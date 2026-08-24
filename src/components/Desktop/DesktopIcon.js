'use client';

import { useOS } from '@/context/OSContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AppIcon from '@/components/common/AppIcon';

// ── Global pollution system (shared across all icon instances) ──
// Every nuke adds a unit of pollution; the haze + falling ash build up and
// slowly clear as the atmosphere "cleans itself". State lives on window so
// every DesktopIcon instance sees the same level.
const POLLUTION_LEVEL_KEY = '__falloutPollutionLevel';
const POLLUTION_DECAY_KEY = '__falloutPollutionDecay';

function getPollutionLevel() {
  return typeof window !== 'undefined' ? (window[POLLUTION_LEVEL_KEY] || 0) : 0;
}

function renderPollution() {
  if (typeof document === 'undefined') return;
  const level = getPollutionLevel();
  document.querySelectorAll('.fallout-smog').forEach((el) => el.remove());
  if (level <= 0) return;

  const smog = document.createElement('div');
  smog.className = 'fallout-smog';
  // Each detonation thickens the haze, capped at a post-apocalyptic ceiling
  smog.style.opacity = Math.min(0.12 * level + 0.06, 0.55);

  // Drifting ash flakes — density scales with pollution
  const flakes = Math.min(8 + Math.round(level * 9), 50);
  for (let i = 0; i < flakes; i++) {
    const flake = document.createElement('div');
    flake.className = 'fallout-ash-flake';
    flake.style.left = `${Math.random() * 100}%`;
    const size = 2 + Math.random() * 3;
    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;
    flake.style.animationDuration = `${7 + Math.random() * 9}s`;
    flake.style.animationDelay = `${-Math.random() * 12}s`;
    flake.style.opacity = `${0.35 + Math.random() * 0.5}`;
    smog.appendChild(flake);
  }
  document.body.appendChild(smog);
}

function addPollution(amount = 1) {
  if (typeof window === 'undefined') return;
  window[POLLUTION_LEVEL_KEY] = Math.min(getPollutionLevel() + amount, 5);
  renderPollution();

  // Atmosphere cleans itself: -1 level every 30s of no detonations,
  // haze fades smoothly via its CSS opacity transition
  clearInterval(window[POLLUTION_DECAY_KEY]);
  window[POLLUTION_DECAY_KEY] = setInterval(() => {
    window[POLLUTION_LEVEL_KEY] = Math.max(0, getPollutionLevel() - 1);
    renderPollution();
    if (getPollutionLevel() <= 0) {
      clearInterval(window[POLLUTION_DECAY_KEY]);
      delete window[POLLUTION_DECAY_KEY];
    }
  }, 30000);
}


