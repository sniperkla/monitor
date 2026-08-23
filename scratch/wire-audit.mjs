import fs from 'fs';
const NL = String.fromCharCode(10);
function patch(file, edits) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [anchor, insert] of edits) {
    if (!s.includes(anchor)) { console.error('ANCHOR MISS in ' + file + ': ' + JSON.stringify(anchor.slice(0, 60))); process.exit(1); }
    const marker = insert.split(NL).find(l => l.includes('auditLog('));
    if (!marker || !s.includes(marker.trim())) {
      s = s.replace(anchor, anchor + NL + insert);
    }
  }
  fs.writeFileSync(file, s);
  console.log('patched', file);
}

// 1. rclone/exec - audit every remote command execution
patch('src/app/api/rclone/exec/route.js', [
  [
    "import { logger } from '@/lib/logger';",
    "import { auditLog } from '@/lib/auditLog';"
  ],
  [
    "      return NextResponse.json({ success: false, error: 'action must be one of: sync, copy, move, check' }, { status: 400 });",
    "    }",
    "",
    "    // Audit: record every remote rclone execution",
    "    await auditLog({ req, action: 'rclone.exec', detail: { connectionId, action, source, target } });"
  ].join(NL)
]);

// 2. deploy/trigger - audit every deployment trigger
patch('src/app/api/deploy/trigger/route.js', [
  [
    "import { getServerSession } from 'next-auth/next';",
    "import { auditLog } from '@/lib/auditLog';"
  ],
  [
    "    // 3. Now check config state (only reachable by authenticated users)",
    "    await auditLog({ req, action: 'deploy.trigger', detail: { projectId } });"
  ].join(NL)
]);

// 3. firewall/apply - audit every blocklist application
patch('src/app/api/firewall/apply/route.js', [
  [
    "import { getServerSession } from 'next-auth/next';",
    "import { auditLog } from '@/lib/auditLog';"
  ],
  [
    "    const result = await runApply();",
    "    await auditLog({ req: request, action: 'firewall.apply', detail: { connectionId, entries: cleanEntries.length } });"
  ].join(NL)
]);
