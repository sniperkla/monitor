'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Send, Loader2, Bot, Box, Server as ServerIcon, MonitorCog, CheckCircle2, XCircle, Trash2, Settings2, Zap, Sparkles, ExternalLink, UserPlus, Lock } from 'lucide-react';
import ThemeSelect from '@/components/common/ThemeSelect';

/**
 * HermesAgentWizard — one-click install of Hermes Agent by Nous Research
 * (https://hermes-agent.nousresearch.com) onto a selected SSH server.
 *
 * Easy mode = 0-knowledge: pick LLM provider → paste API key → pick messenger
 * (Telegram / LINE / Discord) → paste token(s) → Install. The installer runs
 * the OFFICIAL install.sh non-interactively, seeds ~/.hermes/.env secrets,
 * applies config via `hermes config set`, and installs the gateway service.
 *
 * Advanced mode = raw .env lines + config key=value pairs + service override.
 */

const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', model: '', placeholder: 'anthropic/claude-3.5-sonnet', hint: 'One key, 300+ models (recommended). Get a key at openrouter.ai/keys — enter model ID (e.g. anthropic/claude-3.5-sonnet)' },
  { id: 'openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY', model: '', placeholder: 'gpt-4o', hint: 'platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', model: '', placeholder: 'claude-3-5-sonnet-20241022', hint: 'console.anthropic.com → API keys' },
  { id: 'custom', label: 'Custom…', envKey: '', model: '', placeholder: 'model-name', hint: 'Bring your own OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, Groq, Together, etc.). Pick the env-var name and paste the key.', custom: true },
];

const MESSENGERS = [
  { id: 'telegram', label: 'Telegram', hint: 'Create a bot with @BotFather (/newbot) → paste the token. Your user ID from @userinfobot.' },
  { id: 'line', label: 'LINE', hint: 'LINE Developers Console → Messaging API channel. Needs a public webhook URL (tunnel) for inbound chat; push alerts work without one.' },
  { id: 'discord', label: 'Discord', hint: 'Developer portal → Bot → token. Enable Message Content Intent. User IDs via Developer Mode → Copy ID.' },
];

const DISTROS = [
  { id: 'alma', label: 'AlmaLinux 9' },
  { id: 'rocky', label: 'Rocky Linux 9' },
  { id: 'centos', label: 'CentOS Stream 9' },
  { id: 'ubuntu', label: 'Ubuntu 24.04' },
  { id: 'debian', label: 'Debian 12' },
  { id: 'fedora', label: 'Fedora 40' },
  { id: 'arch', label: 'Arch Linux' },
  { id: 'leap', label: 'openSUSE Leap 15' },
];

const THEMED_SELECT_CLS = 'w-full bg-black/40 border border-[var(--border-color)] rounded-lg px-3 py-2 text-[11px] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-indigo-400/50 [&>option]:bg-[#1a1a2e] [&>option]:text-white';

