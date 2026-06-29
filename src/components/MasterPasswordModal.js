'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import {
  Lock, Unlock, Shield, Key, Eye, EyeOff,
  Mail, AlertTriangle, CheckCircle, Loader,
  Database, ArrowRight, RefreshCw, Zap,
  HelpCircle, ChevronDown, ChevronUp, Monitor, Network,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import { useIsMobile } from '@/hooks/useIsMobile';

// Floating particles background (disabled on mobile for performance)
function Particles({ count = 30, color = 'rgba(99,102,241,0.15)' }) {
  const isMobile = useIsMobile();
  const particles = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      duration: Math.random() * 15 + 10,
      delay: Math.random() * 5,
    })),
    [count]
  );
  if (isMobile) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: color,
            boxShadow: `0 0 ${p.size * 3}px ${color}`,
          }}
          animate={{
            y: [0, -30, 0],
            x: [0, Math.random() * 20 - 10, 0],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

const PRESETS = [
  { label: 'MongoDB', uri: 'mongodb://localhost:27017/ssh-monitor' },
  { label: 'MySQL', uri: 'mysql://root:password@127.0.0.1:3306/db' },
  { label: 'PostgreSQL', uri: 'postgres://postgres:password@127.0.0.1:5432/db' },
];

/**
 * MasterPasswordModal
 * 
 * Shows when the vault needs to be unlocked or set up.
 * Handles 3 flows:
 * 1. SETUP: First-time vault configuration (URI + Master Password)
 * 2. UNLOCK: Enter Master Password to decrypt
 * 3. RECOVERY: Forgot password → email code → reset vault
 */
export default function MasterPasswordModal({ isBooted = true }) {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const {
    vaultStatus, unlockVault, setupVault,
    requestRecovery, verifyRecovery, error: vaultError,
    hasLegacyUri, legacyUri, dismissVault, isDismissed
  } = useVault();
  const { addNotification } = useOS();

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState('unlock'); // unlock, setup, recovery, verify
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mongoUri, setMongoUri] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRelayReminder, setShowRelayReminder] = useState(false);
  const [pendingSetup, setPendingSetup] = useState(null); // stores { uri, tunnelConfig } when relay reminder is shown
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [faqOpen, setFaqOpen] = useState(null); // which FAQ index is open
  const [relayConnected, setRelayConnected] = useState(false);

  // Check relay status once on mount
  useEffect(() => {
    if (!session) return;
    fetch('/api/relay/token')
      .then(r => r.json())
      .then(d => { if (d.success) setRelayConnected(d.connected); })
      .catch(() => {});
  }, [session]);

  // SSH Tunnel state (for vault setup)
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelHost, setTunnelHost] = useState('');
  const [tunnelPort, setTunnelPort] = useState(22);
  const [tunnelUser, setTunnelUser] = useState('');
  const [tunnelAuth, setTunnelAuth] = useState('password');
  const [tunnelPassword, setTunnelPassword] = useState('');
  const [tunnelKey, setTunnelKey] = useState('');
  const [tunnelPassphrase, setTunnelPassphrase] = useState('');

  const inputRef = useRef(null);

  useEffect(() => {
    if (isBooted) {
      setMounted(true);
    }
  }, [isBooted]);

  // Auto-set mode based on vault status
  useEffect(() => {
    if (vaultStatus === 'setup') {
      setMode('setup');
      if (hasLegacyUri && legacyUri) {
        setMongoUri(legacyUri);
      }
    }
    else if (vaultStatus === 'locked') setMode('unlock');
  }, [vaultStatus, hasLegacyUri, legacyUri]);

  // Auto-focus
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [mode]);

  // Don't show if not needed
  if (!mounted || vaultStatus === 'unlocked' || vaultStatus === 'no_auth' || vaultStatus === 'loading' || isDismissed) {
    return null;
  }

  const triggerShake = () => {
    setShakeKey(k => k + 1);
  };

  // === UNLOCK HANDLER ===
  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!masterPassword) return;
    setLoading(true);
    setError('');

    try {
      await unlockVault(masterPassword);
      addNotification({ title: t('common.success'), message: t('vault.toasts.unlocked'), type: 'success' });
    } catch (err) {
      setError(err.message || t('vault.errors.unlockFailed'));
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // === SETUP HANDLER ===
  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');

    if (!mongoUri.trim()) {
      setError('Please enter your MongoDB URI');
      return;
    }
    const uri = mongoUri.trim();
    const allowed = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowed.some(p => uri.startsWith(p));

    if (!isValid) {
      setError('Unsupported database protocol');
      return;
    }
    if (masterPassword.length < 8) {
      setError('Master Password must be at least 8 characters');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      triggerShake();
      return;
    }

    // If URI targets localhost, remind about Local Relay Agent
    // This applies to ALL protocols (MongoDB, PostgreSQL, MySQL) when targeting localhost
    const isLocalhost = /localhost|127\.0\.0\.1/.test(uri);
    const needsRelay = true; // all localhost DBs need relay when app is on remote server
    if (isLocalhost && !relayConnected && needsRelay) {
      setError('');
      setPendingSetup({ uri, tunnelConfig: null });
      setShowRelayReminder(true);
      return;
    }

    await continueSetup(uri, null);
  };

  const continueSetup = async (uri, tunnelConfig, skipTest = false) => {
    setLoading(true);
    try {
      if (!skipTest) {
        // First test the URI (with tunnel if configured)
        const testHeaders = { 'Content-Type': 'application/json' };
        if (tunnelConfig) testHeaders['x-vault-tunnel'] = JSON.stringify(tunnelConfig);

        const testRes = await fetch('/api/connections/test-uri', { 
          method: 'POST',
          headers: testHeaders,
          body: JSON.stringify({ uri })
        });
        const testData = await testRes.json();
        if (!testData.success) {
          // If relay is required, show relay reminder instead of a generic error
          if (testData.relayRequired) {
            setPendingSetup({ uri, tunnelConfig });
            setShowRelayReminder(true);
            setLoading(false);
            return;
          }
          setError(testData.error || t('vault.errors.connectionFailed'));
          setLoading(false);
          return;
        }
      }

      await setupVault(uri, masterPassword, tunnelConfig);
      addNotification({ title: t('common.success'), message: t('vault.toasts.created'), type: 'success' });
    } catch (err) {
      setError(err.message || 'Setup failed');
    }
    setLoading(false);
  };

  // === RECOVERY HANDLER ===
  const handleRequestRecovery = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await requestRecovery();
      if (data.success) {
        setRecoveryEmail(data.maskedEmail);
        setMode('verify');
        addNotification({ title: t('vault.recovery.title'), message: t('vault.toasts.recoverySent', { email: data.maskedEmail }), type: 'info' });
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to send recovery email');
    }
    setLoading(false);
  };

  // === VERIFY RECOVERY CODE ===
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (recoveryCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await verifyRecovery(recoveryCode);
      if (data.success) {
        addNotification({ title: t('vault.toasts.resetComplete'), message: t('vault.toasts.resetComplete'), type: 'success' });
        setMode('setup');
        setMasterPassword('');
        setConfirmPassword('');
        setRecoveryCode('');
      } else {
        setError(data.error);
        triggerShake();
      }
    } catch (err) {
      setError('Verification failed');
    }
    setLoading(false);
  };

  // FAQ items
  const faqItems = [
    { q: t('vault.faq.q1'), a: t('vault.faq.a1') },
    { q: t('vault.faq.q2'), a: t('vault.faq.a2') },
    { q: t('vault.faq.q3'), a: t('vault.faq.a3') },
  ];

  const renderContent = () => {
    switch (mode) {
      case 'unlock': return renderUnlock();
      case 'setup': return renderSetup();
      case 'recovery': return renderRecovery();
      case 'verify': return renderVerify();
    }
  };

  // === FAQ Section ===
  const renderFAQ = () => (
    <div className="mt-8 border-t border-[var(--border-color)] pt-6 relative">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-full text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[2px] whitespace-nowrap shadow-xl">
        Security Knowledge
      </div>

      <button
        type="button"
        onClick={() => setFaqOpen(faqOpen === -1 ? null : -1)}
        className="group flex items-center justify-between w-full px-4 py-3 bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)]/80 border border-[var(--border-color)] rounded-2xl transition-all duration-300"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-indigo)]/10 flex items-center justify-center text-[var(--accent-indigo)] group-hover:bg-[var(--accent-indigo)]/20 transition-colors">
            <HelpCircle size={16} />
          </div>
          <div className="text-left">
            <span className="block text-[13px] font-bold text-[var(--text-primary)] tracking-tight">{t('vault.faq.title')}</span>
            <span className="block text-[10px] text-[var(--text-muted)] font-medium">{t('vault.faq.subtitle')}</span>
          </div>
        </div>
        <div className={`p-1.5 rounded-full bg-white/5 transition-transform duration-300 ${faqOpen !== null ? 'rotate-180' : ''}`}>
          <ChevronDown size={14} className="text-slate-400" />
        </div>
      </button>

      <AnimatePresence>
        {faqOpen !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: 'auto', opacity: 1, marginTop: 16 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3">
              {faqItems.map((item, i) => (
                <motion.div 
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  key={i} 
                  className={`rounded-2xl border transition-all duration-300 ${
                    faqOpen === i 
                      ? 'bg-[var(--bg-primary)] border-[var(--accent-indigo)]/30 shadow-[0_0_20px_rgba(99,102,241,0.05)]' 
                      : 'bg-[var(--bg-secondary)]/30 border-[var(--border-color)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left group"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${faqOpen === i ? 'bg-[var(--accent-indigo)] scale-125 shadow-[0_0_8px_var(--glow-indigo)]' : 'bg-[var(--text-muted)]'}`} />
                    <span className={`flex-1 text-[12px] font-bold tracking-tight transition-colors ${faqOpen === i ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>
                      {item.q}
                    </span>
                    <div className={`transition-transform duration-300 ${faqOpen === i ? 'rotate-180' : ''}`}>
                      <ChevronDown size={14} className={faqOpen === i ? 'text-indigo-400' : 'text-slate-500'} />
                    </div>
                  </button>
                  <AnimatePresence>
                    {faqOpen === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pl-[34px]">
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-medium">
                            {item.a}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // === UNLOCK VIEW ===
  const renderUnlock = () => (
    <form onSubmit={handleUnlock} className="space-y-6 px-2 py-4 relative overflow-hidden">
      {/* Background Effects */}
      {!isMobile && <Particles count={25} color="rgba(99,102,241,0.12)" />}
      {!isMobile && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none animate-pulse" />}
      {!isMobile && <div className="absolute bottom-0 right-0 w-48 h-48 bg-indigo-500/8 blur-[80px] rounded-full pointer-events-none" />}
      
      <div className="text-center relative z-10">
        {isMobile ? (
          <div className="relative inline-block mb-6">
            <div className="relative w-20 h-20 bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-2xl flex items-center justify-center shadow-2xl mx-auto">
              <Lock size={32} className="text-[var(--accent-indigo)]" />
            </div>
          </div>
        ) : (
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, type: 'spring', bounce: 0.3 }}
            className="relative inline-block mb-6"
          >
            <motion.div 
              className="absolute inset-0 rounded-2xl"
              animate={{ 
                boxShadow: [
                  '0 0 20px rgba(99,102,241,0.2), 0 0 40px rgba(99,102,241,0.1)',
                  '0 0 30px rgba(99,102,241,0.3), 0 0 60px rgba(99,102,241,0.15)',
                  '0 0 20px rgba(99,102,241,0.2), 0 0 40px rgba(99,102,241,0.1)',
                ]
              }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/30 to-indigo-500/30 blur-xl" />
            <div className="relative w-20 h-20 bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-2xl flex items-center justify-center shadow-2xl overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-tr from-[var(--accent-indigo)]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <motion.div
                animate={{ rotate: [0, -8, 8, -4, 0], scale: [1, 1.05, 1] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Lock size={32} className="text-[var(--accent-indigo)] drop-shadow-[0_0_12px_var(--glow-indigo)]" />
              </motion.div>
            </div>
          </motion.div>
        )}
        
        <h2 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] mb-2">
          {t('vault.locked') || 'Secured Vault'}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm max-w-[280px] mx-auto leading-relaxed">
          {t('vault.unlockNow') || 'Your connection data is securely encrypted. Enter your master password to access.'}
        </p>
        
        {!session && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-full text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            <Monitor size={10} className="text-[var(--accent-indigo)]" /> {t('vault.guestMode') || 'Guest Mode'}
          </div>
        )}
      </div>

      <div className="space-y-4 relative z-10">
        <motion.div 
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="group relative"
        >
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/50 to-indigo-500/50 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
          <div className="relative">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder={t('vault.masterPassword') || 'Master Password'}
              className="w-full px-4 py-3.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-0 focus:border-blue-500/40 transition-all text-base shadow-inner pointer-events-auto relative z-10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </motion.div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10, opacity: 0 }}
            animate={{ x: [0, -12, 12, -6, 6, 0], opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 shadow-lg backdrop-blur-md"
            style={{ boxShadow: '0 0 20px rgba(244,63,94,0.15)' }}
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}

        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <button
            type="submit"
            disabled={loading || !masterPassword}
            className="w-full py-4 px-6 relative group overflow-hidden rounded-xl bg-blue-600 font-bold text-white text-base shadow-[0_8px_30px_rgb(37,99,235,0.4)] hover:shadow-[0_8px_40px_rgb(37,99,235,0.6)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-600 transition-all group-hover:scale-105" />
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center justify-center gap-3">
              {loading ? (
                <><Loader size={20} className="animate-spin" /> {t('vault.unlocking') || 'Authorizing...'}</>
              ) : (
                <><Unlock size={20} /> {t('vault.unlockVault') || 'Unlock & Access Dashboard'}</>
              )}
            </div>
          </button>
        </motion.div>

        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); }}
            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--accent-indigo)] transition-colors py-1"
          >
            {t('vault.forgotPassword') || 'Forgot Master Password?'}
          </button>

          <button
            type="button"
            onClick={dismissVault}
            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors py-1"
          >
            {t('vault.unlockLater') || 'Use Manual Mode'}
          </button>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="relative z-10">
        {renderFAQ()}
      </div>
    </form>
  );

  // === SETUP VIEW ===
  const renderSetup = () => (
    <form onSubmit={handleSetup} className="space-y-6 px-2 py-4 relative overflow-hidden">
      {!isMobile && <Particles count={20} color="rgba(52,211,153,0.12)" />}
      {!isMobile && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none animate-pulse" />}

      <div className="text-center relative z-10">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, type: 'spring', bounce: 0.3 }}
          className="relative inline-block mb-4"
        >
          <motion.div 
            className="absolute inset-0 rounded-2xl"
            animate={{ 
              boxShadow: [
                '0 0 20px rgba(52,211,153,0.2), 0 0 40px rgba(52,211,153,0.1)',
                '0 0 30px rgba(52,211,153,0.3), 0 0 60px rgba(52,211,153,0.15)',
                '0 0 20px rgba(52,211,153,0.2), 0 0 40px rgba(52,211,153,0.1)',
              ]
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-emerald-500/30 to-teal-500/30 blur-xl" />
          <div className="relative w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl">
            <Shield size={28} className="text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
          </div>
        </motion.div>
        
        <motion.h2 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] mb-1"
        >
          {session ? (t('vault.setupVault') || 'Initialize Secure Vault') : (t('vault.localVault') || 'Local Vault Setup')}
        </motion.h2>
        <motion.p 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[var(--text-secondary)] text-sm max-w-[320px] mx-auto leading-relaxed"
        >
          {t('vault.setupDescription') || 'Set up your private database and master password to start encrypting your connections.'}
        </motion.p>
      </div>

      <div className="space-y-4 relative z-10">
        {/* Database URI */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">
             {mongoUri.includes('mysql') ? 'MySQL Connection' : mongoUri.includes('postgres') ? 'PostgreSQL Connection' : (t('vault.mongoUri') || 'MongoDB Connection URI')}
          </label>
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
            <input
              ref={inputRef}
              type="text"
              value={mongoUri}
              onChange={(e) => setMongoUri(e.target.value)}
              placeholder="mongodb://user:pass@host:27017/db"
              className="w-full px-4 py-3 bg-[var(--bg-primary)]/80 border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-all text-xs font-mono shadow-inner pointer-events-auto relative z-10"
            />
          </div>
          
          <div className="flex flex-wrap gap-2 pt-1">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setMongoUri(preset.uri)}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all backdrop-blur-sm"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Master Password */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest ml-1">
            {t('vault.masterPassword') || 'Choose Master Password'}
          </label>
          <div className="relative group">
             <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
             <input
              inputMode="text"
              type={showPassword ? 'text' : 'password'}
               value={masterPassword}
               onChange={(e) => setMasterPassword(e.target.value)}
               placeholder={t('vault.atLeast8') || 'Minimum 8 strong characters'}
               className="w-full px-4 py-3 bg-[var(--bg-primary)]/80 border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-all text-sm shadow-inner pointer-events-auto relative z-10"
               autoComplete="new-password"
             />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          
          {/* Password strength */}
          {masterPassword && (
            <div className="mt-2 px-1 flex gap-1.5">
              {[1, 2, 3, 4].map(level => (
                <div
                  key={level}
                  className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                    masterPassword.length >= level * 3
                      ? level <= 1 ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' 
                      : level <= 2 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' 
                      : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                      : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('vault.confirmPassword') || 'Confirm Master Password'}
            className="w-full px-4 py-3 bg-[var(--bg-primary)]/80 border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-all text-sm shadow-inner pointer-events-auto relative z-10"
            autoComplete="new-password"
          />
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10, opacity: 0 }}
            animate={{ x: [0, -8, 8, -4, 4, 0], opacity: 1 }}
            className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 backdrop-blur-md"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={dismissVault}
            className="flex-1 py-4 px-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-bold transition-all backdrop-blur-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !mongoUri || !masterPassword || !confirmPassword}
            className="flex-[2] py-4 px-6 relative group overflow-hidden rounded-xl bg-emerald-600 font-bold text-white text-sm shadow-[0_8px_30px_rgb(16,185,129,0.3)] hover:shadow-[0_8px_40px_rgb(16,185,129,0.5)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-600 transition-all group-hover:scale-105" />
            <div className="relative flex items-center justify-center gap-2">
               {loading ? (
                <><Loader size={16} className="animate-spin" /> {hasLegacyUri ? (t('vault.migrating') || 'Migrating...') : (t('vault.encrypting') || 'Encrypting...')}</>
              ) : (
                <><Shield size={16} /> {hasLegacyUri ? (t('vault.secureNow') || 'Complete Migration') : (t('vault.createVault') || 'Initialize Vault')}</>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Security Info Card */}
      <div className="relative group">
        <div className="absolute inset-0 bg-[var(--accent-indigo)]/5 blur-xl group-hover:bg-[var(--accent-indigo)]/10 transition-colors pointer-events-none" />
        <div className="relative p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-2xl flex items-start gap-3 backdrop-blur-md">
          <Shield size={18} className="text-[var(--accent-indigo)] mt-1 shrink-0" />
          <div className="space-y-1">
             <h4 className="text-[11px] font-bold text-[var(--accent-indigo)] uppercase tracking-wider">{t('vault.privacyFirstTitle')}</h4>
             <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-medium">
               {t('vault.privacyFirstDesc')}
             </p>
          </div>
        </div>
      </div>

      {renderFAQ()}

      {/* Local Relay Reminder Modal */}
      <AnimatePresence>
        {showRelayReminder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-2xl"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              className="mx-4 bg-[var(--bg-secondary)] border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-2xl max-w-sm w-full"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Zap size={18} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[var(--text-primary)]">{t('vault.relay.reminderTitle')}</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    {t('vault.relay.reminderDesc').split('localhost').map((part, i, arr) =>
                      i < arr.length - 1
                        ? [part, <span key={i} className="font-mono text-amber-400">localhost</span>]
                        : part
                    )}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl text-[11px] text-amber-300/80 leading-relaxed">
                {t('vault.relay.reminderHint')}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowRelayReminder(false);
                    setPendingSetup(null);
                    dismissVault();
                    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'database' }));
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-all"
                >
                  {t('vault.relay.setupRelay')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowRelayReminder(false);
                    if (pendingSetup) await continueSetup(pendingSetup.uri, pendingSetup.tunnelConfig, true);
                    setPendingSetup(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-bold transition-all"
                >
                  {t('vault.relay.continueAnyway')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );

  // === RECOVERY VIEW ===
  const renderRecovery = () => (
    <div className="space-y-6 px-2 py-4 relative">
       <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/10 blur-[80px] rounded-full pointer-events-none" />
       
      <div className="text-center relative z-10">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative inline-block mb-4"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-amber-500/30 to-orange-500/30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl">
            <Mail size={28} className="text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.5)]" />
          </div>
        </motion.div>
        
        <h2 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] mb-1">
          {t('vault.recovery.title') || 'Account Recovery'}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm max-w-[300px] mx-auto leading-relaxed">
          {t('vault.recovery.desc') || 'We will send a 6-digit verification code to your registered email address to reset the vault access.'}
        </p>
      </div>

      <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl relative z-10 backdrop-blur-md">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h4 className="text-[11px] font-bold text-rose-500 uppercase tracking-widest">{t('vault.recovery.warning') || 'Critical Warning'}</h4>
            <p className="text-[11px] text-rose-500/80 leading-relaxed font-semibold">
               {t('vault.recovery.warningDetail') || 'Resetting your vault will delete all existing encrypted connections if you cannot provide the original master password. Use this as a last resort.'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 backdrop-blur-md">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <div className="flex gap-4 pt-2 relative z-10">
        <button
          onClick={() => { setMode('unlock'); setError(''); }}
          className="flex-1 py-4 px-4 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-bold transition-all backdrop-blur-sm"
        >
          {t('vault.recovery.back') || 'Go Back'}
        </button>
        <button
          onClick={handleRequestRecovery}
          disabled={loading}
          className="flex-[2] py-4 px-6 relative group overflow-hidden rounded-xl bg-amber-600 font-bold text-white text-sm shadow-[0_8px_30px_rgb(245,158,11,0.3)] hover:shadow-[0_8px_40px_rgb(245,158,11,0.5)] active:scale-[0.98] transition-all disabled:opacity-50"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500 to-orange-600 transition-all group-hover:scale-105" />
          <div className="relative flex items-center justify-center gap-2">
            {loading ? (
              <><Loader size={16} className="animate-spin" /> {t('vault.recovery.sending') || 'Requesting...'}</>
            ) : (
              <><Mail size={16} /> {t('vault.recovery.sendCode') || 'Request Recovery Code'}</>
            )}
          </div>
        </button>
      </div>
    </div>
  );

  // === VERIFY CODE VIEW ===
  const renderVerify = () => (
    <form onSubmit={handleVerifyCode} className="space-y-6 px-2 py-4 relative">
       <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full pointer-events-none" />

      <div className="text-center relative z-10">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative inline-block mb-4"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/30 to-cyan-500/30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl">
            <CheckCircle size={28} className="text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
          </div>
        </motion.div>
        
        <h2 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] mb-1">
          {t('vault.verify.title') || 'Verify Ownership'}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm max-w-[300px] mx-auto leading-relaxed">
          {t('vault.verify.sentTo') || 'Verification code sent to:'} <br/>
          <span className="text-[var(--accent-indigo)] font-bold uppercase tracking-wider">{recoveryEmail}</span>
        </p>
      </div>

      <div className="space-y-6 relative z-10">
        <div className="relative group">
          <div className="absolute -inset-1 bg-[var(--accent-indigo)]/20 rounded-2xl blur opacity-100" />
          <input
            ref={inputRef}
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="relative w-full px-6 py-6 bg-[var(--bg-primary)]/90 border border-[var(--border-color)] rounded-2xl text-[var(--text-primary)] text-center text-4xl font-black tracking-[12px] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)]/50 transition-all shadow-inner pointer-events-auto z-10"
            autoComplete="one-time-code"
          />
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10, opacity: 0 }}
            animate={{ x: [0, -8, 8, -4, 4, 0], opacity: 1 }}
            className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 backdrop-blur-md"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}

        <div className="flex gap-4 pt-1">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); setRecoveryCode(''); }}
            className="flex-1 py-4 px-4 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-bold transition-all backdrop-blur-sm"
          >
            {t('vault.recovery.back') || 'Go Back'}
          </button>
          <button
            type="submit"
            disabled={loading || recoveryCode.length !== 6}
            className="flex-[2] py-4 px-6 relative group overflow-hidden rounded-xl bg-blue-600 font-bold text-white text-sm shadow-[0_8px_30px_rgb(37,99,235,0.3)] hover:shadow-[0_8px_40px_rgb(37,99,235,0.5)] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-600 transition-all group-hover:scale-105" />
            <div className="relative flex items-center justify-center gap-2">
              {loading ? (
                <><Loader size={16} className="animate-spin" /> {t('vault.verify.verifying') || 'Verifying...'}</>
              ) : (
                <><CheckCircle size={16} /> {t('vault.verify.verifyReset') || 'Confirm Verification'}</>
              )}
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={handleRequestRecovery}
          disabled={loading}
          className="w-full py-1 text-[var(--text-muted)] hover:text-[var(--accent-indigo)] text-xs font-bold transition-colors flex items-center justify-center gap-2 uppercase tracking-widest"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {t('vault.verify.resend') || 'Resend verification code'}
        </button>
      </div>
    </form>
  );

  const getWindowTitle = () => {
    switch (mode) {
      case 'unlock': return { title: t('vault.locked') || 'Security', icon: Lock };
      case 'setup': return { title: t('vault.setupVault') || 'Setup Vault', icon: Shield };
      case 'recovery': return { title: t('vault.recovery.title') || 'Recovery', icon: Mail };
      case 'verify': return { title: t('vault.verify.title') || 'Verify', icon: CheckCircle };
      default: return { title: 'Security', icon: Shield };
    }
  };

  const { title, icon } = getWindowTitle();

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 flex items-end"
        style={{ background: 'rgba(0,0,0,0.5)', zIndex: 90000 }}
      >
        <div
          className="w-full max-h-[92vh] flex flex-col overflow-hidden rounded-t-2xl"
          style={{ background: 'var(--window-bg)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              {icon && <span>{icon}</span>}
              <span>{title}</span>
            </div>
            <button
              type="button"
              onClick={() => dismissVault?.()}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <X size={18} className="text-[var(--text-secondary)]" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {renderContent()}
          </div>
        </div>
      </div>
    );
  }

  return createPortal(
    <MacOSModalWindow
      isOpen
      title={title}
      icon={icon}
      draggable={true}
      resizable={true}
      defaultWidth={500}
      defaultHeight={620}
      minWidth={450}
      minHeight={550}
      onClose={() => dismissVault?.()}
      zIndexClassName="z-[90000]"
      contentClassName="p-4"
      closeOnOverlayClick={false}
    >
      {renderContent()}
    </MacOSModalWindow>,
    document.body
  );
}
