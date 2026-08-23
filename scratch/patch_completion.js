const fs = require('fs');
let code = fs.readFileSync('src/components/TerminalView.js', 'utf8');

const target = 'completionHint = `\\n[ACTION] TERMINAL_EVIDENCE_POSITIVE: Goal satisfied (Reason: ${completionEvidence.reason}). Set <done>true</done> now.`;';
const replace = 'completionHint = `\\n🏆 CRITICAL: SUCCESS CONFIRMED (Reason: ${completionEvidence.reason}). The goal has been achieved. You MUST stop now. Do NOT overthink or run further commands. Set <done>true</done> and provide a <explain> summary IMMEDIATELY.`;';

code = code.replace(target, replace);
fs.writeFileSync('src/components/TerminalView.js', code);
console.log('Saved completion hint patch');
