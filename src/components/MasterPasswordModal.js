'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import { 
  Lock, Unlock, Shield, Key, Eye, EyeOff, 
  Mail, AlertTriangle, CheckCircle, Loader, 
  Database, ArrowRight, RefreshCw, Zap,
  HelpCircle, ChevronDown, ChevronUp, Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import MacOSModalWindow from '@/components/MacOSModalWindow';

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
export default function MasterPasswordModal() {
  const { data: session } = useSession();
  const { t } = useTranslation();
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
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [faqOpen, setFaqOpen] = useState(null); // which FAQ index is open

  const inputRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      addNotification({ title: 'Success', message: '🔓 Vault unlocked', type: 'success' });
    } catch (err) {
      setError(err.message || 'Failed to unlock');
      triggerShake();
    }
    setLoading(false);
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

    setLoading(true);
    try {
      // First test the URI
      const testRes = await fetch('/api/connections', {
        headers: { 'x-mongodb-uri': mongoUri.trim() }
      });
      const testData = await testRes.json();
      if (!testData.success) {
        setError('Could not connect to the database. Please check the URI.');
        setLoading(false);
        return;
      }

      await setupVault(mongoUri.trim(), masterPassword);
      addNotification({ title: 'Success', message: '🔐 Vault created! Your data is now encrypted.', type: 'success' });
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
        addNotification({ title: 'Recovery', message: `Recovery code sent to ${data.maskedEmail}`, type: 'info' });
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
        addNotification({ title: 'Reset Complete', message: 'Vault reset! Set up a new Master Password.', type: 'success' });
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
    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <button
        type="button"
        onClick={() => setFaqOpen(faqOpen === -1 ? null : -1)}
        className="flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-indigo-400 transition-colors w-full"
      >
        <HelpCircle size={12} />
        <span className="font-medium">{t('vault.faq.title')}</span>
        {faqOpen !== null ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
      </button>
      <AnimatePresence>
        {faqOpen !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              {faqItems.map((item, i) => (
                <div key={i} className="rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-left"
                  >
                    <span className="flex-1 font-medium">{item.q}</span>
                    {faqOpen === i ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                  <AnimatePresence>
                    {faqOpen === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <p className="px-3 pb-2.5 text-[10px] text-[var(--text-muted)] leading-relaxed">{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
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
      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full pointer-events-none" />
      
      <div className="text-center relative z-10">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, type: 'spring' }}
          className="relative inline-block mb-6"
        >
          {/* Glowing Ring */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/30 to-indigo-500/30 blur-xl animate-pulse" />
          
          <div className="relative w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <motion.div
              animate={{ rotate: [0, -5, 5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Lock size={32} className="text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
            </motion.div>
          </div>
        </motion.div>
        
        <h2 className="text-2xl font-extrabold tracking-tight text-white mb-2">
          {t('vault.locked') || 'Secured Vault'}
        </h2>
        <p className="text-slate-400 text-sm max-w-[280px] mx-auto leading-relaxed">
          {t('vault.unlockNow') || 'Your connection data is securely encrypted. Enter your master password to access.'}
        </p>
        
        {!session && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 backdrop-blur-md rounded-full text-[10px] font-semibold text-slate-300 uppercase tracking-wider"
          >
            <Monitor size={10} className="text-blue-400" /> {t('vault.guestMode') || 'Guest Mode'}
          </motion.div>
        )}
      </div>

      <div className="space-y-4 relative z-10">
        <div className="group relative">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/50 to-indigo-500/50 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
          <div className="relative">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder={t('vault.masterPassword') || 'Master Password'}
              className="w-full px-4 py-3.5 bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-0 transition-all text-base shadow-inner"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10, opacity: 0 }}
            animate={{ x: [0, -8, 8, -4, 4, 0], opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 shadow-lg backdrop-blur-md"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading || !masterPassword}
          className="w-full py-4 px-6 relative group overflow-hidden rounded-xl bg-blue-600 font-bold text-white text-base shadow-[0_8px_30px_rgb(37,99,235,0.4)] hover:shadow-[0_8px_40px_rgb(37,99,235,0.6)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-600 transition-all group-hover:scale-105" />
          <div className="relative flex items-center justify-center gap-3">
            {loading ? (
              <><Loader size={20} className="animate-spin" /> {t('vault.unlocking') || 'Authorizing...'}</>
            ) : (
              <><Unlock size={20} /> {t('vault.unlockVault') || 'Unlock & Access Dashboard'}</>
            )}
          </div>
        </button>

        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); }}
            className="text-xs font-semibold text-slate-500 hover:text-blue-400 transition-colors py-1"
          >
            {t('vault.forgotPassword') || 'Forgot Master Password?'}
          </button>

          <button
            type="button"
            onClick={dismissVault}
            className="text-xs font-semibold text-slate-500 hover:text-white transition-colors py-1"
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
    <form onSubmit={handleSetup} className="space-y-6 px-2 py-4 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-emerald-500/10 blur-[80px] rounded-full pointer-events-none" />

      <div className="text-center relative z-10">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative inline-block mb-4"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-emerald-500/30 to-teal-500/30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl">
            <Shield size={28} className="text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
          </div>
        </motion.div>
        
        <h2 className="text-2xl font-extrabold tracking-tight text-white mb-1">
          {session ? (t('vault.setupVault') || 'Initialize Secure Vault') : (t('vault.localVault') || 'Local Vault Setup')}
        </h2>
        <p className="text-slate-400 text-sm max-w-[320px] mx-auto leading-relaxed">
          {t('vault.setupDescription') || 'Set up your private database and master password to start encrypting your connections.'}
        </p>
      </div>

      <div className="space-y-4 relative z-10">
        {/* Database URI */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
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
              className="w-full px-4 py-3 bg-slate-900/80 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:outline-none transition-all text-xs font-mono shadow-inner"
            />
          </div>
          
          <div className="flex flex-wrap gap-2 pt-1">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setMongoUri(preset.uri)}
                className="px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700/80 border border-white/5 text-[10px] font-bold text-slate-400 hover:text-white transition-all backdrop-blur-sm"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Master Password */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
            {t('vault.masterPassword') || 'Choose Master Password'}
          </label>
          <div className="relative group">
             <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
             <input
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder={t('vault.atLeast8') || 'Minimum 8 strong characters'}
              className="w-full px-4 py-3 bg-slate-900/80 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:outline-none transition-all text-sm shadow-inner"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1"
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
            className="w-full px-4 py-3 bg-slate-900/80 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:outline-none transition-all text-sm shadow-inner"
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
            className="flex-1 py-4 px-3 bg-slate-800/50 hover:bg-slate-700/80 border border-white/5 rounded-xl text-slate-400 hover:text-white text-sm font-bold transition-all backdrop-blur-sm"
          >
            {t('vault.setupLater') || 'Later'}
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
        <div className="absolute inset-0 bg-blue-500/5 blur-xl group-hover:bg-blue-500/10 transition-colors pointer-events-none" />
        <div className="relative p-4 bg-slate-900/40 border border-white/5 rounded-2xl flex items-start gap-3 backdrop-blur-md">
          <Shield size={18} className="text-blue-400 mt-1 shrink-0" />
          <div className="space-y-1">
             <h4 className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">{t('vault.privacyFirst') || 'Zero-Knowledge Privacy'}</h4>
             <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
               {t('vault.privacyDesc') || 'Your Master Password is never stored on our servers. All encryption happens locally in your browser. If you lose this password, your data is unrecoverable.'}
             </p>
          </div>
        </div>
      </div>

      {renderFAQ()}
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
        
        <h2 className="text-2xl font-extrabold tracking-tight text-white mb-1">
          {t('vault.recovery.title') || 'Account Recovery'}
        </h2>
        <p className="text-slate-400 text-sm max-w-[300px] mx-auto leading-relaxed">
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
          className="flex-1 py-4 px-4 bg-slate-800/50 hover:bg-slate-700/80 border border-white/5 rounded-xl text-slate-400 hover:text-white text-sm font-bold transition-all backdrop-blur-sm"
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
        
        <h2 className="text-2xl font-extrabold tracking-tight text-white mb-1">
          {t('vault.verify.title') || 'Verify Ownership'}
        </h2>
        <p className="text-slate-400 text-sm max-w-[300px] mx-auto leading-relaxed">
          {t('vault.verify.sentTo') || 'Verification code sent to:'} <br/>
          <span className="text-blue-400 font-bold uppercase tracking-wider">{recoveryEmail}</span>
        </p>
      </div>

      <div className="space-y-6 relative z-10">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-2xl blur opacity-100" />
          <input
            ref={inputRef}
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="relative w-full px-6 py-6 bg-slate-900/90 border border-white/10 rounded-2xl text-white text-center text-4xl font-black tracking-[12px] placeholder-slate-700/50 focus:outline-none focus:border-blue-500/50 transition-all shadow-inner"
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
            className="flex-1 py-4 px-4 bg-slate-800/50 hover:bg-slate-700/80 border border-white/5 rounded-xl text-slate-400 hover:text-white text-sm font-bold transition-all backdrop-blur-sm"
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
          className="w-full py-1 text-slate-500 hover:text-blue-400 text-xs font-bold transition-colors flex items-center justify-center gap-2 uppercase tracking-widest"
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

  return createPortal(
    <MacOSModalWindow
      isOpen
      title={title}
      icon={icon}
      draggable={true}
      resizable={true}
      defaultWidth={480}
      defaultHeight={420}
      minWidth={400}
      minHeight={360}
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
