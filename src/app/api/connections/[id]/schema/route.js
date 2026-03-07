import { NextResponse } from 'next/server';
import { getPooledConnection } from '@/lib/dbPool';
import { decrypt } from '@/utils/encryption';
import { checkRateLimit } from '@/lib/serverGuard';

export async function POST(request, { params }) {
  try {
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

    console.log(`🔍 Fetching schema for ${provider} on ${conn.host}:${conn.port}`);

    // Attach userId so dbPool can route localhost connections via relay
    try {
      const { getToken } = await import('next-auth/jwt');
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      if (token?.sub) conn = { ...conn, _userId: token.sub };
    } catch (_) {}

    // Use pooled connection
    const pooled = await getPooledConnection(conn);
    
    if (provider === 'mongodb') {
      const collections = await pooled.db.db.listCollections().toArray();
      
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
    }

    return NextResponse.json({ success: false, error: 'Provider not supported' }, { status: 400 });
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
    
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
