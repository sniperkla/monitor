import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Save, Search, Replace, X, ChevronUp, ChevronDown } from 'lucide-react';
import MacOSModalWindow from '@/components/MacOSModalWindow';

function computeMatches(content, query, matchCase, useRegex) {
  if (!query) return [];
  try {
    const flags = matchCase ? 'g' : 'gi';
    const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(pattern, flags);
    const hits = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      if (m[0].length === 0) re.lastIndex++;
    }
    return hits;
  } catch { return []; }
}

export default function ConfigEditorModal({ file, initialContent, onSave, onClose }) {
  const [content, setContent] = useState(initialContent || '');
  const [cursorPos, setCursorPos] = useState(0);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef(null);
  
  const [findBar, setFindBar] = useState({ visible: false, query: '', replace: '', matchCase: false, useRegex: false, replaceVisible: false, currentIndex: 0 });
  const findInputRef = useRef(null);

  const handleSave = async () => {
    setSaving(true);
    await onSave(content);
    setSaving(false);
    onClose();
  };

  const jumpToMatch = useCallback((matches, index) => {
    if (!matches.length || !textareaRef.current) return;
    const m = matches[index];
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(m.start, m.end);
    const ta = textareaRef.current;
    const linesBefore = ta.value.slice(0, m.start).split('\n').length - 1;
    const lineH = 20; 
    ta.scrollTop = Math.max(0, linesBefore * lineH - ta.clientHeight / 2);
  }, []);

  const openFindBar = useCallback((withReplace = false) => {
    setFindBar(prev => ({ ...prev, visible: true, replaceVisible: withReplace || prev.replaceVisible }));
    setTimeout(() => findInputRef.current?.focus(), 30);
  }, []);

  const closeFindBar = useCallback(() => {
    setFindBar(prev => ({ ...prev, visible: false }));
    textareaRef.current?.focus();
  }, []);

  const findNavigate = useCallback((dir) => {
    const matches = computeMatches(content, findBar.query, findBar.matchCase, findBar.useRegex);
    if (!matches.length) return;
    const next = (findBar.currentIndex + dir + matches.length) % matches.length;
    setFindBar(prev => ({ ...prev, currentIndex: next }));
    jumpToMatch(matches, next);
    setTimeout(() => findInputRef.current?.focus(), 0);
  }, [content, findBar, jumpToMatch]);

  const findReplaceOne = useCallback(() => {
    const matches = computeMatches(content, findBar.query, findBar.matchCase, findBar.useRegex);
    if (!matches.length) return;
    const idx = findBar.currentIndex % matches.length;
    const m = matches[idx];
    const newContent = content.slice(0, m.start) + findBar.replace + content.slice(m.end);
    setContent(newContent);
    const newMatches = computeMatches(newContent, findBar.query, findBar.matchCase, findBar.useRegex);
    const newIdx = Math.min(idx, Math.max(newMatches.length - 1, 0));
    setFindBar(prev => ({ ...prev, currentIndex: newIdx }));
    setTimeout(() => jumpToMatch(computeMatches(newContent, findBar.query, findBar.matchCase, findBar.useRegex), newIdx), 0);
  }, [content, findBar, jumpToMatch]);

  const findReplaceAll = useCallback(() => {
    if (!findBar.query) return;
    try {
      const flags = (findBar.matchCase ? 'g' : 'gi');
      const pattern = findBar.useRegex ? findBar.query : findBar.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(pattern, flags);
      const newContent = content.replace(re, findBar.replace);
      setContent(newContent);
    } catch {}
  }, [content, findBar]);

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openFindBar(false);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      openFindBar(true);
    } else if (e.key === 'Escape') {
      if (findBar.visible) closeFindBar();
    }
  };

  const matches = computeMatches(content, findBar.query, findBar.matchCase, findBar.useRegex);
  const safeIdx = matches.length ? findBar.currentIndex % matches.length : -1;

  return createPortal(
    <MacOSModalWindow
      isOpen
      title={file || 'Editor'}
      icon={FileText}
      onClose={onClose}
      zIndexClassName="z-[9999]"
      draggable={true}
      resizable={true}
      defaultWidth={typeof window !== 'undefined' && window.innerWidth < 600 ? 320 : 800}
      defaultHeight={typeof window !== 'undefined' && window.innerHeight < 600 ? 400 : 600}
      minWidth={300}
      minHeight={300}
      contentClassName="p-4"
      closeOnOverlayClick
      overlayClassName="bg-black/40 backdrop-blur-sm"
    >
      <div className="flex flex-col h-full relative" onKeyDown={handleKeyDown}>
        {/* Find / Replace bar */}
        {findBar.visible && (
          <div className="mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Search size={13} className="text-[var(--text-muted)] shrink-0" />
              <input
                ref={findInputRef}
                value={findBar.query}
                onChange={e => setFindBar(prev => ({ ...prev, query: e.target.value, currentIndex: 0 }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); findNavigate(e.shiftKey ? -1 : 1); }
                  if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
                }}
                placeholder="Find…"
                className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
                spellCheck={false}
              />
              <span className="text-[10px] font-mono text-[var(--text-muted)] select-none whitespace-nowrap shrink-0">
                {findBar.query ? (matches.length ? `${safeIdx + 1} / ${matches.length}` : 'no match') : ''}
              </span>
              <button
                title="Match case"
                onClick={() => setFindBar(prev => ({ ...prev, matchCase: !prev.matchCase, currentIndex: 0 }))}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors select-none ${
                   findBar.matchCase ? 'bg-[var(--accent-indigo)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >Aa</button>
              <button
                title="Use regular expression"
                onClick={() => setFindBar(prev => ({ ...prev, useRegex: !prev.useRegex, currentIndex: 0 }))}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors select-none ${
                   findBar.useRegex ? 'bg-[var(--accent-indigo)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >.*</button>
              <button title="Previous match" onClick={() => findNavigate(-1)} disabled={!matches.length} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><ChevronUp size={14} /></button>
              <button title="Next match" onClick={() => findNavigate(1)} disabled={!matches.length} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><ChevronDown size={14} /></button>
              <button title="Toggle replace" onClick={() => setFindBar(prev => ({ ...prev, replaceVisible: !prev.replaceVisible }))} className={`p-0.5 rounded transition-colors ${findBar.replaceVisible ? 'text-[var(--accent-indigo)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}><Replace size={13} /></button>
              <button onClick={closeFindBar} className="ml-1 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X size={13} /></button>
            </div>
            {findBar.replaceVisible && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[var(--border-color)]">
                <Replace size={13} className="text-[var(--text-muted)] shrink-0" />
                <input
                  value={findBar.replace}
                  onChange={e => setFindBar(prev => ({ ...prev, replace: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); } }}
                  placeholder="Replace with…"
                  className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
                  spellCheck={false}
                />
                <button onClick={findReplaceOne} disabled={!matches.length} className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-card-hover)] hover:bg-[var(--accent-indigo)]/20 text-[var(--text-primary)] hover:text-[var(--accent-indigo)] transition-colors whitespace-nowrap">Replace</button>
                <button onClick={findReplaceAll} disabled={!matches.length} className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-card-hover)] hover:bg-[var(--accent-indigo)]/20 text-[var(--text-primary)] hover:text-[var(--accent-indigo)] transition-colors whitespace-nowrap">Replace All</button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] font-mono text-[var(--text-muted)] select-none">
            {(() => {
              const safeContent = content || '';
              const before = safeContent.slice(0, cursorPos);
              const line = before.split('\n').length;
              const col = before.split('\n').pop().length + 1;
              const totalLines = safeContent.split('\n').length;
              return `Ln ${line}, Col ${col}  |  ${totalLines} lines`;
            })()}
          </span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-[var(--accent-indigo)] hover:opacity-90 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50 text-white font-bold"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </div>

        <div className="flex-1 relative overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
          <div className="flex h-full w-full overflow-auto" ref={el => {
              if (!el) return;
              el._scrollSyncInstalled = el._scrollSyncInstalled || (() => {
                const ta = el.querySelector('textarea');
                const gutter = el.querySelector('[data-gutter]');
                if (!ta || !gutter) return;
                ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
                el._scrollSyncInstalled = true;
              })();
            }}>
            {/* Gutter */}
            <div data-gutter="1" className="select-none overflow-hidden shrink-0 text-right font-mono text-xs leading-5 pt-4 pb-4 pr-3 pl-3" style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)', borderRight: '1px solid var(--border-color)', minWidth: `${String((content || '').split('\\n').length).length * 9 + 28}px`, userSelect: 'none', pointerEvents: 'none' }}>
              {(content || '').split('\n').map((_, i) => (<div key={i} style={{ lineHeight: '1.25rem' }}>{i + 1}</div>))}
            </div>
            {/* TextArea */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => {
                setContent(e.target.value);
                setCursorPos(e.target.selectionStart);
              }}
              onSelect={e => setCursorPos(e.target.selectionStart)}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const start = e.target.selectionStart;
                  const end = e.target.selectionEnd;
                  const val = e.target.value;
                  const newVal = val.substring(0, start) + '  ' + val.substring(end);
                  setContent(newVal);
                  setTimeout(() => { if(textareaRef.current) { textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2; setCursorPos(start + 2); } }, 0);
                }
              }}
              spellCheck={false}
              className="flex-1 bg-transparent p-4 outline-none resize-none whitespace-pre font-mono text-xs leading-5 text-[var(--text-primary)]"
              style={{ minHeight: '100%', tabSize: 2 }}
            />
          </div>
        </div>
      </div>
    </MacOSModalWindow>,
    document.body
  );
}
