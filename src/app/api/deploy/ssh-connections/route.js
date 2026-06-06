import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { ConnectionRepository } from '@/lib/repositories/ConnectionRepository';

/**
 * GET /api/deploy/ssh-connections
 * 
 * Fetches all SSH connections available for deployment configuration.
 * Works through both server database and local relay (for vault access).
 * Only returns metadata - no sensitive credentials.
 */
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let db;
    let relayHint = null;

    try {
      // Always connect to the main server database for SSH connections
      db = await connectDB(process.env.MONGODB_URI, true);
    } catch (dbErr) {
      // If relay is required, inform the client
      if (dbErr.message?.includes('Local Relay Agent')) {
        relayHint = dbErr.message;
        return NextResponse.json({
          success: false,
          error: 'Database connection failed. Please ensure Local Relay Agent is connected.',
          relayRequired: true,
          relayHint
        }, { status: 503 });
      }
      throw dbErr;
    }

    const repo = new ConnectionRepository(db);
    await repo.init();
    
    // Fetch all connections
    const allConnections = await repo.findAll();
    
    // Filter for SSH connections only
    const sshConnections = allConnections.filter(conn => conn.type === 'ssh');

    // Return metadata only (no credentials)
    const sanitized = sshConnections.map(conn => ({
      _id: conn._id || conn.id,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType,
      keyFileName: conn.keyFileName,
      color: conn.color,
      isFavorite: conn.isFavorite,
      lastConnected: conn.lastConnected,
      status: conn.status,
    }));

    return NextResponse.json({
      success: true,
      connections: sanitized,
      count: sanitized.length,
      relayHint
    });
  } catch (error) {
    console.error('[deploy/ssh-connections] Error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
