'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import LandingPage from '@/components/landing';

export default function Home() {
  const { data: session, status } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [showDesktop, setShowDesktop] = useState(false);
  const [DesktopEnvironment, setDesktopEnvironment] = useState(null);

  const shouldShowLanding = status !== 'loading' && !session && !dismissed;

  useEffect(() => {
    if (!shouldShowLanding && !DesktopEnvironment) {
      import('@/components/Desktop/DesktopEnvironment').then((mod) => {
        setDesktopEnvironment(() => mod.default);
        setShowDesktop(true);
      });
    }
  }, [shouldShowLanding, DesktopEnvironment]);

  if (status === 'loading') {
    return <div className="fixed inset-0" style={{ background: '#0a0e1a' }} />;
  }

  if (shouldShowLanding) {
    return <LandingPage onDismiss={() => setDismissed(true)} />;
  }

  if (!DesktopEnvironment) {
    return <div className="fixed inset-0" style={{ background: '#0a0e1a' }} />;
  }

  return <DesktopEnvironment />;
}
