import SystemSetting from '@/models/SystemSetting';

export class SystemSettingRepository {
  constructor(db) {
    this.db = db;
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          \`key\` VARCHAR(255) NOT NULL UNIQUE,
          value JSON,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } else if (this.isPostgres) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          "id" SERIAL PRIMARY KEY,
          "key" VARCHAR(255) NOT NULL UNIQUE,
          "value" JSONB,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      const keys = Object.keys(criteria);
      if (keys.length === 0) return null;
      const quote = this.isPostgres ? '"' : '`';
      const where = keys.map((k, i) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      const query = `SELECT * FROM system_settings WHERE ${where} LIMIT 1`;
      const res = await this.db.query(query, Object.values(criteria));
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      const r = rows[0];
      return { ...r, _id: r.id.toString(), value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value };
    } else {
      return await SystemSetting.findOne(criteria);
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
        ? `UPDATE system_settings SET ${quote}value${quote} = $1, ${quote}updatedAt${quote} = CURRENT_TIMESTAMP WHERE ${quote}key${quote} = $2`
        : 'UPDATE system_settings SET `value` = ?, `updatedAt` = CURRENT_TIMESTAMP WHERE `key` = ?';
      
      await this.db.query(query, [JSON.stringify(newValue), existing.key]);
      return true;
    } else {
      return await SystemSetting.updateOne(criteria, { $set: data });
    }
  }
}
