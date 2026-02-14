'use client';

import { useState, useEffect } from 'react';
import { 
  Palette, Image as ImageIcon, Monitor, Layout, Bell, Shield, Info, 
  Database, CheckCircle, AlertCircle, RefreshCw, Zap, Wifi, WifiOff, 
  Loader, Trash2, Lock, Unlock, Key, Mail, Code,Volume2
} from 'lucide-react';
import { useOS } from '@/context/OSContext';
import { useApp } from '@/context/AppContext';
import { useVault } from '@/context/VaultContext';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

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

export default function SettingsApp() {
  const [activeTab, setActiveTab] = useState('appearance');
  const { data: session } = useSession();
  const { t, i18n } = useTranslation();
  const { state: osState, setWallpaper, setGlassmorphism, setIconSize, setIconStyle, setBrightness, setUiScale, setNotifications, setLanguage, addCustomWallpaper, removeCustomWallpaper, saveSettings } = useOS();
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

  // Custom Wallpaper state
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');

  useEffect(() => {
    if (activeTab === 'database') {
      fetchDbConfig();
    }
  }, [activeTab, vaultStatus, decryptedUri]);

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
      toast.error(t('settings_ui.db.enterUri'));
      return;
    }
    setDbConnecting(true);
    try {
      const testRes = await fetch('/api/connections', {
        headers: { 'x-mongodb-uri': dbUri.trim() }
      });
      const testData = await testRes.json();
      
      if (testData.success) {
        const targetUri = dbUri.trim();
        dispatch({ type: 'SET_DB_CONFIG', payload: { uri: targetUri } });
        setDbConnected(true);
        toast.success(t('settings_ui.db.connected'));
      } else {
        setDbConnected(false);
        toast.error(testData.error || t('settings_ui.db.failed'));
      }
    } catch (err) {
      setDbConnected(false);
      toast.error(t('settings_ui.db.unreachable'));
    }
    setDbConnecting(false);
  };

  const handleVaultSetup = async () => {
    if (!vaultUri.trim()) {
      toast.error(t('settings_ui.db.enterUri'));
      return;
    }
    if (!vaultUri.startsWith('mongodb://') && !vaultUri.startsWith('mongodb+srv://')) {
      toast.error(t('settings_ui.db.invalidUri'));
      return;
    }
    if (vaultPassword.length < 8) {
      toast.error(t('settings_ui.db.passShort'));
      return;
    }
    if (vaultPassword !== vaultConfirm) {
      toast.error(t('settings_ui.db.passMismatch'));
      return;
    }

    setVaultSaving(true);
    try {
      await setupVault(vaultUri.trim(), vaultPassword);
      toast.success(t('settings_ui.db.vaultCreated'));
      setVaultUri('');
      setVaultPassword('');
      setVaultConfirm('');
    } catch (err) {
      toast.error(err.message || t('settings_ui.db.failed'));
    }
    setVaultSaving(false);
  };

  const handleSetWallpaper = (url) => {
    setWallpaper(url);
  };

  return (
    <div className="flex h-full w-full bg-[#0f172a] text-white overflow-hidden">
      {/* Sidebar */}
      <div className="w-52 border-r border-white/10 p-4 flex flex-col shrink-0 h-full overflow-y-auto custom-scrollbar">
        {/* User Profile Section */}
        <div className="mb-8 px-2">
          {session ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img 
                  src={session.user.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`} 
                  className="w-10 h-10 rounded-full border border-white/10 object-cover" 
                  alt="Avatar" 
                  onError={(e) => {
                    e.target.onerror = null; 
                    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.name)}&background=6366f1&color=fff`;
                  }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{session.user.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{session.user.email}</p>
                </div>
              </div>
              {/* Vault Status Badge */}
              <div className={`flex items-center gap-2 text-[10px] font-bold px-2 py-1 rounded-lg ${
                vaultStatus === 'unlocked' 
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : vaultStatus === 'locked' 
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-gray-500/10 text-gray-400'
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
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('common.login')}</p>
              <button 
                onClick={() => signIn('google')}
                className="w-full py-2 px-3 rounded-xl bg-white text-black text-xs font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
              >
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-3 h-3" alt="Google" />
                {t('common.login')}
              </button>
              <p className="text-[9px] text-center text-gray-500 px-1">{t('vault.setupDescription')}</p>
            </div>
          )}
        </div>

        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 px-2">{t('common.settings')}</h2>
        <div className="space-y-1">
          {[
            { id: 'appearance', label: t('settings.appearanceTitle'), icon: Palette, color: 'text-indigo-400', desc: t('settings.appearanceDesc') },
            { id: 'database', label: t('settings.databaseTitle'), icon: Database, color: 'text-purple-400', desc: t('settings.databaseDesc'), requireLogin: true },
            { id: 'display', label: t('settings_ui.display.title'), icon: Monitor, color: 'text-blue-400', desc: t('settings_ui.display.desc') },
            { id: 'notifications', label: t('settings_ui.notifications.title'), icon: Bell, color: 'text-amber-400', desc: t('settings_ui.notifications.desc') },
            { id: 'privacy', label: t('settings_ui.privacy.title'), icon: Shield, color: 'text-emerald-400', desc: t('settings_ui.privacy.desc') },
            { id: 'about', label: t('common.about'), icon: Info, color: 'text-gray-400', desc: t('settings_ui.about.desc') },
          ].map(tab => {
            const isDisabled = tab.requireLogin && !session;
            return (
              <button
                key={tab.id}
                onClick={() => !isDisabled && setActiveTab(tab.id)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : isDisabled
                    ? 'text-gray-600 cursor-not-allowed opacity-50'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <tab.icon size={16} />
                <span className="text-sm font-medium">{tab.label}</span>
                {isDisabled && (
                  <span className="ml-auto text-[8px] text-amber-400 font-bold">{t('vault.loginBtn').toUpperCase()}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto h-full p-8 pb-28 custom-scrollbar">
        {activeTab === 'appearance' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2">{t('settings.appearanceTitle')}</h1>
            <p className="text-gray-400 text-sm mb-8">{t('settings.appearanceDesc')}</p>

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
                            : 'border-white/10 hover:border-white/20'
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
                    <div className="h-28 rounded-xl bg-white/5 border border-indigo-500/50 p-2 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200">
                      <input
                        autoFocus
                        type="text"
                        placeholder="https://images.unsplash.com/..."
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-indigo-500"
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
                          className="px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold transition-colors"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="h-28 rounded-xl border-dashed border-2 border-white/10 flex flex-col items-center justify-center hover:border-white/20 transition-all cursor-pointer group hover:bg-white/5"
                      onClick={() => setShowCustomInput(true)}
                    >
                      <PlusIcon size={20} className="text-gray-500 mb-1 group-hover:text-indigo-400 transition-colors" />
                      <span className="text-[10px] text-gray-500 group-hover:text-gray-400 transition-colors">{t('settings_ui.appearance.customUrl')}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-white/10">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Layout size={16} className="text-emerald-400" />
                  {t('settings.interfaceStyle')}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div 
                    className={`p-4 rounded-xl cursor-pointer transition-all border ${
                      glassmorphism ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    } flex items-center justify-between`}
                    onClick={() => setGlassmorphism(true)}
                  >
                    <div>
                      <span className="block text-sm font-medium">{t('settings_ui.appearance.glassmorphism')}</span>
                      <span className="text-[10px] text-gray-500">{t('settings_ui.appearance.glassmorphismDesc')}</span>
                    </div>
                    {glassmorphism && (
                      <div className="w-10 h-5 bg-indigo-600 rounded-full relative">
                        <div className="absolute top-1 right-1 w-3 h-3 bg-white rounded-full shadow-lg" />
                      </div>
                    )}
                  </div>
                  <div 
                    className={`p-4 rounded-xl cursor-pointer transition-all border ${
                      !glassmorphism ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    } flex items-center justify-between`}
                    onClick={() => setGlassmorphism(false)}
                  >
                    <div>
                      <span className="block text-sm font-medium">{t('settings_ui.appearance.opaqueMode')}</span>
                      <span className="text-[10px] text-gray-500">{t('settings_ui.appearance.opaqueModeDesc')}</span>
                    </div>
                    {!glassmorphism && (
                      <div className="w-10 h-5 bg-indigo-600 rounded-full relative">
                        <div className="absolute top-1 right-1 w-3 h-3 bg-white rounded-full shadow-lg" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-white/10">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Layout size={16} className="text-purple-400" />
                  {t('settings_ui.appearance.iconStyle')}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
                      className={`p-3 rounded-xl border transition-all text-left ${
                        osState.iconStyle === style.id 
                          ? 'bg-indigo-500/20 border-indigo-500/50 shadow-lg shadow-indigo-500/10' 
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <span className="block text-[11px] font-bold">{t(`settings_ui.appearance.styles.${style.id}`)}</span>
                      <span className="text-[9px] text-gray-500 leading-tight">{t(`settings_ui.appearance.styles.${style.id}Desc`)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-white/10">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Monitor size={16} className="text-blue-400" />
                  {t('settings_ui.appearance.language')}
                </h3>
                <div className="flex gap-4">
                  {[
                    { code: 'en', label: 'English', sub: 'USA' },
                    { code: 'th', label: 'ภาษาไทย', sub: 'TH' },
                    { code: 'cn', label: '简体中文', sub: 'CN' },
                  ].map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`flex-1 p-4 rounded-xl border transition-all text-left ${
                        i18n.language === lang.code 
                          ? 'bg-indigo-500/20 border-indigo-500/50' 
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <span className="block text-sm font-bold truncate">{lang.label}</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-widest">{lang.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
        
        {activeTab === 'display' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2">{t('settings_ui.display.title')}</h1>
            <p className="text-gray-400 text-sm mb-8">{t('settings_ui.display.desc')}</p>

            <section className="space-y-8">
              {/* Actual Brightness Control */}
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Zap size={16} className="text-yellow-400" />
                    {t('settings_ui.display.brightness')}
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">{brightness}%</span>
                </div>
                <input 
                  type="range"
                  min="30"
                  max="100"
                  value={brightness}
                  onChange={(e) => setBrightness(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-500 mb-6"
                />
                <div className="p-3 bg-black/20 rounded-xl border border-white/5 flex items-center gap-3">
                   <Info size={14} className="text-gray-500" />
                   <p className="text-[10px] text-gray-500 italic">{t('settings_ui.display.brightnessDesc')}</p>
                </div>
              </div>

              {/* UI Scaling (Realistic Resolution Replacement) */}
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">{t('settings_ui.display.interfaceScaling')}</h4>
                <div className="grid grid-cols-3 gap-3">
                   {[75, 100, 125].map(scale => (
                     <button 
                       key={scale} 
                       onClick={() => {
                         setUiScale(scale);
                         toast.success(t('settings_ui.display.scalingSet', { scale }));
                       }}
                       className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                         uiScale === scale 
                           ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' 
                           : 'bg-white/5 border-white/5 text-gray-500 hover:text-white hover:bg-white/10'
                       }`}
                     >
                       {scale}%
                     </button>
                   ))}
                </div>
                <p className="mt-4 text-[11px] text-gray-500">{t('settings_ui.display.scalingInfo')}</p>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2">{t('settings_ui.notifications.title')}</h1>
            <p className="text-gray-400 text-sm mb-8">{t('settings_ui.notifications.desc')}</p>

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
                     className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group hover:bg-white/[0.07] transition-all"
                   >
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-indigo-500/10 transition-colors">
                          <item.icon size={20} className={isActive ? 'text-indigo-400' : 'text-gray-500'} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-gray-200">{item.title}</h4>
                          <p className="text-xs text-gray-500 italic">{item.desc}</p>
                        </div>
                     </div>
                     <div 
                        onClick={() => setNotifications({ [item.id]: !isActive })}
                        className={`w-11 h-6 rounded-full p-1 transition-colors cursor-pointer ${isActive ? 'bg-indigo-600' : 'bg-gray-700'}`}
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
            <h1 className="text-2xl font-bold mb-2">{t('settings_ui.privacy.title')}</h1>
            <p className="text-gray-400 text-sm mb-8">{t('settings_ui.privacy.desc')}</p>

            <section className="space-y-6">
              <div className="p-6 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-white/10 rounded-3xl relative overflow-hidden group">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-700" />
                <div className="relative z-10 flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-xl shadow-indigo-500/20">
                    <Shield size={24} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white mb-1">{t('settings_ui.privacy.dashboard')}</h3>
                    <p className="text-sm text-gray-300 leading-relaxed mb-4">
                      {t('settings_ui.privacy.dashboardDesc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase text-gray-300 border border-white/10">{t('settings_ui.privacy.zeroKnowledge')}</span>
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase text-gray-300 border border-white/10">{t('settings_ui.privacy.clientSideEncryption')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-3">
                    <Info size={16} className="text-indigo-400" />
                    <p className="text-xs text-gray-400 font-medium">{t('settings_ui.privacy.autoHandled')}</p>
                  </div>
               </div>
            </section>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-2xl font-bold mb-2">{t('settings.databaseTitle')}</h1>
            <p className="text-gray-400 text-sm mb-8">{t('settings.databaseDesc')}</p>

            {dbLoading ? (
              <div className="flex items-center gap-3 text-gray-400 py-12">
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
                              toast.success(t('settings_ui.db.vaultLocked'));
                            }}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-gray-300 flex items-center gap-1.5 transition-colors"
                          >
                            <Lock size={12} /> {t('settings_ui.db.lock')}
                          </button>
                        </>
                      ) : vaultStatus === 'locked' ? (
                        <>
                          <Lock size={18} className="text-amber-400" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-amber-400">{t('settings_ui.vaultStatus.locked')}</span>
                            <p className="text-[11px] text-amber-400/60">{t('vault.unlockDescription')}</p>
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
                          <Shield size={18} className="text-indigo-400" />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-indigo-400">{t('settings_ui.vaultStatus.none')}</span>
                            <p className="text-[11px] text-indigo-400/60">{t('vault.setupDescription')}</p>
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
                      <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                        <h3 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-2">
                          <Database size={14} className="text-emerald-400" />
                          {t('settings_ui.db.activeDb')}
                        </h3>
                        <code className="text-xs text-emerald-400/70 font-mono break-all">
                          {decryptedUri.replace(/:([^@]+)@/, ':••••••@')}
                        </code>
                      </div>
                    )}

                    {/* Vault Actions */}
                    {vaultStatus === 'unlocked' && (
                      <div className="flex gap-3">
                        <button
                          onClick={async () => {
                            if (!confirm(t('settings_ui.db.deleteConfirm'))) return;
                            await clearVault();
                            dispatch({ type: 'SET_DB_CONFIG', payload: { uri: '' } });
                            toast.success(t('settings_ui.db.vaultCleared'));
                          }}
                          className="text-xs text-red-400/70 hover:text-red-400 font-medium px-4 py-2 rounded-xl bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 transition-all flex items-center gap-2"
                        >
                          <Trash2 size={13} />
                          {t('settings_ui.db.deleteVault')}
                        </button>
                      </div>
                    )}

                    {/* Security Info */}
                    <div className="p-6 bg-indigo-500/[0.03] border border-indigo-500/10 rounded-2xl">
                      <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4">{t('common.security')} & {t('common.privacy')}</h4>
                      <div className="space-y-4">
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                            <Key size={16} className="text-indigo-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-200 mb-1">{t('vault.masterPassword')}</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                              {t('vault.privacyDesc')}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <Shield size={16} className="text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-200 mb-1">{t('settings_ui.db.sessionOnlyMemory')}</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                              {t('settings_ui.db.sessionOnlyMemoryDesc')}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                            <Mail size={16} className="text-amber-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-200 mb-1">{t('settings_ui.db.emailRecovery')}</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
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
                          <WifiOff size={18} className="text-amber-400" />
                          <div>
                            <span className="text-sm font-medium text-amber-400">{t('settings_ui.db.notConnected')}</span>
                            <p className="text-[11px] text-amber-400/60">{t('settings_ui.db.notConnectedDesc')}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Connection URI */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Database size={16} className="text-indigo-400" />
                        {t('settings_ui.db.mongoDbUri')}
                      </h3>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                          placeholder="mongodb://127.0.0.1:27017/ssh-monitor"
                          value={dbUri}
                          onChange={(e) => setDbUri(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                        />
                        <button
                          onClick={handleConnect}
                          disabled={dbConnecting || !dbUri.trim()}
                          className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap shadow-lg ${
                            dbConnecting
                              ? 'bg-indigo-600/50 text-white/50 cursor-wait'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20'
                          }`}
                        >
                          {dbConnecting ? (
                            <><Loader size={14} className="animate-spin" /> {t('settings_ui.db.connecting')}</>
                          ) : (
                            <><Zap size={14} /> {t('settings_ui.db.connect')}</>
                          )}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-2">
                        {t('settings_ui.db.example')}: <code className="text-indigo-400/70">mongodb://127.0.0.1:27017/ssh-monitor</code>
                      </p>
                    </div>

                    {/* Quick Presets */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-gray-400">{t('settings_ui.db.quickPresets')}</h3>
                      <div className="flex flex-wrap gap-2">
                        {PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => setDbUri(preset.uri)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              dbUri === preset.uri 
                                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' 
                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
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

        {activeTab === 'about' && (
          <div className="max-w-md mx-auto py-12 text-center animate-in zoom-in-95 duration-300">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl shadow-2xl flex items-center justify-center mb-6">
              <Monitor size={48} className="text-white drop-shadow-lg" />
            </div>
            <h2 className="text-2xl font-bold mb-1">Webtop OS</h2>
            <p className="text-indigo-400 text-sm font-medium mb-6">{t('settings_ui.about.version', { version: '1.0.5 (Beta)' })}</p>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 text-sm text-gray-400 leading-relaxed text-left">
              <p className="mb-4 text-xs">{t('settings_ui.about.description')}</p>
              
              <div className="space-y-4">
                {/* Environment Info */}
                <div className="space-y-2">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="font-medium text-gray-300">{t('settings_ui.about.environment')}</span>
                    <span>{t('settings_ui.about.environmentValue')}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="font-medium text-gray-300">{t('settings_ui.about.resolution')}</span>
                    <span>{typeof window !== 'undefined' ? `${window.innerWidth} x ${window.innerHeight}` : 'N/A'}</span>
                  </div>
                </div>

                {/* Security Engineering Section */}
                <div>
                  <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3">{t('settings_ui.about.securityEng')}</h4>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-center gap-2 bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-2">
                      <Shield size={12} className="text-indigo-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-300 uppercase">{t('settings_ui.about.keyDerivation')}</p>
                        <p className="text-[10px] text-gray-500">{t('settings_ui.about.keyDerivationValue')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2">
                      <Lock size={12} className="text-emerald-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-300 uppercase">{t('settings_ui.about.encryption')}</p>
                        <p className="text-[10px] text-gray-500">{t('settings_ui.about.encryptionValue')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2">
                      <Code size={12} className="text-amber-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-300 uppercase">{t('settings_ui.about.defense')}</p>
                        <p className="text-[10px] text-gray-500">{t('settings_ui.about.defenseValue')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2 border-t border-white/5">
                  <span className="font-medium text-gray-300">{t('settings_ui.about.license')}</span>
                  <span>{t('settings_ui.about.licenseValue')}</span>
                </div>
              </div>
            </div>
            <p className="mt-8 text-[10px] text-gray-600 italic">{t('settings_ui.about.quote')}</p>
          </div>
        )}
      </div>
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
