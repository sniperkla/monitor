import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getPooledConnection } from '@/lib/dbPool';
import { decrypt } from '@/utils/encryption';
import { checkRateLimit } from '@/lib/serverGuard';
import { attachRequestUserId, isRelayConnectionError, friendlyRelayErrorMessage } from '@/lib/requestUser';

export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`schema:${clientIP}`);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const { id } = await params;
    const body = await request.json();
    let conn = body.connection;
    const provider = conn.dbProvider || 'mongodb';

    // SECURITY FIX: If password is missing (sanitized on frontend), fetch from DB
    if (!conn.password && !id.startsWith('local-')) {
      const connectDB = (await import('@/lib/mongodb')).default;
      const { ConnectionRepository } = await import('@/lib/repositories/ConnectionRepository');
      const db = await connectDB();
      const repo = new ConnectionRepository(db);
      const fullConn = await repo.findById(id);
      if (fullConn) {
        conn = { ...conn, ...fullConn.toObject ? fullConn.toObject() : fullConn };
      }
    }

    console.log(`🔍 Fetching schema for ${provider}`);

    conn = await attachRequestUserId(request, conn);

    // Use pooled connection
    const pooled = await getPooledConnection(conn);
    
    if (provider === 'mongodb') {
      let collections = [];
      try {
        const rawColls = await pooled.db.db.listCollections().toArray();
        collections = rawColls;
      } catch (collErr) {
        console.warn(`[schema] listCollections auth warning for ${id}:`, collErr.message);
      }
      
      // Update status if it's a real DB connection
      if (id && !id.startsWith('local-')) {
        try {
          const { ConnectionRepository } = await import('@/lib/repositories/ConnectionRepository');
          const repo = new ConnectionRepository(await (await import('@/lib/mongodb')).default());
          await repo.update(id, { status: 'online', lastConnected: new Date() });
        } catch (e) {}
      }
      
      return NextResponse.json({ success: true, data: collections.map(c => c.name) });

    } else if (provider === 'mysql') {
      const [rows] = await pooled.db.query('SHOW TABLES');
      
      // Update status if it's a real DB connection
      if (id && !id.startsWith('local-')) {
        try {
          const { ConnectionRepository } = await import('@/lib/repositories/ConnectionRepository');
          const repo = new ConnectionRepository(await (await import('@/lib/mongodb')).default());
          await repo.update(id, { status: 'online', lastConnected: new Date() });
        } catch (e) {}
      }
      
      if (rows.length === 0) return NextResponse.json({ success: true, data: [] });
      const tableKey = Object.keys(rows[0])[0];
      return NextResponse.json({ success: true, data: rows.map(r => r[tableKey]) });

    } else if (provider === 'postgres') {
      const result = await pooled.db.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );

      // Update status if it's a real DB connection
      if (id && !id.startsWith('local-')) {
        try {
          const { ConnectionRepository } = await import('@/lib/repositories/ConnectionRepository');
          const repo = new ConnectionRepository(await (await import('@/lib/mongodb')).default());
          await repo.update(id, { status: 'online', lastConnected: new Date() });
        } catch (e) {}
      }

      return NextResponse.json({ success: true, data: result.rows.map(r => r.table_name) });
    }
  } catch (error) {
    console.error('Schema fetch error:', error);
    
    // Try to mark as offline
    try {
      const { id } = await params;
      if (id && !id.startsWith('local-')) {
        const { ConnectionRepository } = await import('@/lib/repositories/ConnectionRepository');
        const repo = new ConnectionRepository(await (await import('@/lib/mongodb')).default());
        await repo.update(id, { status: 'offline' });
      }
    } catch (e) {}
    
    const relayRequired = isRelayConnectionError(error.message);
    return NextResponse.json({
      success: false,
      error: relayRequired ? friendlyRelayErrorMessage(error.message) : error.message,
      relayRequired,
    }, { status: 500 });
  }
}
