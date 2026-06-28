'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { StickyNote, Database, Lock, Unlock, Save, Trash2, Plus, Search, Terminal, Zap, Menu, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export default function NotepadApp() {
  const { state, apiFetch } = useApp();
  const { t } = useTranslation();
  const { dbConfig } = state;
  const isUnlocked = !!dbConfig?.uri;

  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  
  const isMobile = useIsMobile();
  const [showSidebar, setShowSidebar] = useState(true);

  // Auto-hide sidebar on mobile when a note is selected
  useEffect(() => {
    if (isMobile) {
      setShowSidebar(false);
    } else {
      setShowSidebar(true);
    }
  }, [isMobile, activeNote]);

  // Fetch notes if unlocked
  useEffect(() => {
    if (isUnlocked) {
      fetchNotes();
    }
  }, [isUnlocked]);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/notes');
      const data = await res.json();
      if (data.success) {
        setNotes(data.data);
        if (data.data.length > 0 && !activeNote) {
          setActiveNote(data.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeNote || !isUnlocked) return;
    setLoading(true);
    try {
      const method = activeNote._id ? 'PUT' : 'POST';
      const url = activeNote._id ? `/api/notes/${activeNote._id}` : '/api/notes';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeNote)
      });
      const data = await res.json();
      if (data.success) {
        fetchNotes();
        if (!activeNote._id) setActiveNote(data.data);
      }
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!isUnlocked) return;
    try {
      const res = await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setNotes(notes.filter(n => n._id !== id));
        if (activeNote?._id === id) setActiveNote(notes.find(n => n._id !== id) || null);
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const createNewNote = () => {
    const newNote = { title: 'New Note', content: '', createdAt: new Date() };
    setActiveNote(newNote);
  };

  const filteredNotes = (notes || []).filter(n => 
    (n.title || '').toLowerCase().includes((search || '').toLowerCase()) || 
    (n.content || '').toLowerCase().includes((search || '').toLowerCase())
  );

  if (!isUnlocked) {
    return (
      <div className="flex flex-col h-full bg-transparent items-center justify-center p-8 text-center">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md"
        >
          <div className="w-20 h-20 rounded-3xl bg-amber-500/10 flex items-center justify-center mx-auto mb-6 border border-amber-500/20 shadow-[0_0_30px_rgba(245,158,11,0.1)]">
            <Lock size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4 italic tracking-tight">
            {t('notepad.systemEncrypted')}
          </h2>
          <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
            {t('notepad.encryptedDesc')} 
          </p>
          <div className="p-4 rounded-xl bg-[var(--glow-indigo)] border border-[var(--accent-indigo)]/20 text-xs text-[var(--accent-indigo)] inline-flex items-center gap-2">
            <Database size={14} />
            {t('notepad.connectDbHint')}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-transparent text-[var(--text-primary)] overflow-hidden font-sans relative">
      {/* Sidebar */}
      <div className={`${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${isMobile ? 'fixed inset-y-0 left-0 z-50 bg-[var(--bg-primary)] shadow-2xl transition-transform duration-300' : 'relative transition-none'} w-72 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]/30 shrink-0`}>
        <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-indigo)]/10 flex items-center justify-center border border-[var(--accent-indigo)]/20 shadow-inner">
                 <StickyNote size={16} className="text-[var(--accent-indigo)]" />
              </div>
              <span className="font-bold text-sm tracking-tight italic">{t('notepad.title')}</span>
              <div className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-bold animate-pulse">
                {t('notepad.unlocked')}
              </div>
            </div>
            <button 
              onClick={createNewNote}
              className="p-1.5 hover:bg-[var(--bg-card-hover)] rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-indigo)] transition-all active:scale-95"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input 
              type="text"
              placeholder={t('notepad.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] rounded-lg py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:border-[var(--accent-indigo)]/50 placeholder-[var(--text-muted)]"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredNotes.map(note => (
            <button
              key={note._id || Math.random()}
              onClick={() => setActiveNote(note)}
              className={`w-full text-left p-3 rounded-xl transition-all group ${
                activeNote?._id === note._id ? 'bg-[var(--accent-indigo)]/10 border border-[var(--accent-indigo)]/20 shadow-sm' : 'hover:bg-[var(--bg-card-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-bold truncate ${activeNote?._id === note._id ? 'text-[var(--accent-indigo)]' : 'text-[var(--text-primary)]'}`}>
                  {note.title}
                </span>
                <span className="text-[9px] text-[var(--text-muted)]">
                  {new Date(note.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] line-clamp-1 group-hover:text-[var(--text-secondary)]">
                {note.content || 'Empty note...'}
              </p>
            </button>
          ))}
          {filteredNotes.length === 0 && (
            <div className="py-12 text-center">
              <Search size={32} className="mx-auto mb-2 text-[var(--text-muted)] opacity-20" />
              <p className="text-xs text-[var(--text-muted)]">{t('notepad.noNotes')}</p>
            </div>
          )}
        </div>
        
        <div className="p-3 bg-[var(--bg-tertiary)]/20 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--accent-indigo)]/20 shadow-sm">
            <Zap size={10} className="text-[var(--accent-indigo)]" />
            <span className="text-[9px] font-mono text-[var(--accent-indigo)] font-bold truncate">
              {t('notepad.directAccess')}
            </span>
          </div>
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobile && showSidebar && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowSidebar(false)} />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative min-w-0 bg-[var(--bg-primary)]/10 backdrop-blur-3xl">
        {activeNote ? (
          <>
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-[var(--border-color)] shrink-0">
              <div className="flex items-center gap-3 w-full">
                {isMobile && !showSidebar && (
                  <button onClick={() => setShowSidebar(true)} className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 mr-2">
                    <Menu size={16} />
                  </button>
                )}
                <input 
                  type="text"
                  value={activeNote.title}
                  onChange={e => setActiveNote({...activeNote, title: e.target.value})}
                  className="bg-transparent border-none text-lg font-bold text-[var(--text-primary)] focus:outline-none flex-1 italic tracking-tight"
                  placeholder={t('common.title') || "Title"}
                />
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => handleDelete(activeNote._id)}
                  disabled={!activeNote._id}
                  className="p-2 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-30 disabled:hover:text-[var(--text-muted)] transition-colors"
                >
                  <Trash2 size={18} />
                </button>
                <div className="w-px h-4 bg-[var(--border-color)]" />
                <button 
                  onClick={handleSave}
                  disabled={loading}
                  className="px-4 py-1.5 bg-[var(--accent-indigo)] hover:bg-[var(--accent-indigo-hover)] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-[var(--accent-indigo)]/20 active:scale-95 disabled:opacity-50"
                >
                  {loading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                  {t('notepad.saveBtn')}
                </button>
              </div>
            </div>
            <div className="flex-1 p-8">
              <textarea 
                value={activeNote.content}
                onChange={e => setActiveNote({...activeNote, content: e.target.value})}
                className="w-full h-full bg-transparent border-none resize-none text-[15px] leading-relaxed text-[var(--text-secondary)] focus:outline-none font-mono"
                placeholder={t('notepad.notePlaceholder')}
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40">
             {isMobile && !showSidebar && (
                <button onClick={() => setShowSidebar(true)} className="mb-4 p-3 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] transition-colors border border-[var(--border-color)]">
                  <Menu size={20} />
                </button>
              )}
             <StickyNote size={64} className="mb-4 text-[var(--text-muted)]" />
             <p className="text-sm font-medium">{t('notepad.emptyState')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
