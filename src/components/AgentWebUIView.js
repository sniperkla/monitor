'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ExternalLink,
  RefreshCw,
  Copy,
  Loader2,
  AlertCircle,
  MonitorSmartphone,
  Maximize2,
  Minimize2,
  Minus,
  GripHorizontal,
  AlertTriangle,
  PanelLeft,
  PanelRight,
} from 'lucide-react';

const PROBE_TIMEOUT_MS = 30_000;

// Floating geometry. A phone-sized viewport gets the maximised (full-screen)
// panel instead — a 1100x760 window dragged around a 375px screen is not a
// feature, and neither is docking a pane to the side of it.
const DEFAULT_W = 1100;
const DEFAULT_H = 760;
const EDGE_GAP = 8;
const MIN_W = 360;
const MIN_H = 260;
const MIN_DOCK_W = 300;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// How close to an edge the pointer has to get before the panel offers to dock.
// Scales with the viewport but stays sane at both ends.
const dockThreshold = () => clamp(Math.round(window.innerWidth * 0.12), 72, 160);

function floatingGeom() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(DEFAULT_W, vw - EDGE_GAP * 2);
  const h = Math.min(DEFAULT_H, vh - 96);
  return {
    x: Math.max(EDGE_GAP, Math.round((vw - w) / 2)),
    y: Math.max(EDGE_GAP, Math.round((vh - h) / 2) - 24),
    w,
    h,
  };
}

// Keep a floating box on screen and above its minimums — after a drag, a
// resize, or the viewport changing under it.
function clampGeom(g) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(g.w ?? DEFAULT_W, MIN_W, Math.max(MIN_W, vw - EDGE_GAP * 2));
  const h = clamp(g.h ?? DEFAULT_H, MIN_H, Math.max(MIN_H, vh - 96));
  return {
    w,
    h,
    x: clamp(g.x ?? EDGE_GAP, EDGE_GAP, Math.max(EDGE_GAP, vw - w - EDGE_GAP)),
    y: clamp(g.y ?? EDGE_GAP, EDGE_GAP, Math.max(EDGE_GAP, vh - h - EDGE_GAP)),
  };
}

/**
 * In-app view of an agent's Web UI — a real window, not a modal.
 *
 * Frames the SAME-ORIGIN proxy (`/api/agents/webui-proxy/...`), which is the
 * whole point: the route already answers with `X-Frame-Options: SAMEORIGIN`
 * and `frame-ancestors 'self'`, and because the URL is same-origin there is
 * no Local Network Access check, no loopback address and no popup — the three
 * things that make the external-tab route fail on a phone in standard mobile
 * mode. The monitor dials the target itself, so this behaves identically on
 * every device.
 *
 * Three placements, because an embedded Web UI you cannot move is one you have
 * to close to get anything else done:
 *
 *   floating  — dragged by the header, resized from the right/bottom edges and
 *               the bottom-right corner
 *   docked    — dragged to (or clicked onto) the left or right edge, where it
 *               becomes a full-height side pane resizable from its inner edge
 *   maximised — full screen
 *
 * Detaching a docked panel restores the floating box it had before, so docking
 * never costs you your layout. Minimising hides the panel WITHOUT unmounting
 * the frame, so the agent's SPA keeps its socket and any half-typed message.
 *
 * The iframe is only mounted after a successful probe. That probe is what
 * separates this from the floating iframe panel this replaced: the old one was
 * pointed straight at http://127.0.0.1:<tunnel>, so when the tunnel was not up
 * yet the frame committed a connection error and could never recover without a
 * remount. Here a failure is an HTTP status we can read, so we show a real card
 * with Retry instead of a dead grey box.
 */
