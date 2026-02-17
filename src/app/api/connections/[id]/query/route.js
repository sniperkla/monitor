
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { getPooledConnection, buildMongoUri } from '@/lib/dbPool';
import { decrypt } from '@/utils/encryption';
import { checkRateLimit, checkMemory, getConcurrencyLimiter, LIMITS } from '@/lib/serverGuard';

export async function POST(request, { params }) {
  try {
    // Rate limiting
    const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateCheck = checkRateLimit(clientIP);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const { id } = await params;
    const body = await request.json();
    const { connection, query } = body;
    let conn = connection;
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

    if (!query) throw new Error('Query body is missing');

    // Use pooled connection instead of creating a new one every time
    const pooled = await getPooledConnection(conn);

    if (provider === 'mongodb') {
      let result;
      const collection = query.collection;
      if (!collection) throw new Error('Collection name is required');
      const col = pooled.db.db.collection(collection);

      if (query.action === 'find') {
        // Default to newest first so users see their new insertions
        const sort = query.sort || { _id: -1 }; 
        result = await col.find(query.filter || {}).sort(sort).limit(100).toArray();
      } else if (query.action === 'insertOne') {
        result = await col.insertOne(query.data);
      } else if (query.action === 'insertMany') {
        result = await col.insertMany(query.data);
      } else if (query.action === 'updateOne') {
        const filter = { ...query.filter };
        if (filter._id && typeof filter._id === 'string') {
          try { filter._id = new mongoose.Types.ObjectId(filter._id); } catch(e) {}
        }
        
        let updateDoc = query.update;
        if (!updateDoc && query.data) {
          updateDoc = { $set: query.data };
        }
        
        if (!updateDoc) throw new Error('Update document is required');
        
        result = await col.updateOne(filter, updateDoc);
      } else if (query.action === 'updateMany') {
        const filter = { ...query.filter } || {};
        if (filter._id && typeof filter._id === 'string') {
          try { filter._id = new mongoose.Types.ObjectId(filter._id); } catch(e) {}
        }

        let updateDoc = query.update;
        if (!updateDoc && query.data) {
          updateDoc = { $set: query.data };
        }

        if (!updateDoc) throw new Error('Update document is required');

        result = await col.updateMany(filter, updateDoc);
      } else if (query.action === 'deleteOne') {
        const filter = { ...query.filter };
        if (filter._id && typeof filter._id === 'string') {
          try { filter._id = new mongoose.Types.ObjectId(filter._id); } catch(e) {}
        }
        result = await col.deleteOne(filter);
      } else if (query.action === 'deleteMany') {
         const filter = { ...query.filter } || {};
         if (filter._id && typeof filter._id === 'string') {
           try { filter._id = new mongoose.Types.ObjectId(filter._id); } catch(e) {}
         }
         result = await col.deleteMany(filter);
      } else {
        throw new Error(`Action ${query.action} not supported`);
      }
      return NextResponse.json({ success: true, data: result });

    } else if (provider === 'mysql') {
      let result;
      // Handle structured query objects (like MongoDB)
      if (typeof query === 'object' && query.action) {
         const { action, collection, data, filter } = query;
         if (!collection) throw new Error('Table name is required');
         
         if (action === 'find') {
            const [rows] = await pooled.db.query(`SELECT * FROM \`${collection}\` LIMIT 100`);
            result = rows;
         } else if (action === 'insertOne') {
            const columns = Object.keys(data);
            const placeholders = columns.map(() => '?').join(', ');
            const sql = `INSERT INTO \`${collection}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;
            const [res] = await pooled.db.execute(sql, Object.values(data));
            result = res;
         } else if (action === 'insertMany') {
            if (!Array.isArray(data) || data.length === 0) throw new Error('Data must be non-empty array');
            const columns = Object.keys(data[0]);
            const sql = `INSERT INTO \`${collection}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES ?`;
            const values = data.map(row => columns.map(col => row[col]));
            const [res] = await pooled.db.query(sql, [values]);
            result = res;
         } else if (action === 'updateOne') {
            const columns = Object.keys(data);
            const setClause = columns.map(c => `\`${c}\` = ?`).join(', ');
            const filterKey = Object.keys(filter)[0];
            const sql = `UPDATE \`${collection}\` SET ${setClause} WHERE \`${filterKey}\` = ?`;
            const [res] = await pooled.db.execute(sql, [...Object.values(data), filter[filterKey]]);
            result = res;
         } else if (action === 'deleteOne') {
            const filterKey = Object.keys(filter)[0];
            const sql = `DELETE FROM \`${collection}\` WHERE \`${filterKey}\` = ?`;
            const [res] = await pooled.db.execute(sql, [filter[filterKey]]);
            result = res;
         }
      } else {
         // Fallback to legacy raw string query
         const [rows] = await pooled.db.query(query);
         result = rows;
      }
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json({ success: false, error: 'Provider not supported' }, { status: 400 });
  } catch (error) {
    console.error('Query execution error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
