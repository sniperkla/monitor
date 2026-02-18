'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAIUsage } from '@/hooks/useAIUsage';

export default function AiUsageBar({ compact = false }) {
  const { t } = useTranslation();
  const { usage, loading } = useAIUsage();
  const [showTooltip, setShowTooltip] = useState(false);

  const percentage = Math.min(100, Math.ceil((usage.used / usage.limit) * 100));
  const isHigh = percentage > 80;
  const isCritical = percentage > 95;

  if (loading || !usage.limit) {
    return compact ? (
      <div className="relative inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white/5 border border-white/10">
        <Sparkles size={10} className="text-slate-500 animate-pulse" />
        <div className="w-16 h-1 bg-white/10 rounded-full" />
      </div>
    ) : (
      <div className="relative mb-6">
        <div className="h-2 w-full bg-white/5 rounded-full animate-pulse" />
      </div>
    );
  }

  // Compact view for taskbar
  if (compact) {
    return (
      <div className="relative inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group cursor-default">
        <Sparkles size={10} className={`${isCritical ? 'text-rose-400' : 'text-indigo-400'} ${percentage < 100 ? 'animate-pulse' : ''}`} />
        
        <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden relative">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            className={`h-full relative ${
              isCritical ? 'bg-rose-500' : isHigh ? 'bg-amber-500' : 'bg-indigo-500'
            }`}
          />
        </div>

        <span className={`text-[9px] font-bold ${isCritical ? 'text-rose-400' : 'text-slate-400'}`}>
          {percentage}%
        </span>

        <button 
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="text-slate-500 hover:text-white"
        >
          <Info size={10} />
        </button>

        <AnimatePresence>
          {showTooltip && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-40 p-2 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-50 pointer-events-none"
            >
              <p className="text-[9px] text-slate-300 leading-tight">
                {t('ai.usedOf')} <span className="text-white font-bold">{usage.used.toLocaleString()}</span> / <span className="text-white font-bold">{usage.limit.toLocaleString()}</span>
                <br/>
                <span className="opacity-50 italic">{t('ai.resetNotice')}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Full view
  return (
    <div className="relative mb-6">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded-md ${isCritical ? 'bg-rose-500/20 text-rose-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
            <Sparkles size={12} className={percentage < 100 ? 'animate-pulse' : ''} />
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {t('ai.dailyAllowance')}
          </span>
        </div>
        
        <button 
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="text-slate-500 hover:text-white transition-colors"
        >
          <Info size={12} />
        </button>

        <AnimatePresence>
          {showTooltip && (
            <motion.div 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="absolute right-0 bottom-full mb-2 w-48 p-3 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50 pointer-events-none"
            >
              <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                {t('ai.usedOf')} <span className="text-white font-bold">{usage.used.toLocaleString()}</span> / <span className="text-white font-bold">{usage.limit.toLocaleString()}</span> {t('ai.tokensUsed')}.
                <br />
                <span className="text-[9px] opacity-70 italic">{t('ai.resetNotice')}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 relative group">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full relative transition-[background-color] duration-500 ${
            isCritical ? 'bg-gradient-to-r from-rose-600 to-rose-400' :
            isHigh ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
            'bg-gradient-to-r from-indigo-600 to-blue-400'
          }`}
        >
          {/* Shimmer effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
        </motion.div>
      </div>

      <div className="flex justify-between mt-1.5 px-0.5">
        <span className={`text-[10px] font-black tracking-tight ${isCritical ? 'text-rose-400' : 'text-slate-500'}`}>
          {usage.used.toLocaleString()} {t('ai.tokensUsed')}
        </span>
        <span className="text-[10px] font-bold text-slate-600 uppercase">
          {percentage}%
        </span>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}
