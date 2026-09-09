'use client';

import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkIsMobile = () => {
      const next = window.innerWidth < breakpoint;
      // Guard against redundant re-renders — only update when value changes
      setIsMobile(prev => (prev === next ? prev : next));
    };

    // Initial check
    checkIsMobile();

    // Debounce resize handler: orientation changes and zoom gestures fire
    // dozens of events per second; debouncing to 100ms prevents a re-render
    // storm that visibly lags the UI on mid-range phones.
    let debounceTimer;
    const handleResize = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkIsMobile, 100);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(debounceTimer);
    };
  }, [breakpoint]);

  return isMobile;
}
