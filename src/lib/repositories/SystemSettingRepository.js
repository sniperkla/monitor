import mongoose from 'mongoose';
import SystemSetting from '../../models/SystemSetting.js';

/**
 * SystemSettingRepository
 *
 * Provides a unified interface for reading/writing system settings across
 * different database backends (MySQL, PostgreSQL, MongoDB).
 *
 * NOTE: For MongoDB, we use the native driver directly against the
 * 'system_settings' collection (NOT the Mongoose 'SystemSetting' model
 * which writes to 'systemsettings'). This ensures consistency with the
 * original native-driver code.
 */
export class SystemSettingRepository {
  /**
   * @param {object} db - DB connection object
   * @param {string} [userId='global'] - The user ID to scope settings. Use 'global' for shared/system settings.
   */
  constructor(db, userId = 'global') {
    this.db = db;
    this.userId = userId || 'global';
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  /**
   * Get the native MongoDB collection for system_settings.
   */
  _mongoCol() {
    return mongoose.connection.db.collection('system_settings');
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL DEFAULT 'global',
          \`key\` VARCHAR(255) NOT NULL,
          value JSON,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_key (user_id, \`key\`)
        )
      `);
    } else if (this.isPostgres) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          "id" SERIAL PRIMARY KEY,
          "user_id" VARCHAR(255) NOT NULL DEFAULT 'global',
          "key" VARCHAR(255) NOT NULL,
          "value" JSONB,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE("user_id", "key")
        )
      `);

      // Migration: Case-sensitivity fix
      try {
        const check = await this.db.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'system_settings' AND column_name = 'createdat'
        `);
        if (check.rows?.length > 0) {
          console.log('[SystemSettings] Migrating lowercase columns to camelCase...');
          const renames = [
            ['createdat', 'createdAt'],
            ['updatedat', 'updatedAt']
          ];
          for (const [oldC, newC] of renames) {
            try { await this.db.query(`ALTER TABLE system_settings RENAME COLUMN "${oldC}" TO "${newC}"`); } catch(e){}
          }
        }
      } catch(e){}
    }
  }

  async findOne(criteria) {
    if (this.isSql) {
      const scopedCriteria = { user_id: this.userId, ...criteria };
      const keys = Object.keys(scopedCriteria);
      if (keys.length === 0) return null;
      const quote = this.isPostgres ? '"' : '`';
      const where = keys.map((k, i) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      const query = `SELECT * FROM system_settings WHERE ${where} LIMIT 1`;
      const res = await this.db.query(query, Object.values(scopedCriteria));
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      const r = rows[0];
      return { ...r, _id: r.id.toString(), value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value };
    } else {
      // For MongoDB, convert string userId to ObjectId if valid
      let userIdForMongo = this.userId;
      if (typeof this.userId === 'string' && this.userId !== 'global' && mongoose.Types.ObjectId.isValid(this.userId)) {
        userIdForMongo = new mongoose.Types.ObjectId(this.userId);
      }
      
      // Scope by userId in MongoDB
      const doc = await this._mongoCol().findOne({ userId: userIdForMongo, ...criteria });
      return doc || null;
    }
  }

  async update(criteria, data) {
    if (this.isSql) {
      const existing = await this.findOne(criteria);
      if (!existing) return false;

      let newValue = existing.value;
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('value.')) {
          const subKey = key.split('.')[1];
          if (typeof newValue === 'object' && newValue !== null) {
            newValue[subKey] = val;
          }
        } else if (key === 'value') {
          newValue = val;
        }
      }

      const quote = this.isPostgres ? '"' : '`';
      const query = this.isPostgres
        ? `UPDATE system_settings SET ${quote}value${quote} = $1, ${quote}updatedAt${quote} = CURRENT_TIMESTAMP WHERE ${quote}user_id${quote} = $2 AND ${quote}key${quote} = $3`
        : 'UPDATE system_settings SET `value` = ?, `updatedAt` = CURRENT_TIMESTAMP WHERE `user_id` = ? AND `key` = ?';

      await this.db.query(query, [JSON.stringify(newValue), this.userId, existing.key]);
      return true;
    } else {
      const setData = {};
      for (const [key, val] of Object.entries(data)) {
        setData[key] = val;
      }
      await this._mongoCol().updateOne({ userId: this.userId, ...criteria }, { $set: setData });
      return true;
    }
  }

  /**
   * Upsert a setting by key — inserts if not exists, updates if it does.
   * Scoped to this.userId.
   */
  async upsert(key, value) {
    if (this.isSql) {
      const existing = await this.findOne({ key });
      if (existing) {
        const quote = this.isPostgres ? '"' : '`';
        const query = this.isPostgres
          ? `UPDATE system_settings SET ${quote}value${quote} = $1, ${quote}updatedAt${quote} = CURRENT_TIMESTAMP WHERE ${quote}user_id${quote} = $2 AND ${quote}key${quote} = $3`
          : 'UPDATE system_settings SET `value` = ?, `updatedAt` = CURRENT_TIMESTAMP WHERE `user_id` = ? AND `key` = ?';
        await this.db.query(query, [JSON.stringify(value), this.userId, key]);
      } else {
        const quote = this.isPostgres ? '"' : '`';
        const query = this.isPostgres
          ? `INSERT INTO system_settings (${quote}user_id${quote}, ${quote}key${quote}, ${quote}value${quote}) VALUES ($1, $2, $3)`
          : 'INSERT INTO system_settings (`user_id`, `key`, `value`) VALUES (?, ?, ?)';
        await this.db.query(query, [this.userId, key, JSON.stringify(value)]);
      }
    } else {
      // For MongoDB, convert string userId to ObjectId if valid
      let userIdForMongo = this.userId;
      if (typeof this.userId === 'string' && this.userId !== 'global' && mongoose.Types.ObjectId.isValid(this.userId)) {
        userIdForMongo = new mongoose.Types.ObjectId(this.userId);
      }
      
      await this._mongoCol().updateOne(
        { userId: userIdForMongo, key },
        { $set: { userId: userIdForMongo, key, value, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  }
}

