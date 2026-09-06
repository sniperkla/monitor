'use client';

import { RevealScreen } from './RevealScreen';

// Guests see the login screen directly.
// The boot sequence + handshake runs after login via BootSequence in page.js.
export default function LandingPage({ onDismiss }) {
  return (
    // This element owns the scroll. It was `overflow-hidden`, which meant the
    // reveal screen could not scroll at all — on a short viewport, or a phone
    // with the on-screen keyboard up, everything below the fold was simply
    // unreachable. Vertical scroll happens here; the scene backgrounds inside
    // RevealScreen are `fixed`, so they hold still while the content moves
    // over them.
    // `data-scroll-root` lets RevealScreen's scroll engine find this element
    // (scroll events here do not reach `window` listeners without capture).
    <div
      data-scroll-root
      className="fixed inset-0 z-[9999] overflow-y-auto overflow-x-hidden overscroll-contain bg-black select-none"
    >
      <RevealScreen onDismiss={onDismiss} />
    </div>
  );
}
