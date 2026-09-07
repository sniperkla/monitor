'use client';

import { useEffect, useState } from 'react';
import { useOS } from '@/context/OSContext';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Monitor, Zap, Shield, Smartphone, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function detectMobileOS() {
  if (typeof window === 'undefined' || !navigator.userAgent) return null;
  const ua = navigator.userAgent;
  const isIpadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/i.test(ua) || isIpadOs) return 'ios';
  if (/Android|Mobile|Silk|Kindle/i.test(ua)) return 'android';
  return null;
}

export default function PWAHandler() {
  const { state, setDeferredPrompt } = useOS();
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  // 'android' → native beforeinstallprompt flow, 'ios' → manual instructions
  const [mobileOS, setMobileOS] = useState(null);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const hasDismissed = sessionStorage.getItem('pwa_modal_dismissed');
    const os = detectMobileOS();
    setMobileOS(os);

    // Force-install nudge for mobile users: on phones/tablets we don't wait
    // for beforeinstallprompt (iOS never fires it) — show our own guidance
    // shortly after login. Desktop keeps the old opt-in behaviour.
    if (os && !isStandalone && !hasDismissed) {
      const timer = setTimeout(() => setShowModal(true), 3000);
      return () => clearTimeout(timer);
    }

    const handleBeforeInstallPrompt = (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);

      if (session && !isStandalone && !hasDismissed) {
        // Delay slightly for better UX
        setTimeout(() => setShowModal(true), 3000);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [session, setDeferredPrompt]);

  const handleInstall = async () => {
    if (!state.deferredPrompt) return;

    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowModal(false);
    }
  };

  const handleDismiss = () => {
    setShowModal(false);
    sessionStorage.setItem('pwa_modal_dismissed', 'true');
  };

  if (!showModal) return null;
  // Desktop: unchanged behaviour — only show when the browser offered install.
  // Mobile: we show our own guidance (iOS has no programmatic install API).
  if (!mobileOS && !state.deferredPrompt) return null;

  const isIos = mobileOS === 'ios';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="relative w-full max-w-md bg-[var(--window-bg)] border border-[var(--border-color)] rounded-3xl shadow-2xl p-8 overflow-hidden"
          style={{ backdropFilter: 'blur(var(--glass-blur, 24px))' }}
        >
          {/* Decorative background elements */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />

          <button 
            onClick={handleDismiss}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/5 text-[var(--text-muted)] transition-colors"
          >
            <X size={20} />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full animate-pulse" />
              <div className="relative w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Download size={40} className="text-white" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Install SSH Monitor</h2>
            <p className="text-[var(--text-secondary)] mb-8 text-sm leading-relaxed">
              {isIos
                ? 'Add the monitor to your home screen for a native, full-screen experience — no browser bars, faster launch.'
                : 'Experience the monitor with a native look and feel. Faster loading, full-screen mode, and no browser distraction.'}
            </p>

            {isIos ? (
              /* iOS has no programmatic install API — walk the user through it */
              <div className="w-full space-y-3 mb-8 text-left">
                {[
                  { icon: <Share size={18} className="text-blue-400 shrink-0" />, text: 'Tap the Share button in Safari\u2019s toolbar' },
                  { icon: <Download size={18} className="text-emerald-400 shrink-0" />, text: 'Scroll and tap \u201cAdd to Home Screen\u201d' },
                  { icon: <Smartphone size={18} className="text-purple-400 shrink-0" />, text: 'Tap Add — launch it like a native app' },
                ].map(({ icon, text }, i) => (
                  <div key={i} className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                    {icon}
                    <span className="text-[12px] font-medium text-[var(--text-secondary)] leading-tight">{text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 w-full mb-8 text-left">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                <Shield size={18} className="text-emerald-400 shrink-0" />
                <span className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">Secure & Isolated Environment</span>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                <Zap size={18} className="text-amber-400 shrink-0" />
                <span className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">Lightning Fast Launch</span>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                <Monitor size={18} className="text-blue-400 shrink-0" />
                <span className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">True Fullscreen Experience</span>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                <Smartphone size={18} className="text-purple-400 shrink-0" />
                <span className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">Native Desktop Window</span>
              </div>
            </div>
            )}

            {!isIos && (
              <button
                onClick={handleInstall}
                className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 group"
              >
                <span>Install Now</span>
                <Download size={18} className="group-hover:translate-y-0.5 transition-transform" />
              </button>
            )}

            <button 
              onClick={handleDismiss}
              className="mt-4 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors uppercase tracking-widest"
            >
              Maybe Later
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
