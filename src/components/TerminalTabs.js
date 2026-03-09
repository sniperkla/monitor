'use client';

import TmuxLayout from '@/components/TmuxLayout';

/**
 * TerminalTabs — now delegated to TmuxLayout for a tmux-like split-pane experience.
 * All terminal management (pane creation, splitting, closing) is handled by TmuxLayout.
 */
export default function TerminalTabs({ windowId }) {
  return <TmuxLayout windowId={windowId} isTmuxMode={false} />;
}