export default function AgentWebUIView({
  open,
  url,
  title = 'Web UI',
  subtitle = '',
  onClose,
  onOpenExternal,
}) {
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [geom, setGeom] = useState(null);
  const [dock, setDock] = useState('none'); // none | left | right
  const [dockW, setDockW] = useState(MIN_DOCK_W);
  const [dockPreview, setDockPreview] = useState(null); // null | left | right
  const [dragging, setDragging] = useState(null); // null | move | e | s | se | dockw
  const [narrow, setNarrow] = useState(false);
  const [frameSrc, setFrameSrc] = useState('');
  const [escapeNotice, setEscapeNotice] = useState('');
  const abortRef = useRef(null);
  const dragRef = useRef(null);
  const previewRef = useRef(null);
  const frameRef = useRef(null);
  const lastRepairRef = useRef(0);

  const probe = useCallback(async () => {
    if (!url) {
      setPhase('error');
      setError('No server selected, so there is no Web UI to open.');
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
        } catch { /* body already consumed or unreadable */ }
        setStatus(res.status);
        setError(detail || `The server answered with HTTP ${res.status}.`);
        setPhase('error');
        return;
      }
      // Only the status mattered — drop the body so the connection is not
      // left parked waiting for a reader that will never come.
      try { res.body?.cancel(); } catch { /* already consumed */ }
      setPhase('ready');
    } catch (e) {
      if (ctrl.signal.aborted) {
        setError(`The Web UI did not answer within ${PROBE_TIMEOUT_MS / 1000}s.`);
      } else {
        setError(e?.message || 'Could not reach the Web UI.');
      }
      setPhase('error');
    } finally {
      clearTimeout(timer);
    }
  }, [url]);

  useEffect(() => {
    if (!open) return undefined;
    probe();
    return () => abortRef.current?.abort();
    // `nonce` is a deliberate dependency: it is the Retry signal.
  }, [open, probe, nonce]);

  // A fresh open or a Reload starts from the entry URL again, so drop any
  // repaired address and any stale "left the tunnel" notice.
  useEffect(() => {
    setFrameSrc('');
    setEscapeNotice('');
  }, [url, nonce]);

  // ── Tunnel escape watcher ──────────────────────────────────────────────
  //
  // Unlike a top-level tab, a SAME-ORIGIN frame can be watched — so this is
  // the one thing the embedded view can do that a browser tab cannot.
  //
  // A hosted app served from its own root links to bare paths like
  // "/chat/<id>". Under the proxy that path is not the tunnel: the monitor has
  // no such route, so the frame lands on a 404 while the very same click
  // through Local Relay — where the app really is at the root — works fine.
  // That asymmetry is exactly the "works in a new tab, not embedded" report.
  // So: notice the escape, and pull the frame back in, keeping the path it
  // actually asked for.
  useEffect(() => {
    if (!open || phase !== 'ready' || minimized) return undefined;
    const frame = frameRef.current;
    const base = /^\/api\/agents\/webui-proxy\/m\/[^/]+\/[^/?#]+/.exec(url || '');
    if (!frame || !base) return undefined;
    const id = setInterval(() => {
      // Give the repaired load time to settle before judging it again.
      if (Date.now() - lastRepairRef.current < 2500) return;
      let href = '';
      try { href = frame.contentWindow?.location?.href || ''; } catch { return; }
      if (!href || href === 'about:blank') return;
      if (href.indexOf(base[0]) !== -1) return; // still inside the tunnel
      try {
        const escaped = new URL(href, window.location.origin);
        if (escaped.origin !== window.location.origin) return;
        const entry = new URL(url, window.location.origin);
        lastRepairRef.current = Date.now();
        setEscapeNotice(escaped.pathname || '/');
        setFrameSrc(base[0] + escaped.pathname + (escaped.search || entry.search) + escaped.hash);
      } catch { /* unparseable — leave it alone */ }
    }, 800);
    return () => clearInterval(id);
  }, [open, phase, minimized, url]);

  // Size and place the panel on open. Phone-sized viewports start maximised —
  // there is nowhere to drag a window to and no room for a side pane.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    setMinimized(false);
    setDock('none');
    setDockPreview(null);
    const isNarrow = window.innerWidth < 768;
    setNarrow(isNarrow);
    setMaximized(isNarrow);
    setDockW((prev) => (prev && prev > MIN_DOCK_W
      ? prev
      : clamp(Math.round(window.innerWidth * 0.42), MIN_DOCK_W, window.innerWidth - 160)));
    setGeom((prev) => prev || floatingGeom());
  }, [open]);

  // Keep a floating panel on screen when the viewport shrinks.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onResize = () => {
      setNarrow(window.innerWidth < 768);
      setGeom((prev) => (prev ? clampGeom(prev) : prev));
      setDockW((prev) => clamp(prev, MIN_DOCK_W, Math.max(MIN_DOCK_W, window.innerWidth - 160)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // Escape closes, and the page behind must not scroll while we cover all of it.
  useEffect(() => {
    if (!open || !maximized) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, maximized, onClose]);

  // Back closes the overlay.
  //
  // A full-screen panel with no Back handling is a trap on Android: the
  // gesture is the only way off a screen for most people, and without this it
  // navigates the whole app away instead of dismissing the panel. We own a
  // marked history entry while open, so popping it is unambiguous.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // The push is guarded by a ref rather than by `history.state`, because React
  // StrictMode (on by default in Next 16) mounts, unmounts and remounts every
  // effect in development. An unguarded push/back pair fights itself: the
  // simulated unmount pops the entry the remount just pushed, the popstate
  // fires, and the panel closes itself the instant it opens.
  const historyPushedRef = useRef(false);
  const historyPoppedRef = useRef(false);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    if (!historyPushedRef.current) {
      historyPushedRef.current = true;
      historyPoppedRef.current = false;
      window.history.pushState({ ...(window.history.state || {}), agentWebUIView: true }, '');
    }
    const onPop = () => {
      historyPoppedRef.current = true;
      onCloseRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);

  // Pop our entry when the panel closes by any other route (X, Escape, handing
  // off to a browser tab). Skipped when Back already did it — otherwise this
  // would navigate the app away from the page underneath.
  useEffect(() => {
    if (open || typeof window === 'undefined') return;
    if (!historyPushedRef.current) return;
    historyPushedRef.current = false;
    if (!historyPoppedRef.current && window.history.state?.agentWebUIView) {
      window.history.back();
    }
    historyPoppedRef.current = false;
  }, [open]);

  // ── Dragging and resizing ──────────────────────────────────────────────
  //
  // Pointer events, not mouse events: the live-log panel's mousedown/move/up
  // trio does nothing on a touchscreen, and this panel has to work on a phone.
  // Listeners go on `window` rather than relying on setPointerCapture, so a
  // fast drag that outruns the handle still tracks.
  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);

  const beginMove = (e) => {
    if (maximized || minimized) return;
    // A drag that begins on a control is a click, not a drag.
    if (e.target.closest?.('button')) return;
    e.preventDefault();

    let base = geom ? { ...geom } : floatingGeom();
    if (dock !== 'none') {
      // Detaching by drag: hand the panel a floating box under the cursor so
      // it follows the pointer instead of teleporting to its old position.
      const h = Math.min(window.innerHeight - 96, geom?.h ?? DEFAULT_H);
      base = clampGeom({
        x: e.clientX - Math.min(120, dockW / 2),
        y: e.clientY - 14,
        w: dockW,
        h,
      });
      setDock('none');
      setGeom(base);
    }
    dragRef.current = { kind: 'move', dx: e.clientX - base.x, dy: e.clientY - base.y };
    previewRef.current = null;
    setDragging('move');

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const th = dockThreshold();
      const side = ev.clientX <= th
        ? 'left'
        : ev.clientX >= window.innerWidth - th
          ? 'right'
          : null;
      previewRef.current = side;
      setDockPreview(side);
      setGeom((prev) => (prev
        ? clampGeom({ ...prev, x: ev.clientX - d.dx, y: ev.clientY - d.dy })
        : prev));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const target = previewRef.current;
      previewRef.current = null;
      setDockPreview(null);
      // `geom` is deliberately left alone, so un-docking restores this box.
      if (target) setDock(target);
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const beginResize = (e, kind) => {
    if (maximized || minimized) return;
    e.preventDefault();
    e.stopPropagation();
    const start = {
      x: e.clientX,
      y: e.clientY,
      w: dock !== 'none' ? dockW : (geom?.w ?? DEFAULT_W),
      h: geom?.h ?? DEFAULT_H,
    };
    dragRef.current = { kind, start };
    setDragging(kind);

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.start.x;
      const dy = ev.clientY - d.start.y;
      if (dock !== 'none') {
        // Inner edge only: pulling it outward grows the pane.
        const next = dock === 'left' ? d.start.w + dx : d.start.w - dx;
        setDockW(clamp(next, MIN_DOCK_W, Math.max(MIN_DOCK_W, window.innerWidth - 160)));
        return;
      }
      const w = (kind === 'e' || kind === 'se') ? d.start.w + dx : d.start.w;
      const h = (kind === 's' || kind === 'se') ? d.start.h + dy : d.start.h;
      setGeom((prev) => clampGeom({ ...(prev || {}), w, h }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (!open || typeof document === 'undefined') return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — nothing to do */ }
  };

  const iconBtn = 'w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition shrink-0';
  const handleBase = 'absolute z-20';
  const renderable = !minimized;

  const panelStyle = maximized
    ? { inset: 0, borderRadius: 0 }
    : dock === 'left'
      ? { left: 0, top: 0, bottom: 0, width: dockW, borderRadius: 0 }
      : dock === 'right'
        ? { right: 0, top: 0, bottom: 0, width: dockW, borderRadius: 0 }
        : geom
          ? { left: geom.x, top: geom.y, width: geom.w, height: geom.h }
          : { left: EDGE_GAP, top: EDGE_GAP, width: 'calc(100vw - 16px)', height: 'calc(100vh - 16px)' };

  return createPortal(
    <>
      {/* Drop zone hint while dragging towards an edge. */}
      {dragging === 'move' && dockPreview && (
        <div
          data-webui-dock-preview={dockPreview}
          className="fixed z-[10009] pointer-events-none"
          style={{
            top: 0,
            bottom: 0,
            left: dockPreview === 'left' ? 0 : 'auto',
            right: dockPreview === 'right' ? 0 : 'auto',
            width: dockW,
            background: 'rgba(56,189,248,0.14)',
            border: '2px dashed rgba(56,189,248,0.65)',
          }}
        />
      )}

      <div
        data-agent-webui-view="true"
        data-webui-dock={dock}
        className={
          'fixed z-[10010] flex flex-col bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-2xl overflow-hidden '
          + (maximized || dock !== 'none' ? '' : 'rounded-2xl ')
          + (minimized ? 'hidden' : '')
        }
        style={{
          ...panelStyle,
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        {/* Header / drag handle. flex-wrap so the controls drop to their own
            line on a phone instead of overflowing off-screen. */}
        <div
          onPointerDown={beginMove}
          style={{ touchAction: 'none' }}
          className={
            'flex flex-wrap items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-[var(--border-color)] bg-black/40 shrink-0 select-none '
            // Grab cursor whenever dragging actually does something — including
            // when docked, where a drag detaches the pane.
            + (maximized ? '' : 'cursor-grab active:cursor-grabbing')
          }
        >
          {!maximized && (
            <GripHorizontal size={13} className="text-[var(--text-muted)] opacity-60 shrink-0" />
          )}
          <MonitorSmartphone size={15} className="text-sky-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-white truncate leading-tight">{title}</div>
            {subtitle && (
              <div className="text-[10px] text-[var(--text-muted)] truncate leading-tight">{subtitle}</div>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {!narrow && (
              <>
                <button
                  onClick={() => setDock((d) => (d === 'left' ? 'none' : 'left'))}
                  className={iconBtn + (dock === 'left' ? ' !text-sky-400 bg-sky-500/15' : '')}
                  title={dock === 'left' ? 'Detach from the left pane' : 'Attach to the left pane'}
                  aria-label="Attach to the left pane"
                >
                  <PanelLeft size={14} />
                </button>
                <button
                  onClick={() => setDock((d) => (d === 'right' ? 'none' : 'right'))}
                  className={iconBtn + (dock === 'right' ? ' !text-sky-400 bg-sky-500/15' : '')}
                  title={dock === 'right' ? 'Detach from the right pane' : 'Attach to the right pane'}
                  aria-label="Attach to the right pane"
                >
                  <PanelRight size={14} />
                </button>
              </>
            )}
            <button
              onClick={() => setMinimized(true)}
              className={iconBtn}
              title="Minimise (keeps the Web UI running)"
              aria-label="Minimise"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => setMaximized((v) => !v)}
              className={iconBtn}
              title={maximized ? 'Restore window size' : 'Maximise'}
              aria-label={maximized ? 'Restore window size' : 'Maximise'}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button onClick={() => setNonce((n) => n + 1)} className={iconBtn} title="Reload">
              <RefreshCw size={14} />
            </button>
            <button onClick={copyLink} className={iconBtn} title={copied ? 'Copied' : 'Copy link'}>
              {copied ? <span className="text-[9px] font-bold text-emerald-400">OK</span> : <Copy size={14} />}
            </button>
            <button
              onClick={() => onOpenExternal?.()}
              className={iconBtn}
              title="Open this Web UI in a browser tab instead"
            >
              <ExternalLink size={14} />
            </button>
            <button onClick={() => onClose?.()} className={iconBtn} title="Close" aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Escape notice. Also the diagnostic: the path named here is the one
            the hosted app tried to reach, which is what to report if a route
            still misbehaves. */}
        {escapeNotice && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-[11px] text-amber-200">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              The Web UI tried to open {escapeNotice} outside the tunnel — pulled it back in.
            </span>
            <button
              onClick={() => setEscapeNotice('')}
              className="w-11 h-11 sm:w-6 sm:h-6 -my-1 flex items-center justify-center rounded hover:bg-white/10 shrink-0"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Body. `overflow:auto` + a touch-scrolling hint is what keeps iOS
            Safari from inflating the frame to its content height — the frame is
            absolutely positioned, so its box is fixed by this wrapper.
            While dragging or resizing, the frame must not swallow the pointer
            stream or the panel jumps and sticks mid-gesture. */}
        <div
          className="relative flex-1 min-h-0 bg-[#0b1020]"
          style={{
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            pointerEvents: dragging ? 'none' : undefined,
          }}
        >
          {phase === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 size={22} className="animate-spin text-sky-400" />
              <div className="text-[12px] text-slate-400">Opening {title}…</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center p-4 overflow-auto">
              <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-[#151c2e] p-5">
                <div className="flex items-center gap-2.5">
                  <AlertCircle size={18} className="text-red-400 shrink-0" />
                  <div className="text-[13px] font-bold text-white">Could not open the Web UI</div>
                </div>
                {status > 0 && (
                  <div className="mt-2 text-[10px] font-mono text-amber-300">HTTP {status}</div>
                )}
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-red-300 font-mono">
                  {error}
                </pre>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => setNonce((n) => n + 1)}
                    className="px-3 py-2.5 sm:py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-bold transition cursor-pointer min-h-[44px] sm:min-h-0"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => onOpenExternal?.()}
                    className="px-3 py-2.5 sm:py-1.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white hover:border-white/25 text-[11px] font-bold transition cursor-pointer min-h-[44px] sm:min-h-0"
                  >
                    Try a browser tab
                  </button>
                  <button
                    onClick={() => onClose?.()}
                    className="px-3 py-2.5 sm:py-1.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white hover:border-white/25 text-[11px] font-bold transition cursor-pointer min-h-[44px] sm:min-h-0"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <>
              {frameLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 size={20} className="animate-spin text-sky-400" />
                </div>
              )}
              <iframe
                key={`${url}#${nonce}`}
                ref={frameRef}
                src={frameSrc || url}
                title={title}
                onLoad={() => setFrameLoading(false)}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: '#0b1020' }}
                referrerPolicy="same-origin"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            </>
          )}
        </div>

        {/* Resize handles. Docked panes get only their inner edge; a floating
            panel gets the right edge, the bottom edge and the corner. */}
        {renderable && !maximized && dock === 'none' && (
          <>
            <div
              onPointerDown={(e) => beginResize(e, 'e')}
              style={{ touchAction: 'none' }}
              className={`${handleBase} top-0 bottom-0 right-0 w-2 sm:w-1.5 cursor-ew-resize hover:bg-sky-500/40`}
              title="Resize width"
            />
            <div
              onPointerDown={(e) => beginResize(e, 's')}
              style={{ touchAction: 'none' }}
              className={`${handleBase} left-0 right-0 bottom-0 h-2 sm:h-1.5 cursor-ns-resize hover:bg-sky-500/40`}
              title="Resize height"
            />
            <div
              onPointerDown={(e) => beginResize(e, 'se')}
              style={{ touchAction: 'none' }}
              className={`${handleBase} bottom-0 right-0 w-6 h-6 sm:w-4 sm:h-4 cursor-nwse-resize`}
              title="Resize"
            />
          </>
        )}
        {renderable && !maximized && dock !== 'none' && (
          <div
            onPointerDown={(e) => beginResize(e, dock === 'left' ? 'e' : 'w')}
            style={{
              touchAction: 'none',
              [dock === 'left' ? 'right' : 'left']: 0,
            }}
            className={`${handleBase} top-0 bottom-0 w-2 sm:w-1.5 cursor-ew-resize hover:bg-sky-500/40`}
            title="Resize the pane"
          />
        )}
      </div>

      {/* Minimised badge. The panel above is hidden, NOT unmounted, so the
          agent's SPA keeps its socket, its scroll position and any unsent
          message in the composer. */}
      {minimized && (
        <div
          className="fixed bottom-6 right-6 z-[10011] flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[var(--bg-primary)]/95 border border-[var(--border-color)] shadow-2xl text-xs cursor-pointer hover:border-sky-500/50 transition-all select-none"
          onClick={() => setMinimized(false)}
          title="Restore the Web UI"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setMinimized(false); }}
        >
          <MonitorSmartphone size={13} className="text-sky-400 shrink-0" />
          <span className="font-bold text-white">{title}</span>
          {phase === 'error' && <AlertCircle size={12} className="text-red-400 shrink-0" />}
          <button
            onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
            className="w-11 h-11 sm:w-7 sm:h-7 -my-1 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition"
            title="Restore"
            aria-label="Restore"
          >
            <Maximize2 size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            className="w-11 h-11 sm:w-7 sm:h-7 -my-1 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition"
            title="Close"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
