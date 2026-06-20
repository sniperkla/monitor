'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';
import { BootScreen } from './BootScreen';
import { HyperspaceTransition } from './HyperspaceTransition';
import { RevealScreen } from './RevealScreen';

export default function LandingPage({ onDismiss }) {
  const [phase, setPhase] = useState('boot');
  const [showPowerOff, setShowPowerOff] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

  const handleBootComplete = useCallback(() => {
    setShowPowerOff(true);
  }, []);

  const handleShatterComplete = useCallback(() => {
    setShowPowerOff(false);
    setPhase('reveal');
    setShowReveal(true);
  }, []);

  const handleSkip = useCallback(() => {
    setPhase('reveal');
    setShowPowerOff(false);
    setShowReveal(true);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black select-none">
      <AnimatePresence>
        {phase === 'boot' && !showPowerOff && (
          <motion.div key="boot" exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="absolute inset-0">
            <BootScreen onComplete={handleBootComplete} onSkip={handleSkip} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPowerOff && <HyperspaceTransition key="warp" onComplete={handleShatterComplete} />}
      </AnimatePresence>

      <AnimatePresence>
        {showReveal && (
          <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} className="absolute inset-0">
            <RevealScreen onDismiss={onDismiss} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
