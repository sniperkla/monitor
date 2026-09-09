'use client';

import { useState, useEffect } from 'react';

/**
 * Returns `true` while the document is visible (foreground tab / active PWA),
 * `false` when the user switches tabs, minimises the app, or locks their phone.
 *
 * Usage pattern in polling effects:
 *
 *   const isVisible = usePageVisibility();
 *   useEffect(() => {
 *     if (!isVisible) return;          // skip expensive fetch when hidden
 *     const id = setInterval(poll, 5000);
 *     return () => clearInterval(id);
 *   }, [isVisible, ...]);
 */
export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? !document.hidden : true,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return isVisible;
}
