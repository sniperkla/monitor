'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useOS } from '@/context/OSContext';
import { useState, useEffect } from 'react';
import { AlertCircle, HelpCircle, Type } from 'lucide-react';
import MacOSModalWindow from '@/components/MacOSModalWindow';

export default function DesktopModal() {
  const { state, closeModal } = useOS();
  const { modal } = state;
  const [promptValue, setPromptValue] = useState('');

  // Sync prompt value when modal opens
  useEffect(() => {
    if (modal.isOpen) {
      setPromptValue(modal.defaultValue || '');
      
      // Prevent body scroll when modal is open
      const originalStyle = window.getComputedStyle(document.body);
      const originalOverflow = originalStyle.overflow;
      const originalPaddingRight = originalStyle.paddingRight;
      
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      
      return () => {
        // Restore original styles
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [modal.isOpen, modal.defaultValue]);

  if (!modal.isOpen) return null;

  const handleConfirm = () => {
    if (modal.type === 'prompt') {
      modal.onConfirm?.(promptValue);
    } else {
      modal.onConfirm?.();
    }
    closeModal();
  };

  const handleCancel = () => {
    modal.onCancel?.();
    closeModal();
  };

  const getIcon = () => {
    switch (modal.type) {
      case 'confirm': return HelpCircle;
      case 'prompt': return Type;
      default: return AlertCircle;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-transparent"
        onClick={handleCancel}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <MacOSModalWindow
            isOpen
            title={modal.title || (modal.type === 'alert' ? 'Alert' : modal.type === 'confirm' ? 'Confirm' : 'Prompt')}
            icon={getIcon()}
            onClose={handleCancel}
            zIndexClassName="z-[100000]"
            draggable={true}
            resizable={false}
            defaultWidth={400}
            defaultHeight={modal.type === 'prompt' ? 220 : 180}
            minWidth={320}
            minHeight={150}
            contentClassName="px-6 pt-5 pb-8"
            closeOnOverlayClick
            overlayClassName="bg-transparent"
            enableMinimize={false}
            enableMaximize={false}
          >
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-6">
              {modal.message}
            </p>

            {modal.type === 'prompt' && (
              <div className="relative">
                <input
                  autoFocus
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                  className="w-full px-4 py-2.5 bg-black/20 dark:bg-black/40 border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all mb-4"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-4">
              {modal.type !== 'alert' && (
                <button
                  onClick={handleCancel}
                  className="px-5 py-2 rounded-xl text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all border border-[var(--border-color)]"
                >
                  {modal.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                onClick={handleConfirm}
                className="px-6 py-2 rounded-xl text-sm font-bold bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition-all border border-indigo-400/20"
              >
                {modal.confirmLabel || (modal.type === 'alert' ? 'OK' : modal.type === 'confirm' ? 'Confirm' : 'Submit')}
              </button>
            </div>
          </MacOSModalWindow>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
