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
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(
          (registration) => {
            console.log('SW registered: ', registration);
          },
          (registrationError) => {
            console.log('SW registration failed: ', registrationError);
          }
        );
      });
    }
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
