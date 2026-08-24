'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * ThemeSelect — the app-wide themed dropdown. Replaces every legacy native
 * <select> so all dropdowns share one dark glass look.
 *
 * Props:
 *  - value:            current value
 *  - options:          [{ value, label }]
 *  - onChange(v):      called with the selected value
 *  - disabled:         disable interaction
 *  - placeholder:      label when nothing selected
 *  - icon:             optional lucide icon rendered in the trigger
 *  - title:            native tooltip on the trigger
 *  - size:             'xs' | 'sm' | 'md' (default 'sm')
 *  - className:        wrapper class (width/layout)
 */
export default function ThemeSelect({
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = 'Select…',
  icon: Icon = null,
  title,
  size = 'sm',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : size === 'md' ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs';
  const itemPad = size === 'xs' ? 'px-2 py-1 text-[10px]' : size === 'md' ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs';
  const menuMaxH = size === 'xs' ? 'max-h-40' : 'max-h-56';

  const toggle = () => {
    if (disabled) return;
    // Flip the menu upward when there isn't room below (small windows / bottom docks)
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setDropUp(rect.bottom + 230 > window.innerHeight && rect.top > 240);
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        title={title}
        className={`w-full flex items-center gap-1.5 ${pad} rounded-lg bg-white/[0.04] border border-white/10 hover:border-indigo-500/40 focus:border-indigo-500/50 outline-none transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {Icon && <Icon size={12} className="text-slate-500 shrink-0" />}
        <span className={`flex-1 truncate ${current ? 'text-slate-200' : 'text-slate-500'}`}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          size={size === 'xs' ? 10 : 13}
          className={`text-slate-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className={`absolute z-[200] w-full ${menuMaxH} overflow-y-auto custom-scrollbar rounded-lg bg-[#141824] border border-white/10 shadow-xl shadow-black/60 py-1 ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">No options</p>
          )}
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 ${itemPad} text-left transition-colors ${
                o.value === value ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-300 hover:bg-white/[0.05]'
              }`}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={12} className="text-indigo-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}