'use client';

import { useApp } from '@/context/AppContext';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Loader2, AlertCircle, CheckCircle2, XCircle, X, Minus, Maximize2, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

let Terminal, FitAddon, WebLinksAddon;

export default function TerminalView({ connectionId, connectionName, host, color, onClose, connection, isStandalone }) {
  const { state: appState, dispatch } = useApp();
  const { t } = useTranslation();
  const terminalRef = useRef(null);
  const termInstanceRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting, connected, error, closed
  const [errorMsg, setErrorMsg] = useState(null);
  const [latency, setLatency] = useState(null);

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
    });

    socket.on('ssh:error', (data) => {
      setStatus('error');
      setErrorMsg(data.message);
      // updateConnectionStatus('offline'); // Optional, or keep as error
      term.writeln(`\n\x1b[1;31m✗ ${t('terminal.errorPrefix')} ${data.message}\x1b[0m`);
    });

    socket.on('ssh:closed', () => {
      setStatus('closed');
      updateConnectionStatus('offline'); // Update global state
      term.writeln(`\n\x1b[1;33m⚠ ${t('terminal.connectionClosed')}\x1b[0m`);
    });

    socket.on('disconnect', () => {
      if (status !== 'closed') {
        setStatus('closed');
        updateConnectionStatus('offline');
        term.writeln(`\n\x1b[1;31m✗ ${t('terminal.socketDisconnected')}\x1b[0m`);
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
      </div>
    </div>
  );
}
