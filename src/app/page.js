'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import LandingPage from '@/components/landing';
import { BootSequence } from '@/components/landing/BootSequence';
import { HyperspaceTransition } from '@/components/landing/HyperspaceTransition';
import { AnimatePresence } from 'framer-motion';

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

  // Start loading DesktopEnvironment as soon as session is known (parallel with boot animation)
  useEffect(() => {
    if (session && !desktopLoadStarted.current) {
      desktopLoadStarted.current = true;
      import('@/components/Desktop/DesktopEnvironment').then((mod) => {
        setDesktopEnvironment(() => mod.default);
      });
    }
  }, [session]);

  // --- Render ---

  if (status === 'loading') {
    return <div className="fixed inset-0" style={{ background: '#0a0e1a' }} />;
  }

  // Guest: show landing page (unchanged)
  if (shouldShowLanding) {
    return <LandingPage onDismiss={() => setDismissed(true)} />;
  }

  // Logged-in boot sequence
  if (bootPhase === 'boot') {
    return (
      <div className="fixed inset-0 z-[9999] overflow-hidden bg-black">
        <BootSequence
          onComplete={() => setBootPhase('warp')}
          onSkip={() => setBootPhase('warp')}
        />
      </div>
    );
  }

  if (bootPhase === 'warp') {
    return (
      <div className="fixed inset-0 z-[9999] overflow-hidden bg-black">
        <HyperspaceTransition onComplete={() => setBootPhase('desktop')} />
      </div>
    );
  }

  // Desktop — show blank bg while module loads if needed
  if (!DesktopEnvironment) {
    return <div className="fixed inset-0" style={{ background: '#0a0e1a' }} />;
  }

  return <DesktopEnvironment />;
}
