'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
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
  Plus,
  X,
  Search,
  Compass,
  Bookmark,
  Code2,
  BookOpen,
  Terminal,
  Cpu,
  HelpCircle,
  Laptop,
  ChevronDown,
} from 'lucide-react';
import { openExternalUrl } from '@/utils/webuiOpenMode';
import { fetchRelayStatus, onRelayStatusRefresh, requestRelayStatusRefresh } from '@/utils/relayStatus';
import BrowserOnboarding, { hasCompletedBrowserOnboarding, resetBrowserOnboarding } from '@/components/BrowserOnboarding';

const PROBE_TIMEOUT_MS = 30_000;

/**
 * How long a relay-proxied frame has to prove it rendered.
 *
 * The frame's origin is the user's own machine, and the monitor app is a public
 * origin, so Chrome's Local/Private Network Access check can refuse the load.
 * A refused frame still fires `load` on the <iframe>, so `onLoad` proves
 * nothing; the only trustworthy signal is the beacon the relay injects INSIDE
 * the document. When it does not arrive, the tab moves to the relay-required
 * state rather than showing a dead viewport or a degraded fallback renderer.
 */
const RELAY_FRAME_TIMEOUT_MS = 6_000;

/**
 * How long a relay-rendered page may go without a heartbeat before the tab is
 * declared un-embeddable.
 *
 * The relay injects a 2s heartbeat because 'ready' only proves the document
 * PARSED, not that it survived: a page whose own JS navigates to an origin that
 * refuses framing leaves the frame on a `chrome-error` document, and a
 * cross-origin frame gives the parent no other way to notice. Measured: this is
 * NOT what youtube.com does — it renders — so the timeout must stay generous
 * enough that a heavy page is never called dead by mistake.
 *
 * Deliberately far longer than the heartbeat: a page whose own JS blocks the
 * main thread for a few seconds must not be mistaken for a dead one, and the
 * interval keeps firing for as long as the document is genuinely alive.
 *
 * The watchdog is armed by the first heartbeat, never by 'ready' — a relay
 * built before heartbeats existed serves pages fine and never sends one.
 */
const RELAY_ALIVE_TIMEOUT_MS = 8_000;

