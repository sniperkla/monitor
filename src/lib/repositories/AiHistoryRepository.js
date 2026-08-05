import AiHistory from '../../models/AiHistory';

export class AiHistoryRepository {
  constructor(db) {
    this.db = db;
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ai_histories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          userId VARCHAR(255) NOT NULL,
          type VARCHAR(50) DEFAULT 'terminal',
          title VARCHAR(255),
          context JSON,
          messages JSON,
          lastActive DATETIME DEFAULT CURRENT_TIMESTAMP,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } else if (this.isPostgres) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ai_histories (
          "id" SERIAL PRIMARY KEY,
          "userId" VARCHAR(255) NOT NULL,
          "type" VARCHAR(50) DEFAULT 'terminal',
          "title" VARCHAR(255),
          "context" JSONB,
          "messages" JSONB,
          "lastActive" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Migration: Handle case where table was created without quotes (lowercase columns)
      try {
         const check = await this.db.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'ai_histories' AND column_name = 'userid'
         `);
         if (check.rows?.length > 0) {
            console.log('[AiHistory] Migrating lowercase columns to camelCase...');
            const renames = [
              ['userid', 'userId'],
              ['lastactive', 'lastActive'],
              ['createdat', 'createdAt'],
              ['updatedat', 'updatedAt']
            ];
            for (const [oldC, newC] of renames) {
               try { await this.db.query(`ALTER TABLE ai_histories RENAME COLUMN "${oldC}" TO "${newC}"`); } catch(e){}
            }
         }
      } catch(e){}
    }
  }

  async findOne(criteria) {
    if (this.isSql) {
      const quote = this.isPostgres ? '"' : '`';
      const keys = Object.keys(criteria).filter(k => k !== 'updatedAt');
      const where = keys.map((k, i) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      let query = `SELECT * FROM ai_histories WHERE ${where}`;
      
      const values = keys.map(k => criteria[k]);
      
      if (criteria.updatedAt?.$gt) {
          query += ` AND ${quote}updatedAt${quote} > ${this.isPostgres ? '$' + (keys.length + 1) : '?'}`;
          values.push(criteria.updatedAt.$gt);
      }
      
      query += ` LIMIT 1`;
      
      const res = await this.db.query(query, values);
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      const r = rows[0];
      return { 
          ...r, 
          _id: r.id, 
          messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages,
          context: typeof r.context === 'string' ? JSON.parse(r.context) : r.context
      };
    } else {
      return await AiHistory.findOne(criteria);
    }
  }

  async create(data) {
    if (this.isSql) {
      const cols = ['userId', 'type', 'title', 'context', 'messages', 'lastActive'];
      const vals = [
          data.userId, 
          data.type || 'terminal', 
          data.title, 
          JSON.stringify(data.context || {}), 
          JSON.stringify(data.messages || []), 
          new Date()
      ];
      const quote = this.isPostgres ? '"' : '`';
      const placeholders = this.isPostgres ? cols.map((_, i) => '$' + (i + 1)).join(', ') : cols.map(() => '?').join(', ');
      const query = `INSERT INTO ai_histories (${cols.map(c => `${quote}${c}${quote}`).join(', ')}) VALUES (${placeholders}) ${this.isPostgres ? 'RETURNING id' : ''}`;
      const res = await this.db.query(query, vals);
      const id = this.isPostgres ? res.rows[0].id : res[0].insertId;
      return { ...data, _id: id };
    } else {
      return await AiHistory.create(data);
    }
  }

  async updateOne(criteria, update) {
    if (this.isSql) {
      const existing = await this.findOne(criteria);
      if (!existing) return false;

      const push = update.$push || {};
      const set = update.$set || {};

      let messages = [...(existing.messages || [])];
      if (push.messages?.$each) {
          messages.push(...push.messages.$each);
      } else if (push.messages) {
          messages.push(push.messages);
      }

      const payload = {
          messages: JSON.stringify(messages),
          lastActive: set.lastActive || new Date(),
          updatedAt: new Date()
      };

      const quote = this.isPostgres ? '"' : '`';
      const fields = [];
      const vals = [];
      let i = 0;
      for (const [k, v] of Object.entries(payload)) {
          fields.push(`${quote}${k}${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`);
          vals.push(v);
      }

      const criteriaKeys = Object.keys(criteria);
      const where = criteriaKeys.map(k => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (++i) : '?'}`).join(' AND ');
      vals.push(...Object.values(criteria));

      const query = `UPDATE ai_histories SET ${fields.join(', ')} WHERE ${where}`;
      await this.db.query(query, vals);
      return true;
    } else {
      return await AiHistory.updateOne(criteria, update);
    }
  }
}
