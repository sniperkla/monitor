'use client';
 
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import {
  ShieldCheck, ShieldAlert, Play, RefreshCw, Trash2, Bug,
  FileWarning, Clock3, Skull, ArchiveRestore, EyeOff, XCircle,
  CheckCircle2, AlertTriangle, Info, Server as ServerIcon, Loader2,
  BadgeCheck, Download, ChevronDown, ChevronRight, Activity, Cpu, Terminal,
  X, Zap, HardDrive, Search,
} from 'lucide-react';
import VirusScanOnboarding, { hasCompletedVirusScanOnboarding, resetVirusScanOnboarding } from '@/components/VirusScanOnboarding';
import { useOS } from '@/context/OSContext';
import ThemeSelect from '@/components/common/ThemeSelect';

const SEVERITY = {
  critical: { label: 'Critical', color: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/30', Icon: Skull },
  high:     { label: 'High',     color: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/30', Icon: AlertTriangle },
  medium:   { label: 'Medium',   color: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', Icon: FileWarning },
  low:      { label: 'Low',      color: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/30', Icon: Info },
};

// Checks whose findings are real files that can be quarantined/deleted.
const FILE_CHECKS = new Set(['clamav-signatures', 'maldet-scan', 'tmp-executables', 'known-malware-paths', 'recent-suid', 'hidden-process']);

const ENGINES = [
  { id: 'clamav', name: 'ClamAV', desc: 'Antivirus signatures (Cisco Talos)' },
  { id: 'maldet', name: 'Maldet (LMD)', desc: 'Web-malware & backdoor signatures' },
  { id: 'wazuh-manager', name: 'Wazuh manager', desc: 'Self-hosted HIDS brain — analyzes & stores alerts on this server, no external setup' },
  { id: 'wazuh',  name: 'Wazuh agent', desc: 'Real-time intrusion detection — needs a Wazuh manager (install manager first if you have none)' },
];

const STATUS_BADGE = {
  open:        { label: 'Open',        cls: 'bg-white/[0.06] text-slate-300' },
  quarantined: { label: 'Quarantined', cls: 'bg-violet-500/15 text-violet-300' },
  deleted:     { label: 'Deleted',     cls: 'bg-emerald-500/15 text-emerald-300' },
  ignored:     { label: 'Ignored',     cls: 'bg-slate-500/15 text-slate-400' },
  resolved:    { label: 'Resolved',    cls: 'bg-emerald-500/15 text-emerald-300' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const s = Math.max(1, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ---------- Themed dropdown now shared: @/components/common/ThemeSelect ---------- */

/* ---------- Collapsible evidence block ---------- */
function Evidence({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const lines = text.split('\n');
  const long = lines.length > 4 || text.length > 200;
  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(e => !e)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-300 transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {expanded ? 'Hide details' : `Show details (${lines.length} line${lines.length === 1 ? '' : 's'})`}
      </button>
      {expanded && (
        <pre className="mt-1.5 p-2 rounded-lg bg-black/40 border border-white/5 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{text}</pre>
      )}
    </div>
  );
}

/* ---------- Themed modal (replaces window.confirm / window.prompt) ---------- */
function ConfirmModal({ modal, onClose }) {
  const [inputVal, setInputVal] = useState('');
  useEffect(() => { setInputVal(modal?.inputValue ?? ''); }, [modal]);
  if (!modal) return null;
  const submit = () => {
    if (modal.input && !inputVal.trim()) return;
    modal.resolve(modal.input ? inputVal.trim() : true);
    onClose();
  };
  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-[#141824] border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${modal.danger ? 'bg-rose-500/15' : 'bg-indigo-500/15'}`}>
              {modal.danger ? <AlertTriangle size={17} className="text-rose-300" /> : <ShieldCheck size={17} className="text-indigo-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-slate-100 leading-snug">{modal.title}</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{modal.message}</p>
              {modal.input && (
                <input
                  autoFocus
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder={modal.inputPlaceholder || ''}
                  className="mt-3 w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 focus:border-indigo-500/50 focus:outline-none text-sm text-slate-200 font-mono"
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-xs font-medium text-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={modal.input && !inputVal.trim()}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
              modal.danger
                ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-200'
                : 'bg-indigo-500/25 hover:bg-indigo-500/35 text-indigo-100'
            }`}
          >
            {modal.confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Advanced findings-filter helpers ── */
const SEVS = ['critical', 'high', 'medium', 'low'];
const CATS = ['process', 'file', 'cron', 'auth', 'network', 'system'];
const STATUSES = ['quarantined', 'deleted', 'ignored', 'resolved'];
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_PILL = {
  critical: 'border-rose-500/40 text-rose-300',
  high: 'border-orange-500/40 text-orange-300',
  medium: 'border-amber-500/40 text-amber-300',
  low: 'border-sky-500/40 text-sky-300',
};
function engineGroup(checkId) {
  if (checkId === 'clamav-signatures') return 'clamav';
  if (checkId === 'maldet-scan') return 'lmd';
  if (checkId === 'wazuh-alerts') return 'wazuh';
  return 'heuristic';
}
const ENGINE_LABELS = { clamav: 'ClamAV', lmd: 'LMD', wazuh: 'Wazuh', heuristic: 'Heuristic' };

function FPill({ active, onClick, children, cls = '' }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
        active ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/[0.04] text-slate-400 border-transparent hover:bg-white/[0.07] hover:text-slate-200'
      } ${cls}`}
    >
      {children}
    </button>
  );
}

export default function VirusScannerApp({ windowId }) {
  const { state: appState, apiFetch } = useApp();
  const { state: osState, toggleMaximize } = useOS();

  const connections = useMemo(() => (
    (appState.connections || []).filter(c => c.type === 'ssh' || (!c.type && !c.dbProvider))
  ), [appState.connections]);

  const [selectedConn, setSelectedConn] = useState(null);
  const [tab, setTab] = useState('overview'); // overview | findings | history
  const [scan, setScan] = useState(null);
  const [history, setHistory] = useState([]);
  const [scanningMode, setScanningMode] = useState(null); // 'quick' | 'deep' | 'full' while its request runs
  const scanning = scanningMode !== null;
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [fStatus, setFStatus] = useState('open');   // 'open' | 'all' | specific status
  const [fSev, setFSev] = useState([]);
  const [fCat, setFCat] = useState([]);
  const [fEng, setFEng] = useState([]);
  const [fQuery, setFQuery] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Show the guided tour on first visit
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasCompletedVirusScanOnboarding()) ensureMaximizedThenShowRef.current();
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const replayOnboarding = () => {
    resetVirusScanOnboarding();
    ensureMaximizedThenShowRef.current();
  };

  // Maximize-then-onboard (same deterministic pattern as Docker app):
  // poll until the window record actually flips to isMaximized.
  const osStateRef = useRef(osState);
  useEffect(() => { osStateRef.current = osState; }, [osState]);
  const ensureMaximizedThenShow = useCallback(() => {
    const show = () => setShowOnboarding(true);
    const winId = windowId
      || `virus-scanner`;
    const win = (osStateRef.current?.windows || []).find(w => w.id === winId)
      || (osStateRef.current?.windows || []).find(w => w.id?.startsWith('virus-scanner'));
    if (!win || win.isMaximized) return show();
    toggleMaximize(win.id);
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const now = (osStateRef.current?.windows || []).find(w => w.id === win.id);
      if ((now && now.isMaximized) || tries > 15) {
        clearInterval(iv);
        show();
      }
    }, 100);
  }, [windowId, toggleMaximize]);
  const ensureMaximizedThenShowRef = useRef(ensureMaximizedThenShow);
  useEffect(() => { ensureMaximizedThenShowRef.current = ensureMaximizedThenShow; }, [ensureMaximizedThenShow]);
  const [engines, setEngines] = useState({});
  const [installingEngine, setInstallingEngine] = useState(null);
  const [actingEngine, setActingEngine] = useState(null); // `${engineId}:${action}` busy marker
  const [installLog, setInstallLog] = useState('');
  const [bgScans, setBgScans] = useState({ clamav: 'idle', maldet: 'idle', wazuh: null });
  const [modal, setModal] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);

  // Refs so the tmux polling interval always sees current values
  const connRef = useRef(selectedConn);
  useEffect(() => { connRef.current = selectedConn; }, [selectedConn]);

  // Promise-based themed dialog: resolves true/false (confirm) or string|null (prompt)
  const askDialog = useCallback((opts) => new Promise((resolve) => setModal({ ...opts, resolve })), []);
  const closeModal = useCallback(() => {
    setModal(m => { m?.resolve?.(m.input ? null : false); return null; });
  }, []);

  const connOptions = useMemo(() => connections.map(c => ({ value: c._id, label: c.name || c.host })), [connections]);
  const selectedConnObj = useMemo(() => connections.find(c => c._id === selectedConn), [connections, selectedConn]);

  useEffect(() => {
    if (connections.length > 0 && (!selectedConn || !connections.some(c => c._id === selectedConn))) {
      setSelectedConn(connections[0]._id);
    }
  }, [connections, selectedConn]);

  const loadResults = useCallback(async (connId) => {
    if (!connId) return;
    try {
      const res = await apiFetch(`/api/virus-scan?connectionId=${encodeURIComponent(connId)}`);
      const data = res?.json ? await res.json() : res;
      if (data?.success) {
        setScan(data.latest || null);
        setHistory(data.history || []);
        setError(null);
      } else {
        setError(data?.error || 'Failed to load results');
      }
    } catch (e) {
      setError(e?.message || 'Failed to load results');
    }
  }, [apiFetch]);

  const loadEngineStatuses = useCallback(async (connId) => {
    if (!connId) return;
    for (const eng of ENGINES) {
      try {
        // Cache-buster: identical GET URLs can be served from the browser's
        // HTTP cache (stale "installed" bodies) — a unique query forces every
        // poll to reach the server.
        const bust = `_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const res = await apiFetch(`/api/virus-scan/engine?engine=${eng.id}&connectionId=${encodeURIComponent(connId)}&${bust}`);
        const data = res?.json ? await res.json() : res;
        if (data?.success) {
          setEngines(prev => ({ ...prev, [eng.id]: { available: !!data.available, version: data.version, extra: data.extra } }));
        }
      } catch (_) {}
    }
  }, [apiFetch]);

  useEffect(() => { loadResults(selectedConn); }, [selectedConn, loadResults]);
  useEffect(() => { loadEngineStatuses(selectedConn); }, [selectedConn, loadEngineStatuses]);

  // Stop a running background scan / uninstall an engine from the server
  const engineAction = async (engineId, action) => {
    if (!selectedConn || actingEngine) return;
    if (action === 'uninstall') {
      const engName = ENGINES.find(e => e.id === engineId)?.name;
      const ok = await askDialog({
        danger: true,
        title: `Uninstall ${engName}?`,
        message: `${engName} and its databases/config will be removed from the server. Any background scan is stopped first, and our temporary scan artifacts are cleaned up. You can reinstall anytime.`,
        confirmText: 'Uninstall',
      });
      if (!ok) return;
    }
    setError(null);
    setNotice(null);
    // Busy marker drives the spinner on the button — uninstall can take
    // 1-2 minutes (package purge), so visible progress is essential.
    setActingEngine(`${engineId}:${action}`);
    try {
      const res = await apiFetch('/api/virus-scan/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engineId, connectionId: selectedConn, action }),
      });
      const data = res?.json ? await res.json() : res;
      if (data?.success) {
        setNotice(data.message || (action === 'stop' ? 'Scan stopped' : 'Uninstalled'));
        // Optimistic flip: don't wait for the status round-trip to reflect
        // the change in the engine cards.
        if (action === 'uninstall') {
          setEngines(prev => ({ ...prev, [engineId]: { available: false, version: null, extra: null } }));
          setBgScans(prev => (engineId === 'wazuh' || engineId === 'wazuh-manager' ? { ...prev, wazuh: null } : prev));
        }
      } else {
        setError(data?.error || `${action} failed`);
      }
    } catch (e) {
      setError(e?.message || `${action} failed`);
    } finally {
      setActingEngine(null);
      // Refresh immediately, then again after a delay — the first GET can hit
      // SSH pool churn right after the uninstall channel closed.
      loadEngineStatuses(selectedConn);
      setTimeout(() => loadEngineStatuses(selectedConn), 3000);
    }
  };

  // Pull raw server-side scan state (tmux/procs/files/runners) for troubleshooting
  const loadDebug = useCallback(async () => {
    if (!selectedConn) return;
    try {
      const res = await apiFetch(`/api/virus-scan/engine?debug=1&connectionId=${encodeURIComponent(selectedConn)}`);
      const data = res?.json ? await res.json() : res;
      setDebugInfo(data?.output || data?.error || JSON.stringify(data));
    } catch (e) {
      setDebugInfo(`Failed: ${e?.message || e}`);
    }
  }, [selectedConn, apiFetch]);

  // Poll background scan (tmux) session status — Running / Done badges + notifications
  useEffect(() => {
    if (!selectedConn) return;
    let cancelled = false;
    const pollSessions = async () => {
      try {
        const res = await apiFetch(`/api/virus-scan/engine?tmux=1&connectionId=${encodeURIComponent(selectedConn)}&_=${Date.now()}`);
        const data = res?.json ? await res.json() : res;
        if (cancelled || !data?.success || !data.sessions) return;
        setBgScans(data.sessions);
      } catch (_) {}
    };
    pollSessions();
    const iv = setInterval(pollSessions, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [selectedConn, apiFetch]);

  // Badge states:
  //   running → amber spinner · done → green check · stopped → red x (killed/crashed, results incomplete)
  //   idle → gray dot (never run) · active → green pulse (Wazuh service) · null → hidden
  const SCAN_BADGE_STYLES = {
    running: { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: <Loader2 size={10} className="animate-spin" />, text: 'Scanning' },
    done:    { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: <CheckCircle2 size={10} />, text: 'Done' },
    stopped: { cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: <XCircle size={10} />, text: 'Stopped' },
    idle:    { cls: 'bg-white/[0.06] text-slate-400 border-white/10', icon: <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />, text: 'Idle' },
    active:  { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: <Activity size={10} />, text: 'Active' },
  };
  const ScanBadge = ({ id, label }) => {
    const v = bgScans[id];
    if (v === null || v === undefined) return null; // not installed / unknown
    const st = SCAN_BADGE_STYLES[v];
    if (!st) return null;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors ${st.cls}`}>
        {st.icon}
        {label}: {st.text}
        {/* Live stop control while a deep scan is running */}
        {(id === 'clamav' || id === 'maldet') && v === 'running' && (
          <button
            onClick={() => engineAction(id, 'stop')}
            title="Stop this background scan"
            className="ml-1 px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-rose-500/30 text-[9px] font-bold text-slate-200 hover:text-rose-100 transition-colors"
          >
            STOP
          </button>
        )}
      </span>
    );
  };

  const installEngine = async (engineId) => {
    if (!selectedConn || installingEngine) return;
    let managerIp;
    if (engineId === 'wazuh') {
      // Pre-fill with this server's own IP — a common setup is running the
      // Wazuh manager on the same box being monitored.
      managerIp = await askDialog({
        title: 'Wazuh manager address',
        message: 'The agent needs the IP of a Wazuh MANAGER server — it connects there to register and send security alerts. Only correct if a Wazuh manager actually runs at that address (e.g., pre-filled with the IP of this server when the manager runs on the same box). No manager yet? Cancel and skip Wazuh for now.',
        input: true,
        inputValue: selectedConnObj?.host || '',
        inputPlaceholder: 'e.g. 203.0.113.10',
        confirmText: 'Continue',
      });
      if (!managerIp) return;
    }
    const engName = ENGINES.find(e => e.id === engineId)?.name;
    const ok = await askDialog({
      title: `Install ${engName}?`,
      message: `${engName} will be installed on this server from its official source (~1-5 minutes).`,
      confirmText: 'Install',
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch('/api/virus-scan/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engineId, connectionId: selectedConn, managerIp }),
      });
      const data = res?.json ? await res.json() : res;
      if (data?.success && data.started) {
        // Installer launched in tmux on the server — start streaming its output
        setNotice(data.message || 'Installation started');
        setInstallLog('');
        setInstallingEngine(engineId);
      } else {
        setError(data?.error || 'Install failed');
      }
    } catch (e) {
      setError(e?.message || 'Install failed');
    }
  };

  // Stream the installer's live output while an install is running
  useEffect(() => {
    if (!installingEngine || !selectedConn) return;
    let cancelled = false;
    const engName = ENGINES.find(e => e.id === installingEngine)?.name || installingEngine;
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/virus-scan/engine?engine=${installingEngine}&connectionId=${encodeURIComponent(selectedConn)}&log=1`);
        const data = res?.json ? await res.json() : res;
        if (cancelled || !data?.success) return;
        setInstallLog(data.lines || '');
        if (data.done) {
          const out = data.lines || '';
          const failed = /INSTALL_FAIL|NOPM|NOCURL|NOSUDO_NOBIN|NOSUDO_NEEDPW|NETFAIL/.test(out);
          if (!failed) {
            setNotice(`${engName} installed successfully`);
            setError(null);
          } else {
            const detail = out.split(String.fromCharCode(10)).filter(Boolean).slice(-3).join(' | ').slice(0, 400);
            setError(`${engName} installation failed${detail ? ` — ${detail}` : ''}`);
            setNotice(null);
          }
          setInstallingEngine(null);
          loadEngineStatuses(selectedConn);
        }
      } catch (_) {}
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [installingEngine, selectedConn, apiFetch, loadEngineStatuses]);

  // Poll while a scan is running
  useEffect(() => {
    if (!scanning) return;
    const iv = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/virus-scan?connectionId=${encodeURIComponent(selectedConn)}&_=${Date.now()}`);
        const data = res?.json ? await res.json() : res;
        if (data?.success && data.latest) {
          setScan(data.latest);
          if (data.latest.status !== 'running') {
            setScanningMode(null);
            setProgressLabel('');
          } else {
            setProgressLabel(data.latest.currentCheck || '');
          }
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(iv);
  }, [scanning, selectedConn, apiFetch]);

  const startScan = async (mode = 'deep') => {
    if (!selectedConn || scanning) return;
    setScanningMode(mode);
    setError(null);
    setNotice(null);
    const labelMap = {
      quick: 'Quick scan — connecting…',
      deep: 'Deep scan — connecting…',
      full: 'FULL DISK scan — connecting… (this runs for a long time in the background)',
    };
    setProgressLabel(labelMap[mode] || 'Connecting…');
    try {
      const res = await apiFetch('/api/virus-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedConn, mode }),
      });
      const data = res?.json ? await res.json() : res;
      if (data?.success && data.scan) {
        setScan(data.scan);
        // The 2s status-poller may have already pulled this completed scan
        // into history via GET — de-dupe so React keys stay unique.
        setHistory(h => [data.scan, ...h.filter(x => x._id !== data.scan._id)].slice(0, 10));
      } else {
        // Friendly handling when a scan request is already in flight
        if (res?.status === 429 || /already in progress/i.test(data?.error || '')) {
          setNotice('A scan is still processing — the engines run detached, so results keep collecting. Try again in a moment.');
        } else {
          setError(data?.error || 'Scan failed');
        }
      }
    } catch (e) {
      setError(e?.message || 'Scan failed');
    } finally {
      setScanningMode(null);
      setProgressLabel('');
    }
  };

  const act = async (findingId, action) => {
    if (!scan) return;
    if (action === 'delete' || action === 'kill') {
      const ok = await askDialog({
        danger: true,
        title: action === 'kill' ? 'Terminate process?' : 'Delete permanently?',
        message: action === 'kill'
          ? `Process ${scan.findings.find(f => f._id === findingId)?.pid} will be force-killed immediately.`
          : 'The file will be permanently removed from the server. This cannot be undone.',
        confirmText: action === 'kill' ? 'Kill process' : 'Delete',
      });
      if (!ok) return;
    }
    setActingId(findingId);
    setNotice(null);
    try {
      const res = await apiFetch('/api/virus-scan/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: scan._id, findingId, action }),
      });
      const data = res?.json ? await res.json() : res;
      if (data?.success) {
        setNotice(data.message);
        setScan(s => ({
          ...s,
          findings: s.findings.map(f => f._id === findingId
            ? { ...f, status: action === 'quarantine' ? 'quarantined'
                : action === 'delete' ? 'deleted'
                : action === 'ignore' ? 'ignored'
                : action === 'restore' ? 'open'
                : 'resolved' }
            : f),
        }));
      } else {
        setError(data?.error || 'Action failed');
      }
    } catch (e) {
      setError(e?.message || 'Action failed');
    } finally {
      setActingId(null);
    }
  };

  const clearHistory = async () => {
    const ok = await askDialog({
      danger: true,
      title: 'Clear scan history?',
      message: 'All past scan records will be deleted. This cannot be undone.',
      confirmText: 'Clear history',
    });
    if (!ok) return;
    await apiFetch(`/api/virus-scan${selectedConn ? `?connectionId=${encodeURIComponent(selectedConn)}` : ''}`, { method: 'DELETE' });
    setScan(null); setHistory([]);
  };

  const visibleFindings = useMemo(() => {
    if (!scan?.findings) return [];
    const q = fQuery.trim().toLowerCase();
    const list = scan.findings.filter(f => {
      if (fStatus === 'open' && f.status !== 'open') return false;
      if (fStatus !== 'all' && fStatus !== 'open' && f.status !== fStatus) return false;
      if (fSev.length && !fSev.includes(f.severity)) return false;
      if (fCat.length && !fCat.includes(f.category)) return false;
      if (fEng.length && !fEng.includes(engineGroup(f.checkId))) return false;
      if (q && ![f.title, f.detail, f.path, f.evidence].filter(Boolean).some(t => String(t).toLowerCase().includes(q))) return false;
      return true;
    });
    return [...list].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  }, [scan, fStatus, fSev, fCat, fEng, fQuery]);

  const advFilterCount = fSev.length + fCat.length + fEng.length + (fQuery.trim() ? 1 : 0);
  const clearAdvFilters = () => { setFSev([]); setFCat([]); setFEng([]); setFQuery(''); };

  const summary = scan?.summary || { critical: 0, high: 0, medium: 0, low: 0 };
  const totalIssues = summary.critical + summary.high + summary.medium + summary.low;
  const openCount = scan?.findings?.filter(f => f.status === 'open').length ?? 0;

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-slate-200">
      {/* ===== Header: connection + actions ===== */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div data-onboarding="vs-server-select" className="min-w-0 flex-1 max-w-[280px]">
            <ThemeSelect
              value={selectedConn || ''}
              options={connOptions}
              onChange={(v) => setSelectedConn(v)}
              icon={ServerIcon}
              placeholder="Select server…"
            />
          </div>
          <button
            onClick={() => { loadResults(selectedConn); loadEngineStatuses(selectedConn); }}
            title="Refresh"
            className="shrink-0 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:border-indigo-500/40 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Progress */}
        {scanning && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${scan?.status === 'running' ? Math.max(5, scan.progress || 5) : 8}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 truncate flex items-center gap-1.5">
              <Terminal size={11} /> {progressLabel || 'Running checks…'} · heavy engine scans run in tmux capped at ~15% CPU
            </p>
          </div>
        )}

        {/* Tabs */}
        {!scanning && (
          <div className="flex items-center gap-1 mt-3 -mb-3">
            {[
              ['overview', 'Overview'],
              ['findings', `Findings${openCount > 0 ? ` (${openCount})` : ''}`],
              ['history', 'History'],
            ].map(([id, label]) => (
              <button
                key={id}
                data-onboarding={`vs-tab-${id}`}
                onClick={() => setTab(id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                  tab === id
                    ? 'text-indigo-300 border-indigo-400'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

        {tab === 'findings' && scan && scan.status !== 'failed' && (
          <div className="px-5 pt-4 pb-3 border-b border-white/5 bg-[#0b0e14]">
            <div className="flex flex-col items-center gap-2">
                  {/* Row 1: status chips + advanced toggle */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <FPill active={fStatus === 'open'} onClick={() => setFStatus('open')}>
                      Needs attention ({openCount})
                    </FPill>
                    <FPill active={fStatus === 'all'} onClick={() => setFStatus('all')}>
                      All ({scan.findings.length})
                    </FPill>
                    {STATUSES.map(s => {
                      const n = scan.findings.filter(f => f.status === s).length;
                      return n > 0 ? (
                        <FPill key={s} active={fStatus === s} onClick={() => setFStatus(s)}>
                          {s} ({n})
                        </FPill>
                      ) : null;
                    })}
                    <button
                      onClick={() => setShowAdv(a => !a)}
                      className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                        showAdv || advFilterCount
                          ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                          : 'bg-white/[0.04] text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      <Search size={10} /> Filters{advFilterCount ? ` (${advFilterCount})` : ''}
                      <ChevronDown size={10} className={`transition-transform ${showAdv ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Row 2+: advanced filters */}
                  {showAdv && (
                    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2 animate-in fade-in duration-200">
                      {/* Search */}
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          autoFocus
                          value={fQuery}
                          onChange={(e) => setFQuery(e.target.value)}
                          placeholder="Search title, path, detail…"
                          className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      {/* Severity */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-16">Severity</span>
                        {SEVS.map(s => (
                          <FPill key={s} active={fSev.includes(s)} cls={fSev.includes(s) ? SEV_PILL[s] : ''} onClick={() => setFSev(l => l.includes(s) ? l.filter(x => x !== s) : [...l, s])}>
                            {s}
                          </FPill>
                        ))}
                      </div>
                      {/* Source engine */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-16">Source</span>
                        {Object.entries(ENGINE_LABELS).map(([id, label]) => (
                          <FPill key={id} active={fEng.includes(id)} onClick={() => setFEng(l => l.includes(id) ? l.filter(x => x !== id) : [...l, id])}>
                            {label}
                          </FPill>
                        ))}
                      </div>
                      {/* Category */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-16">Category</span>
                        {CATS.map(c => (
                          <FPill key={c} active={fCat.includes(c)} onClick={() => setFCat(l => l.includes(c) ? l.filter(x => x !== c) : [...l, c])}>
                            {c}
                          </FPill>
                        ))}
                      </div>
                      {advFilterCount > 0 && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-indigo-300 font-medium">
                            {visibleFindings.length} of {scan.findings.length} findings match
                          </span>
                          <button onClick={clearAdvFilters} className="text-[10px] font-semibold text-slate-400 hover:text-slate-200 underline underline-offset-2 transition-colors">
                            Clear filters
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
          </div>
        )}

      {/* ===== Body ===== */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25">
            <XCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-200 break-words">{error}</p>
          </div>
        )}
        {notice && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-200 break-words">{notice}</p>
          </div>
        )}

        {/* ---------- OVERVIEW TAB ---------- */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* ── Scan action bar (moved out of header for clean layout) ── */}
            <div data-onboarding="vs-run-modes" className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-1">Run scan:</span>
              <div className="relative group shrink-0" data-onboarding="vs-quick">
                <button
                  onClick={() => startScan('quick')}
                  disabled={scanning || !selectedConn}
                  className="w-24 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-medium text-emerald-200 transition-colors disabled:opacity-50"
                >
                  {scanningMode === 'quick' ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  {scanningMode === 'quick' ? 'Quick…' : 'Quick'}
                </button>
                <div className="pointer-events-none absolute left-0 top-full mt-2 w-72 rounded-xl border border-white/10 bg-[#141824] shadow-2xl shadow-black/60 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                  <p className="text-[11px] font-bold text-emerald-300 mb-1.5">⚡ Quick Scan checks for:</p>
                  <ul className="space-y-1 text-[10px] text-slate-300 leading-relaxed list-disc pl-4">
                    <li>Cryptominer processes</li>
                    <li>Malware dropped in /tmp & /dev/shm</li>
                    <li>Malicious cron jobs</li>
                    <li>Backdoor SSH keys & weak root login</li>
                    <li>Brute-force attacks</li>
                    <li>Suspicious network connections</li>
                  </ul>
                  <p className="mt-2 text-[9px] text-slate-500">Also collects results from any finished ClamAV/LMD scan.</p>
                </div>
              </div>
              <div className="relative group shrink-0">
                <button
                  onClick={() => startScan('deep')}
                  disabled={scanning || !selectedConn}
                  className="w-24 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-xs font-medium text-indigo-200 transition-colors disabled:opacity-50"
                >
                  {scanningMode === 'deep' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  {scanningMode === 'deep' ? 'Deep…' : 'Deep'}
                </button>
                <div className="pointer-events-none absolute left-0 top-full mt-2 w-72 rounded-xl border border-white/10 bg-[#141824] shadow-2xl shadow-black/60 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                  <p className="text-[11px] font-bold text-indigo-300 mb-1.5">🧭 Deep Scan = everything in Quick, plus:</p>
                  <ul className="space-y-1 text-[10px] text-slate-300 leading-relaxed list-disc pl-4">
                    <li>ClamAV antivirus on /tmp, /var/tmp, /dev/shm, /root, /home, /opt, /srv (background)</li>
                    <li>LMD web-malware scan on /tmp, /var/tmp, /dev/shm (background)</li>
                    <li>Recently modified SUID root binaries</li>
                    <li>Wazuh security alerts (level 7+)</li>
                  </ul>
                </div>
              </div>
              <div className="relative group shrink-0">
                <button
                  onClick={() => startScan('full')}
                  disabled={scanning || !selectedConn}
                  className="w-24 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-medium text-rose-200 transition-colors disabled:opacity-50"
                >
                  {scanningMode === 'full' ? <Loader2 size={13} className="animate-spin" /> : <HardDrive size={13} />}
                  {scanningMode === 'full' ? 'Full…' : 'Full'}
                </button>
                <div className="pointer-events-none absolute left-0 top-full mt-2 w-72 rounded-xl border border-white/10 bg-[#141824] shadow-2xl shadow-black/60 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                  <p className="text-[11px] font-bold text-rose-300 mb-1.5">💾 Full Scan = everything in Deep, but:</p>
                  <ul className="space-y-1 text-[10px] text-slate-300 leading-relaxed list-disc pl-4">
                    <li>ClamAV checks the ENTIRE disk (/) — web roots, /etc, /usr/local, every file</li>
                    <li>Bigger file allowance (250MB per file)</li>
                    <li>Takes the longest — runs in the background for hours</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ── Engine status badges (top of page for instant visibility) ── */}
            <div data-onboarding="vs-status-badges" className="flex items-center gap-2 flex-wrap">
              <ScanBadge id="clamav" label="ClamAV deep scan" />
              <ScanBadge id="maldet" label="LMD malware scan" />
              <ScanBadge id="wazuh" label="Wazuh HIDS" />
              <button
                onClick={loadDebug}
                className="ml-auto text-[10px] text-slate-600 hover:text-slate-300 underline underline-offset-2 transition-colors"
              >
                Server diagnostics
              </button>
              <button
                onClick={() => { resetVirusScanOnboarding(); ensureMaximizedThenShowRef.current(); }}
                title="Show guided tour"
                className="inline-flex items-center gap-1 text-[10px] text-slate-600 hover:text-indigo-300 underline underline-offset-2 transition-colors"
              >
                <Bug size={10} /> Guide
              </button>
            </div>

            {/* Hero status card */}
            <div className={`rounded-2xl border p-5 ${
              scanning ? 'bg-indigo-500/[0.07] border-indigo-500/25'
              : totalIssues > 0 ? 'bg-rose-500/[0.07] border-rose-500/25'
              : scan ? 'bg-emerald-500/[0.07] border-emerald-500/25'
              : 'bg-white/[0.03] border-white/10'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border ${
                  scanning ? 'bg-indigo-500/15 border-indigo-500/30'
                  : totalIssues > 0 ? 'bg-rose-500/15 border-rose-500/30'
                  : scan ? 'bg-emerald-500/15 border-emerald-500/30'
                  : 'bg-white/[0.04] border-white/10'
                }`}>
                  {scanning ? <Loader2 size={26} className="text-indigo-300 animate-spin" />
                    : totalIssues > 0 ? <ShieldAlert size={26} className="text-rose-300" />
                    : scan ? <ShieldCheck size={26} className="text-emerald-300" />
                    : <Bug size={26} className="text-slate-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-slate-100 leading-tight">
                    {scanning ? 'Scanning in progress…'
                      : !scan ? 'No scans yet'
                      : totalIssues > 0 ? `${totalIssues} issue${totalIssues === 1 ? '' : 's'} detected`
                      : 'All clear'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {scan?.host ? `${scan.host} · ` : ''}
                    {scan ? `last scanned ${timeAgo(scan.createdAt)}${scan.durationMs ? ` in ${(scan.durationMs / 1000).toFixed(1)}s` : ''}` : 'run your first scan to check for threats'}
                  </p>
                </div>
                {scan && !scanning && (
                  <button
                    onClick={() => setTab('findings')}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors"
                  >
                    View findings →
                  </button>
                )}
              </div>

              {/* Severity breakdown */}
              {scan && scan.status === 'completed' && (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {(['critical', 'high', 'medium', 'low']).map(sev => {
                    const S = SEVERITY[sev];
                    return (
                      <div key={sev} className={`rounded-xl border ${S.border} ${S.bg} px-3 py-2.5`}>
                        <div className="flex items-center gap-1.5">
                          <S.Icon size={12} className={S.color} />
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${S.color}`}>{S.label}</span>
                        </div>
                        <p className="text-xl font-bold text-slate-100 mt-1">{summary[sev]}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trusted engines */}
            <div data-onboarding="vs-trusted-engines">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Trusted detection engines</p>
              <div className="space-y-2">
                {ENGINES.map(eng => {
                  const st = engines[eng.id];
                  const busy = installingEngine === eng.id;
                  return (
                    <div key={eng.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                      st?.available ? 'bg-emerald-500/[0.06] border-emerald-500/20' : 'bg-white/[0.02] border-white/10'
                    }`}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        st?.available ? 'bg-emerald-500/15' : 'bg-white/[0.04]'
                      }`}>
                        {st?.available
                          ? <BadgeCheck size={16} className="text-emerald-300" />
                          : busy ? <Loader2 size={16} className="text-amber-300 animate-spin" />
                          : <Download size={16} className="text-slate-600" />}
                      </div>
                      <div className="flex-1 min-w-0 leading-snug">
                        <p className="text-[13px] font-medium text-slate-100">
                          {eng.name}
                          {st?.available && st.version ? <span className="ml-2 text-[11px] font-normal text-emerald-300/80">{st.version}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {busy ? 'Installing on server (~1-5 min)…' : st?.available ? eng.desc : `${eng.desc} — not installed`}
                        </p>
                      </div>
                      {st?.available && (
                        <button
                          onClick={() => engineAction(eng.id, 'uninstall')}
                          disabled={!!installingEngine}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30 text-[11px] font-medium text-slate-400 hover:text-rose-300 transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={11} /> Uninstall
                        </button>
                      )}
                      {st && !st.available && (
                        <button
                          onClick={() => installEngine(eng.id)}
                          disabled={!!installingEngine}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-medium text-amber-100 transition-colors disabled:opacity-50"
                        >
                          <Download size={11} /> Install
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-slate-600 flex items-center gap-1.5">
                <Cpu size={10} /> Engine scans run in detached tmux sessions capped at ~15% total CPU (single-threaded, idle-class disk I/O) — they never slow down production workloads and survive disconnects.
              </p>

              {/* Live install terminal preview */}
              {installingEngine && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/70 overflow-hidden shadow-lg shadow-black/40">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.04]">
                    <span className="flex gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                    </span>
                    <span className="text-[11px] font-medium text-slate-300 ml-1">
                      Installing {ENGINES.find(e => e.id === installingEngine)?.name} — live output
                    </span>
                    <Loader2 size={11} className="animate-spin text-slate-500 ml-auto" />
                  </div>
                  <pre className="p-3 text-[10px] leading-relaxed text-emerald-200/80 font-mono overflow-y-auto max-h-56 whitespace-pre-wrap break-all">
                    {installLog || 'Starting installer…'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- FINDINGS TAB ---------- */}
        {tab === 'findings' && (
          <>
            {!scan ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <Bug size={28} className="text-slate-700 mb-3" />
                <p className="text-sm font-medium text-slate-400">No scans yet</p>
                <p className="text-xs text-slate-600 mt-1 max-w-[280px]">
                  Run a scan to check this server for cryptominers, malware droppers, suspicious cron jobs, backdoor SSH keys and more.
                </p>
              </div>
            ) : scan.status === 'failed' ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <XCircle size={28} className="text-rose-400 mb-3" />
                <p className="text-sm font-medium text-rose-300">Scan failed</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[280px] break-words">{scan.error}</p>
              </div>
            ) : (
              <>

                {visibleFindings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12">
                    <ShieldCheck size={32} className="text-emerald-400 mb-3" />
                    <p className="text-sm font-medium text-emerald-300">All clear</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {fStatus === 'open' ? 'No unresolved findings on this server.' : 'Nothing matches the current filters.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {visibleFindings.map(f => {
                      const S = SEVERITY[f.severity] || SEVERITY.low;
                      const SB = STATUS_BADGE[f.status] || STATUS_BADGE.open;
                      const busy = actingId === f._id;
                      return (
                        <div key={f._id} className={`rounded-xl border ${S.border} ${S.bg} p-3.5`}>
                          <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-black/20">
                              <S.Icon size={14} className={S.color} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-[13px] font-medium text-slate-100 leading-snug">{f.title}</p>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${SB.cls}`}>{SB.label}</span>
                                {(f.checkId === 'clamav-signatures' || f.checkId === 'maldet-scan') && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                                    <BadgeCheck size={9} /> Trusted engine
                                  </span>
                                )}
                                {f.checkId === 'wazuh-alerts' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[10px] font-semibold">
                                    <BadgeCheck size={9} /> Wazuh HIDS
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{f.detail}</p>
                              {f.path && (
                                <p className="text-[11px] text-slate-500 mt-1.5 font-mono break-all">{f.path}{f.pid ? ` · PID ${f.pid}` : ''}</p>
                              )}
                              <Evidence text={f.evidence} />

                              {/* Actions */}
                              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                                {busy ? (
                                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                                    <Loader2 size={12} className="animate-spin" /> Working…
                                  </span>
                                ) : (
                                  <>
                                    {f.pid && f.status === 'open' && (
                                      <button onClick={() => act(f._id, 'kill')} className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-[11px] font-medium text-rose-200 transition-colors">
                                        Kill process
                                      </button>
                                    )}
                                    {f.checkId === 'ssh-root-login' && f.status === 'open' && (
                                      <button onClick={() => act(f._id, 'harden-ssh')} title="Set PermitRootLogin prohibit-password and reload sshd (config is backed up first)" className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-[11px] font-medium text-emerald-200 transition-colors">
                                        Harden SSH
                                      </button>
                                    )}
                                    {FILE_CHECKS.has(f.checkId) && f.path && f.path !== 'crontab' && f.status === 'open' && (
                                      <>
                                        <button onClick={() => act(f._id, 'quarantine')} className="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-[11px] font-medium text-violet-200 transition-colors">
                                          Quarantine
                                        </button>
                                        <button onClick={() => act(f._id, 'delete')} className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-[11px] font-medium text-rose-200 transition-colors">
                                          Delete
                                        </button>
                                      </>
                                    )}
                                    {f.status === 'quarantined' && (
                                      <>
                                        <button onClick={() => act(f._id, 'restore')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[11px] font-medium text-slate-200 transition-colors">
                                          <ArchiveRestore size={11} /> Restore
                                        </button>
                                        <button onClick={() => act(f._id, 'delete')} className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-[11px] font-medium text-rose-200 transition-colors">
                                          Delete permanently
                                        </button>
                                      </>
                                    )}
                                    {f.status === 'open' && (
                                      <button onClick={() => act(f._id, 'ignore')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-white/[0.06] text-[11px] text-slate-400 hover:text-slate-200 transition-colors">
                                        <EyeOff size={11} /> Ignore
                                      </button>
                                    )}
                                    {f.quarantinePath && (
                                      <span className="text-[10px] text-slate-600 font-mono truncate max-w-[220px]" title={f.quarantinePath}>→ {f.quarantinePath}</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ---------- HISTORY TAB ---------- */}
        {tab === 'history' && (
          <>
            {/* Background engine scan status */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] text-slate-500 mr-1">Background scans:</span>
              <ScanBadge id="clamav" label="ClamAV deep scan" />
              <ScanBadge id="maldet" label="LMD malware scan" />
              <ScanBadge id="wazuh" label="Wazuh HIDS" />
            </div>
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <Clock3 size={28} className="text-slate-700 mb-3" />
                <p className="text-sm font-medium text-slate-400">No scan history</p>
              </div>
            ) : (
              <>
                <div className="flex justify-end mb-2">
                  <button
                    onClick={clearHistory}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 text-[11px] text-slate-400 hover:text-rose-300 transition-colors"
                  >
                    <Trash2 size={11} /> Clear history
                  </button>
                </div>
                <div className="space-y-1.5">
                  {history.map((h, i) => (
                    <div key={`${h._id}-${i}`} className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                      <span className="inline-flex items-center gap-2 text-xs text-slate-300 min-w-0">
                        <ServerIcon size={12} className="text-slate-600 shrink-0" />
                        <span className="truncate">{h.host || 'server'}</span>
                        {h.mode === 'quick' && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold uppercase tracking-wide">
                            <Zap size={8} /> quick
                          </span>
                        )}
                        {h.mode === 'full' && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 text-[9px] font-bold uppercase tracking-wide">
                            <HardDrive size={8} /> full
                          </span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-3 shrink-0">
                        {h.summary?.critical > 0 && <span className="text-[11px] text-rose-300">{h.summary.critical} critical</span>}
                        {h.summary?.high > 0 && <span className="text-[11px] text-orange-300">{h.summary.high} high</span>}
                        {h.summary?.medium > 0 && <span className="text-[11px] text-amber-300">{h.summary.medium} med</span>}
                        {h.summary?.low > 0 && <span className="text-[11px] text-sky-300">{h.summary.low} low</span>}
                        {!(h.summary?.critical || h.summary?.high || h.summary?.medium || h.summary?.low) && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300"><Activity size={10} /> clean</span>
                        )}
                        <span className="text-[11px] text-slate-600 w-16 text-right">{timeAgo(h.createdAt)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* NOTE: scan-finished banners are desktop-wide now — see GlobalScanNotifications.
          Notification preferences live in the Settings app. */}
      {/* Server diagnostics modal */}
      {debugInfo !== null && (
        <div
          className="absolute inset-0 z-[150] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDebugInfo(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#141824] border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/5">
              <h4 className="text-sm font-semibold text-slate-100">Server-side scan state</h4>
              <button onClick={() => setDebugInfo(null)} className="text-slate-500 hover:text-slate-200 transition-colors"><X size={14} /></button>
            </div>
            <pre className="p-4 text-[10px] leading-relaxed text-emerald-200/80 font-mono overflow-auto max-h-80 whitespace-pre-wrap break-all">{debugInfo}</pre>
            <div className="flex justify-end gap-2 px-5 pb-4">
              <button onClick={loadDebug} className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-xs text-slate-300 transition-colors">Refresh</button>
              <button onClick={() => setDebugInfo(null)} className="px-3 py-1.5 rounded-lg bg-indigo-500/25 hover:bg-indigo-500/35 text-xs text-indigo-100 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Themed dialog */}
      <ConfirmModal modal={modal} onClose={closeModal} />

      {/* Guided onboarding tour (same spotlight style as Firewall/Docker) */}
      {showOnboarding && (
        <VirusScanOnboarding onComplete={() => setShowOnboarding(false)} />
      )}

    </div>
  );
}
