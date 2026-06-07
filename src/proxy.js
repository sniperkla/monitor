import middleware from "next-auth/middleware";
export const proxy = middleware;
export default middleware;

export const config = {
  matcher: [
    "/api/connections/:path*",
    "/api/admin/:path*",
    "/api/user/:path*",
    "/api/wiki/:path*",
    "/((?!api/auth|api/health|api/settings/database|api/deploy/webhook|api/deploy/trigger|_next/static|_next/image|favicon.ico).*)"
  ],
};
