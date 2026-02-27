'use client';

import { useState, useEffect, useRef } from 'react';

export default function ShortcutInput({ value, onChange, placeholder, className = '' }) {
  const [isRecording, setIsRecording] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e) => {
      // Don't prevent default for system keys that might be needed to escape
      if (e.key === 'Escape') {
        setIsRecording(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.metaKey) keys.push('Cmd');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');

      const key = e.key;
      const isModifier = ['Control', 'Meta', 'Alt', 'Shift'].includes(key);

      if (!isModifier) {
        let displayKey = key;
        if (key === ' ') displayKey = 'Space';
        else if (key === 'Enter') displayKey = 'Enter';
        else if (key === 'Backspace') displayKey = 'Backspace';
        else if (key === 'Delete') displayKey = 'Delete';
        else if (key === 'Tab') displayKey = 'Tab';
        else if (key.length === 1) displayKey = key.toUpperCase();
        else if (key.startsWith('Arrow')) {
          displayKey = key.replace('Arrow', ''); // e.g. 'Up', 'Left', 'Right', 'Down'
        }

        keys.push(displayKey);
        const finalShortcut = keys.join('+');
        onChange(finalShortcut);
        setIsRecording(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onChange]);

  // Click outside to cancel
  useEffect(() => {
    if (!isRecording) return;
    
    const handleClickOutside = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        setIsRecording(false);
      }
    };
    
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isRecording]);

  return (
    <div 
      ref={inputRef}
      onMouseDown={(e) => {
        // Prevent focus stealing or other issues
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        setIsRecording(true);
      }}
      className={`px-3 py-1.5 text-sm rounded shadow-sm flex items-center justify-center min-w-[128px] cursor-pointer transition-all border ${
        isRecording 
          ? 'bg-blue-500/10 border-blue-500 text-blue-400 ring-2 ring-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.2)]' 
          : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--border-hover)]'
      } ${className}`}
      title="Click to record new shortcut"
    >
      <span className="font-mono text-xs tracking-wide select-none">
        {isRecording ? 'Listening...' : (value || placeholder || 'None')}
      </span>
    </div>
  );
}
