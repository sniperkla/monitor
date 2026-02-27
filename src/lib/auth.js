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
    async signIn({ user, account, profile }) {
      if (account.provider === "google") {
        try {
          // Connect to DB Center using the global default connection
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
            // Update profile info (captures updated image/name from Google)
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
    async session({ session, token }) {
      try {
        await connectDB(process.env.MONGODB_URI, true);
        const dbUser = await User.findOne({ email: session.user.email });
        if (dbUser) {
          session.user.id = dbUser._id;
          session.user.name = dbUser.name;
          session.user.image = dbUser.image;
          session.user.role = dbUser.role || 'user';
          session.user.vaultConfigured = dbUser.vault?.isConfigured || false;
          session.user.settings = dbUser.settings;
        }
      } catch (e) {
        console.error("Session callback error:", e);
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
