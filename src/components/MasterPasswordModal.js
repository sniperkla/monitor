'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useVault } from '@/context/VaultContext';
import { useSession } from 'next-auth/react';
import {
  Lock, Unlock, Shield, Key, Eye, EyeOff,
  Mail, TriangleAlert, CircleCheck, LoaderCircle,
  Database, Zap, CircleHelp, ChevronDown, Monitor,
  X, Check, AlertCircle, HardDrive, Cpu, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import { useIsMobile } from '@/hooks/useIsMobile';

// Subtle Web Audio synthesizer for micro-haptic feedback
function playVaultAudio(type = 'click') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'unlock') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.setValueAtTime(120, now + 0.08);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else {
      // Soft mechanical key click
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, now);
      gain.gain.setValueAtTime(0.015, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  } catch (_) {
    // AudioContext blocked or not supported
  }
}

// Deterministic particles generated statically to preserve render purity
const STATIC_PARTICLES = Array.from({ length: 24 }, (_, i) => {
  const seed = (i * 9301 + 49297) % 233280;
  const rnd1 = seed / 233280;
  const rnd2 = ((seed * 9301 + 49297) % 233280) / 233280;
  const rnd3 = ((seed * 12345 + 6789) % 233280) / 233280;
  const rnd4 = ((seed * 54321 + 9876) % 233280) / 233280;

  return {
    id: i,
    x: rnd1 * 100,
    y: rnd2 * 100,
    size: rnd3 * 2.5 + 1,
    duration: rnd4 * 14 + 10,
    delay: rnd1 * 4,
    xOffset: rnd2 * 16 - 8,
  };
});

