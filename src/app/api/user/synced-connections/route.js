import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

// GET: Fetch all synced connections for the current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email })
      .select('syncedConnections')
      .lean();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const connections = user.syncedConnections || [];
    console.log(`📋 GET synced-connections: found ${connections.length} for ${session.user.email}`);
    return NextResponse.json({ connections });
  } catch (error) {
    console.error('GET synced-connections error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: Sync connections (upsert by fingerprint)
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { connections } = await request.json();
    if (!Array.isArray(connections) || connections.length === 0) {
      return NextResponse.json({ error: 'No connections provided' }, { status: 400 });
    }

    if (connections.length > 100) {
      return NextResponse.json({ error: 'Max 100 connections per sync' }, { status: 400 });
    }

    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.syncedConnections) user.syncedConnections = [];

    let added = 0;
    let updated = 0;

    for (const conn of connections) {
      if (!conn.fingerprint || !conn.encryptedData || !conn.salt || !conn.iv) {
        continue; // skip invalid entries
      }

      const existingIdx = user.syncedConnections.findIndex(
        sc => sc.fingerprint === conn.fingerprint
      );

      if (existingIdx >= 0) {
        user.syncedConnections[existingIdx] = {
          fingerprint: conn.fingerprint,
          name: conn.name || '',
          host: conn.host || '',
          type: conn.type || 'ssh',
          encryptedData: conn.encryptedData,
          salt: conn.salt,
          iv: conn.iv,
          syncedAt: new Date(),
        };
        updated++;
      } else {
        user.syncedConnections.push({
          fingerprint: conn.fingerprint,
          name: conn.name || '',
          host: conn.host || '',
          type: conn.type || 'ssh',
          encryptedData: conn.encryptedData,
          salt: conn.salt,
          iv: conn.iv,
          syncedAt: new Date(),
        });
        added++;
      }
    }

    await user.save();
    return NextResponse.json({ success: true, added, updated, total: user.syncedConnections.length });
  } catch (error) {
    console.error('POST synced-connections error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE: Remove specific synced connections by fingerprint, or clear all
export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    
    await connectDB(process.env.MONGODB_URI, true);
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.syncedConnections) user.syncedConnections = [];

    // Clear all synced connections
    if (body.clearAll) {
      const count = user.syncedConnections.length;
      user.syncedConnections = [];
      await user.save();
      return NextResponse.json({ success: true, removed: count });
    }

    // Remove by fingerprints
    const { fingerprints } = body;
    if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
      return NextResponse.json({ error: 'No fingerprints provided' }, { status: 400 });
    }

    const before = user.syncedConnections.length;
    user.syncedConnections = user.syncedConnections.filter(
      sc => !fingerprints.includes(sc.fingerprint)
    );
    await user.save();

    return NextResponse.json({ success: true, removed: before - user.syncedConnections.length });
  } catch (error) {
    console.error('DELETE synced-connections error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
