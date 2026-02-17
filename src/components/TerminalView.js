'use client';

import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Loader2, AlertCircle, CheckCircle2, XCircle, X, Minus, Maximize2, Wifi, Sparkles, Copy, CornerDownLeft, ShieldAlert, Settings2, Clock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from 'next-auth/react';
import { Rnd } from 'react-rnd';

let Terminal, FitAddon, WebLinksAddon;

export default function TerminalView({ connectionId, connectionName, host, color, onClose, connection, isStandalone }) {
  const { state: appState, dispatch, apiFetch } = useApp();
  const { state: osState, setSshAiHistory, setSshAiPrefs } = useOS();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user?.email;
  const { t } = useTranslation();
  const terminalRef = useRef(null);
  const termInstanceRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);
  const lastOutputAtRef = useRef(0);
  const [status, setStatus] = useState('connecting'); // connecting, connected, error, closed
  const [errorMsg, setErrorMsg] = useState(null);
  const [latency, setLatency] = useState(null);

  const outputLinesRef = useRef([]);
  const outputBufferRef = useRef('');

  const [aiOpen, setAiOpen] = useState(false);
  const [aiHasOpenedOnce, setAiHasOpenedOnce] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [aiPanelPos, setAiPanelPos] = useState({ x: 16, y: 64 });
  const [aiPanelSize, setAiPanelSize] = useState({ width: 420, height: 520 });
  const [interactivePrompt, setInteractivePrompt] = useState(null); // { text: string, kind: string } | null
  const [lastExecutedCommand, setLastExecutedCommand] = useState('');
  const [lastResultSnapshot, setLastResultSnapshot] = useState('');
  const [lastResultAt, setLastResultAt] = useState(null);
  const lastAutoExplainKeyRef = useRef('');

  const [autoMode, setAutoMode] = useState(false);
  const [autoStepsRemaining, setAutoStepsRemaining] = useState(0);
  const [autoGoal, setAutoGoal] = useState('');
  const autoRunningRef = useRef(false);
  const autoSeenRef = useRef(new Set());
  const autoVerifyKeyRef = useRef('');
  const autoLastLoopKeyRef = useRef('');
  const autoLoopRepeatRef = useRef(0);
  const [aiMode, setAiMode] = useState('manual'); // manual | auto
  const autoEmptyRetryRef = useRef('');

  const sshAiHistory = osState?.sshAiHistory || [];
  const sshAiPrefs = osState?.sshAiPrefs || { preferSudo: true, editor: 'nano', viewer: 'cat', autoExplainOnError: false, autoAnswerPrompts: false };
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);

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

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#0c0c0c', // Keep terminal background dark for true terminal feel
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
      },
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    // Initial fit attempt
    setTimeout(() => {
      try { fitAddon.fit(); } catch (e) {}
    }, 50);

    termInstanceRef.current = term;

    const stripAnsi = (s) => String(s || '')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\r/g, '');

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
    });

    socket.on('ssh:error', (data) => {
      setStatus('error');
      setErrorMsg(data.message);
      // updateConnectionStatus('offline'); // Optional, or keep as error
      term.writeln(`\n\x1b[1;31m✗ ${t('terminal.errorPrefix')} ${data.message}\x1b[0m`);
      appendOutput(`\n✗ ${t('terminal.errorPrefix')} ${data.message}\n`);
    });

    socket.on('ssh:closed', () => {
      setStatus('closed');
      updateConnectionStatus('offline'); // Update global state
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')}\x1b[0m`);
      appendOutput(`\n⚠ ${t('terminal.connectionClosed')}\n`);
    });

    socket.on('disconnect', () => {
      if (status !== 'closed') {
        setStatus('closed');
        updateConnectionStatus('offline');
        term.writeln(`\n\x1b[1;31m✗ ${t('terminal.socketDisconnected')}\x1b[0m`);
        appendOutput(`\n✗ ${t('terminal.socketDisconnected')}\n`);
      }
    });

    term.onData((data) => {
      if (socket.connected) {
        socket.emit('ssh:input', data);
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

  const parseAiAnswer = (raw) => {
    const getTag = (tag) => {
      const m = String(raw || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const command = getTag('command');
    const explain = getTag('explain');
    const dangerRaw = getTag('danger');
    const warn = getTag('warn');
    const danger = String(dangerRaw || '').trim().toLowerCase() === 'true';
    return { command, explain, danger, warn, raw: String(raw || '').trim() };
  };

  const getOutputContext = () => {
    const lines = outputLinesRef.current.slice(-20);
    return lines.join('\n');
  };

  const looksLikeShellPrompt = (text) => {
    const lines = String(text || '').split('\n').filter(Boolean);
    const last = (lines[lines.length - 1] || '').trim();
    if (!last) return false;
    // Common prompts: $ , # , > at end (with optional path/user/host)
    return /[$#>]\s*$/.test(last);
  };

  const waitForCommandSettle = async () => {
    const maxMs = 60000;
    const idleMs = 1200;
    const start = Date.now();

    while (Date.now() - start < maxMs) {
      const snap = getOutputContext();
      const interactive = detectInteractivePrompt(snap);
      if (interactive) return { reason: 'interactive', snap };

      const err = detectTerminalError(snap);
      if (err) {
        // still allow settle quickly on errors
        const idleFor = Date.now() - (lastOutputAtRef.current || 0);
        if (idleFor > 400) return { reason: 'error', snap };
      }

      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      if (idleFor > idleMs && looksLikeShellPrompt(snap)) {
        return { reason: 'prompt', snap };
      }

      await new Promise(r => setTimeout(r, 200));
    }

    return { reason: 'timeout', snap: getOutputContext() };
  };

  const detectInteractivePrompt = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const t = raw.toLowerCase();

    // yum/dnf confirmation
    if (t.includes('is this ok') && t.includes('[y/n')) {
      return { kind: 'confirm_yn', text: raw };
    }
    if (t.includes('is this ok') && t.includes('[y/n]')) {
      return { kind: 'confirm_yn', text: raw };
    }
    if (t.includes('is this ok') && t.includes('[y/n]:')) {
      return { kind: 'confirm_yn', text: raw };
    }
    if (t.includes('is this ok') && t.includes('[y/n]')) {
      return { kind: 'confirm_yn', text: raw };
    }
    if (t.includes('is this ok') && t.includes('[y/n]')) {
      return { kind: 'confirm_yn', text: raw };
    }

    // Generic prompts
    if (/(\(y\/n\)|\[y\/n\]|\[y\/N\]|\(yes\/no\)|\[yes\/no\])/i.test(raw)) {
      return { kind: 'confirm_yn', text: raw };
    }
    if (/\[y\/N\]/i.test(raw) || /\[Y\/n\]/i.test(raw)) {
      return { kind: 'confirm_yn', text: raw };
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
    if (t.includes('command not found')) return { type: 'command_not_found', label: 'Command not found' };
    if (t.includes('permission denied')) return { type: 'permission_denied', label: 'Permission denied' };
    if (t.includes('no such file or directory')) return { type: 'missing_file', label: 'No such file or directory' };
    if (t.includes('not recognized as an internal or external command')) return { type: 'command_not_found', label: 'Command not found' };
    if (t.includes('failed') || t.includes('error:') || t.includes('fatal:')) return { type: 'generic_error', label: 'Error' };
    return null;
  };

  const getVerifyCommandForGoal = (goalText) => {
    const g = String(goalText || '').toLowerCase();
    if (!g.trim()) return '';
    
    // Service management goals
    if (g.includes('firewalld') || (g.includes('firewall') && g.includes('enable'))) {
      return 'systemctl is-active firewalld && systemctl is-enabled firewalld';
    }
    if (g.includes('nginx')) {
      return 'systemctl is-active nginx && nginx -v';
    }
    if (g.includes('apache') || g.includes('httpd')) {
      return 'systemctl is-active httpd && httpd -v';
    }
    if (g.includes('mysql') || g.includes('mariadb')) {
      return 'systemctl is-active mariadb || systemctl is-active mysql';
    }
    if (g.includes('postgresql') || g.includes('postgres')) {
      return 'systemctl is-active postgresql';
    }
    if (g.includes('docker')) {
      return 'systemctl is-active docker && docker --version';
    }
    if (g.includes('redis')) {
      return 'systemctl is-active redis && redis-cli ping';
    }
    
    // Software installation goals
    if (g.includes('pm2')) return 'pm2 -v';
    if (g.includes('node') || g.includes('nodejs')) return 'node -v && npm -v';
    if (g.includes('npm')) return 'npm -v';
    if (g.includes('python') && g.includes('pip')) return 'python3 --version && pip3 --version';
    if (g.includes('go') || g.includes('golang')) return 'go version';
    if (g.includes('java')) return 'java -version';
    if (g.includes('ruby')) return 'ruby -v';
    if (g.includes('mongodb') || g.includes('mongo')) return 'mongod --version && mongo --version';
    
    // Firewall configuration goals
    if (g.includes('firewall') && g.includes('port')) {
      return 'firewall-cmd --list-all 2>/dev/null || ufw status';
    }
    
    return '';
  };

  const isGoalSatisfied = (goalText, lastCmdText, snapshot) => {
    const g = String(goalText || '').toLowerCase();
    const c = String(lastCmdText || '').toLowerCase();
    const s = String(snapshot || '').toLowerCase();

    // Firewalld service goals
    if (g.includes('firewalld') || g.includes('firewall')) {
      const wantsEnableStart = g.includes('enable') || g.includes('start') || g.includes('active');
      if (!wantsEnableStart) return false;
      if (c.includes('systemctl') && c.includes('firewalld') && (c.includes('is-active') || c.includes('is-enabled'))) {
        if (s.includes('active') && s.includes('enabled')) return true;
      }
      // Also check for "active (running)" from status output
      if (c.includes('systemctl') && c.includes('status') && c.includes('firewalld')) {
        if (s.includes('active (running)') || (s.includes('active') && s.includes('running'))) return true;
      }
    }
    
    // Generic service goals (nginx, httpd, mysql, etc.)
    const services = ['nginx', 'httpd', 'apache', 'mysql', 'mariadb', 'postgresql', 'docker', 'redis'];
    for (const svc of services) {
      if (g.includes(svc)) {
        // Check is-active output
        if (c.includes('systemctl') && c.includes('is-active') && c.includes(svc)) {
          if (s.includes('active')) return true;
        }
        // Check status output
        if (c.includes('systemctl') && c.includes('status') && c.includes(svc)) {
          if (s.includes('active (running)') || (s.includes('active') && s.includes('running'))) return true;
        }
      }
    }
    
    // Node.js/npm goals
    if (g.includes('node') || g.includes('nodejs')) {
      if ((/\bnode\s+-v\b/.test(c) || /^node\s+-v\b/.test(c) || /\bnode\s+--version\b/.test(c)) && /\bv\d+\.\d+\.\d+\b/.test(s)) return true;
      if (c.includes('which node') && !s.includes('not found') && s.trim()) return true;
    }
    if (g.includes('npm')) {
      if ((/\bnpm\s+-v\b/.test(c) || /^npm\s+-v\b/.test(c) || /\bnpm\s+--version\b/.test(c)) && /\b\d+\.\d+\.\d+\b/.test(s)) return true;
    }

    // PM2 goals
    if (g.includes('pm2')) {
      if ((/\bpm2\s*(-v|--version)\b/.test(c) || /^pm2\s*(-v|--version)\b/.test(c)) && /\b\d+\.\d+\.\d+\b/.test(s)) return true;
      if (c.includes('which pm2') && !s.includes('not found') && s.trim()) return true;
    }
    
    // Python/pip goals
    if (g.includes('python') || g.includes('pip')) {
      if (c.includes('python3') && c.includes('--version') && /\d+\.\d+\.\d+/.test(s)) return true;
      if (c.includes('pip3') && c.includes('--version') && /\d+\.\d+\.\d+/.test(s)) return true;
    }
    
    // Docker goals
    if (g.includes('docker')) {
      if (c.includes('docker') && c.includes('--version') && /\d+\.\d+/.test(s)) return true;
      if (c.includes('systemctl') && c.includes('docker') && s.includes('active')) return true;
    }
    
    // MongoDB goals
    if (g.includes('mongodb') || g.includes('mongo')) {
      if (c.includes('mongod') && c.includes('--version') && /\d+\.\d+/.test(s)) return true;
      if (c.includes('mongo') && c.includes('--version') && /\d+\.\d+/.test(s)) return true;
      if (c.includes('which mongod') && !s.includes('not found') && s.trim()) return true;
      if (c.includes('systemctl') && c.includes('mongod') && s.includes('active')) return true;
    }
    
    // Firewall port configuration goals
    if (g.includes('firewall') && g.includes('port')) {
      // Check if port listing shows successful configuration
      if (c.includes('firewall-cmd') && c.includes('--list-all')) {
        // If we can list ports, firewalld is responsive
        if (s.includes('ports:') || s.includes('services:')) {
          // For "allow any port" goals, check if public zone or default zone is set
          if (g.includes('any') && s.includes('public')) return true;
        }
      }
    }

    return false;
  };

  const maybeAutoExplainError = (cmd, snapshot) => {
    if (!isLoggedIn) return;
    if (!sshAiPrefs?.autoExplainOnError) return;
    const err = detectTerminalError(snapshot);
    if (!err) return;

    const key = `${cmd || ''}::${snapshot || ''}`;
    if (lastAutoExplainKeyRef.current === key) return;
    lastAutoExplainKeyRef.current = key;

    const prompt = `I ran this command on SSH:\n${cmd || '(unknown)'}\n\nOutput:\n${snapshot || '(no output captured)'}\n\nIt looks like an error happened (${err.label}). Explain what happened and give the next safe command to fix it. Use my preferences (sudo/editor/viewer) if relevant.`;
    askAiWithPrompt(prompt);
  };

  const maybeHandleInteractivePrompt = (snapshot) => {
    const p = detectInteractivePrompt(snapshot);

    if (!p) {
      setInteractivePrompt(null);
      return;
    }

    // Auto-answer only when explicitly enabled AND in Auto mode.
    if (sshAiPrefs?.autoAnswerPrompts && aiMode === 'auto') {
      const cmd = String(lastExecutedCommand || '').toLowerCase();
      const looksLikeInstall = /(yum|dnf|apt|get|apk|pacman)\s+.*\b(install|upgrade|update)\b/.test(cmd) || /\binstall\b/.test(cmd);

      if (looksLikeInstall) {
        // default to Yes for install/update confirmations
        setInteractivePrompt(null);
        sendQuickInput('y');
        return;
      }
    }

    setInteractivePrompt(p);
    if (p && autoMode) {
      setAiError('Auto Mode paused: interactive prompt requires input (y/n).');
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
    maybeAutoExplainError(lastExecutedCommand, snap);
    maybeHandleInteractivePrompt(snap);
  };

  const executeCommandAndCapture = async (command) => {
    const cmd = String(command || '').replace(/[\r\n]+$/g, '');
    if (!cmd) return '';
    setLastExecutedCommand(cmd);

    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', `${cmd}\n`);
      termInstanceRef.current?.focus();
      const settled = await waitForCommandSettle();
      const snap = settled?.snap ?? getOutputContext();
      setLastResultSnapshot(snap);
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
    setAiPrompt(p);
    return handleAskAi(p);
  };

  const handleAskAi = async (promptOverride) => {
    if (!isLoggedIn) {
      setAiError('Login required to use AI helper.');
      return;
    }
    const effectivePrompt = String(promptOverride ?? aiPrompt).trim();
    if (!effectivePrompt || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);
    try {
      const instruction = `SSH assistant. Output: <command>, <explain>, <danger>, <warn>. Rules: 1 command only. Detect OS/pkg manager. Prefer safe commands. Use <danger> for destructive ops. For installs: check existing first. If package not found, warn and suggest search (yum/apt search). For DBs: clarify server/client/driver.

User: ${effectivePrompt}`;
      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${instruction}\nUser request: ${effectivePrompt}`,
          context: getOutputContext(),
          connectionName,
          host,
          prefs: sshAiPrefs,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'AI request failed');
      const parsed = parseAiAnswer(data.answer);
      setAiAnswer(parsed);

      const entry = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        createdAt: Date.now(),
        prompt: effectivePrompt,
        command: parsed.command,
        explain: parsed.explain,
        danger: parsed.danger,
        warn: parsed.warn,
      };

      // De-duplicate by prompt+command (keep most recent)
      const next = [entry, ...sshAiHistory.filter(h => !(h?.prompt === entry.prompt && h?.command === entry.command))].slice(0, 30);
      setSshAiHistory(next);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  const runAutoStep = async (snapshotOverride) => {
    if (!isLoggedIn) return;
    if (aiMode !== 'auto') return;
    if (!autoMode) return;
    if (autoRunningRef.current) return;
    if (autoStepsRemaining <= 0) {
      setAutoMode(false);
      return;
    }

    const goal = String(autoGoal || aiPrompt || '').trim();
    let snap = String(snapshotOverride ?? lastResultSnapshot ?? getOutputContext() ?? '').trim();
    let err = detectTerminalError(snap);
    if (goal && isGoalSatisfied(goal, lastExecutedCommand, snap)) {
      setAiError(null);
      setAutoMode(false);
      setAiOpen(true);
      setAiHasOpenedOnce(true);
      return;
    }
    if (!goal) {
      setAiError('Auto Mode needs a goal. Type what you want to achieve in the Goal box.');
      setAutoMode(false);
      return;
    }

    const loopKey = `${lastExecutedCommand || ''}::${snap}`;
    if (autoLastLoopKeyRef.current === loopKey) {
      autoLoopRepeatRef.current += 1;
    } else {
      autoLastLoopKeyRef.current = loopKey;
      autoLoopRepeatRef.current = 0;
    }
    if (autoLoopRepeatRef.current >= 2) {
      setAiError('Auto Mode stopped: output did not change (loop detected).');
      setAutoMode(false);
      return;
    }

    autoRunningRef.current = true;
    try {
      const verifyCmd = getVerifyCommandForGoal(goal);
      const afterCmd = String(lastExecutedCommand || '');
      const verifyKey = verifyCmd ? `${goal}::${verifyCmd}::${afterCmd}` : '';
      if (verifyCmd && verifyKey && autoVerifyKeyRef.current !== verifyKey && looksLikeShellPrompt(snap)) {
        autoVerifyKeyRef.current = verifyKey;
        setAutoStepsRemaining((n) => Math.max(0, n - 1));
        const verifySnap = await executeCommandAndCapture(verifyCmd);
        maybeAutoExplainError(String(verifyCmd || '').trim(), verifySnap);
        if (isGoalSatisfied(goal, verifyCmd, verifySnap)) {
          setAiError(null);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }
        snap = String(verifySnap || '').trim();
        err = detectTerminalError(snap);
      }

      const needRetryKey = `${goal}::${lastExecutedCommand || ''}::${snap}`;
      const shouldForceContinue = autoEmptyRetryRef.current === needRetryKey;

      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Goal: ${goal}

SSH auto-mode. Output: <command>, <explain>, <danger>, <warn>.
Rules: 1 command. Detect OS/pkg manager (yum/apt/etc). For firewalld: --permanent + --reload. For installs: check existing first. If "No match" error: STOP, warn, suggest search. For DBs: clarify server/client/driver. Verify before empty command with <warn>VERIFIED_DONE</warn>.

Last: ${lastExecutedCommand || 'none'}
Error: ${err ? err.label : 'none'}
Output: ${snap || 'none'}

${shouldForceContinue ? 'Continue mode.' : ''}`,
          context: snap,
          connectionName,
          host,
          prefs: sshAiPrefs,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'AI request failed');
      const parsed = parseAiAnswer(data.answer);
      setAiAnswer(parsed);

      const aiVerifiedDone = /\bverified_done\b/i.test(String(parsed.warn || ''));

      if (parsed.danger) {
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        setExecuteConfirmOpen(true);
        setAiError('Auto Mode paused: dangerous command requires confirmation.');
        setAutoMode(false);
        return;
      }

      if (!parsed.command || !String(parsed.command).trim()) {
        if (isGoalSatisfied(goal, lastExecutedCommand, snap) || aiVerifiedDone) {
          setAiError(null);
          setAutoMode(false);
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          return;
        }

        if (!shouldForceContinue) {
          autoEmptyRetryRef.current = needRetryKey;
          autoRunningRef.current = false;
          // Retry once with stronger prompt
          await runAutoStep(snap);
          return;
        }

        setAiError('Auto Mode stopped: AI returned no command before completion.');
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      autoEmptyRetryRef.current = '';

      setAutoStepsRemaining((n) => Math.max(0, n - 1));
      const newSnap = await executeCommandAndCapture(parsed.command);
      maybeAutoExplainError(String(parsed.command || '').trim(), newSnap);

      if (isGoalSatisfied(goal, parsed.command, newSnap)) {
        setAiError(null);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }
    } catch (e) {
      setAiError(e.message);
      setAutoMode(false);
    } finally {
      autoRunningRef.current = false;
    }
  };

  useEffect(() => {
    if (aiMode !== 'auto') return;
    if (!autoMode) return;
    if (!lastResultAt) return;
    runAutoStep(lastResultSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, autoMode, lastResultAt]);

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

  const handleExecuteCommand = (cmd) => {
    const command = String(cmd || '').replace(/[\r\n]+$/g, '');
    if (!command) return;
    setLastExecutedCommand(command);
    if (socketRef.current?.connected) {
      socketRef.current.emit('ssh:input', `${command}\n`);
      termInstanceRef.current?.focus();
      setTimeout(() => {
        const snap = getOutputContext();
        setLastResultSnapshot(snap);
        setLastResultAt((prev) => {
          const next = Date.now();
          const p = Number(prev || 0);
          return next > p ? next : p + 1;
        });
        maybeAutoExplainError(command, snap);
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
  }, [initTerminal]);

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
    <div className="h-full flex flex-col">
      {/* Terminal title bar - hidden in standalone mode since Window title shows server name */}
      {isStandalone && (
        <div className="h-10 flex items-center px-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
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
      <div className="flex-1 relative bg-[var(--bg-primary)] min-h-0 overflow-hidden group/term">
        {/* Floating Latency Badge (Visible in all modes) */}
        {latency !== null && status === 'connected' && (
          <div 
            className="absolute top-3 right-5 z-20 flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)]/80 backdrop-blur-xl border border-[var(--border-color)]/50 shadow-lg opacity-60 group-hover/term:opacity-100 transition-all pointer-events-none"
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
              termInstanceRef.current.write(files[0].name);
            }
          }}
        >
          <div ref={terminalRef} className="h-full w-full" />
        </div>

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
          className={`absolute bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)]/80 hover:bg-[var(--bg-secondary)] border border-[var(--border-color)]/60 backdrop-blur-xl shadow-lg text-xs font-semibold transition-all ${!aiHasOpenedOnce ? 'ring-2 ring-indigo-500/30 shadow-indigo-500/20' : ''}`}
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
            <Sparkles size={14} className="text-indigo-400" />
          ) : (
            <ShieldAlert size={14} className="text-amber-400" />
          )}
          AI
        </button>

        {aiOpen && (
          <Rnd
            size={aiPanelSize}
            position={aiPanelPos}
            onDragStop={(e, d) => setAiPanelPos({ x: d.x, y: d.y })}
            onResizeStop={(e, dir, ref, delta, pos) => {
              setAiPanelSize({ width: ref.offsetWidth, height: ref.offsetHeight });
              setAiPanelPos(pos);
            }}
            bounds="parent"
            minWidth={320}
            minHeight={280}
            dragHandleClassName="ai-panel-drag-handle"
            cancel="button,input,textarea,select,option,label"
            className="absolute z-30"
          >
            <div className="w-full h-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 backdrop-blur-2xl shadow-2xl overflow-hidden flex flex-col relative">
              {/* Header */}
              <div className="ai-panel-drag-handle flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-black/20">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>AI Assistant</span>
                  {autoMode && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 animate-pulse">Running</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setAiHistoryOpen(v => !v)} className="p-1.5 rounded hover:bg-white/5" title="History"><Clock size={12} /></button>
                  <button type="button" onClick={() => setAiSettingsOpen(v => !v)} className="p-1.5 rounded hover:bg-white/5" title="Settings"><Settings2 size={12} /></button>
                  <button type="button" onClick={() => { setAiOpen(false); setAiSettingsOpen(false); setAiHistoryOpen(false); }} className="p-1.5 rounded hover:bg-white/5" title="Close"><X size={12} /></button>
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
                  <div className="max-h-48 overflow-y-auto">
                    {sshAiHistory.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] opacity-60" style={{ color: 'var(--text-muted)' }}>No history</div>
                    ) : (
                      sshAiHistory.slice(0, 15).map((h) => (
                        <button key={h.id || h.createdAt} onClick={() => { setAiPrompt(h.prompt || ''); setAiAnswer({ command: h.command || '', explain: h.explain || '', danger: !!h.danger, warn: h.warn || '', raw: '' }); setAiError(null); setExecuteConfirmOpen(false); setAiHistoryOpen(false); }} className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 border-b border-white/5 last:border-0" style={{ color: 'var(--text-primary)' }}>
                          <div className="font-mono truncate opacity-80">{h.prompt}</div>
                          {h.command && <div className="font-mono truncate opacity-50 text-[10px]">{h.command}</div>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {aiSettingsOpen && (
                <div className="absolute top-10 left-2 right-2 z-50 rounded-xl border border-white/10 bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Settings</span>
                    <button onClick={() => setAiSettingsOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>Close</button>
                  </div>
                  <div className="p-3 space-y-3">
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>Prefer sudo</span>
                      <input type="checkbox" checked={!!sshAiPrefs.preferSudo} onChange={(e) => setSshAiPrefs({ preferSudo: e.target.checked })} disabled={!isLoggedIn} />
                    </label>
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>Auto-answer prompts</span>
                      <input type="checkbox" checked={!!sshAiPrefs.autoAnswerPrompts} onChange={(e) => setSshAiPrefs({ autoAnswerPrompts: e.target.checked })} disabled={!isLoggedIn} />
                    </label>
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>Auto explain errors</span>
                      <input type="checkbox" checked={!!sshAiPrefs.autoExplainOnError} onChange={(e) => setSshAiPrefs({ autoExplainOnError: e.target.checked })} disabled={!isLoggedIn} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={sshAiPrefs.editor || 'nano'} onChange={(e) => setSshAiPrefs({ editor: e.target.value })} disabled={!isLoggedIn} className="text-[11px] rounded bg-black/30 border border-white/10 px-2 py-1">
                        <option value="nano">nano</option>
                        <option value="vim">vim</option>
                      </select>
                      <select value={sshAiPrefs.viewer || 'cat'} onChange={(e) => setSshAiPrefs({ viewer: e.target.value })} disabled={!isLoggedIn} className="text-[11px] rounded bg-black/30 border border-white/10 px-2 py-1">
                        <option value="cat">cat</option>
                        <option value="less">less</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Main Content */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Mode Toggle */}
                <div className="flex items-center justify-between bg-black/20 rounded-lg p-1">
                  <div className="flex">
                    <button onClick={() => { setAiMode('manual'); setAutoMode(false); }} className={`px-3 py-1.5 rounded text-[11px] font-medium transition ${aiMode === 'manual' ? 'bg-white/10' : 'hover:bg-white/5'}`} style={{ color: 'var(--text-primary)' }}>Manual</button>
                    <button onClick={() => setAiMode('auto')} className={`px-3 py-1.5 rounded text-[11px] font-medium transition ${aiMode === 'auto' ? 'bg-white/10' : 'hover:bg-white/5'}`} style={{ color: 'var(--text-primary)' }}>Auto</button>
                  </div>
                  {aiMode === 'auto' && (
                    <button onClick={() => {
                      if (!isLoggedIn) { setAiError('Login required'); return; }
                      if (!autoMode) {
                        autoSeenRef.current = new Set();
                        autoVerifyKeyRef.current = '';
                        autoLastLoopKeyRef.current = '';
                        autoLoopRepeatRef.current = 0;
                        setAutoGoal(g => String(g || aiPrompt || '').trim());
                        setAutoStepsRemaining(20);
                        setAutoMode(true);
                        setLastResultSnapshot(s => s || getOutputContext());
                        setLastResultAt(p => { const n = Date.now(); return n > (p || 0) ? n : (p || 0) + 1; });
                      } else {
                        setAutoMode(false);
                      }
                    }} className={`px-3 py-1.5 rounded text-[11px] font-bold transition ${autoMode ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {autoMode ? 'Stop' : 'Start'}
                    </button>
                  )}
                </div>

                {/* Auto Mode Info */}
                {aiMode === 'auto' && (
                  <div className="space-y-2">
                    <input value={autoGoal} onChange={(e) => setAutoGoal(e.target.value)} placeholder="Goal: install nginx, enable firewalld..." className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs outline-none" disabled={!isLoggedIn} style={{ color: 'var(--text-primary)' }} />
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      <span>Steps: {autoStepsRemaining}</span>
                      <span className={autoMode ? 'text-emerald-400' : ''}>{autoMode ? 'Running' : 'Idle'}</span>
                    </div>
                  </div>
                )}

                {/* Command Input */}
                <div className="space-y-2">
                  <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="What do you want to do?" className="w-full h-20 resize-none rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs outline-none focus:border-indigo-500/50" disabled={!isLoggedIn} style={{ color: 'var(--text-primary)' }} />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] opacity-60" style={{ color: 'var(--text-muted)' }}>Uses last terminal output</span>
                    <button onClick={() => handleAskAi()} disabled={!isLoggedIn || aiLoading || !aiPrompt.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition">
                      {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                      Ask AI
                    </button>
                  </div>
                </div>

                {/* Last Result Preview */}
                {(lastExecutedCommand || lastResultSnapshot) && (
                  <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
                      <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Last Result</span>
                      <div className="flex gap-1">
                        <button onClick={refreshLastResultSnapshot} className="p-1 rounded hover:bg-white/5" title="Refresh"><RefreshCw size={10} /></button>
                        <button onClick={() => navigator.clipboard.writeText([lastExecutedCommand, lastResultSnapshot].filter(Boolean).join('\n'))} className="p-1 rounded hover:bg-white/5" title="Copy"><Copy size={10} /></button>
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
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
                      }} disabled={!isLoggedIn} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-white/5 hover:bg-white/10 text-xs transition" style={{ color: 'var(--text-muted)' }}>
                        <Sparkles size={10} /> Explain Output
                      </button>
                    </div>
                  </div>
                )}

                {/* Error */}
                {aiError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {aiError}
                  </div>
                )}

                {/* AI Answer */}
                {aiAnswer && (
                  <div className={`rounded-lg border overflow-hidden ${aiAnswer.danger ? 'border-red-500/30' : 'border-white/10'}`}>
                    <div className={`px-3 py-2 ${aiAnswer.danger ? 'bg-red-500/10' : 'bg-black/20'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>AI Response</span>
                        {aiAnswer.danger && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><ShieldAlert size={10} /> Danger</span>}
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-black/40 rounded px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{aiAnswer.command || '(no command)'}</pre>
                      {(aiAnswer.explain || aiAnswer.warn) && (
                        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {aiAnswer.warn && <div className="text-red-300/80 mb-1">{aiAnswer.warn}</div>}
                          {aiAnswer.explain}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 p-2 border-t border-white/10 bg-black/10">
                      <button onClick={() => navigator.clipboard.writeText(aiAnswer.command || '')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 hover:bg-white/10 text-xs transition" style={{ color: 'var(--text-primary)' }}><Copy size={12} /> Copy</button>
                      <button onClick={() => handleInsertCommand(aiAnswer.command)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs transition"><CornerDownLeft size={12} /> Insert</button>
                      <button onClick={() => {
                        if (!isLoggedIn) { setAiError('Login required'); return; }
                        if (aiAnswer.danger) { setExecuteConfirmOpen(true); return; }
                        handleExecuteCommand(aiAnswer.command);
                      }} disabled={!isLoggedIn} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-white text-xs transition ${aiAnswer.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}><CornerDownLeft size={12} /> Run</button>
                    </div>
                  </div>
                )}

                {/* Interactive Prompt */}
                {interactivePrompt?.kind === 'confirm_yn' && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Waiting for input...</div>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap mb-2 opacity-80" style={{ color: 'var(--text-primary)' }}>{interactivePrompt.text}</pre>
                    <div className="flex gap-2">
                      <button onClick={() => { setInteractivePrompt(null); sendQuickInput('y'); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes (y)</button>
                      <button onClick={() => { setInteractivePrompt(null); sendQuickInput('n'); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No (n)</button>
                    </div>
                  </div>
                )}

                {/* Danger Confirmation */}
                {executeConfirmOpen && aiAnswer?.danger && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-300 mb-2"><ShieldAlert size={12} /> Confirm execution</div>
                    <div className="text-[11px] opacity-80 mb-3" style={{ color: 'var(--text-primary)' }}>This command will run immediately on your SSH session.</div>
                    <div className="flex gap-2">
                      <button onClick={() => setExecuteConfirmOpen(false)} className="flex-1 py-1.5 rounded border border-white/10 hover:bg-white/5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Cancel</button>
                      <button onClick={() => { setExecuteConfirmOpen(false); handleExecuteCommand(aiAnswer?.command); }} disabled={!isLoggedIn} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">Execute</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Rnd>
        )}
      </div>
    </div>
  );
}
