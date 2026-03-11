import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { getConnectionModel } from '@/models/Connection';

function mapSqlRow(r) {
  return {
    ...r,
    _id: r.id?.toString(),
    type: r.type || 'ssh',
    dbProvider: r.dbprovider || r.dbProvider || 'mongodb',
    authType: r.authtype || r.authType || 'password',
    privateKey: r.privatekey || r.privateKey || null,
    keyFileName: r.keyfilename || r.keyFileName || null,
    passphrase: r.passphrase || null,
    tags: (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) || [],
    isFavorite: !!(r.isfavorite !== undefined ? r.isfavorite : r.isFavorite),
    isSrv: !!(r.issrv !== undefined ? r.issrv : r.isSrv),
    sshTunnel: !!(r.sshtunnel !== undefined ? r.sshtunnel : r.sshTunnel),
    sshTunnelHost: r.sshtunnelhost || r.sshTunnelHost || null,
    sshTunnelPort: r.sshtunnelport || r.sshTunnelPort || 22,
    sshTunnelUser: r.sshtunneluser || r.sshTunnelUser || null,
    sshTunnelAuth: r.sshtunnelauth || r.sshTunnelAuth || 'password',
    sshTunnelPassword: r.sshtunnelpassword || r.sshTunnelPassword || null,
    sshTunnelPrivateKey: r.sshtunnelprivatekey || r.sshTunnelPrivateKey || null,
    sshTunnelPassphrase: r.sshtunnelpassphrase || r.sshTunnelPassphrase || null,
    lastConnected: r.lastconnected || r.lastConnected || null,
    createdAt: r.createdat || r.createdAt,
    updatedAt: r.updatedat || r.updatedAt,
    database: r.database_name || null
  };
}

/**
 * Read ALL connections from a given source database URI.
 * Returns an array of plain connection objects.
 */
export async function readConnectionsFromSource(sourceUri) {
  if (!sourceUri) return [];

  // --- MongoDB source ---
  if (sourceUri.startsWith('mongodb')) {
    let conn;
    try {
      // If the default mongoose connection is already connected, reuse it
      if (mongoose.connection.readyState === 1) {
        const model = mongoose.models.Connection || getConnectionModel(mongoose);
        const docs = await model.find({}).lean();
        return docs.map(d => ({ ...d, _id: d._id?.toString() }));
      }
      // Otherwise create a temporary connection
      conn = await mongoose.createConnection(sourceUri, {
        serverSelectionTimeoutMS: 5000,
      }).asPromise();
      const model = getConnectionModel(conn);
      const docs = await model.find({}).lean();
      return docs.map(d => ({ ...d, _id: d._id?.toString() }));
    } catch (e) {
      console.error('Migration: MongoDB read error:', e.message);
      return [];
    } finally {
      if (conn) try { await conn.close(); } catch (_) {}
    }
  }

  // --- MySQL source ---
  if (sourceUri.startsWith('mysql://')) {
    let pool;
    try {
      pool = mysql.createPool(sourceUri);
      const [tables] = await pool.execute("SHOW TABLES LIKE 'connections'");
      if (tables.length === 0) return [];
      const [rows] = await pool.execute('SELECT * FROM connections');
      return rows.map(r => mapSqlRow(r));
    } catch (e) {
      console.error('Migration: MySQL read error:', e.message);
      return [];
    } finally {
      if (pool) try { await pool.end(); } catch (_) {}
    }
  }

  // --- PostgreSQL source ---
  if (sourceUri.startsWith('postgres://') || sourceUri.startsWith('postgresql://')) {
    let client;
    try {
      client = new Client({ connectionString: sourceUri, connectionTimeoutMillis: 5000 });
      await client.connect();
      const tableCheck = await client.query("SELECT to_regclass('public.connections') AS t");
      if (!tableCheck.rows[0].t) return [];
      const res = await client.query('SELECT * FROM connections');
      return res.rows.map(r => mapSqlRow(r));
    } catch (e) {
      console.error('Migration: PostgreSQL read error:', e.message);
      return [];
    } finally {
      if (client) try { await client.end(); } catch (_) {}
    }
  }

  return [];
}

/**
 * Pick only the fields we need for migration.
 */
