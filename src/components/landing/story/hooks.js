'use client';

import { useState, useEffect } from 'react';

/**
 * True when the primary pointer cannot hover — phones, tablets, touch
 * laptops. Gates the tilt/parallax (a drag would leave content stranded at
 * the last offset) and halves the particle field. Resolved in an effect so
 * the first client render still matches the server HTML.
 */
function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouch(window.matchMedia('(hover: none), (pointer: coarse)').matches);
  }, []);
  return touch;
}

/** Pauses the field when the tab is hidden — an unseen canvas is pure waste. */
function useDocumentVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}


export { useIsTouch, useDocumentVisible };
