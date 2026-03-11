import { getSshMemoryModel } from '@/models/SshMemory';

export class SshMemoryRepository {
  constructor(db) {
    this.db = db;
    this.isMysql = db.type === 'mysql';
    this.isPostgres = db.type === 'postgres';
    this.isSql = this.isMysql || this.isPostgres;
  }

  async init() {
    if (this.isMysql) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ssh_memory (
          id INT AUTO_INCREMENT PRIMARY KEY,
          userId VARCHAR(255) NOT NULL,
          host VARCHAR(255) NOT NULL,
          label VARCHAR(255) DEFAULT '',
          os VARCHAR(100) DEFAULT '',
          loginUser VARCHAR(80) DEFAULT '',
          workingDir VARCHAR(200) DEFAULT '',
          packageManager VARCHAR(40) DEFAULT '',
          keyPaths JSON,
          installedTools JSON,
          runningServices JSON,
          completedGoals JSON,
          notes JSON,
          reminders JSON,
          lastSeenAt DATETIME,
          sessionCount INT DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY user_host (userId, host)
        )
      `);
    } else if (this.isPostgres) {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ssh_memory (
          "id" SERIAL PRIMARY KEY,
          "userId" VARCHAR(255) NOT NULL,
          "host" VARCHAR(255) NOT NULL,
          "label" VARCHAR(255) DEFAULT '',
          "os" VARCHAR(100) DEFAULT '',
          "loginUser" VARCHAR(80) DEFAULT '',
          "workingDir" VARCHAR(200) DEFAULT '',
          "packageManager" VARCHAR(40) DEFAULT '',
          "keyPaths" JSONB,
          "installedTools" JSONB,
          "runningServices" JSONB,
          "completedGoals" JSONB,
          "notes" JSONB,
          "reminders" JSONB,
          "lastSeenAt" TIMESTAMP,
          "sessionCount" INT DEFAULT 0,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE ("userId", "host")
        )
      `);

      // Migration: Handle case where table was created without quotes (lowercase columns)
      try {
         const cols = await this.db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ssh_memory' 
            AND column_name = 'userid'
         `);
         if (cols.rows?.length > 0) {
            console.log('[SshMemory] Migrating lowercase columns to camelCase...');
            const renames = [
              ['userid', 'userId'],
              ['loginuser', 'loginUser'],
              ['workingdir', 'workingDir'],
              ['packagemanager', 'packageManager'],
              ['keypaths', 'keyPaths'],
              ['installedtools', 'installedTools'],
              ['runningservices', 'runningServices'],
              ['completedgoals', 'completedGoals'],
              ['lastseenat', 'lastSeenAt'],
              ['sessioncount', 'sessionCount'],
              ['createdat', 'createdAt'],
              ['updatedat', 'updatedAt']
            ];
            for (const [oldC, newC] of renames) {
               try { await this.db.query(`ALTER TABLE ssh_memory RENAME COLUMN "${oldC}" TO "${newC}"`); } catch(e){}
            }
         }
      } catch(e) {
         console.warn('[SshMemory] Migration check failed:', e.message);
      }
    }
  }

  _mapSqlRow(r) {
    if (!r) return null;
    return {
      ...r,
      _id: r.id.toString(),
      keyPaths: (typeof r.keypaths === 'string' ? JSON.parse(r.keypaths) : r.keyPaths || r.keypaths) || [],
      installedTools: (typeof r.installedtools === 'string' ? JSON.parse(r.installedtools) : r.installedTools || r.installedtools) || [],
      runningServices: (typeof r.runningservices === 'string' ? JSON.parse(r.runningservices) : r.runningServices || r.runningservices) || [],
      completedGoals: (typeof r.completedgoals === 'string' ? JSON.parse(r.completedgoals) : r.completedGoals || r.completedgoals) || [],
      notes: (typeof r.notes === 'string' ? JSON.parse(r.notes) : r.notes) || [],
      reminders: (typeof r.reminders === 'string' ? JSON.parse(r.reminders) : r.reminders) || [],
      lastSeenAt: r.lastseenat || r.lastSeenAt,
      sessionCount: r.sessioncount || r.sessionCount || 0,
      createdAt: r.createdat || r.createdAt,
      updatedAt: r.updatedat || r.updatedAt
    };
  }

  async findOne(criteria) {
    if (this.isSql) {
      const keys = Object.keys(criteria);
      if (keys.length === 0) return null;
      const quote = this.isPostgres ? '"' : '`';
      const where = keys.map((k, i) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      const query = `SELECT * FROM ssh_memory WHERE ${where} LIMIT 1`;
      const res = await this.db.query(query, Object.values(criteria));
      const rows = this.isPostgres ? res.rows : res[0];
      if (rows.length === 0) return null;
      return this._mapSqlRow(rows[0]);
    } else {
      const model = getSshMemoryModel(this.db);
      return await model.findOne(criteria).lean();
    }
  }

