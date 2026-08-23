const fs = require('fs');
const { execSync } = require('child_process');
let out;
try { out = execSync(String.fromCharCode(110,112,120,32,101,115,108,105,110,116,32,115,114,99,32,45,45,113,117,105,101,116,32,45,102,32,106,115,111,110), { maxBuffer: 50 * 1024 * 1024 }).toString(); }
catch (e) { out = e.stdout.toString(); }
const results = JSON.parse(out);
const byFile = {};
for (const f of results) {
  for (const m of f.messages) {
    if (m.ruleId !== 'react/no-unescaped-entities') continue;
    const ch = m.message.includes("'") ? "'" : m.message.includes('"') ? '"' : m.message.includes('>') ? '>' : '<';
    if (!byFile[f.filePath]) byFile[f.filePath] = [];
    byFile[f.filePath].push({ line: m.line, col: m.column, ch });
  }
}
let fixed = 0;
for (const [path, items] of Object.entries(byFile)) {
  let lines = fs.readFileSync(path, 'utf8').split('\n');
  // sort descending so edits do not shift earlier positions
  items.sort((a, b) => b.line - a.line || b.col - a.col);
  for (const it of items) {
    const idx = it.line - 1;
    const line = lines[idx];
    if (line && line[it.col - 1] === it.ch) {
      const esc = it.ch === "'" ? '&apos;' : it.ch === '"' ? '&quot;' : it.ch === '>' ? '&gt;' : '&lt;';
      lines[idx] = line.slice(0, it.col - 1) + esc + line.slice(it.col);
      fixed++;
    }
  }
  fs.writeFileSync(path, lines.join('\n'));
  console.log('fixed', path.split('/').pop(), items.length);
}
console.log('total fixed:', fixed);
