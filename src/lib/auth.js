import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import connectDB from "./mongodb.js";
import User from "../models/User.js";
import { logger } from '@/lib/logger';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '@/lib/loginRateLimit';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      httpOptions: {
        timeout: 10000,
      },
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const cleanEmail = String(credentials.email).trim().toLowerCase();
        // req.headers may be a Fetch-style Headers instance OR a plain object
        // depending on which NextAuth entry point invoked authorize().
        const _hdr = (h, k) =>
          typeof h?.get === 'function' ? h.get(k) : h?.[k] ?? h?.[String(k).toLowerCase()];
        const ip =
          _hdr(req?.headers, 'x-forwarded-for')?.split(',')[0]?.trim() ||
          _hdr(req?.headers, 'x-real-ip') ||
          'unknown';
        const gate = checkLoginAllowed({ email: cleanEmail, ip });
        if (!gate.allowed) {
          throw new Error(
            `Too many failed login attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.`
          );
        }
        await connectDB(process.env.MONGODB_URI, true);

        const dbUser = await User.findOne({ email: cleanEmail }).select('+password').lean();
        if (!dbUser || !dbUser.password) {
          recordLoginFailure({ email: cleanEmail, ip });
          throw new Error("Invalid email or password");
        }

        const isValid = await bcrypt.compare(credentials.password, dbUser.password);
        if (!isValid) {
          recordLoginFailure({ email: cleanEmail, ip });
          throw new Error("Invalid email or password");
        }
        recordLoginSuccess({ email: cleanEmail });

        const isAdminEmail = !!process.env.ADMIN_EMAIL && dbUser.email === process.env.ADMIN_EMAIL;

        const supporterActive = dbUser.role === 'admin' ||
          !!(dbUser.supporter?.status &&
            (!dbUser.supporter?.expiresAt || new Date(dbUser.supporter.expiresAt).getTime() > Date.now()));

        return {
          id: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          role: dbUser.role || (isAdminEmail ? 'admin' : 'user'),
          vaultConfigured: !!dbUser.vault?.isConfigured,
          isSupporter: supporterActive,
        };
      }
    }),
  ],
  callbacks: {
    /**
     * signIn — runs once when the user authenticates with Google or Credentials.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") {
        user.dbId = user.id;
        return true;
      }

      if (account?.provider === "google") {
        try {
          await connectDB(process.env.MONGODB_URI, true);
          const profileImage = profile?.picture || user.image;
          const isAdminEmail = !!process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL;
          const update = {
            $set: {
              name: user.name,
              image: profileImage,
              googleId: profile?.sub,
              ...(isAdminEmail ? { role: 'admin' } : {}),
            },
            $setOnInsert: {
              email: user.email,
              role: isAdminEmail ? 'admin' : 'user',
            },
          };
          const dbUser = await User.findOneAndUpdate(
            { email: user.email },
            update,
            {
              new: true,
              upsert: true,
              setDefaultsOnInsert: true,
            }
          ).lean();

          user.dbId = dbUser?._id?.toString?.() || null;
          user.role = dbUser?.role || (isAdminEmail ? 'admin' : 'user');
          user.vaultConfigured = !!dbUser?.vault?.isConfigured;
          user.isSupporter = dbUser?.role === 'admin' ||
            !!(dbUser?.supporter?.status &&
              (!dbUser?.supporter?.expiresAt || new Date(dbUser.supporter.expiresAt).getTime() > Date.now()));
          user.settings = dbUser?.settings || null;

          logger.info(dbUser?.createdAt && dbUser?.updatedAt && dbUser.createdAt.getTime?.() === dbUser.updatedAt.getTime?.()
            ? "🆕 New User created in DB Center:"
            : "✅ User profile synced:", user.email);
          return true;
        } catch (error) {
          logger.error("❌ Error in signIn callback:", error);
          return false;
        }
      }
      return true;
    },

    /**
     * jwt — runs when the JWT is created or refreshed.
     * DB call ONLY on first sign-in (account is present). 
     * All subsequent calls just return the cached token — zero DB queries.
     */
    async jwt({ token, account, user }) {
      if (account) {
        // First sign-in: prefer data already resolved in signIn to avoid a second DB query.
        if (user?.dbId) {
          token.dbId = user.dbId;
          token.role = user.role || 'user';
          token.vaultConfigured = !!user.vaultConfigured;
          token.isSupporter = !!user.isSupporter;
          // IMPORTANT: Do not store user.settings in JWT to prevent HTTP 431 Error (Header Fields Too Large)
        } else {
          try {
            await connectDB(process.env.MONGODB_URI, true);
            const dbUser = await User.findOne({ email: token.email }).lean();
            if (dbUser) {
              token.dbId = dbUser._id.toString();
              token.role = dbUser.role || 'user';
              token.vaultConfigured = dbUser.vault?.isConfigured || false;
              token.isSupporter = dbUser.role === 'admin' ||
                !!(dbUser.supporter?.status &&
                  (!dbUser.supporter?.expiresAt || new Date(dbUser.supporter.expiresAt).getTime() > Date.now()));
            }
          } catch (e) {
            logger.error("JWT callback DB error:", e);
          }
        }
      }
      return token;
    },

    /**
     * session — called on every authenticated request.
     * Reads from the JWT — NO database queries here.
     */
    async session({ session, token }) {
      // Only stable identity is exposed here.
      //
      // `role`, `vaultConfigured` and `isSupporter` were removed deliberately.
      // /api/auth/session is fetched automatically on every page load, which
      // made it a universal reconnaissance endpoint: any XSS could read the
      // victim's role and identify admin accounts to target. Those values now
      // come from /api/user/me, which is only fetched when a feature actually
      // needs them.
      //
      // Server-side authorization is unaffected — every API route re-checks the
      // database directly and has never trusted these session fields.
      session.user.id = token.dbId || token.sub;
      // Do not spread settings here either
      return session;
    },

    /**
     * redirect — validate callbackUrl to prevent open redirects
     */
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      if (new URL(url).origin === baseUrl) return url;
      // Reject all other URLs (prevents open redirect to external sites)
      return baseUrl;
    },
  },
  session: {
    strategy: "jwt",
  },
  // No hardcoded fallback: a predictable secret would let attackers forge session JWTs.
  // Fail fast at startup if NEXTAUTH_SECRET is not configured.
  secret: process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY,
};
