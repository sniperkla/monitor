import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

// AI training / scraping bots — blocked hard at the edge (403).
// These bots often ignore robots.txt, so we enforce it in code as well.
const AI_BOT_PATTERNS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "Applebot-Extended",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Diffbot",
  "ImagesiftBot",
  "YouBot",
];

function isAiBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return AI_BOT_PATTERNS.some((bot) => ua.includes(bot.toLowerCase()));
}

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

export default function wrappedProxy(req) {
  // Hard-block known AI scrapers before anything else runs.
  if (isAiBot(req.headers.get("user-agent"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return proxy(req);
}

export const config = {
  matcher: [
    "/api/connections/:path*",
    "/api/admin/:path*",
    "/api/user/:path*",
    "/api/wiki/:path*",
    "/((?!api/auth|api/health|api/settings/database|api/deploy/webhook|api/deploy/trigger|_next/static|_next/image|favicon.ico|monitor-agent\\.min\\.js|monitor-agent\\.js|local-relay\\.min\\.js|local-relay\\.js|$).*)"
  ],
};
