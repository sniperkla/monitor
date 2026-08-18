'use client';

import { SessionProvider } from "next-auth/react";
import { AppProvider } from "@/context/AppContext";
import { OSProvider } from "@/context/OSContext";
import { VaultProvider } from "@/context/VaultContext";
import { useEffect, useState } from "react";
import '@/lib/i18n';
import AppRateLimitBanner from '@/components/AppRateLimitBanner';

/**
 * Fixed bottom-right overlay that surfaces only when usage reaches ≥ 80%.
 * Below that threshold it is completely absent from the DOM — zero visual noise
 * during normal use.
 */
function GlobalRateLimitOverlay() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Listen for usage updates broadcast by AppRateLimitBanner's shared cache
  useEffect(() => {
    // Poll the status lightly — the component itself handles the actual fetch
    const check = () => {
      try {
        const raw = localStorage.getItem('_rl_cache');
        if (!raw) return;
        const d = JSON.parse(raw);
        if (d?.percentage >= 80) setShow(true);
      } catch { /* ignore */ }
    };

    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[9998] w-72 p-3 rounded-2xl bg-[#0d1117]/95 border border-white/10 shadow-2xl backdrop-blur-md">
      <AppRateLimitBanner className="mb-0" />
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 text-slate-600 hover:text-slate-400 text-xs leading-none"
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}

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
            {/* Global daily quota banner — fixed bottom-right, only visible when usage ≥ 80% */}
            <GlobalRateLimitOverlay />
          </AppProvider>
        </OSProvider>
      </VaultProvider>
    </SessionProvider>
  );
}
