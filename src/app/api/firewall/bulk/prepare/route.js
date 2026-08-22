import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prepareBulkBatch } from '@/lib/firewallBulkImport';
import { remoteClientIps } from '@/lib/firewallBlocklist';

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { importIds, protectedIps = [] } = await request.json();
    const batch = await prepareBulkBatch(importIds, [...remoteClientIps(request.headers), ...protectedIps]);
    return NextResponse.json({ success: true, ...batch });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not prepare blocklist batch' }, { status: 400 });
  }
}
