import { NextResponse } from 'next/server';

// AI daily usage tracking removed — returns empty data so existing callers don't crash
export async function GET() {
  return NextResponse.json({
    success: true,
    used: 0,
    limit: 0,
    remaining: 0,
    percentage: 0,
    resetsInSeconds: 0,
    isAdmin: false,
  });
}
