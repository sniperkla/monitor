'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Terminal, Settings, Monitor, StickyNote, Book, Folder,
  ArrowRight, Command, CornerDownLeft, ChevronUp, ChevronDown,
  Hash, FileText, Server, Globe, Database, Shield, Layers, X
} from 'lucide-react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { useTranslation } from 'react-i18next';
import MacOSModalWindow from '@/components/MacOSModalWindow';

import SSHApp from '@/apps/SSHApp';
import SettingsApp from '@/apps/SettingsApp';
import NotepadApp from '@/apps/NotepadApp';
import WikiApp from '@/apps/WikiApp';
import FilesApp from '@/apps/FilesApp';
import TerminalApp from '@/apps/TerminalApp';

const SYSTEM_APPS = [
  { id: 'ssh-manager', titleKey: 'ssh.manager', fallback: 'SSH Manager', icon: Monitor, component: <SSHApp />, category: 'app', initialWidth: 1200, initialHeight: 800 },
  { id: 'settings', titleKey: 'common.settings', fallback: 'Settings', icon: Settings, component: <SettingsApp />, category: 'app', initialWidth: 800, initialHeight: 600 },
  { id: 'wiki', titleKey: null, fallback: 'Resource Hub', icon: Book, component: <WikiApp />, category: 'app', initialWidth: 1100, initialHeight: 750 },
  { id: 'notepad', titleKey: null, fallback: 'Notepad', icon: StickyNote, component: <NotepadApp />, category: 'app', initialWidth: 800, initialHeight: 600 },
  { id: 'files-app', titleKey: null, fallback: 'Files', icon: Folder, component: <FilesApp />, category: 'app', initialWidth: 1000, initialHeight: 650 },
  { id: 'terminal', titleKey: 'terminal.title', fallback: 'Terminal', icon: Terminal, component: <TerminalApp />, category: 'app', initialWidth: 900, initialHeight: 600 },
];

const CATEGORY_ICONS = {
  'Web Server': Globe,
  'Container': Layers,
  'Database': Database,
  'Security': Shield,
  'OS': Server,
  'Networking': Globe,
  'Automation': Terminal,
  'Programming': FileText,
};

