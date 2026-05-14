const fs = require('fs');
let code = fs.readFileSync('src/components/TerminalView.js', 'utf8');

code = code.replace(
  '    autoRunningRef.current = true;\n    try {',
  '    autoRunningRef.current = true;\n    setAiLoading(true);\n    try {'
);

code = code.replace(
  '{autoMode && autoCountdown === 0 && (\n                          <button',
  '{autoMode && autoCountdown === 0 && !autoRunningRef.current && !aiLoading && (\n                          <button'
);

code = code.replace(
  '    } finally {\n      autoRunningRef.current = false;\n    }',
  '    } finally {\n      autoRunningRef.current = false;\n      setAiLoading(false);\n    }'
);

fs.writeFileSync('src/components/TerminalView.js', code);
console.log('Done');
