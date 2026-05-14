'use client';

import { SessionProvider } from "next-auth/react";
import { AppProvider } from "@/context/AppContext";
import { OSProvider } from "@/context/OSContext";
import { VaultProvider } from "@/context/VaultContext";
import MasterPasswordModal from "@/components/MasterPasswordModal";
import { useEffect } from "react";
import '@/lib/i18n';

export function Providers({ children }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const clearMonitorCaches = async () => {
      if (typeof caches === 'undefined') return;
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('webtop-monitor-'))
          .map((name) => caches.delete(name))
      );
    };

    const handleLoad = () => {
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        window.navigator.standalone === true;

      // In dev mode, unregister any existing service workers to prevent stale
      // workers from intercepting blob: URLs (used by Three.js GLTFLoader).
      if (process.env.NODE_ENV !== 'production' || !isStandalone) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
        clearMonitorCaches().catch((err) => {
          console.warn('Failed clearing monitor caches:', err);
        });
        return;
      }

      // In installed PWA mode, register with immediate update check.
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(
        (registration) => {
          registration.update(); // force check for new SW
          console.log('SW registered: ', registration);
        },
        (registrationError) => {
          console.log('SW registration failed: ', registrationError);
        }
      );
    };

    window.addEventListener('load', handleLoad);
    return () => window.removeEventListener('load', handleLoad);
  }, []);

  return (
    <SessionProvider>
      <VaultProvider>
        <OSProvider>
          <AppProvider>
            {children}
            <MasterPasswordModal />
          </AppProvider>
        </OSProvider>
      </VaultProvider>
    </SessionProvider>
  );
}