export default function SpotlightSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [wikiResults, setWikiResults] = useState([]);
  const [wikiLoading, setWikiLoading] = useState(false);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const searchTimerRef = useRef(null);

  const { openWindow, closeWindow, state: osState } = useOS();
  const { apiFetch } = useApp();
  const { t } = useTranslation();

  // ⌘+K / Ctrl+K to toggle
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setWikiResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced wiki search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (query.trim().length < 2) {
      setWikiResults([]);
      setWikiLoading(false);
      return;
    }

    setWikiLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/wiki?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (data.success) {
          setWikiResults(data.data.slice(0, 8)); // Cap at 8 results
        }
      } catch {
        setWikiResults([]);
      } finally {
        setWikiLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query]);

  // Filter system apps
  const filteredApps = query.trim()
    ? SYSTEM_APPS.filter(app => {
        const title = app.titleKey ? t(app.titleKey) : app.fallback;
        return title.toLowerCase().includes(query.toLowerCase()) ||
               app.id.toLowerCase().includes(query.toLowerCase());
      })
    : SYSTEM_APPS;

  // Combined results
  const allResults = [
    ...filteredApps.map(app => ({
      type: 'app',
      id: app.id,
      title: app.titleKey ? t(app.titleKey) : app.fallback,
      subtitle: t('desktop.taskbar.systemApp') || 'System App',
      icon: app.icon,
      component: app.component,
      appIcon: app.icon,
      initialWidth: app.initialWidth,
      initialHeight: app.initialHeight,
    })),
    ...wikiResults.map(guide => ({
      type: 'wiki',
      id: `wiki-${guide._id}`,
      title: guide.title,
      subtitle: `${guide.category} · ${guide.os}`,
      icon: CATEGORY_ICONS[guide.category] || Book,
      guide,
    })),
  ];

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= allResults.length) {
      setSelectedIndex(Math.max(0, allResults.length - 1));
    }
  }, [allResults.length, selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allResults[selectedIndex]) {
        handleSelect(allResults[selectedIndex]);
      }
    }
  }, [allResults, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = (result) => {
    if (result.type === 'app') {
      openWindow(result.id, result.title, result.component, result.appIcon, {
        initialWidth: result.initialWidth,
        initialHeight: result.initialHeight
      });
    } else if (result.type === 'wiki') {
      // Close existing wiki window, then reopen with the specific guide
      const existingWiki = osState.windows.find(w => w.id === 'wiki');
      if (existingWiki) {
        closeWindow('wiki');
      }
      // Use setTimeout to ensure the close action is processed first
      setTimeout(() => {
        openWindow('wiki', result.guide.title, <WikiApp initialGuideId={result.guide._id} />, Book, {
          initialWidth: 1100,
          initialHeight: 750
        });
      }, 50);
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <MacOSModalWindow
      isOpen
      title={t('desktop.taskbar.search') || 'Search'}
      icon={Search}
      onClose={() => setIsOpen(false)}
      zIndexClassName="z-[20000]"
      maxWidthClassName="w-[640px] max-w-[90vw]"
      maxHeightClassName="max-h-[70vh]"
      contentClassName="p-0"
      closeOnOverlayClick
      overlayClassName="bg-black/40 backdrop-blur-sm"
      containerClassName="items-start pt-[18vh]"
      windowClassName="shadow-2xl"
    >
      <div>
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
          <Search size={20} className="text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search apps, guides, commands..."
            className="flex-1 bg-transparent text-base text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none font-medium"
            autoComplete="off"
            spellCheck="false"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="p-1 rounded-md hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <div className="flex items-center gap-1 text-[var(--text-muted)]/70 text-[10px] font-mono shrink-0">
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px]">esc</kbd>
          </div>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto custom-scrollbar">
          {allResults.length > 0 ? (
            <>
              {/* Apps Section */}
              {filteredApps.length > 0 && (
                <div className="px-3 pt-3 pb-1">
                  <div className="px-2 mb-2 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                    Applications
                  </div>
                  {filteredApps.map((app, i) => {
                    const globalIndex = i;
                    const title = app.titleKey ? t(app.titleKey) : app.fallback;
                    return (
                      <button
                        key={app.id}
                        data-index={globalIndex}
                        onClick={() => handleSelect(allResults[globalIndex])}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                          selectedIndex === globalIndex
                            ? 'bg-indigo-500/20 text-white'
                            : 'text-white/70 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          selectedIndex === globalIndex
                            ? 'bg-indigo-500/30'
                            : 'bg-white/[0.06]'
                        }`}>
                          <app.icon size={18} className={selectedIndex === globalIndex ? 'text-indigo-300' : 'text-white/50'} />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <span className="block text-sm font-semibold truncate">{title}</span>
                          <span className="block text-[10px] text-white/30 truncate">Application</span>
                        </div>
                        {selectedIndex === globalIndex && (
                          <div className="flex items-center gap-1 text-white/30 shrink-0">
                            <CornerDownLeft size={12} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Wiki section */}
              {wikiResults.length > 0 && (
                <div className="px-3 pt-2 pb-2">
                  <div className="h-px bg-white/[0.06] mx-2 mb-3" />
                  <div className="px-2 mb-2 text-[10px] font-bold text-white/30 uppercase tracking-widest flex items-center gap-2">
                    <Book size={10} />
                    Guide Hub Results
                  </div>
                  {wikiResults.map((guide, i) => {
                    const globalIndex = filteredApps.length + i;
                    const Icon = CATEGORY_ICONS[guide.category] || Book;
                    return (
                      <button
                        key={guide._id}
                        data-index={globalIndex}
                        onClick={() => handleSelect(allResults[globalIndex])}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                          selectedIndex === globalIndex
                            ? 'bg-indigo-500/20 text-white'
                            : 'text-white/70 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          selectedIndex === globalIndex
                            ? 'bg-purple-500/30'
                            : 'bg-white/[0.06]'
                        }`}>
                          <Icon size={16} className={selectedIndex === globalIndex ? 'text-purple-300' : 'text-white/50'} />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <span className="block text-sm font-semibold truncate">{guide.title}</span>
                          <span className="block text-[10px] text-white/30 truncate">
                            {guide.category} · {guide.os} · {guide.commands?.length || 0} commands
                          </span>
                        </div>
                        {guide.tags && guide.tags.length > 0 && (
                          <div className="hidden md:flex items-center gap-1 shrink-0">
                            {guide.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[9px] text-white/30 font-mono">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {selectedIndex === globalIndex && (
                          <div className="flex items-center gap-1 text-white/30 shrink-0 ml-1">
                            <CornerDownLeft size={12} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Loading indicator for wiki */}
              {wikiLoading && query.trim().length >= 2 && (
                <div className="px-5 py-3 flex items-center gap-2 text-white/30 text-xs">
                  <div className="w-3 h-3 rounded-full border-2 border-indigo-400/40 border-t-indigo-400 animate-spin" />
                  Searching guides...
                </div>
              )}
            </>
          ) : query.trim().length >= 2 && !wikiLoading ? (
            <div className="px-5 py-10 text-center">
              <Search size={32} className="mx-auto text-white/10 mb-3" />
              <p className="text-sm text-white/30 font-medium">No results found</p>
              <p className="text-xs text-white/15 mt-1">Try a different search term</p>
            </div>
          ) : query.trim().length === 0 ? (
            /* Quick actions when empty */
            <div className="px-3 pt-3 pb-2">
              <div className="px-2 mb-2 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                Quick Launch
              </div>
              {SYSTEM_APPS.map((app, i) => {
                const title = app.titleKey ? t(app.titleKey) : app.fallback;
                return (
                  <button
                    key={app.id}
                    data-index={i}
                    onClick={() => handleSelect(allResults[i])}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                      selectedIndex === i
                        ? 'bg-indigo-500/20 text-white'
                        : 'text-white/70 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      selectedIndex === i
                        ? 'bg-indigo-500/30'
                        : 'bg-white/[0.06]'
                    }`}>
                      <app.icon size={18} className={selectedIndex === i ? 'text-indigo-300' : 'text-white/50'} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <span className="block text-sm font-semibold truncate">{title}</span>
                    </div>
                    {selectedIndex === i && (
                      <CornerDownLeft size={12} className="text-white/30 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-4 text-[10px] text-white/20">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px]">↑</kbd>
              <kbd className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px]">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px]">↵</kbd>
              open
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/15">
            <Command size={10} />
            <span>K</span>
          </div>
        </div>
      </div>
    </MacOSModalWindow>,
    document.body
  );
}
