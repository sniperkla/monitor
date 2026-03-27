'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Palette, Image as ImageIcon, Monitor, Layout, Bell, Shield, Info, 
  Database, CheckCircle, AlertCircle, RefreshCw, Zap, Wifi, WifiOff, 
  Loader, Trash2, Lock, Unlock, Key, Mail, Code, Volume2, Sun, Moon, Cpu,
  Search, Terminal, Network, Download, Copy, X, CheckCheck, Sparkles
} from 'lucide-react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';
import ShortcutInput from '@/components/Desktop/ShortcutInput';

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

export default function SettingsApp({ initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'appearance');
  const { data: session } = useSession();
  const { t, i18n } = useTranslation();
  const { state: osState, setWallpaper, setGlassmorphism, setIconSize, setIconStyle, setBrightness, setUiScale, setNotifications, setLanguage, setTheme, setTaskbarPosition, setWindowLayout, addCustomWallpaper, removeCustomWallpaper, saveSettings, addNotification, showConfirm, setKeyboardShortcuts, setTerminalSettings } = useOS();
  const { state: appState, dispatch } = useApp();
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // For mobile/small window view

  // Local Relay Agent state
  const [relayToken, setRelayToken] = useState(null);
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayModalOpen, setRelayModalOpen] = useState(false);
  const [relayWaiting, setRelayWaiting] = useState(false);
  const [relayInstallSuccess, setRelayInstallSuccess] = useState(false);

  // Detect PWA (standalone) mode
  const isPWA = useMemo(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches, []);

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

  // Poll relay status — every 5s on database tab, every 2s while install wizard is waiting
  useEffect(() => {
    const isOnDbTab = activeTab === 'database' && session;
    const isWaiting = relayModalOpen && relayWaiting;
    if (!isOnDbTab && !isWaiting) return;
    const interval = isWaiting ? 2000 : 5000;
    const poll = async () => {
      try {
        const res = await fetch('/api/relay/token');
        const data = await res.json();
        if (data.success) setRelayConnected(data.connected);
      } catch {}
    };
    poll();
    const id = setInterval(poll, interval);
    return () => clearInterval(id);
  }, [activeTab, session, relayModalOpen, relayWaiting]);

  // Auto-close modal when relay connects during install wizard
  useEffect(() => {
    if (!relayModalOpen) {
      setRelayWaiting(false);
      setRelayInstallSuccess(false);
      return;
    }
    if (relayWaiting && relayConnected && !relayInstallSuccess) {
      setRelayInstallSuccess(true);
      const timer = setTimeout(() => {
        setRelayModalOpen(false);
        addNotification({ title: 'Relay Connected!', message: 'Your local relay agent is now running.', type: 'success' });
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [relayConnected, relayWaiting, relayModalOpen, relayInstallSuccess]);

  const handleGenerateRelayToken = async () => {
    setRelayLoading(true);
    try {
      const res = await fetch('/api/relay/token', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRelayToken(data.token);
        addNotification({ title: t('settings_ui.relay.toasts.tokenCreated'), message: t('settings_ui.relay.toasts.tokenCreatedMsg'), type: 'success' });
      }
    } catch {
      addNotification({ title: t('common.error'), message: t('settings_ui.relay.toasts.tokenError'), type: 'error' });
    }
    setRelayLoading(false);
  };

  const handleRevokeRelayToken = async () => {
    try {
      await fetch('/api/relay/token', { method: 'DELETE' });
      setRelayToken(null);
      setRelayConnected(false);
      addNotification({ title: t('settings_ui.relay.toasts.tokenRevoked'), message: t('settings_ui.relay.toasts.tokenRevokedMsg'), type: 'info' });
    } catch {}
  };

  // Generate & download a platform-specific install/uninstall script
  const downloadInstallerScript = (mode) => {
    const server = window.location.origin;
    const scriptUrl = `${server}/local-relay.js`;
    const installArgs = `--install --server ${server} --token ${relayToken}`;
    const installCmd  = `node local-relay.js ${installArgs}`;
    const uninstallCmd = `node local-relay.js --uninstall`;
    const cmd = mode === 'install' ? installCmd : uninstallCmd;

    let content, filename;
    if (detectedOS === 'windows') {
      content = [
        '@echo off',
        'setlocal',
        `cd /d "%USERPROFILE%\\Downloads"`,
        `echo Downloading latest local-relay.js...`,
        `curl -fsSL "${scriptUrl}" -o local-relay.js`,
        `echo Running: ${cmd}`,
        cmd,
        'echo.',
        'echo Done! Press any key to close...',
        'pause > nul',
      ].join('\r\n');
      filename = mode === 'install' ? 'relay-install.bat' : 'relay-uninstall.bat';
    } else {
      const lines = [
        '#!/bin/bash',
        'set -e',
        'cd ~/Downloads',
        `echo "Downloading latest local-relay.js..."`,
        `curl -fsSL "${scriptUrl}" -o local-relay.js`,
        `echo "Running: ${cmd}"`,
        cmd,
        'echo ""',
        'echo "Done!"',
      ];
      filename = mode === 'install' ? 'relay-install.sh' : 'relay-uninstall.sh';
      content = lines.join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    addNotification({ 
      title: t('settings_ui.relay.toasts.downloaded'), 
      message: t('settings_ui.relay.toasts.downloadMsg', { filename, mode: mode === 'install' ? t('settings_ui.relay.install').toLowerCase() : t('settings_ui.relay.uninstall').toLowerCase() }), 
      type: 'success' 
    });
  };

  // Self-contained one-liner for macOS/Linux (curl download + node run in one paste)
  const getMacOneLiner = (mode) => {
    const server = window.location.origin;
    const scriptUrl = `${server}/local-relay.js`;
    if (mode === 'uninstall') {
      return `curl -fsSL "${scriptUrl}" -o /tmp/local-relay.js && node /tmp/local-relay.js --uninstall`;
    }
    return `curl -fsSL "${scriptUrl}" -o /tmp/local-relay.js && node /tmp/local-relay.js --install --server ${server} --token ${relayToken}`;
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
      <div className={`
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        fixed md:relative z-20 md:z-0 w-52 border-r border-[var(--border-color)] p-4 flex flex-col shrink-0 h-full overflow-y-auto custom-scrollbar transition-transform duration-300 bg-transparent
      `}>
        {/* User Profile Section */}
        <div className="mb-8 px-2">
          {session ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img 
                  src={session.user.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`} 
                  className="w-10 h-10 rounded-full border border-[var(--border-color)] object-cover" 
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
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate text-[var(--text-primary)]">{session.user.name}</p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">{session.user.email}</p>
                </div>
              </div>
              {/* Vault Status Badge */}
              <div className={`flex items-center gap-2 text-[10px] font-bold px-2 py-1 rounded-lg ${
                vaultStatus === 'unlocked' 
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : vaultStatus === 'locked' 
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-gray-500/10 text-gray-700 dark:text-[var(--text-muted)]'
              }`}>
                {vaultStatus === 'unlocked' ? (
                  <><Unlock size={10} /> {t('settings_ui.vaultStatus.unlocked')}</>
                ) : vaultStatus === 'locked' ? (
                  <><Lock size={10} /> {t('settings_ui.vaultStatus.locked')}</>
                ) : (
                  <><Shield size={10} /> {t('settings_ui.vaultStatus.none')}</>
                )}
              </div>
              <button 
                onClick={async () => {
                  try {
                    await saveSettings();
                  } catch(e) { console.error(e); }
                  signOut();
                }}
                className="w-full text-left text-[10px] font-bold text-red-400/70 hover:text-red-400 transition-colors flex items-center gap-2"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {t('common.logout')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{t('common.login')}</p>
              <button 
                onClick={() => signIn('google')}
                className="w-full py-2 px-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs font-bold border border-[var(--border-color)] hover:bg-[var(--bg-card-hover)] transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <img src="https://lh3.googleusercontent.com/COxitqgJr1sJnIDe8-jiKhxDx1FrYbtRHKJ9z_hELisAlapwE9LUPh6fcXIfb5vwpbMl4xl9H9TRFPc5NOO8Sb3VSgIBrfRYvW6cUA" className="w-4 h-4" alt="Google" />
                {t('common.login')}
              </button>
              <p className="text-[9px] text-center text-[var(--text-secondary)] px-1">{t('vault.setupDescription')}</p>
            </div>
          )}
        </div>

        <h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-4 px-2">{t('common.settings')}</h2>
        <div className="space-y-1">
          {[
            { id: 'appearance', label: t('settings.appearanceTitle'), icon: Palette, color: 'text-indigo-400', desc: t('settings.appearanceDesc') },
            { id: 'terminal', label: t('settings_ui.terminal.title') || 'Terminal', icon: Terminal, color: 'text-emerald-400', desc: t('settings_ui.terminal.desc') },

            { id: 'database', label: t('settings.databaseTitle'), icon: Database, color: 'text-purple-400', desc: t('settings.databaseDesc'), requireLogin: true },
            { id: 'display', label: t('settings_ui.display.title'), icon: Monitor, color: 'text-blue-400', desc: t('settings_ui.display.desc') },
            { id: 'notifications', label: t('settings_ui.notifications.title'), icon: Bell, color: 'text-amber-400', desc: t('settings_ui.notifications.desc') },
            { id: 'privacy', label: t('settings_ui.privacy.title'), icon: Shield, color: 'text-emerald-400', desc: t('settings_ui.privacy.desc') },
            { id: 'keyboard', label: t('settings_ui.keyboard.title') || 'Shortcuts', icon: Key, color: 'text-rose-400', desc: t('settings_ui.keyboard.desc') || 'Manage system shortcuts' },
            { id: 'about', label: t('common.about'), icon: Info, color: 'text-[var(--text-muted)]', desc: t('settings_ui.about.desc') },
          ].map(tab => {
            const isDisabled = tab.requireLogin && !session;
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-[var(--glow-indigo)] text-[var(--accent-indigo)] font-semibold'
                    : isDisabled
                    ? 'text-[var(--text-muted)] cursor-not-allowed opacity-50'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <tab.icon size={16} className={activeTab === tab.id ? 'text-[var(--accent-indigo)]' : ''} />
                <span className="text-sm font-medium truncate">{tab.label}</span>
                {isDisabled && (
                  <span className="ml-auto text-[8px] text-amber-700 dark:text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">{t('vault.loginBtn').toUpperCase()}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Overlay to close sidebar on mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-10 md:hidden" 
          onClick={() => setIsSidebarOpen(false)} 
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto h-full p-4 md:p-8 pb-28 custom-scrollbar">
        {/* Mobile Header */}
        <div className="flex items-center gap-3 mb-6 md:hidden">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
          >
            <Layout size={18} />
          </button>
          <h2 className="text-lg font-bold truncate">
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
          </h2>
        </div>

        {activeTab === 'appearance' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings.appearanceTitle')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings.appearanceDesc')}</p>

            <section className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <ImageIcon size={16} className="text-indigo-400" />
                  {t('settings.wallpaper')}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Preset Wallpapers */}
                  {WALLPAPERS.map(wp => {
                    const isActive = osState.wallpaper === wp.url;
                    return (
                      <div 
                        key={wp.id}
                        className={`group relative h-28 rounded-xl overflow-hidden cursor-pointer border-2 transition-all shadow-lg ${
                          isActive 
                            ? 'border-indigo-500 ring-2 ring-indigo-500/30' 
                            : 'border-transparent hover:border-indigo-500'
                        }`}
                        onClick={() => handleSetWallpaper(wp.url)}
                      >
                        <img src={wp.url} alt={wp.name} className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-500" />
                        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {isActive && <CheckCircle size={24} className="text-white drop-shadow-lg mb-4" />}
                          {!isActive && <span className="text-xs font-bold bg-indigo-500 px-2 py-1 rounded shadow text-white pointer-events-none">{t('settings_ui.appearance.apply')}</span>}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                          <span className="text-[10px] font-medium text-white opacity-90">{wp.name}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Custom Wallpapers (Persistent) */}
                  {osState.customWallpapers?.map((url, idx) => {
                    const isActive = osState.wallpaper === url;
                    return (
                      <div 
                        key={`custom-${idx}`}
                        className={`group relative h-28 rounded-xl overflow-hidden cursor-pointer border-2 transition-all shadow-lg ${
                          isActive 
                            ? 'border-indigo-500 ring-2 ring-indigo-500/30' 
                            : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                        }`}
                        onClick={() => handleSetWallpaper(url)}
                      >
                        <img src={url} alt="Custom" className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-500" />
                        
                        {/* Overlay Actions */}
                        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                           {isActive ? (
                             <CheckCircle size={24} className="text-white drop-shadow-lg mb-4" />
                           ) : (
                             <span className="text-xs font-bold bg-indigo-500 px-2 py-1 rounded shadow text-white pointer-events-none">{t('settings_ui.appearance.apply')}</span>
                           )}
                           
                           {/* Delete Button */}
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               removeCustomWallpaper(url);
                             }}
                             className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg transition-colors shadow-lg"
                             title={t('common.delete')}
                           >
                             <Trash2 size={12} />
                           </button>
                        </div>
                        
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                          <span className="text-[10px] font-medium text-white opacity-90">{t('settings_ui.appearance.customUrl')} #{idx + 1}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add New Custom URL Card */}
                  {showCustomInput ? (
                    <div className="h-28 rounded-xl bg-[var(--bg-tertiary)] border border-indigo-500/50 p-2 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200">
                      <input
                        autoFocus
                        type="text"
                        placeholder="https://images.unsplash.com/..."
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-[10px] text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                        value={customUrlInput}
                        onChange={(e) => setCustomUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (customUrlInput) {
                              addCustomWallpaper(customUrlInput);
                              handleSetWallpaper(customUrlInput);
                              setCustomUrlInput('');
                            }
                            setShowCustomInput(false);
                          }
                          if (e.key === 'Escape') setShowCustomInput(false);
                        }}
                      />
                      <div className="flex gap-1.5">
                        <button 
                          onClick={() => {
                            if (customUrlInput) {
                              addCustomWallpaper(customUrlInput);
                              handleSetWallpaper(customUrlInput);
                              setCustomUrlInput('');
                            }
                            setShowCustomInput(false);
                          }}
                          className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-600 rounded-lg text-[10px] font-bold transition-colors"
                        >
                          {t('settings_ui.appearance.apply')}
                        </button>
                        <button 
                          onClick={() => setShowCustomInput(false)}
                          className="px-2 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] rounded-lg text-[10px] font-bold border border-[var(--border-color)] transition-colors"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="h-28 rounded-xl border-dashed border-2 border-[var(--border-color)] flex flex-col items-center justify-center hover:border-[var(--border-hover)] transition-all cursor-pointer group hover:bg-[var(--bg-card)]"
                      onClick={() => setShowCustomInput(true)}
                    >
                      <PlusIcon size={20} className="text-[var(--text-secondary)] mb-1 group-hover:text-indigo-400 transition-colors" />
                      <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-muted)] transition-colors">{t('settings_ui.appearance.customUrl')}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Layout size={16} className="text-[var(--accent-emerald)]" />
                  {t('settings.interfaceStyle')}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div 
                    className={`p-4 rounded-xl cursor-pointer transition-all border shadow-sm ${
                      glassmorphism ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]' : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                    } flex items-center justify-between`}
                    onClick={() => setGlassmorphism(true)}
                  >
                    <div>
                      <span className="block text-sm font-medium text-[var(--text-primary)]">{t('settings_ui.appearance.glassmorphism')}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{t('settings_ui.appearance.glassmorphismDesc')}</span>
                    </div>
                    <div className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${glassmorphism ? 'bg-[var(--accent-indigo)]' : 'bg-slate-300 dark:bg-slate-700'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${glassmorphism ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                  <div 
                    className={`p-4 rounded-xl cursor-pointer transition-all border shadow-sm ${
                      !glassmorphism ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]' : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                    } flex items-center justify-between`}
                    onClick={() => setGlassmorphism(false)}
                  >
                    <div>
                      <span className="block text-sm font-medium text-[var(--text-primary)]">{t('settings_ui.appearance.opaqueMode')}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{t('settings_ui.appearance.opaqueModeDesc')}</span>
                    </div>
                    <div className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${!glassmorphism ? 'bg-[var(--accent-indigo)]' : 'bg-slate-300 dark:bg-slate-700'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${!glassmorphism ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Layout size={16} className="text-[var(--accent-purple)]" />
                  {t('settings_ui.appearance.iconStyle')}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {[
                    { id: 'glass' },
                    { id: 'flat' },
                    { id: 'neumorphic' },
                    { id: 'outline' },
                    { id: 'minimal' },
                  ].map(style => (
                    <button
                      key={style.id}
                      onClick={() => setIconStyle(style.id)}
                      className={`p-3 rounded-xl border transition-all text-left flex flex-col justify-between h-full ${
                        osState.iconStyle === style.id 
                          ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)] shadow-lg shadow-[var(--glow-indigo)]' 
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      <span className="block text-[11px] font-bold text-[var(--text-primary)] mb-1">{t(`settings_ui.appearance.styles.${style.id}`)}</span>
                      <span className="text-[9px] text-[var(--text-muted)] leading-tight">{t(`settings_ui.appearance.styles.${style.id}Desc`)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Palette size={16} className="text-[var(--accent-indigo)]" />
                  {t('settings_ui.appearance.theme')}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {[
                    { id: 'light', label: t('settings_ui.appearance.themes.light'), icon: Sun },
                    { id: 'dark', label: t('settings_ui.appearance.themes.dark'), icon: Moon },
                    { id: 'retro', label: t('settings_ui.appearance.themes.retro'), icon: Cpu },
                    { id: 'cyberpunk', label: t('settings_ui.appearance.themes.cyberpunk') || 'Cyberpunk', icon: Zap },
                    { id: 'auto', label: t('settings_ui.appearance.themes.auto'), icon: Monitor },
                  ].map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => {
                        setTheme(theme.id);
                        if (window.innerWidth < 768) setIsSidebarOpen(false);
                      }}
                      className={`p-4 rounded-xl border transition-all text-left flex flex-col justify-center items-start gap-2 h-full ${
                        osState.theme === theme.id 
                          ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]' 
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      <theme.icon size={20} className={osState.theme === theme.id ? 'text-[var(--accent-indigo)]' : 'text-[var(--text-muted)]'} />
                      <span className="block text-sm font-bold truncate text-[var(--text-primary)] w-full">{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Monitor size={16} className="text-[var(--accent-indigo)]" />
                  {t('settings_ui.appearance.language')}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { code: 'en', label: 'English', sub: 'USA' },
                    { code: 'th', label: 'ภาษาไทย', sub: 'TH' },
                    { code: 'cn', label: '简体中文', sub: 'CN' },
                  ].map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`p-4 rounded-xl border transition-all text-left h-full ${
                        i18n.language === lang.code 
                          ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)]' 
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      <span className="block text-sm font-bold truncate text-[var(--text-primary)]">{lang.label}</span>
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">{lang.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Taskbar Section (Merged from Personalization) */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Layout size={16} className="text-indigo-400" />
                  {t('settings_ui.personalization.taskbarTitle')}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {['bottom', 'top', 'left', 'right'].map(pos => (
                    <button
                      key={pos}
                      onClick={() => setTaskbarPosition(pos)}
                      className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                        osState.taskbarPosition === pos
                          ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)] text-[var(--accent-indigo)]'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      {t(`settings_ui.personalization.positions.${pos}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Window Layout Section */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Monitor size={16} className="text-blue-400" />
                  {t('settings_ui.personalization.windowLayoutTitle')}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {['mac', 'pc'].map(layout => (
                    <button
                      key={layout}
                      onClick={() => setWindowLayout(layout)}
                      className={`p-4 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-2 ${
                        osState.windowLayout === layout
                          ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)] text-[var(--accent-indigo)]'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      <div className={`w-full h-8 rounded-lg bg-black/20 flex items-center px-1.5 ${layout === 'mac' ? 'justify-start gap-1' : 'justify-end gap-1 flex-row-reverse'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${layout === 'mac' ? 'bg-[#ff5f57]' : 'bg-gray-400/50'}`} />
                        <div className={`w-1.5 h-1.5 rounded-full ${layout === 'mac' ? 'bg-[#febc2e]' : 'bg-gray-400/50'}`} />
                        <div className={`w-1.5 h-1.5 rounded-full ${layout === 'mac' ? 'bg-[#28c840]' : 'bg-gray-400/50'}`} />
                      </div>
                      {t(`settings_ui.personalization.windowLayouts.${layout}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Desktop Icon Size (Merged from Personalization) */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Monitor size={16} className="text-emerald-400" />
                  {t('settings_ui.personalization.desktopTitle')}
                </h3>
                <div className="flex gap-3">
                  {[
                    { id: 'small', size: 48 },
                    { id: 'medium', size: 64 },
                    { id: 'large', size: 80 },
                  ].map(size => (
                    <button
                      key={size.id}
                      onClick={() => setIconSize(size.id)}
                      className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-all ${
                        osState.iconSize === size.id
                          ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      {t(`desktop.context.icons.${size.id}`)}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}


        
        {activeTab === 'display' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings_ui.display.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings_ui.display.desc')}</p>

            <section className="space-y-8">
              {/* Actual Brightness Control */}
              <div className="p-6 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                    <Zap size={16} className="text-yellow-400" />
                    {t('settings_ui.display.brightness')}
                  </h3>
                  <span className="text-xs text-[var(--text-muted)] font-mono">{brightness}%</span>
                </div>
                <input 
                  type="range"
                  min="30"
                  max="100"
                  value={brightness}
                  onChange={(e) => setBrightness(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-indigo-500 mb-6"
                />
                <div className="p-3 bg-[var(--bg-tertiary)]/50 rounded-xl border border-[var(--border-color)] flex items-center gap-3">
                   <Info size={14} className="text-[var(--text-muted)]" />
                   <p className="text-[10px] text-[var(--text-muted)] italic">{t('settings_ui.display.brightnessDesc')}</p>
                </div>
              </div>

              {/* UI Scaling (Realistic Resolution Replacement) */}
              <div className="p-6 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl">
                <h4 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">{t('settings_ui.display.interfaceScaling')}</h4>
                <div className="grid grid-cols-3 gap-3">
                   {[75, 100, 125].map(scale => (
                     <button 
                       key={scale} 
                       onClick={() => {
                         setUiScale(scale);
                         addNotification({ title: 'UI Scale', message: t('settings_ui.display.scalingSet', { scale }), type: 'success' });
                       }}
                       className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                         uiScale === scale 
                           ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' 
                           : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                       }`}
                     >
                       {scale}%
                     </button>
                   ))}
                </div>
                <p className="mt-4 text-[11px] text-[var(--text-muted)]">{t('settings_ui.display.scalingInfo')}</p>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings_ui.notifications.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings_ui.notifications.desc')}</p>

            <section className="space-y-4">
               {[
                 { id: 'system', icon: Bell, title: t('settings_ui.notifications.system'), desc: t('settings_ui.notifications.systemDesc') },
                 { id: 'terminal', icon: Volume2, title: t('settings_ui.notifications.terminal'), desc: t('settings_ui.notifications.terminalDesc') },
                 { id: 'desktop', icon: Monitor, title: t('settings_ui.notifications.desktop'), desc: t('settings_ui.notifications.desktopDesc') },
               ].map((item, i) => {
                 const isActive = notifications[item.id];
                 return (
                   <motion.div 
                     key={item.id}
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ delay: i * 0.1 }}
                     className="p-4 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between group hover:bg-[var(--bg-card-hover)] transition-all"
                   >
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center group-hover:bg-indigo-500/10 transition-colors">
                          <item.icon size={20} className={isActive ? 'text-indigo-400' : 'text-[var(--text-muted)]'} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-[var(--text-primary)]">{item.title}</h4>
                          <p className="text-xs text-[var(--text-muted)] italic">{item.desc}</p>
                        </div>
                     </div>
                     <div 
                        onClick={() => setNotifications({ [item.id]: !isActive })}
                        className={`w-11 h-6 rounded-full p-1 transition-colors cursor-pointer ${isActive ? 'bg-[var(--accent-indigo)]' : 'bg-slate-300 dark:bg-slate-700'}`}
                     >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                     </div>
                   </motion.div>
                 );
               })}
            </section>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings_ui.privacy.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings_ui.privacy.desc')}</p>

            <section className="space-y-6">
              <div className="p-6 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-[var(--border-color)] rounded-3xl relative overflow-hidden group">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-700" />
                <div className="relative z-10 flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--bg-selected)] border border-[var(--accent-indigo)]/30 flex items-center justify-center shadow-xl shadow-[var(--glow-indigo)]/20">
                    <Shield size={24} className="text-[var(--text-selected)]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">{t('settings_ui.privacy.dashboard')}</h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                      {t('settings_ui.privacy.dashboardDesc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-gray-500/5 dark:bg-white/10 rounded-full text-[10px] font-bold uppercase text-[var(--text-secondary)] border border-gray-500/10 dark:border-white/10">{t('settings_ui.privacy.zeroKnowledge')}</span>
                      <span className="px-3 py-1 bg-gray-500/5 dark:bg-white/10 rounded-full text-[10px] font-bold uppercase text-[var(--text-secondary)] border border-gray-500/10 dark:border-white/10">{t('settings_ui.privacy.clientSideEncryption')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                  <div className="p-4 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-2xl flex items-center gap-3">
                    <Info size={16} className="text-indigo-400" />
                    <p className="text-xs text-[var(--text-muted)] font-medium">{t('settings_ui.privacy.autoHandled')}</p>
                  </div>
               </div>
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
                          <Lock size={18} className="text-amber-600 dark:text-amber-400" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('settings_ui.vaultStatus.locked')}</span>
                            <p className="text-[11px] text-amber-600/60 dark:text-amber-400/60">{t('vault.unlockDescription')}</p>
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
                          <Shield size={18} className="text-indigo-600 dark:text-indigo-400" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{t('settings_ui.vaultStatus.none')}</span>
                            <p className="text-[11px] text-indigo-600/60 dark:text-indigo-400/60">{t('vault.setupDescription')}</p>
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

                    {/* Local Relay Agent — only shown when active DB targets localhost */}
                    {/localhost|127\.0\.0\.1/.test(decryptedUri || dbUri) && (
                    <div id="relay-agent-section" className="border border-[var(--border-color)] rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 bg-amber-500/[0.04] border-b border-amber-500/10 flex items-center gap-3">
                        <Network size={15} className={relayConnected ? 'text-amber-400' : 'text-[var(--text-muted)]'} />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-[var(--text-primary)]">{t('settings_ui.relay.title')}</h4>
                          <p className="text-[10px] text-[var(--text-muted)]">{t('settings_ui.relay.subtitle')}</p>
                        </div>
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                          relayConnected
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${relayConnected ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-muted)]'}`} />
                          {relayConnected ? t('settings_ui.relay.statusConnected') : t('settings_ui.relay.statusOffline')}
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Why section — always visible */}
                        <details className="group">
                          <summary className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors list-none">
                            <Info size={11} className="shrink-0" />
                            {t('settings_ui.relay.whyTitle')}
                            <span className="ml-auto text-[8px] opacity-50 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="mt-2.5 p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] space-y-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                            <p>
                              <span className="text-[var(--text-primary)] font-semibold">{t('settings_ui.relay.problemLabel')}</span> {t('settings_ui.relay.problemDesc')}
                            </p>
                            <p>
                              <span className="text-[var(--text-primary)] font-semibold">{t('settings_ui.relay.fixesLabel')}</span> {t('settings_ui.relay.fixesDesc')}
                            </p>
                            <p>
                              <span className="text-emerald-400 font-semibold">{t('settings_ui.relay.solutionLabel')}</span> {t('settings_ui.relay.solutionDesc', { machine: t('settings_ui.relay.machine') || 'your machine' })}
                            </p>
                            <div className="flex items-center gap-1.5 pt-1 text-[9px] text-emerald-400 font-semibold">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                              {t('settings_ui.relay.safeHint')}
                            </div>
                          </div>
                        </details>

                        {relayToken ? (
                          <>
                            {/* Important: run on LOCAL machine notice */}
                            <div className="flex items-start gap-2 p-3 bg-blue-500/8 border border-blue-500/20 rounded-xl">
                              <span className="text-blue-400 text-base shrink-0">💻</span>
                              <p className="text-[10px] text-blue-300/80 leading-relaxed">
                                <span className="font-bold text-blue-300">Run the command below on your own computer</span> — the machine where MongoDB / MySQL / PostgreSQL is running. <span className="opacity-70">Not on the server.</span>
                              </p>
                            </div>

                            {/* OS badge */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${osMeta[detectedOS].badge}`}>
                                {osMeta[detectedOS].label} {t('settings_ui.relay.detected')}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">{osMeta[detectedOS].detail}</span>
                            </div>

                            {/* ONE-CLICK wizard button (always shown, primary on PWA) */}
                            <button
                              onClick={() => setRelayModalOpen(true)}
                              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-[12px] transition-colors ${
                                isPWA
                                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20'
                                  : 'bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400'
                              }`}
                            >
                              <Sparkles size={13} />
                              {isPWA ? t('settings_ui.relay.oneClick') : t('settings_ui.relay.wizard')}
                            </button>

                            {/* Inline command (non-PWA only — collapsible in PWA) */}
                            {!isPWA && (
                              <details>
                                <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors">
                                  {t('settings_ui.relay.manualCommand')}
                                </summary>
                                <div className="relative mt-2">
                                  <code className="block p-3 pr-10 bg-[var(--bg-tertiary)] rounded-xl text-[10px] font-mono text-amber-300 break-all leading-relaxed">
                                    {getMacOneLiner('install')}
                                  </code>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(getMacOneLiner('install'));
                                      addNotification({ title: t('settings_ui.relay.toasts.copied'), message: t('settings_ui.relay.toasts.copyMsg'), type: 'success' });
                                    }}
                                    className="absolute right-2 top-2 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                  >
                                    <Copy size={12} className="text-[var(--text-muted)]" />
                                  </button>
                                </div>
                              </details>
                            )}

                            <div className="flex items-center gap-3 flex-wrap">
                              <a
                                href="/local-relay.js"
                                download="local-relay.js"
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] rounded-lg text-[11px] text-[var(--text-muted)] transition-colors"
                              >
                                <Download size={12} /> local-relay.js
                              </a>
                              <button
                                onClick={handleRevokeRelayToken}
                                className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-2 py-1.5 ml-auto"
                              >
                                {t('settings_ui.relay.revokeToken')}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3">
                            <p className="text-[11px] text-[var(--text-muted)] flex-1">
                              Generate a token — <code className="text-amber-400 font-mono">local-relay.js</code> will auto-detect your OS and install the right background service.
                            </p>
                            <button
                              onClick={handleGenerateRelayToken}
                              disabled={relayLoading}
                              className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-lg text-white text-[11px] font-bold flex items-center gap-2 transition-colors"
                            >
                              {relayLoading ? <Loader size={12} className="animate-spin" /> : <Zap size={12} />}
                              Generate Token
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    )} {/* end Local Relay Agent conditional */}

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
                           <WifiOff size={18} className="text-amber-600 dark:text-amber-400" />
                           <div>
                             <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('settings_ui.db.notConnected')}</span>
                             <p className="text-[11px] text-amber-600/60 dark:text-amber-400/60">{t('settings_ui.db.notConnectedDesc')}</p>
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
                                 ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-600 dark:text-indigo-400'
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
                          className="flex-1 px-4 py-3 bg-gray-500/5 dark:bg-white/5 border border-gray-500/10 dark:border-white/10 rounded-xl text-sm font-mono text-[var(--text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
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
                                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-600 dark:text-indigo-400' 
                                : 'bg-gray-500/5 dark:bg-white/5 border-gray-500/10 dark:border-white/10 text-[var(--text-muted)] hover:bg-gray-500/10 dark:hover:bg-white/10 hover:text-[var(--text-primary)]'
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
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings_ui.keyboard.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">{t('settings_ui.keyboard.desc')}</p>

            <section className="space-y-6">
              <div className="grid gap-4">
                {[
                  { id: 'previewWindow', label: t('settings_ui.keyboard.missionControl'), desc: t('settings_ui.keyboard.descriptions.missionControl'), icon: Layout },
                  { id: 'spotlight', label: t('settings_ui.keyboard.spotlightSearch'), desc: t('settings_ui.keyboard.descriptions.spotlightSearch'), icon: Search },
                  { id: 'prevDesktop', label: t('settings_ui.keyboard.prevDesktop'), desc: t('settings_ui.keyboard.descriptions.prevDesktop'), icon: Monitor },
                  { id: 'nextDesktop', label: t('settings_ui.keyboard.nextDesktop'), desc: t('settings_ui.keyboard.descriptions.nextDesktop'), icon: Monitor },
                  { id: 'minimizeAll', label: t('settings_ui.keyboard.minimizeAll'), desc: t('settings_ui.keyboard.descriptions.minimizeAll'), icon: Layout },
                  { id: 'closeAll', label: t('settings_ui.keyboard.closeAll'), desc: t('settings_ui.keyboard.descriptions.closeAll'), icon: Trash2 },
                ].map((item) => (
                  <div key={item.id} className="p-4 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between group hover:bg-[var(--bg-card-hover)] transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <item.icon size={18} className="text-indigo-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-[var(--text-primary)]">{item.label}</h4>
                        <p className="text-[10px] text-[var(--text-muted)]">{item.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <ShortcutInput
                          value={osState.keyboardShortcuts?.[item.id] || ''}
                          onChange={(val) => {
                            setKeyboardShortcuts({ [item.id]: val });
                          }}
                          placeholder="e.g. Cmd+K"
                          className="w-32 border-indigo-500/20 text-[var(--accent-indigo)]"
                        />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3">
                <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 dark:text-amber-200/70 leading-relaxed">
                  <strong>Tip:</strong> Shortcuts use standard combinations like <code>Cmd+K</code>, <code>Ctrl+Shift+L</code>, etc. Use <code>Cmd</code> for Command (Mac) or Windows Key (PC), and <code>Ctrl</code> for Control.
                </p>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="max-w-md mx-auto py-12 text-center animate-in zoom-in-95 duration-300">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl shadow-2xl flex items-center justify-center mb-6">
              <Monitor size={48} className="text-white drop-shadow-lg" />
            </div>
            <h2 className="text-2xl font-bold mb-1">Webtop OS</h2>
            <p className="text-indigo-400 text-sm font-medium mb-6">{t('settings_ui.about.version', { version: '1.0.5 (Beta)' })}</p>
            <div className="bg-gray-500/5 dark:bg-white/5 rounded-2xl p-6 border border-gray-500/10 dark:border-white/10 text-sm text-[var(--text-primary)] leading-relaxed text-left">
              <p className="mb-4 text-xs">{t('settings_ui.about.description')}</p>
              
              <div className="space-y-4">
                {/* Environment Info */}
                <div className="space-y-2">
                  <div className="flex justify-between border-b border-gray-500/5 dark:border-white/5 pb-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">{t('settings_ui.about.environment')}</span>
                    <span className="text-[var(--text-primary)]">{t('settings_ui.about.environmentValue')}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-500/5 dark:border-white/5 pb-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">{t('settings_ui.about.resolution')}</span>
                    <span className="text-[var(--text-primary)]">{typeof window !== 'undefined' ? `${window.innerWidth} x ${window.innerHeight}` : 'N/A'}</span>
                  </div>
                </div>

                {/* Security Engineering Section */}
                <div>
                  <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3">{t('settings_ui.about.securityEng')}</h4>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-center gap-2 bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-2">
                      <Shield size={12} className="text-indigo-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase">{t('settings_ui.about.keyDerivation')}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{t('settings_ui.about.keyDerivationValue')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2">
                      <Lock size={12} className="text-emerald-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase">{t('settings_ui.about.encryption')}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{t('settings_ui.about.encryptionValue')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2">
                      <Code size={12} className="text-amber-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase">{t('settings_ui.about.defense')}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{t('settings_ui.about.defenseValue')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2 border-t border-gray-500/5 dark:border-white/5">
                  <span className="font-medium text-gray-600 dark:text-gray-300">{t('settings_ui.about.license')}</span>
                  <span className="text-[var(--text-primary)] font-bold">{t('settings_ui.about.licenseValue')}</span>
                </div>
              </div>
            </div>
            <p className="mt-8 text-[10px] text-gray-600 italic">{t('settings_ui.about.quote')}</p>
          </div>
        )}
        {activeTab === 'terminal' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{t('settings_ui.terminal.title') || 'Terminal Customization'}</h1>
            <p className="text-[var(--text-secondary)] text-sm mb-8">Personalize your command-line interface with presets and custom styling.</p>

            <section className="space-y-8">
              {/* Presets Grid */}
              <div>
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Monitor size={16} className="text-emerald-400" />
                  {t('settings_ui.terminal.presets') || 'Interface Presets'}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { id: 'modern', name: 'Standard Modern', desc: 'Clean font, smooth colors' },
                    { id: 'retro', name: 'Pip-Boy 3000', desc: 'Monochrome, phosphor glow' },
                    { id: 'matrix', name: 'Digital Rain', desc: 'High contrast green-on-black' },
                  ].map(p => {
                    const isActive = osState.terminalSettings?.activePreset === p.id;
                    return (
                      <button 
                        key={p.id}
                        onClick={() => setTerminalSettings({ activePreset: p.id })}
                        className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden ${
                          isActive 
                            ? 'bg-emerald-500/5 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]' 
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg mb-3 flex items-center justify-center ${isActive ? 'bg-emerald-500/20' : 'bg-[var(--bg-tertiary)]'}`}>
                          <Terminal size={16} className={isActive ? 'text-emerald-400' : 'text-[var(--text-muted)]'} />
                        </div>
                        <span className="block text-sm font-bold text-[var(--text-primary)]">{p.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Advanced Typography */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                   <Code size={16} className="text-indigo-400" />
                   Typography & Sizing
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Font Size */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">{t('settings_ui.terminal.fontSize') || 'Font Size'}</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range"
                        min="10"
                        max="32"
                        value={osState.terminalSettings?.fontSize || 14}
                        onChange={(e) => setTerminalSettings({ fontSize: parseInt(e.target.value) })}
                        className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-emerald-500"
                      />
                      <span className="text-sm font-mono text-emerald-400 w-8">{osState.terminalSettings?.fontSize || 14}px</span>
                    </div>
                  </div>

                  {/* Cursor Style */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Cursor Style</label>
                    <div className="flex gap-2">
                      {['bar', 'block', 'underline'].map(style => (
                        <button
                          key={style}
                          onClick={() => setTerminalSettings({ cursorStyle: style })}
                          className={`flex-1 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                            (osState.terminalSettings?.cursorStyle || 'bar') === style
                              ? 'bg-[var(--glow-indigo)] border-[var(--accent-indigo)] text-[var(--accent-indigo)]'
                              : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)]'
                          }`}
                        >
                          {style.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Terminal Colors */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <h3 className="text-sm font-semibold mb-6 flex items-center gap-2">
                   <Palette size={16} className="text-amber-400" />
                   {t('settings_ui.terminal.colors') || 'Terminal Colors'}
                </h3>
                <div className="space-y-4">
                  {[
                    { key: 'background', label: t('settings_ui.terminal.background'), colorId: 'amber', default: '#0c0c0c' },
                    { key: 'foreground', label: t('settings_ui.terminal.foreground'), colorId: 'emerald', default: '#e4e4e7' },
                    { key: 'cursor', label: t('settings_ui.terminal.cursor'), colorId: 'indigo', default: '#6366f1' }
                  ].map(c => (
                    <div key={c.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)]">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-[var(--text-primary)]">{c.label}</span>
                        <span className="text-[10px] text-[var(--text-muted)] font-mono uppercase opacity-60">{c.key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                         <div className="relative w-10 h-10 rounded-xl border border-[var(--border-color)] overflow-hidden bg-[var(--bg-tertiary)] flex-shrink-0 shadow-sm group">
                           <div 
                             className="absolute inset-0 transition-transform group-hover:scale-110" 
                             style={{ backgroundColor: osState.terminalSettings?.theme?.[c.key] || c.default }} 
                           />
                           <input 
                             type="color" 
                             value={osState.terminalSettings?.theme?.[c.key] || c.default}
                             onChange={(e) => updateTerminalTheme(c.key, e.target.value)}
                             className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -left-1/2 -top-1/2"
                           />
                         </div>
                         <input 
                           type="text"
                           value={osState.terminalSettings?.theme?.[c.key] || c.default}
                           onChange={(e) => updateTerminalTheme(c.key, e.target.value)}
                           className={`w-28 h-10 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl px-3 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-indigo)] transition-all`}
                         />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Opacity Control */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <div className="p-6 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                      <Layout size={16} className="text-blue-400" />
                      {t('settings_ui.terminal.opacity') || 'Background Opacity'}
                    </h3>
                    <span className="text-xs text-blue-400 font-mono">{Math.round((osState.terminalSettings?.backgroundOpacity ?? 1) * 100)}%</span>
                  </div>
                  <input 
                    type="range"
                    min="30"
                    max="100"
                    value={(osState.terminalSettings?.backgroundOpacity ?? 1) * 100}
                    onChange={(e) => setTerminalSettings({ backgroundOpacity: parseInt(e.target.value) / 100 })}
                    className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <p className="mt-4 text-[10px] text-[var(--text-muted)] italic">
                    Lower opacity allows the desktop wallpaper to shine through. Works best with darker background colors.
                  </p>
                </div>
              </div>

              {/* Behavior Settings */}
              <div className="pt-6 border-t border-[var(--border-color)]">
                <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between group hover:bg-[var(--bg-card-hover)] transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                      <RefreshCw size={18} className="text-amber-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Cursor Blinking</h4>
                      <p className="text-[10px] text-[var(--text-muted)] italic">Enable or disable smooth cursor animation</p>
                    </div>
                  </div>
                  <div 
                    onClick={() => setTerminalSettings({ cursorBlink: !osState.terminalSettings?.cursorBlink })}
                    className={`w-11 h-6 rounded-full p-1 transition-colors cursor-pointer ${osState.terminalSettings?.cursorBlink !== false ? 'bg-[var(--accent-emerald)]' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${osState.terminalSettings?.cursorBlink !== false ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between group hover:bg-[var(--bg-card-hover)] transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                      <Zap size={18} className="text-indigo-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Tmux Mouse Scroll</h4>
                      <p className="text-[10px] text-[var(--text-muted)] italic">Allow mouse wheel to scroll history within Tmux</p>
                    </div>
                  </div>
                  <div 
                    onClick={() => setTerminalSettings({ tmuxMouseScrolling: !osState.terminalSettings?.tmuxMouseScrolling })}
                    className={`w-11 h-6 rounded-full p-1 transition-colors cursor-pointer ${osState.terminalSettings?.tmuxMouseScrolling ? 'bg-[var(--accent-indigo)]' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${osState.terminalSettings?.tmuxMouseScrolling ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl flex items-center justify-between group hover:bg-[var(--bg-card-hover)] transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                      <Terminal size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Auto-Attach Tmux</h4>
                      <p className="text-[10px] text-[var(--text-muted)] italic">Automatically open Tmux on every terminal start</p>
                    </div>
                  </div>
                  <div 
                    onClick={() => setTerminalSettings({ autoTmuxAttach: !osState.terminalSettings?.autoTmuxAttach })}
                    className={`w-11 h-6 rounded-full p-1 transition-colors cursor-pointer ${osState.terminalSettings?.autoTmuxAttach ? 'bg-[var(--accent-emerald)]' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${osState.terminalSettings?.autoTmuxAttach ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>
              </div>


            </section>
          </div>
        )}
      </div>

      {/* ── One-Click Relay Installer Modal ─────────────────────────── */}
      <AnimatePresence>
        {relayModalOpen && (
          <motion.div
            key="relay-installer-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setRelayModalOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              className="w-full max-w-sm bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl my-auto flex flex-col"
            >
              {/* Header — sticky so it stays visible while scrolling */}
              <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-3 shrink-0">
                <Sparkles size={15} className="text-amber-400" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">{t('settings_ui.relay.installerTitle')}</h3>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {detectedOS === 'macos' ? t('settings_ui.relay.copyPasteOneLiner') : t('settings_ui.relay.downloadClickNoTerminal')}
                  </p>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${osMeta[detectedOS].badge}`}>
                  {osMeta[detectedOS].label}
                </span>
                <button onClick={() => setRelayModalOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                  <X size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto max-h-[calc(100vh-12rem)]">
              {relayInstallSuccess ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-5">
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 200 }}
                    className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/30 flex items-center justify-center"
                  >
                    <CheckCircle size={38} className="text-emerald-400" />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="space-y-1"
                  >
                    <p className="text-base font-bold text-[var(--text-primary)]">Relay Connected!</p>
                    <p className="text-xs text-emerald-400">Agent is running on your machine</p>
                    <p className="text-[10px] text-[var(--text-muted)] pt-1">Closing automatically…</p>
                  </motion.div>
                </div>
              ) : (
              <div className="space-y-4">
                {/* How-it-works banner */}
                <div className="flex gap-2.5 p-3 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/15 text-[10px] text-[var(--text-muted)] leading-relaxed">
                  <Info size={12} className="shrink-0 text-emerald-400 mt-0.5" />
                  <span>
                    {t('settings_ui.relay.howItWorks', { 
                      machine: t('settings_ui.relay.machine') || 'your machine' 
                    }).split('{{machine}}').map((part, i, arr) => 
                      i < arr.length - 1 ? [part, <strong key={i} className="text-[var(--text-secondary)]">{t('settings_ui.relay.machine') || 'your machine'}</strong>] : part
                    )}
                  </span>
                </div>

                {/* INSTALL */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{t('settings_ui.relay.install')}</p>

                  {detectedOS === 'macos' ? (
                    /* macOS: Gatekeeper blocks downloaded scripts — use copy+paste approach */
                    <>
                      <div className="relative">
                        <code className="block p-3 pr-10 bg-[var(--bg-tertiary)] rounded-xl text-[10px] font-mono text-amber-300 break-all leading-relaxed">
                          {getMacOneLiner('install')}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(getMacOneLiner('install'));
                            setRelayWaiting(true);
                            addNotification({ title: t('settings_ui.relay.toasts.copied'), message: t('settings_ui.relay.toasts.copyMsg'), type: 'success' });
                          }}
                          className="absolute right-2 top-2 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        >
                          <Copy size={12} className="text-[var(--text-muted)]" />
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(getMacOneLiner('install'));
                          setRelayWaiting(true);
                          addNotification({ title: t('settings_ui.relay.toasts.copied'), message: t('settings_ui.relay.toasts.openPasteInstall'), type: 'success' });
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] rounded-xl text-white font-bold text-sm transition-all shadow-lg shadow-amber-500/20"
                      >
                        <Copy size={14} /> {t('settings_ui.relay.copyInstallCommand')}
                      </button>

                      {/* Step hints */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {[t('settings_ui.relay.steps.copy'), t('settings_ui.relay.steps.openTerminal'), t('settings_ui.relay.steps.pasteEnter')].map((s, i) => (
                          <div key={i} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--bg-tertiary)]">
                            <CheckCheck size={12} className="text-amber-400" />
                            <span className="text-[9px] text-[var(--text-muted)] text-center leading-tight">{s}</span>
                          </div>
                        ))}
                      </div>

                      <p className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                        {t('settings_ui.relay.openTerminalHint')}
                      </p>

                      {/* Download fallback */}
                      <details>
                        <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors py-1">
                          {t('settings_ui.relay.preferScript')}
                        </summary>
                        <div className="pt-2 space-y-2">
                          <button
                            onClick={() => downloadInstallerScript('install')}
                            className="w-full flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] rounded-xl text-[var(--text-secondary)] text-[11px] font-bold transition-colors"
                          >
                            <Download size={13} /> {t('settings_ui.relay.downloadScript')}
                          </button>
                          <p className="text-[10px] text-[var(--text-muted)] bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                            {t('settings_ui.relay.macOSBlockWarning')}<br />
                            <code className="text-amber-300 text-[9px] break-all">xattr -d com.apple.quarantine ~/Downloads/relay-install.command && bash ~/Downloads/relay-install.command</code>
                          </p>
                        </div>
                      </details>
                    </>
                  ) : (
                    /* Windows / Linux: download & double-click works fine */
                    <>
                      <button
                        onClick={() => downloadInstallerScript('install')}
                        className="w-full flex items-center gap-3 px-4 py-3.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] rounded-xl text-white font-bold text-sm transition-all shadow-lg shadow-amber-500/25"
                      >
                        <Download size={16} />
                        <div className="text-left">
                          <div>{t('settings_ui.relay.downloadInstaller')}</div>
                          <div className="text-[10px] font-normal opacity-80">
                            {detectedOS === 'windows' && t('settings_ui.relay.winHint')}
                            {detectedOS === 'linux'   && t('settings_ui.relay.linuxHint')}
                            {detectedOS === 'unknown' && t('settings_ui.relay.autoDetect')}
                          </div>
                        </div>
                      </button>

                      {/* Step hints */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {[t('settings_ui.relay.steps.download'), t('settings_ui.relay.steps.doubleClick'), t('settings_ui.relay.steps.done')].map((s, i) => (
                          <div key={i} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--bg-tertiary)]">
                            <CheckCheck size={12} className="text-amber-400" />
                            <span className="text-[9px] text-[var(--text-muted)] text-center leading-tight">{s}</span>
                          </div>
                        ))}
                      </div>

                      {detectedOS === 'linux' && (
                        <p className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                          {t('settings_ui.relay.linuxRunHint')}
                        </p>
                      )}
                      {detectedOS === 'windows' && (
                        <p className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                          {t('settings_ui.relay.winRunHint')}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-widest">{t('vault.or')}</span>
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                </div>

                {/* UNINSTALL */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{t('settings_ui.relay.uninstall')}</p>
                  {detectedOS === 'macos' ? (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(getMacOneLiner('uninstall'));
                        addNotification({ title: t('settings_ui.relay.toasts.copied'), message: t('settings_ui.relay.toasts.pasteUninstall'), type: 'info' });
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 active:scale-[0.98] rounded-xl text-red-400 font-bold text-[12px] transition-all"
                    >
                      <Copy size={14} />
                      <div className="text-left">
                        <div>{t('settings_ui.relay.uninstallBtn')}</div>
                        <div className="text-[10px] font-normal opacity-70">{t('settings_ui.relay.uninstallDesc')}</div>
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={() => downloadInstallerScript('uninstall')}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 active:scale-[0.98] rounded-xl text-red-400 font-bold text-[12px] transition-all"
                    >
                      <X size={14} />
                      <div className="text-left">
                        <div>{t('settings_ui.relay.downloadUninstaller')}</div>
                        <div className="text-[10px] font-normal opacity-70">
                          {detectedOS === 'windows' && t('settings_ui.relay.winUninstallHint')}
                          {detectedOS === 'linux'   && t('settings_ui.relay.linuxUninstallHint')}
                        </div>
                      </div>
                    </button>
                  )}
                </div>

                <p className="text-[9px] text-center text-[var(--text-muted)]">
                  {t('settings_ui.relay.osMeta.unknown')}
                </p>

                {/* Waiting indicator — shown after user copies the install command */}
                <AnimatePresence>
                  {relayWaiting && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 text-[10px] text-[var(--text-muted)]"
                    >
                      <Loader size={12} className="shrink-0 text-amber-400 animate-spin" />
                      <span>Waiting for relay agent to connect… run the command above in your Terminal, then this window will close automatically.</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
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
