'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { useSession } from 'next-auth/react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { i18n } from '@/lib/i18n';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, X, Minus, Maximize2, Wifi,
  Sparkles, Copy, CornerDownLeft, ShieldAlert, Settings2, Clock, RefreshCw,
  ListChecks, Trophy, PartyPopper, Languages, Lock, Brain, ChevronDown, ChevronUp
} from 'lucide-react';
import { diff_match_patch } from 'diff-match-patch';

let Terminal, FitAddon, WebLinksAddon;

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== 'string') return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const extractUnifiedDiff = (text) => {
  const t = String(text || '');
  if (!t) return null;

  // We look for common unified diff markers.
  // Supports diff -u, git diff, and some patch outputs.
  const lines = t.split(/\r?\n/);
  const startIdx = lines.findIndex((l) =>
    l.startsWith('diff --git ') ||
    l.startsWith('--- ') ||
    l.startsWith('+++ ') ||
    l.startsWith('@@ ') ||
    l.startsWith('@@@ ')
  );
  if (startIdx === -1) return null;

  const diffLines = lines.slice(startIdx);
  const diffText = diffLines.join('\n').trim();
  if (!/^(diff --git |--- |\+\+\+ |@@ )/m.test(diffText)) return null;

  const fileMap = new Map();
  let currentFile = null;

  const ensureFile = (path) => {
    const p = String(path || '').trim();
    if (!p) return null;
    if (!fileMap.has(p)) {
      fileMap.set(p, { path: p, added: 0, removed: 0, lines: [] });
    }
    return fileMap.get(p);
  };

  for (const l of diffLines) {
    const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      currentFile = m[2];
      ensureFile(currentFile);
    }
    const fileEntry = currentFile ? ensureFile(currentFile) : null;
    if (fileEntry) fileEntry.lines.push(l);

    if (l.startsWith('+++ ') || l.startsWith('--- ')) continue;
    if (l.startsWith('+') && !l.startsWith('+++')) {
      if (fileEntry) fileEntry.added++;
    }
    if (l.startsWith('-') && !l.startsWith('---')) {
      if (fileEntry) fileEntry.removed++;
    }
  }

  const files = Array.from(fileMap.values()).slice(0, 20);
  const added = files.reduce((sum, f) => sum + (f.added || 0), 0);
  const removed = files.reduce((sum, f) => sum + (f.removed || 0), 0);

  return { diffText, files, added, removed };
};

const TERMINAL_PRESETS = {
  modern: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    theme: {
      background: '#0c0c0c',
      foreground: '#e4e4e7',
      cursor: '#6366f1',
      cursorAccent: '#0c0c0c',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
      selectionForeground: '#ffffff',
      black: '#1a1a2e', red: '#f43f5e', green: '#4ade80', yellow: '#fbbf24',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
      brightBlack: '#64748b', brightRed: '#fb7185', brightGreen: '#86efac',
      brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  retro: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 18,
    fontWeight: 'normal',
    letterSpacing: 0,
    cursorStyle: 'block',
    theme: {
      background: '#050505',
      foreground: '#18e12c',
      cursor: '#18e12c',
      cursorAccent: '#050505',
      selectionBackground: 'rgba(26, 255, 26, 0.2)',
      selectionForeground: '#ffffff',
      black: '#000000', red: '#ff3333', green: '#18e12c', yellow: '#18e12c',
      blue: '#18e12c', magenta: '#18e12c', cyan: '#18e12c', white: '#18e12c',
      brightBlack: '#333333', brightRed: '#ff6666', brightGreen: '#33ff33',
      brightYellow: '#33ff33', brightBlue: '#33ff33', brightMagenta: '#33ff33',
      brightCyan: '#33ff33', brightWhite: '#ffffff',
    }
  },
  matrix: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 16,
    theme: {
      background: '#000000',
      foreground: '#00ff41',
      cursor: '#00ff41',
      selectionBackground: 'rgba(0, 255, 65, 0.15)',
      black: '#000000', red: '#ff0000', green: '#00ff41', yellow: '#ffff00',
      blue: '#0000ff', magenta: '#ff00ff', cyan: '#00ffff', white: '#d1d1d1',
      brightBlack: '#808080', brightRed: '#ff0000', brightGreen: '#00ff41',
      brightYellow: '#ffff00', brightBlue: '#0000ff', brightMagenta: '#ff00ff',
      brightCyan: '#00ffff', brightWhite: '#ffffff',
    }
  }
};

const MAX_AUTO_STEPS = Number.POSITIVE_INFINITY;

