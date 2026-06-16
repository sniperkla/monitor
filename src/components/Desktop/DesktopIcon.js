'use client';

import { useOS } from '@/context/OSContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import AppIcon from '@/components/common/AppIcon';

export default function DesktopIcon({ id, title, icon: Icon, component, defaultPos, initialWidth, initialHeight, isFalloutIdleMode }) {
  const { state, openWindow, updateIconPosition, setSortBy, setSelectedIcons, toggleIconSelection, updateMultipleIconPositions } = useOS();
  const { selectedIconIds } = state;
  const isSelected = selectedIconIds.includes(id);
  const [isDragging, setIsDragging] = useState(false);
  const [consumedAsAmmo, setConsumedAsAmmo] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, snapshot: null, isConsumed: false });
  const hoverTimeoutRef = useRef(null);
  const iconRef = useRef(null);
  
  const position = state.iconPositions[id] || defaultPos || { x: 0, y: 0 };
  const iconSize = state.iconSize || 'medium';
  const isFalloutTheme = state.theme === 'retro' || state.theme === 'fallout';

  const handleDoubleClick = () => {
    openWindow(id, title, component, Icon, { initialWidth, initialHeight });
  };

  const getSizes = () => {
    switch (iconSize) {
      case 'small': return { container: 'w-20', icon: 32, iconBox: 'w-10 h-10', text: 'text-[10px]' };
      case 'large': return { container: 'w-28', icon: 32, iconBox: 'w-16 h-16', text: 'text-sm' };
      default: return { container: 'w-24', icon: 24, iconBox: 'w-12 h-12', text: 'text-xs' };
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
    // Only left mouse button
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Handle selection
    if (e.shiftKey || e.metaKey) {
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
    };

    setIsDragging(true);

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        dragRef.current.hasMoved = true;
      }

      const updates = {};
      Object.keys(dragRef.current.snapshot).forEach(sid => {
        const start = dragRef.current.snapshot[sid];
        updates[sid] = {
          x: start.x + dx,
          y: start.y + dy,
        };
      });
      // Track latest positions in the ref so pointerup can read them
      // (avoids stale closure reading old state.iconPositions)
      dragRef.current.lastPositions = updates;
      updateMultipleIconPositions(updates);

      // --- HOVER TO AIRSTRIKE LOGIC ---
      const myLatestY = updates[id]?.y;
      if (isFalloutTheme && isFalloutIdleMode && myLatestY !== undefined) {
        if (myLatestY < 300) {
          if (!hoverTimeoutRef.current) {
             hoverTimeoutRef.current = setTimeout(() => {
                if (dragRef.current.isConsumed) return;
                dragRef.current.isConsumed = true;
                
                const myLatestX = dragRef.current.lastPositions?.[id]?.x || updates[id].x;
                window.dispatchEvent(
                  new CustomEvent('fallout-airstrike', { detail: { x: myLatestX, y: myLatestY } })
                );
                setConsumedAsAmmo(true);
                
                // End drag manually
                setIsDragging(false);
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
             }, 800); // 800ms hover threshold
          }
        } else {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
          }
        }
      }
    };

    const handlePointerUp = (e) => {
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }

      const latestX = dragRef.current.lastPositions?.[id]?.x;
      const latestY = dragRef.current.lastPositions?.[id]?.y;

      // Abort if already consumed by the hover timeout
      if (dragRef.current.isConsumed) return;

      // Special Fallout Interaction: Drag icon to the Sky to call an airstrike!
      // The icon "disappears" like ammunition being loaded into the bomber
      if (isFalloutTheme && isFalloutIdleMode && latestY !== undefined && latestY < 300) {
          // Dispatch airstrike event (plane only, no self-detonation)
          window.dispatchEvent(
            new CustomEvent('fallout-airstrike', {
               detail: { x: latestX, y: latestY }
            })
          );
          dragRef.current.isConsumed = true;
          // Hide icon visually (it becomes the "ammo")
          setConsumedAsAmmo(true);
          dragRef.current.snapshot = null;
          dragRef.current.lastPositions = null;
          return; // Skip normal grid-snap logic
      }

      // Grid snap all moved icons using the latest dragged positions
      // (not state.iconPositions which is stale due to React closure)
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
  }, [id, isSelected, selectedIconIds, state.iconPositions, defaultPos, isFalloutTheme, isFalloutIdleMode]);

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

  // ========== FALLOUT EXPLOSION EASTER EGG ==========
  // Reset ammo state when exiting wasteland mode
  useEffect(() => {
    if (!isFalloutIdleMode) setConsumedAsAmmo(false);
  }, [isFalloutIdleMode]);

  const [isExploding, setIsExploding] = useState(false);
  const [isReforming, setIsReforming] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
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

      // Max impact radius 600px
      if (distance < 600 && distance > 0) {
        // Inverse square-ish force dropoff
        const force = Math.pow(Math.max(0, (600 - distance) / 600), 1.5); 
        
        // Push outward up to 150px
        const pushX = (dx / distance) * force * 150;
        const pushY = (dy / distance) * force * 150;
        
        // Unpredictable spin generated by the chaotic wind
        const rotate = (Math.random() > 0.5 ? 1 : -1) * force * (45 + Math.random() * 45);

        // Instantly get hit by the shockwave
        setImpactTransform(`translate(${pushX}px, ${pushY}px) rotate(${rotate}deg) scale(${1 - force*0.3})`);
        
        // Wait out the blast, then spring back
        setTimeout(() => {
          setImpactTransform('');
        }, 800 + Math.random() * 600); // 0.8s to 1.4s recovery
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

  const handleMouseEnter = useCallback(() => {
    if (!isFalloutTheme || isExploding || isReforming || isFalloutIdleMode) return;
    
    // Don't trigger the apocalyptic audio instantly. Give the user a 1-second grace period 
    // so they can double-click or swipe past icons without annoyance.
    hoverDelayTimerRef.current = setTimeout(() => {
      setIsArmed(true); // Icon starts physically tearing apart

      // Start Air Raid Siren
      startSiren();

      // Start playing geiger clicks at random intervals
      const clickLoop = () => {
        playGeigerClick();
        const nextClick = 50 + Math.random() * 150; // Getting faster as it approaches
        geigerIntervalRef.current = setTimeout(clickLoop, nextClick);
      };
      geigerIntervalRef.current = setTimeout(clickLoop, 100);

      // Arm the detonation for 2.5 seconds *after* the warning sirens start
      explosionTimerRef.current = setTimeout(() => {
        setIsArmed(false); // Explosion takes over

        // Clear geiger counter
        if (geigerIntervalRef.current) {
          clearTimeout(geigerIntervalRef.current);
          geigerIntervalRef.current = null;
        }
        
        // Stop siren and transition into the blast
        stopSiren();
        
        setIsExploding(true);
        triggerScreenShake();
        triggerFullScreenFlash();
        playExplosionSound();
        
        // Dispatch explosion event to affect other icons globally
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

        // Spawn full-screen CRT damage static
        const crtDamage = document.createElement('div');
        crtDamage.className = 'fallout-crt-damage';
        document.body.appendChild(crtDamage);
        setTimeout(() => crtDamage.remove(), 3000);

        // Spawn radioactive fallout rain across the viewport (Optimized Count)
        const rainContainer = document.createElement('div');
        rainContainer.className = 'fallout-rain-container';
        for (let i = 0; i < 20; i++) {
          const drop = document.createElement('div');
          drop.className = 'fallout-rain-drop';
          drop.style.left = `${Math.random() * 100}%`;
          drop.style.animationDelay = `${Math.random() * 4}s`;
          drop.style.animationDuration = `${3 + Math.random() * 4}s`;
          drop.style.opacity = `${0.3 + Math.random() * 0.7}`;
          drop.style.width = `${1 + Math.random() * 3}px`;
          drop.style.height = `${1 + Math.random() * 3}px`;
          rainContainer.appendChild(drop);
        }
        document.body.appendChild(rainContainer);
        setTimeout(() => rainContainer.remove(), 8000);

        // Let the icon start reconstructing from the nuclear ashes
        setTimeout(() => setIsReforming(true), 6000);
        setTimeout(() => {
          setIsReforming(false);
          // Icon is now irradiated — glows green and pulses
          setIsIrradiated(true);
          setTimeout(() => setIsIrradiated(false), 5000);
        }, 8000);

        // Keep the mushroom cloud DOM elements alive for 11 seconds total
        setTimeout(() => {
          setIsExploding(false);
        }, 11000);
      }, 2500);
    }, 1000); // 1000ms grace period
  }, [isFalloutTheme, isExploding, isReforming, playGeigerClick, playExplosionSound, startSiren, stopSiren, id]);

  const handleMouseLeave = useCallback(() => {
    setIsArmed(false);
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

    return (
      <div className="absolute pointer-events-none z-50" style={{ left: '-60px', top: '-60px', right: '-60px', bottom: '-60px' }}>
        {/* Ground-zero fireball */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: '50%', top: '50%',
            width: 20, height: 20,
            transform: 'translate(-50%, -50%)',
            animation: 'fallout-fireball 0.8s ease-out forwards',
          }}
        />

        {/* Central nuclear flash */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            width: 10, height: 10,
            transform: 'translate(-50%, -50%)',
            animation: 'fallout-nuke-flash 0.8s ease-out forwards',
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
              {/* Generate high-fidelity fractal noise for organic billows */}
              <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" result="noise" />
              {/* Volumetric displacement */}
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="40" xChannelSelector="R" yChannelSelector="G" result="displaced" />
              {/* Soften edges for smoke plume realism */}
              <feGaussianBlur in="displaced" stdDeviation="5" result="blur" />
              <feComponentTransfer in="blur">
                <feFuncA type="linear" slope="1.8" />
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
              background: 'linear-gradient(to top, #ffffff, #ffcc00 20%, #ff4400 60%, transparent)',
              boxShadow: '0 0 30px #ff3300, 0 0 10px #ffaa00',
              borderRadius: '15px',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
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
      className={`desktop-icon absolute flex flex-col items-center justify-center p-2 rounded-xl 
        cursor-grab active:cursor-grabbing hover:bg-[var(--text-primary)]/10 dark:hover:bg-white/10 active:bg-[var(--text-primary)]/15 
        transition-all duration-150
        ${sizes.container} gap-2 z-10 group 
        ${isSelected ? 'bg-[var(--accent-indigo)]/15 border border-[var(--accent-indigo)]/40 shadow-[0_8px_24px_rgba(0,0,0,0.15)] ring-1 ring-[var(--accent-indigo)]/20' : 'border border-transparent'}
        ${isDragging ? 'z-50 opacity-90' : ''}
        ${isExploding ? 'z-50' : ''}
        ${consumedAsAmmo ? 'pointer-events-none' : ''}
      `}
      data-icon-id={id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      tabIndex={0}
      style={{ 
        left: position.x, 
        top: position.y,
        transform: impactTransform || 'none',
        transition: isDragging ? 'none' : 
                    impactTransform ? 'transform 0.05s cubic-bezier(0, 0.9, 0.1, 1)' : 
                    'transform 0.8s cubic-bezier(0.3, -0.3, 0.2, 1.4), left 0.15s ease, top 0.15s ease',
        touchAction: 'none',
        opacity: consumedAsAmmo ? 0 : undefined,
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
        className={`flex items-center justify-center transition-all duration-300 pointer-events-none group-hover:shadow-indigo-500/20 ${isDragging ? 'scale-110 shadow-2xl' : (!isArmed && !isExploding && !isReforming ? 'group-hover:scale-110' : '')}`}
        style={{
          ...(isExploding ? { animation: 'fallout-icon-disintegrate 0.6s 0.2s ease-in forwards' } : {}),
          ...(isReforming ? { animation: 'fallout-icon-reform 0.8s ease-out forwards' } : {}),
          ...(isIrradiated ? { 
            filter: 'hue-rotate(80deg) brightness(1.3) drop-shadow(0 0 12px rgba(50,255,50,0.8))',
            animation: 'fallout-irradiated-pulse 0.8s ease-in-out infinite alternate',
          } : {}),
        }}
      >
        <div className={`${sizes.iconBox} ${state.theme === 'retro' || state.theme === 'fallout' || state.theme === 'cyberpunk' ? '' : styleClass} rounded-2xl flex items-center justify-center overflow-hidden relative`}>
          {(() => {
            const InnerIcon = () => (
              <AppIcon id={id} size={sizes.icon} theme={state.theme} iconStyle={state.iconStyle} isDesktop={true} />
            );

            if (isArmed) {
              return (
                <>
                  {[1, 2, 3].map((slice) => (
                    <div 
                      key={slice}
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ animation: `fallout-slice-tear-${slice} 2.5s ease-in forwards` }}
                    >
                      <InnerIcon />
                    </div>
                  ))}
                </>
              );
            }

            return <InnerIcon />;
          })()}
        </div>
      </div>
      <span 
        className={`${sizes.text} text-[var(--desktop-icon-text)] text-center font-semibold select-none leading-tight pointer-events-none px-1 py-0.5 mt-1.5`} 
        style={{ 
          textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.6)',
          ...(isExploding ? { animation: 'fallout-icon-disintegrate 0.6s 0.2s ease-in forwards' } : {}),
          ...(isReforming ? { animation: 'fallout-icon-reform 0.8s ease-out forwards' } : {}),
        }}>
        {title}
      </span>

      {/* Massive Flashing Radiation Symbol During Arming Phase */}
      {isArmed && (
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none flex items-center justify-center font-bold"
          style={{ 
            fontSize: '6rem',
            color: '#ffcc00', // Bright warning yellow
            textShadow: '0 0 20px #ffaa00, 0 0 40px #ff6600, 0 0 80px #ffffff',
            animation: 'fallout-biohazard-flash 0.15s infinite alternate ease-in-out'
          }}
        >
          ☢
        </div>
      )}
    </div>
  );
}
