'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOS } from '@/context/OSContext';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Lock,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Loader2,
  Globe,
  Sparkles,
  Server,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { openExternalUrl } from '@/utils/webuiOpenMode';

const PROBE_TIMEOUT_MS = 30_000;

/**
 * AgentWebUIBrowserApp
 *
 * A first-class desktop browser app for AI Agent WebUIs.
 * Spawns as an independent desktop window managed by OSContext,
 * survives when the AI Agents app is closed, and features full browser chrome
 * with an address bar, navigation controls, tunnel escape recovery, and
 * a titlebar/toolbar that adapts to macOS or Windows themes.
 */
export default function AgentWebUIBrowserApp({
  windowId,
  url,
  agentId = 'agent',
  agentName = 'AI Agent',
  connectionId = '',
  connectionName = 'remote server',
  port = '',
  onOpenExternal,
}) {
  const { state: osState } = useOS();
  const windowLayout = osState?.windowLayout || 'mac';
  const isMacTheme = windowLayout === 'mac';

  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [frameSrc, setFrameSrc] = useState('');
  const [escapeNotice, setEscapeNotice] = useState('');

  const abortRef = useRef(null);
  const frameRef = useRef(null);
  const lastRepairRef = useRef(0);

  // Clean formatted display URL for the address bar
  const displayAddress = port
    ? `http://${connectionName || 'agent'}:${port}`
    : `agent://${agentId || 'webui'}`;

  // Probe the same-origin proxy URL before mounting the iframe
  const probe = useCallback(async () => {
    if (!url) {
      setPhase('error');
      setError('No target server selected. Please select a server to connect.');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('loading');
    setError('');
    setStatus(0);
    setFrameLoading(true);

    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim();
        } catch { /* unreadable */ }
        setStatus(res.status);
        setError(detail || `The WebUI server answered with HTTP status ${res.status}.`);
        setPhase('error');
        return;
      }

      // Close the stream once status is verified
      try { res.body?.cancel(); } catch { /* consumed */ }
      setPhase('ready');
    } catch (e) {
      if (ctrl.signal.aborted) {
        setError(`Web UI connection timed out after ${PROBE_TIMEOUT_MS / 1000}s.`);
      } else {
        setError(e?.message || 'Could not reach the agent Web UI.');
      }
      setPhase('error');
    } finally {
      clearTimeout(timer);
    }
  }, [url]);

  useEffect(() => {
    probe();
    return () => abortRef.current?.abort();
  }, [probe, nonce]);

  useEffect(() => {
    setFrameSrc('');
    setEscapeNotice('');
  }, [url, nonce]);

  // Tunnel escape watcher:
  // If an in-frame SPA navigates to a bare route like "/chat/123", catch it and
  // rewrite it back into the proxy tunnel prefix so it doesn't 404.
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const frame = frameRef.current;
    const base = /^\/api\/agents\/webui-proxy\/m\/[^/]+\/[^/?#]+/.exec(url || '');
    if (!frame || !base) return undefined;

    const intervalId = setInterval(() => {
      if (Date.now() - lastRepairRef.current < 2500) return;
      let href = '';
      try { href = frame.contentWindow?.location?.href || ''; } catch { return; }
      if (!href || href === 'about:blank') return;
      if (href.indexOf(base[0]) !== -1) return; // Still safely inside the tunnel

      try {
        const escaped = new URL(href, window.location.origin);
        if (escaped.origin !== window.location.origin) return;
        const entry = new URL(url, window.location.origin);
        lastRepairRef.current = Date.now();
        setEscapeNotice(escaped.pathname || '/');
        setFrameSrc(base[0] + escaped.pathname + (escaped.search || entry.search) + escaped.hash);
      } catch { /* unparseable */ }
    }, 800);

    return () => clearInterval(intervalId);
  }, [phase, url]);

  // Browser navigation controls
  const handleBack = () => {
    try { frameRef.current?.contentWindow?.history?.back(); } catch (_) {}
  };

  const handleForward = () => {
    try { frameRef.current?.contentWindow?.history?.forward(); } catch (_) {}
  };

  const handleReload = () => {
    setNonce((n) => n + 1);
  };

  const handleHome = () => {
    setFrameSrc('');
    setEscapeNotice('');
    setNonce((n) => n + 1);
  };

  const copyUrl = async () => {
    try {
      const fullUrl = typeof window !== 'undefined'
        ? `${window.location.origin}${frameSrc || url}`
        : (frameSrc || url);
      await navigator.clipboard?.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const handleExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
    } else if (url) {
      openExternalUrl(url);
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-[var(--bg-primary)] overflow-hidden select-none">
      {/* ── Browser Toolbar / Chrome ────────────────────────────────────────── */}
      <div
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-color)] transition-colors ${
          isMacTheme
            ? 'bg-[var(--bg-secondary)]/90 backdrop-blur-md'
            : 'bg-[var(--bg-secondary)]'
        }`}
      >
        {/* Navigation Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            className={`w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            onClick={handleForward}
            className={`w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Forward"
            aria-label="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={handleReload}
            className={`w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition ${
              phase === 'loading' ? 'animate-spin text-sky-400' : ''
            } ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Reload Web UI"
            aria-label="Reload Web UI"
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            onClick={handleHome}
            className={`w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Home"
            aria-label="Home"
          >
            <Home size={13} />
          </button>
        </div>

        {/* Omnibox / Address Bar */}
        <div
          className={`flex-1 flex items-center min-w-0 transition-all ${
            isMacTheme
              ? 'max-w-xl mx-auto rounded-lg bg-black/25 hover:bg-black/35 border border-white/10 px-2.5 py-1'
              : 'max-w-2xl mx-2 rounded-md bg-[var(--bg-tertiary)] hover:border-white/20 border border-[var(--border-color)] px-2.5 py-1'
          }`}
        >
          {/* Security / Tunnel Badge */}
          <div
            className="flex items-center gap-1.5 shrink-0 pr-2 border-r border-white/10 mr-2 text-emerald-400"
            title="Secure SSH Proxy Tunnel via Monitor"
          >
            <ShieldCheck size={13} />
            <span className="hidden sm:inline text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider">
              Tunnel
            </span>
          </div>

          {/* Address Display */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold shrink-0">
              {agentName}
            </span>
            <span className="text-xs font-mono text-zinc-300 truncate">
              {displayAddress}
            </span>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            {phase === 'loading' ? (
              <span className="flex items-center gap-1 text-[10px] text-sky-400 font-medium">
                <Loader2 size={11} className="animate-spin" />
                <span className="hidden md:inline">Connecting</span>
              </span>
            ) : phase === 'ready' ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium" title="Online and Ready">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                <span className="hidden md:inline">Ready</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium" title="Connection Error">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="hidden md:inline">Offline</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={copyUrl}
            className={`px-2 py-1 flex items-center gap-1 text-xs font-medium transition ${
              copied
                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            } ${isMacTheme ? 'rounded-lg' : 'rounded'}`}
            title="Copy Web UI Address"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="hidden lg:inline text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleExternal}
            className={`px-2 py-1 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition ${
              isMacTheme ? 'rounded-lg' : 'rounded'
            }`}
            title="Open Web UI in external browser tab"
          >
            <ExternalLink size={13} />
            <span className="hidden lg:inline text-[11px]">Tab</span>
          </button>
        </div>
      </div>

      {/* ── Progress Bar ────────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <div className="h-0.5 w-full bg-zinc-800 overflow-hidden shrink-0">
          <div className="h-full bg-gradient-to-r from-sky-500 via-indigo-400 to-sky-500 animate-[pulse_1.5s_infinite] w-full" />
        </div>
      )}

      {/* ── Viewport Area ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 min-w-0 relative bg-[var(--bg-primary)]">
        {/* Loading State Splash */}
        {phase === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-[var(--bg-primary)]/80 backdrop-blur-sm">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center mb-4 shadow-lg shadow-sky-500/10">
              <Loader2 size={28} className="animate-spin" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Connecting to {agentName} Web UI</h3>
            <p className="text-xs text-zinc-400 max-w-sm">
              Establishing tunnel to <span className="text-zinc-200 font-mono">{connectionName}</span> on port <span className="text-zinc-200 font-mono">{port || 'default'}</span>…
            </p>
          </div>
        )}

        {/* Error State Card */}
        {phase === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
            <div className="max-w-md w-full rounded-2xl border border-red-500/25 bg-[var(--bg-secondary)] p-6 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-base font-bold text-white mb-2">Web UI is Not Reachable</h3>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                {error || `The agent service on port ${port} did not answer.`}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  type="button"
                  onClick={handleReload}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-sky-500/20"
                >
                  <RefreshCw size={13} />
                  Retry Connection
                </button>
                <button
                  type="button"
                  onClick={handleExternal}
                  className="px-4 py-2 rounded-xl border border-white/10 hover:border-white/20 text-zinc-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink size={13} />
                  Try External Tab
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Ready State: Real WebUI iframe */}
        {phase === 'ready' && (
          <iframe
            ref={frameRef}
            src={frameSrc || url}
            title={`${agentName} Web UI`}
            allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
            className="w-full h-full border-0 select-auto"
            onLoad={() => setFrameLoading(false)}
          />
        )}
      </div>
    </div>
  );
}