/** base64url of a UTF-8 string — byte-for-byte the relay's `webProxyEncode`. */
function b64url(value) {
  // `btoa` alone throws above U+00FF, and the input here is a URL origin, which
  // can be an IDN host. Encoding UTF-8 bytes first keeps both ends agreeing.
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(value) {
  try {
    const binary = atob(String(value).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * A destination as a relay-proxy frame URL: `http://127.0.0.1:<port>/p/<enc>/…`.
 *
 * Only the ORIGIN is encoded, which is what makes the relay's proxy stateless —
 * and it is why the page's own RELATIVE links, assets and fetches stay inside
 * the proxy with no click interception at all. An absolute href is the one case
 * the base cannot cover, so the relay intercepts just those and reports the real
 * destination here; see the injected script in `public/local-relay.js`.
 */
function relayProxyUrlFor(port, target) {
  try {
    const u = new URL(target);
    return `http://127.0.0.1:${port}/p/${b64url(u.origin)}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return '';
  }
}

/** Inverse of {@link relayProxyUrlFor}: the real destination behind a frame URL. */
function relayProxyTargetFor(href, port) {
  try {
    const u = new URL(href);
    if (u.port !== String(port)) return '';
    const match = /^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(u.pathname);
    if (!match) return '';
    const origin = unb64url(match[1]);
    if (!origin) return '';
    return `${origin}${match[2] || '/'}${u.search || ''}${u.hash || ''}`;
  } catch {
    return '';
  }
}

/**
 * Resolve a relay navigation that uses an un-prefixed root path.
 *
 * GET forms and some search pages use `location.href = '/search?...'`.
 * The relay's injected form bridge reports that as
 * `http://127.0.0.1:<relay-port>/search?...`, which is a relay URL but not the
 * path-keyed `/p/<origin>/...` shape understood by relayProxyTargetFor(). If
 * the parent wraps that URL as-is, the relay tries to proxy itself and the
 * frame shows "127.0.0.1 refused to connect". Reattach the root path to the
 * current tab's real target origin before building the next relay URL.
 */
function relayUnprefixedTargetFor(href, port, currentTarget) {
  if (!port || !currentTarget) return '';
  try {
    const u = new URL(href);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== String(port)) return '';
    if (/^\/p\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname)) return '';
    const current = new URL(currentTarget);
    if (!['http:', 'https:'].includes(current.protocol)) return '';
    return `${current.origin}${u.pathname || '/'}${u.search || ''}${u.hash || ''}`;
  } catch {
    return '';
  }
}

/**
 * Sandbox for the *external web* viewport only — never for `webui` tabs.
 *
 * `/api/browser/proxy` fetches arbitrary third-party HTML and serves it from
 * OUR origin. Without this, a proxied page's JavaScript runs as our origin: it
 * can read our DOM, our localStorage, and call same-origin APIs with the
 * user's cookies attached. Dropping `allow-same-origin` gives the frame an
 * opaque origin, so none of that is reachable.
 *
 * Deliberately absent:
 *   - allow-same-origin   — the entire point of the sandbox.
 *   - allow-top-navigation — a proxied page must never navigate the app away.
 *   - allow-downloads      — no silent downloads out of a browsing proxy.
 *
 * Verified COEP-neutral: Chromium's nested-document COEP rule only inspects the
 * response header, so a sandboxed frame still loads under the shell's
 * `credentialless` policy (see scratch/coep-isolate.mjs).
 *
 * Consequence: the parent can no longer touch `contentWindow` (location,
 * history). Navigation is bridged with postMessage instead — see
 * `WEB_FRAME_MSG` and the injected script in the proxy route.
 */
const WEB_FRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-modals';

/** postMessage channel between the proxied page and this window. */
const WEB_FRAME_MSG = '__mpBrowser';

/**
 * Which renderer serves an ordinary website, and its frame URL.
 *
 * The in-app Web Browser REQUIRES the Local Relay. Pages are fetched by the
 * USER's machine, render on a real origin (localStorage works, which is
 * precisely what storage-dependent sites need) and no page bytes touch the
 * monitor server. When no relay is attached there is deliberately NO fallback
 * renderer: a relay-less tab shows an explicit "Local Relay required" state
 * instead of a degraded page — the old same-origin server proxy could not
 * render storage-dependent sites, had to run sandboxed (breaking still more),
 * and served third-party HTML as our origin.
 *
 * Pure and port-explicit rather than reading component state, because the relay
 * re-binds to a different port when 18780 is taken — so the port that is correct
 * at mount can be a dead one later, and the status effect has to re-point tabs
 * at a port it has just learned about.
 */
function frameFor(port, target) {
  const relaySrc = port > 0 ? relayProxyUrlFor(port, target) : '';
  if (relaySrc) return { proxyKind: 'relay', frameSrc: relaySrc };
  return { proxyKind: 'relay-required', frameSrc: '' };
}

/**
 * SSH-tunnel proxy URL for a localhost port on a target server.
 *
 * The WebUI proxy already opens an SSH tunnel to 127.0.0.1:<port> on the
 * remote host and serves its HTTP through /api/agents/webui-proxy. Re-using
 * that infrastructure means localhost:3071 in the browser reaches the TARGET
 * SERVER's localhost:3071, not the user's own machine.
 */
function buildTunnelUrl(connectionId, port, path = '/') {
  const suffix = path === '/' ? '' : path.replace(/^\/+/, '');
  return `/api/agents/webui-proxy/m/${encodeURIComponent(connectionId)}/${encodeURIComponent(String(port))}${suffix ? '/' + suffix : ''}`;
}

/** Hostname of a URL, falling back to whatever title we already had. */
function hostnameOf(target, fallback = '') {
  try { return new URL(target).hostname || fallback; } catch { return fallback; }
}

// Curated explore bookmarks for dev & AI productivity
const EXPLORE_BOOKMARKS = [
  {
    category: 'AI & Agents',
    icon: Cpu,
    color: 'from-sky-500 to-indigo-500',
    items: [
      { name: 'Hermes Agent WebUI', url: 'agent://hermes', desc: 'Nous Research agent dashboard', isAgent: true, port: 9119 },
      { name: 'Nanobot WebUI', url: 'agent://nanobot', desc: 'Ultra-lightweight personal AI agent', isAgent: true, port: 8765 },
      { name: 'Hugging Face', url: 'https://huggingface.co', desc: 'Models, datasets & spaces' },
      { name: 'DevDocs API', url: 'https://devdocs.io', desc: 'Fast, offline-friendly developer documentation' },
    ],
  },
  {
    category: 'Developer Reference & Tools',
    icon: Code2,
    color: 'from-emerald-500 to-teal-500',
    items: [
      { name: 'ExplainShell', url: 'https://explainshell.com', desc: 'Visual breakdown of shell commands' },
      { name: 'Regex101', url: 'https://regex101.com', desc: 'Interactive regular expression debugger' },
      { name: 'Crontab Guru', url: 'https://crontab.guru', desc: 'Cron schedule expression editor' },
      { name: 'CyberChef', url: 'https://gchq.github.io/CyberChef', desc: 'The cyber Swiss Army Knife for decoding & crypto' },
    ],
  },
  {
    category: 'Knowledge & Exploration',
    icon: BookOpen,
    color: 'from-purple-500 to-pink-500',
    items: [
      { name: 'Wikipedia', url: 'https://en.m.wikipedia.org', desc: 'The free encyclopedia (mobile embed view)' },
      { name: 'Linux Journey', url: 'https://linuxjourney.com', desc: 'Learn Linux command line and systems' },
      { name: 'Hacker News', url: 'https://news.ycombinator.com', desc: 'Tech news & discussions' },
      { name: 'DuckDuckGo', url: 'https://duckduckgo.com', desc: 'Privacy-first web search' },
    ],
  },
];

const SEARCH_ENGINES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', queryUrl: 'https://html.duckduckgo.com/html/?q=' },
  { id: 'wikipedia', name: 'Wikipedia', queryUrl: 'https://en.m.wikipedia.org/w/index.php?search=' },
  { id: 'google', name: 'Google', queryUrl: 'https://www.google.com/search?q=' },
  { id: 'bing', name: 'Bing', queryUrl: 'https://www.bing.com/search?q=' },
];

/**
 * AgentWebUIBrowserApp
 *
 * A full desktop browser app experience with tabs, omnibox address bar,
 * search engine integration, explore bookmarks, and AI Agent WebUI tunneling.
 */
export default function AgentWebUIBrowserApp({
  windowId,
  url = '',
  agentId = 'hermes',
  agentName = 'AI Agent',
  connectionId = '',
  connectionName = 'remote server',
  port = '',
  initialMode = 'webui', // 'webui' | 'explore'
  onOpenExternal,
}) {
  const { state: osState } = useOS();
  const windowLayout = osState?.windowLayout || 'mac';
  const isMacTheme = windowLayout === 'mac';

  // Connection context for localhost tunneling — when the user types
  // localhost:3071 we need to know WHICH server's localhost to reach.
  const {
    state: appState,
    connectionsReady,
    fetchConnections,
    dispatch: appDispatch,
  } = useApp();
  const connections = appState?.connections || [];
  // Only active SSH servers are valid localhost tunnel targets. Database
  // records, explicitly inactive/offline entries, and malformed records must
  // never appear in this picker.
  const serverConnections = connections.filter((c) => {
    if (!c || !(c._id || c.id)) return false;
    if (c.type && c.type !== 'ssh') return false;
    return c.status !== 'offline' && c.status !== 'inactive' && c.isActive !== false;
  });
  const selectedConnection = appState?.selectedConnection;
  const [connPickerOpen, setConnPickerOpen] = useState(false);

  // Initial tab setup
  const initialUrl = url || '';
  const [tabs, setTabs] = useState(() => [
    {
      id: 'tab-1',
      title: initialMode === 'explore' || !initialUrl ? 'Explore & Browse' : `${agentName} Web UI`,
      type: initialMode === 'explore' || !initialUrl ? 'explore' : 'webui',
      url: initialUrl,
      frameSrc: '',
      agentId,
      agentName,
      connectionId,
      connectionName,
      port,
      phase: initialMode === 'explore' || !initialUrl ? 'ready' : 'loading',
      status: 0,
      error: '',
    },
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');

  // Omnibox input state
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const selectedConnectionId = selectedConnection?._id || selectedConnection?.id || '';
  const activeConnectionId = activeTab?.connectionId || connectionId || selectedConnectionId || '';
  const activeConnection = serverConnections.find(
    (c) => (c._id || c.id) === activeConnectionId
  );
  const [addressInput, setAddressInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchEngine, setSearchEngine] = useState('duckduckgo');
  const [copied, setCopied] = useState(false);
  // Tabs whose relay frame answered and then tore itself down, so the tab is
  // showing a dead frame. Some sites simply cannot be embedded (see
  // RELAY_ALIVE_TIMEOUT_MS), and a silent blank frame reads as a broken app.
  //
  // A SET keyed by tab, not one boolean: every tab stays MOUNTED now (that is
  // what makes tab switches stop reloading), so a hidden tab's page can die
  // while the user is looking at a different one. A global flag would then put
  // the "this page cannot be embedded" banner on a page that is fine.
  const [relayDeadTabs, setRelayDeadTabs] = useState(() => new Set());
  const [directOpenNotice, setDirectOpenNotice] = useState('');
  // Loopback port of the relay's own web proxy, or 0 when there is none. This
  // is what lets ordinary sites render from the USER's machine instead of the
  // monitor server.
  const [relayProxyPort, setRelayProxyPort] = useState(0);

  // Onboarding: show on first visit, hide once completed. Same deferred-mount
  // pattern as RcloneApp — a beat of delay lets the window finish opening so
  // the spotlight measures settled geometry.
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasCompletedBrowserOnboarding()) setShowOnboarding(true);
    }, 400);
    return () => clearTimeout(t);
  }, []);
  const replayOnboarding = useCallback(() => {
    resetBrowserOnboarding();
    setShowOnboarding(true);
  }, []);

  const abortRef = useRef(null);
  const frameRef = useRef(null);
  /**
   * Every mounted tab frame, keyed by tab id.
   *
   * Tabs stay MOUNTED when they are not active (hidden, not unmounted) so a page
   * survives a tab switch — switching used to reload it every time. That means
   * several frames can postMessage at once, so each message has to be attributed
   * to the tab that owns its source rather than assumed to be the active one.
   */
  const frameRefsRef = useRef(new Map());
  /**
   * Per tab, the `frameSrc` whose relay frame has already announced itself.
   *
   * Keyed by the src rather than a bare "loaded" flag so it self-invalidates:
   * the moment we point a tab at a new src (a port change, a fresh address, a
   * Back), the stored value no longer matches and the tab is probed again. A
   * bare flag would need every one of those call sites to remember to clear it.
   */
  const relayReadyRef = useRef(new Map());
  /** Latest tabs, for handlers that must not re-subscribe on every change. */
  const tabsRef = useRef(tabs);
  const lastRepairRef = useRef(0);
  const nextTabNumRef = useRef(2);
  const relayProbeRef = useRef({ tabId: '', timer: null });
  const relayAliveRef = useRef({ tabId: '', timer: null });
  /**
   * Auto-recovery attempts per tab, since the last successful 'ready'.
   *
   * A dead frame is recovered by RELOADING it, so the guard is what stops a
   * permanently-embeddable site (one that dies on every load) from turning
   * into an infinite reload loop. Two consecutive silent reloads and the tab
   * goes back to the banner; any 'ready' from the frame clears the count.
   */
  const relayRecoveryRef = useRef(new Map());
  /** Last relay proxy port we acted on, so a poll does not reload every tab. */
  const relayPortRef = useRef(0);

  /** Mark a tab's relay frame dead (or alive again) — drives the amber banner. */
  const markRelayDead = useCallback((tabId, dead) => {
    if (!tabId) return;
    setRelayDeadTabs((prev) => {
      if (prev.has(tabId) === dead) return prev;
      const next = new Set(prev);
      if (dead) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  /**
   * Record that a tab's relay frame announced itself — keyed by the `frameSrc`
   * that did it, so the probe effect can tell "this page is already up" from
   * "this page has not answered yet" without any call site having to remember
   * to clear a flag when the src changes.
   */
  const rememberRelayReady = useCallback((tabId) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || !tab.frameSrc) return;
    relayReadyRef.current.set(tabId, tab.frameSrc);
  }, []);

  /**
   * True when the tab on screen is the one whose relay frame died.
   *
   * Derived, not stored: with several frames alive at once, "is the current
   * page broken" is a question about the active tab, and answering it from a
   * single shared boolean is how the banner ends up on the wrong page.
   */
  const relayUnrenderable = relayDeadTabs.has(activeTabId);

  // Keep the tab snapshot current for the message bridge, which has to look up a
  // tab's `frameSrc` to record relay readiness, but must not re-subscribe on
  // every keystroke and tab change.
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  // The desktop browser is opened without props, so it cannot rely on
  // AIAgentsApp to provide a connectionId. As soon as AppContext finishes
  // loading, seed the active tab with the selected server (or the first SSH
  // server) so localhost:PORT works without requiring an unrelated app to be
  // opened first.
  useEffect(() => {
    if (!activeTabId || activeTab?.connectionId) return;
    const fallbackId = connectionId || selectedConnectionId || (serverConnections[0]?._id || serverConnections[0]?.id);
    if (!fallbackId) return;
    const picked = serverConnections.find((c) => (c._id || c.id) === fallbackId);
    setTabs((prev) => prev.map((t) => t.id === activeTabId
      ? {
          ...t,
          connectionId: fallbackId,
          connectionName: picked?.name || picked?.host || connectionName || 'remote server',
        }
      : t
    ));
  }, [activeTabId, activeTab?.connectionId, connectionId, selectedConnectionId, serverConnections, connectionName]);

  /**
   * Read the relay's web-proxy port and, if it CHANGED, re-point every
   * relay-rendered tab at the new one. Returns the new port, or 0 when nothing
   * changed (or the read failed).
   *
   * This used to be a mount-only read, and that was a bug with a confusing
   * symptom: the relay re-binds to `18780 + n` when the port is taken
   * (EADDRINUSE retry, and a second relay on the same machine is enough), and it
   * disappears entirely when the relay stops. A cached port then points at
   * nothing, so the NEXT navigation in an already-open tab fails with
   * **"127.0.0.1 refused to connect"** — even though the tab was rendering fine
   * a moment earlier, because a loaded document needs no further connections.
   *
   * Re-pointing happens ONLY when the port actually changed: doing it on every
   * call would reload every tab and destroy exactly the state that keeping the
   * frames mounted exists to preserve.
   */
  const refreshRelayPort = useCallback(async () => {
    let port;
    try {
      const status = await fetchRelayStatus();
      port = Number(status.webProxyPort) || 0;
    } catch {
      // A transient failure is not evidence that the relay went away. Keep the
      // port we have: tearing down working frames on a blip is worse.
      return 0;
    }
    if (port === relayPortRef.current) return 0;
    relayPortRef.current = port;
    setRelayProxyPort(port);
    setTabs((prev) =>
      prev.map((t) => {
        // Re-point every web tab whose renderer DEPENDS on the relay: live
        // relay frames follow a moved port, and relay-required interstitials
        // switch to the relay the moment one appears. A legacy server-proxied
        // tab is left alone — swapping its renderer now would reload the page
        // and throw away its state for no gain.
        const wantsRelay = t.proxyKind === 'relay' || t.proxyKind === 'relay-required';
        if (t.type !== 'web' || !wantsRelay) return t;
        return { ...t, ...frameFor(port, t.url) };
      })
    );
    return port;
  }, []);

  /**
   * Re-read the port on mount and whenever relay state is known to have
   * changed (pairing approved, install finished, relay revoked — see
   * `requestRelayStatusRefresh`).
   *
   * A SILENT relay restart does not fire any of those, which is precisely the
   * case that produced the reported bug, so this is not the only reader: the
   * relay probe re-reads the port when a relay frame fails to answer. See
   * {@link armRelayProbe}.
   */
  useEffect(() => {
    refreshRelayPort();
    return onRelayStatusRefresh(() => { refreshRelayPort(); });
  }, [refreshRelayPort]);

  // Sync address input when active tab changes
  useEffect(() => {
    if (activeTab?.type === 'explore') {
      setAddressInput('');
    } else if (activeTab?.type === 'webui') {
      // Agent Web UIs show agent://hermes, tunnel tabs show localhost:port
      if (activeTab.agentId === 'tunnel') {
        setAddressInput(`localhost:${activeTab.port}`);
      } else {
        const display = activeTab.port
          ? `http://${activeTab.connectionName || 'agent'}:${activeTab.port}`
          : `agent://${activeTab.agentId || 'webui'}`;
        setAddressInput(display);
      }
    } else {
      // `url` is the real destination; `frameSrc` is our internal
      // `/api/browser/proxy?url=…` wrapper. Showing the wrapper in the omnibox
      // was leaking the plumbing into the address bar.
      setAddressInput(activeTab?.url || activeTab?.frameSrc || '');
    }
  }, [activeTabId, activeTab?.type, activeTab?.url, activeTab?.frameSrc, activeTab?.port, activeTab?.connectionName, activeTab?.agentId]);

  /**
   * `frameRef` is the ACTIVE tab's frame — the one Back/Forward/Reload and the
   * WebUI tunnel-escape watcher act on.
   *
   * With every tab's frame mounted at once it can no longer be attached with a
   * `ref` prop (that would leave it pointing at whichever frame mounted last),
   * so it is re-pointed here. Declared ABOVE the effects that read it, because
   * effects run in declaration order and the watcher would otherwise see the
   * previous tab's frame for one commit.
   */
  useEffect(() => {
    frameRef.current = frameRefsRef.current.get(activeTabId) || null;
  }, [activeTabId, tabs]);

  // Probe webui URL when active tab is a webui tab in 'loading' phase
  const probeTab = useCallback(async (tabId, targetUrl) => {
    if (!targetUrl) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, phase: 'loading', error: '' } : t))
    );

    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(targetUrl, {
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
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  phase: 'error',
                  status: res.status,
                  error: detail || `HTTP status ${res.status} from agent server.`,
                }
              : t
          )
        );
        return;
      }

      try { res.body?.cancel(); } catch { /* consumed */ }
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, phase: 'ready', error: '' } : t))
      );
    } catch (e) {
      const errMsg = ctrl.signal.aborted
        ? `Connection timed out after ${PROBE_TIMEOUT_MS / 1000}s.`
        : (e?.message || 'Could not reach agent Web UI.');
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, phase: 'error', error: errMsg } : t))
      );
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Run probe when webui tab opens or changes
  useEffect(() => {
    if (activeTab?.type === 'webui' && activeTab?.phase === 'loading') {
      probeTab(activeTab.id, activeTab.url);
    }
  }, [activeTab?.id, activeTab?.type, activeTab?.phase, activeTab?.url, probeTab]);

  // Tunnel escape watcher for WebUI tabs
  useEffect(() => {
    if (activeTab?.type !== 'webui' || activeTab?.phase !== 'ready') return undefined;
    const frame = frameRef.current;
    const base = /^\/api\/agents\/webui-proxy\/m\/[^/]+\/[^/?#]+/.exec(activeTab.url || '');
    if (!frame || !base) return undefined;

    const intervalId = setInterval(() => {
      if (Date.now() - lastRepairRef.current < 2500) return;
      let href = '';
      try { href = frame.contentWindow?.location?.href || ''; } catch { return; }
      if (!href || href === 'about:blank') return;
      if (href.indexOf(base[0]) !== -1) return; // In tunnel

      try {
        const escaped = new URL(href, window.location.origin);
        if (escaped.origin !== window.location.origin) return;
        const entry = new URL(activeTab.url, window.location.origin);
        lastRepairRef.current = Date.now();
        const repaired = base[0] + escaped.pathname + (escaped.search || entry.search) + escaped.hash;
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTab.id ? { ...t, frameSrc: repaired } : t))
        );
      } catch { /* unparseable */ }
    }, 800);

    return () => clearInterval(intervalId);
  }, [activeTab?.id, activeTab?.type, activeTab?.phase, activeTab?.url]);

  // Tab management
  // Stable identity so the sandbox bridge effect can depend on it without
  // re-subscribing on every render.
  const handleNewTab = useCallback((initialProps = {}) => {
    const newId = `tab-${nextTabNumRef.current++}`;
    const isWeb = initialProps.type === 'web';
    const newTab = {
      id: newId,
      title: initialProps.title || 'New Tab',
      type: initialProps.type || 'explore',
      url: initialProps.url || '',
      frameSrc: initialProps.frameSrc || '',
      // 'relay' | 'server' | '' — which proxy renders this web tab. Carried on
      // the tab because it decides whether the frame is sandboxed AND whether
      // Back/Forward are delegated to the frame.
      proxyKind: initialProps.proxyKind || '',
      agentId: initialProps.agentId || 'hermes',
      agentName: initialProps.agentName || 'AI Agent',
      connectionId: initialProps.connectionId || '',
      connectionName: initialProps.connectionName || 'remote server',
      port: initialProps.port || '',
      phase: initialProps.type === 'webui' ? 'loading' : 'ready',
      status: 0,
      error: '',
      // A web tab needs a history stack from birth, or Back has nothing to pop.
      history: isWeb && initialProps.url ? [initialProps.url] : [],
      historyIndex: isWeb && initialProps.url ? 0 : -1,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, []);

  const handleCloseTab = (e, tabId) => {
    e.stopPropagation();
    // A closed tab's frame unmounts and its entry is dropped by the ref
    // callback, but the side tables keyed by tab id are not — clean them here
    // so a long session does not accumulate entries for tabs that are gone.
    relayReadyRef.current.delete(tabId);
    markRelayDead(tabId, false);
    if (tabs.length === 1) {
      // If closing the only tab, convert it to Explore mode
      setTabs([{
        id: 'tab-1',
        title: 'Explore & Browse',
        type: 'explore',
        url: '',
        frameSrc: '',
        phase: 'ready',
      }]);
      setActiveTabId('tab-1');
      return;
    }
    const idx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      const nextActive = newTabs[Math.max(0, idx - 1)];
      setActiveTabId(nextActive.id);
    }
  };

  /**
   * Frame coordinates for an ordinary website.
   *
   * The in-app browser REQUIRES the relay: the page is fetched by the USER's
   * machine, so it renders on a real origin (localStorage works, which is
   * precisely what YouTube needs) and no page bytes touch the monitor server.
   * When no relay is attached the tab shows the relay-required state — there
   * is no sandboxed fallback renderer anymore. See frameFor.
   */
  const webTabFrame = useCallback((target) => frameFor(relayProxyPort, target), [relayProxyPort]);

  /**
   * Start the fallback clock for a relay-proxied tab.
   *
   * The frame's origin is the user's own machine and this app is a public
   * origin, so Chrome's Local/Private Network Access check can refuse the load
   * outright — and a refused frame still fires `load`, so the only trustworthy
   * signal is the relay's own beacon from inside the document. If it never
   * arrives the tab moves to the relay-required state, and says so rather than
   * silently swapping the renderer underneath the user.
   *
   * A silent relay FAILURE looks identical to a relay that MOVED, and the two
   * need opposite responses, so the timeout asks which one it is before gating
   * anything: a relay that restarted has re-bound to the next free port, and
   * re-pointing the tab at it self-heals. Without this the reported bug only
   * half-goes away — the tab would sit on the required state (or, before
   * this change, on a sandboxed proxy or a dead port) until the user typed the
   * address again.
   *
   * The re-read happens here, on an actual failure, rather than on a timer: it
   * costs one request only when something is already wrong, and it does not
   * hammer a DB-backed endpoint from a tab that has no relay at all.
   */
  const armRelayProbe = useCallback((tabId) => {
    clearTimeout(relayProbeRef.current.timer);
    // The frame is (re)loading, so whatever the last one did is history.
    markRelayDead(tabId, false);
    relayProbeRef.current = {
      tabId,
      timer: setTimeout(async () => {
        const movedTo = await refreshRelayPort();
        // The port changed: the tabs have been re-pointed at it, and the fresh
        // frame arms its own probe. Nothing to demote.
        if (movedTo > 0) return;

        let gate = false;
        setTabs((prev) => prev.map((t) => {
          if (t.id !== tabId || t.proxyKind !== 'relay') return t;
          gate = true;
          // The in-app browser REQUIRES the relay. A relay that is genuinely
          // gone (not moved) puts the tab on the explicit required state —
          // there is no silent fall back to the sandboxed server proxy.
          return { ...t, proxyKind: 'relay-required', frameSrc: '' };
        }));
        if (gate) {
          setDirectOpenNotice('Local Relay stopped answering — the in-app browser requires it. Check the relay and try again.');
          setTimeout(() => setDirectOpenNotice(''), 6000);
        }
      }, RELAY_FRAME_TIMEOUT_MS),
    };
  }, [markRelayDead, refreshRelayPort]);

  /**
   * Bring a dead relay frame back to life.
   *
   * A relay frame that navigated ITSELF (a search form, a redirect) can die
   * without the parent ever learning the destination: the document is gone, so
   * its heartbeat stops, and the frame shows Chrome's own error page
   * ("127.0.0.1 refused to connect") for a URL we never saw. The classic
   * trigger measured in the wild: the relay process restarts while the frame
   * is mid-navigation — the redirect into the proxy lands in the restart gap
   * and the connection is refused.
   *
   * Recovery therefore cannot trust the frame URL we hold (it is stale) — it
   * re-reads the relay port, then rebuilds the frame from the tab's REAL
   * target URL, which is exactly what a user pressing Reload would want. The
   * probe effect re-arms on the changed `frameSrc` and demotes to the server
   * proxy if the fresh frame still does not answer, so this cannot strand the
   * tab on a dead port either.
   *
   * Bounded by `relayRecoveryRef` (see it): without a bound, a site that dies
   * on every load would reload forever.
   */
  const recoverRelayTab = useCallback((tabId) => {
    if (!tabId) return;
    const attempts = relayRecoveryRef.current.get(tabId) || 0;
    if (attempts >= 2) {
      markRelayDead(tabId, true);
      return;
    }
    relayRecoveryRef.current.set(tabId, attempts + 1);
    markRelayDead(tabId, false);
    // Re-read the port FIRST: a relay restart that re-bound to a new port is
    // the most common reason a follow-up navigation died, and rebuilding on
    // the old one would just reproduce the refusal.
    //
    // `movedTo > 0` means the port CHANGED and refreshRelayPort already
    // re-pointed every relay tab at it — rebuilding here would clobber that
    // with the render's stale `webTabFrame` closure, so stand down.
    refreshRelayPort().then((movedTo) => {
      if (movedTo > 0) return;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId || t.type !== 'web' || t.proxyKind !== 'relay') return t;
          return { ...t, ...webTabFrame(t.url), phase: 'ready' };
        })
      );
    });
  }, [markRelayDead, refreshRelayPort, webTabFrame]);

  /**
   * Watchdog for "the relay answered, then the page collapsed".
   *
   * Re-armed by every heartbeat, so it only fires when the document stopped
   * existing without a replacement document taking over. Skipped while the app
   * is backgrounded: Chrome throttles timers in hidden tabs to roughly one a
   * minute, so a missing heartbeat there means nothing.
   *
   * For the ACTIVE tab a stopped heartbeat is a dead document, and a dead
   * document cannot heal itself — every in-frame recovery (the Reload button's
   * postMessage, the banner's old dismiss) posts into a Chrome error page that
   * has no script to receive it. So the watchdog now recovers the active tab
   * directly (bounded — see recoverRelayTab). A BACKGROUND tab only gets the
   * banner: its heartbeat may merely be throttled, and reloading a working
   * page would destroy exactly the state keeping frames mounted exists to
   * preserve.
   */
  const armRelayAlive = useCallback((tabId) => {
    clearTimeout(relayAliveRef.current.timer);
    relayAliveRef.current = {
      tabId,
      timer: setTimeout(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (tabId === activeTabId) {
          recoverRelayTab(tabId);
          return;
        }
        markRelayDead(tabId, true);
      }, RELAY_ALIVE_TIMEOUT_MS),
    };
  }, [activeTabId, markRelayDead, recoverRelayTab]);

  /** Stop both relay clocks — the tab is no longer relay-rendered. */
  const clearRelayClocks = useCallback(() => {
    clearTimeout(relayProbeRef.current.timer);
    clearTimeout(relayAliveRef.current.timer);
  }, []);

  // Stop the clocks on unmount too. Defined here, not with the other mount
  // effects: `clearRelayClocks` is a `const`, so an effect ABOVE this line that
  // named it in its dependency array would throw
  // `ReferenceError: Cannot access 'clearRelayClocks' before initialization` —
  // which is exactly what happened, and what the unit tests could not see.
  useEffect(() => () => clearRelayClocks(), [clearRelayClocks]);

  // Address Bar submission (URL or Search)
  const navigateAddress = (input) => {
    const raw = (input || '').trim();
    if (!raw) return;

    // Check for agent shortcuts. When this browser is hosted by AIAgentsApp,
    // hand the selected agent to its existing real-tab + Local Relay flow.
    // Keep the old in-app fallback for standalone/browser-app contexts that do
    // not provide that callback.
    if (raw.startsWith('agent://') || raw.includes(':9119') || raw.includes(':8765')) {
      const agId = raw.includes('nano') ? 'nanobot' : 'hermes';
      const agPort = agId === 'nanobot' ? 8765 : 9119;
      if (onOpenExternal && agId === agentId) {
        onOpenExternal();
        return;
      }
      const targetConn = connectionId || 'local';
      const proxyUrl = `/api/agents/webui-proxy/m/${encodeURIComponent(targetConn)}/${agPort}`;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                type: 'webui',
                title: `${agId === 'nanobot' ? 'Nanobot' : 'Hermes'} Web UI`,
                url: proxyUrl,
                frameSrc: '',
                agentId: agId,
                agentName: agId === 'nanobot' ? 'Nanobot' : 'Hermes',
                port: agPort,
                phase: 'loading',
              }
            : t
        )
      );
      return;
    }

    // Check if user entered a URL, IP/localhost, or domain
    const isDomain = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(raw);
    const isLocalHostOrIp = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(raw);
    const hasProtocol = /^https?:\/\//i.test(raw);

    let destinationUrl = '';
    let tabTitle = raw;

    if (hasProtocol) {
      destinationUrl = raw;
      try { tabTitle = new URL(raw).hostname; } catch (_) {}
    } else if (isLocalHostOrIp) {
      destinationUrl = `http://${raw}`;
      try { tabTitle = new URL(destinationUrl).host; } catch (_) {}
    } else if (isDomain) {
      destinationUrl = `https://${raw}`;
      try { tabTitle = new URL(destinationUrl).hostname; } catch (_) {}
    } else {
      // It's a search query!
      const engine = SEARCH_ENGINES.find((e) => e.id === searchEngine) || SEARCH_ENGINES[0];
      destinationUrl = `${engine.queryUrl}${encodeURIComponent(raw)}`;
      tabTitle = `${raw} - Search`;
    }

    // ── localhost / 127.0.0.1 on a TARGET SERVER ────────────────────────────
    // The relay proxy reaches the USER'S machine. If the user wants to check
    // localhost:3071 on the server they SSH'd into, route through the WebUI
    // proxy's SSH tunnel instead — exactly the same path agent Web UIs use.
    let localMatch = isLocalHostOrIp && /^(localhost|127\.0\.0\.1)(?::(\d+))?(\/.*)?$/i.exec(raw);
    if (!localMatch && hasProtocol) {
      try {
        const parsedLocal = new URL(destinationUrl);
        if (/^(localhost|127\.0\.0\.1)$/i.test(parsedLocal.hostname)) {
          localMatch = [
            parsedLocal.href,
            parsedLocal.hostname,
            parsedLocal.port || '',
            `${parsedLocal.pathname || '/'}${parsedLocal.search || ''}`,
          ];
        }
      } catch (_) { /* invalid URL is handled below */ }
    }
    if (localMatch) {
      const port = parseInt(localMatch[2], 10) || 80;
      const path = localMatch[3] || '/';
      // Prefer the tab's current server. This matters after the user changes
      // the selector: the component prop may still point at the old server.
      const targetConn = activeTab?.connectionId || activeConnectionId;
      if (targetConn) {
        const proxyUrl = buildTunnelUrl(targetConn, port, path);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  type: 'webui',
                  title: `localhost:${port}`,
                  url: proxyUrl,
                  frameSrc: '',
                  agentId: 'tunnel',
                  agentName: 'Local Service',
                  connectionId: targetConn,
                  connectionName: activeConnection?.name || activeConnection?.host || activeTab?.connectionName || connectionName || 'remote server',
                  port,
                  phase: 'loading',
                }
              : t
          )
        );
        return;
      }
      // No connection selected — fall through to relay proxy, but warn.
      setDirectOpenNotice('No server connection selected. localhost reached your own machine. Pick a connection in the sidebar to tunnel to the server.');
      setTimeout(() => setDirectOpenNotice(''), 8000);
    }

    // Ordinary websites render IN-APP through the Local Relay. They used to be
    // handed to a real browser tab, which was honest but not what this app is
    // for: the user asked for the page to appear in this viewport. The relay's
    // loopback proxy does that client-side; without a relay the tab shows the
    // relay-required state instead of a degraded page.
    if (/^https?:\/\//i.test(destinationUrl)) {
      const frame = webTabFrame(destinationUrl);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          // PUSH, not reset: typing a new address is a navigation like any
          // other, and Back must be able to return to the previous typed one.
          // (A reset here was why Back after typing a second address did
          // nothing — the stack only ever held the current page.)
          const past = Array.isArray(t.history) ? t.history : [];
          const idx = typeof t.historyIndex === 'number' ? t.historyIndex : -1;
          const history = past.slice(0, idx + 1);
          if (history[history.length - 1] !== destinationUrl) history.push(destinationUrl);
          return {
            ...t,
            type: 'web',
            title: tabTitle,
            url: destinationUrl,
            ...frame,
            phase: 'ready',
            history,
            historyIndex: history.length - 1,
          };
        })
      );
      return;
    }

    setDirectOpenNotice(`Could not open ${tabTitle}.`);
  };

  // Arm the fallback clock for whichever relay-proxied tab is showing. Done
  // here rather than at each call site so it also covers tabs opened through
  // handleNewTab and tabs restored from a window's saved props.
  useEffect(() => {
    if (activeTab?.type !== 'web' || activeTab?.proxyKind !== 'relay') {
      // Leaving a relay tab: stop its clocks. The banner is NOT cleared here —
      // it belongs to the dead tab, not to whatever is shown next, and the
      // dead-tab set already scopes it to the page that actually died.
      clearRelayClocks();
      return;
    }
    // A tab that already proved itself must not be re-probed. Its frame stays
    // MOUNTED across a tab switch now, so it will never re-send 'ready' — and
    // re-arming the probe would time out and gate a perfectly good relay page
    // to the required state every time the user came back to this tab.
    if (relayReadyRef.current.get(activeTab.id) === activeTab.frameSrc) return;
    armRelayProbe(activeTab.id);
    // The heartbeat watchdog is armed only once the page has announced itself;
    // until then `armRelayProbe` owns the decision.
  }, [activeTab?.id, activeTab?.type, activeTab?.proxyKind, activeTab?.frameSrc, armRelayProbe, clearRelayClocks]);

  const handleAddressKeyDown = (e) => {
    if (e.key === 'Enter') {
      navigateAddress(addressInput);
      e.target.blur();
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigateAddress(searchQuery);
    }
  };

  /**
   * Send the active web tab to a new destination.
   *
   * The sandboxed frame cannot navigate itself: its opaque origin makes its own
   * requests cross-site, so the session cookie is withheld and the proxy
   * answers 401. A navigation initiated from THIS document carries the cookie,
   * so all web navigation goes through here — assigning `frameSrc` and letting
   * React drive the iframe.
   *
   * Also owns the tab's history stack, because `contentWindow.history` is
   * unreachable across the sandbox boundary.
   */
  const navigateTab = useCallback((target, tabId) => {
    let parsed;
    try { parsed = new URL(target); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    // Unwrap first if this is ALREADY one of our relay-proxy frame URLs.
    // Wrapping it again would address the relay through itself
    // (`/p/<enc>/p/<enc>/…`) and the tab would never load. Belt and braces: the
    // relay's click interceptor already skips links on the proxy origin, but a
    // message is a message and this failure is unrecoverable from the UI.
    const currentTab = tabsRef.current.find((t) => t.id === tabId);
    const href = relayProxyTargetFor(parsed.href, relayProxyPort)
      || relayUnprefixedTargetFor(parsed.href, relayProxyPort, currentTab?.url)
      || parsed.href;

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const past = Array.isArray(t.history) ? t.history : [];
        const idx = typeof t.historyIndex === 'number' ? t.historyIndex : -1;
        // Drop anything ahead of the cursor, then append (browsers do the same).
        const history = past.slice(0, idx + 1);
        if (history[history.length - 1] !== href) history.push(href);
        return {
          ...t,
          type: 'web',
          url: href,
          ...webTabFrame(href),
          title: hostnameOf(href, t.title),
          history,
          historyIndex: history.length - 1,
          phase: 'ready',
        };
      })
    );
  }, [webTabFrame, relayProxyPort]);

  /** Move within the tab's own history stack (sandboxed frames cannot). */
  const stepHistory = useCallback((delta, tabId) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== (tabId || activeTabId)) return t;
        const history = Array.isArray(t.history) ? t.history : [];
        const idx = typeof t.historyIndex === 'number' ? t.historyIndex : 0;
        const next = idx + delta;
        if (next < 0 || next >= history.length) return t;
        const target = history[next];
        return {
          ...t,
          historyIndex: next,
          url: target,
          ...webTabFrame(target),
          title: hostnameOf(target, t.title),
        };
      })
    );
  }, [activeTabId, webTabFrame]);

  /**
   * Open a link in a new in-app tab.
   *
   * A sandboxed page's `target="_blank"` would otherwise become a native popup
   * that inherits the frame's opaque origin — the target site, logged out, in a
   * separate OS window outside this app's tab bar. Since we already have tabs,
   * honour `_blank` the way a real browser does and keep it in-app.
   */
  const openWebTab = useCallback((target) => {
    let parsed;
    try { parsed = new URL(target); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    const href = parsed.href;
    handleNewTab({
      type: 'web',
      url: href,
      ...webTabFrame(href),
      title: hostnameOf(href, 'New Tab'),
    });
  }, [handleNewTab, webTabFrame]);

  // Browser navigation.
  //
  // Back/Forward are driven ENTIRELY by the parent's stack. An earlier design
  // delegated them to the relay frame via postMessage, and two failures made
  // the buttons dead in practice (measured in the app UI, 2026-09-12): the
  // postMessage succeeds unconditionally even when the frame has no entry to
  // traverse, so the parent's fallback never ran; and a cross-origin frame's
  // `history.back()` can traverse the JOINT session history — the probe's app
  // UI vanished entirely under it. The stack is complete since applyPushedRoute
  // records the frame's own navigations, so the parent can always act.
  const handleBack = () => {
    if (activeTab?.type === 'web') return stepHistory(-1);
    try { frameRef.current?.contentWindow?.history?.back(); } catch (_) {}
  };

  const handleForward = () => {
    if (activeTab?.type === 'web') return stepHistory(1);
    try { frameRef.current?.contentWindow?.history?.forward(); } catch (_) {}
  };

  const handleReload = () => {
    if (activeTab?.type === 'webui') {
      probeTab(activeTab.id, activeTab.url);
    } else if (activeTab?.proxyKind === 'relay-required') {
      // No frame to reload — the relay is what is missing. Nudge the relay
      // status poller: its subscription re-reads the port and re-points this
      // tab straight to a frame the moment a relay appears.
      requestRelayStatusRefresh('browser-required');
    } else if (activeTab?.proxyKind === 'relay' && relayDeadTabs.has(activeTab.id)) {
      // A chrome-error document has NO script, so nothing in-frame can run —
      // the frame would sit on the error page forever (measured: the user's
      // Reload after a relay-restart refusal did exactly that). Recover: re-read
      // the port, rebuild from the tab's real URL.
      recoverRelayTab(activeTab.id);
    } else if (frameRef.current && activeTab?.frameSrc) {
      // Parent-driven reload: re-assigning `src` always re-navigates. This used
      // to delegate to the frame's own location.reload() via postMessage, which
      // is another cross-origin ask that silently no-ops whenever the injected
      // script is not there to receive it — the parent needs no cooperation.
      try { frameRef.current.src = activeTab.frameSrc; } catch (_) { /* frame gone */ }
    }
  };

  const handleHome = () => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              type: 'explore',
              title: 'Explore & Browse',
              url: '',
              frameSrc: '',
              phase: 'ready',
            }
          : t
      )
    );
  };

  const copyUrl = async () => {
    try {
      const targetUrl = activeTab?.type === 'webui'
        ? (typeof window !== 'undefined' ? `${window.location.origin}${activeTab.frameSrc || activeTab.url}` : activeTab.url)
        : (activeTab?.url || window.location.href);
      await navigator.clipboard?.writeText(targetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const handleExternal = () => {
    const targetUrl = activeTab?.type === 'webui'
      ? (activeTab.frameSrc || activeTab.url)
      : activeTab?.url;

    if (activeTab?.type === 'webui' && onOpenExternal) {
      onOpenExternal();
    } else if (targetUrl) {
      openExternalUrl(targetUrl);
    }
  };

  /**
   * Point a tab at the page its frame actually landed on.
   *
   * The address bar is not written here — the sync effect mirrors `tab.url`
   * into the omnibox, so there is exactly one source of truth for it.
   *
   * `tabId` is passed rather than assumed: hidden tabs stay mounted, so a
   * message can come from a tab that is not the active one, and crediting the
   * active tab would write the wrong URL into its omnibox.
   */
  const applyFrameUrl = useCallback((href, tabId) => {
    let urlParam = null;
    try {
      const u = new URL(href, window.location.origin);
      if (u.pathname !== '/api/browser/proxy') return;
      urlParam = u.searchParams.get('url');
    } catch { return; }
    if (!urlParam) return;

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.url === urlParam) return t;
        return { ...t, url: urlParam, title: hostnameOf(urlParam, t.title) };
      })
    );
  }, []);

  /**
   * Point a tab at a real destination URL reported by an SPA's client-side
   * router, or by the relay frame navigating itself (relative links stay
   * inside the proxy through `<base href>` and never ask the parent).
   *
   * NOT `applyFrameUrl`: that one unwraps a `/api/browser/proxy?url=…` wrapper
   * and bails on anything else. A router/frame report is the bare target URL.
   *
   * For RELAY-rendered web tabs the report is also RECORDED in the tab's own
   * history stack: Back/Forward are driven by the parent (see handleBack), so
   * a navigation the frame made by itself must land in the stack or the
   * buttons cannot see it. For anything else it stays display-only — a
   * cosmetic SPA state change and a real route change look identical from
   * here, and the server-proxied frame is sandboxed with no storage anyway.
   *
   * `tabId` is explicit: a hidden tab's router can report a route while a
   * different tab is on screen.
   */
  const applyPushedRoute = useCallback((href, tabId) => {
    let parsed;
    try { parsed = new URL(href); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    const target = parsed.href;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.url === target) return t;
        const base = { ...t, url: target, title: hostnameOf(target, t.title) };
        if (t.type !== 'web' || t.proxyKind !== 'relay') return base;
        // Same stack discipline as navigateTab: drop anything ahead of the
        // cursor (a native navigation after a Back kills the forward tail),
        // then append — unless this is the same page already on top.
        const past = Array.isArray(t.history) ? t.history : [];
        const idx = typeof t.historyIndex === 'number' ? t.historyIndex : -1;
        const history = past.slice(0, idx + 1);
        if (history[history.length - 1] !== target) history.push(target);
        return { ...base, history, historyIndex: history.length - 1 };
      })
    );
  }, []);

  /**
   * The bridge from a sandboxed page (see the script injected by
   * /api/browser/proxy):
   *
   *   'goto'   — the page wants to navigate but must not do it itself, so we
   *              perform it from here where the session cookie still applies.
   *   'newtab' — a target="_blank" click. Opened as a tab, not an OS popup.
   *   'nav'    — the page reporting where it actually landed (used when the
   *              proxy resolved a server-side redirect).
   *   'push'   — an SPA's client-side route change. The opaque frame cannot
   *              really pushState, so this is display-only: the omnibox follows
   *              the route, but we do NOT touch the history stack.
   *
   * `event.source` is checked so no other window can drive a tab, and it is
   * also how the tab is IDENTIFIED: every tab's frame stays mounted now, so a
   * message can arrive from a hidden tab and crediting the active one would
   * write the wrong URL into the wrong omnibox.
   */
  useEffect(() => {
    const onMessage = (e) => {
      let tabId = '';
      for (const [id, el] of frameRefsRef.current) {
        if (el && el.contentWindow === e.source) { tabId = id; break; }
      }
      if (!tabId) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      // ── the relay proxy's channel ─────────────────────────────────────────
      // The relay frame is cross-origin, so these are the only window into it:
      // 'ready' proves the document parsed (a refused frame still fires `load`,
      // so nothing else does), 'alive' proves it is STILL there, and 'url' keeps
      // the omnibox honest while the page navigates itself inside the proxy.
      if (data.__mpProxy === 'ready') {
        if (relayProbeRef.current.tabId === tabId) clearTimeout(relayProbeRef.current.timer);
        markRelayDead(tabId, false);
        rememberRelayReady(tabId);
        // A document that parsed means the last recovery (if any) worked. Give
        // the next death its full budget of auto-reloads.
        relayRecoveryRef.current.delete(tabId);
        // Deliberately NOT arming the heartbeat watchdog here. A relay built
        // before heartbeats existed still serves pages perfectly and never
        // sends one, so arming on 'ready' would accuse a working page of being
        // dead 8s in. Only a heartbeat that STOPS is evidence of anything, so
        // the watchdog starts on the first 'alive' instead.
        return;
      }
      if (data.__mpProxy === 'alive') {
        // Re-arm: a heartbeat means the document is still alive, whatever else
        // it is doing. This is what stops a slow page being called dead.
        markRelayDead(tabId, false);
        rememberRelayReady(tabId);
        armRelayAlive(tabId);
        return;
      }
      if (data.__mpProxy === 'url' && typeof data.href === 'string') {
        const target = relayProxyTargetFor(data.href, relayProxyPort);
        if (target) applyPushedRoute(target, tabId);
        return;
      }

      if (data[WEB_FRAME_MSG] === 'goto' && typeof data.url === 'string') {
        navigateTab(data.url, tabId);
      } else if (data[WEB_FRAME_MSG] === 'newtab' && typeof data.url === 'string') {
        openWebTab(data.url);
      } else if (data[WEB_FRAME_MSG] === 'nav' && typeof data.href === 'string') {
        applyFrameUrl(data.href, tabId);
      } else if (data[WEB_FRAME_MSG] === 'push' && typeof data.href === 'string') {
        applyPushedRoute(data.href, tabId);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyFrameUrl, navigateTab, openWebTab, applyPushedRoute, relayProxyPort, armRelayAlive, markRelayDead, rememberRelayReady]);

  return (
    <div className="flex flex-col w-full h-full bg-[var(--bg-primary)] overflow-hidden select-none">
      {/* ── Browser Tab Bar ─────────────────────────────────────────────────── */}
      <div
        className={`shrink-0 flex items-center px-2 pt-1.5 gap-1 border-b border-[var(--border-color)] overflow-x-auto scrollbar-none transition-colors ${
          isMacTheme ? 'bg-[var(--bg-secondary)]/80 backdrop-blur-md' : 'bg-[var(--bg-secondary)]'
        }`}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 min-w-[130px] max-w-[220px] text-xs transition-all cursor-pointer select-none border-b-2 ${
                isMacTheme
                  ? `rounded-t-lg ${
                      isActive
                        ? 'bg-[var(--bg-primary)] text-white border-sky-400 font-medium shadow-sm'
                        : 'bg-white/5 hover:bg-white/10 text-zinc-400 border-transparent'
                    }`
                  : `border-t-2 ${
                      isActive
                        ? 'bg-[var(--bg-primary)] text-white border-t-sky-500 border-b-transparent font-medium'
                        : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-zinc-400 border-t-transparent border-b-transparent'
                    }`
              }`}
              title={tab.title}
            >
              {tab.type === 'webui' ? (
                <Cpu size={13} className="text-sky-400 shrink-0" />
              ) : tab.type === 'explore' ? (
                <Compass size={13} className="text-amber-400 shrink-0" />
              ) : (
                <Globe size={13} className="text-emerald-400 shrink-0" />
              )}
              <span className="truncate flex-1 min-w-0 text-[11px]">{tab.title}</span>
              <button
                type="button"
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="w-4 h-4 rounded flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/20 transition opacity-60 group-hover:opacity-100"
                title="Close Tab"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          type="button"
          onClick={() => handleNewTab()}
          data-onboarding="new-tab-btn"
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition shrink-0 ml-1"
          title="Open New Tab"
          aria-label="Open New Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── Navigation Chrome Toolbar ───────────────────────────────────────── */}
      <div
        className={`relative z-30 shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-color)] transition-colors ${
          isMacTheme ? 'bg-[var(--bg-secondary)]/90 backdrop-blur-md' : 'bg-[var(--bg-secondary)]'
        }`}
      >
        {/* Navigation Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            data-onboarding="nav-back"
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
              activeTab?.phase === 'loading' ? 'animate-spin text-sky-400' : ''
            } ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Reload"
            aria-label="Reload"
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            onClick={handleHome}
            className={`w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition ${
              isMacTheme ? 'rounded-full hover:bg-white/10 active:scale-95' : 'rounded hover:bg-[var(--bg-card-hover)]'
            }`}
            title="Explore Home"
            aria-label="Explore Home"
          >
            <Home size={13} />
          </button>
        </div>

        {/* Omnibox Address & Search Bar */}
        <div
          data-onboarding="omnibox"
          className={`flex-1 flex items-center min-w-0 transition-all ${
            isMacTheme
              ? 'max-w-xl mx-auto rounded-lg bg-black/25 hover:bg-black/35 focus-within:bg-black/45 border border-white/10 focus-within:border-sky-400/60 px-2.5 py-1'
              : 'max-w-2xl mx-2 rounded-md bg-[var(--bg-tertiary)] hover:border-white/20 focus-within:border-sky-500 border border-[var(--border-color)] px-2.5 py-1'
          }`}
        >
          {activeTab?.type === 'webui' ? (
            <div
              className="flex items-center gap-1.5 shrink-0 pr-2 border-r border-white/10 mr-2 text-emerald-400 cursor-default"
              title="Encrypted SSH Tunnel via Monitor Proxy"
            >
              <ShieldCheck size={13} />
              <span className="hidden sm:inline text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider">
                Tunnel
              </span>
            </div>
          ) : (
            <div className="flex items-center shrink-0 pr-2 border-r border-white/10 mr-2 text-zinc-400">
              <Search size={13} />
            </div>
          )}

          {/* Editable input field */}
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onFocus={(e) => {
              setIsInputFocused(true);
              e.target.select();
            }}
            onBlur={() => setIsInputFocused(false)}
            onKeyDown={handleAddressKeyDown}
            placeholder="Search the web or enter address (e.g. agent://hermes, devdocs.io)..."
            className="flex-1 bg-transparent border-0 outline-none text-xs font-mono text-zinc-200 placeholder-zinc-500 truncate"
          />

          {/* Status badge */}
          {activeTab?.type === 'webui' && (
            <div className="flex items-center gap-1.5 shrink-0 pl-2">
              {activeTab?.phase === 'loading' ? (
                <span className="flex items-center gap-1 text-[10px] text-sky-400 font-medium">
                  <Loader2 size={11} className="animate-spin" />
                  <span className="hidden md:inline">Connecting</span>
                </span>
              ) : activeTab?.phase === 'ready' ? (
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
          )}
        </div>

        {/* Connection Selector — which server localhost tunnels to */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setConnPickerOpen((v) => !v)}
            className={`px-2 py-1 flex items-center gap-1.5 text-xs font-medium transition ${
              activeConnectionId
                ? 'text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/15 border border-sky-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent'
            } ${isMacTheme ? 'rounded-lg' : 'rounded'}`}
            title={activeConnectionId
              ? `Tunnelling through ${activeConnection?.name || activeConnection?.host || activeTab?.connectionName || 'server'}`
              : 'Select a server for localhost tunneling'}
          >
            <Server size={12} />
            <span className="hidden md:inline text-[11px] max-w-[100px] truncate">
              {activeConnection?.name || activeConnection?.host || activeTab?.connectionName || 'Select server'}
            </span>
            <ChevronDown size={10} className={`transition ${connPickerOpen ? 'rotate-180' : ''}`} />
          </button>
          {connPickerOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1"
            >
              <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                Tunnel localhost via
              </div>
              {serverConnections.length > 0 ? serverConnections.map((c) => {
                const id = c._id || c.id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setConnPickerOpen(false);
                      appDispatch({ type: 'SELECT_CONNECTION', payload: c });
                      setTabs((prev) => prev.map((t) => {
                        if (t.id !== activeTabId) return t;
                        const next = {
                          ...t,
                          connectionId: id,
                          connectionName: c.name || c.host || 'Server',
                        };
                        // If this is a tunnel tab, rebuild the proxy URL so
                        // the switch takes effect immediately.
                        if (t.agentId === 'tunnel' && t.port) {
                          const currentPath = (() => {
                            try {
                              const old = new URL(t.url, window.location.origin);
                              const marker = `/m/${encodeURIComponent(t.connectionId || '')}/${encodeURIComponent(String(t.port))}`;
                              return old.pathname.includes(marker) ? old.pathname.slice(old.pathname.indexOf(marker) + marker.length) || '/' : '/';
                            } catch (_) { return '/'; }
                          })();
                          next.url = buildTunnelUrl(id, t.port, currentPath);
                          next.frameSrc = '';
                          next.phase = 'loading';
                        }
                        return next;
                      }));
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 transition ${
                      activeConnectionId === id
                        ? 'text-sky-400 bg-sky-500/10'
                        : 'text-zinc-300 hover:bg-white/5'
                    }`}
                  >
                    <Server size={11} className="shrink-0" />
                    <span className="truncate">{c.name || c.host || 'Server'}</span>
                  </button>
                );
              }) : (
                <div className="px-2.5 py-2 text-xs text-zinc-500">
                  {connectionsReady ? 'No SSH servers found.' : 'Loading servers...'}
                </div>
              )}
              <div className="mt-1 border-t border-[var(--border-color)] pt-1">
                <button
                  type="button"
                  disabled={!fetchConnections || !connectionsReady}
                  onClick={() => { fetchConnections?.(); }}
                  className="w-full text-left px-2.5 py-1.5 text-[11px] text-sky-400 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Refresh server list
                </button>
              </div>
            </div>
          )}
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
            title="Copy URL"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="hidden lg:inline text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={replayOnboarding}
            data-onboarding="help-btn"
            className={`px-2 py-1 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition ${
              isMacTheme ? 'rounded-lg' : 'rounded'
            }`}
            title="Show tutorial"
          >
            <HelpCircle size={13} />
            <span className="hidden lg:inline text-[11px]">Tour</span>
          </button>

          <button
            type="button"
            onClick={handleExternal}
            data-onboarding="external-btn"
            className={`px-2 py-1 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition ${
              isMacTheme ? 'rounded-lg' : 'rounded'
            }`}
            title="Open in external browser tab"
          >
            <ExternalLink size={13} />
            <span className="hidden lg:inline text-[11px]">Tab</span>
          </button>
        </div>
      </div>

      {/* ── "This page cannot be embedded" banner ───────────────────────────── */}
      {relayUnrenderable && activeTab?.type === 'web' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-3 py-1.5 flex items-center justify-between text-xs text-amber-200">
          <span className="truncate pr-2">
            This page stopped loading inside the app — some sites refuse to run
            from a proxy origin. Open it in a real browser tab instead.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => recoverRelayTab(activeTabId)}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[11px] font-semibold transition"
              title="Re-read the relay port and reload this page"
            >
              Retry
            </button>
            <button
              onClick={handleExternal}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[11px] font-semibold transition"
            >
              Open in Tab
            </button>
            <button
              onClick={() => markRelayDead(activeTabId, false)}
              className="text-amber-400 hover:text-white p-0.5"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
      {directOpenNotice && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-200">
          {directOpenNotice}
        </div>
      )}

      {/* ── Viewport Area ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 min-w-0 relative bg-[var(--bg-primary)] overflow-y-auto">
        {/* 1. Explore / Start Page View */}
        {activeTab?.type === 'explore' && (
          <div className="min-h-full flex flex-col items-center justify-start p-6 md:p-10 max-w-5xl mx-auto select-none">
            {/* Hero & Search Banner */}
            <div className="w-full text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 shadow-xl shadow-indigo-500/20 text-white mb-4">
                <Compass size={32} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Web Browser & Explorer</h2>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Explore websites, developer documentation, and manage your AI agent interfaces all in one place.
              </p>

              {/* Big Search Form */}
              <form onSubmit={handleSearchSubmit} className="mt-6 max-w-xl mx-auto flex items-center gap-2">
                <div className="flex-1 relative flex items-center">
                  <Search size={16} className="absolute left-3.5 text-zinc-400 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search with ${SEARCH_ENGINES.find((e) => e.id === searchEngine)?.name}...`}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 shadow-lg"
                  />
                </div>
                <select
                  value={searchEngine}
                  onChange={(e) => setSearchEngine(e.target.value)}
                  className="py-2.5 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs text-zinc-300 focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  {SEARCH_ENGINES.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs transition shadow-lg shadow-sky-500/25"
                >
                  Search
                </button>
              </form>
            </div>

            {/* Curated Bookmark Groups */}
            <div className="w-full space-y-6">
              {EXPLORE_BOOKMARKS.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.category} className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                      <GroupIcon size={14} className="text-sky-400" />
                      <span>{group.category}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      {group.items.map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => navigateAddress(item.url)}
                          className="flex flex-col items-start p-3.5 rounded-xl bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-sky-500/50 transition-all text-left group shadow-sm hover:shadow-md cursor-pointer"
                        >
                          <div className="flex items-center justify-between w-full mb-1.5">
                            <span className="font-semibold text-xs text-white group-hover:text-sky-300 transition-colors">
                              {item.name}
                            </span>
                            <ExternalLink size={12} className="text-zinc-500 group-hover:text-sky-400 transition" />
                          </div>
                          <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                            {item.desc}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. WebUI Loading State */}
        {activeTab?.type === 'webui' && activeTab?.phase === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-[var(--bg-primary)]/80 backdrop-blur-sm">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center mb-4 shadow-lg shadow-sky-500/10">
              <Loader2 size={28} className="animate-spin" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Connecting to {activeTab.agentName} Web UI</h3>
            <p className="text-xs text-zinc-400 max-w-sm">
              Establishing tunnel to <span className="text-zinc-200 font-mono">{activeTab.connectionName}</span> on port{' '}
              <span className="text-zinc-200 font-mono">{activeTab.port || 'default'}</span>…
            </p>
          </div>
        )}

        {/* 3. WebUI Error State */}
        {activeTab?.type === 'webui' && activeTab?.phase === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
            <div className="max-w-md w-full rounded-2xl border border-red-500/25 bg-[var(--bg-secondary)] p-6 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-base font-bold text-white mb-2">Web UI Unreachable</h3>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                {activeTab.error || `The agent service on port ${activeTab.port} did not answer.`}
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

        {/* 4. The frames.
            EVERY tab's frame stays MOUNTED; only the active one is shown.
            Rendering just the active tab's frame meant switching tabs changed
            `src`, which reloads the document — so every tab switch threw away
            the page, its scroll position and anything half-typed. Real browsers
            keep background tabs alive, and so does this now.

            Hidden, not unmounted, so `hidden` (display:none) is what takes the
            inactive frame out of the layout. `visibility` is set as well
            because a Tailwind display utility on the same element would
            otherwise win over `hidden` and leave two pages stacked. */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          // A web tab without a relay has NO frame — it shows the required
          // state instead of a blank iframe. The tab stays mounted so the
          // moment a relay appears, refreshRelayPort re-points it and the
          // real frame takes its place.
          if (tab.type === 'web' && tab.proxyKind === 'relay-required') {
            return (
              <div
                key={tab.id}
                hidden={!isActive}
                className={`w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center ${
                  isActive ? '' : 'hidden'
                }`}
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 mb-1">
                  <Server size={30} />
                </div>
                <h2 className="text-lg font-bold text-white">Local Relay Required</h2>
                <p className="max-w-md text-xs text-zinc-300">
                  The in-app Web Browser renders every page through the Local Relay
                  running on this machine — pages are fetched from your own connection
                  and never pass through the monitor server. A relay must be installed
                  (<code className="text-sky-300">npm install -g ssh-monitor-relay</code>),
                  paired, and connected before websites can show here.
                </p>
                <p className="max-w-md text-xs text-zinc-400">
                  The relay is currently <span className="text-amber-300 font-semibold">not connected or not installed</span>.
                  Install and connect it, then check again — this browser picks it up automatically.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    type="button"
                    onClick={handleReload}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={13} />
                    Check Again
                  </button>
                  <button
                    type="button"
                    onClick={handleExternal}
                    className="px-4 py-2 rounded-xl border border-white/10 hover:border-white/20 text-zinc-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink size={13} />
                    Open in External Tab
                  </button>
                </div>
              </div>
            );
          }
          const showable = (tab.type === 'webui' && tab.phase === 'ready') || tab.type === 'web';
          if (!showable) return null;
          return (
            <iframe
              key={tab.id}
              ref={(el) => {
                // Keyed by tab: several frames are alive at once, so the message
                // bridge resolves a sender by matching `event.source` against
                // this map rather than against a single "current" frame.
                if (el) frameRefsRef.current.set(tab.id, el);
                else frameRefsRef.current.delete(tab.id);
              }}
              src={tab.frameSrc || tab.url}
              title={tab.title || 'Browser'}
              // Only the SERVER-proxied web view is sandboxed. `webui` tabs are
              // our own trusted agent UI and need same-origin access (the
              // WebSocket proxy and asset rewriting depend on it). A relay-
              // proxied frame is already cross-origin to us, so it needs no
              // sandbox — and must not have one: the opaque origin a sandbox
              // creates is exactly what stops localStorage working, which is the
              // entire reason the relay renders these pages instead.
              // See WEB_FRAME_SANDBOX.
              sandbox={tab.type === 'web' && tab.proxyKind !== 'relay' ? WEB_FRAME_SANDBOX : undefined}
              allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
              hidden={!isActive}
              style={isActive ? undefined : { visibility: 'hidden' }}
              className="w-full h-full border-0 select-auto"
            />
          );
        })}
      </div>

      {/* First-time onboarding overlay */}
      {showOnboarding && (
        <BrowserOnboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
