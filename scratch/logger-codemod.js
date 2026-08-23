const fs = require('fs');
const path = require('path');

const ROOTS = ['src/app/api', 'src/lib'];
const IMPORT_LINE = "import { logger } from '@/lib/logger';";

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') && e.name !== 'logger.js') out.push(p);
  }
  return out;
}

let filesChanged = 0, callsReplaced = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root, [])) {
    let s = fs.readFileSync(file, 'utf8');
    const before = s;
    s = s.replace(/\bconsole\.log\(/g, 'logger.info(');
    s = s.replace(/\bconsole\.warn\(/g, 'logger.warn(');
    s = s.replace(/\bconsole\.error\(/g, 'logger.error(');
    if (s === before) continue;
    // add import if missing (skip files that already reference logger)
    if (!s.includes("@/lib/logger")) {
      const lines = s.split(String.fromCharCode(10));
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^import\s/.test(lines[i])) lastImport = i;
      }
      if (lastImport >= 0) lines.splice(lastImport + 1, 0, IMPORT_LINE);
      else lines.unshift(IMPORT_LINE);
      s = lines.join(String.fromCharCode(10));
    }
    fs.writeFileSync(file, s);
    filesChanged++;
    callsReplaced += (before.match(/\bconsole\.(log|warn|error)\(/g) || []).length;
  }
}
console.log('files changed:', filesChanged, '| calls replaced:', callsReplaced);
