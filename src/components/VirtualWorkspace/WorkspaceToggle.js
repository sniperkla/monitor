'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Box } from 'lucide-react';

const WorkspaceScene = dynamic(() => import('./WorkspaceScene'), {
  ssr: false,
  loading: () => (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: '16px',
    }}>
      Loading 3D Workspace...
    </div>
  ),
});

export default function WorkspaceToggle() {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  useEffect(() => {
    const handleToggle = () => toggle();
    window.addEventListener('toggle-virtual-workspace', handleToggle);
    return () => window.removeEventListener('toggle-virtual-workspace', handleToggle);
  }, [toggle]);

  return (
    <>
      <button
        onClick={toggle}
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '16px',
          zIndex: 40,
          padding: '12px',
          background: isOpen ? 'rgba(239, 68, 68, 0.8)' : 'rgba(168, 85, 247, 0.8)',
          color: '#fff',
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.background = isOpen ? 'rgba(239, 68, 68, 1)' : 'rgba(168, 85, 247, 1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.background = isOpen ? 'rgba(239, 68, 68, 0.8)' : 'rgba(168, 85, 247, 0.8)';
        }}
        title="Toggle Virtual Workspace (Ctrl+Shift+3)"
      >
        <Box size={24} />
      </button>

      {isOpen && <WorkspaceScene onClose={() => setIsOpen(false)} />}
    </>
  );
}