export default function DesktopIcon({ id, title, icon: Icon, component, defaultPos, initialWidth, initialHeight, isMobile }) {
  const { state, openWindow, updateIconPosition, setSortBy, setSelectedIcons, toggleIconSelection, updateMultipleIconPositions, pinApp, unpinApp } = useOS();
  const { selectedIconIds, pinnedApps } = state;
  const isPinned = (pinnedApps || []).includes(id);
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const isSelected = selectedIconIds.includes(id);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, snapshot: null });
  const hoverTimeoutRef = useRef(null);
  const iconRef = useRef(null);
  
  const position = state.iconPositions[id] || defaultPos || { x: 0, y: 0 };
  const iconSize = state.iconSize || 'medium';
  // Nuclear hover gimmick: Fallout/Retro get the nuke; Synthwave gets a
  // Thanos-snap dust disintegration ("EJECT"); Cyberpunk gets an ICE-breach
  // system crash. Each has its own palette + flavor.
  const THEME_GIMMICKS = {
    retro: {
      label: '⚠ DETONATION IN', tag: 'ARMED',
      digit: ['#ffc21a', '#ff7a1a', '#ff3020'], panelBorder: 'rgba(255,180,40,0.55)',
      ember: ['#ff4400', '#ff6600', '#ffaa00', '#18e12c', '#ff2200'],
      capCore: ['#ffffff', '#ffcc00', '#ff2200'], lobeInner: 'rgba(255,100,0,0.5)', lobeGlow: 'rgba(255,68,0,0.2)',
      swFrom: 'rgba(255,200,100,0.8)', swTo: 'rgba(255,0,0,0.1)',
      rgBorder: 'rgba(255,200,50,0.4)', rgGlow: 'rgba(255,100,0,0.8)',
      rain: 'rgba(24,225,44,0.6)', rainGlow: '#18e12c', crtFilter: 'none',
    },
    synthwave: {
      label: '▶ TRACKING ERROR', tag: 'EJECT',
      digit: ['#01cdfe', '#b967ff', '#ff2ec4'], panelBorder: 'rgba(255,46,196,0.6)',
      ember: ['#ff2ec4', '#ff71ce', '#01cdfe', '#b967ff', '#ffffff'],
      capCore: ['#ffffff', '#ff71ce', '#a1006e'], lobeInner: 'rgba(255,46,196,0.45)', lobeGlow: 'rgba(1,205,254,0.25)',
      swFrom: 'rgba(255,46,196,0.8)', swTo: 'rgba(1,205,254,0.1)',
      rgBorder: 'rgba(255,46,196,0.45)', rgGlow: 'rgba(1,205,254,0.7)',
      rain: 'rgba(255,46,196,0.6)', rainGlow: '#ff2ec4', crtFilter: 'hue-rotate(260deg)',
    },
    cyberpunk: {
      label: '⌁ BREACH IN', tag: 'HACKING',
      digit: ['#ffe600', '#00fff0', '#ff003c'], panelBorder: 'rgba(0,255,240,0.55)',
      ember: ['#00fff0', '#ff003c', '#ffe600', '#00b3ff', '#ffffff'],
      capCore: ['#eaffff', '#00fff0', '#003cff'], lobeInner: 'rgba(0,255,240,0.4)', lobeGlow: 'rgba(255,0,60,0.22)',
      swFrom: 'rgba(0,255,240,0.75)', swTo: 'rgba(255,0,60,0.12)',
      rgBorder: 'rgba(0,255,240,0.4)', rgGlow: 'rgba(255,0,60,0.6)',
      rain: 'rgba(0,255,240,0.55)', rainGlow: '#00fff0', crtFilter: 'hue-rotate(160deg) saturate(1.4)',
    },
  };
  THEME_GIMMICKS.fallout = THEME_GIMMICKS.retro;
  const gm = THEME_GIMMICKS[state.theme] || null;
  const isFalloutTheme = !!gm;
  // Destruction flavor: nuke (Fallout/Retro), dust snap (Synthwave),
  // ICE-breach crash (Cyberpunk)
  const GIMMICK_TYPE = state.theme === 'synthwave' ? 'synth'
    : state.theme === 'cyberpunk' ? 'cpunk'
      : gm ? 'nuke' : null;

  const handleDoubleClick = () => {
    if (isMobile) {
      const mobileW = Math.round(window.innerWidth * 0.7);
      const mobileH = Math.round(window.innerHeight * 0.6);
      openWindow(id, title, component, Icon, { initialWidth: mobileW, initialHeight: mobileH });
    } else {
      openWindow(id, title, component, Icon, { initialWidth, initialHeight });
    }
  };

  const getSizes = () => {
    switch (iconSize) {
      case 'small': return { container: 'w-20', icon: 36, iconBox: 'w-12 h-12', text: 'text-xs' };
      case 'large': return { container: 'w-32', icon: 52, iconBox: 'w-20 h-20', text: 'text-base' };
      default: return { container: 'w-24', icon: 44, iconBox: 'w-14 h-14', text: 'text-sm' };
    }
  };

  const sizes = getSizes();
  const iconStyle = state.iconStyle || 'glass';

  const getStyle = () => {
    const isLight = state.theme === 'light';
    
    switch (iconStyle) {
      case 'flat':
        return 'bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] border border-[var(--border-color)] shadow-sm';
      case 'neumorphic':
        return 'bg-[var(--bg-primary)] shadow-[var(--neumorphic-shadow-dark),var(--neumorphic-shadow-light)] border-none';
      case 'outline':
        return `bg-transparent border-2 ${isLight ? 'border-[var(--accent-indigo)]/50' : 'border-[var(--accent-indigo)]/30'} hover:bg-[var(--accent-indigo)]/10 transition-colors`;
      case 'minimal':
        return 'bg-transparent border-none shadow-none hover:bg-[var(--text-primary)]/10 transition-colors';
      default: // glass
        return isLight 
          ? 'bg-white/40 backdrop-blur-xl border border-white/60 shadow-xl ring-1 ring-black/5'
          : 'bg-black/25 backdrop-blur-xl border border-white/10 shadow-2xl ring-1 ring-white/5';
    }
  };

  const styleClass = getStyle();

  // --- Custom Drag System ---
  const handlePointerDown = useCallback((e) => {
    console.log('[DesktopIcon] Pointer down on', id);
    // Only left mouse button
    if (e.button !== 0) return;
    e.stopPropagation();
    
    // Handle selection
    if (e.shiftKey || e.metaKey) {
      e.preventDefault();
      toggleIconSelection(id);
      return; // Don't start drag on shift/cmd click
    } else if (!isSelected) {
      setSelectedIcons([id]);
    }

    // Snapshot ALL selected icon positions at drag start
    const idsToMove = isSelected ? [...selectedIconIds] : [id];
    // Make sure current icon is in the list
    if (!idsToMove.includes(id)) idsToMove.push(id);
    
    const snapshot = {};
    idsToMove.forEach(sid => {
      snapshot[sid] = state.iconPositions[sid] || defaultPos || { x: 0, y: 0 };
    });

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      snapshot,
      hasMoved: false,
      cancelled: false,
      targetElement: null,
    };

    setIsDragging(true);

    const handlePointerMove = (moveEvent) => {
      if (dragRef.current.cancelled) return;
      
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        dragRef.current.hasMoved = true;
      }

      // Check what element we're over
      const elementUnder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const folderUnder = elementUnder?.closest('.desktop-folder');
      dragRef.current.targetElement = folderUnder;
      
      // Trigger hover effect on folder
      if (folderUnder && !dragRef.current.lastFolder) {
        folderUnder.classList.add('icon-drag-over');
        dragRef.current.lastFolder = folderUnder;
      } else if (!folderUnder && dragRef.current.lastFolder) {
        dragRef.current.lastFolder.classList.remove('icon-drag-over');
        dragRef.current.lastFolder = null;
      } else if (folderUnder && folderUnder !== dragRef.current.lastFolder) {
        if (dragRef.current.lastFolder) {
          dragRef.current.lastFolder.classList.remove('icon-drag-over');
        }
        folderUnder.classList.add('icon-drag-over');
        dragRef.current.lastFolder = folderUnder;
      }

      const updates = {};
      Object.keys(dragRef.current.snapshot).forEach(sid => {
        const start = dragRef.current.snapshot[sid];
        updates[sid] = {
          x: start.x + dx,
          y: start.y + dy,
        };
      });
      dragRef.current.lastPositions = updates;
      updateMultipleIconPositions(updates);
    };

    const handlePointerUp = (e) => {
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      // Clean up hover class
      if (dragRef.current.lastFolder) {
        dragRef.current.lastFolder.classList.remove('icon-drag-over');
        dragRef.current.lastFolder = null;
      }

      // Check if we dropped on a folder
      // Temporarily hide the icon being dragged so elementFromPoint can see what's underneath
      if (iconRef.current) iconRef.current.style.pointerEvents = 'none';
      
      const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
      const folderUnder = elementUnder?.closest('.desktop-folder');
      
      // Restore pointer events
      if (iconRef.current) iconRef.current.style.pointerEvents = '';
      
      console.log('[DesktopIcon] Drop check:', {
        clientX: e.clientX,
        clientY: e.clientY,
        elementUnder: elementUnder?.className,
        folderUnder: folderUnder?.className,
        groupId: folderUnder?.getAttribute('data-group-id'),
        hasMoved: dragRef.current.hasMoved
      });
      
      if (folderUnder && dragRef.current.hasMoved) {
        // Dropped on folder - trigger folder drop
        const groupId = folderUnder.getAttribute('data-group-id');
        if (groupId) {
          console.log('[DesktopIcon] Dropped on folder:', groupId, 'icon:', id);
          window.dispatchEvent(new CustomEvent('desktop-folder-drop', { detail: { groupId, iconId: id } }));
          // Reset position since we're moving to folder
          const updates = {};
          Object.keys(dragRef.current.snapshot).forEach(sid => {
            updates[sid] = dragRef.current.snapshot[sid];
          });
          updateMultipleIconPositions(updates);
          dragRef.current.snapshot = null;
          dragRef.current.lastPositions = null;
          return;
        }
      }

      // Normal desktop reposition - grid snap
      const GRID_X = 100;
      const GRID_Y = 110;
      const updates = {};
      const currentPositions = dragRef.current.lastPositions || dragRef.current.snapshot;
      Object.keys(dragRef.current.snapshot).forEach(sid => {
        const pos = currentPositions[sid] || dragRef.current.snapshot[sid];
        const snappedX = Math.round(pos.x / GRID_X) * GRID_X;
        const snappedY = Math.round(pos.y / GRID_Y) * GRID_Y;
        updates[sid] = {
          x: Math.max(0, snappedX),
          y: Math.max(0, snappedY),
        };
      });
      updateMultipleIconPositions(updates);

      if (state.sortBy && state.sortBy !== 'none') {
        setSortBy('none');
      }

      dragRef.current.snapshot = null;
      dragRef.current.lastPositions = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [id, isSelected, selectedIconIds, state.iconPositions, defaultPos, isFalloutTheme]);

  const handleDragOver = (e) => {
    if (e.dataTransfer.types.includes('application/ssh-connection') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const connectionData = e.dataTransfer.getData('application/ssh-connection');
    if (connectionData) {
      try {
        const connection = JSON.parse(connectionData);
        // Dispatch custom event that DesktopEnvironment can listen to
        window.dispatchEvent(new CustomEvent('desktop-icon-drop', { 
          detail: { targetAppId: id, connection } 
        }));
      } catch (err) {
        console.error('DesktopIcon drop parse error:', err);
      }
    }
  };

  const [isExploding, setIsExploding] = useState(false);
  const [isDamaged, setIsDamaged] = useState(false); // scorch residue after a close hit
  const [isReforming, setIsReforming] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [countdown, setCountdown] = useState(0); // 4, 3, 2, 1 during arming
  const [isIrradiated, setIsIrradiated] = useState(false);
  const [isCratered, setIsCratered] = useState(false);
  const [impactTransform, setImpactTransform] = useState('');
  const explosionTimerRef = useRef(null);
  const geigerIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    if (!isFalloutTheme) return;

    const handleExplosion = (e) => {
      if (e.detail.sourceId === id || isExploding) return; // Don't push the bomb itself

      const rect = iconRef.current?.getBoundingClientRect();
      if (!rect) return;

      const myX = rect.left + rect.width / 2;
      const myY = rect.top + rect.height / 2;
      
      const dx = myX - e.detail.x;
      const dy = myY - e.detail.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Shockwave radius 900px
      if (distance < 900 && distance > 0) {
        // Realistic wavefront: the shock travels outward at finite speed, so
        // farther icons are hit LATER — a visible ripple across the desktop
        const shockDelay = distance * 0.55; // ms (≈1800px/s)

        // Inverse-square-ish force dropoff
        const force = Math.pow(Math.max(0, (900 - distance) / 900), 1.6);

        // Primary shove: pushed radially away, lifted off the ground and
        // tumbled by the chaotic overpressure — closer icons take it harder
        const pushX = (dx / distance) * force * 130;
        const pushY = (dy / distance) * force * 90 - force * 45; // upward bias: blast lifts things
        const rotate = (Math.random() > 0.5 ? 1 : -1) * force * (35 + Math.random() * 50);
        const squash = 1 - force * 0.12;

        setTimeout(() => {
          // Wavefront arrives — violent displacement
          setImpactTransform(
            `translate(${pushX}px, ${pushY}px) rotate(${rotate}deg) scale(${squash})`
          );

          // Secondary settling: rebound partially toward origin as the
          // overpressure passes, then drift home
          setTimeout(() => {
            setImpactTransform(
              `translate(${pushX * 0.3}px, ${pushY * 0.35}px) rotate(${rotate * 0.35}deg)`
            );
            // Heavy hits leave the icon slightly knocked out of place —
            // it never quite lands back where it stood until the damage heals
            setTimeout(() => {
              if (force > 0.5) {
                setImpactTransform(
                  `translate(${pushX * 0.07}px, ${pushY * 0.09}px) rotate(${rotate * 0.1}deg)`
                );
                setTimeout(() => setImpactTransform(''), 7000);
              } else {
                setImpactTransform('');
              }
            }, 400 + Math.random() * 300);
          }, 450 + Math.random() * 250);

          // Close icons come away scorched — burnt tint slowly heals
          if (force > 0.45) {
            setTimeout(() => setIsDamaged(true), shockDelay + 500);
            setTimeout(() => setIsDamaged(false), shockDelay + 9500);
          }
        }, shockDelay);
      }
    };

    window.addEventListener('fallout-explosion', handleExplosion);
    return () => window.removeEventListener('fallout-explosion', handleExplosion);
  }, [isFalloutTheme, id, isExploding]);

  const initAudio = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtxRef.current = new AudioContext();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playGeigerClick = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      // True Geiger radiation crackle (using filtered noise instead of simple square)
      const noiseSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < noiseSize; i++) output[i] = Math.random() * 2 - 1;

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = buffer;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2000 + Math.random() * 3000;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.3 + Math.random() * 0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);
      
      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noiseSrc.start();
    } catch (e) { }
  }, []);

  const sirenOscRef = useRef(null);
  const sirenGainRef = useRef(null);

  const startSiren = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      if (sirenOscRef.current) return;
      
      // A frantic, rapid-pulsing whoop alarm (highly excited/panic-inducing)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const lfo = ctx.createOscillator(); // Controls the rapid pulsing
      const gain = ctx.createGain();
      
      osc1.type = 'sawtooth';
      osc2.type = 'square';
      lfo.type = 'sawtooth'; // Sawtooth LFO creates a sharp, repeating downward whoop
      
      // Base frequencies rising up in panic
      osc1.frequency.setValueAtTime(700, ctx.currentTime);
      osc1.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 2.5);
      
      osc2.frequency.setValueAtTime(715, ctx.currentTime); // Slightly detuned for aggression
      osc2.frequency.linearRampToValueAtTime(1120, ctx.currentTime + 2.5);
      
      // The LFO Speed: Starts at 2 'whoops' per sec, accelerates to a frantic 16 whoops per sec
      lfo.frequency.setValueAtTime(2, ctx.currentTime);
      lfo.frequency.exponentialRampToValueAtTime(16, ctx.currentTime + 2.5);
      
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(300, ctx.currentTime); // Modulates the pitch downward by 300Hz
      lfoGain.gain.linearRampToValueAtTime(600, ctx.currentTime + 2.5); // Deepens the whoop as it gets faster

      // Wire the LFO to modulate the frequencies of both main oscillators
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);
      lfoGain.connect(osc2.frequency);

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.1);

      // Add a slight distortion/filter to make it sound like a loud speaker
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1500;
      filter.Q.value = 0.8;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.start();
      osc2.start();
      lfo.start();
      
      sirenOscRef.current = { main: osc1, detune: osc2, drone: lfo };
      sirenGainRef.current = gain;
    } catch (e) { }
  }, []);

  const stopSiren = useCallback(() => {
    if (sirenGainRef.current && sirenOscRef.current && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      const gain = sirenGainRef.current;
      const oscs = sirenOscRef.current;
      try {
        const timeToWindDown = 0.4; // Faster wind down since it's an electronic alarm
        
        // Rapid pitch descent for shutdown
        if (oscs.main) {
          oscs.main.frequency.cancelScheduledValues(ctx.currentTime);
          oscs.main.frequency.setValueAtTime(oscs.main.frequency.value, ctx.currentTime);
          oscs.main.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + timeToWindDown);
        }
        if (oscs.detune) {
          oscs.detune.frequency.cancelScheduledValues(ctx.currentTime);
          oscs.detune.frequency.setValueAtTime(oscs.detune.frequency.value, ctx.currentTime);
          oscs.detune.frequency.exponentialRampToValueAtTime(105, ctx.currentTime + timeToWindDown);
        }
        if (oscs.drone) {
          oscs.drone.frequency.cancelScheduledValues(ctx.currentTime);
          // Slow down the pulsing as it turns off
          oscs.drone.frequency.setValueAtTime(oscs.drone.frequency.value, ctx.currentTime);
          oscs.drone.frequency.exponentialRampToValueAtTime(0.5, ctx.currentTime + timeToWindDown);
        }
        
        // Fast fade out
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + timeToWindDown);
        
        setTimeout(() => {
          try { 
            if (oscs.main) oscs.main.stop(); 
            if (oscs.detune) oscs.detune.stop(); 
            if (oscs.drone) oscs.drone.stop(); 
          } catch(e){}
        }, timeToWindDown * 1000 + 100);
      } catch (e) {}
      sirenOscRef.current = null;
      sirenGainRef.current = null;
    }
  }, []);

  // ── Synthwave: tape-eject zap + power-down sweep + hiss tail ──
  const playSynthEject = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      // Rising zap — the moment of the snap
      const zap = ctx.createOscillator();
      zap.type = 'sawtooth';
      zap.frequency.setValueAtTime(180, t);
      zap.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
      const zapFilter = ctx.createBiquadFilter();
      zapFilter.type = 'lowpass';
      zapFilter.frequency.value = 3200;
      const zapGain = ctx.createGain();
      zapGain.gain.setValueAtTime(0.32, t);
      zapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      zap.connect(zapFilter); zapFilter.connect(zapGain); zapGain.connect(ctx.destination);
      zap.start(t); zap.stop(t + 0.3);

      // Long power-down sweep as the icon dissolves into dust
      const sweep = ctx.createOscillator();
      sweep.type = 'triangle';
      sweep.frequency.setValueAtTime(900, t + 0.15);
      sweep.frequency.exponentialRampToValueAtTime(55, t + 2.2);
      const sweepGain = ctx.createGain();
      sweepGain.gain.setValueAtTime(0.0001, t + 0.15);
      sweepGain.gain.linearRampToValueAtTime(0.2, t + 0.45);
      sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
      sweep.connect(sweepGain); sweepGain.connect(ctx.destination);
      sweep.start(t + 0.15); sweep.stop(t + 2.4);

      // Tape hiss tail drifting away with the dust
      const hissSize = Math.floor(ctx.sampleRate * 1.8);
      const hissBuf = ctx.createBuffer(1, hissSize, ctx.sampleRate);
      const hd = hissBuf.getChannelData(0);
      for (let i = 0; i < hissSize; i++) hd[i] = (Math.random() * 2 - 1) * 0.4;
      const hiss = ctx.createBufferSource();
      hiss.buffer = hissBuf;
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = 'highpass';
      hissFilter.frequency.value = 4500;
      const hissGain = ctx.createGain();
      hissGain.gain.setValueAtTime(0.1, t + 0.2);
      hissGain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
      hiss.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(ctx.destination);
      hiss.start(t + 0.2); hiss.stop(t + 2.1);
    } catch (e) {}
  }, []);

  // ── Cyberpunk: terminal beep per breach countdown tick ──
  const playCpunkBeep = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1150;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.setValueAtTime(0.14, t + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.1);
    } catch (e) {}
  }, []);

  // ── Cyberpunk: glitch crash — bit-crushed burst + falling data arpeggio ──
  const playCpunkCrash = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;

      // Harsh digital noise burst
      const burstSize = Math.floor(ctx.sampleRate * 0.5);
      const burstBuf = ctx.createBuffer(1, burstSize, ctx.sampleRate);
      const bd = burstBuf.getChannelData(0);
      for (let i = 0; i < burstSize; i++) bd[i] = Math.random() < 0.5 ? -1 : 1; // harsh square-ish noise
      const burst = ctx.createBufferSource();
      burst.buffer = burstBuf;
      const burstGain = ctx.createGain();
      burstGain.gain.setValueAtTime(0.28, t);
      burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      burst.connect(burstGain); burstGain.connect(ctx.destination);
      burst.start(t);

      // Falling data arpeggio — memory dumping out
      const arp = ctx.createOscillator();
      arp.type = 'square';
      arp.frequency.setValueAtTime(2200, t + 0.05);
      arp.frequency.exponentialRampToValueAtTime(110, t + 0.9);
      const arpGain = ctx.createGain();
      arpGain.gain.setValueAtTime(0.16, t + 0.05);
      arpGain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      arp.connect(arpGain); arpGain.connect(ctx.destination);
      arp.start(t + 0.05); arp.stop(t + 1.05);

      // Low sub thud for weight
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(160, t);
      sub.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.5, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      sub.connect(subGain); subGain.connect(ctx.destination);
      sub.start(t); sub.stop(t + 0.65);
    } catch (e) {}
  }, []);

  const createDistortionCurve = (amount = 50) => {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  };

  const playExplosionSound = useCallback(() => {
    const ctx = initAudio();
    if (!ctx) return;
    try {
      // Create violent distortion node for terrifying clipping
      const distortion = ctx.createWaveShaper();
      distortion.curve = createDistortionCurve(1000); 
      distortion.oversample = '4x';

      // 1. Initial Blast Crack (High-passed White Noise impact)
      const crackSize = ctx.sampleRate * 0.8; 
      const crackBuf = ctx.createBuffer(1, crackSize, ctx.sampleRate);
      const crackData = crackBuf.getChannelData(0);
      for (let i = 0; i < crackSize; i++) crackData[i] = Math.random() * 2 - 1;
      
      const crackSrc = ctx.createBufferSource();
      crackSrc.buffer = crackBuf;
      
      const crackFilter = ctx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.value = 400; // Removes bass, leaves just the harsh physical "snap"
      
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(4.0, ctx.currentTime); // Extreme overload
      crackGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);

      // 2. The Deep Rumble (Rolling Brown Noise)
      const rumbleSize = ctx.sampleRate * 4; 
      const rumbleBuf = ctx.createBuffer(1, rumbleSize, ctx.sampleRate);
      const rumbleData = rumbleBuf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < rumbleSize; i++) {
        let white = Math.random() * 2 - 1;
        rumbleData[i] = (lastOut + (0.02 * white)) / 1.02; // Filter to brown noise
        lastOut = rumbleData[i];
      }
      
      const rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = rumbleBuf;

      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.setValueAtTime(1000, ctx.currentTime);
      rumbleFilter.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 6.0);

      const rumbleGain = ctx.createGain();
      rumbleGain.gain.setValueAtTime(3.0, ctx.currentTime);
      rumbleGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 1.0); // Wait for crack to fade
      rumbleGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 7.0);

      // 3. Cinematic Sub-Bass Punch
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(200, ctx.currentTime); // High chest thump
      sub.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 1.2); // Drops to sub-audible physical rumble

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(5.0, ctx.currentTime);
      subGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

      // 4. Ghostly Tinnitus Ringing (Stays in ears after blast)
      const ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(4200, ctx.currentTime);
      ring.frequency.linearRampToValueAtTime(3800, ctx.currentTime + 8.0);
      
      const ringGain = ctx.createGain();
      ringGain.gain.setValueAtTime(0, ctx.currentTime);
      ringGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.4); // Rises from the dust
      ringGain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 8.0); // Fades very slowly

      // Master output controls
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;

      // Routing
      crackSrc.connect(crackFilter).connect(distortion).connect(crackGain).connect(masterGain);
      rumbleSrc.connect(rumbleFilter).connect(distortion).connect(rumbleGain).connect(masterGain);
      sub.connect(distortion).connect(subGain).connect(masterGain);
      ring.connect(ringGain).connect(masterGain); // Tinnitus does NOT pass through distortion
      
      masterGain.connect(ctx.destination);

      crackSrc.start();
      rumbleSrc.start();
      sub.start();
      ring.start();
      
      setTimeout(() => {
        try { crackSrc.stop(); rumbleSrc.stop(); sub.stop(); ring.stop(); } catch(e){}
      }, 10000);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const triggerScreenShake = useCallback(() => {
    document.body.classList.add('fallout-screen-shake');
    setTimeout(() => document.body.classList.remove('fallout-screen-shake'), 1200);
  }, []);

  const triggerFullScreenFlash = useCallback(() => {
    const flash = document.createElement('div');
    flash.className = 'fallout-fullscreen-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1500);
  }, []);

  const hoverDelayTimerRef = useRef(null);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Place menu near cursor but keep it on-screen
    const menuW = 200, menuH = 120;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setContextMenu({ x, y });
  }, []);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const handleMouseEnter = useCallback(() => {
    if (!isFalloutTheme || isExploding || isReforming) return;
    
    // Don't trigger the apocalyptic audio instantly. Give the user a 1-second grace period 
    // so they can double-click or swipe past icons without annoyance.
    hoverDelayTimerRef.current = setTimeout(() => {
      // Shared blast sequence — each flavor reaches it its own way.
      // Synthwave never counts down; the snap simply happens.
      const doBlast = () => {
        setIsArmed(false); // Explosion takes over
        setCountdown(0);

        // Clear geiger counter
        if (geigerIntervalRef.current) {
          clearTimeout(geigerIntervalRef.current);
          geigerIntervalRef.current = null;
        }
        
        // Stop siren and transition into the blast
        stopSiren();
        
        setIsExploding(true);

        // Themed audio: tape-eject zap for Synthwave, glitch crash for Cyberpunk
        if (GIMMICK_TYPE === 'synth') playSynthEject();
        if (GIMMICK_TYPE === 'cpunk') playCpunkCrash();

        if (GIMMICK_TYPE === 'nuke') {
          // Physical-world aftermath is nuke-only: shake, flash, boom,
          // neighbor displacement, crater, CRT static and fallout rain.
          triggerScreenShake();
          triggerFullScreenFlash();
          playExplosionSound();

          const rect = iconRef.current?.getBoundingClientRect();
          if (rect) {
            const impactPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, sourceId: id };
            window.dispatchEvent(
              new CustomEvent('fallout-explosion', {
                detail: impactPoint
              })
            );
            window.dispatchEvent(
              new CustomEvent('fallout-strike-request', {
                detail: impactPoint
              })
            );
          }
          // Leave a scorched crater at ground zero
          setIsCratered(true);
          setTimeout(() => setIsCratered(false), 14000);

          // Every detonation pollutes the whole desktop a little more
          addPollution(1);
        }

        // Let the icon start reconstructing from the ashes / corrupted sectors.
        // Synth + cpunk scenes are shorter than the mushroom cloud.
        const reformDelay = GIMMICK_TYPE === 'nuke' ? 6000 : 4000;
        const sceneLifetime = GIMMICK_TYPE === 'nuke' ? 11000 : 7000;
        setTimeout(() => setIsReforming(true), reformDelay);
        setTimeout(() => {
          setIsReforming(false);
          // Icon is now irradiated — glows green and pulses
          setIsIrradiated(true);
          setTimeout(() => setIsIrradiated(false), 5000);
        }, reformDelay + 2000);

        setTimeout(() => {
          setIsExploding(false);
        }, sceneLifetime);
      };

      // Synthwave EJECT: no countdown panel — instead the icon charges up with
      // chromatic ghosting for a moment, then the snap just happens
      if (GIMMICK_TYPE === 'synth') {
        setIsArmed(true); // arm visuals: pink/cyan glow builds while hovering
        explosionTimerRef.current = setTimeout(doBlast, 1100);
        return;
      }

      setIsArmed(true); // Icon starts physically tearing apart
      setCountdown(3);

      // Cyberdeck beep when the breach sequence arms
      if (GIMMICK_TYPE === 'cpunk') playCpunkBeep();

      // Siren + geiger clicks are Fallout-flavor only — a cyberdeck doesn't
      // wail like an air-raid horn
      if (GIMMICK_TYPE === 'nuke') {
        startSiren();

        const clickLoop = () => {
          playGeigerClick();
          const nextClick = 50 + Math.random() * 150; // Getting faster as it approaches
          geigerIntervalRef.current = setTimeout(clickLoop, nextClick);
        };
        geigerIntervalRef.current = setTimeout(clickLoop, 100);
      }

      // Countdown ticks: 3 → 2 → 1 → BOOM / BREACH
      let currentCount = 3;
      const countdownInterval = setInterval(() => {
        currentCount--;
        if (currentCount > 0) {
          setCountdown(currentCount);
          // Terminal beep per breach tick
          if (GIMMICK_TYPE === 'cpunk') playCpunkBeep();
        } else {
          clearInterval(countdownInterval);
          setCountdown(0);
        }
      }, 1000);

      explosionTimerRef.current = setTimeout(doBlast, 2500);
    }, 1000); // 1000ms grace period
  }, [GIMMICK_TYPE, isFalloutTheme, isExploding, isReforming, playGeigerClick, playExplosionSound, playSynthEject, playCpunkBeep, playCpunkCrash, startSiren, stopSiren, id]);

  const handleMouseLeave = useCallback(() => {
    setIsArmed(false);
    setCountdown(0);
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
      hoverDelayTimerRef.current = null;
    }
    if (explosionTimerRef.current) {
      clearTimeout(explosionTimerRef.current);
      explosionTimerRef.current = null;
    }
    if (geigerIntervalRef.current) {
      clearTimeout(geigerIntervalRef.current);
      geigerIntervalRef.current = null;
    }
    stopSiren();
  }, [stopSiren]);

  useEffect(() => {
    return () => {
      if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
      if (explosionTimerRef.current) clearTimeout(explosionTimerRef.current);
      if (geigerIntervalRef.current) clearTimeout(geigerIntervalRef.current);
      stopSiren();
    };
  }, [stopSiren]);

  // Generate explosion particles & effects
  const renderExplosion = () => {
    if (!isExploding) return null;

    // Main debris particles — 40 chunks flying outward (Optimized from 120)
    const debris = [];
    for (let i = 0; i < 40; i++) {
      const angle = (360 / 40) * i + (Math.random() * 20 - 10);
      const distance = 80 + Math.random() * 150; 
      const size = 1 + Math.random() * 5;
      const delay = Math.random() * 0.1;
      const duration = 0.4 + Math.random() * 0.6;
      const colors = ['#ff4400', '#ff6600', '#ffaa00', '#18e12c', '#ff2200'];
      const color = colors[i % colors.length];
      debris.push(
        <div
          key={`d-${i}`}
          className="absolute pointer-events-none"
          style={{
            width: size,
            height: size * (0.5 + Math.random()),
            backgroundColor: color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            left: '50%',
            top: '50%',
            boxShadow: `0 0 ${size * 3}px ${color}`,
            animation: `fallout-particle-fly ${duration}s ${delay}s ease-out forwards`,
            '--fly-x': `${Math.cos((angle * Math.PI) / 180) * distance}px`,
            '--fly-y': `${Math.sin((angle * Math.PI) / 180) * distance}px`,
          }}
        />
      );
    }

    // Ember sparks — 15 smaller, slower (Optimized from 50)
    const embers = [];
    for (let i = 0; i < 15; i++) {
      const x = -60 + Math.random() * 120;
      const delay = 0.1 + Math.random() * 0.4;
      embers.push(
        <div
          key={`e-${i}`}
          className="absolute pointer-events-none rounded-full"
          style={{
            width: 2,
            height: 2,
            backgroundColor: i % 2 === 0 ? '#ffaa00' : '#ff6600',
            left: `calc(50% + ${x}px)`,
            top: '50%',
            boxShadow: `0 0 4px ${i % 2 === 0 ? '#ffaa00' : '#ff6600'}`,
            animation: `fallout-ember-rise 1.5s ${delay}s ease-out forwards`,
          }}
        />
      );
    }

    // ── SYNTHWAVE: Thanos-snap dust disintegration ──
    if (GIMMICK_TYPE === 'synth') {
      const dustColors = ['#ff71ce', '#01cdfe', '#b967ff', '#ffffff'];
      return (
        <div className="absolute pointer-events-none z-50" style={{ left: '-60px', top: '-60px', right: '-60px', bottom: '-60px' }}>
          {/* Dust motes — the icon crumbling away on the wind */}
          {Array.from({ length: 42 }, (_, i) => {
            const size = 2 + Math.random() * 3;
            const c = dustColors[i % dustColors.length];
            const driftX = (Math.random() - 0.35) * 90; // biased upward-right
            const driftY = -(40 + Math.random() * 110);
            return (
              <div
                key={`dust-${i}`}
                className="absolute pointer-events-none rounded-full"
                style={{
                  left: `${15 + Math.random() * 70}%`,
                  top: `${20 + Math.random() * 60}%`,
                  width: size, height: size,
                  backgroundColor: c,
                  boxShadow: `0 0 ${3 + size}px ${c}`,
                  '--dx': `${driftX}px`,
                  '--dy': `${driftY}px`,
                  '--d-op': `${0.5 + Math.random() * 0.5}`,
                  animation: `synth-dust-drift ${1.6 + Math.random() * 1.8}s ${Math.random() * 1.4}s ease-out forwards`,
                }}
              />
            );
          })}

          {/* Soft magenta afterglow where the icon used to be */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%', width: 120, height: 120,
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle, rgba(255,113,206,0.25) 0%, rgba(185,103,255,0.1) 50%, transparent 75%)',
              animation: 'fallout-nuke-flash 2s ease-out forwards',
            }}
          />

          {embers}
        </div>
      );
    }

    // ── CYBERPUNK: ICE breach system crash ──
    if (GIMMICK_TYPE === 'cpunk') {
      const glyphChars = '01<>[]{}#$%&*@!?ABCDEF';
      return (
        <div className="absolute pointer-events-none z-50" style={{ left: '-60px', top: '-60px', right: '-60px', bottom: '-60px' }}>
          {/* Falling data glyphs — the icon's memory dumping out */}
          {Array.from({ length: 14 }, (_, i) => (
            <pre
              key={`g-${i}`}
              className="absolute pointer-events-none font-mono"
              style={{
                left: `${8 + Math.random() * 84}%`,
                top: `${20 + Math.random() * 40}%`,
                fontSize: 11,
                lineHeight: '11px',
                color: i % 3 === 0 ? '#ff003c' : '#00fff0',
                textShadow: `0 0 6px ${i % 3 === 0 ? '#ff003c' : '#00fff0'}`,
                margin: 0,
                animation: `cpunk-glyph-fall ${1 + Math.random() * 0.9}s ${Math.random() * 0.4}s ease-in forwards`,
              }}
            >
              {Array.from({ length: 6 }, () => glyphChars[Math.floor(Math.random() * glyphChars.length)]).join('\n')}
            </pre>
          ))}

          {/* Pixel shards scattering downward */}
          {Array.from({ length: 18 }, (_, i) => {
            const size = 3 + Math.random() * 4;
            const pxColors = ['#00fff0', '#ff003c', '#ffe600'];
            const c = pxColors[i % pxColors.length];
            const angle = Math.random() * Math.PI * 2;
            return (
              <div
                key={`p-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: '50%', top: '50%',
                  width: size, height: size,
                  backgroundColor: c,
                  boxShadow: `0 0 5px ${c}`,
                  animation: `cpunk-pixel-drop ${0.9 + Math.random() * 0.8}s ${Math.random() * 0.3}s ease-in forwards`,
                  '--fly-x': `${Math.cos(angle) * 70}px`,
                }}
              />
            );
          })}

          {/* ACCESS DENIED stamp */}
          <div
            className="absolute pointer-events-none flex items-center justify-center"
            style={{
              left: '50%', top: '50%',
              padding: '4px 10px',
              border: '3px solid #ff003c',
              borderRadius: 4,
              color: '#ff003c',
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '2px',
              background: 'rgba(255,0,60,0.08)',
              textShadow: '0 0 10px rgba(255,0,60,0.7)',
              whiteSpace: 'nowrap',
              animation: 'cpunk-denied 1.6s steps(4) 0.2s forwards',
            }}
          >
            ACCESS DENIED
          </div>

          {/* EMP rings (theme-tinted) */}
          {[
            { delay: '0s', duration: '1s' },
            { delay: '0.2s', duration: '1.5s' },
          ].map((ring, i) => (
            <div
              key={`ering-${i}`}
              className="absolute pointer-events-none rounded-full"
              style={{
                left: '50%', top: '50%',
                transform: 'translate(-50%, -50%)',
                '--sw-from': gm.swFrom,
                '--sw-to': gm.swTo,
                animation: `fallout-shockwave ${ring.duration} ${ring.delay} cubic-bezier(0, 0, 0.2, 1) forwards`,
              }}
            />
          ))}

          {/* EMP glow ring */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              borderRadius: '50%',
              border: `solid ${gm.rgBorder}`,
              boxShadow: `0 0 60px ${gm.rgGlow}, inset 0 0 60px ${gm.rgGlow}`,
              '--rg-border': gm.rgBorder,
              '--rg-glow': gm.rgGlow,
              '--sw-to': gm.swTo,
              animation: 'fallout-radiation-glow 2.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
              zIndex: 9999,
            }}
          />
        </div>
      );
    }

    // ── FALLOUT / RETRO: nuclear strike ──
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: '-60px', top: '-60px', right: '-60px', bottom: '-60px' }}>
        {/* Central nuclear flash */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            width: 10, height: 10,
            transform: 'translate(-50%, -50%)',
            animation: 'fallout-nuke-flash 0.6s ease-out forwards',
          }}
        />

        {/* Refractive Shockwave Rings (Improved Realism) */}
        {[
          { delay: '0s', duration: '1s' },
          { delay: '0.15s', duration: '1.4s' },
          { delay: '0.3s', duration: '1.8s' },
        ].map((ring, i) => (
          <div
            key={`ring-${i}`}
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              animation: `fallout-shockwave ${ring.duration} ${ring.delay} cubic-bezier(0, 0, 0.2, 1) forwards`,
            }}
          />
        ))}

        {/* Debris particles */}
        {debris}

        {/* Embers drifting up */}
        {embers}

        {/* Ground Dust Shockwave (Realistic Debris Cloud) */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            animation: 'fallout-dust-ring 3s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
          }}
        />

        {/* Advanced SVG Displacement Filter for Hyper-Realistic Volumetric Smoke */}
        <svg width="0" height="0" className="absolute pointer-events-none">
          <defs>
            <filter id={`mushroom-smoke-filter-${id}`} x="-150%" y="-150%" width="400%" height="400%">
              {/* Fractal noise for organic billows — 2 octaves keeps GPU/CPU
                  cost sane; the lumpy border-radius shapes do most of the work */}
              <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" seed="7" result="noise" />
              {/* Volumetric displacement */}
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="30" xChannelSelector="R" yChannelSelector="G" result="displaced" />
              {/* Soften edges for smoke plume realism */}
              <feGaussianBlur in="displaced" stdDeviation="3" result="blur" />
              <feComponentTransfer in="blur">
                <feFuncA type="linear" slope="1.6" />
              </feComponentTransfer>
            </filter>
          </defs>
        </svg>

        {/* ONE GIGANTIC VOLUMETRIC MUSHROOM CLOUD */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            filter: `url(#mushroom-smoke-filter-${id})`,
            transform: 'translateZ(0)', // Force GPU acceleration
          }}
        >
          {/* Base Dust Collar (Rolling cloud of dust at the foot of the stem) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              background: 'radial-gradient(ellipse, rgba(80, 60, 50, 0.75) 0%, rgba(40, 30, 25, 0.4) 60%, transparent 80%)',
              boxShadow: '0 0 35px rgba(80, 60, 50, 0.5), inset 0 0 20px rgba(0, 0, 0, 0.6)',
              animation: 'fallout-nuke-dust-collar 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Outer Dark Smoke Column (Stem Plume) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 70,
              height: 185,
              background: 'linear-gradient(to top, rgba(30, 20, 20, 0.95), rgba(50, 40, 40, 0.75) 50%, rgba(200, 80, 20, 0.2))',
              borderRadius: '30px',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Inner Fiery Pillar (Incandescent core of the stem) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 25,
              height: 165,
              background: 'linear-gradient(to top, #ffffff, #ffcc00 20%, #ff4400 60%, transparent)',
              boxShadow: '0 0 30px #ff3300, 0 0 10px #ffaa00',
              borderRadius: '15px',
              animation: 'fallout-fiery-core 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
              opacity: 0.9,
            }}
          />

          {/* Volumetric Billowing Cap - Core Explosion (Inner Fireball) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 140, height: 100,
              background: 'radial-gradient(circle, #ffffff 0%, #ffcc00 30%, #ff2200 65%, rgba(25, 5, 0, 0.95) 85%, transparent 100%)',
              boxShadow: 'inset 0 10px 45px rgba(255, 255, 255, 0.8), 0 0 80px rgba(255, 68, 0, 0.8)',
              animation: 'fallout-giant-mushroom-cap-core 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Volumetric Billowing Cap - Left Lobe (Dark turbulent soot) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 150, height: 110,
              background: 'radial-gradient(circle at 40% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -15px 40px rgba(255, 68, 0, 0.2), inset 10px 10px 30px rgba(0,0,0,0.8)',
              animation: 'fallout-giant-mushroom-cap-left 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Volumetric Billowing Cap - Right Lobe (Dark turbulent soot) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 150, height: 110,
              background: 'radial-gradient(circle at 60% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -15px 40px rgba(255, 68, 0, 0.2), inset -10px 10px 30px rgba(0,0,0,0.8)',
              animation: 'fallout-giant-mushroom-cap-right 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Vapor Condensation Ring (Expanding moisture ring) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              border: '3px solid rgba(255, 255, 255, 0.45)',
              boxShadow: '0 0 15px rgba(255, 255, 255, 0.3), inset 0 0 15px rgba(255, 255, 255, 0.3)',
              animation: 'fallout-nuke-condensation-ring 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Cauliflower billow puffs — secondary lobes rolling off the cap rim */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 90, height: 70,
              background: 'radial-gradient(circle at 45% 45%, rgba(255, 120, 30, 0.4) 0%, rgba(60, 45, 40, 0.9) 55%, rgba(22, 16, 16, 0.95) 82%, transparent 100%)',
              animation: 'fallout-mushroom-puff-a 10s cubic-bezier(0.1, 0.8, 0.2, 1) 0.35s forwards',
            }}
          />
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 80, height: 62,
              background: 'radial-gradient(circle at 55% 45%, rgba(255, 110, 25, 0.38) 0%, rgba(58, 44, 40, 0.9) 55%, rgba(20, 15, 15, 0.95) 82%, transparent 100%)',
              animation: 'fallout-mushroom-puff-b 10s cubic-bezier(0.1, 0.8, 0.2, 1) 0.55s forwards',
            }}
          />
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 74, height: 58,
              background: 'radial-gradient(circle at 50% 40%, rgba(255, 130, 35, 0.35) 0%, rgba(62, 47, 42, 0.88) 55%, rgba(24, 18, 18, 0.94) 82%, transparent 100%)',
              animation: 'fallout-mushroom-puff-c 10s cubic-bezier(0.1, 0.8, 0.2, 1) 0.8s forwards',
            }}
          />
        </div>

        {/* Massive EMP / Radiation Shockwave */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%', // Explicit 50% fixed a backdrop-filter rendering glitch in some browsers
            border: 'solid rgba(255, 200, 50, 0.4)',
            boxShadow: '0 0 60px rgba(255, 100, 0, 0.8), inset 0 0 60px rgba(255, 100, 0, 0.8)',
            animation: 'fallout-radiation-glow 2.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
            zIndex: 9999, // Blast wave literally renders over the top of the entire screen
          }}
        />
      </div>
    );
  };

  return (
    <div
      ref={iconRef}
      className={`desktop-icon ${isMobile ? 'relative mx-auto' : 'absolute'} flex flex-col items-center justify-start p-2 rounded-xl 
        cursor-grab active:cursor-grabbing hover:bg-[var(--text-primary)]/10 dark:hover:bg-white/10 active:bg-[var(--text-primary)]/15 
        ${sizes.container} gap-2 z-10 group 
        ${isSelected ? 'bg-[var(--accent-indigo)]/15 border border-[var(--accent-indigo)]/40 shadow-[0_8px_24px_rgba(0,0,0,0.15)] ring-1 ring-[var(--accent-indigo)]/20' : 'border border-transparent'}
        ${isDragging ? 'z-50 opacity-90' : ''}
        ${isExploding ? 'z-50' : ''}
      `}
      data-icon-id={id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={isMobile ? () => handleDoubleClick() : handlePointerDown}
      onClick={isMobile ? () => handleDoubleClick() : undefined}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      tabIndex={0}
      style={{ 
        left: isMobile ? 'auto' : position.x, 
        top: isMobile ? 'auto' : position.y,
        transform: impactTransform || 'none',
        transition: isDragging ? 'none' : 
                    impactTransform ? 'transform 0.05s cubic-bezier(0, 0.9, 0.1, 1)' : 
                    'left 0.15s ease, top 0.15s ease',
        touchAction: isMobile ? 'auto' : 'none',
      }}
    >
      {/* Ghost Shadow (Grid Snap Preview) */}
      {isDragging && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${
              (Math.round(position.x / 100) * 100) - position.x
            }px, ${
              (Math.round(position.y / 110) * 110) - position.y
            }px)`,
            transition: 'transform 0.1s ease',
          }}
        >
          <div className={`${sizes.iconBox} bg-[var(--bg-tertiary)]/10 border border-dashed border-[var(--border-color)] rounded-xl opacity-50 ml-2 mt-2`} />
        </div>
      )}

      {/* Explosion particles & effects */}
      {renderExplosion()}

      {/* Scorched Crater at ground zero */}
      {isCratered && (
        <div 
          className="absolute pointer-events-none rounded-full z-0"
          style={{
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 90, height: 40,
            background: 'radial-gradient(ellipse, rgba(20,10,0,0.8) 0%, rgba(40,20,0,0.5) 40%, rgba(60,30,0,0.2) 70%, transparent 100%)',
            boxShadow: 'inset 0 2px 15px rgba(255,60,0,0.3), 0 0 30px rgba(0,0,0,0.4)',
            animation: 'fallout-crater-fade 14s linear forwards',
          }}
        />
      )}

      <div 
        className={`flex items-center justify-center transition-transform duration-300 pointer-events-none group-hover:shadow-indigo-500/20 ${isDragging ? 'scale-110 shadow-2xl' : (!isArmed && !isExploding && !isReforming ? 'group-hover:scale-110' : '')}`}
        style={{
          ...(isExploding ? {
            animation: GIMMICK_TYPE === 'synth'
              ? 'synth-dust-disintegrate 2.4s ease-in forwards'
              : GIMMICK_TYPE === 'cpunk'
                ? 'cpunk-dissolve 0.9s steps(8) forwards'
                : 'fallout-icon-disintegrate 0.6s 0.2s ease-in forwards',
          } : {}),
          ...(isReforming ? { animation: 'fallout-icon-reform 0.8s ease-out forwards' } : {}),
          // Scorched residue from a close nuclear hit — slowly heals
          ...(isDamaged ? { animation: 'fallout-damage-decay 9s ease-out forwards' } : {}),
          ...(isIrradiated ? { 
            filter: 'hue-rotate(80deg) brightness(1.3) drop-shadow(0 0 12px rgba(50,255,50,0.8))',
            animation: 'fallout-irradiated-pulse 0.8s ease-in-out infinite alternate',
          } : {}),
          // Progressive shake during countdown — more intense as numbers decrease
          ...(isArmed && countdown > 0 ? {
            animation: countdown === 1 
              ? 'fallout-countdown-shake-hard 0.15s infinite'
              : countdown === 2
                ? 'fallout-countdown-shake-medium 0.2s infinite'
                : 'fallout-countdown-shake-light 0.3s infinite',
            filter: `brightness(${1 + (4 - countdown) * 0.15}) saturate(${1 + (4 - countdown) * 0.3})`,
          } : {}),
          // Synthwave arming: chromatic pink/cyan ghosting builds until the snap
          ...(isArmed && GIMMICK_TYPE === 'synth' ? {
            animation: 'synth-hover-arm 0.45s ease-in-out infinite alternate',
          } : {}),
        }}
      >
        <div className={`${sizes.iconBox} ${state.theme === 'retro' || state.theme === 'fallout' || state.theme === 'cyberpunk' ? '' : styleClass} rounded-[22%] flex items-center justify-center overflow-hidden relative`}>
          {(() => {
            // NOTE: Do NOT define InnerIcon as a component function here.
            // A new component type on every render forces React to unmount/remount
            // the icon subtree, which restarts all CSS animations on every
            // desktop click (any osState change triggers a re-render).
            if (isArmed) {
              return (
                <>
                  {[1, 2, 3].map((slice) => (
                    <div 
                      key={slice}
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ animation: `fallout-slice-tear-${slice} 2.5s ease-in forwards` }}
                    >
                      <AppIcon id={id} size={sizes.icon} theme={state.theme} iconStyle={state.iconStyle} isDesktop={true} />
                    </div>
                  ))}
                </>
              );
            }

            return <AppIcon id={id} size={sizes.icon} theme={state.theme} iconStyle={state.iconStyle} isDesktop={true} />;
          })()}
        </div>
      </div>
      <span 
        className={`${sizes.text} text-[var(--desktop-icon-text)] text-center font-bold select-none leading-tight pointer-events-none px-1.5 py-0.5 mt-1.5`} 
        style={{ 
          textShadow: '0 1px 3px rgba(0,0,0,1), 0 2px 6px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5)',
          ...(isExploding ? {
            animation: GIMMICK_TYPE === 'synth'
              ? 'synth-dust-disintegrate 2.4s ease-in forwards'
              : GIMMICK_TYPE === 'cpunk'
                ? 'cpunk-dissolve 0.9s steps(8) forwards'
                : 'fallout-icon-disintegrate 0.6s 0.2s ease-in forwards',
          } : {}),
          ...(isReforming ? { animation: 'fallout-icon-reform 0.8s ease-out forwards' } : {}),
        }}>
        {title}
      </span>

      {/* Countdown Timer During Arming Phase — themed per gimmick */}
      {isArmed && GIMMICK_TYPE === 'synth' && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 pointer-events-none whitespace-nowrap font-mono text-[9px]"
          style={{
            color: '#ff71ce',
            textShadow: '0 0 8px rgba(255,46,196,0.7)',
            background: 'rgba(10, 2, 14, 0.9)',
            border: '1px solid rgba(255,46,196,0.5)',
            borderRadius: 3,
            padding: '2px 8px',
            letterSpacing: '2px',
            animation: 'fallout-countdown-blink 0.6s steps(2) infinite',
          }}
        >
          ⏏ EJECTING
        </div>
      )}
      {isArmed && countdown > 0 && GIMMICK_TYPE === 'cpunk' && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 pointer-events-none whitespace-nowrap font-mono text-[10px]"
          style={{
            color: countdown === 1 ? '#ff003c' : '#00fff0',
            textShadow: `0 0 8px ${countdown === 1 ? 'rgba(255,0,60,0.7)' : 'rgba(0,255,240,0.6)'}`,
            background: 'rgba(0, 10, 14, 0.92)',
            border: `1px solid ${countdown === 1 ? 'rgba(255,0,60,0.5)' : 'rgba(0,255,240,0.4)'}`,
            borderRadius: 3,
            padding: '3px 8px',
          }}
        >
          {`> ice --breach target=0x${id.slice(-4)} T-00:0${countdown}`}
          <span
            style={{
              display: 'inline-block', width: 6, height: 10, marginLeft: 4,
              background: countdown === 1 ? '#ff003c' : '#00fff0',
              verticalAlign: 'middle',
              animation: 'fallout-countdown-blink 0.5s steps(2) infinite',
            }}
          />
        </div>
      )}
      {isArmed && countdown > 0 && GIMMICK_TYPE !== 'cpunk' && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none flex flex-col items-center"
        >
          {/* Detonator panel — themed per gimmick */}
          <div
            style={{
              background: 'rgba(8, 10, 6, 0.92)',
              border: `2px solid ${gm.panelBorder}`,
              borderRadius: '4px',
              boxShadow: 'inset 0 0 12px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.6)',
              padding: '6px 12px 7px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1px',
              // repeating hazard stripes along the top edge
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,180,40,0.16) 0 8px, transparent 8px 16px)',
            }}
          >
            {/* Label */}
            <div
              style={{
                fontSize: '0.55rem',
                letterSpacing: '2px',
                fontWeight: 700,
                color: '#ffaa00',
                fontFamily: 'monospace',
                opacity: 0.85,
              }}
            >
              ⚠ DETONATION IN
            </div>

            {/* Digits — flat 7-segment look, minimal glow (cheap to composite) */}
            <div
              key={countdown}
              style={{
                fontSize: '2.6rem',
                fontWeight: 700,
                fontFamily: '"Courier New", monospace',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                letterSpacing: '4px',
                color: gm.digit[countdown - 1] || gm.digit[0],
                textShadow: countdown === 1 ? `0 0 12px ${gm.digit[2]}` : 'none',
                animation: 'fallout-countdown-pulse 1s ease-out forwards',
                transformOrigin: 'center',
              }}
            >
              {`00:0${countdown}`}
            </div>

            {/* Blinking arm indicator — opacity-only pulse (compositor friendly) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.6rem',
                color: gm.digit[0],
                fontFamily: 'monospace',
                animation: 'fallout-countdown-blink 0.5s steps(2) infinite',
              }}
            >
              <span>☢</span>
              <span style={{ letterSpacing: '1px' }}>{gm.tag}</span>
              <span>☢</span>
            </div>
          </div>
        </div>
      )}

      {/* Desktop icon context menu */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[100001] w-48 backdrop-blur-xl border border-[var(--border-color)] rounded-xl shadow-2xl p-1.5 overflow-hidden"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--window-bg)',
            backdropFilter: 'blur(var(--glass-blur, 24px))',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-color)] mb-1 truncate">
            {title}
          </div>
          <button
            onClick={() => {
              handleDoubleClick();
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-indigo)] shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>
            Open
          </button>
          <div className="h-px bg-[var(--border-color)] my-1 mx-2" />
          {isPinned ? (
            <button
              onClick={() => {
                unpinApp(id);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-amber)] shrink-0"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Unpin from Taskbar
            </button>
          ) : (
            <button
              onClick={() => {
                pinApp(id);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg flex items-center gap-2 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-indigo)] shrink-0"><path d="M12 2v20M2 12h20"/></svg>
              Pin to Taskbar
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
