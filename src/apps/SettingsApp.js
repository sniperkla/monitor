'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';

function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}
import { 
  Palette, Image as ImageIcon, Monitor, Layout, Bell, Shield, Info, 
  Database, CheckCircle, AlertCircle, RefreshCw, Zap, Wifi, WifiOff, Server, Box, Package,
  Loader, Trash2, Lock, Unlock, Key, Mail, Code, Volume2, Sun, Moon, Cpu,
  Search, Terminal, Network, Download, Copy, X, CheckCheck, Sparkles,
  GitBranch, GitCommit, ChevronDown, Settings, Send, Music, ChevronRight, Globe, LogOut, Check,
  RotateCcw, Menu
} from 'lucide-react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/hooks/useIsMobile';

import { motion, AnimatePresence } from 'framer-motion';
import ShortcutInput from '@/components/Desktop/ShortcutInput';

/* ─── Production-grade reusable UI primitives ─── */

function SettingsCard({ children, className = '', noPad = false }) {
  return (
    <div className={`rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm ${noPad ? '' : 'p-5'} ${className}`}>
      {children}
    </div>
  );
}

function SettingsSectionTitle({ icon: Icon, iconColor = 'text-indigo-400', title, description }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
            <Icon size={18} className={iconColor} />
          </div>
        )}
        <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">{title}</h2>
      </div>
      {description && <p className="text-xs text-[var(--text-muted)] mt-1.5 ml-12 leading-relaxed">{description}</p>}
    </div>
  );
}