export default function HermesAgentWizard({ isOpen, onClose, connections = [], selectedId, apiFetch, agentApi = '/api/agents/hermes', agent = { id: 'hermes', name: 'Hermes Agent', by: 'Nous Research', docsUrl: 'https://hermes-agent.nousresearch.com/docs/' }, onLog, onActionStart, onActionEnd, instance = '' }) {
  const [mode, setMode] = useState('easy');
  const [target, setTarget] = useState(selectedId || connections[0]?._id || '');
  // easy state
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [customEnvKey, setCustomEnvKey] = useState('CUSTOM_LLM_API_KEY');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [messenger, setMessenger] = useState('telegram');
  const [tok1, setTok1] = useState('');
  const [tok2, setTok2] = useState('');
  const [allowedIds, setAllowedIds] = useState('');
  // advanced state
  const [advEnv, setAdvEnv] = useState('');
  const [advSettings, setAdvSettings] = useState('');
  const [method, setMethod] = useState('auto');
  const [skipBrowser, setSkipBrowser] = useState(true);
  // shared state
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successDetail, setSuccessDetail] = useState('');
  const [purge, setPurge] = useState(true); // default: uninstall removes EVERYTHING — untick to keep config for a later reconfigure
  // install-target chooser
  const [showChooser, setShowChooser] = useState(false);
  const [runWhere, setRunWhere] = useState('direct'); // 'direct' | 'docker'
  const [distro, setDistro] = useState('alma');
  const [lightweight, setLightweight] = useState(false);

  const doFetch = apiFetch || fetch;
  const call = useCallback(async (action, extra = {}) => {
    const res = await doFetch(agentApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ connectionId: target, action, instance: instance || undefined, ...extra }),
    });
    return res.json();
  }, [doFetch, target, agentApi]);

  // Live action logs — global on/off setting (persisted). When ON, long-running
  // actions run as background jobs and their log streams in line by line.
  const [liveLogs, setLiveLogs] = useState(true);
  useEffect(() => {
    try { setLiveLogs(localStorage.getItem('ssh_monitor_live_logs') !== 'off'); } catch { /* default on */ }
  }, []);
  const toggleLiveLogs = () => setLiveLogs(v => {
    const nv = !v;
    try { localStorage.setItem('ssh_monitor_live_logs', nv ? 'on' : 'off'); } catch { /* ignore */ }
    return nv;
  });

  // Run an action as a live job and stream its log lines as they appear.
  // Falls back to the classic single-response call when the server does not
  // return a jobId (e.g. live disabled server-side).
  const callLive = useCallback(async (action, extra, onLine) => {
    const start = await call(action, { ...extra, live: true });
    if (!start?.jobId) return start;
    let cursor = 0;
    // Cap at 20 min — beyond that, the job likely hung server-side.
    const deadline = Date.now() + 20 * 60 * 1000;
    // Surface a "no progress" warning after 90s of silence so the user
    // isn't left staring at a frozen terminal. Install/uninstall can
    // legitimately be slow (e.g. compiling venv, downloading binaries),
    // but a long stretch of zero log lines usually means we're stuck.
    let lastProgressAt = Date.now();
    const noProgressWarnMs = 90_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));
      let upd = null;
      try { upd = await call('job', { jobId: start.jobId, cursor }); }
      catch (e) { /* transient network — keep polling */ continue; }
      if (upd?.lines?.length) {
        upd.lines.forEach(onLine);
        lastProgressAt = Date.now();
      }
      cursor = upd?.cursor ?? cursor;
      if (upd?.done) return upd.result || { success: false, error: 'Job ended without a result' };
      // transient "Unknown or expired job" — happens when the dev server hot-reloaded
      // the agent route mid-install. Wait a tick and retry instead of failing.
      if (upd?.error && /Unknown or expired job/i.test(upd.error)) continue;
      if (upd?.error) throw new Error(upd.error);
      // Stuck detection — only warn, don't abort (the server may
      // genuinely be doing something slow).
      if (Date.now() - lastProgressAt > noProgressWarnMs) {
        onLine?.(`\n⚠ No new output for ${Math.round((Date.now() - lastProgressAt) / 1000)}s — the install may be stuck on a network call or large download.\n`);
        lastProgressAt = Date.now();
      }
    }
    return { success: false, error: 'Client timeout: the action took longer than 20 minutes' };
  }, [call]);

  const loadStatus = useCallback(async () => {
    if (!target) return;
    setStatus(null);
    // NOTE: intentionally do NOT pre-fill API key / model / tokens from the
    // server — the form always starts FRESH so a reconfigure never silently
    // re-saves old values. The user enters only what they want to change.
    try {
      const st = await call('status').catch(() => null);
      setStatus(st);
    } catch {
      setStatus(null);
    }
  }, [target, call]);

  useEffect(() => {
    if (isOpen) {
      setStatus(null);
      setApiKey('');
      setModel('');
      setTok1('');
      setTok2('');
      setAllowedIds('');
      setAdvEnv('');
      setAdvSettings('');
      loadStatus();
    }
  }, [isOpen, loadStatus, agentApi]);

  // Reset when the selected server or agent changes. NOTE: depend on a stable
  // connection-id signature, NOT the `connections` array identity — parents
  // may re-create the array on every render (health/heartbeat polling causes
  // frequent re-renders), which previously wiped typed-in tokens/keys every
  // few seconds while the one-click install modal was open.
  const connectionsRef = useRef(connections);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  const connectionKey = connections.map(c => c._id).join('|');
  useEffect(() => {
    setTarget(selectedId || connectionsRef.current[0]?._id || '');
    setStatus(null);
    setLog([]);
    setDone(null);
    setShowChooser(false);
    setApiKey('');
    setModel('');
    setTok1('');
    setTok2('');
    setAllowedIds('');
    setAdvEnv('');
    setAdvSettings('');
  }, [selectedId, connectionKey, agent.id]);

  const buildPayload = () => {
    const base = mode === 'advanced' ? buildAdvancedPayload() : buildEasyPayload();
    base.config.lightweight = lightweight;
    if (runWhere === 'docker') base.config.docker = { enabled: true, image: distro };
    return base;
  };

  const buildAdvancedPayload = () => {
    const env = {};
    advEnv.split('\n').forEach(l => {
      const i = l.indexOf('=');
      if (i > 0 && l.trim() && !l.trim().startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    const settings = {};
    advSettings.split('\n').forEach(l => {
      const i = l.indexOf('=');
      if (i > 0 && l.trim() && !l.trim().startsWith('#')) settings[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return { config: { env, settings, method, skipBrowser } };
  };

  const buildEasyPayload = () => {
    const isReconfig = !!(status && (status.installed || status.running || status.binPath));
    const env = {}, settings = {};
    if (model) settings.model = model;

    const prov = PROVIDERS.find(x => x.id === provider) || PROVIDERS[0];
    const isCustom = !!prov.custom;

    if (apiKey.trim()) {
      const envKey = (isCustom ? customEnvKey.trim() : prov.envKey) || 'CUSTOM_LLM_API_KEY';
      env[envKey] = apiKey.trim();
    }
    if (isCustom && customBaseUrl.trim()) {
      env.OPENAI_BASE_URL = customBaseUrl.trim();
      env.OPENAI_API_BASE = customBaseUrl.trim();
    }
    if (messenger === 'telegram') {
      settings['gateway.platforms.telegram.enabled'] = 'true';
      if (tok1.trim()) env.TELEGRAM_BOT_TOKEN = tok1.trim();
      if (allowedIds.trim()) env.TELEGRAM_ALLOWED_USERS = allowedIds.trim();
    } else if (messenger === 'line') {
      settings['gateway.platforms.line.enabled'] = 'true';
      if (tok1.trim()) env.LINE_CHANNEL_ACCESS_TOKEN = tok1.trim();
      if (tok2.trim()) env.LINE_CHANNEL_SECRET = tok2.trim();
      if (allowedIds.trim()) env.LINE_ALLOWED_USERS = allowedIds.trim();
      else if (!isReconfig) env.LINE_ALLOW_ALL_USERS = 'true';
    } else if (messenger === 'discord') {
      settings['gateway.platforms.discord.enabled'] = 'true';
      if (tok1.trim()) env.DISCORD_BOT_TOKEN = tok1.trim();
      if (allowedIds.trim()) env.DISCORD_ALLOWED_USERS = allowedIds.trim();
      else if (!isReconfig) env.DISCORD_ALLOW_ALL_USERS = 'true';
    }
    return { config: { env, settings, method, skipBrowser } };
  };

  const install = async () => {
    setBusy(true); setLog([]); setDone(null); setShowChooser(false);
    try {
      // 1-Click Install is ALWAYS a real fresh install. When the agent is
      // already installed we purge its instance config/memories first so the
      // resulting setup is identical to a first-time install (no stale tokens,
      // models or gateway). It is NOT a reconfigure.
      const st = (await call('status').catch(() => null)) || status;
      const installed = !!(st && st.installed);

      // Fresh install still requires at least one real field.
      const advHasInput = mode === 'advanced' && !!(advEnv.trim() || advSettings.trim());
      const hasInput = !!(apiKey.trim() || model.trim() || tok1.trim() || customBaseUrl.trim() || advHasInput);
      if (!hasInput) {
        setDone({ ok: false, detail: 'Nothing entered — enter at least an API key/model to install.' });
        setBusy(false);
        return;
      }

      // Purge whatever is already there so the install below is genuinely fresh.
      if (installed) {
        onActionStart?.(`Fresh reinstall ${agent.name} (purging old instance…)`);
        const append = (line) => { setLog(prev => [...prev, line]); onLog?.(line); };
        const u = liveLogs
          ? await callLive('uninstall', { purge: true }, append)
          : await call('uninstall', { purge: true });
        if (!u?.success) {
          setDone({ ok: false, detail: (u && u.error) || 'Failed to clear previous install. Close and retry.' });
          setBusy(false);
          return;
        }
        setLog(prev => [...prev, `— old instance cleared. Starting fresh install…`]);
        onLog?.('— old instance cleared. Starting fresh install…');
      }

      const action = 'install';
      const label = `Install ${agent.name}`;
      onActionStart?.(label);
      const append = (line) => { setLog(prev => [...prev, line]); onLog?.(line); };
      const r = liveLogs
        ? await callLive(action, buildPayload(), append)
        : await call(action, buildPayload());
      if (r?.log && !liveLogs) { setLog(r.log); r.log.forEach(l => onLog?.(l)); }
      const detail = r.success
        ? `${agent.name} ${r.version || ''} gateway is running (${r.startMethod}). Say hi to your agent in ${MESSENGERS.find(m => m.id === messenger)?.label || 'your messenger'}!`
        : r.error;
      if (r.success) {
        setSuccessDetail(detail);
        setShowSuccess(true);
      } else {
        setDone({ ok: !!r.success, detail });
      }
      loadStatus();
    } catch (e) {
      setLog(prev => [...prev, `ERROR: ${e.message}`]);
      onLog?.(`ERROR: ${e.message}`);
      setDone({ ok: false, detail: e.message });
    } finally { setBusy(false); onActionEnd?.(); }
  };

  // ── RECONFIGURE — update config + restart gateway. Keeps everything
  // (token, memories, sessions, skills) — just re-applies what the user
  // entered and bounces the gateway. No purge, no reinstall.
  const reconfigure = async () => {
    setBusy(true); setLog([]); setDone(null); setShowChooser(false);
    try {
      const advHasInput = mode === 'advanced' && !!(advEnv.trim() || advSettings.trim());
      const hasInput = !!(apiKey.trim() || model.trim() || tok1.trim() || customBaseUrl.trim() || advHasInput);
      if (!hasInput) {
        setDone({ ok: false, detail: 'Nothing entered — enter what you want to update, or close the wizard.' });
        setBusy(false);
        return;
      }
      const label = `Reconfigure ${agent.name}`;
      onActionStart?.(label);
      const append = (line) => { setLog(prev => [...prev, line]); onLog?.(line); };
      const r = liveLogs
        ? await callLive('reconfigure', buildPayload(), append)
        : await call('reconfigure', buildPayload());
      if (r?.log && !liveLogs) { setLog(r.log); r.log.forEach(l => onLog?.(l)); }
      const detail = r.success
        ? `${agent.name} reconfigured successfully — gateway restarted.`
        : r.error;
      if (r.success) {
        setSuccessDetail(detail);
        setShowSuccess(true);
      } else {
        setDone({ ok: !!r.success, detail });
      }
      loadStatus();
    } catch (e) {
      setLog(prev => [...prev, `ERROR: ${e.message}`]);
      onLog?.(`ERROR: ${e.message}`);
      setDone({ ok: false, detail: e.message });
    } finally { setBusy(false); onActionEnd?.(); }
  };

  const uninstall = async () => {
    setBusy(true);
    try {
      onActionStart?.(`Uninstall ${agent.name}`);
      const append = (line) => { setLog(prev => [...prev, line]); onLog?.(line); };
      const r = liveLogs ? await callLive('uninstall', { purge }, append) : await call('uninstall', { purge });
      if (r?.log && !liveLogs) { setLog(r.log || ['uninstalled']); (r.log || []).forEach(l => onLog?.(l)); }
      setDone(null);
      loadStatus();
    } finally { setBusy(false); onActionEnd?.(); }
  };

  const switchToAdvanced = () => {
    if (advEnv === '') {
      const prov = PROVIDERS.find(x => x.id === provider) || PROVIDERS[0];
      const isCustom = !!prov.custom;
      const envKey = (isCustom ? customEnvKey.trim() : prov.envKey) || 'CUSTOM_LLM_API_KEY';
      const lines = [];
      if (apiKey.trim()) lines.push(`${envKey}=${apiKey.trim()}`);
      if (isCustom && customBaseUrl.trim()) {
        lines.push(`OPENAI_BASE_URL=${customBaseUrl.trim()}`);
        lines.push(`OPENAI_API_BASE=${customBaseUrl.trim()}`);
      }
      if (messenger === 'telegram' && tok1.trim()) { lines.push(`TELEGRAM_BOT_TOKEN=${tok1.trim()}`); if (allowedIds.trim()) lines.push(`TELEGRAM_ALLOWED_USERS=${allowedIds.trim()}`); }
      setAdvEnv(lines.join('\n'));
      setAdvSettings(`model=${model}\ngateway.platforms.telegram.enabled=true`);
    }
    setMode('advanced');
  };

  if (!isOpen) return null;
  const prov = PROVIDERS.find(x => x.id === provider) || PROVIDERS[0];
  const isCustom = !!prov.custom;
  const mes = MESSENGERS.find(x => x.id === messenger);
  const inputCls = 'w-full bg-black/30 border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-400/50';
  const btnPx = 'px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50';

  return (
    <>
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            {agent.logo ? <img src={agent.logo} alt="" className="w-[18px] h-[18px] rounded object-contain" /> : null}
            <h2 className="text-sm font-bold flex items-center gap-2 flex-wrap">
              {agent.name} <span className="text-[10px] font-normal text-[var(--text-muted)]">by {agent.by}</span>
              {instance && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold" title={`All changes apply to instance "${instance}" (~/.${agent.id}-${instance}), not the default`}>
                  <UserPlus size={10} /> instance: {instance}
                </span>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-1 bg-black/30 rounded-lg p-0.5">
            <button onClick={toggleLiveLogs} title={liveLogs ? 'Live action logs: ON (click to disable)' : 'Live action logs: OFF (click to enable)'}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${liveLogs ? 'bg-emerald-500/15 text-emerald-400' : 'text-[var(--text-muted)] hover:bg-white/5'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveLogs ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-muted)]'}`} /> LIVE
            </button>
            <button onClick={() => setMode('easy')} className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold ${mode === 'easy' ? 'bg-white/10 text-[var(--accent-indigo)]' : 'text-[var(--text-muted)] hover:bg-white/5'} cursor-pointer`}>
              <Zap size={11} /> EASY
            </button>
            <button onClick={switchToAdvanced} className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold ${mode === 'advanced' ? 'bg-white/10 text-[var(--accent-indigo)]' : 'text-[var(--text-muted)] hover:bg-white/5'} cursor-pointer`}>
              <Settings2 size={11} /> ADVANCED
            </button>
          </div>
          <button onClick={onClose} disabled={busy} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 cursor-pointer"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Server picker */}
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Install on server</label>
            <ThemeSelect
              value={target}
              onChange={setTarget}
              options={connections.map(c => ({ value: c._id, label: `${c.name || c.host} (${c.host})` }))}
              placeholder="Select a server…"
              icon={ServerIcon}
              size="sm"
              className="mt-1 w-full"
            />
            {status && (
              <div className="flex items-center gap-2 mt-1.5 text-[10px] flex-wrap">
                {status.installed ? (
                  <>
                    <span className={status.running ? 'text-emerald-400' : 'text-amber-400'}>
                      {status.running ? `● ${agent.name} ${status.version || ''} — gateway running (${status.service})` : `○ ${agent.name} ${status.version || ''} installed — gateway not running`}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">○ Not installed</span>
                )}
                {(!status.prereqs?.git || !status.prereqs?.curl) && <span className="text-amber-400">⚠ git/curl missing (installer will try to add them)</span>}
              </div>
            )}
          </div>

          {/* Agent card */}
          <div className="flex items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
            {agent.logo ? <img src={agent.logo} alt="" className="w-[18px] h-[18px] rounded object-contain shrink-0" /> : null}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold flex items-center gap-1.5">{agent.name}
                <a href={agent.docsUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200 inline-flex" title="Documentation"><ExternalLink size={10} /></a>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Self-improving AI agent on your server — chat with it from Telegram / LINE / Discord, give it tasks, schedules &amp; skills</div>
            </div>
          </div>

          {/* Easy mode fields */}
          {mode === 'easy' && (
            <div className="space-y-3">
              {/* Step 1: brain */}
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">1 · Brain — LLM provider</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  {PROVIDERS.map(x => (
                    <button key={x.id} onClick={() => { setProvider(x.id); if (x.model) setModel(x.model); }} className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${provider === x.id ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300' : 'bg-black/20 border-[var(--border-color)] text-[var(--text-muted)] hover:bg-white/5'}`}>
                      {x.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5">{prov.hint}</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input className={inputCls} placeholder="API key" value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" autoComplete="off" />
                  <input className={inputCls} placeholder={`Model (e.g. ${prov.placeholder || 'anthropic/claude-3.5-sonnet'})`} value={model} onChange={e => setModel(e.target.value)} />
                </div>
                {isCustom && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input className={inputCls} placeholder="Env-var name (e.g. OLLAMA_API_KEY)" value={customEnvKey} onChange={e => setCustomEnvKey(e.target.value)} spellCheck={false} />
                    <input className={inputCls} placeholder="Base URL (https://api.example.com/v1) — optional" value={customBaseUrl} onChange={e => setCustomBaseUrl(e.target.value)} spellCheck={false} />
                  </div>
                )}
              </div>

              {/* Step 2: messenger */}
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">2 · Chat with it via</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  {MESSENGERS.map(x => (
                    <button key={x.id} onClick={() => setMessenger(x.id)} className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${messenger === x.id ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300' : 'bg-black/20 border-[var(--border-color)] text-[var(--text-muted)] hover:bg-white/5'}`}>
                      {x.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5">{mes.hint}</p>
                <div className={`grid gap-2 mt-2 ${messenger === 'line' ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  <input className={inputCls} placeholder={messenger === 'line' ? 'Channel access token' : 'Bot token'} value={tok1} onChange={e => setTok1(e.target.value)} type="password" autoComplete="off" />
                  {messenger === 'line'
                    ? <input className={inputCls} placeholder="Channel secret" value={tok2} onChange={e => setTok2(e.target.value)} type="password" autoComplete="off" />
                    : <input className={inputCls} placeholder="Your user ID (optional)" value={allowedIds} onChange={e => setAllowedIds(e.target.value)} />}
                </div>
                {messenger === 'line' && (
                  <input className={`${inputCls} mt-2`} placeholder="Allowed user IDs, comma-separated (optional — empty = allow all)" value={allowedIds} onChange={e => setAllowedIds(e.target.value)} />
                )}
              </div>
            </div>
          )}

          {/* Advanced mode fields */}
          {mode === 'advanced' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">~/.hermes/.env additions (secrets & tokens)</label>
                <textarea className={`${inputCls} font-mono h-24 mt-1`} value={advEnv} onChange={e => setAdvEnv(e.target.value)} spellCheck={false} placeholder={'OPENROUTER_API_KEY=sk-or-...\nTELEGRAM_BOT_TOKEN=123:ABC\nTELEGRAM_ALLOWED_USERS=123456789'} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Config settings (key=value → hermes config set)</label>
                <textarea className={`${inputCls} font-mono h-20 mt-1`} value={advSettings} onChange={e => setAdvSettings(e.target.value)} spellCheck={false} placeholder={'model=openrouter/meta-llama/llama-3.3-70b-instruct\ngateway.platforms.telegram.enabled=true'} />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Service</label>
                  <ThemeSelect
                    value={method}
                    onChange={setMethod}
                    options={[
                      { value: 'auto', label: 'auto (detect)' },
                      { value: 'system', label: 'system service (boot-time)' },
                      { value: 'user', label: 'user service + linger' },
                      { value: 'nohup', label: 'nohup background' }
                    ]}
                    size="xs"
                    className="w-48"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" checked={skipBrowser} onChange={e => setSkipBrowser(e.target.checked)} className="accent-indigo-500" />
                  skip browser tools (headless)
                </label>
              </div>
            </div>
          )}

          {/* ── Danger zone — kept at the bottom, separated from safe actions ── */}
          {status?.installed && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
              <div className="text-[10px] font-bold text-red-300 flex items-center gap-1.5">
                <Trash2 size={11} /> Danger zone
              </div>
              <p className="text-[9px] text-[var(--text-muted)]">
                Uninstall removes the agent runtime from this server. {instance ? `This also deletes the instance "${instance}" including its config, memories & sessions.` : 'Optionally delete all data (config, memories, sessions) with the checkbox above.'}
              </p>
              <button
                onClick={uninstall}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 disabled:opacity-50 transition cursor-pointer"
              >
                <Trash2 size={12} /> Uninstall {agent.name}{instance ? ` (${instance})` : ''}
              </button>
            </div>
          )}

          {/* ── Sticky action footer — always visible at the modal bottom ── */}
          <div className="sticky bottom-0 -mx-5 px-5 pt-2.5 pb-1 mt-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)]">
          <div className="text-[9px] text-[var(--text-muted)] mb-1.5 flex items-center gap-1 flex-wrap">
            <Lock size={9} /> Applying to:
            <span className="font-mono font-bold text-[var(--text-muted)]">
              {instance ? `~/.${agent.id}-${instance}/` : `~/.${agent.id}/`}
            </span>
            {instance && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold">instance: {instance}</span>}
            {!instance && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[var(--text-muted)] font-bold">default</span>}
          </div>
          {instance ? (
            <div className="space-y-2">
              <button
                onClick={reconfigure}
                disabled={busy || !target}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold disabled:opacity-50 transition cursor-pointer"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Save &amp; Start
              </button>
              <p className="text-[9px] text-[var(--text-muted)]">Applies the config above and starts this instance&apos;s gateway. Uninstall is done later from the instance dropdown.</p>
            </div>
          ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
            {status?.installed ? (
              <>
                <button
                  onClick={reconfigure}
                  disabled={busy || !target}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                  title="Update config + restart gateway — keeps token, memories & sessions"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Update &amp; Restart
                </button>
                <button
                  onClick={install}
                  disabled={busy || !target}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                  title="Wipe this instance's config/memories and install from scratch"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  One-Click Reinstall
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowChooser(true)}
                disabled={busy || !target}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold disabled:opacity-50 transition cursor-pointer"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {busy ? 'Installing… (can take 5–15 min)' : 'One-Click Install'}
              </button>
            )}
            </div>
            {status?.installed && (
              <p className="text-[9px] text-[var(--text-muted)]">
                <span className="text-emerald-400/80 font-bold">Update &amp; Restart</span> keeps token/memories · <span className="text-indigo-400/80 font-bold">One-Click Reinstall</span> wipes config &amp; memories and installs from scratch
              </p>
            )}
          </div>
          )}
          </div>

          {/* Install-target chooser (fire alert) */}
      {showChooser && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowChooser(false)}>
          <div className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold">Where should the agent run?</h3>
            <button onClick={() => setRunWhere('direct')}
              className={`w-full text-left flex items-start gap-3 rounded-xl border px-4 py-3 transition cursor-pointer ${runWhere === 'direct' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-[var(--border-color)] bg-black/20 hover:bg-white/5'}`}>
              <ServerIcon size={18} className="mt-0.5 text-indigo-400 shrink-0" />
              <span>
                <span className="block text-xs font-bold">Directly on this server</span>
                <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">Installs into the server&apos;s own system. Full performance, shares the host environment.</span>
              </span>
            </button>
            <button onClick={() => setRunWhere('docker')}
              className={`w-full text-left flex items-start gap-3 rounded-xl border px-4 py-3 transition cursor-pointer ${runWhere === 'docker' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-[var(--border-color)] bg-black/20 hover:bg-white/5'}`}>
              <Box size={18} className="mt-0.5 text-sky-400 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-bold">Isolated Docker container <span className="text-[9px] font-normal text-emerald-400">recommended</span></span>
                <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">Clean distro container, agent data persists on the host (~/.hermes-docker), auto-restarts with Docker. Requires Docker on the server.</span>
              </span>
            </button>
            {runWhere === 'docker' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Distro</label>
                <ThemeSelect
                  value={distro}
                  onChange={setDistro}
                  options={DISTROS.map(d => ({ value: d.id, label: d.label }))}
                  size="sm"
                  className="mt-1 w-full"
                />
              </div>
            )}
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" checked={lightweight} onChange={e => setLightweight(e.target.checked)} className="accent-indigo-500" />
              Lightweight mode — skip bundled skills &amp; keep auxiliary calls on free models (lowest token usage)
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setShowChooser(false)} className={`${btnPx} bg-white/5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-white`}>Cancel</button>
              <button onClick={install} disabled={busy}
                className={`${btnPx} bg-indigo-500 hover:bg-indigo-400 text-white flex items-center gap-1.5`}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {runWhere === 'docker' ? `Install in ${DISTROS.find(d => d.id === distro)?.label} container` : 'Install on server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result banner */}
          {done && (
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${done.ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/25 bg-red-500/10 text-red-300'}`}>
              {done.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
              <div className="min-w-0">{done.detail}</div>
            </div>
          )}

          {/* Log */}
          {log.length > 0 && (
            <pre className="bg-black/40 rounded-lg p-3 text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto text-[var(--text-muted)]">{log.join('\n')}</pre>
          )}
        </div>
      </div>
    </div>

    {/* ── Reconfigure Success Modal ── */}
    {showSuccess && (
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
        onClick={() => { setShowSuccess(false); onClose(); }}
      >
        <div
          className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
          style={{ background: 'linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)', border: '1px solid rgba(99,102,241,0.35)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* glow ring */}
          <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 80px rgba(99,102,241,0.12)' }} />

          {/* animated confetti dots */}
          <div className="absolute top-0 left-0 right-0 h-1 rounded-t-3xl" style={{ background: 'linear-gradient(90deg,#6366f1,#a855f7,#06b6d4,#6366f1)', backgroundSize: '200%', animation: 'gradientShift 2s linear infinite' }} />

          <div className="flex flex-col items-center gap-4 px-8 py-10">
            {/* big check */}
            <div
              className="relative flex items-center justify-center w-20 h-20 rounded-full"
              style={{ background: 'linear-gradient(135deg,#4ade80 0%,#22d3ee 100%)', boxShadow: '0 0 40px rgba(74,222,128,0.35)' }}
            >
              <CheckCircle2 size={40} className="text-white drop-shadow-lg" strokeWidth={2.5} />
            </div>

            {/* title */}
            <div className="text-center space-y-1">
              <h2 className="text-xl font-black text-white tracking-tight">Reconfigured!</h2>
              <p className="text-sm text-indigo-300 font-medium">{agent.name}</p>
            </div>

            {/* detail */}
            <p className="text-center text-[11px] text-slate-400 leading-relaxed max-w-xs">{successDetail}</p>

            {/* close button */}
            <button
              onClick={() => { setShowSuccess(false); onClose(); }}
              className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition cursor-pointer"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 4px 24px rgba(99,102,241,0.4)' }}
            >
              Done
            </button>
          </div>
        </div>

        <style>{`@keyframes gradientShift{0%{background-position:0%}100%{background-position:200%}}`}</style>
      </div>
    )}
    </>
  );
}
