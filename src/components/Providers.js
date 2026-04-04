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
    window.addEventListener('load', () => {
      // In dev mode, unregister any existing service workers to prevent stale
      // workers from intercepting blob: URLs (used by Three.js GLTFLoader).
      if (process.env.NODE_ENV !== 'production') {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
        return;
      }
      // In production, register with immediate update check
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(
        (registration) => {
          registration.update(); // force check for new SW
          console.log('SW registered: ', registration);
        },
        (registrationError) => {
          console.log('SW registration failed: ', registrationError);
        }
      );
    });
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