function Toggle({ value, onChange, accent = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    blue: 'bg-blue-500',
  };
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${value ? colors[accent] || colors.indigo : 'bg-[var(--bg-tertiary)]'}`}
      style={{ border: value ? 'none' : '1px solid var(--border-color)' }}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function PillButton({ active, onClick, children, accent = 'indigo', className = '' }) {
  const accents = {
    indigo: active ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-400 shadow-sm shadow-indigo-500/10' : '',
    emerald: active ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-sm shadow-emerald-500/10' : '',
    amber: active ? 'bg-amber-500/15 border-amber-500/50 text-amber-400 shadow-sm shadow-amber-500/10' : '',
    rose: active ? 'bg-rose-500/15 border-rose-500/50 text-rose-400 shadow-sm shadow-rose-500/10' : '',
  };
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-150 cursor-pointer ${
        active
          ? accents[accent] || accents.indigo
          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function SettingRow({ label, description, children, noBorder = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-4 ${noBorder ? '' : 'border-b border-[var(--border-color)]/50'}`}>
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
        {description && <span className="block text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">{description}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const WALLPAPERS = [
  { id: 'space', name: 'Space Earth', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop' },
  { id: 'cyberpunk', name: 'Cyberpunk City', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop' },
  { id: 'abstract', name: 'Abstract Deep', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop' },
  { id: 'mountain', name: 'Night Mountain', url: 'https://images.unsplash.com/photo-1534067783941-51c9c23ecefd?q=80&w=2187&auto=format&fit=crop' },
  { id: 'os-dark', name: 'Premium Dark', url: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1974&auto=format&fit=crop' },
];

const PRESETS = [
  { label: 'Local (127.0.0.1)', uri: 'mongodb://127.0.0.1:27017/ssh-monitor' },
  { label: 'Local (localhost)', uri: 'mongodb://localhost:27017/ssh-monitor' },
];

function normalizeGitHubRepo(value) {
  if (!value) return '';
  const raw = value.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      if (parsed.hostname.toLowerCase().includes('github.com')) {
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
      }
    }
  } catch (err) {
    // if URL parsing fails, fall back to plain text
  }
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed;
}

function normalizeBitbucketRepo(value) {
  if (!value) return '';
  const raw = value.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      if (parsed.hostname.toLowerCase().includes('bitbucket.org')) {
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
      }
    }
  } catch (err) {}
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed;
}

export default function SettingsApp({ initialTab, deploymentOnly = false, openRelayWizard = false }) {
  const [activeTab, setActiveTab] = useState(initialTab || (deploymentOnly ? 'deployment' : 'appearance'));
  const { data: session } = useSession();
  const { t, i18n } = useTranslation();
  const { state: osState, setWallpaper, setGlassmorphism, setIconSize, setIconStyle, setBrightness, setUiScale, setNotifications, setLanguage, setTheme, setTaskbarPosition, setWindowLayout, addCustomWallpaper, removeCustomWallpaper, saveSettings, addNotification, showConfirm, setKeyboardShortcuts, setTerminalSettings } = useOS();
  const { state: appState, dispatch, apiFetch, fetchConnections } = useApp();
  const { vaultStatus, decryptedUri, lockVault, clearVault, setupVault, showVault } = useVault();
  const { glassmorphism, brightness, uiScale, notifications } = osState;

  // Database config state (for non-vault / legacy mode)
  const [dbUri, setDbUri] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbConnecting, setDbConnecting] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);

  // Vault setup state (for logged-in users)
  const [vaultUri, setVaultUri] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultConfirm, setVaultConfirm] = useState('');
  const [vaultSaving, setVaultSaving] = useState(false);

  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // For mobile/small window view

  // Auto-open sidebar on desktop
  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (deploymentOnly) {
      setActiveTab('deployment');
    }
  }, [deploymentOnly]);

  // Local Relay Agent state
  const [relayToken, setRelayToken] = useState(null);
  const [relayConnected, setRelayConnected] = useState(false);
  const [relays, setRelays] = useState([]);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayModalOpen, setRelayModalOpen] = useState(openRelayWizard); // Auto-open if requested
  const [relayWaiting, setRelayWaiting] = useState(false);
  const [relayInstallSuccess, setRelayInstallSuccess] = useState(false);
  // Wizard step: 1 = generate token, 2 = install, 3 = success
  const [relayWizardStep, setRelayWizardStep] = useState(1);
  // Set of relay IDs that were already connected before starting the wizard
  const [existingRelayIds, setExistingRelayIds] = useState(new Set());
  // The relay this browser prefers to route through (saved in localStorage)
  const [preferredRelay, setPreferredRelay] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_preferred_relay') || null) : null
  );

  const [sshMode, setSshMode] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_ssh_mode') || 'server') : 'server'
  );

  useEffect(() => {
    const handleSshModeChange = () => {
      setSshMode(localStorage.getItem('ssh_monitor_ssh_mode') || 'server');
    };
    window.addEventListener('ssh-mode-changed', handleSshModeChange);
    return () => {
      window.removeEventListener('ssh-mode-changed', handleSshModeChange);
    };
  }, []);

  // Detect PWA (standalone) mode
  const isPWA = useMemo(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches, []);

  // Deployment configuration state
  const [deployConfig, setDeployConfig] = useState({
    id: 'default',
    name: 'Default Project',
    enabled: false,
    branch: 'main',
    secret: '',
    targetType: 'local',
    connectionId: '',
    deployCommand: '',
    projectPath: '.',
    timeoutSeconds: 600,
    status: 'idle',
    lastDeployLog: '',
    lastDeployAt: null,
    aiProfile: null,
    aiLogs: [],
    aiModel: 'auto',
    aiCustomModel: '',
    aiEndpoint: '',
    aiApiKey: '',
    githubConnected: false,
    githubUser: '',
    bitbucketConnected: false,
    bitbucketUser: '',
    telegramNotification: false,
    telegramBotToken: '',
    telegramChatId: ''
  });
  const [deployProjects, setDeployProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('default');
  const [connections, setConnections] = useState([]);
  const [deployLoading, setDeployLoading] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropdownIndex, setProjectDropdownIndex] = useState(0);
  const projectDropdownRef = useRef(null);
  const projectSearchRef = useRef(null);
  const [logSearch, setLogSearch] = useState('');
  const [logSearchIndex, setLogSearchIndex] = useState(0);
  const logContainerRef = useRef(null);

  // Telegram auto-fetch & test notification states
  const [telegramLoadingChats, setTelegramLoadingChats] = useState(false);
  const [telegramChats, setTelegramChats] = useState([]);
  const [telegramBotInfo, setTelegramBotInfo] = useState(null);
  const [telegramFetchError, setTelegramFetchError] = useState('');
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState(null);

  // Filtered projects for searchable dropdown
  const filteredProjects = useMemo(() => {
    const q = projectSearch.toLowerCase().trim();
    if (!q) return deployProjects;
    return deployProjects.filter(p =>
      p.id.toLowerCase().includes(q) || (p.name && p.name.toLowerCase().includes(q))
    );
  }, [deployProjects, projectSearch]);

  // Close project dropdown on click outside
  useEffect(() => {
    if (!projectDropdownOpen) return;
    const handler = (e) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target)) {
        setProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [projectDropdownOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (projectDropdownOpen && projectSearchRef.current) {
      projectSearchRef.current.focus();
    }
  }, [projectDropdownOpen]);

  // Reset dropdown index when filtered results change
  useEffect(() => {
    setProjectDropdownIndex(0);
  }, [projectSearch]);

  const selectedConnection = deployConfig.targetType === 'ssh' && deployConfig.connectionId
    ? connections.find(c => c._id === deployConfig.connectionId)
    : null;
  const selectedConnectionMissing = deployConfig.targetType === 'ssh' && deployConfig.connectionId && !selectedConnection;
  const isDeployFailed = deployConfig.status === 'failed';

  // Compute readiness status for a deploy config
  const getReadinessStatus = (config) => {
    if (!config || !config.enabled) return { status: 'disabled', missing: [] };
    const missing = [];
    const cmd = (config.deployCommand || '').trim();
    if (!cmd || cmd === '# Enter your deployment shell script here\n# e.g., git pull && npm run build') {
      missing.push('deploy command');
    }
    if (!(config.githubConnected || config.bitbucketConnected)) {
      missing.push('git provider');
    }
    if (!config.branch?.trim()) {
      missing.push('branch');
    }
    if (config.targetType === 'ssh' && !config.connectionId) {
      missing.push('SSH connection');
    }
    return { status: missing.length === 0 ? 'ready' : 'incomplete', missing };
  };

  const readiness = getReadinessStatus(deployConfig);

  const [deploySaving, setDeploySaving] = useState(false);
  const [deployTriggering, setDeployTriggering] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [directCopySuccess, setDirectCopySuccess] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [deploymentTab, setDeploymentTab] = useState('configuration');
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [commits, setCommits] = useState([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [showCommitSelector, setShowCommitSelector] = useState(false);
  const prevDeployStatusRef = useRef(null);
  const [gitProvider, setGitProvider] = useState('github');
  const [bbUsername, setBbUsername] = useState('');
  const [bbAppPassword, setBbAppPassword] = useState('');
  const [bbConnecting, setBbConnecting] = useState(false);
  const [bbRepos, setBbRepos] = useState([]);
  const [loadingBbRepos, setLoadingBbRepos] = useState(false);
  const savedDeployConfigRef = useRef(null);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState(null);

  // Track unsaved deploy config changes
  const hasUnsavedDeployChanges = (() => {
    if (!savedDeployConfigRef.current) return false;
    const saved = savedDeployConfigRef.current;
    const fields = ['name', 'enabled', 'branch', 'targetType', 'connectionId', 'deployCommand', 'projectPath', 'timeoutSeconds', 'bitbucketRepo', 'githubRepo', 'secret', 'telegramNotification', 'telegramBotToken', 'telegramChatId', 'aiEndpoint', 'aiApiKey', 'aiCustomModel'];
    return fields.some(f => (deployConfig[f] || '') !== (saved[f] || ''));
  })();

  const sectionChanged = (fields) => {
    if (!savedDeployConfigRef.current) return false;
    const saved = savedDeployConfigRef.current;
    return fields.some(f => (deployConfig[f] || '') !== (saved[f] || ''));
  };
  const triggerChanged = sectionChanged(['branch', 'bitbucketRepo', 'githubRepo', 'secret', 'enabled']);
  const commandChanged = sectionChanged(['deployCommand']);
  const targetChanged = sectionChanged(['targetType', 'connectionId', 'projectPath', 'timeoutSeconds']);
  const telegramChanged = sectionChanged(['telegramNotification', 'telegramBotToken', 'telegramChatId']);
  const aiChanged = sectionChanged(['aiEndpoint', 'aiApiKey', 'aiCustomModel']);
  const repoChanged = (() => {
    if (!savedDeployConfigRef.current) return false;
    const saved = savedDeployConfigRef.current;
    const savedRepo = gitProvider === 'bitbucket' ? (saved.bitbucketRepo || '') : (saved.githubRepo || '');
    return repoInput !== savedRepo;
  })();

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!hasUnsavedDeployChanges) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedDeployChanges]);

  // Track last fetched combo to avoid redundant re-fetches
  const deployFetchKeyRef = React.useRef(null);
  const deployFetchInProgressRef = React.useRef(false);

  // Fetch deployment config + SSH connections (only when tab or project changes)
  useEffect(() => {
    if (activeTab !== 'deployment') return;
    const fetchKey = `${activeTab}:${selectedProjectId}`;
    // Avoid refetching if already loading or already fetched for this key
    if (deployFetchInProgressRef.current) return;
    if (deployFetchKeyRef.current === fetchKey) return;

    const fetchDeployData = async () => {
      deployFetchInProgressRef.current = true;
      setDeployLoading(true);
      setWebhookTestResult(null);
      try {
          const configRes = await apiFetch(`/api/deploy/config?project=${selectedProjectId}`);
          const configData = await configRes.json();
          if (configData.success && configData.config) {
            const loadedConfig = {
              ...configData.config,
              projectPath: configData.config.projectPath || '.',
              timeoutSeconds: configData.config.timeoutSeconds || 600,
              aiProfile: configData.config.aiProfile || null,
              aiLogs: configData.config.aiLogs || [],
              githubConnected: configData.config.githubConnected || false,
              githubUser: configData.config.githubUser || '',
              githubRepo: configData.config.githubRepo || '',
              bitbucketRepo: configData.config.bitbucketRepo || ''
            };
            setDeployConfig(prev => ({ ...prev, ...loadedConfig }));
            savedDeployConfigRef.current = loadedConfig;
            const isBitbucket = !!configData.config.bitbucketConnected;
            const activeRepo = isBitbucket
              ? (configData.config.bitbucketRepo || '')
              : (configData.config.githubRepo || '');
            setRepoInput(activeRepo);
            if (isBitbucket) setGitProvider('bitbucket');
            else setGitProvider('github');

            if (activeRepo) {
              const fetchBranches = async () => {
                try {
                  const param = `repo=${encodeURIComponent(activeRepo)}&project=${encodeURIComponent(selectedProjectId)}`;
                  const endpoint = isBitbucket ? '/api/deploy/bitbucket/branches' : '/api/deploy/github/branches';
                  const res = await apiFetch(`${endpoint}?${param}`);
                  const data = await res.json();
                  if (data.success && data.branches) {
                    setBranches(data.branches);
                  }
                } catch (err) {
                  console.error('Failed to auto-load branches:', err);
                }
              };
              fetchBranches();
            } else if (isBitbucket && configData.config.bitbucketConnected) {
              const fetchRepos = async () => {
                setLoadingBbRepos(true);
                try {
                  const res = await apiFetch(`/api/deploy/bitbucket/repos?project=${encodeURIComponent(selectedProjectId)}`);
                  const data = await res.json();
                  if (data.success && data.repos) {
                    setBbRepos(data.repos);
                  }
                } catch (err) {
                  console.error('Failed to auto-load Bitbucket repos:', err);
                }
                setLoadingBbRepos(false);
              };
              fetchRepos();
            }
          }

          const listRes = await apiFetch('/api/deploy/config');
          const listData = await listRes.json();
          if (listData.success && listData.projects) {
            setDeployProjects(listData.projects);
          }

          // Fetch SSH connections
          let sshConns = [];
          try {
            const sshRes = await apiFetch('/api/deploy/ssh-connections');
            const sshData = await sshRes.json();
            if (sshData.success && sshData.connections) {
              sshConns = sshData.connections;
            } else if (sshData.relayRequired) {
              console.warn('SSH connections via relay not available, falling back to server DB');
              throw new Error('Relay not available');
            }
          } catch (relayErr) {
            try {
              const connRes = await apiFetch('/api/connections');
              const connData = await connRes.json();
              if (connData.success && connData.data) {
                sshConns = connData.data.filter(c => c.type === 'ssh');
              }
            } catch (e) {
              console.error('Failed to load SSH connections:', e);
            }
          }
          if (sshConns.length === 0) fetchConnections();
          if (sshConns.length > 0) setConnections(sshConns);
          deployFetchKeyRef.current = fetchKey;
        } catch (err) {
          console.error('Failed to load deployment data:', err);
        }
        deployFetchInProgressRef.current = false;
        setDeployLoading(false);
      };
      fetchDeployData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedProjectId]);

  // Separately sync SSH connection list from global AppContext whenever it updates
  // (does NOT re-fetch deploy config — avoids resetting connectionId)
  useEffect(() => {
    if (activeTab !== 'deployment') return;
    if (appState.connections.length === 0) return;
    setConnections(prev => {
      const global = appState.connections.filter(c => c.type === 'ssh');
      // Only update if the global list has more/different entries than what we have
      if (global.length > prev.length) return global;
      return prev;
    });
  }, [activeTab, appState.connections]);

  // Real-time Server-Sent Events for deployment status
  useEffect(() => {
    if (activeTab !== 'deployment') return;

    const eventSource = new EventSource(`/api/deploy/sse?project=${selectedProjectId}`);
    console.log(`[SSE] Connected for project: ${selectedProjectId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Received:', data);
        
        // Show notification when deployment finishes (transitions from running to success/failed)
        if (prevDeployStatusRef.current === 'running' && data.status !== 'running') {
          addNotification({
            title: `Deploy ${data.status === 'success' ? 'Succeeded' : 'Failed'}`,
            message: `Deployment finished with status: ${data.status}`,
            type: data.status === 'success' ? 'success' : 'error'
          });
        }

        prevDeployStatusRef.current = data.status;
        
        setDeployConfig(prev => ({
          ...prev,
          status: data.status,
          lastDeployLog: data.lastDeployLog,
          lastDeployAt: data.lastDeployAt,
          ...(data.lastDeployedCommitSha !== undefined ? { lastDeployedCommitSha: data.lastDeployedCommitSha } : {})
        }));
      } catch (err) {
        console.error('[SSE] Failed to parse message:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      eventSource.close();
    };

    return () => {
      console.log(`[SSE] Disconnected for project: ${selectedProjectId}`);
      eventSource.close();
    };
  }, [activeTab, selectedProjectId, addNotification]);

  useEffect(() => {
    if (activeTab !== 'deployment') return;

    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/deploy/config?project=${selectedProjectId}`);
        const data = await res.json();
        if (data.success && data.config) {
          setDeployConfig(prev => ({
            ...prev,
            status: data.config.status,
            lastDeployLog: data.config.lastDeployLog,
            lastDeployAt: data.config.lastDeployAt,
            ...(data.config.lastDeployedCommitSha !== undefined ? { lastDeployedCommitSha: data.config.lastDeployedCommitSha } : {})
          }));
        }
      } catch (err) {
        console.error('[SSE Poll] Failed to refresh deployment status:', err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeTab, selectedProjectId, apiFetch, vaultStatus, decryptedUri]);

  const handleSaveDeployConfig = async () => {
    if (deployConfig.targetType === 'ssh' && selectedConnectionMissing) {
      addNotification({
        title: 'Invalid SSH Connection',
        message: 'The selected SSH connection is not available in the server connection store. Please choose a valid connection and save again.',
        type: 'error'
      });
      return;
    }

    setDeploySaving(true);
    try {
      // Sync repoInput to the correct repo field before saving
      const repoField = gitProvider === 'bitbucket' ? 'bitbucketRepo' : 'githubRepo';
      const configToSave = { ...deployConfig, [repoField]: repoInput || deployConfig[repoField] || '' };
      const { sshConnectionData, ...safeConfig } = configToSave;
      const res = await apiFetch('/api/deploy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeStringify(safeConfig)
      });
      const data = await res.json();
      if (data.success && data.config) {
        setDeployConfig(data.config);
        savedDeployConfigRef.current = { ...data.config };
        addNotification({ title: 'Success', message: 'Deployment settings saved successfully', type: 'success' });
        
        // Refresh project list names
        const listRes = await apiFetch('/api/deploy/config');
        const listData = await listRes.json();
        if (listData.success && listData.projects) {
          setDeployProjects(listData.projects);
        }
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to save deployment settings', type: 'error' });
      }
    } catch (err) {
      console.error('[Deploy] Save config error:', err);
      addNotification({ title: 'Error', message: err.message || 'Failed to communicate with deploy settings API', type: 'error' });
    }
    setDeploySaving(false);
  };

  const handleTriggerDeploy = async (commitSha = null) => {
    setDeployTriggering(true);
    try {
      // Auto-save configuration first so server always has the latest script
      await handleSaveDeployConfig();
      const actualCommitSha = typeof commitSha === 'string' ? commitSha : null;
      const res = await apiFetch(`/api/deploy/webhook?project=${selectedProjectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual: true, commitSha: actualCommitSha, deployCommand: deployConfig.deployCommand })
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Deployment Triggered', message: actualCommitSha ? `Deploying commit ${actualCommitSha.substring(0, 7)}...` : 'Deployment started. Status updates will appear in real-time.', type: 'info' });
        setDeployConfig(prev => ({ ...prev, status: 'running', lastDeployLog: 'Deploying...' }));
        setDeploymentTab('logs'); // Auto-switch to logs tab to show live output
        // SSE will handle real-time updates automatically
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to trigger deployment', type: 'error' });
      }
    } catch (err) {
      console.error('[Deploy] Trigger error:', err);
      if (err.message === 'SESSION_EXPIRED') {
        addNotification({ title: 'Session Expired', message: 'Your session has expired. Please sign in again.', type: 'error' });
        signIn('google');
      } else if (err.message === 'SERVER_ERROR') {
        addNotification({ title: 'Server Error', message: 'The server returned an unexpected response. Please try again.', type: 'error' });
      } else {
        addNotification({ title: 'Error', message: err.message || 'Failed to communicate with deployment trigger API', type: 'error' });
      }
    }
    setDeployTriggering(false);
  };

  const handleForceResetDeploy = async () => {
    if (!confirm('Force-reset the deployment status to "failed"? Use this only if the deployment is stuck in a running state.')) return;
    try {
      const res = await apiFetch(`/api/deploy/cancel?project=${selectedProjectId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Status Reset', message: 'Deployment status has been force-reset to failed. You can now retry.', type: 'info' });
        setDeployConfig(prev => ({ ...prev, status: 'failed', lastDeployLog: (prev.lastDeployLog || '') + '\n[User] Force-reset deployment status.' }));
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to reset deployment status', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message || 'Failed to communicate with cancel API', type: 'error' });
    }
  };

  const handleCancelDeploy = async () => {
    if (!confirm('Are you sure you want to cancel the running deployment?')) return;
    try {
      const res = await apiFetch(`/api/deploy/cancel?project=${selectedProjectId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Cancelled', message: 'Cancellation requested.', type: 'info' });
        setDeployConfig(prev => ({ ...prev, status: 'failed', lastDeployLog: prev.lastDeployLog + '\n[User] Cancellation requested.' }));
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to cancel deployment', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to communicate with cancel API', type: 'error' });
    }
  };

  const handleTestWebhook = async () => {
    setWebhookTesting(true);
    setWebhookTestResult(null);
    try {
      const res = await apiFetch(`/api/deploy/webhook-test?project=${selectedProjectId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setWebhookTestResult(data);
        if (data.allPassed) {
          addNotification({ title: t('deploy.testWebhookSuccess', 'Webhook OK'), message: 'All checks passed.', type: 'success' });
        } else {
          const failed = data.checks.filter(c => c.status === 'fail').map(c => c.name).join(', ');
          addNotification({ title: t('deploy.testWebhookFailed', 'Webhook Failed'), message: `Failed: ${failed}`, type: 'warning' });
        }
      } else {
        addNotification({ title: t('deploy.testWebhookFailed', 'Webhook Failed'), message: data.error || 'Test failed', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: t('deploy.testWebhookFailed', 'Webhook Failed'), message: err.message || 'Could not reach test endpoint', type: 'error' });
    }
    setWebhookTesting(false);
  };

  const handleFetchCommits = async () => {
    setLoadingCommits(true);
    try {
      const repo = repoInput || (gitProvider === 'bitbucket' ? deployConfig.bitbucketRepo : deployConfig.githubRepo);
      if (!repo) {
        addNotification({ title: 'Error', message: 'Please enter a repository first', type: 'error' });
        setLoadingCommits(false);
        return;
      }
      const endpoint = gitProvider === 'bitbucket'
        ? `/api/deploy/bitbucket/commits?repo=${encodeURIComponent(repo)}&project=${selectedProjectId}&branch=${deployConfig.branch || 'main'}`
        : `/api/deploy/github/commits?repo=${encodeURIComponent(repo)}&project=${selectedProjectId}&branch=${deployConfig.branch || 'main'}`;
      const res = await apiFetch(endpoint);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('SESSION_EXPIRED');
        }
        throw new Error(errData.error || `Server error: ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.commits) {
        setCommits(data.commits);
        setShowCommitSelector(true);
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to fetch commits', type: 'error' });
      }
    } catch (err) {
      console.error('Failed to fetch commits:', err);
      if (err.message === 'SESSION_EXPIRED') {
        addNotification({ title: 'Session Expired', message: 'Your session has expired. Please sign in again.', type: 'error' });
        signIn('google');
      } else if (err.message === 'SERVER_ERROR') {
        addNotification({ title: 'Server Error', message: 'The server returned an unexpected response. Please try again.', type: 'error' });
      } else {
        addNotification({ title: 'Error', message: err.message || 'Failed to fetch commits', type: 'error' });
      }
    }
    setLoadingCommits(false);
  };

  const handleCopyWebhookUrl = () => {
    if (typeof window === 'undefined') return;
    const url = deployConfig.webhookToken
      ? `${window.location.origin}/api/deploy/webhook?token=${deployConfig.webhookToken}`
      : `${window.location.origin}/api/deploy/webhook?project=${selectedProjectId}`;
    navigator.clipboard.writeText(url);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
    addNotification({ title: 'Copied!', message: 'Webhook URL copied to clipboard', type: 'success' });
  };

  const handleCopyDirectTriggerUrl = () => {
    if (typeof window === 'undefined') return;
    const baseUrl = deployConfig.webhookToken
      ? `${window.location.origin}/api/deploy/trigger?webhook_token=${deployConfig.webhookToken}`
      : `${window.location.origin}/api/deploy/trigger?project=${selectedProjectId}`;
    const url = `${baseUrl}${deployConfig.secret ? `&token=${deployConfig.secret}` : ''}`;
    navigator.clipboard.writeText(url);
    setDirectCopySuccess(true);
    setTimeout(() => setDirectCopySuccess(false), 2000);
    addNotification({ title: 'Copied!', message: 'Direct Trigger URL copied to clipboard', type: 'success' });
  };

  const handleConnectGitHub = async () => {
    // Open OAuth connect in a new window
    const connectUrl = `/api/deploy/github/connect?project=${encodeURIComponent(selectedProjectId)}`;
    const win = window.open(connectUrl, '_blank');
    if (!win) {
      addNotification({ title: 'Error', message: 'Popup blocked. Please allow popups for this site.', type: 'error' });
      return;
    }

    // Poll for connection status (once every 2s for 30s)
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const res = await apiFetch(`/api/deploy/config?project=${selectedProjectId}`);
        const data = await res.json();
        if (data.success && data.config && data.config.githubConnected) {
          setDeployConfig(prev => ({ ...prev, githubConnected: true, githubUser: data.config.githubUser || '' }));
          addNotification({ title: 'GitHub Connected', message: `Connected as ${data.config.githubUser}`, type: 'success' });
          clearInterval(interval);
          if (win && !win.closed) win.close();
        }
      } catch (e) {
        // ignore
      }
      if (attempts > 15) {
        clearInterval(interval);
      }
    }, 2000);
  };

  const handleDisconnectGitHub = async () => {
    if (!confirm('Disconnect GitHub for this project? This will remove stored tokens.')) return;
    try {
      const res = await apiFetch(`/api/deploy/github/disconnect?project=${selectedProjectId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDeployConfig(prev => ({ ...prev, githubConnected: false, githubUser: '' }));
        addNotification({ title: 'GitHub Disconnected', message: 'GitHub connection removed for this project', type: 'success' });
        // refresh project list
        const listRes = await apiFetch('/api/deploy/config');
        const listData = await listRes.json();
        if (listData.success && listData.projects) setDeployProjects(listData.projects);
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to disconnect', type: 'error' });
      }
    } catch (err) {
      console.error('Disconnect failed:', err);
      addNotification({ title: 'Error', message: 'Failed to disconnect GitHub', type: 'error' });
    }
  };

  const handleConnectBitbucket = async () => {
    if (!bbUsername.trim() || !bbAppPassword.trim()) {
      addNotification({ title: 'Error', message: 'Enter Bitbucket username and app password', type: 'error' });
      return;
    }
    setBbConnecting(true);
    try {
      const res = await apiFetch(`/api/deploy/bitbucket/connect?project=${encodeURIComponent(selectedProjectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: bbUsername.trim(), appPassword: bbAppPassword.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setDeployConfig(prev => ({ ...prev, bitbucketConnected: true, bitbucketUser: data.bitbucketUser }));
        setBbUsername('');
        setBbAppPassword('');
        addNotification({ title: 'Bitbucket Connected', message: `Connected as ${data.bitbucketUser}`, type: 'success' });
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to connect Bitbucket', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to connect to Bitbucket', type: 'error' });
    }
    setBbConnecting(false);
  };

  const handleDisconnectBitbucket = async () => {
    if (!confirm('Disconnect Bitbucket for this project? This will remove stored credentials.')) return;
    try {
      const res = await apiFetch(`/api/deploy/bitbucket/disconnect?project=${selectedProjectId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDeployConfig(prev => ({ ...prev, bitbucketConnected: false, bitbucketUser: '' }));
        addNotification({ title: 'Bitbucket Disconnected', message: 'Bitbucket connection removed for this project', type: 'success' });
        const listRes = await apiFetch('/api/deploy/config');
        const listData = await listRes.json();
        if (listData.success && listData.projects) setDeployProjects(listData.projects);
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to disconnect', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to disconnect Bitbucket', type: 'error' });
    }
  };

  const handleCreateProject = async () => {
    const name = prompt('Enter a name for your new deployment project:');
    if (!name || !name.trim()) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (deployProjects.find(p => p.id === id)) {
      alert('A project with that ID already exists.');
      return;
    }

    setDeploySaving(true);
    try {
      const newProj = {
        id,
        name: name.trim(),
        enabled: false,
        branch: 'main',
        secret: '',
        targetType: 'local',
        connectionId: '',
        deployCommand: '# Enter your deployment shell script here\n',
        projectPath: '.',
        status: 'idle',
        lastDeployLog: '',
        lastDeployAt: null,
        githubConnected: false,
        githubUser: '',
        aiModel: 'auto',
        aiCustomModel: '',
        aiEndpoint: '',
        aiApiKey: ''
      };

      const res = await apiFetch('/api/deploy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProj)
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Project Created', message: `Project "${name}" was created successfully.`, type: 'success' });
        setSelectedProjectId(id);
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to create deployment project.', type: 'error' });
    }
    setDeploySaving(false);
  };

  const handleDeleteProject = async () => {
    if (selectedProjectId === 'default') {
      alert('The default project cannot be deleted.');
      return;
    }
    if (!confirm(`Are you sure you want to delete project "${deployConfig.name}"?`)) return;

    setDeploySaving(true);
    try {
      const res = await apiFetch(`/api/deploy/config?project=${selectedProjectId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Project Deleted', message: 'Deployment project deleted successfully.', type: 'info' });
        setSelectedProjectId('default');
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to delete project.', type: 'error' });
    }
    setDeploySaving(false);
  };

  const handleAiAnalyze = async () => {
    if (deployConfig.targetType === 'ssh' && !deployConfig.connectionId) {
      addNotification({ title: 'Validation Error', message: 'Please select an SSH Connection first.', type: 'error' });
      return;
    }
    setAiAnalyzing(true);
    try {
      const res = await apiFetch(`/api/deploy/ai-analyze?project=${selectedProjectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: deployConfig.targetType,
          connectionId: deployConfig.connectionId,
          projectPath: deployConfig.projectPath,
          deployCommand: deployConfig.deployCommand,
          aiModel: deployConfig.aiModel,
          aiCustomModel: deployConfig.aiCustomModel,
          aiEndpoint: deployConfig.aiEndpoint,
          aiApiKey: deployConfig.aiApiKey
        })
      });
      const data = await res.json();
      if (data.success) {
        setDeployConfig(prev => ({
          ...prev,
          deployCommand: data.aiProfile?.deployCommand || prev.deployCommand,
          aiProfile: data.aiProfile,
          aiLogs: data.aiLogs
        }));
        addNotification({ title: 'AI Analysis Complete', message: `Detected ${data.aiProfile.projectType} project structure & updated deployment script.`, type: 'success' });
      } else {
        addNotification({ title: 'AI Analysis Failed', message: data.error || 'Failed to analyze project.', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to communicate with AI analysis endpoint.', type: 'error' });
    }
    setAiAnalyzing(false);
  };

  const handleFetchTelegramChats = async () => {
    setTelegramLoadingChats(true);
    setTelegramFetchError('');
    try {
      const params = new URLSearchParams();
      params.set('project', selectedProjectId || 'default');
      if (deployConfig.telegramBotToken) {
        params.set('botToken', deployConfig.telegramBotToken);
      }
      const res = await apiFetch(`/api/deploy/telegram?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setTelegramChats(data.chats || []);
        setTelegramBotInfo(data.bot || null);
        if (data.chats && data.chats.length === 0) {
          setTelegramFetchError('No recent chats found. Send a message (e.g. /start) to your bot on Telegram, then click Fetch Chats again.');
        }
      } else {
        setTelegramFetchError(data.error || 'Failed to fetch Telegram chats');
      }
    } catch (err) {
      setTelegramFetchError(err.message);
    } finally {
      setTelegramLoadingChats(false);
    }
  };

  const handleTestTelegramNotification = async () => {
    setTelegramTesting(true);
    setTelegramTestStatus(null);
    try {
      const res = await apiFetch('/api/deploy/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId || 'default',
          botToken: deployConfig.telegramBotToken,
          chatId: deployConfig.telegramChatId
        })
      });
      const data = await res.json();
      if (data.success) {
        setTelegramTestStatus({ success: true, message: data.message || 'Test notification sent!' });
      } else {
        setTelegramTestStatus({ success: false, message: data.error || 'Failed to send test notification' });
      }
    } catch (err) {
      setTelegramTestStatus({ success: false, message: err.message });
    } finally {
      setTelegramTesting(false);
    }
  };

  // Auto-detect user's OS from browser (for relay install hint)
  const detectedOS = useMemo(() => {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua  = navigator.userAgent || '';
    const plt = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
    if (/win/i.test(plt) || /windows/i.test(ua))  return 'windows';
    if (/mac/i.test(plt) || /mac os/i.test(ua))   return 'macos';
    if (/linux/i.test(plt) || /linux/i.test(ua))  return 'linux';
    return 'unknown';
  }, []);

  const osMeta = useMemo(() => ({
    macos:   { label: t('settings_ui.relay.osMeta.macos_label'),   badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   detail: t('settings_ui.relay.osMeta.macos') },
    linux:   { label: t('settings_ui.relay.osMeta.linux_label'),   badge: 'bg-green-500/10 text-green-400 border-green-500/20', detail: t('settings_ui.relay.osMeta.linux') },
    windows: { label: t('settings_ui.relay.osMeta.windows_label'), badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20',       detail: t('settings_ui.relay.osMeta.windows') },
    unknown: { label: t('settings_ui.relay.osMeta.unknown_label'), badge: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',   detail: t('settings_ui.relay.osMeta.unknown') },
  }), [t]);

  const updateTerminalTheme = (key, value) => {
    setTerminalSettings({
      theme: {
        ...(osState.terminalSettings?.theme || {}),
        [key]: value
      }
    });
  };

  useEffect(() => {
    if (activeTab === 'database') {
      fetchDbConfig();
    }
  }, [activeTab, vaultStatus, decryptedUri]);

  // Poll relay status — every 5s when logged in, every 2s while install wizard is waiting
  // Also auto-detects local relay via discovery server on localhost:48923
  useEffect(() => {
    if (!session) return;
    const isWaiting = relayModalOpen && relayWaiting;
    const interval = isWaiting ? 2000 : 5000;

    // Auto-detect local relay (runs once, then caches result)
    let localRelayName = null;
    const detectLocalRelay = async () => {
      try {
        const res = await fetch('http://127.0.0.1:48923', { signal: AbortSignal.timeout(1000) });
        const data = await res.json();
        if (data.relayName) {
          localRelayName = data.relayName;
          localStorage.setItem('ssh_monitor_local_relay', localRelayName);
        }
      } catch {
        // Discovery server not running — no local relay agent on this machine
      }
    };
    detectLocalRelay();

    // Grace period: on page load, if mode was 'local', don't auto-switch on the
    // first poll — the relay agent may still be reconnecting to the server.
    let firstPoll = true;
    const wasLocalOnLoad = localStorage.getItem('ssh_monitor_ssh_mode') === 'local';
    let consecutiveDisconnects = 0;

    const poll = async () => {
      try {
        const res = await fetch('/api/relay/token', { credentials: 'include' });
        const data = await res.json();
        if (data.success) {
          setRelayConnected(data.connected);
          const fetchedRelays = data.relays || [];
          setRelays(fetchedRelays);

          // Auto-switch SSH mode to server when no relay is connected
          // Skip on first poll if mode was 'local' — give relay agent time to reconnect
          if (!data.connected && localStorage.getItem('ssh_monitor_ssh_mode') === 'local') {
            if (firstPoll && wasLocalOnLoad) {
              consecutiveDisconnects++;
              firstPoll = false;
            } else {
              consecutiveDisconnects++;
              // Require 2 consecutive failures before switching to avoid false positives
              if (consecutiveDisconnects >= 2) {
                localStorage.setItem('ssh_monitor_ssh_mode', 'server');
                window.dispatchEvent(new Event('ssh-mode-changed'));
              }
            }
          } else {
            consecutiveDisconnects = 0;
            firstPoll = false;
          }

          if (fetchedRelays.length > 0) {
            const currentPreferred = localStorage.getItem('ssh_monitor_preferred_relay');
            const isStillConnected = currentPreferred && fetchedRelays.some(r => r.relayName === currentPreferred || r.relayId === currentPreferred);

            // Priority: 1) local relay detected, 2) saved preferred, 3) first available
            if (!isStillConnected) {
              let targetRelay = null;
              // Try to find the local relay
              if (localRelayName) {
                targetRelay = fetchedRelays.find(r => r.relayName === localRelayName || r.relayId === localRelayName);
              }
              if (!targetRelay) {
                const cachedLocal = localStorage.getItem('ssh_monitor_local_relay');
                if (cachedLocal) {
                  targetRelay = fetchedRelays.find(r => r.relayName === cachedLocal || r.relayId === cachedLocal);
                }
              }
              if (!targetRelay) {
                targetRelay = fetchedRelays[0];
              }
              const relayName = targetRelay.relayName || targetRelay.relayId;
              localStorage.setItem('ssh_monitor_preferred_relay', relayName);
              setPreferredRelay(relayName);
            }
          }
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, interval);
    return () => clearInterval(id);
  }, [session, relayModalOpen, relayWaiting]);

  // Auto-start relay polling when entering step 2 (no manual "I ran it" button needed)
  useEffect(() => {
    if (relayModalOpen && !relayWaiting && !relayInstallSuccess) {
      setRelayWaiting(true);
    }
  }, [relayModalOpen, relayWaiting, relayInstallSuccess]);

  // Auto-generate token when relay wizard is opened and no token yet
  useEffect(() => {
    if (relayModalOpen && !relayToken && !relayLoading) {
      handleGenerateRelayToken();
      // Snapshot currently-connected relays so new ones can be detected
      setExistingRelayIds(new Set(relays.map(r => r.relayId || r.relayName)));
    }
    if (!relayModalOpen) {
      setRelayWaiting(false);
      setRelayInstallSuccess(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayModalOpen]);

  // Show success screen when a new relay connects during install wizard
  useEffect(() => {
    if (!relayModalOpen) {
      return;
    }
    const newRelay = relays.find(r => !existingRelayIds.has(r.relayId || r.relayName));
    if (relayWaiting && newRelay && !relayInstallSuccess) {
      setRelayInstallSuccess(true);
      addNotification({ title: 'Relay Connected!', message: 'Your local relay agent is now running.', type: 'success' });
      
      // Auto-swap to SSH connection mode to local relay
      localStorage.setItem('ssh_monitor_ssh_mode', 'local');
      window.dispatchEvent(new Event('ssh-mode-changed'));
      
      // Auto-select preferred relay to this new local relay
      const relayName = newRelay.relayName || newRelay.relayId;
      localStorage.setItem('ssh_monitor_preferred_relay', relayName);
      setPreferredRelay(relayName);
    }
  }, [relays, existingRelayIds, relayWaiting, relayModalOpen, relayInstallSuccess, addNotification]);

  const handleGenerateRelayToken = async () => {
    setRelayLoading(true);
    let success = false;
    try {
      const res = await fetch('/api/relay/token', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setRelayToken(data.token);
        try { addNotification({ title: 'Token Created', message: 'Your relay token has been generated.', type: 'success' }); } catch (_) {}
        success = true;
      } else {
        addNotification({ title: 'Error', message: data.error || 'Failed to generate token', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message || 'Failed to generate token', type: 'error' });
    }
    setRelayLoading(false);
    return success;
  };

  const handleDisconnectRelay = async (relayId, relayName) => {
    const targetId = relayId || relayName;
    if (!targetId) return;
    try {
      await fetch(`/api/relay/token?relayId=${encodeURIComponent(targetId)}`, { method: 'DELETE', credentials: 'include' });
      setRelays(prev => {
        const updated = prev.filter(r => (r.relayId || r.relayName) !== targetId);
        if (updated.length === 0) setRelayConnected(false);
        return updated;
      });
      const currentPref = localStorage.getItem('ssh_monitor_preferred_relay');
      if (currentPref === targetId) {
        localStorage.removeItem('ssh_monitor_preferred_relay');
        setPreferredRelay(null);
      }
      addNotification({ title: 'Relay Disconnected', message: `"${targetId}" has been disconnected.`, type: 'info' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRevokeAllRelays = async () => {
    try {
      await fetch('/api/relay/token', { method: 'DELETE', credentials: 'include' });
      setRelayToken(null);
      setRelayConnected(false);
      setRelays([]);
      addNotification({ title: t('settings_ui.relay.toasts.tokenRevoked'), message: t('settings_ui.relay.toasts.tokenRevokedMsg'), type: 'info' });
    } catch {}
  };

  const quotePosixArg = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const quoteWindowsArg = (value) => `"${String(value).replace(/"/g, '""')}"`;

  const getRelayCommand = (mode, os = detectedOS) => {
    if (mode === 'uninstall') {
      return 'node local-relay.js --uninstall';
    }

    if (!relayToken) return '⚠ Token not yet generated — click Generate Token first';

    if (os === 'windows') {
      return `node local-relay.js --install --server ${quoteWindowsArg(window.location.origin)} --token ${quoteWindowsArg(relayToken)}`;
    }

    return `node local-relay.js --install --server ${quotePosixArg(window.location.origin)} --token ${quotePosixArg(relayToken)}`;
  };

  const getRelayScriptFilename = (mode, os = detectedOS) => {
    if (os === 'windows') return mode === 'install' ? 'relay-install.bat' : 'relay-uninstall.bat';
    if (os === 'macos') return mode === 'install' ? 'relay-install.command' : 'relay-uninstall.command';
    return mode === 'install' ? 'relay-install.sh' : 'relay-uninstall.sh';
  };

  // Generate & download a platform-specific install/uninstall script
  const downloadInstallerScript = (mode) => {
    const server = window.location.origin;
    // Cache-busting: append timestamp to URL so curl never reuses a stale cached copy
    const scriptUrl = `${server}/local-relay.js?v=${Date.now()}`;
    const cmd = getRelayCommand(mode);

    let content, filename;
    if (detectedOS === 'windows') {
      content = [
        '@echo off',
        'setlocal',
        `cd /d "%~dp0"`,
        `if exist local-relay.js del /f /q local-relay.js`,
        `echo Downloading latest local-relay.js...`,
        `curl -fsSL -H "Cache-Control: no-cache" "${scriptUrl}" -o local-relay.js`,
        `echo Running: ${cmd}`,
        cmd,
        `if exist local-relay.js del /f /q local-relay.js`,
        'echo.',
        'echo Done! Press any key to close...',
        'pause > nul',
      ].join('\r\n');
      filename = getRelayScriptFilename(mode, 'windows');
    } else {
      const lines = [
        '#!/bin/bash',
        'set -e',
        'cd "$(dirname "$0")"',
        `echo "Downloading latest local-relay.js..."`,
        // Remove old file first to guarantee we never run a stale copy if curl fails
        'rm -f local-relay.js',
        `curl -fsSL -H 'Cache-Control: no-cache' "${scriptUrl}" -o local-relay.js`,
        `echo "Running: ${cmd}"`,
        cmd,
        'echo ""',
        'echo "Done!"',
      ];
      filename = getRelayScriptFilename(mode, detectedOS);
      content = lines.join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    if (mode === 'install') {
      setRelayWaiting(true);
    }
    addNotification({ 
      title: t('settings_ui.relay.toasts.downloaded'), 
      message: t('settings_ui.relay.toasts.downloadMsg', { filename, mode: mode === 'install' ? t('settings_ui.relay.install').toLowerCase() : t('settings_ui.relay.uninstall').toLowerCase() }), 
      type: 'success' 
    });
  };

  // Self-contained one-liner for macOS/Linux (curl download + node run in one paste)
  const getRelayOneLiner = (mode) => {
    const server = window.location.origin;
    // Cache-busting: append timestamp so the one-liner always fetches the latest version
    const targetPath = './local-relay.js';
    const scriptUrl = `${server}/local-relay.js?v=${Date.now()}`;
    if (mode === 'uninstall') {
      return `rm -f ${targetPath} && curl -fsSL -H 'Cache-Control: no-cache' "${scriptUrl}" -o ${targetPath} && node ${targetPath} --uninstall && rm -f ${targetPath}`;
    }
    if (!relayToken) return '⚠ Token not yet generated — click Generate Token first';
    return `rm -f ${targetPath} && curl -fsSL -H 'Cache-Control: no-cache' "${scriptUrl}" -o ${targetPath} && node ${targetPath} --install --server ${quotePosixArg(server)} --token ${quotePosixArg(relayToken)} && rm -f ${targetPath}`;
  };

  const setVaultPreset = (uri) => {
    setVaultUri(uri);
    addNotification({ title: t('settings_ui.relay.toasts.presetApplied'), message: t('settings_ui.relay.toasts.presetMsg'), type: 'info' });
  };

  const fetchDbConfig = async () => {
    setDbLoading(true);
    if (vaultStatus === 'unlocked' && decryptedUri) {
      setDbUri(decryptedUri);
      setDbConnected(true);
    } else if (appState.dbConfig?.uri) {
      setDbUri(appState.dbConfig.uri);
      setDbConnected(true);
    }
    setDbLoading(false);
  };

  const handleConnect = async () => {
    if (!dbUri.trim()) {
      addNotification({ title: 'Error', message: t('settings_ui.db.enterUri'), type: 'error' });
      return;
    }
    setDbConnecting(true);
    try {
      const testRes = await fetch('/api/connections/test-uri', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: dbUri.trim() })
      });
      const testData = await testRes.json();
      
      if (testData.success) {
        const targetUri = dbUri.trim();
        dispatch({ type: 'SET_DB_CONFIG', payload: { uri: targetUri } });
        setDbConnected(true);
        addNotification({ title: 'Connected', message: t('settings_ui.db.connected'), type: 'success' });
      } else {
        setDbConnected(false);
        addNotification({ title: 'Connection Failed', message: testData.error || t('settings_ui.db.failed'), type: 'error' });
      }
    } catch (err) {
      setDbConnected(false);
      addNotification({ title: 'Error', message: t('settings_ui.db.unreachable'), type: 'error' });
    }
    setDbConnecting(false);
  };

  const handleVaultSetup = async () => {
    if (!vaultUri.trim()) {
      addNotification({ title: 'Error', message: t('settings_ui.db.enterUri'), type: 'error' });
      return;
    }
    const uri = vaultUri.trim();
    const allowed = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowed.some(p => uri.startsWith(p));

    if (!isValid) {
      addNotification({ 
        title: 'Invalid URI', 
        message: 'Unsupported database protocol', 
        type: 'error' 
      });
      return;
    }
    if (vaultPassword.length < 8) {
      addNotification({ title: 'Error', message: t('settings_ui.db.passShort'), type: 'error' });
      return;
    }
    if (vaultPassword !== vaultConfirm) {
      addNotification({ title: 'Error', message: t('settings_ui.db.passMismatch'), type: 'error' });
      return;
    }

    setVaultSaving(true);
    try {
      await setupVault(vaultUri.trim(), vaultPassword);
      addNotification({ title: 'Success', message: t('settings_ui.db.vaultCreated'), type: 'success' });
      setVaultUri('');
      setVaultPassword('');
      setVaultConfirm('');
    } catch (err) {
      addNotification({ title: 'Failed', message: err.message || t('settings_ui.db.failed'), type: 'error' });
    }
    setVaultSaving(false);
  };

  const handleSetWallpaper = (url) => {
    setWallpaper(url);
  };

  return (
    <div className="flex h-full w-full bg-transparent text-[var(--text-primary)] border-[var(--border-color)] overflow-hidden relative">
      {/* Sidebar - responsive behavior */}
      {!deploymentOnly && (
        <div className={`
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          fixed md:relative z-20 md:z-0 w-64 border-r border-[var(--border-color)] flex flex-col shrink-0 h-full overflow-y-auto custom-scrollbar transition-transform duration-300 bg-[var(--bg-secondary)]/60 backdrop-blur-xl
        `}>
        {/* User Profile Section */}
        <div className="p-4 border-b border-[var(--border-color)]/60">
          {session ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img 
                    src={session.user.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`} 
                    className="w-10 h-10 rounded-xl border border-[var(--border-color)] object-cover" 
                    alt="Avatar" 
                    onError={(e) => {
                    if (e.target.src.includes('ui-avatars.com')) {
                      e.target.onerror = null;
                      e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236366f1'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                    } else {
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`;
                    }
                  }} 
                  />
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-secondary)] ${
                    vaultStatus === 'unlocked' ? 'bg-emerald-400' : vaultStatus === 'locked' ? 'bg-amber-400' : 'bg-gray-400'
                  }`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate text-[var(--text-primary)]">{session.user.name}</p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">{session.user.email}</p>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                vaultStatus === 'unlocked'
                  ? 'bg-emerald-500/8 border-emerald-500/15'
                  : vaultStatus === 'locked'
                  ? 'bg-amber-500/8 border-amber-500/15'
                  : 'bg-[var(--bg-tertiary)]/50 border-[var(--border-color)]'
              }`}>
                <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                  vaultStatus === 'unlocked'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : vaultStatus === 'locked'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}>
                  {vaultStatus === 'unlocked' ? (
                    <Unlock size={10} />
                  ) : vaultStatus === 'locked' ? (
                    <Lock size={10} />
                  ) : (
                    <Shield size={10} />
                  )}
                </div>
                <span className={`flex-1 text-[11px] font-medium truncate ${
                  vaultStatus === 'unlocked'
                    ? 'text-emerald-400'
                    : vaultStatus === 'locked'
                    ? 'text-amber-400'
                    : 'text-[var(--text-muted)]'
                }`}>
                  {vaultStatus === 'unlocked'
                    ? t('settings_ui.vaultStatus.unlocked')
                    : vaultStatus === 'locked'
                    ? t('settings_ui.vaultStatus.locked')
                    : t('settings_ui.vaultStatus.none')
                  }
                </span>
                <button
                  onClick={async () => {
                    try { await saveSettings(); } catch(e) { console.error(e); }
                    sessionStorage.removeItem('_vault_uri');
                    sessionStorage.removeItem('_vault_tunnel');
                    signOut();
                  }}
                  className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title={t('common.logout')}
                >
                  <LogOut size={10} />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button 
                onClick={() => signIn('google')}
                className="w-full py-2.5 px-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs font-semibold border border-[var(--border-color)] hover:bg-[var(--bg-card-hover)] transition-all flex items-center justify-center gap-2"
              >
                <img src="https://lh3.googleusercontent.com/COxitqgJr1sJnIDe8-jiKhxDx1FrYbtRHKJ9z_hELisAlapwE9LUPh6fcXIfb5vwpbMl4xl9H9TRFPc5NOO8Sb3VSgIBrfRYvW6cUA" className="w-4 h-4" alt="Google" />
                {t('common.login')}
              </button>
              <p className="text-[9px] text-center text-[var(--text-muted)] px-1">{t('vault.setupDescription')}</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 p-3 space-y-0.5">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-3 py-2">{t('common.settings')}</p>
          {[
            { id: 'appearance', label: t('settings.appearanceTitle'), icon: Palette, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
            { id: 'terminal', label: t('settings_ui.terminal.title') || 'Terminal', icon: Terminal, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { id: 'display', label: t('settings_ui.display.title'), icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { id: 'notifications', label: t('settings_ui.notifications.title'), icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10' },
            { id: 'database', label: t('settings.databaseTitle'), icon: Database, color: 'text-purple-400', bg: 'bg-purple-500/10', requireLogin: true },
            { id: 'privacy', label: t('settings_ui.privacy.title'), icon: Shield, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { id: 'keyboard', label: t('settings_ui.keyboard.title') || 'Shortcuts', icon: Key, color: 'text-rose-400', bg: 'bg-rose-500/10' },
            { id: 'about', label: t('common.about'), icon: Info, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-tertiary)]' },
          ].map(tab => {
            const isDisabled = tab.requireLogin && !session;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (!isDisabled) {
                    setActiveTab(tab.id);
                    setIsSidebarOpen(false);
                  }
                }}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 relative ${
                  isActive
                    ? 'bg-[var(--glow-indigo)] text-[var(--accent-indigo)] font-semibold'
                    : isDisabled
                    ? 'text-[var(--text-muted)] cursor-not-allowed opacity-40'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-500" />
                )}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? tab.bg : 'bg-transparent'}`}>
                  <tab.icon size={15} className={isActive ? tab.color : ''} />
                </div>
                <span className="text-[13px] truncate">{tab.label}</span>
                {isDisabled && (
                  <span className="ml-auto text-[8px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{t('vault.loginBtn').toUpperCase()}</span>
                )}
                {isActive && <ChevronRight size={12} className="ml-auto opacity-40" />}
              </button>
            );
          })}
        </div>
      </div>
      )}
      
      {/* Overlay to close sidebar on mobile */}
      {!deploymentOnly && isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-10 md:hidden" 
          onClick={() => setIsSidebarOpen(false)} 
        />
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto h-full pb-28 custom-scrollbar ${deploymentOnly ? 'p-6 md:p-10 lg:p-12' : 'p-4 md:p-8'}`}>
        {/* Mobile Header */}
        {!deploymentOnly && (
          <div className="flex items-center gap-3 mb-6 md:hidden">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
            >
              <Menu size={18} />
            </button>
            <h2 className="text-lg font-bold truncate">
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </h2>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Palette} iconColor="text-indigo-400" title={t('settings.appearanceTitle')} description={t('settings.appearanceDesc')} />

            <section className="space-y-6">
              {/* Wallpaper */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <ImageIcon size={15} className="text-indigo-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.wallpaper')}</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {WALLPAPERS.map(wp => {
                    const isActive = osState.wallpaper === wp.url;
                    return (
                      <div 
                        key={wp.id}
                        className={`group relative h-24 rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                          isActive 
                            ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg shadow-indigo-500/10' 
                            : 'border-transparent hover:border-indigo-500/50'
                        }`}
                        onClick={() => handleSetWallpaper(wp.url)}
                      >
                        <img src={wp.url} alt={wp.name} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" />
                        <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-2.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <span className="text-[10px] font-semibold text-white">{wp.name}</span>
                          {isActive && <CheckCircle size={16} className="text-indigo-300" />}
                        </div>
                      </div>
                    );
                  })}
                  {osState.customWallpapers?.map((url, idx) => {
                    const isActive = osState.wallpaper === url;
                    return (
                      <div 
                        key={`custom-${idx}`}
                        className={`group relative h-24 rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                          isActive ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-[var(--border-color)] hover:border-indigo-500/50'
                        }`}
                        onClick={() => handleSetWallpaper(url)}
                      >
                        <img src={url} alt="Custom" className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300" />
                        <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-2.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <span className="text-[10px] font-semibold text-white">Custom #{idx + 1}</span>
                          <div className="flex items-center gap-1.5">
                            {isActive && <CheckCircle size={14} className="text-indigo-300" />}
                            <button 
                              onClick={(e) => { e.stopPropagation(); removeCustomWallpaper(url); }}
                              className="p-1 bg-red-500/80 hover:bg-red-500 text-white rounded-md transition-colors"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {showCustomInput ? (
                    <div className="h-24 rounded-xl bg-[var(--bg-tertiary)] border border-indigo-500/40 p-2.5 flex flex-col gap-2 animate-in fade-in duration-200">
                      <input
                        autoFocus type="text" placeholder="https://images.unsplash.com/..."
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                        value={customUrlInput} onChange={(e) => setCustomUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customUrlInput) { addCustomWallpaper(customUrlInput); handleSetWallpaper(customUrlInput); setCustomUrlInput(''); setShowCustomInput(false); }
                          if (e.key === 'Escape') setShowCustomInput(false);
                        }}
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => { if (customUrlInput) { addCustomWallpaper(customUrlInput); handleSetWallpaper(customUrlInput); setCustomUrlInput(''); } setShowCustomInput(false); }} className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-600 rounded-lg text-[10px] font-semibold text-white transition-colors">{t('settings_ui.appearance.apply')}</button>
                        <button onClick={() => setShowCustomInput(false)} className="px-2 py-1.5 bg-[var(--bg-tertiary)] rounded-lg text-[10px] font-semibold border border-[var(--border-color)] transition-colors">{t('common.cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-24 rounded-xl border-2 border-dashed border-[var(--border-color)] flex flex-col items-center justify-center hover:border-indigo-500/40 transition-all cursor-pointer group" onClick={() => setShowCustomInput(true)}>
                      <PlusIcon size={18} className="text-[var(--text-muted)] mb-1 group-hover:text-indigo-400 transition-colors" />
                      <span className="text-[10px] text-[var(--text-muted)]">{t('settings_ui.appearance.customUrl')}</span>
                    </div>
                  )}
                </div>
              </SettingsCard>

              {/* Interface Style */}
              <SettingsCard>
                <SettingRow label={t('settings_ui.appearance.glassmorphism')} description={t('settings_ui.appearance.glassmorphismDesc')} noBorder>
                  <Toggle value={glassmorphism} onChange={() => setGlassmorphism(!glassmorphism)} />
                </SettingRow>
              </SettingsCard>

              {/* Icon Style */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Layout size={15} className="text-purple-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.appearance.iconStyle')}</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {['glass', 'flat', 'neumorphic', 'outline', 'minimal'].map(id => (
                    <button key={id} onClick={() => setIconStyle(id)}
                      className={`p-3 rounded-xl border transition-all text-center ${osState.iconStyle === id ? 'bg-indigo-500/10 border-indigo-500/40 shadow-sm' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'}`}>
                      <span className="block text-[11px] font-semibold text-[var(--text-primary)]">{t(`settings_ui.appearance.styles.${id}`)}</span>
                      <span className="block text-[9px] text-[var(--text-muted)] mt-0.5">{t(`settings_ui.appearance.styles.${id}Desc`)}</span>
                    </button>
                  ))}
                </div>
              </SettingsCard>

              {/* Theme */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Palette size={15} className="text-indigo-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.appearance.theme')}</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'dark', label: t('settings_ui.appearance.themes.dark'), icon: Moon },
                    { id: 'retro', label: t('settings_ui.appearance.themes.retro'), icon: Cpu },
                    { id: 'cyberpunk', label: t('settings_ui.appearance.themes.cyberpunk') || 'Cyberpunk', icon: Zap },
                    { id: 'synthwave', label: 'Synthwave', icon: Music },
                  ].map(theme => (
                    <button key={theme.id} onClick={() => { setTheme(theme.id); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                      className={`p-4 rounded-xl border transition-all flex flex-col items-center gap-2.5 ${osState.theme === theme.id ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'}`}>
                      <theme.icon size={22} className={osState.theme === theme.id ? 'text-indigo-400' : 'text-[var(--text-muted)]'} />
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{theme.label}</span>
                    </button>
                  ))}
                </div>
              </SettingsCard>

              {/* Language */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Globe size={15} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.appearance.language')}</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { code: 'en', label: 'English', flag: '🇺🇸' },
                    { code: 'th', label: 'ภาษาไทย', flag: '🇹🇭' },
                    { code: 'cn', label: '简体中文', flag: '🇨🇳' },
                  ].map(lang => (
                    <button key={lang.code} onClick={() => setLanguage(lang.code)}
                      className={`p-3 rounded-xl border transition-all flex items-center gap-3 ${i18n.language === lang.code ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'}`}>
                      <span className="text-lg">{lang.flag}</span>
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{lang.label}</span>
                    </button>
                  ))}
                </div>
              </SettingsCard>

              {/* Taskbar Position */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Layout size={15} className="text-indigo-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.personalization.taskbarTitle')}</h3>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['bottom', 'top', 'left', 'right'].map(pos => (
                    <button key={pos} onClick={() => setTaskbarPosition(pos)}
                      className={`py-2.5 rounded-xl text-xs font-semibold border transition-all capitalize ${osState.taskbarPosition === pos ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                      {t(`settings_ui.personalization.positions.${pos}`)}
                    </button>
                  ))}
                </div>
              </SettingsCard>

              {/* Window Layout */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Monitor size={15} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.personalization.windowLayoutTitle')}</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {['mac', 'pc'].map(layout => (
                    <button key={layout} onClick={() => setWindowLayout(layout)}
                      className={`p-4 rounded-xl border transition-all flex flex-col items-center gap-2.5 ${osState.windowLayout === layout ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'}`}>
                      <div className={`w-full h-7 rounded-lg bg-black/20 flex items-center px-2 gap-1 ${layout === 'mac' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`w-2 h-2 rounded-full ${layout === 'mac' ? 'bg-[#ff5f57]' : 'bg-gray-500/40'}`} />
                        <div className={`w-2 h-2 rounded-full ${layout === 'mac' ? 'bg-[#febc2e]' : 'bg-gray-500/40'}`} />
                        <div className={`w-2 h-2 rounded-full ${layout === 'mac' ? 'bg-[#28c840]' : 'bg-gray-500/40'}`} />
                      </div>
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{t(`settings_ui.personalization.windowLayouts.${layout}`)}</span>
                    </button>
                  ))}
                </div>
              </SettingsCard>

              {/* Desktop Icon Size */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Monitor size={15} className="text-emerald-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.personalization.desktopTitle')}</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['small', 'medium', 'large'].map(size => (
                    <button key={size} onClick={() => setIconSize(size)}
                      className={`py-2.5 rounded-xl text-xs font-semibold border transition-all capitalize ${osState.iconSize === size ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                      {t(`desktop.context.icons.${size}`)}
                    </button>
                  ))}
                </div>
              </SettingsCard>
            </section>
          </div>
        )}


        
        {activeTab === 'display' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Monitor} iconColor="text-blue-400" title={t('settings_ui.display.title')} description={t('settings_ui.display.desc')} />

            <section className="space-y-6">
              <SettingsCard>
                <SettingRow label={t('settings_ui.display.brightness')} description={t('settings_ui.display.brightnessDesc')}>
                  <span className="text-xs font-mono text-[var(--text-muted)] w-10 text-right">{brightness}%</span>
                </SettingRow>
                <input 
                  type="range" min="30" max="100" value={brightness}
                  onChange={(e) => setBrightness(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-indigo-500 mt-2"
                />
              </SettingsCard>

              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Monitor size={15} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.display.interfaceScaling')}</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[75, 100, 125].map(scale => (
                    <PillButton key={scale} active={uiScale === scale} onClick={() => { setUiScale(scale); addNotification({ title: 'UI Scale', message: t('settings_ui.display.scalingSet', { scale }), type: 'success' }); }}>
                      {scale}%
                    </PillButton>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--text-muted)]">{t('settings_ui.display.scalingInfo')}</p>
              </SettingsCard>
            </section>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Bell} iconColor="text-amber-400" title={t('settings_ui.notifications.title')} description={t('settings_ui.notifications.desc')} />

            <section className="space-y-3">
              {[
                { id: 'system', icon: Bell, title: t('settings_ui.notifications.system'), desc: t('settings_ui.notifications.systemDesc'), accent: 'indigo' },
                { id: 'terminal', icon: Volume2, title: t('settings_ui.notifications.terminal'), desc: t('settings_ui.notifications.terminalDesc'), accent: 'emerald' },
                { id: 'desktop', icon: Monitor, title: t('settings_ui.notifications.desktop'), desc: t('settings_ui.notifications.desktopDesc'), accent: 'blue' },
              ].map(item => {
                const isActive = notifications[item.id];
                return (
                  <SettingsCard key={item.id}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isActive ? 'bg-indigo-500/10' : 'bg-[var(--bg-tertiary)]'}`}>
                          <item.icon size={18} className={isActive ? 'text-indigo-400' : 'text-[var(--text-muted)]'} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</h4>
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                      <Toggle value={isActive} onChange={() => {
                        const next = !isActive;
                        // Request browser notification permission when enabling desktop alerts
                        if (item.id === 'desktop' && next && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
                          Notification.requestPermission();
                        }
                        setNotifications({ [item.id]: next });
                      }} accent={item.accent} />
                    </div>
                  </SettingsCard>
                );
              })}
            </section>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Shield} iconColor="text-emerald-400" title={t('settings_ui.privacy.title')} description={t('settings_ui.privacy.desc')} />

            <section className="space-y-6">
              <SettingsCard className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                    <Shield size={22} className="text-indigo-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">{t('settings_ui.privacy.dashboard')}</h3>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">{t('settings_ui.privacy.dashboardDesc')}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-indigo-500/10 rounded-full text-[10px] font-semibold text-indigo-400 border border-indigo-500/20">{t('settings_ui.privacy.zeroKnowledge')}</span>
                      <span className="px-3 py-1 bg-emerald-500/10 rounded-full text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">{t('settings_ui.privacy.clientSideEncryption')}</span>
                    </div>
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard>
                <div className="flex items-center gap-3">
                  <Info size={16} className="text-indigo-400 shrink-0" />
                  <p className="text-xs text-[var(--text-muted)]">{t('settings_ui.privacy.autoHandled')}</p>
                </div>
              </SettingsCard>
            </section>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings.databaseTitle')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings.databaseDesc')}</p>

            {dbLoading ? (
              <div className="flex items-center gap-3 text-[var(--text-muted)] py-12">
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-sm">{t('settings_ui.db.loading')}</span>
              </div>
            ) : (
              <section className="space-y-6">
                {/* === VAULT MODE (Logged In) === */}
                {session ? (
                  <>
                    {/* Vault Status Banner */}
                    <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                      vaultStatus === 'unlocked'
                        ? 'bg-emerald-500/10 border-emerald-500/20'
                        : vaultStatus === 'locked'
                        ? 'bg-amber-500/10 border-amber-500/20'
                        : 'bg-indigo-500/10 border-indigo-500/20'
                    }`}>
                      {vaultStatus === 'unlocked' ? (
                        <>
                          <Unlock size={18} className="text-emerald-400" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-emerald-400">{t('vault.unlocked')}</span>
                            <p className="text-[11px] text-emerald-400/60">
                              {t('vault.unlockedDescription')}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              lockVault();
                              dispatch({ type: 'SET_DB_CONFIG', payload: { uri: '' } });
                              addNotification({ title: 'Locked', message: t('settings_ui.db.vaultLocked'), type: 'info' });
                            }}
                            className="px-3 py-1.5 text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] flex items-center gap-1.5 transition-colors"
                          >
                            <Lock size={12} /> {t('settings_ui.db.lock')}
                          </button>
                        </>
                      ) : vaultStatus === 'locked' ? (
                        <>
                          <Lock size={18} className="text-[var(--accent-amber)]" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-[var(--accent-amber)]">{t('settings_ui.vaultStatus.locked')}</span>
                            <p className="text-[11px] text-[var(--accent-amber)]/60">{t('vault.unlockDescription')}</p>
                          </div>
                          <button
                            onClick={showVault}
                            className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-bold transition-colors"
                          >
                            {t('settings_ui.db.unlockNow')}
                          </button>
                        </>
                      ) : (
                        <>
                          <Shield size={18} className="text-[var(--accent-indigo)]" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-[var(--accent-indigo)]">{t('settings_ui.vaultStatus.none')}</span>
                            <p className="text-[11px] text-[var(--accent-indigo)]/60">{t('vault.setupDescription')}</p>
                          </div>
                          <button
                            onClick={showVault}
                            className="px-3 py-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 rounded-lg text-white font-bold transition-colors"
                          >
                            {t('settings_ui.db.setupNow')}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Connected URI (masked) when unlocked */}
                    {vaultStatus === 'unlocked' && decryptedUri && (
                      <div className={`p-4 border rounded-xl ${
                        /localhost|127\.0\.0\.1/.test(decryptedUri) && !relayConnected
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)]'
                      }`}>
                        <h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2 flex items-center gap-2">
                          <Database size={14} className={/localhost|127\.0\.0\.1/.test(decryptedUri) && !relayConnected ? 'text-amber-400' : 'text-emerald-400'} />
                          {t('settings_ui.db.activeDb')}
                        </h3>
                        <code className={`text-xs font-mono break-all ${/localhost|127\.0\.0\.1/.test(decryptedUri) && !relayConnected ? 'text-amber-400/70' : 'text-emerald-400/70'}`}>
                          {decryptedUri.replace(/:([^@]+)@/, ':••••••@')}
                        </code>
                        {/localhost|127\.0\.0\.1/.test(decryptedUri) && !relayConnected && (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-[11px] text-amber-400/80">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                              {t('settings_ui.db.relayRequired')}
                            </div>
                            <button
                              onClick={() => {
                                const el = document.getElementById('relay-agent-section');
                                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              className="shrink-0 text-[10px] font-bold text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
                            >
                              {t('settings_ui.db.installRelay')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Vault Actions */}
                    {vaultStatus === 'unlocked' && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            showConfirm(
                              t('settings_ui.db.deleteConfirm'),
                              async () => {
                                await clearVault();
                                dispatch({ type: 'SET_DB_CONFIG', payload: { uri: '' } });
                                addNotification({ title: t('common.removed'), message: t('settings_ui.db.vaultCleared'), type: 'info' });
                              },
                              t('settings_ui.db.deleteVault')
                            );
                          }}
                          className="text-xs text-red-400/70 hover:text-red-400 font-medium px-4 py-2 rounded-xl bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 transition-all flex items-center gap-2"
                        >
                          <Trash2 size={13} />
                          {t('settings_ui.db.deleteVault')}
                        </button>
                      </div>
                    )}

                    {/* SSH Connection Mode Selector */}
                    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/10">
                            <Terminal size={15} className="text-indigo-400" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[var(--text-primary)]">SSH Connection Mode</h4>
                            <p className="text-[10px] text-[var(--text-muted)]">Choose how SSH connections are handled</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {/* Server Mode */}
                          <button
                            onClick={() => {
                              localStorage.setItem('ssh_monitor_ssh_mode', 'server');
                              window.dispatchEvent(new Event('ssh-mode-changed'));
                              addNotification({ title: 'SSH Mode', message: 'Switched to Server mode', type: 'info' });
                            }}
                            className={`relative p-3 rounded-xl border text-left transition-all ${
                              sshMode === 'server'
                                ? 'border-indigo-500/50 bg-indigo-500/10'
                                : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                            }`}
                          >
                            {sshMode === 'server' && (
                              <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                                <Check size={10} className="text-white" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              <Server size={14} className="text-indigo-400" />
                              <span className="text-[11px] font-bold text-[var(--text-primary)]">Server</span>
                              {window.innerWidth < 768 && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-bold">Recommended</span>
                              )}
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] text-emerald-400">✓ Works on phone & desktop</p>
                              <p className="text-[9px] text-emerald-400">✓ Zero setup required</p>
                              <p className="text-[9px] text-emerald-400">✓ SFTP, Docker, AI included</p>
                              <p className="text-[9px] text-amber-400">• Uses server resources</p>
                            </div>
                          </button>

                          {/* Local Mode */}
                          <button
                            onClick={() => {
                              const isMobile = window.innerWidth < 768;
                              if (isMobile) {
                                addNotification({ title: 'Not Available on Mobile', message: 'Local mode requires a desktop with the relay agent. Use Server mode on mobile.', type: 'warning' });
                                return;
                              }
                              if (relayConnected) {
                                localStorage.setItem('ssh_monitor_ssh_mode', 'local');
                                window.dispatchEvent(new Event('ssh-mode-changed'));
                                addNotification({ title: 'SSH Mode', message: 'Switched to Local mode', type: 'success' });
                              } else {
                                addNotification({ title: 'Relay Required', message: 'Install the relay agent first', type: 'warning' });
                              }
                            }}
                            className={`relative p-3 rounded-xl border text-left transition-all ${
                              window.innerWidth < 768
                                ? 'border-[var(--border-color)] opacity-50 cursor-not-allowed'
                                : sshMode === 'local'
                                ? 'border-emerald-500/50 bg-emerald-500/10'
                                : !relayConnected
                                ? 'border-[var(--border-color)] opacity-60'
                                : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                            }`}
                          >
                            {sshMode === 'local' && (
                              <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                                <Check size={10} className="text-white" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              <Monitor size={14} className="text-emerald-400" />
                              <span className="text-[11px] font-bold text-[var(--text-primary)]">Local</span>
                              {window.innerWidth >= 768 && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Recommended</span>
                              )}
                              {window.innerWidth < 768 ? (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Desktop only</span>
                              ) : !relayConnected ? (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">Requires Relay</span>
                              ) : null}
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] text-emerald-400">✓ Your machine handles SSH</p>
                              <p className="text-[9px] text-emerald-400">✓ Server sees nothing</p>
                              <p className="text-[9px] text-emerald-400">✓ Faster (direct connection)</p>
                              <p className="text-[9px] text-amber-400">• Desktop + relay agent required</p>
                            </div>
                          </button>
                        </div>

                        {/* Platform tip */}
                        {window.innerWidth < 768 ? (
                          <div className="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                            <Server size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-indigo-300">
                              <strong>Mobile tip:</strong> Use Server mode to connect to remote servers. For localhost targets, make sure your desktop relay is running — the app server will route through it automatically.
                            </p>
                          </div>
                        ) : (
                          <div className="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                            <Monitor size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-emerald-300">
                              <strong>Desktop tip:</strong> Local mode is recommended — your machine handles SSH directly, the server sees nothing, and it&apos;s faster. Install the relay agent to enable it.
                            </p>
                          </div>
                        )}

                        {/* Comparison table */}
                        <details className="mt-3 group">
                          <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1.5">
                            <ChevronDown size={11} className="group-open:rotate-180 transition-transform" />
                            Compare modes in detail
                          </summary>
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-[9px]">
                              <thead>
                                <tr className="border-b border-[var(--border-color)]">
                                  <th className="text-left py-1.5 pr-3 text-[var(--text-muted)] font-medium">Feature</th>
                                  <th className="text-center py-1.5 px-2 text-indigo-400 font-medium">Server</th>
                                  <th className="text-center py-1.5 pl-2 text-emerald-400 font-medium">Local</th>
                                </tr>
                              </thead>
                              <tbody className="text-[var(--text-secondary)]">
                                <tr className="border-b border-[var(--border-color)]/50">
                                  <td className="py-1.5 pr-3">Setup</td>
                                  <td className="text-center py-1.5 px-2 text-emerald-400">None</td>
                                  <td className="text-center py-1.5 pl-2 text-amber-400">Install agent</td>
                                </tr>
                                <tr className="border-b border-[var(--border-color)]/50">
                                  <td className="py-1.5 pr-3">Speed</td>
                                  <td className="text-center py-1.5 px-2">Good</td>
                                  <td className="text-center py-1.5 pl-2 text-emerald-400">Faster</td>
                                </tr>
                                <tr className="border-b border-[var(--border-color)]/50">
                                  <td className="py-1.5 pr-3">Privacy</td>
                                  <td className="text-center py-1.5 px-2 text-amber-400">Server sees</td>
                                  <td className="text-center py-1.5 pl-2 text-emerald-400">End-to-end</td>
                                </tr>
                                <tr className="border-b border-[var(--border-color)]/50">
                                  <td className="py-1.5 pr-3">SFTP/Docker/AI</td>
                                  <td className="text-center py-1.5 px-2 text-emerald-400">Built-in</td>
                                  <td className="text-center py-1.5 pl-2">Needs ssh2</td>
                                </tr>
                                <tr className="border-b border-[var(--border-color)]/50">
                                  <td className="py-1.5 pr-3">Server load</td>
                                  <td className="text-center py-1.5 px-2 text-amber-400">High</td>
                                  <td className="text-center py-1.5 pl-2 text-emerald-400">Minimal</td>
                                </tr>
                                <tr>
                                  <td className="py-1.5 pr-3">100+ users</td>
                                  <td className="text-center py-1.5 px-2 text-red-400">Slow</td>
                                  <td className="text-center py-1.5 pl-2 text-emerald-400">No issue</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </div>
                    </div>

                    {/* Local Relay Agent — Local Access Gateway */}
                    <div id="relay-agent-section" className="rounded-2xl border overflow-hidden"
                      style={{ borderColor: relayConnected ? 'rgba(52,211,153,0.25)' : 'var(--border-color)' }}
                    >
                      {/* Header */}
                      <div className={`px-4 py-3 flex items-center gap-3 ${relayConnected ? 'bg-emerald-500/[0.05]' : 'bg-amber-500/[0.04]'}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${relayConnected ? 'bg-emerald-500/15' : 'bg-amber-500/10'}`}>
                          <Network size={15} className={relayConnected ? 'text-emerald-400' : 'text-amber-400'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-[var(--text-primary)]">SSH Relay</h4>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                              relayConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${relayConnected ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-muted)]'}`} />
                              {relayConnected ? 'Ready' : 'Offline'}
                            </span>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                            {relayConnected
                              ? 'Relay agent ready — local databases accessible'
                              : 'Access local databases from your machine via secure relay'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!relayToken ? (
                            <button
                              onClick={async () => {
                                setExistingRelayIds(new Set(relays.map(r => r.relayId || r.relayName)));
                                const success = await handleGenerateRelayToken();
                                if (success) {
                                  setRelayWizardStep(2);
                                  setRelayInstallSuccess(false);
                                  setRelayModalOpen(true);
                                }
                              }}
                              disabled={relayLoading}
                              className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20 disabled:opacity-50"
                            >
                              {relayLoading ? <Loader size={11} className="animate-spin" /> : <Zap size={11} />}
                              {relayLoading ? 'Generating…' : 'Generate Token'}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={handleRevokeAllRelays}
                                className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10"
                                title="Revoke token and disconnect all relays"
                              >
                                <X size={10} /> Revoke All
                              </button>
                              <button
                                onClick={() => {
                                  setExistingRelayIds(new Set(relays.map(r => r.relayId || r.relayName)));
                                  setRelayWizardStep(2);
                                  setRelayInstallSuccess(false);
                                  setRelayModalOpen(true);
                                }}
                                className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] text-[var(--text-secondary)]"
                              >
                                <Settings size={11} /> Install Guide
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Active relays list */}
                      {relayConnected && relays.length > 0 && (
                        <div className="px-4 py-3 border-t border-[var(--border-color)] space-y-1.5">
                          {relays.length > 1 && (
                            <p className="text-[10px] text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                              <span className="opacity-60">Click a relay to set it as your active connection for this browser</span>
                            </p>
                          )}
                          {relays.map(r => {
                            const relayLabel = r.relayName || r.relayId;
                            const isPreferred = preferredRelay === relayLabel;
                            return (
                              <div
                                key={r.relayId || r.relayName}
                                onClick={() => {
                                  localStorage.setItem('ssh_monitor_preferred_relay', relayLabel);
                                  setPreferredRelay(relayLabel);
                                  addNotification({ title: 'Relay Selected', message: `"${relayLabel}" is now your active relay for this browser.`, type: 'success' });
                                }}
                                className={`w-full flex items-center gap-2.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                                  isPreferred
                                    ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                                    : 'hover:bg-white/5 border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                                title={isPreferred ? 'Currently active relay for this browser' : 'Click to use this relay'}
                              >
                                <span className={`w-2 h-2 rounded-full shrink-0 ${isPreferred ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-emerald-500/40'}`} />
                                <span className="font-mono flex-1 text-left">{relayLabel}</span>
                                <span className="opacity-40">:{r.localPort}</span>
                                {isPreferred && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                                    Active
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await handleDisconnectRelay(r.relayId, r.relayName);
                                  }}
                                  className="p-1 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors shrink-0 cursor-pointer"
                                  title={`Disconnect ${relayLabel}`}
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Install command when token exists but relay not connected */}
                      {relayToken && !relayConnected && (
                        <div className="px-4 py-3 border-t border-[var(--border-color)] space-y-2">
                          <p className="text-[10px] font-bold text-[var(--text-secondary)]">Run this on your machine:</p>
                          <div className="relative">
                            <code className="block p-2.5 pr-10 bg-slate-950 border border-slate-800 rounded-lg text-[9px] font-mono text-amber-300 break-all leading-relaxed">
                              {getRelayOneLiner('install')}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(getRelayOneLiner('install'));
                                addNotification({ title: 'Copied!', message: 'Paste in your Terminal and press Enter.', type: 'success' });
                              }}
                              className="absolute right-1.5 top-1.5 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                            >
                              <Copy size={12} className="text-[var(--text-muted)]" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Info when not connected and no token */}
                      {!relayConnected && !relayToken && (
                        <div className="px-4 py-3 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)]/30">
                          <div className="flex items-start gap-2.5">
                            <Info size={13} className="text-blue-400 shrink-0 mt-0.5" />
                            <div className="text-[10px] text-[var(--text-muted)] space-y-1">
                              <p><strong className="text-[var(--text-secondary)]">When do you need this?</strong></p>
                              <p>• Your SSH/database server runs on <code className="text-amber-300">localhost</code> or <code className="text-amber-300">127.0.0.1</code></p>
                              <p>• You want to access it from this dashboard (which runs on a different server)</p>
                              <p className="text-emerald-400/80">✓ Not needed for remote servers (public IP/domain)</p>
                              <p className="text-emerald-400/80">✓ Not needed if you access the dashboard directly on localhost</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Security Info */}
                    <div className="p-6 bg-indigo-500/[0.03] border border-indigo-500/10 rounded-2xl">
                      <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4">{t('common.security')} & {t('common.privacy')}</h4>
                      <div className="space-y-4">
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                            <Key size={16} className="text-indigo-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{t('vault.masterPassword')}</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                              {t('vault.privacyDesc')}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <Shield size={16} className="text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{t('settings_ui.db.sessionOnlyMemory')}</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                              {t('settings_ui.db.sessionOnlyMemoryDesc')}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                            <Mail size={16} className="text-amber-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{t('settings_ui.db.emailRecovery')}</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                              {t('settings_ui.db.emailRecoveryDesc')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  /* === LEGACY MODE (Not Logged In) === */
                  <>
                    {/* Connection Status Banner */}
                    <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                      dbConnected 
                        ? 'bg-emerald-500/10 border-emerald-500/20' 
                        : 'bg-amber-500/10 border-amber-500/20'
                    }`}>
                      {dbConnected ? (
                        <>
                          <Wifi size={18} className="text-emerald-400" />
                          <div>
                            <span className="text-sm font-medium text-emerald-400">{t('settings_ui.db.connected')}</span>
                            <p className="text-[11px] text-emerald-400/60">{t('settings_ui.db.connectedDesc')}</p>
                          </div>
                        </>
                      ) : (
                        <>
                           <WifiOff size={18} className="text-[var(--accent-amber)]" />
                           <div>
                             <span className="text-sm font-medium text-[var(--accent-amber)]">{t('settings_ui.db.notConnected')}</span>
                             <p className="text-[11px] text-[var(--accent-amber)]/60">{t('settings_ui.db.notConnectedDesc')}</p>
                           </div>
                        </>
                      )}
                    </div>

                    {/* Connection URI */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Database size={16} className="text-indigo-400" />
                        {t('settings_ui.db.type') || 'Database Type'}
                      </h3>
                      <div className="grid grid-cols-3 gap-3 mb-6">
                         {[
                           { id: 'mongodb', label: 'MongoDB', color: '#10b981', icon: Database, bg: 'bg-emerald-500/10' },
                           { id: 'mysql', label: 'MySQL', color: '#00758f', icon: Database, bg: 'bg-blue-500/10' },
                           { id: 'postgres', label: 'Postgres', color: '#336791', icon: Database, bg: 'bg-indigo-500/10' },
                         ].map(prov => (
                           <button 
                             key={prov.id}
                             onClick={() => {
                                if (prov.id === 'mongodb') setDbUri('mongodb://127.0.0.1:27017/ssh-monitor');
                                if (prov.id === 'mysql') setDbUri('mysql://root:password@127.0.0.1:3306/ssh-monitor');
                                if (prov.id === 'postgres') setDbUri('postgres://postgres:password@127.0.0.1:5432/ssh-monitor');
                             }}
                             className={`flex flex-col items-center gap-2 py-4 rounded-2xl border transition-all ${
                               (dbUri.startsWith(prov.id === 'mongodb' ? 'mongodb' : prov.id) || (prov.id === 'mongodb' && dbUri === ''))
                                 ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]/50 text-[var(--accent-indigo)]'
                                 : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                             }`}
                           >
                              <div className={`p-2 rounded-xl ${prov.bg}`}>
                                <prov.icon size={20} style={{ color: prov.color }} />
                              </div>
                              <span className="text-[11px] font-bold">{prov.label}</span>
                           </button>
                         ))}
                      </div>

                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Lock size={16} className="text-indigo-400" />
                        {dbUri.includes('mysql') ? 'MySQL Connection String' : dbUri.includes('postgres') ? 'PostgreSQL Connection String' : t('settings_ui.db.mongoDbUri')}
                      </h3>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)]/50 focus:ring-1 focus:ring-[var(--accent-indigo)]/25 transition-all"
                          placeholder={dbUri.includes('mysql') ? 'mysql://user:pass@host:port/db' : dbUri.includes('postgres') ? 'postgres://user:pass@host:port/db' : 'mongodb://127.0.0.1:27017/ssh-monitor'}
                          value={dbUri}
                          onChange={(e) => setDbUri(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                        />
                        <button
                          onClick={handleConnect}
                          disabled={dbConnecting || !dbUri.trim()}
                          className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap shadow-lg ${
                            dbConnecting
                              ? 'bg-[var(--accent-indigo)]/50 text-[var(--text-selected)]/50 cursor-wait'
                              : 'bg-[var(--bg-selected)] hover:opacity-90 text-[var(--text-selected)] shadow-[var(--glow-indigo)]/20 border border-[var(--accent-indigo)]/30'
                          }`}
                        >
                          {dbConnecting ? (
                            <><Loader size={14} className="animate-spin" /> {t('settings_ui.db.connecting')}</>
                          ) : (
                            <><Zap size={14} /> {t('settings_ui.db.connect')}</>
                          )}
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                        {t('settings_ui.db.example')}: <code className="text-indigo-400/70">{dbUri.includes('mysql') ? 'mysql://root:secret@127.0.0.1:3306/mydb' : dbUri.includes('postgres') ? 'postgres://pg:secret@127.0.0.1:5432/mydb' : 'mongodb://127.0.0.1:27017/ssh-monitor'}</code>
                      </p>
                    </div>

                    {/* Quick Presets */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-[var(--text-muted)]">{t('settings_ui.db.quickPresets')}</h3>
                      <div className="flex flex-wrap gap-2">
                        {PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => setDbUri(preset.uri)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              dbUri === preset.uri 
                                ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]/50 text-[var(--accent-indigo)]' 
                                : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                  </>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === 'keyboard' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Key} iconColor="text-rose-400" title={t('settings_ui.keyboard.title')} description={t('settings_ui.keyboard.desc')} />

            <section className="space-y-3">
              {[
                { id: 'previewWindow', label: t('settings_ui.keyboard.missionControl'), desc: t('settings_ui.keyboard.descriptions.missionControl'), icon: Layout },
                { id: 'spotlight', label: t('settings_ui.keyboard.spotlightSearch'), desc: t('settings_ui.keyboard.descriptions.spotlightSearch'), icon: Search },
                { id: 'prevDesktop', label: t('settings_ui.keyboard.prevDesktop'), desc: t('settings_ui.keyboard.descriptions.prevDesktop'), icon: Monitor },
                { id: 'nextDesktop', label: t('settings_ui.keyboard.nextDesktop'), desc: t('settings_ui.keyboard.descriptions.nextDesktop'), icon: Monitor },
                { id: 'minimizeAll', label: t('settings_ui.keyboard.minimizeAll'), desc: t('settings_ui.keyboard.descriptions.minimizeAll'), icon: Layout },
                { id: 'closeAll', label: t('settings_ui.keyboard.closeAll'), desc: t('settings_ui.keyboard.descriptions.closeAll'), icon: Trash2 },
              ].map(item => (
                <SettingsCard key={item.id}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                        <item.icon size={16} className="text-indigo-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</h4>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    <ShortcutInput
                      value={osState.keyboardShortcuts?.[item.id] || ''}
                      onChange={(val) => setKeyboardShortcuts({ [item.id]: val })}
                      placeholder="e.g. Cmd+K"
                      className="w-36 border-indigo-500/20 text-[var(--accent-indigo)]"
                    />
                  </div>
                </SettingsCard>
              ))}

              <SettingsCard className="bg-amber-500/5 border-amber-500/20">
                <div className="flex items-start gap-3">
                  <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    <strong>Tip:</strong> Use standard combos like <code className="bg-amber-500/10 px-1 rounded">Cmd+K</code>, <code className="bg-amber-500/10 px-1 rounded">Ctrl+Shift+L</code>. <code className="bg-amber-500/10 px-1 rounded">Cmd</code> = Command/Windows Key, <code className="bg-amber-500/10 px-1 rounded">Ctrl</code> = Control.
                  </p>
                </div>
              </SettingsCard>
            </section>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="max-w-lg mx-auto py-8 text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl shadow-2xl shadow-indigo-500/20 flex items-center justify-center mb-5">
              <Monitor size={40} className="text-white" />
            </div>
            <h2 className="text-xl font-bold mb-0.5">SSH Monitor</h2>
            <p className="text-indigo-400 text-sm font-medium mb-6">{t('settings_ui.about.version', { version: '1.0.5 (Beta)' })}</p>
            
            <SettingsCard className="text-left">
              <p className="text-xs text-[var(--text-secondary)] mb-4">{t('settings_ui.about.description')}</p>
              <div className="space-y-2.5">
                <div className="flex justify-between py-2 border-b border-[var(--border-color)]/40">
                  <span className="text-xs text-[var(--text-muted)]">{t('settings_ui.about.environment')}</span>
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{t('settings_ui.about.environmentValue')}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[var(--border-color)]/40">
                  <span className="text-xs text-[var(--text-muted)]">{t('settings_ui.about.resolution')}</span>
                  <span className="text-xs font-mono text-[var(--text-primary)]">{typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'N/A'}</span>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-3">{t('settings_ui.about.securityEng')}</p>
                {[
                  { icon: Shield, color: 'text-indigo-400', bg: 'bg-indigo-500/10', label: t('settings_ui.about.keyDerivation'), value: t('settings_ui.about.keyDerivationValue') },
                  { icon: Lock, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: t('settings_ui.about.encryption'), value: t('settings_ui.about.encryptionValue') },
                  { icon: Code, color: 'text-amber-400', bg: 'bg-amber-500/10', label: t('settings_ui.about.defense'), value: t('settings_ui.about.defenseValue') },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--bg-tertiary)]">
                    <div className={`w-7 h-7 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
                      <item.icon size={13} className={item.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase">{item.label}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between mt-4 pt-3 border-t border-[var(--border-color)]/40">
                <span className="text-xs text-[var(--text-muted)]">{t('settings_ui.about.license')}</span>
                <span className="text-xs font-bold text-[var(--text-primary)]">{t('settings_ui.about.licenseValue')}</span>
              </div>
            </SettingsCard>

            <p className="mt-6 text-[10px] text-[var(--text-muted)] italic">{t('settings_ui.about.quote')}</p>
          </div>
        )}

        {activeTab === 'deployment' && (
          <div className="max-w-6xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Top Toolbar / Dashboard Selector */}
            <div className="p-4 mb-4 rounded-2xl bg-slate-900/40 border border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('deploy.selectProject', 'Select Project:')}</label>
                <div className="relative" ref={projectDropdownRef}>
                  <button
                    type="button"
                    onClick={() => { setProjectDropdownOpen(!projectDropdownOpen); setProjectSearch(''); }}
                    className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] font-bold focus:outline-none focus:border-indigo-500 min-w-[200px] max-w-[280px] flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-500/50 transition-colors"
                  >
                    <span className="truncate flex items-center gap-1.5">
                      {(() => {
                        const sel = deployProjects.find(p => p.id === selectedProjectId);
                        const rs = sel ? getReadinessStatus(sel) : null;
                        const dot = rs?.status === 'ready' ? '●' : rs?.status === 'incomplete' ? '●' : '○';
                        const dotColor = rs?.status === 'ready' ? 'text-green-400' : rs?.status === 'incomplete' ? 'text-amber-400' : 'text-gray-500';
                        return <span className={`text-[10px] ${dotColor}`}>{dot}</span>;
                      })()}
                      {selectedProjectId}{deployConfig.name ? ` - ${deployConfig.name}` : ''}
                    </span>
                    <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {projectDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-[300px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-[var(--border-color)]">
                        <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-2 py-1.5">
                          <Search size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                          <input
                            ref={projectSearchRef}
                            type="text"
                            value={projectSearch}
                            onChange={(e) => setProjectSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setProjectDropdownIndex(i => Math.min(i + 1, filteredProjects.length - 1));
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setProjectDropdownIndex(i => Math.max(i - 1, 0));
                              } else if (e.key === 'Enter' && filteredProjects[projectDropdownIndex]) {
                                setSelectedProjectId(filteredProjects[projectDropdownIndex].id);
                                setProjectDropdownOpen(false);
                                setProjectSearch('');
                              } else if (e.key === 'Escape') {
                                setProjectDropdownOpen(false);
                                setProjectSearch('');
                              }
                            }}
                            placeholder="Search projects..."
                            className="bg-transparent text-xs text-[var(--text-primary)] outline-none w-full placeholder:text-[var(--text-muted)]"
                          />
                          {projectSearch && (
                            <button onClick={() => setProjectSearch('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-[240px] overflow-y-auto py-1">
                        {filteredProjects.length === 0 ? (
                          <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">No projects found</div>
                        ) : (
                          filteredProjects.map((p, idx) => {
                            const rs = getReadinessStatus(p);
                            const dot = rs.status === 'ready' ? '●' : rs.status === 'incomplete' ? '●' : '○';
                            const dotColor = rs.status === 'ready' ? 'text-green-400' : rs.status === 'incomplete' ? 'text-amber-400' : 'text-gray-500';
                            const isSelected = p.id === selectedProjectId;
                            const isHighlighted = idx === projectDropdownIndex;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => { setSelectedProjectId(p.id); setProjectDropdownOpen(false); setProjectSearch(''); }}
                                onMouseEnter={() => setProjectDropdownIndex(idx)}
                                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                                  isHighlighted ? 'bg-indigo-600/20' : 'hover:bg-slate-700/30'
                                } ${isSelected ? 'text-indigo-400 font-bold' : 'text-[var(--text-primary)]'}`}
                              >
                                <span className={`text-[10px] ${dotColor} flex-shrink-0`}>{dot}</span>
                                <span className="truncate">{p.id}{p.name ? ` - ${p.name}` : ''}</span>
                                {isSelected && <Check size={12} className="ml-auto text-indigo-400 flex-shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                
                <button
                  type="button"
                  onClick={handleCreateProject}
                  className="px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded-xl text-xs font-bold transition-all border border-indigo-500/20 flex items-center gap-1 cursor-pointer"
                >
                  {t('deploy.addProject', '＋ Add Project')}
                </button>
                {selectedProjectId !== 'default' && (
                  <button
                    type="button"
                    onClick={handleDeleteProject}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-bold transition-all border border-red-500/20 cursor-pointer"
                  >
                    {t('deploy.deleteProject', 'Delete Project')}
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('deploy.alias', 'Alias:')}</label>
                <input
                  type="text"
                  value={deployConfig.name || ''}
                  onChange={(e) => setDeployConfig(p => ({ ...p, name: e.target.value }))}
                  placeholder={t('deploy.placeholderAlias', 'Optional display name')}
                  className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] font-bold focus:outline-none focus:border-indigo-500 w-[180px]"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                  {t('deploy.title', 'Auto Deployment')}: <span className="text-indigo-400">{selectedProjectId}</span>
                  {deployConfig.name && <span className="text-sm text-[var(--text-secondary)]">({t('deploy.alias', 'Alias:')} {deployConfig.name})</span>}
                </h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">{t('deploy.subtitle', 'Configure automated git-triggered deployments via webhooks.')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveDeployConfig}
                  disabled={deploySaving || deployLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  {deploySaving ? <Loader size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  {t('deploy.saveSettings', 'Save Settings')}
                </button>
                <button
                  onClick={handleTriggerDeploy}
                  disabled={deployTriggering || deployLoading || deployConfig.status === 'running'}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  {deployTriggering ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {t('deploy.deployNow', 'Deploy Now')}
                </button>
                {deployConfig.status === 'failed' && (
                  <button
                    onClick={handleTriggerDeploy}
                    disabled={deployTriggering || deployLoading}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    {deployTriggering ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    {t('deploy.retry', 'Retry')}
                  </button>
                )}
                {deployConfig.status === 'running' && (
                  <>
                    <button
                      onClick={handleCancelDeploy}
                      disabled={deployLoading}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      {t('deploy.cancel', 'Cancel')}
                    </button>
                    <button
                      onClick={handleForceResetDeploy}
                      disabled={deployLoading}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                      title="Force-reset if deploy is stuck"
                    >
                      {t('deploy.forceReset', 'Force Reset')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {deployLoading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <Loader className="animate-spin text-indigo-500" size={32} />
                <p className="text-xs text-[var(--text-muted)] font-medium">{t('deploy.loadingConfig', 'Loading deployment configuration...')}</p>
              </div>
            ) : (
              <div className="space-y-6 mt-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="inline-flex rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-1">
                    <button
                      type="button"
                      onClick={() => setDeploymentTab('configuration')}
                      className={`rounded-xl px-4 py-2 text-xs font-bold transition ${deploymentTab === 'configuration' ? 'bg-indigo-600 text-white' : 'text-[var(--text-secondary)] hover:bg-slate-700/50'}`}
                    >
                      {t('deploy.tabConfiguration', 'Configuration')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeploymentTab('logs')}
                      className={`rounded-xl px-4 py-2 text-xs font-bold transition ${deploymentTab === 'logs' ? 'bg-indigo-600 text-white' : 'text-[var(--text-secondary)] hover:bg-slate-700/50'}`}
                    >
                      {t('deploy.tabLogs', 'Logs')}
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">{t('deploy.toggleLogHint', 'Toggle between deployment settings and console logs for easier access.')}</p>
                </div>
                {deploymentTab === 'configuration' ? (
                  <>
                    {/* Status Panel */}
                    <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${
                      deployConfig.status === 'running' 
                        ? 'bg-amber-500/10 text-amber-500 animate-pulse'
                        : deployConfig.status === 'success'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : deployConfig.status === 'failed'
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-slate-500/10 text-[var(--text-muted)]'
                    }`}>
                      <GitBranch size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">{t('deploy.statusTitle', 'Deployment Status')}</h4>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {deployConfig.status === 'running' && t('deploy.statusRunningDesc', 'Deployment script is running in the background...')}
                        {deployConfig.status === 'success' && t('deploy.statusSuccessDesc', 'Latest deployment finished successfully.')}
                        {deployConfig.status === 'failed' && t('deploy.statusFailedDesc', 'Latest deployment execution failed.')}
                        {deployConfig.status === 'idle' && t('deploy.statusIdleDesc', 'No deployment has run yet.')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase border ${
                        readiness.status === 'ready'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : readiness.status === 'incomplete'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)]'
                      }`}>
                        {readiness.status === 'ready' ? t('deploy.readinessReady', 'Ready') : readiness.status === 'incomplete' ? t('deploy.readinessIncomplete', 'Incomplete') : t('deploy.readinessDisabled', 'Disabled')}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase border ${
                        deployConfig.status === 'running'
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                          : deployConfig.status === 'success'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : deployConfig.status === 'failed'
                          ? 'bg-red-500/10 text-red-500 border-red-500/20'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)]'
                      }`}>
                        {deployConfig.status}
                      </span>
                    </div>
                    {readiness.status === 'incomplete' && readiness.missing.length > 0 && (
                      <span className="text-[10px] text-amber-400/80">
                        {t('deploy.readinessMissing', 'Missing: {{items}}', { items: readiness.missing.join(', ') })}
                      </span>
                    )}
                    {deployConfig.lastDeployAt && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {t('deploy.lastRun', 'Last Run: ')}{new Date(deployConfig.lastDeployAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Configuration form */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left block - settings inputs */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* General Settings */}
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
                        <Shield size={16} className="text-indigo-400" />
                        {t('deploy.triggerConfig', 'Trigger Configuration')}
                      </h3>

                      <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)] pb-4">
                        <div>
                          <span className="block text-sm font-medium text-[var(--text-primary)]">{t('deploy.enableAutoDeploy', 'Enable Auto-Deploy')}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{t('deploy.enableAutoDeployDesc', 'Automatically run deployment script when pushes arrive')}</span>
                        </div>
                        <button
                          onClick={() => {
                            setDeployConfig(p => ({ ...p, enabled: !p.enabled }));
                          }}
                          className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${deployConfig.enabled ? 'bg-[var(--accent-indigo)]' : 'bg-[var(--bg-tertiary)]'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${deployConfig.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>

                        <div className="space-y-4">
                        <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3">{t('deploy.gitProvider', 'Git Provider')}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setGitProvider('github')}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${gitProvider === 'github' ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--border-color)]'}`}
                            >
                              GitHub
                            </button>
                            <button
                              onClick={() => setGitProvider('bitbucket')}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${gitProvider === 'bitbucket' ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--border-color)]'}`}
                            >
                              Bitbucket
                            </button>
                          </div>
                        </div>

                        {/* GitHub Connection */}
                        {gitProvider === 'github' && (
                        <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{t('deploy.githubConnection', 'GitHub Connection')}</p>
                              <p className="mt-1 text-sm text-[var(--text-primary)]">
                                {deployConfig.githubConnected
                                  ? t('deploy.githubConnectedAs', 'Connected as {{user}}', { user: deployConfig.githubUser || 'GitHub user' })
                                  : t('deploy.githubNotConnected', 'Not connected')}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={handleConnectGitHub}
                                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold"
                              >
                                {deployConfig.githubConnected ? t('deploy.githubReconnect', 'Reconnect') : t('deploy.githubConnect', 'Connect')}
                              </button>
                              {deployConfig.githubConnected && (
                                <button
                                  onClick={handleDisconnectGitHub}
                                  className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold"
                                >
                                  {t('deploy.githubDisconnect', 'Disconnect')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        )}

                        {/* Bitbucket Connection */}
                        {gitProvider === 'bitbucket' && (
                        <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                          <div className="flex flex-col gap-4">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Bitbucket Connection</p>
                              <p className="mt-1 text-sm text-[var(--text-primary)]">
                                {deployConfig.bitbucketConnected
                                  ? `Connected as ${deployConfig.bitbucketUser || 'Bitbucket user'}`
                                  : 'Not connected'}
                              </p>
                            </div>
                            {!deployConfig.bitbucketConnected ? (
                              <div className="space-y-3">
                                <input
                                  type="text"
                                  value={bbUsername}
                                  onChange={(e) => setBbUsername(e.target.value)}
                                  placeholder="Bitbucket username"
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                                />
                                <input
                                  type="password"
                                  value={bbAppPassword}
                                  onChange={(e) => setBbAppPassword(e.target.value)}
                                  placeholder="App password"
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                                />
                                <p className="text-[10px] text-[var(--text-muted)]">Create an app password at Bitbucket Settings &gt; App passwords with <b>Repositories: Read</b> permission.</p>
                                <button
                                  onClick={handleConnectBitbucket}
                                  disabled={bbConnecting}
                                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 text-white rounded-xl text-xs font-bold"
                                >
                                  {bbConnecting ? 'Connecting...' : 'Connect'}
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => { setBbUsername(''); setBbAppPassword(''); handleDisconnectBitbucket(); }}
                                  className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold"
                                >
                                  Disconnect
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{gitProvider === 'github' ? t('deploy.githubRepoLabel', 'GitHub repository') : 'Bitbucket repository'}</label>
                            {gitProvider === 'bitbucket' && bbRepos.length > 0 && !repoInput && (
                              <div className="mb-2">
                                <label className="block text-[10px] text-[var(--text-muted)] mb-1">Select from your repos:</label>
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      setRepoInput(e.target.value);
                                      setBbRepos([]);
                                    }
                                  }}
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                                >
                                  <option value="">{loadingBbRepos ? 'Loading repos...' : 'Choose a repository...'}</option>
                                  {bbRepos.map(r => (
                                    <option key={r.slug} value={r.slug}>{r.name} ({r.slug}){r.isPrivate ? ' 🔒' : ''}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <input
                              type="text"
                              value={repoInput}
                              onChange={(e) => setRepoInput(e.target.value)}
                              onBlur={() => {
                                const normalizer = gitProvider === 'bitbucket' ? normalizeBitbucketRepo : normalizeGitHubRepo;
                                const normalized = normalizer(repoInput);
                                if (normalized !== repoInput) {
                                  setRepoInput(normalized);
                                }
                              }}
                              placeholder={gitProvider === 'github' ? t('deploy.githubRepoPlaceholder', 'owner/repo') : 'workspace/repo-slug'}
                              className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                            />
                            <button
                              onClick={async () => {
                                const rawRepo = repoInput || deployConfig.githubRepo;
                                const normalizer = gitProvider === 'bitbucket' ? normalizeBitbucketRepo : normalizeGitHubRepo;
                                const repoValue = normalizer(rawRepo);
                                if (!repoValue || repoValue.split('/').length < 2) {
                                  addNotification({ title: t('deploy.branchesNotifTitle', 'Branches'), message: t('deploy.branchInvalidRepo', 'Enter a valid repository in owner/repo format or URL.'), type: 'error' });
                                  return;
                                }
                                try {
                                  setLoadingBranches(true);
                                  setBranches([]);
                                  const param = `repo=${encodeURIComponent(repoValue)}&project=${encodeURIComponent(selectedProjectId)}`;
                                  const endpoint = gitProvider === 'bitbucket' ? '/api/deploy/bitbucket/branches' : '/api/deploy/github/branches';
                                  const res = await apiFetch(`${endpoint}?${param}`);
                                  const data = await res.json();
                                  if (data.success) {
                                    setBranches(data.branches || []);
                                    if ((data.branches || []).length > 0) {
                                      const repoField = gitProvider === 'bitbucket' ? 'bitbucketRepo' : 'githubRepo';
                                      setDeployConfig(p => ({ ...p, branch: data.branches[0], [repoField]: repoValue }));
                                      setRepoInput(repoValue);
                                    }
                                  } else {
                                    addNotification({ title: t('deploy.branchesNotifTitle', 'Branches'), message: data.error || t('deploy.branchLoadFailed', 'Failed to load branches'), type: 'error' });
                                  }
                                } catch (err) {
                                  console.error('Failed to load branches:', err);
                                  addNotification({ title: t('deploy.branchesNotifTitle', 'Branches'), message: t('deploy.branchLoadFailed', 'Failed to load branches'), type: 'error' });
                                } finally {
                                  setLoadingBranches(false);
                                }
                              }}
                              disabled={!repoInput && !deployConfig.githubRepo}
                              className={`mt-3 w-full px-3 py-2 rounded-xl text-xs font-bold text-white transition-all ${!repoInput && !deployConfig.githubRepo ? 'bg-slate-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500'}`}
                            >
                              {loadingBranches ? t('deploy.branchLoading', 'Loading branches...') : t('deploy.branchLoadBtn', 'Load branches')}
                            </button>
                            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                              {repoInput || deployConfig.githubRepo
                                ? t('deploy.branchLoadingFor', 'Loading branches for {{repo}}.', { repo: repoInput || deployConfig.githubRepo })
                                : t('deploy.branchEnterFirst', 'Enter an owner/repo or use the saved repository before loading branches.')}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {gitProvider === 'github'
                                ? t('deploy.branchPublicHint', 'Public repos can load without GitHub auth; private repos require connection.')
                                : 'Private repos require Bitbucket connection.'}
                            </p>
                            {repoChanged && (
                              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                                <span className="text-xs">⚠</span>
                                <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.branchToWatch', 'Branch to watch')}</label>
                            {branches && branches.length > 0 ? (
                              <select
                                value={deployConfig.branch}
                                onChange={(e) => setDeployConfig(p => ({ ...p, branch: e.target.value }))}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 transition-all"
                              >
                                {branches.map(b => <option key={b} value={b}>{b}</option>)}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={deployConfig.branch}
                                onChange={(e) => setDeployConfig(p => ({ ...p, branch: e.target.value }))}
                                placeholder="main"
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 transition-all"
                              />
                            )}
                            <p className="mt-2 text-[10px] text-[var(--text-muted)]">{t('deploy.branchLoadHint', 'Load branches first to select from the repository automatically.')}</p>
                            <p className="mt-1 text-[10px] text-[var(--text-muted)]">{t('deploy.branchAnyHint', 'Leave branch blank to trigger on any branch, or enter the exact branch name to target one branch.')}</p>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.webhookSecret', 'Webhook Secret (Optional)')}</label>
                          <input
                            type="password"
                            value={deployConfig.secret}
                            onChange={(e) => setDeployConfig(p => ({ ...p, secret: e.target.value }))}
                            placeholder="••••••••••••••"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 transition-all"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('deploy.webhookUrl', 'Webhook URL')}</label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              readOnly
                              value={typeof window !== 'undefined' ? (deployConfig.webhookToken ? `${window.location.origin}/api/deploy/webhook?token=${deployConfig.webhookToken}` : `${window.location.origin}/api/deploy/webhook?project=${selectedProjectId}`) : ''}
                              className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-muted)] select-all focus:outline-none"
                            />
                            <button
                              onClick={handleCopyWebhookUrl}
                              className="px-3 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-primary)] transition-all flex items-center justify-center"
                            >
                              {copySuccess ? <CheckCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                            <button
                              onClick={handleTestWebhook}
                              disabled={webhookTesting}
                              className="px-3 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 disabled:opacity-50 border border-indigo-500/30 rounded-xl text-xs text-indigo-400 font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              {webhookTesting ? <Loader size={14} className="animate-spin" /> : <Wifi size={14} />}
                              {webhookTesting ? t('deploy.testWebhookRunning', 'Testing...') : t('deploy.testWebhook', 'Test Webhook')}
                            </button>
                          </div>
                          <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('deploy.webhookUrlHint', 'Use this Webhook URL in your repository\'s webhook settings (GitHub or Bitbucket). Make sure Payload format is application/json.', { project: selectedProjectId })}</span>
                          {webhookTestResult && (
                            <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-3 space-y-2">
                              {webhookTestResult.checks.map((check, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  {check.status === 'pass' && <CheckCircle size={14} className="text-emerald-400 shrink-0" />}
                                  {check.status === 'fail' && <AlertCircle size={14} className="text-red-400 shrink-0" />}
                                  {check.status === 'skip' && <Info size={14} className="text-[var(--text-muted)] shrink-0" />}
                                  <span className="font-bold text-[var(--text-secondary)] capitalize">{check.name.replace(/_/g, ' ')}:</span>
                                  <span className={check.status === 'fail' ? 'text-red-300' : check.status === 'pass' ? 'text-emerald-300' : 'text-[var(--text-muted)]'}>{check.message}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="space-y-1 pt-2">
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('deploy.directTriggerUrl', 'Direct Trigger URL')}</label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              readOnly
                              value={typeof window !== 'undefined' ? (deployConfig.webhookToken ? `${window.location.origin}/api/deploy/trigger?webhook_token=${deployConfig.webhookToken}${deployConfig.secret ? `&token=${deployConfig.secret}` : ''}` : `${window.location.origin}/api/deploy/trigger?project=${selectedProjectId}${deployConfig.secret ? `&token=${deployConfig.secret}` : ''}`) : ''}
                              className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-muted)] select-all focus:outline-none"
                            />
                            <button
                              onClick={handleCopyDirectTriggerUrl}
                              className="px-3 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-primary)] transition-all flex items-center justify-center"
                            >
                              {directCopySuccess ? <CheckCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                          <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('deploy.directTriggerUrlHint', 'Use this URL to trigger deployment directly via HTTP (e.g. from curl or custom scripts) without a browser. The secret token is automatically appended if configured.')}</span>
                        </div>
                      </div>
                      {triggerChanged && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                          <span className="text-xs">⚠</span>
                          <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                        </div>
                      )}
                    </div>

                    {/* Script editor */}
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
                        <Code size={16} className="text-indigo-400" />
                        {t('deploy.deploymentCommand', 'Deployment Command')}
                      </h3>
                      <div className="space-y-2">
                        <textarea
                          rows={6}
                          value={deployConfig.deployCommand}
                          onChange={(e) => setDeployConfig(p => ({ ...p, deployCommand: e.target.value }))}
                          placeholder={t('deploy.deployCommandPlaceholder', '# Enter shell script to run on deploy event')}
                          className="w-full bg-slate-950 border border-[var(--border-color)] rounded-xl p-4 text-xs font-mono text-emerald-400 focus:outline-none focus:border-indigo-500/50 shadow-inner"
                        />
                      </div>
                      {commandChanged && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                          <span className="text-xs">⚠</span>
                          <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right block - targets */}
                  <div className="space-y-6">
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
                        <Network size={16} className="text-indigo-400" />
                        {t('deploy.deploymentTarget', 'Deployment Target')}
                      </h3>

                      <div className="space-y-3">
                        <div>
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.targetType', 'Target Type')}</label>
                          <select
                            value={deployConfig.targetType}
                            onChange={(e) => setDeployConfig(p => ({ ...p, targetType: e.target.value }))}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                          >
                            <option value="local">{t('deploy.targetLocal', 'Local Host')}</option>
                            <option value="ssh">{t('deploy.targetSsh', 'Remote SSH Server')}</option>
                          </select>
                        </div>

                        {deployConfig.targetType === 'ssh' && (
                          <div className="animate-in fade-in duration-200">
                            <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.sshConnection', 'SSH Connection')}</label>
                            {selectedConnectionMissing && (
                              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-100 mb-3">
                                {t('deploy.sshConnectionMissing', 'The selected SSH connection ID is not available. Auto-deployments require a database-backed connection.')} <span className="font-mono">{deployConfig.connectionId}</span>
                              </div>
                            )}
                            {vaultStatus === 'locked' ? (
                              <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl text-center space-y-2">
                                <span className="block text-[11px] text-amber-500 font-medium">{t('vault.lockedHint', 'Your database vault is locked.')}</span>
                                <button
                                  type="button"
                                  onClick={showVault}
                                  className="w-full px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-bold transition-colors"
                                >
                                  {t('settings_ui.db.unlockNow', 'Unlock Now')}
                                </button>
                              </div>
                            ) : vaultStatus === 'setup' ? (
                              <div className="p-4 bg-indigo-500/5 border border-indigo-500/15 rounded-xl text-center space-y-2">
                                <span className="block text-[11px] text-indigo-500 font-medium">{t('vault.setupHint', 'Database vault is not configured.')}</span>
                                <button
                                  type="button"
                                  onClick={showVault}
                                  className="w-full px-3 py-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 rounded-lg text-white font-bold transition-colors"
                                >
                                  {t('settings_ui.db.setupNow', 'Set Up Now')}
                                </button>
                              </div>
                            ) : connections.length === 0 ? (
                              <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl text-center">
                                <span className="block text-[10px] text-amber-500">{t('deploy.sshNoConnections', 'No SSH connections found.')}</span>
                                <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('deploy.sshNoConnectionsHint', 'Please create an SSH connection in the main panel first.')}</span>
                              </div>
                            ) : (
                              <select
                                value={deployConfig.connectionId}
                                onChange={(e) => setDeployConfig(p => ({ ...p, connectionId: e.target.value }))}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                              >
                                <option value="">{t('deploy.sshSelectPlaceholder', '-- Select SSH Connection --')}</option>
                                {connections.map(c => (
                                  <option key={c._id} value={c._id}>{c.name} ({c.host})</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.projectRootPath', 'Project Root Path')}</label>
                          <input
                            type="text"
                            value={deployConfig.projectPath}
                            onChange={(e) => setDeployConfig(p => ({ ...p, projectPath: e.target.value }))}
                            placeholder="/var/www/my-app"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 transition-all"
                          />
                          <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('deploy.projectRootPathHint', 'Relative or absolute path containing deployment files.')}</span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.timeout', 'Timeout (seconds)')}</label>
                          <input
                            type="number"
                            min="30"
                            max="3600"
                            value={deployConfig.timeoutSeconds || 600}
                            onChange={(e) => setDeployConfig(p => ({ ...p, timeoutSeconds: parseInt(e.target.value, 10) || 600 }))}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 transition-all"
                          />
                          <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('deploy.timeoutHint', 'Maximum time in seconds a deployment can run before being terminated (30-3600).')}</span>
                        </div>
                      </div>
                      {targetChanged && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                          <span className="text-xs">⚠</span>
                          <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                        </div>
                      )}
                    </div>

                    {/* Telegram Notifications */}
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
                        <Send size={16} className="text-sky-400" />
                        {t('deploy.telegramTitle', 'Telegram Notification')}
                      </h3>

                      <div className="flex items-center justify-between py-1">
                        <div>
                          <span className="block text-xs font-semibold text-[var(--text-primary)]">{t('deploy.telegramEnable', 'Enable Telegram Alerts')}</span>
                          <span className="text-[9px] text-[var(--text-muted)]">{t('deploy.telegramEnableDesc', 'Send start, success, and fail alerts to a Telegram chat')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDeployConfig(p => ({ ...p, telegramNotification: !p.telegramNotification }));
                          }}
                          className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${deployConfig.telegramNotification ? 'bg-[var(--accent-indigo)]' : 'bg-[var(--bg-tertiary)]'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${deployConfig.telegramNotification ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {deployConfig.telegramNotification && (
                        <div className="space-y-4 pt-3 border-t border-[var(--border-color)]/60 animate-in fade-in duration-200">
                          {/* Bot Token field + Fetch button */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                {t('deploy.telegramBotToken', 'Telegram Bot Token')}
                              </label>
                              {telegramBotInfo && (
                                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                                  <CheckCircle size={11} />
                                  🤖 {telegramBotInfo.first_name} (@{telegramBotInfo.username})
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={deployConfig.telegramBotToken || ''}
                                onChange={(e) => setDeployConfig(p => ({ ...p, telegramBotToken: e.target.value }))}
                                placeholder="e.g. 123456789:ABCdefGhI..."
                                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={handleFetchTelegramChats}
                                disabled={telegramLoadingChats || (!deployConfig.telegramBotToken && !telegramBotInfo)}
                                className="px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 hover:text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                              >
                                {telegramLoadingChats ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                Fetch Chats
                              </button>
                            </div>
                          </div>

                          {/* Error message or info hint */}
                          {telegramFetchError && (
                            <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] flex items-start gap-2">
                              <AlertCircle size={14} className="shrink-0 mt-0.5" />
                              <div>
                                <span>{telegramFetchError}</span>
                                <p className="text-[10px] text-rose-400/80 mt-0.5">
                                  💡 <strong>Tip:</strong> Open Telegram, search for your bot, send a message (like <code>/start</code>), then click <strong>Fetch Chats</strong> again.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Dropdown selector if chats were fetched */}
                          {telegramChats.length > 0 && (
                            <div>
                              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Add Chat / Group to Recipients
                              </label>
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) {
                                    const selectedId = e.target.value;
                                    const currentIds = String(deployConfig.telegramChatId || '')
                                      .split(/[\s,]+/)
                                      .map(id => id.trim())
                                      .filter(Boolean);
                                    if (!currentIds.includes(selectedId)) {
                                      const updated = [...currentIds, selectedId].join(', ');
                                      setDeployConfig(p => ({ ...p, telegramChatId: updated }));
                                    }
                                  }
                                }}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                              >
                                <option value="">+ Select a chat to add to notification list...</option>
                                {telegramChats.map(c => {
                                  const currentIds = String(deployConfig.telegramChatId || '')
                                    .split(/[\s,]+/)
                                    .map(id => id.trim())
                                    .filter(Boolean);
                                  const isSelected = currentIds.includes(c.id);
                                  return (
                                    <option key={c.id} value={c.id} disabled={isSelected}>
                                      {isSelected ? '✓ ' : ''}{c.title} ({c.type}) — ID: {c.id}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}

                          {/* Selected Chat Badges / Chips */}
                          {(() => {
                            const chatIds = String(deployConfig.telegramChatId || '')
                              .split(/[\s,]+/)
                              .map(id => id.trim())
                              .filter(Boolean);
                            if (chatIds.length === 0) return null;
                            return (
                              <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                  Selected Recipients ({chatIds.length})
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {chatIds.map(id => {
                                    const match = telegramChats.find(c => c.id === id);
                                    const label = match ? `${match.title}` : `ID: ${id}`;
                                    return (
                                      <span
                                        key={id}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs font-medium"
                                      >
                                        <span>{label}</span>
                                        <span className="text-[10px] text-sky-400/60 font-mono">({id})</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const updated = chatIds.filter(c => c !== id).join(', ');
                                            setDeployConfig(p => ({ ...p, telegramChatId: updated }));
                                          }}
                                          className="hover:text-rose-400 transition-colors p-0.5 rounded"
                                          title="Remove recipient"
                                        >
                                          <X size={12} />
                                        </button>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Chat ID Input field */}
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                              {t('deploy.telegramChatId', 'Telegram Chat IDs (comma-separated)')}
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={deployConfig.telegramChatId || ''}
                                onChange={(e) => setDeployConfig(p => ({ ...p, telegramChatId: e.target.value }))}
                                placeholder="e.g. 123456789, -100123456789"
                                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={handleTestTelegramNotification}
                                disabled={telegramTesting || !deployConfig.telegramChatId}
                                className="px-3 py-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                              >
                                {telegramTesting ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
                                Test Alert
                              </button>
                            </div>
                          </div>

                          {/* Test status alert */}
                          {telegramTestStatus && (
                            <div className={`px-3 py-2 rounded-xl border text-[11px] flex items-center gap-2 ${
                              telegramTestStatus.success 
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            }`}>
                              {telegramTestStatus.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                              <span>{telegramTestStatus.message}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {telegramChanged && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                          <span className="text-xs">⚠</span>
                          <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                        </div>
                      )}
                    </div>

                    {/* AI Configuration Assistant */}
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
                        <Sparkles size={16} className="text-indigo-400 animate-pulse" />
                        {t('deploy.aiAssistantTitle', 'AI Deploy Assistant')}
                      </h3>

                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        {t('deploy.aiAssistantDesc', 'Let AI scan the target project directory, auto-detect language/framework types (Docker, pure Node, Python, etc.), and generate a tailored production script.')}
                      </p>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.aiModel', 'AI Model')}</label>
                          <select
                            value={deployConfig.aiModel}
                            onChange={(e) => setDeployConfig(p => ({ ...p, aiModel: e.target.value }))}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                          >
                            <option value="auto">{t('deploy.aiModelAuto', 'Auto')}</option>
                            <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                            <option value="gpt-4">gpt-4</option>
                            <option value="manual">{t('deploy.aiModelCustom', 'Custom Endpoint')}</option>
                          </select>
                          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{t('deploy.aiModelDesc', 'Choose a model or use a custom endpoint for your deployment analysis.')}</p>
                        </div>

                        {deployConfig.aiModel === 'manual' && (
                          <div className="space-y-4 rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] p-4">
                            <div>
                              <div className="flex flex-wrap gap-2 mb-3">
                                <button
                                  type="button"
                                  onClick={() => setDeployConfig(p => ({ ...p, aiEndpoint: 'https://gen.ai.kku.ac.th/okmd/api/v1', aiCustomModel: 'gpt-5.4' }))}
                                  className="text-[9px] px-2 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  🎓 KKU AI (gpt-5.4)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeployConfig(p => ({ ...p, aiEndpoint: 'https://openrouter.ai/api/v1', aiCustomModel: 'anthropic/claude-3.5-sonnet' }))}
                                  className="text-[9px] px-2 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30 transition-all cursor-pointer"
                                >
                                  🌐 OpenRouter
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeployConfig(p => ({ ...p, aiEndpoint: 'https://api.openai.com/v1', aiCustomModel: 'gpt-4o' }))}
                                  className="text-[9px] px-2 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-all cursor-pointer"
                                >
                                  🟢 OpenAI
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeployConfig(p => ({ ...p, aiEndpoint: 'http://localhost:11434/v1', aiCustomModel: 'llama3.2' }))}
                                  className="text-[9px] px-2 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 transition-all cursor-pointer"
                                >
                                  🦙 Ollama
                                </button>
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.aiCustomEndpointUrl', 'Custom Endpoint URL')}</label>
                                <input
                                  type="text"
                                  value={deployConfig.aiEndpoint}
                                  onChange={(e) => setDeployConfig(p => ({ ...p, aiEndpoint: e.target.value }))}
                                  placeholder="https://gen.ai.kku.ac.th/okmd/api/v1"
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                                />
                                <p className="mt-1 text-[10px] text-slate-500">Enter the base URL — <span className="text-indigo-400">/chat/completions</span> is appended automatically if missing.</p>
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.aiApiKey', 'API Key')}</label>
                                <input
                                  type="password"
                                  value={deployConfig.aiApiKey}
                                  onChange={(e) => setDeployConfig(p => ({ ...p, aiApiKey: e.target.value }))}
                                  placeholder={t('deploy.aiApiKeyPlaceholder', 'Enter API Key')}
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('deploy.aiCustomModelName', 'Custom Model Name')}</label>
                                <input
                                  type="text"
                                  value={deployConfig.aiCustomModel}
                                  onChange={(e) => setDeployConfig(p => ({ ...p, aiCustomModel: e.target.value }))}
                                  placeholder="e.g. gpt-4o-mini"
                                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {(() => {
                        const isMissingKey = deployConfig.aiModel === 'manual' && !deployConfig.aiApiKey?.trim();
                        const isBtnDisabled = isMissingKey || aiAnalyzing || deployLoading;

                        return (
                          <>
                            <button
                              type="button"
                              onClick={handleAiAnalyze}
                              disabled={isBtnDisabled}
                              title={isMissingKey ? 'AI API Key is required for manual model mode' : ''}
                              className={`w-full py-2.5 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 ${
                                isBtnDisabled 
                                  ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed opacity-60' 
                                  : 'bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 cursor-pointer'
                              }`}
                            >
                              {aiAnalyzing ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                              {aiAnalyzing ? t('deploy.aiAnalyzing', 'Scanning & Analyzing...') : isMissingKey ? 'AI API Key Required' : t('deploy.aiAnalyzeBtn', 'Analyze with AI')}
                            </button>

                            {deployConfig.aiProfile && (
                              <div className="p-4 rounded-xl bg-slate-900/60 border border-[var(--border-color)] space-y-3 animate-in fade-in duration-200">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-indigo-400">{t('deploy.aiRecommendation', 'AI Recommendation')}</span>
                                  <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 text-[9px] font-bold">
                                    {deployConfig.aiProfile.projectType}
                                  </span>
                                </div>

                                {deployConfig.aiProfile.technologies && deployConfig.aiProfile.technologies.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {deployConfig.aiProfile.technologies.map(t => (
                                      <span key={t} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[9px] text-slate-300 font-medium">
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                <p className="text-[10px] text-slate-400 leading-normal italic">
                                  &quot;{deployConfig.aiProfile.summary}&quot;
                                </p>

                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeployConfig(p => ({ ...p, deployCommand: p.aiProfile.deployCommand }));
                                      addNotification({ title: t('deploy.aiRecommendedApplied', 'Recommended Applied'), message: t('deploy.aiRecommendedAppliedMsg', 'Deployment command set to AI suggestion.'), type: 'info' });
                                    }}
                                    className="py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                  >
                                    <Code size={11} />
                                    Standard AI Script
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Use AI-generated deployCommand directly — server already injected the Swarm section
                                      setDeployConfig(p => ({ ...p, deployCommand: p.aiProfile.deployCommand }));
                                      addNotification({ title: '🐝 Swarm AI Command Applied', message: 'Swarm zero-downtime deployment script applied.', type: 'success' });
                                    }}
                                    className="py-1.5 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                  >
                                    <Zap size={11} />
                                    Apply Swarm AI
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* AI History Logs */}
                      {deployConfig.aiLogs && deployConfig.aiLogs.length > 0 && (
                        <div className="border-t border-[var(--border-color)] pt-3 space-y-2">
                          <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('deploy.aiHistoryLogs', 'AI History Logs')}</label>
                          <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                            {deployConfig.aiLogs.map((log, idx) => (
                              <div key={idx} className="p-2 rounded bg-slate-900/30 border border-slate-900/50 hover:border-slate-800 flex flex-col gap-1 transition-all">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-slate-300">{log.projectType}</span>
                                  <span className="text-[8px] text-[var(--text-muted)]">
                                    {log.analyzedAt ? new Date(log.analyzedAt).toLocaleDateString() : 'Unknown date'}
                                  </span>
                                </div>
                                <p className="text-[9px] text-[var(--text-muted)] line-clamp-1 italic">&quot;{log.summary}&quot;</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiChanged && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                          <span className="text-xs">⚠</span>
                          <span className="text-[11px] text-amber-400 font-bold">You have unsaved changes</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {deploymentTab === 'logs' ? (
              <div className="space-y-4">
                <div className={`p-4 rounded-2xl border flex items-center justify-between ${isDeployFailed ? 'bg-red-500/5 border-red-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isDeployFailed ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <div>
                      <p className={`text-sm font-bold ${isDeployFailed ? 'text-red-300' : 'text-emerald-300'}`}>
                        {isDeployFailed ? t('deploy.logsLastFailed', 'Last Deployment Failed') : t('deploy.logsLastSucceeded', 'Last Deployment Succeeded')}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {deployConfig.lastDeployAt ? new Date(deployConfig.lastDeployAt).toLocaleString() : t('deploy.logsNoRecentRun', 'No recent deployment run yet')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDeployFailed && (
                      <button
                        onClick={handleTriggerDeploy}
                        disabled={deployTriggering || deployLoading}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        {deployTriggering ? <Loader size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                        {t('deploy.retry', 'Retry')}
                      </button>
                    )}
                    {deployConfig.status === 'running' && (
                      <button
                        onClick={handleForceResetDeploy}
                        disabled={deployLoading}
                        className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        title="Force-reset stuck deployment"
                      >
                        {t('deploy.forceReset', 'Force Reset')}
                      </button>
                    )}
                    <button
                      onClick={handleFetchCommits}
                      disabled={loadingCommits || deployConfig.status === 'running'}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      {loadingCommits ? <Loader size={10} className="animate-spin" /> : <GitCommit size={10} />}
                      {t('deploy.selectCommit', 'Select Commit')}
                    </button>
                    <span className={`text-xs font-bold px-3 py-1 rounded-lg ${isDeployFailed ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {deployConfig.status === 'running' ? t('deploy.logsStatusRunning', 'Running...') : isDeployFailed ? t('deploy.logsStatusFailed', 'Failed') : t('deploy.logsStatusComplete', 'Complete')}
                    </span>
                  </div>
                </div>

                {/* Commit Selector Panel */}
                {showCommitSelector && (
                  <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitCommit size={16} className="text-indigo-400" />
                        <h4 className="text-sm font-bold text-[var(--text-primary)]">{t('deploy.commitSelectorTitle', 'Select Commit to Deploy')}</h4>
                      </div>
                      <button
                        onClick={() => setShowCommitSelector(false)}
                        className="text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {t('deploy.commitSelectorDesc', 'Choose a specific commit to deploy. This will checkout the commit before running the deploy command.')}
                    </p>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5">
                      {commits.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)] text-center py-4">{t('deploy.noCommits', 'No commits found')}</p>
                      ) : (
                        commits.map((commit, idx) => {
                          const isDeployed = deployConfig.lastDeployedCommitSha && commit.fullSha === deployConfig.lastDeployedCommitSha;
                          return (
                          <button
                            key={commit.fullSha}
                            onClick={() => {
                              handleTriggerDeploy(commit.fullSha);
                              setShowCommitSelector(false);
                            }}
                            disabled={deployTriggering || deployConfig.status === 'running'}
                            className={`w-full text-left p-3 rounded-xl border transition-all disabled:opacity-50 cursor-pointer group ${
                              isDeployed
                                ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/50'
                                : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border-transparent hover:border-indigo-500/30'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {isDeployed && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-bold uppercase tracking-wider">Live</span>
                                )}
                                {commit.avatar ? (
                                  <img src={commit.avatar} alt="" className="w-5 h-5 rounded-full" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center text-[8px] text-white font-bold">
                                    {commit.author?.charAt(0)?.toUpperCase() || '?'}
                                  </div>
                                )}
                                <span className="font-mono text-[10px] text-indigo-400 font-bold">{commit.sha}</span>
                                <span className="text-xs text-[var(--text-primary)] truncate">{commit.message}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] text-[var(--text-muted)]">{commit.author}</span>
                                <span className="text-[9px] text-[var(--text-muted)]">
                                  {commit.date ? new Date(commit.date).toLocaleString([], { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                                <span className="text-[9px] text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                                  {t('deploy.deployThisCommit', 'DEPLOY')}
                                </span>
                              </div>
                            </div>
                          </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {deployConfig.lastDeployLog ? (() => {
                  const logLines = deployConfig.lastDeployLog.split('\n');
                  const errorLineIndices = [];
                  const errorPattern = /\b(error|fail|fatal|exception|crash|abort|panic|segfault|killed|denied|not found|cannot|unable to|refused|timed? ?out|broken|ENOENT|EACCES|EPERM|exit code [^0]|status:?\s*[1-9])\b/i;
                  logLines.forEach((line, idx) => {
                    if (errorPattern.test(line)) errorLineIndices.push(idx);
                  });
                  const logQ = logSearch.toLowerCase().trim();
                  const matchingLineIndices = [];
                  if (logQ) {
                    logLines.forEach((line, idx) => {
                      if (line.toLowerCase().includes(logQ)) matchingLineIndices.push(idx);
                    });
                  }
                  const jumpToError = (direction) => {
                    if (errorLineIndices.length === 0) return;
                    const el = logContainerRef.current;
                    const currentScroll = el ? el.scrollTop : 0;
                    const lineHeight = 18;
                    const currentTopLine = Math.floor(currentScroll / lineHeight);
                    let targetIdx;
                    if (direction === 'next') {
                      targetIdx = errorLineIndices.find(i => i > currentTopLine + 2) ?? errorLineIndices[0];
                    } else {
                      const reversed = [...errorLineIndices].reverse();
                      targetIdx = reversed.find(i => i < currentTopLine - 2) ?? errorLineIndices[errorLineIndices.length - 1];
                    }
                    if (el) el.scrollTop = targetIdx * lineHeight;
                  };
                  const jumpToMatch = (idx) => {
                    if (matchingLineIndices.length === 0) return;
                    const el = logContainerRef.current;
                    const targetLine = matchingLineIndices[idx];
                    if (el) el.scrollTop = targetLine * 18;
                    setLogSearchIndex(idx);
                  };
                  return (
                    <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                          <Terminal size={16} className="text-emerald-400 animate-pulse" />
                          <span>{t('deploy.logsConsoleTitle', 'Deployment Console Output')}</span>
                          {errorLineIndices.length > 0 && (
                            <span className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full font-bold">
                              {errorLineIndices.length} error{errorLineIndices.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { const el = logContainerRef.current; if (el) el.scrollTop = el.scrollHeight; }}
                            className="text-[10px] text-[var(--text-muted)] hover:text-emerald-400 transition-colors cursor-pointer"
                            title="Scroll to bottom"
                          >
                            ↓ Bottom
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(deployConfig.lastDeployLog).catch(() => {});
                            }}
                            className="text-[10px] text-[var(--text-muted)] hover:text-indigo-400 transition-colors cursor-pointer"
                            title="Copy full log"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            onClick={() => setDeployConfig(p => ({ ...p, lastDeployLog: '' }))}
                            className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer"
                          >
                            {t('deploy.logsClearConsole', 'Clear Console')}
                          </button>
                        </div>
                      </div>

                      {/* Search & Error Jump Bar */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/50 rounded-lg px-2 py-1 flex-1 min-w-[180px] max-w-[300px]">
                          <Search size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                          <input
                            type="text"
                            value={logSearch}
                            onChange={(e) => { setLogSearch(e.target.value); setLogSearchIndex(0); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && matchingLineIndices.length > 0) {
                                const next = (e.shiftKey)
                                  ? (logSearchIndex - 1 + matchingLineIndices.length) % matchingLineIndices.length
                                  : (logSearchIndex + 1) % matchingLineIndices.length;
                                jumpToMatch(next);
                              }
                              if (e.key === 'Escape') { setLogSearch(''); }
                            }}
                            placeholder="Search in logs..."
                            className="bg-transparent text-[11px] text-[var(--text-primary)] outline-none w-full placeholder:text-[var(--text-muted)]"
                          />
                          {logSearch && (
                            <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">
                              {matchingLineIndices.length > 0 ? `${logSearchIndex + 1}/${matchingLineIndices.length}` : '0'}
                            </span>
                          )}
                          {logSearch && (
                            <button onClick={() => { setLogSearch(''); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                              <X size={10} />
                            </button>
                          )}
                        </div>
                        {errorLineIndices.length > 0 && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => jumpToError('prev')}
                              className="px-2 py-1 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors cursor-pointer"
                              title="Previous error"
                            >
                              ↑ Prev Error
                            </button>
                            <button
                              onClick={() => jumpToError('next')}
                              className="px-2 py-1 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors cursor-pointer"
                              title="Next error"
                            >
                              ↓ Next Error
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Log Content */}
                      <div ref={logContainerRef} className="bg-slate-950 border border-slate-900 rounded-xl shadow-inner max-h-[420px] overflow-y-auto custom-scrollbar font-mono text-[11px] leading-[18px] select-text">
                        {logLines.map((line, idx) => {
                          const isError = errorPattern.test(line);
                          const isSearchMatch = logQ && line.toLowerCase().includes(logQ);
                          const isCurrentMatch = isSearchMatch && matchingLineIndices[logSearchIndex] === idx;
                          const shouldHighlight = logQ ? isSearchMatch : isError;
                          return (
                            <div
                              key={idx}
                              className={`flex px-4 ${isError ? 'bg-red-500/10 border-l-2 border-red-500' : isSearchMatch ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : 'border-l-2 border-transparent'} ${isCurrentMatch ? 'ring-1 ring-inset ring-indigo-400' : ''}`}
                            >
                              <span className="text-slate-600 w-10 text-right pr-3 flex-shrink-0 select-none">{idx + 1}</span>
                              <span className={`whitespace-pre-wrap break-all ${isError ? 'text-red-300' : isSearchMatch ? 'text-indigo-200' : 'text-slate-300'}`}>
                                {logQ && isSearchMatch ? (() => {
                                  const lower = line.toLowerCase();
                                  const parts = [];
                                  let last = 0;
                                  let searchIdx = lower.indexOf(logQ);
                                  while (searchIdx !== -1) {
                                    if (searchIdx > last) parts.push(<span key={`t${last}`}>{line.slice(last, searchIdx)}</span>);
                                    parts.push(<mark key={`m${searchIdx}`} className="bg-indigo-500/40 text-white rounded-sm px-0.5">{line.slice(searchIdx, searchIdx + logQ.length)}</mark>);
                                    last = searchIdx + logQ.length;
                                    searchIdx = lower.indexOf(logQ, last);
                                  }
                                  if (last < line.length) parts.push(<span key={`e${last}`}>{line.slice(last)}</span>);
                                  return parts;
                                })() : line}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                    {t('deploy.logsEmpty', 'No deployment console output is available yet. Run a deployment to see logs here.')}
                  </div>
                )}

                {deployConfig.aiLogs && deployConfig.aiLogs.length > 0 && (
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                      <Sparkles size={16} className="text-indigo-400" />
                      <span>{t('deploy.aiHistoryLogs', 'AI History Logs')}</span>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                      {deployConfig.aiLogs.map((log, idx) => (
                        <div key={idx} className="p-3 rounded-2xl bg-slate-950/70 border border-slate-900 hover:border-slate-700 transition-all">
                          <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                            <span>{log.projectType || 'AI Analysis'}</span>
                            <span>{log.analyzedAt ? new Date(log.analyzedAt).toLocaleString() : 'Unknown'}</span>
                          </div>
                          <p className="mt-2 text-[11px] text-[var(--text-muted)] italic">&quot;{log.summary || 'No summary available.'}&quot;</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
              </div>
            )}
          </div>
        )}
        {activeTab === 'terminal' && (
          <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SettingsSectionTitle icon={Terminal} iconColor="text-emerald-400" title={t('settings_ui.terminal.title') || 'Terminal Customization'} description="Personalize your command-line interface with presets and custom styling." />

            <section className="space-y-6">
              {/* Presets */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Monitor size={15} className="text-emerald-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.terminal.presets') || 'Interface Presets'}</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'modern', name: 'Standard Modern', desc: 'Clean font, smooth colors' },
                    { id: 'retro', name: 'Pip-Boy 3000', desc: 'Monochrome, phosphor glow' },
                    { id: 'matrix', name: 'Digital Rain', desc: 'High contrast green-on-black' },
                  ].map(p => {
                    const isActive = osState.terminalSettings?.activePreset === p.id;
                    return (
                      <button key={p.id} onClick={() => setTerminalSettings({ activePreset: p.id })}
                        className={`p-4 rounded-xl border text-left transition-all ${isActive ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'}`}>
                        <div className={`w-8 h-8 rounded-lg mb-2.5 flex items-center justify-center ${isActive ? 'bg-emerald-500/20' : 'bg-[var(--bg-card)]'}`}>
                          <Terminal size={14} className={isActive ? 'text-emerald-400' : 'text-[var(--text-muted)]'} />
                        </div>
                        <span className="block text-xs font-semibold text-[var(--text-primary)]">{p.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </SettingsCard>

              {/* Typography */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Code size={15} className="text-indigo-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Typography & Sizing</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t('settings_ui.terminal.fontSize') || 'Font Size'}</label>
                    <div className="flex items-center gap-3 mt-2">
                      <input type="range" min="10" max="32" value={osState.terminalSettings?.fontSize || 14}
                        onChange={(e) => setTerminalSettings({ fontSize: parseInt(e.target.value) })}
                        className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-emerald-500" />
                      <span className="text-xs font-mono text-emerald-400 w-8">{osState.terminalSettings?.fontSize || 14}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Cursor Style</label>
                    <div className="flex gap-1.5 mt-2">
                      {['bar', 'block', 'underline'].map(style => (
                        <button key={style} onClick={() => setTerminalSettings({ cursorStyle: style })}
                          className={`flex-1 py-2 rounded-lg border text-[10px] font-semibold transition-all capitalize ${(osState.terminalSettings?.cursorStyle || 'bar') === style ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SettingsCard>

              {/* Terminal Colors */}
              <SettingsCard>
                <div className="flex items-center gap-2 mb-4">
                  <Palette size={15} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings_ui.terminal.colors') || 'Terminal Colors'}</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'background', label: t('settings_ui.terminal.background'), default: '#0c0c0c' },
                    { key: 'foreground', label: t('settings_ui.terminal.foreground'), default: '#e4e4e7' },
                    { key: 'cursor', label: t('settings_ui.terminal.cursor'), default: '#6366f1' }
                  ].map(c => (
                    <div key={c.key} className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
                      <div>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{c.label}</span>
                        <span className="text-[10px] text-[var(--text-muted)] font-mono ml-2">{c.key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative w-8 h-8 rounded-lg border border-[var(--border-color)] overflow-hidden shrink-0">
                          <div className="absolute inset-0" style={{ backgroundColor: osState.terminalSettings?.theme?.[c.key] || c.default }} />
                          <input type="color" value={osState.terminalSettings?.theme?.[c.key] || c.default}
                            onChange={(e) => updateTerminalTheme(c.key, e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -left-1/2 -top-1/2" />
                        </div>
                        <input type="text" value={osState.terminalSettings?.theme?.[c.key] || c.default}
                          onChange={(e) => updateTerminalTheme(c.key, e.target.value)}
                          className="w-24 h-8 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-indigo-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </SettingsCard>

              {/* Opacity */}
              <SettingsCard>
                <SettingRow label={t('settings_ui.terminal.opacity') || 'Background Opacity'} description="Lower opacity allows the desktop wallpaper to shine through.">
                  <span className="text-xs font-mono text-blue-400">{Math.round((osState.terminalSettings?.backgroundOpacity ?? 1) * 100)}%</span>
                </SettingRow>
                <input type="range" min="30" max="100" value={(osState.terminalSettings?.backgroundOpacity ?? 1) * 100}
                  onChange={(e) => setTerminalSettings({ backgroundOpacity: parseInt(e.target.value) / 100 })}
                  className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-blue-500 mt-2" />
              </SettingsCard>

              {/* Behavior */}
              <SettingsCard>
                <SettingRow label="Cursor Blinking" description="Enable or disable smooth cursor animation">
                  <Toggle value={osState.terminalSettings?.cursorBlink !== false} onChange={() => setTerminalSettings({ cursorBlink: !osState.terminalSettings?.cursorBlink })} accent="emerald" />
                </SettingRow>
                <SettingRow label="Tmux Mouse Scroll" description="Allow mouse wheel to scroll history within Tmux">
                  <Toggle value={osState.terminalSettings?.tmuxMouseScrolling || false} onChange={() => setTerminalSettings({ tmuxMouseScrolling: !osState.terminalSettings?.tmuxMouseScrolling })} />
                </SettingRow>
                <SettingRow label="Auto-Attach Tmux" description="Automatically open Tmux on every terminal start" noBorder>
                  <Toggle value={osState.terminalSettings?.autoTmuxAttach || false} onChange={() => setTerminalSettings({ autoTmuxAttach: !osState.terminalSettings?.autoTmuxAttach })} accent="emerald" />
                </SettingRow>
              </SettingsCard>
            </section>
          </div>
        )}
      </div>

      {/* ── One-Click Relay Installer Modal ─────────────────────────── */}
      <AnimatePresence>
        {relayModalOpen && (
          <motion.div
            key="relay-wizard-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setRelayModalOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              className="w-full max-w-lg max-h-[85%] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center gap-3 bg-gradient-to-r from-amber-500/5 to-transparent shrink-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <Network size={16} className="text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Local Relay Agent</h3>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Connect to databases & SSH on <code className="text-amber-300">localhost</code></p>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${osMeta[detectedOS].badge}`}>
                  {osMeta[detectedOS].label}
                </span>
                <button onClick={() => setRelayModalOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors ml-1">
                  <X size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-5">

                {/* SUCCESS state */}
                {relayInstallSuccess ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-5">
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', damping: 14, stiffness: 200 }}
                      className="relative"
                    >
                      <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                      <div className="relative w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
                        <CheckCircle size={38} className="text-emerald-400" />
                      </div>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="space-y-2"
                    >
                      <p className="text-lg font-bold text-[var(--text-primary)]">Relay Connected! 🎉</p>
                      <p className="text-sm text-emerald-400">Your machine is now reachable from the dashboard</p>
                      <p className="text-xs text-[var(--text-muted)]">You can now connect to <code className="text-amber-300">localhost</code> databases and SSH hosts</p>
                    </motion.div>
                    <button
                      onClick={() => setRelayModalOpen(false)}
                      className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] rounded-xl text-white text-sm font-bold transition-all shadow-lg shadow-emerald-500/20"
                    >
                      Done ✓
                    </button>
                  </div>

                ) : (
                  <>
                    {/* What is it? — concise explanation */}
                    <div className="flex gap-3 p-3.5 rounded-xl bg-blue-500/[0.06] border border-blue-500/15">
                      <Info size={14} className="shrink-0 text-blue-400 mt-0.5" />
                      <div className="text-[11px] text-[var(--text-muted)] leading-relaxed space-y-1.5">
                        <p className="font-semibold text-[var(--text-secondary)]">What is the Relay Agent?</p>
                        <p>A small background service you run on <strong className="text-[var(--text-primary)]">your own computer</strong>. It creates a secure tunnel so this dashboard can reach services on <code className="text-amber-300">localhost</code>.</p>
                        <div className="flex flex-col gap-1 pt-1">
                          <span className="text-emerald-400/90">✓ Only needed for localhost/127.0.0.1 — remote servers don't need it</span>
                          <span className="text-emerald-400/90">✓ Nothing stored on our servers — fully end-to-end encrypted</span>
                          <span className="text-blue-400/80">✓ Install on your desktop machine, not the server</span>
                        </div>
                      </div>
                    </div>

                    {/* Install command */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-white">1</span>
                        </div>
                        <p className="text-xs font-bold text-[var(--text-secondary)]">
                          {detectedOS === 'windows' ? 'Download & run the installer' : 'Copy & paste into your Terminal'}
                        </p>
                      </div>

                      {/* Command block */}
                      <div className="relative rounded-xl overflow-hidden border border-slate-700/60">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border-b border-slate-700/40">
                          <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono flex-1">
                            {detectedOS === 'windows' ? 'PowerShell / CMD' : 'Terminal'}
                          </span>
                          {relayToken && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(getRelayOneLiner('install'));
                                addNotification({ title: 'Copied!', message: detectedOS === 'windows' ? 'Paste in PowerShell or CMD and press Enter.' : 'Open Terminal, paste and press Enter.', type: 'success' });
                              }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 text-amber-400 text-[9px] font-bold transition-colors"
                            >
                              <Copy size={9} /> Copy
                            </button>
                          )}
                        </div>
                        <div className="p-3 bg-slate-950 min-h-[56px] flex items-center">
                          {relayToken ? (
                            <code className="text-[10px] font-mono text-amber-300 break-all leading-relaxed">{getRelayOneLiner('install')}</code>
                          ) : (
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 italic">
                              <Loader size={11} className="animate-spin" />
                              <span>Generating your unique install command…</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* CTA buttons */}
                      <div className="flex gap-2">
                        {detectedOS === 'windows' ? (
                          <>
                            <button
                              onClick={() => downloadInstallerScript('install')}
                              disabled={!relayToken}
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-xs transition-all shadow-lg shadow-amber-500/25"
                            >
                              <Download size={13} /> Download {getRelayScriptFilename('install')}
                            </button>
                            <button
                              onClick={() => {
                                if (!relayToken) return;
                                navigator.clipboard.writeText(getRelayOneLiner('install'));
                                addNotification({ title: 'Copied!', message: 'Paste in PowerShell or CMD and press Enter.', type: 'success' });
                              }}
                              disabled={!relayToken}
                              className="px-3 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] border border-[var(--border-color)] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-[var(--text-secondary)] text-xs font-bold transition-colors"
                            >
                              <Copy size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(getRelayOneLiner('install'));
                              addNotification({ title: 'Copied!', message: 'Open Terminal, paste and press Enter. Connection will be detected automatically.', type: 'success' });
                            }}
                            disabled={!relayToken}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-xs transition-all shadow-lg shadow-amber-500/20"
                          >
                            <Copy size={13} /> Copy Install Command
                          </button>
                        )}
                        {!relayToken && (
                          <button
                            onClick={handleGenerateRelayToken}
                            disabled={relayLoading}
                            className="px-3 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] border border-[var(--border-color)] disabled:opacity-40 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs font-bold transition-colors"
                          >
                            {relayLoading ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Step 2 — waiting for connection */}
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${relayConnected ? 'bg-emerald-500' : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)]'}`}>
                          {relayConnected
                            ? <CheckCircle size={12} className="text-white" />
                            : <span className="text-[10px] font-bold text-[var(--text-muted)]">2</span>
                          }
                        </div>
                        <p className="text-xs font-bold text-[var(--text-secondary)]">
                          {relayConnected ? 'Relay detected — you\'re connected!' : 'Waiting for relay to connect…'}
                        </p>
                      </div>

                      <AnimatePresence>
                        {relayConnected ? (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20"
                          >
                            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse shrink-0" />
                            <div className="flex-1">
                              <p className="text-[11px] font-bold text-emerald-300">Relay is online</p>
                              <p className="text-[10px] text-emerald-400/70">Your machine is connected securely</p>
                            </div>
                            <button
                              onClick={() => setRelayInstallSuccess(true)}
                              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-white text-[10px] font-bold transition-all active:scale-[0.97]"
                            >
                              Done ✓
                            </button>
                          </motion.div>
                        ) : (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
                          >
                            <Loader size={12} className="shrink-0 text-[var(--text-muted)] animate-spin" />
                            <span className="text-[10px] text-[var(--text-muted)]">After running the command above, your relay will connect here automatically.</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Collapsible advanced options */}
                    <details className="group border-t border-[var(--border-color)] pt-3">
                      <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1.5 py-1">
                        <ChevronDown size={11} className="group-open:rotate-180 transition-transform" />
                        Advanced options (uninstall, alternative methods)
                      </summary>
                      <div className="pt-3 space-y-2">
                        {detectedOS !== 'windows' && (
                          <button
                            onClick={() => downloadInstallerScript('install')}
                            disabled={!relayToken}
                            className="w-full flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] rounded-xl text-[var(--text-secondary)] text-[11px] font-bold transition-colors disabled:opacity-40"
                          >
                            <Download size={13} /> Download script file instead
                          </button>
                        )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(getRelayOneLiner('uninstall'));
                            addNotification({ title: 'Copied!', message: detectedOS === 'windows' ? 'Paste in PowerShell or CMD to uninstall.' : 'Paste in Terminal to uninstall.', type: 'info' });
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-xl text-red-400 text-[11px] font-bold transition-all"
                        >
                          <Copy size={12} /> Copy Uninstall Command
                        </button>
                        <button
                          onClick={() => downloadInstallerScript('uninstall')}
                          className="w-full flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] rounded-xl text-[var(--text-secondary)] text-[11px] font-bold transition-colors"
                        >
                          <Download size={12} /> Download {getRelayScriptFilename('uninstall')}
                        </button>
                        {relayConnected && (
                          <button
                            onClick={handleRevokeAllRelays}
                            className="w-full text-[10px] text-red-400/60 hover:text-red-400 transition-colors py-1 text-center"
                          >
                            Revoke all tokens
                          </button>
                        )}
                      </div>
                    </details>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlusIcon({ size, className }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}

