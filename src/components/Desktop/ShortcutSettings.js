'use client';

import { useOS } from '@/context/OSContext';
import { useState, useEffect } from 'react';
import { Keyboard, X, Save } from 'lucide-react';

export default function ShortcutSettings({ isOpen, onClose }) {
  const { state, setKeyboardShortcuts, saveSettings } = useOS();
  const { keyboardShortcuts } = state;
  const [shortcuts, setShortcuts] = useState({
    previewWindow: 'Ctrl+Cmd+Up',
    prevDesktop: 'Ctrl+Cmd+Left',
    nextDesktop: 'Ctrl+Cmd+Right',
    minimizeAll: 'Ctrl+Cmd+M',
    closeAll: 'Ctrl+Cmd+W',
  });

  // Load shortcuts from state on mount
  useEffect(() => {
    if (keyboardShortcuts) {
      setShortcuts(keyboardShortcuts);
    }
  }, [keyboardShortcuts]);

  const saveShortcuts = async () => {
    try {
      setKeyboardShortcuts(shortcuts);
      await saveSettings();
      console.log('Shortcuts saved:', shortcuts);
      onClose();
    } catch (error) {
      console.error('Failed to save shortcuts:', error);
    }
  };

  const updateShortcut = (key, value) => {
    setShortcuts(prev => ({ ...prev, [key]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-[var(--bg-primary-overlay)]">
      <div className="bg-[var(--window-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl max-w-md w-full">
        {/* Title Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)] rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--text-secondary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Keyboard Shortcuts</span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-[#ff5f57] border border-black/10 dark:border-[#e0443e]/30 flex items-center justify-center hover:bg-[#ff6b6b] transition-colors"
          >
            <X size={12} className="text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Open Preview</span>
              <input
                type="text"
                value={shortcuts.previewWindow}
                onChange={(e) => updateShortcut('previewWindow', e.target.value)}
                className="px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] w-32"
                placeholder="Ctrl+Cmd+Up"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Previous Desktop</span>
              <input
                type="text"
                value={shortcuts.prevDesktop}
                onChange={(e) => updateShortcut('prevDesktop', e.target.value)}
                className="px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] w-32"
                placeholder="Ctrl+Cmd+Left"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Next Desktop</span>
              <input
                type="text"
                value={shortcuts.nextDesktop}
                onChange={(e) => updateShortcut('nextDesktop', e.target.value)}
                className="px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] w-32"
                placeholder="Ctrl+Cmd+Right"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Minimize All</span>
              <input
                type="text"
                value={shortcuts.minimizeAll}
                onChange={(e) => updateShortcut('minimizeAll', e.target.value)}
                className="px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] w-32"
                placeholder="Ctrl+Cmd+M"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Close All</span>
              <input
                type="text"
                value={shortcuts.closeAll}
                onChange={(e) => updateShortcut('closeAll', e.target.value)}
                className="px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] w-32"
                placeholder="Ctrl+Cmd+W"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-color)]">
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Format: Ctrl+Cmd+[Key]. Use arrow keys for navigation: ArrowUp, ArrowLeft, ArrowRight.
            </p>
            
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveShortcuts}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
