'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export const MessageContent = ({ content, translations, translating, messageIdx }) => {
  const [copiedIndex, setCopiedIndex] = useState(null);
  
  if (!content) return null;
  
  // Split by code block marker ```
  const parts = content.split(/```/);
  
  return (
    <div className="space-y-2 w-full overflow-hidden">
      {parts.map((part, index) => {
        const key = `${messageIdx}_${index}`;
        const isTranslating = translating && translating[key];
        const translatedText = translations && translations[key];

        if (index % 2 === 0) {
          // Text part
          if (!part.trim()) return null;
          
          // Simple markdown parser for bold text
          const formatText = (text) => {
            return text.split(/(\*\*.*?\*\*)/g).map((subPart, i) => {
              if (subPart.startsWith('**') && subPart.endsWith('**')) {
                return <strong key={i} className="text-indigo-300 font-bold">{subPart.slice(2, -2)}</strong>;
              }
              return subPart;
            });
          };

          return (
            <div key={index} className="space-y-1">
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {formatText(translatedText || (isTranslating ? '...' : part))}
              </p>
            </div>
          );
        } else {
          // Code part
          const lines = part.split('\n');
          // Heuristic: First line is language if it doesn't contain spaces and is short
          let language = 'text';
          let code = part;
          
          if (lines.length > 0) {
              const firstLine = lines[0].trim();
              if (firstLine && !firstLine.includes(' ') && firstLine.length < 20) {
                  language = firstLine;
                  code = lines.slice(1).join('\n').trim();
              } else {
                  // If first line is empty or spaces, just trim
                  if (!lines[0].trim()) {
                      code = lines.slice(1).join('\n').trim();
                  } else {
                      code = part.trim();
                  }
              }
          }
          
          if (!code) return null;

          return (
            <div key={index} className="relative rounded-lg bg-black/40 border border-white/10 my-2 group overflow-hidden w-full">
               <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/5">
                  <span className="text-[10px] text-indigo-300 font-mono lowercase opacity-70">{language}</span>
                  <div 
                     onClick={(e) => {
                         e.stopPropagation();
                         navigator.clipboard.writeText(code);
                         setCopiedIndex(index);
                         setTimeout(() => setCopiedIndex(null), 2000);
                     }}
                     className="text-[var(--text-muted)] hover:text-white transition-colors p-1 rounded hover:bg-white/10 cursor-pointer flex items-center justify-center"
                     title="Copy Code"
                  >
                     {copiedIndex === index ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </div>
               </div>
               <pre className="p-3 overflow-x-auto text-[11px] font-mono text-indigo-100/90 custom-scrollbar block w-full">
                  <code>{code}</code>
               </pre>
            </div>
          );
        }
      })}
    </div>
  );
};