function pick(c) {
  return {
    type: c.type || 'ssh',
    dbProvider: c.dbProvider || 'mongodb',
    name: c.name,
    host: c.host,
    port: c.port || 22,
    username: c.username || '',
    authType: c.authType || 'password',
    password: c.password || null,
    database: c.database || c.database_name || null,
    privateKey: c.privateKey || null,
    keyFileName: c.keyFileName || null,
    passphrase: c.passphrase || null,
    tags: c.tags || [],
    color: c.color || '#6366f1',
    status: 'unknown',
    isFavorite: !!c.isFavorite,
    isSrv: !!c.isSrv,
    notes: c.notes || '',
    sshTunnel: !!c.sshTunnel,
    sshTunnelHost: c.sshTunnelHost || null,
    sshTunnelPort: c.sshTunnelPort || 22,
    sshTunnelUser: c.sshTunnelUser || null,
    sshTunnelAuth: c.sshTunnelAuth || 'password',
    sshTunnelPassword: c.sshTunnelPassword || null,
    sshTunnelPrivateKey: c.sshTunnelPrivateKey || null,
    sshTunnelPassphrase: c.sshTunnelPassphrase || null,
  };
}

/**
 * Write connections into the DESTINATION database.
 */
export async function writeConnectionsToTarget(targetUri, connections) {
  if (!targetUri || connections.length === 0) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  // --- Target: MongoDB ---
  if (targetUri.startsWith('mongodb')) {
    let conn;
    try {
      conn = await mongoose.createConnection(targetUri, {
        serverSelectionTimeoutMS: 5000,
      }).asPromise();
      const model = getConnectionModel(conn);

      for (const c of connections) {
        if (!c.name || !c.host) { skipped++; continue; }
        const existing = await model.findOne({ name: c.name, host: c.host });
        if (existing) { skipped++; continue; }
        await model.create(pick(c));
        imported++;
      }
    } catch (e) {
      console.error('Migration: MongoDB write error:', e.message);
    } finally {
      if (conn) try { await conn.close(); } catch (_) {}
    }
  }

  // --- Target: MySQL ---
  else if (targetUri.startsWith('mysql://')) {
    let pool;
    try {
      pool = mysql.createPool(targetUri);
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS connections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          type VARCHAR(20) DEFAULT 'ssh',
          dbProvider VARCHAR(20) DEFAULT 'mongodb',
          name VARCHAR(255) NOT NULL,
          host VARCHAR(255) NOT NULL,
          port INT DEFAULT 22,
          username VARCHAR(255) DEFAULT '',
          authType VARCHAR(20) DEFAULT 'password',
          password TEXT,
          database_name VARCHAR(255),
          privateKey TEXT,
          keyFileName VARCHAR(255),
          passphrase TEXT,
          tags JSON,
          color VARCHAR(20) DEFAULT '#6366f1',
          lastConnected DATETIME,
          status VARCHAR(20) DEFAULT 'unknown',
          isFavorite BOOLEAN DEFAULT FALSE,
          isSrv BOOLEAN DEFAULT FALSE,
          sshTunnel BOOLEAN DEFAULT FALSE,
          sshTunnelHost VARCHAR(255),
          sshTunnelPort INT DEFAULT 22,
          sshTunnelUser VARCHAR(255),
          sshTunnelAuth VARCHAR(20) DEFAULT 'password',
          sshTunnelPassword TEXT,
          sshTunnelPrivateKey TEXT,
          sshTunnelPassphrase TEXT,
          notes TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      for (const c of connections) {
        if (!c.name || !c.host) { skipped++; continue; }
        const [existing] = await pool.execute(
          'SELECT id FROM connections WHERE name = ? AND host = ? LIMIT 1',
          [c.name, c.host]
        );
        if (existing.length > 0) { skipped++; continue; }

        const data = pick(c);
        await pool.execute(
          `INSERT INTO connections (type, dbProvider, name, host, port, username, authType, password, database_name, privateKey, keyFileName, passphrase, tags, color, status, isFavorite, isSrv, notes, sshTunnel, sshTunnelHost, sshTunnelPort, sshTunnelUser, sshTunnelAuth, sshTunnelPassword, sshTunnelPrivateKey, sshTunnelPassphrase)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [data.type, data.dbProvider, data.name, data.host, data.port, data.username, data.authType, data.password, data.database, data.privateKey, data.keyFileName, data.passphrase, JSON.stringify(data.tags), data.color, data.status, data.isFavorite ? 1 : 0, data.isSrv ? 1 : 0, data.notes, data.sshTunnel ? 1 : 0, data.sshTunnelHost, data.sshTunnelPort, data.sshTunnelUser, data.sshTunnelAuth, data.sshTunnelPassword, data.sshTunnelPrivateKey, data.sshTunnelPassphrase]
        );
        imported++;
      }
    } catch (e) {
      console.error('Migration: MySQL write error:', e.message);
    } finally {
      if (pool) try { await pool.end(); } catch (_) {}
    }
  }

  // --- Target: PostgreSQL ---
  else if (targetUri.startsWith('postgres://') || targetUri.startsWith('postgresql://')) {
    let client;
    try {
      client = new Client({ connectionString: targetUri, connectionTimeoutMillis: 5000 });
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS connections (
          id SERIAL PRIMARY KEY,
          type VARCHAR(20) DEFAULT 'ssh',
          dbProvider VARCHAR(20) DEFAULT 'mongodb',
          name VARCHAR(255) NOT NULL,
          host VARCHAR(255) NOT NULL,
          port INT DEFAULT 22,
          username VARCHAR(255) DEFAULT '',
          authType VARCHAR(20) DEFAULT 'password',
          password TEXT,
          database_name VARCHAR(255),
          privateKey TEXT,
          keyFileName VARCHAR(255),
          passphrase TEXT,
          tags JSONB,
          color VARCHAR(20) DEFAULT '#6366f1',
          lastConnected TIMESTAMP,
          status VARCHAR(20) DEFAULT 'unknown',
          isFavorite BOOLEAN DEFAULT FALSE,
          isSrv BOOLEAN DEFAULT FALSE,
          sshTunnel BOOLEAN DEFAULT FALSE,
          sshTunnelHost VARCHAR(255),
          sshTunnelPort INT DEFAULT 22,
          sshTunnelUser VARCHAR(255),
          sshTunnelAuth VARCHAR(20) DEFAULT 'password',
          sshTunnelPassword TEXT,
          sshTunnelPrivateKey TEXT,
          sshTunnelPassphrase TEXT,
          notes TEXT,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      for (const c of connections) {
        if (!c.name || !c.host) { skipped++; continue; }
        const existing = await client.query(
          'SELECT id FROM connections WHERE name = $1 AND host = $2 LIMIT 1',
          [c.name, c.host]
        );
        if (existing.rows.length > 0) { skipped++; continue; }

        const data = pick(c);
        await client.query(
          `INSERT INTO connections (type, dbProvider, name, host, port, username, authType, password, database_name, privateKey, keyFileName, passphrase, tags, color, status, isFavorite, isSrv, notes, sshTunnel, sshTunnelHost, sshTunnelPort, sshTunnelUser, sshTunnelAuth, sshTunnelPassword, sshTunnelPrivateKey, sshTunnelPassphrase)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
          [data.type, data.dbProvider, data.name, data.host, data.port, data.username, data.authType, data.password, data.database, data.privateKey, data.keyFileName, data.passphrase, JSON.stringify(data.tags), data.color, data.status, data.isFavorite, data.isSrv, data.notes, data.sshTunnel, data.sshTunnelHost, data.sshTunnelPort, data.sshTunnelUser, data.sshTunnelAuth, data.sshTunnelPassword, data.sshTunnelPrivateKey, data.sshTunnelPassphrase]
        );
        imported++;
      }
    } catch (e) {
      console.error('Migration: PostgreSQL write error:', e.message);
    } finally {
      if (client) try { await client.end(); } catch (_) {}
    }
  }

  return { imported, skipped };
}

/**
 * High-level migration function.
 * Reads from sourceUri, writes to targetUri. Returns migration stats.
 */
export async function migrateConnections(sourceUri, targetUri) {
  if (!sourceUri || !targetUri || sourceUri === targetUri) {
    return { success: true, migrated: 0, skipped: 0, total: 0 };
  }

  console.log(`🔄 Migration: reading from ${sourceUri.substring(0, 30)}...`);
  const connections = await readConnectionsFromSource(sourceUri);
  console.log(`📦 Migration: found ${connections.length} connections in source`);

  if (connections.length === 0) {
    return { success: true, migrated: 0, skipped: 0, total: 0 };
  }

  console.log(`📥 Migration: writing to ${targetUri.substring(0, 30)}...`);
  const { imported, skipped } = await writeConnectionsToTarget(targetUri, connections);
  console.log(`✅ Migration complete: ${imported} imported, ${skipped} skipped`);

  return {
    success: true,
    migrated: imported,
    skipped,
    total: connections.length,
  };
}
