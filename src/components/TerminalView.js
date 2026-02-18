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
  const aiConversationRef = useRef([]); // conversation history for multi-step context

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
  const [autoCountdown, setAutoCountdown] = useState(0);
  const aiPanelContentRef = useRef(null);
  const autoRunningRef = useRef(false);
  const autoSeenRef = useRef(new Set());
  const autoVerifyKeyRef = useRef('');
  const autoLastLoopKeyRef = useRef('');
  const autoLoopRepeatRef = useRef(0);
  const [aiMode, setAiMode] = useState('manual'); // manual | auto
  const [lastAiUpdate, setLastAiUpdate] = useState(0);
  const autoEmptyRetryRef = useRef('');
  const containerRef = useRef(null);

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
      const m = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'i').exec(String(raw || ''));
      return m ? m[1].trim() : '';
    };
    const command = getTag('command');
    const explain = getTag('explain');
    const dangerRaw = getTag('danger');
    const warn = getTag('warn');
    const doneRaw = getTag('done');
    const interactive = getTag('interactive');
    const danger = String(dangerRaw || '').trim().toLowerCase() === 'true';
    const done = String(doneRaw || '').trim().toLowerCase() === 'true';
    return { command, explain, danger, warn, done, interactive, raw: String(raw || '').trim() };
  };

  const getOutputContext = () => {
    const maxLines = 12;
    const maxChars = 2500;
    const lines = outputLinesRef.current.slice(-maxLines);
    const joined = lines.join('\n');
    return joined.length > maxChars ? joined.slice(-maxChars) : joined;
  };

  const looksLikeShellPrompt = (text) => {
    const lines = String(text || '').split('\n').filter(Boolean);
    const last = (lines[lines.length - 1] || '').trim();
    if (!last) return false;
    // Common prompts: user@host:path$ , [user@host ~]# , bash-5.1$ , sh-4.4# , % (zsh), > (powershell/fish)
    if (/[$#%>]\s*$/.test(last)) return true;
    // Prompt with brackets: [root@server ~]#
    if (/\][$#%>]\s*$/.test(last)) return true;
    // bash version prompts: bash-5.1$
    if (/^(bash|sh|zsh|fish)-[\d.]+[$#]\s*$/.test(last)) return true;
    return false;
  };

  const looksLikeEditorOrPager = (text) => {
    const t = String(text || '').toLowerCase();
    // nano editor indicators
    if (t.includes('gnu nano') || t.includes('^g get help') || t.includes('^x exit')) return 'nano';
    // vim/vi indicators
    if (t.includes('-- insert --') || t.includes('-- visual --') || t.includes('~') && /\n~\n/.test(t)) return 'vim';
    // less/more pager
    if (/\(end\)\s*$/.test(t) || /:\s*$/.test(t.split('\n').pop() || '')) return 'pager';
    // man page
    if (t.includes('manual page') || t.includes('man page')) return 'man';
    return null;
  };

  const waitForCommandSettle = async (commandHint) => {
    const maxMs = 90000; // 90s max for long installs
    const cmdLower = String(commandHint || '').toLowerCase();

    // Adaptive idle threshold based on command type
    let idleMs = 1500; // default
    if (/(yum|dnf|apt|apt-get|apk|pacman|pip|npm|yarn|cargo|gem|go )\s+(install|update|upgrade|remove)/.test(cmdLower)) {
      idleMs = 3000; // package installs can have pauses
    } else if (/(wget|curl|git clone|scp|rsync)/.test(cmdLower)) {
      idleMs = 4000; // downloads
    } else if (/(make|cmake|gcc|g\+\+|cargo build)/.test(cmdLower)) {
      idleMs = 5000; // compilation
    } else if (/(cat |head |tail |ls |echo |whoami|pwd|id |hostname|uname|which |whereis |file |stat )/.test(cmdLower)) {
      idleMs = 800; // quick commands settle fast
    }

    const start = Date.now();
    let lastCheckSnap = '';

    while (Date.now() - start < maxMs) {
      const snap = getOutputContext();

      // Check for interactive prompt
      const interactive = detectInteractivePrompt(snap);
      if (interactive) return { reason: 'interactive', snap, interactive };

      // Check for editor/pager (these never "settle" — output stops but we're stuck)
      const editorPager = looksLikeEditorOrPager(snap);
      if (editorPager) return { reason: 'editor', snap, editor: editorPager };

      // Check for errors (settle quickly)
      const err = detectTerminalError(snap);
      if (err) {
        const idleFor = Date.now() - (lastOutputAtRef.current || 0);
        if (idleFor > 500) return { reason: 'error', snap, error: err };
      }

      // Check for shell prompt idle
      const idleFor = Date.now() - (lastOutputAtRef.current || 0);
      if (idleFor > idleMs && looksLikeShellPrompt(snap)) {
        return { reason: 'prompt', snap };
      }

      // Detect stuck (no output change for a long time, but no prompt)
      if (idleFor > 15000 && snap === lastCheckSnap) {
        return { reason: 'stuck', snap };
      }

      lastCheckSnap = snap;
      await new Promise(r => setTimeout(r, 250));
    }

    return { reason: 'timeout', snap: getOutputContext() };
  };

  const detectInteractivePrompt = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const t = raw.toLowerCase();
    const lastLine = (raw.split('\n').filter(Boolean).pop() || '').trim();
    const lastLineLower = lastLine.toLowerCase();

    // === Y/N Confirmation Prompts ===
    // yum/dnf/apt confirmation
    if (/(\(y\/n\)|\[y\/n\]|\[y\/n\/d\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\[yes\/no\])/i.test(lastLine)) {
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

    // === SSH Key Prompts ===
    if (/enter file in which to save/i.test(lastLine)) {
      return { kind: 'ssh_key_file', text: lastLine };
    }
    if (/are you sure you want to continue connecting/i.test(t)) {
      return { kind: 'ssh_host_verify', text: lastLine };
    }

    // === Press ENTER / Any Key ===
    if (/press.*enter/i.test(lastLine) || /press.*return/i.test(lastLine) || /press any key/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
    }
    if (/hit enter/i.test(lastLine) || /press.*to continue/i.test(lastLine)) {
      return { kind: 'press_enter', text: lastLine };
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
      if (/\?\s*[:：]\s*$/i.test(lastLine) || /enter\s/i.test(lastLineLower) || /type\s/i.test(lastLineLower) || /provide\s/i.test(lastLineLower) || /specify\s/i.test(lastLineLower)) {
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

    // === Network Errors ===
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
    // "failed" alone can be noisy — only match if it's clearly an error line
    if (/^.*\bfailed\b.*$/m.test(recentLines) && !/\bsuccess/i.test(recentLines)) {
      // Avoid false positive from lines like "0 failed" (test results)
      if (!/\b0\s+failed\b/i.test(recentLines)) {
        return { type: 'generic_error', label: 'Command failed', severity: 'medium' };
      }
    }

    return null;
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
      const looksLikeInstall = /(yum|dnf|apt|apt-get|apk|pacman|pip|npm|gem)\s+.*\b(install|upgrade|update|remove)\b/.test(cmd) || /\binstall\b/.test(cmd);

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
      const settled = await waitForCommandSettle(cmd);
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
      setAiError(t('ai.loginRequired'));
      return;
    }
    const effectivePrompt = String(promptOverride ?? aiPrompt).trim();
    if (!effectivePrompt || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);
    try {
      // Add user message to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: effectivePrompt }
      ].slice(-4); // Keep last 4 messages

      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          context: getOutputContext(),
          connectionName,
          host,
          prefs: sshAiPrefs,
          history: aiConversationRef.current.slice(0, -1), // Send history excluding current message
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'AI request failed');
      const parsed = parseAiAnswer(data.answer);
      setAiAnswer(parsed);
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
      ].slice(-4);

      const entry = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        createdAt: Date.now(),
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

      return parsed;
    } catch (e) {
      setAiError(e.message);
      return null;
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
    const loopKey = `${lastExecutedCommand || ''}::${snap.slice(-200)}`;
    if (autoLastLoopKeyRef.current === loopKey) {
      autoLoopRepeatRef.current += 1;
    } else {
      autoLastLoopKeyRef.current = loopKey;
      autoLoopRepeatRef.current = 0;
    }
    if (autoLoopRepeatRef.current >= 3) {
      setAiError('Auto Mode stopped: output did not change after 3 attempts (loop detected).');
      setAutoMode(false);
      return;
    }

    autoRunningRef.current = true;
    try {
      // Build contextual prompt for auto-mode (Optimized for tokens)
      const autoPrompt = `[AUTO] Goal: ${goal}
State:
- Last Cmd: ${lastExecutedCommand || '(none)'}
- Error: ${err ? `${err.label}` : 'none'}
- Output (last lines):
${String(snap || '(no output)').slice(-2500)}

Instructions:
1. Next command?
2. If DONE (proven in output), set <done>true</done>.
3. Fix errors.
4. Auto-confirm (-y). NO interactive editors.
5. Step ${21 - autoStepsRemaining}/20.`;

      // Add to conversation history
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'user', content: autoPrompt }
      ].slice(-4); // Keep last 4 messages only

      const res = await apiFetch('/api/ssh/ai-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: autoPrompt,
          context: String(snap || '').slice(-2500),
          connectionName,
          host,
          prefs: sshAiPrefs,
          history: aiConversationRef.current.slice(0, -1),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'AI request failed');
      const parsed = parseAiAnswer(data.answer);
      setAiAnswer(parsed);

      // Track AI response
      aiConversationRef.current = [
        ...aiConversationRef.current,
        { role: 'assistant', content: data.answer }
      ].slice(-10);

      // === AI says DONE ===
      if (parsed.done) {
        setAiError(null);
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
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

      // === Interactive command warning: pause ===
      if (parsed.interactive) {
        const interactiveType = String(parsed.interactive).toLowerCase();
        if (/(editor|password|passphrase|multiple prompts)/i.test(interactiveType)) {
          setAiOpen(true);
          setAiHasOpenedOnce(true);
          setAiError(`Auto Mode paused: command requires ${parsed.interactive}.`);
          setAutoMode(false);
          return;
        }
      }

      // === No command and not done: AI is stuck ===
      if (!parsed.command || !String(parsed.command).trim()) {
        const needRetryKey = `${goal}::${lastExecutedCommand || ''}::${snap.slice(-100)}`;
        if (autoEmptyRetryRef.current !== needRetryKey) {
          // Retry once
          autoEmptyRetryRef.current = needRetryKey;
          autoRunningRef.current = false;
          await runAutoStep(snap);
          return;
        }

        setAiError('Auto Mode stopped: AI could not determine next command.');
        setAutoMode(false);
        setAiOpen(true);
        setAiHasOpenedOnce(true);
        return;
      }

      autoEmptyRetryRef.current = '';

      // === Execute the command ===
      setAutoStepsRemaining((n) => Math.max(0, n - 1));
      const newSnap = await executeCommandAndCapture(parsed.command);
      maybeAutoExplainError(String(parsed.command || '').trim(), newSnap);

      // Check if editor/pager was accidentally opened
      const editorCheck = looksLikeEditorOrPager(newSnap);
      if (editorCheck) {
        setAiError(`Auto Mode paused: ${editorCheck} editor/pager was opened. Please close it manually.`);
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

    let timer;
    let count = 3;
    setAutoCountdown(count);
    
    timer = setInterval(() => {
      count--;
      setAutoCountdown(count);
      if (count <= 0) {
        clearInterval(timer);
        setAutoCountdown(0);
        runAutoStep(lastResultSnapshot);
      }
    }, 1000);

    return () => clearInterval(timer);
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
    <div ref={containerRef} className="h-full flex flex-col">
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
              <div className="ai-panel-drag-handle flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 dark:bg-black/20">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('ai.title')}</span>
                  {autoMode && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 animate-pulse">{t('ai.running')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setAiHistoryOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.history')} style={{ color: 'var(--text-secondary)' }}><Clock size={12} /></button>
                  <button type="button" onClick={() => setAiSettingsOpen(v => !v)} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] dark:hover:bg-white/5" title={t('ai.settings')} style={{ color: 'var(--text-secondary)' }}><Settings2 size={12} /></button>
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
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('ai.settings')}</span>
                    <button onClick={() => setAiSettingsOpen(false)} className="text-[10px] opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{t('ai.close')}</button>
                  </div>
                  <div className="p-3 space-y-3">
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>{t('ai.preferSudo')}</span>
                      <input type="checkbox" checked={!!sshAiPrefs.preferSudo} onChange={(e) => setSshAiPrefs({ preferSudo: e.target.checked })} disabled={!isLoggedIn} />
                    </label>
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>{t('ai.autoAnswer')}</span>
                      <input type="checkbox" checked={!!sshAiPrefs.autoAnswerPrompts} onChange={(e) => setSshAiPrefs({ autoAnswerPrompts: e.target.checked })} disabled={!isLoggedIn} />
                    </label>
                    <label className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <span>{t('ai.autoExplain')}</span>
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
              <div ref={aiPanelContentRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-10 space-y-4">

                {/* Mode Toggle */}
                <div className="flex items-center justify-between bg-[var(--bg-tertiary)]/50 dark:bg-black/20 rounded-lg p-1">
                  <div className="flex">
                    <button onClick={() => { setAiMode('manual'); setAutoMode(false); }} className={`px-3 py-1.5 rounded text-[11px] font-medium transition ${aiMode === 'manual' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5'}`} style={{ color: 'var(--text-primary)' }}>{t('ai.manual')}</button>
                    <button onClick={() => setAiMode('auto')} className={`px-3 py-1.5 rounded text-[11px] font-medium transition ${aiMode === 'auto' ? 'bg-[var(--bg-primary)] dark:bg-white/10 shadow-sm' : 'hover:bg-[var(--bg-primary)]/50 dark:hover:bg-white/5'}`} style={{ color: 'var(--text-primary)' }}>{t('ai.auto')}</button>
                  </div>
                  {aiMode === 'auto' && (
                    <button onClick={() => {
                      if (!isLoggedIn) { setAiError(t('ai.loginRequired')); return; }
                      if (!autoMode) {
                        autoSeenRef.current = new Set();
                        autoVerifyKeyRef.current = '';
                        autoLastLoopKeyRef.current = '';
                        autoLoopRepeatRef.current = 0;
                        aiConversationRef.current = []; // Fresh conversation for new goal
                        setAutoGoal(g => String(g || aiPrompt || '').trim());
                        setAutoStepsRemaining(30);
                        setAutoMode(true);
                        setLastResultSnapshot(s => s || getOutputContext());
                        setLastResultAt(p => { const n = Date.now(); return n > (p || 0) ? n : (p || 0) + 1; });
                      } else {
                        setAutoMode(false);
                      }
                    }} className={`px-3 py-1.5 rounded text-[11px] font-bold transition ${autoMode ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {autoMode ? t('ai.stop') : t('ai.start')}
                    </button>
                  )}
                </div>

                {/* Auto Mode Info */}
                {aiMode === 'auto' && (
                  <div className="space-y-2">
                    <input value={autoGoal} onChange={(e) => setAutoGoal(e.target.value)} placeholder={t('ai.goalPlaceholder')} className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] px-3 py-2 text-xs outline-none focus:border-indigo-500/50" disabled={!isLoggedIn} style={{ color: 'var(--text-primary)' }} />
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      <span>{t('ai.steps')} {autoStepsRemaining} {autoCountdown > 0 && <span className="text-amber-400 ml-2 animate-pulse">{t('ai.wait', { count: autoCountdown })}</span>}</span>
                      <span className={autoMode ? 'text-emerald-400' : ''}>{autoMode ? t('ai.running') : t('ai.idle')}</span>
                    </div>
                  </div>
                )}

                {/* Command Input */}
                <div className="space-y-2">
                  <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={t('ai.promptPlaceholder')} className="w-full h-20 resize-none rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] px-3 py-2 text-xs outline-none focus:border-indigo-500/50" disabled={!isLoggedIn} style={{ color: 'var(--text-primary)' }} />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] opacity-60" style={{ color: 'var(--text-muted)' }}>{t('ai.usesLastOutput')}</span>
                    <button onClick={() => handleAskAi()} disabled={!isLoggedIn || aiLoading || !aiPrompt.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition">
                      {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                      {t('ai.askAi')}
                    </button>
                  </div>
                </div>

                {/* Last Result Preview */}
                {(lastExecutedCommand || lastResultSnapshot) && (
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)]/20 dark:bg-black/20 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
                      <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{t('ai.lastResult')}</span>
                      <div className="flex gap-1">
                        <button onClick={refreshLastResultSnapshot} className="p-1 rounded hover:bg-white/5" title={t('ai.refresh')}><RefreshCw size={10} /></button>
                        <button onClick={() => navigator.clipboard.writeText([lastExecutedCommand, lastResultSnapshot].filter(Boolean).join('\n'))} className="p-1 rounded hover:bg-white/5" title={t('ai.copy')}><Copy size={10} /></button>
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
                      }} disabled={!isLoggedIn} className="w-full flex items-center justify-center gap-1.5 py-2 rounded bg-gradient-to-r from-indigo-500/10 to-purple-500/10 hover:from-indigo-500/20 hover:to-purple-500/20 border border-indigo-500/20 text-xs font-medium text-indigo-200 hover:text-white transition-all shadow-sm group">
                        <Sparkles size={12} className="text-indigo-400 group-hover:text-indigo-300 transition-colors" /> {t('terminal.explainOutput')}
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
                  <div className={`rounded-lg border overflow-hidden ${aiAnswer.danger ? 'border-red-500/30' : aiAnswer.done ? 'border-emerald-500/30' : 'border-white/10'}`}>
                    <div className={`px-3 py-2 ${aiAnswer.danger ? 'bg-red-500/10' : aiAnswer.done ? 'bg-emerald-500/10' : 'bg-black/20'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{t('ai.aiResponse')}</span>
                        <div className="flex items-center gap-2">
                          {aiAnswer.done && <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10} /> {t('ai.done')}</span>}
                          {aiAnswer.danger && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><ShieldAlert size={10} /> {t('ai.danger')}</span>}
                          {aiAnswer.interactive && <span className="text-[10px] font-bold text-amber-400">⚡ {aiAnswer.interactive}</span>}
                        </div>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-[var(--bg-primary)]/50 dark:bg-black/40 border border-[var(--border-color)] rounded px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{aiAnswer.command || (aiAnswer.done ? `✅ ${t('ai.done')}!` : '(no command)')}</pre>
                      {(aiAnswer.explain || aiAnswer.warn) && (
                        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {aiAnswer.warn && <div className="text-red-600 dark:text-red-300/80 mb-1">{aiAnswer.warn}</div>}
                          {aiAnswer.explain}
                        </div>
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

                {/* Interactive Prompt - All Types */}
                {interactivePrompt && (
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
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('y'); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes (y)</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('n'); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No (n)</button>
                      </div>
                    )}

                    {/* SSH Host Verification */}
                    {interactivePrompt.kind === 'ssh_host_verify' && (
                      <div className="flex gap-2">
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('yes'); }} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">Yes</button>
                        <button onClick={() => { setInteractivePrompt(null); sendQuickInput('no'); }} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">No</button>
                      </div>
                    )}

                    {/* Press ENTER */}
                    {interactivePrompt.kind === 'press_enter' && (
                      <button onClick={() => { setInteractivePrompt(null); if (socketRef.current?.connected) socketRef.current.emit('ssh:input', '\n'); }} className="w-full py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Press ENTER</button>
                    )}

                    {/* Password warning (manual only) */}
                    {(interactivePrompt.kind === 'password' || interactivePrompt.kind === 'sudo_password' || interactivePrompt.kind === 'passphrase') && (
                      <div className="text-[10px] opacity-70 mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Type your {interactivePrompt.kind === 'sudo_password' ? 'sudo password' : interactivePrompt.kind} directly in the terminal below.
                      </div>
                    )}

                    {/* Selection / Text Input */}
                    {(interactivePrompt.kind === 'selection' || interactivePrompt.kind === 'text_input' || interactivePrompt.kind === 'ssh_key_file') && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder={interactivePrompt.kind === 'selection' ? 'Enter selection...' : 'Enter value...'}
                          className="flex-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] px-2 py-1.5 text-xs outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setInteractivePrompt(null);
                              sendQuickInput(e.target.value);
                            }
                          }}
                        />
                        <button onClick={() => { setInteractivePrompt(null); if (socketRef.current?.connected) socketRef.current.emit('ssh:input', '\n'); }} className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">ENTER</button>
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
                      <button onClick={() => { setExecuteConfirmOpen(false); handleExecuteCommand(aiAnswer?.command); }} disabled={!isLoggedIn} className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium">{t('ai.execute')}</button>
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
