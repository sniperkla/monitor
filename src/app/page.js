'use client';

import { useState, useEffect, useRef, Component } from 'react';
import { useSession } from 'next-auth/react';
import LandingPage from '@/components/landing';
import { BootSequence } from '@/components/landing/BootSequence';
import { HyperspaceTransition } from '@/components/landing/HyperspaceTransition';
import { AnimatePresence, motion } from 'framer-motion';

class DesktopErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error('[DesktopErrorBoundary]', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#0a0e1a] flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <span className="text-2xl">⚠</span>
            </div>
            <h1 className="text-xl font-bold text-slate-100">Something went wrong</h1>
            <p className="text-sm text-slate-400">The desktop failed to load. This may be due to memory limits on your device.</p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-sm transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Boot phases for logged-in users: boot → warp → desktop
// Guests keep the existing landing flow

export default function Home() {
  const { data: session, status } = useSession();
  const [dismissed, setDismissed] = useState(false);

  // Guest landing flow
  const shouldShowLanding = status !== 'loading' && !session && !dismissed;

  // Logged-in boot flow
  const [bootPhase, setBootPhase] = useState('boot'); // 'boot' | 'warp' | 'desktop'
  const [DesktopEnvironment, setDesktopEnvironment] = useState(null);
  const desktopLoadStarted = useRef(false);
  const warpFinishedRef = useRef(false);

  // Start loading DesktopEnvironment as soon as session is known OR guest dismissed landing
  useEffect(() => {
    if ((session || dismissed) && !desktopLoadStarted.current) {
      desktopLoadStarted.current = true;
      import('@/components/Desktop/DesktopEnvironment').then((mod) => {
        setDesktopEnvironment(() => mod.default);
      });
    }
  }, [session, dismissed]);

  // Warp animation completed its first full cycle
  const handleWarpComplete = () => {
    warpFinishedRef.current = true;
    // Only transition if desktop is also ready
    if (DesktopEnvironment) {
      setBootPhase('desktop');
    }
  };

  // If DesktopEnvironment loads after warp finishes, transition
  useEffect(() => {
    if (DesktopEnvironment && warpFinishedRef.current && bootPhase === 'warp') {
      setBootPhase('desktop');
    }
  }, [DesktopEnvironment, bootPhase]);

  // Safety: force-escape warp phase if it hangs (e.g. OffscreenCanvas crash on mobile)
  useEffect(() => {
    if (bootPhase !== 'warp') return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const timeout = isMobile ? 500 : 6000;
    const t = setTimeout(() => {
      if (bootPhase === 'warp') {
        warpFinishedRef.current = true;
        setBootPhase('desktop');
      }
    }, timeout);
    return () => clearTimeout(t);
  }, [bootPhase]);

  // --- Render ---

  // Session still loading — show boot screen as placeholder
  if (status === 'loading') {
    return (
      <div className="fixed inset-0 z-[9999] overflow-hidden bg-black">
        <BootSequence onComplete={() => {}} onSkip={() => {}} />
      </div>
    );
  }

  // Guest: show landing page
  if (shouldShowLanding) {
    return <LandingPage onDismiss={() => setDismissed(true)} />;
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* Desktop Environment rendered underneath — mounts early so phase transitions crossfade seamlessly */}
      {DesktopEnvironment && (
        <motion.div
          className="w-full h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.0, ease: 'easeInOut' }}
        >
          <DesktopErrorBoundary>
            <DesktopEnvironment bootPhase={bootPhase} />
          </DesktopErrorBoundary>
        </motion.div>
      )}

      <AnimatePresence>
        {bootPhase === 'boot' && (
          <motion.div
            key="boot"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeIn' }}
            className="fixed inset-0 z-[9999] overflow-hidden bg-black"
          >
            <BootSequence
              onComplete={() => setBootPhase('warp')}
              onSkip={() => setBootPhase('warp')}
            />
          </motion.div>
        )}

        {bootPhase === 'warp' && (
          <motion.div
            key="warp"
            exit={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: 'easeOut' }}
            className="fixed inset-0 z-[9998] overflow-hidden"
          >
            <HyperspaceTransition onComplete={handleWarpComplete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
