import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bot, Server as ServerIcon, RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle, Settings2, Puzzle, Trash2, Play, Square, RotateCw, Plus, ExternalLink, Send, Search, Sparkles, Check, FileText, Copy, Lock, Radio, Zap, Shield, Cable, ChevronRight, Flame, Heart, Terminal, ChevronDown, ChevronUp, X, Minus, Maximize2, Minimize2, GripHorizontal, Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { useSupporter } from '@/hooks/useSupporter';
import SupporterModal from '@/components/common/SupporterModal';
import HermesAgentWizard from '@/components/HermesAgentWizard';
import ThemeSelect from '@/components/common/ThemeSelect';
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
  // Future agents — add entries here:
];

export default function AIAgentsApp({ apiFetch }) {
  const { state, connectionsReady, relayInfo } = useApp();
  const { isSupporter, isAdmin } = useSupporter({ refreshOnFocus: true });
  const { showPrompt } = useOS();
  const [supporterModalOpen, setSupporterModalOpen] = useState(false);
  const doFetch = apiFetch || fetch;
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
  const [autoHeal, setAutoHeal] = useState(false);
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

  const agent = AGENTS.find(a => a.id === agentId) || AGENTS[0];

  // ── Multi-instance support (every agent): selected instance + list ──
  const [instanceSel, setInstanceSel] = useState({});
  const [instanceList, setInstanceList] = useState({});
  const [instanceListTick, setInstanceListTick] = useState(0);
  const [spawningInstance, setSpawningInstance] = useState(false);
  const instKey = `${agent.id}:${target}`;
  const activeInstance = instanceSel[instKey] || '';
  const instRef = useRef('');
  useEffect(() => { instRef.current = activeInstance; }, [activeInstance]);
  // Instance-scoped home dir for display hints: '' → ~/.hermes, 'bot2' → ~/.hermes-bot2
  const instHome = (inst) => `~/.${agent.id}${inst ? `-${inst}` : ''}`;


  const call = useCallback(async (action, extra = {}) => {
    if (!target) return null;
    const res = await doFetch(agent.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ connectionId: target, action, instance: instRef.current || undefined, ...extra }),
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
    setLoading(true);
    try {
      const d = await call('details');
      if (d && (d.installed != null || d.success)) {
        setDetails(d);
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
      } else {
        setDetails(null);
      }
    } catch { setDetails(null); }
    finally { setLoading(false); }
  }, [target, call, agent.id, promptActiveFile]);

  // Instance list (multi-instance) — refetched on demand
  const refreshInstances = useCallback(() => setInstanceListTick(t => t + 1), []);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    call('instances').then(r => {
      if (!cancelled && r?.instances) setInstanceList(m => ({ ...m, [instKey]: r.instances }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent.id, target, instanceListTick, call, instKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spawn a new agent instance (clones the default install, starts it)
  const spawnInstance = () => {
    showPrompt(`New ${agent.name} instance name (letters/numbers/-, e.g. bot2):`, (tagRaw) => {
      const tag = String(tagRaw || '').trim();
      if (!tag) return;
      setSpawningInstance(true);
      call('spawn-instance', { instance: tag, config: { tag } })
        .then(r => {
          setNotice({ ok: r?.success !== false, text: r?.output || r?.error || `Instance ${tag} spawned` });
          refreshInstances();
          setInstanceSel(m => ({ ...m, [instKey]: tag }));
          loadDetails();
        })
        .catch(e => setNotice({ ok: false, text: `Spawn failed: ${e?.message || e}` }))
        .finally(() => setSpawningInstance(false));
    }, '', `Spawn ${agent.name} instance`);
  };

  useEffect(() => {
    if (connectionsReady && !target && connections.length > 0) {
      setTarget(connections[0]._id);
    }
  }, [connectionsReady, connections, target]);

  useEffect(() => {
    setYamlDraft('');
    setPromptDraft('');
    setPromptActiveFile('PROMPT.md');
    setDetails(null);
    setTab('overview');
    if (target) loadDetails();
  }, [target, agentId, activeInstance]); // eslint-disable-line react-hooks/exhaustive-deps
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
        setLiveLogLines(prev => {
          const set = new Set(prev);
          const added = r.log.filter(l => !set.has(l));
          return [...prev, ...added, `— done in ${elapsed}s —`];
        });
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

  const act = async (label, fn) => {
    setBusyMsg(label); setNotice(null);
    setLiveLogLines([`> Starting ${label}...`, '> Connecting to remote server...']);
    setLiveLogAction(label); setLiveLogOpen(true); setLiveLogMinimized(false);
    const startTs = Date.now();
    try {
      const r = await fn();
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      if (Array.isArray(r?.log) && r.log.length) {
        setLiveLogLines(prev => {
          const set = new Set(prev);
          const added = r.log.filter(l => !set.has(l));
          return [...prev, ...added, `— done in ${elapsed}s —`];
        });
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
    return callAction(`Gateway ${op}`, 'gateway', { config: { op } });
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
  const uninstall = () => {
    setShowUninstallModal(true);
  };
  const doUninstall = (wantsPurge) => {
    setShowUninstallModal(false);
    setPurge(wantsPurge);
    return callAction('Uninstall', 'uninstall', { purge: wantsPurge });
  };

  const fetchPairings = useCallback(async () => {
    if (!target || !details?.installed) return;
    try {
      const res = await call('pairing-list');
      if (res?.pending && Array.isArray(res.pending)) {
        setPendingPairings(res.pending);
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

    // Single-line tail command that continuously follows daemon logs with -F
    const tailCmd = `stty -echo 2>/dev/null; mkdir -p "${homePref}/logs"; touch "${homePref}/logs/daemon.log"; LOGF="$(ls -1t "${homePref}/logs/"*.log 2>/dev/null | head -1)"; [ -z "$LOGF" ] && LOGF="${homePref}/logs/daemon.log"; tail -n 100 -F "$LOGF" 2>/dev/null || journalctl --user -u ${agentId} --no-pager -n 100 -f 2>/dev/null\n`;

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

    socket.on('connect_error', (err) => {
      console.error('[Agent Logs] Socket connection error:', err.message);
    });
    
    socket.on('ssh:error', (err) => {
      console.error('[Agent Logs] SSH error:', err);
    });
    
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
      const pollInterval = setInterval(() => {
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
      setTimeout(() => {
        if (!active || hasReceivedData) {
          console.log(`[Agent Logs] Placeholder check at 3s: active=${active}, hasReceivedData=${hasReceivedData} - skipping`);
          return;
        }
        console.log(`[Agent Logs] No logs after 3s, showing placeholder for ${agentId}`);
        setLogText(`[SSH connection established]\n\nConnected to ${selectedConn.name || selectedConn.host} successfully.\nAuto-refreshing every 5 seconds...\n\nIf no logs appear:\n• The agent gateway might not be running\n• Try starting/restarting the gateway from the Overview tab\n• Click the "Refresh" button above to fetch logs manually\n`);
      }, 3000);
      
      // Cleanup on unmount
      return () => {
        clearInterval(pollInterval);
      };
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
    socket.on('ssh:error', () => {
      if (!active) return;
      setLogStreamMode('http');
      fetchSnapshot();
    });

    socket.on('connect_error', () => {
      if (!active) return;
      setLogStreamMode('http');
      fetchSnapshot();
    });

    return () => {
      active = false;
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
  useEffect(() => { autoHealRef.current = autoHeal; }, [autoHeal]);
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
  }, [target, agentId, autoHeal]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputCls = 'w-full bg-black/30 border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-400/50';
  const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer disabled:opacity-40';

  if (!isSupporter && !isAdmin) {
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
              <Bot size={15} /> 4 AI Agent Engines
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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <style>{`select option { background-color: #16162a; color: #fff; }`}</style>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {agent.logo
            ? <img src={agent.logo} alt="" className="w-6 h-6 rounded object-contain" />
            : <Bot size={22} className="text-[var(--accent-indigo)]" />}
          <div>
            <h1 className="text-base font-bold">AI Agents</h1>
            <p className="text-[11px] text-[var(--text-muted)]">Install & manage autonomous agents on your servers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          {relayInfo?.connected && (
            <span className="flex items-center gap-1 text-[10px] text-pink-300 font-bold bg-pink-500/10 px-2 py-0.5 rounded-full border border-pink-500/20 shadow-[0_0_10px_rgba(236,72,153,0.15)]">
              <Cable size={10} /> Local Relay Active
            </span>
          )}
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
                <Bot size={16} className={`mt-0.5 shrink-0 ${agentId === a.id ? 'text-indigo-400' : 'text-[var(--text-muted)]'}`} />
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
      ) : !details?.installed ? (
        /* Not installed → install card */
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-5 text-center">
          {agent.logo
            ? <img src={agent.logo} alt="" className="w-8 h-8 mx-auto mb-2 rounded object-contain" />
            : <Bot size={26} className="mx-auto mb-2 text-indigo-400" />}
          <p className="text-sm font-bold mb-1">No agent installed on this server</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">Install {agent.name} with one click — chat with it from Telegram, LINE, Discord &amp; more.</p>
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
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] font-mono">
                {details.version.match(/v?[0-9]+\.[0-9]+(\.[0-9]+)?(-[0-9]+)?/)?.[0] || details.version.split('\n')[0].slice(0, 30)}
              </span>
            )}
            {details.binPath && (
              <span className="text-[9px] font-mono text-[var(--text-muted)] opacity-70 truncate max-w-[220px] hidden sm:inline" title={`Binary path: ${details.binPath}`}>
                {details.binPath}
              </span>
            )}
            {details.model && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">🧠 {details.model}</span>}
            {details.service && <span className="text-[10px] text-[var(--text-muted)]">{details.service} service</span>}
            <span className="ml-auto flex items-center gap-1">
              {!details.running && <button onClick={() => gatewayOp('start')} disabled={!!busyMsg} className={`${btn} bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}><Play size={11} /> Start</button>}
              {details.running && <button onClick={() => gatewayOp('stop')} disabled={!!busyMsg} className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}><Square size={11} /> Stop</button>}
              <button onClick={() => gatewayOp('restart')} disabled={!!busyMsg} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}><RotateCw size={11} /> Restart</button>
              <button onClick={uninstall} disabled={!!busyMsg} title="Uninstall agent" className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>
                <Trash2 size={11} /> Uninstall
              </button>
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
              <AlertCircle size={14} /> ZeroClaw binary is not found on this server.
              <button onClick={() => setShowWizard(true)} disabled={!!busyMsg} className={`${btn} !py-1 !px-2.5 ml-auto bg-indigo-500 text-white hover:bg-indigo-400 font-bold`}>
                <Send size={11} /> 1-Click Install ZeroClaw
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

          <div className="flex gap-1 px-3 pt-3 bg-black/10 overflow-x-auto">
            {[
              ['overview', 'Overview'],
              ['skills', `Skills (${(details.skills || []).length})`],
              ['prompt', 'Personality & Prompt'],
              ['config', 'Config'],
              ['env', `Env (${(details.envKeys || []).length})`],
              ['logs', 'Logs (live)'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-t-lg text-[11px] font-bold transition cursor-pointer whitespace-nowrap ${tab === id ? 'bg-[var(--bg-secondary)] text-[var(--accent-indigo)] border-t border-x border-[var(--border-color)]' : 'text-[var(--text-muted)] hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'overview' && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[['Version', details.version || '—'], ['Model', details.model || '—'], ['Service', details.service || '—'], ['Skills', String((details.skills || []).length)]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-black/30 border border-[var(--border-color)] px-3 py-2">
                      <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)]">{k}</div>
                      <div className="text-xs font-bold mt-0.5 truncate" title={v}>{v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)] mb-1.5">Configured credentials ({(details.envKeys || []).length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(details.envKeys || []).map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-mono">{k}</span>)}
                    {(details.envKeys || []).length === 0 && <span className="text-[10px] text-[var(--text-muted)]">none yet — use the install wizard to add API keys / messenger tokens</span>}
                  </div>
                </div>
                {/* ── Pairing & Access Approval Card ── */}
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm">
                        🔑
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs">Pairing &amp; User Access Approval</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Approve Telegram, Discord, LINE or Slack user pairing codes without using SSH
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={fetchPairings}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] flex items-center gap-1 cursor-pointer transition"
                    >
                      <RotateCw size={10} /> Scan Pending Requests
                    </button>
                  </div>

                  {/* Pending detected pairing chips */}
                  {pendingPairings.length > 0 && (
                    <div className="rounded-lg bg-black/40 border border-indigo-500/30 p-2.5 space-y-2">
                      <div className="text-[10px] font-bold text-indigo-300 flex items-center gap-1.5">
                        <Sparkles size={11} className="text-amber-400 animate-pulse" /> Pending pairing request(s) detected:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pendingPairings.map((p, idx) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-xs">
                            <span className="font-mono font-bold text-white tracking-wider">{p.code}</span>
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-200 font-bold">{p.platform}</span>
                            <button
                              onClick={() => handleApprovePairing(p.code, p.platform)}
                              disabled={pairingLoading || !!busyMsg}
                              className="px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-[10px] transition cursor-pointer flex items-center gap-1"
                            >
                              <Check size={10} /> Approve
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Manual Pairing Form */}
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1">
                    <div className="w-32 shrink-0">
                      <ThemeSelect
                        value={pairingPlatform}
                        onChange={setPairingPlatform}
                        options={[
                          { value: 'telegram', label: 'Telegram' },
                          { value: 'discord', label: 'Discord' },
                          { value: 'line', label: 'LINE' },
                          { value: 'slack', label: 'Slack' },
                          { value: 'auto', label: 'Auto (any)' },
                        ]}
                        size="xs"
                        className="w-full"
                      />
                    </div>
                    <div className="relative flex-1 min-w-[160px]">
                      <input
                        type="text"
                        placeholder="Enter pairing code (e.g. 2VXNGUEH)"
                        value={pairingCode}
                        onChange={e => setPairingCode(e.target.value.toUpperCase())}
                        onKeyDown={e => { if (e.key === 'Enter' && pairingCode.trim()) handleApprovePairing(); }}
                        className="w-full bg-black/40 border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-[var(--text-muted)] font-mono uppercase tracking-wider focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                    <button
                      onClick={() => handleApprovePairing()}
                      disabled={!pairingCode.trim() || pairingLoading || !!busyMsg}
                      className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-white !py-1.5 !px-3.5 font-bold disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {pairingLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Approve Code
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" checked={autoHeal} onChange={e => setAutoHeal(e.target.checked)} className="accent-emerald-500" />
                  Auto-restart gateway if it dies unexpectedly (watchdog)
                </label>
                <button onClick={() => setShowWizard(true)} className={`${btn} bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25`}>
                  <Settings2 size={11} /> Reconfigure / Update settings
                </button>
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
                  prompt: `You are an expert DevOps engineer and Linux system administrator.
- Always provide safe, robust, and verified bash commands.
- Explain potential risks before executing high-impact actions (deletions, service stops, firewall changes).
- Format all terminal commands and code in clear code blocks with explanations.
- Proactively check logs and service health statuses when diagnosing issues.`,
                },
                {
                  id: 'fullstack',
                  name: 'Senior Fullstack Engineer',
                  icon: '💻',
                  desc: 'Clean code architecture, API design, Node.js, Python, and frontend performance',
                  prompt: `You are a Senior Fullstack Software Architect.
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
                  {/* Search Bar & Autocomplete */}
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

                  {/* Category Filter Chips */}
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

                  {/* Universal Skills (shared across all agents) */}
                  {filteredShared.length > 0 && (
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

                  {/* Agent-Specific Skill Hub Grid */}
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

                  {/* Installed Skills List */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                        Installed Skills ({installedList.length})
                      </div>
                      {installedList.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelSkills(new Set())} disabled={selSkills.size === 0} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}>Clear</button>
                          <button onClick={() => { const s = new Set(); installedList.forEach(x => selSkills.has(x) ? null : s.add(x)); setSelSkills(s); }} className={`${btn} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white !py-1 !px-2`}>Select all</button>
                          {selSkills.size > 0 && (
                            <button onClick={async () => { for (const s of selSkills) await call('skills', { config: { op: 'remove', name: s } }); setSelSkills(new Set()); await loadDetails(); }} disabled={!!busyMsg} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25 !py-1 !px-2`}>
                              <Trash2 size={11} /> Remove ({selSkills.size})
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl divide-y divide-[var(--border-color)] bg-black/20 border border-[var(--border-color)] max-h-72 overflow-y-auto">
                      {installedList.map(s => (
                        <div key={s} className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/[0.02] transition">
                          <input type="checkbox" checked={selSkills.has(s)} onChange={e => { const n = new Set(selSkills); e.target.checked ? n.add(s) : n.delete(s); setSelSkills(n); }} className="accent-indigo-500" />
                          <Puzzle size={13} className="text-indigo-400 shrink-0" />
                          <span className="text-xs font-mono font-medium text-white truncate flex-1">{s}</span>
                          {agent.id === 'hermes' && (
                            <button onClick={() => act(`Reset skill ${s}`, () => call('skills', { config: { op: 'reset', name: s } }))} disabled={!!busyMsg} className="text-[9px] text-[var(--text-muted)] hover:text-white cursor-pointer px-2 py-1 rounded bg-white/5 border border-[var(--border-color)]">reset</button>
                          )}
                          <button onClick={() => removeSkill(s)} disabled={!!busyMsg} title="Uninstall skill" className="p-1 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition"><Trash2 size={13} /></button>
                        </div>
                      ))}
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
        const home = { hermes: instHome(activeInstance), nanobot: '~/.nanobot', openclaw: '~/.openclaw', zeroclaw: '~/.zeroclaw' }[agent.id] || ('~/' + agent.id);
        return (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
            <div className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-[var(--bg-primary)] shadow-2xl overflow-hidden">
              {/* top accent */}
              <div className="h-1 w-full bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-lg">🗑️</div>
                  <div>
                    <h2 className="text-base font-bold text-white">Uninstall {agent.name}</h2>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Choose how much to remove from the server</p>
                  </div>
                </div>

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
                      Removes the binary <span className="text-red-400">and deletes {home}</span> including all config, memories &amp; sessions. This cannot be undone.
                    </p>
                  </button>
                </div>

                <div className="pt-1">
                  <button
                    onClick={() => setShowUninstallModal(false)}
                    className="w-full py-2 rounded-xl text-[11px] font-bold text-[var(--text-muted)] hover:text-white border border-[var(--border-color)] hover:border-white/20 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
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
