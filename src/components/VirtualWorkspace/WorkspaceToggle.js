'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Box } from 'lucide-react';

const WorkspaceScene = dynamic(() => import('./WorkspaceScene'), {
  ssr: false,
  loading: () => null,
});

export default function WorkspaceToggle() {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <>
      <button
        onClick={toggle}
        className="fixed bottom-20 right-4 z-40 p-3 bg-purple-500/80 text-white rounded-full shadow-lg hover:bg-purple-500 transition-all hover:scale-110"
        title="Toggle Virtual Workspace (Ctrl+Shift+3)"
      >
        <Box size={24} />
      </button>

      {isOpen && <WorkspaceScene onClose={() => setIsOpen(false)} />}
    </>
  );
}
