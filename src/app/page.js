'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import LandingPage from '@/components/landing';
import { BootSequence } from '@/components/landing/BootSequence';
import { HyperspaceTransition } from '@/components/landing/HyperspaceTransition';
import { AnimatePresence, motion } from 'framer-motion';

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
      {/* Desktop Environment rendered underneath */}
      {DesktopEnvironment && bootPhase !== 'boot' && (
        <motion.div 
          className="w-full h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <DesktopEnvironment bootPhase={bootPhase} />
        </motion.div>
      )}

      <AnimatePresence>
        {bootPhase === 'boot' && (
          <motion.div
            key="boot"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
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
            className="fixed inset-0 z-[9998] overflow-hidden bg-black"
          >
            <HyperspaceTransition onComplete={handleWarpComplete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
