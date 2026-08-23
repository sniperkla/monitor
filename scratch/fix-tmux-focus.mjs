import fs from 'fs';
const NL = String.fromCharCode(10);
const DQ = String.fromCharCode(34);
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

patch("src/components/TmuxLayout.js", [
  [
    '        className="tmux-pane-wrapper"',
    '        data-pane-id={layout.id}'
  ],
  [
    "        onClick={(e) => {" + NL + "          e.stopPropagation();" + NL + "          onFocusPane(layout.id);" + NL + "        }}",
    "          // Split-pane focus fix: move real DOM focus into THIS pane terminal," + NL +
    "          // otherwise keystrokes keep going to whichever xterm held focus before." + NL +
    "          const ta = e.currentTarget.querySelector('.xterm-helper-textarea');" + NL +
    "          if (ta) ta.focus({ preventScroll: true });"
  ],
  [
    "  const handleFocusPane = useCallback((id) => {" + NL + "    updateActiveWindow(win => ({ ...win, activePaneId: id }));" + NL + "  }, [updateActiveWindow]);",
    "    // Split-pane focus fix: after active pane changes, move DOM focus to its terminal" + NL +
    "    setTimeout(() => {" + NL +
    "      const el = document.querySelector('[data-pane-id=" + DQ + " + id + " + DQ + "] .xterm-helper-textarea');" + NL +
    "      if (el) el.focus({ preventScroll: true });" + NL +
    "    }, 0);"
  ]
]);
