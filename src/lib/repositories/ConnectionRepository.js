import { getConnectionModel } from '@/models/Connection';

export class ConnectionRepository {
  constructor(db) {
    this.db = db;
    this.isMysql = db.type === 'mysql';
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
      } catch (e) {
        // Column probably already exists, ignore
      }
    }
  }

  async findAll() {
    if (this.isMysql) {
      const [rows] = await this.db.query('SELECT * FROM connections ORDER BY updatedAt DESC');
      return rows.map(r => ({
        ...r,
        _id: r.id.toString(),
        tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []),
        isFavorite: !!r.isFavorite,
        isSrv: !!r.isSrv,
        database: r.database_name
      }));
    } else {
      const model = getConnectionModel(this.db);
      return await model.find({}).sort({ updatedAt: -1 });
    }
  }

  async findById(id) {
    if (this.isMysql) {
      const [rows] = await this.db.query('SELECT * FROM connections WHERE id = ?', [id]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        ...r,
        _id: r.id.toString(),
        tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []),
        isFavorite: !!r.isFavorite,
        isSrv: !!r.isSrv,
        database: r.database_name
      };
    } else {
      const model = getConnectionModel(this.db);
      return await model.findById(id);
    }
  }

  async create(data) {
    if (this.isMysql) {
      const [result] = await this.db.query(
        `INSERT INTO connections (
          type, dbProvider, name, host, port, username, authType, 
          password, database_name, privateKey, keyFileName, passphrase, 
          tags, color, status, isFavorite, isSrv, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.type || 'ssh',
          data.dbProvider || 'mongodb',
          data.name,
          data.host,
          data.port || 22,
          data.username || '',
          data.authType || 'password',
          data.password || null,
          data.database || null,
          data.privateKey || null,
          data.keyFileName || null,
          data.passphrase || null,
          JSON.stringify(data.tags || []),
          data.color || '#6366f1',
          data.status || 'unknown',
          data.isFavorite ? 1 : 0,
          data.isSrv ? 1 : 0,
          data.notes || ''
        ]
      );
      return { _id: result.insertId.toString(), name: data.name };
    } else {
      const model = getConnectionModel(this.db);
      return await model.create(data);
    }
  }

  async update(id, data) {
    if (this.isMysql) {
      const fields = [];
      const values = [];
      
      const mapping = {
        database: 'database_name',
        isFavorite: 'isFavorite'
      };

      for (const [key, value] of Object.entries(data)) {
        if (key === '_id' || key === 'id' || key === 'storage' || key === 'connection') continue;
        const dbKey = mapping[key] || key;
        fields.push(`${dbKey} = ?`);
        if (key === 'tags') {
          values.push(JSON.stringify(value));
        } else if (key === 'isFavorite' || key === 'isSrv' || key === 'isPinned' || key === 'system') {
          values.push(value ? 1 : 0);
        } else {
          values.push(value);
        }
      }

      if (fields.length === 0) return true;

      values.push(id);
      await this.db.query(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`, values);
      return true;
    } else {
      const model = getConnectionModel(this.db);
      return await model.findByIdAndUpdate(id, data, { new: true });
    }
  }

  async delete(id) {
    if (this.isMysql) {
      await this.db.query('DELETE FROM connections WHERE id = ?', [id]);
      return true;
    } else {
      const model = getConnectionModel(this.db);
      return await model.findByIdAndDelete(id);
    }
  }
}
