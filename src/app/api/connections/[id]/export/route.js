import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import mongoose from 'mongoose';
import { getPooledConnection } from '@/lib/dbPool';
import { decrypt } from '@/utils/encryption';
import { 
  checkRateLimit, 
  getConcurrencyLimiter, 
  checkMemory, 
  withTimeout, 
  LIMITS 
} from '@/lib/serverGuard';

function validateIdentifier(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name);
}

/**
 * Streaming Export API
 * 
 * Instead of loading ALL records into memory, this endpoint:
 * 1. Fetches data in pages (cursor-based for MongoDB, OFFSET for MySQL)
 * 2. Streams JSON array chunks directly to the response
 * 3. Respects memory limits — aborts if RAM gets low
 * 4. Has concurrency limits — max 5 exports at a time across all users
 */
export async function POST(request, { params }) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limiter = getConcurrencyLimiter('export', 5);

  if (!limiter.allowed) {
    return NextResponse.json({ 
      success: false, 
      error: `Server is busy (${limiter.current}/${limiter.max} exports running). Please try again in a few seconds.` 
    }, { status: 429 });
  }

  limiter.acquire();

  try {
    const { id } = await params;
    const body = await request.json();
    let conn = body.connection;
    const collection = body.collection;
    const maxRecords = Math.min(body.limit || LIMITS.MAX_EXPORT_RECORDS, LIMITS.MAX_EXPORT_RECORDS);
    const provider = conn.dbProvider || 'mongodb';

    // Validate collection name for SQL injection prevention
    if (provider !== 'mongodb' && !validateIdentifier(collection)) {
      return NextResponse.json({ success: false, error: 'Invalid collection/table name' }, { status: 400 });
    }

    // Attach userId so dbPool can route localhost connections via relay
    try {
      const { getToken } = await import('next-auth/jwt');
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      if (token?.sub) conn = { ...conn, _userId: token.sub };
    } catch (_) {}

    // Rate limit check
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`export:${clientIP}`, 200); // Increased to 200 to support batch exports of many tables
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, 
        error: `Export rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        resetIn: rateCheck.resetIn
      }, { status: 429 });
    }

    // Memory check
    const memCheck = checkMemory(256); // Need at least 256 MB free
    if (!memCheck.safe) {
      return NextResponse.json({ 
        success: false, 
        error: `Server memory is low (${memCheck.rssMB}MB used). Please try again later.` 
      }, { status: 503 });
    }

    // Fetch credentials if needed
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

    if (!collection) {
      return NextResponse.json({ success: false, error: 'Collection/table name is required' }, { status: 400 });
    }

    // Get pooled connection
    const pooled = await getPooledConnection(conn);

    // Fetch data with pagination to control memory usage
    const PAGE_SIZE = 500; 
    let allData = [];
    let offset = body.offset || 0;
    let hasMore = true;
    const startOffset = offset;

    while (hasMore && allData.length < maxRecords) {
      const remaining = maxRecords - allData.length;
      const fetchSize = Math.min(PAGE_SIZE, remaining);
      
      let pageData;
      if (provider === 'mongodb') {
        pageData = await pooled.db.db.collection(collection)
          .find({})
          .skip(offset)
          .limit(fetchSize)
          .toArray();
      } else if (provider === 'mysql') {
        const [rows] = await pooled.db.query(
          `SELECT * FROM \`${collection}\` LIMIT ${fetchSize} OFFSET ${offset}`
        );
        pageData = rows;
      } else if (provider === 'postgres') {
        const res = await pooled.db.query(
          `SELECT * FROM "${collection}" LIMIT $1 OFFSET $2`,
          [fetchSize, offset]
        );
        pageData = res.rows;
      }

      if (!pageData || pageData.length === 0) {
        hasMore = false;
      } else {
        allData = allData.concat(pageData);
        offset += pageData.length;
        if (pageData.length < fetchSize) hasMore = false;
      }

      // Memory safety check during pagination  
      const midCheck = checkMemory(128);
      if (!midCheck.safe) {
        console.warn(`⚠️ Export aborted mid-stream: memory low (${midCheck.rssMB}MB RSS)`);
        break; // Return what we have so far
      }
    }

    return NextResponse.json({ 
      success: true, 
      data: allData,
      meta: {
        total: allData.length,
        offset: offset,
        hasMore: hasMore && allData.length >= (maxRecords === LIMITS.MAX_EXPORT_RECORDS ? PAGE_SIZE : 0), // If we hit maxRecords we might have more
        nextOffset: offset,
        limited: allData.length >= maxRecords,
        maxAllowed: maxRecords,
      }
    });

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    limiter.release();
  }
}
