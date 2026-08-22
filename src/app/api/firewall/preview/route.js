import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { parseBlocklist, getConflictingEntries, normalizeEntry, remoteClientIps } from '@/lib/firewallBlocklist';

export async function POST(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { content, protectedIps = [] } = await request.json();
    const parsed = parseBlocklist(content);
    // The managed set uses ipset's IPv4 family. Keeping this explicit prevents a
    // mixed IPv4/IPv6 upload from failing part-way through a remote apply.
    const entries = parsed.entries.filter(entry => isIP(entry.split('/')[0]) === 4);
    const ignored = parsed.ignored + (parsed.entries.length - entries.length);
    const protection = [...remoteClientIps(request.headers), ...protectedIps.map(normalizeEntry).filter(Boolean).map(ip => ip.split('/')[0])];
    const conflicts = getConflictingEntries(entries, protection);
    return NextResponse.json({ success: true, entries, ignored, protectedIps: [...new Set(protection)], conflicts });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not validate this blocklist' }, { status: 400 });
  }
}
