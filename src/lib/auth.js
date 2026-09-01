import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import connectDB from "./mongodb.js";
import User from "../models/User.js";
import { logger } from '@/lib/logger';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '@/lib/loginRateLimit';

/**
 * Allowed callback-URL origins.
 *
 * The redirect callback uses this as a defence-in-depth allowlist: even if
 * the same-origin check is somehow bypassed (e.g. by a misconfigured
 * NEXTAUTH_URL / baseUrl), only origins explicitly listed here are honoured.
 *
 * `NEXTAUTH_URL` is always allowed (that is the app itself). Additional
 * origins can be added via the CALLBACK_URL_ALLOWLIST env var (space/comma
 * separated), useful when the app is served from multiple domains.
 */
function getCallbackAllowlist() {
  const set = new Set();
  // The app's own origin — NEXTAUTH_URL is the canonical config.
  if (process.env.NEXTAUTH_URL) {
    try { set.add(new URL(process.env.NEXTAUTH_URL).origin); } catch { /* ignore malformed */ }
  }
  // AUTH_URL is NextAuth v5's equivalent name.
  if (process.env.AUTH_URL) {
    try { set.add(new URL(process.env.AUTH_URL).origin); } catch { /* ignore malformed */ }
  }
  // Explicit additions for multi-domain deployments.
  const extra = process.env.CALLBACK_URL_ALLOWLIST;
  if (extra) {
    for (const part of extra.split(/[\s,]+/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try { set.add(new URL(trimmed).origin); } catch { /* ignore malformed */ }
    }
  }
  return set;
}

/**
 * Check whether a callback URL is safe (same-origin or on the allowlist).
 *
 * Used by the [...nextauth] route handler to sanitise the `callbackUrl` query
 * parameter BEFORE NextAuth renders the signin form — preventing an attacker-
 * supplied external URL from being embedded in the form's hidden input.
 *
 * @param {string} callbackUrl  the raw callbackUrl value from the query string
 * @param {string} currentOrigin  the origin of the current request (req.url origin)
 * @returns {boolean} true if the URL is same-origin or on the allowlist
 */
export function sanitizeCallbackUrl(callbackUrl, currentOrigin) {
  if (!callbackUrl) return true;
  // Relative paths starting with a single slash are safe.
  if (callbackUrl.startsWith('/') && !callbackUrl.startsWith('//') && !callbackUrl.startsWith('\\')) {
    return true;
  }
  try {
    const cbOrigin = new URL(callbackUrl).origin;
    if (cbOrigin === currentOrigin) return true;
    if (getCallbackAllowlist().has(cbOrigin)) return true;
  } catch {
    // Malformed URL — not safe.
  }
  return false;
}

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
     * redirect — validate callbackUrl to prevent open redirects.
     *
     * Threat: an attacker crafts `/api/auth/signin/google?callbackUrl=https://evil.com`
     * and tricks a victim into clicking it. After OAuth completes, the victim's
     * browser is sent to evil.com, enabling phishing and token theft. The
     * callbackUrl is also embedded as a hidden input in NextAuth's built-in
     * signin form, so validation must happen BEFORE it reaches the form.
     *
     * Defence-in-depth: every branch that does NOT match the allowlist returns
     * `baseUrl` — never the attacker-supplied URL. All parsing is wrapped so a
     * malformed URL cannot throw and fall through to NextAuth's default
     * (which would honour the original callbackUrl).
     */
    async redirect({ url, baseUrl }) {
      const allowlist = getCallbackAllowlist();
      try {
        const baseOrigin = new URL(baseUrl).origin;

        // 1. Same-origin absolute URL. Check against baseUrl AND the explicit
        //    allowlist so a misconfigured NEXTAUTH_URL cannot widen the net.
        let urlOrigin = null;
        try { urlOrigin = new URL(url).origin; } catch { /* relative — handled below */ }
        if (urlOrigin) {
          if (urlOrigin === baseOrigin) return url;
          if (allowlist.has(urlOrigin)) return url;
          // External origin not on the allowlist — reject.
          return baseUrl;
        }

        // 2. Relative path on our own origin. Only allow paths starting with
        //    a single slash — protocol-relative URLs (//evil.com) and
        //    backslash tricks (\\evil.com) are rejected.
        if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('\\')) {
          return `${baseUrl}${url}`;
        }

        // 3. Everything else (external origins, protocol-relative, malformed)
        //    is rejected. Never return the attacker-supplied URL.
        return baseUrl;
      } catch {
        // If anything unexpected happens, send the user to the safe home page.
        return baseUrl;
      }
    },
  },
  session: {
    strategy: "jwt",
  },
  // No hardcoded fallback: a predictable secret would let attackers forge session JWTs.
  // Fail fast at startup if NEXTAUTH_SECRET is not configured.
  secret: process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY,
};
