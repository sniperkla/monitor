'use client';

import { useApp } from '@/context/AppContext';
import FileLayout from '@/components/FileLayout';

export default function FileTabs() {
  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden relative">
      <FileLayout />
    </div>
  );
}
