'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import { 
  Lock, Unlock, Shield, Key, Eye, EyeOff, 
  Mail, AlertTriangle, CheckCircle, Loader, 
  Database, ArrowRight, RefreshCw, X, Zap,
  HelpCircle, ChevronDown, ChevronUp, Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

const PRESETS = [
  { label: 'Localhost', uri: 'mongodb://localhost:27017/ssh-monitor' },
  { label: 'Local IP', uri: 'mongodb://127.0.0.1:27017/ssh-monitor' },
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
      toast.success('🔓 Vault unlocked');
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
    if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
      setError('URI must start with mongodb:// or mongodb+srv://');
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
      toast.success('🔐 Vault created! Your data is now encrypted.');
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
        toast.success(`Recovery code sent to ${data.maskedEmail}`);
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
        toast.success('Vault reset! Set up a new Master Password.');
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
    <div className="mt-4 border-t border-white/5 pt-4">
      <button
        type="button"
        onClick={() => setFaqOpen(faqOpen === -1 ? null : -1)}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-indigo-400 transition-colors w-full"
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
                <div key={i} className="rounded-lg bg-white/3 border border-white/5 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-300 hover:text-white transition-colors text-left"
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
                        <p className="px-3 pb-2.5 text-[10px] text-gray-500 leading-relaxed">{item.a}</p>
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
    <form onSubmit={handleUnlock} className="space-y-6">
      <div className="text-center">
        <motion.div 
          className="w-20 h-20 mx-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/30 mb-4"
          animate={{ rotate: [0, -3, 3, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
        >
          <Lock size={36} className="text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-1">
          {t('vault.locked')}
        </h2>
        <p className="text-gray-400 text-sm">
          {t('vault.unlockNow')}
        </p>
        {!session && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[10px] font-bold text-amber-400 uppercase tracking-widest">
            <Monitor size={10} /> {t('vault.guestMode')}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Key size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            placeholder={t('vault.masterPassword')}
            className="w-full pl-11 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10 }}
            animate={{ x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={14} />
            {error}
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading || !masterPassword}
          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20"
        >
          {loading ? (
            <><Loader size={16} className="animate-spin" /> {t('vault.unlocking')}</>
          ) : (
            <><Unlock size={16} /> {t('vault.unlockVault')}</>
          )}
        </button>
      </div>

      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={() => { setMode('recovery'); setError(''); }}
          className="text-xs text-gray-500 hover:text-indigo-400 transition-colors"
        >
          {t('vault.forgotPassword')}
        </button>
        
        <div className="w-full flex items-center gap-4 my-2">
          <div className="h-px flex-1 bg-white/5" />
          <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">{t('vault.or')}</span>
          <div className="h-px flex-1 bg-white/5" />
        </div>

        <button
          type="button"
          onClick={dismissVault}
          className="text-xs text-gray-500 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg"
        >
          {t('vault.unlockLater')}
        </button>
      </div>

      {/* FAQ */}
      {renderFAQ()}
    </form>
  );

  // === SETUP VIEW ===
  const renderSetup = () => (
    <form onSubmit={handleSetup} className="space-y-6">
      <div className="text-center">
        <motion.div 
          className="w-20 h-20 mx-auto bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/30 mb-4"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring' }}
        >
          <Shield size={36} className="text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-1">
          {session ? t('vault.setupVault') : t('vault.localVault')}
        </h2>
        <p className="text-gray-400 text-sm">
          {t('vault.setupDescription')}
        </p>
        {!session && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
            <Shield size={10} /> {t('vault.secureLocalStorage')}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* MongoDB URI */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
            <Database size={12} /> {t('vault.mongoUri')}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={mongoUri}
            onChange={(e) => setMongoUri(e.target.value)}
            placeholder="mongodb://user:pass@host:27017/db"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-all text-sm font-mono"
          />
          {/* Presets */}
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setMongoUri(preset.uri)}
                className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-[10px] text-gray-400 font-medium transition-all flex items-center gap-1"
              >
                <Zap size={10} className="text-amber-400" />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Master Password */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
            <Key size={12} /> {t('vault.masterPassword')}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder={t('vault.atLeast8')}
              className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-all text-sm"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {/* Password strength indicator */}
          {masterPassword && (
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4].map(level => (
                <div
                  key={level}
                  className={`h-1 flex-1 rounded-full transition-all ${
                    masterPassword.length >= level * 3
                      ? level <= 1 ? 'bg-red-500' 
                      : level <= 2 ? 'bg-amber-500' 
                      : level <= 3 ? 'bg-emerald-500' 
                      : 'bg-emerald-400'
                      : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2">{t('vault.confirmPassword')}</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('vault.confirmPassword')}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-all text-sm"
            autoComplete="new-password"
          />
          {confirmPassword && masterPassword !== confirmPassword && (
            <p className="text-red-400 text-[11px] mt-1 flex items-center gap-1">
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
            className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={14} />
            {error}
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading || !mongoUri || !masterPassword || !confirmPassword}
          className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
        >
          {loading ? (
            <><Loader size={16} className="animate-spin" /> {hasLegacyUri ? t('vault.migrating') : t('vault.encrypting')}</>
          ) : (
            <><Shield size={16} /> {hasLegacyUri ? t('vault.secureNow') : t('vault.createVault')}</>
          )}
        </button>

        <button
          type="button"
          onClick={dismissVault}
          className="w-full py-3 text-gray-500 hover:text-white text-xs font-medium transition-colors"
        >
          {t('vault.setupLater')}
        </button>
      </div>

      {/* Security Info */}
      <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
        <div className="flex items-start gap-3">
          <Shield size={14} className="text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-gray-400 leading-relaxed">
            <strong className="text-indigo-400">{t('vault.privacyFirst')}</strong> {t('vault.privacyDesc')}
          </p>
        </div>
      </div>

      {/* FAQ */}
      {renderFAQ()}
    </form>
  );

  // === RECOVERY VIEW ===
  const renderRecovery = () => (
    <div className="space-y-6">
      <div className="text-center">
        <motion.div 
          className="w-20 h-20 mx-auto bg-gradient-to-br from-amber-500 to-orange-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-amber-500/30 mb-4"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
        >
          <Mail size={36} className="text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-1">{t('vault.recovery.title')}</h2>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          {t('vault.recovery.desc')} 
          <strong className="text-amber-400"> {t('vault.recovery.warning')}</strong>
        </p>
      </div>

      <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-400/80 leading-relaxed">
            <strong>Warning:</strong> {t('vault.recovery.warningDetail')}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => { setMode('unlock'); setError(''); }}
          className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 text-sm font-medium transition-all"
        >
          {t('vault.recovery.back')}
        </button>
        <button
          onClick={handleRequestRecovery}
          disabled={loading}
          className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/50 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
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
    <form onSubmit={handleVerifyCode} className="space-y-6">
      <div className="text-center">
        <motion.div 
          className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-cyan-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/30 mb-4"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
        >
          <CheckCircle size={36} className="text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-white mb-1">{t('vault.verify.title')}</h2>
        <p className="text-gray-400 text-sm">
          {t('vault.verify.sentTo')} <span className="text-blue-400 font-medium">{recoveryEmail}</span>
        </p>
      </div>

      <div className="space-y-4">
        <input
          ref={inputRef}
          type="text"
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          className="w-full px-4 py-4 bg-white/5 border border-white/10 rounded-xl text-white text-center text-3xl font-mono tracking-[12px] placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
          autoComplete="one-time-code"
        />

        {error && (
          <motion.div 
            key={shakeKey}
            initial={{ x: -10 }}
            animate={{ x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertTriangle size={14} />
            {error}
          </motion.div>
        )}

        {/* Debug hint for dev */}
        <div className="text-[10px] text-gray-600 text-center bg-white/3 p-2 rounded-lg border border-white/5">
          <p>Don't see the email? Check your <strong>terminal console</strong> or <strong>RECOVERY_CODE.txt</strong> in the project folder.</p>
        </div>

        <button
          type="submit"
          disabled={loading || recoveryCode.length !== 6}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-500/20"
        >
          {loading ? (
            <><Loader size={16} className="animate-spin" /> {t('vault.verify.verifying')}</>
          ) : (
            <><CheckCircle size={16} /> {t('vault.verify.verifyReset')}</>
          )}
        </button>
      </div>

      <div className="flex justify-between text-xs">
        <button
          type="button"
          onClick={() => { setMode('recovery'); setError(''); setRecoveryCode(''); }}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← {t('vault.recovery.back')}
        </button>
        <button
          type="button"
          onClick={handleRequestRecovery}
          disabled={loading}
          className="text-gray-500 hover:text-indigo-400 transition-colors flex items-center gap-1"
        >
          <RefreshCw size={10} /> {t('vault.verify.resend')}
        </button>
      </div>
    </form>
  );

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[50000] flex items-center justify-center"
        style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)' }}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto custom-scrollbar"
        >
          <div 
            className="rounded-2xl border border-white/10 p-8 shadow-2xl"
            style={{ 
              background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95))',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
            }}
          >
            {renderContent()}

            {/* Security badge — inside modal */}
            <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-2 text-gray-600 text-[10px]">
              <Shield size={10} />
              <span>{t('vault.securityBadge')}</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
