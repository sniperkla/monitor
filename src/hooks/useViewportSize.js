'use client';

import { useState, useEffect } from 'react';

/**
 * Current viewport size, re-measured on resize and orientation change.
 *
 * Exists because several components need to branch their *structure* at a
 * breakpoint, not just their styling — a media query can restyle a fixed
 * layout but it cannot reflow `label ...dots... result` into two rows. Those
 * decisions have to be made in JS.
 *
 * SSR-safe: the server and the first client paint both assume a desktop
 * viewport (1280x800), then the effect corrects on mount. This does mean a
 * narrow device renders the wide layout for one frame before swapping; that is
 * the correct trade-off here, because the alternative (rendering nothing until
 * mounted) blanks the boot sequence on every reload.
 */
export function useViewportSize() {
  const [vp, setVp] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  return vp;
}
