'use client';

import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function TrafficLightButtons({ onClose }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClose}
        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57] border border-[#e0443e]/30 flex items-center justify-center group transition-all"
      >
        <X size={8} className="opacity-0 group-hover:opacity-100 text-[#4d0000] transition-opacity" />
      </button>
      <div className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]/30" />
      <div className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1fa530]/30" />
    </div>
  );
}

function WindowTitleBar({ title, icon: Icon, onClose }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)] border-b border-[var(--border-color)] rounded-t-xl">
      <TrafficLightButtons onClose={onClose} />
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
        {Icon ? <Icon size={14} /> : null}
        <span>{title}</span>
      </div>
      <div className="w-14" />
    </div>
  );
}

export default function MacOSModalWindow({
  isOpen,
  title,
  icon,
  onClose,
  children,
  zIndexClassName = 'z-[50000]',
  maxWidthClassName = 'max-w-sm',
  maxHeightClassName = 'max-h-[85vh]',
  contentClassName = 'p-4',
  closeOnOverlayClick = false,
  overlayClassName = '',
  containerClassName = '',
  windowClassName = '',
}) {
  const resolvedOverlayClassName = overlayClassName?.trim()
    ? overlayClassName
    : 'bg-black/40';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center p-4 ${resolvedOverlayClassName} ${containerClassName}`}
          onClick={() => closeOnOverlayClick && onClose?.()}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`w-full ${maxWidthClassName} ${maxHeightClassName} overflow-hidden ${windowClassName}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden"
              style={{
                background: 'var(--window-bg)',
                boxShadow:
                  '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              }}
            >
              <WindowTitleBar title={title} icon={icon} onClose={onClose} />
              <div className={`${contentClassName} overflow-y-auto custom-scrollbar`}>
                {children}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
