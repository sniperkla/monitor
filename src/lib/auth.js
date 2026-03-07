import GoogleProvider from "next-auth/providers/google";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    /**
     * signIn — runs once when the user authenticates with Google.
     * Creates or syncs the user record in the center DB.
     */
    async signIn({ user, account, profile }) {
      if (account.provider === "google") {
        try {
          await connectDB(process.env.MONGODB_URI, true);
          let existingUser = await User.findOne({ email: user.email });
          const profileImage = profile.picture || user.image;
          if (!existingUser) {
            existingUser = await User.create({
              name: user.name,
              email: user.email,
              image: profileImage,
              googleId: profile.sub,
              role: process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL ? 'admin' : 'user',
            });
            console.log("🆕 New User created in DB Center:", user.email);
          } else {
            existingUser.name = user.name;
            existingUser.image = profileImage;
            await existingUser.save();
            console.log("✅ User profile synced:", user.email);
          }
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
    async jwt({ token, account }) {
      if (account) {
        // First sign-in: fetch MongoDB _id and role once, store in the JWT.
        try {
          await connectDB(process.env.MONGODB_URI, true);
          const dbUser = await User.findOne({ email: token.email }).lean();
          if (dbUser) {
            token.dbId           = dbUser._id.toString();
            token.role           = dbUser.role || 'user';
            token.vaultConfigured = dbUser.vault?.isConfigured || false;
            token.settings       = dbUser.settings || null;
          }
        } catch (e) {
          console.error("JWT callback DB error:", e);
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
      session.user.settings       = token.settings || null;
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
