'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useOS } from '@/context/OSContext';
import AppIcon from '@/components/common/AppIcon';
import { FolderOpen, X, Pencil, Trash2, Check } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * DesktopFolder — a draggable icon group folder on the desktop.
 */
export default function DesktopFolder({ group, allIcons, isMobile, onOpenIcon }) {
  const {
    state,
    deleteIconGroup,
    renameIconGroup,
    updateIconGroupPosition,
    removeFromIconGroup,
  } = useOS();

  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const folderRef = useRef(null);
  const popoverRef = useRef(null);
  const renameInputRef = useRef(null);
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, hasMoved: false });

  const position = group.position || { x: 120, y: 120 };
  const iconSize = state.iconSize || 'medium';
  const theme = state.theme;

  const containedIcons = (group.iconIds || [])
    .map(id => allIcons.find(ic => ic.id === id))
    .filter(Boolean);

  const previewIcons = containedIcons.slice(0, 4);

  const getSizes = () => {
    switch (iconSize) {
      case 'small': return { container: 'w-20', folderBox: 'w-12 h-12', text: 'text-xs' };
      case 'large': return { container: 'w-32', folderBox: 'w-20 h-20', text: 'text-base' };
      default:      return { container: 'w-24', folderBox: 'w-14 h-14', text: 'text-sm' };
    }
  };
  const sizes = getSizes();

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(group.name);
      setTimeout(() => renameInputRef.current?.select(), 50);
    }
  }, [isRenaming, group.name]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        folderRef.current && !folderRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const computePopoverPos = useCallback(() => {
    if (!folderRef.current) return;
    const rect = folderRef.current.getBoundingClientRect();
    const pw = 260;
    const ph = 260;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top = rect.top - ph - 12;
    if (top < 8) top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    setPopoverPos({ top, left });
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (isRenaming) return;
    e.stopPropagation();
    e.preventDefault();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      hasMoved: false,
    };
    setIsDragging(true);

    const handleMove = (mv) => {
      const dx = mv.clientX - dragRef.current.startX;
      const dy = mv.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.hasMoved = true;
        setIsOpen(false);
      }
      if (dragRef.current.hasMoved && folderRef.current) {
        folderRef.current.style.left = `${dragRef.current.startPosX + dx}px`;
        folderRef.current.style.top = `${dragRef.current.startPosY + dy}px`;
      }
    };

    const handleUp = (up) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setIsDragging(false);

      if (dragRef.current.hasMoved) {
        const dx = up.clientX - dragRef.current.startX;
        const dy = up.clientY - dragRef.current.startY;
        const newX = Math.max(0, dragRef.current.startPosX + dx);
        const newY = Math.max(0, dragRef.current.startPosY + dy);
        updateIconGroupPosition(group.id, { x: newX, y: newY });
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [position, group.id, updateIconGroupPosition, isRenaming]);

  const handleClick = useCallback(() => {
    if (dragRef.current.hasMoved) return;
    computePopoverPos();
    setIsOpen(prev => !prev);
  }, [computePopoverPos]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    if (dragRef.current.hasMoved) return;
    setIsRenaming(true);
    setIsOpen(false);
  }, []);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed) renameIconGroup(group.id, trimmed);
    setIsRenaming(false);
  };

  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes('application/desktop-icon-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const iconId = e.dataTransfer.getData('application/desktop-icon-id');
    console.log('[DesktopFolder] Drop received:', { iconId, groupId: group.id, alreadyHas: group.iconIds.includes(iconId) });
    if (iconId && !group.iconIds.includes(iconId)) {
      console.log('[DesktopFolder] Dispatching desktop-folder-drop event');
      window.dispatchEvent(new CustomEvent('desktop-folder-drop', { detail: { groupId: group.id, iconId } }));
    }
  };

  const isFallout = theme === 'retro' || theme === 'fallout';
  const folderBg = isFallout
    ? 'bg-emerald-900/60 border-emerald-500/40'
    : 'bg-black/30 backdrop-blur-xl border-white/15';

  return (
    <>
      <div
        ref={folderRef}
        data-group-id={group.id}
        className={`absolute ${sizes.container} flex flex-col items-center gap-1 cursor-pointer select-none group desktop-folder`}
        style={{
          left: position.x,
          top: position.y,
          zIndex: isOpen ? 9000 : 10,
        }}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className={`${sizes.folderBox} rounded-2xl border flex items-center justify-center relative transition-all duration-200 overflow-hidden
            ${isDragging ? 'opacity-60' : ''}
            ${folderBg}
          `}
          style={{
            boxShadow: dragOver
              ? '0 0 16px rgba(99,102,241,0.5)'
              : isOpen
              ? '0 0 12px rgba(99,102,241,0.3)'
              : '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {previewIcons.length === 0 ? (
            <FolderOpen size={24} className="text-indigo-300 opacity-60" />
          ) : (
            <div className="grid grid-cols-2 gap-0.5 p-1.5 w-full h-full">
              {previewIcons.map((ic, i) => (
                <div key={ic.id} className="flex items-center justify-center rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <AppIcon id={ic.id} size={16} theme={theme} iconStyle={state.iconStyle} />
                </div>
              ))}
              {Array.from({ length: Math.max(0, 4 - previewIcons.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="rounded-md" style={{ background: 'rgba(255,255,255,0.03)' }} />
              ))}
            </div>
          )}
          <div className="absolute inset-0 rounded-2xl bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none" />
        </div>

        {isRenaming ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              onBlur={commitRename}
              className="text-[11px] text-center text-white bg-indigo-600/80 border border-indigo-400/50 rounded px-1 py-0 outline-none w-20"
              maxLength={32}
              autoFocus
            />
            <button
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); commitRename(); }}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <Check size={11} />
            </button>
          </div>
        ) : (
          <span
            className={`${sizes.text} text-center text-white font-medium leading-tight max-w-full px-1 truncate`}
            style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)' }}
          >
            {group.name}
            {containedIcons.length > 0 && (
              <span className="ml-1 text-[9px] text-indigo-300 opacity-70">({containedIcons.length})</span>
            )}
          </span>
        )}
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[50000] animate-in fade-in zoom-in-95 duration-150"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="w-64 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            style={{ background: 'rgba(15,18,30,0.92)', backdropFilter: 'blur(24px)' }}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
              <div className="flex items-center gap-2">
                <FolderOpen size={14} className="text-indigo-400" />
                <span className="text-xs font-bold text-white truncate max-w-[140px]">{group.name}</span>
                <span className="text-[9px] text-indigo-300/70">({containedIcons.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-white transition-colors"
                  title="Rename"
                  onClick={(e) => { e.stopPropagation(); setIsOpen(false); setIsRenaming(true); }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="p-1 rounded-lg hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title="Delete group"
                  onClick={(e) => { e.stopPropagation(); setIsOpen(false); deleteIconGroup(group.id); }}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  className="p-1 rounded-lg hover:bg-white/10 text-[var(--text-muted)] hover:text-white transition-colors"
                  onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            <div className="p-3">
              {containedIcons.length === 0 ? (
                <div className="text-center py-6 text-xs text-white/30">
                  <FolderOpen size={28} className="mx-auto mb-2 opacity-30" />
                  Empty group
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {containedIcons.map((ic) => (
                    <FolderIconItem
                      key={ic.id}
                      icon={ic}
                      group={group}
                      theme={theme}
                      iconStyle={state.iconStyle}
                      onOpen={() => { setIsOpen(false); onOpenIcon && onOpenIcon(ic); }}
                      onRemove={() => removeFromIconGroup(group.id, ic.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function FolderIconItem({ icon, group, theme, iconStyle, onOpen, onRemove }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex flex-col items-center gap-1 cursor-pointer group/item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      title="Click to open"
    >
      <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center relative border border-white/8 hover:border-white/20 transition-all"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <AppIcon id={icon.id} size={28} theme={theme} iconStyle={iconStyle} />

        {hovered && (
          <button
            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500/90 text-white flex items-center justify-center hover:bg-red-400 transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove from group"
          >
            <X size={9} />
          </button>
        )}
      </div>
      <span className="text-[9px] text-white/70 text-center leading-tight max-w-full truncate px-0.5 w-12">
        {icon.title}
      </span>
    </div>
  );
}
