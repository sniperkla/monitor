import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  callbacks: {
    authorized: ({ token, req }) => {
      if (!token) {
        const pathname = req.nextUrl.pathname;
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
          );
        }
      }
      return !!token;
    },
  },
});

export default proxy;

export const config = {
  matcher: [
    "/api/connections/:path*",
    "/api/admin/:path*",
    "/api/user/:path*",
    "/api/wiki/:path*",
    "/((?!api/auth|api/health|api/settings/database|api/deploy/webhook|api/deploy/trigger|_next/static|_next/image|favicon.ico|monitor-agent\\.min\\.js|monitor-agent\\.js|local-relay\\.min\\.js|local-relay\\.js|$).*)"
  ],
};
