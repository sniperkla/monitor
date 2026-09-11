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
} from 'lucide-react';
import { openExternalUrl } from '@/utils/webuiOpenMode';

const PROBE_TIMEOUT_MS = 30_000;

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
 * Legacy in-app web proxy endpoint. New ordinary-site navigation is direct to a
 * real browser tab; these helpers remain only so already-open legacy web tabs
 * can be reloaded safely during a live upgrade.
 */
const WEB_PROXY_PATH = '/api/browser/proxy';
const proxyUrlFor = (target) => `${WEB_PROXY_PATH}?url=${encodeURIComponent(target)}`;

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
  const [addressInput, setAddressInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchEngine, setSearchEngine] = useState('duckduckgo');
  const [copied, setCopied] = useState(false);
  const [showIframeNotice, setShowIframeNotice] = useState(false);
  const [directOpenNotice, setDirectOpenNotice] = useState('');

  const abortRef = useRef(null);
  const frameRef = useRef(null);
  const lastRepairRef = useRef(0);
  const nextTabNumRef = useRef(2);

  // Sync address input when active tab changes
  useEffect(() => {
    if (activeTab?.type === 'explore') {
      setAddressInput('');
    } else if (activeTab?.type === 'webui') {
      const display = activeTab.port
        ? `http://${activeTab.connectionName || 'agent'}:${activeTab.port}`
        : `agent://${activeTab.agentId || 'webui'}`;
      setAddressInput(display);
    } else {
      // `url` is the real destination; `frameSrc` is our internal
      // `/api/browser/proxy?url=…` wrapper. Showing the wrapper in the omnibox
      // was leaking the plumbing into the address bar.
      setAddressInput(activeTab?.url || activeTab?.frameSrc || '');
    }
  }, [activeTabId, activeTab?.type, activeTab?.url, activeTab?.frameSrc, activeTab?.port, activeTab?.connectionName, activeTab?.agentId]);

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

  // Open ordinary websites in a real browser tab. This is deliberately a
  // client-only path: no HTML is fetched, rewritten, or rendered by Monitor.
  // The user's browser keeps the real site origin, cookies, storage, service
  // workers, JavaScript, and network identity. AI-agent Web UI shortcuts remain
  // on the existing Local Relay flow below.
  const openDirectWebsite = useCallback((target) => {
    if (!target) return;
    const opened = openExternalUrl(target);
    setDirectOpenNotice(opened
      ? 'Opened in a real browser tab.'
      : 'The browser blocked the new tab. Use the Tab button or allow pop-ups for Monitor.');
    setTimeout(() => setDirectOpenNotice(''), 5000);
  }, []);

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

    // Ordinary websites use a real browser tab. Do not send public content
    // through /api/browser/proxy: that route intentionally sandboxes arbitrary
    // pages, which breaks sites that need real cookies, storage, service
    // workers, or a non-opaque origin. Opening the actual destination keeps the
    // full browser environment on the client and keeps website bytes off the
    // Monitor server.
    if (/^https?:\/\//i.test(destinationUrl)) {
      openDirectWebsite(destinationUrl);
      return;
    }

    setDirectOpenNotice(`Could not open ${tabTitle}.`);
  };

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
  const navigateTab = useCallback((target) => {
    let parsed;
    try { parsed = new URL(target); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    const href = parsed.href;

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        const past = Array.isArray(t.history) ? t.history : [];
        const idx = typeof t.historyIndex === 'number' ? t.historyIndex : -1;
        // Drop anything ahead of the cursor, then append (browsers do the same).
        const history = past.slice(0, idx + 1);
        if (history[history.length - 1] !== href) history.push(href);
        return {
          ...t,
          type: 'web',
          url: href,
          frameSrc: proxyUrlFor(href),
          title: hostnameOf(href, t.title),
          history,
          historyIndex: history.length - 1,
          phase: 'ready',
        };
      })
    );
  }, [activeTabId]);

  /** Move within the tab's own history stack (sandboxed frames cannot). */
  const stepHistory = useCallback((delta) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        const history = Array.isArray(t.history) ? t.history : [];
        const idx = typeof t.historyIndex === 'number' ? t.historyIndex : 0;
        const next = idx + delta;
        if (next < 0 || next >= history.length) return t;
        const target = history[next];
        return {
          ...t,
          historyIndex: next,
          url: target,
          frameSrc: proxyUrlFor(target),
          title: hostnameOf(target, t.title),
        };
      })
    );
  }, [activeTabId]);

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
      frameSrc: proxyUrlFor(href),
      title: hostnameOf(href, 'New Tab'),
    });
  }, [handleNewTab]);

  // Browser navigation
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
    } else if (frameRef.current) {
      // Re-assigning `src` always re-navigates, and because the assignment
      // comes from this document the reload still carries the session cookie.
      // Never fall back to the bare `url` — that would send the frame straight
      // to the target origin, outside the proxy.
      const src = activeTab?.frameSrc || (activeTab?.url ? proxyUrlFor(activeTab.url) : '');
      if (src) { try { frameRef.current.src = src; } catch (_) { /* frame gone */ } }
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
   * Point the active tab at the page the frame actually landed on.
   *
   * The address bar is not written here — the sync effect mirrors `tab.url`
   * into the omnibox, so there is exactly one source of truth for it.
   */
  const applyFrameUrl = useCallback((href) => {
    let urlParam = null;
    try {
      const u = new URL(href, window.location.origin);
      if (u.pathname !== '/api/browser/proxy') return;
      urlParam = u.searchParams.get('url');
    } catch { return; }
    if (!urlParam) return;

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId || t.url === urlParam) return t;
        return { ...t, url: urlParam, title: hostnameOf(urlParam, t.title) };
      })
    );
  }, [activeTabId]);

  /**
   * Point the active tab at a real destination URL reported by an SPA's
   * client-side router.
   *
   * NOT `applyFrameUrl`: that one unwraps a `/api/browser/proxy?url=…` wrapper
   * and bails on anything else. A router reports the bare target URL, so it
   * needs its own handler. Display-only — no history push, because a cosmetic
   * state change and a real route change look identical from here.
   */
  const applyPushedRoute = useCallback((href) => {
    let parsed;
    try { parsed = new URL(href); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    const target = parsed.href;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId || t.url === target) return t;
        return { ...t, url: target, title: hostnameOf(target, t.title) };
      })
    );
  }, [activeTabId]);

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
   * `event.source` is checked so no other window can drive this tab.
   */
  useEffect(() => {
    if (activeTab?.type !== 'web') return undefined;
    const onMessage = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data[WEB_FRAME_MSG] === 'goto' && typeof data.url === 'string') {
        navigateTab(data.url);
      } else if (data[WEB_FRAME_MSG] === 'newtab' && typeof data.url === 'string') {
        openWebTab(data.url);
      } else if (data[WEB_FRAME_MSG] === 'nav' && typeof data.href === 'string') {
        applyFrameUrl(data.href);
      } else if (data[WEB_FRAME_MSG] === 'push' && typeof data.href === 'string') {
        applyPushedRoute(data.href);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeTab?.type, applyFrameUrl, navigateTab, openWebTab, applyPushedRoute]);

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
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition shrink-0 ml-1"
          title="Open New Tab"
          aria-label="Open New Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── Navigation Chrome Toolbar ───────────────────────────────────────── */}
      <div
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-color)] transition-colors ${
          isMacTheme ? 'bg-[var(--bg-secondary)]/90 backdrop-blur-md' : 'bg-[var(--bg-secondary)]'
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
            onClick={handleExternal}
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

      {/* ── Optional External Iframe Banner ─────────────────────────────────── */}
      {showIframeNotice && activeTab?.type === 'web' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-3 py-1.5 flex items-center justify-between text-xs text-amber-200">
          <span className="truncate pr-2">
            External pages are opened in a real browser tab for full compatibility.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExternal}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[11px] font-semibold transition"
            >
              Open in Tab
            </button>
            <button
              onClick={() => setShowIframeNotice(false)}
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

        {/* 4. Active Iframe View (for WebUI or explicit in-app WebUI) */}
        {((activeTab?.type === 'webui' && activeTab?.phase === 'ready') || activeTab?.type === 'web') && (
          <iframe
            ref={frameRef}
            src={activeTab?.frameSrc || activeTab?.url}
            title={activeTab?.title || 'Browser'}
            // Only the external web view is sandboxed. `webui` tabs are our own
            // trusted agent UI and need same-origin access (the WebSocket proxy
            // and asset rewriting depend on it). See WEB_FRAME_SANDBOX.
            sandbox={activeTab?.type === 'web' ? WEB_FRAME_SANDBOX : undefined}
            allow="clipboard-read; clipboard-write; microphone; camera; display-capture"
            className="w-full h-full border-0 select-auto"
          />
        )}
      </div>
    </div>
  );
}
