import { getConnectionModel } from '../../models/Connection.js';

export class ConnectionRepository {
  constructor(db, userId = null) {
    this.db = db;
    // 🔐 Multi-tenant scoping: when a userId is provided, EVERY query is scoped
    // to that owner and writes are tagged. Callers without a userId keep legacy
    // unscoped behavior (internal/server-side use only — never expose via API).
    this.userId = userId || null;
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  // Row may carry the owner under either casing depending on engine/driver.
  _rowOwnerId(r) {
    const v = r?.userid ?? r?.userId ?? null;
    return v == null ? null : String(v);
  }

  // Ownership gate for scoped repositories. Legacy rows with NO owner are only
  // visible unscoped (pre-migration); once scoped, an orphan or foreign row is
  // treated as not-found so IDs from other tenants are unfetchable.
  _owns(r) {
    if (!this.userId) return true;
    const ownerId = this._rowOwnerId(r);
    return ownerId === String(this.userId);
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS connections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          type ENUM('ssh', 'database') DEFAULT 'ssh',
          dbProvider ENUM('mongodb', 'mysql', 'postgres', 'sqlite') DEFAULT 'mongodb',
          name VARCHAR(255) NOT NULL,
          host VARCHAR(255) NOT NULL,
          port INT DEFAULT 22,
          username VARCHAR(255) DEFAULT '',
          authType ENUM('password', 'privateKey', 'none') DEFAULT 'password',
          password TEXT,
          database_name VARCHAR(255),
          privateKey TEXT,
          keyFileName VARCHAR(255),
          passphrase TEXT,
          tags JSON,
          color VARCHAR(20) DEFAULT '#6366f1',
          lastConnected DATETIME,
          status ENUM('online', 'offline', 'testing', 'unknown') DEFAULT 'unknown',
          isFavorite BOOLEAN DEFAULT FALSE,
          isSrv BOOLEAN DEFAULT FALSE,
          notes TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      // Migration: Add isSrv if missing
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN isSrv BOOLEAN DEFAULT FALSE');
      } catch (e) {}
      // 🔐 Multi-tenant: owner column + index
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN userId VARCHAR(64)');
        await this.db.query('CREATE INDEX idx_connections_userId ON connections (userId)');
      } catch (e) {}
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN authSource VARCHAR(255)');
      } catch (e) {}
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN relayName VARCHAR(255)');
      } catch (e) {}
      
      // Migration: Add SSH tunnel columns if missing
      const tunnelCols = [
        'sshTunnel BOOLEAN DEFAULT FALSE',
        'sshTunnelHost VARCHAR(255)',
        'sshTunnelPort INT DEFAULT 22',
        'sshTunnelUser VARCHAR(255)',
        "sshTunnelAuth ENUM('password','privateKey') DEFAULT 'password'",
        'sshTunnelPassword TEXT',
        'sshTunnelPrivateKey TEXT',
        'sshTunnelPassphrase TEXT',
      ];
      for (const colDef of tunnelCols) {
        try {
          await this.db.query(`ALTER TABLE connections ADD COLUMN ${colDef}`);
        } catch (e) {}
      }
    } else if (this.isPostgres) {
      await this.db.query(`
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
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN authSource VARCHAR(255)');
      } catch (e) {}
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN relayName VARCHAR(255)');
      } catch (e) {}
      // 🔐 Multi-tenant: owner column + index
      try {
        await this.db.query('ALTER TABLE connections ADD COLUMN userId VARCHAR(64)');
        await this.db.query('CREATE INDEX idx_connections_userId ON connections (userId)');
      } catch (e) {}
    }
  }

  _mapSqlRow(r) {
    return {
      ...r,
      _id: r.id.toString(),
      type: r.type || 'ssh',
      dbProvider: r.dbprovider || r.dbProvider || 'mongodb',
      authType: r.authtype || r.authType || 'password',
      privateKey: r.privatekey || r.privateKey || null,
      keyFileName: r.keyfilename || r.keyFileName || null,
      passphrase: r.passphrase || null,
      tags: (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) || [],
      isFavorite: !!(r.isfavorite !== undefined ? r.isfavorite : r.isFavorite),
      isSrv: !!(r.issrv !== undefined ? r.issrv : r.isSrv),
      authSource: r.authsource || r.authSource || null,
      sshTunnel: !!(r.sshtunnel !== undefined ? r.sshtunnel : r.sshTunnel),
      sshTunnelHost: r.sshtunnelhost || r.sshTunnelHost || null,
      sshTunnelPort: r.sshtunnelport || r.sshTunnelPort || 22,
      sshTunnelUser: r.sshtunneluser || r.sshTunnelUser || null,
      sshTunnelAuth: r.sshtunnelauth || r.sshTunnelAuth || 'password',
      sshTunnelPassword: r.sshtunnelpassword || r.sshTunnelPassword || null,
      sshTunnelPrivateKey: r.sshtunnelprivatekey || r.sshTunnelPrivateKey || null,
      sshTunnelPassphrase: r.sshtunnelpassphrase || r.sshTunnelPassphrase || null,
      relayName: r.relayname || r.relayName || null,
      lastConnected: r.lastconnected || r.lastConnected || null,
      createdAt: r.createdat || r.createdAt,
      updatedAt: r.updatedat || r.updatedAt,
      database: r.database_name || null
    };
  }

  async findAll() {
    if (this.isSql) {
      const where = this.userId ? ' WHERE userId = ?' : '';
      const params = this.userId ? [this.userId] : [];
      const res = await this.db.query(`SELECT * FROM connections${where} ORDER BY updatedAt DESC`, params);
      const rows = this.isPostgres ? res.rows : res[0];
      return rows.filter(r => this._owns(r)).map(r => this._mapSqlRow(r));
    } else {
      const model = getConnectionModel(this.db);
      const query = this.userId
        ? model.find({ userId: this.userId }).sort({ updatedAt: -1 })
        : model.find({}).sort({ updatedAt: -1 });
      return await query;
    }
  }

  async findById(id) {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) return null;

    if (this.isSql) {
      // PostgreSQL uses integer serial IDs — skip lookup if id is not a valid numeric ID.
      if (this.isPostgres && !/^\d+$/.test(normalizedId)) return null;
      const query = this.isPostgres ? 'SELECT * FROM connections WHERE id = $1' : 'SELECT * FROM connections WHERE id = ?';
      const res = await this.db.query(query, [normalizedId]);
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      if (!this._owns(rows[0])) return null; // foreign row → not-found
      return this._mapSqlRow(rows[0]);
    } else {
      const model = getConnectionModel(this.db);
      try {
        // NOTE: findById() ignores extra filter fields, so ownership scoping
        // requires an explicit findOne() compound filter.
        const filter = this.userId ? { _id: normalizedId, userId: this.userId } : { _id: normalizedId };
        return await model.findOne(filter);
      } catch (err) {
        if (err.name === 'CastError') return null;
        throw err;
      }
    }
  }

  async findOne(criteria) {
    if (this.isSql) {
      const keys = Object.keys(criteria);
      if (keys.length === 0) return null;
      const where = keys.map((k, i) => `${k === 'database' ? 'database_name' : k} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      let query = `SELECT * FROM connections WHERE ${where}`;
      const params = [...Object.values(criteria)];
      // 🔐 Scoped repositories search only their own rows
      if (this.userId) {
        query += this.isPostgres ? ` AND userId = $${params.length + 1}` : ' AND userId = ?';
        params.push(this.userId);
      }
      query += ' LIMIT 1';
      const res = await this.db.query(query, params);
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      if (!this._owns(rows[0])) return null; // foreign row → not-found
      return this._mapSqlRow(rows[0]);
    } else {
      const scoped = this.userId ? { ...criteria, userId: this.userId } : criteria;
      const model = getConnectionModel(this.db);
      return await model.findOne(scoped);
    }
  }

  async create(data) {
    if (this.isSql) {
      const columns = [
        'type', 'dbProvider', 'name', 'host', 'port', 'username', 'authType', 
        'password', 'database_name', 'privateKey', 'keyFileName', 'passphrase', 
        'tags', 'color', 'status', 'isFavorite', 'isSrv', 'notes',
        'sshTunnel', 'sshTunnelHost', 'sshTunnelPort', 'sshTunnelUser', 'sshTunnelAuth',
        'sshTunnelPassword', 'sshTunnelPrivateKey', 'sshTunnelPassphrase', 'relayName'
      ];
      const values = [
        data.type || 'ssh',
        data.dbProvider || data.dbprovider || 'mongodb',
        data.name,
        data.host,
        data.port || 22,
        data.username || '',
        data.authType || data.authtype || 'password',
        data.password || null,
        data.database || data.database_name || null,
        data.privateKey || null,
        data.keyFileName || null,
        data.passphrase || null,
        JSON.stringify(data.tags || []),
        data.color || '#6366f1',
        data.status || 'unknown',
        this.isPostgres ? !!data.isFavorite : (data.isFavorite ? 1 : 0),
        this.isPostgres ? !!data.isSrv : (data.isSrv ? 1 : 0),
        data.notes || '',
        this.isPostgres ? !!data.sshTunnel : (data.sshTunnel ? 1 : 0),
        data.sshTunnelHost || null,
        data.sshTunnelPort || 22,
        data.sshTunnelUser || null,
        data.sshTunnelAuth || 'password',
        data.sshTunnelPassword || null,
        data.sshTunnelPrivateKey || null,
        data.sshTunnelPassphrase || null,
        data.relayName || null
      ];

      // 🔐 Tag the row with the owning user when the repository is scoped
      if (this.userId) {
        columns.unshift('userId');
        values.unshift(this.userId);
      }

      const placeholders = this.isPostgres 
        ? columns.map((_, i) => '$' + (i + 1)).join(', ')
        : columns.map(() => '?').join(', ');
      
      const query = `INSERT INTO connections (${columns.join(', ')}) VALUES (${placeholders}) ${this.isPostgres ? 'RETURNING id' : ''}`;
      const res = await this.db.query(query, values);
      const insertedId = this.isPostgres ? res.rows[0].id : res[0].insertId;
      
      return { _id: insertedId.toString(), name: data.name };
    } else {
      const model = getConnectionModel(this.db);
      const docData = this.userId ? { ...data, userId: this.userId } : data;
      return await model.create(docData);
    }
  }

  async update(id, data) {
    if (this.isSql) {
      // PostgreSQL uses integer serial IDs — skip update if id is a MongoDB ObjectId
      if (this.isPostgres && !/^\d+$/.test(String(id))) return true;
      const fields = [];
      const values = [];
      
      const mapping = {
        database: 'database_name'
      };

      let i = 0;
      for (const [key, value] of Object.entries(data)) {
        if (key === '_id' || key === 'id' || key === 'storage' || key === 'connection') continue;
        const dbKey = mapping[key] || key;
        fields.push(`${dbKey} = ${this.isPostgres ? '$' + (++i) : '?'}`);
        
        if (key === 'tags') {
          values.push(JSON.stringify(value));
        } else if (['isFavorite', 'isSrv', 'isPinned', 'system', 'sshTunnel'].includes(key)) {
          values.push(this.isPostgres ? !!value : (value ? 1 : 0));
        } else {
          values.push(value);
        }
      }

      if (fields.length === 0) return true;

      values.push(id);
      let query = `UPDATE connections SET ${fields.join(', ')} WHERE id = ${this.isPostgres ? '$' + (++i) : '?'}`;
      // 🔐 Scoped repositories may only touch their own rows
      if (this.userId) query += this.isPostgres ? ` AND userId = $${++i}` : ' AND userId = ?';
      if (this.userId) values.push(this.userId);
      await this.db.query(query, values);
      return true;
    } else {
      const model = getConnectionModel(this.db);
      // NOTE: findByIdAndUpdate() ignores non-_id filter fields, so ownership
      // scoping requires an explicit compound-filter findOneAndUpdate().
      const filter = this.userId ? { _id: id, userId: this.userId } : { _id: id };
      return await model.findOneAndUpdate(filter, data, { new: true });
    }
  }

  async delete(id) {
    if (this.isSql) {
      let query = this.isPostgres ? 'DELETE FROM connections WHERE id = $1' : 'DELETE FROM connections WHERE id = ?';
      const params = [id];
      // 🔐 Scoped repositories may only delete their own rows
      if (this.userId) {
        query += this.isPostgres ? ' AND userId = $2' : ' AND userId = ?';
        params.push(this.userId);
      }
      await this.db.query(query, params);
      return true;
    } else {
      const model = getConnectionModel(this.db);
      if (this.userId) {
        return await model.findOneAndDelete({ _id: id, userId: this.userId });
      }
      return await model.findByIdAndDelete(id);
    }
  }
}
