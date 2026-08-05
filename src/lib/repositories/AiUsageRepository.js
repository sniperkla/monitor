import AiUsage from '../../models/AiUsage';

export class AiUsageRepository {
  constructor(db) {
    this.db = db;
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ai_usage (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          dayKey VARCHAR(20) NOT NULL,
          tokensUsed INT DEFAULT 0,
          tokensTotal INT DEFAULT 0,
          lastUpdated DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } else if (this.isPostgres) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ai_usage (
          "id" SERIAL PRIMARY KEY,
          "email" TEXT NOT NULL UNIQUE,
          "dayKey" VARCHAR(20) NOT NULL,
          "tokensUsed" INT DEFAULT 0,
          "tokensTotal" BIGINT DEFAULT 0,
          "lastUpdated" TIMESTAMP,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Migration check
      try {
        const check = await this.db.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'ai_usage' AND column_name = 'daykey'
        `);
        if (check.rows?.length > 0) {
          console.log('[AiUsage] Migrating lowercase columns to camelCase...');
          const renames = [
            ['daykey', 'dayKey'],
            ['tokensused', 'tokensUsed'],
            ['tokenstotal', 'tokensTotal'],
            ['lastupdated', 'lastUpdated'],
            ['createdat', 'createdAt'],
            ['updatedat', 'updatedAt']
          ];
          for (const [oldC, newC] of renames) {
            try { await this.db.query(`ALTER TABLE ai_usage RENAME COLUMN "${oldC}" TO "${newC}"`); } catch(e){}
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
      const query = `SELECT * FROM ai_usage WHERE ${where} LIMIT 1`;
      const res = await this.db.query(query, Object.values(criteria));
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      const r = rows[0];
      return { ...r, _id: r.id.toString(), tokensUsed: parseInt(r.tokensused || r.tokensUsed) || 0, dayKey: r.daykey || r.dayKey };
    } else {
      return await AiUsage.findOne(criteria);
    }
  }

  async create(data) {
    if (this.isSql) {
      const cols = ['email', 'dayKey', 'tokensUsed', 'lastUpdated'];
      const vals = [data.email, data.dayKey, data.tokensUsed || 0, data.lastUpdated || new Date()];
      const quote = this.isPostgres ? '"' : '`';
      const placeholders = this.isPostgres ? cols.map((_, i) => '$' + (i+1)).join(', ') : cols.map(() => '?').join(', ');
      const query = `INSERT INTO ai_usage (${cols.map(c => `${quote}${c}${quote}`).join(', ')}) VALUES (${placeholders}) ${this.isPostgres? 'RETURNING id' : ''}`;
      const res = await this.db.query(query, vals);
      const id = this.isPostgres ? res.rows[0].id : res[0].insertId;
      return { ...data, _id: id.toString() };
    } else {
      return await AiUsage.create(data);
    }
  }

  async updateOne(criteria, update) {
    if (this.isSql) {
      const existing = await this.findOne(criteria);
      if (!existing) return false;

      const set = update.$set || {};
      const inc = update.$inc || {};

      const fields = [];
      const vals = [];
      let i = 0;
      
      const tokensConsumed = inc.tokensUsed || 0;
      const newTokensUsed = (existing.tokensUsed || 0) + tokensConsumed;
      
      const quote = this.isPostgres ? '"' : '`';
      fields.push(`${quote}tokensUsed${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`); vals.push(newTokensUsed);
      if (set.dayKey) { fields.push(`${quote}dayKey${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`); vals.push(set.dayKey); }
      if (set.lastUpdated) { fields.push(`${quote}lastUpdated${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`); vals.push(set.lastUpdated); }
      fields.push(`${quote}updatedAt${quote} = ${this.isPostgres ? 'CURRENT_TIMESTAMP' : 'NOW()'}`);

      const criteriaKeys = Object.keys(criteria);
      const where = criteriaKeys.map(k => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`).join(' AND ');
      vals.push(...Object.values(criteria));

      const query = `UPDATE ai_usage SET ${fields.join(', ')} WHERE ${where}`;
      await this.db.query(query, vals);
      return true;
    } else {
      return await AiUsage.updateOne(criteria, update);
    }
  }
}
