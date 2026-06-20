import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

const handler = NextAuth(authOptions);

// Rate limiting for signin attempts
const signinAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkSigninRateLimit(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const entry = signinAttempts.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  signinAttempts.set(ip, entry);

  return entry.count <= MAX_ATTEMPTS;
}

async function rateLimitedHandler(request, context) {
  const url = new URL(request.url);
  const isSigninRequest =
    (request.method === 'POST' && url.pathname.includes('/signin')) ||
    (request.method === 'POST' && url.pathname.includes('/credentials'));

  if (isSigninRequest && !checkSigninRateLimit(request)) {
    return NextResponse.json(
      { error: 'Too many signin attempts. Please try again later.' },
      { status: 429 }
    );
  }

  return handler(request, context);
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST };
