import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import connectDB from "./mongodb.js";
import User from "../models/User.js";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const cleanEmail = String(credentials.email).trim().toLowerCase();
        await connectDB(process.env.MONGODB_URI, true);

        const dbUser = await User.findOne({ email: cleanEmail }).select('+password').lean();
        if (!dbUser || !dbUser.password) {
          throw new Error("Invalid email or password");
        }

        const isValid = await bcrypt.compare(credentials.password, dbUser.password);
        if (!isValid) {
          throw new Error("Invalid email or password");
        }

        const isAdminEmail = !!process.env.ADMIN_EMAIL && dbUser.email === process.env.ADMIN_EMAIL;

        return {
          id: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          role: dbUser.role || (isAdminEmail ? 'admin' : 'user'),
          vaultConfigured: !!dbUser.vault?.isConfigured,
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
          user.settings = dbUser?.settings || null;

          console.log(dbUser?.createdAt && dbUser?.updatedAt && dbUser.createdAt.getTime?.() === dbUser.updatedAt.getTime?.()
            ? "🆕 New User created in DB Center:"
            : "✅ User profile synced:", user.email);
          return true;
        } catch (error) {
          console.error("❌ Error in signIn callback:", error);
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
          // IMPORTANT: Do not store user.settings in JWT to prevent HTTP 431 Error (Header Fields Too Large)
        } else {
          try {
            await connectDB(process.env.MONGODB_URI, true);
            const dbUser = await User.findOne({ email: token.email }).lean();
            if (dbUser) {
              token.dbId = dbUser._id.toString();
              token.role = dbUser.role || 'user';
              token.vaultConfigured = dbUser.vault?.isConfigured || false;
            }
          } catch (e) {
            console.error("JWT callback DB error:", e);
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
      session.user.id             = token.dbId || token.sub;
      session.user.role           = token.role || 'user';
      session.user.vaultConfigured = token.vaultConfigured || false;
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
  secret: process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY || 'b5caf31cfa8c03a8ac8350f76e35eee30ed4e1d57f25596f900a558e6c98c04e',
};
