import os from 'os';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, checkMemory, LIMITS } from '../src/lib/serverGuard.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Load Mock Spec from JSON
const specPath = path.join(process.cwd(), 'scripts', 'system-spec.json');
const SPEC = JSON.parse(fs.readFileSync(specPath, 'utf8'));

async function runMonitor() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🛡️  SYSTEM PROTECTION MONITOR - [${SPEC.environment.toUpperCase()}]`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Memory Health Check
  const mem = checkMemory(SPEC.guards.memory.minFreeMB);
  const memStatus = mem.safe ? '\x1b[32m✅ Healthy\x1b[0m' : '\x1b[31m⚠️ Critical\x1b[0m';
  
  console.log(`\n[1] MEMORY STATUS: ${memStatus}`);
  console.log(`    - System Total: ${mem.sysTotalMB} MB`);
  console.log(`    - System Free:  ${mem.sysFreeMB} MB (Spec: >${SPEC.guards.memory.minFreeMB}MB)`);
  console.log(`    - Server RSS:   ${mem.rssMB} MB (Spec: <${SPEC.guards.memory.maxRssMB}MB)`);
  console.log(`    - Usage Percentage: ${mem.usagePercent}%`);

  // 2. Guard Logic Logic Check (Rate Limit)
  console.log(`\n[2] GUARD LOGIC VERIFICATION:`);
  const id = `monitor-${Date.now()}`;
  
  let allowedCount = 0;
  for (let i = 0; i < 5; i++) {
    const check = checkRateLimit(id, 10);
    if (check.allowed) allowedCount++;
  }
  
  const guardOk = allowedCount === 5;
  console.log(`    - Rate Limit Accumulator: ${guardOk ? '\x1b[32m✅ OK\x1b[0m' : '\x1b[31m❌ FAILED\x1b[0m'}`);
  
  const finalCheck = checkRateLimit(id, 5);
  console.log(`    - Rate Limit Trigger:     ${!finalCheck.allowed ? '\x1b[32m✅ Blocking correctly\x1b[0m' : '\x1b[31m❌ Failed to block\x1b[0m'}`);

  // 3. Database Status Check
  console.log(`\n[3] DB ENVIRONMENT:`);
  const mongoUri = process.env.MONGODB_URI;
  const hasUri = !!mongoUri;
  
  console.log(`    - MONGODB_URI: ${hasUri ? '\x1b[32m✅ Detected\x1b[0m' : '\x1b[33m⚠️ Missing (using default)\x1b[0m'}`);
  
  if (hasUri) {
    try {
      console.log('    - Testing Connection...');
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: SPEC.database.timeoutMs });
      console.log('    - Connection Status:  \x1b[32m✅ Connected\x1b[0m');
      
      const admin = mongoose.connection.db.admin();
      const status = await admin.serverStatus();
      console.log(`    - DB Version:         v${status.version}`);
      console.log(`    - Active Connections: ${status.connections.current}`);
      
      await mongoose.disconnect();
    } catch(e) {
      console.log(`    - Connection Status:  \x1b[31m❌ Connection Failed\x1b[0m`);
      console.log(`    - Error Detail:       ${e.message}`);
    }
  }

  // 4. Protection Constants
  console.log(`\n[4] SYSTEM LIMITS CONFIG:`);
  console.log(`    - Max Export:  ${LIMITS.MAX_EXPORT_RECORDS} records`);
  console.log(`    - Max Query:   ${LIMITS.MAX_QUERY_RESULT_ROWS} rows`);
  console.log(`    - Timeout:     ${LIMITS.REQUEST_TIMEOUT_MS / 1000}s`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (mem.safe && guardOk) {
    console.log('\x1b[32m✅ ALL SYSTEMS OPERATIONAL - ENVIRONMENT IS SAFE\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31m❌ PROTECTION SYSTEMS DEGRADED\x1b[0m');
    process.exit(1);
  }
}

runMonitor();