export default function TerminalView({ connectionId, connectionName, host, color, onClose, connection, isStandalone }) {
  const { state: appState, dispatch, apiFetch } = useApp();
  const { state: osState, setSshAiHistory, setSshAiPrefs } = useOS();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user?.email;
  const { t, i18n } = useTranslation();
  const terminalRef = useRef(null);
  const termInstanceRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);
  const lastOutputAtRef = useRef(0);
  const [status, setStatus] = useState('connecting'); // connecting, connected, error, closed
  const [errorMsg, setErrorMsg] = useState(null);
  const [latency, setLatency] = useState(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [showReconnect, setShowReconnect] = useState(false);
  const idleTimedOutRef = useRef(false);

  const outputLinesRef = useRef([]);
  const outputBufferRef = useRef('');
  const aiConversationRef = useRef([]); // conversation history for multi-step context
  const lastCommandSentAtRef = useRef(0);
  const sawOutputAfterCommandRef = useRef(false);

  const inputBufferRef = useRef('');
  const recentCommandsRef = useRef([]);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiHasOpenedOnce, setAiHasOpenedOnce] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [sshMemory, setSshMemory] = useState(null);
  const [aiDone, setAiDone] = useState(false);
  const [aiDoneSummary, setAiDoneSummary] = useState(null); // { goal, steps, taskMode }
  const [aiLimitHit, setAiLimitHit] = useState(false);
  const [aiLimitGoal, setAiLimitGoal] = useState(''); // save goal for resume
  const [autoStepHistory, setAutoStepHistory] = useState([]); // track steps for UI
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [sensitiveConfirmOpen, setSensitiveConfirmOpen] = useState(false);
  const [pendingSensitiveCommand, setPendingSensitiveCommand] = useState(null);
  const [patchModalOpen, setPatchModalOpen] = useState(false);
  const [patchModalDiff, setPatchModalDiff] = useState('');
  const [lastPatchBackup, setLastPatchBackup] = useState(null); // { id: string, files: string[] } | null
  const [lastPatchResultData, setLastPatchResultData] = useState(null);
  const lastAutoAppliedDiffRef = useRef('');
  const [patchModalAutoApplied, setPatchModalAutoApplied] = useState(false);
  const [patchFileCollapsed, setPatchFileCollapsed] = useState({}); // per-file collapse in patch modal
  const [aiPanelPos, setAiPanelPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 450 : 16, y: 64 });
  const [aiPanelSize, setAiPanelSize] = useState({ width: 420, height: 520 });
  const [aiPanelDocked, setAiPanelDocked] = useState(false);
  const [aiPanelMinimized, setAiPanelMinimized] = useState(false);
  const [interactivePrompt, setInteractivePrompt] = useState(null);
  const [lastExecutedCommand, setLastExecutedCommand] = useState('');
  const [lastResultSnapshot, setLastResultSnapshot] = useState('');
  const [lastResultAt, setLastResultAt] = useState(null);
  const lastAutoExplainKeyRef = useRef('');
  const [chatHistory, setChatHistory] = useState([]); // Chat-like conversation history
  const [lastResultCollapsed, setLastResultCollapsed] = useState(true); // Default collapsed for cleaner UI
  const [aiAnswerCollapsed, setAiAnswerCollapsed] = useState(false); // Default expanded for new answers
  const [fileChangesCollapsed, setFileChangesCollapsed] = useState(true);
  const [fileChanges, setFileChanges] = useState(null); // { diffText, files, added, removed } | null
  const [selectedDiffFile, setSelectedDiffFile] = useState('');
  const [aiStreamText, setAiStreamText] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);

  const [autoMode, setAutoMode] = useState(false);
  const [autoStepsRemaining, setAutoStepsRemaining] = useState(MAX_AUTO_STEPS);
  const apiRetryCountRef = useRef(0);
  const [autoGoal, setAutoGoal] = useState('');
  const [autoCountdown, setAutoCountdown] = useState(0);
  const aiPanelContentRef = useRef(null);
  const autoRunningRef = useRef(false);
  const autoSeenRef = useRef(new Set());
  const autoVerifyKeyRef = useRef('');
  const autoLastLoopKeyRef = useRef('');
  const autoLoopRepeatRef = useRef(0);
  const autoRepeatSigRef = useRef({ key: '', count: 0 });
  const autoSameCommandRef = useRef({ cmd: '', count: 0 });
  const autoRecentCommandsRef = useRef([]);
  const autoRecentSigsRef = useRef([]);
  const autoDiagKeyRef = useRef('');
  const [aiMode, setAiMode] = useState('manual'); // manual | auto
  const [lastAiUpdate, setLastAiUpdate] = useState(0);
  const autoTimerRef = useRef(null);
  const autoEmptyRetryRef = useRef('');
  const containerRef = useRef(null);
  const autoModeRef = useRef(false);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  const suppressInteractiveUntilRef = useRef(0); // epoch ms: ignore interactive prompts until this time
  const detectedOsRef = useRef(null); // persistent OS detection across steps
  const lastGoalRef = useRef(''); // detect goal changes to reset context
  const aiModeRef = useRef('manual');
  useEffect(() => { aiModeRef.current = aiMode; }, [aiMode]);
  const bypassPasswordPauseRef = useRef(false); // skip predictive password-pause for one step after user resumes

  const [autoTranslate, setAutoTranslate] = useState(false);
  const [aiTranslations, setAiTranslations] = useState({ explain: '', warn: '', plan: '', thought: '' });
  const [translatingAiText, setTranslatingAiText] = useState({ explain: false, warn: false, plan: false, thought: false });
  const [tmuxInitialized, setTmuxInitialized] = useState(false);
  
  const sshAiPrefs = osState?.sshAiPrefs || { preferSudo: true, aiModel: 'auto' };

  // Auto Tmux Init
  useEffect(() => {
    if (sshAiPrefs?.autoTmux && status === 'connected' && !tmuxInitialized) {
      setTmuxInitialized(true);
      if (socketRef.current) {
        // Send command to setup tmux in the background (no attach)
        const tmuxCmd = `if ! command -v tmux &> /dev/null; then echo "\\n\\033[1;36m✨ [AI Auto-Setup]\\033[0m Installing tmux for background tasks..."; if command -v apt-get &> /dev/null; then sudo apt-get update && sudo apt-get install -y tmux; elif command -v yum &> /dev/null; then sudo yum install -y tmux; elif command -v dnf &> /dev/null; then sudo dnf install -y tmux; elif command -v apk &> /dev/null; then sudo apk add tmux; elif command -v pacman &> /dev/null; then sudo pacman -S --noconfirm tmux; fi; fi; if command -v tmux &> /dev/null; then tmux new -d -s ai-bg-task 2>/dev/null || true; echo "\\n\\033[1;36m✨ [AI Auto-Setup]\\033[0m Background tmux session 'ai-bg-task' is ready.\\n"; fi\n`;
        socketRef.current.emit('ssh:input', tmuxCmd);
      }
    }
  }, [sshAiPrefs?.autoTmux, status, tmuxInitialized]);

  // Handle translation when AI answer updates and autoTranslate is enabled
  useEffect(() => {
    if (autoTranslate && aiAnswer) {
      const targetLang = i18n.language;
      if (targetLang === 'en') return;

      const translateField = async (text, key) => {
        if (!text || aiTranslations[key]) return;
        setTranslatingAiText(prev => ({ ...prev, [key]: true }));
        try {
          const res = await fetch('/api/utils/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, targetLang })
          });
          const data = await res.json();
          if (data.success && data.translated) {
            setAiTranslations(prev => ({ ...prev, [key]: data.translated }));
          }
        } catch (err) {
          console.error('Translation error:', err);
        } finally {
          setTranslatingAiText(prev => ({ ...prev, [key]: false }));
        }
      };

      if (aiAnswer.explain && !aiTranslations.explain && !translatingAiText.explain) {
        translateField(aiAnswer.explain, 'explain');
      }
      if (aiAnswer.warn && !aiTranslations.warn && !translatingAiText.warn) {
        translateField(aiAnswer.warn, 'warn');
      }
      if (aiAnswer.plan && !aiTranslations.plan && !translatingAiText.plan) {
        translateField(aiAnswer.plan, 'plan');
      }
      if (aiAnswer.thought && !aiTranslations.thought && !translatingAiText.thought) {
        translateField(aiAnswer.thought, 'thought');
      }
    }
  }, [aiAnswer, autoTranslate, i18n.language]);

  // Clear translations when AI answer is completely cleared or replaced with a new thought
  useEffect(() => {
    if (!aiAnswer) {
      setAiTranslations({ explain: '', warn: '', plan: '', thought: '' });
      setTranslatingAiText({ explain: false, warn: false, plan: false, thought: false });
    }
  }, [aiAnswer]);

  // ── FETCH AI SSH MEMORY ──
  useEffect(() => {
    if (aiOpen && host && session?.user && !sshMemory) {
      apiFetch(`/api/ssh/memory?host=${encodeURIComponent(host)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.memory) {
            setSshMemory(data.memory);
          }
        })
        .catch(err => console.error('Failed to load SSH Memory:', err));
    }
  }, [aiOpen, host, session?.user, sshMemory]);

  // Ensure the panel fits gracefully on mount/resize
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;

    const performFit = () => {
      try {
        fitAddonRef.current.fit();
      } catch (e) {
        console.warn('FitAddon.fit() failed:', e);
      }
    };

    // Initial fit
    performFit();

    // Debounced fit on resize
    const resizeObserver = new ResizeObserver(() => {
      performFit();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Resize observer to scale AI panel position
  useEffect(() => {
    if (!containerRef.current) return;
    let prevWidth = 0;
    let prevHeight = 0;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      
      const { width, height } = entry.contentRect;
      
      if (prevWidth > 0 && prevHeight > 0) {
        const scaleX = width / prevWidth;
        const scaleY = height / prevHeight;
        
        if (Math.abs(width - prevWidth) > 1 || Math.abs(height - prevHeight) > 1) {
          setAiPanelPos(prev => ({
            x: prev.x * scaleX,
            y: prev.y * scaleY
          }));
        }
      }
      prevWidth = width;
      prevHeight = height;
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);


  const sshAiHistory = Array.isArray(osState?.sshAiHistory) ? osState.sshAiHistory : [];
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  // Refs for props that might change but shouldn't trigger a full restart
  const propsRef = useRef({ connectionId, connectionName, host, connection });
  useEffect(() => {
    propsRef.current = { connectionId, connectionName, host, connection };
  }, [connectionId, connectionName, host, connection]);

  const updateConnectionStatus = useCallback((newStatus) => {
    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: {
        _id: connectionId,
        status: newStatus,
        lastConnected: newStatus === 'online' ? new Date().toISOString() : undefined,
      },
    });
  }, [dispatch, connectionId]);

  const initTerminal = useCallback(async () => {
    // Dynamic imports for xterm (client-side only)
    if (!Terminal) {
      const xtermModule = await import('@xterm/xterm');
      const fitModule = await import('@xterm/addon-fit');
      const webLinksModule = await import('@xterm/addon-web-links');
      Terminal = xtermModule.Terminal;
      FitAddon = fitModule.FitAddon;
      WebLinksAddon = webLinksModule.WebLinksAddon;
      await import('@xterm/xterm/css/xterm.css');
    }

    if (!terminalRef.current || termInstanceRef.current) return;

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    fitAddonRef.current = fitAddon;

    const settings = osState?.terminalSettings || {};
    const preset = TERMINAL_PRESETS[settings.activePreset || 'modern'] || TERMINAL_PRESETS.modern;
    const isRetro = settings.activePreset === 'retro';
    const bgOpacity = settings.backgroundOpacity ?? 1;
    const baseBg = settings.theme?.background || preset.theme?.background || '#0c0c0c';

    const term = new Terminal({
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      cursorStyle: settings.cursorStyle || preset.cursorStyle || 'bar',
      fontSize: settings.fontSize || preset.fontSize || 14,
      fontFamily: settings.fontFamily || preset.fontFamily || "'JetBrains Mono', monospace",
      fontWeight: settings.fontWeight || preset.fontWeight || 'normal',
      letterSpacing: settings.letterSpacing || preset.letterSpacing || 0,
      theme: {
        ...(preset.theme || {}),
        ...(settings.theme || {}),
        background: hexToRgba(baseBg, bgOpacity)
      },
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    // Initial fit attempt IMMEDIATELY, before socket connect,
    // to guarantee the backend PTY gets the exact client size on shell boot!
    // This prevents bash/nano from missing SIGWINCH if resized right after boot.
    try { 
      // Need a tiny non-blocking tick to let DOM paint the terminal div if it was just unhidden
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch(e) {}
      });
      // But also try synchronously for instant dimension mapping
      fitAddon.fit(); 
    } catch (e) {}

    termInstanceRef.current = term;

    const stripAnsi = (s) => String(s || '')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      // Treat carriage return as a line boundary for our log buffer.
      // This prevents progress bars (dnf/npm) from corrupting prompt detection.
      .replace(/\r/g, '\n');

    const appendOutput = (chunk) => {
      const clean = stripAnsi(chunk);
      if (!clean) return;
      outputBufferRef.current += clean;
      const parts = outputBufferRef.current.split('\n');
      outputBufferRef.current = parts.pop() || '';
      if (parts.length) {
        outputLinesRef.current = outputLinesRef.current.concat(parts);
        if (outputLinesRef.current.length > 40) {
          outputLinesRef.current = outputLinesRef.current.slice(-40);
        }
      }
    };

    term.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m');
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[1;37m${t('terminal.connectingTo')} \x1b[1;33m${propsRef.current.connectionName}\x1b[0m`);
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[90m${propsRef.current.host}\x1b[0m`);
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    const socket = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      query: {
        dbUri: appState.dbConfig?.uri || ''
      }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('ssh:connect', { 
        connectionId: propsRef.current.connectionId, 
        connection: propsRef.current.connection,
        cols: term.cols,
        rows: term.rows
      });
    });

    socket.on('heartbeat:pong', (sentTimestamp) => {
      const now = Date.now();
      setLatency(now - sentTimestamp);
    });

    socket.on('ssh:connected', () => {
      setStatus('connected');
      updateConnectionStatus('online'); // Update global state
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      term.writeln(`\x1b[1;32m✓ ${t('terminal.connectedSuccess')}\x1b[0m\n`);
      appendOutput(`✓ ${t('terminal.connectedSuccess')}\n`);
      term.writeln('\r');
      
      // Secondary dimension sync to ensure precision after handshake
      setTimeout(() => {
        try {
          fitAddon.fit();
          if (socket.connected) {
             socket.emit('ssh:resize', { cols: term.cols, rows: term.rows });
          }
        } catch (e) {}
      }, 100);

      term.focus(); // Focus terminal on connect
    });

    socket.on('ssh:data', (data) => {
      term.write(data);
      appendOutput(data);
      lastOutputAtRef.current = Date.now();
      if (lastCommandSentAtRef.current > 0) {
        sawOutputAfterCommandRef.current = true;
      }
    });

    const resetAiOnDisconnect = () => {
      setAutoMode(false);
      setAutoStepsRemaining(0);
      setExecuteConfirmOpen(false);
      setAiError(null);
      setAiAnswer(null);
      setInteractivePrompt(null);
      setPatchModalOpen(false);
      setPatchModalDiff('');
      setPatchModalAutoApplied(false);
      setLastPatchBackup(null);
      setTmuxInitialized(false);
      // Close AI panel and related panels when SSH disconnects
      setAiOpen(false);
      setAiSettingsOpen(false);
      setAiHistoryOpen(false);
      autoRunningRef.current = false;
      lastCommandSentAtRef.current = 0;
      sawOutputAfterCommandRef.current = false;
    };

    socket.on('ssh:error', (data) => {
      setStatus('error');
      setErrorMsg(data.message);
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      resetAiOnDisconnect();
      // updateConnectionStatus('offline'); // Optional, or keep as error
      term.writeln(`\n\x1b[1;31m✗ ${t('terminal.errorPrefix')} ${data.message}\x1b[0m`);
      appendOutput(`\n✗ ${t('terminal.errorPrefix')} ${data.message}\n`);
    });

    socket.on('ssh:closed', () => {
      setStatus('closed');
      updateConnectionStatus('offline'); // Update global state
      idleTimedOutRef.current = false;
      setShowReconnect(false);
      resetAiOnDisconnect();
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')}\x1b[0m`);
      appendOutput(`\n⚠ ${t('terminal.connectionClosed')}\n`);
    });

    socket.on('ssh:idle_timeout', () => {
      setStatus('closed');
      updateConnectionStatus('offline');
      idleTimedOutRef.current = true;
      setShowReconnect(true);
      resetAiOnDisconnect();
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')} (Idle timeout: 2m)\x1b[0m`);
      appendOutput(`\n⚠ ${t('terminal.connectionClosed')} (Idle timeout: 2m)\n`);
    });

    socket.on('disconnect', () => {
      if (status !== 'closed') {
        setStatus('closed');
        updateConnectionStatus('offline');
        if (!idleTimedOutRef.current) setShowReconnect(false);
        resetAiOnDisconnect();
        term.writeln(`\n\x1b[1;31m✗ ${t('terminal.socketDisconnected')}\x1b[0m`);
        appendOutput(`\n✗ ${t('terminal.socketDisconnected')}\n`);
      }
    });

    term.onData((data) => {
      if (socket.connected && !autoModeRef.current) {
        socket.emit('ssh:input', data);
      }

      // Capture user commands (best-effort) for AI context
      // xterm sends \r on Enter; also handle \n.
      const chunk = String(data || '');
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          const line = inputBufferRef.current;
          inputBufferRef.current = '';
          const cleaned = String(line || '').trim();
          if (cleaned) {
            recentCommandsRef.current = [...recentCommandsRef.current, cleaned].slice(-25);
          }
        } else if (ch === '\u007f') {
          // backspace
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        } else if (ch >= ' ') {
          inputBufferRef.current += ch;
        }
      }
    });

    term.onResize(({ cols, rows }) => {
      if (socket.connected) {
        socket.emit('ssh:resize', { cols, rows });
      }
    });
    
    // Improved resize handling with precision fitting
    const performFit = () => {
      if (!fitAddonRef.current || !terminalRef.current) return;
      try {
        fitAddonRef.current.fit();
      } catch (e) {
        console.warn('Terminal fit failed:', e);
      }
    };

    const handleResize = () => performFit();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      // Small delay helps flexbox layouts finish settling
      setTimeout(performFit, 0);
      setTimeout(performFit, 50);
    });

    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [connectionId, appState.dbConfig?.uri, updateConnectionStatus]);

  // Handle Dynamic Theme Updates for XTerm
  useEffect(() => {
    if (!termInstanceRef.current) return;
    
    const settings = osState?.terminalSettings || {};
    const preset = TERMINAL_PRESETS[settings.activePreset || 'modern'] || TERMINAL_PRESETS.modern;
    const isRetro = settings.activePreset === 'retro';
    const bgOpacity = settings.backgroundOpacity ?? 1;
    const baseBg = settings.theme?.background || preset.theme?.background || '#0c0c0c';
    
    termInstanceRef.current.options = {
      fontFamily: settings.fontFamily || preset.fontFamily,
      fontSize: settings.fontSize || preset.fontSize,
      fontWeight: settings.fontWeight || preset.fontWeight || 'normal',
      letterSpacing: settings.letterSpacing || preset.letterSpacing || 0,
      cursorStyle: settings.cursorStyle || preset.cursorStyle || 'bar',
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      theme: {
        ...(preset.theme || {}),
        ...(settings.theme || {}),
        background: hexToRgba(baseBg, bgOpacity)
      }
    };

    // Force redraw and re-measure after fonts are ready
    const triggerRefresh = () => {
      try { 
        fitAddonRef.current?.fit(); 
        termInstanceRef.current?.refresh(0, termInstanceRef.current.rows - 1);
      } catch (e) {}
    };

    if (document.fonts) {
      document.fonts.ready.then(triggerRefresh);
    }
    
    setTimeout(triggerRefresh, 200);
    setTimeout(triggerRefresh, 1000); // Heavy fallback for lazy loading
  }, [osState?.terminalSettings, t]);

  const redactSecrets = (text) => {
    let t = String(text || '');
    // Common secret patterns
    t = t.replace(/(authorization:\s*bearer\s+)([^\s]+)/gi, '$1[REDACTED]');
    t = t.replace(/(api[_-]?key\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(token\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(password\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    t = t.replace(/(secret\s*[=:]\s*)([^\s"']+)/gi, '$1[REDACTED]');
    // .env style assignments (best-effort)
    t = t.replace(/^(\s*[A-Z0-9_]+\s*=\s*)(.+)$/gmi, (m, k, v) => {
      if (/(KEY|TOKEN|SECRET|PASS|PASSWORD|PRIVATE|AUTH|BEARER)/i.test(String(k || ''))) {
        return `${k}[REDACTED]`;
      }
      return m;
    });
    return t;
  };

  // Detect if a command is sensitive/dangerous and requires user confirmation
  const isSensitiveCommand = (command) => {
    const cmd = String(command || '').toLowerCase().trim();
    if (!cmd) return false;

    // File overwrite / replace patterns (high risk: can wipe existing code)
    // We only treat these as sensitive when AI is in code-editor mode.
    const overwritePatterns = [
      /\bcat\s+<<\s*'eof'\s*>\s*[^\s]+/i,  // cat <<'EOF' > file
      /\bcat\s+<<\s*eof\s*>\s*[^\s]+/i,    // cat <<EOF > file
      /\btee\s+[^\s]+\s*>\s*\/dev\/null/i, // tee file > /dev/null (used with sudo)
      /\bprintf\b[\s\S]*>\s*[^\s]+/i,       // printf ... > file
      /\becho\b[\s\S]*>\s*[^\s]+/i,         // echo ... > file
    ];
    if (sshAiPrefs?.aiTask === 'code' && overwritePatterns.some(p => p.test(cmd))) {
      return true;
    }

    // Destructive patterns
    const destructivePatterns = [
      /rm\s+-[rf]+/i,           // rm -rf, rm -r -f
      /rm\s+.*\*/i,             // rm with wildcards
      /mkfs\./i,                // Format filesystem
      /dd\s+if=/i,              // dd with input file
      /fdisk/i,                 // Partition manipulation
      /parted/i,                // Partition editing
      /userdel/i,               // Delete user
      /groupdel/i,              // Delete group
      /passwd\s+/i,             // Change password
      /iptables.*-F/i,          // Flush firewall rules
      /ufw.*disable/i,          // Disable firewall
      /sshd.*stop/i,            // Stop SSH service
      /systemctl.*stop.*ssh/i,  // Stop SSH
      /chown\s+-R/i,            // Recursive chown
      /chmod\s+-R/i,            // Recursive chmod
      /mkfs\s+/i,               // Make filesystem
      /dd\s+.*of=\/dev\/sd/i,   // Write to disk device
      /echo.*>.*\/etc\/passwd/i, // Modify passwd file
      /echo.*>.*\/etc\/shadow/i, // Modify shadow file
    ];

    // System file modifications
    const systemFilePatterns = [
      /\/etc\/sshd?(_config)?/i,
      /\/etc\/passwd/i,
      /\/etc\/shadow/i,
      /\/etc\/sudoers/i,
      /\/etc\/hosts/i,
      /\/etc\/fstab/i,
      /\/boot\//i,
      /\/dev\/sd[a-z]/i,
    ];

    return destructivePatterns.some(p => p.test(cmd)) ||
           systemFilePatterns.some(p => p.test(cmd));
  };

  const parseAiAnswer = (raw, metadata) => {
    const decodeEntities = (str) => {
      const entities = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&#x2F;': '/', '&#x60;': '`', '&#x3D;': '='
      };
      return String(str || '').replace(/&[#\w\d]+;/g, (m) => entities[m] || m);
    };

    const getTag = (tag) => {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'gi');
      let m;
      let lastMatch = '';
      while ((m = regex.exec(String(raw || ''))) !== null) {
        lastMatch = m[1].trim();
      }
      return lastMatch;
    };

    const cleanDiffContent = (text) => {
      let d = String(text || '').trim();
      // If there's garbage before the first diff header, strip it
      // Allow leading whitespace in the header check
      const firstHeader = d.search(/(^\s*--- |^\s*\+\+\+ |^\s*@@ |^\s*diff )/m);
      if (firstHeader > 0) {
        d = d.slice(firstHeader);
      }
      return d;
    };

    let command = getTag('command');
    if (command.includes('&')) command = decodeEntities(command);
    
    const explain = getTag('explain');
    const dangerRaw = getTag('danger');
    const warn = getTag('warn');
    const doneRaw = getTag('done');
    let diff = getTag('diff');
    if (diff) {
      diff = cleanDiffContent(diff);
      if (diff.includes('&')) diff = decodeEntities(diff);
    }
    const plan = getTag('plan');
    const thought = getTag('thought');
    const interactive = getTag('interactive');
    const stepRaw = getTag('step');
    const danger = String(dangerRaw || '').trim().toLowerCase() === 'true';
    const done = String(doneRaw || '').trim().toLowerCase() === 'true';
    const step = parseInt(stepRaw) || 1;
    return { command, diff, explain, danger, warn, done, interactive, plan, thought, step, usedModel: metadata?.usedModel, raw: String(raw || '').trim() };
  };

  const isValidUnifiedDiff = (diffText) => {
    const d = String(diffText || '').replace(/\r\n/g, '\n').trim();
    if (!d) return false;
    
    const lines = d.split('\n');
    let foundMinus = false;
    let foundPlus = false;
    let foundHunk = false;
    let foundChange = false;
    let inHunk = false;
    
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];          // keep original (leading space = context line!)
      const trimmed = raw.trim();     // only for header detection
      if (trimmed.startsWith('--- ')) {
        foundMinus = true;
        inHunk = false;
        continue;
      }
      if (trimmed.startsWith('+++ ')) {
        foundPlus = true;
        inHunk = false;
        continue;
      }
      if (trimmed.startsWith('@@ ')) {
        foundHunk = true;
        inHunk = true;
        continue;
      }
      if (inHunk) {
        if (trimmed.startsWith('diff ') || trimmed.startsWith('index ')) {
          inHunk = false;
          continue;
        }
        if (raw.startsWith('+') || raw.startsWith('-')) {
          foundChange = true;
        }
        // Inside a hunk, every line MUST start with ' ', '+', '-', or '\' (no newline marker)
        // Use RAW line (not trimmed) so context lines keep their leading space
        if (raw.length > 0 && !/^[ \+\-\\]/.test(raw)) {
          // Don't reject — DMP can handle slightly malformed diffs via fuzzy matching
          // Just skip validation for this line
        }
      }
    }
    // Only require hunk header + at least one --- or +++ header + at least one change
    return foundHunk && (foundMinus || foundPlus) && foundChange;
  };

  const applyUnifiedWithDMP = (originalText, unifiedDiff) => {
    try {
      const dmp = new diff_match_patch();
      const patches = dmp.patch_fromText(unifiedDiff);
      const [newText, results] = dmp.patch_apply(patches, originalText);
      const success = results.every(r => r === true);
      return { success, newText, results };
    } catch (e) {
      console.error('DMP Patch Error:', e);
      return { success: false, error: e.message };
    }
  };

  const repairDiffWithDMP = (diffText) => {
    const d = String(diffText || '').replace(/\r\n/g, '\n');
    const lines = d.split('\n');
    const fixed = [];
    let inHunk = false;
    for (let line of lines) {
      if (line.startsWith('@@ ')) {
        inHunk = true;
        fixed.push(line);
        continue;
      }
      if (inHunk) {
        if (/^--- |^\+\+\+ |^diff |^index /.test(line)) {
          inHunk = false;
          fixed.push(line);
          continue;
        }
        if (/^[ \+\-]/.test(line)) {
          fixed.push(line);
        } else if (line.trim() === '') {
          fixed.push(' ');
        } else {
          fixed.push(' ' + line);
        }
      } else {
        fixed.push(line);
      }
    }
    return fixed.join('\n');
  };

  const rewriteDiffPathsForPatch = (diffText) => {
    // 🛡️ Pre-sanitize: Fix minor malformations using DMP-inspired repair
    const sanitized = repairDiffWithDMP(diffText);
    let d = String(sanitized || '').replace(/\r\n/g, '\n');
    if (!d.trim()) return '';

    // 🔧 Tilde Fix: AI sometimes writes /~/ which is invalid (e.g. "/~/.zeroclaw/foo" → "~/.zeroclaw/foo")
    d = d.split('\n').map(line => {
      if ((line.startsWith('--- /~') || line.startsWith('+++ /~'))) {
        return line.replace(/^((?:--- |\+\+\+ ))\/~/, '$1~');
      }
      return line;
    }).join('\n');

    const lines = d.split('\n');
    const processedLines = [];
    let currentHunk = null; // { headerIdx: number, oldStart: number, oldLines: number, newStart: number, newLines: number, actualOld: number, actualNew: number }

    const finalizeHunk = () => {
      if (!currentHunk) return;
      const { headerIdx, oldStart, actualOld, newStart, actualNew } = currentHunk;
      // Update the @@ line with actual counts
      processedLines[headerIdx] = `@@ -${oldStart},${actualOld} +${newStart},${actualNew} @@`;
      currentHunk = null;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // 🚨 AUTO-FIX: Split merged headers
      if (trimmed.startsWith('--- ') && trimmed.includes(' +++ ')) {
        const parts = line.split(' +++ ');
        const minusLine = parts[0];
        const plusLine = '+++ ' + parts[1];
        lines.splice(i + 1, 0, plusLine);
        line = minusLine;
        trimmed = line.trim();
      }

      // Handle File Headers
      if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('diff ') || trimmed.startsWith('index ')) {
        finalizeHunk();
        if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ')) {
          const prefix = trimmed.slice(0, 4);
          let rest = trimmed.slice(4);
          const parts = rest.split('\t');
          let p = (parts[0] || '').trim();
          
          if (p.startsWith('a/')) p = p.slice(2);
          if (p.startsWith('b/')) p = p.slice(2);
          
          // Smart Path Resolution: 
          const isBare = !p.includes('/') || (p.startsWith('/') && p.lastIndexOf('/') === 0);
          if (isBare) {
            const fileName = p.split('/').pop();
            let absoluteMatch = null;
            
            // 1. Try to resolve relative to CWD first (Priority)
            if (sshMemory?.cwd) {
              const cwd = sshMemory.cwd.endsWith('/') ? sshMemory.cwd.slice(0, -1) : sshMemory.cwd;
              absoluteMatch = cwd + '/' + fileName;
            }
            
            // 2. Fallback to memory keyPaths if CWD didn't help (or file needs system-wide matching)
            if (!absoluteMatch && sshMemory?.keyPaths?.length) {
              absoluteMatch = sshMemory.keyPaths.find(kp => kp.endsWith('/' + fileName) || kp === fileName);
            }
            
            if (absoluteMatch) {
              p = absoluteMatch;
            }
          }
          
          if (p && !p.startsWith('/') && !p.startsWith('~') && p.includes('/')) {
            p = '/' + p;
          }
          const suffix = parts.length > 1 ? '\t' + parts.slice(1).join('\t') : '';
          processedLines.push(`${prefix}${p}${suffix}`);
        } else {
          processedLines.push(trimmed);
        }
        continue;
      }

      // Handle Hunk Headers
      if (trimmed.startsWith('@@ ')) {
        finalizeHunk();
        const headerMatch = trimmed.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (headerMatch) {
          const oldStart = parseInt(headerMatch[1]);
          const newStart = parseInt(headerMatch[3]);
          currentHunk = { headerIdx: processedLines.length, oldStart, actualOld: 0, newStart, actualNew: 0 };
          processedLines.push(trimmed);
        } else {
          processedLines.push(trimmed);
        }
        continue;
      }

      // Handle Hunk Content
      if (currentHunk) {
        // AI sometimes sends blank lines for context, but standard patch requires a ' '
        if (line.startsWith(' ') || trimmed === '') {
          // 🛡️ SMART HEAL: If the line is totally empty but the AI meant it as context, 
          // we only count it if it's not a placeholder at the start/end of a hunk.
          currentHunk.actualOld++;
          currentHunk.actualNew++;
          processedLines.push(line.startsWith(' ') ? line : ' ' + line);
        } else if (line.startsWith('-')) {
          currentHunk.actualOld++;
          processedLines.push(line);
        } else if (line.startsWith('+')) {
          currentHunk.actualNew++;
          processedLines.push(line);
        } else {
          finalizeHunk();
          processedLines.push(line);
        }
      } else {
        // Outside hunk, just push
        processedLines.push(line);
      }
    }

    // Finalize the last hunk if any
    finalizeHunk();
    
    // 🛡️ EMERGENCY REPAIR: If the AI produced an invalid "empty" hunk like @@ -0,0 +0,0 @@
    // we convert it to a valid "remove everything" hunk if possible, or just skip it.
    const finalLines = processedLines.filter(l => {
      const trim = l.trim();
      if (trim.startsWith('@@') && (l.includes('-0,0 +0,0') || l.includes('-1,0 +1,0'))) return false;
      return true;
    });

    // Ensure the diff is actually valid and has hunks
    if (!finalLines.some(l => l.trim().startsWith('@@ '))) return '';

    return finalLines.join('\n').trimEnd() + '\n';
  };

  // ── Apply Patch via SFTP + diff-match-patch (server-side) ──────────────────
  const applyPatchViaSftp = (diffText, backupId) => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Socket not connected' });
        return;
      }

      const d = rewriteDiffPathsForPatch(diffText);
      if (!d) {
        resolve({ success: false, error: 'Invalid diff (empty after path rewrite)' });
        return;
      }
      if (!isValidUnifiedDiff(d)) {
        resolve({ success: false, error: 'Invalid unified diff format' });
        return;
      }

      // Extract files for rollback tracking
      const files = extractFilesFromUnifiedDiff(d);

      // Set up one-time result listener
      const onResult = (result) => {
        socketRef.current?.off('sftp:patchResult', onResult);
        clearTimeout(timeout);
        resolve({ ...result, files });
      };

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        socketRef.current?.off('sftp:patchResult', onResult);
        resolve({ success: false, error: 'Patch operation timed out (30s)', files });
      }, 30000);

      socketRef.current.on('sftp:patchResult', onResult);
      socketRef.current.emit('sftp:applyPatch', { diffText: d, backupId: backupId || null });
    });
  };

  const extractFilesFromUnifiedDiff = (diffText) => {
    const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
    const files = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('+++ ')) continue;
      let p = trimmed.slice(4).trim();
      if (!p || p === '/dev/null') continue;
      p = p.split('\t')[0].trim();
      if (p.startsWith('b/')) p = p.slice(2);
      if (p.startsWith('a/')) p = p.slice(2);
      if (p.startsWith('/') || p.startsWith('~')) {
        // Keep as is
      } else {
        if (!p.startsWith('~')) p = '/' + p;
      }
      if (!files.includes(p)) files.push(p);
    }
    return files;
  };


  const buildPatchRollbackCommand = (backup) => {
    const id = backup?.id;
    const files = Array.isArray(backup?.files) ? backup.files : [];
    if (!id || files.length === 0) return '';
    const list = files.map(f => `'${String(f).replace(/'/g, `'\\''`)}'`).join(' ');
    return `for f in ${list}; do if [ -f "$f.bak.${id}" ]; then mv "$f.bak.${id}" "$f"; fi; done`;
  };

  const openPatchModal = (diffText) => {
    setPatchModalDiff(diffText || '');
    setPatchModalAutoApplied(false);
    setPatchFileCollapsed({}); // reset so all files start expanded
    setPatchModalOpen(true);
  };

  useEffect(() => {
    if (!aiAnswer?.diff) return;
    if (sshAiPrefs?.aiTask !== 'code') return;
    if (sshAiPrefs?.enforcePatch === false) return;
    if (!sshAiPrefs?.autoApplyPatch) return;
    
    // ✋ If we are in Auto Mode (running loop), let 'runAutoStep' handle the execution 
    // to avoid double-sending the command. This effect is for Manual Mode auto-apply.
    if (autoModeRef.current) return;

    const d = String(aiAnswer.diff || '').trim();
    if (!d) return;
    if (lastAutoAppliedDiffRef.current === d) return;
    lastAutoAppliedDiffRef.current = d;

    const backupId = `${Date.now().toString(36)}`;
    
    setPatchModalDiff(d);
    setPatchModalAutoApplied(true);
    setPatchFileCollapsed({}); 
    setLastPatchResultData(null); // Clear for new diff
    setPatchModalOpen(true);

    // Apply via SFTP + diff-match-patch
    applyPatchViaSftp(d, backupId).then((result) => {
      const files = result.files || [];
      setLastPatchBackup({ id: backupId, files });
      setLastPatchResultData(result.results || null);
      if (result.success) {
        console.log('[Patch] Auto-applied successfully:', result.summary);
      } else {
        console.warn('[Patch] Auto-apply failed:', result.error || result.summary);
        setAiError(`Patch failed: ${result.error || result.summary || 'Unknown error'}`);
      }
    });

    // Auto-close modal after 4 seconds to keep UI clean during auto operations
    setTimeout(() => {
      setPatchModalOpen(prev => {
        if (prev && lastAutoAppliedDiffRef.current === d) return false;
        return prev;
      });
    }, 4000);
  }, [aiAnswer, sshAiPrefs?.aiTask, sshAiPrefs?.enforcePatch, sshAiPrefs?.autoApplyPatch]);

  const renderDiffLines = (diffText) => {
    const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      const isAdd = trimmed.startsWith('+') && !trimmed.startsWith('+++');
      const isDel = trimmed.startsWith('-') && !trimmed.startsWith('---');
      const isHunk = trimmed.startsWith('@@');
      const isFileHdr = trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('diff ') || trimmed.startsWith('index ');

      const sectionStart = trimmed.startsWith('diff ') || trimmed.startsWith('--- ');

      let cls = 'whitespace-pre px-3 py-[2px] text-[11px] font-mono';
      if (isAdd) cls += ' bg-emerald-500/15 text-emerald-200';
      else if (isDel) cls += ' bg-red-500/15 text-red-200';
      else if (isHunk) cls += ' bg-indigo-500/15 text-indigo-200 font-semibold';
      else if (isFileHdr) cls += ' bg-white/5 text-[var(--text-primary)] font-semibold';
      else cls += ' text-[var(--text-secondary)]';
      if (sectionStart && idx !== 0) cls += ' mt-2 border-t border-white/10';

      return (
        <div key={idx} className={cls}>
          {line || ' '}
        </div>
      );
    });
  };

  // Split a unified diff into per-file sections with VS Code-style colored view
  // Green = added, Red = removed, normal = context (unchanged). Per-file rollback supported.
  const renderDiffByFile = (diffText, collapsedState, setCollapsedState, backup, onRollbackFile) => {
    const rawLines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');

    // ── Parse into file sections ──────────────────────────────────────────────
    const fileSections = [];
    let current = null;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('diff ')) {
        if (current) fileSections.push(current);
        current = { lines: [line], filename: '' };
      } else if (trimmed.startsWith('--- ') && !trimmed.startsWith('--- a/')) {
        const nextLine = (rawLines[i + 1] || '').trim();
        if (nextLine.startsWith('+++ ')) {
          if (current) fileSections.push(current);
          const rawName = trimmed.replace(/^--- /, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
          current = { lines: [line], filename: rawName };
        } else if (current) {
          current.lines.push(line);
        }
      } else if (trimmed.startsWith('--- a/')) {
        if (current === null) {
          current = { lines: [line], filename: trimmed.replace(/^--- a\//, '').trim() };
        } else {
          current.filename = trimmed.replace(/^--- a\//, '').trim();
          current.lines.push(line);
        }
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) fileSections.push(current);

    // ── Fallback: no file boundary found ─────────────────────────────────────
    if (fileSections.length === 0) {
      return (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <div className="overflow-y-auto max-h-[420px] custom-scrollbar bg-black/40">
            {rawLines.map((line, idx) => {
              const isAdd = line.startsWith('+') && !line.startsWith('+++');
              const isDel = line.startsWith('-') && !line.startsWith('---');
              const isHunk = line.startsWith('@@');
              let cls = 'whitespace-pre-wrap break-all px-4 py-[1px] text-[11px] font-mono flex';
              if (isAdd) cls += ' bg-emerald-500/10 text-emerald-300';
              else if (isDel) cls += ' bg-red-500/10 text-red-300';
              else if (isHunk) cls += ' bg-indigo-500/20 text-indigo-300 font-semibold';
              else cls += ' text-[var(--text-secondary)]';
              return (
                <div key={idx} className={cls}>
                  <span className="w-5 shrink-0 opacity-30 text-right mr-3 select-none">
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  <span>{line.slice(isAdd || isDel ? 1 : 0) || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Render per-file cards ─────────────────────────────────────────────────
    return fileSections.map((section, fi) => {
      const key = section.filename || String(fi);
      const isCollapsed = collapsedState?.[key] ?? false;

      // Count changes
      let added = 0, removed = 0;
      for (const ln of section.lines) {
        if (ln.startsWith('+') && !ln.startsWith('+++')) added++;
        if (ln.startsWith('-') && !ln.startsWith('---')) removed++;
      }

      const displayName = section.filename
        ? section.filename.split('/').pop() || section.filename
        : `File ${fi + 1}`;
      // Paths in the diff are relative to / (for patch -d /), so prepend / for display
      const fullPath = section.filename
        ? ((section.filename.startsWith('/') || section.filename.startsWith('~')) ? section.filename : '/' + section.filename)
        : '';

      // Can we roll back this specific file?
      const fileBackupExists = backup?.id && Array.isArray(backup?.files) &&
        backup.files.some(f => {
          const norm = (s) => s.replace(/^\/+/, '');
          return norm(f).endsWith(norm(fullPath)) || norm(fullPath).endsWith(norm(f));
        });

      // Build a full-view display list:
      // - Between hunks, gap lines are shown as plain grey (original/unchanged)
      // - Changed lines: green (+) or red (-)
      // - Context lines within hunks: normal color
      const displayLines = [];
      let newLineNo = 1;
      let prevHunkEndNewLine = 0; // tracks where last hunk ended in the new file

      // First pass: collect all hunks with their line ranges
      const hunks = [];
      let curHunk = null;
      for (const ln of section.lines) {
        const isFileMeta = ln.startsWith('---') || ln.startsWith('+++') || ln.startsWith('diff ') || ln.startsWith('index ');
        if (isFileMeta) continue;
        const hunkMatch = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
          if (curHunk) hunks.push(curHunk);
          curHunk = {
            oldStart: parseInt(hunkMatch[1], 10),
            newStart: parseInt(hunkMatch[3], 10),
            lines: [],
          };
          continue;
        }
        if (curHunk) curHunk.lines.push(ln);
      }
      if (curHunk) hunks.push(curHunk);

      // Second pass: render with gap placeholders
      let currentNewLine = 1;
      for (let hi = 0; hi < hunks.length; hi++) {
        const hunk = hunks[hi];
        const gapStart = currentNewLine;
        const gapEnd = hunk.newStart - 1;

        // Show gap lines as folded "N lines unchanged"
        if (gapEnd >= gapStart) {
          const gapCount = gapEnd - gapStart + 1;
          displayLines.push({ type: 'gap', count: gapCount, startLine: gapStart });
          currentNewLine = gapEnd + 1;
        }

        // Show hunk lines
        let lineNo = hunk.newStart;
        let oldLineNo = hunk.oldStart;
        for (const ln of hunk.lines) {
          const isAdd = ln.startsWith('+') && !ln.startsWith('+++');
          const isDel = ln.startsWith('-') && !ln.startsWith('---');
          if (isAdd) {
            displayLines.push({ type: 'add', text: ln.slice(1), lineNo });
            lineNo++;
          } else if (isDel) {
            displayLines.push({ type: 'del', text: ln.slice(1), lineNo: null });
            oldLineNo++;
          } else {
            displayLines.push({ type: 'ctx', text: ln.slice(1) || '', lineNo });
            lineNo++;
            oldLineNo++;
          }
        }
        currentNewLine = lineNo;
      }

      return (
        <div key={fi} className="rounded-xl border border-white/10 overflow-hidden mb-3 last:mb-0 shadow-sm">
          {/* ── File header ── */}
          <div className="flex items-center bg-[#1a1a2e] border-b border-white/10">
            <button
              type="button"
              onClick={() => setCollapsedState(prev => ({ ...prev, [key]: !isCollapsed }))}
              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                {isCollapsed
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </span>
              <span className="text-[12px] font-bold font-mono text-white truncate">{displayName}</span>
              {fullPath && fullPath !== displayName && (
                <span className="text-[10px] font-mono opacity-30 text-[var(--text-muted)] truncate hidden sm:inline ml-1">{fullPath}</span>
              )}
            </button>

            {/* Stats + per-file rollback */}
            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
              <span className="text-[11px] font-mono font-bold text-emerald-400">+{added}</span>
              <span className="text-[10px] opacity-30 font-mono">/</span>
              <span className="text-[11px] font-mono font-bold text-red-400">-{removed}</span>
              {fileBackupExists && onRollbackFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRollbackFile(fullPath, backup.id); }}
                  className="ml-2 px-2 py-1 rounded text-[10px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-all"
                  title={`Rollback ${displayName}`}
                >
                  ↩ Rollback
                </button>
              )}
            </div>
          </div>

          {/* ── Diff content ── */}
          {!isCollapsed && (
            <div className="overflow-y-auto max-h-[500px] custom-scrollbar font-mono text-[11px] bg-[#0d0d1a]">
              {displayLines.map((entry, li) => {
                if (entry.type === 'gap') {
                  return (
                    <div key={li} className="flex items-center gap-2 px-3 py-[3px] bg-[#111122]/60 border-y border-white/[0.04] text-[var(--text-muted)] opacity-40 text-[10px] select-none">
                      <span>···</span>
                      <span className="italic">{entry.count} unchanged line{entry.count !== 1 ? 's' : ''}</span>
                    </div>
                  );
                }

                const isAdd = entry.type === 'add';
                const isDel = entry.type === 'del';
                const lineNumStr = entry.lineNo != null ? String(entry.lineNo) : '';

                return (
                  <div key={li} className={`flex min-w-0 ${
                    isAdd ? 'bg-emerald-500/10 hover:bg-emerald-500/15' :
                    isDel ? 'bg-red-500/10 hover:bg-red-500/15' :
                    'hover:bg-white/[0.03]'
                  }`}>
                    {/* Line number gutter */}
                    <span className="w-10 shrink-0 px-2 py-[2px] text-right text-[10px] text-[var(--text-muted)] opacity-30 select-none border-r border-white/5">
                      {lineNumStr}
                    </span>
                    {/* +/- gutter */}
                    <span className={`w-5 shrink-0 px-1 py-[2px] text-center select-none ${
                      isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-[var(--text-muted)] opacity-20'
                    }`}>
                      {isAdd ? '+' : isDel ? '−' : ' '}
                    </span>
                    {/* Code content */}
                    <span className={`flex-1 py-[2px] px-2 whitespace-pre-wrap break-all ${
                      isAdd ? 'text-emerald-200' :
                      isDel ? 'text-red-200' :
                      'text-[var(--text-secondary)]'
                    }`}>
                      {entry.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  // ── Render actual full-file post-patch diff using DMP ───────────────────────
  const renderDmpDiffByResult = (resultsArray, collapsedState, setCollapsedState, backup, onRollbackFile) => {
    if (!Array.isArray(resultsArray) || resultsArray.length === 0) return null;

    return resultsArray.map((result, fi) => {
      const fullPath = result.file;
      const displayName = fullPath.split('/').pop() || fullPath;
      const key = fullPath;
      const isCollapsed = collapsedState?.[key] ?? false;

      // Calculate diff using diff-match-patch
      const dmp = new diff_match_patch();
      // Calculate diffs between original and new
      const diffs = dmp.diff_main(result.originalContent || '', result.newContent || '');
      // Clean up diffs to be semantic line-by-line
      dmp.diff_cleanupSemantic(diffs);

      let added = 0;
      let removed = 0;
      
      const displayLines = [];
      let oldLine = 1;
      let newLine = 1;

      // diffs is array of [Operation, text]
      // Operation format: -1 = diff_match_patch.DIFF_DELETE, 1 = DIFF_INSERT, 0 = DIFF_EQUAL
      for (const [op, text] of diffs) {
        // text might be multiple lines, split by \n
        // Be careful: trailing \n means empty last element in split array
        const lines = text.split('\n');
        // if the last element is empty because of a trailing newline, remove it to avoid extra blank line
        if (lines[lines.length - 1] === '') lines.pop();

        for (const lineText of lines) {
          if (op === 1) { // Insert
            displayLines.push({ type: 'add', text: lineText, lineNo: newLine });
            newLine++;
            added++;
          } else if (op === -1) { // Delete
            displayLines.push({ type: 'del', text: lineText, lineNo: null });
            oldLine++;
            removed++;
          } else { // Equal
            displayLines.push({ type: 'ctx', text: lineText, lineNo: newLine });
            newLine++;
            oldLine++;
          }
        }
      }

      const fileBackupExists = backup?.id && Array.isArray(backup?.files) &&
        backup.files.some(f => {
          const norm = (s) => s.replace(/^\/+/, '');
          return norm(f).endsWith(norm(fullPath)) || norm(fullPath).endsWith(norm(f));
        });

      // Now we have a huge list of displayLines containing the entire file.
      // We can also collapse context areas (gap lines) if there are too many ctx lines in a row.
      const foldedLines = [];
      const CONTEXT_SIZE = 3;
      let i = 0;
      
      while (i < displayLines.length) {
        if (displayLines[i].type !== 'ctx') {
          foldedLines.push(displayLines[i]);
          i++;
          continue;
        }

        // Count consecutive "ctx" lines
        let ctxCount = 0;
        let startIdx = i;
        while (i < displayLines.length && displayLines[i].type === 'ctx') {
          ctxCount++;
          i++;
        }

        if (ctxCount > CONTEXT_SIZE * 2 + 1) {
          // Add first few context lines
          for (let j = 0; j < CONTEXT_SIZE; j++) {
            foldedLines.push(displayLines[startIdx + j]);
          }
          // Add the gap
          const hiddenCount = ctxCount - (CONTEXT_SIZE * 2);
          foldedLines.push({ type: 'gap', count: hiddenCount });
          // Add the last few context lines
          for (let j = 0; j < CONTEXT_SIZE; j++) {
            foldedLines.push(displayLines[i - CONTEXT_SIZE + j]);
          }
        } else {
          // Just push all ctx lines if it's small enough
          for (let j = startIdx; j < i; j++) {
            foldedLines.push(displayLines[j]);
          }
        }
      }

      return (
        <div key={key} className="rounded-xl border border-white/10 overflow-hidden mb-3 last:mb-0 shadow-sm">
          {/* FILE HEADER HTML IDENTICAL TO RENDERDIFFBYFILE */}
          <div className="flex items-center bg-[#1a1a2e] border-b border-white/10">
            <button
              type="button"
              onClick={() => setCollapsedState(prev => ({ ...prev, [key]: !isCollapsed }))}
              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                {isCollapsed
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }
              </span>
              <span className="text-[12px] font-bold font-mono text-white truncate">{displayName}</span>
              {fullPath && fullPath !== displayName && (
                <span className="text-[10px] font-mono opacity-30 text-[var(--text-muted)] truncate hidden sm:inline ml-1">{fullPath}</span>
              )}
              {!result.success && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 ml-2">FAILED</span>
              )}
            </button>

            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
              <span className="text-[11px] font-mono font-bold text-emerald-400">+{added}</span>
              <span className="text-[10px] opacity-30 font-mono">/</span>
              <span className="text-[11px] font-mono font-bold text-red-400">-{removed}</span>
              {fileBackupExists && onRollbackFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRollbackFile(fullPath, backup.id); }}
                  className="ml-2 px-2 py-1 rounded text-[10px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-all"
                  title={`Rollback ${displayName}`}
                >
                  ↩ Rollback
                </button>
              )}
            </div>
          </div>

          {/* DIFF CONTENT */}
          {!isCollapsed && (
            <div className="overflow-y-auto max-h-[500px] custom-scrollbar font-mono text-[11px] bg-[#0d0d1a]">
              {foldedLines.map((entry, li) => {
                if (entry.type === 'gap') {
                  return (
                    <div key={li} className="flex items-center gap-2 px-3 py-[3px] bg-[#111122]/60 border-y border-white/[0.04] text-[var(--text-muted)] opacity-40 text-[10px] select-none">
                      <span>···</span>
                      <span className="italic">{entry.count} unchanged line{entry.count !== 1 ? 's' : ''}</span>
                    </div>
                  );
                }

                const isAdd = entry.type === 'add';
                const isDel = entry.type === 'del';
                const lineNumStr = entry.lineNo != null ? String(entry.lineNo) : '';

                return (
                  <div key={li} className={`flex min-w-0 ${
                    isAdd ? 'bg-emerald-500/10 hover:bg-emerald-500/15' :
                    isDel ? 'bg-red-500/10 hover:bg-red-500/15' :
                    'hover:bg-white/[0.03]'
                  }`}>
                    <span className="w-10 shrink-0 px-2 py-[2px] text-right text-[10px] text-[var(--text-muted)] opacity-30 select-none border-r border-white/5">
                      {lineNumStr}
                    </span>
                    <span className={`w-5 shrink-0 px-1 py-[2px] text-center select-none ${
                      isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-[var(--text-muted)] opacity-20'
                    }`}>
                      {isAdd ? '+' : isDel ? '−' : ' '}
                    </span>
                    <span className={`flex-1 py-[2px] px-2 whitespace-pre-wrap break-all ${
                      isAdd ? 'text-emerald-200' :
                      isDel ? 'text-red-200' :
                      'text-[var(--text-secondary)]'
                    }`}>
                      {entry.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  const getOutputContext = () => {
    const maxLines = 100;
    const maxChars = 15000;
    const lines = outputLinesRef.current.slice(-maxLines);
    const joined = lines.join('\n') + (outputBufferRef.current ? '\n' + outputBufferRef.current : '');
    return joined.length > maxChars ? joined.slice(-maxChars) : joined;
  };

  const getOutputContextForAi = () => {
    const maxLines = 200;
    const maxChars = 15000;
    const lines = outputLinesRef.current.slice(-maxLines);
    const joined = lines.join('\n') + (outputBufferRef.current ? '\n' + outputBufferRef.current : '');
    const tail = joined.length > maxChars ? joined.slice(-maxChars) : joined;
    return redactSecrets(tail);
  };

  const extractEnvFromPrompt = (text) => {
    const lines = String(text || '').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      // Match pattern: user@host:cwd$ or [user@host cwd]$
      const m = /([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):([^$#%>]+)[$#%>]/.exec(line);
      if (m) {
        return { user: m[1], hostname: m[2], cwd: m[3].trim() };
      }
      // Brackets style: [root@server ~]#
      const m2 = /\[([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)\s+([^\]]+)\][$#%>]/.exec(line);
      if (m2) {
        return { user: m2[1], hostname: m2[2], cwd: m2[3].trim() };
      }
    }
    return null;
  };

  const buildAiContextPack = (snapshotOverride) => {
    const snap = String(snapshotOverride ?? getOutputContextForAi() ?? '').trim();
    const err = detectTerminalError(snap);
    const env = extractEnvFromPrompt(snap);

    return {
      connectionName: connectionName || '?',
      host: host || '?',
      user: env?.user || 'unknown',
      cwd: env?.cwd || 'unknown',
      hostname: env?.hostname || 'unknown',
      lastCommand: String(lastExecutedCommand || ''),
      recentCommands: (recentCommandsRef.current || []).slice(-30),
      lastError: err ? { label: err.label, excerpt: redactSecrets(String(err.excerpt || '')) } : null,
      terminalTail: snap,
    };
  };

  const normalizeForLoop = (text) => {
    const raw = String(text || '');
    const lines = raw
      .split('\n')
      .map((l) => String(l).replace(/\x1b\[[0-9;]*m/g, '').trimEnd())
      .filter((l) => {
        const s = String(l || '').trim();
        if (!s) return false;
        if (/^last metadata expiration check:/i.test(s)) return false;
        if (/^last login:/i.test(s)) return false;
        if (/^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}/.test(s)) return false;
        return true;
      });
    return lines.slice(-40).join('\n');
  };

  const computeErrorSignature = (snap) => {
    const normalized = normalizeForLoop(snap);
    const err = detectTerminalError(normalized);
    const label = String(err?.label || '').toLowerCase();
    const excerpt = String(err?.excerpt || normalized).toLowerCase();
    const patterns = [
      /no match for argument:\s*([^\s]+)/i,
      /unable to find a match:\s*([^\s]+)/i,
      /no matching packages to list/i,
      /no package\s+([^\s]+)\s+available/i,
      /command not found/i,
      /permission denied/i,
      /could not resolve host/i,
      /temporary failure in name resolution/i,
      /connection timed out/i,
      /failed to.*(download|fetch)/i,
      /404 not found/i,
      /not found/i,
    ];
    let hit = '';
    for (const re of patterns) {
      const m = re.exec(excerpt);
      if (m) {
        hit = m[0];
        if (m[1]) hit = `${m[0]}:${m[1]}`;
        break;
      }
    }
    const tail = normalized.slice(-220);
    const sig = [label || 'none', hit || 'none', tail].join('::');
    return sig;
  };

  const buildSafeDiagnostics = (lastCmd, snap) => {
    const cmd = String(lastCmd || '').toLowerCase();
    const normalized = normalizeForLoop(snap);
    const sig = computeErrorSignature(normalized);

    const diags = [];
    // Always-safe environment basics
    diags.push('pwd && whoami && hostname');
    diags.push('uname -a');
    diags.push('cat /etc/os-release 2>/dev/null || lsb_release -a 2>/dev/null || sw_vers 2>/dev/null');

    // Package-manager context when installs fail
    const looksLikePkg = /(dnf|yum|apt-get|apt|apk|pacman|zypper)\b/.test(cmd) || /(no match for argument|unable to find a match|no package|no matching packages)/i.test(sig);
    if (looksLikePkg) {
      diags.push('command -v dnf yum apt-get apt apk pacman zypper 2>/dev/null | cat');
      // Repo visibility checks (non-destructive). Use conditional execution to avoid errors.
      diags.push('command -v dnf >/dev/null 2>&1 && dnf repolist -v || true');
      diags.push('command -v yum >/dev/null 2>&1 && yum repolist -v || true');
      diags.push('command -v apt-get >/dev/null 2>&1 && apt-cache policy || true');
      diags.push('command -v apk >/dev/null 2>&1 && apk info -vv 2>/dev/null || true');
    }

    // Command-not-found context
    if (/command not found/i.test(sig) || /no match for argument:\s*pm2/i.test(sig) || /unable to find a match:\s*pm2/i.test(sig)) {
      diags.push('command -v pm2 node npm npx 2>/dev/null | cat');
      diags.push('node -v 2>/dev/null || true');
      diags.push('npm -v 2>/dev/null || true');
    }

    // Keep it short to avoid spending too many steps
    return diags.slice(0, 5);
  };

  const looksLikeShellPrompt = (text) => {
    // Strip ANSI escape codes and non-printable characters first
    const cleanText = String(text || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').replace(/[^\x20-\x7E\n\r]/g, '');
    const lines = cleanText.split('\n').filter(l => l.trim().length > 0);
    const last = (lines[lines.length - 1] || '').trim();
    if (!last) return false;

    // Common standard prompts: $, #, %, > and rich zsh themes: ❯, ➜, ➔, ➤
    if (/[$#%>❯➜➔➤]\s*$/.test(last)) return true;
    // Brackets/paths style: [user@server ~]# or (base) user@host ~/path $
    // This also captures [user@host ~]$ (even without space)
    if (/\]\s*[$#%>❯➜➔➤]\s*$/.test(last) || /\)\s*.*[$#%>❯➜➔➤]\s*$/.test(last) || /\][$#%>]/.test(last)) return true;
    // bash/sh/zsh/fish version prompts: bash-5.1$
    if (/^(bash|sh|zsh|fish|cmd)-[\d.]+[$#%>]\s*$/.test(last)) return true;
    // user@host pattern: check for common user@host indicators (e.g. [user@host ~]$ or user@host:path$)
    if (/^\[?[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+.*[$#%>❯➜➔➤]\s*$/.test(last)) return true;
    if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\s*[:\s]\s*[~/\\w.-]+\s*$/.test(last) && last.length < 100) return true;
    return false;
  };

  const looksLikeEditorOrPager = (text) => {
    const raw = String(text || '');
    // If we have a shell prompt, we are NOT in a pager/editor (it finished or exited)
    if (looksLikeShellPrompt(raw)) return null;
    const t = raw.toLowerCase();
    // nano editor indicators
    if (t.includes('gnu nano') || t.includes('^g get help') || t.includes('^x exit')) return 'nano';
    // vim/vi indicators — INSERT mode, visual mode, or vim status line (e.g. "0,0-1All", "1,1All")
    if (t.includes('-- insert --') || t.includes('-- visual --') || t.includes('-- normal --')) return 'vim';
    // vim status bar: "0,0-1All", "1,1  All", "Top", "Bot", "All" at end of line preceded by row/col
    if (/\d+,\d+[-\s]*(?:all|top|bot|\d+%)\s*$/im.test(raw)) return 'vim';
    // multiple ~ lines (vim empty buffer indicator)
    if ((raw.match(/^~$/gm) || []).length >= 3) return 'vim';
    // less/more pager
    if (t.includes('(end)')) return 'pager';
    if (/\blines\s+\d+[-\d]*\/\d+\s*\(end\)\b/i.test(t)) return 'pager';
    // systemctl/journalctl pager screens
    if (/\n~\n/.test(t) && (t.includes('press return') || t.includes('press enter') || t.includes('press q') || t.includes('press any key'))) return 'pager';
    // "press RETURN" style pagers
    if (/press return/i.test(t) || /press enter/i.test(t) || /log file support is not available/i.test(t) || t.includes('press return')) return 'pager';
    // colon-prompt at end of last line (less pager waiting for input)
    // colon-prompt at end of last line (less pager waiting for input)
    if (/^:\s*$/m.test(raw.split('\n').slice(-3).join('\n'))) return 'pager';
    // systemctl status / more / less indicators
    if (t.includes('lines ') && t.includes('--more--')) return 'pager';
    if (t.includes('(end)') || t.includes('press q to quit')) return 'pager';
    // man page
    if (t.includes('manual page') || t.includes('man page')) return 'man';
    return null;
  };

  const waitForCommandSettle = async (commandHint) => {
    const maxMs = 300000; // 5 minute max heartbeat (safety net)
    const cmdLower = String(commandHint || '').toLowerCase();

    // Speed optimizations: reduce idle wait for normal commands
    let idleMs = 600; 
    let stuckMs = 12000;
    
    const isHeavy = /install|build|deploy|setup|create-next-app|npx|npm|dnf|yum|apt/.test(cmdLower);
    if (isHeavy) {
      idleMs = 4000; // Give installers more time to think
      stuckMs = 30000; // Wait 30s before declaring stuck
    }
    
    // Minimal override just to prevent flickering on very quick commands
    if (/^\[?ctrl\+c\]?$|^\^c$/.test(cmdLower)) {
      idleMs = 200;
    }

    const start = Date.now();
    let lastCheckSnap = '';

    while (Date.now() - start < maxMs) {
      const snap = getOutputContext();

      // 1. Check for shell prompt FIRST (if prompt is ready, we are NOT in an editor/pager)
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const promptIdleMs = Math.min(idleMs, 800); 
      if (idleFor > promptIdleMs && looksLikeShellPrompt(snap) && sawOutputAfterCommandRef.current) {
        return { reason: 'prompt', snap };
      }

      // 2. Check for editor/pager (these never "settle" — output stops but we're stuck)
      const editorPager = looksLikeEditorOrPager(snap);
      if (editorPager && idleFor > 1200) return { reason: 'editor', snap, editor: editorPager };

      // 3. Check for errors (patience: don't error out while output is still flying)
      const err = detectTerminalError(snap);
      if (err && idleFor > 3000) return { reason: 'error', snap, error: err };

      // 4. Check for interactive prompt
      const interactive = detectInteractivePrompt(snap);
      if (interactive) return { reason: 'interactive', snap, interactive };

      // Detect stuck (no output change for a long time, but no prompt)
      if (idleFor > stuckMs && snap === lastCheckSnap) {
        return { reason: 'stuck', snap };
      }

      lastCheckSnap = snap;
      await new Promise(r => setTimeout(r, 100)); // Faster polling (100ms)
    }

    return { reason: 'busy', snap: getOutputContext() };
  };

  const detectInteractivePrompt = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const t = raw.toLowerCase();
    const nonEmptyLines = raw.split('\n').map(l => String(l || '')).filter(l => l.trim().length > 0);
    const lastFew = nonEmptyLines.slice(-6);
    const lastLine = (lastFew[lastFew.length - 1] || '').trim();
    const lastLineLower = lastLine.toLowerCase();
    const tailText = lastFew.join('\n');

    // === Y/N Confirmation Prompts ===
    // yum/dnf/apt confirmation
    if (/(\(y\/n\)|\[y\/n\]|\[y\/n\/d\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\[yes\/no\]|\(y\)\s*$|\[y\]\s*$)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    if (/(\(y\)|\[y\])/i.test(lastLine) && /(proceed|confirm|continue|ok to)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    if (/proceed/i.test(t) && /(\?\s*\(y\))|(\(y\)\s*[:：]?\s*$)/i.test(t)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    if (/is this ok/i.test(t) && /\[y/i.test(t)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    // apt "Do you want to continue?"
    if (/do you want to continue/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }
    // Generic confirmations ending with ? and containing yes/no words
    if (/\?\s*$/.test(lastLine) && /(proceed|continue|confirm|accept|agree|overwrite|replace|remove|delete)/i.test(lastLine)) {
      return { kind: 'confirm_yn', text: lastLine };
    }

    // === Overwrite Prompts ===
    if (/overwrite\s+.*\?/i.test(lastLine) || /already exists.*overwrite/i.test(t)) {
      return { kind: 'confirm_overwrite', text: lastLine };
    }
    if (/file exists.*replace/i.test(lastLine)) {
      return { kind: 'confirm_overwrite', text: lastLine };
    }

    // === Password/Passphrase Prompts ===
    if (/password\s*[:：]\s*$/i.test(lastLine) || /password for/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    if (/passphrase/i.test(lastLine) && /[:：]\s*$/.test(lastLine)) {
      return { kind: 'passphrase', text: lastLine };
    }
    if (/enter.*password/i.test(lastLine) || /new password/i.test(lastLine)) {
      return { kind: 'password', text: lastLine };
    }
    // sudo password prompt
    if (/\[sudo\]\s+password/i.test(lastLine)) {
      return { kind: 'sudo_password', text: lastLine };
    }

    // === Press ENTER / Any Key ===
    if (/press.*enter/i.test(lastLine) || /press.*return/i.test(lastLine) || /press any key/i.test(lastLine) || /log file support is not available/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
    }
    if (/press.*enter/i.test(tailText) || /press.*return/i.test(tailText) || /press any key/i.test(tailText)) {
      const line = (lastFew.find(l => /press.*(enter|return)/i.test(l) || /press any key/i.test(l)) || lastLine).trim();
      return { kind: 'press_enter', text: line };
    }
    if (/hit enter/i.test(lastLine) || /press.*to continue/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
    }

    // === SSH Key Prompts ===
    if (/enter file in which to save/i.test(lastLine)) {
      return { kind: 'ssh_key_file', text: lastLine };
    }
    if (/are you sure you want to continue connecting/i.test(t)) {
      return { kind: 'ssh_host_verify', text: lastLine };
    }

    // === Selection Prompts ===
    // Numbered menu (e.g., "Select [1-3]:")
    if (/select.*\[\d/i.test(lastLine) || /choose.*\[\d/i.test(lastLine) || /option.*\[\d/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }
    // Generic choice prompt ending with colon after bracket options
    if (/\[\d+[-/]\d+\]\s*[:：]?\s*$/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }

    // === GPG Key Import ===
    if (/importing.*gpg key/i.test(t) && /is this ok/i.test(t)) {
      return { kind: 'confirm_yn', text: lastLine };
    }

    // === Disk/Partition Selection ===
    if (/select.*disk/i.test(lastLine) || /which.*partition/i.test(lastLine)) {
      return { kind: 'selection', text: lastLine };
    }

    // === Generic "input required" (line ends with : or > and no prompt signs) ===
    if (/[:：]\s*$/.test(lastLine)) {
      // Only if it looks like a question, not a normal shell output
      if (/\?\s*[:：]\s*$/i.test(lastLine) || /enter\s/i.test(lastLineLower) || /type\s/i.test(lastLineLower) || /provide\s/i.test(lastLineLower) || /specify\s/i.test(lastLineLower) || /write\s*[:：]\s*$/i.test(lastLineLower)) {
        return { kind: 'text_input', text: lastLine };
      }
    }

    return null;
  };

  const sendQuickInput = (value) => {
    const v = String(value || '').replace(/[\r\n]+$/g, '');
    if (!v) return;
    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', `${v}\n`);
      termInstanceRef.current?.focus();
      return;
    }
    termInstanceRef.current?.focus();
  };

  const detectTerminalError = (text) => {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return null;

    // Get the last few lines for more accurate detection (avoid false positives from old output)
    const recentLines = t.split('\n').filter(Boolean).slice(-8).join('\n');

    // === Command Not Found ===
    if (recentLines.includes('command not found')) return { type: 'command_not_found', label: 'Command not found', severity: 'high' };
    if (recentLines.includes('not recognized as an internal or external command')) return { type: 'command_not_found', label: 'Command not found', severity: 'high' };
    if (/no such command/i.test(recentLines)) return { type: 'command_not_found', label: 'No such command', severity: 'high' };

    // === Permission / Access ===
    if (recentLines.includes('permission denied')) return { type: 'permission_denied', label: 'Permission denied', severity: 'high' };
    if (recentLines.includes('access denied')) return { type: 'permission_denied', label: 'Access denied', severity: 'high' };
    if (recentLines.includes('operation not permitted')) return { type: 'permission_denied', label: 'Operation not permitted', severity: 'high' };
    if (/insufficient privileges/i.test(recentLines)) return { type: 'permission_denied', label: 'Insufficient privileges', severity: 'high' };

    // === File/Path Errors ===
    if (recentLines.includes('no such file or directory')) return { type: 'missing_file', label: 'No such file or directory', severity: 'high' };
    if (recentLines.includes('is a directory')) return { type: 'wrong_type', label: 'Is a directory', severity: 'medium' };
    if (recentLines.includes('not a directory')) return { type: 'wrong_type', label: 'Not a directory', severity: 'medium' };
    if (recentLines.includes('file exists')) return { type: 'file_exists', label: 'File already exists', severity: 'medium' };

    // === Package Manager Errors ===
    if (/no match for/i.test(recentLines) || /no package.*found/i.test(recentLines)) return { type: 'package_not_found', label: 'Package not found', severity: 'high' };
    if (/unable to locate package/i.test(recentLines)) return { type: 'package_not_found', label: 'Package not found', severity: 'high' };
    if (/nothing provides/i.test(recentLines)) return { type: 'dependency_error', label: 'Missing dependency', severity: 'high' };
    if (/dependency.*conflict/i.test(recentLines) || /conflicts with/i.test(recentLines)) return { type: 'dependency_error', label: 'Dependency conflict', severity: 'high' };
    if (/broken packages/i.test(recentLines)) return { type: 'dependency_error', label: 'Broken packages', severity: 'high' };
    if (/repository.*not found/i.test(recentLines) || /cannot find.*repo/i.test(recentLines)) return { type: 'repo_error', label: 'Repository error', severity: 'medium' };

    // === Docker / Container Errors ===
    if (/docker[:\s]/.test(t) && (/no such container/i.test(t) || /not running/i.test(t) || /failed to start/i.test(t))) return { type: 'docker_error', label: 'Docker error', severity: 'high' };
    if (/kubernetes|kubectl/.test(t) && (/not found/i.test(t) || /error from server/i.test(t) || /refused/i.test(t))) return { type: 'k8s_error', label: 'Kubernetes error', severity: 'high' };

    // === Database Errors ===
    if (/mysql|postgresql|psql|redis|mongo/.test(t) && (/connection refused/i.test(t) || /access denied/i.test(t) || /fatal[:\s]/.test(t))) return { type: 'db_error', label: 'Database connection failed', severity: 'high' };

    // === Resource / Disk Errors ===
    if (/disk quota exceeded/i.test(recentLines)) return { type: 'disk_full', label: 'Disk quota exceeded', severity: 'critical' };
    if (/argument list too long/i.test(recentLines)) return { type: 'system_error', label: 'Argument list too long', severity: 'high' };

    // === Connection / Network Errors ===
    if (/connection refused/i.test(recentLines)) return { type: 'connection_refused', label: 'Connection refused', severity: 'high' };
    if (/connection timed out/i.test(recentLines) || /timed out/i.test(recentLines)) return { type: 'timeout', label: 'Connection timed out', severity: 'high' };
    if (/name or service not known/i.test(recentLines) || /could not resolve/i.test(recentLines)) return { type: 'dns_error', label: 'DNS resolution failed', severity: 'high' };
    if (/network.*unreachable/i.test(recentLines)) return { type: 'network_error', label: 'Network unreachable', severity: 'high' };

    // === Service Errors ===
    if (/failed to start/i.test(recentLines)) return { type: 'service_error', label: 'Service failed to start', severity: 'high' };
    if (/unit.*not found/i.test(recentLines)) return { type: 'service_not_found', label: 'Service unit not found', severity: 'high' };
    if (/inactive \(dead\)/i.test(recentLines)) return { type: 'service_inactive', label: 'Service is inactive', severity: 'medium' };

    // === Disk/Resource Errors ===
    if (/no space left/i.test(recentLines)) return { type: 'disk_full', label: 'No space left on device', severity: 'critical' };
    if (/cannot allocate memory/i.test(recentLines)) return { type: 'memory_error', label: 'Out of memory', severity: 'critical' };
    if (/too many open files/i.test(recentLines)) return { type: 'resource_error', label: 'Too many open files', severity: 'high' };

    // === Authentication Errors ===
    if (/authentication failure/i.test(recentLines) || /auth.*fail/i.test(recentLines)) return { type: 'auth_error', label: 'Authentication failure', severity: 'high' };
    if (/incorrect password/i.test(recentLines)) return { type: 'auth_error', label: 'Incorrect password', severity: 'high' };

    // === Port Errors ===
    if (/address already in use/i.test(recentLines) || /port.*already in use/i.test(recentLines)) return { type: 'port_in_use', label: 'Port already in use', severity: 'high' };

    // === Config Errors ===
    if (/syntax error/i.test(recentLines) || /parse error/i.test(recentLines)) return { type: 'syntax_error', label: 'Syntax/parse error', severity: 'high' };
    if (/configuration.*test.*failed/i.test(recentLines) || /configtest.*failed/i.test(recentLines)) return { type: 'config_error', label: 'Config test failed', severity: 'high' };

    // === Generic (lower priority — checked last) ===
    if (/\berror[:!]/i.test(recentLines) && !recentLines.includes('error:')) return { type: 'generic_error', label: 'Error', severity: 'medium' };
    if (recentLines.includes('error:')) return { type: 'generic_error', label: 'Error', severity: 'medium' };
    if (recentLines.includes('fatal:')) return { type: 'fatal_error', label: 'Fatal error', severity: 'critical' };
    if (/^.*\bfailed\b.*$/m.test(recentLines) && !/\bsuccess/i.test(recentLines)) {
      if (!/\b0\s+failed\b/i.test(recentLines)) {
        return { type: 'generic_error', label: 'Command failed', severity: 'medium' };
      }
    }

    // === Repository / Scaffolding Errors ===
    if (/could not locate.*repository/i.test(recentLines)) return { type: 'repo_error', label: 'Repository not found', severity: 'high' };
    if (/could not determine executable/i.test(recentLines)) return { type: 'npm_error', label: 'NPM Executable error', severity: 'high' };
    if (/invalid character/i.test(recentLines) && /project name/i.test(recentLines)) return { type: 'config_error', label: 'Invalid project name', severity: 'medium' };

    return null;
  };



  const maybeHandleInteractivePrompt = (snapshot) => {
    // Grace period: ignore prompts briefly after the user just resumed from a password
    if (Date.now() < suppressInteractiveUntilRef.current) {
      setInteractivePrompt(null);
      return;
    }
    const p = detectInteractivePrompt(snapshot);

    if (!p) {
      setInteractivePrompt(null);
      return;
    }

    // Auto-answer common confirmations only when in Auto mode.
    if (aiMode === 'auto') {
      const cmd = String(lastExecutedCommand || '').toLowerCase();
      const looksLikeInstall = /(yum|dnf|apt|apt-get|apk|pacman|pip|npm|npx|yarn|gem)\s+.*\b(install|upgrade|update|remove|create|setup|add)\b/.test(cmd) || /\b(install|create-next-app)\b/.test(cmd);

      // Auto-answer Y/N for install/update confirmations
      if (p.kind === 'confirm_yn' && looksLikeInstall) {
        setInteractivePrompt(null);
        sendQuickInput('y');
        return;
      }

      // Auto-answer GPG key imports with yes
      if (p.kind === 'confirm_yn' && /gpg/i.test(p.text)) {
        setInteractivePrompt(null);
        sendQuickInput('y');
        return;
      }

      // Auto-answer SSH host verification with yes
      if (p.kind === 'ssh_host_verify') {
        setInteractivePrompt(null);
        sendQuickInput('yes');
        return;
      }

      // Auto-answer defaults for text inputs in installers (e.g. create-next-app project name, npm init defaults)
      if ((p.kind === 'text_input' || p.kind === 'selection') && looksLikeInstall) {
        // Only if it looks like it has a [default] or just asking for a name
        if (p.text.includes('?') || p.text.includes('name') || p.text.includes('default')) {
           setInteractivePrompt(null);
           sendQuickInput(''); // Just press Enter for default
           return;
        }
      }

      // Auto-press ENTER for "press enter to continue" or SSH key file (accept default)
      if (p.kind === 'press_enter' || p.kind === 'ssh_key_file') {
        setInteractivePrompt(null);
        sendQuickInput('');
        // Need to send just a newline
        if (socketRef.current?.connected) {
          socketRef.current.emit('ssh:input', '\n');
        }
        return;
      }
    }

    // For prompts that require manual input, pause auto mode
    setInteractivePrompt(p);
    if (p && autoMode) {
      const pauseReasons = {
        'confirm_yn': 'interactive prompt requires input (y/n)',
        'confirm_overwrite': 'overwrite confirmation required',
        'password': 'password input required (cannot be automated)',
        'passphrase': 'passphrase input required',
        'sudo_password': 'sudo password required (cannot be automated)',
        'ssh_key_file': 'SSH key file path input required',
        'ssh_host_verify': 'SSH host verification required',
        'press_enter': 'waiting for ENTER key',
        'selection': 'selection input required',
        'text_input': 'text input required',
      };
      setAiError(`${t('ai.pausedPrompt')}`);
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
    }
  };

  const refreshLastResultSnapshot = () => {
    const snap = getOutputContext();
    setLastResultSnapshot(snap);
    setLastResultAt((prev) => {
      const next = Date.now();
      const p = Number(prev || 0);
      return next > p ? next : p + 1;
    });

    maybeHandleInteractivePrompt(snap);
  };

  useEffect(() => {
    // Only attempt diff extraction in code-edit mode (keeps UI simpler for normal SSH mode)
    if (sshAiPrefs?.aiTask !== 'code') {
      setFileChanges(null);
      setSelectedDiffFile('');
      return;
    }
    const extracted = extractUnifiedDiff(lastResultSnapshot);
    if (extracted?.diffText) {
      setFileChanges(extracted);
      setFileChangesCollapsed(true);
      const first = extracted.files?.[0]?.path || '';
      setSelectedDiffFile(first);
    }
  }, [lastResultSnapshot, sshAiPrefs?.aiTask]);

  const executeCommandAndCapture = async (command) => {
    const cmd = String(command || '').replace(/[\r\n]+$/g, '');
    if (!cmd) return '';
    setLastExecutedCommand(cmd);
    lastCommandSentAtRef.current = Date.now();
    sawOutputAfterCommandRef.current = false;

    if (socketRef.current?.connected) {
      if (/^\[wait\]$/i.test(cmd)) {
        // AI specifically wants to wait for more output from a previous command
      } else if (/^\[?ctrl\+c\]?$|^\^c$/i.test(cmd)) {
        socketRef.current.emit('ssh:input', '\x03');
      } else {
        // Parse special control notations: ^X, ^O, ^R, [ESC]
        let finalInput = cmd;
        
        // 1. Handle [ESC]
        finalInput = finalInput.replace(/\[ESC\]/gi, '\x1b');
        
        // 2. Handle Ctrl+Letter (e.g. ^X, ^O, ^C)
        finalInput = finalInput.replace(/\^([A-Z])/g, (m, char) => {
          return String.fromCharCode(char.charCodeAt(0) - 64);
        });

        // 3. Append newline only if it's not a standalone control character or explicitly forbidden
        // If the command already has a newline or Ends with a control character, we don't force another one.
        const isControlOnly = /[\x00-\x1F]/.test(finalInput) && finalInput.length <= 2;
        if (!isControlOnly && !finalInput.endsWith('\n')) {
           finalInput += '\n';
        }

        socketRef.current.emit('ssh:input', finalInput);
      }
      termInstanceRef.current?.focus();
      const settled = await waitForCommandSettle(cmd);
      const snap = settled?.snap ?? getOutputContext();
      setLastResultSnapshot(snap);

      // If the command landed us in an interactive prompt or pager/editor, try to handle it in Auto Mode.
      if (settled?.reason === 'interactive') {
        const prompt = settled.interactive;
        setInteractivePrompt(prompt);
        
        // Auto-handle "press enter" prompts in Auto Mode
        if (autoMode && prompt.kind === 'press_enter') {
          socketRef.current.emit('ssh:input', '\n');
          setInteractivePrompt(null);
          await new Promise(r => setTimeout(r, 800));
          const nextSnap = getOutputContext();
          setLastResultSnapshot(nextSnap);
          return nextSnap;
        }

        // Auto-handle Y/N install confirmations in Auto Mode
        if (autoMode && prompt.kind === 'confirm_yn') {
          const cmdLower = cmd.toLowerCase();
          const isPkg = /(yum|dnf|apt|apt-get|apk|pacman|pip|npm|npx|yarn|gem)\b/.test(cmdLower);
          const isInstall = /\b(install|upgrade|update|remove|create|setup|add|create-next-app)\b/.test(cmdLower);
          
          if (isPkg || isInstall) {
            socketRef.current.emit('ssh:input', 'y\n');
            setInteractivePrompt(null);
            await new Promise(r => setTimeout(r, 1200));
            const nextSnap = getOutputContext();
            setLastResultSnapshot(nextSnap);
            return nextSnap;
          }
        }

        if (autoMode) {
          setAiError(t('ai.pausedPrompt'));
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
        }
        if (autoMode) {
          setLastResultAt(Date.now());
        }
        return snap;
      }

      if (settled?.reason === 'editor') {
        const editorType = String(settled.editor || '');
        // We now ALLOW editors. Return the editor snapshot so the AI can continue interacting with it.
        if (autoMode) {
          setLastResultAt(Date.now());
        }
        return snap;
      }
      if (settled?.reason === 'busy') {
        // Report busy state to AI so it can decide to Wait or Ctrl+C
        setAiError('Command is still running... (Waiting for AI decision)');
        // We return the snap, and in the next loop the AI will see partial output.
        // If the AI sends something new, it will be injected.
      }

      setLastResultAt((prev) => {
        const next = Date.now();
        const p = Number(prev || 0);
        return next > p ? next : p + 1;
      });

      maybeHandleInteractivePrompt(snap);
      return snap;
    }
    if (termInstanceRef.current) termInstanceRef.current.focus();
    return '';
  };

  const askAiWithPrompt = async (prompt) => {
    const p = String(prompt || '').trim();
    if (!p) return;
    setAiOpen(true);
    setAiHasOpenedOnce(true);
    setAiError(null);
    setAiAnswer(null);
    setExecuteConfirmOpen(false);
    
    // Add user message to chat history
    const userMsg = { id: Date.now(), role: 'user', content: p, timestamp: new Date() };
    setChatHistory(prev => [...prev, userMsg]);
    setAiPrompt(''); // Clear input immediately for chat-like feel
    
    return handleAskAi(p);
  };

  const handleAskAi = async (promptOverride) => {
    if (!isLoggedIn) {
      setAiError(t('ai.loginRequired'));
      return;
    }
    const effectivePrompt = String(promptOverride ?? aiPrompt).trim();
    if (!effectivePrompt || aiLoading) return;
    setAiLoading(true);
    setAiStreaming(false);
    setAiStreamText('');
    setAiError(null);
    setAiAnswer(null);
    try {
      // Add user message to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: effectivePrompt }
      ].slice(-8); // Keep last 8 turns for loop prevention

      // Streaming attempt (Groq models). Falls back to normal JSON if unsupported.
      let data = null;
      let streamedAnswer = '';
      try {
        setAiStreaming(true);
        const streamRes = await fetch('/api/ssh/ai-help?stream=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            context: getOutputContext().slice(-2500),
            contextPack: buildAiContextPack(),
            connectionName,
            host,
            prefs: sshAiPrefs,
            model: sshAiPrefs.aiModel || 'auto',
            history: aiConversationRef.current.slice(-8).slice(0, -1),
          }),
        });

        const contentType = streamRes.headers.get('content-type') || '';
        if (!streamRes.ok || !contentType.includes('text/event-stream') || !streamRes.body) {
          throw new Error('Streaming not available');
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const safeNarration = (text) => {
          // Keep UI simple: show only a short preview and hide raw <thought> content.
          const cleaned = String(text || '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '<thought>[hidden]</thought>')
            .replace(/\s+/g, ' ')
            .trim();
          return cleaned.slice(-220);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventName = 'message';
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              if (line.startsWith('data:')) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;

            let payload = null;
            try { payload = JSON.parse(dataLine); } catch { payload = null; }

            if (eventName === 'delta') {
              const delta = payload?.content || '';
              if (delta) {
                streamedAnswer += delta;
                setAiStreamText(safeNarration(streamedAnswer));
              }
            }
            if (eventName === 'final') {
              data = payload;
            }
            if (eventName === 'error') {
              throw new Error(payload?.error || 'Streaming error');
            }
          }
        }

        if (!data?.success) {
          // Sometimes final may not arrive; fallback to using streamedAnswer
          data = { success: true, answer: streamedAnswer, usedModel: null, usage: null };
        }
      } catch (streamErr) {
        setAiStreaming(false);
        setAiStreamText('');
        // Fallback to classic JSON API call
        const res = await apiFetch('/api/ssh/ai-help', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            context: getOutputContext().slice(-2500),
            contextPack: buildAiContextPack(),
            connectionName,
            host,
            prefs: sshAiPrefs,
            model: sshAiPrefs.aiModel || 'auto',
            history: aiConversationRef.current.slice(-8).slice(0, -1),
          }),
        });
        data = await res.json();
      }

       let parsed = null;
       if (data.success) {
         parsed = parseAiAnswer(data.answer, { usedModel: data.usedModel });
         setAiAnswer(parsed);
         setSshAiHistory([{ prompt: effectivePrompt, answer: data.answer, date: new Date().toISOString() }, ...sshAiHistory].slice(0, 50));
       } else {
        if (data.error && /limit|quota|exceeded/i.test(data.error)) {
          setAiLimitHit(true);
          setAiLimitGoal(effectivePrompt);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return null;
        }
        throw new Error(data.error || 'AI request failed');
      }
      setLastAiUpdate(Date.now());

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

      // Track AI response in conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'assistant', content: data.answer }
      ].slice(-12);

      // Add AI response to chat history
      const aiMsg = { 
        id: Date.now() + 1, 
        role: 'assistant', 
        content: parsed?.explain || data.answer,
        command: parsed?.command,
        danger: parsed?.danger,
        done: parsed?.done,
        warn: parsed?.warn,
        plan: parsed?.plan,
        thought: parsed?.thought,
        timestamp: new Date()
      };
      setChatHistory(prev => [...prev, aiMsg]);

      if (parsed) {
        const entry = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          createdAt: Date.now(),
          type: 'manual',
          prompt: effectivePrompt,
          command: parsed.command,
          explain: parsed.explain,
          danger: parsed.danger,
          warn: parsed.warn,
          done: parsed.done,
        };

        // De-duplicate by prompt+command (keep most recent)
        const next = [entry, ...sshAiHistory.filter(h => !(h?.prompt === entry.prompt && h?.command === entry.command))].slice(0, 30);
        setSshAiHistory(next);
      }

      return parsed;
    } catch (e) {
      setAiError(String(e?.message || e));
    } finally {
      setAiLoading(false);
      setAiStreaming(false);
      setAiStreamText('');
    }
  };

  const runAutoStep = async (snapshotOverride) => {
    if (!isLoggedIn) return;
    // Use refs instead of closed-over state — fixes stale-state bug when called from setTimeout
    if (aiModeRef.current !== 'auto') return;
    if (!autoModeRef.current) return;
    if (autoRunningRef.current) return;
    if (Number.isFinite(autoStepsRemaining) && autoStepsRemaining <= 0) {
      setAiError(t('ai.autoFinished'));
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
      return;
    }

    const goal = String(autoGoal || aiPrompt || '').trim();
    if (!goal) {
      setAiError(t('ai.goalRequired'));
      setAutoMode(false);
      return;
    }

    let snap = String(snapshotOverride ?? lastResultSnapshot ?? getOutputContext() ?? '').trim();
    const err = detectTerminalError(snap);

    // Loop detection
    const loopKey = `${lastExecutedCommand || ''}::${normalizeForLoop(snap).slice(-200)}`;
    if (autoLastLoopKeyRef.current === loopKey) {
      autoLoopRepeatRef.current += 1;
    } else {
      autoLastLoopKeyRef.current = loopKey;
      autoLoopRepeatRef.current = 0;
    }
    if (autoLoopRepeatRef.current >= 5) {
      setAiError('Auto Mode stopped: output did not change for 5 consecutive steps. The AI may be stuck in an unresolvable state.');
      setAutoMode(false);
      return;
    }

    const curSig = computeErrorSignature(snap);
    const curKey = `${String(lastExecutedCommand || '').trim()}::${curSig}`;
    if (autoRepeatSigRef.current.key === curKey) {
      autoRepeatSigRef.current.count += 1;
      // After 2 repeats, reset so the AI gets a fresh attempt with richer context
      if (autoRepeatSigRef.current.count >= 2) {
        autoRepeatSigRef.current = { key: curKey, count: 0 };
      }
    } else {
      autoRepeatSigRef.current = { key: curKey, count: 0 };
    }

    const editorType = looksLikeEditorOrPager(snap);
    const interactive = detectInteractivePrompt(snap);
    const isStillRunning = !looksLikeShellPrompt(snap);
    
    let terminalStatus = isStillRunning ? 'RUNNING (No prompt yet)' : 'IDLE (Prompt detected)';
    if (editorType) terminalStatus = `INTERACTIVE PAGER/EDITOR ACTIVE (${editorType})`;
    else if (interactive) terminalStatus = `INTERACTIVE PROMPT DETECTED (${interactive.kind})`;

    autoRunningRef.current = true;
    try {
      // Build rich failure context from recent command history
      const recentHistory = autoRecentCommandsRef.current.slice(-5).join(' → ');
      const failureNote = autoRepeatSigRef.current.count > 0
        ? `\n- REPEATED FAILURE (${autoRepeatSigRef.current.count}x): The last approach did not work. You MUST try a completely DIFFERENT approach. Do NOT repeat the same command.`
        : '';
        
      let runningNote = '';
      if (editorType) {
        runningNote = `\n- ALERT: Terminal is in a PAGER (${editorType}). You MUST press 'q' to quit or 'ENTER' to scroll. Use <command>q</command> or <command>[Wait]</command>.`;
      } else if (interactive) {
        runningNote = `\n- ALERT: INTERACTIVE PROMPT DETECTED (${interactive.kind}). Use the <command> tag to answer it (e.g. <command>y</command> or <command>password</command>).`;
      } else if (isStillRunning) {
        runningNote = `\n- ALERT: The terminal is STILL RUNNING your last command. DO NOT send a new command. Use [Wait] to allow more time. If it is a long output, use [Ctrl+C].`;
      }

      // === OS / Package Manager Detection (persistent across steps) ===
      const osFromSnap = isMacOs => isMacOs ? 'macOS (Darwin)'
        : /ubuntu|debian/i.test(snap) ? 'Ubuntu/Debian'
        : /centos|rhel|red hat/i.test(snap) ? 'CentOS/RHEL'
        : /fedora/i.test(snap) ? 'Fedora'
        : /alpine/i.test(snap) ? 'Alpine Linux'
        : /arch linux/i.test(snap) ? 'Arch Linux'
        : null;
      const isMacOs = /darwin|macos|mac os x|apple m[0-9]|homebrew|sw_vers|ProductName:\s*mac/i.test(snap);
      const freshOs = osFromSnap(isMacOs);
      if (freshOs && !detectedOsRef.current) detectedOsRef.current = freshOs;
      if (isMacOs && detectedOsRef.current !== 'macOS (Darwin)') detectedOsRef.current = 'macOS (Darwin)';
      const detectedOs = detectedOsRef.current;
      const osNote = detectedOs ? `\n- OS: ${detectedOs}` : '';
      const macOsRule = (detectedOs === 'macOS (Darwin)' || isMacOs)
        ? `\n- CRITICAL: This is macOS. NEVER use apt-get, apt, yum, dnf, snap or rpm. Use 'brew' (Homebrew) ONLY. If brew is unavailable, install it first.`
        : '';

      // FORCE AUTOMATIC WAIT: if clearly busy with no prompt, don't even ask AI - just wait 4 seconds and retry.
      // We only call the AI if we are TRULY stuck (no output for >20s) or have an error/prompt.
      // This saves a lot of tokens during long installations.
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      const isInteractionNeeded = err || detectInteractivePrompt(snap) || looksLikeEditorOrPager(snap);
      
      // Give heavy installers up to 60s of silence before bothering the AI, otherwise 20s.
      const cmdLower = String(lastExecutedCommand || '').toLowerCase();
      const isHeavy = /install|build|deploy|setup|create-next-app|npx|npm|dnf|yum|apt|pacman|pip|gem|cargo|brew/.test(cmdLower);
      const maxIdleTime = isHeavy ? 60000 : 20000;

      if (!isInteractionNeeded && isStillRunning && idleFor < maxIdleTime) {
         const waitTime = isHeavy ? 4 : 1.5;
         setAutoCountdown(Math.ceil(waitTime));
         if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
         autoTimerRef.current = setTimeout(() => {
           runAutoStep();
         }, waitTime * 1000);
         autoRunningRef.current = false; // Allow the timed retry to run
         return; 
      }

      // === Goal intent detection (for safety guard below) ===
      const goalLower = String(goal || '').toLowerCase();
      const isRemoveGoal = /\b(remove|uninstall|delete|purge|deinstall|get rid of|clean up)\b/.test(goalLower);
      const isInstallGoal = /\b(install|setup|set up|deploy|add|enable)\b/.test(goalLower) && !isRemoveGoal;

      // Evidence in the terminal that removal already succeeded
      const snapLower = String(snap || '').toLowerCase();
      const removalDoneSignals = [
        /successfully removed/i, /successfully uninstalled/i, /removal complete/i,
        /uninstalled/i, /removed/i, /purged/i,
        /no such file or directory/i, /not found/i, /is not installed/i,
        /package.*not installed/i, /nothing to uninstall/i, /already uninstalled/i,
      ];
      const removalSuccess = isRemoveGoal && removalDoneSignals.some(r => r.test(snapLower));
      const removalSuccessHint = removalSuccess
        ? `\n- NOTE: Terminal output ALREADY shows the removal succeeded or package is not present. You MUST set <done>true</done> NOW. Do NOT reinstall.`
        : '';

      // Evidence that installation succeeded
      const installDoneSignals = [
        /successfully installed/i, /installation complete/i, /installed successfully/i,
        /already installed/i, /is up to date/i, /nothing to install/i,
        /successfully started/i, /running.*active/i, /enabled/i,
      ];
      const installSuccess = isInstallGoal && installDoneSignals.some(r => r.test(snapLower));
      const installSuccessHint = installSuccess
        ? `\n- NOTE: Terminal output ALREADY shows the installation succeeded. You MUST verify with a quick check and set <done>true</done> if confirmed.`
        : '';

      // Low-steps warning (disabled in infinite mode)
      const lowStepsWarn = (Number.isFinite(autoStepsRemaining) && autoStepsRemaining <= 5)
        ? `\n- WARNING: Only ${autoStepsRemaining} steps remaining. Prioritize finishing or verifying. Set <done>true</done> if goal is met.`
        : '';

      const stepsDone = Array.isArray(autoStepHistory) ? autoStepHistory.length : 0;
      const progressLine = Number.isFinite(MAX_AUTO_STEPS)
        ? `Progress: ${MAX_AUTO_STEPS + 1 - autoStepsRemaining}/${MAX_AUTO_STEPS}.`
        : `Progress: ${stepsDone + 1}/∞.`;

      // Smart context: try to extract ONLY output after last command (saves tokens & reduces stale context)
      const extractPostCommandContext = (fullSnap, lastCmd) => {
        if (!lastCmd) return fullSnap;
        const lines = fullSnap.split('\n');
        // Find the last occurrence of the command in the output
        let cmdIdx = -1;
        const cmdTrimmed = String(lastCmd).trim().slice(0, 80); // Use first 80 chars as search key
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].includes(cmdTrimmed)) { cmdIdx = i; break; }
        }
        // If found, return lines after it; otherwise return full context
        if (cmdIdx >= 0 && cmdIdx < lines.length - 2) {
          return lines.slice(cmdIdx + 1).join('\n');
        }
        return fullSnap;
      };
      const postCmdContext = extractPostCommandContext(snap, lastExecutedCommand);
      // Use post-command context if it's meaningful (>50 chars), otherwise use full snap
      const contextToSend = postCmdContext.trim().length > 50 ? postCmdContext : snap;

      const isReadOnlyCommand = (cmd) => {
        const s = String(cmd || '').trim().toLowerCase();
        if (!s) return false;
        return /^(cat|head|tail|grep|rg|sed\s+-n|awk|cut|ls|stat|wc|find|test|\[)/.test(s);
      };

      const patchFirstAutoRules = (sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false)
        ? `\nPATCH-FIRST AUTO RULES (CODE MODE):\n- You MAY use <command> ONLY for reading/verifying (cat/head/tail/grep/test).\n- After reading the relevant files, you MUST output a <diff> that updates ALL required .md files (e.g. HEARTBEAT.md AND AGENTS.md) in ONE response if possible.\n- Never output file-write commands (sed -i, cat > file, tee, printf > file). The UI will apply the patch.\n- Do NOT loop on cat; if you already have the file content in context, move on to <diff>.\n`
        : '';

      const recentReadOnlyCount = (autoRecentCommandsRef.current || []).slice(-6).filter(isReadOnlyCommand).length;
      const forceDiffNowRule = (sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false && recentReadOnlyCount >= 2)
        ? `\nIMPORTANT: You have already performed enough reads. STOP issuing read commands and output ONLY a <diff> now. Leave <command> empty.`
        : '';

      const autoPrompt = `[AUTO] Goal: ${goal}
State:
- Status: ${terminalStatus}${runningNote}${osNote}${macOsRule}${removalSuccessHint}${installSuccessHint}${lowStepsWarn}
- Last Cmd: ${lastExecutedCommand || '(none)'}
- Error: ${err ? err.label : 'none'}${failureNote}
- Recent steps: ${recentHistory || '(none)'}
- Output (since last command):
${String(contextToSend || '(no output)').slice(-4000)}

RULES:
1. If the goal was to REMOVE/UNINSTALL and the output shows it is gone or was not installed → <done>true</done> IMMEDIATELY.
2. If the goal was to INSTALL and it is now installed and running → <done>true</done> IMMEDIATELY.
3. VERIFY the last command result before proceeding.
4. COMMAND: 1 shell command, [Wait], or [Ctrl+C]. NEVER install when goal is remove.
5. macOS=brew, Linux=apt/dnf. No editors (nano/vim). use cat <<EOF.
6. ${progressLine}${patchFirstAutoRules}${forceDiffNowRule}`;

      // Add to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: autoPrompt }
      ].slice(-6); // Tight history: 6 turns is enough when output is present

      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: autoPrompt,
          context: String(snap || '').slice(-2500),
          contextPack: buildAiContextPack(snap),
          connectionName,
          host,
          prefs: sshAiPrefs,
          model: sshAiPrefs.aiModel || 'auto',
          history: aiConversationRef.current.slice(-12),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.error && /limit|quota|exceeded/i.test(data.error)) {
          setAiLimitHit(true);
          setAiLimitGoal(goal);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          setAiError(null);
          return;
        }
        throw new Error(data.error || 'AI request failed');
      }

      apiRetryCountRef.current = 0; // Reset on success

      const parsed = parseAiAnswer(data.answer, { usedModel: data.usedModel });
      setAiAnswer(parsed);
      
      // Update step history for the UI
      if (parsed.command) {
        setAutoStepHistory(prev => [...prev, {
          command: parsed.command,
          explain: parsed.explain || 'Executing command...',
          status: parsed.done ? 'success' : 'running'
        }].slice(-10)); // Keep last 10 steps in view
      }

      // Track AI response — keep only last 12 turns
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'assistant', content: data.answer }
      ].slice(-12);

      // === AI says DONE ===
      if (parsed.done) {
        setAiError(null);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        // Show a clear DONE status
        setAiDone(true);
        // ✅ Save completed session to sshAiHistory
        setAutoStepHistory(prev => {
          const finalSteps = [...prev, {
            command: parsed.command,
            explain: parsed.explain || 'Task complete.',
            status: 'success',
          }];
          // Build summary for the popup
          setAiDoneSummary({
            goal,
            steps: finalSteps.slice(-30),
            taskMode: sshAiPrefs.aiTask || 'ssh',
            thought: parsed.thought || null,
            explain: parsed.explain || null,
          });
          const sessionEntry = {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
            createdAt: Date.now(),
            type: 'auto',
            prompt: goal,
            steps: finalSteps.slice(-30),
            done: true,
          };
          // Use setTimeout to avoid calling dispatch inside a state updater
          setTimeout(() => {
            setSshAiHistory([sessionEntry, ...sshAiHistory.filter(e => e?.id !== sessionEntry.id)].slice(0, 30));
          }, 0);
          return finalSteps;
        });
        return;
      }

      // === Dangerous command: pause for confirmation ===
      if (parsed.danger) {
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        setExecuteConfirmOpen(true);
        setAiError('Auto Mode paused: dangerous command requires confirmation.');
        setAutoMode(false);
        return;
      }

      // === Interactive command warning: predictive pause ===
      // Skip this pause if the user just manually resumed (bypassPasswordPauseRef is set)
      // We have reactive password handling via the terminal interactive prompt UI anyway.
      if (parsed.interactive && !sshAiPrefs?.strictAutoMode && !bypassPasswordPauseRef.current) {
        const interactiveType = String(parsed.interactive).toLowerCase();
        if (/(password|passphrase|multiple prompts)/i.test(interactiveType)) {
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          setAiError(`Auto Mode paused: command requires ${parsed.interactive}. Click Resume to proceed anyway.`);
          setAutoMode(false);
          return;
        }
      }
      bypassPasswordPauseRef.current = false; // consume the bypass after one step

      // === Patch-first auto mode: handle <diff> as an executable patch step ===
      if (parsed.diff && String(parsed.diff).trim() && sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false) {
        const d = String(parsed.diff).trim();
        if (!isValidUnifiedDiff(d)) {
          setPatchModalDiff(d);
          setPatchModalAutoApplied(false);
          setPatchModalOpen(true);
          setAiError('Auto Mode paused: AI returned a malformed diff patch. Please review/copy the patch, then Resume.');
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }
        // If the model repeats the exact same diff, it means the patch already applied
        // but the AI didn't observe the result yet and sent the same patch again.
        // Track repeat count — after 2 repeats, the patch has definitely been applied; force done.
        const patchRepeatKey = `patch::${d.slice(0, 120)}`;
        if (lastAutoAppliedDiffRef.current === d) {
          autoRepeatSigRef.current.count = (autoRepeatSigRef.current.key === patchRepeatKey)
            ? autoRepeatSigRef.current.count + 1
            : 1;
          autoRepeatSigRef.current.key = patchRepeatKey;

          if (autoRepeatSigRef.current.count >= 2) {
            // Patch was already applied — AI is in a loop. Treat as done.
            setAiError(null);
            setAutoMode(false);
            setAiDone(true);
            setAiOpen(true);
            setAiHasOpenedOnce(true);
            setAiDoneSummary({
              goal,
              steps: autoStepHistory,
              taskMode: sshAiPrefs?.aiTask || 'code',
              explain: '✅ Patch was successfully applied. AI confirmed via re-check.',
            });
            return;
          }

          // First repeat — give it one more chance to confirm and declare done
          setAiError(null);
          setAutoCountdown(4);
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => {
            autoRunningRef.current = false;
            runAutoStep();
          }, 4000);
          return;
        }
        // Reset repeat counter when a new diff appears
        autoRepeatSigRef.current = { key: patchRepeatKey, count: 0 };

        setPatchModalDiff(d);
        setPatchModalOpen(true);

        if (!sshAiPrefs?.autoApplyPatch) {
          setPatchModalAutoApplied(false);
          setAiError('Auto Mode paused: patch requires review. Click Apply Patch, then Resume.');
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }

        // Auto-apply patch with backup, then continue
        lastAutoAppliedDiffRef.current = d;
        const backupId = `${Date.now().toString(36)}`;
        setPatchModalAutoApplied(true);
        setLastPatchResultData(null); // Clear for new run
        setPatchModalOpen(true);

        // Apply via SFTP + diff-match-patch
        applyPatchViaSftp(d, backupId).then((result) => {
          const files = result.files || [];
          setLastPatchBackup({ id: backupId, files });
          setLastPatchResultData(result.results || null);
          if (!result.success) {
            setAiError(`Auto Mode: Patch failed — ${result.error || result.summary || 'Unknown error'}`);
          }
        });

        // Auto-close modal after 4 seconds to keep UI clean
        setTimeout(() => {
          setPatchModalOpen(prev => {
            if (prev && lastAutoAppliedDiffRef.current === d) return false;
            return prev;
          });
        }, 4000);

        // Continue after a short delay to let the patch complete
        setAutoCountdown(5);
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          autoRunningRef.current = false;
          runAutoStep();
        }, 5000);
        return;
      }

      // === No command and not done: AI is stuck ===
      if (!parsed.command || !String(parsed.command).trim()) {
        const needRetryKey = `${goal}::${lastExecutedCommand || ''}::${snap.slice(-100)}`;
        if (autoEmptyRetryRef.current !== needRetryKey) {
          // Retry once after a short delay — do NOT recurse directly to avoid race
          autoEmptyRetryRef.current = needRetryKey;
          autoRunningRef.current = false; // release lock before scheduling
          if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
          autoTimerRef.current = setTimeout(() => runAutoStep(snap), 800);
          return;
        }

        setAiError('Auto Mode stopped: AI could not determine next command. Click Resume to try again.');
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      autoEmptyRetryRef.current = '';

      // === Safety guard: block installs when goal is to remove ===
      const cmdTrimLower = String(parsed.command || '').toLowerCase();
      const isInstallCmd = /\b(install|add|enable|setup)\b/.test(cmdTrimLower) &&
        !/(remove|uninstall|purge|delete)/.test(cmdTrimLower);
      if (isRemoveGoal && isInstallCmd) {
        setAiError('Auto Mode stopped: AI tried to INSTALL when the goal was to REMOVE. This looks like a loop. Please check manually.');
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      // === Client-side: if removal clearly succeeded, force done ===
      if (removalSuccess && !parsed.command) {
        setAiError(null);
        setAutoMode(false);
        setAiDone(true);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      // === Hard loop guard: same command repeated ===
      // If the model keeps sending the exact same command repeatedly (common for sed/cat edits), stop auto mode.
      const nextCmdTrim = String(parsed.command || '').trim();
      if (nextCmdTrim) {
        if (autoSameCommandRef.current.cmd === nextCmdTrim) {
          autoSameCommandRef.current.count += 1;
        } else {
          autoSameCommandRef.current = { cmd: nextCmdTrim, count: 0 };
        }
        if (autoSameCommandRef.current.count >= 3 && isReadOnlyCommand(nextCmdTrim) && sshAiPrefs?.aiTask === 'code' && sshAiPrefs?.enforcePatch !== false) {
          // Check if this is a file read that keeps returning empty — likely wrong path
          const catMatch = nextCmdTrim.match(/^(cat|head|tail)\s+(.*)/i);
          const wrongPathHint = catMatch ? `\n\n⚠️ PATH ERROR: The command '${nextCmdTrim}' was repeated ${autoSameCommandRef.current.count + 1} times. This file likely doesn't exist at this path. Check SSH memory for the correct absolute path. If the file is HEARTBEAT.md, it is likely at /home/ubuntu/.zeroclaw/workspace/HEARTBEAT.md` : '';
          setAiError(`Auto Mode stopped: AI kept running read-only commands without making any changes.${wrongPathHint}`);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }
        if (autoSameCommandRef.current.count >= 2 && !isReadOnlyCommand(nextCmdTrim)) {
          setAiError('Auto Mode stopped: AI repeated the same command multiple times. Please run manually or adjust the goal.');
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }
      }

      // === Execute the command ===
      setAutoStepsRemaining((n) => (Number.isFinite(n) ? Math.max(0, n - 1) : n));
      const cmdTrim = String(parsed.command || '').trim();
      if (cmdTrim) {
        autoRecentCommandsRef.current = [...autoRecentCommandsRef.current, cmdTrim].slice(-8);
        autoRecentSigsRef.current = [...autoRecentSigsRef.current, computeErrorSignature(snap)].slice(-8);
        if (autoRecentCommandsRef.current.length >= 6) {
          const a = autoRecentCommandsRef.current[autoRecentCommandsRef.current.length - 1];
          const b = autoRecentCommandsRef.current[autoRecentCommandsRef.current.length - 2];
          const c = autoRecentCommandsRef.current[autoRecentCommandsRef.current.length - 3];
          const d = autoRecentCommandsRef.current[autoRecentCommandsRef.current.length - 4];
          if (a === c && b === d && a !== b) {
            if (!(isReadOnlyCommand(a) && isReadOnlyCommand(b) && isReadOnlyCommand(c) && isReadOnlyCommand(d))) {
              setAiError('Auto Mode stopped: repeating a command cycle (loop detected).');
              setAutoMode(false);
              setAiOpen(true);
              setAiHasOpenedOnce(true);
              return;
            }
          }
        }
      }
      const newSnap = await executeCommandAndCapture(parsed.command);

    } catch (e) {
      if (apiRetryCountRef.current < 2) {
        apiRetryCountRef.current += 1;
        console.warn(`AI API failed, retrying (${apiRetryCountRef.current}/3)...`, e);
        setAutoCountdown(5);
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          runAutoStep(snap);
        }, 5000);
        return;
      }
      setAiError(e.message);
      setAutoMode(false);
      apiRetryCountRef.current = 0;
    } finally {
      autoRunningRef.current = false;
    }
  };

  // Scroll to bottom when AI content updates
  useEffect(() => {
    if (aiPanelContentRef.current) {
      aiPanelContentRef.current.scrollTop = aiPanelContentRef.current.scrollHeight;
    }
  }, [aiAnswer, aiError, interactivePrompt, autoCountdown, executeConfirmOpen]);

  useEffect(() => {
    if (aiMode !== 'auto') return;
    if (!autoMode) return;
    if (!lastResultAt) return;

    setAutoCountdown(0);
    const timer = setTimeout(() => {
      runAutoStep(lastResultSnapshot);
    }, 50); // Instant transition (50ms)

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, autoMode, lastResultAt]);

  // Countdown timer logic
  useEffect(() => {
    if (autoCountdown <= 0) return;
    const timer = setInterval(() => {
      setAutoCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoCountdown]);

  useEffect(() => {
    if (aiMode === 'manual' && autoMode) {
      setAutoMode(false);
    }
  }, [aiMode, autoMode]);

  const handleInsertCommand = (cmd) => {
    const command = String(cmd || '').replace(/[\r\n]+$/g, '');
    if (!command) return;
    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', command);
      termInstanceRef.current?.focus();
      return;
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.focus();
    }
  };

  const handleExecuteCommand = (cmd, bypassSensitive = false) => {
    const command = String(cmd || '').replace(/[\r\n]+$/g, '');
    if (!command) return;
    
    // Check for sensitive operations if confirmation is enabled
    // Skip check for patch commands (they are safe, system-managed operations)
    const confirmSensitive = sshAiPrefs?.confirmSensitive !== false; // default true
    const isPatchCmd = command.startsWith('backup_id=') || command.includes('PATCH_EOF') || command.includes('patch_') || bypassSensitive;
    if (confirmSensitive && isSensitiveCommand(command) && !autoMode && !isPatchCmd) {
      setPendingSensitiveCommand(command);
      setSensitiveConfirmOpen(true);
      return;
    }
    
    executeCommandInternal(command);
  };

  const executeCommandInternal = (command) => {
    setLastExecutedCommand(command);
    if (socketRef.current?.connected) {
      if (/^\[?ctrl\+c\]?$|^\^c$/i.test(command)) {
        socketRef.current.emit('ssh:input', '\x03');
      } else {
        socketRef.current.emit('ssh:input', `${command}\n`);
      }
      termInstanceRef.current?.focus();
      setTimeout(() => {
        const snap = getOutputContext();
        setLastResultSnapshot(snap);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });

        maybeHandleInteractivePrompt(snap);
      }, 700);
      return;
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.focus();
    }
  };

  useEffect(() => {
    const cleanup = initTerminal();

    return () => {
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(fn => fn && fn());
      }
      if (socketRef.current) {
        socketRef.current.emit('ssh:disconnect');
        socketRef.current.disconnect();
      }
      if (termInstanceRef.current) {
        termInstanceRef.current.dispose();
        termInstanceRef.current = null;
      }
    };
  }, [initTerminal, reconnectNonce]);

  const handleReconnect = () => {
    try {
      if (socketRef.current) {
        socketRef.current.emit('ssh:disconnect');
        socketRef.current.disconnect();
      }
    } catch (e) {}

    try {
      if (termInstanceRef.current) {
        termInstanceRef.current.dispose();
        termInstanceRef.current = null;
      }
    } catch (e) {}

    setErrorMsg(null);
    setLatency(null);
    setStatus('connecting');
    idleTimedOutRef.current = false;
    setShowReconnect(false);
    setReconnectNonce((n) => n + 1);
  };

  // Re-fit when tab becomes visible (throttled)
  useEffect(() => {
    if (status !== 'connected') return;
    
    const timeout = setTimeout(() => {
      if (fitAddonRef.current && terminalRef.current?.offsetParent) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {}
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [status]); // Only re-fit on status changes or mount

  // Heartbeat loop for latency monitoring
  useEffect(() => {
    let interval;
    if (status === 'connected' && socketRef.current) {
      interval = setInterval(() => {
        if (socketRef.current.connected) {
          socketRef.current.emit('heartbeat:ping', Date.now());
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status]);

  const getStatusInfo = () => {
    switch (status) {
      case 'connecting':
        return { icon: <Loader2 size={12} className="animate-spin" />, text: t('terminal.status.connecting'), color: 'var(--accent-amber)' };
      case 'connected':
        return { icon: <CheckCircle2 size={12} />, text: t('terminal.status.connected'), color: 'var(--accent-emerald)' };
      case 'error':
        return { icon: <AlertCircle size={12} />, text: t('terminal.status.error'), color: 'var(--accent-rose)' };
      case 'closed':
        return { icon: <XCircle size={12} />, text: t('terminal.status.disconnected'), color: 'var(--text-muted)' };
      default:
        return { icon: null, text: '', color: '' };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Terminal title bar - hidden in standalone mode since Window title shows server name */}
      {isStandalone && (
        <div className="h-10 flex items-center px-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPatchModalOpen(false);
                setPatchModalDiff('');
                setPatchModalAutoApplied(false);
                setLastPatchBackup(null);
                onClose?.();
              }}
              className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group"
              aria-label="Close"
            >
              <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
            </button>
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]/30 flex items-center justify-center group"
              aria-label="Minimize"
            >
              <Minus size={8} className="opacity-0 group-hover:opacity-100 text-[#4d2d00] transition-opacity" />
            </button>
            <button
              type="button"
              className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1fa530]/30 flex items-center justify-center group"
              aria-label="Maximize"
            >
              <Maximize2 size={8} className="opacity-0 group-hover:opacity-100 text-[#003300] transition-opacity" />
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center select-none">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <div className="w-2 h-2 rounded-full" style={{ background: color || '#6366f1' }} />
              <span className="truncate max-w-[55vw]">{connectionName}</span>
              <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[35vw]">— {host}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs" style={{ color: statusInfo.color }}>
            {statusInfo.icon}
            <span>{statusInfo.text}</span>
          </div>
        </div>
      )}

      {/* Terminal body */}
      <div className="flex-1 relative bg-transparent min-h-0 overflow-hidden group/term">
        {/* Floating Latency Badge (Visible in all modes) */}
        {latency !== null && status === 'connected' && (
          <div 
            className="absolute top-3 right-5 z-20 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 shadow-lg opacity-80 group-hover/term:opacity-100 transition-all pointer-events-none"
            style={{ 
              color: latency < 150 ? '#4ade80' : latency < 300 ? '#fbbf24' : '#f43f5e' 
            }}
          >
            <Wifi size={10} strokeWidth={3} />
            <span className="font-mono tracking-tighter">{latency}ms</span>
          </div>
        )}

        <div
          className="h-full w-full p-3" // Padding moved here to avoid breaking FitAddon
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const sshFileData = e.dataTransfer.getData('application/ssh-file');
            if (sshFileData && termInstanceRef.current) {
              try {
                const data = JSON.parse(sshFileData);
                if (data.filePath) {
                  termInstanceRef.current.write(data.filePath);
                }
              } catch (err) {
                console.error('Drop data parse error:', err);
              }
              return;
            }

            // Fallback for standard files
            const files = e.dataTransfer.files;
            if (files.length > 0 && termInstanceRef.current) {
              const fileNames = Array.from(files).map(f => `'${f.name}'`).join(' ');
              termInstanceRef.current.write(fileNames + ' ');
            }
          }}
        >
          <div 
            ref={terminalRef} 
            className={`h-full w-full terminal-container ${osState?.terminalSettings?.activePreset === 'retro' ? 'pip-boy-terminal' : ''}`} 
            style={{ fontFamily: osState?.terminalSettings?.activePreset === 'retro' ? 'VT323, monospace' : 'inherit' }}
          />
        </div>

        {/* AI Processing Overlay — shown when auto mode is running */}
        {autoMode && (
          <div className="absolute inset-0 z-30 pointer-events-none flex items-end justify-end p-8">
            <div className="flex flex-col items-center gap-4 animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto">
              <div className="bg-black/80 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl shadow-emerald-500/10 flex flex-col items-center gap-3 max-w-[280px] text-center">
                <div className="relative">
                  <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full animate-pulse" />
                  <div className="relative bg-black/40 border border-emerald-500/30 p-3 rounded-xl">
                    <Sparkles className="text-emerald-400 animate-pulse" size={24} />
                  </div>
                  <div className="absolute -top-1 -right-1 bg-emerald-500 rounded-full p-1 border-2 border-black">
                    <Lock size={10} className="text-black" />
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="text-sm font-bold text-emerald-300 tracking-tight">AI Control Active</div>
                  <div className="text-[11px] text-emerald-400/60 leading-relaxed">Terminal is locked while AI is executing your goal.</div>
                </div>

                <div className="w-full h-px bg-white/5 my-1" />

                <div className="flex items-center gap-2 text-[10px] text-emerald-400/80 font-mono">
                  <span className="animate-ping w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Step {(Array.isArray(autoStepHistory) ? autoStepHistory.length : 0) + 1} <span className="opacity-40">/</span> {Number.isFinite(MAX_AUTO_STEPS) ? MAX_AUTO_STEPS : '∞'}
                </div>

                <button
                  onClick={() => setAutoMode(false)}
                  className="mt-2 w-full py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all active:scale-95"
                >
                  STOP AI & UNLOCK
                </button>
              </div>
            </div>
          </div>
        )}

        {showReconnect && (
          <div className="absolute top-3 left-5 z-50 flex items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={handleReconnect}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20 border border-blue-500/40 transition-colors"
              title="Reconnect"
            >
              <RefreshCw size={14} />
              <span>Reconnect</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (!isLoggedIn) {
              setAiOpen(true);
              setAiHasOpenedOnce(true);
              setAiError('Login required to use AI helper.');
              setAiAnswer(null);
              return;
            }
            setAiOpen(v => !v);
            setAiHasOpenedOnce(true);
            setAiError(null);
            setAiAnswer(null);
          }}
          className={`absolute bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)]/80 hover:bg-[var(--bg-secondary)] border border-[var(--border-color)]/60 backdrop-blur-xl shadow-lg text-xs font-semibold transition-all ${!aiHasOpenedOnce ? 'ring-2 ring-[var(--accent-indigo)]/30 shadow-[var(--glow-indigo)]' : ''}`}
          style={{ color: 'var(--text-primary)' }}
          title={isLoggedIn ? 'AI Command Helper' : 'Login required'}
        >
          {!aiHasOpenedOnce && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
            </span>
          )}
          {isLoggedIn ? (
            <Sparkles size={14} className="text-[var(--accent-indigo)]" />
          ) : (
            <ShieldAlert size={14} className="text-[var(--accent-amber)]" />
          )}
          AI
        </button>

        {aiOpen && createPortal(
          <Rnd
            size={aiPanelSize}
            position={aiPanelPos}
            onDragStop={(e, d) => setAiPanelPos({ x: d.x, y: d.y })}
            onResizeStop={(e, dir, ref, delta, pos) => {
              setAiPanelSize({ width: ref.offsetWidth, height: ref.offsetHeight });
              setAiPanelPos(pos);
            }}
            minWidth={320}
            minHeight={280}
            dragHandleClassName="ai-panel-drag-handle"
            cancel="button,input,textarea,select,option,label"
            className="z-50"
            style={{ position: 'fixed' }}
          >
            <div className="w-full h-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 backdrop-blur-2xl shadow-2xl overflow-hidden flex flex-col relative">
              {/* Header */}
              <div className="ai-panel-drag-handle flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 dark:bg-black/20">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[var(--accent-indigo)]" />
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('ai.title')}</span>
                  {autoMode && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--glow-emerald)] text-[var(--accent-emerald)] animate-pulse">{t('ai.running')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setAiHistoryOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.history')} style={{ color: 'var(--text-secondary)' }}><Clock size={12} /></button>
                  <button type="button" onClick={() => setAiSettingsOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.settings')} style={{ color: 'var(--text-secondary)' }}><Settings2 size={12} /></button>
                  <button 
                    type="button" 
                    onClick={() => setAutoTranslate(v => !v)} 
                    className={`p-1.5 rounded transition ${autoTranslate ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5 text-[var(--text-secondary)] hover:text-indigo-400'}`} 
                    title={t('wiki.autoTranslate')}
                  >
                    <Languages size={12} />
                  </button>
                  <button type="button" onClick={() => { setAiOpen(false); setAiSettingsOpen(false); setAiHistoryOpen(false); }} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.close')} style={{ color: 'var(--text-secondary)' }}><X size={12} /></button>
                </div>
              </div>

              {/* Popovers */}
              {aiHistoryOpen && (
                <div className="absolute top-10 left-2 right-2 z-50 rounded-xl border border-white/10 bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>History</span>
                    <div className="flex gap-2">
                      <button onClick={() => setSshAiHistory([])} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>Clear</button>
                      <button onClick={() => setAiHistoryOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>Close</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {sshAiHistory.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] opacity-60" style={{ color: 'var(--text-muted)' }}>No history</div>
                    ) : (
                      sshAiHistory.slice(0, 20).map((h) => {
                        const isAuto = h?.type === 'auto';
                        const isExpanded = expandedHistoryId === (h.id || h.createdAt);
                        return (
                          <div key={h.id || h.createdAt} className="border-b border-white/5 last:border-0">
                            <button
                              onClick={() => {
                                if (isAuto) {
                                  setExpandedHistoryId(isExpanded ? null : (h.id || h.createdAt));
                                } else {
                                  setAiPrompt(h.prompt || '');
                                  setAiAnswer({ command: h.command || '', explain: h.explain || '', danger: !!h.danger, warn: h.warn || '', raw: '' });
                                  setAiError(null);
                                  setExecuteConfirmOpen(false);
                                  setAiHistoryOpen(false);
                                }
                              }}
                              className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 flex items-start gap-2"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              <span className={`mt-0.5 shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${
                                isAuto ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'
                              }`}>{isAuto ? 'AUTO' : 'ASK'}</span>
                              <div className="flex-1 min-w-0">
                                <div className="font-mono truncate opacity-80">{h.prompt}</div>
                                {!isAuto && h.command && (
                                  <div className="font-mono truncate opacity-50 text-[10px] mt-0.5">{h.command}</div>
                                )}
                                {isAuto && h.steps && (
                                  <div className="text-[9px] opacity-40 mt-0.5">{h.steps.length} steps · {h.done ? '✅ Done' : '⚠ Stopped'}</div>
                                )}
                              </div>
                              {isAuto && (
                                <span className="text-[10px] opacity-40 ml-1 shrink-0">{isExpanded ? '▲' : '▼'}</span>
                              )}
                            </button>
                            {isAuto && isExpanded && h.steps && (
                              <div className="px-3 pb-2 space-y-1 bg-black/20">
                                {h.steps.map((step, si) => (
                                  <div key={si} className="flex items-start gap-2 py-1 border-b border-white/5 last:border-0">
                                    <span className="text-[9px] font-bold text-[var(--text-muted)] mt-0.5 shrink-0 w-4">{si + 1}.</span>
                                    <div className="min-w-0">
                                      <div
                                        className="font-mono text-[10px] text-[var(--accent-indigo)] truncate cursor-pointer hover:whitespace-normal"
                                        onClick={() => {
                                          setAiPrompt(step.command);
                                          setAiHistoryOpen(false);
                                        }}
                                        title={step.command}
                                      >{step.command}</div>
                                      {step.explain && (
                                        <div className="text-[9px] opacity-60 mt-0.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>{step.explain}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {aiSettingsOpen && (
                <div className="absolute top-10 left-2 right-2 z-50 rounded-xl border border-white/10 bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('ai.settings')}</span>
                    <button onClick={() => setAiSettingsOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{t('ai.close')}</button>
                  </div>
                  <div className="p-3 space-y-3">
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>{t('ai.preferSudo')}</span>
                      <input type="checkbox" checked={!!sshAiPrefs.preferSudo} onChange={(e) => setSshAiPrefs({ preferSudo: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title="When enabled, Code Editor mode will propose changes as a patch (<diff>) for you to review/apply (VSCode-like).">
                      <span className="flex items-center gap-1.5">
                        <span className="text-emerald-400">🧩</span>
                        Enforce Patch-first
                      </span>
                      <input type="checkbox" checked={sshAiPrefs?.enforcePatch !== false} onChange={(e) => setSshAiPrefs({ enforcePatch: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title="When enabled, AI patches will be applied automatically (with backups). You can Rollback from the Patch Review modal.">
                      <span className="flex items-center gap-1.5">
                        <span className="text-indigo-400">⚡</span>
                        Auto-apply patches
                      </span>
                      <input type="checkbox" checked={!!sshAiPrefs?.autoApplyPatch} onChange={(e) => setSshAiPrefs({ autoApplyPatch: e.target.checked })} disabled={!isLoggedIn || sshAiPrefs?.enforcePatch === false || sshAiPrefs?.aiTask !== 'code'} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title="Automatically install and prepare tmux for AI to run background tasks without blocking the terminal.">
                      <span className="flex items-center gap-1.5">
                        <span className="text-blue-400">🔄</span>
                        Background AI Tasks (tmux)
                      </span>
                      <input type="checkbox" checked={!!sshAiPrefs?.autoTmux} onChange={(e) => setSshAiPrefs({ autoTmux: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }} title="Ask for confirmation before executing sensitive commands (rm -rf, disk operations, user deletion, etc.)">
                      <span className="flex items-center gap-1.5">
                        <ShieldAlert size={12} className="text-amber-400" />
                        Confirm Sensitive Ops
                      </span>
                      <input type="checkbox" checked={sshAiPrefs?.confirmSensitive !== false} onChange={(e) => setSshAiPrefs({ confirmSensitive: e.target.checked })} disabled={!isLoggedIn} />
                    </label>

                    {/* AI Task Mode */}
                    <div className="pt-1 space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest opacity-50" style={{ color: 'var(--text-muted)' }}>AI Task Mode</span>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => setSshAiPrefs({ aiTask: 'ssh' })}
                          disabled={!isLoggedIn}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${(!sshAiPrefs.aiTask || sshAiPrefs.aiTask === 'ssh') ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-black/20 border-white/10 text-[var(--text-muted)]'}`}
                          title="SSH Commands — AI sends terminal commands to achieve your goal"
                        >
                          💻 SSH Commands
                        </button>
                        <button
                          onClick={() => setSshAiPrefs({ aiTask: 'code' })}
                          disabled={!isLoggedIn}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${sshAiPrefs.aiTask === 'code' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-black/20 border-white/10 text-[var(--text-muted)]'}`}
                          title="Code / File Editor — AI writes or patches file content directly"
                        >
                          🗒 Code Editor
                        </button>
                      </div>
                      <p className="text-[9px] leading-tight opacity-50" style={{ color: 'var(--text-muted)' }}>
                        {(!sshAiPrefs.aiTask || sshAiPrefs.aiTask === 'ssh')
                          ? 'AI generates shell commands to run on the server.'
                          : 'AI writes/patches file content (JSON, TOML, scripts, agent files, etc). Use when you want to edit a file, not run commands.'}
                      </p>
                    </div>

                    <div className="pt-1">
                        <select value={sshAiPrefs.aiModel || 'auto'} onChange={(e) => setSshAiPrefs({ aiModel: e.target.value })} disabled={!isLoggedIn} className="w-full text-[11px] rounded bg-black/30 border border-white/10 px-2 py-1.5 outline-none focus:border-indigo-500/50" title="AI Model" style={{ color: 'var(--text-primary)' }}>
                          <option value="auto">✨ Auto Select (Recommended)</option>
                          <option value="llama-3.1-8b-instant">🥉 Llama 3.1 8B (Thinking)</option>
                          <option value="meta-llama/llama-4-scout-17b-16e-instruct">🥇 Llama 4 Scout (Primary)</option>
                          <option value="llama-3.3-70b-versatile">🥈 Llama 3.3 70B (Heavy/Large)</option>
                          <option value="manual">🛠 Custom (Manual Endpoint)</option>
                        </select>
                    </div>
                    {sshAiPrefs.aiModel === 'manual' && (
                      <div className="space-y-2 pt-2 border-t border-white/10">
                        <div className="flex gap-2 mb-2">
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', aiCustomModel: 'anthropic/claude-3.5-sonnet' })} className="text-[9px] px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors" title="Use OpenRouter Preset">
                             🌐 OpenRouter
                           </button>
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://api.openai.com/v1/chat/completions', aiCustomModel: 'gpt-4o' })} className="text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors" title="Use default OpenAI Endpoint">
                             🟢 OpenAI
                           </button>
                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'http://localhost:11434/v1/chat/completions', aiCustomModel: 'llama3.2' })} className="text-[9px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-colors" title="Use Ollama Local Preset">
                             🦙 Ollama
                           </button>
                        </div>
                        <input type="text" placeholder="Endpoint URL (e.g. https://api.openai.com/v1/chat/completions)" value={sshAiPrefs.aiEndpoint || ''} onChange={e => setSshAiPrefs({ aiEndpoint: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title="API Endpoint URL" />
                        <input type="password" placeholder="API Key" value={sshAiPrefs.aiApiKey || ''} onChange={e => setSshAiPrefs({ aiApiKey: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title="API Key" />
                        <input type="text" placeholder="Model Name (e.g. gpt-4o, openrouter/auto)" value={sshAiPrefs.aiCustomModel || ''} onChange={e => setSshAiPrefs({ aiCustomModel: e.target.value })} disabled={!isLoggedIn} className="w-full text-[10px] rounded bg-black/30 border border-white/10 px-2 py-1.5 focus:border-indigo-500/50 outline-none" style={{ color: 'var(--text-primary)' }} title="Custom Model Name" />
                      </div>
                    )}

                    {/* Save Button */}
                    <button
                      onClick={() => {
                        // Settings are already saved via setSshAiPrefs, just show feedback
                        setAiSettingsOpen(false);
                      }}
                      disabled={!isLoggedIn}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-white/30 text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-95 mt-2"
                    >
                      💾 Save Settings
                    </button>
                  </div>
                </div>
              )}


              {/* Floating Mode Toggle */}
              <div className="px-4 py-2 border-b border-white/5 bg-[var(--bg-secondary)]/50 backdrop-blur-xl">
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 p-2 flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex rounded-lg bg-[var(--bg-tertiary)]/50 dark:bg-black/20 p-1 border border-white/5">
                    <button
                      type="button"
                      onClick={() => { setAiMode('manual'); setAutoMode(false); }}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${aiMode === 'manual' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm text-indigo-400' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5 text-[var(--text-muted)]'}`}
                    >
                      {t('ai.manual')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiMode('auto')}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${aiMode === 'auto' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm text-emerald-400' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5 text-[var(--text-muted)]'}`}
                    >
                      {t('ai.auto')}
                    </button>
                  </div>
                  
                  <div className="flex flex-1 justify-end items-center gap-2">
                    {/* Server Memory Badge */}
                    {sshMemory && (sshMemory.os || sshMemory.installedTools?.length > 0) && (
                      <div 
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-bold cursor-help transition-colors hover:bg-purple-500/20"
                        title={
                          `Server Memory Context:\n` +
                          `OS: ${sshMemory.os || 'Unknown'}\n` +
                          `PkgMgr: ${sshMemory.packageManager || 'Unknown'}\n` +
                          `Tools: ${sshMemory.installedTools?.length || 0} known\n` +
                          `Services: ${sshMemory.runningServices?.length || 0} known\n` +
                          `Paths: ${sshMemory.keyPaths?.length || 0} known`
                        }
                      >
                        <Brain size={10} className="text-purple-400" />
                        <span className="uppercase tracking-wider">Brain Synced</span>
                      </div>
                    )}

                    {aiMode === 'auto' && (
                      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Engine Active</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div ref={aiPanelContentRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-10 space-y-4">

                {/* Chat History - Chat-like conversation */}
                {chatHistory.length > 0 && (
                  <div className="space-y-3">
                    {chatHistory.map((msg, idx) => (
                      <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* User Message */}
                        {msg.role === 'user' && (
                          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600/90 dark:bg-indigo-600/80 px-4 py-2.5 text-[12px] leading-relaxed text-white shadow-lg shadow-indigo-500/10">
                            <div className="flex items-center gap-1.5 mb-1 opacity-70">
                              <span className="text-[9px] font-bold uppercase tracking-wider">You</span>
                              <span className="text-[9px] opacity-50">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            {msg.content}
                          </div>
                        )}
                        
                        {/* AI Message */}
                        {msg.role === 'assistant' && (
                          <div className={`max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-3 text-[12px] leading-relaxed shadow-lg ${
                            msg.danger ? 'bg-red-500/10 border border-red-500/20 text-red-100' : 
                            msg.done ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-100' : 
                            'bg-[var(--bg-tertiary)]/60 border border-white/5 text-[var(--text-primary)]'
                          }`}>
                            <div className="flex items-center gap-1.5 mb-2">
                              <Sparkles size={12} className={msg.danger ? 'text-red-400' : msg.done ? 'text-emerald-400' : 'text-[var(--accent-indigo)]'} />
                              <span className={`text-[9px] font-bold uppercase tracking-wider ${msg.danger ? 'text-red-400' : msg.done ? 'text-emerald-400' : 'text-[var(--accent-indigo)]'}`}>
                                AI Assistant
                              </span>
                              <span className="text-[9px] opacity-40 text-[var(--text-muted)]">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            
                            {/* Message Content */}
                            <div className="space-y-2">
                              {msg.content && (
                                <div className="text-[12px] leading-relaxed">
                                  {autoTranslate && aiTranslations.explain && msg.content === parsed?.explain ? aiTranslations.explain : msg.content}
                                </div>
                              )}
                              
                              {msg.warn && (
                                <div className="flex gap-2 items-start text-amber-400 text-[11px]">
                                  <span>⚠️</span>
                                  <span>{msg.warn}</span>
                                </div>
                              )}
                              
                              {msg.thought && (
                                <div className="text-[10px] italic opacity-60 border-l-2 border-white/10 pl-2">
                                  💭 {msg.thought}
                                </div>
                              )}
                              
                              {msg.plan && (
                                <div className="text-[11px] space-y-2 bg-black/20 rounded-lg p-3 border border-white/5">
                                  <div className="font-bold text-indigo-400 mb-2 flex items-center gap-1.5">
                                    <ListChecks size={12} />
                                    Task Checklist
                                  </div>
                                  {msg.plan.split('\n').filter(l => l.trim()).map((line, i) => {
                                    const stepNum = i + 1;
                                    const isDone = msg.step > stepNum || msg.done;
                                    const isCurrent = stepNum === msg.step && !msg.done;
                                    return (
                                      <div key={i} className="flex items-start gap-2.5 transition-all duration-300">
                                        <span className={`mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold transition-all ${
                                          isDone 
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                            : isCurrent
                                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                                              : 'bg-white/5 text-white/30 border border-white/10'
                                        }`}>
                                          {isDone ? '✓' : isCurrent ? '⋯' : stepNum}
                                        </span>
                                        <span className={`flex-1 transition-all ${
                                          isDone 
                                            ? 'text-emerald-400 line-through decoration-emerald-500/30' 
                                            : isCurrent
                                              ? 'text-amber-300 font-medium'
                                              : 'text-white/50'
                                        }`}>
                                          {line.replace(/^[\d\.\s\)\-]{1,5}/, '').trim()}
                                          {isCurrent && <span className="ml-2 inline-block text-[8px] text-amber-400/70">(running...)</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {msg.command && (
                                <div className="mt-2 rounded-lg bg-black/40 border border-white/10 overflow-hidden">
                                  <div className="px-2 py-1 text-[8px] font-mono text-white/40 uppercase tracking-wider bg-black/20">💻 Command</div>
                                  <pre className="text-[10px] font-mono p-2 text-white/90">{msg.command}</pre>
                                </div>
                              )}
                              
                              {/* Action Buttons for AI messages with commands */}
                              {msg.command && (
                                <div className="flex items-center gap-1 pt-2 mt-2 border-t border-white/5">
                                  <button onClick={() => navigator.clipboard.writeText(msg.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] transition">
                                    <Copy size={10} /> Copy
                                  </button>
                                  <button onClick={() => handleInsertCommand(msg.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-[10px] transition">
                                    <CornerDownLeft size={10} /> Insert
                                  </button>
                                  <button onClick={() => {
                                    if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                                    if (msg.danger) { setExecuteConfirmOpen(true); setAiAnswer({ ...msg, danger: true }); return; }
                                    handleExecuteCommand(msg.command);
                                  }} disabled={!isLoggedIn} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[10px] transition ${msg.danger ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400'}`}>
                                    <CornerDownLeft size={10} /> Run
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Patch Review Modal */}
                {patchModalOpen && (
                  (typeof document !== 'undefined'
                    ? createPortal(
                        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => {
                          if (e.target === e.currentTarget) {
                            setPatchModalOpen(false);
                          }
                        }}>
                          <Rnd
                            default={{ x: 0, y: 0, width: 920, height: 520 }}
                            enableResizing={true}
                            minWidth={520}
                            minHeight={320}
                            dragHandleClassName="patch-modal-drag-handle"
                            cancel="button,input,textarea,select,option,label,pre"
                            className="z-[10000]"
                            style={{ position: 'relative' }}
                          >
                            <div className="w-full h-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden flex flex-col">
                              <div className="patch-modal-drag-handle flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] cursor-move">
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Patch Review</div>
                                  {patchModalAutoApplied && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Auto-applied</span>
                                  )}
                                </div>
                                <button onClick={() => setPatchModalOpen(false)} className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }} title={t('ai.cancel')}>
                                  <X size={14} />
                                </button>
                              </div>

                              <div className="p-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                                  {lastPatchResultData ? (
                                    renderDmpDiffByResult(
                                      lastPatchResultData,
                                      patchFileCollapsed,
                                      setPatchFileCollapsed,
                                      lastPatchBackup,
                                      (filePath, backupId) => {
                                        if (!isLoggedIn) { setAiError('Login required'); return; }
                                        const safeFile = `'${String(filePath).replace(/'/g, "'\\''")} '`;
                                        const cmd = `if [ -f ${safeFile}.bak.${backupId} ]; then mv ${safeFile}.bak.${backupId} ${safeFile}; echo "✅ Rolled back ${filePath}"; else echo "⚠️ No backup found for ${filePath}"; fi`;
                                        handleExecuteCommand(cmd, true);
                                      }
                                    )
                                  ) : (
                                    renderDiffByFile(
                                      patchModalDiff,
                                      patchFileCollapsed,
                                      setPatchFileCollapsed,
                                      lastPatchBackup,
                                      (filePath, backupId) => {
                                        if (!isLoggedIn) { setAiError('Login required'); return; }
                                        const safeFile = `'${String(filePath).replace(/'/g, "'\\''")} '`;
                                        const cmd = `if [ -f ${safeFile}.bak.${backupId} ]; then mv ${safeFile}.bak.${backupId} ${safeFile}; echo "✅ Rolled back ${filePath}"; else echo "⚠️ No backup found for ${filePath}"; fi`;
                                        handleExecuteCommand(cmd, true);
                                      }
                                    )
                                  )}
                              </div>

                              <div className="flex gap-2 px-4 py-3 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/70">
                                <button onClick={() => setPatchModalOpen(false)} className="flex-1 py-2 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {t('ai.cancel')}
                                </button>
                                {/* Rollback All — only shown when backup exists */}
                                {lastPatchBackup?.id && (
                                  <button onClick={() => {
                                    const rb = buildPatchRollbackCommand(lastPatchBackup);
                                    if (!rb) { setAiError('No rollback available'); return; }
                                    setPatchModalOpen(false);
                                    handleExecuteCommand(rb, true);
                                    setLastPatchBackup(null);
                                    setLastPatchResultData(null);
                                    setPatchModalAutoApplied(false);
                                  }} disabled={!isLoggedIn} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-red-600/70 hover:bg-red-600 text-white text-xs transition border border-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
                                    ↩ Rollback All
                                  </button>
                                )}
                                <button onClick={() => navigator.clipboard.writeText(patchModalDiff || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}>
                                  <Copy size={12} /> {t('ai.copy')}
                                </button>
                                {!patchModalAutoApplied ? (
                                  <button onClick={async () => {
                                    if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                                    const backupId = `${Date.now().toString(36)}`;
                                    setPatchModalOpen(false);
                                    const result = await applyPatchViaSftp(patchModalDiff, backupId);
                                    const files = result.files || [];
                                    setLastPatchBackup({ id: backupId, files });
                                    setLastPatchResultData(result.results || null);
                                    if (!result.success) {
                                      setAiError(`Patch failed: ${result.error || result.summary || 'Unknown error'}`);
                                    }
                                    setPatchModalAutoApplied(true);
                                  }} disabled={!isLoggedIn} className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-emerald-600/80 dark:bg-emerald-600/50 hover:bg-emerald-500 text-white text-xs transition border border-emerald-500/20">
                                    <CornerDownLeft size={12} /> Apply Patch
                                  </button>
                                ) : (
                                  <button disabled className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-emerald-600/20 text-emerald-200 text-xs transition border border-emerald-500/10 opacity-60 cursor-not-allowed">
                                    Applied
                                  </button>
                                )}
                              </div>
                            </div>
                          </Rnd>
                        </div>,
                        document.body
                      )
                    : null)
                )}

                {/* Last Result Preview - Collapsible */}
                {(lastExecutedCommand || lastResultSnapshot) && (
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => setLastResultCollapsed(!lastResultCollapsed)}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{t('ai.lastResult')}</span>
                        <span className="text-[9px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                          {lastResultCollapsed ? '(คลิกเพื่อขยาย)' : '(คลิกเพื่อย่อ)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); refreshLastResultSnapshot(); }} className="p-1 rounded hover:bg-white/5" title={t('ai.refresh')}><RefreshCw size={10} /></button>
                        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText([lastExecutedCommand, lastResultSnapshot].filter(Boolean).join('\n')); }} className="p-1 rounded hover:bg-white/5" title={t('ai.copy')}><Copy size={10} /></button>
                        <button className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                          {lastResultCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                      </div>
                    </div>
                    {!lastResultCollapsed && (
                      <div className="p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        {lastExecutedCommand && (
                          <div className="text-xs font-mono opacity-80 truncate" style={{ color: 'var(--text-primary)' }}>{lastExecutedCommand}</div>
                        )}
                        {lastResultSnapshot && (
                          <pre className="text-[10px] font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text-secondary)' }}>{lastResultSnapshot}</pre>
                        )}
                        <button onClick={() => {
                          if (!isLoggedIn) { setAiError('Login required'); return; }
                          const prompt = `Command: ${lastExecutedCommand || 'unknown'}\nOutput: ${lastResultSnapshot || getOutputContext() || 'none'}\nExplain and suggest next step.`;
                          askAiWithPrompt(prompt);
                        }} disabled={!isLoggedIn} className="w-full flex items-center justify-center gap-1.5 py-2 rounded bg-gradient-to-r from-[var(--accent-indigo)]/10 to-[var(--accent-purple,rgba(168,85,247,0.1))] hover:from-[var(--accent-indigo)]/20 hover:to-[var(--accent-purple,rgba(168,85,247,0.2))] border border-[var(--accent-indigo)]/20 text-xs font-medium text-[var(--accent-indigo)] hover:text-white transition-all shadow-sm group">
                          <Sparkles size={12} className="text-[var(--accent-indigo)] group-hover:text-[var(--accent-indigo)] transition-colors" /> {t('terminal.explainOutput')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* File Changes (diff) - Collapsible */}
                {sshAiPrefs?.aiTask === 'code' && fileChanges?.diffText && (
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 overflow-hidden">
                    <div
                      className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setFileChangesCollapsed(!fileChangesCollapsed)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>File Changes</span>
                        <span className="text-[9px] opacity-60 font-mono" style={{ color: 'var(--text-secondary)' }}>
                          +{fileChanges.added} / -{fileChanges.removed}
                        </span>
                        {Array.isArray(fileChanges.files) && fileChanges.files.length > 0 && (
                          <span className="text-[9px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {fileChanges.files.length} file(s)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(fileChanges.diffText || ''); }}
                          className="p-1 rounded hover:bg-white/5"
                          title={t('ai.copy')}
                        >
                          <Copy size={10} />
                        </button>
                        <button className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                          {fileChangesCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                      </div>
                    </div>
                    {!fileChangesCollapsed && (
                      <div className="p-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex gap-3">
                          <div className="w-[160px] shrink-0 space-y-1">
                            {Array.isArray(fileChanges.files) && fileChanges.files.map((f) => (
                              <button
                                key={f.path}
                                onClick={() => setSelectedDiffFile(f.path)}
                                className={`w-full text-left rounded px-2 py-1 border transition ${selectedDiffFile === f.path ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-black/10 border-white/5 hover:bg-white/5'}`}
                              >
                                <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>{f.path}</div>
                                <div className="text-[9px] font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                  <span className="text-emerald-400">+{f.added || 0}</span>
                                  <span className="mx-1 opacity-40">/</span>
                                  <span className="text-rose-400">-{f.removed || 0}</span>
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="flex-1 min-w-0">
                            {(() => {
                              const chosen = Array.isArray(fileChanges.files)
                                ? fileChanges.files.find((x) => x.path === selectedDiffFile)
                                : null;
                              const textToShow = chosen?.lines?.length ? chosen.lines.join('\n') : fileChanges.diffText;
                              return (
                                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words max-h-44 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text-secondary)' }}>
                                  {textToShow}
                                </pre>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {aiStreaming && (
                  <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                        <Loader2 size={12} className="animate-spin" />
                        Streaming
                      </div>
                      <span className="text-[9px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        live
                      </span>
                    </div>
                    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      {aiStreamText || '...'}
                    </div>
                  </div>
                )}







                {aiAnswer && (
                  <div className={`rounded-lg border overflow-hidden ${aiAnswer.danger ? 'border-red-500/30' : aiAnswer.done ? 'border-emerald-500/30' : 'border-white/10'}`}>
                    {/* Header - Always visible, clickable to collapse */}
                    <div 
                      className={`px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity ${aiAnswer.danger ? 'bg-red-500/10' : aiAnswer.done ? 'bg-emerald-500/10' : 'bg-black/20'}`}
                      onClick={() => setAiAnswerCollapsed(!aiAnswerCollapsed)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 opacity-80">
                            <Sparkles size={12} className="text-[var(--accent-indigo)]" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-indigo)]">
                              {aiAnswer.raw.includes('AUTO_FIX_REQUEST') ? t('ai.autoFix') : 'Zeroclaw AI'}
                            </span>
                          </div>
                          {aiAnswer.usedModel && (
                            <span className="text-[8px] opacity-50 font-mono tracking-tight text-[var(--text-muted)]">
                              {aiAnswer.usedModel.split('/').pop().replace(/-/g, ' ')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {aiAnswer.raw.includes('AUTO_FIX_REQUEST') && <span className="text-[9px] font-bold bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/30">{t('ai.autoFix')}</span>}
                          {aiAnswer.done && <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10} /> {t('ai.done')}</span>}
                          {aiAnswer.danger && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><ShieldAlert size={10} /> {t('ai.danger')}</span>}
                          {aiAnswer.interactive && <span className="text-[10px] font-bold text-amber-400">⚡ {aiAnswer.interactive}</span>}
                          <button className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                            {aiAnswerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Content - Collapsible */}
                    {!aiAnswerCollapsed && (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="px-3 py-2">
                      <div className="mb-3 border-b border-white/5 pb-2">
                      {/* Conversational Explanation */}
                      {(aiAnswer.explain || aiAnswer.warn) && (
                        <div className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                           {aiAnswer.warn && (
                             <div className="text-red-500 font-medium mb-1.5 flex gap-1.5 items-start">
                               <AlertCircle size={14} className="mt-0.5 shrink-0" />
                               <span>{autoTranslate && aiTranslations.warn ? aiTranslations.warn : (translatingAiText.warn ? '...' : aiAnswer.warn)}</span>
                             </div>
                           )}
                           {aiAnswer.explain && (
                             <div>
                               {autoTranslate && aiTranslations.explain ? aiTranslations.explain : (translatingAiText.explain ? '...' : aiAnswer.explain)}
                             </div>
                           )}
                        </div>
                      )}
                      
                      {aiAnswer.thought && (
                        <div className="mb-3 p-2.5 rounded-lg border border-black/20 bg-black/20 overflow-hidden opacity-70 hover:opacity-100 transition-opacity">
                          <div className="text-[10px] font-medium leading-relaxed italic text-[var(--text-muted)]">
                            "{autoTranslate && aiTranslations.thought ? aiTranslations.thought : (translatingAiText.thought ? '...' : aiAnswer.thought)}"
                          </div>
                        </div>
                      )}
                      </div>

                      {/* Proposed Patch (VSCode-like) */}
                      {aiAnswer.diff && (
                        <div className="mt-2 rounded bg-black/40 border border-white/5 overflow-hidden">
                          <div className="px-2 py-1 text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider bg-black/40 border-b border-white/5">Proposed Patch</div>
                          <div className="flex items-center gap-1 p-2 border-t border-white/5 bg-black/20">
                            <button onClick={() => {
                              setPatchModalDiff(aiAnswer.diff || '');
                              setPatchModalOpen(true);
                            }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-indigo-600/80 dark:bg-indigo-600/50 hover:bg-indigo-500 text-white text-xs transition border border-indigo-500/20">
                              Review Patch
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(aiAnswer.diff || '')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}><Copy size={12} /> {t('ai.copy')}</button>
                          </div>
                        </div>
                      )}

                      {/* Command Block */}
                      {aiAnswer.command && (
                        <div className="mt-2 rounded bg-black/40 border border-white/5 overflow-hidden">
                          <div className="px-2 py-1 text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider bg-black/40 border-b border-white/5">Terminal Command</div>
                          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words px-2.5 py-2" style={{ color: 'var(--text-primary)' }}>
                            {aiAnswer.command}
                          </pre>
                        </div>
                      )}
                      
                      {!aiAnswer.command && aiAnswer.done && (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-[var(--bg-primary)]/50 dark:bg-black/40 border border-[var(--border-color)] rounded px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                          ✅ {t('ai.done')}!
                        </pre>
                      )}
                    </div>
                    {aiAnswer.command && (
                      <div className="flex items-center gap-1 p-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
                        <button onClick={() => navigator.clipboard.writeText(aiAnswer.command || '')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-xs transition border border-[var(--border-color)]" style={{ color: 'var(--text-primary)' }}><Copy size={12} /> {t('ai.copy')}</button>
                        <button onClick={() => handleInsertCommand(aiAnswer.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-600/80 dark:bg-emerald-600/50 hover:bg-emerald-500 text-white text-xs transition border border-emerald-500/20"><CornerDownLeft size={12} /> {t('ai.insert')}</button>
                        <button onClick={() => {
                          if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                          if (aiAnswer.danger) { setExecuteConfirmOpen(true); return; }
                          handleExecuteCommand(aiAnswer.command);
                        }} disabled={!isLoggedIn || (executeConfirmOpen && aiAnswer.danger)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-white text-xs transition ${aiAnswer.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'} ${(executeConfirmOpen && aiAnswer.danger) ? 'opacity-70 cursor-not-allowed' : ''}`}>
                          {executeConfirmOpen && aiAnswer.danger ? t('ai.confirmRun') : <><CornerDownLeft size={12} /> {t('ai.run')}</>}
                        </button>
                      </div>
                    )}
                    </div>
                    )}
                  </div>
                )}

                {/* AI Plan / Intention */}
                {aiAnswer && aiAnswer.plan && !aiAnswer.done && (
                  <div className={`rounded-xl border border-[var(--accent-indigo)]/20 bg-[var(--accent-indigo)]/5 p-3 space-y-2 transition-all duration-500 ${aiLoading || autoRunningRef.current ? 'opacity-60 blur-[0.5px]' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-indigo)]">
                        <ListChecks size={12} />
                        {t('ai.roadmap')}
                      </div>
                      {(aiLoading || autoRunningRef.current) && (
                        <div className="flex items-center gap-1.5">
                           <span className="text-[9px] text-[var(--accent-indigo)] opacity-70 animate-pulse italic">{t('ai.thinking')}</span>
                           <Loader2 size={10} className="animate-spin text-[var(--accent-indigo)]" />
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] leading-relaxed space-y-1.5">
                      {aiAnswer.plan.split('\n').filter(l => l.trim().length > 2).map((line, i) => {
                        const stepNum = i + 1;
                        const isCurrent = stepNum === aiAnswer.step && !(aiLoading || autoRunningRef.current);
                        const isPast = stepNum < aiAnswer.step;
                        const isFuture = stepNum > aiAnswer.step;
                        
                        return (
                          <div key={i} className={`flex gap-2.5 transition-all duration-300 ${isCurrent ? 'translate-x-1' : ''}`}>
                            <span className={`tabular-nums font-bold min-w-[18px] transition-colors ${
                              isCurrent ? 'text-emerald-400' : 
                              isPast ? 'text-[var(--text-muted)] opacity-50' : 
                              'text-[var(--text-muted)] opacity-40'
                            }`}>
                              {stepNum}.
                            </span>
                            <span className={`flex-1 transition-colors ${
                              isCurrent ? 'text-emerald-300 font-bold' : 
                              isPast ? 'text-[var(--text-muted)] line-through decoration-white/10' : 
                              'text-[var(--text-secondary)] opacity-70'
                            }`}>
                               {line.replace(/^[\d\.\s\)\-]{1,5}/, '').trim()}
                               {isCurrent && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Error — shown at bottom for easy reading */}

                {/* Token Limit Hit Banner */}
                {aiLimitHit && (
                  <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">⚠️</span>
                      <div>
                        <div className="text-sm font-bold text-amber-300">{t('ai.limitReached')}</div>
                        <div className="text-[10px] text-amber-400/70 mt-0.5">{t('ai.limitDesc')}</div>
                      </div>
                    </div>
                    {aiLimitGoal && (
                      <div className="text-[10px] text-amber-300/60 font-mono truncate border border-amber-500/20 rounded px-2 py-1 bg-black/20">
                        {t('ai.goal')}: {aiLimitGoal}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => {
                          setAiLimitHit(false);
                          if (aiLimitGoal) {
                            setAutoGoal(aiLimitGoal);
                            setAiMode('auto');
                            setAutoMode(true);
                            setAutoStepsRemaining(MAX_AUTO_STEPS);
                            setLastResultAt(Date.now());
                          }
                        }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white border border-emerald-500/30 transition"
                      >
                        {t('ai.continueTask')}
                      </button>
                      <button
                        onClick={() => setAiLimitHit(false)}
                        className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-white/10 hover:bg-white/5 transition"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Auto Step History - Moved to bottom nest */}
                {autoStepHistory.length > 0 && (
                  <div className="space-y-2 border-t border-white/5 pt-4">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('ai.completedSteps')}</span>
                      <span className="text-[9px] opacity-40 italic">{t('ai.lastActions', { count: autoStepHistory.length })}</span>
                    </div>
                    <div className="space-y-1.5 overflow-y-auto max-h-[200px] pr-1 scrollbar-thin">
                      {autoStepHistory.map((step, idx) => (
                        <div key={idx} className="rounded-lg border border-white/5 bg-black/10 p-2 text-[10px] flex items-start gap-2.5 transition-all hover:border-white/10 group">
                          <div className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${idx === autoStepHistory.length - 1 && autoMode ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[10px] text-[var(--text-primary)] leading-snug">{step.explain}</div>
                            <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)] opacity-70 truncate group-hover:whitespace-normal group-hover:break-all transition-all bg-black/20 px-1.5 py-0.5 rounded border border-white/5 inline-block">{step.command}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interactive Prompt - All Types */}
                {interactivePrompt && (!autoMode || aiMode !== 'auto') && (
                  <div className={`rounded-lg border p-3 ${
                    interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase'
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                      {interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' ? '🔒 Password Required' :
                       interactivePrompt.kind === 'passphrase' ? '🔑 Passphrase Required' :
                       interactivePrompt.kind === 'confirm_yn' || interactivePrompt.kind === 'confirm_overwrite' ? '❓ Confirmation Required' :
                       interactivePrompt.kind === 'ssh_host_verify' ? '🔗 SSH Host Verification' :
                       interactivePrompt.kind === 'press_enter' ? '⏎ Press ENTER' :
                       interactivePrompt.kind === 'selection' ? '📋 Selection Required' :
                       '⌨️ Input Required'}
                    </div>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap mb-2 opacity-80" style={{ color: 'var(--text-primary)' }}>{interactivePrompt.text}</pre>
                    
                    {/* Y/N Buttons */}
                    {(interactivePrompt.kind === 'confirm_yn' || interactivePrompt.kind === 'confirm_overwrite') && (
                      <div className="flex gap-2">
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('y'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes (y)</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('n'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No (n)</button>
                      </div>
                    )}

                    {/* SSH Host Verification */}
                    {interactivePrompt.kind === 'ssh_host_verify' && (
                      <div className="flex gap-2">
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('yes'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('no'); if (aiMode === 'auto') setAutoMode(true); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No</button>
                      </div>
                    )}

                    {/* Press ENTER */}
                    {interactivePrompt.kind === 'press_enter' && (
                      <button onClick={() => { setInteractivePrompt(null); if (socketRef.current?.connected) socketRef.current.emit('ssh:input', '\n'); if (aiMode === 'auto') setAutoMode(true); }} className="w-full py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Press ENTER</button>
                    )}

                    {/* Password warning (manual only) */}
                    {(interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase') && (
                      <div className="space-y-3 mt-1">
                        <div className="text-[10px] opacity-70" style={{ color: 'var(--text-secondary)' }}>
                          Type your {interactivePrompt.kind === 'sudo_password' ? 'sudo password' : interactivePrompt.kind} directly in the terminal below.
                        </div>
                        {aiMode === 'auto' && !autoMode && (
                          <button 
                            onClick={() => {
                              suppressInteractiveUntilRef.current = Date.now() + 6000; // 6s grace
                              autoModeRef.current = true; // set ref synchronously before setTimeout
                              bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                              setInteractivePrompt(null);
                              setAiError(null);
                              setAutoMode(true);
                              setTimeout(() => {
                                autoRunningRef.current = false;
                                runAutoStep();
                              }, 2000); // Wait 2s for terminal to settle after password
                            }}
                            className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase tracking-wider"
                          >
                            Done, Resume Engine
                          </button>
                        )}
                      </div>
                    )}

                    {/* Selection / Text Input / Password */}
                    {(interactivePrompt.kind === 'selection' || interactivePrompt.kind === 'text_input' || interactivePrompt.kind === 'ssh_key_file' || interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase') && (
                      <div className="flex gap-2">
                        <input
                          id="ai-interactive-input"
                          type={interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase' ? 'password' : 'text'}
                          placeholder={
                            interactivePrompt.kind === 'selection' ? 'Enter selection...' : 
                            interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' ? 'Enter password...' :
                            interactivePrompt.kind === 'passphrase' ? 'Enter passphrase...' :
                            'Enter value...'
                          }
                          autoFocus
                          className="flex-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] px-2 py-1.5 text-xs outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = e.target.value;
                              const isPassword = interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase';
                              if (isPassword) suppressInteractiveUntilRef.current = Date.now() + 6000;
                              setInteractivePrompt(null);
                              sendQuickInput(val);
                          if (aiModeRef.current === 'auto') {
                                autoModeRef.current = true; // set ref synchronously
                                bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                                setAutoMode(true);
                                setTimeout(() => {
                                  autoRunningRef.current = false;
                                  runAutoStep();
                                }, isPassword ? 2000 : 500);
                              }
                            }
                          }}
                        />
                        <button onClick={() => { 
                          const val = document.getElementById('ai-interactive-input')?.value || '';
                          const isPassword = interactivePrompt.kind.includes('password') || interactivePrompt.kind === 'passphrase';
                          if (isPassword) suppressInteractiveUntilRef.current = Date.now() + 6000;
                          setInteractivePrompt(null); 
                          sendQuickInput(val); 
                          if (aiModeRef.current === 'auto') {
                            autoModeRef.current = true; // set ref synchronously
                            bypassPasswordPauseRef.current = true; // skip predictive pause for next step
                            setAutoMode(true);
                            setTimeout(() => {
                              autoRunningRef.current = false;
                              runAutoStep();
                            }, isPassword ? 2000 : 500);
                          }
                        }} className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium uppercase tracking-wider">Send</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Danger Confirmation */}
                {executeConfirmOpen && aiAnswer?.danger && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-600 dark:text-red-300 mb-2"><ShieldAlert size={12} /> {t('ai.confirmExecution')}</div>
                    <div className="text-[11px] opacity-80 mb-3" style={{ color: 'var(--text-primary)' }}>{t('ai.confirmText')}</div>
                    <div className="flex gap-2">
                      <button onClick={() => setExecuteConfirmOpen(false)} className="flex-1 py-1.5 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t('ai.cancel')}</button>
                      <button onClick={() => {
                        setExecuteConfirmOpen(false);
                        setAiError(null);
                        setAiAnswer((prev) => (prev ? { ...prev, danger: false } : prev));
                        handleExecuteCommand(aiAnswer?.command);
                        if (aiMode === 'auto') {
                          setAutoMode(true);
                        }
                      }} disabled={!isLoggedIn} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">{t('ai.execute')}</button>
                    </div>
                  </div>
                )}

                {/* Sensitive Operation Confirmation */}
                {sensitiveConfirmOpen && pendingSensitiveCommand && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-300 mb-2">
                      <ShieldAlert size={12} /> Sensitive Operation
                    </div>
                    <div className="text-[11px] opacity-80 mb-2" style={{ color: 'var(--text-primary)' }}>
                      This command may affect system security or stability:
                    </div>
                    <div className="rounded bg-black/40 border border-amber-500/20 p-2 mb-3">
                      <code className="text-[10px] font-mono text-amber-400 break-all">{pendingSensitiveCommand}</code>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setSensitiveConfirmOpen(false);
                          setPendingSensitiveCommand(null);
                        }} 
                        className="flex-1 py-1.5 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" 
                        style={{ color: 'var(--text-primary)' }}
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => {
                          const cmd = pendingSensitiveCommand;
                          setSensitiveConfirmOpen(false);
                          setPendingSensitiveCommand(null);
                          executeCommandInternal(cmd);
                        }} 
                        disabled={!isLoggedIn} 
                        className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium"
                      >
                        Execute Anyway
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Error Banner (bottom, most visible) ── */}
              {aiError && (
                <div className="mx-3 mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-[11px] flex items-start gap-2" style={{ color: 'var(--text-primary)' }}>
                  <span className="shrink-0 mt-0.5 text-red-400">⚠</span>
                  <span className="flex-1 leading-snug">{aiError}</span>
                  <button onClick={() => setAiError(null)} className="shrink-0 text-red-400/60 hover:text-red-400 transition-colors" title="Dismiss">
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Floating Input Footer - Antigravity Style */}
              <div className="p-4 border-t border-white/5 bg-[var(--bg-secondary)] dark:bg-[#0c0c0c]/90 backdrop-blur-3xl z-40 transition-all duration-300">
                <div className="flex flex-col gap-3">
                  {/* Status & Control Bar */}
                  {aiMode === 'auto' && (
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-3 text-[10px] font-mono">
                         <div className="flex items-center gap-1.5 cursor-help" title={autoMode ? "The AI engine is actively managing the session" : "The AI engine is paused"}>
                            <span className={`w-1.5 h-1.5 rounded-full ${autoMode ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-white/20'}`} />
                            <span className={autoMode ? 'text-emerald-400 font-bold' : 'text-white/40'}>{autoMode ? 'ENGINE ACTIVE' : 'ENGINE READY'}</span>
                         </div>
                         <span className="opacity-20 text-white">|</span>
                         <span className="text-white/60">Steps: <span className="text-white font-bold">{autoStepsRemaining}</span></span>

                         {!autoMode && aiMode === 'auto' && (
                           <button 
                             onClick={() => {
                               suppressInteractiveUntilRef.current = Date.now() + 4000;
                               autoModeRef.current = true;
                               bypassPasswordPauseRef.current = true;
                               setAiError(null); // clear any error on resume
                               setAutoMode(true);
                               // Bump lastResultAt so the useEffect always re-fires
                               setLastResultAt(p => { const n = Date.now(); return n > (p || 0) ? n : (p || 0) + 1; });
                               // Also call directly after short delay as backstop
                               setTimeout(() => {
                                 autoRunningRef.current = false;
                                 runAutoStep();
                               }, 300);
                             }}
                             className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-[9px] font-bold hover:bg-white/10 hover:text-white transition-all active:scale-95"
                           >
                             <RefreshCw size={9} className="opacity-60" />
                             RESUME ENGINE
                           </button>
                         )}
                        
                        {autoMode && autoCountdown === 0 && (
                          <button 
                            onClick={() => {
                              autoRunningRef.current = false;
                              runAutoStep();
                            }}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold hover:bg-emerald-500/20 active:scale-95 transition-all"
                            title="Force the AI to re-analyze immediately"
                          >
                            <CornerDownLeft size={10} />
                            FORCE NEXT STEP
                          </button>
                        )}

                        {autoCountdown > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-bold animate-pulse">Wait: {autoCountdown}s</span>
                            <button 
                              onClick={() => {
                                if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
                                setAutoCountdown(0);
                                runAutoStep();
                              }}
                              className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-bold hover:bg-amber-500/20 active:scale-95 transition-all"
                            >
                              CONTINUE NOW
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Primary Input Box */}
                  <div className={`relative flex gap-2 bg-[var(--bg-primary)] border border-white/5 rounded-2xl p-1.5 shadow-2xl transition-all focus-within:border-indigo-500/40 focus-within:ring-4 focus-within:ring-indigo-500/5 ${(!isLoggedIn || aiLimitHit) ? 'opacity-50 grayscale' : ''}`}>
                    {aiMode === 'auto' ? (
                      <div className="flex-1 flex flex-col px-3 py-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[8px] font-black tracking-widest text-emerald-500 opacity-70 shrink-0">GOAL</span>
                          {autoGoal.length > 0 && (
                            <span className="text-[8px] text-white/20 ml-auto">{autoGoal.length} chars</span>
                          )}
                        </div>
                        <textarea
                          value={autoGoal}
                          onChange={(e) => {
                            setAutoGoal(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !autoMode) {
                              e.preventDefault();
                              // trigger start
                              document.querySelector('[data-ai-submit]')?.click();
                            }
                          }}
                          disabled={!isLoggedIn || aiLimitHit || autoMode}
                          rows={1}
                          className="w-full bg-transparent text-xs outline-none text-[var(--text-primary)] font-medium placeholder:text-white/20 resize-none leading-relaxed scrollbar-none"
                          style={{ height: 'auto', minHeight: '22px', maxHeight: '96px' }}
                          placeholder={t('ai.goalPlaceholder')}
                        />
                      </div>
                    ) : (
                      <div className="flex-1 flex items-start gap-2 px-2 pt-1 min-w-0">
                        <button className="p-1.5 text-white/40 hover:text-white/80 transition-colors shrink-0 mt-0.5" onClick={() => setAiHistoryOpen(true)} title="History">
                          <Clock size={14} />
                        </button>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => {
                            setAiPrompt(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                          }}
                          disabled={!isLoggedIn || aiLimitHit || aiLoading}
                          rows={1}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAskAi();
                            }
                          }}
                          className="flex-1 bg-transparent py-2 text-xs outline-none resize-none text-[var(--text-primary)] font-medium placeholder:text-white/20 leading-relaxed scrollbar-none"
                          style={{ height: 'auto', minHeight: '28px', maxHeight: '120px' }}
                          placeholder={t('ai.promptPlaceholder')}
                        />
                      </div>
                    )}
                    
                    {/* Primary Action Button */}
                    <button
                      data-ai-submit
                      onClick={() => {
                        if (aiMode === 'auto') {
                          if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                          if (aiLimitHit && !autoMode) { setAiError('Daily AI limit reached.'); return; }
                          if (!autoMode) {
                            autoSeenRef.current = new Set();
                            autoVerifyKeyRef.current = '';
                            autoLastLoopKeyRef.current = '';
                            autoLoopRepeatRef.current = 0;
                            aiConversationRef.current = []; // Fresh context for new goal
                            autoRecentCommandsRef.current = []; // Clear cmd history
                            detectedOsRef.current = null; // Re-detect OS for new session
                            lastGoalRef.current = String(autoGoal || aiPrompt || '').trim();
                            setAutoStepHistory([]);
                            setAutoGoal(g => String(g || aiPrompt || '').trim());
                            setAutoStepsRemaining(MAX_AUTO_STEPS);
                            setAutoMode(true);
                            setLastResultSnapshot(s => s || getOutputContext());
                            setLastResultAt(p => { const n = Date.now(); return n > (p || 0) ? n : (p || 0) + 1; });

                          } else {
                            setAutoMode(false);
                          }
                        } else {
                          handleAskAi();
                        }
                      }}
                      disabled={!isLoggedIn || aiLimitHit || (aiMode === 'manual' && (!aiPrompt.trim() || aiLoading))}
                      className={`self-start mt-1 shrink-0 h-10 w-10 rounded-xl transition-all active:scale-90 flex items-center justify-center ${
                        aiMode === 'auto' 
                          ? (autoMode ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' : 'bg-emerald-500 text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.2)]')
                          : 'bg-indigo-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:bg-indigo-500'
                      }`}
                    >
                      {aiMode === 'auto' 
                         ? (autoMode ? <X size={18} strokeWidth={3} /> : <CornerDownLeft size={18} strokeWidth={3} />)
                         : (aiLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} strokeWidth={2} />)
                      }
                    </button>
                  </div>
                  
                  {/* Footer Hint */}
                  {!isLoggedIn ? (
                    <div className="text-center text-[9px] text-amber-400/60 font-medium uppercase tracking-tighter">Login Required to Execute</div>
                  ) : aiLimitHit ? (
                    <div className="text-center text-[9px] text-rose-400/60 font-medium uppercase tracking-tighter">Daily Token Limit Reached</div>
                  ) : (
                    <div className="flex items-center justify-between px-2 text-[9px] text-white/30 font-medium uppercase tracking-tighter">
                       <span>{aiMode === 'auto' ? 'Goal Mode Active' : (sshAiPrefs.aiTask === 'code' ? '🗒 Code Editor Mode' : t('ai.usesLastOutput'))}</span>
                       <span className={sshAiPrefs.aiTask === 'code' ? 'text-emerald-400/50' : ''}>{sshAiPrefs.aiTask === 'code' ? 'File Edit Mode — Not SSH' : 'Terminal Context Attached'}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Rnd>,
          document.body
        )}
      </div>

      {/* Mission Accomplished Premium Popup */}
      <AnimatePresence>
        {aiDone && !autoMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-500/30 bg-[#0c0c0c]/95 shadow-[0_0_50px_rgba(16,185,129,0.2)] backdrop-blur-2xl flex flex-col max-h-[85vh]"
            >
              {/* Glow Effects */}
              <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-emerald-500/10 blur-[80px] pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-indigo-500/10 blur-[80px] pointer-events-none" />

                <div className="relative flex flex-col items-center text-center px-8 pt-8 pb-4 shrink-0">
                  {/* Animated Icon */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 shadow-inner shrink-0"
                  >
                    <Trophy className="h-8 w-8 text-emerald-400" />
                  </motion.div>

                  <motion.h2
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="mb-2 text-xl font-black tracking-tight text-white"
                  >
                    {t('ai.missionAccomplished')}
                  </motion.h2>

                  {/* Goal pill — wraps neatly, no truncation problems */}
                  <motion.div
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mb-2 flex items-start gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] font-semibold text-emerald-400/80 max-w-full"
                  >
                    <Sparkles size={10} className="shrink-0 mt-0.5" />
                    <span className="break-words text-left leading-snug">{aiDoneSummary?.goal || autoGoal}</span>
                  </motion.div>

                  {/* Mode badge */}
                  {aiDoneSummary?.taskMode === 'code' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.45 }}
                      className="mb-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-[9px] font-bold text-teal-400 uppercase tracking-wider"
                    >
                      🗒 Code Editor Mode
                    </motion.div>
                  )}
                </div>

              {/* Summary body — scrollable */}
              <div className="relative flex-1 overflow-y-auto px-6 pb-2 space-y-3 min-h-0 custom-scrollbar">

                {/* Final thought/explanation */}
                {(aiDoneSummary?.explain || aiAnswer?.thought) && (
                  <motion.div 
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     transition={{ delay: 0.5 }}
                     className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm leading-relaxed text-zinc-300 italic"
                  >
                    "{aiDoneSummary?.explain || (autoTranslate && aiTranslations.thought ? aiTranslations.thought : (translatingAiText.thought ? '...' : aiAnswer?.thought))}"
                  </motion.div>
                )}

                {/* Step-by-step summary */}
                {aiDoneSummary?.steps && aiDoneSummary.steps.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55 }}
                    className="rounded-xl border border-white/5 bg-black/30 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400/70">✅ Steps Completed</span>
                      <span className="text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                        {aiDoneSummary.steps.length} step{aiDoneSummary.steps.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="divide-y divide-white/5">
                      {aiDoneSummary.steps.map((step, idx) => (
                        <div key={idx} className="px-3 py-2 flex items-start gap-2">
                          <div className="mt-0.5 shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                            <span className="text-[7px] font-black text-emerald-400">{idx + 1}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            {step.command && step.command !== '[Wait]' && (
                              <code className="block text-[9px] font-mono text-indigo-300/80 bg-indigo-500/5 px-1.5 py-0.5 rounded mb-0.5 truncate">
                                {String(step.command).slice(0, 120)}
                              </code>
                            )}
                            {step.explain && (
                              <p className="text-[10px] text-zinc-400 leading-snug">{step.explain}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Footer button */}
              <motion.div 
                 initial={{ y: 20, opacity: 0 }}
                 animate={{ y: 0, opacity: 1 }}
                 transition={{ delay: 0.65 }}
                 className="shrink-0 px-6 py-4 border-t border-white/5"
              >
                <button 
                  onClick={() => { setAiDone(false); setAiDoneSummary(null); }}
                  className="group relative w-full overflow-hidden rounded-xl bg-emerald-500 px-6 py-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-emerald-600 opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="relative flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-950">
                    {t('ai.dismissSummary')} <CornerDownLeft size={14} />
                  </span>
                </button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
