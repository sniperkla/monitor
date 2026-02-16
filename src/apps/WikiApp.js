'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import { 
  Book, Search, Terminal, Copy, Check, ChevronRight, 
  Layers, Settings, Globe, Shield, Database, Layout,
  ExternalLink, Info, Filter, Plus, Monitor, Server,
  Cloud, Wrench, Activity, GitBranch, Clock, Cpu,
  MessageSquare, Send, X, Bot, User, Sparkles, Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSession, signIn } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';
import { useOS } from '@/context/OSContext';

const OS_ICONS = {
  'Ubuntu/Debian': { emoji: '🟠', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  'CentOS/RHEL': { emoji: '🔴', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  'All Linux': { emoji: '🐧', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  'macOS': { emoji: '🍎', color: 'text-gray-300', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
  'Windows': { emoji: '🪟', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  'Alpine': { emoji: '🏔️', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  'Any': { emoji: '🌐', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
};

const getOsStyle = (os) => OS_ICONS[os] || OS_ICONS['Any'];

export default function WikiApp({ initialGuideId }) {
  const { state, apiFetch, dispatch } = useApp();
  const { addNotification } = useOS();
  const { data: session } = useSession();
  const { isConfigured, isUnlocked } = useVault();
  const { t } = useTranslation();
  const [guides, setGuides] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [osList, setOsList] = useState(['All']);
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeOs, setActiveOs] = useState('All');
  const [activeGuide, setActiveGuide] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  
  // Chat / AI Assistant State
  // Chat / AI Assistant State - Multiple Windows
  // Open a new chat window for the current guide
  const openChatWindow = () => {
    if (!activeGuide) return;
    dispatch({
      type: 'OPEN_WIKI_CHAT',
      payload: {
        id: Date.now(),
        guide: activeGuide,
      }
    });
  };


  // If opened from Spotlight with a specific guide, fetch it directly
  const [initialLoaded, setInitialLoaded] = useState(false);
  useEffect(() => {
    if (initialGuideId && !initialLoaded) {
      (async () => {
        try {
          setLoading(true);
          const res = await apiFetch(`/api/wiki/${initialGuideId}`);
          const data = await res.json();
          if (data.success && data.data) {
            setActiveGuide(data.data);
          }
        } catch (err) {
          console.error('Failed to fetch initial guide:', err);
        } finally {
          setInitialLoaded(true);
          // Still load the full list
          fetchGuides();
        }
      })();
    } else if (!initialLoaded) {
      setInitialLoaded(true);
      fetchGuides();
    }
  }, []);

  useEffect(() => {
    if (initialLoaded) {
      fetchGuides();
    }
  }, [search, activeCategory, activeOs]);

  const fetchGuides = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/wiki?q=${search}&category=${activeCategory}&os=${activeOs}`);
      const data = await res.json();
      if (data.success) {
        setGuides(data.data);
        if (data.categories) setCategories(data.categories);
        if (data.osList) setOsList(data.osList);
        if (data.data.length > 0 && !activeGuide && !initialGuideId) {
          setActiveGuide(data.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch wiki guides:', err);
    } finally {
      setLoading(false);
    }
  };



  const handleCopy = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCategoryIcon = (category) => {
    const c = category.toLowerCase();
    if (c === 'all') return <Layers size={14} className="text-indigo-400" />;
    if (c === 'web server') return <Globe size={14} className="text-emerald-400" />;
    if (c === 'security') return <Shield size={14} className="text-rose-400" />;
    if (c === 'database') return <Database size={14} className="text-amber-400" />;
    if (c === 'container') return <Cpu size={14} className="text-cyan-400" />;
    if (c === 'monitoring') return <Activity size={14} className="text-green-400" />;
    if (c === 'network') return <Globe size={14} className="text-sky-400" />;
    if (c === 'process') return <Server size={14} className="text-violet-400" />;
    if (c === 'devops') return <GitBranch size={14} className="text-pink-400" />;
    if (c === 'cloud') return <Cloud size={14} className="text-blue-400" />;
    if (c === 'system') return <Monitor size={14} className="text-teal-400" />;
    if (c === 'installation') return <Plus size={14} className="text-blue-400" />;
    if (c === 'tools') return <Wrench size={14} className="text-orange-400" />;
    return <Settings size={14} className="text-gray-400" />;
  };

  const OsBadge = ({ os, small }) => {
    const s = getOsStyle(os);
    return (
      <span className={`inline-flex items-center gap-1 ${small ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-0.5 text-[9px]'} rounded ${s.bg} ${s.color} border ${s.border} font-medium`}>
        <span className={small ? 'text-[8px]' : 'text-[10px]'}>{s.emoji}</span>
        {os}
      </span>
    );
  };

  return (
    <div className="flex h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-x-auto overflow-y-hidden font-sans custom-scrollbar">
      {/* Categories & Search Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]/30">
        <div className="p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-inner">
               <Book size={18} className="text-indigo-400" />
            </div>
            <span className="font-bold text-sm tracking-tight italic">Resource Hub</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input 
              type="text"
              placeholder="Search guides..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] rounded-lg py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {/* OS Filter */}
          <p className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Platform / OS</p>
          <div className="px-2 pb-3 flex flex-wrap gap-1">
            {osList.map(os => {
              const s = os === 'All' ? { emoji: '🌐', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' } : getOsStyle(os);
              return (
                <button
                  key={os}
                  onClick={() => { setActiveOs(os); setActiveGuide(null); }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                    activeOs === os
                      ? `${s.bg} ${s.color} ${s.border} shadow-sm`
                      : 'border-transparent hover:bg-white/5 text-[var(--text-muted)]'
                  }`}
                >
                  <span className="text-[11px]">{s.emoji}</span>
                  {os}
                </button>
              );
            })}
          </div>

          {/* Categories */}
          <p className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Categories</p>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); setActiveGuide(null); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
                activeCategory === cat 
                  ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                  : 'hover:bg-white/5 text-[var(--text-secondary)] border border-transparent'
              }`}
            >
              {getCategoryIcon(cat)}
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Guide List Pane */}
      <div className="w-72 flex-shrink-0 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-primary)]">
        <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/5 flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text-primary)]">Guides</span>
          <span className="text-[10px] text-[var(--text-muted)]">{guides.length} found</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center opacity-40">
              <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-indigo-400" />
              <p className="text-xs">Connecting to Hub...</p>
            </div>
          ) : guides.length > 0 ? (
            guides.map(guide => (
              <button
                key={guide._id}
                onClick={() => setActiveGuide(guide)}
                className={`w-full p-4 rounded-xl text-left transition-all border group ${
                  activeGuide?._id === guide._id 
                    ? 'bg-indigo-500/5 border-indigo-500/20 shadow-sm' 
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold truncate ${activeGuide?._id === guide._id ? 'text-indigo-400' : 'text-[var(--text-primary)]'}`}>
                    {guide.title}
                  </span>
                  <ChevronRight size={12} className={`transition-transform flex-shrink-0 ml-1 ${activeGuide?._id === guide._id ? 'rotate-90 text-indigo-400' : 'text-[var(--text-muted)]'}`} />
                </div>
                <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed opacity-80 group-hover:opacity-100 italic">
                  {guide.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {guide.os?.map(o => (
                    <OsBadge key={o} os={o} small />
                  ))}
                  {guide.tags?.slice(0, 1).map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-indigo-500/5 text-[8px] text-indigo-300 font-mono">
                      #{tag}
                    </span>
                  ))}
                </div>
              </button>
            ))
          ) : (
            <div className="py-12 text-center opacity-40">
              <Info size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-xs">No guides found for this query</p>
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-[500px] flex flex-col bg-[var(--bg-primary)]">
        {activeGuide ? (
          <>
            <div className="h-16 border-b border-[var(--border-color)] flex items-center justify-between px-8 bg-indigo-500/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  {getCategoryIcon(activeGuide.category)}
                </div>
                <div>
                  <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                    {activeGuide.title}
                  </h1>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-widest">{activeGuide.category}</span>
                    <span className="w-1 h-1 rounded-full bg-[var(--border-color)]" />
                    <div className="flex gap-1">
                      {activeGuide.os?.map(o => <OsBadge key={o} os={o} />)}
                    </div>
                    <span className="w-1 h-1 rounded-full bg-[var(--border-color)]" />
                    <span className="text-[9px] text-[var(--text-muted)] italic">Last updated {new Date(activeGuide.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              
              {(!session && !isConfigured) ? (
                <button
                  onClick={() => signIn('google')}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all text-xs font-bold border border-white/5"
                >
                  <User size={14} />
                  Login to Ask AI
                </button>
              ) : !isConfigured ? (
                <button
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-all text-xs font-bold cursor-not-allowed opacity-80"
                  onClick={() => addNotification({
                    title: 'Database Required',
                    message: 'Please configure your database in Settings to use AI Chat History.',
                    type: 'warning'
                  })}
                >
                  <Database size={14} />
                  Connect DB for AI
                </button>
              ) : !isUnlocked ? (
                <button
                  onClick={() => addNotification({
                    title: 'Vault Locked',
                    message: 'Please go to Settings to unlock your vault with your Master Password.',
                    type: 'info'
                  })}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all text-xs font-bold"
                >
                  <Lock size={14} />
                  Unlock Vault for AI
                </button>
              ) : (
                <button
                  onClick={openChatWindow}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-600 transition-all text-xs font-bold"
                >
                  <Sparkles size={14} />
                  Ask AI Helper
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
              <div className="max-w-3xl mx-auto">
                <div className="p-6 rounded-3xl bg-indigo-500/5 border border-indigo-500/10 mb-8 border-l-4 border-l-indigo-500 shadow-sm shadow-indigo-500/5">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)] italic">
                    {activeGuide.description}
                  </p>
                  {activeGuide.os && activeGuide.os.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 pt-3 border-t border-indigo-500/10">
                      <Monitor size={12} className="text-[var(--text-muted)]" />
                      <span className="text-[10px] text-[var(--text-muted)] font-medium">Supported on:</span>
                      <div className="flex gap-1 flex-wrap">
                        {activeGuide.os.map(o => <OsBadge key={o} os={o} />)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-8">
                  {activeGuide.commands?.map((cmd, i) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      key={i} 
                      className="group"
                    >
                      <h3 className="text-xs font-bold text-indigo-300 mb-3 flex items-center gap-2 uppercase tracking-widest">
                        <Terminal size={14} />
                        {cmd.label}
                      </h3>
                      
                      <div className="relative rounded-2xl bg-black/40 border border-white/5 overflow-hidden group-hover:border-indigo-500/30 transition-all shadow-xl">
                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                          <button 
                            onClick={() => handleCopy(cmd.code, `${activeGuide._id}-${i}`)}
                            className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-all active:scale-95 border border-white/5"
                            title="Copy Code"
                          >
                            {copiedId === `${activeGuide._id}-${i}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                          </button>
                        </div>
                        <pre className="p-5 font-mono text-[13px] text-indigo-100 overflow-x-auto custom-scrollbar-horizontal leading-relaxed">
                          <code>{cmd.code}</code>
                        </pre>
                        {cmd.explanation && (
                          <div className="px-5 py-3 bg-white/5 border-t border-white/5 text-[11px] text-[var(--text-muted)] italic leading-relaxed">
                            {cmd.explanation}
                          </div>
                        )}
                        {cmd.result && (
                          <div className="px-5 py-3 bg-emerald-500/5 border-t border-white/5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Example Output</span>
                            </div>
                            <pre className="font-mono text-[10px] text-emerald-200/70 whitespace-pre-wrap leading-tight">
                              {cmd.result}
                            </pre>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {activeGuide.tags && (
                  <div className="mt-12 pt-8 border-t border-[var(--border-color)] flex items-center gap-3">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Related Tags:</span>
                    <div className="flex flex-wrap gap-2">
                      {activeGuide.tags.map(tag => (
                        <span key={tag} className="px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] text-[var(--text-secondary)] hover:text-indigo-400 transition-colors cursor-pointer">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>


            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-20">
             <div className="w-24 h-24 rounded-full bg-indigo-500/5 flex items-center justify-center mb-6 border border-indigo-500/10">
                <Book size={48} className="text-indigo-400" />
             </div>
             <h2 className="text-xl font-bold mb-2 tracking-tight">Knowledge Base</h2>
             <p className="text-sm max-w-xs mx-auto italic">Select a guide from the hub to explore server commands and installation steps.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const RefreshCw = ({ size, className }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);


