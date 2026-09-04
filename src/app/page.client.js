'use client';

import { useState, Component } from 'react';
import { useSession } from 'next-auth/react';
import LandingPage from '@/components/landing';
import { BootSequence } from '@/components/landing/BootSequence';
import { AnimatePresence, motion } from 'framer-motion';

import dynamic from 'next/dynamic';

const DesktopEnvironment = dynamic(() => import('@/components/Desktop/DesktopEnvironment'), {
  ssr: false,
});

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

// Boot phases for logged-in users: preflight → desktop
// Guests keep the existing landing flow

export default function Home() {
  const { data: session, status } = useSession();
  const [dismissed, setDismissed] = useState(false);

  // Guest landing flow
  const shouldShowLanding = status !== 'loading' && !session && !dismissed;

  // Logged-in boot flow
  const [flowPhase, setFlowPhase] = useState('preflight'); // 'preflight' | 'desktop'

  // --- Render ---

  // Session still loading — show boot screen as placeholder
  if (status === 'loading') {
    return (
      <div className="fixed inset-0 z-[100000] overflow-hidden bg-black">
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
            <DesktopEnvironment bootPhase={flowPhase} />
          </DesktopErrorBoundary>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {flowPhase === 'preflight' && (
          <motion.div
            key="preflight"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[100000] overflow-hidden bg-black"
          >
            <BootSequence
              onComplete={() => setFlowPhase('desktop')}
              onSkip={() => setFlowPhase('desktop')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
