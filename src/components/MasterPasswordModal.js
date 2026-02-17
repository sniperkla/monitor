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
    <form onSubmit={handleUnlock} className="space-y-5">
      <div className="text-center pt-2">
        <motion.div 
          className="w-16 h-16 mx-auto bg-gradient-to-br from-slate-500 to-slate-600 rounded-2xl flex items-center justify-center shadow-lg mb-4"
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
        >
          <Lock size={28} className="text-white" />
        </motion.div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          {t('vault.locked')}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm">
          {t('vault.unlockNow')}
        </p>
        {!session && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md text-[10px] font-medium text-amber-600 dark:text-amber-400">
            <Monitor size={10} /> {t('vault.guestMode')}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="relative">
          <input
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            placeholder={t('vault.masterPassword')}
            className="w-full px-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-[var(--bg-tertiary)] transition-all"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10 }}
            animate={{ x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={12} />
            {error}
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading || !masterPassword}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <><Loader size={14} className="animate-spin" /> {t('vault.unlocking')}</>
          ) : (
            <><Unlock size={14} /> {t('vault.unlockVault')}</>
          )}
        </button>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); }}
            className="text-xs text-[var(--text-muted)] hover:text-blue-500 transition-colors"
          >
            {t('vault.forgotPassword')}
          </button>

          <button
            type="button"
            onClick={dismissVault}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {t('vault.unlockLater')}
          </button>
        </div>
      </div>

      {/* FAQ */}
      {renderFAQ()}
    </form>
  );

  // === SETUP VIEW ===
  const renderSetup = () => (
    <form onSubmit={handleSetup} className="space-y-4">
      <div className="text-center pt-2">
        <motion.div 
          className="w-14 h-14 mx-auto bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg mb-3"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring' }}
        >
          <Shield size={24} className="text-white" />
        </motion.div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          {session ? t('vault.setupVault') : t('vault.localVault')}
        </h2>
        <p className="text-[var(--text-secondary)] text-xs">
          {t('vault.setupDescription')}
        </p>
      </div>

      <div className="space-y-3">
        {/* Database URI */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            {mongoUri.includes('mysql') ? 'MySQL URI' : mongoUri.includes('postgres') ? 'PostgreSQL URI' : t('vault.mongoUri')}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={mongoUri}
            onChange={(e) => setMongoUri(e.target.value)}
            placeholder="mongodb://user:pass@host:27017/db"
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs font-mono"
          />
          {/* Presets */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setMongoUri(preset.uri)}
                className="px-2 py-1 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[10px] text-[var(--text-muted)] transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Master Password */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            {t('vault.masterPassword')}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder={t('vault.atLeast8')}
              className="w-full px-3 py-2 pr-10 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1 rounded hover:bg-[var(--bg-tertiary)] transition-all"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {/* Password strength indicator */}
          {masterPassword && (
            <div className="mt-1.5 flex gap-1">
              {[1, 2, 3, 4].map(level => (
                <div
                  key={level}
                  className={`h-1 flex-1 rounded-full transition-all ${
                    masterPassword.length >= level * 3
                      ? level <= 1 ? 'bg-red-500' 
                      : level <= 2 ? 'bg-amber-500' 
                      : level <= 3 ? 'bg-emerald-500' 
                      : 'bg-emerald-400'
                      : 'bg-[var(--bg-tertiary)]'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">{t('vault.confirmPassword')}</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('vault.confirmPassword')}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm"
            autoComplete="new-password"
          />
          {confirmPassword && masterPassword !== confirmPassword && (
            <p className="text-red-500 text-[11px] mt-1 flex items-center gap-1">
              <AlertTriangle size={10} /> {t('vault.passwordsMismatch')}
            </p>
          )}
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10 }}
            animate={{ x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={12} />
            {error}
          </motion.div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={dismissVault}
            className="flex-1 py-2 px-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] text-xs font-medium transition-all"
          >
            {t('vault.setupLater')}
          </button>
          <button
            type="submit"
            disabled={loading || !mongoUri || !masterPassword || !confirmPassword}
            className="flex-[2] py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
            {loading ? (
              <><Loader size={14} className="animate-spin" /> {hasLegacyUri ? t('vault.migrating') : t('vault.encrypting')}</>
            ) : (
              <><Shield size={14} /> {hasLegacyUri ? t('vault.secureNow') : t('vault.createVault')}</>
            )}
          </button>
        </div>
      </div>

      {/* Security Info */}
      <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
        <div className="flex items-start gap-2">
          <Shield size={12} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            <strong className="text-blue-500">{t('vault.privacyFirst')}</strong> {t('vault.privacyDesc')}
          </p>
        </div>
      </div>

      {/* FAQ */}
      {renderFAQ()}
    </form>
  );

  // === RECOVERY VIEW ===
  const renderRecovery = () => (
    <div className="space-y-4">
      <div className="text-center pt-2">
        <motion.div 
          className="w-14 h-14 mx-auto bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg mb-3"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
        >
          <Mail size={24} className="text-white" />
        </motion.div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{t('vault.recovery.title')}</h2>
        <p className="text-[var(--text-secondary)] text-xs max-w-xs mx-auto">
          {t('vault.recovery.desc')} 
          <strong className="text-amber-500"> {t('vault.recovery.warning')}</strong>
        </p>
      </div>

      <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-500/80 leading-relaxed">
            <strong>Warning:</strong> {t('vault.recovery.warningDetail')}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => { setMode('unlock'); setError(''); }}
          className="flex-1 py-2 px-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] text-xs font-medium transition-all"
        >
          {t('vault.recovery.back')}
        </button>
        <button
          onClick={handleRequestRecovery}
          disabled={loading}
          className="flex-[2] py-2 px-4 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <><Loader size={14} className="animate-spin" /> {t('vault.recovery.sending')}</>
          ) : (
            <><Mail size={14} /> {t('vault.recovery.sendCode')}</>
          )}
        </button>
      </div>
    </div>
  );

  // === VERIFY CODE VIEW ===
  const renderVerify = () => (
    <form onSubmit={handleVerifyCode} className="space-y-4">
      <div className="text-center pt-2">
        <motion.div 
          className="w-14 h-14 mx-auto bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg mb-3"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
        >
          <CheckCircle size={24} className="text-white" />
        </motion.div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{t('vault.verify.title')}</h2>
        <p className="text-[var(--text-secondary)] text-xs">
          {t('vault.verify.sentTo')} <span className="text-blue-500 font-medium">{recoveryEmail}</span>
        </p>
      </div>

      <div className="space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-center text-2xl font-mono tracking-[8px] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all"
          autoComplete="one-time-code"
        />

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10 }}
            animate={{ x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={12} />
            {error}
          </motion.div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); setRecoveryCode(''); }}
            className="flex-1 py-2 px-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-secondary)] text-xs font-medium transition-all"
          >
            ← {t('vault.recovery.back')}
          </button>
          <button
            type="submit"
            disabled={loading || recoveryCode.length !== 6}
            className="flex-[2] py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
            {loading ? (
              <><Loader size={14} className="animate-spin" /> {t('vault.verify.verifying')}</>
            ) : (
              <><CheckCircle size={14} /> {t('vault.verify.verifyReset')}</>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={handleRequestRecovery}
          disabled={loading}
          className="w-full py-1.5 text-[var(--text-muted)] hover:text-blue-500 text-xs transition-colors flex items-center justify-center gap-1"
        >
          <RefreshCw size={10} /> {t('vault.verify.resend')}
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
      draggable
      resizable
      defaultWidth={560}
      defaultHeight={460}
      minWidth={420}
      minHeight={360}
      onClose={() => dismissVault?.()}
      zIndexClassName="z-[90000]"
      maxWidthClassName="max-w-xl"
      maxHeightClassName="max-h-[75vh]"
      contentClassName="p-4"
      closeOnOverlayClick={false}
    >
      {renderContent()}
    </MacOSModalWindow>,
    document.body
  );
}
