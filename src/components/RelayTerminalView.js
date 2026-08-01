'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { RelayClient } from '@/lib/relayClient';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw, Wifi, WifiOff
} from 'lucide-react';

let Terminal, FitAddon;

// Simple XOR encryption for sessionStorage credentials (prevents casual reading)
const CRED_KEY = 'ssh_monitor_relay_2024';
function encryptCreds(data) {
  const str = JSON.stringify(data);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    result += String.fromCharCode(str.charCodeAt(i) ^ CRED_KEY.charCodeAt(i % CRED_KEY.length));
  }
  return btoa(result);
}
function decryptCreds(encoded) {
  try {
    const str = atob(encoded);
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += String.fromCharCode(str.charCodeAt(i) ^ CRED_KEY.charCodeAt(i % CRED_KEY.length));
    }
    return JSON.parse(result);
  } catch { return null; }
}

const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== 'string') return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export default function RelayTerminalView({
  connectionId,
  connection,
  connectionName,
  host,
  initialCommand,
  dbUri,
}) {
  const { t } = useTranslation();
  const { state: osState } = useOS();
  const { state: appState, dispatch } = useApp();
  const { vaultStatus } = useVault();

  const terminalRef = useRef(null);
  const termInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const relayRef = useRef(null);
  const hasEmittedConnectedBannerRef = useRef(false);
  const propsRef = useRef({ connectionId, connection, connectionName, host, initialCommand, dbUri });
  const osStateRef = useRef(osState);

  // Keep osState ref in sync (avoids re-creating initTerminal on every OS state change)
  useEffect(() => {
    osStateRef.current = osState;
  }, [osState]);

  const [status, setStatus] = useState('connecting');
  const [latency, setLatency] = useState(null);
  const [showReconnect, setShowReconnect] = useState(false);
  const [relayStatus, setRelayStatus] = useState(null); // null = checking, 'connected', 'disconnected', 'no_ssh2'
  const [capabilities, setCapabilities] = useState(null); // { ssh: bool, sftp: bool, docker: bool }

  // Check relay agent status on mount
  useEffect(() => {
    const checkRelayStatus = async () => {
      try {
        const res = await fetch('/api/relay/token');
        const data = await res.json();
        if (data.success && data.connected) {
          setRelayStatus('connected');
          setCapabilities(data.capabilities || { ssh: false, sftp: false, docker: false });
        } else {
          setRelayStatus('disconnected');
        }
      } catch {
        setRelayStatus('disconnected');
      }
    };
    checkRelayStatus();
  }, []);

  // Keep props ref in sync
  useEffect(() => {
    propsRef.current = { connectionId, connection, connectionName, host, initialCommand, dbUri };
  }, [connectionId, connection, connectionName, host, initialCommand, dbUri]);

  const updateConnectionStatus = useCallback((newStatus) => {
    if (connectionId) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: { _id: connectionId, status: newStatus } });
    }
  }, [connectionId, dispatch]);

  const initTerminal = useCallback(async () => {
    if (vaultStatus === 'loading') return;
    if (vaultStatus === 'locked') {
      setStatus('error');
      setErrorMsg('🔒 Vault Locked — Please enter your Master Password to unlock the vault and establish SSH connections.');
      return;
    }

    // Dynamic imports for xterm (client-side only)
    if (!Terminal) {
      const xtermModule = await import('@xterm/xterm');
      const fitModule = await import('@xterm/addon-fit');
      Terminal = xtermModule.Terminal;
      FitAddon = fitModule.FitAddon;
      await import('@xterm/xterm/css/xterm.css');
    }

    if (!terminalRef.current || termInstanceRef.current) return;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    // Read terminal settings directly from ref to avoid osState dependency
    const settings = osStateRef.current?.terminalSettings || {};
    const bgOpacity = settings.backgroundOpacity ?? 1;
    const baseBg = settings.theme?.background || '#0c0c0c';

    const term = new Terminal({
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      cursorStyle: settings.cursorStyle || 'bar',
      fontSize: settings.fontSize || 14,
      fontFamily: settings.fontFamily || "'JetBrains Mono', monospace",
      fontWeight: settings.fontWeight || 'normal',
      letterSpacing: settings.letterSpacing || 0,
      macOptionClickForcesSelection: true,
      theme: {
        background: hexToRgba(baseBg, bgOpacity),
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: '#818cf840',
      },
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    termInstanceRef.current = term;

    // Fit terminal
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (_) {}
    });

    // Connection banner
    term.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m');
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[1mConnecting to \x1b[1;33m${propsRef.current.connectionName}\x1b[0m`);
    term.writeln(`\x1b[1;36m║\x1b[0m  \x1b[90m${propsRef.current.host}\x1b[0m`);
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    // Connect via relay
    const client = new RelayClient();
    relayRef.current = client;

    client.on('connected', () => {
      setStatus('connected');
      updateConnectionStatus('online');
      setShowReconnect(false);
      if (!hasEmittedConnectedBannerRef.current) {
        hasEmittedConnectedBannerRef.current = true;
        term.writeln(`\x1b[1;32m✓ Connected via relay\x1b[0m\n`);
        term.writeln('\r');
      }
      term.focus();

      // Heartbeat loop for latency monitoring
      client._heartbeatInterval = setInterval(() => {
        if (client.connected) {
          client.heartbeat();
        }
      }, 3000);

      client.on('heartbeat:pong', (sentTimestamp) => {
        setLatency(Date.now() - sentTimestamp);
      });

      // Send initial command if provided
      if (propsRef.current.initialCommand) {
        setTimeout(() => {
          if (client.connected) {
            client.write(propsRef.current.initialCommand + '\r');
          }
        }, 800);
      }
    });

    client.on('data', (data) => {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      term.write(str);
    });

    client.on('error', (err) => {
      setStatus('error');
      updateConnectionStatus('offline');
      
      const errorMsg = err.message || 'Connection failed';
      
      // Detect specific errors and show helpful messages
      if (errorMsg.includes('websocket error') || errorMsg.includes('ECONNREFUSED')) {
        term.writeln('\r\n\x1b[1;31m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;33m⚠ Relay Agent Not Running\x1b[0m');
        term.writeln('\x1b[1;31m╠══════════════════════════════════════════════════════════╣\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  The relay agent is not running on your machine.');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1mTo install and run the relay agent:\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  1. Go to \x1b[1;36mSettings → Database\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  2. Click \x1b[1;32m"Install Relay Agent"\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  3. Run the command shown on your machine');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  Or manually: \x1b[1;36mnpm install ssh2\x1b[0m then');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;36mnode local-relay.js --server YOUR_SERVER --token YOUR_TOKEN\x1b[0m');
        term.writeln('\x1b[1;31m╚══════════════════════════════════════════════════════════╝\x1b[0m');
      } else if (errorMsg.includes('ssh2 not installed')) {
        term.writeln('\r\n\x1b[1;31m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;33m⚠ ssh2 Not Installed\x1b[0m');
        term.writeln('\x1b[1;31m╠══════════════════════════════════════════════════════════╣\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  The relay agent needs ssh2 to handle SSH connections.');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1mOn your machine, run:\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;36mnpm install ssh2\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  Then restart the relay agent.');
        term.writeln('\x1b[1;31m╚══════════════════════════════════════════════════════════╝\x1b[0m');
      } else if (errorMsg.includes('Unauthorized') || errorMsg.includes('Authentication')) {
        term.writeln('\r\n\x1b[1;31m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;33m⚠ Authentication Failed\x1b[0m');
        term.writeln('\x1b[1;31m╠══════════════════════════════════════════════════════════╣\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  Your session may have expired.');
        term.writeln('\x1b[1;31m║\x1b[0m  ');
        term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1mPlease:\x1b[0m');
        term.writeln('\x1b[1;31m║\x1b[0m  1. Refresh the page');
        term.writeln('\x1b[1;31m║\x1b[0m  2. Log in again if needed');
        term.writeln('\x1b[1;31m╚══════════════════════════════════════════════════════════╝\x1b[0m');
      } else {
        term.writeln(`\r\n\x1b[1;31m✗ Error: ${errorMsg}\x1b[0m`);
      }
      
      setShowReconnect(true);
    });

    client.on('closed', () => {
      setStatus('disconnected');
      updateConnectionStatus('offline');
      if (client._heartbeatInterval) clearInterval(client._heartbeatInterval);
      term.writeln('\r\n\x1b[1;33m⚠ Connection closed\x1b[0m');
      setShowReconnect(true);
    });

    client.on('disconnected', () => {
      setStatus('disconnected');
      if (client._heartbeatInterval) clearInterval(client._heartbeatInterval);
      setShowReconnect(true);
    });

    // Terminal → Relay
    term.onData((data) => {
      if (client.connected) {
        client.write(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      try {
        fitAddon.fit();
        if (client.connected) {
          client.resize(term.cols, term.rows);
        }
      } catch (_) {}
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Connect to relay
    try {
      await client.connect();
      
      // Build connection data with password from sessionStorage if available
      const conn = propsRef.current.connection || {};
      const connId = conn._id;
      
      // Try to get password from sessionStorage (persisted from previous session)
      let password = conn.password;
      let privateKey = conn.privateKey;
      let passphrase = conn.passphrase;
      
      if (connId) {
        const storedCreds = sessionStorage.getItem(`relay_creds_${connId}`);
        if (storedCreds) {
          try {
            const parsed = decryptCreds(storedCreds);
            if (parsed) {
              password = password || parsed.password;
              privateKey = privateKey || parsed.privateKey;
              passphrase = passphrase || parsed.passphrase;
            }
          } catch {}
        }
      }
      
      // Store credentials in sessionStorage for future reconnects (encrypted)
      if (connId && (password || privateKey)) {
        sessionStorage.setItem(`relay_creds_${connId}`, encryptCreds({
          password,
          privateKey,
          passphrase,
        }));
      }
      
      // Send connection with credentials
      client.requestConnection(
        { ...conn, password, privateKey, passphrase },
        term.cols,
        term.rows
      );
    } catch (err) {
      setStatus('error');
      term.writeln(`\x1b[1;31m✗ Relay connection failed: ${err.message}\x1b[0m`);
      setShowReconnect(true);
    }

    // Cleanup function
    return () => {
      if (client._heartbeatInterval) clearInterval(client._heartbeatInterval);
      resizeObserver.disconnect();
      client.close();
      term.dispose();
      termInstanceRef.current = null;
      relayRef.current = null;
    };
  }, [vaultStatus, updateConnectionStatus]);

  // Initialize terminal on mount
  useEffect(() => {
    let cleanup;
    initTerminal().then((fn) => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, [initTerminal]);

  // Reconnect handler
  const handleReconnect = () => {
    setShowReconnect(false);
    setStatus('connecting');
    if (termInstanceRef.current) {
      termInstanceRef.current.clear();
    }
    if (relayRef.current) {
      relayRef.current.close();
    }
    termInstanceRef.current = null;
    relayRef.current = null;
    initTerminal();
  };

  return (
    <div className="flex flex-col h-full w-full relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Relay status warning banner */}
      {relayStatus === 'disconnected' && (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ background: 'var(--accent-amber)', color: '#000' }}
        >
          <WifiOff size={14} />
          <span className="text-xs font-medium flex-1">
            Relay agent not running. Install and run local-relay.js on your machine.
          </span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'database' }));
            }}
            className="text-xs font-bold underline"
          >
            Setup Guide
          </a>
        </div>
      )}

      {/* ssh2 not installed warning */}
      {relayStatus === 'connected' && capabilities && !capabilities.ssh && (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ background: 'var(--accent-rose)', color: '#fff' }}
        >
          <AlertCircle size={14} />
          <span className="text-xs font-medium flex-1">
            ssh2 not installed on relay agent. Run <code className="font-mono bg-black/20 px-1 rounded">npm install ssh2</code> on your machine.
          </span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'database' }));
            }}
            className="text-xs font-bold underline"
          >
            Help
          </a>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          {status === 'connecting' && (
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent-amber)' }} />
          )}
          {status === 'connected' && (
            <CheckCircle2 size={12} style={{ color: 'var(--accent-emerald)' }} />
          )}
          {status === 'error' && (
            <AlertCircle size={12} style={{ color: 'var(--accent-rose)' }} />
          )}
          {status === 'disconnected' && (
            <XCircle size={12} style={{ color: 'var(--text-muted)' }} />
          )}
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Connected (relay)'}
            {status === 'error' && 'Error'}
            {status === 'disconnected' && 'Disconnected'}
          </span>
          
          {/* Relay agent status indicator */}
          {relayStatus === 'connected' && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent-emerald)', color: '#000' }}
            >
              Relay Online
            </span>
          )}
          {relayStatus === 'disconnected' && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent-amber)', color: '#000' }}
            >
              Relay Offline
            </span>
          )}
          
          {/* ssh2 capability indicator */}
          {relayStatus === 'connected' && capabilities && !capabilities.ssh && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent-rose)', color: '#fff' }}
            >
              ssh2 Missing
            </span>
          )}
          {relayStatus === 'connected' && capabilities?.ssh && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent-emerald)', color: '#000' }}
            >
              ssh2 OK
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {latency !== null && status === 'connected' && (
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {latency}ms
            </span>
          )}
          {showReconnect && (
            <button
              onClick={handleReconnect}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background: 'var(--accent-indigo)',
                color: 'white',
              }}
            >
              <RefreshCw size={10} />
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 p-1"
        style={{ background: 'var(--terminal-bg, #0c0c0c)' }}
      />
    </div>
  );
}
