'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, useDragControls, AnimatePresence } from 'framer-motion';
import { Bot, Send, History, Plus, ChevronLeft, Trash, Clock, MessageSquare, Languages } from 'lucide-react';
import { MessageContent } from '@/components/MessageContent';
import { useOS } from '@/context/OSContext';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { useSession, signIn } from 'next-auth/react';

// Global cache for pending translation requests to prevent duplicates
const pendingTranslations = new Map();

const LockIcon = ({ size, className }) => (
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
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export default function WikiChatWindow({ id, guide, onClose }) {
  const { t, i18n } = useTranslation();
  const { state: osState, showConfirm } = useOS();
  const { apiFetch } = useApp();
  const { data: session } = useSession();
  const controls = useDragControls();
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translations, setTranslations] = useState({}); // { [messageIdx_partIdx]: translatedText }
  const [translating, setTranslating] = useState({}); // { [messageIdx_partIdx]: boolean }
  const [lastAiUpdate, setLastAiUpdate] = useState(0);
  
  const chatEndRef = useRef(null);
  const taskbarPos = osState.taskbarPosition || 'bottom';

  // Fetch history list on mount
  useEffect(() => {
    fetchHistory();
  }, [guide._id]);

  const fetchHistory = async () => {
    try {
      const res = await apiFetch('/api/wiki/chat/history');
      const data = await res.json();
      if (data.success) {
        // Filter history for this specific guide
        const filtered = data.data.filter(h => h.guideId === guide._id);
        setHistoryList(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  // Initialize with system message if no history selected
  useEffect(() => {
    if (currentHistoryId) return;

    const lang = i18n.language;
    let greeting = `Hi! I'm your AI assistant for the "${guide.title}" guide. Ask me anything about these commands or how to adapt them for your setup.`;
    
    if (lang === 'th') {
      greeting = `สวัสดีครับ! ผมคือผู้ช่วย AI สำหรับคู่มือ "${guide.title}" ครับ สอบถามข้อมูลเพิ่มเติมเกี่ยวกับคำสั่งหรือการตั้งค่าได้เลยครับ`;
    } else if (lang === 'cn' || lang === 'zh') {
      greeting = `你好！我是 "${guide.title}" 的 AI 助手。关于这些命令或如何根据您的设置进行调整，请随时提问。`;
    }

    setMessages([{
      role: 'system',
      content: greeting
    }]);
  }, [guide, i18n.language, currentHistoryId]);

  // Auto-scroll
  useEffect(() => {
    if (chatEndRef.current && !minimized) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, minimized]);

  // Auto-save chat when messages update (debounced-ish via assistant trigger)
  const saveChat = async (updatedMessages) => {
    if (updatedMessages.length < 2) return; // Don't save if only system message
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/wiki/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyId: currentHistoryId,
          guideId: guide._id,
          title: guide.title,
          messages: updatedMessages
        })
      });
      const data = await res.json();
      if (data.success) {
        if (!currentHistoryId) {
          setCurrentHistoryId(data.data._id);
          fetchHistory(); // Refresh list to show new entry
        }
      }
    } catch (err) {
      console.error('Failed to save chat:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const loadHistory = async (histId) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/wiki/chat/history/${histId}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.data.messages);
        setCurrentHistoryId(histId);
        setShowHistory(false);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setCurrentHistoryId(null);
    setShowHistory(false);
    // Trigger useEffect re-init
  };

  const deleteHistory = async (e, histId) => {
    e.stopPropagation();
    showConfirm(
      'Delete this chat history?',
      async () => {
        try {
          await apiFetch(`/api/wiki/chat/history/${histId}`, { method: 'DELETE' });
          setHistoryList(prev => prev.filter(h => h._id !== histId));
          if (currentHistoryId === histId) startNewChat();
        } catch (err) {
          console.error('Delete failed:', err);
        }
      },
      'Delete History'
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/wiki/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg.content,
          language: i18n.language,
          guideContext: {
            title: guide.title,
            description: guide.description,
            category: guide.category,
            os: guide.os,
            commands: guide.commands
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        const assistantMsg = { role: 'assistant', content: data.message, timestamp: new Date() };
        const finalMessages = [...newMessages, assistantMsg];
        setMessages(finalMessages);
        setLastAiUpdate(Date.now());
        saveChat(finalMessages);

        // Sync AI usage across all windows immediately after use
        if (data.usage) {
          const syncChannel = new BroadcastChannel('ai_usage_sync');
          syncChannel.postMessage({ 
            type: 'sync', 
            used: data.usage.used, 
            limit: data.usage.limit 
          });
          syncChannel.close();
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error connecting to the AI service.' }]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const translateText = async (text, msgIdx, partIdx) => {
    const targetLang = i18n.language;
    if (targetLang === 'en' || !text.trim()) return;

    const key = `${msgIdx}_${partIdx}`;
    const cacheKey = `${text}_${targetLang}`;
    
    // Check if already translated
    if (translations[key]) return;
    
    // Check if translation is already in progress globally
    if (pendingTranslations.has(cacheKey)) {
      // Wait for the existing request to complete
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
    if (autoTranslate && messages.length > 0) {
      const textsToTranslate = [];
      
      messages.forEach((msg, mIdx) => {
        if (msg.role === 'assistant') {
          const parts = msg.content.split(/```/);
          parts.forEach((part, pIdx) => {
            if (pIdx % 2 === 0 && part.trim()) {
              const key = `${mIdx}_${pIdx}`;
              if (!translations[key] && !translating[key]) {
                textsToTranslate.push({ key, text: part });
              }
            }
          });
        }
      });
      
      // Send as single batch
      if (textsToTranslate.length > 0) {
        translateBatch(textsToTranslate);
      }
    }
  }, [autoTranslate, messages, i18n.language]);

  // Calculate maximized position based on taskbar
  const getMaximizedStyle = () => {
    const base = { position: 'fixed', margin: 0 };
    switch (taskbarPos) {
      case 'top':
        return { ...base, top: 48, left: 0, width: '100%', height: 'calc(100% - 48px)', borderRadius: 0 };
      case 'left':
        return { ...base, top: 0, left: 64, width: 'calc(100% - 64px)', height: '100%', borderRadius: 0 };
      case 'right':
        return { ...base, top: 0, left: 0, width: 'calc(100% - 64px)', height: '100%', borderRadius: 0 };
      case 'bottom':
      default:
        return { ...base, top: 0, left: 0, width: '100%', height: 'calc(100% - 48px)', borderRadius: 0 };
    }
  };

  const getNormalStyle = () => ({
    position: 'fixed',
    right: 20 + (id % 5) * 20,
    bottom: 56,
    top: 'auto',
    left: 'auto',
    width: showHistory ? 640 : 400,
    height: minimized ? 40 : 600,
    maxHeight: 'calc(100vh - 80px)',
    borderRadius: 12,
  });

  const windowStyle = maximized ? getMaximizedStyle() : getNormalStyle();

  return (
    <motion.div
      drag={!maximized}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        x: maximized ? 0 : undefined,
        y: maximized ? 0 : undefined
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="window-container bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col overflow-hidden z-[9999] ring-1 ring-[var(--border-color)]"
      style={{
        ...windowStyle,
        transition: 'top 0.3s ease, left 0.3s ease, right 0.3s ease, bottom 0.3s ease, width 0.3s ease, height 0.3s ease, border-radius 0.3s ease',
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Title Bar - Draggable Area */}
      <div 
        onPointerDown={(e) => {
          if (!maximized) controls.start(e);
        }}
        className={`h-10 bg-[var(--bg-tertiary)]/80 backdrop-blur-sm border-b border-[var(--border-color)] flex items-center px-3 justify-between select-none flex-shrink-0 ${maximized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex gap-1.5">
            <button onClick={() => onClose(id)} className="w-3 h-3 rounded-full bg-red-400/80 hover:bg-red-400 border border-black/5 dark:border-white/5 transition-colors" title="Close" />
            <button onClick={() => { if (maximized) setMaximized(false); setMinimized(!minimized); }} className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 border border-black/5 dark:border-white/5 transition-colors" title="Minimize" />
            <button onClick={() => { setMinimized(false); setMaximized(!maximized); }} className="w-3 h-3 rounded-full bg-green-400/80 hover:bg-green-400 border border-black/5 dark:border-white/5 transition-colors" title="Maximize" />
          </div>
        </div>
        <div className="flex-1 mx-4 overflow-hidden">
          <div className="bg-[var(--bg-primary)]/50 rounded flex items-center justify-center py-0.5 px-2 border border-[var(--border-color)]">
             <LockIcon size={10} className="text-emerald-400 mr-1.5 flex-shrink-0" />
             <span className="text-[10px] text-[var(--text-muted)] font-mono truncate">AI: {guide.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setAutoTranslate(!autoTranslate)}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${autoTranslate ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}
            title="Auto Translate"
          >
            <Languages size={14} />
            {autoTranslate && <span className="text-[10px] font-bold uppercase tracking-tighter">On</span>}
          </button>
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-indigo-500 text-white' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}
            title="Chat History"
          >
            <History size={14} />
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* History Sidebar */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ x: -200 }}
              animate={{ x: 0 }}
              exit={{ x: -200 }}
              className="absolute inset-y-0 left-0 w-64 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] z-20 flex flex-col shadow-xl"
            >
              <div className="p-3 border-b border-[var(--border-color)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Previous Chats</span>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={startNewChat}
                    className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all"
                    title="New Chat"
                  >
                    <Plus size={14} />
                  </button>
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                    title="Collapse"
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                {historyList.length === 0 ? (
                  <div className="py-8 text-center opacity-40">
                    <MessageSquare size={24} className="mx-auto mb-2" />
                    <p className="text-[10px]">No history found</p>
                  </div>
                ) : (
                  historyList.map(hist => (
                    <div 
                      key={hist._id}
                      onClick={() => loadHistory(hist._id)}
                      className={`group p-3 rounded-xl cursor-pointer transition-all border ${
                        currentHistoryId === hist._id 
                          ? 'bg-indigo-500/10 border-indigo-500/20 shadow-sm' 
                          : 'border-transparent hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-bold truncate ${currentHistoryId === hist._id ? 'text-indigo-400' : 'text-[var(--text-primary)]'}`}>
                            {hist.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 text-[9px] text-[var(--text-muted)]">
                            <Clock size={10} />
                            {new Date(hist.lastMessageAt).toLocaleDateString()}
                          </div>
                        </div>
                        <button 
                          onClick={(e) => deleteHistory(e, hist._id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/10 hover:text-red-400 transition-all text-[var(--text-muted)]"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Content */}
        {!minimized && (
          <div 
            className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden"
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
          >
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar min-h-0 overscroll-contain"
              style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
            >
              {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-indigo-500 text-white rounded-tr-none shadow-sm shadow-indigo-500/20' 
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-tl-none'
                  }`}
                  style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-[var(--border-color)]">
                      <Bot size={12} className="text-indigo-400" />
                      <span className="text-[10px] font-bold text-indigo-300">Wiki AI</span>
                    </div>
                  )}
                  {msg.role === 'system' ? (
                    <p className="whitespace-pre-wrap italic opacity-80">{msg.content}</p>
                  ) : (
                    <MessageContent 
                      content={msg.content} 
                      translations={autoTranslate && msg.role === 'assistant' ? translations : null}
                      translating={autoTranslate && msg.role === 'assistant' ? translating : null}
                      messageIdx={idx}
                    />
                  )}
                </div>
              </div>
            ))}
            {!session && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                <p className="text-[10px] text-red-400 font-bold mb-2 uppercase tracking-widest">Session Expired</p>
                <button onClick={() => signIn('google')} className="px-3 py-1 bg-red-500 text-white text-[10px] font-bold rounded-lg">Login Again</button>
              </div>
            )}
            {loading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-2xl rounded-tl-none px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 flex-shrink-0 relative">
              {isSaving && (
                <div className="absolute -top-6 right-4 flex items-center gap-1.5 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded-t-lg text-[8px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse">
                  <History size={8} /> Saving History...
                </div>
              )}
              <form onSubmit={handleSubmit} className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask for examples or details..."
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl py-2.5 pl-4 pr-10 text-xs focus:outline-none focus:border-indigo-500/50 shadow-inner"
                  style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                />
                <button 
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:hover:bg-indigo-500 transition-colors"
                >
                  <Send size={12} />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
