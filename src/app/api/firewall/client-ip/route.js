import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { remoteClientIps } from '@/lib/firewallBlocklist';

// Best-effort VPN/datacenter detection via ip-api.com (free tier, HTTP only).
// Never fails the request — unknown lookups are reported as `unknown`.
async function lookupVpnInfo(ip) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting,isp,org,query`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data?.status !== 'success') return { ip, vpn: null, isp: null };
    return {
      ip,
      vpn: Boolean(data.proxy) || Boolean(data.hosting),
      isp: data.isp || data.org || null,
    };
  } catch {
    return { ip, vpn: null, isp: null };
  }
}

export async function GET(request) {
  try {
    if (!await getServerSession(authOptions)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const ips = remoteClientIps(request.headers);
    const ipInfo = await Promise.all(ips.slice(0, 3).map(lookupVpnInfo));
    return NextResponse.json({
      success: true,
      ips,
      detected: ips.length > 0,
      ipInfo,
      message: ips.length ? null : 'Your public IP could not be detected. Add your SSH/VPN egress IP manually.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'Could not detect the client IP' }, { status: 500 });
  }
}
