'use client';

import { RevealScreen } from './RevealScreen';

// Guests see the login screen directly.
// The boot sequence + warp runs after login via BootSequence in page.js.
export default function LandingPage({ onDismiss }) {
  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black select-none">
      <RevealScreen onDismiss={onDismiss} />
    </div>
  );
}
