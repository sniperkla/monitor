#!/usr/bin/env node

/**
 * Update API routes to pass userId when accessing user-specific settings.
 * 
 * This script identifies routes that access user-specific settings
 * (google_drive_config, server_backup_history) and updates them to:
 * 1. Get session.user.id
 * 2. Pass userId to SystemSettingRepository constructor
 * 
 * Run: node scripts/update-routes-for-user-settings.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User-specific setting keys
const USER_SPECIFIC_KEYS = [
  'google_drive_config',
  'server_backup_history'
];

// Files that need updating
const FILES_TO_UPDATE = [
  'src/app/api/mongo-sync/gdrive/auth/route.js',
  'src/app/api/mongo-sync/gdrive/callback/route.js',
  'src/app/api/mongo-sync/cron/route.js',
  'src/app/api/mongo-sync/jobs/[id]/run/route.js',
  'src/app/api/mongo-sync/history/route.js'
];

function updateFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  const originalContent = content;
  let modified = false;

  // Check if file uses any user-specific settings
  const usesUserSettings = USER_SPECIFIC_KEYS.some(key => content.includes(`'${key}'`));
  
  if (!usesUserSettings) {
    console.log(`ℹ️  ${filePath}: No user-specific settings found`);
    return false;
  }

  // Check if getServerSession is already imported
  const hasSessionImport = content.includes('getServerSession');
  const hasAuthOptionsImport = content.includes('authOptions');

  // Add session imports if needed
  if (!hasSessionImport) {
    const nextResponseImportMatch = content.match(/(import\s+\{[^}]+\}\s+from\s+['"]next\/server['"];?\n)/);
    if (nextResponseImportMatch) {
      const insertAfter = nextResponseImportMatch[0];
      content = content.replace(
        insertAfter,
        insertAfter + 'import { getServerSession } from "next-auth/next";\n' +
        'import { authOptions } from "@/lib/auth";\n'
      );
      modified = true;
      console.log(`  ✓ Added session imports`);
    }
  }

  // Pattern 1: Update SystemSettingRepository instantiation from `new SystemSettingRepository(db)` to use userId
  // We'll look for patterns where session is checked and then update the repo instantiation
  
  // First, check if session is retrieved
  const hasSessionCheck = content.includes('getServerSession(authOptions)');
  
  if (!hasSessionCheck) {
    // Add session check after try { in the handler
    const handlerMatch = content.match(/(export\s+async\s+function\s+\w+\([^)]*\)\s*\{[\s\n]*try\s*\{)/);
    if (handlerMatch) {
      const tryBlock = handlerMatch[0];
      const insertPoint = tryBlock.length;
      const beforeTry = content.substring(0, content.indexOf(tryBlock) + insertPoint);
      const afterTry = content.substring(content.indexOf(tryBlock) + insertPoint);
      
      content = beforeTry + `
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID not found in session' }, { status: 400 });
    }
` + afterTry;
      modified = true;
      console.log(`  ✓ Added session check`);
    }
  }

  // Update SystemSettingRepository instantiation
  // Pattern: new SystemSettingRepository(db) -> new SystemSettingRepository(db, userId)
  const repoPattern = /new\s+SystemSettingRepository\(\s*(\w+)\s*\)/g;
  let match;
  let replacements = 0;
  
  while ((match = repoPattern.exec(originalContent)) !== null) {
    const dbVar = match[1];
    const oldPattern = `new SystemSettingRepository(${dbVar})`;
    const newPattern = `new SystemSettingRepository(${dbVar}, userId)`;
    
    // Only replace if content has the old pattern and userId variable exists
    if (content.includes(oldPattern) && content.includes('const userId')) {
      content = content.replace(
        new RegExp(`new\\s+SystemSettingRepository\\(\\s*${dbVar}\\s*\\)`, 'g'),
        `new SystemSettingRepository(${dbVar}, userId)`
      );
      replacements++;
    }
  }
  
  if (replacements > 0) {
    modified = true;
    console.log(`  ✓ Updated ${replacements} SystemSettingRepository instantiation(s)`);
  }

  if (modified) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
    return true;
  } else {
    console.log(`ℹ️  ${filePath}: No changes needed`);
    return false;
  }
}

console.log('🔧 Updating API routes for user-specific settings...\n');
console.log('User-specific setting keys:');
USER_SPECIFIC_KEYS.forEach(key => console.log(`  - ${key}`));
console.log('\n' + '='.repeat(80) + '\n');

let updatedCount = 0;
let skippedCount = 0;

for (const file of FILES_TO_UPDATE) {
  console.log(`\nProcessing: ${file}`);
  if (updateFile(file)) {
    updatedCount++;
  } else {
    skippedCount++;
  }
}

console.log('\n' + '='.repeat(80));
console.log('📊 SUMMARY');
console.log('='.repeat(80));
console.log(`Files updated: ${updatedCount}`);
console.log(`Files skipped: ${skippedCount}`);
console.log(`Total: ${FILES_TO_UPDATE.length}`);
console.log('='.repeat(80));
console.log('\n✅ Done!\n');