// Floating ambient particles
function Particles({ color = 'rgba(99,102,241,0.15)' }) {
  const isMobile = useIsMobile();
  if (isMobile) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {STATIC_PARTICLES.map((p) => (
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
            y: [0, -25, 0],
            x: [0, p.xOffset, 0],
            opacity: [0.15, 0.55, 0.15],
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

// Database presets
const DATABASE_PRESETS = [
  {
    id: 'mongodb',
    label: 'MongoDB',
    protocol: 'mongodb://',
    port: '27017',
    defaultUri: 'mongodb://localhost:27017/ssh-monitor',
    icon: Database,
    badge: 'NoSQL',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    protocol: 'postgres://',
    port: '5432',
    defaultUri: 'postgres://postgres:password@127.0.0.1:5432/db',
    icon: HardDrive,
    badge: 'SQL',
  },
  {
    id: 'mysql',
    label: 'MySQL',
    protocol: 'mysql://',
    port: '3306',
    defaultUri: 'mysql://root:password@127.0.0.1:3306/db',
    icon: Cpu,
    badge: 'SQL',
  },
];

/**
 * Interactive Cryptographic Vault Dial (Hero Artwork)
 * Concentric animated SVG rings with dynamic mode-aware center core
 */
function CryptographicVaultDial({ mode = 'unlock', activeChars = 0, isUnlocking = false }) {
  const dialRotation = (activeChars * 24) % 360;

  const modeTheme = {
    unlock: {
      primary: '#6366f1',
      secondary: '#06b6d4',
      glow: 'rgba(99,102,241,0.25)',
    },
    setup: {
      primary: '#10b981',
      secondary: '#14b8a6',
      glow: 'rgba(16,185,129,0.25)',
    },
    recovery: {
      primary: '#f59e0b',
      secondary: '#ef4444',
      glow: 'rgba(245,158,11,0.25)',
    },
    verify: {
      primary: '#3b82f6',
      secondary: '#8b5cf6',
      glow: 'rgba(59,130,246,0.25)',
    },
  }[mode] || {
    primary: '#6366f1',
    secondary: '#06b6d4',
    glow: 'rgba(99,102,241,0.25)',
  };

  return (
    <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
      {/* Outer Glow Halo */}
      <motion.div
        className="absolute inset-0 rounded-full blur-2xl pointer-events-none"
        style={{ background: modeTheme.glow }}
        animate={{
          scale: isUnlocking ? [1, 1.35, 1.1] : [1, 1.1, 1],
          opacity: isUnlocking ? [0.4, 0.8, 0.6] : [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Outer SVG Rotor Dial */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 112 112">
        {/* Static graduation circle */}
        <circle
          cx="56"
          cy="56"
          r="52"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1.5"
          strokeDasharray="2 6"
        />

        {/* Orbiting segment ring — rotates continuously */}
        <motion.circle
          cx="56"
          cy="56"
          r="48"
          fill="none"
          stroke={modeTheme.primary}
          strokeWidth="1.5"
          strokeDasharray="28 80"
          strokeLinecap="round"
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '56px 56px', opacity: 0.65 }}
        />

        {/* Counter-rotating secondary ring */}
        <motion.circle
          cx="56"
          cy="56"
          r="42"
          fill="none"
          stroke={modeTheme.secondary}
          strokeWidth="1"
          strokeDasharray="14 50"
          animate={{ rotate: -360 }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '56px 56px', opacity: 0.5 }}
        />

        {/* User-input responsive rotor ticks */}
        <g
          style={{
            transform: `rotate(${dialRotation}deg)`,
            transformOrigin: '56px 56px',
            transition: 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1="56"
              y1="18"
              x2="56"
              y2="23"
              stroke={angle % 90 === 0 ? modeTheme.primary : 'rgba(255,255,255,0.25)'}
              strokeWidth={angle % 90 === 0 ? 2 : 1}
              strokeLinecap="round"
              transform={`rotate(${angle} 56 56)`}
            />
          ))}
        </g>
      </svg>

      {/* Central Glass Core with Icon */}
      <motion.div
        className="relative w-16 h-16 rounded-2xl flex items-center justify-center border shadow-xl backdrop-blur-md overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(15,23,42,0.85) 100%)',
          borderColor: 'rgba(255,255,255,0.15)',
          boxShadow: `0 0 24px ${modeTheme.glow}, inset 0 1px 1px rgba(255,255,255,0.2)`,
        }}
        whileHover={{ scale: 1.05 }}
      >
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            background: `radial-gradient(circle at center, ${modeTheme.primary} 0%, transparent 70%)`,
          }}
        />

        {mode === 'unlock' && (
          <motion.div
            animate={isUnlocking ? { scale: [1, 1.15, 1], rotate: [0, -10, 10, 0] } : {}}
            transition={{ duration: 0.5 }}
          >
            {isUnlocking ? (
              <Unlock size={26} className="text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.6)]" />
            ) : (
              <Lock size={26} className="text-indigo-400 drop-shadow-[0_0_10px_rgba(99,102,241,0.6)]" />
            )}
          </motion.div>
        )}

        {mode === 'setup' && (
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Shield size={26} className="text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
          </motion.div>
        )}

        {mode === 'recovery' && (
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Mail size={26} className="text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.6)]" />
          </motion.div>
        )}

        {mode === 'verify' && (
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            <CircleCheck size={26} className="text-blue-400 drop-shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Password Strength Evaluator
 */
function evaluatePasswordStrength(password = '') {
  if (!password) return { score: 0, label: 'EMPTY', color: 'bg-slate-700', text: 'text-slate-500' };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 0.5;
  if (/[^A-Za-z0-9]/.test(password)) score += 0.5;

  const normalized = Math.min(4, Math.floor(score));

  switch (normalized) {
    case 1:
      return { score: 1, label: 'WEAK', color: 'bg-rose-500', text: 'text-rose-400' };
    case 2:
      return { score: 2, label: 'FAIR', color: 'bg-amber-500', text: 'text-amber-400' };
    case 3:
      return { score: 3, label: 'STRONG', color: 'bg-emerald-500', text: 'text-emerald-400' };
    case 4:
      return { score: 4, label: 'QUANTUM-GRADE', color: 'bg-cyan-400', text: 'text-cyan-300' };
    default:
      return { score: 1, label: 'TOO SHORT', color: 'bg-rose-500', text: 'text-rose-400' };
  }
}

/**
 * MasterPasswordModal
 */
export default function MasterPasswordModal({ isBooted = true }) {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const {
    vaultStatus, unlockVault, setupVault,
    requestRecovery, verifyRecovery,
    hasLegacyUri, legacyUri, dismissVault, isDismissed
  } = useVault();
  const { addNotification } = useOS();

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState('unlock'); // 'unlock' | 'setup' | 'recovery' | 'verify'
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mongoUri, setMongoUri] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRelayReminder, setShowRelayReminder] = useState(false);
  const [pendingSetup, setPendingSetup] = useState(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [faqOpen, setFaqOpen] = useState(null);
  const [relayConnected, setRelayConnected] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // OTP 6-digit input box refs
  const otpInputRefs = useRef([]);
  const inputRef = useRef(null);

  // Check relay status on mount
  useEffect(() => {
    if (!session) return;
    fetch('/api/relay/token')
      .then(r => r.json())
      .then(d => { if (d.success) setRelayConnected(d.connected); })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle mode transitions based on vaultStatus
  useEffect(() => {
    setMasterPassword('');
    setConfirmPassword('');
    setError('');
    if (vaultStatus === 'setup') {
      setMode('setup');
      if (hasLegacyUri && legacyUri) {
        setMongoUri(legacyUri);
      }
    } else if (vaultStatus === 'locked') {
      setMode('unlock');
    }
  }, [vaultStatus, hasLegacyUri, legacyUri]);

  // Autofocus input on mode switch or when booted into desktop
  useEffect(() => {
    if (!mounted || !isBooted) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [mode, mounted, isBooted]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Keyboard shortcut: Escape to dismiss (if dismissable)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && dismissVault) {
        dismissVault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissVault]);

  // Detect CapsLock status
  const handleKeyModifierCheck = (e) => {
    if (e.getModifierState) {
      setCapsLockActive(e.getModifierState('CapsLock'));
    }
  };

  const triggerShake = () => {
    setShakeKey(k => k + 1);
    playVaultAudio('error');
  };

  // Active database preset selector
  const activePreset = useMemo(() => {
    if (!mongoUri) return null;
    const lower = mongoUri.toLowerCase();
    return DATABASE_PRESETS.find(p => lower.startsWith(p.protocol)) || null;
  }, [mongoUri]);

  // Password entropy evaluation
  const strength = useMemo(() => evaluatePasswordStrength(masterPassword), [masterPassword]);

  // === UNLOCK HANDLER ===
  const handleUnlock = async (e) => {
    e?.preventDefault();
    if (!masterPassword || loading) return;
    setLoading(true);
    setError('');

    try {
      await unlockVault(masterPassword);
      playVaultAudio('unlock');
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
    e?.preventDefault();
    setError('');

    if (!mongoUri.trim()) {
      setError('Please provide a database connection URI');
      return;
    }
    const uri = mongoUri.trim();
    const allowed = ['mongodb://', 'mongodb+srv://', 'mysql://', 'postgres://', 'postgresql://'];
    const isValid = allowed.some(p => uri.startsWith(p));

    if (!isValid) {
      setError('Unsupported database protocol. Use mongodb://, postgres://, or mysql://');
      return;
    }
    if (masterPassword.length < 8) {
      setError('Master Password must be at least 8 characters long');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      triggerShake();
      return;
    }

    const isLocalhost = /localhost|127\.0\.0\.1/.test(uri);
    if (isLocalhost && !relayConnected) {
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
        const testHeaders = { 'Content-Type': 'application/json' };
        if (tunnelConfig) testHeaders['x-vault-tunnel'] = JSON.stringify(tunnelConfig);

        const testRes = await fetch('/api/connections/test-uri', {
          method: 'POST',
          headers: testHeaders,
          body: JSON.stringify({ uri, allowRelay: true })
        });
        const testData = await testRes.json();
        if (!testData.success) {
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
      playVaultAudio('unlock');
      addNotification({ title: t('common.success'), message: t('vault.toasts.created'), type: 'success' });
    } catch (err) {
      setError(err.message || 'Setup failed');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // === RECOVERY HANDLER ===
  const handleRequestRecovery = async () => {
    if (loading || resendCooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestRecovery();
      if (data.success) {
        setRecoveryEmail(data.maskedEmail);
        setMode('verify');
        setResendCooldown(60);
        addNotification({
          title: t('vault.recovery.title'),
          message: t('vault.toasts.recoverySent', { email: data.maskedEmail }),
          type: 'info'
        });
      } else {
        setError(data.error || 'Failed to dispatch recovery instructions');
        triggerShake();
      }
    } catch (_) {
      setError('Failed to send recovery email');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // === VERIFY RECOVERY CODE ===
  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    const cleanCode = recoveryCode.trim();
    if (cleanCode.length !== 6) {
      setError('Please enter the 6-digit verification code');
      triggerShake();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await verifyRecovery(cleanCode);
      if (data.success) {
        addNotification({
          title: t('vault.toasts.resetComplete'),
          message: t('vault.toasts.resetComplete'),
          type: 'success'
        });
        setMode('setup');
        setMasterPassword('');
        setConfirmPassword('');
        setRecoveryCode('');
      } else {
        setError(data.error || 'Invalid or expired code');
        triggerShake();
      }
    } catch (_) {
      setError('Verification failed');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // Handle segmented OTP digits input
  const handleOtpBoxChange = (index, value) => {
    const char = value.replace(/\D/g, '').slice(-1);
    const digits = (recoveryCode + '      ').slice(0, 6).split('');
    digits[index] = char || ' ';
    const newCode = digits.join('').replace(/\s+$/, '');
    setRecoveryCode(newCode);
    playVaultAudio('click');

    if (char && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpBoxKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !recoveryCode[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      setRecoveryCode(pasted);
      const nextIdx = Math.min(pasted.length, 5);
      otpInputRefs.current[nextIdx]?.focus();
      playVaultAudio('click');
    }
  };

  // Early return conditions
  if (!mounted || vaultStatus === 'unlocked' || vaultStatus === 'no_auth' || vaultStatus === 'loading' || isDismissed) {
    return null;
  }

  // FAQ Items
  const faqItems = [
    { q: t('vault.faq.q1') || 'What is a Master Password?', a: t('vault.faq.a1') || 'A Master Password derives a local cryptographic key on your device to encrypt and decrypt database credentials. It is never transmitted to the server.' },
    { q: t('vault.faq.q2') || 'What happens if I lose it?', a: t('vault.faq.a2') || 'You can reset via email recovery, but all previously encrypted connections will be erased to protect privacy. You will need to configure your database URI again.' },
    { q: t('vault.faq.q3') || 'Can the server admin see my database?', a: t('vault.faq.a3') || 'No. Encryption occurs entirely in your browser using PBKDF2 and AES-256-GCM before transmission.' },
  ];

  // Window title & Mode theme
  const getHeaderMeta = () => {
    switch (mode) {
      case 'unlock':
        return {
          title: t('vault.locked') || 'Secured Vault',
          badge: 'AUTHENTICATION',
          accent: 'indigo',
          icon: Lock,
        };
      case 'setup':
        return {
          title: hasLegacyUri ? 'Database Migration' : (t('vault.setupVault') || 'Initialize Secure Vault'),
          badge: 'INITIALIZATION',
          accent: 'emerald',
          icon: Shield,
        };
      case 'recovery':
        return {
          title: t('vault.recovery.title') || 'Emergency Reset',
          badge: 'EMERGENCY PROTOCOL',
          accent: 'amber',
          icon: Mail,
        };
      case 'verify':
        return {
          title: t('vault.verify.title') || 'Verify Ownership',
          badge: 'MFA VERIFICATION',
          accent: 'blue',
          icon: CircleCheck,
        };
      default:
        return {
          title: 'Secured Vault',
          badge: 'ZERO-KNOWLEDGE',
          accent: 'indigo',
          icon: Shield,
        };
    }
  };

  const headerMeta = getHeaderMeta();

  // === FAQ Section ===
  const renderFAQ = () => (
    <div className="mt-6 pt-5 border-t border-white/[0.08] relative">
      <button
        type="button"
        onClick={() => setFaqOpen(faqOpen === -1 ? null : -1)}
        className="group flex items-center justify-between w-full px-3.5 py-2.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/15 rounded-xl transition-all duration-200"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
            <CircleHelp size={15} />
          </div>
          <div className="text-left">
            <span className="block text-xs font-semibold text-slate-200 tracking-tight">
              {t('vault.faq.title') || 'Security & Zero-Knowledge Architecture'}
            </span>
            <span className="block text-[10px] text-slate-400 font-medium">
              {t('vault.faq.subtitle') || 'Learn how your sensitive credentials are protected'}
            </span>
          </div>
        </div>
        <div className={`p-1 rounded-full text-slate-400 transition-transform duration-200 ${faqOpen !== null ? 'rotate-180 text-indigo-400' : ''}`}>
          <ChevronDown size={14} />
        </div>
      </button>

      <AnimatePresence>
        {faqOpen !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: 'auto', opacity: 1, marginTop: 10 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              {faqItems.map((item, i) => (
                <div
                  key={i}
                  className={`rounded-xl border transition-all duration-200 ${
                    faqOpen === i
                      ? 'bg-white/[0.05] border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                      : 'bg-white/[0.02] border-white/[0.06] hover:border-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left group"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full transition-all ${faqOpen === i ? 'bg-indigo-400 shadow-[0_0_6px_#818cf8]' : 'bg-slate-500'}`} />
                    <span className={`flex-1 text-[11px] font-semibold transition-colors ${faqOpen === i ? 'text-indigo-200' : 'text-slate-300 group-hover:text-white'}`}>
                      {item.q}
                    </span>
                    <ChevronDown size={13} className={`text-slate-500 transition-transform duration-200 ${faqOpen === i ? 'rotate-180 text-indigo-400' : ''}`} />
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
                        <div className="px-3.5 pb-3 pl-7 text-[11px] text-slate-400 leading-relaxed font-normal">
                          {item.a}
                        </div>
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

  // === VIEW 1: UNLOCK ===
  const renderUnlock = () => (
    <form onSubmit={handleUnlock} className="space-y-5 px-1 py-2">
      {/* Hero Visual */}
      <div className="text-center">
        <CryptographicVaultDial
          mode="unlock"
          activeChars={masterPassword.length}
          isUnlocking={loading}
        />

        <h2 className="text-xl font-bold tracking-tight text-white mt-3 mb-1">
          {t('vault.locked') || 'Secured Vault'}
        </h2>
        <p className="text-slate-400 text-xs max-w-[290px] mx-auto leading-relaxed">
          {t('vault.unlockNow') || 'Enter your master passphrase to derive decryption keys and access encrypted connections.'}
        </p>

        {!session && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/[0.04] border border-white/10 rounded-full text-[10px] font-mono text-slate-400">
            <Monitor size={10} className="text-indigo-400" />
            <span>GUEST MODE · LOCAL STORAGE</span>
          </div>
        )}
      </div>

      {/* Input Field with CapsLock detection */}
      <div className="space-y-3 pt-1">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              <Key size={12} className="text-indigo-400" />
              {t('vault.masterPassword') || 'Master Password'}
            </span>
            {capsLockActive && (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 rounded text-[9px] font-bold tracking-wider animate-pulse">
                <AlertCircle size={10} /> CAPS LOCK ON
              </span>
            )}
          </div>

          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500/30 via-cyan-500/30 to-purple-500/30 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-300 pointer-events-none" />
            <div className="relative flex items-center bg-[#0d1222]/90 border border-white/10 group-focus-within:border-indigo-500/60 rounded-xl overflow-hidden shadow-inner transition-all">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => {
                  setMasterPassword(e.target.value);
                  playVaultAudio('click');
                }}
                onKeyDown={handleKeyModifierCheck}
                onKeyUp={handleKeyModifierCheck}
                placeholder={t('vault.masterPassword') || 'Enter your passphrase...'}
                className="w-full px-3.5 py-3 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm font-medium tracking-wide"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="px-3.5 text-slate-400 hover:text-white transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Error notification banner */}
        {error && (
          <motion.div
            key={shakeKey}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 shadow-lg backdrop-blur-sm"
          >
            <TriangleAlert size={14} className="shrink-0 text-rose-400" />
            <span className="font-medium text-[11px] leading-tight">{error}</span>
          </motion.div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !masterPassword}
          className="w-full py-3 px-5 relative group overflow-hidden rounded-xl font-bold text-white text-sm shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_30px_rgba(99,102,241,0.55)] active:scale-[0.99] transition-all disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 transition-transform duration-300 group-hover:scale-105" />
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center justify-center gap-2">
            {loading ? (
              <>
                <LoaderCircle size={16} className="animate-spin" />
                <span>{t('vault.unlocking') || 'Deriving Keys & Decrypting...'}</span>
              </>
            ) : (
              <>
                <Unlock size={16} />
                <span>{t('vault.unlockVault') || 'Unlock Dashboard'}</span>
              </>
            )}
          </div>
        </button>

        {/* Secondary Links */}
        <div className="flex items-center justify-between pt-1 px-1 text-xs">
          <button
            type="button"
            onClick={() => { setMode('recovery'); setError(''); }}
            className="text-slate-400 hover:text-indigo-400 transition-colors font-medium text-[11px]"
          >
            {t('vault.forgotPassword') || 'Forgot Master Password?'}
          </button>

          <button
            type="button"
            onClick={dismissVault}
            className="text-slate-400 hover:text-slate-200 transition-colors font-medium text-[11px]"
          >
            {t('vault.unlockLater') || 'Use Manual Mode'}
          </button>
        </div>
      </div>

      {renderFAQ()}
    </form>
  );

  // === VIEW 2: SETUP ===
  const renderSetup = () => (
    <form onSubmit={handleSetup} className="space-y-4 px-1 py-2">
      {/* Hero Visual */}
      <div className="text-center">
        <CryptographicVaultDial mode="setup" activeChars={masterPassword.length} />

        <h2 className="text-xl font-bold tracking-tight text-white mt-3 mb-1">
          {session
            ? (hasLegacyUri ? 'Database Migration' : (t('vault.setupVault') || 'Initialize Secure Vault'))
            : (t('vault.localVault') || 'Local Vault Setup')}
        </h2>
        <p className="text-slate-400 text-xs max-w-[320px] mx-auto leading-relaxed">
          {t('vault.setupDescription') || 'Configure your target database URI and create a zero-knowledge master passphrase.'}
        </p>
      </div>

      <div className="space-y-3.5 pt-1">
        {/* Database Protocol Picker Tabs */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
            Database Engine & Protocol
          </label>
          <div className="grid grid-cols-3 gap-2">
            {DATABASE_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const isSelected = activePreset?.id === preset.id || (!activePreset && preset.id === 'mongodb' && !mongoUri);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setMongoUri(preset.defaultUri);
                    playVaultAudio('click');
                  }}
                  className={`flex flex-col items-center justify-center py-2 px-2 rounded-xl border text-center transition-all ${
                    isSelected
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                      : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon size={16} className={isSelected ? 'text-emerald-400' : 'text-slate-400'} />
                  <span className="text-xs font-semibold mt-1">{preset.label}</span>
                  <span className="text-[9px] text-slate-500 font-mono">Port {preset.port}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Database URI Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
            <span className="uppercase tracking-wider">
              {activePreset ? `${activePreset.label} Connection URI` : 'Database URI'}
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {activePreset ? `${activePreset.protocol}...` : 'mongodb:// | postgres:// | mysql://'}
            </span>
          </div>
          <div className="relative group">
            <div className="relative flex items-center bg-[#0d1222]/90 border border-white/10 group-focus-within:border-emerald-500/50 rounded-xl overflow-hidden shadow-inner transition-all">
              <div className="pl-3 text-slate-500">
                <Database size={15} />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={mongoUri}
                onChange={(e) => setMongoUri(e.target.value)}
                placeholder="mongodb://username:password@hostname:27017/dbname"
                className="w-full px-3 py-2.5 bg-transparent text-white placeholder-slate-500 focus:outline-none text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Master Password Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
            <span className="uppercase tracking-wider">
              {t('vault.masterPassword') || 'Choose Master Passphrase'}
            </span>
            {capsLockActive && (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 rounded text-[9px] font-bold tracking-wider animate-pulse">
                <AlertCircle size={10} /> CAPS LOCK ON
              </span>
            )}
          </div>
          <div className="relative group">
            <div className="relative flex items-center bg-[#0d1222]/90 border border-white/10 group-focus-within:border-emerald-500/50 rounded-xl overflow-hidden shadow-inner transition-all">
              <input
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => {
                  setMasterPassword(e.target.value);
                  playVaultAudio('click');
                }}
                onKeyDown={handleKeyModifierCheck}
                onKeyUp={handleKeyModifierCheck}
                placeholder={t('vault.atLeast8') || 'Minimum 8 characters (mixed symbols)'}
                className="w-full px-3.5 py-2.5 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm font-medium"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="px-3 text-slate-400 hover:text-white transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Real-time Password Entropy Meter */}
          {masterPassword && (
            <div className="space-y-1 pt-1 px-1">
              <div className="flex items-center justify-between text-[10px] font-semibold">
                <span className="text-slate-400">PASSPHRASE ENTROPY</span>
                <span className={`font-bold tracking-wider ${strength.text}`}>{strength.label}</span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((lvl) => (
                  <div
                    key={lvl}
                    className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                      lvl <= strength.score ? strength.color : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password Input with Match Indicator */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 px-1">
            <span className="uppercase tracking-wider">
              {t('vault.confirmPassword') || 'Confirm Master Passphrase'}
            </span>
            {confirmPassword && (
              <span className={`text-[10px] font-semibold flex items-center gap-1 ${
                masterPassword === confirmPassword ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {masterPassword === confirmPassword ? (
                  <><Check size={11} /> Passphrases match</>
                ) : (
                  <><X size={11} /> Mismatch</>
                )}
              </span>
            )}
          </div>
          <div className="relative group">
            <div className="relative flex items-center bg-[#0d1222]/90 border border-white/10 group-focus-within:border-emerald-500/50 rounded-xl overflow-hidden shadow-inner transition-all">
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  playVaultAudio('click');
                }}
                onKeyDown={handleKeyModifierCheck}
                onKeyUp={handleKeyModifierCheck}
                placeholder={t('vault.confirmPassword') || 'Re-enter passphrase'}
                className="w-full px-3.5 py-2.5 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm font-medium"
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {/* Error notification banner */}
        {error && (
          <motion.div
            key={shakeKey}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 shadow-lg backdrop-blur-sm"
          >
            <TriangleAlert size={14} className="shrink-0 text-rose-400" />
            <span className="font-medium text-[11px] leading-tight">{error}</span>
          </motion.div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={dismissVault}
            className="flex-1 py-3 px-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl text-slate-300 hover:text-white text-xs font-semibold transition-all"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={loading || !mongoUri || !masterPassword || !confirmPassword || masterPassword !== confirmPassword}
            className="flex-[2] py-3 px-4 relative group overflow-hidden rounded-xl font-bold text-white text-xs shadow-[0_4px_20px_rgba(16,185,129,0.35)] hover:shadow-[0_4px_30px_rgba(16,185,129,0.55)] active:scale-[0.99] transition-all disabled:opacity-40 disabled:shadow-none"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 transition-transform duration-300 group-hover:scale-105" />
            <div className="relative flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <LoaderCircle size={15} className="animate-spin" />
                  <span>{hasLegacyUri ? (t('vault.migrating') || 'Migrating...') : (t('vault.encrypting') || 'Encrypting & Initializing...')}</span>
                </>
              ) : (
                <>
                  <Shield size={15} />
                  <span>{hasLegacyUri ? (t('vault.secureNow') || 'Complete Migration') : (t('vault.createVault') || 'Initialize Vault')}</span>
                </>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Privacy Notice Card */}
      <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-start gap-2.5 mt-3">
        <Shield size={16} className="text-indigo-400 mt-0.5 shrink-0" />
        <div className="text-[11px] leading-relaxed text-slate-300">
          <strong className="text-white block font-semibold mb-0.5">
            {t('vault.privacyFirst') || 'Zero-Knowledge Security Boundary'}
          </strong>
          {t('vault.privacyDesc') || 'Your credentials never leave this browser unencrypted. The server only stores non-decryptable encrypted ciphertext blobs.'}
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
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md rounded-2xl p-4"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 8 }}
              className="bg-[#0f172a] border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-2xl max-w-sm w-full"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 border border-amber-500/30">
                  <Zap size={18} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {t('vault.relay.reminderTitle') || 'Local Relay Agent Required'}
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {t('vault.relay.reminderDesc') || 'Your URI points to localhost. Remote deployments cannot reach your private machine without the Local Relay Agent.'}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-200/90 leading-relaxed font-mono">
                {t('vault.relay.reminderHint') || 'Go to Settings → Database → Local Relay to pair your agent in 30 seconds.'}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowRelayReminder(false);
                    setPendingSetup(null);
                    dismissVault();
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('open-relay-wizard'));
                    }, 60);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-amber-500/20"
                >
                  {t('vault.relay.setupRelay') || 'Setup Relay Agent'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowRelayReminder(false);
                    if (pendingSetup) await continueSetup(pendingSetup.uri, pendingSetup.tunnelConfig, true);
                    setPendingSetup(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-all"
                >
                  {t('vault.relay.continueAnyway') || 'Continue Anyway'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );

  // === VIEW 3: RECOVERY (Emergency Reset Request) ===
  const renderRecovery = () => (
    <div className="space-y-5 px-1 py-2">
      <div className="text-center">
        <CryptographicVaultDial mode="recovery" />

        <h2 className="text-xl font-bold tracking-tight text-white mt-3 mb-1">
          {t('vault.recovery.title') || 'Account Recovery'}
        </h2>
        <p className="text-slate-400 text-xs max-w-[300px] mx-auto leading-relaxed">
          {t('vault.recovery.desc') || 'A 6-digit one-time verification token will be dispatched to your registered email.'}
        </p>
      </div>

      {/* Critical Caution Banner */}
      <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-start gap-3">
        <TriangleAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
            {t('vault.recovery.warning') || 'Critical Security Warning'}
          </h4>
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            {t('vault.recovery.warningDetail') || 'Resetting the vault erases previously encrypted credentials because the original key cannot be recovered. You will need to re-enter your database URI.'}
          </p>
        </div>
      </div>

      {error && (
        <motion.div
          key={shakeKey}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 shadow-lg backdrop-blur-sm"
        >
          <TriangleAlert size={14} className="shrink-0 text-rose-400" />
          <span className="font-medium text-[11px] leading-tight">{error}</span>
        </motion.div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => { setMode('unlock'); setError(''); }}
          className="flex-1 py-3 px-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl text-slate-300 hover:text-white text-xs font-semibold transition-all"
        >
          {t('vault.recovery.back') || 'Go Back'}
        </button>
        <button
          type="button"
          onClick={handleRequestRecovery}
          disabled={loading || resendCooldown > 0}
          className="flex-[2] py-3 px-4 relative group overflow-hidden rounded-xl font-bold text-white text-xs shadow-[0_4px_20px_rgba(245,158,11,0.35)] hover:shadow-[0_4px_30px_rgba(245,158,11,0.55)] active:scale-[0.99] transition-all disabled:opacity-40"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 transition-transform duration-300 group-hover:scale-105" />
          <div className="relative flex items-center justify-center gap-2">
            {loading ? (
              <>
                <LoaderCircle size={15} className="animate-spin" />
                <span>{t('vault.recovery.sending') || 'Dispatching Code...'}</span>
              </>
            ) : (
              <>
                <Mail size={15} />
                <span>{resendCooldown > 0 ? `Wait ${resendCooldown}s` : (t('vault.recovery.sendCode') || 'Request Recovery Code')}</span>
              </>
            )}
          </div>
        </button>
      </div>
    </div>
  );

  // === VIEW 4: VERIFY (Segmented 6-digit OTP) ===
  const renderVerify = () => {
    const codeChars = (recoveryCode + '      ').slice(0, 6).split('');

    return (
      <form onSubmit={handleVerifyCode} className="space-y-5 px-1 py-2">
        <div className="text-center">
          <CryptographicVaultDial mode="verify" />

          <h2 className="text-xl font-bold tracking-tight text-white mt-3 mb-1">
            {t('vault.verify.title') || 'Verify Ownership'}
          </h2>
          <p className="text-slate-400 text-xs max-w-[300px] mx-auto leading-relaxed">
            {t('vault.verify.sentTo') || 'Enter the 6-digit code dispatched to:'}
            <br />
            <span className="text-blue-400 font-mono font-bold tracking-wide">{recoveryEmail}</span>
          </p>
        </div>

        {/* 6-Digit Segmented OTP Input */}
        <div className="space-y-3">
          <div className="flex justify-center gap-2.5 sm:gap-3" onPaste={handleOtpPaste}>
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const char = codeChars[index]?.trim() || '';
              return (
                <input
                  key={index}
                  ref={(el) => { otpInputRefs.current[index] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={char}
                  onChange={(e) => handleOtpBoxChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpBoxKeyDown(index, e)}
                  className={`w-11 h-14 sm:w-12 sm:h-14 text-center text-xl font-mono font-black rounded-xl border transition-all ${
                    char
                      ? 'bg-blue-500/15 border-blue-400 text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                      : 'bg-[#0d1222]/90 border-white/10 text-slate-400 focus:border-blue-400/70 focus:bg-white/[0.04]'
                  } focus:outline-none`}
                />
              );
            })}
          </div>

          {error && (
            <motion.div
              key={shakeKey}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 shadow-lg backdrop-blur-sm"
            >
              <TriangleAlert size={14} className="shrink-0 text-rose-400" />
              <span className="font-medium text-[11px] leading-tight">{error}</span>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => { setMode('recovery'); setError(''); setRecoveryCode(''); }}
              className="flex-1 py-3 px-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl text-slate-300 hover:text-white text-xs font-semibold transition-all"
            >
              {t('vault.recovery.back') || 'Go Back'}
            </button>
            <button
              type="submit"
              disabled={loading || recoveryCode.trim().length !== 6}
              className="flex-[2] py-3 px-4 relative group overflow-hidden rounded-xl font-bold text-white text-xs shadow-[0_4px_20px_rgba(59,130,246,0.35)] hover:shadow-[0_4px_30px_rgba(59,130,246,0.55)] active:scale-[0.99] transition-all disabled:opacity-40"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 transition-transform duration-300 group-hover:scale-105" />
              <div className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" />
                    <span>{t('vault.verify.verifying') || 'Verifying Token...'}</span>
                  </>
                ) : (
                  <>
                    <CircleCheck size={15} />
                    <span>{t('vault.verify.verifyReset') || 'Confirm Verification'}</span>
                  </>
                )}
              </div>
            </button>
          </div>

          {/* Resend Cooldown Button */}
          <div className="text-center pt-1">
            <button
              type="button"
              onClick={handleRequestRecovery}
              disabled={loading || resendCooldown > 0}
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-blue-400 disabled:text-slate-600 text-[11px] font-semibold transition-colors"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              <span>
                {resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : (t('vault.verify.resend') || 'Resend verification code')}
              </span>
            </button>
          </div>
        </div>
      </form>
    );
  };

  const renderContent = () => {
    switch (mode) {
      case 'unlock': return renderUnlock();
      case 'setup': return renderSetup();
      case 'recovery': return renderRecovery();
      case 'verify': return renderVerify();
      default: return renderUnlock();
    }
  };

  // Mobile Bottom Sheet
  if (isMobile) {
    return (
      <div
        className="fixed inset-0 flex items-end"
        style={{ background: 'rgba(0,0,0,0.65)', zIndex: 90000, backdropFilter: 'blur(8px)' }}
      >
        <div
          className="w-full max-h-[92vh] flex flex-col overflow-hidden rounded-t-3xl border-t border-white/10 shadow-2xl"
          style={{ background: '#0a0e1a' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{headerMeta.title}</span>
            </div>
            <button
              type="button"
              onClick={() => dismissVault?.()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {renderContent()}
          </div>
        </div>
      </div>
    );
  }

  // Desktop Centered Immersive Modal
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="vault-immersive-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[90000] flex items-center justify-center p-4 overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(10,14,28,0.92) 0%, rgba(2,4,10,0.98) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* Ambient atmospheric lighting */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[480px] rounded-full bg-indigo-600/15 blur-[150px]" />
          <div className="absolute -bottom-48 -right-24 w-[520px] h-[400px] rounded-full bg-blue-600/15 blur-[140px]" />
          <div className="absolute top-1/3 -left-32 w-[380px] h-[380px] rounded-full bg-purple-600/10 blur-[130px]" />

          {/* Micro-grid layer */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          <Particles count={24} />

          {/* Vignette */}
          <div
            className="absolute inset-0"
            style={{ boxShadow: 'inset 0 0 200px rgba(0,0,0,0.85)' }}
          />
        </div>

        {/* Modal Card — materializes seamlessly out of the warp exit */}
        <motion.div
          initial={{ scale: 0.92, y: 16, opacity: 0, filter: 'blur(6px)' }}
          animate={
            isBooted
              ? { scale: 1, y: 0, opacity: 1, filter: 'blur(0px)' }
              : { scale: 0.92, y: 16, opacity: 0, filter: 'blur(6px)' }
          }
          exit={{ scale: 0.94, y: 16, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 140, damping: 22, mass: 0.8 }}
          className={`relative z-10 w-full max-w-lg ${shakeKey ? 'vault-shake' : ''}`}
          key={shakeKey ? `shake-${shakeKey}` : 'vault-card'}
        >
          {/* Subtle Outer Neon Rim */}
          <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-b from-indigo-400/40 via-white/5 to-transparent pointer-events-none" />
          <div className="absolute -inset-6 rounded-[36px] bg-indigo-500/10 blur-2xl pointer-events-none" />

          <div
            className="relative rounded-3xl overflow-hidden border border-white/10 shadow-[0_30px_100px_rgba(0,0,0,0.9)]"
            style={{
              background: 'linear-gradient(180deg, rgba(16,21,38,0.94) 0%, rgba(9,12,23,0.98) 100%)',
            }}
          >
            {/* Header Strip */}
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.08] bg-black/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 shrink-0 rounded-xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center">
                  <headerMeta.icon size={16} className="text-indigo-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate flex items-center gap-2">
                    <span>{headerMeta.title}</span>
                    <span className="text-[9px] font-mono font-normal text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-500/20">
                      {headerMeta.badge}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[8px] font-mono uppercase tracking-wider text-emerald-400/90 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    AES-256-GCM · ZERO-KNOWLEDGE BOUNDARY
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissVault?.()}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Subtle scanline */}
            <div
              className="absolute left-0 right-0 h-px pointer-events-none opacity-30"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(129,140,248,0.4), transparent)',
                animation: 'boot-scanline 6s linear infinite',
              }}
            />

            {/* Modal Body */}
            <div className="p-6 max-h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar">
              {renderContent()}
            </div>

            {/* Trust Footer */}
            <div className="px-5 py-2.5 border-t border-white/[0.06] bg-black/40 flex items-center justify-center gap-4 text-[8px] font-mono uppercase tracking-[1.5px] text-slate-500">
              <span className="flex items-center gap-1">
                <Shield size={9} className="text-indigo-400" />
                Local Decryption Only
              </span>
              <span>·</span>
              <span>No Cloud Key Storage</span>
              <span>·</span>
              <span>PBKDF2-HMAC-SHA256</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
