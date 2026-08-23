import fs from 'fs';
const NL = String.fromCharCode(10);
function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [anchor, insertAfter] of pairs) {
    const i = s.indexOf(anchor);
    if (i === -1) { console.error('MISS in ' + file + ': ' + JSON.stringify(anchor.slice(0, 50))); process.exit(1); }
    if (!s.includes(insertAfter.trim())) {
      s = s.slice(0, i + anchor.length) + NL + insertAfter + s.slice(i + anchor.length);
    }
  }
  fs.writeFileSync(file, s);
  console.log('patched', file);
}

patch('src/components/FileManager.js', [
  ["  isSplit = false,", "  // Only the active split pane may respond to global keyboard/paste events" + NL + "  isActivePane = true,"],
  [
    "    const handleSystemPaste = async (e) => {",
    "      // Split-pane fix: inactive panes must never react to global Ctrl+V" + NL + "      if (isSplit && !isActivePane) return;"
  ],
  [
    "        document.activeElement.closest('.xterm')" + NL + "      ) {" + NL + "        return;" + NL + "      }",
    NL + "      // Split-pane fix: shortcuts apply to the focused pane only" + NL + "      if (isSplit && !isActivePane) return;"
  ]
]);

patch('src/components/FileLayout.js', [
  ["              isSplit={true}", "              isActivePane={isActive}"]
]);
