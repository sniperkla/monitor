'use client';

import { useState, useEffect, useMemo, useRef } from 'react';

/**
 * Immersive Nuclear Explosion with 3D perspective, heat distortion,
 * chromatic aberration, screen-wide post-processing, and enhanced particles.
 */
export default function NuclearExplosion({ x, y, onComplete, id }) {
  const [active, setActive] = useState(true);
  const [phase, setPhase] = useState('flash'); // flash -> blast -> mushroom -> aftermath
  const onCompleteRef = useRef(onComplete);
  const audioCtxRef = useRef(null);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    // Phase transitions
    const t1 = setTimeout(() => setPhase('blast'), 200);
    const t2 = setTimeout(() => setPhase('mushroom'), 800);
    const t3 = setTimeout(() => setPhase('aftermath'), 3000);
    const t4 = setTimeout(() => {
      setActive(false);
      onCompleteRef.current?.();
    }, 12000);

    // Procedural Audio
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const now = audioCtx.currentTime;

      // Deep sub-bass impact
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now);
      osc.frequency.exponentialRampToValueAtTime(8, now + 0.8);
      oscGain.gain.setValueAtTime(0.9, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
      osc.connect(oscGain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 1.5);

      // Crackle/particle debris layer
      const crackleLen = audioCtx.sampleRate * 2;
      const crackleBuf = audioCtx.createBuffer(1, crackleLen, audioCtx.sampleRate);
      const crackleData = crackleBuf.getChannelData(0);
      for (let i = 0; i < crackleLen; i++) {
        crackleData[i] = (Math.random() * 2 - 1) * (Math.random() > 0.97 ? 0.8 : 0.02);
      }
      const crackle = audioCtx.createBufferSource();
      crackle.buffer = crackleBuf;
      const crackleFilter = audioCtx.createBiquadFilter();
      crackleFilter.type = 'bandpass';
      crackleFilter.frequency.value = 3000;
      crackleFilter.Q.value = 0.5;
      const crackleGain = audioCtx.createGain();
      crackleGain.gain.setValueAtTime(0.3, now + 0.3);
      crackleGain.gain.exponentialRampToValueAtTime(0.01, now + 2.5);
      crackle.connect(crackleFilter).connect(crackleGain).connect(audioCtx.destination);
      crackle.start(now + 0.2);
      crackle.stop(now + 2.5);

      // Massive shockwave rumble
      const bufSize = audioCtx.sampleRate * 5;
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const lpf = audioCtx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(800, now);
      lpf.frequency.exponentialRampToValueAtTime(15, now + 5);
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.6, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 5);
      noise.connect(lpf).connect(noiseGain).connect(audioCtx.destination);
      noise.start(now);
      noise.stop(now + 5);

      // High-frequency whine (electromagnetic pulse feel)
      const whine = audioCtx.createOscillator();
      const whineGain = audioCtx.createGain();
      whine.type = 'sawtooth';
      whine.frequency.setValueAtTime(4000, now);
      whine.frequency.exponentialRampToValueAtTime(200, now + 0.5);
      whineGain.gain.setValueAtTime(0.15, now);
      whineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      whine.connect(whineGain).connect(audioCtx.destination);
      whine.start(now);
      whine.stop(now + 0.6);
    } catch (_) {}

    return () => {
      [t1, t2, t3, t4].forEach(clearTimeout);
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (_) {}
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Generate particles once
  const particles = useMemo(() => {
    const debris = [];
    for (let i = 0; i < 60; i++) {
      const angle = (360 / 60) * i + (Math.random() * 30 - 15);
      const distance = 100 + Math.random() * 250;
      const size = 2 + Math.random() * 8;
      const delay = Math.random() * 0.15;
      const duration = 0.5 + Math.random() * 0.8;
      const colors = ['#ff4400', '#ff6600', '#ffaa00', '#18e12c', '#ff2200', '#ffcc00'];
      const color = colors[i % colors.length];
      const trail = Math.random() > 0.6;
      debris.push({ id: i, angle, distance, size, delay, duration, color, trail });
    }

    const embers = [];
    for (let i = 0; i < 25; i++) {
      const ex = -80 + Math.random() * 160;
      const edelay = 0.1 + Math.random() * 0.5;
      const size = 1 + Math.random() * 3;
      embers.push({ id: i, x: ex, delay: edelay, size });
    }

    // Fallout ash/radioactive particles
    const fallout = [];
    for (let i = 0; i < 30; i++) {
      const fx = -200 + Math.random() * 400;
      const delay = 2 + Math.random() * 3;
      const duration = 4 + Math.random() * 6;
      const size = 1 + Math.random() * 2;
      fallout.push({ id: i, x: fx, delay, duration, size });
    }

    return { debris, embers, fallout };
  }, []);

  if (!active) return null;

  return (
    <div
      className="fixed pointer-events-none z-[9999]"
      style={{
        left: x, top: y, width: 0, height: 0,
        perspective: '1200px',
        perspectiveOrigin: '50% 50%',
      }}
    >
      {/* === SCREEN-WIDE POST-PROCESSING OVERLAYS === */}
      {/* White flash blast */}
      <div className="fixed inset-0 pointer-events-none z-[10000]"
        style={{
          background: 'radial-gradient(circle at 50% 50%, #ffffff 0%, #ffcc00 40%, #ff4400 70%, transparent 100%)',
          animation: 'nuke-screen-flash 1.2s ease-out forwards',
          mixBlendMode: 'screen',
        }}
      />

      {/* Chromatic aberration overlay */}
      <div className="fixed inset-0 pointer-events-none z-[10001]"
        style={{
          animation: 'nuke-chromatic-aberration 2s ease-out forwards',
          background: 'transparent',
          boxShadow: 'inset -4px 0 20px rgba(255,0,0,0.3), inset 4px 0 20px rgba(0,100,255,0.3)',
          mixBlendMode: 'screen',
        }}
      />

      {/* Heat distortion wave */}
      <div className="fixed inset-0 pointer-events-none z-[10002]"
        style={{
          animation: 'nuke-heat-distortion 3s ease-out forwards',
          backdropFilter: 'blur(0px)',
          WebkitBackdropFilter: 'blur(0px)',
        }}
      />

      {/* Radiation vignette — green-tinted edges */}
      <div className="fixed inset-0 pointer-events-none z-[10003]"
        style={{
          animation: 'nuke-radiation-vignette 8s ease-out forwards',
          boxShadow: 'inset 0 0 200px rgba(50,255,50,0.0)',
        }}
      />

      {/* Scanline/static overlay during aftermath */}
      {phase === 'aftermath' && (
        <div className="fixed inset-0 pointer-events-none z-[10004]"
          style={{
            animation: 'nuke-static-overlay 4s linear forwards',
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.03) 2px, rgba(0,255,0,0.03) 4px)',
            mixBlendMode: 'overlay',
          }}
        />
      )}

      {/* === MAIN EXPLOSION CONTENT (3D perspective container) === */}
      <div className="absolute pointer-events-none"
        style={{
          left: '-120px', top: '-120px', right: '-120px', bottom: '-120px',
          transformStyle: 'preserve-3d',
          transform: 'rotateX(5deg)',
        }}
      >
        {/* Ground-zero fireball with 3D depth */}
        <div className="absolute pointer-events-none"
          style={{
            left: '50%', top: '50%',
            width: 30, height: 30,
            transform: 'translate(-50%, -50%) translateZ(50px)',
            animation: 'fallout-fireball 0.8s ease-out forwards',
            filter: 'blur(2px)',
          }}
        />

        {/* Central nuclear flash — multi-layered for 3D feel */}
        <div className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            width: 15, height: 15,
            transform: 'translate(-50%, -50%) translateZ(100px)',
            animation: 'fallout-nuke-flash 0.8s ease-out forwards',
            filter: 'blur(3px)',
          }}
        />

        {/* Secondary flash layer — depth */}
        <div className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            width: 8, height: 8,
            transform: 'translate(-50%, -50%) translateZ(150px)',
            animation: 'fallout-nuke-flash 0.6s 0.05s ease-out forwards',
            background: '#ffffff',
            boxShadow: '0 0 100px 50px rgba(255,255,255,0.9)',
          }}
        />

        {/* Refractive Shockwave Rings — 3D perspective */}
        {[
          { delay: '0s', duration: '1s', z: 0 },
          { delay: '0.12s', duration: '1.4s', z: 20 },
          { delay: '0.25s', duration: '1.8s', z: 40 },
          { delay: '0.4s', duration: '2.2s', z: 60 },
        ].map((ring, i) => (
          <div key={`ring-${i}`} className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              transform: `translate(-50%, -50%) translateZ(${ring.z}px)`,
              animation: `fallout-shockwave ${ring.duration} ${ring.delay} cubic-bezier(0, 0, 0.2, 1) forwards`,
            }}
          />
        ))}

        {/* Debris particles — some with trails */}
        {particles.debris.map((p) => (
          <div key={`d-${p.id}`} className="absolute pointer-events-none"
            style={{
              width: p.size,
              height: p.size * (0.5 + Math.random()),
              backgroundColor: p.color,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
              left: '50%',
              top: '50%',
              boxShadow: p.trail
                ? `0 0 ${p.size * 4}px ${p.color}, 0 0 ${p.size * 8}px ${p.color}40`
                : `0 0 ${p.size * 3}px ${p.color}`,
              transform: `translateZ(${Math.random() * 80}px)`,
              animation: `fallout-particle-fly ${p.duration}s ${p.delay}s ease-out forwards`,
              '--fly-x': `${Math.cos((p.angle * Math.PI) / 180) * p.distance}px`,
              '--fly-y': `${Math.sin((p.angle * Math.PI) / 180) * p.distance}px`,
            }}
          />
        ))}

        {/* Embers drifting up — varied sizes */}
        {particles.embers.map((e) => (
          <div key={`e-${e.id}`} className="absolute pointer-events-none rounded-full"
            style={{
              width: e.size,
              height: e.size,
              backgroundColor: e.id % 3 === 0 ? '#ffcc00' : e.id % 3 === 1 ? '#ffaa00' : '#ff6600',
              left: `calc(50% + ${e.x}px)`,
              top: '50%',
              boxShadow: `0 0 ${e.size * 3}px ${e.id % 2 === 0 ? '#ffaa00' : '#ff6600'}`,
              transform: `translateZ(${20 + Math.random() * 60}px)`,
              animation: `fallout-ember-rise 2s ${e.delay}s ease-out forwards`,
            }}
          />
        ))}

        {/* Ground Dust Shockwave — 3D */}
        <div className="absolute pointer-events-none rounded-full"
          style={{
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%) translateZ(-20px)',
            animation: 'fallout-dust-ring 3s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
          }}
        />

        {/* SVG Displacement Filter for Volumetric Smoke */}
        <svg width="0" height="0" className="absolute pointer-events-none">
          <defs>
            <filter id={`mushroom-smoke-filter-${id}`} x="-150%" y="-150%" width="400%" height="400%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" result="noise" seed={id || 1} />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="65" xChannelSelector="R" yChannelSelector="G" result="displaced" />
              <feGaussianBlur in="displaced" stdDeviation="6" result="blur" />
              <feComponentTransfer in="blur">
                <feFuncA type="linear" slope="2.0" />
              </feComponentTransfer>
            </filter>
          </defs>
        </svg>

        {/* MUSHROOM CLOUD — 3D layered */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            filter: `url(#mushroom-smoke-filter-${id})`,
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Base Dust Collar */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              background: 'radial-gradient(ellipse, rgba(80, 60, 50, 0.8) 0%, rgba(40, 30, 25, 0.5) 60%, transparent 80%)',
              boxShadow: '0 0 60px rgba(80, 60, 50, 0.6), inset 0 0 40px rgba(0, 0, 0, 0.7)',
              transform: 'translateZ(-30px)',
              animation: 'fallout-nuke-dust-collar 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Outer Dark Smoke Column (Stem) */}
          <div className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 110,
              background: 'linear-gradient(to top, rgba(20, 15, 15, 0.95), rgba(50, 40, 40, 0.8) 50%, rgba(200, 80, 20, 0.25))',
              borderRadius: '40px',
              transform: 'translateZ(10px)',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Inner Fiery Pillar */}
          <div className="absolute pointer-events-none"
            style={{
              left: '50%', top: '50%',
              width: 40,
              background: 'linear-gradient(to top, #ffffff, #ffcc00 20%, #ff4400 60%, transparent)',
              boxShadow: '0 0 60px #ff3300, 0 0 20px #ffaa00',
              borderRadius: '20px',
              transform: 'translateZ(20px)',
              animation: 'fallout-giant-mushroom-stem 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
              opacity: 0.9,
            }}
          />

          {/* Cap Core — 3D depth */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 220, height: 160,
              background: 'radial-gradient(circle, #ffffff 0%, #ffcc00 30%, #ff2200 65%, rgba(25, 5, 0, 0.95) 85%, transparent 100%)',
              boxShadow: 'inset 0 20px 80px rgba(255, 255, 255, 0.8), 0 0 150px rgba(255, 68, 0, 0.8)',
              transform: 'translateZ(40px)',
              animation: 'fallout-giant-mushroom-cap-core 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Cap Left Lobe */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 235, height: 175,
              background: 'radial-gradient(circle at 40% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -25px 80px rgba(255, 68, 0, 0.25), inset 15px 15px 50px rgba(0,0,0,0.8)',
              transform: 'translateZ(25px)',
              animation: 'fallout-giant-mushroom-cap-left 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Cap Right Lobe */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              width: 235, height: 175,
              background: 'radial-gradient(circle at 60% 40%, rgba(255, 100, 0, 0.5) 0%, rgba(50, 40, 40, 0.95) 50%, rgba(20, 15, 15, 0.98) 80%, transparent 100%)',
              boxShadow: '0 -25px 80px rgba(255, 68, 0, 0.25), inset -15px 15px 50px rgba(0,0,0,0.8)',
              transform: 'translateZ(15px)',
              animation: 'fallout-giant-mushroom-cap-right 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />

          {/* Condensation Ring */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: '50%', top: '50%',
              border: '5px solid rgba(255, 255, 255, 0.5)',
              boxShadow: '0 0 30px rgba(255, 255, 255, 0.35), inset 0 0 30px rgba(255, 255, 255, 0.35)',
              transform: 'translateZ(50px)',
              animation: 'fallout-nuke-condensation-ring 10s cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
            }}
          />
        </div>

        {/* Radiation Shockwave — 3D */}
        <div className="absolute pointer-events-none"
          style={{
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%) translateZ(-10px)',
            borderRadius: '50%',
            border: 'solid rgba(255, 200, 50, 0.4)',
            boxShadow: '0 0 80px rgba(255, 100, 0, 0.9), inset 0 0 80px rgba(255, 100, 0, 0.9)',
            animation: 'fallout-radiation-glow 2.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards',
            zIndex: 9999,
          }}
        />

        {/* Fallout ash rain — delayed radioactive particles */}
        {particles.fallout.map((f) => (
          <div key={`f-${f.id}`} className="absolute pointer-events-none rounded-full"
            style={{
              width: f.size,
              height: f.size,
              backgroundColor: f.id % 2 === 0 ? '#88ff88' : '#aaffaa',
              left: `calc(50% + ${f.x}px)`,
              top: '-20px',
              opacity: 0,
              boxShadow: '0 0 4px #88ff88',
              animation: `nuke-fallout-rain ${f.duration}s ${f.delay}s ease-in forwards`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
