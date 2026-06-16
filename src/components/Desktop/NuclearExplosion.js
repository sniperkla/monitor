'use client';

import { useState, useEffect, useMemo, useRef } from 'react';

/**
 * A standalone Nuclear Explosion component that can be placed anywhere on the screen.
 * It renders the mushroom cloud, shockwaves, and debris.
 */
export default function NuclearExplosion({ x, y, onComplete, id }) {
  const [active, setActive] = useState(true);
  const onCompleteRef = useRef(onComplete);
  const audioCtxRef = useRef(null);

  // Keep callback ref fresh without re-triggering effects
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Run ONCE on mount: start animations + play sound
  useEffect(() => {
    // Automatically cleanup after the 10s mushroom cloud animation
    const timer = setTimeout(() => {
      setActive(false);
      if (onCompleteRef.current) onCompleteRef.current();
    }, 10000);

    // --- Procedural Nuclear Explosion Sound (Web Audio) ---
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      
      // 1. Physical Impact (Deep Sub-Bass Thump)
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.6);
      oscGain.gain.setValueAtTime(0.8, audioCtx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
      osc.connect(oscGain);
      oscGain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 1.2);

      // 2. Shockwave (Massive White Noise Rumble)
      const bufferSize = audioCtx.sampleRate * 4;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const noiseFilter = audioCtx.createBiquadFilter();
      const noiseGain = audioCtx.createGain();
      
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(1000, audioCtx.currentTime);
      noiseFilter.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 4.0);
      
      noiseGain.gain.setValueAtTime(0.5, audioCtx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 4.0);
      
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      noise.start();
      noise.stop(audioCtx.currentTime + 4.0);
    } catch (e) {
      console.warn("Audio Context blocked by browser:", e);
    }

    return () => {
      clearTimeout(timer);
      // Kill audio immediately on unmount
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch(e) {}
        audioCtxRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate particles only once on mount
  const particles = useMemo(() => {
    const debris = [];
    for (let i = 0; i < 40; i++) {
      const angle = (360 / 40) * i + (Math.random() * 20 - 10);
      const distance = 80 + Math.random() * 150; 
      const size = 1 + Math.random() * 5;
      const delay = Math.random() * 0.1;
      const duration = 0.4 + Math.random() * 0.6;
      const colors = ['#ff4400', '#ff6600', '#ffaa00', '#18e12c', '#ff2200'];
      const color = colors[i % colors.length];
      debris.push({ id: i, angle, distance, size, delay, duration, color });
    }

    const embers = [];
    for (let i = 0; i < 15; i++) {
      const ex = -60 + Math.random() * 120;
      const edelay = 0.1 + Math.random() * 0.4;
      embers.push({ id: i, x: ex, delay: edelay });
    }

    return { debris, embers };
  }, []);

  if (!active) return null;

  return (
    <div 
      className="fixed pointer-events-none z-[9999]" 
      style={{ left: x, top: y, width: 0, height: 0 }}
    >
      <div className="absolute pointer-events-none" style={{ left: '-60px', top: '-60px', right: '-60px', bottom: '-60px' }}>
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

        {/* Refractive Shockwave Rings */}
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
        {particles.debris.map((p) => (
          <div
            key={`d-${p.id}`}
            className="absolute pointer-events-none"
            style={{
              width: p.size,
              height: p.size * (0.5 + Math.random()),
              backgroundColor: p.color,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
              left: '50%',
              top: '50%',
              boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
              animation: `fallout-particle-fly ${p.duration}s ${p.delay}s ease-out forwards`,
              '--fly-x': `${Math.cos((p.angle * Math.PI) / 180) * p.distance}px`,
              '--fly-y': `${Math.sin((p.angle * Math.PI) / 180) * p.distance}px`,
            }}
          />
        ))}

        {/* Embers drifting up */}
        {particles.embers.map((e) => (
          <div
            key={`e-${e.id}`}
            className="absolute pointer-events-none rounded-full"
            style={{
              width: 2,
              height: 2,
              backgroundColor: e.id % 2 === 0 ? '#ffaa00' : '#ff6600',
              left: `calc(50% + ${e.x}px)`,
              top: '50%',
              boxShadow: `0 0 4px ${e.id % 2 === 0 ? '#ffaa00' : '#ff6600'}`,
              animation: `fallout-ember-rise 1.5s ${e.delay}s ease-out forwards`,
            }}
          />
        ))}

        {/* Ground Dust Shockwave */}
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
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="55" xChannelSelector="R" yChannelSelector="G" result="displaced" />
              {/* Soften edges for smoke plume realism */}
              <feGaussianBlur in="displaced" stdDeviation="5.5" result="blur" />
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
            transform: 'translateZ(0)',
          }}
        >
          {/* Base Dust Collar (Rolling cloud of dust at the foot of the stem) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              background: 'radial-gradient(ellipse, rgba(80, 60, 50, 0.75) 0%, rgba(40, 30, 25, 0.4) 60%, transparent 80%)',
              boxShadow: '0 0 50px rgba(80, 60, 50, 0.5), inset 0 0 30px rgba(0, 0, 0, 0.6)',
              animation: 'fallout-nuke-dust-collar 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Outer Dark Smoke Column (Stem Plume) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 100,
              background: 'linear-gradient(to top, rgba(20, 15, 15, 0.95), rgba(50, 40, 40, 0.75) 50%, rgba(200, 80, 20, 0.2))',
              borderRadius: '40px',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Inner Fiery Pillar (Incandescent core of the stem) */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 35,
              background: 'linear-gradient(to top, #ffffff, #ffcc00 20%, #ff4400 60%, transparent)',
              boxShadow: '0 0 45px #ff3300, 0 0 15px #ffaa00',
              borderRadius: '20px',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
              opacity: 0.9,
            }}
          />

          {/* Volumetric Billowing Cap - Core Explosion (Inner Fireball) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 210, height: 150,
              background: 'radial-gradient(circle, #ffffff 0%, #ffcc00 30%, #ff2200 65%, rgba(25, 5, 0, 0.95) 85%, transparent 100%)',
              boxShadow: 'inset 0 15px 60px rgba(255, 255, 255, 0.8), 0 0 120px rgba(255, 68, 0, 0.8)',
              animation: 'fallout-giant-mushroom-cap-core 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Volumetric Billowing Cap - Left Lobe (Dark turbulent soot) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 225, height: 165,
              background: 'radial-gradient(circle at 40% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -20px 60px rgba(255, 68, 0, 0.2), inset 15px 15px 45px rgba(0,0,0,0.8)',
              animation: 'fallout-giant-mushroom-cap-left 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Volumetric Billowing Cap - Right Lobe (Dark turbulent soot) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 225, height: 165,
              background: 'radial-gradient(circle at 60% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -20px 60px rgba(255, 68, 0, 0.2), inset -15px 15px 45px rgba(0,0,0,0.8)',
              animation: 'fallout-giant-mushroom-cap-right 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Vapor Condensation Ring (Expanding moisture ring) */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              border: '4px solid rgba(255, 255, 255, 0.45)',
              boxShadow: '0 0 25px rgba(255, 255, 255, 0.3), inset 0 0 25px rgba(255, 255, 255, 0.3)',
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
            borderRadius: '50%',
            border: 'solid rgba(255, 200, 50, 0.4)',
            boxShadow: '0 0 60px rgba(255, 100, 0, 0.8), inset 0 0 60px rgba(255, 100, 0, 0.8)',
            animation: 'fallout-radiation-glow 2.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
            zIndex: 9999,
          }}
        />
      </div>
    </div>
  );
}
