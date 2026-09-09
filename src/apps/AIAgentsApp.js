import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BrainCircuit, Server as ServerIcon, RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle, Settings2, Puzzle, Trash2, Play, Square, RotateCw, Plus, ExternalLink, Send, Search, Sparkles, Check, FileText, Copy, Lock, Radio, Zap, Shield, ShieldOff, UserX, Cable, ChevronRight, Flame, Heart, Terminal, ChevronDown, ChevronUp, X, Minus, Maximize2, Minimize2, GripHorizontal, Eye, EyeOff, ArrowUpCircle, DownloadCloud, MonitorSmartphone, ChevronLeft, KeyRound } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { useSupporter } from '@/hooks/useSupporter';
import SupporterModal from '@/components/common/SupporterModal';
import HermesAgentWizard from '@/components/HermesAgentWizard';
import ThemeSelect from '@/components/common/ThemeSelect';
import RelayPairingPanel from '@/components/RelayPairingPanel';
import { io } from 'socket.io-client';
import { createRelayPeer, DC } from '@/lib/webrtc-relay';

/**
 * AIAgentsApp — dedicated app for installing and managing AI agents on servers.
 *
 * AGENTS registry makes it extensible: add a new entry + handler and it shows up
 * as a selectable card. Currently supported: Hermes Agent (Nous Research).
 *
 * For an installed agent it exposes:
 *   • Overview   — version / model / service state, gateway start/stop/restart
 *   • Config     — live ~/.hermes/config.yaml editor (+ backup & restart)
 *   • Skills     — installed skills list, install from hub, remove,
 *                  bundled-skills seeding toggle (opt-out / opt-in)
 */

// Per-agent pairing UI: code format, platforms and hints differ per agent.
const PAIRING_UI = {
  hermes: {
    platforms: ['telegram', 'discord', 'line', 'slack', 'auto'],
    placeholder: 'Enter pairing code (e.g. 2VXNGUEH)',
    hint: 'Alphanumeric codes from the bot. Approve here, or run /pair in your messenger.',
  },
  nanobot: {
    platforms: ['telegram'],
    placeholder: 'Enter pairing code (e.g. AXL7-CR8Q)',
    hint: 'XXXX-XXXX code appears when you first message the bot — approve here to allow that sender.',
  },
  openclaw: {
    platforms: ['telegram', 'discord', 'line', 'slack', 'auto'],
    placeholder: 'Enter pairing code (e.g. A1B2C3)',
    hint: 'Alphanumeric codes (6-12 chars) from the bot or gateway log. Approve here.',
  },
  zeroclaw: {
    platforms: ['telegram'],
    placeholder: 'Enter 6-digit code (e.g. 517043)',
    numericOnly: true,
    hint: 'Gateway codes (6-digit) can be approved here. Telegram bind codes must be confirmed by sending /bind <code> from your own Telegram account.',
    revoke: true,
  },
};

const AGENTS = [
  {
    id: 'hermes',
    name: 'Hermes Agent',
    by: 'Nous Research',
    desc: 'Self-improving AI agent with persistent memory, skills, cron automations, and chat via Telegram / LINE / Discord.',
    docs: 'https://hermes-agent.nousresearch.com/docs/',
    api: '/api/agents/hermes',
    logo: '/agents/hermes.png',
  },
  {
    id: 'nanobot',
    name: 'Nanobot',
    by: 'HKUDS',
    desc: 'Ultra-lightweight personal AI agent (Python) with WebUI, tools, memory, MCP and chat apps. Low resource usage.',
    docs: 'https://github.com/HKUDS/nanobot',
    api: '/api/agents/nanobot',
    logo: '/agents/nanobot.svg',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    by: 'OpenClaw Foundation',
    desc: 'Self-hosted multi-channel AI agent gateway (Node) — Discord, Telegram, WhatsApp, Slack & more via one Gateway on port 18789.',
    docs: 'https://docs.openclaw.ai/',
    api: '/api/agents/openclaw',
    logo: '/agents/openclaw.png',
  },
  {
    id: 'zeroclaw',
    name: 'ZeroClaw',
    by: 'ZeroClaw Labs',
    desc: 'Fast, small, fully autonomous AI assistant infrastructure (Rust) — channels + gateway on port 42617, SOP engine, deploy anywhere.',
    docs: 'https://github.com/zeroclaw-labs/zeroclaw',
    api: '/api/agents/zeroclaw',
    logo: '/agents/zeroclaw.jpg',
  },
];

// Agents whose Web UI is a separate process we can start/stop on demand via
// the `webui-ctl` action, and whose traffic can be direct-transferred through
// the user's Local Relay (`op: 'relay-start'`). Anything else only has a
// gateway port, reachable through the central proxy alone.
const WEBUI_START_AGENTS = ['nanobot', 'hermes'];

// Hard client-side deadline for any Web UI open/start round trip. Every leg of
// it server-side (SSH execs, the relay ack wait) has its own timeout, but their
// SUM can run past a minute — and nothing protects against a leg that never
// settles at all (e.g. an SSH connect in execCommand's non-pooled path that
// fires neither 'ready' nor 'error'). Without this deadline the claimed browser
// tab sits on "Opening Web UI…" forever, because the fallback card is only
// written once the await resolves.
const WEBUI_OPEN_DEADLINE_MS = 75_000;

// Race `promise` against a deadline. Never rejects: on timeout it resolves
// with { success:false, deadline:true, error }. A late rejection of the
// original promise is swallowed so it can't surface as an unhandled rejection
// after the race has already settled.
function withDeadline(promise, ms, error) {
  let timer = null;
  const wrapped = Promise.resolve(promise).then((v) => { if (timer) clearTimeout(timer); return v; });
  wrapped.catch(() => {}); // keep a handler attached for the late-rejection case
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ success: false, deadline: true, error }), ms);
  });
  return Promise.race([wrapped, deadline]);
}

