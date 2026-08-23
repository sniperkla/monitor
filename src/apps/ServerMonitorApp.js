'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Activity, Server, HardDrive, Wifi, Cpu, MemoryStick, Download, Upload, 
  Clock, Package, Database, Box, RefreshCw, AlertCircle, CheckCircle2, 
  Zap, TrendingUp, TrendingDown, Minus, Pause, Play, RotateCw, Radio,
  Check, Shield, Sparkles, ExternalLink, Laptop, AlertTriangle,
  ChevronDown, ListFilter, Search, XOctagon, Skull, ArrowUpDown, Trash2, X,
  ZoomIn, ZoomOut, Maximize2, Minimize2, GripHorizontal, MoveHorizontal, ChevronLeft, ChevronRight, Sliders, ChevronsRight, ChevronsLeft, Eye, History, Navigation,
  Flame, FileSpreadsheet, ScrollText
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { createRelayPeer } from '@/lib/webrtc-relay';
import AgentSetupWizard from '@/components/AgentSetupWizard';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 🎨 Styled popover select — matches RcloneApp theme
function CustomSelect({ value, onChange, options = [], placeholder = 'Select...', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedOpt = options.find(o => String(o.value) === String(value));

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 text-xs rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] font-medium flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-500/50 transition-all whitespace-nowrap"
      >
        <span className="truncate">{selectedOpt?.label || placeholder}</span>
        <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[9999] overflow-hidden max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            const isDisabled = !!opt.disabled;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={isDisabled}
                onClick={() => { if (!isDisabled) { onChange(opt.value); setOpen(false); } }}
                title={isDisabled ? (opt.disabledReason || 'Not available') : undefined}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                  isDisabled
                    ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                    : isSelected
                    ? 'bg-indigo-500/15 text-indigo-400 font-bold cursor-pointer'
                    : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] cursor-pointer'
                }`}
              >
                <span className="truncate">{opt.label}{isDisabled && opt.disabledReason ? <span className="ml-1 text-[10px] text-amber-400/70 font-normal">— agent required</span> : null}</span>
                {isSelected && !isDisabled && <Check size={12} className="text-indigo-400 shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Module-level utility formatters
const formatBytes = (bytes) => {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i < 0) return '0 B';
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const asFiniteNumber = (value) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

// Draw selection markers against Chart.js' plot area instead of using DOM
// offsets. This keeps the guide aligned while axis width, zoom, and labels vary.
const timelineMarkerPlugin = {
  id: 'timelineMarker',
  afterDatasetsDraw(chart, _args, options) {
    const index = options?.index;
    if (!Number.isInteger(index) || index < 0) return;

    const xScale = chart.scales.x;
    const { ctx, chartArea } = chart;
    if (!xScale || !chartArea) return;

    const x = xScale.getPixelForValue(index);
    if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const value = asFiniteNumber(dataset.data?.[index]);
      const point = chart.getDatasetMeta(datasetIndex)?.data?.[index];
      if (value === null || !point) return;

      const position = point.getProps(['x', 'y'], true);
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      ctx.fillStyle = dataset.borderColor || '#f43f5e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(position.x, position.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 📈 Interactive Scrollable Chart Card with Horizontal Drag/Wheel & Past Scroller
// ─────────────────────────────────────────────────────────────────────────────
function ScrollableChartCard({
  title,
  icon: Icon,
  currentValue,
  valueSuffix = '%',
  statusColor = '',
  trendIcon,
  headerExtra,
  subHeader,
  chartData,
  chartOptions,
  heightClass = 'h-40',
  zoomLevel = '1x',
  footer,
  emptyMessage = 'No data yet',
  emptyState,
  isLive = true,
  syncScrollRatio = null,
  syncEnabled = false,
  onUserScroll = null,
  spikeData = null, // { history: [{value}], threshold: 80 } for per-card spike badge
  align = 'left', // 'left' | 'right' based on column position in the grid
  jumpToIndividualPeakSignal = 0, // increment this to trigger a jump-to-own-peak
}) {
  const scrollRef = useRef(null);
  const [localZoom, setLocalZoom] = useState(null);
  
  // When in Synced mode, all cards follow the global zoomLevel. In Individual mode, localZoom takes priority.
  const activeZoom = syncEnabled ? zoomLevel : (localZoom || zoomLevel);

  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollStartLeft, setScrollStartLeft] = useState(0);
  const [isAtEnd, setIsAtEnd] = useState(true);
  const [visibleTime, setVisibleTime] = useState(null);
  const isSyncingRef = useRef(false);

  const totalPoints = chartData?.labels?.length || 0;

  // Reset localZoom whenever syncEnabled is turned ON
  useEffect(() => {
    if (syncEnabled) {
      setLocalZoom(null);
    }
  }, [syncEnabled]);

  // Calculate dynamic width based on active zoom level:
  // 1x/2x/4x are GUARANTEED to be wider than container width so scrolling and timeline sliding always roll smoothly!
  const chartWidth = useMemo(() => {
    if (activeZoom === 'fit' || totalPoints === 0) return '100%';
    const minPointPx = activeZoom === '4x' ? 36 : activeZoom === '2x' ? 20 : 12;
    const percentWidth = activeZoom === '4x' ? 400 : activeZoom === '2x' ? 250 : 160;
    const calcPx = totalPoints * minPointPx;
    return `max(${percentWidth}%, ${calcPx}px)`;
  }, [activeZoom, totalPoints]);

  // Keep scrolled to latest when new data arrives and user is at the right edge
  useEffect(() => {
    if (isLive && isAtEnd && scrollRef.current && activeZoom !== 'fit') {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [chartData, isLive, isAtEnd, activeZoom]);

  // Handle external synchronized scroll (when sync is enabled or when syncScrollRatio changes)
  useEffect(() => {
    if (syncEnabled && syncScrollRatio !== null && syncScrollRatio !== undefined && scrollRef.current) {
      // If currently fit, auto-switch to 1x so scrolling reveals the timestamp
      if (activeZoom === 'fit') {
        setLocalZoom('1x');
      }
      const container = scrollRef.current;
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll > 0) {
        isSyncingRef.current = true;
        // Direct synchronous scroll for zero-lag realtime tracking during scrubber drag
        container.scrollLeft = syncScrollRatio * maxScroll;
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 60);
      }
      if (totalPoints > 0) {
        const idx = Math.min(Math.max(0, Math.floor(syncScrollRatio * (totalPoints - 1))), totalPoints - 1);
        if (chartData?.labels?.[idx]) {
          setVisibleTime(chartData.labels[idx]);
        }
        setIsAtEnd(syncScrollRatio >= 0.98);
      }
    }
  }, [syncScrollRatio, syncEnabled, activeZoom, totalPoints, chartData]);

  // On scroll (individual card)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    const maxScroll = scrollWidth - clientWidth;
    const atEnd = maxScroll <= 0 || (maxScroll - scrollLeft < 15);
    setIsAtEnd(atEnd);

    if (totalPoints > 0 && chartData?.labels) {
      const ratio = maxScroll > 0 ? scrollLeft / maxScroll : 1;
      const idx = Math.min(Math.max(0, Math.floor(ratio * (totalPoints - 1))), totalPoints - 1);
      setVisibleTime(chartData.labels[idx]);
      // Only emit sync if the scroll was user-initiated, not from external sync
      if (syncEnabled && onUserScroll && maxScroll > 0 && !isSyncingRef.current) {
        onUserScroll(ratio);
      }
    }
  }, [totalPoints, chartData, syncEnabled, onUserScroll]);

  const rafRef = useRef(null);

  // Mouse Drag to Pan with requestAnimationFrame & Sync support
  const handleMouseDown = (e) => {
    if (activeZoom === 'fit' || !scrollRef.current) return;
    if (e.target.closest('button') || e.target.closest('input')) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollStartLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const pageX = e.pageX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const x = pageX - scrollRef.current.offsetLeft;
      const walk = (x - startX) * 1.5;
      const nextLeft = scrollStartLeft - walk;
      scrollRef.current.scrollLeft = nextLeft;
      if (syncEnabled && onUserScroll) {
        const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
        if (maxScroll > 0) {
          onUserScroll(Math.min(Math.max(0, nextLeft / maxScroll), 1));
        }
      }
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };
  const handleMouseLeave = () => {
    setIsDragging(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  // Wheel Horizontal Scroll with requestAnimationFrame & Sync support
  const handleWheel = (e) => {
    if (activeZoom === 'fit' || !scrollRef.current) return;
    if (Math.abs(e.deltaX) > 0) return;
    if (e.deltaY) {
      const delta = e.deltaY;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollLeft += delta;
        if (syncEnabled && onUserScroll) {
          const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
          if (maxScroll > 0) {
            onUserScroll(Math.min(Math.max(0, scrollRef.current.scrollLeft / maxScroll), 1));
          }
        }
      });
    }
  };

  const [peakHighlight, setPeakHighlight] = useState(null);
  const [activeHighlightIdx, setActiveHighlightIdx] = useState(null);

  // Compute peak and spike points for this specific card.
  const { cardPeakIdx, cardPeakVal, cardSpikeIndices } = useMemo(() => {
    const hist = spikeData?.history ?? [];
    const threshold = spikeData?.threshold ?? 80;
    let maxVal = -1;
    let maxIdx = -1;
    const spikes = [];

    hist.forEach((d, i) => {
      const val = asFiniteNumber(typeof d === 'number' ? d : d?.value);
      if (val === null) return;
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
      if (val >= threshold) {
        spikes.push(i);
      }
    });

    return {
      cardPeakIdx: maxIdx,
      cardPeakVal: maxVal >= 0 ? maxVal : null,
      cardSpikeIndices: spikes
    };
  }, [spikeData]);

  const formattedPeak = useMemo(() => {
    if (cardPeakVal === null) return '—';
    if (spikeData?.formatValue) return spikeData.formatValue(cardPeakVal);
    if (spikeData?.isBytes) return `${formatBytes(cardPeakVal)}/s`;
    return `${cardPeakVal.toFixed(0)}%`;
  }, [spikeData, cardPeakVal]);

  // Jump to specific index on this card and show peak highlight & dicut line
  const jumpToIndex = (targetIdx, label, force = false) => {
    if (targetIdx == null || targetIdx < 0 || totalPoints === 0 || !scrollRef.current) return;
    
    // Toggle off only on manual click if already highlighted, but not during broadcast jump
    if (!force && activeHighlightIdx === targetIdx) {
      setActiveHighlightIdx(null);
      setPeakHighlight(null);
      return;
    }

    setActiveHighlightIdx(targetIdx);

    // Auto-switch from 'fit' to '1x' so scrolling is possible and readable
    if (activeZoom === 'fit') {
      setLocalZoom('1x');
    }

    setTimeout(() => {
      if (!scrollRef.current) return;
      const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
      const ratio = totalPoints > 1 ? targetIdx / (totalPoints - 1) : 1;
      if (maxScroll > 0) {
        scrollRef.current.scrollTo({
          left: ratio * maxScroll,
          behavior: 'smooth'
        });
      }
      setIsAtEnd(targetIdx >= totalPoints - 2);
      const time = chartData?.labels?.[targetIdx] || 'past';
      setVisibleTime(time);
      setPeakHighlight(label || `Peak: ${formattedPeak} at ${time}`);
    }, 80);
  };

  // React to global "Jump to Individual Peak" broadcast — each card jumps to its OWN peak
  useEffect(() => {
    if (jumpToIndividualPeakSignal > 0 && cardPeakIdx >= 0 && totalPoints > 0) {
      jumpToIndex(cardPeakIdx, `Peak: ${formattedPeak}`, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToIndividualPeakSignal]);

  const jumpToNextCardSpike = (direction = 'next') => {
    if (cardSpikeIndices.length === 0) {
      jumpToIndex(cardPeakIdx, `Peak: ${formattedPeak}`);
      return;
    }
    const currentIdx = Math.floor((scrollRef.current?.scrollLeft / Math.max(1, (scrollRef.current?.scrollWidth - scrollRef.current?.clientWidth || 1))) * (totalPoints - 1));
    let targetIdx;
    if (direction === 'next') {
      targetIdx = cardSpikeIndices.find(idx => idx > currentIdx) ?? cardSpikeIndices[0];
    } else {
      const reversed = [...cardSpikeIndices].reverse();
      targetIdx = reversed.find(idx => idx < currentIdx) ?? cardSpikeIndices[cardSpikeIndices.length - 1];
    }
    const time = chartData?.labels?.[targetIdx] || 'past';
    jumpToIndex(targetIdx, `Spike: ${time}`);
  };

  const snapToNow = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        left: scrollRef.current.scrollWidth,
        behavior: 'smooth'
      });
      setIsAtEnd(true);
      setPeakHighlight(null);
      setActiveHighlightIdx(null);
    }
  };



  const cardRef = useRef(null);
  const [customHeight, setCustomHeight] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);

  const handleResizeStart = (e, direction = 'vertical') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartY.current = e.clientY;
    const currentH = scrollRef.current ? scrollRef.current.clientHeight : 200;
    resizeStartH.current = currentH;

    const onMouseMove = (moveEv) => {
      const deltaX = moveEv.clientX - resizeStartX.current;
      const deltaY = moveEv.clientY - resizeStartY.current;

      if (direction === 'vertical' || direction === 'both') {
        const newH = Math.max(140, Math.min(800, resizeStartH.current + deltaY));
        setCustomHeight(newH);
      }

      if (direction === 'horizontal' || direction === 'both') {
        if (align === 'right') {
          // Right-column card: dragging left (negative deltaX) expands full width to the left!
          if (deltaX < -50) {
            setIsExpanded(true);
          } else if (deltaX > 50) {
            setIsExpanded(false);
          }
        } else {
          // Left-column card: dragging right (positive deltaX) expands full width to the right!
          if (deltaX > 50) {
            setIsExpanded(true);
          } else if (deltaX < -50) {
            setIsExpanded(false);
          }
        }
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div 
      ref={cardRef}
      style={{ order: isExpanded ? -1 : 0 }}
      className={`bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm flex flex-col relative group transition-all duration-200 ${
        isExpanded ? 'col-span-1 lg:col-span-2 shadow-xl ring-1 ring-indigo-500/40' : ''
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="text-indigo-400 shrink-0" size={18} />}
          <h3 className="font-semibold text-sm leading-tight flex items-center gap-1.5">
            {title}
            {activeZoom !== 'fit' && (
              <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-color)]/50">
                {activeZoom}
              </span>
            )}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Peak remains visible even when a metric also has threshold breaches. */}
          {spikeData && totalPoints > 0 && cardPeakIdx >= 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => jumpToIndex(cardPeakIdx, `Peak: ${formattedPeak} at ${chartData?.labels?.[cardPeakIdx] || 'past'}`)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 text-[10px] font-medium transition-colors cursor-pointer"
                title={`Focus highest recorded value: ${formattedPeak}`}
                aria-label={`Focus peak ${formattedPeak}`}
              >
                <TrendingUp size={11} />
                <span>Peak {formattedPeak}</span>
              </button>
              {cardSpikeIndices.length > 0 && (
                <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-medium">
                  <Flame size={11} />
                  <span>{cardSpikeIndices.length}</span>
                  <button type="button" onClick={() => jumpToNextCardSpike('prev')} className="p-0.5 rounded hover:bg-rose-500/20 cursor-pointer" title="Previous threshold breach" aria-label="Previous threshold breach">
                    <ChevronLeft size={11} />
                  </button>
                  <button type="button" onClick={() => jumpToNextCardSpike('next')} className="p-0.5 rounded hover:bg-rose-500/20 cursor-pointer" title="Next threshold breach" aria-label="Next threshold breach">
                    <ChevronRight size={11} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Individual Zoom Selector per Card (Only affects THIS card) */}
          <div className="hidden sm:flex items-center gap-1 p-0.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[10px]">
            {['fit', '1x', '2x', '4x'].map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setLocalZoom(z)}
                className={`px-1.5 py-0.5 rounded font-medium transition-all cursor-pointer ${
                  activeZoom === z
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title={`Zoom ${title}: ${z === 'fit' ? 'Fit all' : z}`}
              >
                {z === 'fit' ? 'Fit' : z}
              </button>
            ))}
          </div>

          {/* Full-width / Expand toggle button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={`p-1 rounded transition-colors cursor-pointer ${
              isExpanded 
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' 
                : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title={isExpanded ? 'Collapse to 1 column' : 'Expand full 2 columns'}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {/* Custom header extra (e.g. network rates) */}
          {headerExtra}

          {/* Current Value + Trend */}
          <div className="flex items-center gap-1.5 ml-1">
            {trendIcon}
            {currentValue !== undefined && currentValue !== null && (
              <span className={`text-lg font-bold font-mono ${statusColor}`}>
                {typeof currentValue === 'number' ? currentValue.toFixed(1) : currentValue}{valueSuffix}
              </span>
            )}
          </div>
        </div>
      </div>

      {subHeader}

      {/* Floating Past Time / Peak Highlight Badge */}
      {(!isAtEnd && activeZoom !== 'fit' && totalPoints > 0) || peakHighlight ? (
        <div className="absolute top-12 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/95 border border-indigo-500/40 text-[11px] shadow-xl [backdrop-filter:blur(var(--glass-blur,12px))] animate-fade-in">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {peakHighlight ? (
            <span className="font-mono font-semibold text-emerald-300">{peakHighlight}</span>
          ) : (
            <>
              <span className="text-[var(--text-muted)]">Past:</span>
              <span className="font-mono font-semibold text-amber-300">{visibleTime || 'past'}</span>
            </>
          )}
          <button
            type="button"
            onClick={snapToNow}
            className="ml-1 px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
            title="Snap back to current live time"
          >
            <Zap size={10} className="fill-white" />
            Snap to Now
          </button>
        </div>
      ) : null}

      {/* Chart Canvas Area with Horizontal Scroll & Pan + Dynamic Resizing */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        className={`${!customHeight ? (isExpanded ? 'h-96' : heightClass) : ''} mb-2 transition-all duration-150 ${
          activeZoom === 'fit' ? 'overflow-hidden' : 'overflow-x-auto overflow-y-hidden custom-scrollbar'
        } ${isDragging ? 'cursor-grabbing select-none' : activeZoom !== 'fit' ? 'cursor-grab' : 'cursor-default'}`}
        style={{ 
          height: customHeight ? `${customHeight}px` : undefined,
          WebkitOverflowScrolling: 'touch' 
        }}
      >
        {totalPoints > 0 ? (
          <div style={{ width: chartWidth, height: '100%', minWidth: '100%' }} className="relative overflow-hidden">
            <Line
              data={chartData}
              options={{
                ...chartOptions,
                plugins: {
                  ...chartOptions.plugins,
                  timelineMarker: { index: activeHighlightIdx },
                },
              }}
              plugins={[timelineMarkerPlugin]}
            />
          </div>
        ) : (
          emptyState || (
            <div className="flex flex-col items-center justify-center h-full text-xs text-[var(--text-muted)] gap-1">
              <span>{emptyMessage}</span>
            </div>
          )
        )}
      </div>

      {/* Scroll indicator hints for user if zoomed */}
      {activeZoom !== 'fit' && totalPoints > 0 && (
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-0.5 px-0.5">
          <span className="flex items-center gap-1 opacity-70">
            <MoveHorizontal size={11} /> Drag chart or scroll sideways for past time
          </span>
          <span className="font-mono opacity-80">
            {chartData?.labels?.[0] || 'Start'} → {chartData?.labels?.[totalPoints - 1] || 'Now'}
          </span>
        </div>
      )}

      {footer}

      {/* Interactive Bottom Drag-to-Resize Handle (Vertical Height) */}
      <div
        onMouseDown={(e) => handleResizeStart(e, 'vertical')}
        className={`w-full py-1 -mb-2 mt-1 flex items-center justify-center cursor-row-resize select-none transition-opacity ${
          isResizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="Drag up or down to resize height"
      >
        <div className="w-14 h-1 rounded-full bg-[var(--border-color)] hover:bg-indigo-400 group-hover:bg-indigo-500/60 transition-colors flex items-center justify-center">
          <GripHorizontal size={10} className="text-white/40 opacity-0 group-hover:opacity-100" />
        </div>
      </div>

      {/* Interactive Horizontal Edge Drag Handle (Expand/Collapse) */}
      <div
        onMouseDown={(e) => handleResizeStart(e, 'horizontal')}
        className={`absolute top-12 bottom-6 ${align === 'right' ? 'left-0' : 'right-0'} w-2.5 cursor-col-resize opacity-0 hover:opacity-100 group-hover:opacity-40 transition-opacity flex items-center justify-center select-none z-10`}
        title={align === 'right' ? 'Drag left to expand width, drag right to collapse' : 'Drag right to expand width, drag left to collapse'}
      >
        <div className="w-1 h-12 rounded-full bg-indigo-500/50 hover:bg-indigo-400" />
      </div>

      {/* Interactive 2D Corner Resize Handle (Bottom-Right for left cards, Bottom-Left for right cards) */}
      <div
        onMouseDown={(e) => handleResizeStart(e, 'both')}
        className={`absolute bottom-1 ${align === 'right' ? 'left-1 cursor-sw-resize' : 'right-1 cursor-se-resize'} w-5 h-5 flex items-end ${align === 'right' ? 'justify-start' : 'justify-end'} p-0.5 opacity-30 hover:opacity-100 group-hover:opacity-75 transition-opacity z-20 select-none`}
        title={align === 'right' ? 'Drag corner left & down to resize width and height' : 'Drag corner right & down to resize width and height'}
      >
        <svg viewBox="0 0 6 6" className="w-3 h-3 fill-[var(--text-muted)] hover:fill-indigo-400">
          <circle cx="5" cy="5" r="0.75" />
          <circle cx="5" cy="3" r="0.75" />
          <circle cx="3" cy="5" r="0.75" />
          <circle cx="5" cy="1" r="0.75" />
          <circle cx="3" cy="3" r="0.75" />
          <circle cx="1" cy="5" r="0.75" />
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🧭 Synchronized Timeline Navigator & Range Toolbar
// ─────────────────────────────────────────────────────────────────────────────
function TimelineNavigator({
  historyRange,
  setHistoryRange,
  historyLoading,
  historyData,
  liveCount,
  fetchHistory,
  selectedConnection,
  zoomLevel,
  setZoomLevel,
  syncEnabled = false,
  setSyncEnabled,
  timelineLabels = [],
  scrubberRatio,
  onScrubberChange,
  onSnapToLive,
  cpuHistory = [],
  ramHistory = [],
  networkHistory = [],
  diskHistory = [],
  onJumpToIndividualPeak,
  timelineTimestamps = [],
  onInspectLogs,
}) {
  const totalPoints = timelineLabels.length;
  const oldestTime = timelineLabels[0] || '—';
  const latestTime = timelineLabels[totalPoints - 1] || 'Now';

  const [scrubPreview, setScrubPreview] = useState(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logResult, setLogResult] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [activeLogTab, setActiveLogTab] = useState('system');
  const [dockerLiveLines, setDockerLiveLines] = useState([]);
  const [dockerStreamState, setDockerStreamState] = useState('idle');
  const dockerStreamRef = useRef(null);
  const logTerminalRef = useRef(null);
  const logTerminalAtBottomRef = useRef(true);
  const [spikeThreshold, setSpikeThreshold] = useState(70);
  const historyRefreshLabel = historyRange === '24h' ? 'refreshes every minute'
    : historyRange === '7d' || historyRange === '30d' ? 'refreshes every 5 min'
      : 'refreshes every 30 sec';

  // Compute peaks for ALL 4 metrics (CPU, RAM, Network, Disk) + high load spike indices
  const { spikeIndices, cpuPeak, ramPeak, netPeak, diskPeak } = useMemo(() => {
    const indices = [];
    let maxCpu = { val: -1, idx: -1, time: '' };
    let maxRam = { val: -1, idx: -1, time: '' };
    let maxNet = { val: -1, idx: -1, time: '' };
    let maxDisk = { val: -1, idx: -1, time: '' };

    if (historyData?.data && historyData.data.length > 0) {
      historyData.data.forEach((d, i) => {
        const time = d.label || '';
        const cpu = asFiniteNumber(d.cpu);
        if (cpu !== null && cpu > maxCpu.val) maxCpu = { val: cpu, idx: i, time };

        const ram = asFiniteNumber(d.ram);
        if (ram !== null && ram > maxRam.val) maxRam = { val: ram, idx: i, time };

        const rx = asFiniteNumber(d.rxBytes) ?? 0;
        const tx = asFiniteNumber(d.txBytes) ?? 0;
        const net = rx + tx;
        if (asFiniteNumber(d.rxBytes) !== null || asFiniteNumber(d.txBytes) !== null) {
          if (net > maxNet.val) maxNet = { val: net, idx: i, time };
        }

        const disk = asFiniteNumber(d.disk);
        if (disk !== null && disk > maxDisk.val) maxDisk = { val: disk, idx: i, time };

        if ((cpu !== null && cpu >= spikeThreshold) || (ram !== null && ram >= spikeThreshold)) {
          indices.push(i);
        }
      });
    } else {
      const len = Math.max(cpuHistory.length, ramHistory.length, networkHistory.length, diskHistory.length);
      for (let i = 0; i < len; i++) {
        const time = cpuHistory[i]?.time || ramHistory[i]?.time || timelineLabels[i] || '';
        const cpu = asFiniteNumber(cpuHistory[i]?.value);
        if (cpu !== null && cpu > maxCpu.val) maxCpu = { val: cpu, idx: i, time };

        const ram = asFiniteNumber(ramHistory[i]?.value);
        if (ram !== null && ram > maxRam.val) maxRam = { val: ram, idx: i, time };

        const rx = asFiniteNumber(networkHistory[i]?.rx) ?? 0;
        const tx = asFiniteNumber(networkHistory[i]?.tx) ?? 0;
        const net = rx + tx;
        if (asFiniteNumber(networkHistory[i]?.rx) !== null || asFiniteNumber(networkHistory[i]?.tx) !== null) {
          if (net > maxNet.val) maxNet = { val: net, idx: i, time };
        }

        const disk = asFiniteNumber(diskHistory[i]?.value);
        if (disk !== null && disk > maxDisk.val) maxDisk = { val: disk, idx: i, time };

        if ((cpu !== null && cpu >= spikeThreshold) || (ram !== null && ram >= spikeThreshold)) {
          indices.push(i);
        }
      }
    }

    return {
      spikeIndices: indices,
      cpuPeak: maxCpu.val >= 0 ? maxCpu : null,
      ramPeak: maxRam.val >= 0 ? maxRam : null,
      netPeak: maxNet.val >= 0 ? maxNet : null,
      diskPeak: maxDisk.val >= 0 ? maxDisk : null,
    };
  }, [historyData, cpuHistory, ramHistory, networkHistory, diskHistory, timelineLabels, spikeThreshold]);

  const handleSliderChange = (e) => {
    const val = parseFloat(e.target.value);
    if (zoomLevel === 'fit' && setZoomLevel) {
      setZoomLevel('1x');
    }
    if (setSyncEnabled) setSyncEnabled(true);
    onScrubberChange(val);
    if (totalPoints > 0) {
      const idx = Math.min(Math.max(0, Math.floor(val * (totalPoints - 1))), totalPoints - 1);
      setScrubPreview(timelineLabels[idx]);
    }
  };

  const handleStep = (stepDelta) => {
    if (totalPoints === 0) return;
    const currentIdx = Math.floor((scrubberRatio ?? 1) * (totalPoints - 1));
    const nextIdx = Math.min(Math.max(0, currentIdx + stepDelta), totalPoints - 1);
    const nextRatio = totalPoints > 1 ? nextIdx / (totalPoints - 1) : 1;
    onScrubberChange(nextRatio);
    setScrubPreview(timelineLabels[nextIdx]);
  };

  const stopDockerStream = () => {
    if (dockerStreamRef.current) {
      dockerStreamRef.current.close();
      dockerStreamRef.current = null;
    }
    setDockerStreamState('idle');
  };

  const startDockerStream = () => {
    if (!selectedConnection || dockerStreamRef.current) return;

    setDockerLiveLines([]);
    setDockerStreamState('connecting');
    const stream = new EventSource(`/api/server-monitor/logs/stream?connectionId=${encodeURIComponent(selectedConnection)}`);
    dockerStreamRef.current = stream;

    stream.onmessage = (event) => {
      try {
        const { message } = JSON.parse(event.data);
        if (message) {
          setDockerLiveLines(previous => [...previous, message].slice(-400));
          setDockerStreamState(message.startsWith('__MONITOR_ERROR__') ? 'error' : 'live');
        }
      } catch {
        setDockerLiveLines(previous => [...previous, event.data].slice(-400));
        setDockerStreamState('live');
      }
    };

    stream.onerror = () => {
      if (dockerStreamRef.current !== stream) return;
      stream.close();
      dockerStreamRef.current = null;
      setDockerStreamState('error');
    };
  };

  const selectLogTab = (tabId) => {
    setActiveLogTab(tabId);
    if (tabId === 'docker') startDockerStream();
    else stopDockerStream();
  };

  const closeLogViewer = () => {
    stopDockerStream();
    setShowLogModal(false);
  };

  useEffect(() => () => {
    if (dockerStreamRef.current) dockerStreamRef.current.close();
  }, []);

  useEffect(() => {
    if (activeLogTab === 'docker' && logTerminalAtBottomRef.current && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [activeLogTab, dockerLiveLines]);

  const openLogViewer = async () => {
    const index = Math.min(Math.max(0, Math.floor((scrubberRatio ?? 1) * (totalPoints - 1))), totalPoints - 1);
    const timestamp = timelineTimestamps[index];
    setShowLogModal(true);
    setActiveLogTab('system');
    setLogResult(null);
    stopDockerStream();

    if (!timestamp || !onInspectLogs) {
      setLogResult({ error: 'No exact timestamp is available for this sample.' });
      return;
    }

    setLogLoading(true);
    try {
      setLogResult(await onInspectLogs(timestamp));
    } catch (error) {
      setLogResult({ error: error.message || 'Unable to retrieve server logs.' });
    } finally {
      setLogLoading(false);
    }
  };

  // Jump to absolute highest peak in the active timeline (global: sync all to same point)
  const jumpToPeak = () => {
    const peakIdx = cpuPeak?.idx ?? ramPeak?.idx ?? netPeak?.idx ?? diskPeak?.idx;
    if (peakIdx == null || peakIdx < 0 || totalPoints === 0) return;
    const nextRatio = totalPoints > 1 ? peakIdx / (totalPoints - 1) : 1;
    if (setSyncEnabled) setSyncEnabled(true);
    onScrubberChange(nextRatio);
    setScrubPreview(timelineLabels[peakIdx]);
  };

  // Jump each card to ITS OWN individual peak (not synced to same timestamp)
  const jumpToIndividualPeak = () => {
    if (onJumpToIndividualPeak) onJumpToIndividualPeak();
  };

  // Jump to next or previous spike
  const jumpToSpike = (direction) => {
    if (spikeIndices.length === 0 || totalPoints === 0) {
      jumpToPeak();
      return;
    }
    if (setSyncEnabled) setSyncEnabled(true);
    const currentIdx = Math.floor((scrubberRatio ?? 1) * (totalPoints - 1));
    let targetIdx;
    if (direction === 'next') {
      targetIdx = spikeIndices.find(idx => idx > currentIdx) ?? spikeIndices[0];
    } else {
      const reversed = [...spikeIndices].reverse();
      targetIdx = reversed.find(idx => idx < currentIdx) ?? spikeIndices[spikeIndices.length - 1];
    }
    const nextRatio = totalPoints > 1 ? targetIdx / (totalPoints - 1) : 1;
    onScrubberChange(nextRatio);
    setScrubPreview(timelineLabels[targetIdx]);
  };

  // Export current timeline points to CSV
  const exportCsv = () => {
    const points = historyData?.data || cpuHistory.map((d, i) => ({
      label: d.time,
      t: Date.now() - (cpuHistory.length - 1 - i) * 10000,
      cpu: d.value,
      ram: ramHistory[i]?.value ?? null,
      rxBytes: null,
      txBytes: null,
      disk: null,
    }));

    if (!points || points.length === 0) return;

    const headers = ['Timestamp', 'TimeLabel', 'CPU_Percent', 'RAM_Percent', 'Network_Rx_Bps', 'Network_Tx_Bps', 'Disk_Percent'];
    const rows = points.map(p => [
      p.t || '',
      `"${p.label || ''}"`,
      p.cpu != null ? p.cpu.toFixed(2) : '',
      p.ram != null ? p.ram.toFixed(2) : '',
      p.rxBytes != null ? p.rxBytes : '',
      p.txBytes != null ? p.txBytes : '',
      p.disk != null ? p.disk.toFixed(2) : ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `server-metrics-${historyRange}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 shadow-sm space-y-2.5">
      {/* Top row: Range selector + Status + Mode + Zoom controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* History Range Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-xs">
          {[
            { id: 'live', label: 'Live' },
            { id: '1h',   label: '1h' },
            { id: '6h',   label: '6h' },
            { id: '24h',  label: '24h' },
            { id: '7d',   label: '7d' },
            { id: '30d',  label: '30d' },
          ].map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setHistoryRange(r.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                historyRange === r.id
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {r.id === 'live' && (
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${historyRange === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-muted)]'}`} />
              )}
              {r.label}
            </button>
          ))}
        </div>

        {/* Status / Count indicator & Spikes Detector */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {historyRange !== 'live' ? (
            historyLoading ? (
              <span className="flex items-center gap-1 text-indigo-400"><RefreshCw size={11} className="animate-spin" /> Loading history…</span>
            ) : historyData ? (
              <span>{historyData.count} data points · {historyRefreshLabel}</span>
            ) : null
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {liveCount} live points
            </span>
          )}

          {/* High load spike detector & Peaks strip for ALL 4 metrics */}
          {totalPoints > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Spikes Pill (if any spikes above threshold) */}
              {spikeIndices.length > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-medium" title={`Points where CPU or RAM exceeded ${spikeThreshold}%`}>
                  <Flame size={11} className="animate-pulse text-rose-400" />
                  <button
                    type="button"
                    onClick={() => setSpikeThreshold(prev => prev === 30 ? 50 : prev === 50 ? 70 : prev === 70 ? 80 : 30)}
                    className="hover:underline font-semibold cursor-pointer"
                    title="Click to toggle threshold: >30%, >50%, >70%, >80%"
                  >
                    {spikeIndices.length} {spikeIndices.length === 1 ? 'spike' : 'spikes'} (&gt;{spikeThreshold}%)
                  </button>
                  <div className="flex items-center ml-1 border-l border-rose-500/30 pl-1 gap-0.5">
                    <button
                      type="button"
                      onClick={() => jumpToSpike('prev')}
                      className="px-1 hover:bg-rose-500/20 rounded cursor-pointer transition-colors"
                      title="Jump to previous spike"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpToSpike('next')}
                      className="px-1 hover:bg-rose-500/20 rounded cursor-pointer transition-colors"
                      title="Jump to next spike"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              )}

              {/* All 4 Peak Metric Pills */}
              <div className="flex items-center gap-1 text-[10px] font-mono bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg p-0.5">
                {/* CPU Peak */}
                {cpuPeak && (
                  <button
                    type="button"
                    onClick={() => {
                      if (cpuPeak.idx >= 0) {
                        const ratio = totalPoints > 1 ? cpuPeak.idx / (totalPoints - 1) : 1;
                        if (setSyncEnabled) setSyncEnabled(true);
                        onScrubberChange(ratio);
                        setScrubPreview(timelineLabels[cpuPeak.idx]);
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-indigo-500/20 text-indigo-300 transition-colors cursor-pointer"
                    title={`Highest CPU: ${cpuPeak.val.toFixed(1)}% at ${cpuPeak.time || 'past'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    <span>CPU <strong>{cpuPeak.val.toFixed(0)}%</strong></span>
                  </button>
                )}

                {/* RAM Peak */}
                {ramPeak && (
                  <button
                    type="button"
                    onClick={() => {
                      if (ramPeak.idx >= 0) {
                        const ratio = totalPoints > 1 ? ramPeak.idx / (totalPoints - 1) : 1;
                        if (setSyncEnabled) setSyncEnabled(true);
                        onScrubberChange(ratio);
                        setScrubPreview(timelineLabels[ramPeak.idx]);
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-emerald-500/20 text-emerald-300 transition-colors cursor-pointer border-l border-[var(--border-color)]/60"
                    title={`Highest RAM: ${ramPeak.val.toFixed(1)}% at ${ramPeak.time || 'past'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>RAM <strong>{ramPeak.val.toFixed(0)}%</strong></span>
                  </button>
                )}

                {/* Network Peak */}
                {netPeak && (
                  <button
                    type="button"
                    onClick={() => {
                      if (netPeak.idx >= 0) {
                        const ratio = totalPoints > 1 ? netPeak.idx / (totalPoints - 1) : 1;
                        if (setSyncEnabled) setSyncEnabled(true);
                        onScrubberChange(ratio);
                        setScrubPreview(timelineLabels[netPeak.idx]);
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-500/20 text-blue-300 transition-colors cursor-pointer border-l border-[var(--border-color)]/60"
                    title={`Highest Network: ${formatBytes(netPeak.val)}/s at ${netPeak.time || 'past'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    <span>Net <strong>{formatBytes(netPeak.val)}/s</strong></span>
                  </button>
                )}

                {/* Disk Peak */}
                {diskPeak && (
                  <button
                    type="button"
                    onClick={() => {
                      if (diskPeak.idx >= 0) {
                        const ratio = totalPoints > 1 ? diskPeak.idx / (totalPoints - 1) : 1;
                        if (setSyncEnabled) setSyncEnabled(true);
                        onScrubberChange(ratio);
                        setScrubPreview(timelineLabels[diskPeak.idx]);
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-purple-500/20 text-purple-300 transition-colors cursor-pointer border-l border-[var(--border-color)]/60"
                    title={`Highest Disk: ${diskPeak.val.toFixed(1)}% at ${diskPeak.time || 'past'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    <span>Disk <strong>{diskPeak.val.toFixed(0)}%</strong></span>
                  </button>
                )}

                {/* Jump All Button */}
                <button
                  type="button"
                  onClick={jumpToIndividualPeak}
                  className="ml-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-sans font-semibold cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
                  title="Jump every card to its own individual peak simultaneously"
                >
                  <Zap size={10} className="fill-white" />
                  Jump All ⚡
                </button>
              </div>
            </div>
          )}

          {historyRange !== 'live' && (
            <button
              type="button"
              onClick={() => fetchHistory(historyRange, selectedConnection)}
              disabled={historyLoading}
              className="p-1 hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 cursor-pointer"
              title="Refresh historical data"
            >
              <RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} />
            </button>
          )}

          {/* Export CSV button */}
          {totalPoints > 0 && (
            <button
              type="button"
              onClick={exportCsv}
              className="p-1 hover:text-[var(--text-primary)] text-[var(--text-muted)] transition-colors cursor-pointer"
              title="Export timeline data to CSV"
            >
              <FileSpreadsheet size={13} />
            </button>
          )}
        </div>

        {/* Sync Mode & Global Zoom Controls */}
        <div className="flex items-center gap-3">
          {/* Synced vs Independent Toggle */}
          {setSyncEnabled && (
            <button
              type="button"
              onClick={() => setSyncEnabled(!syncEnabled)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                syncEnabled
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-primary)]'
              }`}
              title={syncEnabled ? 'All charts scroll together (Synced)' : 'Each chart scrolls independently (Individual)'}
            >
              <Sliders size={12} className={syncEnabled ? 'text-indigo-400' : 'text-[var(--text-muted)]'} />
              <span>{syncEnabled ? '🔗 Synced' : '🔓 Individual'}</span>
            </button>
          )}

          {/* Global Timeline Zoom Buttons */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className="text-[11px] font-medium hidden sm:inline">Zoom:</span>
            <div className="flex items-center gap-1 p-0.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-xs">
              {[
                { id: 'fit', label: 'Fit' },
                { id: '1x', label: '1x' },
                { id: '2x', label: '2x' },
                { id: '4x', label: '4x' },
              ].map(z => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setZoomLevel(z.id)}
                  className={`px-2 py-0.5 rounded font-medium transition-all text-xs cursor-pointer ${
                    zoomLevel === z.id
                      ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title={z.id === 'fit' ? 'Fit all points into card width' : `Zoom density: ${z.label}`}
                >
                  {z.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: Timeline Scrubber Slider Bar */}
      {totalPoints > 1 && (
        <div className="pt-2 border-t border-[var(--border-color)]/60">
          <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] mb-1">
            <span className="flex items-center gap-1" title="Oldest recorded point">
              <Clock size={11} className="text-indigo-400 shrink-0" />
              {oldestTime}
            </span>

            {/* Scrub Preview / Past Inspector */}
            <div className="flex items-center gap-2">
              {scrubberRatio !== null && scrubberRatio < 0.98 ? (
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-medium flex items-center gap-1">
                    <Eye size={10} /> Past: {scrubPreview || 'selected'}
                  </span>
                  {/* View Server Logs Button */}
                  <button
                    type="button"
                    onClick={openLogViewer}
                    className="px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] border border-[var(--border-color)] text-indigo-300 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    title="Open server logs for this timestamp"
                  >
                    <ScrollText size={10} className="text-indigo-400" />
                    Inspect Logs
                  </button>
                </div>
              ) : (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live / Latest
                </span>
              )}

              {/* Quick Jump Buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleStep(-10)}
                  className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Step 10 points into past"
                >
                  ◀ -10
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(10)}
                  className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Step 10 points forward"
                >
                  +10 ▶
                </button>
                <button
                  type="button"
                  onClick={onSnapToLive}
                  className="px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Jump to latest timestamp"
                >
                  <Zap size={10} className="fill-white" /> Now
                </button>
              </div>
            </div>

            <span className="flex items-center gap-1" title="Latest recorded point">
              {latestTime}
            </span>
          </div>

          {/* Interactive Range Slider Scrubber */}
          <div className="relative flex items-center">
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={scrubberRatio ?? 1}
              onInput={handleSliderChange}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
              title="Drag slider to scroll sideways through time in realtime"
            />
          </div>
        </div>
      )}

      {/* Log Inspection Dialog Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-full max-w-3xl shadow-2xl p-4 space-y-3 animate-scale-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <ScrollText size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Server logs</h3>
                  <p className="text-[11px] text-[var(--text-muted)] font-mono">
                    {logResult?.from ? `${new Date(logResult.from).toLocaleString()} to ${new Date(logResult.until).toLocaleString()}` : `Loading ${scrubPreview || 'selected time'}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeLogViewer}
                className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                aria-label="Close log viewer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-1">
                {[
                  { id: 'system', label: 'System journal' },
                  { id: 'docker', label: 'Docker' },
                ].map(tab => (
                  <button key={tab.id} type="button" onClick={() => selectLogTab(tab.id)} className={`px-2.5 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${activeLogTab === tab.id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <span className="flex items-center gap-1.5">
                      {tab.label}
                      {tab.id === 'docker' && dockerStreamState !== 'idle' && <span className={`w-1.5 h-1.5 rounded-full ${dockerStreamState === 'live' ? 'bg-emerald-400 animate-pulse' : dockerStreamState === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`} />}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={openLogViewer} disabled={logLoading} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer" title="Reload logs" aria-label="Reload logs">
                <RefreshCw size={14} className={logLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div
              ref={logTerminalRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                logTerminalAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
              }}
              className="h-80 overflow-auto rounded-lg border border-[var(--border-color)] bg-[#0b1020] p-3 font-mono text-[11px] leading-5 text-slate-200 whitespace-pre-wrap break-words custom-scrollbar"
              aria-live="polite"
            >
              {logLoading ? (
                <span className="flex items-center gap-2 text-indigo-300"><RefreshCw size={14} className="animate-spin" /> Connecting to server and retrieving logs...</span>
              ) : logResult?.error ? (
                <span className="text-rose-300">{logResult.error}</span>
              ) : (
                activeLogTab === 'docker'
                  ? [logResult?.docker, ...dockerLiveLines].filter(Boolean).join('\n') || 'No Docker entries were returned for this window.'
                  : logResult?.system || 'No system journal entries were returned for this window.'
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={closeLogViewer}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServerMonitorApp() {
  const { t } = useTranslation();
  const { state: appState, apiFetch, relayInfo } = useApp();
  
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // overview, apps, processes
  const [metrics, setMetrics] = useState(null);
  const [appsData, setAppsData] = useState({}); // cached by connectionId: { apps, timestamp }
  const [appsLoading, setAppsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(10000); // default 10s for agentless; agent unlocks faster intervals
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [showAgentWizard, setShowAgentWizard] = useState(false);

  // ── Processes Management State ──
  const [processesData, setProcessesData] = useState({}); // { [connId]: { processes: [], total: 0, timestamp: null } }
  const [processesLoading, setProcessesLoading] = useState(false);
  const [procSearchQuery, setProcSearchQuery] = useState('');
  const [procSortField, setProcSortField] = useState('cpu'); // 'cpu' | 'mem' | 'rssKb' | 'pid' | 'name'
  const [procSortDir, setProcSortDir] = useState('desc'); // 'desc' | 'asc'
  const [killModal, setKillModal] = useState({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null });

  // Per-server agent status (keyed by connectionId) — from SSH process check
  const [agentStatuses, setAgentStatuses] = useState({}); // { [connId]: { isRunning, nodeInstalled, inTmux, inService, checkedAt } }
  // Live WebSocket-connected monitor agents (from agent:online/offline events)
  const [connectedAgents, setConnectedAgents] = useState(new Map()); // agentName → { agentName, host, connectedAt }
  const agentPollRef = useRef(null);

  // Client-side previous sample for instantaneous delta math (user machine CPU/Net calculation)
  const prevSampleRef = useRef(null);
  const inFlightMetricsRef = useRef(false);
  const abortControllerRef = useRef(null);
  const intervalRef = useRef(null);
  const relayPollRef = useRef(null);

  // Historical data for charts (last 360 points — live ring buffer)
  const [cpuHistory, setCpuHistory] = useState([]);
  const [ramHistory, setRamHistory] = useState([]);
  const [networkHistory, setNetworkHistory] = useState([]);
  const [diskHistory, setDiskHistory] = useState([]);

  // Timeline zoom & horizontal scroller state
  const [timelineZoom, setTimelineZoom] = useState('1x'); // 'fit' | '1x' | '2x' | '4x'
  const [syncScrollRatio, setSyncScrollRatio] = useState(1); // 0 to 1
  const [syncEnabled, setSyncEnabled] = useState(false); // whether scrolling one card or master scrubber syncs all charts
  const [jumpToIndividualPeakSignal, setJumpToIndividualPeakSignal] = useState(0); // increment to broadcast jump-to-own-peak

  // Persistent history (fetched from DB for 1h / 6h / 24h views)
  const [historyRange, setHistoryRange] = useState('live'); // 'live' | '1h' | '6h' | '24h' | '7d' | '30d'
  const [historyData, setHistoryData] = useState(null);    // { data: [...], range, count } | null
  const [historyLoading, setHistoryLoading] = useState(false);
  const lastSnapshotRef = useRef(0); // timestamp of last DB snapshot write (throttle to 1/30s)

  const inFlightProcRef = useRef(false);
  const inFlightStatusRef = useRef(false);
  const inFlightAppsRef = useRef(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const [isSocketStreaming, setIsSocketStreaming] = useState(false);
  const [isP2PStreaming, setIsP2PStreaming] = useState(false);
  const isP2PStreamingRef = useRef(false); // ref to avoid stale closure in socket event handlers

  // Refs for latest state accessible inside closed-over socket event handlers
  const selectedConnectionRef = useRef(null);
  const connectionsRef = useRef([]);
  const refreshIntervalRef = useRef(10000);

  const connections = useMemo(() => {
    return (appState.connections || []).filter(c => c.type === 'ssh' || (!c.type && !c.dbProvider));
  }, [appState.connections]);

  // Select first SSH connection by default (or fallback if current selection is not an SSH connection)
  useEffect(() => {
    if (connections.length > 0) {
      if (!selectedConnection || !connections.some(c => c._id === selectedConnection)) {
        setSelectedConnection(connections[0]._id);
      }
    } else {
      setSelectedConnection(null);
    }
  }, [connections, selectedConnection]);

  // Keep refs in sync with latest state (for use inside closed-over socket handlers)
  useEffect(() => { selectedConnectionRef.current = selectedConnection; }, [selectedConnection]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => { refreshIntervalRef.current = refreshInterval; }, [refreshInterval]);

  // Guard: if agent goes offline while a fast interval is active, clamp to 10s minimum
  useEffect(() => {
    const agentActive = isSocketStreaming || isP2PStreaming;
    if (!agentActive && refreshInterval < 10000) {
      setRefreshInterval(10000);
    }
  }, [isSocketStreaming, isP2PStreaming, refreshInterval]);



  // ── Per-connection agent status polling ──
  const checkAgentStatusForConn = useCallback(async (connId) => {
    if (!connId || inFlightStatusRef.current) return;
    inFlightStatusRef.current = true;
    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId, action: 'status' })
      });
      if (res.ok) {
        const data = await res.json();
        setAgentStatuses(prev => ({
          ...prev,
          [connId]: {
            isRunning: data.isRunning,
            nodeInstalled: data.nodeInstalled,
            inTmux: data.inTmux,
            inService: data.inService,
            checkedAt: Date.now()
          }
        }));
      }
    } catch (_) {
    } finally {
      inFlightStatusRef.current = false;
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!selectedConnection) return;

    // Only run SSH process check if agent is NOT streaming live via WebSocket
    if (isSocketStreaming || isP2PStreaming) return;

    // Check once when connection changes
    checkAgentStatusForConn(selectedConnection);

    // Only poll over SSH every 30s if wizard is open or agent is offline
    if (showAgentWizard) {
      agentPollRef.current = setInterval(() => {
        if (!isSocketStreaming && !isP2PStreaming) {
          checkAgentStatusForConn(selectedConnection);
        }
      }, 30000);
    }

    return () => {
      if (agentPollRef.current) clearInterval(agentPollRef.current);
    };
  }, [selectedConnection, isSocketStreaming, isP2PStreaming, showAgentWizard, checkAgentStatusForConn]);

  // Page Visibility detection - pause polling when tab/window is in the background
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = !document.hidden;
      setIsTabVisible(visible);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Clear previous samples and reset stream state when server connection changes
  useEffect(() => {
    prevSampleRef.current = null;
    setCpuHistory([]);
    setRamHistory([]);
    setNetworkHistory([]);
    setDiskHistory([]);
    setHistoryRange('live');
    setHistoryData(null);
    setError(null);
    setMetrics(null);
    setIsSocketStreaming(false);
    setIsP2PStreaming(false);
    isP2PStreamingRef.current = false;
  }, [selectedConnection]);

  // Client-side CPU and Network rate calculation from cumulative delta counters
  const computeClientDeltas = useCallback((rawMetrics) => {
    const nowMs = rawMetrics.timestampMs || Date.now();
    const prev = prevSampleRef.current;
    
    let computedCpuUsage = rawMetrics.cpu?.usage || 0;
    let computedRxRate = rawMetrics.network?.rxRate || 0;
    let computedTxRate = rawMetrics.network?.txRate || 0;

    if (prev && prev.timeMs) {
      const deltaMs = Math.max(50, nowMs - prev.timeMs);
      const deltaSec = deltaMs / 1000;

      // 1. CPU Usage Delta Math
      if (rawMetrics.cpu?.raw && prev.cpuRaw) {
        const deltaTotal = rawMetrics.cpu.raw.total - prev.cpuRaw.total;
        const deltaIdle = rawMetrics.cpu.raw.idle - prev.cpuRaw.idle;
        if (deltaTotal > 0) {
          const usedRatio = (deltaTotal - deltaIdle) / deltaTotal;
          computedCpuUsage = Math.max(0, Math.min(100, usedRatio * 100));
        }
      }

      // 2. Network RX / TX Rate Delta Math
      if (rawMetrics.network && prev.netRaw) {
        const rxTotal = rawMetrics.network.rxTotal || 0;
        const txTotal = rawMetrics.network.txTotal || 0;
        const deltaRx = Math.max(0, rxTotal - prev.netRaw.rxTotal);
        const deltaTx = Math.max(0, txTotal - prev.netRaw.txTotal);
        computedRxRate = deltaRx / deltaSec;
        computedTxRate = deltaTx / deltaSec;
      }
    }

    // Save current sample for next delta calculation
    prevSampleRef.current = {
      timeMs: nowMs,
      cpuRaw: rawMetrics.cpu?.raw || null,
      netRaw: {
        rxTotal: rawMetrics.network?.rxTotal || 0,
        txTotal: rawMetrics.network?.txTotal || 0,
      }
    };

    return {
      ...rawMetrics,
      cpu: {
        ...rawMetrics.cpu,
        usage: computedCpuUsage,
      },
      network: {
        ...rawMetrics.network,
        rxRate: computedRxRate,
        txRate: computedTxRate,
      }
    };
  }, []);

  // Fetch metrics with in-flight guard and client delta computation
  const fetchMetrics = useCallback(async (isManual = false) => {
    if (!selectedConnection) return;
    if (inFlightMetricsRef.current && !isManual) return;

    inFlightMetricsRef.current = true;
    if (isManual) setLoading(true);

    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const response = await apiFetch(`/api/server-monitor/metrics?connectionId=${selectedConnection}`, {
        signal: abortControllerRef.current.signal
      });

      if (response.ok) {
        const data = await response.json();
        const processed = computeClientDeltas(data);
        
        setMetrics(processed);
        setError(null);

        // Update charts on client machine
        const timestamp = new Date(processed.timestampMs || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setCpuHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: processed.cpu?.usage || 0 }]);
        setRamHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: processed.memory?.usedPercent || 0 }]);
        setNetworkHistory(prev => [...prev.slice(-359), { 
          time: timestamp, t: processed.timestampMs || Date.now(),
          rx: processed.network?.rxRate || 0, 
          tx: processed.network?.txRate || 0 
        }]);
        const primaryDisk = processed.disk?.filesystems?.[0];
        setDiskHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: primaryDisk?.usedPercent || 0 }]);
      } else {
        const errData = await response.json();
        setError(errData.error || 'Failed to fetch metrics');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Fetch metrics error:', err);
        setError(err.message);
      }
    } finally {
      inFlightMetricsRef.current = false;
      if (isManual) setLoading(false);
    }
  }, [selectedConnection, apiFetch, computeClientDeltas]);

  // Fetch installed applications (on-demand with client cache)
  const fetchApps = useCallback(async (force = false) => {
    if (!selectedConnection || inFlightAppsRef.current) return;
    inFlightAppsRef.current = true;
    setAppsLoading(true);

    try {
      const response = await apiFetch(`/api/server-monitor/apps?connectionId=${selectedConnection}`);
      if (response.ok) {
        const data = await response.json();
        setAppsData(prev => ({
          ...prev,
          [selectedConnection]: {
            ...data,
            timestamp: Date.now()
          }
        }));
      }
    } catch (err) {
      console.error('Fetch apps error:', err);
    } finally {
      inFlightAppsRef.current = false;
      setAppsLoading(false);
    }
  }, [selectedConnection, apiFetch]);

  // Fetch running processes (on-demand or live polling)
  const fetchProcesses = useCallback(async (force = false) => {
    if (!selectedConnection || inFlightProcRef.current) return;
    inFlightProcRef.current = true;
    setProcessesLoading(true);

    try {
      const response = await apiFetch(`/api/server-monitor/processes?connectionId=${selectedConnection}`);
      if (response.ok) {
        const data = await response.json();
        setProcessesData(prev => ({
          ...prev,
          [selectedConnection]: {
            processes: data.processes || [],
            total: data.total || 0,
            timestamp: Date.now()
          }
        }));
      }
    } catch (err) {
      console.error('Fetch processes error:', err);
    } finally {
      inFlightProcRef.current = false;
      setProcessesLoading(false);
    }
  }, [selectedConnection, apiFetch]);

  // Terminate / Kill process by PID
  const executeKillProcess = async () => {
    if (!killModal.process || !selectedConnection) return;
    setKillModal(prev => ({ ...prev, loading: true, error: null }));

    try {
      const res = await apiFetch('/api/server-monitor/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConnection,
          pid: killModal.process.pid,
          signal: killModal.signal
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null });
        // Refresh process list immediately
        fetchProcesses(true);
      } else {
        setKillModal(prev => ({ ...prev, loading: false, error: data.error || 'Failed to terminate process' }));
      }
    } catch (err) {
      setKillModal(prev => ({ ...prev, loading: false, error: err.message }));
    }
  };


  // Common handler for incoming telemetry data
  const handleIncomingTelemetry = useCallback((raw) => {
    const processed = computeClientDeltas(raw);
    setMetrics(processed);
    setError(null);

    const timestamp = new Date(processed.timestampMs || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setCpuHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: processed.cpu?.usage || 0 }]);
    setRamHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: processed.memory?.usedPercent || 0 }]);
    setNetworkHistory(prev => [...prev.slice(-359), { 
      time: timestamp, t: processed.timestampMs || Date.now(),
      rx: processed.network?.rxRate || 0, 
      tx: processed.network?.txRate || 0 
    }]);
    const primaryDisk = processed.disk?.filesystems?.[0];
    setDiskHistory(prev => [...prev.slice(-359), { time: timestamp, t: processed.timestampMs || Date.now(), value: primaryDisk?.usedPercent || 0 }]);

    // Throttled DB snapshot — at most once every 30 seconds
    const now = Date.now();
    if (now - lastSnapshotRef.current >= 30_000) {
      lastSnapshotRef.current = now;
      const connId = selectedConnectionRef.current;
      if (connId) {
        apiFetch('/api/server-monitor/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: connId,
            cpu:          processed.cpu?.usage     ?? null,
            ram:          processed.memory?.usedPercent ?? null,
            rxBytes:      processed.network?.rxRate ?? null,
            txBytes:      processed.network?.txRate ?? null,
            disk:         primaryDisk?.usedPercent  ?? null,
          }),
        }).catch(() => {}); // fire-and-forget
      }
    }
  }, [computeClientDeltas, apiFetch]);

  // Fetch history from DB for a given range
  const fetchHistory = useCallback(async (range, connId) => {
    if (!connId || range === 'live') { setHistoryData(null); return; }
    setHistoryLoading(true);
    try {
      const res = await apiFetch(`/api/server-monitor/history?connectionId=${connId}&range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setHistoryData(json);
      }
    } catch (err) {
      console.error('[fetchHistory]', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiFetch]);

  // Re-fetch history when range or selected connection changes
  useEffect(() => {
    if (historyRange !== 'live') {
      fetchHistory(historyRange, selectedConnection);
    } else {
      setHistoryData(null);
    }
  }, [historyRange, selectedConnection, fetchHistory]);

  // Auto-refresh history (throttled by range length — longer ranges refresh less frequently)
  useEffect(() => {
    if (historyRange === 'live') return;
    // Longer ranges refresh less frequently: 1h/6h → 30s, 24h → 60s, 7d/30d → 5min
    const intervalMs = (historyRange === '7d' || historyRange === '30d') ? 300_000
      : historyRange === '24h' ? 60_000
      : 30_000;
    const id = setInterval(() => {
      fetchHistory(historyRange, selectedConnection);
    }, intervalMs);
    return () => clearInterval(id);
  }, [historyRange, selectedConnection, fetchHistory]);

  // ── WebRTC P2P DataChannel + WebSocket Relay Stream ──
  useEffect(() => {
    const socket = io({
      path: '/api/socket',
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // 1. Ask server for currently connected monitor agents
      socket.emit('agent:list');

      const selectedConn_ = connections.find(c => c._id === selectedConnection);
      const targetHost = selectedConn_?.host || '';
      const targetLabel = selectedConn_?.label || '';

      // 2. First priority: initiate WebRTC P2P DataChannel signaling for selected server
      socket.emit('telemetry:webrtc:init', {
        connectionId: selectedConnection,
        targetHost,
        targetLabel
      });
      
      // Fallback: If not P2P yet, start WebSocket stream
      if (autoRefresh && isTabVisible && selectedConnection && !peerRef.current) {
        socket.emit('telemetry:start_stream', {
          interval: refreshInterval,
          connectionId: selectedConnection,
          targetHost,
          targetLabel
        });
      }
    });

    // Agent online/offline events from server
    socket.on('agent:list:result', (agents) => {
      setConnectedAgents(new Map(agents.map(a => [a.agentName, a])));
      // Re-request stream in case stream was sent before agents were registered
      if (agents.length > 0 && selectedConnectionRef.current && !isP2PStreamingRef.current) {
        const conn_ = connectionsRef.current.find(c => c._id === selectedConnectionRef.current);
        socket.emit('telemetry:start_stream', {
          interval: refreshIntervalRef.current,
          connectionId: selectedConnectionRef.current,
          targetHost: conn_?.host || '',
          targetLabel: conn_?.label || ''
        });
      }
    });
    socket.on('agent:online', (info) => {
      setConnectedAgents(prev => {
        const next = new Map(prev);
        next.set(info.agentName, info);
        return next;
      });
      // An agent just came online — re-request stream for current server
      if (selectedConnectionRef.current && !isP2PStreamingRef.current) {
        const conn_ = connectionsRef.current.find(c => c._id === selectedConnectionRef.current);
        socket.emit('telemetry:start_stream', {
          interval: refreshIntervalRef.current,
          connectionId: selectedConnectionRef.current,
          targetHost: conn_?.host || '',
          targetLabel: conn_?.label || ''
        });
      }
    });
    socket.on('agent:offline', (info) => {
      setConnectedAgents(prev => {
        const next = new Map(prev);
        next.delete(info.agentName);
        return next;
      });
      setIsSocketStreaming(false);
    });

    // 2. WebRTC P2P negotiation (Direct DataChannel)
    socket.on('telemetry:rtc:ready', async ({ connId }) => {
      try {
        console.log('[WebRTC Telemetry] Negotiating P2P DataChannel for connId:', connId);
        const peer = await createRelayPeer({ socket, relayConnId: connId });
        peerRef.current = peer;
        setIsP2PStreaming(true);
        isP2PStreamingRef.current = true;
        setIsSocketStreaming(false);

        // Tell central server to stop WebSocket relay since P2P is now active
        socket.emit('telemetry:stop_stream');

        peer.onControl((msg) => {
          if (msg.type === 'telemetry:stream') {
            setIsP2PStreaming(true);
            handleIncomingTelemetry(msg.data);
          }
        });

        if (autoRefresh && isTabVisible && selectedConnection) {
          peer.sendControl({
            type: 'telemetry:start_stream',
            interval: refreshInterval,
            connectionId: selectedConnection
          });
        }
      } catch (err) {
        console.log('[WebRTC Telemetry] P2P negotiation failed, falling back to WebSocket relay:', err.message);
        setIsP2PStreaming(false);
        isP2PStreamingRef.current = false;
        if (autoRefresh && isTabVisible && selectedConnection) {
          socket.emit('telemetry:start_stream', {
            interval: refreshInterval,
            connectionId: selectedConnection
          });
        }
      }
    });

    socket.on('telemetry:no_agent', () => {
      console.log('[ServerMonitor] No agent available for selected server — falling back to HTTP polling');
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
      isP2PStreamingRef.current = false;
    });

    // 3. Fallback WebSocket Relay Stream handler
    // IMPORTANT: Only set isSocketStreaming=true if we receive data from an actual agent
    // Don't set it for HTTP polling fallback data
    socket.on('telemetry:stream', (raw) => {
      if (!isP2PStreamingRef.current) {
        // Only mark as streaming if we have a connection ID that matches
        // This prevents false-positive "Agent Connected" status
        console.log('[ServerMonitor] Receiving telemetry:stream from agent');
        setIsSocketStreaming(true);
        handleIncomingTelemetry(raw);
      }
    });

    socket.on('disconnect', () => {
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
      isP2PStreamingRef.current = false;
    });

    return () => {
      if (peerRef.current) {
        try {
          peerRef.current.sendControl({ type: 'telemetry:stop_stream' });
          peerRef.current.close();
        } catch (_) {}
        peerRef.current = null;
      }
      if (socket.connected) {
        socket.emit('telemetry:stop_stream');
      }
      socket.disconnect();
      socketRef.current = null;
      setIsSocketStreaming(false);
      setIsP2PStreaming(false);
    };
  }, [handleIncomingTelemetry]);

  // Track previous selected connection to detect server switches
  const prevSelectedConnectionRef = useRef(null);

  // Synchronize stream interval and target parameters
  useEffect(() => {
    const socket = socketRef.current;
    const selectedConn_ = connections.find(c => c._id === selectedConnection);
    const targetHost = selectedConn_?.host || '';
    const targetLabel = selectedConn_?.label || '';

    // Detect server switch while P2P is active:
    // The existing P2P peer is bound to the OLD server's agent via WebRTC DataChannel.
    // Sending telemetry:start_stream to it just tells the wrong agent to stream.
    // Instead, tear down the old peer and re-initiate WebRTC for the new server.
    const serverChanged = prevSelectedConnectionRef.current !== null &&
      prevSelectedConnectionRef.current !== selectedConnection;
    prevSelectedConnectionRef.current = selectedConnection;

    if (peerRef.current && isP2PStreaming) {
      if (serverChanged) {
        // Close old P2P connection — it belongs to the previous server's agent
        try {
          peerRef.current.sendControl({ type: 'telemetry:stop_stream' });
          peerRef.current.close();
        } catch (_) {}
        peerRef.current = null;
        setIsP2PStreaming(false);
        isP2PStreamingRef.current = false;

        // Re-initiate WebRTC for the new server, then fall through to socket path below
        if (socket && socket.connected && autoRefresh && isTabVisible && selectedConnection) {
          socket.emit('telemetry:webrtc:init', { connectionId: selectedConnection, targetHost, targetLabel });
          socket.emit('telemetry:start_stream', { interval: refreshInterval, connectionId: selectedConnection, targetHost, targetLabel });
        }
        return;
      }

      // Same server — just update interval/params on the existing P2P peer
      if (autoRefresh && isTabVisible && selectedConnection) {
        peerRef.current.sendControl({
          type: 'telemetry:start_stream',
          interval: refreshInterval,
          connectionId: selectedConnection
        });
      } else {
        peerRef.current.sendControl({ type: 'telemetry:stop_stream' });
        setIsP2PStreaming(false);
      }
      return;
    }

    if (!socket || !socket.connected) return;

    if (autoRefresh && isTabVisible && selectedConnection) {
      // Re-initiate WebRTC for the new server first (best path)
      socket.emit('telemetry:webrtc:init', { connectionId: selectedConnection, targetHost, targetLabel });

      socket.emit('telemetry:start_stream', {
        interval: refreshInterval,
        connectionId: selectedConnection,
        targetHost,
        targetLabel
      });
    } else {
      socket.emit('telemetry:stop_stream');
      setIsSocketStreaming(false);
    }
  }, [autoRefresh, isTabVisible, selectedConnection, refreshInterval, isP2PStreaming, connections]);

  // Active polling lifecycle for remote server metrics
  // Only run HTTP polling when neither WebSocket stream nor P2P DataChannel is active
  useEffect(() => {
    if (!selectedConnection) return;
    // Skip HTTP polling when real-time stream is already delivering telemetry
    if (isSocketStreaming || isP2PStreaming) return;

    let isMounted = true;
    let timeoutId = null;

    const runLoop = async () => {
      if (!isMounted) return;
      if (autoRefresh && isTabVisible) {
        // Ensure we're not falsely showing agent connected during HTTP polling
        setIsSocketStreaming(false);
        setIsP2PStreaming(false);
        
        const start = Date.now();
        await fetchMetrics();
        if (!isMounted) return;
        const elapsed = Date.now() - start;
        const delay = Math.max(50, refreshInterval - elapsed);
        timeoutId = setTimeout(runLoop, delay);
      }
    };

    // Immediate first fetch when selectedConnection or interval changes
    runLoop();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [selectedConnection, autoRefresh, refreshInterval, isTabVisible, fetchMetrics, isSocketStreaming, isP2PStreaming]);

  // Fetch apps on-demand when switching to 'apps' tab
  useEffect(() => {
    if (activeTab === 'apps' && selectedConnection) {
      fetchApps();
    }
  }, [activeTab, selectedConnection, fetchApps]);

  // Fetch and poll processes when switching to 'processes' tab
  useEffect(() => {
    if (activeTab === 'processes' && selectedConnection) {
      fetchProcesses(true);

      let procInterval = null;
      if (autoRefresh && isTabVisible) {
        procInterval = setInterval(() => {
          fetchProcesses(true);
        }, Math.max(3000, refreshInterval));
      }

      return () => {
        if (procInterval) clearInterval(procInterval);
      };
    }
  }, [activeTab, selectedConnection, autoRefresh, refreshInterval, isTabVisible, fetchProcesses]);

  const selectedConn = connections.find(c => c._id === selectedConnection);
  const currentApps = appsData[selectedConnection]?.apps || null;
  const currentAppsTimestamp = appsData[selectedConnection]?.timestamp || null;
  const availableApps = useMemo(() => (currentApps || []).filter(a => a.installed), [currentApps]);




  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getStatusColor = (percent) => {
    if (percent >= 90) return 'text-red-400';
    if (percent >= 70) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getStatusBg = (percent) => {
    if (percent >= 90) return 'bg-red-500/20';
    if (percent >= 70) return 'bg-amber-500/20';
    return 'bg-emerald-500/20';
  };

  const getTrendIcon = (current, previous) => {
    if (previous === undefined || previous === null) return <Minus size={12} className="text-[var(--text-muted)]" />;
    if (current > previous + 0.5) return <TrendingUp size={12} className="text-red-400" />;
    if (current < previous - 0.5) return <TrendingDown size={12} className="text-emerald-400" />;
    return <Minus size={12} className="text-[var(--text-muted)]" />;
  };

  // Active timeline labels for scrubber
  const activeTimelineLabels = useMemo(() => {
    if (historyData?.data && historyData.data.length > 0) {
      return historyData.data.map(d => d.label);
    }
    return cpuHistory.map(d => d.time);
  }, [historyData, cpuHistory]);

  const activeTimelineTimestamps = useMemo(() => {
    if (historyData?.data && historyData.data.length > 0) {
      return historyData.data.map(d => d.t);
    }
    return cpuHistory.map(d => d.t);
  }, [historyData, cpuHistory]);

  const inspectHistoryLogs = useCallback(async (timestamp) => {
    const response = await apiFetch('/api/server-monitor/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: selectedConnection, timestamp }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Unable to retrieve server logs.');
    }
    return result;
  }, [apiFetch, selectedConnection]);

  // Lightweight Chart configuration (optimized for 60fps scrolling & dense points)
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    spanGaps: true,
    elements: {
      point: {
        radius: 0,
        hoverRadius: 4,
        hitRadius: 8,
      },
      line: {
        borderWidth: 2,
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 8,
        titleFont: { size: 11, weight: 'bold' },
        bodyFont: { size: 11 },
        displayColors: true,
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          callback: (value) => `${value}%`
        }
      },
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  const getCpuChartData = () => {
    const pts = historyData?.data ?? null;
    if (pts) return {
      labels: pts.map(d => d.label),
      datasets: [{ label: 'CPU Usage', data: pts.map(d => d.cpu), borderColor: 'rgb(99, 102, 241)', backgroundColor: 'rgba(99, 102, 241, 0.12)', fill: true, tension: 0.3, pointRadius: pts.length > 60 ? 0 : 2 }]
    };
    return {
      labels: cpuHistory.map(d => d.time),
      datasets: [{ label: 'CPU Usage', data: cpuHistory.map(d => d.value), borderColor: 'rgb(99, 102, 241)', backgroundColor: 'rgba(99, 102, 241, 0.12)', fill: true, tension: 0.3 }]
    };
  };

  const getRamChartData = () => {
    const pts = historyData?.data ?? null;
    if (pts) return {
      labels: pts.map(d => d.label),
      datasets: [{ label: 'RAM Usage', data: pts.map(d => d.ram), borderColor: 'rgb(16, 185, 129)', backgroundColor: 'rgba(16, 185, 129, 0.12)', fill: true, tension: 0.3, pointRadius: pts.length > 60 ? 0 : 2 }]
    };
    return {
      labels: ramHistory.map(d => d.time),
      datasets: [{ label: 'RAM Usage', data: ramHistory.map(d => d.value), borderColor: 'rgb(16, 185, 129)', backgroundColor: 'rgba(16, 185, 129, 0.12)', fill: true, tension: 0.3 }]
    };
  };

  const getNetworkChartData = () => {
    const pts = historyData?.data ?? null;
    if (pts) return {
      labels: pts.map(d => d.label),
      datasets: [
        { label: 'Download', data: pts.map(d => d.rxBytes), borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.12)', fill: true, tension: 0.3, pointRadius: pts.length > 60 ? 0 : 2 },
        { label: 'Upload',   data: pts.map(d => d.txBytes), borderColor: 'rgb(245, 158, 11)', backgroundColor: 'rgba(245, 158, 11, 0.12)', fill: true, tension: 0.3, pointRadius: pts.length > 60 ? 0 : 2 },
      ]
    };
    return {
      labels: networkHistory.map(d => d.time),
      datasets: [
        { label: 'Download', data: networkHistory.map(d => d.rx), borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.12)', fill: true, tension: 0.3 },
        { label: 'Upload',   data: networkHistory.map(d => d.tx), borderColor: 'rgb(245, 158, 11)', backgroundColor: 'rgba(245, 158, 11, 0.12)', fill: true, tension: 0.3 },
      ]
    };
  };

  const getDiskChartData = () => {
    const pts = historyData?.data ?? null;
    if (pts) return {
      labels: pts.map(d => d.label),
      datasets: [{ label: 'Disk Usage', data: pts.map(d => d.disk), borderColor: 'rgb(168, 85, 247)', backgroundColor: 'rgba(168, 85, 247, 0.12)', fill: true, tension: 0.3, pointRadius: pts.length > 60 ? 0 : 2 }]
    };
    return {
      labels: diskHistory.map(d => d.time),
      datasets: [{ label: 'Disk Usage', data: diskHistory.map(d => d.value), borderColor: 'rgb(168, 85, 247)', backgroundColor: 'rgba(168, 85, 247, 0.12)', fill: true, tension: 0.3 }]
    };
  };
  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN APP VIEW
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <Activity className="text-[var(--accent-indigo)]" size={20} />
          <div>
            <h1 className="text-base font-semibold leading-tight flex items-center gap-2">
              Server Monitor
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Zap size={10} className="fill-emerald-400" />
                {(isSocketStreaming || isP2PStreaming) ? 'Agent Streaming' : 'Agentless Mode'}
              </span>
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              {/* Status Indicator */}
              <span className={`inline-block w-2 h-2 rounded-full ${
                !autoRefresh 
                  ? 'bg-amber-400' 
                  : !isTabVisible 
                  ? 'bg-amber-500 animate-pulse' 
                  : error 
                  ? 'bg-red-400' 
                  : isP2PStreaming
                  ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse'
                  : isSocketStreaming
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse'
                  : 'bg-emerald-400 animate-pulse'
              }`} />
              <span>
                {!autoRefresh 
                  ? 'Paused' 
                  : !isTabVisible 
                  ? 'Eco Paused (Tab Hidden)' 
                  : error 
                  ? 'Connection Error' 
                  : isP2PStreaming
                  ? 'WebRTC P2P DataChannel (0ms Direct)'
                  : isSocketStreaming
                  ? 'Agent WebSocket Stream (<10ms)'
                  : 'Live — HTTP Polling'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Server selector */}
          <CustomSelect
            value={selectedConnection || ''}
            onChange={(val) => setSelectedConnection(val)}
            placeholder="Select Server"
            className="w-44"
            options={[
              { value: '', label: 'Select Server' },
              ...connections.map(conn => ({
                value: conn._id,
                label: conn.label || `${conn.username}@${conn.host}`
              }))
            ]}
          />

          {/* Polling Interval selector */}
          <div className={!autoRefresh ? 'opacity-50 pointer-events-none' : ''}>
            <CustomSelect
              value={String(refreshInterval)}
              onChange={(val) => setRefreshInterval(Number(val))}
              className="w-44"
              options={(() => {
                const agentActive = isSocketStreaming || isP2PStreaming;
                const agentMsg = 'Install Monitor Agent to unlock this interval';
                return [
                  { value: '500',   label: '500ms — Ultra Realtime', disabled: !agentActive, disabledReason: agentMsg },
                  { value: '1000',  label: '1s — High Frequency',    disabled: !agentActive, disabledReason: agentMsg },
                  { value: '2000',  label: '2s — Realtime',          disabled: !agentActive, disabledReason: agentMsg },
                  { value: '5000',  label: '5s — Standard',          disabled: !agentActive, disabledReason: agentMsg },
                  { value: '10000', label: '10s — Agentless Min' },
                  { value: '30000', label: '30s — Low Impact' },
                ];
              })()}
            />
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
              autoRefresh 
                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/30' 
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-primary)]'
            }`}
            title={autoRefresh ? 'Auto-refresh active' : 'Auto-refresh paused'}
          >
            {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
            <span className="hidden sm:inline">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>

          {/* Agent Setup Wizard Button + status badge */}
          {selectedConnection && (() => {
            const agentSt = agentStatuses[selectedConnection];
            const agentRunning = agentSt?.isRunning;
            const agentChecked = !!agentSt;
            // Check if any connected WebSocket agent matches this connection
            const selectedConn_ = connections.find(c => c._id === selectedConnection);
            const connHost = selectedConn_?.host || '';
            const connLabel = selectedConn_?.label || '';
            const currentHostname = metrics?.system?.hostname || '';
            
            // Only consider an agent "live" if we have active streaming channels
            // Don't rely solely on connectedAgents Map as it may contain stale or unrelated entries
            const liveAgent = (isSocketStreaming || isP2PStreaming) && connectedAgents.size > 0 && [...connectedAgents.values()].find(
              a => {
                // Strict matching: must match host, IP, label, or hostname
                const matchHost = a.host === connHost || a.ip === connHost;
                const matchName = a.agentName === connHost || a.agentName === connLabel;
                const matchHostname = currentHostname && (a.agentName === currentHostname || a.host === currentHostname);
                return matchHost || matchName || matchHostname;
              }
            );
            const isLive = (isSocketStreaming || isP2PStreaming) && !!liveAgent;
            return (
              <button
                onClick={() => setShowAgentWizard(true)}
                className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer ${
                  isLive
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    : agentRunning
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : agentChecked
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-indigo-600/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/25'
                }`}
                title={
                  isLive
                    ? `Agent "${liveAgent?.agentName ?? 'unknown'}" is streaming live telemetry`
                    : agentRunning
                    ? 'Monitor Agent process is running but not connected to server — check network/token'
                    : agentChecked
                    ? 'Monitor Agent not detected — click to install'
                    : 'Setup / Manage Monitor Agent on this Server'
                }
              >
                <span className={`w-2 h-2 rounded-full ${
                  isLive
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse'
                    : agentRunning
                    ? 'bg-amber-400 animate-pulse'
                    : agentChecked
                    ? 'bg-amber-400'
                    : 'bg-indigo-400 animate-pulse'
                }`} />
                <span className="hidden md:inline">
                  {isLive ? 'Agent Connected' : agentRunning ? 'Agent (No WS)' : agentChecked ? 'Install Agent' : 'Relay Agent'}
                </span>
              </button>
            );
          })()}

          {/* Manual refresh */}
          <button
            onClick={() => {
              fetchMetrics(true);
              if (activeTab === 'apps') fetchApps(true);
            }}
            disabled={loading || appsLoading}
            className="p-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-lg transition-colors disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw size={14} className={loading || appsLoading ? 'animate-spin text-[var(--accent-indigo)]' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'history', label: 'History', icon: TrendingUp },
            { id: 'apps', label: 'Applications', icon: Package },
            { id: 'processes', label: 'Processes', icon: ListFilter },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--accent-indigo)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.id === 'processes' && processesData[selectedConnection]?.total > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-900/60 text-indigo-200">
                  {processesData[selectedConnection].total}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'apps' && (
          <div className="flex items-center gap-2">
            {currentAppsTimestamp && (
              <span className="text-[11px] text-[var(--text-muted)]">
                Updated {new Date(currentAppsTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => fetchApps(true)}
              disabled={appsLoading}
              className="flex items-center gap-1 px-2.5 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-md text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              <RotateCw size={12} className={appsLoading ? 'animate-spin text-[var(--accent-indigo)]' : ''} />
              <span>Refresh Apps</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={18} />
            <div className="text-xs">
              <p className="font-semibold text-red-400">Connection Error</p>
              <p className="text-red-300 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!selectedConnection && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Server size={48} className="text-[var(--text-muted)] mb-3 opacity-60" />
            <h3 className="text-base font-semibold mb-1">No Server Selected</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm">
              Select a target server from the dropdown above to view real-time system diagnostics.
            </p>
          </div>
        )}

        {selectedConnection && activeTab === 'overview' && (
          <>
            {!metrics && !error && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <RefreshCw className="animate-spin text-[var(--accent-indigo)] mb-3" size={32} />
                <p className="text-xs text-[var(--text-muted)]">Connecting and streaming system telemetry via Local Relay...</p>
              </div>
            )}

            {metrics && (
              <div className="space-y-4">
                {/* System Info Card */}
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="text-[var(--accent-indigo)]" size={18} />
                    <h2 className="text-sm font-semibold">System Information</h2>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    <InfoItem label="Hostname" value={metrics.system?.hostname || 'N/A'} />
                    <InfoItem label="OS" value={metrics.system?.os || 'N/A'} />
                    <InfoItem label="Kernel" value={metrics.system?.kernel || 'N/A'} />
                    <InfoItem label="Arch" value={metrics.system?.arch || 'N/A'} />
                    <InfoItem 
                      label="Uptime" 
                      value={formatUptime(metrics.system?.uptime)} 
                      icon={<Clock size={12} className="text-[var(--accent-indigo)]" />}
                    />
                    <InfoItem 
                      label="Load Avg" 
                      value={metrics.cpu?.loadAverage?.join(', ') || 'N/A'} 
                    />
                  </div>
                </div>

                {/* Overview: Simple live charts — no advanced controls */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* CPU Card — static live chart */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="text-indigo-400 shrink-0" size={18} />
                        <h3 className="font-semibold text-sm">CPU Usage</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getTrendIcon(metrics.cpu?.usage, cpuHistory[cpuHistory.length - 2]?.value)}
                        <span className={`text-lg font-bold font-mono ${getStatusColor(metrics.cpu?.usage)}`}>
                          {metrics.cpu?.usage?.toFixed(1) ?? '—'}%
                        </span>
                      </div>
                    </div>
                    <div className="h-36">
                      {getCpuChartData()?.labels?.length > 0
                        ? <Line data={getCpuChartData()} options={chartOptions} />
                        : <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">No data yet</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Cores:</span>
                        <span className="ml-1 font-medium">{metrics.cpu?.cores || 'N/A'}</span>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Model:</span>
                        <span className="ml-1 font-medium truncate block" title={metrics.cpu?.model}>
                          {metrics.cpu?.model?.split(' ')[0] || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* RAM Card — static live chart */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="text-emerald-400 shrink-0" size={18} />
                        <h3 className="font-semibold text-sm">Memory Usage</h3>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {getTrendIcon(metrics.memory?.usedPercent, ramHistory[ramHistory.length - 2]?.value)}
                        <span className={`text-lg font-bold font-mono ${getStatusColor(metrics.memory?.usedPercent)}`}>
                          {metrics.memory?.usedPercent?.toFixed(1) ?? '—'}%
                        </span>
                      </div>
                    </div>
                    <div className="h-36">
                      {getRamChartData()?.labels?.length > 0
                        ? <Line data={getRamChartData()} options={chartOptions} />
                        : <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">No data yet</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Used:</span>
                        <span className="ml-1 font-medium">{formatBytes(metrics.memory?.used)}</span>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2">
                        <span className="text-[var(--text-muted)]">Total:</span>
                        <span className="ml-1 font-medium">{formatBytes(metrics.memory?.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Disk and Network */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Disk Card */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <HardDrive className="text-purple-400" size={18} />
                      <h3 className="font-semibold text-sm">Disk Storage</h3>
                    </div>
                    <div className="space-y-2.5">
                      {metrics.disk?.filesystems?.slice(0, 4).map((fs, idx) => (
                        <div key={idx} className="bg-[var(--bg-tertiary)] rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium truncate max-w-[200px]" title={fs.mount}>{fs.mount}</span>
                            <span className={`text-xs font-bold font-mono ${getStatusColor(fs.usedPercent)}`}>{fs.usedPercent?.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-[var(--bg-primary)] rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full transition-all duration-300 ${getStatusBg(fs.usedPercent)}`} style={{ width: `${Math.min(100, fs.usedPercent)}%` }} />
                          </div>
                          <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-muted)]">
                            <span>{formatBytes(fs.used)} used</span>
                            <span>{formatBytes(fs.total)} total</span>
                          </div>
                        </div>
                      ))}
                      {(!metrics.disk?.filesystems || metrics.disk.filesystems.length === 0) && (
                        <div className="text-xs text-[var(--text-muted)] text-center py-4">No disks reported</div>
                      )}
                    </div>
                  </div>

                  {/* Network Card — static live chart */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Wifi className="text-blue-400 shrink-0" size={18} />
                        <h3 className="font-semibold text-sm">Network Activity</h3>
                      </div>
                      <span className="text-lg font-bold font-mono text-blue-300">
                        {formatBytes((metrics.network?.rxRate || 0) + (metrics.network?.txRate || 0))}/s
                      </span>
                    </div>
                    <div className="h-36">
                      {getNetworkChartData()?.labels?.length > 0
                        ? <Line data={getNetworkChartData()} options={{ ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales.y, max: undefined, ticks: { color: 'rgba(255,255,255,0.5)', callback: (v) => formatBytes(v) + '/s' } } } }} />
                        : <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">No data yet</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 flex items-center gap-2">
                        <Download size={14} className="text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-[var(--text-muted)]">Download</div>
                          <div className="font-medium font-mono truncate">{formatBytes(metrics.network?.rxRate)}/s</div>
                        </div>
                      </div>
                      <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 flex items-center gap-2">
                        <Upload size={14} className="text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-[var(--text-muted)]">Upload</div>
                          <div className="font-medium font-mono truncate">{formatBytes(metrics.network?.txRate)}/s</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {selectedConnection && activeTab === 'history' && (
          <div className="space-y-4">
            {/* Timeline Navigator with zoom, scrubber, and range picker */}
            <TimelineNavigator
              historyRange={historyRange}
              setHistoryRange={setHistoryRange}
              historyLoading={historyLoading}
              historyData={historyData}
              liveCount={cpuHistory.length}
              fetchHistory={fetchHistory}
              selectedConnection={selectedConnection}
              zoomLevel={timelineZoom}
              setZoomLevel={setTimelineZoom}
              syncEnabled={syncEnabled}
              setSyncEnabled={setSyncEnabled}
              timelineLabels={activeTimelineLabels}
              scrubberRatio={syncScrollRatio}
              onScrubberChange={(ratio) => {
                setSyncEnabled(true);
                setSyncScrollRatio(ratio);
              }}
              onSnapToLive={() => {
                setSyncEnabled(true);
                setSyncScrollRatio(1);
              }}
              cpuHistory={cpuHistory}
              ramHistory={ramHistory}
              networkHistory={networkHistory}
              diskHistory={diskHistory}
              onJumpToIndividualPeak={() => setJumpToIndividualPeakSignal(s => s + 1)}
              timelineTimestamps={activeTimelineTimestamps}
              onInspectLogs={inspectHistoryLogs}
            />

            {/* Summary stats row — at the top for quick reference */}
            {metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'CPU Cores', value: metrics.cpu?.cores ?? 'N/A', icon: <Cpu size={14} className="text-indigo-400" /> },
                  { label: 'Total RAM', value: formatBytes(metrics.memory?.total), icon: <MemoryStick size={14} className="text-emerald-400" /> },
                  { label: 'Primary Disk', value: metrics.disk?.filesystems?.[0] ? `${formatBytes(metrics.disk.filesystems[0].used)} / ${formatBytes(metrics.disk.filesystems[0].total)}` : 'N/A', icon: <HardDrive size={14} className="text-purple-400" /> },
                  { label: 'Uptime', value: formatUptime(metrics.system?.uptime), icon: <Clock size={14} className="text-blue-400" /> },
                ].map(stat => (
                  <div key={stat.label} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">{stat.icon}</div>
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)] font-medium">{stat.label}</div>
                      <div className="text-sm font-semibold font-mono">{stat.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scrollable chart grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ScrollableChartCard
                title="CPU Usage"
                icon={Cpu}
                currentValue={metrics?.cpu?.usage}
                statusColor={getStatusColor(metrics?.cpu?.usage)}
                trendIcon={getTrendIcon(metrics?.cpu?.usage, cpuHistory[cpuHistory.length - 2]?.value)}
                chartData={getCpuChartData()}
                chartOptions={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    legend: { display: false },
                    tooltip: {
                      mode: 'index',
                      intersect: false,
                      callbacks: { label: (ctx) => ` ${ctx.parsed.y?.toFixed(1) ?? '—'}%` }
                    }
                  }
                }}
                heightClass="h-52"
                zoomLevel={timelineZoom}
                syncScrollRatio={syncScrollRatio}
                syncEnabled={syncEnabled}
                onUserScroll={setSyncScrollRatio}
                isLive={historyRange === 'live'}
                spikeData={{
                  history: historyData?.data ? historyData.data.map(d => d.cpu ?? 0) : cpuHistory,
                  threshold: 80
                }}
                align="left"
                jumpToIndividualPeakSignal={jumpToIndividualPeakSignal}
                emptyMessage={historyRange !== 'live' ? `No historical snapshots in last ${historyRange}` : 'No live data yet'}
              />

              <ScrollableChartCard
                title="Memory Usage"
                icon={MemoryStick}
                currentValue={metrics?.memory?.usedPercent}
                statusColor={getStatusColor(metrics?.memory?.usedPercent)}
                trendIcon={getTrendIcon(metrics?.memory?.usedPercent, ramHistory[ramHistory.length - 2]?.value)}
                chartData={getRamChartData()}
                chartOptions={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    legend: { display: false },
                    tooltip: {
                      mode: 'index',
                      intersect: false,
                      callbacks: { label: (ctx) => ` ${ctx.parsed.y?.toFixed(1) ?? '—'}%` }
                    }
                  }
                }}
                heightClass="h-52"
                zoomLevel={timelineZoom}
                syncScrollRatio={syncScrollRatio}
                syncEnabled={syncEnabled}
                onUserScroll={setSyncScrollRatio}
                isLive={historyRange === 'live'}
                spikeData={{
                  history: historyData?.data ? historyData.data.map(d => d.ram ?? 0) : ramHistory,
                  threshold: 80
                }}
                align="right"
                jumpToIndividualPeakSignal={jumpToIndividualPeakSignal}
                emptyMessage={historyRange !== 'live' ? `No historical snapshots in last ${historyRange}` : 'No live data yet'}
              />

              <ScrollableChartCard
                title="Network I/O"
                icon={Wifi}
                currentValue={null}
                headerExtra={
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="flex items-center gap-1 text-blue-400">
                      <Download size={12} /> {formatBytes(metrics?.network?.rxRate || 0)}/s
                    </span>
                    <span className="flex items-center gap-1 text-amber-400">
                      <Upload size={12} /> {formatBytes(metrics?.network?.txRate || 0)}/s
                    </span>
                  </div>
                }
                chartData={getNetworkChartData()}
                chartOptions={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    legend: { display: true, labels: { color: 'rgba(255,255,255,0.6)', boxWidth: 10, font: { size: 11 } } },
                    tooltip: {
                      mode: 'index',
                      intersect: false,
                      callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatBytes(ctx.parsed.y ?? 0)}/s` }
                    }
                  },
                  scales: {
                    ...chartOptions.scales,
                    y: {
                      ...chartOptions.scales.y,
                      max: undefined,
                      ticks: { color: 'rgba(255,255,255,0.5)', callback: (v) => formatBytes(v) + '/s' }
                    }
                  }
                }}
                heightClass="h-52"
                zoomLevel={timelineZoom}
                syncScrollRatio={syncScrollRatio}
                syncEnabled={syncEnabled}
                onUserScroll={setSyncScrollRatio}
                isLive={historyRange === 'live'}
                spikeData={{
                  history: historyData?.data
                    ? historyData.data.map(d => (d?.rxBytes || 0) + (d?.txBytes || 0))
                    : networkHistory.map(d => (d?.rx || 0) + (d?.tx || 0)),
                  isBytes: true,
                  threshold: 1 * 1024 * 1024
                }}
                align="left"
                jumpToIndividualPeakSignal={jumpToIndividualPeakSignal}
                emptyMessage={historyRange !== 'live' ? `No historical snapshots in last ${historyRange}` : 'No live data yet'}
              />

              <ScrollableChartCard
                title={<>Disk Usage <span className="text-[11px] font-normal text-[var(--text-muted)]">(primary)</span></>}
                icon={HardDrive}
                currentValue={metrics?.disk?.filesystems?.[0]?.usedPercent}
                statusColor={getStatusColor(metrics?.disk?.filesystems?.[0]?.usedPercent)}
                chartData={getDiskChartData()}
                chartOptions={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    legend: { display: false },
                    tooltip: {
                      mode: 'index',
                      intersect: false,
                      callbacks: { label: (ctx) => ` ${ctx.parsed.y?.toFixed(1) ?? '—'}%` }
                    }
                  }
                }}
                heightClass="h-52"
                zoomLevel={timelineZoom}
                syncScrollRatio={syncScrollRatio}
                syncEnabled={syncEnabled}
                onUserScroll={setSyncScrollRatio}
                isLive={historyRange === 'live'}
                spikeData={{
                  history: historyData?.data ? historyData.data.map(d => d.disk ?? 0) : diskHistory.map(d => d?.value ?? 0),
                  threshold: 85
                }}
                align="right"
                jumpToIndividualPeakSignal={jumpToIndividualPeakSignal}
                emptyMessage={historyRange !== 'live' ? `No historical snapshots in last ${historyRange}` : 'No live data yet'}
                emptyState={
                  <div className="flex flex-col items-center justify-center h-full text-xs text-[var(--text-muted)] gap-1">
                    <HardDrive size={24} className="opacity-30" />
                    <span>{historyRange !== 'live' ? `No disk history recorded in last ${historyRange}` : 'No disk history yet — collecting on next snapshot'}</span>
                  </div>
                }
              />
            </div>
          </div>
        )}

        {selectedConnection && activeTab === 'apps' && (
          <div className="space-y-4">
            {appsLoading && !currentApps && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <RefreshCw className="animate-spin text-[var(--accent-indigo)] mb-3" size={32} />
                <p className="text-xs text-[var(--text-muted)]">Detecting installed services and runtimes...</p>
              </div>
            )}

            {currentApps && (
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="text-[var(--accent-indigo)]" size={18} />
                    <h2 className="text-sm font-semibold">Available Applications & Services</h2>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                    {availableApps.length} available
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availableApps.map((app, idx) => (
                    <AppCard 
                      key={app.name || idx} 
                      app={{ ...app, connectionId: selectedConnection }} 
                      onRefresh={() => fetchApps(true)} 
                    />
                  ))}
                  
                  {availableApps.length === 0 && (
                    <div className="col-span-full text-center py-12 text-xs text-[var(--text-muted)] space-y-2">
                      <Package size={32} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
                      <p className="font-semibold text-sm text-[var(--text-primary)]">No monitored applications detected</p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        None of the monitored runtimes or services (Docker, Nginx, Databases, Node, Python, etc.) were found on this server.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: PROCESSES ── */}
        {activeTab === 'processes' && (
          <div className="p-4 space-y-4">
            {(() => {
              const currentProcList = processesData[selectedConnection]?.processes || [];
              const procTimestamp = processesData[selectedConnection]?.timestamp || null;

              // Filter processes by search query
              const query = procSearchQuery.toLowerCase().trim();
              const filtered = currentProcList.filter(p => {
                if (!query) return true;
                return (
                  String(p.pid).includes(query) ||
                  (p.name && p.name.toLowerCase().includes(query)) ||
                  (p.user && p.user.toLowerCase().includes(query)) ||
                  (p.command && p.command.toLowerCase().includes(query))
                );
              });

              // Sort processes
              const sorted = [...filtered].sort((a, b) => {
                let valA = a[procSortField];
                let valB = b[procSortField];
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return procSortDir === 'asc' ? -1 : 1;
                if (valA > valB) return procSortDir === 'asc' ? 1 : -1;
                return 0;
              });

              // Compute top stats
              const topCpu = [...currentProcList].sort((a, b) => (b.cpu || 0) - (a.cpu || 0))[0];
              const topMem = [...currentProcList].sort((a, b) => (b.rssKb || 0) - (a.rssKb || 0))[0];

              return (
                <div className="space-y-4">
                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Total Processes</div>
                        <div className="text-xl font-bold mt-0.5 text-[var(--text-primary)]">
                          {currentProcList.length > 0 ? currentProcList.length : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <ListFilter size={18} />
                      </div>
                    </div>

                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div className="truncate pr-2">
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Top CPU Consumer</div>
                        <div className="text-sm font-bold mt-0.5 text-amber-400 truncate flex items-center gap-1.5">
                          {topCpu ? (
                            <>
                              <span className="truncate">{topCpu.name}</span>
                              <span className="text-[11px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono font-normal">
                                {topCpu.cpu.toFixed(1)}%
                              </span>
                            </>
                          ) : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                        <Cpu size={18} />
                      </div>
                    </div>

                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3.5 flex items-center justify-between">
                      <div className="truncate pr-2">
                        <div className="text-[11px] text-[var(--text-muted)] font-medium">Top Memory Consumer</div>
                        <div className="text-sm font-bold mt-0.5 text-purple-400 truncate flex items-center gap-1.5">
                          {topMem ? (
                            <>
                              <span className="truncate">{topMem.name}</span>
                              <span className="text-[11px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono font-normal">
                                {formatBytes(topMem.rssKb * 1024)}
                              </span>
                            </>
                          ) : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
                        <MemoryStick size={18} />
                      </div>
                    </div>
                  </div>

                  {/* Filter & Controls Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] p-2.5 rounded-xl">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        placeholder="Search processes by name, PID, user, command..."
                        value={procSearchQuery}
                        onChange={(e) => setProcSearchQuery(e.target.value)}
                        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg pl-8 pr-8 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50"
                      />
                      {procSearchQuery && (
                        <button
                          onClick={() => setProcSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg p-0.5 text-xs">
                        <span className="text-[10px] text-[var(--text-muted)] font-medium pl-2 pr-1">Sort:</span>
                        {[
                          { id: 'cpu', label: 'CPU' },
                          { id: 'mem', label: 'RAM' },
                          { id: 'pid', label: 'PID' },
                          { id: 'name', label: 'Name' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              if (procSortField === opt.id) {
                                setProcSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
                              } else {
                                setProcSortField(opt.id);
                                setProcSortDir('desc');
                              }
                            }}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                              procSortField === opt.id
                                ? 'bg-indigo-600/30 text-indigo-300 font-semibold'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {opt.label} {procSortField === opt.id && (procSortDir === 'desc' ? '↓' : '↑')}
                          </button>
                        ))}
                      </div>

                      {procTimestamp && (
                        <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">
                          {new Date(procTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      )}

                      <button
                        onClick={() => fetchProcesses(true)}
                        disabled={processesLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        title="Refresh Process List"
                      >
                        <RefreshCw size={12} className={processesLoading ? 'animate-spin text-indigo-400' : ''} />
                        <span>Refresh</span>
                      </button>
                    </div>
                  </div>

                  {/* Processes Table */}
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse font-sans">
                        <thead className="bg-[var(--bg-tertiary)]/70 text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider sticky top-0 z-10 border-b border-[var(--border-color)] backdrop-blur-md">
                          <tr>
                            <th className="py-2.5 px-3">PID</th>
                            <th className="py-2.5 px-3">User</th>
                            <th className="py-2.5 px-3 text-right">CPU %</th>
                            <th className="py-2.5 px-3 text-right">MEM %</th>
                            <th className="py-2.5 px-3 text-right">RAM (RSS)</th>
                            <th className="py-2.5 px-2 text-center">State</th>
                            <th className="py-2.5 px-3">Time</th>
                            <th className="py-2.5 px-3 min-w-[200px]">Process / Command</th>
                            <th className="py-2.5 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]/50">
                          {sorted.map((proc) => {
                            const isCpuHot = (proc.cpu || 0) >= 50;
                            const isCpuWarm = (proc.cpu || 0) >= 15;
                            const isMemHot = (proc.mem || 0) >= 40;
                            const isMemWarm = (proc.mem || 0) >= 10;

                            return (
                              <tr
                                key={proc.pid}
                                className="hover:bg-[var(--bg-tertiary)]/40 transition-colors group"
                              >
                                <td className="py-2 px-3 font-mono font-bold text-slate-300 text-[11px]">
                                  {proc.pid}
                                </td>

                                <td className="py-2 px-3 text-[11px] text-[var(--text-muted)]">
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-slate-300 font-mono text-[10px]">
                                    {proc.user}
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px]">
                                  <span className={`font-bold ${
                                    isCpuHot ? 'text-red-400' : isCpuWarm ? 'text-amber-400' : 'text-slate-300'
                                  }`}>
                                    {proc.cpu?.toFixed(1) || '0.0'}%
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px]">
                                  <span className={`font-bold ${
                                    isMemHot ? 'text-purple-400' : isMemWarm ? 'text-indigo-300' : 'text-slate-300'
                                  }`}>
                                    {proc.mem?.toFixed(1) || '0.0'}%
                                  </span>
                                </td>

                                <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-300">
                                  {formatBytes((proc.rssKb || 0) * 1024)}
                                </td>

                                <td className="py-2 px-2 text-center">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700/50">
                                    {proc.stat}
                                  </span>
                                </td>

                                <td className="py-2 px-3 font-mono text-[10px] text-[var(--text-muted)]">
                                  {proc.time}
                                </td>

                                <td className="py-2 px-3">
                                  <div className="font-semibold text-[var(--text-primary)] truncate max-w-sm flex items-center gap-1.5" title={proc.command}>
                                    <span className="text-indigo-400 font-mono">{proc.name}</span>
                                    {proc.command !== proc.name && (
                                      <span className="text-[10px] text-[var(--text-muted)] font-mono font-normal truncate opacity-70">
                                        {proc.command}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-2 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setKillModal({
                                      isOpen: true,
                                      process: proc,
                                      signal: 'SIGTERM',
                                      loading: false,
                                      error: null
                                    })}
                                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all flex items-center gap-1 mx-auto cursor-pointer"
                                    title={`Kill Process ${proc.name} (PID: ${proc.pid})`}
                                  >
                                    <Trash2 size={10} />
                                    <span>Kill</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}

                          {sorted.length === 0 && (
                            <tr>
                              <td colSpan={9} className="text-center py-12 text-xs text-[var(--text-muted)]">
                                <ListFilter size={28} className="mx-auto text-[var(--text-muted)] opacity-30 mb-2" />
                                {processesLoading ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <RefreshCw size={14} className="animate-spin text-indigo-400" />
                                    <span>Loading process table...</span>
                                  </div>
                                ) : (
                                  <span>No matching processes found.</span>
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── KILL PROCESS CONFIRMATION MODAL ── */}
      {killModal.isOpen && killModal.process && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[var(--bg-primary)] border border-red-500/30 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)] bg-red-500/10">
              <div className="flex items-center gap-2.5 text-red-400">
                <Skull size={18} />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">Kill Process</h3>
              </div>
              <button
                onClick={() => setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null })}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Process Name:</span>
                  <span className="font-bold text-indigo-400">{killModal.process.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">PID:</span>
                  <span className="font-bold text-slate-200">{killModal.process.pid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">User:</span>
                  <span className="text-slate-300">{killModal.process.user}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">CPU / RAM:</span>
                  <span className="text-slate-300">{killModal.process.cpu}% CPU · {formatBytes(killModal.process.rssKb * 1024)}</span>
                </div>
                <div className="pt-1.5 border-t border-[var(--border-color)]/40 text-[10px] text-[var(--text-muted)] truncate" title={killModal.process.command}>
                  {killModal.process.command}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider block mb-1.5">
                  Termination Signal
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKillModal(prev => ({ ...prev, signal: 'SIGTERM' }))}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      killModal.signal === 'SIGTERM'
                        ? 'bg-amber-500/15 border-amber-400/60 text-amber-300'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-slate-500'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Graceful (SIGTERM - 15)</div>
                    <div className="text-[10px] opacity-75 mt-0.5">Allows process to save state & close</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKillModal(prev => ({ ...prev, signal: 'SIGKILL' }))}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      killModal.signal === 'SIGKILL'
                        ? 'bg-red-500/20 border-red-400/60 text-red-300'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-slate-500'
                    }`}
                  >
                    <div className="font-bold text-[11px] text-red-400">Force Kill (SIGKILL - 9)</div>
                    <div className="text-[10px] opacity-75 mt-0.5">Immediately stops frozen processes</div>
                  </button>
                </div>
              </div>

              {killModal.error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{killModal.error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  disabled={killModal.loading}
                  onClick={() => setKillModal({ isOpen: false, process: null, signal: 'SIGTERM', loading: false, error: null })}
                  className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={killModal.loading}
                  onClick={executeKillProcess}
                  className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-red-600/30 disabled:opacity-50"
                >
                  {killModal.loading ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Terminating...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={12} />
                      <span>Terminate PID {killModal.process.pid}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Relay Agent Setup & Management Wizard */}
      <AgentSetupWizard
        isOpen={showAgentWizard}
        onClose={() => {
          setShowAgentWizard(false);
          // Re-check agent status after wizard closes so the badge updates
          if (selectedConnection) checkAgentStatusForConn(selectedConnection);
        }}
        connection={selectedConn}
        onAgentInstalled={() => {
          // Auto-switch to 500ms Ultra Realtime when agent comes online
          setRefreshInterval(500);
        }}
        onRefreshStatus={() => {
          fetchMetrics(true);
          if (selectedConnection) checkAgentStatusForConn(selectedConnection);
          // Re-request telemetry stream — agent may have just come online
          const socket = socketRef.current;
          if (socket && socket.connected && selectedConnection) {
            const conn_ = connections.find(c => c._id === selectedConnection);
            socket.emit('agent:list');
            socket.emit('telemetry:webrtc:init', {
              connectionId: selectedConnection,
              targetHost: conn_?.host || '',
              targetLabel: conn_?.label || '',
            });
            socket.emit('telemetry:start_stream', {
              interval: refreshInterval,
              connectionId: selectedConnection,
              targetHost: conn_?.host || '',
              targetLabel: conn_?.label || '',
            });
          }
        }}
        apiFetch={apiFetch}
      />
    </div>
  );
}

function InfoItem({ label, value, icon }) {
  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-2.5 border border-[var(--border-color)]/40">
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xs font-semibold truncate" title={String(value)}>{value}</div>
    </div>
  );
}

function AppActionButtons({ app, actionLoading, onAction, canControlService, updateStatus }) {
  const { apiFetch } = useApp();
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  // Version picker state
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const versionsRef = useRef(null);

  const handleAction = async (action, version) => {
    setActiveAction(action);
    await onAction(action, version);
    setActiveAction(null);
    if (action === 'uninstall') setConfirmUninstall(false);
    if (action === 'install-version') setShowVersions(false);
  };

  // Fetch installable versions from the server's package manager
  const loadVersions = async () => {
    setShowVersions(prev => !prev);
    if (showVersions || versions.length > 0) return;
    setLoadingVersions(true);
    try {
      const response = await apiFetch('/api/server-monitor/app-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: app.connectionId, appName: app.name, action: 'list-versions' })
      });
      const data = await response.json();
      setVersions(Array.isArray(data?.versions) ? data.versions : []);
    } catch (_) {
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  };

  // Close the version popover when clicking outside
  useEffect(() => {
    if (!showVersions) return;
    const handleClick = (e) => {
      if (versionsRef.current && !versionsRef.current.contains(e.target)) setShowVersions(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showVersions]);

  const isLoading = (action) => actionLoading && activeAction === action;

  return (
    <div className="mt-2.5 space-y-1.5">
      {/* Service Control Row — only for services that have a status */}
      {canControlService && (
        <div className="flex flex-wrap gap-1">
          {app.status === 'running' ? (
            <>
              <button
                onClick={() => handleAction('stop')}
                disabled={actionLoading}
                className="px-2 py-0.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors disabled:opacity-50"
              >
                {isLoading('stop') ? '...' : 'Stop'}
              </button>
              <button
                onClick={() => handleAction('restart')}
                disabled={actionLoading}
                className="px-2 py-0.5 text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded transition-colors disabled:opacity-50"
              >
                {isLoading('restart') ? '...' : 'Restart'}
              </button>
            </>
          ) : (
            <button
              onClick={() => handleAction('start')}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded transition-colors disabled:opacity-50"
            >
              {isLoading('start') ? '...' : 'Start'}
            </button>
          )}
        </div>
      )}

      {/* Package Management Row — all installed apps */}
      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[var(--border-color)]/30">
        {updateStatus === 'up-to-date' ? (
          <span
            title={`${app.name} is already at the latest version`}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded"
          >
            <CheckCircle2 size={9} />
            Up to date
          </span>
        ) : (
          <button
            onClick={() => handleAction('update')}
            disabled={actionLoading}
            title={`Update ${app.name} to latest version via package manager`}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded transition-colors disabled:opacity-50 ${
              updateStatus === 'available'
                ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30'
                : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20'
            }`}
          >
            {isLoading('update') ? (
              <RefreshCw size={9} className="animate-spin" />
            ) : (
              <Zap size={9} />
            )}
            {isLoading('update') ? 'Updating...' : updateStatus === 'available' ? 'Update Available' : 'Update'}
          </button>
        )}

        {/* Version picker — install/switch to any available package version */}
        <div className="relative" ref={versionsRef}>
          <button
            onClick={loadVersions}
            disabled={actionLoading}
            title={`Browse installable versions of ${app.name}`}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded transition-colors disabled:opacity-50"
          >
            <History size={9} />
            Version
            <ChevronDown size={8} className={`transition-transform ${showVersions ? 'rotate-180' : ''}`} />
          </button>

          {showVersions && (
            <div className="absolute top-full left-0 mt-1 w-52 max-h-44 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl z-[9999] divide-y divide-[var(--border-color)]/60 custom-scrollbar">
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold sticky top-0 bg-[var(--bg-secondary)]">
                Install a specific version
              </div>
              {loadingVersions ? (
                <div className="flex items-center gap-1.5 px-2 py-2 text-[10px] text-indigo-400">
                  <RefreshCw size={10} className="animate-spin" /> Loading versions...
                </div>
              ) : versions.length === 0 ? (
                <div className="px-2 py-2 text-[10px] text-[var(--text-muted)]">
                  No versions listed by this package manager.
                </div>
              ) : (
                versions.map(v => {
                  const isCurrent = app.version && String(app.version).includes(String(v).split('-')[0]);
                  return (
                    <button
                      key={v}
                      onClick={() => handleAction('install-version', v)}
                      disabled={actionLoading}
                      title={`Install ${app.name} ${v}`}
                      className={`w-full px-2 py-1.5 text-left text-[10px] font-mono flex items-center justify-between gap-2 transition-colors disabled:opacity-50 ${
                        isCurrent
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'hover:bg-indigo-500/15 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="truncate">{v}</span>
                      {isCurrent && <CheckCircle2 size={10} className="shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {confirmUninstall ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-red-400 font-medium">Confirm?</span>
            <button
              onClick={() => handleAction('uninstall')}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded transition-colors disabled:opacity-50"
            >
              {isLoading('uninstall') ? 'Removing...' : 'Yes, Remove'}
            </button>
            <button
              onClick={() => setConfirmUninstall(false)}
              disabled={actionLoading}
              className="px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border-color)] rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmUninstall(true)}
            disabled={actionLoading}
            title={`Uninstall ${app.name} from the server via package manager`}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors disabled:opacity-50"
          >
            <AlertTriangle size={9} />
            Uninstall
          </button>
        )}
      </div>
    </div>
  );
}

function AppCard({ app, onRefresh }) {
  const { apiFetch } = useApp();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  // 'unknown' | 'checking' | 'up-to-date' | 'available'
  const [updateStatus, setUpdateStatus] = useState('unknown');

  // Check whether a package update is available so we can hide the Update button
  const checkForUpdates = useCallback(async () => {
    if (!app.installed || !app.connectionId) return;
    try {
      const response = await apiFetch('/api/server-monitor/app-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: app.connectionId, appName: app.name, action: 'check-update' })
      });
      const data = await response.json();
      if (data?.verdict === 'UP_TO_DATE') setUpdateStatus('up-to-date');
      else if (data?.verdict === 'UPDATE_AVAILABLE') setUpdateStatus('available');
      else setUpdateStatus('unknown');
    } catch (_) {
      setUpdateStatus('unknown');
    }
  }, [apiFetch, app.installed, app.connectionId, app.name]);

  useEffect(() => {
    setUpdateStatus(app.installed ? 'checking' : 'unknown');
    if (app.installed) checkForUpdates();
  }, [app.installed, checkForUpdates]);
  
  const iconMap = {
    docker: Box,
    nginx: Server,
    mongodb: Database,
    node: Zap,
    python: Activity,
  };
  
  const Icon = iconMap[app.name?.toLowerCase()] || Package;
  
  const handleAction = async (action, version) => {
    setActionLoading(true);
    setActionResult(null);
    
    try {
      const response = await apiFetch('/api/server-monitor/app-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: app.connectionId,
          appName: app.name,
          action,
          ...(version ? { version } : {})
        })
      });
      
      const data = await response.json();
      setActionResult(data);
      
      // Re-check update availability after a successful update/uninstall/version switch
      if (data.success && ['update', 'uninstall', 'install-version'].includes(action)) {
        setTimeout(checkForUpdates, 2000);
      }

      // In-place refresh after action without full window.location.reload()
      if (data.success && onRefresh) {
        setTimeout(() => onRefresh(), 1500);
      }
    } catch (err) {
      setActionResult({ success: false, error: err.message });
    } finally {
      setActionLoading(false);
    }
  };
  
  // Service control (Start/Stop/Restart) — only for known managed services with a status
  const canControlService = !!(app.installed && app.status && ['docker', 'nginx', 'mongodb', 'mysql', 'postgresql', 'redis'].includes(app.name?.toLowerCase()));
  // Package management (Update/Uninstall) — any installed app
  const canPackageManage = app.installed;
  
  return (
    <div className={`bg-[var(--bg-tertiary)] rounded-lg p-3 border transition-colors ${
      app.installed ? 'border-[var(--border-color)] hover:border-[var(--accent-indigo)]' : 'border-dashed border-[var(--border-color)]/50 opacity-60'
    }`}>
      <div className="flex items-start gap-3">
        <div className="p-2 bg-[var(--bg-primary)] rounded-lg shrink-0">
          <Icon size={18} className="text-[var(--accent-indigo)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <h3 className="font-semibold text-xs capitalize truncate">{app.name}</h3>
            {app.installed ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Installed</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-[var(--text-muted)]">Not Found</span>
            )}
          </div>

          <p className="text-[11px] text-[var(--text-muted)] mb-1 truncate">{app.version || 'Version undetected'}</p>
          
          {app.path && (
            <p className="text-[10px] text-[var(--text-muted)] font-mono truncate" title={app.path}>
              {app.path}
            </p>
          )}

          {app.status && (
            <div className="flex items-center gap-1 mt-1.5">
              {app.status === 'running' ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : (
                <AlertCircle size={12} className="text-amber-400" />
              )}
              <span className={`text-[10px] font-medium capitalize ${app.status === 'running' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {app.status}
              </span>
            </div>
          )}
          
          {/* Action buttons */}
          {(canControlService || canPackageManage) && (
            <AppActionButtons
              app={app}
              actionLoading={actionLoading}
              onAction={handleAction}
              canControlService={canControlService}
              updateStatus={updateStatus}
            />
          )}
          
          {/* Action result message */}
          {actionResult && (
            <div
              className={`mt-1.5 flex items-start gap-1 p-1.5 rounded-md border text-[10px] leading-snug ${
                actionResult.success
                  ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/5 border-red-500/20 text-red-400'
              }`}
            >
              {actionResult.success ? (
                <CheckCircle2 size={11} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
              )}
              <span className="min-w-0 break-words" title={actionResult.output || actionResult.error}>
                {actionResult.success
                  ? `${actionResult.action ? actionResult.action.charAt(0).toUpperCase() + actionResult.action.slice(1) : 'Action'} completed successfully`
                  : (actionResult.error || actionResult.output?.split('\n').find(l => l.trim()) || 'Action failed')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
