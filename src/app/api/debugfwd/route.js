import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id || null;
  const userRelays = global.__activeRelays?.get(uid);
  const relays = [];
  if (userRelays instanceof Map) for (const [rid, r] of userRelays) relays.push({ rid, name: r.relayName, caps: r.capabilities, ws: r.ws?.readyState, fwd: r.forwarders instanceof Map ? [...r.forwarders.keys()] : String(r.forwarders) });
  return NextResponse.json({ uid, fnType: typeof global.__requestRelayForwarder, relays });
}