// Same-origin Web UI proxy URL — the fallback for every device that is NOT the
// relay host. A phone has no Local Relay of its own, so http://127.0.0.1:<port>
// can never resolve there; this route makes the monitor dial the target itself
// (monitor → target) instead of asking the device to (device → target).
//
// Tunnel coordinates ride in the PATH, never the query: a bundler resolves a
// chunk's relative imports against import.meta.url, and RFC 3986 relative
// resolution drops the base URL's query string — so `?connectionId=&port=` on
// the entry module makes every lazy chunk 400 and the SPA never leaves its boot
// splash. See tests/webui-proxy-assets.test.mjs.
function buildWebUIProxyUrl(connectionId, port, p, agentId = 'nanobot', routeOptions = {}) {
  // Defensive: only a non-empty string is meaningful here. Some code paths can
  // hand us a non-string (e.g. an object from the details payload) — guard
  // before calling string methods on it.
  const full = (typeof p === 'string' && p) ? p : '/';
  // Local Relay direct-transfer mode: absolute URL served by the gateway on the
  // user's own machine (http://127.0.0.1:<port>) — no central proxy involved.
  if (/^https?:\/\//i.test(full)) return full;
  const hashIdx = full.indexOf('#');
  const pathPart = hashIdx >= 0 ? (full.slice(0, hashIdx) || '/') : full;
  const hashPart = hashIdx >= 0 ? full.slice(hashIdx) : '';
  const suffix = pathPart === '/' ? '' : pathPart.replace(/^\/+/, '');
  const relayQuery = routeOptions.preferredRelay
    ? `&sshMode=local&preferredRelay=${encodeURIComponent(routeOptions.preferredRelay)}`
    : '';
  return `/api/agents/webui-proxy/m/${encodeURIComponent(connectionId)}/${encodeURIComponent(String(port))}`
    + `${suffix ? '/' + suffix : ''}?agent=${encodeURIComponent(agentId)}${relayQuery}${hashPart}`;
}

// The nanobot WebUI pair credential is its bootstrap secret — the value in the
// webUIBootstrapPath payload (`/#/?bootstrapSecret=<token>`). Extract just the
// token so the Pairing card can show a copyable code for the workbench prompt.
function extractWebUISecret(webUIBootstrapPath) {
  if (typeof webUIBootstrapPath !== 'string' || !webUIBootstrapPath) return '';
  const m = webUIBootstrapPath.match(/bootstrapSecret=([A-Za-z0-9+/=_-]+)/);
  return m ? m[1] : '';
}

export default function AIAgentsApp({ apiFetch }) {
  // `apiFetch` is accepted as a prop for direct mounts, but the window manager
  // renders every app as `<Component windowId={...} />` with no props, so the
  // prop is ALWAYS undefined in practice and `apiFetch || fetch` silently fell
  // back to bare `fetch()`. That dropped the `x-ssh-mode` / `x-preferred-relay`
  // headers, so agent commands were never routed through the user's Local
  // Relay — getSshConfig only falls back to the relay for a literal localhost
  // host or an explicit `sshMode: 'local'`. Measured: /api/agents/hermes sent
  // neither header while localStorage said local-relay mode. Every other app
  // (ServerBackup, Docker, Firewall…) pulls apiFetch from useApp() instead.
  const { state, connectionsReady, relayInfo, dispatch, apiFetch: ctxApiFetch } = useApp();
  const { isSupporter } = useSupporter({ refreshOnFocus: true });
  const { showPrompt } = useOS();
  const [supporterModalOpen, setSupporterModalOpen] = useState(false);
  const doFetch = apiFetch || ctxApiFetch || fetch;
  const connections = useMemo(
    () => (state?.connections || []).filter(c => c.type !== 'database'),
    [state?.connections]
  );

  const [agentId, setAgentId] = useState('hermes');
  const [target, setTarget] = useState('');
  const [tab, setTab] = useState('overview'); // overview | config | skills
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  // The Web UI is opened in a REAL browser tab (see openWebUIInTab), so there
  // is no floating browser window state any more. All that's left is the
  // in-flight flag for the "Start Web UI" button.
  const [startingWebUI, setStartingWebUI] = useState(false);
  const startingWebUIRef = useRef(false);
  const handleStartWebUIRef = useRef(null);
  const [stoppingWebUI, setStoppingWebUI] = useState(false);
  const [forceBypassRelay, setForceBypassRelay] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'server';
    } catch {
      return false;
    }
  });

  // "Continue with direct connection" is a real MODE SWITCH, not just a UI
  // unlock. apiFetch reads `ssh_monitor_ssh_mode` from localStorage on every
  // call, and AppContext auto-pins it to 'local' whenever it sees a relay — so
  // simply flipping React state left every request still routed through the
  // relay the user just asked to bypass (a phone has no relay at all, so every
  // call then failed). Persist the mode, then announce it exactly the way
  // AppContext does when it auto-switches, so this survives a remount.
  const bypassRelay = useCallback(() => {
    try { localStorage.setItem('ssh_monitor_ssh_mode', 'server'); } catch {}
    // Tells AppContext's relay poll not to auto-pin this browser back to
    // 'local' on its next tick — see the relayOptedOut guard there.
    try { localStorage.setItem('ssh_monitor_relay_optout', '1'); } catch {}
    try { window.dispatchEvent(new Event('ssh-mode-changed')); } catch {}
    setForceBypassRelay(true);
  }, []);
  const [loadError, setLoadError] = useState(null);
  const [checkingRelay, setCheckingRelay] = useState(true);
  const [credsExpanded, setCredsExpanded] = useState(false);

  const checkLocalRelay = useCallback(async () => {
    try {
      const res = await doFetch('/api/relay/token', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const isConnected = !!data.connected;
        if (dispatch) {
          dispatch({
            type: 'SET_RELAY_INFO',
            payload: { connected: isConnected, relays: data.relays || [], checkDone: true },
          });
        }
        return isConnected;
      }
    } catch (_) {}
    return false;
  }, [doFetch, dispatch]);

  // Check Local Relay first immediately on open
  useEffect(() => {
    let mounted = true;
    setCheckingRelay(true);
    checkLocalRelay().finally(() => {
      if (mounted) setCheckingRelay(false);
    });
    return () => { mounted = false; };
  }, [checkLocalRelay]);

  // Auto-detect polling when relay is not connected
  useEffect(() => {
    if (relayInfo?.connected || forceBypassRelay) return;
    const interval = setInterval(() => {
      checkLocalRelay();
    }, 2500);
    return () => clearInterval(interval);
  }, [relayInfo?.connected, forceBypassRelay, checkLocalRelay]);

  // Listen for 'START_WEBUI' postMessage from the embedded diagnostic screen
  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === 'START_WEBUI') {
        // Call the function directly via ref — more reliable than DOM button.click()
        // which can fail when the button is hidden, disabled, or not rendered yet.
        if (handleStartWebUIRef.current) handleStartWebUIRef.current();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Floating Draggable Live Log window state
  const [liveLogLines, setLiveLogLines] = useState([]);
  const [liveLogOpen, setLiveLogOpen] = useState(false);
  const [liveLogMinimized, setLiveLogMinimized] = useState(false);
  const [liveLogMaximized, setLiveLogMaximized] = useState(false);
  const [liveLogAction, setLiveLogAction] = useState('');
  const [logPos, setLogPos] = useState({ x: null, y: null });
  const liveLogBoxRef = useRef(null);
  const isDraggingLogRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleLogDragStart = (e) => {
    if (e.target.closest('button')) return;
    isDraggingLogRef.current = true;
    const panel = e.currentTarget.closest('[data-log-panel]');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      dragOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    const handleMouseMove = (ev) => {
      if (!isDraggingLogRef.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 320, ev.clientX - dragOffsetRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, ev.clientY - dragOffsetRef.current.y));
      setLogPos({ x: newX, y: newY });
    };
    const handleMouseUp = () => {
      isDraggingLogRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const [notice, setNotice] = useState(null); // {ok, text}
  // auto-dismiss the banner after 5s so it never blocks the UI
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  // Auto-scroll the live-log box to the bottom whenever new lines arrive.
  useEffect(() => {
    if (!liveLogBoxRef.current) return;
    liveLogBoxRef.current.scrollTop = liveLogBoxRef.current.scrollHeight;
  }, [liveLogLines]);
  const [showWizard, setShowWizard] = useState(false);
  // When true, opening the wizard runs in "spawn new instance" mode (name field
  // + Create & Configure) instead of the normal install/reconfigure view.
  const [spawnWizardMode, setSpawnWizardMode] = useState(false);
  const [purge, setPurge] = useState(false);
  const [showUninstallModal, setShowUninstallModal] = useState(false);
  // env tab (unmasked)
  const [envDraft, setEnvDraft] = useState([]); // [{ key, value, masked }]
  const [envNewKey, setEnvNewKey] = useState('');
  const [envNewVal, setEnvNewVal] = useState('');

  useEffect(() => {
    if (tab !== 'env' || !details) return;
    const parsed = {};
    if (details.envText) {
      for (const line of String(details.envText).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          parsed[k] = v;
        }
      }
    }
    const allKeys = Array.from(new Set([...(details.envKeys || []), ...Object.keys(parsed)]));
    const draft = allKeys.map(k => ({
      key: k,
      value: parsed[k] ?? '',
      masked: false,
    }));
    setEnvDraft(draft);
    setEnvNewKey('');
    setEnvNewVal('');
  }, [tab, details?.envText, details?.configJson, details?.configYaml]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEnv = () => {
    const env = {};
    for (const r of envDraft) {
      if (r.key && r.value !== undefined && r.value !== null && r.value.trim() !== '') {
        env[r.key] = r.value.trim();
      }
    }
    if (envNewKey.trim() && envNewVal.trim()) env[envNewKey.trim()] = envNewVal.trim();
    if (Object.keys(env).length === 0) {
      setNotice({ ok: false, text: 'No env keys to save — enter at least one value.' });
      return;
    }
    callAction('Save env', 'reconfigure', { config: { env, restart: restartAfterSave } }).then(() => {
      setEnvNewKey(''); setEnvNewVal('');
    });
  };
  // config tab
  const [yamlDraft, setYamlDraft] = useState('');
  const [restartAfterSave, setRestartAfterSave] = useState(true);
  const [backups, setBackups] = useState([]);
  // prompt tab & personality markdown files
  const [promptDraft, setPromptDraft] = useState('');
  const [promptActiveFile, setPromptActiveFile] = useState('PROMPT.md');
  const [promptFilesMap, setPromptFilesMap] = useState({});
  // skills tab & live autocomplete
  const [skillInput, setSkillInput] = useState('');
  const [skillCat, setSkillCat] = useState('all');
  const [acOpen, setAcOpen] = useState(false);
  const [acIndex, setAcIndex] = useState(-1);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const skillSearchBoxRef = useRef(null);
  // ClawHub (SkillsMP) marketplace search
  const [hubQuery, setHubQuery] = useState('');
  const [hubResults, setHubResults] = useState([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');
  const [hubSearched, setHubSearched] = useState(false);
  // logs tab & WebRTC streamline
  const [logText, setLogText] = useState('');
  
  // Debug: log state changes
  useEffect(() => {
    console.log(`[Agent Logs] logText state changed: ${logText.length} chars`, logText.substring(0, 100));
  }, [logText]);
  const [logCursor, setLogCursor] = useState(0);
  const [logPause, setLogPause] = useState(false);
  const [logStreamMode, setLogStreamMode] = useState('connecting'); // 'p2p' | 'relay_ws' | 'http' | 'connecting'
  const socketRef = useRef(null);
  const rtcPeerRef = useRef(null);
  const logPreRef = useRef(null);
  const autoHealRef = useRef(false);
  // userStopped persists across page refresh via sessionStorage
  const stoppedKey = `agent-stopped:${agentId}:${target || ''}`;
  const [userStopped, setUserStoppedState] = useState(() => {
    try { return sessionStorage.getItem(`agent-stopped:${agentId}:${target || ''}`) === '1'; } catch { return false; }
  });
  const userStoppedRef = useRef(userStopped);
  const setUserStopped = (v) => {
    userStoppedRef.current = v;
    setUserStoppedState(v);
    try { if (v) sessionStorage.setItem(stoppedKey, '1'); else sessionStorage.removeItem(stoppedKey); } catch { /* ignore */ }
  };
  const [health, setHealth] = useState(null);
  // skills multi-select
  const [selSkills, setSelSkills] = useState(new Set());
  // searches
  const [logSearch, setLogSearch] = useState('');
  const [cfgSearch, setCfgSearch] = useState('');
  const [logNav, setLogNav] = useState(0);
  const [cfgNav, setCfgNav] = useState(0);
  const cfgTaRef = useRef(null);

  const [pairingCode, setPairingCode] = useState('');
  const [pairingPlatform, setPairingPlatform] = useState('telegram');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState([]);
  const [pairingRevokeDevice, setPairingRevokeDevice] = useState('');
  const [pairedTokens, setPairedTokens] = useState(null);
  const [zcManualCode, setZcManualCode] = useState('');
  const [zcRevokeTab, setZcRevokeTab] = useState('device');

  const agent = AGENTS.find(a => a.id === agentId) || AGENTS[0];

  // ── Multi-instance support (every agent): selected instance + list ──
  const [instanceSel, setInstanceSel] = useState({});
  const [instanceList, setInstanceList] = useState({});
  const [spawningInstance, setSpawningInstance] = useState(false);
  const instKey = `${agent.id}:${target}`;
  const activeInstance = instanceSel[instKey] || '';
  const instRef = useRef('');
  useEffect(() => { instRef.current = activeInstance; }, [activeInstance]);
  // Race-condition guard: each loadDetails call gets a generation stamp.
  // If the agent/target/instance changes before the response arrives, the
  // stale response checks this ref and discards itself.
  const loadGenRef = useRef(0);
  // autoHeal is per agent+instance (keyed), persisted in localStorage —
  // enabling it on the default must NOT auto-restart other instances.
  const healKey = `${agentId}:${activeInstance || 'default'}:${target || ''}`;
  const [autoHealMap, setAutoHealMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent-autoheal') || '{}'); } catch { return {}; }
  });
  const autoHeal = !!autoHealMap[healKey];
  const setAutoHeal = (v) => {
    setAutoHealMap((m) => {
      const next = { ...m, [healKey]: !!v };
      try { localStorage.setItem('agent-autoheal', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  // Instance-scoped home dir for display hints: '' → ~/.hermes, 'bot2' → ~/.hermes-bot2
  const instHome = (inst) => `~/.${agent.id}${inst ? `-${inst}` : ''}`;


  const call = useCallback(async (action, extra = {}) => {
    if (!target) return null;
    const instParam = extra.instance !== undefined ? extra.instance : (instRef.current || undefined);
    const res = await doFetch(agent.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ connectionId: target, action, ...extra, instance: instParam }),
    });
    return res.json();
  }, [doFetch, agent.api, target]);

  // Live action logs — global on/off setting (persisted). When ON, long-running
  // actions run as background jobs; their log streams into busyMsg as they run.
  const [liveLogs, setLiveLogs] = useState(true);
  useEffect(() => {
    try { setLiveLogs(localStorage.getItem('ssh_monitor_live_logs') !== 'off'); } catch { /* default on */ }
  }, []);
  const toggleLiveLogs = () => setLiveLogs(v => {
    const nv = !v;
    try { localStorage.setItem('ssh_monitor_live_logs', nv ? 'on' : 'off'); } catch { /* ignore */ }
    return nv;
  });

  const callLive = useCallback(async (action, extra, onLine) => {
    const start = await call(action, { ...extra, live: true });
    if (!start?.jobId) return start;
    let cursor = 0;
    // Cap at 20 min — beyond that, the job likely hung server-side.
    const deadline = Date.now() + 20 * 60 * 1000;
    // Surface a "no progress" warning after 90s of silence. Uninstall can
    // legitimately be slow (e.g. waiting on `pkill` or `systemctl stop`),
    // but a long stretch of zero log lines usually means we're stuck on a
    // single remote command — better to warn the user than to sit there
    // silently.
    let lastLineCount = 0;
    let lastProgressAt = Date.now();
    const noProgressWarnMs = 90_000;
    // "Unknown or expired job" happens when the server lost the in-memory job
    // (dev HMR reload / restart). Retry a few times, then give up with a clear
    // error instead of silently polling until the 20-minute deadline while the
    // "Gateway restart…" busy banner stays stuck on screen.
    let unknownJobRetries = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));
      let upd = null;
      try { upd = await call('job', { jobId: start.jobId, cursor }); }
      catch (e) { /* transient network — keep polling */ continue; }
      if (upd?.lines?.length) {
        upd.lines.forEach(onLine);
        lastLineCount += upd.lines.length;
        lastProgressAt = Date.now();
      }
      cursor = upd?.cursor ?? cursor;
      if (upd?.done) return upd.result || { success: false, error: 'Job ended without a result' };
      if (upd?.error && /Unknown or expired job/i.test(upd.error)) {
        unknownJobRetries += 1;
        if (unknownJobRetries > 5) {
          throw new Error('Lost track of the action on the server (it may have reloaded). The gateway op likely completed — check the status on the Overview tab.');
        }
        continue;
      }
      if (upd?.error) throw new Error(upd.error);
      // Detect "stuck" — server is alive but no log progress for >90s.
      // (The server-side job may genuinely be slow, so we only emit a
      //  warning, not abort.)
      if (Date.now() - lastProgressAt > noProgressWarnMs) {
        onLine?.(`\n⚠ No new output for ${Math.round((Date.now() - lastProgressAt) / 1000)}s — the server may be stuck on a single command.\n`);
        lastProgressAt = Date.now(); // throttle further warnings
      }
    }
    return { success: false, error: 'Client timeout: the action took longer than 20 minutes' };
  }, [call]);

  const loadDetails = useCallback(async () => {
    if (!target) return;
    // Stamp this fetch with the current generation so we can detect if a newer
    // fetch supersedes us before our response arrives (fast agent switching).
    const myGen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await call('details', { instance: activeInstance || undefined });
      // Discard stale response — user has already switched to a different agent/target
      if (myGen !== loadGenRef.current) return;
      if (d && (d.installed != null || d.success)) {
        setDetails(d);
        setLoadError(null);
        const draftText = ['nanobot', 'openclaw', 'zeroclaw'].includes(agent.id) ? (d?.configJson || '') : (d?.configYaml || '');
        setYamlDraft(draftText);
        const pFiles = d?.promptFiles || {
          'PROMPT.md': d?.systemPrompt || '',
          'SOUL.md': '',
          'USER.md': '',
          'AGENTS.md': '',
          'MEMORY.md': '',
        };
        setPromptFilesMap(pFiles);
        setPromptDraft(pFiles[promptActiveFile] ?? pFiles['PROMPT.md'] ?? '');
      } else if (d?.error) {
        setLoadError(d.error);
        setDetails(null);
      } else {
        setLoadError('Failed to read agent status from server');
        setDetails(null);
      }
    } catch (err) {
      if (myGen === loadGenRef.current) {
        setLoadError(err?.message || 'Failed to connect to target server');
        setDetails(null);
      }
    } finally {
      if (myGen === loadGenRef.current) setLoading(false);
    }
  }, [target, call, agent.id, promptActiveFile]);

  // Instance list (multi-instance) — fetch directly so callers can await a
  // confirmed list after an uninstall rather than leaving a stale selector.
  const refreshInstances = useCallback(async () => {
    if (!target) return [];
    try {
      const r = await call('instances');
      const instances = Array.isArray(r?.instances) ? r.instances : [];
      setInstanceList(m => ({ ...m, [instKey]: instances }));
      return instances;
    } catch {
      return null;
    }
  }, [target, call, instKey]);
  useEffect(() => {
    refreshInstances();
  }, [refreshInstances]);

  // Spawn a new agent instance (clones the default install, starts it)
  const spawnInstance = () => {
    // Open the wizard FIRST in spawn mode so the user enters the new instance's
    // name + API key/model/token BEFORE anything is created. The wizard then
    // chains spawn → configure → start in one flow (no empty uneconfiged first boot).
    setSpawnWizardMode(true);
    setShowWizard(true);
  };

  useEffect(() => {
    if (connectionsReady && !target && connections.length > 0) {
      setTarget(connections[0]._id);
    }
  }, [connectionsReady, connections, target]);

  useEffect(() => {
    // Immediately clear stale data so the UI never shows the previous agent's
    // details while the new fetch is in flight.
    setYamlDraft('');
    setPromptDraft('');
    setPromptActiveFile('PROMPT.md');
    setDetails(null);
    setLoadError(null);
    setLoading(false);
    setTab('overview');
    // Bump the generation so any in-flight fetch for the old agent is discarded.
    loadGenRef.current += 1;
    if (target && (relayInfo?.connected || forceBypassRelay)) loadDetails();
  }, [target, agentId, activeInstance, relayInfo?.connected, forceBypassRelay]); // eslint-disable-line react-hooks/exhaustive-deps
  // When fresh details arrive (e.g. after wizard install), refresh the config draft
  // so the Config tab shows the new values, not the old ones.
  useEffect(() => {
    if (!details) return;
    const draftText = ['nanobot', 'openclaw', 'zeroclaw'].includes(agent.id) ? (details.configJson || '') : (details.configYaml || '');
    setYamlDraft(draftText);
    const pFiles = details.promptFiles || {
      'PROMPT.md': details.systemPrompt || '',
      'SOUL.md': '',
      'USER.md': '',
      'AGENTS.md': '',
      'MEMORY.md': '',
    };
    setPromptFilesMap(pFiles);
    setPromptDraft(pFiles[promptActiveFile] ?? pFiles['PROMPT.md'] ?? '');
  }, [details, agent.id, promptActiveFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const callAction = async (label, action, extra = {}) => {
    setBusyMsg(label); setNotice(null);
    setLiveLogLines([`> Starting ${label}...`, '> Connecting to remote server...']);
    setLiveLogAction(label); setLiveLogOpen(true); setLiveLogMinimized(false);
    const startTs = Date.now();
    
    // Once the action completes, fails, or the safety timeout below fires,
    // late log lines (e.g. the 90s "no progress" warning from callLive) must
    // NOT resurrect the busy banner — that is what made "Gateway restart…"
    // appear stuck even after the gateway had already restarted.
    let settled = false;
    
    // Safety timeout: clear busyMsg after 60 seconds no matter what
    const timeoutId = setTimeout(() => {
      console.warn(`[AIAgents] Action "${label}" timed out, clearing busyMsg`);
      settled = true;
      setBusyMsg('');
    }, 60000);
    
    try {
      let r;
      if (liveLogs) {
        r = await callLive(action, extra, (line) => {
          const parts = String(line).split('\n');
          setLiveLogLines(prev => [...prev, ...parts]);
          const last = parts.filter(Boolean).pop() || parts[0] || '';
          if (!settled) setBusyMsg(`${label} — ${last.slice(0, 80)}`);
        });
      } else {
        r = await call(action, extra);
      }
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      if (Array.isArray(r?.log) && r.log.length) {
        setLiveLogLines(prev => [...prev, ...r.log.flatMap(l => String(l).split('\n')), `— done in ${elapsed}s —`]);
      } else if (liveLogs) {
        setLiveLogLines(prev => [...prev, `— done in ${elapsed}s —`]);
      } else {
        const ok = r?.success !== false;
        const msg = r?.output ? String(r.output).trim() : (ok ? 'done' : (r?.error || 'failed'));
        setLiveLogLines(prev => prev.length ? [...prev, `— done in ${elapsed}s —`] : [`${ok ? '✓' : '✗'} ${label}: ${msg}  (${elapsed}s)`]);
      }
      if (r?.output) setNotice({ ok: r.success !== false, text: `${label}: ${String(r.output).slice(-400)}` });
      else setNotice({ ok: r?.success !== false, text: `${label}: ${r?.error || 'done'}` });
      await loadDetails();
      console.log(`[AIAgents] Action "${label}" completed in ${elapsed}s`);
      return r;
    } catch (e) {
      console.error(`[AIAgents] Action "${label}" error:`, e.message);
      setLiveLogLines(prev => [...prev, `✗ ERROR: ${e.message}`]);
      setNotice({ ok: false, text: `${label}: ${e.message}` });
    } finally {
      settled = true;
      clearTimeout(timeoutId);
      setBusyMsg('');
      console.log(`[AIAgents] busyMsg cleared for "${label}"`);
    }
  };

  // ── The Web UI tab is a status page, not a dead end ────────────────────
  //
  // A tab claimed with window.open('', '_blank') starts on about:blank, which
  // INHERITS the monitor's origin. That is why document.write() works at all —
  // and it means the tab stays same-origin (and scriptable from here) right up
  // until it actually navigates somewhere else. Two consequences we rely on:
  //
  //   1. It can SPEAK. When the open fails we rewrite the placeholder with the
  //      real reason and a way out, instead of leaving the user staring at
  //      "Opening Web UI…" forever.
  //   2. It can be WATCHED. A tab still sitting on about:blank seconds after we
  //      set location.href never navigated. Chrome blocks public-origin →
  //      loopback jumps under Local Network Access (on by default since
  //      Chrome 142), and a phone has no relay of its own, so 127.0.0.1 there
  //      is the phone itself. Waiting longer changes nothing in either case.
  //
  // NOTE: no backticks anywhere in this CSS/HTML — it is injected through a JS
  // template literal and one stray backtick would terminate it.
  const WEBUI_TAB_CSS = [
    '*{box-sizing:border-box}',
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e2e8f0;',
    'font:14px system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}',
    '.card{max-width:520px;width:100%;background:#151c2e;border:1px solid #1e293b;border-radius:14px;',
    'padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.45)}',
    '.center{text-align:center}',
    '.kicker{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc}',
    'h1{margin:8px 0 10px;font-size:16px;color:#fff}',
    'p{margin:6px 0;font-size:13px;color:#94a3b8;line-height:1.55}',
    'pre{margin:10px 0 0;background:#080c14;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;',
    'color:#f87171;font-size:11px;white-space:pre-wrap;word-break:break-all;',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}',
    'button{font:inherit;font-size:12px;font-weight:700;border-radius:9px;padding:9px 14px;cursor:pointer;border:0}',
    '.primary{background:#0284c7;color:#fff}.primary:hover{background:#0369a1}',
    '.ghost{background:rgba(255,255,255,.08);color:#cbd5e1;border:1px solid rgba(255,255,255,.15)}',
    '.ghost:hover{background:rgba(255,255,255,.15)}',
    '.spin{width:26px;height:26px;border-radius:50%;border:2px solid rgba(125,211,252,.25);',
    'border-top-color:#7dd3fc;animation:sp .8s linear infinite;margin:0 auto 14px}',
    '@keyframes sp{to{transform:rotate(360deg)}}',
  ].join('');

  const escWebUI = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const writeWebUITab = (tab, title, bodyHtml) => {
    if (!tab) return false;
    try {
      const doc = tab.document;
      doc.open();
      doc.write('<!doctype html><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>' + escWebUI(title) + '</title>'
        + '<style>' + WEBUI_TAB_CSS + '</style><body>' + bodyHtml + '</body>');
      doc.close();
      return true;
    } catch { return false; }
  };

  // Replace "Opening Web UI…" with an actionable card. proxyUrl is the
  // same-origin central proxy: it works from any device because the MONITOR
  // dials the target, so a phone (which runs no relay) can still get in.
  const failWebUITab = (tab, { heading, reason, detail, directUrl, proxyUrl }) => {
    if (!tab) return;
    const body = '<div class="card">'
      + '<div class="kicker">Web UI</div>'
      + '<h1>' + escWebUI(heading) + '</h1>'
      + '<p>' + escWebUI(reason) + '</p>'
      + (detail ? '<pre>' + escWebUI(detail) + '</pre>' : '')
      + '<div class="row">'
      + (proxyUrl ? '<button class="primary" id="wb-proxy">Open through the server</button>' : '')
      + (directUrl ? '<button class="ghost" id="wb-retry">Retry direct</button>' : '')
      + (directUrl ? '<button class="ghost" id="wb-copy">Copy address</button>' : '')
      + '</div></div>';
    if (!writeWebUITab(tab, heading || 'Web UI', body)) return;
    try {
      const doc = tab.document;
      const go = (url) => { try { tab.location.href = url; } catch { /* blocked */ } };
      doc.getElementById('wb-proxy')?.addEventListener('click', () => go(proxyUrl));
      doc.getElementById('wb-retry')?.addEventListener('click', () => go(directUrl));
      doc.getElementById('wb-copy')?.addEventListener('click', (e) => {
        try { navigator.clipboard?.writeText(directUrl); if (e?.target) e.target.textContent = 'Copied'; } catch { /* ignore */ }
      });
    } catch { /* the tab may already be gone */ }
  };

  // Claim a blank browser tab for the Web UI.
  //
  // MUST be called synchronously from a click handler: window.open() after an
  // `await` has lost the user-gesture token and gets popup-blocked. Callers
  // that need to do async work first should grab the tab up front and hand it
  // to openWebUIInTab() to navigate once the URL is known.
  //
  // Returns null if the popup was blocked (callers fall back to showing/copying
  // the URL instead of navigating the app away).
  const openBlankWebUITab = () => {
    if (typeof window === 'undefined') return null;
    let tab = null;
    try {
      tab = window.open('', '_blank');
    } catch {
      return null;
    }
    if (!tab) return null;
    // Deliberately NOT passing 'noopener' in the features string — that nulls
    // out the handle we need in order to navigate the tab later. Sever the
    // reverse link by hand instead, so the opened page can't script us.
    try { tab.opener = null; } catch { /* ignore */ }
    writeWebUITab(tab, 'Opening Web UI…',
      '<div class="card center"><div class="spin"></div>'
      + '<div style="font-size:13px;color:#94a3b8">Opening Web UI…</div></div>');
    return tab;
  };

  // Port the agent's Web UI listens on. Prefer the live value from `details`
  // (tagged instances get their own allocated port) and fall back to the
  // agent's shipped default: Hermes' dashboard is 9119, nanobot's webui 8765.
  const webUIPort = () => details?.webUIPort || (agent.id === 'hermes' ? 9119 : 8765);

  // Same-origin proxy fallback for this agent/target (see buildWebUIProxyUrl).
  // Handed to every failure card so the user is never left without a way in.
  const webUIProxyUrl = () => {
    if (!target) return '';
    let preferredRelay = '';
    try { preferredRelay = localStorage.getItem('ssh_monitor_preferred_relay') || ''; } catch {}
    return buildWebUIProxyUrl(target, webUIPort(), details?.webUIBootstrapPath || '/', agent.id, {
      preferredRelay,
    });
  };

  const handleStartWebUI = async () => {
    if (!relayConnectedRef.current) {
      setNotice({
        ok: false,
        text: 'Local Relay is required to start and use Web UI. Please start Local Relay on your computer first.',
      });
      return;
    }
    if (startingWebUIRef.current) return;
    startingWebUIRef.current = true;
    setStartingWebUI(true);
    // Claim the browser tab NOW, synchronously. The whole point is that
    // window.open() after an await loses the user-gesture token and gets
    // blocked — so we take the tab first and navigate it once the gateway
    // is actually up.
    const startTab = openBlankWebUITab();
    try {
      // Same stranded-tab protection as openWebUIInTab: if the start round trip
      // never settles, the claimed tab would sit on "Opening Web UI…" forever.
      // Resolve to { deadline:true } and explain inside the tab instead.
      const r = await withDeadline(
        callAction('Start Web UI', 'webui-ctl', {
          config: { op: 'start', port: webUIPort() }
        }),
        WEBUI_OPEN_DEADLINE_MS,
        `Starting the Web UI timed out on the server (port ${webUIPort()}).`,
      );
      if (r?.deadline) {
        failWebUITab(startTab, {
          heading: 'Could not start the Web UI',
          reason: r.error,
          directUrl: '',
          proxyUrl: webUIProxyUrl(),
        });
        setNotice({ ok: false, text: `Start Web UI: ${r.error}` });
        return;
      }
      if (r?.active || r?.success) {
        // Re-read the agent details BEFORE opening the tab.
        //
        // `webUIActive` is not a flag we can set locally — it is a live curl
        // probe against the agent's Web UI port that only runs inside the
        // `details` action. Without this refresh, `details.webUIActive` stays
        // false after a successful start, so the button flips straight back to
        // "Start Web UI" even though the Web UI really is up — and stays
        // clickable, offering to start something already running.
        //
        // It doubles as the settle delay: this is an SSH round-trip, which
        // gives the webui process time to bind its port.
        await loadDetails();
        // Wait a beat for the gateway process to bind its port, then open.
        // The tab itself was already created synchronously below, so this
        // delay doesn't cost us the user-gesture token.
        await new Promise((res) => setTimeout(res, 1000));
        await openWebUIInTab(r?.webUIBootstrapPath, startTab);
      } else {
        // The tab is already open on "Opening Web UI…" and nothing is coming.
        // callAction also returns `undefined` when it throws, so this branch is
        // the only feedback the user gets — make it real, in the tab they are
        // looking at, not just in a notice they may have scrolled past.
        const reason = r?.error
          || `The ${agent.name} Web UI did not report as running on port ${webUIPort()}.`;
        failWebUITab(startTab, {
          heading: 'Could not start the Web UI',
          reason,
          directUrl: '',
          proxyUrl: webUIProxyUrl(),
        });
        setNotice({ ok: false, text: `Start Web UI: ${reason}` });
      }
    } catch (err) {
      console.error('[WebUI] Failed to start Web UI:', err);
      failWebUITab(startTab, {
        heading: 'Could not start the Web UI',
        reason: err?.message || 'The start command failed.',
        directUrl: '',
        proxyUrl: webUIProxyUrl(),
      });
    } finally {
      startingWebUIRef.current = false;
      setStartingWebUI(false);
    }
  };
  // Keep the ref in sync so the postMessage listener (stale closure) can call it
  handleStartWebUIRef.current = handleStartWebUI;

  // Stop the Web UI daemon. Only offered while it is actually serving
  // (webUIActive), and only for agents that own a startable Web UI process —
  // zeroclaw/openclaw expose a gateway port we never launched, so there is
  // nothing for us to stop.
  //
  // `callAction` re-runs `loadDetails()` on completion, which is what flips the
  // button back to "Start Web UI" — webUIActive is a live probe, not local state.
  const handleStopWebUI = async () => {
    if (stoppingWebUIRef.current) return;
    stoppingWebUIRef.current = true;
    setStoppingWebUI(true);
    try {
      await callAction('Stop Web UI', 'webui-ctl', {
        config: { op: 'stop', port: webUIPort() }
      });
    } catch (err) {
      console.error('[WebUI] Failed to stop Web UI:', err);
    } finally {
      stoppingWebUIRef.current = false;
      setStoppingWebUI(false);
    }
  };

  // Open the agent Web UI in a REAL browser tab.
  //
  // Why this replaced the floating <iframe> panel: the Local Relay has to be
  // installed on this machine for any of this to work anyway, so embedding
  // bought no isolation — it only bought failure modes. Chrome does not retry
  // a failed top-level navigation, so an iframe pointed at a not-yet-tunnelled
  // 127.0.0.1 URL gets permanently stranded on "refused to connect", with no
  // way back but a manual remount. A real tab has none of that, and gets a
  // proper reload button, devtools, zoom and its own cookie jar.
  //
  // Transport: direct transfer through the user's Local Relay first
  // (http://127.0.0.1:<localPort>, data flows device→agent, central server is
  // control plane only), falling back to the same-origin central SSH proxy.
  //
  // Popup-blocker note: window.open() only escapes the blocker when called
  // SYNCHRONOUSLY inside the click handler. We therefore open a blank tab
  // up-front and navigate it once the relay has told us which port it bound —
  // waiting to call window.open() until after the await would be blocked.
  const openWebUIInTab = async (overridePath, preopenedTab = null) => {
    const proxyUrl = webUIProxyUrl();
    const isMobileBrowser = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    // Mobile routing — same rule as the desktop "Via server" button, which is
    // only offered for a Web UI bound to LOOPBACK (127.0.0.1) on the target:
    //   • webUILoopback === false  → the UI is exposed on a public interface,
    //     so the phone goes DIRECT to http://<host>:<port> (no proxy).
    //   • loopback, or the probe hasn't reported yet → same-origin server
    //     route. A relay selected on a phone belongs to another device
    //     (usually the user's Mac) and its 127.0.0.1 gateway is the Mac's
    //     loopback, not the phone's — the phone can never jump there itself,
    //     so the proxy is the only way in.
    // All reads go through refs: handleStartWebUI awaits loadDetails() before
    // calling this, so the render-closure `details` can be stale here. The
    // whole decision is synchronous — no await may precede openBlankWebUITab,
    // or the popup blocker kills the tab.
    if (isMobileBrowser) {
      let mobileUrl = '';
      let viaServer = true;
      if (detailsRef.current?.webUILoopback === false) {
        const conn = connectionsRef.current?.find((c) => c._id === targetRef.current);
        if (conn?.host) {
          mobileUrl = `http://${conn.host}:${webUIPort()}${detailsRef.current?.webUIBootstrapPath || '/'}`;
          viaServer = false;
        }
        // Probe says public but the connection host is unknown → no URL we can
        // justify (the loopback proxy is reserved for loopback binds now), so
        // fall through to the guard below rather than silently proxying.
      } else {
        mobileUrl = proxyUrl;
      }
      if (mobileUrl) {
        const tab = preopenedTab || openBlankWebUITab();
        if (tab) {
          try {
            tab.location.href = mobileUrl;
            setNotice({ ok: true, text: viaServer ? 'Opened the Web UI through the server.' : `Opened the Web UI directly — ${mobileUrl}` });
            return;
          } catch { /* fall through — popup may have been blocked */ }
        }
        try { navigator.clipboard?.writeText(mobileUrl); } catch { /* ignore */ }
        setNotice({ ok: true, text: `Popup blocked — URL copied to clipboard: ${mobileUrl}` });
        return;
      }
    }

    // Require Local Relay: central socket proxy has protocol/chat desync bugs
    if (!relayConnectedRef.current) {
      // Do not just close the claimed tab — the user is looking at it. Tell
      // them why, and offer the same-origin route that needs no relay here.
      if (preopenedTab && !preopenedTab.closed) {
        failWebUITab(preopenedTab, {
          heading: 'Local Relay is required',
          reason: 'The direct route tunnels through the Local Relay running on your computer. Start it, or open the Web UI through the server instead.',
          directUrl: '',
          proxyUrl,
        });
      }
      setNotice({
        ok: false,
        text: 'Local Relay is required to open Web UI. Please start Local Relay on your computer.',
      });
      return;
    }

    const tab = preopenedTab || openBlankWebUITab();

    const basePath = (typeof overridePath === 'string' && overridePath)
      ? overridePath
      : (typeof details?.webUIBootstrapPath === 'string' ? details.webUIBootstrapPath : '/');

    const navigate = (url, note) => {
      if (tab) {
        try {
          if (navigateWebUITab(tab, url, proxyUrl)) {
            setNotice({ ok: true, text: note });
            return;
          }
        } catch { /* fall through */ }
      }
      // Popup blocked: hand over the URL rather than navigating the app away.
      try { navigator.clipboard?.writeText(url); } catch { /* ignore */ }
      setNotice({ ok: true, text: `Popup blocked — URL copied to clipboard: ${url}` });
    };

    // Direct transfer via Local Relay. The relay itself verifies the full
    // chain (listener → SSH tunnel → agent Web UI) BEFORE it acks the port —
    // see handleWebuiForward in public/local-relay.js. We deliberately do NOT
    // re-verify from the browser: on production the page's CSP connect-src
    // excludes http://127.0.0.1:* (see buildCsp in src/proxy.js), so any
    // fetch() probe here is blocked client-side and would fail ALWAYS — the
    // tab would then be closed after the timeout even though the URL works
    // fine when pasted into the address bar (CSP does not restrict
    // navigations). Trust the relay's ack and navigate immediately.
    let relayFailure = '';
    if (WEBUI_START_AGENTS.includes(agentRef.current?.id) && callRef.current) {
      try {
        // Hard deadline: a hung server leg must never leave this tab on the
        // spinner — the fail card below is the only thing the user can act on.
        const rr = await withDeadline(
          callRef.current('webui-ctl', {
            config: { op: 'relay-start', port: webUIPort(), monitorOrigin: window.location.origin },
          }),
          WEBUI_OPEN_DEADLINE_MS,
          'The server did not answer the open request in time. Check your connection and try again.',
        );
        if (rr?.success && rr?.localPort) {
          const candidate = `http://127.0.0.1:${rr.localPort}`;
          navigate(`${candidate}${basePath}`,
            `Opened in a new tab — direct via Local Relay (${candidate}).`);
          return;
        }
        relayFailure = rr?.error || 'Local Relay did not report a tunnel port.';
      } catch (e) {
        relayFailure = e?.message || 'The request to Local Relay failed.';
      }
    } else {
      relayFailure = `${agentRef.current?.id || 'This agent'} has no startable Web UI to tunnel.`;
    }

    // Tunnel could not be bound. The claimed tab is sitting on
    // "Opening Web UI…" — write the reason into it instead of closing it under
    // the user's nose and leaving them with nothing.
    if (tab && !tab.closed) {
      failWebUITab(tab, {
        heading: 'Could not reach the Web UI',
        reason: relayFailure,
        directUrl: '',
        proxyUrl,
      });
    }
    setNotice({
      ok: false,
      text: relayFailure || 'Could not connect through Local Relay. Please verify Local Relay is running on your computer.',
    });
  };

  // Hand the claimed tab its destination — and make the TAB responsible for
  // noticing if the jump never happens.
  //
  // We cannot detect a blocked navigation from the opener. Measured in Chrome:
  // once the tab really leaves, reading `tab.location.href` throws and tells
  // us nothing; and before it leaves, an about:blank popup reports the
  // OPENER's URL as its href (about:blank inherits the creator's URL), so
  // "did it move?" cannot be answered from out here either. Both checks were
  // tried and both are blind.
  //
  // So the tab watches itself. The script below runs INSIDE it: it attempts
  // the navigation, and if it is still alive `graceMs` later the jump never
  // committed — Chrome refuses public-origin → loopback under Local Network
  // Access (default since Chrome 142), and on a phone 127.0.0.1 is the phone,
  // where no relay is listening. It then renders the fallback card itself.
  const navigateWebUITab = (tab, directUrl, proxyUrl, graceMs = 9000) => {
    if (!tab) return false;
    const card = '<div class="card">'
      + '<div class="kicker">Web UI</div>'
      + '<h1>Could not reach the Web UI</h1>'
      + '<p>The browser never opened the local address. Chrome blocks this while'
      + ' Local Network Access is on (a public site reaching 127.0.0.1), and'
      + ' 127.0.0.1 only exists on the computer running Local Relay &mdash; never on a'
      + ' phone. Opening through the server works from any device.</p>'
      + (directUrl ? '<pre>' + escWebUI(directUrl) + '</pre>' : '')
      + '<div class="row">'
      + (proxyUrl ? '<button class="primary" id="wb-proxy">Open through the server</button>' : '')
      + (directUrl ? '<button class="ghost" id="wb-retry">Retry direct</button>' : '')
      + '</div></div>';
    // NOTE: the closing tag is split so the string cannot terminate the block.
    const script = [
      '(function () {',
      '  var direct = ' + JSON.stringify(directUrl || '') + ';',
      '  var proxy = ' + JSON.stringify(proxyUrl || '') + ';',
      '  if (direct) { setTimeout(function () { location.replace(direct); }, 60); }',
      '  setTimeout(function () {',
      '    var box = document.getElementById("wb-stage");',
      '    if (!box) { return; }',
      '    box.innerHTML = ' + JSON.stringify(card) + ';',
      '    var p = document.getElementById("wb-proxy");',
      '    if (p && proxy) { p.addEventListener("click", function () { location.replace(proxy); }); }',
      '    var r = document.getElementById("wb-retry");',
      '    if (r && direct) { r.addEventListener("click", function () { location.replace(direct); }); }',
      '  }, ' + Number(graceMs) + ');',
      '})();',
    ].join('\n');
    return writeWebUITab(tab, 'Opening Web UI…',
      '<div id="wb-stage" class="card center"><div class="spin"></div>'
      + '<div style="font-size:13px;color:#94a3b8">Opening Web UI…</div></div>'
      + '<script>' + script + '<\/script>');
  };

  // Open the Web UI through the monitor server instead of this device.
  //
  // Same origin, so there is no Local Network Access check and no dependency
  // on this device running a relay: the server opens the SSH tunnel itself.
  // This is the route that works from a phone (no relay, and its 127.0.0.1 is
  // the phone), from a browser that blocks loopback, and any time the direct
  // jump is refused.
  const openWebUIViaServer = () => {
    const url = webUIProxyUrl();
    if (!url) {
      setNotice({ ok: false, text: 'Select a server before opening the Web UI.' });
      return;
    }
    const tab = openBlankWebUITab();
    if (tab) {
      try {
        tab.location.href = url;
        setNotice({ ok: true, text: 'Opened the Web UI through the server.' });
        return;
      } catch { /* fall through — popup may have been blocked */ }
    }
    try { navigator.clipboard?.writeText(url); } catch { /* ignore */ }
    setNotice({ ok: true, text: `Popup blocked — URL copied to clipboard: ${url}` });
  };

  const act = async (label, fn) => {
    setBusyMsg(label); setNotice(null);
    setLiveLogLines([`> Starting ${label}...`, '> Connecting to remote server...']);
    setLiveLogAction(label); setLiveLogOpen(true); setLiveLogMinimized(false);
    const startTs = Date.now();
    try {
      const r = await fn();
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      if (Array.isArray(r?.log) && r.log.length) {
        setLiveLogLines(prev => [...prev, ...r.log.flatMap(l => String(l).split('\n')), `— done in ${elapsed}s —`]);
      } else {
        const ok = r?.success !== false;
        const msg = r?.output
          ? String(r.output).trim()
          : (ok ? 'done' : (r?.error || 'failed'));
        setLiveLogLines(prev => prev.length ? [...prev, `— done in ${elapsed}s —`] : [`${ok ? '✓' : '✗'} ${label}: ${msg}  (${elapsed}s)`]);
      }
      if (r?.output) setNotice({ ok: r.success !== false, text: `${label}: ${String(r.output).slice(-400)}` });
      else setNotice({ ok: r?.success !== false, text: `${label}: ${r?.error || 'done'}` });
      await loadDetails();
      return r;
    } catch (e) {
      setLiveLogLines(prev => [...prev, `✗ ERROR: ${e.message}`]);
      setNotice({ ok: false, text: `${label}: ${e.message}` });
    } finally {
      setBusyMsg('');
    }
  };

  const gatewayOp = (op) => {
    if (op === 'stop') setUserStopped(true);
    if (op === 'start' || op === 'restart') setUserStopped(false);
    return callAction(`Gateway ${op}`, 'gateway', { config: { op } }).then((r) => {
      // After a start/stop/restart the per-instance running state changes —
      // refresh the dropdown list too, else it keeps showing the stale state.
      refreshInstances();
      return r;
    });
  };
  const saveConfig = () => {
    const isJson = ['nanobot', 'openclaw'].includes(agent.id);
    const isToml = agent.id === 'zeroclaw';
    const configPayload = isJson
      ? { configJson: yamlDraft, restart: restartAfterSave }
      : isToml
      ? { configJson: yamlDraft, configToml: yamlDraft, restart: restartAfterSave }
      : { configYaml: yamlDraft, restart: restartAfterSave };
    return callAction('Save config', 'save-config', { config: configPayload });
  };
  const savePrompt = () => {
    return callAction(`Save ${promptActiveFile}`, 'save-prompt', { config: { file: promptActiveFile, prompt: promptDraft, restart: restartAfterSave } }).then(() => {
      setPromptFilesMap(prev => ({ ...prev, [promptActiveFile]: promptDraft }));
    });
  };
  const switchPromptFile = (fileKey) => {
    setPromptFilesMap(prev => ({ ...prev, [promptActiveFile]: promptDraft }));
    setPromptActiveFile(fileKey);
    setPromptDraft(promptFilesMap[fileKey] ?? details?.promptFiles?.[fileKey] ?? '');
  };
  const removeSkill = (name) => callAction(`Remove skill ${name}`, 'skills', { config: { op: 'remove', name } });
  const installSkill = () => { if (skillInput.trim()) { const id = skillInput.trim(); setSkillInput(''); return callAction(`Install skill ${id}`, 'skills', { config: { op: 'install', id } }); } };
  const toggleBundled = (optOut) => callAction(optOut ? 'Disable bundled skills' : 'Re-enable bundled skills', 'skills', { config: { op: optOut ? 'opt-out' : 'opt-in' } });

  // ClawHub marketplace search + install
  const searchHub = useCallback(async (overrideQ) => {
    const q = (typeof overrideQ === 'string' ? overrideQ : hubQuery).trim();
    if (!q) {
      setHubResults([]);
      setHubSearched(false);
      setHubLoading(false);
      return;
    }
    setHubLoading(true); setHubError(''); setHubSearched(true);
    try {
      const res = await doFetch('/api/skills/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ q, type: 'smart' }),
      });
      const data = await res.json();
      if (data.success) setHubResults(data.skills || []);
      else setHubError(data.error || 'Search failed');
    } catch (e) { setHubError(e.message); }
    finally { setHubLoading(false); }
  }, [doFetch, hubQuery]);

  // Live autocomplete / auto-search debounce as user types
  useEffect(() => {
    const q = hubQuery.trim();
    if (!q) {
      setHubResults([]);
      setHubSearched(false);
      setHubLoading(false);
      return;
    }
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      searchHub(q);
    }, 380);
    return () => clearTimeout(timer);
  }, [hubQuery, searchHub]);

  // Helper to fetch live raw GitHub markdown or generate complete SKILL.md
  const resolveSkillContent = async (skill) => {
    if (skill.content && skill.content.trim().length > 20) return skill.content.trim();
    const gh = skill.githubUrl?.trim();
    if (gh) {
      const candidates = [];
      const treeMatch = gh.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
      if (treeMatch) {
        const [, owner, repo, branch, path] = treeMatch;
        const cleanPath = path.replace(/\/$/, '');
        if (cleanPath.endsWith('.md')) {
          candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`);
        } else {
          candidates.push(
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/SKILL.md`,
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/skill.md`,
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/README.md`
          );
        }
      } else {
        const blobMatch = gh.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
        if (blobMatch) {
          const [, owner, repo, branch, path] = blobMatch;
          candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
        } else {
          const repoMatch = gh.match(/github\.com\/([^/]+)\/([^/]+)/);
          if (repoMatch) {
            const [, owner, repo] = repoMatch;
            candidates.push(
              `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
              `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
              `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`
            );
          }
        }
      }
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const text = await res.text();
            if (text && text.trim().length > 10) return text.trim();
          }
        } catch (_) {}
      }
    }

    const safeName = skill.name || skill.id || 'Custom Skill';
    const safeDesc = skill.description || `Tool and skill definition for ${safeName}.`;
    return [
      '---',
      `name: ${safeName}`,
      `description: "${safeDesc.replace(/"/g, '\\"')}"`,
      `keywords: [${safeName.toLowerCase().replace(/[^a-z0-9]+/g, ', ')}]`,
      'source: clawhub',
      '---',
      '',
      `# ${safeName}`,
      '',
      safeDesc,
      '',
      '## Instructions & Capabilities',
      `- You have the ability to execute tasks for: ${safeName}.`,
      `- Follow user instructions closely when invoking tools or processing requests related to ${safeName}.`,
    ].join('\n');
  };

  const installHubSkill = async (skill) => {
    const rawName = skill.name || skill.id || 'custom-skill';
    const skillSlug = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 64);
    const label = `Install "${rawName}" from ClawHub`;
    setBusyMsg(label); setNotice(null);
    setLiveLogLines([`> ${label}...`, '> Resolving skill definition and instructions...']);
    setLiveLogAction(label); setLiveLogOpen(true); setLiveLogMinimized(false);
    try {
      const resolvedContent = await resolveSkillContent(skill);
      setLiveLogLines(prev => [...prev, `> Loaded skill content (${resolvedContent.length} bytes), writing to remote agent...`]);
      // Write SKILL.md over SSH to remote agent instance
      const r = await call('skills', { config: { op: 'install-content', name: rawName, id: skill.id, content: resolvedContent } });
      const ok = r?.success !== false;
      setNotice({ ok, text: r?.output || r?.error || label });
      setLiveLogLines(prev => [...prev, ok ? `✓ Installed ${rawName}` : `✗ ${r?.error || 'Failed'}`]);
      if (ok) {
        setDetails(prev => {
          if (!prev) return prev;
          const currentSkills = prev.skills || [];
          const entry = skillSlug || rawName;
          if (!currentSkills.includes(entry) && !currentSkills.includes(rawName)) {
            return { ...prev, skills: [entry, ...currentSkills] };
          }
          return prev;
        });
      }
      await loadDetails();
    } catch (e) {
      setNotice({ ok: false, text: `${label}: ${e.message}` });
      setLiveLogLines(prev => [...prev, `✗ ERROR: ${e.message}`]);
    } finally {
      setBusyMsg('');
    }
  };
  const updateAgent = () => {
    if (!confirm(`Update ${agent.name} to the latest version?\n\nThis will pull the latest updates from the official repository and restart the gateway daemon. Your configuration, API keys, and memory files will be preserved.`)) return;
    return callAction(`Update ${agent.name}`, 'update', { instance: activeInstance || undefined });
  };
  const uninstall = () => {
    setShowUninstallModal(true);
  };
  const doUninstall = (wantsPurge) => {
    setShowUninstallModal(false);
    setPurge(wantsPurge);
    const removedInstance = activeInstance; // snapshot before async
    // Immediately clear activeInstance / instRef.current locally BEFORE firing callAction
    // so that any internal loadDetails() or effect triggered by callAction queries the default instance
    // instead of querying the instance that is being deleted.
    if (removedInstance) {
      instRef.current = '';
      setInstanceSel(m => ({ ...m, [instKey]: '' }));
      setInstanceList(m => ({
        ...m,
        [instKey]: (m[instKey] || []).filter(i => i.tag !== removedInstance),
      }));
    }
    return callAction('Uninstall', 'uninstall', { instance: removedInstance || undefined, purge: wantsPurge }).then(async (r) => {
      instRef.current = '';
      setInstanceSel(m => ({ ...m, [instKey]: '' }));
      await refreshInstances();
      await loadDetails();
      return r;
    });
  };

  // ZeroClaw gateway (dashboard/API) manual code approve.
  const handleZcGatewayPairing = () => {
    const c = zcManualCode.trim();
    if (!c) return;
    handleApprovePairing(c, 'gateway');
    setZcManualCode('');
  };

  const fetchPairings = useCallback(async () => {
    if (!target || !details?.installed) return;
    try {
      const res = await call('pairing-list');
      if (res?.pending && Array.isArray(res.pending)) {
        setPendingPairings(res.pending);
      }
      if (typeof res?.pairedTokens === 'number') {
        setPairedTokens(res.pairedTokens);
      }
    } catch { /* ignore */ }
  }, [call, target, details?.installed]);

  useEffect(() => {
    if (tab === 'overview' && details?.installed) {
      fetchPairings();
    }
  }, [tab, details?.installed, fetchPairings]);

  const handleApprovePairing = async (codeToApprove, platToApprove) => {
    const c = (codeToApprove || pairingCode).trim();
    const p = platToApprove || pairingPlatform;
    if (!c) return;
    setPairingLoading(true);
    try {
      await callAction(`Approve pairing code ${c}`, 'pairing-approve', { config: { code: c, platform: p } });
      setPairingCode('');
      fetchPairings();
    } finally {
      setPairingLoading(false);
    }
  };

  // ZeroClaw: revoke / deactivate pairing (all devices or one device). The UI
  // guards destructive rotate behind a confirm().
  const revokePairing = async (which, extra) => {
    setPairingLoading(true);
    try {
      const cfg = which === 'device'
        ? { which: 'device', device: pairingRevokeDevice.trim() }
        : which === 'remove-tg'
        ? { which: 'remove-tg', device: extra }
        : { which: 'all' };
      const r = await callAction(`Revoke access (${which === 'device' ? pairingRevokeDevice : 'all devices'})`, 'pairing-revoke', { config: cfg });
      if (which === 'device') setPairingRevokeDevice('');
      fetchPairings();
      return r;
    } finally {
      setPairingLoading(false);
    }
  };

  // ── search helpers: highlight + count + navigate ──
  const logLinesAll = useMemo(() => logText.split('\n'), [logText]);
  const logLineIdx = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return [];
    return logLinesAll.map((l, i) => (l.toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0);
  }, [logLinesAll, logSearch]);
  const logMatches = logLineIdx;
  useEffect(() => { setLogNav(0); }, [logSearch]);
  const navLog = (dir) => {
    if (!logLineIdx.length) return;
    const n = (logNav + dir + logLineIdx.length) % logLineIdx.length;
    setLogNav(n);
    const lineNo = logLineIdx[n];
    requestAnimationFrame(() => document.getElementById(`log-line-${lineNo}`)?.scrollIntoView({ block: 'center' }));
  };
  const cfgOccurrences = useMemo(() => {
    const q = cfgSearch.trim().toLowerCase();
    if (!q || !yamlDraft) return [];
    const low = yamlDraft.toLowerCase();
    const res = []; let idx = low.indexOf(q);
    while (idx !== -1 && res.length < 2000) { res.push(idx); idx = low.indexOf(q, idx + q.length); }
    return res;
  }, [yamlDraft, cfgSearch]);
  useEffect(() => { setCfgNav(0); }, [cfgSearch]);
  const curLineNo = useMemo(
    () => cfgOccurrences.length
      ? yamlDraft.slice(0, cfgOccurrences[Math.min(cfgNav, cfgOccurrences.length - 1)]).split('\n').length
      : -1,
    [cfgOccurrences, cfgNav, yamlDraft]
  );
  const gotoCfg = (dir) => {
    if (!cfgOccurrences.length) return;
    const n = (cfgNav + dir + cfgOccurrences.length) % cfgOccurrences.length;
    setCfgNav(n);
    const ta = cfgTaRef.current; if (!ta) return;
    ta.focus();
    ta.setSelectionRange(cfgOccurrences[n], cfgOccurrences[n] + cfgSearch.trim().length);
    const before = yamlDraft.slice(0, cfgOccurrences[n]);
    const lineNo = before.split('\n').length;
    ta.scrollTop = Math.max(0, (lineNo - 4) * 16);
  };

  const highlightText = (text, query) => {
    const q = query.trim(); if (!q) return text;
    const parts = []; let rest = text; let k = 0;
    let idx = rest.toLowerCase().indexOf(q.toLowerCase());
    while (idx !== -1 && k < 30) {
      parts.push(rest.slice(0, idx));
      parts.push(<mark key={k++} className="bg-amber-400/70 text-black rounded px-0.5">{rest.slice(idx, idx + q.length)}</mark>);
      rest = rest.slice(idx + q.length);
      idx = rest.toLowerCase().indexOf(q.toLowerCase());
    }
    parts.push(rest); return parts;
  };

  // load config backups when Config tab opens
  useEffect(() => {
    if (tab !== 'config' || !target) return;
    call('backups').then(r => setBackups(r?.backups || [])).catch(() => {});
  }, [tab, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const logPauseRef = useRef(logPause);
  useEffect(() => { logPauseRef.current = logPause; }, [logPause]);
  const connectionsRef = useRef(connections);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  // Auto-scroll to bottom of log pre when new stream data arrives
  useEffect(() => {
    if (logPreRef.current && !logPause && tab === 'logs') {
      logPreRef.current.scrollTop = logPreRef.current.scrollHeight;
    }
  }, [logText, logPause, tab]);

  // ── Agent Live Log Streaming: WebRTC P2P → Dedicated Non-Interactive Exec → HTTP fallback ──
  const cleanLogStream = (text) => {
    if (!text) return '';
    return text
      .replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, '') // ANSI control & bracketed paste
      .replace(/\[\?2004[hl]\]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/^Last login:.*\r?\n?/gm, '')
      .replace(/^\[root@[^\]]+\][#\$]?\s*/gm, '')
      .replace(/^\[[^\]@]+@[^\]]+\][\$#]\s*/gm, '')
      .replace(/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+:[^$#]*[\$#]\s*/gm, '')
      .replace(/^stty -echo.*\r?\n?/gm, '')
      .replace(/^sh -c '[\s\S]*?fi'\r?\n?/gm, '')
      .replace(/^.*(?:for f in|journalctl --user -u|tail -n [0-9]+|LOGF="").*\r?\n?/gm, '')
      .trimStart();
  };

  const relayConnectedRef = useRef(relayInfo?.connected);
  useEffect(() => { relayConnectedRef.current = relayInfo?.connected; }, [relayInfo?.connected]);

  useEffect(() => {
    if (tab !== 'logs' || !target) {
      if (socketRef.current) {
        try { socketRef.current.emit('agent:logs:stop'); } catch {}
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (rtcPeerRef.current) {
        try { rtcPeerRef.current.close(); } catch {}
        rtcPeerRef.current = null;
      }
      return;
    }

    let active = true;
    let hasReceivedData = false; // Track if any data has come through
    // Timers owned by the EFFECT, not by the socket handler.
    // They used to be declared inside the `ssh:connected` handler below, and that
    // handler ended with `return () => clearInterval(pollInterval)` — but that
    // return value goes to socket.io, which discards it. The effect's own cleanup
    // never cleared them, so the 5s poll kept firing after teardown. Declaring
    // them here lets the cleanup at the bottom of this effect cancel them.
    let pollInterval = null;
    let placeholderTimer = null;
    console.log(`[Agent Logs] useEffect triggered: tab=${tab}, target=${target}, agentId=${agentId}`);
    const selectedConn = connectionsRef.current?.find(c => c._id === target);
    if (!selectedConn) {
      console.log('[Agent Logs] No selected connection found, aborting');
      return;
    }
    console.log(`[Agent Logs] Selected connection: ${selectedConn.name || selectedConn.host}`);

    setLogText('');
    setLogStreamMode('connecting');

    // Tear down stale socket from previous server/agent
    if (socketRef.current) {
      try { socketRef.current.emit('agent:logs:stop'); } catch {}
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Instance-scoped home dir (empty tag → default ~/.<agent>)
    const instTag = activeInstance ? `-${activeInstance}` : '';
    const homePref = `$HOME/.${agentId}${instTag}`;

    // Single-line tail command that continuously follows daemon logs with -F (read-only, never creates dirs)
    const tailCmd = `stty -echo 2>/dev/null; if [ -d "${homePref}/logs" ]; then LOGF="$(ls -1t "${homePref}/logs/"*.log 2>/dev/null | head -1)"; [ -n "$LOGF" ] && tail -n 100 -F "$LOGF" 2>/dev/null; fi || journalctl --user -u ${agentId} --no-pager -n 100 -f 2>/dev/null\n`;

    // ── HTTP snapshot (one-shot, used as initial seed or error fallback) ──
    const fetchSnapshot = async () => {
      try {
        const res = await fetch(agentRef.current.api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ connectionId: targetRef.current, action: 'logs', instance: instRef.current || undefined, config: { lines: 300 } }),
        });
        const r = await res.json();
        if (active && r?.data) {
          hasReceivedData = true; // Mark that we've received data
          const cleaned = cleanLogStream(r.data);
          if (cleaned) {
            console.log(`[Agent Logs] Fetched ${cleaned.length} chars of logs via HTTP`);
            setLogText(cleaned.slice(-100000));
          } else {
            // No historical logs exist — show helpful message
            setLogText(`[No historical logs found]\n\nThe agent log file appears to be empty. New log entries will appear here as they are generated.\n\nTo generate logs, try:\n- Starting or restarting the ${agent.name} gateway\n- Sending a message to your bot via Telegram/Discord/etc\n- Running: systemctl --user status ${agentId}\n`);
          }
        } else {
          setLogText(`[Connection established]\n\nWaiting for log output from ${agent.name}...\n\nIf no logs appear:\n1. Check if the agent is running (Overview tab)\n2. Verify ~/.${agentId}/logs/ directory exists\n3. Send a test message to your bot to generate activity\n`);
        }
      } catch (err) {
        if (active) {
          console.error('[Agent Logs] HTTP fetch error:', err.message);
          setLogText(`[Log fetch error]\n\nCouldn't retrieve logs: ${err.message}\n\nTry clicking Refresh or check if the agent is running.\n`);
        }
      }
    };

    const preferredRelay = typeof window !== 'undefined'
      ? (localStorage.getItem('ssh_monitor_preferred_relay') || undefined)
      : undefined;

    const socket = io({ path: '/api/socket', transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    console.log('[Agent Logs] Socket.IO client created, waiting for connect event...');

    socket.on('connect', () => {
      if (!active) return;
      console.log(`[Agent Logs] Socket connected! Emitting ssh:connect for ${selectedConn.name || selectedConn.host}`);
      socket.emit('ssh:connect', {
        connectionId: selectedConn._id,
        connection: selectedConn,
        preferredRelay,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Agent Logs] Socket disconnected: ${reason}`);
    });

    // (ssh:error / connect_error are registered ONCE each, further down, where
    // they also fall back to an HTTP snapshot. They used to be registered twice
    // — this logging-only pair plus that one — and socket.io invokes every
    // registered listener for an event, so the duplicate was dead weight.)
    socket.on('ssh:close', () => {
      console.log('[Agent Logs] SSH session closed');
    });

    // ── Path 1: WebRTC P2P via Local Relay (zero central server load) ──
    socket.on('relay:rtc:ready', async ({ connId: relayConnId }) => {
      if (!active) return;
      console.log(`[Agent Logs] relay:rtc:ready received, initializing WebRTC peer for ${relayConnId}`);
      try {
        const peer = await createRelayPeer({ socket, relayConnId });
        if (!active) { peer.close(); return; }
        rtcPeerRef.current = peer;
        setLogStreamMode('p2p');
        console.log('[Agent Logs] WebRTC peer established, setting up SSH channel...');

        peer.channel(DC.SSH).onmessage = (evt) => {
          if (!active || logPauseRef.current) return;
          hasReceivedData = true; // Mark that we've received data
          const raw = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data);
          console.log(`[Agent Logs] WebRTC data received: ${raw.length} bytes`);
          const chunk = cleanLogStream(raw);
          console.log(`[Agent Logs] After cleanLogStream (WebRTC): ${chunk?.length || 0} chars`);
          if (chunk) {
            setLogText(prev => {
              // If we had the placeholder message, replace it completely
              if (prev.includes('Listening for live output')) return chunk.slice(-100000);
              return (prev + chunk).slice(-100000);
            });
          }
        };

        peer.sendControl({ type: 'ssh:start', connId: relayConnId });
        console.log('[Agent Logs] Sent ssh:start control message via WebRTC');
        setTimeout(() => {
          if (active) {
            console.log('[Agent Logs] Sending tail command via WebRTC:', tailCmd.substring(0, 80) + '...');
            try { peer.sendSsh(tailCmd); } catch {}
          }
        }, 300);
      } catch (err) {
        if (!active) return;
        console.warn('[Agent Logs] WebRTC failed, falling back to WS relay:', err?.message);
        setLogStreamMode('relay_ws');
      }
    });

    // ── Path 2: Dedicated Non-Interactive Stream / Fallback Stream ──
    socket.on('ssh:connected', () => {
      if (!active || rtcPeerRef.current) return; // already on WebRTC
      console.log(`[Agent Logs] SSH connected for ${agentId}, setting up polling mode`);
      setLogStreamMode('relay_ws');
      
      // WORKAROUND: Poll for new logs every 5 seconds instead of tail -F
      // tail -F doesn't stream continuously over SSH exec
      let lastFetchTime = Date.now();
      pollInterval = setInterval(() => {
        if (!active) {
          clearInterval(pollInterval);
          return;
        }
        console.log('[Agent Logs] Polling for new logs...');
        fetchSnapshot();
      }, 5000); // Poll every 5 seconds

      // Initial fetch
      console.log('[Agent Logs] Fetching initial logs...');
      fetchSnapshot();

      // Show a helpful message after 3 seconds if no logs appear
      placeholderTimer = setTimeout(() => {
        if (!active || hasReceivedData) {
          console.log(`[Agent Logs] Placeholder check at 3s: active=${active}, hasReceivedData=${hasReceivedData} - skipping`);
          return;
        }
        console.log(`[Agent Logs] No logs after 3s, showing placeholder for ${agentId}`);
        setLogText(`[SSH connection established]\n\nConnected to ${selectedConn.name || selectedConn.host} successfully.\nAuto-refreshing every 5 seconds...\n\nIf no logs appear:\n• The agent gateway might not be running\n• Try starting/restarting the gateway from the Overview tab\n• Click the "Refresh" button above to fetch logs manually\n`);
      }, 3000);
      // NOTE: intentionally no cleanup returned here. This is a socket.io event
      // handler and socket.io DISCARDS handler return values — the old
      // `return () => clearInterval(pollInterval)` never ran. Both timers are now
      // cancelled by the effect's own cleanup at the bottom of this effect.
    });

    socket.on('ssh:data', (data) => {
      console.log(`[Agent Logs] ssh:data received (${data?.length || 0} bytes), active=${active}, paused=${logPauseRef.current}, rtc=${!!rtcPeerRef.current}`);
      console.log(`[Agent Logs] Raw data preview:`, data?.substring?.(0, 100) || data);
      if (!active || logPauseRef.current || rtcPeerRef.current) {
        console.log('[Agent Logs] Early return triggered');
        return;
      }
      hasReceivedData = true; // Mark that we've received data
      console.log('[Agent Logs] Calling cleanLogStream...');
      const chunk = cleanLogStream(data);
      console.log(`[Agent Logs] After cleanLogStream: ${chunk?.length || 0} chars`);
      if (chunk) {
        console.log('[Agent Logs] Chunk exists, calling setLogText');
        setLogText(prev => {
          console.log(`[Agent Logs] setLogText callback, prev length: ${prev.length}`);
          // If we had the placeholder message, replace it completely
          if (prev.includes('Listening for live output') || prev.includes('[SSH connection established]')) {
            console.log('[Agent Logs] Replacing placeholder with real data');
            return chunk.slice(-100000);
          }
          console.log('[Agent Logs] Appending to existing log');
          return (prev + chunk).slice(-100000);
        });
      } else {
        console.log('[Agent Logs] Chunk is empty, not updating UI');
      }
    });

    // ── Path 3: HTTP snapshot fallback on error ──
    socket.on('ssh:error', (err) => {
      console.error('[Agent Logs] SSH error:', err);
      if (!active) return;
      setLogStreamMode('http');
      fetchSnapshot();
    });

    socket.on('connect_error', (err) => {
      console.error('[Agent Logs] Socket connection error:', err?.message);
      if (!active) return;
      setLogStreamMode('http');
      fetchSnapshot();
    });

    return () => {
      active = false;
      // Cancel the timers created inside the `ssh:connected` handler above.
      // Without this the 5s snapshot poll outlives the effect and keeps POSTing
      // after the user switches tabs or the component unmounts.
      if (pollInterval) clearInterval(pollInterval);
      if (placeholderTimer) clearTimeout(placeholderTimer);
      if (socketRef.current) {
        try { socketRef.current.emit('agent:logs:stop'); } catch {}
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (rtcPeerRef.current) {
        try { rtcPeerRef.current.close(); } catch {}
        rtcPeerRef.current = null;
      }
    };
  }, [tab, target, agentId, activeInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep refs in sync so interval closures always read latest values
  const callRef = useRef(call);
  useEffect(() => { callRef.current = call; }, [call]);
  const detailsRef = useRef(details);
  useEffect(() => { detailsRef.current = details; }, [details]);
  const agentRef = useRef(agent);
  useEffect(() => { agentRef.current = agent; }, [agent]);
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { autoHealRef.current = autoHeal; }, [autoHeal, healKey]);
  useEffect(() => { userStoppedRef.current = userStopped; }, [userStopped]);

  // re-sync userStopped from sessionStorage when agent/target changes
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(`agent-stopped:${agentId}:${target || ''}`) === '1';
      userStoppedRef.current = v;
      setUserStoppedState(v);
    } catch { /* ignore */ }
  }, [agentId, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Health watchdog (only runs when auto-heal is enabled by user) ──
  useEffect(() => {
    if (!target || !autoHeal) return;
    let cancelled = false;
    const check = async () => {
      if (!detailsRef.current?.installed || !autoHealRef.current || userStoppedRef.current || cancelled) return;
      try {
        const h = await callRef.current('health');
        if (!cancelled && h) setHealth(h);
        if (!cancelled && autoHealRef.current && !userStoppedRef.current && h && !h.alive && h.installed !== false) {
          setNotice({ ok: false, text: `⚠ ${agent.name} gateway died unexpectedly — auto-restarting…` });
          const r = await callRef.current('gateway', { config: { op: 'start' } });
          if (r?.success) setNotice({ ok: true, text: `✓ ${agent.name} gateway was down — automatically restarted.` });
        }
      } catch { /* transient */ }
    };
    const t0 = setTimeout(check, 15000);
    const iv = setInterval(check, 60000);
    return () => { cancelled = true; clearTimeout(t0); clearInterval(iv); };
  }, [target, agentId, autoHeal, healKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputCls = 'w-full bg-black/30 border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-400/50';
  // Safely render a value as text: React throws "object as a React child" when
  // a non-primitive (e.g. an accidental component/object) lands in a text slot.
  const txt = (v) => {
    if (v == null) return '';
    return (typeof v === 'string' || typeof v === 'number') ? String(v) : String(v);
  };
  const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer disabled:opacity-40';

  if (!isSupporter) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-8 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[600px] text-center space-y-6">
        <style>{`select option { background-color: #16162a; color: #fff; }`}</style>
        
        {/* Glow ambient background */}
        <div className="relative">
          <div className="absolute -inset-4 bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-indigo-500/20 rounded-full blur-2xl opacity-75 animate-pulse" />
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-600/30 border border-pink-500/30 flex items-center justify-center shadow-2xl shadow-pink-500/20">
            <Lock size={36} className="text-pink-400" />
          </div>
        </div>

        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-pink-500/10 text-pink-300 border border-pink-500/25">
            <Sparkles size={12} className="text-pink-400" /> Supporter-Exclusive App
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-white/90 to-pink-200 bg-clip-text text-transparent">
            AI Autonomous Agent Fleet
          </h2>
          <p className="text-xs md:text-sm text-[var(--text-muted)] leading-relaxed">
            Deploy and manage autonomous AI agents (Hermes, OpenClaw, Nanobot &amp; ZeroClaw) with low-latency WebRTC P2P live log streamline and zero central server overhead.
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl text-left">
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)]/80 border border-pink-500/15 hover:border-pink-500/30 transition space-y-1.5">
            <div className="flex items-center gap-2 text-pink-400 font-bold text-xs">
              <Radio size={15} /> WebRTC P2P Live Logs
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Stream remote agent logs directly peer-to-peer via Local Relay DataChannels with zero central server bandwidth or CPU usage.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)]/80 border border-indigo-500/15 hover:border-indigo-500/30 transition space-y-1.5">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
              <BrainCircuit size={15} /> 4 AI Agent Engines
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              1-click cross-distro deployment for Hermes, OpenClaw, Nanobot &amp; ZeroClaw on Ubuntu, Debian, Rocky, Fedora, Arch &amp; OpenSUSE.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)]/80 border border-emerald-500/15 hover:border-emerald-500/30 transition space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
              <Cable size={15} /> Private &amp; NAT Server Tunnel
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Manage AI agents on home labs and private VPCs via Local Relay without opening any inbound ports.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)]/80 border border-violet-500/15 hover:border-violet-500/30 transition space-y-1.5">
            <div className="flex items-center gap-2 text-violet-400 font-bold text-xs">
              <FileText size={15} /> Personality &amp; Skills Studio
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Customize SOUL.md, PROMPT.md, and install community skills from the curated live skills catalog.
            </p>
          </div>
        </div>

        {/* Unlock Action Button */}
        <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={() => setSupporterModalOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white font-bold text-xs shadow-lg shadow-pink-500/25 hover:shadow-pink-500/40 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
          >
            <Sparkles size={14} /> Unlock with Supporter Membership
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-muted)] opacity-70">
          Already a supporter? Click the button above to verify or enter your Ko-fi activation code.
        </p>

        <SupporterModal
          open={supporterModalOpen}
          onClose={() => setSupporterModalOpen(false)}
        />
      </div>
    );
  }

  // ── 0. Initial Local Relay probe on open ──
  if (checkingRelay && !relayInfo?.connected && !forceBypassRelay) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 animate-in fade-in duration-200">
        <div className="relative">
          <div className="absolute -inset-3 bg-pink-500/15 rounded-full blur-xl animate-pulse" />
          <div className="relative w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] border border-pink-500/30 flex items-center justify-center">
            <Loader2 size={20} className="text-pink-400 animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-white">Checking Local Relay…</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Verifying direct connection on your computer</div>
        </div>
      </div>
    );
  }

  // ── Force Local Relay Setup: Require Local Relay for optimal speed, 0ms direct WebUI, and no SSH polling latency ──
  if (!relayInfo?.connected && !forceBypassRelay) {
    const selectedConn = connections.find(c => c._id === target) || connections[0];
    const serverOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const quickCmd = `rm -f ./local-relay.js && curl -fsSL -H 'Cache-Control: no-cache' "${serverOrigin}/local-relay.js" -o ./local-relay.js && node ./local-relay.js --pair --server "${serverOrigin}" && rm -f ./local-relay.js`;

    return (
      <div className="h-full overflow-y-auto">
        <style>{`select option { background-color: #16162a; color: #fff; }`}</style>
        <div className="min-h-full flex flex-col lg:flex-row">

          {/* ── Left: Branding & Feature highlights ── */}
          <div className="flex-1 flex flex-col justify-center p-6 md:p-8 lg:p-10 space-y-5 lg:max-w-[52%]">
            {/* Badge + Title */}
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-pink-500/10 text-pink-300 border border-pink-500/25">
                <Cable size={11} className="text-pink-400" />
                Local Relay Required
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-extrabold tracking-tight text-white leading-tight">
                  Fast Agent Telemetry
                  <span className="block bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
                    &amp; 0ms WebUI
                  </span>
                </h2>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-2 max-w-sm">
                  A small helper app on your computer connects your AI Agents directly to your servers — for faster updates and a smoother Web UI, with your data staying between you and your servers.
                </p>
              </div>
            </div>

            {/* Feature pillars — horizontal rows */}
            <div className="space-y-2">
              {[
                { icon: <Zap size={13} className="text-pink-400 shrink-0" />, label: '10× Faster Sync', desc: 'Agent status updates arrive almost instantly.' },
                { icon: <Radio size={13} className="text-indigo-400 shrink-0" />, label: 'Instant Web UI', desc: 'Chat responds in real time, right on your computer.' },
                { icon: <Shield size={13} className="text-emerald-400 shrink-0" />, label: 'Private by Design', desc: 'Encrypted direct connection — your data never touches our servers.' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[var(--bg-secondary)]/60 border border-white/5">
                  <div className="mt-0.5">{icon}</div>
                  <div>
                    <div className="text-[11px] font-bold text-white">{label}</div>
                    <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* ── Right: Action card ── */}
          <div className="flex-1 flex flex-col justify-center p-6 md:p-8 lg:p-10 lg:border-l lg:border-[var(--border-color)] border-t border-[var(--border-color)] lg:border-t-0">
            <div className="max-w-md w-full mx-auto space-y-4">
              {/* Ambient glow + icon */}
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className="absolute -inset-2 bg-pink-500/20 rounded-full blur-lg animate-pulse" />
                  <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500/20 via-purple-600/30 to-indigo-600/20 border border-pink-500/40 flex items-center justify-center">
                    <Cable size={18} className="text-pink-400" />
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Start Local Relay</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Run once in your terminal — auto-detected</div>
                </div>
              </div>

              {/* Command box */}
              <div className="rounded-xl bg-black/50 border border-white/10 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500/70" />
                    <div className="w-2 h-2 rounded-full bg-amber-500/70" />
                    <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)] font-mono">Terminal</div>
                </div>
                <div className="p-3 font-mono text-[10px] text-pink-200/80 leading-relaxed break-all select-all">
                  {quickCmd}
                </div>
              </div>

              {/* Copy button */}
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(quickCmd).catch(() => {});
                  setNotice({ ok: true, text: 'Command copied to clipboard!' });
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:from-pink-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-pink-500/20 transition cursor-pointer"
              >
                <Copy size={13} /> Copy Command
              </button>

              {/* Status row */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500" />
                  </span>
                  Waiting… auto-detecting every 2.5s
                </div>
                <button
                  onClick={async () => {
                    setNotice(null);
                    const ok = await checkLocalRelay();
                    setNotice(ok
                      ? { ok: true,  text: 'Local Relay connected!' }
                      : { ok: false, text: 'Not detected — make sure local-relay.js is running.' }
                    );
                  }}
                  className="flex items-center gap-1 text-[10px] font-bold text-pink-300 hover:text-pink-200 bg-pink-500/10 hover:bg-pink-500/20 px-2 py-1 rounded-lg border border-pink-500/20 transition cursor-pointer"
                >
                  <RefreshCw size={10} /> Check Now
                </button>
              </div>

              {/* Approve Pairing Code section */}
              <div className="p-3 rounded-xl bg-pink-500/5 border border-pink-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold text-pink-300 uppercase tracking-wide flex items-center gap-1.5">
                    <KeyRound size={12} className="text-pink-400" />
                    Enter Pairing Code
                  </div>
                  <span className="text-[9px] text-[var(--text-muted)]">From terminal</span>
                </div>
                <RelayPairingPanel
                  compact
                  onApproved={async () => {
                    // Pairing a relay on THIS device is an explicit "I want
                    // relay mode here", so drop any earlier direct-connection
                    // opt-out — otherwise AppContext would never pin back to
                    // local mode and the relay would sit unused.
                    try { localStorage.removeItem('ssh_monitor_relay_optout'); } catch {}
                    setNotice({ ok: true, text: 'Relay approved! Connecting...' });
                    await checkLocalRelay();
                  }}
                  onSupporterRequired={() => setSupporterModalOpen(true)}
                />
              </div>

              {/* NPM install alternative */}
              <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)]/50 border border-[var(--border-color)] space-y-1">
                <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Or install globally</div>
                <div className="font-mono text-[10px] text-[var(--text-primary)] bg-black/30 px-2 py-1 rounded-lg select-all">
                  npm i -g ssh-monitor-relay &amp;&amp; local-relay --pair --server {serverOrigin}
                </div>
              </div>

              {/* Bypass option for Cloud / Mobile / Server mode */}
              <div className="pt-2 text-center">
                <button
                  onClick={bypassRelay}
                  className="w-full py-2.5 px-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ServerIcon size={14} className="text-indigo-400" />
                  <span>Using a cloud server or phone? Continue with direct connection</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  const zcBindCode = (pendingPairings.find(p => p.platform === 'telegram-bind') || {}).code || '';
  // Instances that exist on the server but are not running (default uninstalled,
  // instance homes survived). Shown as a banner on the install card.
  const stoppedInstanceTags = (instanceList[instKey] || []).filter(i => i.tag && !i.running).map(i => i.tag);
  const zcTgUsers = (() => {
    const users = new Set();
    // 1. .env allow-list (TELEGRAM_ALLOWED_USERS)
    const m = String(details?.envText || '').match(/^TELEGRAM_ALLOWED_USERS=(.*)$/m);
    (m ? m[1].split(',') : []).forEach(x => { const v = x.trim(); if (v) users.add(v); });
    // 2. /bind results live in config.toml [peer_groups.*].external_peers
    const cfg = String(details?.configJson || '');
    for (const mm of cfg.matchAll(/external_peers\s*=\s*\[([^\]]*)\]/g)) {
      mm[1].split(',').forEach(x => { const v = x.trim().replace(/^"|"$/g, ''); if (v && /^\d+$/.test(v)) users.add(v); });
    }
    return [...users];
  })();
  return (
    <div className="h-full overflow-y-auto p-2.5 sm:p-4 md:p-6 max-w-4xl mx-auto space-y-4 select-text">
      <style>{`select option { background-color: #16162a; color: #fff; }`}</style>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {agent.logo
            ? <img src={agent.logo} alt="" className="w-6 h-6 rounded object-contain" />
            : <BrainCircuit size={22} className="text-[var(--accent-indigo)]" />}
          <div>
            <h1 className="text-base font-bold">AI Agents</h1>
            <p className="text-[11px] text-[var(--text-muted)]">Install & manage autonomous agents on your servers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button onClick={toggleLiveLogs} title={liveLogs ? 'Live action logs: ON (click to disable)' : 'Live action logs: OFF (click to enable)'}
            className={`${btn} ${liveLogs ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveLogs ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-muted)]'}`} /> Live logs {liveLogs ? 'on' : 'off'}
          </button>
          <button onClick={() => loadDetails()} disabled={loading || !target} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>
      </div>

      {/* Server picker */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Server</label>
          <div className="flex items-center gap-1.5">
            {relayInfo?.connected ? (
              <span className="flex items-center gap-1 text-[10px] text-pink-300 font-bold bg-pink-500/10 px-2 py-0.5 rounded-full border border-pink-500/20 shadow-[0_0_10px_rgba(236,72,153,0.15)]" title="Local Relay active: Direct communication with zero server hops">
                <Cable size={10} className="text-pink-400" /> Local Relay Active
              </span>
            ) : (
              <button
                onClick={async () => {
                  const ok = await checkLocalRelay();
                  if (ok) setNotice({ ok: true, text: 'Local Relay detected and active!' });
                  else setNotice({ ok: false, text: 'Local Relay is not running on your computer.' });
                }}
                className="flex items-center gap-1 text-[10px] text-amber-300/90 font-medium bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/20 transition cursor-pointer"
                title="Local Relay is not connected: Click to check connection"
              >
                <Radio size={10} className="text-amber-400 animate-pulse" /> Local Relay Inactive · Check
              </button>
            )}
          </div>
        </div>
        <ThemeSelect
          value={target}
          onChange={setTarget}
          options={connections.map(c => ({ value: c._id, label: `${c.name || c.host} (${c.host})` }))}
          placeholder="— select a server —"
          icon={ServerIcon}
          size="sm"
          className="mt-1 w-full"
        />

        {/* Agent catalog */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          {AGENTS.map(a => (
            <button
              key={a.id}
              onClick={() => setAgentId(a.id)}
              className={`text-left flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition cursor-pointer ${agentId === a.id ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-[var(--border-color)] bg-black/20 hover:bg-white/5'}`}>
              {a.logo ? (
                <img src={a.logo} alt="" className="mt-0.5 w-4 h-4 shrink-0 rounded object-contain bg-black/20 p-px" />
              ) : (
                <BrainCircuit size={16} className={`mt-0.5 shrink-0 ${agentId === a.id ? 'text-indigo-400' : 'text-[var(--text-muted)]'}`} />
              )}
              <span className="min-w-0">
                <span className="block text-xs font-bold">{a.name} <span className="text-[9px] font-normal text-[var(--text-muted)]">by {a.by}</span></span>
                <span className="block text-[10px] text-[var(--text-muted)] line-clamp-2">{a.desc}</span>
              </span>
            </button>
          ))}
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border-color)] px-3 py-2.5 opacity-50">
            <Plus size={14} className="text-[var(--text-muted)] shrink-0" />
            <span className="text-[10px] text-[var(--text-muted)]">More agents coming soon</span>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${notice.ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/25 bg-red-500/10 text-red-300'}`}>
          {notice.text}
        </div>
      )}

      {!target ? (
        <div className="rounded-xl border border-dashed border-[var(--border-color)] p-8 text-center text-xs text-[var(--text-muted)]">Select a server to begin</div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-xs text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Reading agent state…</div>
      ) : loadError ? (
        /* Connection error card — do not mask connection failures as 'not installed' */
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <AlertCircle size={28} className="mx-auto mb-2 text-rose-400" />
          <p className="text-sm font-bold mb-1 text-rose-200">Unable to Connect to Server</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-4 max-w-md mx-auto">{loadError}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => loadDetails()} className={`${btn} bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 text-xs px-4 py-2`}>
              <RefreshCw size={12} /> Retry Connection
            </button>
            <button onClick={() => { bypassRelay(); setTimeout(() => loadDetails(), 50); }} className={`${btn} bg-white/5 hover:bg-white/10 border border-[var(--border-color)] text-xs px-3 py-2 text-[var(--text-muted)] hover:text-white`}>
              <ServerIcon size={12} /> Force Cloud / Direct Mode
            </button>
          </div>
        </div>
      ) : !details?.installed ? (
        /* Not installed → install card */
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-5 text-center">
          {agent.logo
            ? <img src={agent.logo} alt="" className="w-8 h-8 mx-auto mb-2 rounded object-contain" />
            : <BrainCircuit size={26} className="mx-auto mb-2 text-indigo-400" />}
          <p className="text-sm font-bold mb-1">No default agent installed on this server</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">Install {agent.name} with one click — chat with it from Telegram, LINE, Discord &amp; more.</p>
          {stoppedInstanceTags.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-4 text-left">
              <div className="text-[10px] font-bold text-amber-300 mb-0.5">
                {stoppedInstanceTags.length} instance{stoppedInstanceTags.length > 1 ? 's' : ''} still on this server (stopped): {stoppedInstanceTags.join(', ')}
              </div>
              <div className="text-[10px] text-amber-200/70">
                One-Click Install will restore the binary — then select an instance in the dropdown and press Start to bring it back.
              </div>
            </div>
          )}
          <button onClick={() => setShowWizard(true)} className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white text-xs px-5 py-2.5`}>
            <Send size={13} /> One-Click Install
          </button>
          <a href={agent.docs} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200 align-middle">
            Docs <ExternalLink size={9} />
          </a>
        </div>
      ) : (
        /* Installed → management panel */
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
          {/* Status bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] bg-black/20">
            <span className={`flex items-center gap-1.5 text-xs font-bold ${details.running ? 'text-emerald-400' : 'text-amber-400'}`}>
              {details.running ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {details.running ? 'Gateway running' : 'Gateway stopped'}
            </span>
            {details.version && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] font-mono flex items-center gap-1.5" title={details?.updateAvailable ? `Update available: v${details.latestVersion}` : 'Up to date'}>
                <span>{txt(details.version.match(/v?[0-9]+\.[0-9]+(\.[0-9]+)?(-[0-9]+)?/)?.[0] || details.version.split('\n')[0].slice(0, 30))}</span>
                {!details?.updateAvailable && (
                  <span className="text-emerald-400 font-sans font-bold text-[9px] flex items-center gap-0.5">
                    <Check size={9} /> up to date
                  </span>
                )}
                {details?.updateAvailable && (
                  <span className="text-emerald-400 font-sans font-bold text-[9px] flex items-center gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping" />
                    update
                  </span>
                )}
              </span>
            )}
            {details.binPath && (
              <span className="text-[9px] font-mono text-[var(--text-muted)] opacity-70 truncate max-w-[220px] hidden sm:inline" title={`Binary path: ${txt(details.binPath)}`}>
                {txt(details.binPath)}
              </span>
            )}
            {details.isNanobot !== true && details.model && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">🧠 {txt(details.model)}</span>}
            {details.isNanobot === true && details.models?.length > 1 && (
              <span className="flex items-center gap-1">
                <span className="text-[10px] text-indigo-200">🧠</span>
                <select
                  value={details.activeModelPreset || ''}
                  onChange={(e) => call('set-model-preset', { config: { preset: e.target.value } }).then(r => {
                    if (r?.success) { setNotice({ ok: true, text: `Model preset → ${r.activeModelPreset}` }); loadDetails(); }
                    else setNotice({ ok: false, text: r?.error || 'Failed to switch model' });
                  })}
                  disabled={!!busyMsg}
                  className="text-[10px] bg-black/40 border border-[var(--border-color)] rounded px-1.5 py-0.5 text-indigo-200 font-mono cursor-pointer max-w-[180px]"
                  title="Active model preset (nanobot)"
                >
                  {details.models.map(m => (
                    <option key={m.preset} value={m.preset} className="text-black">
                      {m.preset}{m.model ? ` · ${m.model}` : ''}
                    </option>
                  ))}
                </select>
              </span>
            )}
            {details.isNanobot === true && details.models?.length <= 1 && details.model && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">🧠 {txt(details.model)}</span>}
            {details.service && <span className="text-[10px] text-[var(--text-muted)]">{txt(details.service)} service</span>}
            <span className="ml-auto flex items-center gap-1">
              {!details.running && <button onClick={() => gatewayOp('start')} disabled={!!busyMsg} className={`${btn} bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}><Play size={11} /> Start</button>}
              {details.running && <button onClick={() => gatewayOp('stop')} disabled={!!busyMsg} className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}><Square size={11} /> Stop</button>}
              <button onClick={() => gatewayOp('restart')} disabled={!!busyMsg} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}><RotateCw size={11} /> Restart</button>
            </span>
          </div>

          {/* Multi-instance bar (all agents) */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-black/10">
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Instances</span>
            <ThemeSelect
              value={activeInstance}
              onChange={v => setInstanceSel(m => ({ ...m, [instKey]: v }))}
              options={(instanceList[instKey] || [{ tag: '', running: undefined }]).map(i => ({
                value: i.tag,
                label: `${i.tag || 'default'}${i.running === false ? ' (stopped)' : ''}`,
              }))}
              disabled={!!busyMsg}
              placeholder="default"
              size="xs"
              className="w-40"
              title={`Active ${agent.name} instance`}
            />
            <button
              onClick={spawnInstance}
              disabled={!!busyMsg || spawningInstance}
              className={`${btn} !py-1 !px-2 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25`}
              title={`Spawn another ${agent.name} instance on this server (own data dir, own bot token)`}
            >
              {spawningInstance ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Spawn instance
            </button>
            {activeInstance && (
              <span className="text-[9px] text-[var(--text-muted)]">
                dir: {instHome(activeInstance)} · give it its OWN bot token via Env tab
              </span>
            )}
          </div>

          {/* Abnormal-state banner */}
          {!details.binPath && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
              <AlertCircle size={14} /> {agent.name} binary is not found on this server.
              <button onClick={() => setShowWizard(true)} disabled={!!busyMsg} className={`${btn} !py-1 !px-2.5 ml-auto bg-indigo-500 text-white hover:bg-indigo-400 font-bold`}>
                <Send size={11} /> 1-Click Install {agent.name}
              </button>
            </div>
          )}
          {details.binPath && details.running === false && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              <XCircle size={14} /> Gateway is DOWN — your bot is not responding.
              <button onClick={() => gatewayOp('start')} disabled={!!busyMsg} className={`${btn} !py-1 !px-2 ml-auto bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30`}>
                <Play size={11} /> Start it now
              </button>
            </div>
          )}
          {health && details.running && (health.telegram === 'error' || health.telegram === 'disconnected') && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>Telegram bot error — check your bot token or server network.</span>
            </div>
          )}

          <div className="flex gap-1 px-3 pt-3 bg-black/10 overflow-x-auto scrollbar-hide shrink-0" style={{ WebkitOverflowScrolling: 'touch' }}>
            {[
              ['overview', 'Overview'],
              ['skills', `Skills (${(details.skills || []).length})`],
              ['prompt', 'Personality & Prompt'],
              ['config', 'Config'],
              ['env', `Env (${(details.envKeys || []).length})`],
              ['logs', 'Logs (live)'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`shrink-0 px-3 py-2 sm:py-1.5 rounded-t-lg text-[11px] font-bold transition cursor-pointer whitespace-nowrap active:opacity-80 ${tab === id ? 'bg-[var(--bg-secondary)] text-[var(--accent-indigo)] border-t border-x border-[var(--border-color)]' : 'text-[var(--text-muted)] hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'overview' && (
              <div className="space-y-3 text-xs">
                {/* ── Update Available Notification Banner ── */}
                {details?.updateAvailable && (
                  <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/10 to-transparent p-3 flex items-center justify-between gap-3 flex-wrap shadow-[0_0_20px_rgba(16,185,129,0.12)] animate-in fade-in duration-200">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                        <ArrowUpCircle size={17} className="animate-bounce" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs flex items-center gap-2">
                          <span>Update available for {agent.name}</span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            {details.version || 'installed'} → v{details.latestVersion}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          One-click update pulls the newest release, upgrades packages, and restarts the gateway without losing settings.
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={updateAgent}
                      disabled={!!busyMsg}
                      className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/25 transition cursor-pointer"
                    >
                      <ArrowUpCircle size={13} /> One-Click Update
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[['Version', details.version || '—'], ['Model', details.model || '—'], ['Service', details.service || '—'], ['Skills', String((details.skills || []).length)]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-black/30 border border-[var(--border-color)] px-3 py-2 relative">
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)]">{k}</div>
                        {k === 'Version' && details?.updateAvailable && (
                          <span className="flex items-center gap-1 text-[8px] font-bold text-emerald-400 uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            update
                          </span>
                        )}
                        {k === 'Version' && !details?.updateAvailable && details?.version && details?.version !== '—' && (
                          <span className="flex items-center gap-1 text-[8px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            <Check size={8} className="text-emerald-400" />
                            up to date
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold mt-0.5 truncate flex items-center gap-1.5" title={txt(v)}>
                        <span>{txt(v)}</span>
                        {k === 'Version' && details?.updateAvailable && details?.latestVersion && (
                          <span className="text-[9px] font-normal text-emerald-400 shrink-0">→ v{details.latestVersion}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <button
                    onClick={() => setCredsExpanded(v => !v)}
                    className="w-full flex items-center justify-between gap-2 group mb-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)]">
                        Configured credentials
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-[9px] font-bold">
                        {(details.envKeys || []).length}
                      </span>
                    </div>
                    <span className="text-[var(--text-muted)] group-hover:text-white transition">
                      {credsExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </span>
                  </button>
                  {credsExpanded && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(details.envKeys || []).map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-mono">{k}</span>)}
                      {(details.envKeys || []).length === 0 && <span className="text-[10px] text-[var(--text-muted)]">none yet — use the install wizard to add API keys / messenger tokens</span>}
                    </div>
                  )}
                  {!credsExpanded && (details.envKeys || []).length === 0 && (
                    <span className="text-[10px] text-[var(--text-muted)]">none yet — use the install wizard to add API keys / messenger tokens</span>
                  )}
                </div>

                {/* ── Maintenance row — settings, watchdog, uninstall (kept near the top for clarity) ── */}
                <div className="rounded-xl border border-[var(--border-color)] bg-black/20 p-2.5 flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer select-none" title="Watches the gateway process and restarts it automatically if it crashes">
                    <input type="checkbox" checked={autoHeal} onChange={e => setAutoHeal(e.target.checked)} className="accent-emerald-500" />
                    <Zap size={10} className="text-emerald-400" /> Auto-restart (watchdog){activeInstance ? ` · ${activeInstance}` : ' · default'}
                  </label>
                  <span className="flex-1" />
                  <button
                    onClick={details?.updateAvailable || !(details?.version && details?.version !== '—') ? updateAgent : undefined}
                    disabled={!!busyMsg || (details?.version && details?.version !== '—' && !details?.updateAvailable)}
                    title={
                      details?.updateAvailable
                        ? `Update ${agent.name} to v${details.latestVersion} (1-click)`
                        : details?.version && details?.version !== '—'
                        ? `${agent.name} is up to date (v${details.version})`
                        : `Update ${agent.name} runtime and restart gateway`
                    }
                    className={`${btn} ${
                      details?.updateAvailable
                        ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : details?.version && details?.version !== '—'
                        ? 'bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/20 cursor-default opacity-80'
                        : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 hover:text-white'
                    } !py-1 !px-2.5 flex items-center gap-1.5`}
                  >
                    {details?.updateAvailable ? (
                      <>
                        <ArrowUpCircle size={11} className="text-emerald-400 animate-pulse" />
                        <span>Update to v{details.latestVersion}</span>
                      </>
                    ) : details?.version && details?.version !== '—' ? (
                      <>
                        <CheckCircle2 size={11} className="text-emerald-400" />
                        <span>Up to date</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpCircle size={11} className="text-emerald-400" />
                        <span>Update</span>
                      </>
                    )}
                  </button>
                  <button onClick={() => setShowWizard(true)} title="Update settings (API key, model, endpoints)" className={`${btn} bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 !py-1 !px-2.5`}>
                    <Settings2 size={11} /> Reconfigure
                  </button>
                  <button onClick={uninstall} disabled={!!busyMsg} title={`Uninstall ${agent.name}${activeInstance ? ` (deletes instance "${activeInstance}" incl. config, memories & sessions)` : ' — removes the agent runtime from this server'}`} className={`${btn} text-red-400/70 hover:text-red-300 hover:bg-red-500/10 !py-1 !px-2 border border-transparent hover:border-red-500/30`}>
                    <Trash2 size={11} />{activeInstance ? ` Remove "${activeInstance}"` : ' Uninstall'}
                  </button>
                </div>
                {/* ── Web UI quick-launch card (for agents with a built-in web interface) ── */}
                {details?.hasWebUI && (
                  <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                        <MonitorSmartphone size={16} />
                      </div>
                      <div>
                        {/* No separate status pill — the Start button to the
                            right carries the running/stopped state instead. */}
                        <div className="font-bold text-white text-xs flex items-center gap-2 flex-wrap">
                          <span>Web UI</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">:{details.webUIPort}</span>
                          {relayInfo?.connected ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-pink-500/15 text-pink-300 border border-pink-500/30 shadow-[0_0_8px_rgba(236,72,153,0.2)]" title="Direct local tunnel active: chat and UI stream directly with 0ms server latency">
                              <Cable size={10} className="text-pink-400" /> Local Relay Active (0ms)
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Central WebSocket proxy is disabled due to known protocol & chat bugs. Local Relay is required.">
                              <ShieldOff size={10} className="text-amber-400" /> Local Relay Required
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {agent.name} built-in web interface — chat, sessions, skills, cron and logs in your browser.
                          {relayInfo?.connected
                            ? ' ⚡ Direct mode: Served straight from your Local Relay (http://127.0.0.1:18791) with zero server hops.'
                            : ' ⚠️ Local Relay required: Central WebSocket proxy is disabled to eliminate chat bugs. Run Local Relay on your computer to open Web UI directly.'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {WEBUI_START_AGENTS.includes(agent.id) && (
                        <button
                          data-start-webui-btn
                          onClick={handleStartWebUI}
                          // Blocked while already running (nothing to start) and
                          // while a start is in flight (avoid double-launch).
                          // webUIActive reflects the Web UI port itself, NOT the
                          // gateway process — they are separate processes.
                          disabled={startingWebUI || !!details?.webUIActive}
                          className={
                            details?.webUIActive
                              ? 'px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 font-bold text-xs flex items-center gap-1.5 border border-emerald-500/30 cursor-default'
                              : 'px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 font-bold text-xs flex items-center gap-1.5 border border-amber-500/30 transition cursor-pointer disabled:opacity-50'
                          }
                          title={
                            details?.webUIActive
                              ? `Web UI is already running on port ${details.webUIPort}`
                              : `Start the ${agent.name} Web UI process on port ${webUIPort()}`
                          }
                        >
                          {details?.webUIActive ? (
                            <><CheckCircle2 size={12} /> Running</>
                          ) : startingWebUI ? (
                            <><Loader2 size={11} className="animate-spin" /> Starting…</>
                          ) : (
                            <><span>⚡</span> Start Web UI</>
                          )}
                        </button>
                      )}
                      {WEBUI_START_AGENTS.includes(agent.id) && details?.webUIActive && (
                        <button
                          data-stop-webui-btn
                          onClick={handleStopWebUI}
                          disabled={stoppingWebUI || !!busyMsg}
                          className="px-3 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200 font-bold text-xs flex items-center gap-1.5 border border-red-500/30 transition cursor-pointer disabled:opacity-50"
                          title={`Stop the ${agent.name} Web UI process listening on port ${webUIPort()}`}
                        >
                          {stoppingWebUI ? (
                            <><Loader2 size={11} className="animate-spin" /> Stopping…</>
                          ) : (
                            <><Square size={10} /> Stop</>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => openWebUIInTab()}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 border transition cursor-pointer ${
                          relayInfo?.connected
                            ? 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 hover:text-sky-200 border-sky-500/30'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border-amber-500/30'
                        }`}
                        title={relayInfo?.connected ? "Open directly via Local Relay (http://127.0.0.1:18791)" : "Local Relay is required for Web UI"}
                      >
                        {relayInfo?.connected ? (
                          <><ExternalLink size={12} /> Open in New Tab</>
                        ) : (
                          <><Cable size={12} /> Local Relay Required</>
                        )}
                      </button>
                      {/* "Via server" only makes sense for a Web UI bound to
                          LOOPBACK (127.0.0.1) on the target server — that is
                          exactly what the proxy dials over SSH. When the UI is
                          exposed on a public interface the browser reaches it
                          directly and the button is hidden. details.webUILoopback
                          comes from the ss/netstat probe in the agent's details
                          action (nanobot + hermes routes). */}
                      {details?.webUILoopback && (
                        <button
                          onClick={openWebUIViaServer}
                          disabled={!target}
                          className="px-3 py-1.5 rounded-xl bg-slate-500/15 hover:bg-slate-500/25 text-slate-200 hover:text-white font-bold text-xs flex items-center gap-1.5 border border-slate-400/30 transition cursor-pointer disabled:opacity-50"
                          title="Open through the monitor server (same-origin proxy) — works from any device"
                        >
                          <ServerIcon size={12} /> Via server
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* ── Pairing & Access Approval Card ── */}{agent.id === 'zeroclaw' ? (

                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm">🔑</div>
                        <div>
                          <div className="font-bold text-white text-xs">Pairing &amp; User Access</div>
                          <div className="text-[10px] text-[var(--text-muted)]">ZeroClaw has two separate pairing systems — pick the one for how you connect.</div>
                        </div>
                      </div>
                      <button onClick={fetchPairings} className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-[var(--text-muted)] border border-[var(--border-color)] flex items-center gap-1 cursor-pointer transition"><RotateCw size={10} /> Refresh</button>
                    </div>

                    <div className="rounded-lg bg-black/30 border border-teal-500/30 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-teal-500/20 text-teal-300 flex items-center justify-center text-[10px]">✉</span><span className="text-[10px] font-bold text-teal-300">System A — Chat in Telegram</span></div>
                      <p className="text-[10px] text-[var(--text-muted)]">Use the bot in Telegram. First time you message it, the bot replies with a <b>one-time bind code</b>.</p>
                      <div className="flex items-center gap-2 mt-1">
                        {zcBindCode ? (
                        <code className="flex-1 bg-black/50 border border-teal-500/20 rounded px-2 py-1 text-[10px] font-mono text-teal-200">/bind <span className="text-white">{zcBindCode}</span></code>
                      ) : (
                        <code className="flex-1 bg-black/50 border border-teal-500/20 rounded px-2 py-1 text-[10px] font-mono text-[var(--text-muted)]">message the bot first — bind code will appear here</code>
                      )}
                        <span className="text-[9px] text-[var(--text-muted)]">type this in Telegram yourself</span>
                      </div>
                    </div>

                    <div className="rounded-lg bg-black/30 border border-indigo-500/30 p-3 space-y-2">
                      <div className="flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px]">🖥</span><span className="text-[10px] font-bold text-indigo-300">System B — Dashboard / API access</span></div>
                      <p className="text-[10px] text-[var(--text-muted)]">For the web dashboard (127.0.0.1:42617) or API clients. Approve a 6-digit gateway code here.</p>
                      {pendingPairings.filter(p => p.platform === 'gateway').length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {pendingPairings.filter(p => p.platform === 'gateway').map((p, idx) => (
                            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-xs">
                              <span className="font-mono font-bold text-white tracking-wider">{p.code}</span>
                              <button onClick={() => handleApprovePairing(p.code, 'gateway')} disabled={pairingLoading || !!busyMsg} className="px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-[10px] transition cursor-pointer flex items-center gap-1"><Check size={10} /> Approve</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[9px] text-[var(--text-muted)]">No gateway code pending right now. Refresh to scan.</div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <input type="text" inputMode="numeric" placeholder="6-digit gateway code (dashboard/API)" value={zcManualCode} onChange={e => { const v = e.target.value.replace(/\D/g, ''); setZcManualCode(v); }} onKeyDown={e => { if (e.key === 'Enter' && zcManualCode.trim()) handleZcGatewayPairing(); }} className="flex-1 bg-black/40 border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-[var(--text-muted)] font-mono focus:outline-none focus:border-indigo-400" />
                        <button onClick={handleZcGatewayPairing} disabled={!zcManualCode.trim() || pairingLoading || !!busyMsg} className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white !py-1.5 !px-3 font-bold disabled:opacity-40 disabled:cursor-not-allowed`}>
                          {pairingLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                        </button>
                      </div>
                    </div>

                    {PAIRING_UI[agent.id]?.revoke && (
  <div className="rounded-lg bg-black/40 border border-red-500/25 p-3 space-y-2.5">
    <div className="text-[10px] font-bold text-red-300 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5"><ShieldOff size={11} /> Revoke / Deactivate access</span>
      <span className="text-[9px] text-[var(--text-muted)] font-normal">paired tokens: {pairedTokens ?? '—'}</span>
    </div>

    {/* Tabs: Devices | Telegram */}
    <div className="flex gap-1 bg-black/30 rounded-lg p-0.5">
      <button
        onClick={() => setZcRevokeTab('device')}
        className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition cursor-pointer ${zcRevokeTab === 'device' ? 'bg-red-500/25 text-red-200' : 'text-[var(--text-muted)] hover:text-white'}`}
      >Devices (dashboard/API)</button>
      <button
        onClick={() => setZcRevokeTab('telegram')}
        className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition cursor-pointer ${zcRevokeTab === 'telegram' ? 'bg-red-500/25 text-red-200' : 'text-[var(--text-muted)] hover:text-white'}`}
      >Telegram users ({zcTgUsers.length})</button>
    </div>

    {zcRevokeTab === 'device' && (
      <div className="space-y-2">
        <p className="text-[9px] text-[var(--text-muted)]">Gateway bearer tokens (web dashboard / API). Revoking forces every client to re-pair.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { if (confirm('Revoke ALL paired devices? Every client must re-pair.')) revokePairing('all'); }} disabled={pairingLoading || !!busyMsg} className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold border border-red-500/30 transition cursor-pointer" title="Revoke all devices">
            <RotateCw size={10} /> All
          </button>
          <div className="flex items-center gap-1 flex-1 min-w-[160px]">
            <input value={pairingRevokeDevice} onChange={e => setPairingRevokeDevice(e.target.value)} placeholder="device ID (optional)" disabled={pairingLoading || !!busyMsg} className="flex-1 bg-black/40 border border-[var(--border-color)] rounded px-2 py-1 text-[10px] text-white placeholder:text-[var(--text-muted)] font-mono focus:outline-none focus:border-red-400" />
            <button onClick={() => { if (!pairingRevokeDevice.trim()) { setNotice({ ok: false, text: 'Enter a device ID, or use Revoke All.' }); return; } revokePairing('device'); }} disabled={pairingLoading || !!busyMsg} className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold border border-red-500/30 transition cursor-pointer" title="Revoke specific device">
              Device
            </button>
          </div>
        </div>
      </div>
    )}

    {zcRevokeTab === 'telegram' && (
      <div className="space-y-2">
        <p className="text-[9px] text-[var(--text-muted)]">Accounts allowed to message the bot. Remove one to have it ignored.</p>
        {zcTgUsers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {zcTgUsers.map((uid, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/25 text-[10px]">
                <span className="font-mono text-red-200">{uid}</span>
                <button
                  onClick={() => { if (confirm('Remove Telegram user ' + uid + '? The bot will ignore their messages.')) revokePairing('remove-tg', uid); }}
                  disabled={pairingLoading || !!busyMsg}
                  className="text-red-400 hover:text-white font-bold transition cursor-pointer"
                  title="Remove from allow-list"
                ><X size={10} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[9px] text-[var(--text-muted)]">No Telegram users — the bot uses /bind pairing instead.</div>
        )}
      </div>
    )}
  </div>
)}

<p className="text-[9px] text-[var(--text-muted)]">Only the system you use matters. Telegram chat = /bind. Dashboard/API = approve a gateway code.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm">🔑</div>
                        <div>
                          <div className="font-bold text-white text-xs">Pairing &amp; User Access Approval</div>
                          <div className="text-[10px] text-[var(--text-muted)]">Approve Telegram, Discord, LINE or Slack user pairing codes without using SSH</div>
                        </div>
                      </div>
                      <button onClick={fetchPairings} className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] flex items-center gap-1 cursor-pointer transition"><RotateCw size={10} /> Scan Pending Requests</button>
                    </div>

                    {/* Only agents that gate their Web UI behind a bootstrap
                        secret (nanobot) have anything to show here. Hermes
                        injects its own session token into the served page and
                        disables auth on a loopback bind, so there is no code
                        to copy — suppress the card entirely. */}
                    {details?.hasWebUI && extractWebUISecret(details?.webUIBootstrapPath) && (
                      <div className="rounded-lg bg-black/30 border border-sky-500/30 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-300 flex items-center justify-center text-[10px]">🌐</span>
                          <span className="text-[10px] font-bold text-sky-300">Web UI pairing code (browser workbench)</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          The Web UI asks for a bootstrap secret the first time it pairs a browser. Copy this code and paste it into the workbench&apos;s pair prompt — or just open the Web UI from the app, which applies it automatically.
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-black/50 border border-sky-500/20 rounded px-2 py-1 text-[10px] font-mono text-sky-200 break-all min-w-0">{extractWebUISecret(details.webUIBootstrapPath)}</code>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const s = extractWebUISecret(details.webUIBootstrapPath);
                              if (s) {
                                navigator.clipboard.writeText(s).catch(() => {});
                                setNotice({ ok: true, text: 'WebUI bootstrap secret copied' });
                              }
                            }}
                            className="px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[10px] font-bold border border-sky-500/30 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                            title="Copy bootstrap secret"
                          >
                            <Copy size={10} /> Copy
                          </button>
                        </div>
                        <p className="text-[9px] text-sky-400/60 font-mono break-all">{details.webUIBootstrapPath}</p>
                      </div>
                    )}

                    {pendingPairings.length > 0 && (
                      <div className="rounded-lg bg-black/40 border border-indigo-500/30 p-2.5 space-y-2">
                        <div className="text-[10px] font-bold text-indigo-300 flex items-center gap-1.5"><Sparkles size={11} className="text-amber-400 animate-pulse" /> Pending pairing request(s) detected:</div>
                        <div className="flex flex-wrap gap-2">
                          {pendingPairings.map((p, idx) => (
                            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-xs">
                              <span className="font-mono font-bold text-white tracking-wider">{p.code}</span>
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-200 font-bold">{p.platform}</span>
                              <button onClick={() => handleApprovePairing(p.code, p.platform)} disabled={pairingLoading || !!busyMsg} className="px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-[10px] transition cursor-pointer flex items-center gap-1"><Check size={10} /> Approve</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1">
                      <div className="w-32 shrink-0">
                        <ThemeSelect value={pairingPlatform} onChange={setPairingPlatform} options={(PAIRING_UI[agent.id]?.platforms || ['telegram', 'discord', 'line', 'slack', 'auto']).map(v => ({ value: v, label: v === 'auto' ? 'Auto (any)' : v.charAt(0).toUpperCase() + v.slice(1) }))} size="xs" className="w-full" />
                      </div>
                      <div className="relative flex-1 min-w-[160px]">
                        <input type="text" inputMode={PAIRING_UI[agent.id]?.numericOnly ? 'numeric' : 'text'} placeholder={PAIRING_UI[agent.id]?.placeholder || 'Enter pairing code'} value={pairingCode} onChange={e => setPairingCode(PAIRING_UI[agent.id]?.numericOnly ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter' && pairingCode.trim()) handleApprovePairing(); }} className="w-full bg-black/40 border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-[var(--text-muted)] font-mono tracking-wider focus:outline-none focus:border-indigo-400" />
                      </div>
                      <button onClick={() => handleApprovePairing()} disabled={!pairingCode.trim() || pairingLoading || !!busyMsg} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-white !py-1.5 !px-3.5 font-bold disabled:opacity-40 disabled:cursor-not-allowed`}>
                        {pairingLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Approve Code
                      </button>
                    </div>
                    {PAIRING_UI[agent.id]?.hint && <p className="text-[9px] text-[var(--text-muted)]">{PAIRING_UI[agent.id].hint}</p>}
                  </div>
                )}

              </div>
            )}

            {tab === 'logs' && (
              <div className="space-y-2">
                {/* Streaming status bar */}
                <div className="flex items-center justify-between gap-2 flex-wrap bg-black/30 p-2.5 rounded-xl border border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    {relayInfo?.connected ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-pink-500/15 text-pink-300 border border-pink-500/30 shadow-[0_0_12px_rgba(236,72,153,0.2)]">
                        <Cable size={11} className="text-pink-400" /> Local Relay (Zero Server Hop)
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                        <Radio size={11} className="animate-pulse text-emerald-400" /> Live Agent Stream
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">
                      {logPause ? 'Stream paused' : `Auto-refreshing ~/.${agentId}${activeInstance ? `-${activeInstance}` : ''}/logs/ every 5s`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setLogPause(p => !p)}
                      className={`${btn} ${logPause ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white'} !py-1 !px-2`}
                    >
                      {logPause ? <Play size={10} /> : <Square size={10} />}
                      {logPause ? 'Resume Stream' : 'Pause'}
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(agent.api, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ connectionId: target, action: 'logs', config: { lines: 300 } }),
                          });
                          const r = await res.json();
                          if (r?.data) {
                            setLogText(cleanLogStream(r.data).slice(-100000));
                            setNotice({ ok: true, text: 'Logs refreshed' });
                          }
                        } catch {}
                      }}
                      className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}
                      title="Force refresh logs"
                    >
                      <RefreshCw size={10} /> Refresh
                    </button>
                    <button
                      onClick={() => setLogText('')}
                      className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}
                      title="Clear log buffer"
                    >
                      <Trash2 size={10} /> Clear
                    </button>
                    <button
                      onClick={() => {
                        if (logText) {
                          navigator.clipboard.writeText(logText);
                          setNotice({ ok: true, text: 'Logs copied to clipboard' });
                        }
                      }}
                      className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}
                      title="Copy all logs"
                    >
                      <Copy size={10} /> Copy
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    value={logSearch}
                    onChange={e => { setLogSearch(e.target.value); setLogNav(0); }}
                    placeholder="Search live log (e.g. error, gateway, websocket)…"
                    className={`${inputCls} flex-1 !py-1.5 font-mono`}
                  />
                  {logSearch.trim() && (
                    <>
                      <span className="text-[10px] font-bold text-indigo-300 whitespace-nowrap">
                        {logMatches.length ? `${logNav + 1}/${logMatches.length}` : '0 found'}
                      </span>
                      <button onClick={() => navLog(-1)} disabled={!logMatches.length} className={`${btn} bg-white/5 border border-[var(--border-color)] !py-1 !px-2`}>↑</button>
                      <button onClick={() => navLog(1)} disabled={!logMatches.length} className={`${btn} bg-white/5 border border-[var(--border-color)] !py-1 !px-2`}>↓</button>
                    </>
                  )}
                </div>

                <pre
                  ref={logPreRef}
                  className="bg-black/50 rounded-xl p-3.5 text-[10px] font-mono whitespace-pre-wrap h-84 overflow-y-auto text-emerald-200/90 border border-[var(--border-color)] selection:bg-indigo-500/30"
                >
                  {(() => {
                    const q = logSearch.trim().toLowerCase();
                    if (!logText) return (
                      <span className="text-[var(--text-muted)] italic flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin text-indigo-400" />
                        Listening for live output from {agent.name} gateway…
                      </span>
                    );
                    if (!q) return logText.slice(-30000);
                    return logText.split('\n').map((l, i) => {
                      const isMatch = l.toLowerCase().includes(q);
                      const isCur = isMatch && logLineIdx[logNav % Math.max(logLineIdx.length, 1)] === i;
                      return (
                        <div
                          key={i}
                          id={`log-line-${i}`}
                          className={isCur ? 'bg-indigo-500/40 rounded px-1' : isMatch ? 'bg-amber-500/15 rounded px-1' : ''}
                        >
                          {highlightText(l, logSearch)}
                        </div>
                      );
                    });
                  })()}
                </pre>

                {health?.errorCount > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-2">
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-400 shrink-0" />
                        <span>{health.errorCount} recent ERROR line(s) detected in gateway log</span>
                      </span>
                      {health.telegram === 'error' && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-200 border border-red-500/30">
                          Telegram Conflict / Auth Error
                        </span>
                      )}
                    </div>
                    {health.recentErrors && health.recentErrors.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-black/50 border border-red-500/20 font-mono text-[10px] text-red-200/90 whitespace-pre-wrap max-h-36 overflow-y-auto space-y-1">
                        {health.recentErrors.map((errLine, idx) => (
                          <div key={idx} className="leading-relaxed border-b border-red-500/10 last:border-0 pb-1 last:pb-0">{errLine}</div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                      <span className="text-[10px] text-red-300/70">Check credentials or restart the gateway to clear conflicts.</span>
                      <button
                        onClick={() => gatewayOp('restart')}
                        disabled={!!busyMsg}
                        className={`${btn} bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/30 !py-1 !px-2 ml-auto`}
                      >
                        <RotateCw size={10} /> Restart Gateway
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'config' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">
                    {agent.id === 'hermes' ? `${instHome(activeInstance)}/config.yaml` : agent.id === 'nanobot' ? `${instHome(activeInstance)}/config.json` : agent.id === 'openclaw' ? `${instHome(activeInstance)}/config.json` : agent.id === 'zeroclaw' ? `${instHome(activeInstance)}/config.toml` : `~/.${agent.id}/config`}
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                    <input type="checkbox" checked={restartAfterSave} onChange={e => setRestartAfterSave(e.target.checked)} className="accent-indigo-500" />
                    restart gateway after save
                  </label>
                </div>
                <div className="flex items-center gap-2 flex-wrap"><input value={cfgSearch} onChange={e => { setCfgSearch(e.target.value); setCfgNav(0); }} placeholder="Search config.." className={`${inputCls} flex-1 !py-1.5 font-mono`} />
          {cfgSearch.trim() && (<><span className="text-[10px] font-bold text-indigo-300">{cfgOccurrences.length ? cfgNav + 1 + "/" + cfgOccurrences.length : "0 found"}</span><button onClick={() => gotoCfg(-1)} disabled={!cfgOccurrences.length} className={`${btn} bg-white/5 border border-[var(--border-color)] !py-1 !px-2`}>Up</button><button onClick={() => gotoCfg(1)} disabled={!cfgOccurrences.length} className={`${btn} bg-white/5 border border-[var(--border-color)] !py-1 !px-2`}>Down</button></>)}</div>
                <textarea className={`${inputCls} font-mono h-72`} value={yamlDraft} onChange={e => setYamlDraft(e.target.value)} spellCheck={false} />
                {cfgSearch.trim() && (
                  <div className="rounded-lg bg-black/40 border border-[var(--border-color)] p-2 max-h-32 overflow-y-auto text-[10px] font-mono">
                    {yamlDraft.split('\n').map((l, i) => ({ l, i })).filter(x => x.l.toLowerCase().includes(cfgSearch.toLowerCase()))
                      .map(x => <div key={x.i} className={x.i + 1 === curLineNo ? 'bg-indigo-500/30 rounded text-indigo-200' : 'text-emerald-300/90'}>{x.i + 1}: {x.l || ' '}</div>)}
                  </div>
                )}
                <button onClick={saveConfig} disabled={!!busyMsg || !yamlDraft.trim()} className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white`}>
                  {busyMsg.startsWith('Save') ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Save {agent.id === 'hermes' ? 'config.yaml' : agent.id === 'zeroclaw' ? 'config.toml' : 'config.json'}
                </button>
                <p className="text-[9px] text-[var(--text-muted)]">A timestamped backup is kept automatically. If a saved config breaks the gateway, the previous one is restored for you.</p>
                {backups.length > 0 && (
                  <div className="rounded-lg border border-[var(--border-color)] bg-black/20 p-2.5">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)] mb-1.5">Restore a backup</div>
                    <ThemeSelect
                      value=""
                      onChange={(n) => {
                        if (n) act(`Restore ${n}`, () => call('restore-backup', { config: { name: n } }));
                      }}
                      options={backups.map(b => ({
                        value: b.name,
                        label: `${b.name} — ${b.date} (${Math.round(b.size / 1024)} KB)`
                      }))}
                      placeholder="Select backup…"
                      size="xs"
                      className="mt-1"
                    />
                  </div>
                )}
              </div>
            )}

            {tab === 'env' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">
                    {agent.id === 'hermes' ? `${instHome(activeInstance)}/.env` : agent.id === 'nanobot' ? `${instHome(activeInstance)}/.env` : agent.id === 'openclaw' ? `${instHome(activeInstance)}/.env` : agent.id === 'zeroclaw' ? `${instHome(activeInstance)}/.env` : `~/.${agent.id}/.env`}
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                    <input type="checkbox" checked={restartAfterSave} onChange={e => setRestartAfterSave(e.target.checked)} className="accent-indigo-500" />
                    restart gateway after save
                  </label>
                </div>
                <p className="text-[9px] text-[var(--text-muted)]">Environment keys & values loaded directly from <span className="font-mono">{instHome(activeInstance)}/.env</span>. Edit any value and save to apply immediately.</p>
                <div className="space-y-1.5">
                  {envDraft.map((r, i) => (
                    <div key={r.key} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono w-48 truncate text-[var(--text-primary)] font-semibold">{r.key}</span>
                      <input
                        type={r.masked ? 'password' : 'text'}
                        value={r.value ?? ''}
                        onChange={e => setEnvDraft(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                        className={`${inputCls} !py-1.5 font-mono flex-1`}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        onClick={() => setEnvDraft(prev => prev.map((x, j) => j === i ? { ...x, masked: !x.masked } : x))}
                        className={`${btn} bg-white/5 text-[var(--text-muted)] hover:text-white !py-1 !px-2`}
                        title={r.masked ? "Show plain text" : "Hide plain text"}
                      >
                        {r.masked ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button
                        onClick={() => setEnvDraft(prev => prev.filter((_, j) => j !== i))}
                        className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20 !py-1 !px-2`}
                        title="Remove this key from the list"
                      ><Trash2 size={10} /></button>
                    </div>
                  ))}
                  {envDraft.length === 0 && (
                    <div className="py-2 space-y-2">
                      <p className="text-[10px] text-[var(--text-muted)] italic">No env keys configured in <span className="font-mono">{instHome(activeInstance)}/.env</span> yet.</p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[9px] text-[var(--text-muted)]">Quick add:</span>
                        {['MODEL', 'OPENROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].map(k => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              if (!envDraft.some(x => x.key === k)) {
                                setEnvDraft(prev => [...prev, { key: k, value: '', masked: false }]);
                              }
                            }}
                            className="px-2 py-0.5 text-[9px] font-mono rounded bg-white/5 hover:bg-white/10 text-indigo-300 border border-indigo-500/20"
                          >
                            + {k}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="NEW_KEY_NAME"
                      value={envNewKey}
                      onChange={e => setEnvNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                      className={`${inputCls} !py-1.5 font-mono flex-1`}
                      spellCheck={false}
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={envNewVal}
                      onChange={e => setEnvNewVal(e.target.value)}
                      className={`${inputCls} !py-1.5 font-mono flex-1`}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <button onClick={saveEnv} disabled={!!busyMsg} className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white`}>
                  {busyMsg === 'Save env' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Save env + restart
                </button>
                <p className="text-[9px] text-[var(--text-muted)]">Saved keys go to <span className="font-mono">{instHome(activeInstance)}/.env</span>. The gateway is restarted (if checked) and the gateway log will reflect the new keys.</p>
              </div>
            )}

            {tab === 'prompt' && (() => {
              const PROMPT_TEMPLATES = [
                {
                  id: 'sysadmin',
                  name: 'DevOps & Linux Sysadmin',
                  icon: '🛠️',
                  desc: 'Specialized in Linux shell, systemd, docker, network diagnostics and server health',
                  prompt: `You are an expert in server operations and Linux system administration.
- Always provide safe, robust, and verified bash commands.
- Explain potential risks before executing high-impact actions (deletions, service stops, firewall changes).
- Format all terminal commands and code in clear code blocks with explanations.
- Proactively check logs and service health statuses when diagnosing issues.`,
                },
                {
                  id: 'fullstack',
                  name: 'Full-Stack Coding Assistant',
                  icon: '💻',
                  desc: 'Clean code architecture, API design, Node.js, Python, and frontend performance',
                  prompt: `You are an expert software development assistant.
- Write clean, modular, maintainable, and type-safe code.
- Prioritize best practices, modern frameworks, and robust error handling.
- Suggest unit tests and security considerations for any code you generate.
- Be direct, structured, and deliver production-ready solutions.`,
                },
                {
                  id: 'concise',
                  name: 'Concise Terminal Operator',
                  icon: '⚡',
                  desc: 'Ultra-fast, direct, minimal fluff, straight to execution commands and results',
                  prompt: `You are a concise, high-efficiency AI terminal assistant.
- Give short, direct answers without unnecessary pleasantries.
- Provide the exact shell commands needed immediately.
- Only explain when explicitly requested or when a command carries data loss risk.`,
                },
                {
                  id: 'security',
                  name: 'Security & Hardening Auditor',
                  icon: '🛡️',
                  desc: 'Audits permissions, SSH security, firewall rules, and vulnerability fixes',
                  prompt: `You are a Cybersecurity & Server Hardening Specialist.
- Always review security implications of commands, open ports, and file permissions.
- Follow the principle of least privilege in all configurations.
- Alert the user immediately if any insecure settings or weak credentials are detected.`,
                },
                {
                  id: 'autonomous',
                  name: 'Autonomous Problem Solver',
                  icon: '🧠',
                  desc: 'Breaks down complex multi-step goals, executes subtasks, and self-verifies',
                  prompt: `You are an autonomous AI problem solver.
- When given a complex goal, break it into clear, logical milestones.
- Execute steps methodically, verify results after each step, and pivot if unexpected errors occur.
- Provide concise progress updates to the user.`,
                },
              ];

              // Per-agent workspace file locations:
              //   hermes   → ~/.hermes/* (custom_instructions.txt for the system prompt)
              //   zeroclaw → ~/.zeroclaw/data/* (0.8.4 workspace; NOT the legacy workspace/ dir)
              //   others   → ~/.<agent>/workspace/*
              const HERMES_PROMPT_PATHS = {
                'PROMPT.md': `${instHome(activeInstance)}/custom_instructions.txt`,
                'SOUL.md': `${instHome(activeInstance)}/SOUL.md`,
                'USER.md': `${instHome(activeInstance)}/USER.md`,
                'AGENTS.md': `${instHome(activeInstance)}/AGENTS.md`,
                'MEMORY.md': `${instHome(activeInstance)}/memories/MEMORY.md`,
              };
              const WS_DIR = agent.id === 'zeroclaw' ? `${instHome(activeInstance)}/data` : `${instHome(activeInstance)}/workspace`;
              const wsPath = (f) => agent.id === 'hermes' ? HERMES_PROMPT_PATHS[f] : `${WS_DIR}/${f}`;

              const WORKSPACE_FILES = [
                {
                  key: 'PROMPT.md',
                  name: 'PROMPT.md',
                  icon: '📜',
                  label: 'System Prompt',
                  desc: 'Core instructions and behavioral rules',
                  path: wsPath('PROMPT.md'),
                },
                {
                  key: 'SOUL.md',
                  name: 'SOUL.md',
                  icon: '🎭',
                  label: 'Personality & Voice',
                  desc: 'Persona identity, tone of voice, empathy, and character traits',
                  path: wsPath('SOUL.md'),
                },
                {
                  key: 'USER.md',
                  name: 'USER.md',
                  icon: '👤',
                  label: 'User Profile',
                  desc: 'User bio, preferences, language style, and background',
                  path: wsPath('USER.md'),
                },
                {
                  key: 'AGENTS.md',
                  name: 'AGENTS.md',
                  icon: '🛡️',
                  label: 'Rules & Safety',
                  desc: 'Operational safety boundaries and constraints',
                  path: wsPath('AGENTS.md'),
                },
                {
                  key: 'MEMORY.md',
                  name: 'MEMORY.md',
                  icon: '🧠',
                  label: 'Long-Term Memory',
                  desc: 'Persistent knowledge notes, facts, and saved context',
                  path: wsPath('MEMORY.md'),
                },
              ];

              const curFileMeta = WORKSPACE_FILES.find(f => f.key === promptActiveFile) || WORKSPACE_FILES[0];
              const words = promptDraft.trim() ? promptDraft.trim().split(/\s+/).length : 0;
              const chars = promptDraft.length;
              const lines = promptDraft ? promptDraft.split('\n').length : 0;

              return (
                <div className="space-y-3">
                  {/* File Selector Tabs */}
                  <div>
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>Personality &amp; Workspace Files</span>
                      <span className="text-[9px] text-indigo-400 font-normal">Click a file to edit</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                      {WORKSPACE_FILES.map(f => {
                        const isActive = promptActiveFile === f.key;
                        const hasContent = !!(promptFilesMap[f.key]?.trim() || (isActive && promptDraft.trim()));
                        return (
                          <button
                            key={f.key}
                            onClick={() => switchPromptFile(f.key)}
                            className={`p-2 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                              isActive
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-white shadow-sm'
                                : 'bg-black/20 border-[var(--border-color)] text-[var(--text-muted)] hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold truncate">
                              <span>{f.icon}</span>
                              <span className={isActive ? 'text-indigo-300' : ''}>{f.name}</span>
                            </div>
                            <div className="text-[9px] truncate mt-1 text-[var(--text-muted)]">{f.label}</div>
                            <div className="mt-1 flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${hasContent ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                              <span className="text-[8px] text-[var(--text-muted)]">{hasContent ? 'Configured' : 'Empty'}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Target File Info & Restart Checkbox */}
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Target Path:</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">{curFileMeta.path}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">({curFileMeta.desc})</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                      <input type="checkbox" checked={restartAfterSave} onChange={e => setRestartAfterSave(e.target.checked)} className="accent-indigo-500" />
                      restart gateway after save
                    </label>
                  </div>

                  {/* Preset Persona Quick Templates (only on PROMPT.md / SOUL.md) */}
                  {(promptActiveFile === 'PROMPT.md' || promptActiveFile === 'SOUL.md') && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                        <span className="flex items-center gap-1"><Sparkles size={11} className="text-indigo-400" /> Quick Persona Templates (1-Click Insert)</span>
                        {promptDraft && (
                          <button
                            onClick={() => setPromptDraft('')}
                            className="text-[9px] text-red-400 hover:text-red-300 cursor-pointer font-normal"
                          >
                            Clear editor
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {PROMPT_TEMPLATES.map(tmpl => (
                          <div
                            key={tmpl.id}
                            onClick={() => setPromptDraft(tmpl.prompt)}
                            className="p-2.5 rounded-xl border border-[var(--border-color)] bg-black/20 hover:border-indigo-400/40 hover:bg-white/5 transition cursor-pointer flex flex-col justify-between group"
                          >
                            <div className="flex items-start gap-2 mb-1.5">
                              <span className="text-lg shrink-0 p-1 rounded bg-white/5">{tmpl.icon}</span>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition truncate">{tmpl.name}</div>
                                <div className="text-[9px] text-[var(--text-muted)] line-clamp-2 mt-0.5 leading-tight">{tmpl.desc}</div>
                              </div>
                            </div>
                            <div className="pt-1.5 border-t border-[var(--border-color)] flex items-center justify-between text-[9px] text-indigo-400 font-bold">
                              <span>Insert template</span>
                              <span>→</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom Prompt Textarea */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                      <span>Editing <b className="text-white">{curFileMeta.name}</b> — {curFileMeta.label}</span>
                      <span>{lines} lines · {words} words · {chars} chars</span>
                    </div>
                    <textarea
                      className={`${inputCls} font-mono h-64 text-xs leading-relaxed`}
                      placeholder={
                        promptActiveFile === 'SOUL.md'
                          ? `# SOUL.md\nDescribe ${agent.name}'s character, voice, and demeanor...\n\nExample:\n- Voice: direct, technical, calm, concise.\n- Identity: an experienced DevOps assistant who values clean code.`
                          : promptActiveFile === 'USER.md'
                          ? `# USER.md\nDescribe yourself and your preferences for ${agent.name}...\n\nExample:\n- Name: Admin\n- Language: English & Thai\n- Style: Provide command lines first, brief explanations after.`
                          : promptActiveFile === 'AGENTS.md'
                          ? `# AGENTS.md\nOperational guidelines & boundaries...\n\nExample:\n- Do not delete production databases without confirmation.\n- Always check disk space before creating backups.`
                          : promptActiveFile === 'MEMORY.md'
                          ? `# MEMORY.md\nLong-term knowledge & context notes...\n\nExample:\n- Server 1: Web server on port 3000\n- Server 2: Postgres cluster`
                          : `Enter system instructions for ${agent.name} here...`
                      }
                      value={promptDraft}
                      onChange={e => setPromptDraft(e.target.value)}
                      spellCheck={false}
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={savePrompt}
                      disabled={!!busyMsg}
                      className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white px-5`}
                    >
                      {busyMsg.startsWith('Save') ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save {curFileMeta.name}
                    </button>
                    <button
                      onClick={() => loadDetails()}
                      disabled={!!busyMsg}
                      className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}
                    >
                      <RotateCw size={11} /> Reload from Server
                    </button>
                  </div>
                  <p className="text-[9px] text-[var(--text-muted)]">
                    Saved directly to <span className="font-mono">{curFileMeta.path}</span>. When saved, the agent gateway is restarted (if checked) to immediately load your updated personality and behavioral rules.
                  </p>
                </div>
              );
            })()}

            {tab === 'skills' && (() => {
              // Universal skills available on every agent via custom skill clone
              const SHARED_SKILLS = [
                { id: 'web-search', name: 'Web Search', cat: 'tools', icon: '🌐', desc: 'Live Google & DuckDuckGo web search with URL extraction', tags: ['search', 'google', 'browse', 'web', 'internet'] },
                { id: 'github-assistant', name: 'GitHub Assistant', cat: 'tools', icon: '🐙', desc: 'Manage repositories, search code, issues & pull requests', tags: ['git', 'github', 'repo', 'code', 'pr'] },
                { id: 'weather', name: 'Weather Forecast', cat: 'tools', icon: '☀️', desc: 'Global live weather forecasts and atmospheric data', tags: ['weather', 'climate', 'temperature', 'forecast'] },
                { id: 'crypto-tracker', name: 'Crypto Tracker', cat: 'tools', icon: '📈', desc: 'Real-time cryptocurrency prices & market data', tags: ['crypto', 'bitcoin', 'eth', 'prices', 'finance'] },
                { id: 'code-interpreter', name: 'Python Code Sandbox', cat: 'tools', icon: '🐍', desc: 'Execute Python scripts in an isolated sandbox environment', tags: ['python', 'code', 'sandbox', 'exec'] },
                { id: 'notion-sync', name: 'Notion Sync', cat: 'tools', icon: '📓', desc: 'Read and update Notion databases and workspaces', tags: ['notion', 'notes', 'docs', 'database'] },
                { id: 'cron-scheduler', name: 'Cron Automation Engine', cat: 'devops', icon: '⏱️', desc: 'Schedule periodic AI background tasks and wake-up jobs', tags: ['cron', 'schedule', 'periodic', 'timer'] },
                { id: 'sql-database', name: 'SQL Query Assistant', cat: 'devops', icon: '🗄️', desc: 'Direct Postgres / MySQL querying, schemas & analysis', tags: ['sql', 'database', 'postgres', 'mysql'] },
                { id: 'arxiv-search', name: 'ArXiv Research Explorer', cat: 'ai', icon: '📚', desc: 'Search and summarize latest academic papers on ArXiv', tags: ['arxiv', 'paper', 'research', 'pdf', 'science'] },
                { id: 'browser-use', name: 'Browser Agent (Playwright)', cat: 'tools', icon: '🧭', desc: 'Autonomous web browsing, form filling, and scraping', tags: ['browser', 'playwright', 'automation', 'dom'] },
              ];

              const CATALOG = {
                hermes: [
                  { id: 'skill-creator', name: 'Skill Creator', cat: 'ai', icon: '✨', desc: 'Auto-create & train new custom skills from plain English', tags: ['create', 'generator', 'ai', 'custom'] },
                  { id: 'web-search', name: 'Web Search', cat: 'tools', icon: '🌐', desc: 'Live Google & DuckDuckGo web search with URL extraction', tags: ['search', 'google', 'browse', 'web', 'internet'] },
                  { id: 'github-assistant', name: 'GitHub Assistant', cat: 'tools', icon: '🐙', desc: 'Manage repositories, search code, issues & pull requests', tags: ['git', 'github', 'repo', 'code', 'pr'] },
                  { id: 'weather', name: 'Weather Forecast', cat: 'tools', icon: '☀️', desc: 'Global live weather forecasts and atmospheric data', tags: ['weather', 'climate', 'temperature', 'forecast'] },
                  { id: 'crypto-tracker', name: 'Crypto Tracker', cat: 'tools', icon: '📈', desc: 'Real-time cryptocurrency metrics, prices & market data', tags: ['crypto', 'bitcoin', 'eth', 'prices', 'finance'] },
                  { id: 'telegram-broadcast', name: 'Telegram Broadcaster', cat: 'channels', icon: '📢', desc: 'Automated multi-chat and channel announcement tools', tags: ['telegram', 'broadcast', 'channel', 'notify'] },
                  { id: 'browser-use', name: 'Browser Agent (Playwright)', cat: 'tools', icon: '🧭', desc: 'Autonomous web browsing, form filling, and scraping', tags: ['browser', 'playwright', 'automation', 'dom'] },
                  { id: 'notion-sync', name: 'Notion Sync', cat: 'tools', icon: '📓', desc: 'Read and update Notion databases and workspaces', tags: ['notion', 'notes', 'docs', 'database'] },
                  { id: 'code-interpreter', name: 'Python Code Sandbox', cat: 'tools', icon: '🐍', desc: 'Execute Python scripts in an isolated sandbox environment', tags: ['python', 'code', 'sandbox', 'exec'] },
                  { id: 'cron-scheduler', name: 'Cron Automation Engine', cat: 'devops', icon: '⏱️', desc: 'Schedule periodic AI background tasks and wake-up jobs', tags: ['cron', 'schedule', 'periodic', 'timer'] },
                  { id: 'arxiv-search', name: 'ArXiv Research Explorer', cat: 'ai', icon: '📚', desc: 'Search and summarize latest academic papers on ArXiv', tags: ['arxiv', 'paper', 'research', 'pdf', 'science'] },
                  { id: 'sql-database', name: 'SQL Query Assistant', cat: 'devops', icon: '🗄️', desc: 'Direct Postgres / MySQL querying, schemas & analysis', tags: ['sql', 'database', 'postgres', 'mysql'] },
                ],
                nanobot: [
                  { id: 'discord', name: 'Discord Gateway', cat: 'channels', icon: '🎮', desc: 'Full Discord server bot, channels, threads & mentions', tags: ['discord', 'chat', 'bot', 'gaming'] },
                  { id: 'slack', name: 'Slack Workspace Bot', cat: 'channels', icon: '💬', desc: 'Real-time workplace channel assistant and DM bot', tags: ['slack', 'workspace', 'work', 'chat'] },
                  { id: 'matrix', name: 'Matrix Encrypted Chat', cat: 'channels', icon: '🔒', desc: 'Decentralized end-to-end encrypted messaging bridge', tags: ['matrix', 'element', 'crypto', 'decentralized'] },
                  { id: 'feishu', name: 'Feishu / Lark Gateway', cat: 'channels', icon: '🕊️', desc: 'Enterprise workplace automation, cards & webhooks', tags: ['feishu', 'lark', 'enterprise', 'bytedance'] },
                  { id: 'email', name: 'Email Gateway (SMTP/IMAP)', cat: 'channels', icon: '✉️', desc: 'Inbound / outbound email processing and drafting', tags: ['email', 'mail', 'smtp', 'imap', 'gmail'] },
                  { id: 'langfuse', name: 'Langfuse Observability', cat: 'ai', icon: '📊', desc: 'Deep LLM trace telemetry, token costs & latency logs', tags: ['langfuse', 'telemetry', 'trace', 'monitoring'] },
                  { id: 'azure', name: 'Azure OpenAI Endpoints', cat: 'ai', icon: '☁️', desc: 'Connect enterprise Microsoft Azure OpenAI deployments', tags: ['azure', 'microsoft', 'openai', 'cloud'] },
                  { id: 'bedrock', name: 'AWS Bedrock Integration', cat: 'ai', icon: '📦', desc: 'Amazon Bedrock Claude, Llama & Titan model support', tags: ['aws', 'amazon', 'bedrock', 'claude'] },
                  { id: 'dingtalk', name: 'DingTalk Channel', cat: 'channels', icon: '📱', desc: 'Alibaba DingTalk enterprise bot & webhook integration', tags: ['dingtalk', 'alibaba', 'enterprise'] },
                  { id: 'whatsapp', name: 'WhatsApp Business API', cat: 'channels', icon: '💬', desc: 'WhatsApp messaging bridge for mobile conversations', tags: ['whatsapp', 'meta', 'phone', 'chat'] },
                  { id: 'signal', name: 'Signal Messenger Bridge', cat: 'channels', icon: '🛡️', desc: 'Private Signal protocol encrypted bot channel', tags: ['signal', 'privacy', 'chat'] },
                  { id: 'olostep', name: 'Olostep Web Scraper', cat: 'tools', icon: '🕷️', desc: 'High-speed anti-bot headless scraping & extraction', tags: ['olostep', 'scrape', 'crawl', 'web'] },
                  { id: 'msteams', name: 'Microsoft Teams Channel', cat: 'channels', icon: '🏢', desc: 'Enterprise Microsoft Teams bot & channel integrations', tags: ['msteams', 'microsoft', 'teams', 'office'] },
                  { id: 'wecom', name: 'WeCom / WeChat Work', cat: 'channels', icon: '💼', desc: 'Tencent WeChat enterprise work assistant gateway', tags: ['wecom', 'wechat', 'tencent', 'work'] },
                  { id: 'weixin', name: 'WeChat Official Account', cat: 'channels', icon: '💬', desc: 'Tencent WeChat public platform messaging channel', tags: ['weixin', 'wechat', 'tencent'] },
                  { id: 'qq', name: 'QQ Channel Gateway', cat: 'channels', icon: '🐧', desc: 'Tencent QQ group bot and channel integration', tags: ['qq', 'tencent', 'bot'] },
                  { id: 'mattermost', name: 'Mattermost Channel', cat: 'channels', icon: '💬', desc: 'Open-source self-hosted Mattermost workspace chat', tags: ['mattermost', 'chat', 'selfhosted'] },
                  { id: 'api', name: 'OpenAI API Server (/v1)', cat: 'ai', icon: '⚡', desc: 'Serve local Nanobot as standard OpenAI-compatible API', tags: ['api', 'openai', 'v1', 'serve', 'http'] },
                  { id: 'napcat', name: 'NapCat OneBot Bridge', cat: 'tools', icon: '🐱', desc: 'OneBot 11 standard protocol bridge for Nanobot', tags: ['napcat', 'onebot', 'qq'] },
                  { id: 'mochat', name: 'Mochat Customer Service', cat: 'channels', icon: '🎧', desc: 'Multi-tenant live customer chat & support dashboard', tags: ['mochat', 'support', 'helpdesk'] },
                ],
                openclaw: [
                  { id: 'filesystem', name: 'Filesystem MCP', cat: 'mcp', icon: '📁', desc: 'Secure local host file reading, writing, and navigation', tags: ['filesystem', 'files', 'disk', 'local'] },
                  { id: 'github', name: 'GitHub MCP', cat: 'mcp', icon: '🐙', desc: 'Repository manipulation, branch ops, PRs & git commits', tags: ['github', 'git', 'repo', 'prs', 'issues'] },
                  { id: 'fetch', name: 'Web Fetch MCP', cat: 'mcp', icon: '🌐', desc: 'High-speed markdown web page extraction & parser', tags: ['fetch', 'web', 'http', 'html', 'scrape'] },
                  { id: 'brave-search', name: 'Brave Search MCP', cat: 'mcp', icon: '🔍', desc: 'Privacy-first global search engine indexing', tags: ['brave', 'search', 'privacy', 'google'] },
                  { id: 'puppeteer', name: 'Puppeteer Browser MCP', cat: 'mcp', icon: '🧭', desc: 'Full headless Chromium browser automation & screenshots', tags: ['puppeteer', 'chrome', 'browser', 'dom'] },
                  { id: 'postgres', name: 'PostgreSQL MCP', cat: 'mcp', icon: '🐘', desc: 'Direct SQL database exploration, queries & migrations', tags: ['postgres', 'database', 'sql', 'query'] },
                  { id: 'memory', name: 'Knowledge Graph Memory MCP', cat: 'ai', icon: '🧠', desc: 'Persistent hierarchical entity & graph memory store', tags: ['memory', 'graph', 'knowledge', 'entities'] },
                  { id: 'slack', name: 'Slack MCP Server', cat: 'mcp', icon: '💬', desc: 'Send messages, listen to channels, and query threads', tags: ['slack', 'mcp', 'chat'] },
                  { id: 'docker', name: 'Docker MCP Server', cat: 'devops', icon: '🐳', desc: 'Inspect containers, view logs, and manage Docker services', tags: ['docker', 'containers', 'devops'] },
                  { id: 'sqlite', name: 'SQLite MCP Server', cat: 'devops', icon: '💾', desc: 'Local embedded database query and manipulation tool', tags: ['sqlite', 'database', 'embedded'] },
                ],
                zeroclaw: [
                  { id: 'cron-monitor', name: 'Cron & Uptime Monitor', cat: 'devops', icon: '⏱️', desc: 'Automated periodic health auditing and status triggers', tags: ['cron', 'uptime', 'monitor', 'schedule'] },
                  { id: 'system-diagnostics', name: 'System Diagnostics SOP', cat: 'devops', icon: '🩺', desc: 'Automated CPU, RAM, disk & IO bottleneck analysis', tags: ['system', 'cpu', 'ram', 'disk', 'audit'] },
                  { id: 'database-backup', name: 'Database Backup SOP', cat: 'devops', icon: '💾', desc: 'Scheduled automated database exports and rotations', tags: ['backup', 'database', 'snapshot', 'cron'] },
                  { id: 'web-scraper', name: 'Web Scraper SOP', cat: 'tools', icon: '🕸️', desc: 'Structured data extraction & headless crawling pipeline', tags: ['scrape', 'crawler', 'web', 'data'] },
                  { id: 'api-health-check', name: 'API Health Alerts', cat: 'devops', icon: '📡', desc: 'HTTP endpoint monitoring with instant webhook alerts', tags: ['api', 'ping', 'alerts', 'http'] },
                  { id: 'docker-prune', name: 'Docker Cleanup SOP', cat: 'devops', icon: '🐳', desc: 'Auto-prune dangling images, builder cache & containers', tags: ['docker', 'cleanup', 'prune', 'disk'] },
                  { id: 'ssl-cert-renewal', name: 'SSL Renewal SOP', cat: 'devops', icon: '🔐', desc: 'Automated Let’s Encrypt Certbot SSL renewal check', tags: ['ssl', 'https', 'certbot', 'security'] },
                  { id: 'log-rotator', name: 'Log Rotation SOP', cat: 'devops', icon: '📜', desc: 'Compress and archive bulky server log files', tags: ['logs', 'rotate', 'compress', 'storage'] },
                ],
              };

              const agentCatalog = CATALOG[agent.id] || CATALOG.hermes;
              const fullCatalog = [...agentCatalog];
              const installedList = details.skills || [];
              // Skills shipped inside the agent package itself. They are real
              // and loaded by the bot, but they live in site-packages — so the
              // remove op (which deletes <home>/workspace/skills/<name>) would
              // silently do nothing. Badge them instead of offering a dead button.
              const bundledSet = new Set((details.bundledSkills || []).map(String));
              const q = skillInput.trim().toLowerCase();

              // Filtered shared skills
              const filteredShared = SHARED_SKILLS.filter(item => {
                const matchesCat = skillCat === 'all' || item.cat === skillCat;
                const matchesQuery = !q || item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.tags.some(t => t.toLowerCase().includes(q));
                return matchesCat && matchesQuery;
              });

              // Filtered presets for grid
              const filteredGrid = fullCatalog.filter(item => {
                const matchesCat = skillCat === 'all' || item.cat === skillCat;
                const matchesQuery = !q || item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.tags.some(t => t.toLowerCase().includes(q));
                return matchesCat && matchesQuery;
              });

              // Autocomplete suggestions from both shared + agent catalog (up to 8)
              const allForSearch = [...SHARED_SKILLS.filter(s => !fullCatalog.find(f => f.id === s.id)), ...fullCatalog];
              const autocompleteMatches = q ? allForSearch.filter(item => {
                return item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.tags.some(t => t.toLowerCase().includes(q));
              }).slice(0, 8) : [];

              const CATEGORIES = [
                { id: 'all', label: 'All', icon: '⚡' },
                { id: 'channels', label: 'Channels', icon: '💬' },
                { id: 'tools', label: 'Tools', icon: '🛠️' },
                { id: 'mcp', label: 'MCP Servers', icon: '🔌' },
                { id: 'devops', label: 'DevOps & SOPs', icon: '⏱️' },
                { id: 'ai', label: 'AI & Cloud', icon: '🧠' },
              ];

              const selectAutocompleteItem = (item) => {
                setSkillInput(item.id);
                setAcOpen(false);
                setAcIndex(-1);
                act(`Install skill ${item.id}`, () => call('skills', { config: { op: 'install', id: item.id } }));
              };

              const handleKeyDown = (e) => {
                if (acOpen && autocompleteMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAcIndex(i => (i + 1) % autocompleteMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAcIndex(i => (i - 1 + autocompleteMatches.length) % autocompleteMatches.length);
                    return;
                  }
                  if (e.key === 'Enter' && acIndex >= 0 && acIndex < autocompleteMatches.length) {
                    e.preventDefault();
                    selectAutocompleteItem(autocompleteMatches[acIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setAcOpen(false);
                    return;
                  }
                }
                if (e.key === 'Enter') {
                  setAcOpen(false);
                  installSkill();
                }
              };

              return (
                <div className="space-y-4">
                  {/* ── For Nanobot: ClawHub Marketplace is at the very top ── */}
                  {agent.id === 'nanobot' && (
                    <div className="rounded-xl border border-[var(--border-color)] bg-black/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[12px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles size={14} className="text-indigo-400" />
                          ClawHub Marketplace
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-normal normal-case tracking-normal">powered by SkillsMP</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Search and install live community skills and tool definitions directly into Nanobot.
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          {hubLoading ? (
                            <Loader2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin pointer-events-none" />
                          ) : (
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                          )}
                          <input
                            className={`${inputCls} !pl-9`}
                            placeholder="Type to search ClawHub skills live… (e.g. weather forecast, crypto price, docker, github)"
                            value={hubQuery}
                            onChange={e => setHubQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && searchHub()}
                          />
                          {hubQuery && (
                            <button
                              onClick={() => { setHubQuery(''); setHubResults([]); setHubSearched(false); }}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-white px-1.5 py-0.5 rounded bg-white/5 cursor-pointer"
                            >
                              esc
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => searchHub()}
                          disabled={hubLoading || !hubQuery.trim()}
                          className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white whitespace-nowrap px-4`}
                        >
                          {hubLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Search
                        </button>
                      </div>

                      {hubError && (
                        <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          {hubError}
                        </div>
                      )}

                      {hubSearched && !hubLoading && hubResults.length === 0 && !hubError && (
                        <div className="text-center py-6 text-[11px] text-[var(--text-muted)]">
                          <Search size={18} className="mx-auto mb-2 opacity-40" />
                          No skills found for &ldquo;{hubQuery}&rdquo;. Try different keywords.
                        </div>
                      )}

                      {hubLoading && (
                        <div className="text-center py-6 text-[11px] text-[var(--text-muted)] flex items-center justify-center gap-2">
                          <Loader2 size={14} className="animate-spin text-indigo-400" /> Searching ClawHub…
                        </div>
                      )}

                      {hubResults.length > 0 && (
                        <div className="rounded-xl border border-[var(--border-color)] bg-black/40 divide-y divide-[var(--border-color)] max-h-80 overflow-y-auto">
                          {hubResults.map(skill => {
                            const isInstalled = (details?.skills || []).some(s => s.toLowerCase().includes((skill.name || skill.id || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')));
                            return (
                              <div key={skill.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-white/[0.02] transition">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xs font-bold text-white">{skill.name}</span>
                                    {isInstalled && <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Installed</span>}
                                    {skill.stars > 0 && <span className="text-[9px] text-amber-400">★ {skill.stars}</span>}
                                    {skill.version && <span className="text-[9px] text-[var(--text-muted)] font-mono">v{skill.version}</span>}
                                  </div>
                                  <div className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">{skill.description || 'No description available.'}</div>
                                </div>
                                <button
                                  onClick={() => installHubSkill(skill)}
                                  disabled={!!busyMsg}
                                  className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer ${
                                    isInstalled ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20' : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                                  }`}
                                >
                                  {isInstalled ? <Check size={10} /> : <Plus size={10} />}
                                  {isInstalled ? 'Reinstall' : 'Install'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Search Bar & Autocomplete (for non-Nanobot agents) */}
                  {agent.id !== 'nanobot' && (
                  <div className="relative" ref={skillSearchBoxRef}>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        <input
                          className={`${inputCls} !pl-9 flex-1`}
                          placeholder={`Search ${agent.name} skills, tools, MCP servers... (e.g. search, discord, github)`}
                          value={skillInput}
                          onChange={e => {
                            setSkillInput(e.target.value);
                            setAcOpen(true);
                            setAcIndex(-1);
                          }}
                          onFocus={() => { if (skillInput.trim()) setAcOpen(true); }}
                          onBlur={() => { setTimeout(() => setAcOpen(false), 200); }}
                          onKeyDown={handleKeyDown}
                        />
                        {skillInput && (
                          <button
                            onClick={() => { setSkillInput(''); setAcOpen(false); }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-white px-1.5 py-0.5 rounded bg-white/5 cursor-pointer"
                          >
                            esc
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => { setAcOpen(false); installSkill(); }}
                        disabled={!!busyMsg || !skillInput.trim()}
                        className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white whitespace-nowrap px-4`}
                      >
                        {busyMsg.startsWith('Install skill') ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Install
                      </button>
                    </div>

                    {/* Live Autocomplete Dropdown Popover */}
                    {acOpen && skillInput.trim().length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl backdrop-blur-xl overflow-hidden max-h-80 overflow-y-auto divide-y divide-[var(--border-color)]">
                        <div className="px-3 py-1.5 bg-black/40 text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)] flex items-center justify-between">
                          <span className="flex items-center gap-1"><Sparkles size={10} className="text-indigo-400" /> Live Autocomplete Suggestions ({autocompleteMatches.length})</span>
                          <span>↑↓ to navigate, Enter to install</span>
                        </div>
                        {autocompleteMatches.map((item, idx) => {
                          const isInstalled = installedList.some(s => s.toLowerCase() === item.id.toLowerCase() || s.toLowerCase().includes(item.id.toLowerCase()));
                          const isFocused = idx === acIndex;
                          return (
                            <div
                              key={item.id}
                              onMouseDown={(e) => { e.preventDefault(); selectAutocompleteItem(item); }}
                              className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition cursor-pointer ${
                                isFocused ? 'bg-indigo-500/20 text-white' : 'hover:bg-white/5'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-base shrink-0 p-1 rounded-md bg-white/5">{item.icon}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-white flex items-center gap-2">
                                    <span>{item.name}</span>
                                    <span className="text-[9px] font-mono text-[var(--text-muted)]">{item.id}</span>
                                    {isInstalled && <span className="text-[8px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-normal">Installed</span>}
                                  </div>
                                  <div className="text-[10px] text-[var(--text-muted)] truncate">{item.desc}</div>
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)] uppercase tracking-wider">{item.cat}</span>
                                <button
                                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); isInstalled ? removeSkill(item.id) : selectAutocompleteItem(item); }}
                                  className={`text-[10px] font-bold px-2 py-1 rounded transition flex items-center gap-1 cursor-pointer ${
                                    isInstalled
                                      ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                                      : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                                  }`}
                                >
                                  {isInstalled ? <Trash2 size={10} /> : <Plus size={10} />}
                                  {isInstalled ? 'Remove' : '1-Click'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {autocompleteMatches.length === 0 && (
                          <div
                            onMouseDown={(e) => { e.preventDefault(); installSkill(); }}
                            className="px-4 py-3 text-xs text-[var(--text-muted)] hover:bg-white/5 cursor-pointer flex items-center justify-between"
                          >
                            <span>Install custom skill: <b className="text-indigo-300 font-mono">&quot;{skillInput}&quot;</b></span>
                            <span className="text-[10px] text-indigo-400 font-bold flex items-center gap-1"><Plus size={10} /> Click to Install</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {/* Category Filter Chips (for non-Nanobot agents) */}
                  {agent.id !== 'nanobot' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CATEGORIES.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSkillCat(c.id)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                          skillCat === c.id
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white'
                        }`}
                      >
                        <span>{c.icon}</span> {c.label}
                      </button>
                    ))}
                  </div>
                  )}

                  {/* Universal Skills (shared across all agents, hidden for Nanobot which uses ClawHub) */}
                  {agent.id !== 'nanobot' && filteredShared.length > 0 && (
                    <div>
                      <button
                        onClick={() => setSharedExpanded(x => !x)}
                        className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)] mb-2 uppercase tracking-wider hover:text-white transition cursor-pointer group"
                      >
                        <span className="flex items-center gap-1.5">
                          <span>🌍</span> Universal Skills
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-normal normal-case tracking-normal">works on all agents</span>
                          <span className="text-[9px] text-[var(--text-muted)] font-normal normal-case">({filteredShared.length})</span>
                        </span>
                        <span className="text-[9px] text-indigo-400 flex items-center gap-1">
                          {sharedExpanded ? '▲ Collapse' : `▼ Show ${filteredShared.length}`}
                        </span>
                      </button>
                      {sharedExpanded && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-1">
                            {(q ? filteredShared : filteredShared.slice(0, 5)).map(preset => {
                              const isInstalled = installedList.some(s => s.toLowerCase() === preset.id.toLowerCase() || s.toLowerCase().includes(preset.id.toLowerCase()));
                              return (
                                <div
                                  key={preset.id}
                                  className={`flex flex-col justify-between p-3 rounded-xl border transition ${
                                    isInstalled
                                      ? 'border-emerald-500/30 bg-emerald-500/5'
                                      : 'border-[var(--border-color)] bg-black/20 hover:border-indigo-400/40 hover:bg-white/5'
                                  }`}
                                >
                                  <div className="flex items-start gap-2.5 mb-2">
                                    <span className="text-xl shrink-0 p-1.5 rounded-lg bg-white/5 border border-[var(--border-color)]">{preset.icon}</span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                        {preset.name}
                                        {isInstalled && <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-normal">Installed</span>}
                                      </div>
                                      <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5 line-clamp-2">{preset.desc}</div>
                                    </div>
                                  </div>
                                  <div className="mt-auto pt-2 border-t border-[var(--border-color)] flex items-center justify-between">
                                    <span className="text-[9px] font-mono text-[var(--text-muted)]">{preset.id}</span>
                                    {isInstalled ? (
                                      <button onClick={() => removeSkill(preset.id)} disabled={!!busyMsg} className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-1 cursor-pointer"><Trash2 size={10} /> Remove</button>
                                    ) : (
                                      <button onClick={() => act(`Install skill ${preset.id}`, () => call('skills', { config: { op: 'install', id: preset.id } }))} disabled={!!busyMsg} className="text-[10px] text-indigo-300 hover:text-indigo-200 font-bold flex items-center gap-1 cursor-pointer"><Plus size={10} /> 1-Click Install</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {!q && filteredShared.length > 5 && (
                            <button onClick={() => {}} className="w-full text-center text-[10px] text-indigo-400 hover:text-indigo-300 py-1 cursor-pointer">
                              + {filteredShared.length - 5} more universal skills
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Agent-Specific Skill Hub Grid (hidden for Nanobot — ClawHub is used instead) */}
                  {agent.id !== 'nanobot' && (
                  <div>
                    <button
                      onClick={() => setCatalogExpanded(x => !x)}
                      className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)] mb-2 uppercase tracking-wider hover:text-white transition cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>⚡</span> {agent.name} Skills Catalog
                        <span className="text-[9px] text-[var(--text-muted)] font-normal normal-case">({filteredGrid.length})</span>
                        {q && <span className="text-indigo-300 text-[10px] font-normal normal-case tracking-normal">· filtered</span>}
                      </span>
                      <span className="text-[9px] text-indigo-400 flex items-center gap-1">
                        {catalogExpanded ? '▲ Collapse' : `▼ Show ${Math.min(filteredGrid.length, 5)} of ${filteredGrid.length}`}
                      </span>
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {(q || catalogExpanded ? filteredGrid : filteredGrid.slice(0, 5)).map(preset => {
                        const isInstalled = installedList.some(s => s.toLowerCase() === preset.id.toLowerCase() || s.toLowerCase().includes(preset.id.toLowerCase()));
                        return (
                          <div
                            key={preset.id}
                            className={`flex flex-col justify-between p-3 rounded-xl border transition ${
                              isInstalled
                                ? 'border-emerald-500/30 bg-emerald-500/5'
                                : 'border-[var(--border-color)] bg-black/20 hover:border-indigo-400/40 hover:bg-white/5'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 mb-2">
                              <span className="text-xl shrink-0 p-1.5 rounded-lg bg-white/5 border border-[var(--border-color)]">{preset.icon}</span>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                  {preset.name}
                                  {isInstalled && <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-normal">Installed</span>}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5 line-clamp-2">{preset.desc}</div>
                              </div>
                            </div>
                            <div className="mt-auto pt-2 border-t border-[var(--border-color)] flex items-center justify-between">
                              <span className="text-[9px] font-mono text-[var(--text-muted)]">{preset.id}</span>
                              {isInstalled ? (
                                <button
                                  onClick={() => removeSkill(preset.id)}
                                  disabled={!!busyMsg}
                                  className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 size={10} /> Remove
                                </button>
                              ) : (
                                <button
                                  onClick={() => act(`Install skill ${preset.id}`, () => call('skills', { config: { op: 'install', id: preset.id } }))}
                                  disabled={!!busyMsg}
                                  className="text-[10px] text-indigo-300 hover:text-indigo-200 font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Plus size={10} /> 1-Click Install
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!q && filteredGrid.length > 5 && (
                      <button
                        onClick={() => setCatalogExpanded(x => !x)}
                        className="w-full mt-2 py-2 rounded-xl border border-dashed border-[var(--border-color)] text-[10px] text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        {catalogExpanded
                          ? <><span>▲</span> Collapse catalog</>
                          : <><span>▼</span> Show all {filteredGrid.length} {agent.name} skills</>
                        }
                      </button>
                    )}
                  </div>

                  )}

                  {/* Installed Skills List */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                        Installed Skills ({installedList.length})
                      </div>
                      {installedList.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelSkills(new Set())} disabled={selSkills.size === 0} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}>Clear</button>
                          <button onClick={() => { const s = new Set(); installedList.forEach(x => selSkills.has(x) || bundledSet.has(x) ? null : s.add(x)); setSelSkills(s); }} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}>Select all</button>
                          {selSkills.size > 0 && (
                            <button onClick={async () => { for (const s of selSkills) await call('skills', { config: { op: 'remove', name: s } }); setSelSkills(new Set()); await loadDetails(); }} disabled={!!busyMsg} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25 !py-1 !px-2`}>
                              <Trash2 size={11} /> Remove ({selSkills.size})
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl divide-y divide-[var(--border-color)] bg-black/20 border border-[var(--border-color)] max-h-72 overflow-y-auto">
                      {installedList.map(s => {
                        const isBuiltIn = bundledSet.has(s);
                        return (
                        <div key={s} className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/[0.02] transition">
                          <input type="checkbox" checked={selSkills.has(s)} disabled={isBuiltIn} onChange={e => { const n = new Set(selSkills); e.target.checked ? n.add(s) : n.delete(s); setSelSkills(n); }} className="accent-indigo-500 disabled:opacity-30" />
                          <Puzzle size={13} className={`shrink-0 ${isBuiltIn ? 'text-[var(--text-muted)]' : 'text-indigo-400'}`} />
                          <span className="text-xs font-mono font-medium text-white truncate flex-1">{s}</span>
                          {isBuiltIn && (
                            <span title="Ships with the agent package — always available, cannot be uninstalled" className="text-[8px] px-1.5 py-0.5 rounded bg-white/10 text-[var(--text-muted)] border border-[var(--border-color)] uppercase tracking-wide shrink-0">built-in</span>
                          )}
                          {agent.id === 'hermes' && (
                            <button onClick={() => act(`Reset skill ${s}`, () => call('skills', { config: { op: 'reset', name: s } }))} disabled={!!busyMsg} className="text-[9px] text-[var(--text-muted)] hover:text-white cursor-pointer px-2 py-1 rounded bg-white/5 border border-[var(--border-color)]">reset</button>
                          )}
                          {!isBuiltIn && (
                            <button onClick={() => removeSkill(s)} disabled={!!busyMsg} title="Uninstall skill" className="p-1 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition"><Trash2 size={13} /></button>
                          )}
                        </div>
                        );
                      })}
                      {installedList.length === 0 && (
                        <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)] space-y-1">
                          <Puzzle size={20} className="mx-auto text-[var(--text-muted)] opacity-50 mb-2" />
                          <div>No extra skills currently active.</div>
                          <div className="text-[10px] text-[var(--text-muted)]">Use the search box above or click <b>1-Click Install</b> on any preset.</div>
                        </div>
                      )}
                    </div>

                    {agent.id === 'hermes' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={() => toggleBundled(true)} disabled={!!busyMsg} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}>Opt out of bundled seeding</button>
                        <button onClick={() => toggleBundled(false)} disabled={!!busyMsg} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}>Re-enable & sync</button>
                      </div>
                    )}
                  </div>

                  {/* ── ClawHub Marketplace Search (for non-Nanobot agents) ── */}
                  {agent.id !== 'nanobot' && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles size={12} className="text-indigo-400" />
                        ClawHub Marketplace
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-normal normal-case tracking-normal">powered by SkillsMP</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mb-3">
                      <div className="relative flex-1">
                        {hubLoading ? (
                          <Loader2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin pointer-events-none" />
                        ) : (
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        )}
                        <input
                          className={`${inputCls} !pl-9`}
                          placeholder="Type to search ClawHub skills live… (e.g. weather forecast, docker monitor)"
                          value={hubQuery}
                          onChange={e => setHubQuery(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && searchHub()}
                        />
                        {hubQuery && (
                          <button
                            onClick={() => { setHubQuery(''); setHubResults([]); setHubSearched(false); }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-white px-1.5 py-0.5 rounded bg-white/5 cursor-pointer"
                          >
                            esc
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => searchHub()}
                        disabled={hubLoading || !hubQuery.trim()}
                        className={`${btn} bg-indigo-500 hover:bg-indigo-400 text-white whitespace-nowrap px-4`}
                      >
                        {hubLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Search
                      </button>
                    </div>

                    {hubError && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
                        {hubError}
                      </div>
                    )}

                    {hubSearched && !hubLoading && hubResults.length === 0 && !hubError && (
                      <div className="text-center py-6 text-[11px] text-[var(--text-muted)]">
                        <Search size={18} className="mx-auto mb-2 opacity-40" />
                        No skills found for &ldquo;{hubQuery}&rdquo;. Try different keywords.
                      </div>
                    )}

                    {hubLoading && (
                      <div className="text-center py-6 text-[11px] text-[var(--text-muted)] flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin text-indigo-400" /> Searching ClawHub…
                      </div>
                    )}

                    {hubResults.length > 0 && (
                      <div className="rounded-xl border border-[var(--border-color)] bg-black/20 divide-y divide-[var(--border-color)] max-h-80 overflow-y-auto">
                        {hubResults.map(skill => {
                          const isInstalled = (details?.skills || []).some(s => s.toLowerCase().includes((skill.name || skill.id || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')));
                          return (
                            <div key={skill.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-white/[0.02] transition">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs font-bold text-white">{skill.name}</span>
                                  {isInstalled && <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Installed</span>}
                                  {skill.stars > 0 && (
                                    <span className="text-[9px] text-amber-400 flex items-center gap-0.5">★ {skill.stars}</span>
                                  )}
                                  {skill.version && (
                                    <span className="text-[9px] text-[var(--text-muted)] font-mono">v{skill.version}</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">{skill.description || 'No description available.'}</div>
                              </div>
                              <button
                                onClick={() => installHubSkill(skill)}
                                disabled={!!busyMsg}
                                className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer ${
                                  isInstalled
                                    ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                                }`}
                              >
                                {isInstalled ? <Check size={10} /> : <Plus size={10} />}
                                {isInstalled ? 'Reinstall' : 'Install'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Busy strip + live log panel.
          The strip shows the current action's label and spinner; the
          expandable panel below reveals the full server-side log so the
          user can see exactly what the install/uninstall script is
          doing. The previous version only had the strip (no log view),
          which made long-running actions look "stuck". */}
      {busyMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl px-4 py-2.5 text-xs">
          <Loader2 size={13} className="animate-spin text-indigo-400" /> {busyMsg}…
        </div>
      )}
      {/* Floating / Draggable Live Log Panel */}
      {liveLogOpen && (
        liveLogMinimized ? (
          <div
            className="fixed bottom-6 right-6 z-[3000] flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[var(--bg-primary)]/95 border border-[var(--border-color)] shadow-2xl backdrop-blur text-xs cursor-pointer hover:border-indigo-500/50 transition-all select-none"
            onClick={() => setLiveLogMinimized(false)}
            title="Click to restore live log window"
          >
            <Terminal size={13} className="text-indigo-400" />
            <span className="font-bold text-white">{liveLogAction || 'Live log'}</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              ({liveLogLines.length} line{liveLogLines.length === 1 ? '' : 's'})
            </span>
            {busyMsg && <Loader2 size={11} className="animate-spin text-amber-400" />}
            <button
              onClick={(e) => { e.stopPropagation(); setLiveLogMinimized(false); }}
              className="p-1 rounded text-[var(--text-muted)] hover:text-white"
              title="Expand window"
            >
              <Maximize2 size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setLiveLogOpen(false); setLiveLogLines([]); setLiveLogAction(''); }}
              className="p-1 rounded text-[var(--text-muted)] hover:text-white"
              title="Close log"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <div
            data-log-panel="true"
            className={`fixed z-[3000] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col transition-all ${
              liveLogMaximized
                ? 'inset-6 w-auto h-auto'
                : 'w-[min(640px,calc(100vw-2rem))]'
            }`}
            style={
              !liveLogMaximized && logPos.x !== null && logPos.y !== null
                ? { left: `${logPos.x}px`, top: `${logPos.y}px` }
                : !liveLogMaximized
                ? { bottom: '4rem', right: '1rem' }
                : {}
            }
          >
            {/* Draggable Titlebar */}
            <div
              onMouseDown={!liveLogMaximized ? handleLogDragStart : undefined}
              className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-black/40 text-[11px] cursor-grab active:cursor-grabbing select-none"
            >
              <GripHorizontal size={13} className="text-[var(--text-muted)] opacity-60" />
              <Terminal size={12} className="text-indigo-400" />
              <span className="font-bold text-white">{liveLogAction || 'Live log'}</span>
              <span className="text-[10px] text-[var(--text-muted)] ml-1">
                ({liveLogLines.length} line{liveLogLines.length === 1 ? '' : 's'})
              </span>
              {busyMsg && <Loader2 size={11} className="animate-spin text-amber-400 ml-1" />}
              
              <div className="ml-auto flex items-center gap-1">
                {/* Minimize button (minimizes to background badge) */}
                <button
                  onClick={() => setLiveLogMinimized(true)}
                  title="Minimize as background badge"
                  className="p-1 rounded text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Minus size={12} />
                </button>
                {/* Maximize toggle */}
                <button
                  onClick={() => setLiveLogMaximized(v => !v)}
                  title={liveLogMaximized ? 'Restore size' : 'Maximize window'}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-colors"
                >
                  {liveLogMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
                {/* Close button */}
                <button
                  onClick={() => { setLiveLogOpen(false); setLiveLogLines([]); setLiveLogAction(''); }}
                  title="Close log"
                  className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Log output stream */}
            <pre
              ref={liveLogBoxRef}
              className={`bg-black/60 text-[10.5px] font-mono leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap break-words p-3.5 overflow-y-auto ${
                liveLogMaximized ? 'flex-1' : 'max-h-80'
              }`}
            >
              {liveLogLines.length ? liveLogLines.join('\n') : '> Initializing live log stream...'}
            </pre>
          </div>
        )
      )}


      <HermesAgentWizard
        isOpen={showWizard}
        onClose={() => { setShowWizard(false); setBusyMsg(''); loadDetails(); setTab('overview'); }}
        connections={connections}
        selectedId={target}
        apiFetch={doFetch}
        agentApi={agent.api}
        agent={{ id: agent.id, name: agent.name, by: agent.by, docsUrl: agent.docs, logo: agent.logo }}
        instance={activeInstance || ''}
        spawnMode={spawnWizardMode}
        onSpawned={(tag) => {
          setSpawnWizardMode(false);
          refreshInstances();
          setInstanceSel(m => ({ ...m, [instKey]: tag }));
          loadDetails();
        }}
        onActionStart={(label) => {
          setLiveLogLines([`> Starting ${label}...`, '> Connecting to remote server...']);
          setLiveLogAction(label);
          setLiveLogOpen(true);
          setLiveLogMinimized(false);
          setBusyMsg(label);
        }}
        onLog={(line) => {
          const parts = String(line).split('\n');
          setLiveLogLines(prev => [...prev, ...parts]);
          const last = parts.filter(Boolean).pop() || '';
          if (last) setBusyMsg(prev => prev ? `${prev.split(' — ')[0]} — ${last.slice(0, 80)}` : last.slice(0, 80));
        }}
        onActionEnd={() => setBusyMsg('')}
      />

      {/* ── Uninstall Confirmation Modal ── */}
      {showUninstallModal && (() => {
        const home = activeInstance
          ? `~/.${agent.id}-${activeInstance}`
          : ('~/' + agent.id);
        return (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
            <div className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-[var(--bg-primary)] shadow-2xl overflow-hidden">
              {/* top accent */}
              <div className="h-1 w-full bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-lg">🗑️</div>
                  <div>
                    <h2 className="text-base font-bold text-white">{activeInstance ? `Delete Instance "${activeInstance}"` : `Uninstall ${agent.name}`}</h2>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {activeInstance ? `This will stop and permanently delete the entire directory ${home}.` : 'Choose how much to remove from the server (default install).'}
                    </p>
                  </div>
                </div>

                {activeInstance ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-[var(--text-muted)] leading-relaxed">
                      This will stop the <span className="font-mono text-white font-bold">{activeInstance}</span> gateway and completely remove <span className="font-mono text-red-400 font-bold">{home}</span> including all its config, memories, sessions, and environment.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowUninstallModal(false)}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] hover:border-white/20 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => doUninstall(true)}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20 transition cursor-pointer"
                      >
                        Delete {home}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Option A — binary only */}
                    <button
                      onClick={() => doUninstall(false)}
                      className="w-full text-left rounded-xl border border-[var(--border-color)] bg-white/5 hover:bg-white/10 hover:border-indigo-400/40 transition p-4 group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white group-hover:text-indigo-300 transition">Remove binary only</span>
                        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">SAFE</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        Removes the <span className="font-mono text-white/70">{agent.name.toLowerCase()}</span> binary only.{' '}
                        <span className="text-emerald-400">{home} config, memories &amp; sessions are kept</span> — you can reinstall anytime and pick up where you left off.
                      </p>
                    </button>

                    {/* Option B — full purge */}
                    <button
                      onClick={() => doUninstall(true)}
                      className="w-full text-left rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/40 transition p-4 group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white group-hover:text-red-300 transition">Full purge</span>
                        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold">DESTRUCTIVE</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        Removes the binary <span className="text-red-400 font-bold">and deletes {home}</span> including all config, memories &amp; sessions. This cannot be undone.
                      </p>
                    </button>

                    <div className="pt-1">
                      <button
                        onClick={() => setShowUninstallModal(false)}
                        className="w-full py-2 rounded-xl text-[11px] font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] hover:border-white/20 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <SupporterModal
        open={supporterModalOpen}
        onClose={() => setSupporterModalOpen(false)}
      />
    </div>
  );
}
