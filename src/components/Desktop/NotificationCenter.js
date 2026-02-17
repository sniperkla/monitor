'use client';

import { useEffect, useState } from 'react';
import { useOS } from '@/context/OSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, Loader } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function NotificationCenter() {
  const { state, removeNotification } = useOS();
  const { notificationQueue, taskbarPosition, glassmorphism } = state;

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div 
      className="fixed z-[200000] pointer-events-none flex flex-col gap-2 p-4 w-80"
      style={{
        bottom: taskbarPosition === 'bottom' ? 60 : 20,
        right: taskbarPosition === 'right' ? 60 : 20,
        top: taskbarPosition === 'top' ? 60 : 'auto',
      }}
    >
      <AnimatePresence mode="popLayout">
        {notificationQueue.map((notification) => (
          <NotificationItem 
            key={notification.id} 
            notification={notification} 
            removeNotification={removeNotification}
            glassmorphism={glassmorphism}
          />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}

function NotificationItem({ notification, removeNotification, glassmorphism }) {
  const { id, title, message, type, duration = 5000 } = notification;

  const onDismiss = () => removeNotification(id);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onDismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, removeNotification]);

  const icons = {
    success: <CheckCircle size={18} className="text-emerald-400" />,
    error: <AlertTriangle size={18} className="text-rose-400" />,
    info: <Info size={18} className="text-blue-400" />,
    warning: <AlertCircle size={18} className="text-amber-400" />,
    loading: <Loader size={18} className="text-indigo-400 animate-spin" />
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`pointer-events-auto relative w-full overflow-hidden rounded-lg border shadow-lg backdrop-blur-md select-none group`}
      style={{
        background: glassmorphism ? 'var(--window-bg)' : 'var(--bg-primary)',
        borderColor: 'var(--border-color)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
      }}
    >
      <div className="flex p-3 gap-3 items-start">
        <div className="mt-0.5 shrink-0">
          {icons[type] || icons.info}
        </div>
        <div className="flex-1 min-w-0">
          {title && <h4 className="text-sm font-semibold text-[var(--text-primary)] leading-tight mb-0.5">{title}</h4>}
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors -mr-1 -mt-1 opacity-0 group-hover:opacity-100"
        >
          <X size={14} />
        </button>
      </div>
      
      {/* Progress Bar for Auto Dismiss */}
      {duration > 0 && (
        <motion.div 
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: duration / 1000, ease: 'linear' }}
          className="h-0.5 bg-white/20 absolute bottom-0 left-0"
        />
      )}
    </motion.div>
  );
}