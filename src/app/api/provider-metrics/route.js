import { NextResponse } from 'next/server';

// Stub: legacy clients (stale cached bundles) still poll this endpoint.
// Returns an empty metrics payload so they get a cheap 200 instead of 404 noise.
export async function GET() {
  return NextResponse.json({ ok: true, metrics: [] });
}
