import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { remoteClientIps } from '@/lib/firewallBlocklist';

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const ips = remoteClientIps(request.headers);
    return NextResponse.json({
      success: true,
      ips,
      detected: ips.length > 0,
      message: ips.length ? null : 'Your public IP could not be detected. Add your SSH/VPN egress IP manually.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not detect the client IP' }, { status: 500 });
  }
}
