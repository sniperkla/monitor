'use client';

import { SessionProvider } from "next-auth/react";
import { AppProvider } from "@/context/AppContext";
import { OSProvider } from "@/context/OSContext";
import { VaultProvider } from "@/context/VaultContext";
import { useEffect } from "react";
import '@/lib/i18n';
// Side-effect import: installs the CSRF header shim over window.fetch as early
// as possible, before any component issues a state-changing request.
import '@/utils/csrfClient';
import { ensureCsrfTokenOnMount } from '@/utils/csrfClient';

export function Providers({ children }) {
  // Prime the CSRF cookie so the first POST does not need an extra roundtrip.
  useEffect(() => {
    ensureCsrfTokenOnMount();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleLoad = () => {
      // In development mode, unregister workers to prevent caching interference
      if (process.env.NODE_ENV !== 'production') {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
        return;
      }

      // In production mode, register SW for PWA support
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
        console.warn('SW registration failed:', err);
      });
    };

    if (document.readyState === 'complete') {
      handleLoad();
    } else {
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, []);

  return (
    <SessionProvider>
      <VaultProvider>
        <OSProvider>
          <AppProvider>
            {children}
          </AppProvider>
        </OSProvider>
      </VaultProvider>
    </SessionProvider>
  );
}