  async findOneAndUpdate(criteria, update, options = {}) {
    if (this.isSql) {
      // Very basic implementation of findOneAndUpdate logic for SQL
      const existing = await this.findOne(criteria);
      if (existing) {
        // Build update fields from Mongoose-style update object
        const fields = [];
        const values = [];
        let i = 0;

        // Note: This is an approximation of Mongoose $set/$addToSet/$push/$inc
        const setData = update.$set || {};
        const incData = update.$inc || {};
        const addToSetData = update.$addToSet || {};
        const pushData = update.$push || {};

        // 1. Combine $set
        const finalSet = { ...setData };

        // 2. Handle $inc
        for (const [k, v] of Object.entries(incData)) {
          // SQL: sessionCount = sessionCount + 1
          // Easier to just fetch existing and add in JS for this simple app
        }

        // 3. Handle Arrays ($addToSet, $push)
        // Since we store JSONB, we have to read, modify, and write back
        const keyPaths = [...(existing.keyPaths || [])];
        if (addToSetData.keyPaths?.$each) {
          addToSetData.keyPaths.$each.forEach(p => { if (!keyPaths.includes(p)) keyPaths.push(p); });
        }
        const installedTools = [...(existing.installedTools || [])];
        if (addToSetData.installedTools?.$each) {
          addToSetData.installedTools.$each.forEach(t => { if (!installedTools.includes(t)) installedTools.push(t); });
        }
        const runningServices = [...(existing.runningServices || [])];
        if (addToSetData.runningServices?.$each) {
          addToSetData.runningServices.$each.forEach(s => { if (!runningServices.includes(s)) runningServices.push(s); });
        }
        const reminders = [...(existing.reminders || [])];
        if (addToSetData.reminders?.$each) {
          addToSetData.reminders.$each.forEach(r => { 
             // Dedupe reminders by title+command
             const exists = reminders.some(er => er.title === r.title && er.command === r.command);
             if (!exists) reminders.push(r);
          });
        }

        const completedGoals = [...(existing.completedGoals || [])];
        if (pushData.completedGoals?.$each) {
          completedGoals.push(...pushData.completedGoals.$each);
          if (pushData.completedGoals.$slice) {
            const slice = pushData.completedGoals.$slice;
            if (slice < 0) completedGoals.splice(0, completedGoals.length + slice);
          }
        }
        const notes = [...(existing.notes || [])];
        if (pushData.notes?.$each) {
          notes.push(...pushData.notes.$each);
          if (pushData.notes.$slice) {
            const slice = pushData.notes.$slice;
            if (slice < 0) notes.splice(0, notes.length + slice);
          }
        }

        // Final payload for SQL update
        const payload = {
          ...finalSet,
          sessionCount: (existing.sessionCount || 0) + (incData.sessionCount || 0),
          keyPaths: JSON.stringify(keyPaths.slice(0, 50)),
          installedTools: JSON.stringify(installedTools.slice(0, 100)),
          runningServices: JSON.stringify(runningServices.slice(0, 50)),
          completedGoals: JSON.stringify(completedGoals),
          notes: JSON.stringify(notes),
          reminders: JSON.stringify(reminders),
          updatedAt: new Date()
        };

        const quote = this.isPostgres ? '"' : '`';
        const updateFields = [];
        const updateValues = [];
        let j = 0;
        for (const [k, v] of Object.entries(payload)) {
          updateFields.push(`${quote}${k}${quote} = ${this.isPostgres ? '$' + (++j) : '?'}`);
          updateValues.push(v);
        }

        // Criteria for WHERE
        const criteriaKeys = Object.keys(criteria);
        const where = criteriaKeys.map((k, idx) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (++j) : '?'}`).join(' AND ');
        updateValues.push(...Object.values(criteria));

        const query = `UPDATE ssh_memory SET ${updateFields.join(', ')} WHERE ${where}`;
        await this.db.query(query, updateValues);
        return await this.findOne(criteria);
      } else if (options.upsert) {
        // INSERT
        const setData = update.$set || {};
        const columns = ['userId', 'host', 'os', 'loginUser', 'workingDir', 'packageManager', 'keyPaths', 'installedTools', 'runningServices', 'completedGoals', 'notes', 'reminders', 'sessionCount', 'lastSeenAt'];
        const values = [
          criteria.userId,
          criteria.host,
          setData.os || '',
          setData.loginUser || '',
          setData.workingDir || '',
          setData.packageManager || '',
          JSON.stringify(update.$addToSet?.keyPaths?.$each || []),
          JSON.stringify(update.$addToSet?.installedTools?.$each || []),
          JSON.stringify(update.$addToSet?.runningServices?.$each || []),
          JSON.stringify(update.$push?.completedGoals?.$each || []),
          JSON.stringify(update.$push?.notes?.$each || []),
          JSON.stringify(update.$addToSet?.reminders?.$each || []),
          update.$inc?.sessionCount || 1,
          setData.lastSeenAt || new Date()
        ];
        
        const placeholders = this.isPostgres 
          ? columns.map((_, idx) => '$' + (idx + 1)).join(', ') 
          : columns.map(() => '?').join(', ');
        
        const quote = this.isPostgres ? '"' : '`';
        const query = `INSERT INTO ssh_memory (${columns.map(c => `${quote}${c}${quote}`).join(', ')}) VALUES (${placeholders})`;
        await this.db.query(query, values);
        return await this.findOne(criteria);
      }
      return null;
    } else {
      const model = getSshMemoryModel(this.db);
      return await model.findOneAndUpdate(criteria, update, options).lean();
    }
  }

  async deleteOne(criteria) {
    if (this.isSql) {
      const keys = Object.keys(criteria);
      if (keys.length === 0) return false;
      const quote = this.isPostgres ? '"' : '`';
      const where = keys.map((k, i) => `${quote}${k === '_id' ? 'id' : k}${quote} = ${this.isPostgres ? '$' + (i + 1) : '?'}`).join(' AND ');
      const query = `DELETE FROM ssh_memory WHERE ${where}`;
      const res = await this.db.query(query, Object.values(criteria));
      return true;
    } else {
      const model = getSshMemoryModel(this.db);
      return await model.deleteOne(criteria);
    }
  }
}
