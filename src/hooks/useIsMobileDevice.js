'use client';

import { useEffect, useState } from 'react';

/**
 * True when the browser runs on a phone/tablet — detected via the user agent,
 * NOT viewport width (a narrow desktop window should not lose animations).
 *
 * Covers:
 *  - Android (phone & tablet)
 *  - iPhone / iPod
 *  - iPad: Safari 13+ reports itself as "Macintosh" with touch support, so a
 *    plain /iPad/ test misses it. Macintosh + maxTouchPoints > 1 = iPadOS.
 *  - Generic mobile tokens as a fallback
 */
export function useIsMobileDevice() {
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.userAgent) return;
    const ua = navigator.userAgent;
    const isIpadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    const mobile = /Android|iPhone|iPod|iPad|Mobile|Silk|Kindle/i.test(ua) || isIpadOs;
    setIsMobileDevice(mobile);
  }, []);

  return isMobileDevice;
}

/**
 * Synchronous (non-hook) variant for one-shot checks outside React render —
 * e.g. adding a class to <html> before first paint of the effect tree.
 */
export function detectMobileDevice() {
  if (typeof window === 'undefined' || !navigator.userAgent) return false;
  const ua = navigator.userAgent;
  const isIpadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPod|iPad|Mobile|Silk|Kindle/i.test(ua) || isIpadOs;
}