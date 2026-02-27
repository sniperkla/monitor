'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import { 
  Book, Search, Terminal, Copy, Check, ChevronRight, 
  Layers, Settings, Globe, Shield, Database, Layout,
  ExternalLink, Info, Filter, Plus, Monitor, Server,
  Cloud, Wrench, Activity, GitBranch, Clock, Cpu,
  MessageSquare, Send, X, Bot, User, Sparkles, Lock, Languages
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSession, signIn } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';
import { useOS } from '@/context/OSContext';

// Global cache for pending translation requests to prevent duplicates
const pendingTranslations = new Map();

const OS_ICONS = {
  'Ubuntu/Debian': { emoji: '🟠', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  'CentOS/RHEL': { emoji: '🔴', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  'All Linux': { emoji: '🐧', color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  'macOS': { emoji: '🍎', color: 'text-slate-600 dark:text-gray-300', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
  'Windows': { emoji: '🪟', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  'Alpine': { emoji: '🏔️', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  'Any': { emoji: '🌐', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
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
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translations, setTranslations] = useState({}); // { [key]: string }
  const [translating, setTranslating] = useState({}); // { [key]: boolean }
  const { i18n } = useTranslation();
  
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



  const translateText = async (text, key) => {
    const targetLang = i18n.language;
    if (targetLang === 'en' || !text.trim()) return;

    const cacheKey = `${text}_${targetLang}`;
    
    // Check if already translated
    if (translations[key]) return;
    
    // Check if translation is already in progress globally
    if (pendingTranslations.has(cacheKey)) {
      try {
        const result = await pendingTranslations.get(cacheKey);
        if (result) {
          setTranslations(prev => ({ ...prev, [key]: result }));
        }
      } catch (err) {
        console.error('Translation error:', err);
      }
      return;
    }

    setTranslating(prev => ({ ...prev, [key]: true }));
    
    // Create the translation promise
    const translationPromise = (async () => {
      const res = await fetch('/api/utils/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang })
      });
      const data = await res.json();
      if (data.success) {
        return data.translated;
      }
      throw new Error(data.error || 'Translation failed');
    })();

    // Store in global cache
    pendingTranslations.set(cacheKey, translationPromise);

    try {
      const translated = await translationPromise;
      setTranslations(prev => ({ ...prev, [key]: translated }));
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setTranslating(prev => ({ ...prev, [key]: false }));
      // Clean up cache after a delay
      setTimeout(() => pendingTranslations.delete(cacheKey), 5000);
    }
  };

  // Bulk translation function
  const translateBatch = async (textsToTranslate) => {
    const targetLang = i18n.language;
    if (targetLang === 'en' || textsToTranslate.length === 0) return;

    // Filter out already translated or in-progress texts
    const pendingTexts = textsToTranslate.filter(({ key, text }) => {
      const cacheKey = `${text}_${targetLang}`;
      return !translations[key] && !pendingTranslations.has(cacheKey);
    });

    if (pendingTexts.length === 0) return;

    // Mark all as translating
    const translatingKeys = {};
    pendingTexts.forEach(({ key }) => {
      translatingKeys[key] = true;
    });
    setTranslating(prev => ({ ...prev, ...translatingKeys }));

    // Create batch payload
    const batch = pendingTexts.map(({ key, text }) => ({
      key,
      text,
      cacheKey: `${text}_${targetLang}`
    }));

    // Store promises in cache
    const batchPromise = (async () => {
      const res = await fetch('/api/utils/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          texts: batch.map(b => ({ key: b.key, text: b.text })), 
          targetLang 
        })
      });
      const data = await res.json();
      return data;
    })();

    // Cache individual promises
    batch.forEach(({ cacheKey }) => {
      pendingTranslations.set(cacheKey, batchPromise.then(data => {
        const item = data.translations?.find(t => {
          const b = batch.find(x => x.key === t.key);
          return b && b.cacheKey === cacheKey;
        });
        return item?.translated;
      }));
    });

    try {
      const data = await batchPromise;
      if (data.success && data.translations) {
        const newTranslations = {};
        data.translations.forEach(({ key, translated }) => {
          newTranslations[key] = translated;
        });
        setTranslations(prev => ({ ...prev, ...newTranslations }));
      }
    } catch (err) {
      console.error('Batch translation error:', err);
    } finally {
      setTranslating(prev => {
        const next = { ...prev };
        pendingTexts.forEach(({ key }) => delete next[key]);
        return next;
      });
      // Clean up cache
      setTimeout(() => {
        batch.forEach(({ cacheKey }) => pendingTranslations.delete(cacheKey));
      }, 5000);
    }
  };

  useEffect(() => {
    if (autoTranslate && activeGuide) {
      const lang = i18n.language;
      if (lang === 'en') return;

      const textsToTranslate = [];

      // Queue Title
      if (!translations[`title_${activeGuide._id}`]) {
        textsToTranslate.push({
          key: `title_${activeGuide._id}`,
          text: activeGuide.title
        });
      }
      // Queue Description  
      if (!translations[`desc_${activeGuide._id}`]) {
        textsToTranslate.push({
          key: `desc_${activeGuide._id}`,
          text: activeGuide.description
        });
      }
      // Queue Command Explanations
      activeGuide.commands?.forEach((cmd, idx) => {
        if (cmd.explanation && !translations[`cmd_exp_${activeGuide._id}_${idx}`]) {
          textsToTranslate.push({
            key: `cmd_exp_${activeGuide._id}_${idx}`,
            text: cmd.explanation
          });
        }
      });

      // Send as single batch
      if (textsToTranslate.length > 0) {
        translateBatch(textsToTranslate);
      }
    }
  }, [autoTranslate, activeGuide, i18n.language]);

  const handleCopy = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCategoryIcon = (category) => {
    const c = (category || '').toLowerCase();
    if (c === 'all') return <Layers size={14} className="text-[var(--accent-indigo)]" />;
    if (c === 'web server') return <Globe size={14} className="text-emerald-600 dark:text-emerald-400" />;
    if (c === 'security') return <Shield size={14} className="text-rose-600 dark:text-rose-400" />;
    if (c === 'database') return <Database size={14} className="text-amber-600 dark:text-amber-400" />;
    if (c === 'container') return <Cpu size={14} className="text-cyan-600 dark:text-cyan-400" />;
    if (c === 'monitoring') return <Activity size={14} className="text-green-600 dark:text-green-400" />;
    if (c === 'network') return <Globe size={14} className="text-sky-600 dark:text-sky-400" />;
    if (c === 'process') return <Server size={14} className="text-violet-600 dark:text-violet-400" />;
    if (c === 'devops') return <GitBranch size={14} className="text-pink-600 dark:text-pink-400" />;
    if (c === 'cloud') return <Cloud size={14} className="text-blue-600 dark:text-blue-400" />;
    if (c === 'system') return <Monitor size={14} className="text-teal-600 dark:text-teal-400" />;
    if (c === 'installation') return <Plus size={14} className="text-blue-600 dark:text-blue-400" />;
    if (c === 'tools') return <Wrench size={14} className="text-[var(--accent-amber)]" />;
    return <Settings size={14} className="text-[var(--text-muted)]" />;
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
            <div className="w-8 h-8 rounded-lg bg-[var(--glow-indigo)] flex items-center justify-center border border-[var(--accent-indigo)]/20 shadow-inner">
               <Book size={18} className="text-[var(--accent-indigo)]" />
            </div>
            <span className="font-bold text-sm tracking-tight italic">{t('wiki.hub')}</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input 
              type="text"
              placeholder={t('wiki.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] rounded-lg py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {/* OS Filter */}
          <p className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{t('wiki.platform')}</p>
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
                      : 'border-transparent hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                  }`}
                >
                  <span className="text-[11px]">{s.emoji}</span>
                  {os}
                </button>
              );
            })}
          </div>

          {/* Categories */}
          <p className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{t('wiki.categories')}</p>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); setActiveGuide(null); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
                activeCategory === cat 
                  ? 'bg-[var(--glow-indigo)] text-[var(--accent-indigo)] border border-[var(--accent-indigo)]/20' 
                  : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-transparent'
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
          <span className="text-xs font-bold text-[var(--text-primary)]">{t('wiki.guides')}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{guides.length} {t('wiki.found')}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center opacity-40">
              <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-[var(--accent-indigo)]" />
              <p className="text-xs">{t('wiki.connecting')}</p>
            </div>
          ) : guides.length > 0 ? (
            guides.map(guide => (
              <button
                key={guide._id}
                onClick={() => setActiveGuide(guide)}
                className={`w-full p-4 rounded-xl text-left transition-all border group ${
                  activeGuide?._id === guide._id 
                    ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]/20 shadow-sm' 
                    : 'border-transparent hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold truncate ${activeGuide?._id === guide._id ? 'text-[var(--accent-indigo)]' : 'text-[var(--text-primary)]'}`}>
                    {autoTranslate && translations[`title_${guide._id}`] 
                      ? translations[`title_${guide._id}`] 
                      : (translating[`title_${guide._id}`] ? '...' : guide.title)}
                  </span>
                  <ChevronRight size={12} className={`transition-transform flex-shrink-0 ml-1 ${activeGuide?._id === guide._id ? 'rotate-90 text-[var(--accent-indigo)]' : 'text-[var(--text-muted)]'}`} />
                </div>
                <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed opacity-80 group-hover:opacity-100 italic">
                  {autoTranslate && translations[`desc_${guide._id}`] 
                    ? translations[`desc_${guide._id}`] 
                    : (translating[`desc_${guide._id}`] ? '...' : guide.description)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {guide.os?.map(o => (
                    <OsBadge key={o} os={o} small />
                  ))}
                  {guide.tags?.slice(0, 1).map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-[var(--glow-indigo)] text-[8px] text-[var(--accent-indigo)] font-mono">
                      #{tag}
                    </span>
                  ))}
                </div>
              </button>
            ))
          ) : (
            <div className="py-12 text-center opacity-40">
              <Info size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-xs">{t('wiki.noGuides')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-[500px] flex flex-col bg-[var(--bg-primary)]">
        {activeGuide ? (
          <>
            <div className="h-16 border-b border-[var(--border-color)] flex items-center justify-between px-8 bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[var(--glow-indigo)] border border-[var(--accent-indigo)]/20">
                  {getCategoryIcon(activeGuide.category)}
                </div>
                <div>
                  <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                    {autoTranslate && translations[`title_${activeGuide._id}`] 
                      ? translations[`title_${activeGuide._id}`] 
                      : (translating[`title_${activeGuide._id}`] ? '...' : activeGuide.title)}
                  </h1>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-bold text-[var(--accent-indigo)] tracking-widest">{activeGuide.category}</span>
                    <span className="w-1 h-1 rounded-full bg-[var(--border-color)]" />
                    <div className="flex gap-1">
                      {activeGuide.os?.map(o => <OsBadge key={o} os={o} />)}
                    </div>
                    <span className="w-1 h-1 rounded-full bg-[var(--border-color)]" />
                    <span className="text-[9px] text-[var(--text-muted)] italic">{t('wiki.lastUpdated')} {new Date(activeGuide.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoTranslate(!autoTranslate)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-bold border ${
                    autoTranslate 
                      ? 'bg-[var(--glow-emerald)] text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30 shadow-lg shadow-[var(--glow-emerald)]' 
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                  }`}
                  title={t('wiki.autoTranslate')}
                >
                  <Languages size={14} />
                  {autoTranslate ? t('wiki.translationOn') : t('wiki.autoTranslate')}
                </button>

              {(!session && !isConfigured) ? (
                <button
                  onClick={() => signIn('google')}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all text-xs font-bold border border-[var(--border-color)]"
                >
                  <User size={14} />
                  {t('wiki.askAiLogin')}
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
                  {t('wiki.askAiConnect')}
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
                  {t('wiki.askAiUnlock')}
                </button>
              ) : (
                <button
                  onClick={openChatWindow}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[var(--glow-indigo)] border border-[var(--accent-indigo)]/50 text-[var(--accent-indigo)] shadow-lg shadow-[var(--glow-indigo)] hover:bg-[var(--accent-indigo)] hover:text-white transition-all text-xs font-bold group/ai"
                >
                  <Sparkles size={14} className="group-hover/ai:animate-pulse" />
                  {t('wiki.askAi')}
                </button>
              )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
              <div className="max-w-3xl mx-auto">
                <div className="p-6 rounded-3xl bg-[var(--glow-indigo)] border border-[var(--accent-indigo)]/10 mb-8 border-l-4 border-l-[var(--accent-indigo)] shadow-sm shadow-[var(--glow-indigo)] space-y-3">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)] italic">
                    {autoTranslate && translations[`desc_${activeGuide._id}`] 
                      ? translations[`desc_${activeGuide._id}`] 
                      : (translating[`desc_${activeGuide._id}`] ? '...' : activeGuide.description)}
                  </p>
                  {activeGuide.os && activeGuide.os.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 pt-3 border-t border-indigo-500/10">
                      <Monitor size={12} className="text-[var(--text-muted)]" />
                      <span className="text-[10px] text-[var(--text-muted)] font-medium">{t('wiki.supportedOn')}</span>
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
                      <h3 className="text-xs font-bold text-[var(--accent-indigo)] mb-3 flex items-center gap-2 uppercase tracking-widest">
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
                        <pre className="p-5 font-mono text-[13px] text-white dark:text-indigo-100 overflow-x-auto custom-scrollbar-horizontal leading-relaxed">
                          <code>{cmd.code}</code>
                        </pre>
                        {cmd.explanation && (
                          <div className="px-5 py-3 bg-white/5 border-t border-white/5 space-y-2">
                             <p className="text-[11px] text-[var(--text-muted)] italic leading-relaxed">
                                {autoTranslate && translations[`cmd_exp_${activeGuide._id}_${i}`]
                                  ? translations[`cmd_exp_${activeGuide._id}_${i}`]
                                  : (translating[`cmd_exp_${activeGuide._id}_${i}`] ? '...' : cmd.explanation)}
                             </p>
                          </div>
                        )}
                        {cmd.result && (
                          <div className="px-5 py-3 bg-emerald-500/5 border-t border-white/5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">{t('wiki.exampleOutput')}</span>
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
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{t('wiki.tags')}</span>
                    <div className="flex flex-wrap gap-2">
                      {activeGuide.tags.map(tag => (
                        <span key={tag} className="px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-indigo)] transition-colors cursor-pointer">
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
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40">
             <div className="w-24 h-24 rounded-full bg-[var(--glow-indigo)] flex items-center justify-center mb-6 border border-[var(--accent-indigo)]/20 shadow-xl">
                <Book size={48} className="text-[var(--accent-indigo)]" />
             </div>
             <h2 className="text-xl font-bold mb-2 tracking-tight text-[var(--text-primary)]">{t('wiki.emptyTitle')}</h2>
             <p className="text-sm max-w-xs mx-auto italic text-[var(--text-secondary)]">{t('wiki.emptyDesc')}</p>
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


