'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import NuclearExplosion from './NuclearExplosion';

const WORLD_WIDTH = 1200;
const WORLD_DEPTH = 800;

// Dynamic Biomes / Themes
const THEMES = [
  {
    name: 'village',
    population: 150, carCount: 15, treeCount: 20, houseCount: 10, birdCount: 30,
    groundColor: '#65a30d', groundPolluted: '#3f3f2d',
    houseColors: ['#fef3c7', '#fcd34d', '#ffedd5'], roofColors: ['#991b1b', '#b45309'],
    carColors: ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#111827', '#f8fafc'],
    personColors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
    skyColor: '#87CEEB', skyPolluted: '#2a2a21',
    sunColor: '#fde047',
    houseScale: 1, treeScale: 1, carSpeed: 4
  },
  {
    name: 'city',
    population: 250, carCount: 40, treeCount: 3, houseCount: 18, birdCount: 8,
    groundColor: '#475569', groundPolluted: '#0f172a', // Asphalt / Concrete
    houseColors: ['#94a3b8', '#64748b', '#cbd5e1', '#334155'], roofColors: ['#334155', '#1e293b'], // Skyscrapers
    carColors: ['#000000', '#ffffff', '#facc15', '#facc15', '#ef4444'], // Lots of yellow cabs
    personColors: ['#000000', '#333333', '#111111', '#555555', '#cccccc', '#94a3b8'], // Monotone coats
    skyColor: '#93c5fd', skyPolluted: '#1e1b4b',
    sunColor: '#fef08a',
    houseScale: 3.5, // Tall highrises
    treeScale: 0.8, carSpeed: 6 // Fast traffic
  },
  {
    name: 'militarybase',
    population: 100, carCount: 20, treeCount: 8, houseCount: 12, birdCount: 0,
    groundColor: '#78350f', groundPolluted: '#451a03', // Mud/Dirt
    houseColors: ['#4d7c0f', '#3f6212', '#14532d'], roofColors: ['#3f6212', '#14532d', '#052e16'], // Barracks
    carColors: ['#14532d', '#166534', '#064e3b'], // Army jeeps / trucks
    personColors: ['#14532d', '#166534', '#3f6212', '#78350f', '#000000'], // Camouflage
    skyColor: '#ea580c', skyPolluted: '#451a03', // Orange/muddy sunset
    sunColor: '#fef3c7',
    houseScale: 0.6, // Low barracks
    treeScale: 1.2, carSpeed: 3
  }
];

const AudioManager = {
  ctx: null,
  _cooldowns: {},     // Per-type cooldown timestamps
  _activeCount: 0,    // Total active audio nodes
  _MAX_CONCURRENT: 12, // Hard cap on simultaneous sounds
  _noiseCache: {},    // Cache noise buffers to avoid regeneration
  // Minimum interval (seconds) between plays of the same sound type
  _COOLDOWN_MAP: {
    bomb: 0.3, nuke: 2.0, tank_fire: 0.25, plane_engine: 1.5,
    tank_engine: 1.0, gun: 0.12, scream: 0.8, kaiju_roar: 2.5,
    fire_breath: 1.5, missile_launch: 0.5
  },
  init() {
    if (!this.ctx && typeof window !== 'undefined') {
       try {
         const AudioContext = window.AudioContext || window.webkitAudioContext;
         this.ctx = new AudioContext();
       } catch(e) {}
    }
    return this.ctx;
  },
  // Cleanup when game ends
  cleanup() {
    if (this.ctx) {
      try { this.ctx.close(); } catch(e) {}
      this.ctx = null;
    }
    this._cooldowns = {};
    this._activeCount = 0;
    this._noiseCache = {};
  },
  // Cached white noise buffer
  getNoiseBuffer(ctx, duration) {
    const key = `white_${Math.round(duration * 10)}`;
    if (!this._noiseCache[key]) {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      this._noiseCache[key] = buffer;
    }
    return this._noiseCache[key];
  },
  // Cached pink noise buffer
  getPinkNoise(ctx, duration) {
    const key = `pink_${Math.round(duration * 10)}`;
    if (!this._noiseCache[key]) {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750758;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      this._noiseCache[key] = buffer;
    }
    return this._noiseCache[key];
  },
  play(type, options = {}) {
    const ctx = this.init();
    if (!ctx) return;
    // Resume suspended context (browser autoplay policy)
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch(e) {} }
    const now = performance.now();
    const t = ctx.currentTime;
    
    // --- Rate limiting: per-type cooldown ---
    const cooldown = (this._COOLDOWN_MAP[type] || 0.2) * 1000; // ms
    const lastPlayed = this._cooldowns[type] || 0;
    if (now - lastPlayed < cooldown) return; // Too soon, skip
    
    // --- Global concurrent limit ---
    if (this._activeCount >= this._MAX_CONCURRENT) return;
    
    this._cooldowns[type] = now;
    this._activeCount++;
    
    // Helper: auto-decrement active count after duration
    const scheduleRelease = (dur) => {
      setTimeout(() => { this._activeCount = Math.max(0, this._activeCount - 1); }, dur * 1000);
    };
    
    if (type === 'bomb') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 1.2);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(300, t);
      lowpass.frequency.exponentialRampToValueAtTime(40, t + 0.8);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 1.0);
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(25, t + 0.5);
      subGain.gain.setValueAtTime(0.35, t);
      subGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(t); sub.stop(t + 0.5);
      scheduleRelease(1.0);

    } else if (type === 'nuke') {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(35, t);
      sub.frequency.exponentialRampToValueAtTime(12, t + 3);
      subGain.gain.setValueAtTime(0.5, t);
      subGain.gain.exponentialRampToValueAtTime(0.01, t + 3);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(t); sub.stop(t + 3);
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 3);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(600, t);
      lowpass.frequency.exponentialRampToValueAtTime(50, t + 2.5);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.4, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 3);
      noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 3);
      scheduleRelease(3);

    } else if (type === 'tank_fire') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.3);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(1500, t);
      lowpass.frequency.exponentialRampToValueAtTime(100, t + 0.25);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.3);
      scheduleRelease(0.3);

    } else if (type === 'plane_engine') {
      const dur = options.duration || 0.4;
      const vol = options.volume || 0.04;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 70 + Math.random() * 15;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'tank_engine') {
      const dur = options.duration || 0.2;
      const vol = options.volume || 0.03;
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, dur);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'gun') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx, 0.08);
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
      noise.connect(highpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.08);
      scheduleRelease(0.08);

    } else if (type === 'scream') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.5);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(900 + Math.random() * 200, t);
      formant.frequency.linearRampToValueAtTime(500, t + 0.5);
      formant.Q.value = 6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 0.5);
      noise.connect(formant).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.5);
      scheduleRelease(0.5);

    } else if (type === 'kaiju_roar') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 1.5);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(800, t);
      lowpass.frequency.linearRampToValueAtTime(200, t + 1.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 1.5);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 1.5);
      const growl = ctx.createOscillator();
      const growlGain = ctx.createGain();
      growl.type = 'sine';
      growl.frequency.setValueAtTime(70, t);
      growl.frequency.linearRampToValueAtTime(35, t + 1.5);
      growlGain.gain.setValueAtTime(0.3, t);
      growlGain.gain.linearRampToValueAtTime(0.01, t + 1.5);
      growl.connect(growlGain).connect(ctx.destination);
      growl.start(t); growl.stop(t + 1.5);
      scheduleRelease(1.5);

    } else if (type === 'fire_breath') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.8);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(300, t);
      bandpass.frequency.linearRampToValueAtTime(1500, t + 0.3);
      bandpass.frequency.linearRampToValueAtTime(150, t + 0.8);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 0.8);
      noise.connect(bandpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.8);
      scheduleRelease(0.8);

    } else if (type === 'missile_launch') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx, 0.35);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(200, t);
      bandpass.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
      noise.connect(bandpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.35);
      scheduleRelease(0.35);
    } else {
      // Unknown type, release immediately
      this._activeCount = Math.max(0, this._activeCount - 1);
    }
  }
};

function createPerson(id, theme) {
  return {
    id, type: 'person', dead: false, state: 'idle',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    z: (Math.random() - 0.5) * WORLD_DEPTH * 0.8,
    vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 1.5,
    fleeVx: 0, fleeVz: 0,
    color: theme.personColors[Math.floor(Math.random() * theme.personColors.length)],
    scale: 0.8 + Math.random() * 0.4,
    idleTimer: Math.random() * 100, // Quick initialization
  };
}

function createCar(id, theme) {
  const isRight = Math.random() > 0.5;
  return {
    id, type: 'car', dead: false, state: 'driving',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    // Scatter cars across significantly wider horizontal bounding fields
    z: (WORLD_DEPTH * 0.4) + (Math.random() - 0.5) * 450,
    vx: (isRight ? 1 : -1) * (theme.carSpeed + Math.random() * 3), vz: 0,
    color: theme.carColors[Math.floor(Math.random() * theme.carColors.length)],
    scale: 1 + Math.random() * 0.5,
    idleTimer: 0,
  };
}

function createTree(id, theme) {
  return {
    id, type: 'tree', dead: false, state: 'idle',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    z: (Math.random() - 0.5) * WORLD_DEPTH,
    color: theme.name === 'militarybase' ? '#064e3b' : '#15803d',
    scale: theme.treeScale * (1 + Math.random() * 1.5),
  };
}

function createHouse(id, theme) {
  return {
    id, type: 'house', dead: false, state: 'idle',
    x: (Math.random() - 0.5) * WORLD_WIDTH * 0.8,
    z: (Math.random() - 0.5) * WORLD_DEPTH * 0.6,
    color: theme.houseColors[Math.floor(Math.random() * theme.houseColors.length)],
    roofColor: theme.roofColors[Math.floor(Math.random() * theme.roofColors.length)],
    scale: 1 + Math.random() * 0.5,
    // Random height multiplier based on theme
    scaleY: theme.houseScale * (1 + Math.random() * 1.5),
    rotation: Math.random() * Math.PI,
  };
}

function createBird(id, theme) {
  const isRight = Math.random() > 0.5;
  return {
    id, type: 'bird', dead: false, state: 'flying',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    y: 80 + Math.random() * 40,
    z: (Math.random() - 0.5) * WORLD_DEPTH,
    vx: (isRight ? 1 : -1) * (2 + Math.random() * 2),
    vy: (Math.random() - 0.5) * 0.5,
    vz: (Math.random() - 0.5) * 1,
    color: '#1e293b',
    scale: 0.5 + Math.random() * 0.5,
    idleTimer: 0,
  };
}

// Highly Optimized Entity Components = No React re-renders!
const EntityPerson = memo(({ index, entitiesRef }) => {
  const group = useRef();
  const mat = useRef();

  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    group.current.position.set(p.x, 5 * p.scale + (p.y || 0), p.z);
    
    if (p.state === 'fleeing') {
      mat.current.color.set('#ffaa00');
      // Frantic running animation with clear direction
      group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
      group.current.rotation.z = Math.sin(Date.now() * 0.02) * 0.4;
      group.current.rotation.x = Math.abs(Math.cos(Date.now() * 0.02)) * 0.4;
    } else {
      mat.current.color.set(p.color);
      // Normal walking animation in the direction of movement
      if (p.vx || p.vz) {
        group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
        group.current.rotation.z = Math.sin(Date.now() * 0.01) * 0.15;
        group.current.rotation.x = Math.abs(Math.cos(Date.now() * 0.01)) * 0.15;
      } else {
        group.current.rotation.set(0, 0, 0); // Stand upright
      }
    }
  });

  const p = entitiesRef.current[index];
  return (
    <group ref={group} position={[p.x, 5 * p.scale, p.z]}>
      <mesh>
        <boxGeometry args={[6 * p.scale, 10 * p.scale, 6 * p.scale]} />
        <meshLambertMaterial ref={mat} color={p.color} />
      </mesh>
      <mesh position={[0, 8 * p.scale, 0]}>
        <boxGeometry args={[4 * p.scale, 4 * p.scale, 4 * p.scale]} />
        <meshLambertMaterial color="#fcd34d" />
      </mesh>
    </group>
  );
});

const EntityCar = memo(({ index, entitiesRef }) => {
  const group = useRef();
  
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    group.current.position.set(p.x, 8 * p.scale + (p.y || 0), p.z);
    
    if (p.state === 'fleeing') {
       // Cars flip sideways chaotically
       group.current.rotation.x += 0.1;
       group.current.rotation.z += 0.2;
    } else {
       group.current.rotation.set(0, p.vx > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    }
  });

  const p = entitiesRef.current[index];
  return (
    <group ref={group} position={[p.x, 8 * p.scale, p.z]}>
      <mesh>
        <boxGeometry args={[12 * p.scale, 6 * p.scale, 24 * p.scale]} />
        <meshLambertMaterial color={p.color} />
      </mesh>
      <mesh position={[0, 5 * p.scale, -2 * p.scale]}>
        <boxGeometry args={[10 * p.scale, 4 * p.scale, 12 * p.scale]} />
        <meshLambertMaterial color="#000" />
      </mesh>
    </group>
  );
});

const EntityTank = memo(({ index, entitiesRef }) => {
  const group = useRef();
  const turret = useRef();
  const fireAnim = useRef(0);
  const soundCooldown = useRef(0);
  const turretAngle = useRef(0);
  
  useFrame((state, delta) => {
    // Force render update
    state.invalidate();
    
    const p = entitiesRef.current[index];
    if (p.dead) { 
      if (group.current) group.current.visible = false; 
      return; 
    }
    
    // Update cooldowns using refs (no re-renders)
    soundCooldown.current = Math.max(0, soundCooldown.current - delta);
    fireAnim.current = Math.max(0, fireAnim.current - delta * 5);
    
    // Tanks can still fire when broken (props) - check for broken state
    const isBroken = p.state === 'broken';
    
    let nearestKaiju = null;
    let minDist = Infinity;
    entitiesRef.current.forEach(k => {
        if (k.type === 'kaiju' && !k.dead) {
           const kd = Math.sqrt(Math.pow(k.x - p.x, 2) + Math.pow(k.z - p.z, 2));
           if (kd < minDist) { minDist = kd; nearestKaiju = k; }
        }
    });
    
    if (nearestKaiju) {
        // UNIQUE COMBAT POSITIONING: Prevent tanks from clumping up
        p.targetDist = p.targetDist || (150 + Math.random() * 150); // 150 to 300 unit engagement range
        p.orbitOffset = p.orbitOffset || ((Math.random() - 0.5) * 1.5); // Spread tanks out
        
        let angleToKaiju = Math.atan2(nearestKaiju.z - p.z, nearestKaiju.x - p.x);
        turretAngle.current = -angleToKaiju + Math.PI;
        
        // KITE AI: Maintain optimal distance
        if (!isBroken && minDist < p.targetDist - 40) {
           const revSpeed = 1.0;
           p.vx = -Math.cos(angleToKaiju + p.orbitOffset) * revSpeed;
           p.vz = -Math.sin(angleToKaiju + p.orbitOffset) * revSpeed;
        } else if (!isBroken && minDist > p.targetDist + 40) {
           const speed = 2.5;
           p.vx = Math.cos(angleToKaiju + p.orbitOffset) * speed;
           p.vz = Math.sin(angleToKaiju + p.orbitOffset) * speed;
           p.state = 'driving';
        } else {
           p.vx = 0; p.vz = 0; // Hold position
        }
        
        // REALISTIC RELOAD MECHANICS
        p.reloadTimer = Math.max(0, (p.reloadTimer || 0) - delta);
        
        if (p.reloadTimer <= 0 && minDist < p.targetDist + 80) { 
            p.reloadTimer = 1.5 + Math.random() * 1.0; // 1.5 to 2.5 seconds to reload shell
            AudioManager.play('tank_fire');
            nearestKaiju.hp -= 0.1; // Reduced damage - nuke is main damage
            if (nearestKaiju.hp <= 0) nearestKaiju.dead = true;
            
            // Spawn tank shell effect from turret tip
            const turretTipX = p.x + Math.cos(angleToKaiju) * 15;
            const turretTipZ = p.z + Math.sin(angleToKaiju) * 15;
            entitiesRef.current.push({
                id: `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'shell',
                x: turretTipX, y: 15, z: turretTipZ,
                targetX: nearestKaiju.x, targetY: nearestKaiju.y + 40, targetZ: nearestKaiju.z,
                age: 0, dead: false
            });
            // Spawn muzzle flash
            entitiesRef.current.push({
                id: `muzzleflash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'muzzle_flash',
                x: turretTipX, y: 15, z: turretTipZ,
                age: 0, dead: false
            });
            // Trigger powerful recoil animation
            fireAnim.current = 1;
        }
        
        // Tank engine rumble - only play when moving
        if ((Math.abs(p.vx) > 0 || Math.abs(p.vz) > 0) && soundCooldown.current <= 0 && Math.random() < 0.05) {
           AudioManager.play('tank_engine', { volume: 0.04, duration: 0.2 });
           soundCooldown.current = 0.6;
        }
    } else {
        // Slow down and stop if nothing to attack
        p.vx *= 0.95;
        p.vz *= 0.95;
    }
    
    // Apply movement
    if (!isBroken && (p.vx || p.vz)) {
        p.x += p.vx;
        p.z += p.vz;
        // Rotate body to face movement direction
        group.current.rotation.y = Math.atan2(p.vz, p.vx);
    }
    
    group.current.position.set(p.x, 8 * p.scale, p.z);
    
    // Turret rotation and recoil animation
    if (turret.current) {
        turret.current.rotation.y = turretAngle.current;
        turret.current.position.z = fireAnim.current * -3; // Recoil back
        turret.current.position.y = 2 + fireAnim.current * 1; // Slight jump up
    }
  });

  const p = entitiesRef.current[index];
  return (
    <group ref={group} position={[p.x, 8 * p.scale, p.z]} scale={[p.scale, p.scale, p.scale]}>
       <mesh position={[0, -2, 0]}>
          <boxGeometry args={[16, 6, 10]} />
          <meshStandardMaterial color="#166534" />
       </mesh>
       <mesh position={[0, -5, 5]}>
          <boxGeometry args={[20, 3, 3]} />
          <meshStandardMaterial color="#171717" />
       </mesh>
       <mesh position={[0, -5, -5]}>
          <boxGeometry args={[20, 3, 3]} />
          <meshStandardMaterial color="#171717" />
       </mesh>
       <group ref={turret} position={[0, 2, 0]}>
          <mesh position={[0, 0, 0]}>
             <cylinderGeometry args={[4, 4, 3, 32]} />
             <meshStandardMaterial color="#14532d" />
          </mesh>
          <mesh position={[10, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
             <cylinderGeometry args={[0.8, 0.8, 16, 16]} />
             <meshStandardMaterial color="#171717" />
          </mesh>
       </group>
    </group>
  );
});

const EntityBird = memo(({ index, entitiesRef }) => {
  const group = useRef();
  
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = p.vx > 0 ? Math.PI / 2 : -Math.PI / 2;
  });

  const p = entitiesRef.current[index];
  return (
    <group ref={group} position={[p.x, p.y, p.z]}>
      <mesh>
        <boxGeometry args={[2 * p.scale, 2 * p.scale, 6 * p.scale]} />
        <meshLambertMaterial color={p.color} />
      </mesh>
    </group>
  );
});

const EntityHouse = memo(({ index, entitiesRef }) => {
  const intact = useRef();
  const broken = useRef();

  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (p.state === 'broken') {
      intact.current.visible = false;
      broken.current.visible = true;
    } else {
      intact.current.visible = true;
      broken.current.visible = false;
    }
  });

  const p = entitiesRef.current[index];
  const houseHeight = 30 * p.scale * p.scaleY;
  
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, p.rotation, 0]}>
      <group ref={intact}>
        <mesh position={[0, houseHeight / 2, 0]}>
          <boxGeometry args={[30 * p.scale, houseHeight, 30 * p.scale]} />
          <meshLambertMaterial color={p.color} />
        </mesh>
        <mesh position={[0, houseHeight + 7.5 * p.scale, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[26 * p.scale, 15 * p.scale, 4]} />
          <meshLambertMaterial color={p.roofColor} />
        </mesh>
      </group>
      <group ref={broken} visible={false}>
        <mesh position={[0, 4 * p.scale, 0]}>
          <boxGeometry args={[30 * p.scale, 8 * p.scale, 30 * p.scale]} />
          <meshLambertMaterial color="#451a03" />
        </mesh>
        <mesh position={[5 * p.scale, 10 * p.scale, -4 * p.scale]} rotation={[0.4, 0.2, 0.8]}>
          <boxGeometry args={[10 * p.scale, 4 * p.scale, 15 * p.scale]} />
          <meshLambertMaterial color="#78350f" />
        </mesh>
      </group>
    </group>
  );
});

const EntityTree = memo(({ index, entitiesRef }) => {
  const intact = useRef();
  const broken = useRef();

  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (p.state === 'broken') {
      intact.current.visible = false;
      broken.current.visible = true;
    } else {
      intact.current.visible = true;
      broken.current.visible = false;
    }
  });

  const p = entitiesRef.current[index];
  return (
    <group position={[p.x, 0, p.z]}>
      <group ref={intact}>
        <mesh position={[0, 10 * p.scale, 0]}>
          <cylinderGeometry args={[2 * p.scale, 2.5 * p.scale, 20 * p.scale]} />
          <meshLambertMaterial color="#78350f" />
        </mesh>
        <mesh position={[0, 25 * p.scale, 0]}>
          <coneGeometry args={[14 * p.scale, 25 * p.scale, 7]} />
          <meshLambertMaterial color={p.color} />
        </mesh>
      </group>
      <group ref={broken} visible={false}>
        <mesh position={[0, 10 * p.scale, 0]}>
          <cylinderGeometry args={[2 * p.scale, 2 * p.scale, 20 * p.scale]} />
          <meshLambertMaterial color="#451a03" /> {/* scorched trunk */}
        </mesh>
      </group>
    </group>
  );
});

// Corpse - dead person/soldier remains on ground
const EntityCorpse = memo(({ index, entitiesRef }) => {
  const p = entitiesRef.current[index];
  if (!p || p.dead) return null;
  
  return (
    <group position={[p.x, 2, p.z]} rotation={[0, Math.random() * Math.PI * 2, 0]}>
      {/* Body lying down */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[3, 8, 4, 8]} />
        <meshLambertMaterial color={p.color || '#666666'} />
      </mesh>
      {/* Head */}
      <mesh position={[6, 0, 0]}>
        <sphereGeometry args={[3, 8, 8]} />
        <meshLambertMaterial color="#fcd34d" />
      </mesh>
      {/* Blood stain */}
      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5, 12]} />
        <meshBasicMaterial color="#7f1d1d" transparent opacity={0.6} />
      </mesh>
    </group>
  );
});

const EntityScorch = memo(({ index, entitiesRef }) => {
  const p = entitiesRef.current[index];
  return (
    <mesh position={[p.x, 0.2, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[p.radius, 16]} />
      <meshBasicMaterial color="#1a0a00" transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
});

const EntityMushroomCloud = memo(({ index, entitiesRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const age = useRef(0);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    age.current += delta;
    if (age.current > 4) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }
    
    const progress = Math.min(age.current / 3, 1);
    const scale = 20 + progress * 60;
    const opacity = Math.max(0, 1 - progress);
    
    if (group.current) {
        group.current.position.set(p.x, 0, p.z);
        group.current.scale.set(scale, scale, scale);
        group.current.visible = true;
    }
    
    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity * opacity;
        if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
            mat.emissiveIntensity = mat._origEmissive * opacity;
        }
    });
  });

  return (
    <group ref={group} visible={false}>
      {/* Stem */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.3, 0.8, 1.2, 8]} />
        <meshStandardMaterial 
          ref={el => { if(el){ el._origOpacity = 1; el._origEmissive = 2; materials.current.push(el); } }}
          color="#fb923c" 
          emissive="#ea580c" 
          transparent 
        />
      </mesh>
      {/* Cap */}
      <mesh position={[0, 1.2, 0]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial 
          ref={el => { if(el){ el._origOpacity = 0.8; el._origEmissive = 4; materials.current.push(el); } }}
          color="#fcd34d" 
          emissive="#f59e0b" 
          transparent 
        />
      </mesh>
    </group>
  );
});

// Kaiju attack impact effect - variant-specific attacks
const EntityKaijuAttack = ({ index, entitiesRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const meshes = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);
  const sourcePos = useRef(null);
  const attackType = useRef('fireball');
  const started = useRef(false);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    
    if (!started.current && p.x !== undefined) {
      pos.current = { x: p.x, y: p.y || 0, z: p.z };
      sourcePos.current = { x: p.sourceX || p.x, y: p.sourceY || 30, z: p.sourceZ || p.z };
      attackType.current = p.attackType || 'fireball';
      started.current = true;
    }
    
    if (started.current) {
      age.current += delta;
      if (age.current > 1.5) {
        p.dead = true;
        if (group.current) group.current.visible = false;
        return;
      }
      
      const progress = age.current / 1.5;
      const scale = 1 + progress * 5;
      const opacity = Math.max(0, 1 - progress);
      const flashIntensity = Math.max(0, 1 - progress * 1.5);
      
      if (group.current) {
          group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
          group.current.visible = true;
          if (attackType.current !== 'lightning') {
              group.current.scale.set(scale, scale, scale);
          }
      }
      
      if (attackType.current === 'lightning') {
          materials.current.forEach(mat => {
              if (mat) {
                 mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                 if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * flashIntensity;
                 }
              }
          });
          meshes.current.forEach((mesh, i) => {
              if (mesh && mesh._isSpark) {
                 const sparkProgress = progress * 30;
                 const angle = (i / 12) * Math.PI * 2;
                 const height = Math.sin(progress * Math.PI * 2 + i) * 15;
                 mesh.position.set(Math.cos(angle) * sparkProgress, height, Math.sin(angle) * sparkProgress);
              } else if (mesh && mesh._isSeg) {
                 const t = mesh._t;
                 const jitter = Math.sin(mesh._i * 7 + age.current * 20) * 8;
                 const segX = sourcePos.current.x + (pos.current.x - sourcePos.current.x) * t - pos.current.x; 
                 const segY = sourcePos.current.y + (pos.current.y - sourcePos.current.y) * t - Math.sin(t * Math.PI) * 30 - pos.current.y;
                 const segZ = sourcePos.current.z + (pos.current.z - sourcePos.current.z) * t - pos.current.z;
                 mesh.position.set(segX + jitter, segY, segZ + jitter * 0.5);
              }
          });
      } else if (attackType.current === 'ink') {
          materials.current.forEach(mat => {
              if (mat) {
                 mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                 if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * (mat._isPurple ? flashIntensity : 1);
                 }
              }
          });
          meshes.current.forEach((mesh) => {
             if (mesh && mesh._isSplatter) {
                 const dist = progress * 35;
                 const angle = mesh._angle;
                 const height = Math.sin(progress * Math.PI) * 20 + progress * 10;
                 mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
             } else if (mesh && mesh._isMist) {
                 mesh.position.set(0, 15 + progress * 10, 0);
                 const ms = 20 + progress * 10;
                 mesh.scale.set(ms/20, ms/20, ms/20);
             }
          });
      } else {
          materials.current.forEach(mat => {
              if (mat) {
                  mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                  if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * (mat._isCore ? flashIntensity : opacity);
                  }
              }
          });
          meshes.current.forEach((mesh) => {
             if (mesh && mesh._isRingInner) {
                 const outer = 10 + progress * 40;
                 mesh.scale.set(outer/10, outer/10, outer/10); 
             } else if (mesh && mesh._isRingOuter) {
                 const outer = 15 + progress * 55;
                 mesh.scale.set(outer/15, outer/15, outer/15);
             } else if (mesh && mesh._isDebris) {
                 const angle = mesh._baseAngle + progress * 0.5;
                 const dist = progress * 35;
                 const height = Math.sin(progress * Math.PI) * 20 + progress * 12;
                 mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
             } else if (mesh && mesh._isPlume) {
                 mesh.position.set(0, 8 * progress, 0);
                 const s = (8 + progress * 5)/8;
                 mesh.scale.set(s,s,s);
             } else if (mesh && mesh._isSecondarySmoke) {
                 mesh.position.set(5, 20 + progress * 15, -3);
                 const s = (8 + progress * 5)/8;
                 mesh.scale.set(s,s,s);
             }
          });
      }
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Lightning Attack */}
      {attackType.current === 'lightning' && (
        <>
          {[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((t, i) => (
            <mesh key={`seg-${i}`} ref={el => { if(el) { el._isSeg = true; el._t = t; el._i = i; meshes.current.push(el); } }}>
              <sphereGeometry args={[3 + Math.random() * 2, 8, 8]} />
              <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 1; el._origEmissive = 10; materials.current.push(el); } }} color="#00ffff" emissive="#00ffff" transparent />
            </mesh>
          ))}
          <mesh position={[0, 10, 0]}>
            <sphereGeometry args={[15, 16, 16]} />
            <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.8; el._origEmissive = 6; materials.current.push(el); } }} color="#ffffff" emissive="#00ffff" transparent />
          </mesh>
          {[...Array(12)].map((_, i) => (
            <mesh key={`spark-${i}`} ref={el => { if(el) { el._isSpark = true; meshes.current.push(el); } }}>
              <boxGeometry args={[2, 2, 2]} />
              <meshBasicMaterial ref={el => { if(el) { el._origBaseOpacity = 1; materials.current.push(el); } }} color="#00ffff" transparent />
            </mesh>
          ))}
        </>
      )}

      {/* Ink Attack */}
      {attackType.current === 'ink' && (
        <>
          <mesh position={[0, 8, 0]}>
            <sphereGeometry args={[18, 16, 16]} />
            <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.9; materials.current.push(el); } }} color="#1a0a2e" transparent />
          </mesh>
          <mesh position={[0, 10, 0]}>
            <sphereGeometry args={[12, 12, 12]} />
            <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.7; el._origEmissive = 3; el._isPurple = true; materials.current.push(el); } }} color="#7c3aed" emissive="#5b21b6" transparent />
          </mesh>
          {[...Array(16)].map((_, i) => (
            <mesh key={`ink-${i}`} ref={el => { if(el) { el._isSplatter = true; el._angle = (i / 16) * Math.PI * 2; meshes.current.push(el); } }}>
              <sphereGeometry args={[3 + Math.random() * 2, 8, 8]} />
              <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.8; el._origEmissive = 2; materials.current.push(el); } }} color="#4c1d95" emissive="#6b21a8" transparent />
            </mesh>
          ))}
          <mesh position={[0, 15, 0]} ref={el => { if(el) { el._isMist = true; meshes.current.push(el); } }}>
            <sphereGeometry args={[20, 12, 12]} />
            <meshBasicMaterial ref={el => { if(el) { el._origBaseOpacity = 0.4; materials.current.push(el); } }} color="#2d1b4e" transparent />
          </mesh>
        </>
      )}

      {/* Fireball Attack */}
      {attackType.current === 'fireball' && (
        <>
          <mesh position={[0, 10, 0]}>
            <sphereGeometry args={[8, 20, 20]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 1; el._origEmissive = 8; el._isCore = true; materials.current.push(el); } }} color="#ffffff" emissive="#ffffff" transparent />
          </mesh>
          <mesh position={[0, 8, 0]}>
            <sphereGeometry args={[14, 20, 20]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.95; el._origEmissive = 4; materials.current.push(el); } }} color="#ff8800" emissive="#ff6600" transparent />
          </mesh>
          <mesh position={[0, 6, 0]}>
            <sphereGeometry args={[20, 16, 16]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.8; el._origEmissive = 3; materials.current.push(el); } }} color="#ff4400" emissive="#ff2200" transparent />
          </mesh>
          <mesh position={[0, 4, 0]}>
            <sphereGeometry args={[25, 12, 12]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.5; materials.current.push(el); } }} color="#331111" transparent />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2, 0]} ref={el => { if (el) { el._isRingInner = true; meshes.current.push(el); } }}>
            <ringGeometry args={[5, 10, 48]} />
            <meshBasicMaterial ref={el => { if(el){ el._origBaseOpacity = 0.9; materials.current.push(el); } }} color="#ffaa00" transparent side={2} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1, 0]} ref={el => { if (el) { el._isRingOuter = true; meshes.current.push(el); } }}>
            <ringGeometry args={[10, 15, 48]} />
            <meshBasicMaterial ref={el => { if(el){ el._origBaseOpacity = 0.6; materials.current.push(el); } }} color="#ff6600" transparent side={2} />
          </mesh>
          {[...Array(16)].map((_, i) => {
             const size = 2 + Math.sin(i * 3) * 1.5;
             const colors = ['#ffcc00', '#ff8800', '#ff4400', '#ff2200'];
             return (
               <mesh key={`debris-${i}`} ref={el => { if(el){ el._isDebris = true; el._baseAngle = (i / 16) * Math.PI * 2; meshes.current.push(el); } }}>
                 <boxGeometry args={[size, size * 1.5, size]} />
                 <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 1; el._origEmissive = 3; materials.current.push(el); } }} color={colors[i % 4]} emissive={colors[i % 4]} transparent />
               </mesh>
             );
          })}
          <mesh position={[0, 8, 0]} ref={el => { if(el){ el._isPlume = true; meshes.current.push(el); } }}>
            <sphereGeometry args={[8, 12, 12]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.5; materials.current.push(el); } }} color="#222222" transparent />
          </mesh>
          <mesh position={[5, 20, -3]} ref={el => { if(el){ el._isSecondarySmoke = true; meshes.current.push(el); } }}>
            <sphereGeometry args={[8, 10, 10]} />
            <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.4; materials.current.push(el); } }} color="#333333" transparent />
          </mesh>
        </>
      )}
    </group>
  );
};

// Kaiju fire breath effect - dramatic flame
const EntityFireBreath = ({ index, entitiesRef }) => {
  const group = useRef();
  const meshes = useRef([]);
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) {
      pos.current = { x: p.x, y: p.y, z: p.z, targetX: p.targetX, targetZ: p.targetZ };
    }
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 1.2) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    if (group.current && !group.current.visible) {
       group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
       const dx = pos.current.targetX - pos.current.x;
       const dz = pos.current.targetZ - pos.current.z;
       group.current.rotation.y = -Math.atan2(dz, dx);
       group.current.visible = true;
    }

    const progress = age.current / 1.2;
    const opacity = Math.max(0, 1 - progress);
    const intensity = Math.max(0, 1 - progress * 0.3);

    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity ? mat._origOpacity * opacity : opacity;
        if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
            mat.emissiveIntensity = mat._origEmissive * intensity;
        }
    });

    meshes.current.forEach((mesh) => {
        if (!mesh) return;
        if (mesh._isCore) {
            const t = mesh._t;
            const dist = progress * 300 * t;
            const yOffset = Math.sin(t * Math.PI) * 8;
            mesh.position.set(dist, yOffset, 0);
        } else if (mesh._isTrail) {
            const i = mesh._i;
            const angle = (i / 12) * Math.PI * 2;
            const dist = progress * 180 + (Math.sin(i * 7) * 30);
            const height = Math.sin(progress * Math.PI * 3 + i) * 12;
            mesh.position.set(dist, height, Math.cos(angle) * 15);
        } else if (mesh._isSmoke) {
            mesh.position.set(progress * 150, 20 + progress * 8, 0);
            mesh.visible = age.current > 0.3;
        } else if (mesh._isGlow) {
            mesh.position.set(progress * 120, 1, 0);
            const r = 40 + progress * 25;
            mesh.scale.set(r/40, r/40, r/40);
        }
    });
  });

  return (
    <group ref={group} visible={false}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t, i) => (
        <mesh key={`core-${i}`} ref={el => { if(el) { el._isCore = true; el._t = t; meshes.current.push(el); } }}>
          <sphereGeometry args={[4 + t * 30, 14, 14]} />
          <meshStandardMaterial ref={el => { if(el) { el._origOpacity = 1 - t * 0.7; el._origEmissive = 5; materials.current.push(el); } }} 
             color={i < 2 ? '#ffffff' : i < 4 ? '#ffee00' : i < 6 ? '#ff8800' : '#ff4400'}
             emissive={i < 2 ? '#ffffff' : i < 4 ? '#ffdd00' : i < 6 ? '#ff6600' : '#ff2200'} transparent />
        </mesh>
      ))}
      {[...Array(12)].map((_, i) => (
        <mesh key={`trail-${i}`} ref={el => { if(el) { el._isTrail = true; el._i = i; meshes.current.push(el); } }}>
          <sphereGeometry args={[3 + Math.sin(i * 5) * 2, 10, 10]} />
          <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.8; el._origEmissive = 3; materials.current.push(el); } }}
             color="#ff6600" emissive="#ff4400" transparent />
        </mesh>
      ))}
      <mesh ref={el => { if(el){ el._isSmoke = true; meshes.current.push(el); } }}>
         <sphereGeometry args={[25, 12, 12]} />
         <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.4; materials.current.push(el); } }} color="#2a2a2a" transparent />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} ref={el => { if(el) { el._isGlow = true; meshes.current.push(el); } }}>
         <circleGeometry args={[40, 24]} />
         <meshBasicMaterial ref={el => { if(el){ el._origOpacity = 0.5; materials.current.push(el); } }} color="#ff6600" transparent />
      </mesh>
    </group>
  );
};

// Bullet tracer effect - small fast projectile
const EntityBullet = ({ index, entitiesRef }) => {
  const group = useRef();
  const trail = useRef();
  const age = useRef(0);
  const pos = useRef(null);
  const targetPos = useRef(null);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!targetPos.current && p.targetX !== undefined) targetPos.current = { x: p.targetX, y: p.targetY, z: p.targetZ };
    
    if (!pos.current || !targetPos.current) return;
    
    age.current += delta;
    if (age.current > 0.3) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.3;
    if (group.current) {
        group.current.position.set(
           pos.current.x + (targetPos.current.x - pos.current.x) * progress,
           pos.current.y + (targetPos.current.y - pos.current.y) * progress,
           pos.current.z + (targetPos.current.z - pos.current.z) * progress
        );
        group.current.visible = true;
    }
    if (trail.current) {
        trail.current.position.set(
           -(targetPos.current.x - pos.current.x) * progress * 0.1,
           -(targetPos.current.y - pos.current.y) * progress * 0.1,
           -(targetPos.current.z - pos.current.z) * progress * 0.1
        );
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#ffff00" />
      </mesh>
      <mesh ref={trail}>
        <sphereGeometry args={[0.5, 4, 4]} />
        <meshBasicMaterial color="#ffaa00" transparent opacity={0.6} />
      </mesh>
    </group>
  );
};

// Tank shell effect - larger projectile with trail
const EntityShell = ({ index, entitiesRef }) => {
  const group = useRef();
  const trails = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);
  const targetPos = useRef(null);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!targetPos.current && p.targetX !== undefined) targetPos.current = { x: p.targetX, y: p.targetY, z: p.targetZ };
    
    if (!pos.current || !targetPos.current) return;
    
    age.current += delta;
    if (age.current > 0.5) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.5;
    if (group.current) {
        group.current.position.set(
           pos.current.x + (targetPos.current.x - pos.current.x) * progress,
           pos.current.y + (targetPos.current.y - pos.current.y) * progress,
           pos.current.z + (targetPos.current.z - pos.current.z) * progress
        );
        group.current.visible = true;
    }
    
    trails.current.forEach((mesh, i) => {
        if (!mesh) return;
        const t = (i + 1) * 0.1;
        const factor = (progress - t) * 0.15;
        mesh.position.set(
            -(targetPos.current.x - pos.current.x) * factor,
            -(targetPos.current.y - pos.current.y) * factor,
            -(targetPos.current.z - pos.current.z) * factor
        );
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[2, 8, 8]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ff6600" emissiveIntensity={2} />
      </mesh>
      {[0.1, 0.2, 0.3].map((t, i) => (
        <mesh key={i} ref={el => trails.current[i] = el}>
          <sphereGeometry args={[1.5 - i * 0.3, 6, 6]} />
          <meshBasicMaterial color="#888888" transparent opacity={0.4 - i * 0.1} />
        </mesh>
      ))}
    </group>
  );
};

// Muzzle flash effect - quick bright flash when tank fires
const EntityMuzzleFlash = ({ index, entitiesRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 0.15) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.15;
    const scale = 1 + progress * 2;
    const opacity = 1 - progress;

    if (group.current) {
        group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
        group.current.scale.set(scale, scale, scale);
        group.current.visible = true;
    }
    
    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity * opacity;
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[3, 8, 8]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 1; materials.current.push(el); } }} color="#ffffff" transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[5, 8, 8]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 0.8; materials.current.push(el); } }} color="#ff8800" transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[7, 6, 6]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 0.5; materials.current.push(el); } }} color="#ffcc00" transparent />
      </mesh>
    </group>
  );
};

const EntityJet = ({ index, entitiesRef }) => {
  const group = useRef();
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
    // Slight roll when turning or high speed
    group.current.rotation.z = Math.sin(Date.now() * 0.01) * 0.05;
  });
  return (
    <group ref={group} scale={[0.6, 0.6, 0.6]}>
      {/* Sleek Delta Wing Body */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[4, 8, 120, 8]} />
        <meshStandardMaterial color="#4b5563" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Delta Wings */}
      <mesh position={[-20, 0, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[60, 2, 100]} />
        <meshStandardMaterial color="#374151" metalness={0.7} />
      </mesh>
      {/* Cockpit Canopy */}
      <mesh position={[40, 5, 0]}>
        <sphereGeometry args={[5, 16, 16]} scale={[2, 1, 1]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.6} metalness={0.9} />
      </mesh>
      {/* Afterburner glow */}
      <mesh position={[-65, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[4, 1, 15, 8]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
    </group>
  );
};

const EntityMissile = ({ index, entitiesRef }) => {
  const group = useRef();
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
  });
  return (
    <group ref={group}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[2, 2, 15, 8]} />
        <meshStandardMaterial color="#94a3b8" emissive="#cbd5e1" emissiveIntensity={0.5} />
      </mesh>
      {/* Fire tail */}
      <mesh position={[-10, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[2.5, 8, 8]} />
        <meshBasicMaterial color="#fb923c" />
      </mesh>
    </group>
  );
};

// Missile impact explosion - small but visible
const EntityMissileImpact = ({ index, entitiesRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 0.5) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.5;
    const scale = 1 + progress * 3;
    const opacity = 1 - progress;

    if (group.current) {
        group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
        group.current.scale.set(scale, scale, scale);
        group.current.visible = true;
    }
    
    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity * opacity;
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[4, 10, 10]} />
        <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 1; materials.current.push(el); } }} color="#ffffff" emissive="#ffffff" emissiveIntensity={5} transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[8, 8, 8]} />
        <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.7; materials.current.push(el); } }} color="#ff6600" emissive="#ff4400" emissiveIntensity={3} transparent />
      </mesh>
      <mesh position={[0, 5, 0]}>
        <sphereGeometry args={[6, 6, 6]} />
        <meshBasicMaterial ref={el => { if(el){ el._origOpacity = 0.4; materials.current.push(el); } }} color="#333333" transparent />
      </mesh>
    </group>
  );
};

const EntityPlane = ({ index, entitiesRef }) => {
  const group = useRef();
  const propRef = useRef();
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
    
    // Smooth 3D Omni-directional rotation (Model's nose is built along +X axis)
    group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
    
    // Gentle flight oscillation
    group.current.rotation.z = Math.sin(Date.now() * 0.0008) * 0.02;
    group.current.rotation.x = Math.sin(Date.now() * 0.0006) * 0.01;
    // Spin props
    if (propRef.current) propRef.current.rotation.x = Date.now() * 0.05;
  });
  return (
    <group ref={group} scale={[0.8, 0.8, 0.8]}>
      {/* === FUSELAGE === Smooth polished aluminum body */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[8, 12, 140, 12]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Belly (slightly darker underside) */}
      <mesh position={[0, -6, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[6, 10, 130, 12]} />
        <meshStandardMaterial color="#8a8a8a" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* === NOSE === Glass bombardier nose */}
      <mesh position={[75, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[8, 25, 10]} />
        <meshStandardMaterial color="#a8d8ea" metalness={0.3} roughness={0.1} transparent opacity={0.7} />
      </mesh>
      {/* Nose tip */}
      <mesh position={[90, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[3, 10, 8]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.7} roughness={0.2} />
      </mesh>

      {/* === COCKPIT === Raised glass canopy */}
      <mesh position={[50, 10, 0]}>
        <sphereGeometry args={[7, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#7dd3fc" metalness={0.2} roughness={0.1} transparent opacity={0.5} />
      </mesh>
      {/* Cockpit frame */}
      <mesh position={[50, 10, 0]}>
        <torusGeometry args={[7, 0.5, 4, 8]} />
        <meshStandardMaterial color="#71717a" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* === WINGS === Main wing spar */}
      <mesh position={[5, -1, 0]}>
        <boxGeometry args={[50, 2.5, 260]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Wing leading edge (front bevel) */}
      <mesh position={[32, -1, 0]} rotation={[0, 0, -0.1]}>
        <boxGeometry args={[6, 1.5, 250]} />
        <meshStandardMaterial color="#b8b8be" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Wing trailing edge flaps */}
      <mesh position={[-22, -2, 0]} rotation={[0, 0, 0.05]}>
        <boxGeometry args={[8, 1, 220]} />
        <meshStandardMaterial color="#909098" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* === ENGINES === 4 Radial engine nacelles */}
      {[-90, -40, 40, 90].map((z, i) => (
        <group key={i} position={[12, -8, z]}>
          {/* Nacelle housing */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[5, 5, 22, 8]} />
            <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Nacelle nose cone (intake) */}
          <mesh position={[13, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[5, 8, 8]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.7} roughness={0.2} />
          </mesh>
          {/* Spinning propeller blades */}
          <group ref={i === 0 ? propRef : undefined} position={[18, 0, 0]}>
            {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot, j) => (
              <mesh key={j} rotation={[rot, 0, 0]}>
                <boxGeometry args={[1, 16, 2.5]} />
                <meshStandardMaterial color="#27272a" metalness={0.4} roughness={0.5} />
              </mesh>
            ))}
            {/* Hub */}
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <sphereGeometry args={[2, 6, 6]} />
              <meshStandardMaterial color="#fafafa" metalness={0.8} roughness={0.1} />
            </mesh>
          </group>
        </group>
      ))}

      {/* === TAIL SECTION === */}
      {/* Tail cone / fuselage taper */}
      <mesh position={[-78, 3, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[10, 40, 10]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Vertical stabilizer (tall fin) */}
      <mesh position={[-85, 22, 0]}>
        <boxGeometry args={[25, 35, 2]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Fin top cap */}
      <mesh position={[-80, 40, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[15, 3, 2]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Horizontal stabilizers */}
      <mesh position={[-85, 8, 0]}>
        <boxGeometry args={[20, 2, 80]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.5} roughness={0.35} />
      </mesh>

      {/* === BOMB BAY DOORS === Dark underside marking */}
      <mesh position={[0, -10, 0]}>
        <boxGeometry args={[30, 1, 15]} />
        <meshStandardMaterial color="#27272a" metalness={0.3} roughness={0.6} />
      </mesh>

      {/* === MARKINGS === Olive drab military stripe */}
      <mesh position={[20, 8, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[9, 9, 5, 12]} />
        <meshStandardMaterial color="#4d7c0f" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* USAF Star (white circle on wing) */}
      <mesh position={[5, 0.5, 60]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[12, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[5, 0.5, -60]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[12, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Star inner (blue) */}
      <mesh position={[5, 0.8, 60]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7, 16]} />
        <meshBasicMaterial color="#1e3a5f" />
      </mesh>
      <mesh position={[5, 0.8, -60]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7, 16]} />
        <meshBasicMaterial color="#1e3a5f" />
      </mesh>
    </group>
  );
};

const EntityBomb = ({ index, entitiesRef }) => {
  const group = useRef();
  useFrame((state) => {
    state.invalidate();
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
    // Gentle pendulum sway under parachute
    group.current.rotation.z = Math.sin(Date.now() * 0.003) * 0.15;
    group.current.rotation.x = Math.cos(Date.now() * 0.002) * 0.1;
  });
  return (
    <group ref={group}>
      {/* "Little Boy" Casing — long dark cylinder */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[8, 8, 50, 8]} />
        <meshLambertMaterial color="#334155" />
      </mesh>
      {/* Nose cone */}
      <mesh position={[28, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[8, 15, 8]} />
        <meshLambertMaterial color="#475569" />
      </mesh>
      {/* Tail fins (4 cross fins) */}
      {[0, Math.PI/2, Math.PI, Math.PI*1.5].map((rot, i) => (
        <mesh key={i} position={[-28, 0, 0]} rotation={[rot, 0, 0]}>
          <boxGeometry args={[15, 12, 2]} />
          <meshLambertMaterial color="#1e293b" />
        </mesh>
      ))}
      {/* Yellow hazard band */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[8.5, 8.5, 8, 8]} />
        <meshLambertMaterial color="#fbbf24" />
      </mesh>
      {/* === PARACHUTE === */}
      {/* Canopy — semi-sphere above the bomb */}
      <mesh position={[0, 55, 0]}>
        <sphereGeometry args={[35, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color="#f5f5f4" transparent opacity={0.7} side={2} />
      </mesh>
      {/* Parachute lines (4 ropes) */}
      {[[-12, 0, -12], [12, 0, -12], [-12, 0, 12], [12, 0, 12]].map((anchor, i) => {
        const topY = 55;
        return (
          <mesh key={i} position={[anchor[0]/2, topY/2, anchor[2]/2]} rotation={[Math.atan2(anchor[2], topY)*0.4, 0, Math.atan2(anchor[0], topY)*0.4]}>
            <cylinderGeometry args={[0.3, 0.3, 60, 3]} />
            <meshBasicMaterial color="#a8a29e" />
          </mesh>
        );
      })}
    </group>
  );
};

const EntityBunker = ({ index, entitiesRef }) => {
  const group = useRef();
  const hpBar = useRef();
  const { camera } = useThree();

  useFrame((state) => {
    state.invalidate();
    if (hpBar.current) hpBar.current.lookAt(camera.position);
    
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
  });

  const p = entitiesRef.current[index];
  if (!p || p.dead) return null;
  const hpPercent = Math.max(0, p.hp / p.maxHp);

  return (
    <group ref={group} scale={[1.5, 1.5, 1.5]} position={[p.x, p.y, p.z]}>
      {/* === FALLOUT VAULT BUNKER REDESIGN === */}
      <group position={[0, -2, 0]}>
        {/* Concrete Housing Block */}
        <mesh position={[0, 15, 0]}>
           <boxGeometry args={[45, 30, 45]} />
           <meshStandardMaterial color="#333333" roughness={0.9} />
        </mesh>
        
        {/* Sloped Blast Shield Front */}
        <mesh position={[0, 10, 25]} rotation={[Math.PI / 4, 0, 0]}>
           <boxGeometry args={[45, 20, 10]} />
           <meshStandardMaterial color="#262626" roughness={0.9} />
        </mesh>

        {/* Huge Vault Gear Door (Iconic Fallout Style) */}
        <group position={[0, 12, 28]} rotation={[-0.1, 0, 0]}>
          {/* Main Vault door circle */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
             <cylinderGeometry args={[14, 14, 4, 32]} />
             <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Vault Door Gears (Teeth) */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
             <mesh key={i} rotation={[0, 0, (i * Math.PI) / 4]} position={[0, 0, 0]}>
                <boxGeometry args={[32, 4, 3]} />
                <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.4} />
             </mesh>
          ))}
          {/* Vault Number Background */}
          <mesh position={[0, 0, 2.1]} rotation={[0, 0, 0]}>
             <circleGeometry args={[8, 16]} />
             <meshStandardMaterial color="#fcd34d" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>

        {/* Thick concrete framing around door */}
        <mesh position={[0, 12, 26]}>
           <boxGeometry args={[38, 38, 2]} />
           <meshStandardMaterial color="#1a1a1a" roughness={1} />
        </mesh>

        {/* Red Hazard Light on top center */}
        <mesh position={[0, 31, 10]}>
           <cylinderGeometry args={[1.5, 1.5, 3]} />
           <meshStandardMaterial color="#dc2626" emissive="#ef4444" emissiveIntensity={2} />
        </mesh>
      </group>

      {/* HP Bar */}
      <group ref={hpBar} position={[0, 45, 0]}>
         <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[24, 3]} />
            <meshBasicMaterial color="#7f1d1d" />
         </mesh>
         <mesh position={[12 * (hpPercent - 1), 0, 0]}>
            <planeGeometry args={[24 * hpPercent, 3]} />
            <meshBasicMaterial color="#3b82f6" />
         </mesh>
      </group>
    </group>
  );
};

const EntityKaiju = ({ index, entitiesRef, setGameState }) => {
  const group = useRef();
  const hpBar = useRef();
  const jawRef = useRef();
  const { camera } = useThree();

  useFrame((state) => {
    // Force render update
    state.invalidate();
    
    const p = entitiesRef.current[index];
    if (p.dead) { 
       if (group.current) group.current.visible = false; 
       
       // Ensure ALL Kaijus are dead before declaring victory
       const allKaijus = entitiesRef.current.filter(e => e.type === 'kaiju');
       if (allKaijus.every(k => k.dead)) {
          if (!entitiesRef.current._victoryTriggered && setGameState) {
             entitiesRef.current._victoryTriggered = true;
             setGameState('won');
          }
       }
       return; 
    }
    
    // Kaiju passively crushes nearby entities
    entitiesRef.current.forEach(e => {
        if (e.dead || e.type === 'kaiju' || e.type === 'scorch' || e.type === 'bomb' || e.type === 'bunker') return;
        const eY = e.y || 0;
        const d3d = Math.sqrt(Math.pow(e.x - p.x, 2) + Math.pow(eY - p.y, 2) + Math.pow(e.z - p.z, 2));
        if (d3d < 200) {
            // Buildings and houses collapse into broken state
            if (e.type === 'house' || e.type === 'tree') {
                e.state = 'broken';
            }
            // Tanks become broken but still visible
            else if (e.type === 'tank') {
                e.state = 'broken';
                AudioManager.play('bomb');
            }
            // People/soldiers become corpses
            else if (e.type === 'person' || e.type === 'soldier') {
                e.dead = true;
                AudioManager.play('scream');
                // Spawn corpse
                entitiesRef.current.push({
                    id: `corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    type: 'corpse',
                    x: e.x, y: 0, z: e.z,
                    color: e.color,
                    dead: false
                });
            }
            // Cars and other entities
            else if (e.type === 'car') {
                e.state = 'broken';
            }
            else {
                e.dead = true;
            }
        }
    });

    // Occasional massive radioactive/AoE stomp blast!
    if (Math.random() < 0.005) { 
        AudioManager.play('bomb');
        // Fire breath attack effect
        if (Math.random() < 0.3) {
           AudioManager.play('fire_breath');
           // Spawn fire breath visual effect with unique ID
           const fireId = `firebreath-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
           entitiesRef.current.push({
               id: fireId, type: 'firebreath',
               x: p.x, y: p.y + 30, z: p.z + 50,
               targetX: p.x + Math.cos(p.rotation || 0) * 200,
               targetZ: p.z + Math.sin(p.rotation || 0) * 200,
               age: 0, dead: false
           });
        }
        
        entitiesRef.current.forEach(e => {
            if (e.dead || e.type === 'kaiju' || e.type === 'scorch' || e.type === 'bomb' || e.type === 'bunker') return;
            const eY = e.y || 0;
            const d3d = Math.sqrt(Math.pow(e.x - p.x, 2) + Math.pow(eY - p.y, 2) + Math.pow(e.z - p.z, 2));
            if (d3d < 600) { 
                // Buildings collapse
                if (e.type === 'house' || e.type === 'tree') {
                    e.state = 'broken';
                }
                // Tanks break
                else if (e.type === 'tank') {
                    e.state = 'broken';
                    AudioManager.play('bomb');
                }
                // People become corpses
                else if (e.type === 'person' || e.type === 'soldier') {
                    e.dead = true;
                    AudioManager.play('scream');
                    entitiesRef.current.push({
                        id: `corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        type: 'corpse',
                        x: e.x, y: 0, z: e.z,
                        color: e.color,
                        dead: false
                    });
                }
                else if (e.type === 'car') {
                    e.state = 'broken';
                }
                else {
                    e.dead = true;
                }
            }
        });
    }
    
    // Spawn airforce jets ONLY IF nukeCount > 0 (user has started interacting)
    if (Math.random() < 0.002 && (window._nukeInteractionTriggered)) {
        const jets = entitiesRef.current.filter(e => e.type === 'jet' && !e.dead);
        if (jets.length < 3) {
            const fromLeft = Math.random() > 0.5;
            const targetKaiju = p; // Current kaiju
            entitiesRef.current.push({
                id: `jet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'jet',
                x: fromLeft ? -WORLD_WIDTH/2 - 100 : WORLD_WIDTH/2 + 100,
                y: 200 + Math.random() * 100,
                z: p.z + (Math.random() - 0.5) * 200,
                vx: fromLeft ? 8 : -8,
                vz: 0,
                targetKaiju: { x: targetKaiju.x, y: targetKaiju.y, z: targetKaiju.z },
                fired: false,
                dead: false
            });
            AudioManager.play('plane_engine', { volume: 0.1, duration: 0.3 });
        }
    }

    // === SMART KAIJU AI: Prioritize military targets ===
    const tanks = entitiesRef.current.filter(e => e.type === 'tank' && !e.dead && e.state !== 'broken');
    const jets = entitiesRef.current.filter(e => e.type === 'jet' && !e.dead);
    const bunkers = entitiesRef.current.filter(e => e.type === 'bunker' && !e.dead);
    
    // Find nearest military target (tanks first priority)
    let primaryTarget = null;
    let primaryDist = Infinity;
    let targetType = null;
    
    // Priority 1: Active tanks
    tanks.forEach(t => {
       const d = Math.sqrt(Math.pow(t.x - p.x, 2) + Math.pow(t.z - p.z, 2));
       if (d < primaryDist) { primaryDist = d; primaryTarget = t; targetType = 'tank'; }
    });
    
    // Priority 2: Jets (if no tanks nearby)
    if (!primaryTarget || primaryDist > 400) {
       jets.forEach(j => {
          const d = Math.sqrt(Math.pow(j.x - p.x, 2) + Math.pow(j.z - p.z, 2));
          if (d < primaryDist) { primaryDist = d; primaryTarget = j; targetType = 'jet'; }
       });
    }
    
    // Priority 3: Bunker (only if no military nearby)
    let bunker = null;
    let bunkerDist = Infinity;
    bunkers.forEach(b => {
       const d = Math.sqrt(Math.pow(b.x - p.x, 2) + Math.pow(b.z - p.z, 2));
       if (d < bunkerDist) { bunkerDist = d; bunker = b; }
    });
    
    // If military targets exist, engage them first
    if (primaryTarget && primaryDist < 600) {
       const dx = primaryTarget.x - p.x;
       const dz = primaryTarget.z - p.z;
       
       // Move toward military target but keep distance for ranged attacks
       const idealRange = 200; // Stay at this range for ranged attacks
       
       if (primaryDist > idealRange + 50) {
          // Move closer
          const speed = p.variant === 'spider' ? 2.0 : p.variant === 'octopus' ? 1.0 : 1.5;
          p.x += (dx / primaryDist) * speed;
          p.z += (dz / primaryDist) * speed;
          group.current.rotation.y = Math.atan2(dx, dz);
          p.state = 'hunting';
       } else if (primaryDist < idealRange - 50) {
          // Back away to maintain range
          const speed = 0.8;
          p.x -= (dx / primaryDist) * speed;
          p.z -= (dz / primaryDist) * speed;
          group.current.rotation.y = Math.atan2(dx, dz);
          p.state = 'attacking';
       } else {
          // In ideal range - attack!
          p.state = 'attacking';
          group.current.rotation.y = Math.atan2(dx, dz);
          
          // Ranged attack on military
          if (Math.random() < 0.08) {
             AudioManager.play('kaiju_roar');
             
             // Spawn attack effect toward target
             const attackId = `attack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
             const attackType = p.variant === 'spider' ? 'lightning' : p.variant === 'octopus' ? 'ink' : 'fireball';
             entitiesRef.current.push({
                 id: attackId, type: 'kaiju_attack',
                 variant: p.variant,
                 attackType: attackType,
                 x: primaryTarget.x, y: primaryTarget.y || 0, z: primaryTarget.z,
                 sourceX: p.x, sourceY: p.y + 30, sourceZ: p.z,
                 age: 0, dead: false
             });
             
             // Damage target
             if (targetType === 'tank') {
                primaryTarget.state = 'broken';
                AudioManager.play('bomb');
             } else if (targetType === 'jet') {
                primaryTarget.dead = true;
             }
          }
       }
    } else if (bunker) {
       // No military nearby - approach bunker but stay outside
       const dx = bunker.x - p.x;
       const dz = bunker.z - p.z;
       const standOffRange = 150; // Stay outside this range
       
       if (bunkerDist > standOffRange + 50) {
          // Move toward bunker
          const speed = p.variant === 'spider' ? 1.5 : p.variant === 'octopus' ? 0.6 : 1.0;
          p.x += (dx / bunkerDist) * speed;
          p.z += (dz / bunkerDist) * speed;
          group.current.rotation.y = Math.atan2(dx, dz);
          p.state = 'approaching';
       } else {
          // At stand-off range - bombard bunker from distance
          p.state = 'attacking_bunker';
          group.current.rotation.y = Math.atan2(dx, dz);
          
          if (Math.random() < 0.05) {
             bunker.hp -= 25;
             AudioManager.play('kaiju_roar');
             
             const attackId = `attack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
             const attackType = p.variant === 'spider' ? 'lightning' : p.variant === 'octopus' ? 'ink' : 'fireball';
             entitiesRef.current.push({
                 id: attackId, type: 'kaiju_attack',
                 variant: p.variant,
                 attackType: attackType,
                 x: bunker.x, y: 0, z: bunker.z,
                 sourceX: p.x, sourceY: p.y + 30, sourceZ: p.z,
                 age: 0, dead: false
             });
             if (bunker.hp <= 0) bunker.dead = true;
          }
       }
    } else {
       // No targets - wander
       p.x += Math.sin(Date.now() * 0.0005) * 1.5;
       p.z += Math.cos(Date.now() * 0.0005) * 1.5;
       group.current.rotation.y = Date.now() * 0.0005;
       p.state = 'wandering';
    }
    
    group.current.position.set(p.x, p.y, p.z);
    
    // Natural breathing animation
    const breathe = Math.sin(Date.now() * 0.002) * 0.03;
    group.current.scale.set(1, 1 + breathe, 1);
    
    // Idle sway when not moving much
    const idleSway = Math.sin(Date.now() * 0.001) * 0.02;
    group.current.rotation.z = idleSway;
    group.current.rotation.x = Math.sin(Date.now() * 0.0015) * 0.015;
    
    // More dynamic movement when walking
    if (p.state !== 'attacking_bunker') {
        const walkBob = Math.sin(Date.now() * 0.008) * 0.05;
        group.current.position.y = p.y + Math.abs(walkBob) * 5;
        group.current.rotation.z = Math.sin(Date.now() * 0.006) * 0.08;
    }
    
    // Attack anticipation - lean back before striking
    if (p.state === 'attacking_bunker') {
        const attackWindup = Math.sin(Date.now() * 0.01) * 0.15;
        if (group.current) {
        group.current.position.set(p.x, 0, p.z);
        group.current.rotation.y = -p.angle + Math.PI;
        group.current.rotation.x = -0.1 + attackWindup;
    }
    }
    
    if (jawRef.current) {
       jawRef.current.rotation.x = 0.4 + Math.sin(Date.now() * 0.005) * 0.3;
    }

    if (hpBar.current) hpBar.current.lookAt(camera.position);
  });

  const p = entitiesRef.current[index];
  if (!p || p.dead) return null;
  const hpPercent = Math.max(0, p.hp / p.maxHp);

  const renderVariant = () => {
     if (p.variant === 'octopus') {
        return (
           <group position={[0, 5, 0]}>
               {/* Bulbous Head */}
               <mesh position={[0, 15, 0]}>
                   <sphereGeometry args={[12, 64, 64]} />
                   <meshStandardMaterial color="#6b21a8" roughness={0.6} />
               </mesh>
               {/* Toxic Glowing Eyes */}
               <mesh position={[8, 12, 10]}>
                   <sphereGeometry args={[3, 32, 32]} />
                   <meshStandardMaterial color="#34d399" emissive="#10b981" emissiveIntensity={3} />
               </mesh>
               <mesh position={[-8, 12, 10]}>
                   <sphereGeometry args={[3, 32, 32]} />
                   <meshStandardMaterial color="#34d399" emissive="#10b981" emissiveIntensity={3} />
               </mesh>
               {/* Wobbling Tentacles */}
               {[0, 1, 2, 3, 4, 5].map(i => {
                  const angle = (i / 6) * Math.PI * 2;
                  return (
                    <group key={i} rotation={[0, angle, 0]}>
                       <mesh position={[0, 0, 12]} rotation={[0.5, 0, 0]}>
                          <cylinderGeometry args={[2, 0.5, 25]} rotation={[Math.PI / 2, 0, 0]} />
                          <meshStandardMaterial color="#4c1d95" roughness={0.8} />
                       </mesh>
                    </group>
                  )
               })}
           </group>
        );
     } else if (p.variant === 'spider') {
        return (
           <group position={[0, 5, 0]}>
               {/* Body */}
               <mesh position={[0, 10, -5]}>
                  <sphereGeometry args={[12, 64, 64]} />
                  <meshStandardMaterial color="#020617" roughness={0.8} />
               </mesh>
               {/* Thorax */}
               <mesh position={[0, 10, 5]}>
                  <sphereGeometry args={[8, 32, 32]} />
                  <meshStandardMaterial color="#020617" roughness={0.9} />
               </mesh>
               {/* Glowing red eyes */}
               {[[-3,3], [3,3], [-5,0], [5,0], [-2,-2], [2,-2]].map((pos, i) => (
                  <mesh key={i} position={[pos[0], 12 + pos[1], 12]}>
                     <sphereGeometry args={[1.5, 32, 32]} />
                     <meshStandardMaterial color="#dc2626" emissive="#ef4444" emissiveIntensity={4} />
                  </mesh>
               ))}
               {/* Legs */}
               {[0, 1, 2, 3].map(i => {
                  return [-1, 1].map(side => (
                     <group key={`${i}-${side}`} position={[side * 8, 10, -10 + i * 5]} rotation={[0, 0, side * 0.5]}>
                        <mesh position={[side * 10, -5, 0]} rotation={[0, 0, side * -0.5]}>
                           <cylinderGeometry args={[1.5, 0.5, 25]} />
                           <meshStandardMaterial color="#0f172a" />
                        </mesh>
                     </group>
                  ));
               })}
           </group>
        );
     }
     
     // Default: Godzilla - Made more creepy and intimidating
     return (
        <group>
          {/* Torso - Hunched forward, darker */}
          <mesh position={[0, 20, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[18, 30, 22]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.95} />
          </mesh>
          
          {/* Radioactive Chest Heart - pulsing glow */}
          <mesh position={[0, 22, 11]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[10, 12, 3]} />
            <meshStandardMaterial color="#22c55e" emissive="#16a34a" emissiveIntensity={4} />
          </mesh>
          
          {/* Spikes along back */}
          {[0, 1, 2, 3, 4, 5].map(i => (
             <mesh key={i} position={[0, 35 - i * 5, -5 - i * 2]} rotation={[-0.3 - i * 0.1, 0, 0]}>
                <coneGeometry args={[2, 8 + i, 4]} />
                <meshStandardMaterial color="#0f0f0f" emissive="#1a1a1a" emissiveIntensity={1} />
             </mesh>
          ))}
          
          {/* Massive Head */}
          <group position={[0, 42, 8]}>
             {/* Upper Skull - larger, more menacing */}
             <mesh position={[0, 2, 5]}>
                <boxGeometry args={[16, 10, 18]} />
                <meshStandardMaterial color="#050505" roughness={0.9} />
             </mesh>
             {/* Animated Lower Jaw */}
             <mesh ref={jawRef} position={[0, -4, 4]} rotation={[0.4, 0, 0]}>
                <boxGeometry args={[14, 5, 15]} />
                <meshStandardMaterial color="#0a0a0a" />
             </mesh>
             {/* Teeth */}
             {[...Array(8)].map((_, i) => (
                <mesh key={i} position={[-5 + i * 1.5, -2, 10]}>
                   <coneGeometry args={[0.8, 4, 4]} />
                   <meshStandardMaterial color="#f5f5dc" />
                </mesh>
             ))}
             {/* Glowing Evil Eyes - larger, more menacing */}
             <mesh position={[5, 4, 14]}>
                <sphereGeometry args={[2, 32, 32]} />
                <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={6} />
             </mesh>
             <mesh position={[-5, 4, 14]}>
                <sphereGeometry args={[2, 32, 32]} />
                <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={6} />
             </mesh>
          </group>
          
          {/* Long Claws */}
          <mesh position={[12, 25, 8]} rotation={[-0.6, 0, -0.3]}>
             <cylinderGeometry args={[2.5, 4, 20]} />
             <meshStandardMaterial color="#0f0f0f" />
          </mesh>
          <mesh position={[-12, 25, 8]} rotation={[-0.6, 0, 0.3]}>
             <cylinderGeometry args={[2.5, 4, 20]} />
             <meshStandardMaterial color="#0f0f0f" />
          </mesh>
          {/* Claw spikes */}
          <mesh position={[14, 15, 12]} rotation={[-0.8, 0, -0.3]}>
             <coneGeometry args={[1.5, 8, 4]} />
             <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[-14, 15, 12]} rotation={[-0.8, 0, 0.3]}>
             <coneGeometry args={[1.5, 8, 4]} />
             <meshStandardMaterial color="#1a1a1a" />
          </mesh>
    
          {/* Massive Legs */}
          <mesh position={[8, 10, -3]}>
             <boxGeometry args={[8, 20, 12]} />
             <meshStandardMaterial color="#050505" />
          </mesh>
          <mesh position={[-8, 10, -3]}>
             <boxGeometry args={[8, 20, 12]} />
             <meshStandardMaterial color="#050505" />
          </mesh>
    
          {/* Heavy dragged tail - longer */}
          <group position={[0, 8, -12]} rotation={[-0.2, 0, 0]}>
             <mesh position={[0, 0, -18]}>
               <cylinderGeometry args={[6, 2.5, 35]} rotation={[Math.PI / 2, 0, 0]} />
               <meshStandardMaterial color="#0a0a0a" />
             </mesh>
             {/* Tail spikes - more */}
             {[0, 1, 2, 3, 4].map(i => (
                <mesh key={i} position={[0, 3, -25 - i * 6]} rotation={[-0.5, 0, 0]}>
                   <coneGeometry args={[2, 8, 4]} />
                   <meshStandardMaterial color="#022c22" emissive="#064e3b" emissiveIntensity={3} />
                </mesh>
             ))}
          </group>
        </group>
     );
  };

  return (
    <group ref={group} scale={[p.scale || 8, (p.scale || 8) * 1.5, p.scale || 8]}>
      {renderVariant()}

      {/* HP Bar Overlay floating directly above head, dynamically adjusting to scale */}
      <group ref={hpBar} position={[0, Math.max(30, 600 / (p.scale || 10)), 0]}>
         <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[20, 2]} />
            <meshBasicMaterial color="#7f1d1d" />
         </mesh>
         <mesh position={[10 * (hpPercent - 1), 0, 0]}>
            <planeGeometry args={[20 * hpPercent, 2]} />
            <meshBasicMaterial color="#22c55e" />
         </mesh>
      </group>
    </group>
  );
};

const MemoEntityKaijuAttack = memo(EntityKaijuAttack);
const MemoEntityFireBreath = memo(EntityFireBreath);
const MemoEntityBullet = memo(EntityBullet);
const MemoEntityShell = memo(EntityShell);
const MemoEntityMuzzleFlash = memo(EntityMuzzleFlash);
const MemoEntityJet = memo(EntityJet);
const MemoEntityMissile = memo(EntityMissile);
const MemoEntityMissileImpact = memo(EntityMissileImpact);
const MemoEntityPlane = memo(EntityPlane);
const MemoEntityBomb = memo(EntityBomb);
const MemoEntityBunker = memo(EntityBunker);
const MemoEntityKaiju = memo(EntityKaiju);

const DynamicEntitySync = memo(({ entitiesRef, setGameState }) => {
  const [, setForceRender] = useState(0);
  const lastLen = useRef(0);
  const fc = useRef(0);
  
  useFrame(() => {
     fc.current++;
     if (entitiesRef.current.length !== lastLen.current) {
        if (fc.current % 5 === 0) {
           lastLen.current = entitiesRef.current.length;
           setForceRender(n => n + 1);
        }
     } else if (fc.current % 120 === 0) {
        setForceRender(n => n + 1);
     }
  });

  return (
    <>
      {entitiesRef.current.map((p, idx) => {
        // ONLY return dynamic entities out of the main array
        if (p.type === 'plane') return <MemoEntityPlane key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bomb') return <MemoEntityBomb key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'kaiju') return <MemoEntityKaiju key={p.id} index={idx} entitiesRef={entitiesRef} setGameState={setGameState} />;
        if (p.type === 'mushroom') return <EntityMushroomCloud key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'kaiju_attack') return <MemoEntityKaijuAttack key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'firebreath') return <MemoEntityFireBreath key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bullet') return <MemoEntityBullet key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'shell') return <MemoEntityShell key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'jet') return <MemoEntityJet key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'missile') return <MemoEntityMissile key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'missile_impact') return <MemoEntityMissileImpact key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'muzzle_flash') return <MemoEntityMuzzleFlash key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'corpse') return <EntityCorpse key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'scorch') return <EntityScorch key={p.id} index={idx} entitiesRef={entitiesRef} />;
        return null;
      })}
    </>
  );
});

const VillageScene = ({ themeConfig, setNukeCount, setGameState }) => {
  const entitiesRef = useRef([]);
  const [mounted, setMounted] = useState(false);
  const { camera } = useThree();
  const shakeRef = useRef(0);
  const originalCamPos = useRef(new THREE.Vector3(0, 400, 600));

  useEffect(() => {
    if (!themeConfig) return;

    const initial = [];
    for (let i = 0; i < themeConfig.population * 2; i++) initial.push(createPerson(`p${i}`, themeConfig));
    for (let i = 0; i < themeConfig.carCount * 2; i++) initial.push(createCar(`c${i}`, themeConfig));
    for (let i = 0; i < themeConfig.houseCount * 1.5; i++) initial.push(createHouse(`h${i}`, themeConfig));
    for (let i = 0; i < themeConfig.treeCount * 1.5; i++) initial.push(createTree(`t${i}`, themeConfig));
    for (let i = 0; i < themeConfig.birdCount * 1.5; i++) initial.push(createBird(`b${i}`, themeConfig));

    // Spawn 1 to 3 Kaijus instantly at start session!
    const numKaijus = 1 + Math.floor(Math.random() * 3);
    const variants = ['godzilla', 'octopus', 'spider'];
    for (let i = 0; i < numKaijus; i++) {
       const variant = variants[Math.floor(Math.random() * variants.length)];
       const angle = Math.random() * Math.PI * 2;
       const radius = 600 + Math.random() * 200; // Closer so the cutscene cinematic works well
       initial.push({
          id: `kaiju-${Date.now()}-${i}`,
          type: 'kaiju', variant,
          x: Math.cos(angle) * radius,
          y: 0,
          z: Math.sin(angle) * radius,
          hp: 10000, maxHp: 10000,
          scale: 30, // Absolute behemoth!
          dead: false
       });
    }
    
    // Spawn military tanks from all directions when kaiju appears
    const tankDirections = [
      { x: -WORLD_WIDTH/2 - 200, z: 0, vx: 5, vz: 0 },
      { x: WORLD_WIDTH/2 + 200, z: 0, vx: -5, vz: 0 },
      { x: 0, z: -WORLD_DEPTH/2 - 200, vx: 0, vz: 5 },
      { x: 0, z: WORLD_DEPTH/2 + 200, vx: 0, vz: -5 },
      { x: -WORLD_WIDTH/2 - 150, z: -WORLD_DEPTH/2 - 150, vx: 4, vz: 4 },
      { x: WORLD_WIDTH/2 + 150, z: WORLD_DEPTH/2 + 150, vx: -4, vz: -4 },
    ];
    tankDirections.forEach((dir, i) => {
        initial.push({
            id: `tank-reinforce-${Date.now()}-${i}`,
            type: 'tank',
            x: dir.x,
            z: dir.z,
            y: 0,
            vx: dir.vx,
            vz: dir.vz,
            scale: 1.2,
            state: 'driving',
            reloadTimer: Math.random() * 3.0, // Stagger initial firing so they don't fire at once
            dead: false
        });
    });

    initial.forEach(p => {
       if (p.type === 'car') {
           p.type = 'tank';
           p.reloadTimer = Math.random() * 3.0; // Stagger initial firing
       }
       if (p.type === 'person') {
          if (Math.random() < 0.4) p.type = 'soldier';
       }
    });

    // Spawn 4 Scattered Bunkers
    const bunkerPos = [[120, 120], [-120, 120], [120, -120], [-120, -120]];
    bunkerPos.forEach((pos, i) => {
        initial.push({
           id: `bunker-${i}`, type: 'bunker',
           x: pos[0], y: 0, z: pos[1],
           hp: 1500, maxHp: 1500,
           dead: false
        });
    });

    initial._victoryTriggered = false;
    initial._defeatTriggered = false;
    entitiesRef.current = initial;
    setMounted(true);
  }, [themeConfig]);

  useEffect(() => {
    if (!themeConfig) return;

    const handleExplosion = (e) => {
      const { x: screenX, y: screenY } = e.detail;
      
      const vec = new THREE.Vector3();
      const pos = new THREE.Vector3();
      vec.set((screenX / window.innerWidth) * 2 - 1, -(screenY / window.innerHeight) * 2 + 1, 0.5);
      vec.unproject(camera);
      vec.sub(camera.position).normalize();
      const distance = -camera.position.y / vec.y;
      pos.copy(camera.position).add(vec.multiplyScalar(distance));
      setNukeCount(n => n + 1);
      shakeRef.current = 25.0;
      window._nukeInteractionTriggered = true;
      if (cutsceneTimer.current > 0) cutsceneTimer.current = 0.1; // End cutscene early on interaction
      
      const currentScorchCount = entitiesRef.current.filter(e => e.type === 'scorch').length;
      if (currentScorchCount > 20) {
        const firstScorchIdx = entitiesRef.current.findIndex(e => e.type === 'scorch');
        if (firstScorchIdx !== -1) entitiesRef.current.splice(firstScorchIdx, 1);
      }

      // Kaijus now spawn at initialization, no longer spawn during explosions
      entitiesRef.current.push({
         id: `scorch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
         type: 'scorch',
         x: pos.x, z: pos.z,
         radius: 60 + Math.random() * 60,
         dead: false
      });

      entitiesRef.current.forEach(p => {
        if (p.dead || (p.state === 'broken' && p.type !== 'tank')) return;
        // Tanks can still fire when broken (props)
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        const dy = (p.y || 0);
        const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);

        if (p.type === 'kaiju') {
           // Bomb does up to 1200 damage scaling by proximity (max damage inside 800 units)
           const damage = Math.max(0, 800 - dist) * 1.5; 
           p.hp -= damage;
           if (p.hp <= 0) p.dead = true;
           return;
        }

        if (dist < 400) { 
          if (p.type === 'house' || p.type === 'tree') { p.state = 'broken'; return; }
          if (dist < 250) { p.state = 'dead'; p.dead = true; return; }
        }
        const angle = Math.atan2(dz, dx);
        if (p.type === 'car') {
          p.state = 'fleeing'; p.vx = (p.vx > 0 ? 1 : -1) * (30 + Math.random() * 20); p.idleTimer = 300;
          p.vy = 20 + Math.random() * 30;
        } else if (p.type === 'bird') {
          p.state = 'fleeing'; p.vx = (dx < 0 ? -1 : 1) * 45; p.vy = 35; p.vz = (dz < 0 ? -1 : 1) * 35; p.idleTimer = 300;
        } else if (p.type === 'person') {
          const speed = Math.max(10.0, 35 - dist / 50);
          p.state = 'fleeing';
          p.fleeVx = Math.cos(angle) * speed + (Math.random() - 0.5) * 15;
          p.fleeVz = Math.sin(angle) * speed + (Math.random() - 0.5) * 15;
          p.vy = 15 + Math.random() * 20;
          p.idleTimer = 200 + Math.random() * 300;
        }
      });
    };

    // Separate handler for airstrike — spawns a bomber plane from ANY 360 direction
    const handleAirstrike = () => {
      const id = `plane-${Date.now()}`;
      const angle = Math.random() * Math.PI * 2; // Full 360 degree spawn angle
      const speed = 4 + Math.random() * 2.5; 
      
      // Target a random strike zone in the middle of the village
      const dropX = (Math.random() - 0.5) * (WORLD_WIDTH * 0.7);
      const dropZ = (Math.random() - 0.5) * (WORLD_DEPTH * 0.7);
      
      // Start 1500 units away along that line
      const startDist = WORLD_WIDTH * 1.5;
      const startX = dropX - Math.cos(angle) * startDist;
      const startZ = dropZ - Math.sin(angle) * startDist;
      
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      
      entitiesRef.current.push({
         id, type: 'plane', 
         x: startX, y: 350 + Math.random() * 80, z: startZ,
         vx, vz, dropped: false, 
         dropX, dropZ,
         dead: false,
         engineSoundTimer: 0
      });
      // Play plane engine sound on spawn
      AudioManager.play('plane_engine', { volume: 0.2, duration: 0.8 });
      setNukeCount(n => n + 0.0001); // Force immediate render
      window._nukeInteractionTriggered = true;
      if (cutsceneTimer.current > 0) cutsceneTimer.current = 0.1; // End cutscene early on interaction
    };

    window.addEventListener('fallout-explosion', handleExplosion);
    window.addEventListener('fallout-airstrike', handleAirstrike);
    return () => {
      window.removeEventListener('fallout-explosion', handleExplosion);
      window.removeEventListener('fallout-airstrike', handleAirstrike);
    };
  }, [themeConfig, camera, setNukeCount]);

  const gcCounter = useRef(0);
  const cutsceneTimer = useRef(5);
  const frameCount = useRef(0);
  const lastEntityCountRef = useRef(0);

  useFrame((state, delta) => {
    // Force continuous render - critical for animations
    state.invalidate();
    
    if (!themeConfig || !mounted) return;
    
    frameCount.current++;
    
    // === AUTONOMOUS CINEMATIC AIRSTRIKES ===
    // Drops bombs organically so no clicking is required!
    if (frameCount.current % 240 === 0) {
      const kaijus = entitiesRef.current.filter(e => e.type === 'kaiju' && !e.dead);
      if (kaijus.length > 0 && Math.random() < 0.6) {
          const target = kaijus[Math.floor(Math.random() * kaijus.length)];
          const angle = Math.random() * Math.PI * 2;
          const speed = 4 + Math.random() * 2.5; 
          const dropX = target.x + (Math.random() - 0.5) * 150;
          const dropZ = target.z + (Math.random() - 0.5) * 150;
          const startDist = WORLD_WIDTH * 1.5;
          entitiesRef.current.push({
             id: `plane-auto-${Date.now()}`, type: 'plane', 
             x: dropX - Math.cos(angle) * startDist, y: 350 + Math.random() * 80, z: dropZ - Math.sin(angle) * startDist,
             vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, dropped: false, 
             dropX, dropZ, dead: false, engineSoundTimer: 0
          });
          AudioManager.play('plane_engine', { volume: 0.2, duration: 0.8 });
      }
    }
    
    // Normalizing speed for high-refresh rate monitors (60fps reference)
    const ds = delta * 60;

    // === CINEMATIC CUTSCENE INTRO ===
    if (cutsceneTimer.current > 0) {
      window._cutsceneInProgress = true;
      cutsceneTimer.current -= delta;
      
      const kaiju = entitiesRef.current.find(e => e.type === 'kaiju');
      if (kaiju) {
         const progress = 1 - Math.max(0, cutsceneTimer.current / 5);
         // Ease out cubic
         const ease = 1 - Math.pow(1 - progress, 3);
         
         // Start from a dramatic high-angle focusing on the Kaiju
         const startY = 1000, startZ = 1200;
         const endY = originalCamPos.current.y, endZ = originalCamPos.current.z;
         
         const curX = kaiju.x * (1 - ease) + originalCamPos.current.x * ease;
         const curY = startY + (endY - startY) * ease;
         const curZ = kaiju.z * (1 - ease) + startZ * (1 - ease) + endZ * ease;
         
         camera.position.set(curX, curY, curZ);
         camera.lookAt(kaiju.x * (1 - ease) * 0.5, 0, kaiju.z * (1 - ease) * 0.5);
      }
    } else if (cutsceneTimer.current > -1 && shakeRef.current === 0) {
       // Snap camera completely back to rest right after cutscene ends 
       // but only do this once to not fight with the regular camera logic
       window._cutsceneInProgress = false;
       camera.position.copy(originalCamPos.current);
       camera.lookAt(0, 0, 0);
       cutsceneTimer.current = -2;
    }

    // === GARBAGE COLLECTION: Remove dead ephemeral entities every 120 frames ===
    gcCounter.current++;
    if (gcCounter.current >= 120) {
      gcCounter.current = 0;
      const ephemeralTypes = new Set(['bullet', 'shell', 'muzzle_flash', 'missile', 'missile_impact', 'corpse', 'mushroom', 'kaiju_attack', 'firebreath']);
      const before = entitiesRef.current.length;
      entitiesRef.current = entitiesRef.current.filter(e => {
        if (e.dead && ephemeralTypes.has(e.type)) return false; // Remove dead ephemeral
        return true;
      });
      // Preserve flags
      if (entitiesRef.current._victoryTriggered === undefined) entitiesRef.current._victoryTriggered = false;
      if (entitiesRef.current._defeatTriggered === undefined) entitiesRef.current._defeatTriggered = false;
    }

    if (setGameState) {
       const kaijus = entitiesRef.current.filter(e => e.type === 'kaiju');
       const bunkers = entitiesRef.current.filter(e => e.type === 'bunker');
       
       if (kaijus.length > 0) {
           const allDead = kaijus.every(k => k.dead);
           if (allDead && !entitiesRef.current._victoryTriggered) {
               entitiesRef.current._victoryTriggered = true;
               setGameState('won');
           }
           
           const allBunkersDead = bunkers.length > 0 && bunkers.every(b => b.dead);
           if (allBunkersDead && !entitiesRef.current._defeatTriggered) {
               const hasActiveDrops = entitiesRef.current.some(e => 
                  (e.type === 'bomb' && !e.dead) || 
                  (e.type === 'plane' && !e.dead && !e.dropped)
               );
               if (!hasActiveDrops) {
                  entitiesRef.current._defeatTriggered = true;
                  setGameState('lost');
               }
           }
       }
       
       // Publish stats for HUD (every ~30 frames to avoid overhead)
       if (gcCounter.current % 30 === 0) {
         window._falloutGameStats = {
           bunkers: bunkers.map(b => ({ hp: b.hp, maxHp: b.maxHp, dead: b.dead })),
           tanks: entitiesRef.current.filter(e => e.type === 'tank' && !e.dead && e.state !== 'broken').length,
           soldiers: entitiesRef.current.filter(e => e.type === 'soldier' && !e.dead).length,
           jets: entitiesRef.current.filter(e => e.type === 'jet' && !e.dead).length,
           kaijus: kaijus.map(k => ({ hp: k.hp, maxHp: k.maxHp, dead: k.dead, variant: k.variant }))
         };
       }
    }

    // Process 3D Camera Shake
    if (shakeRef.current > 0.1) {
       camera.position.x = originalCamPos.current.x + (Math.random() - 0.5) * shakeRef.current;
       camera.position.y = originalCamPos.current.y + (Math.random() - 0.5) * shakeRef.current;
       camera.position.z = originalCamPos.current.z + (Math.random() - 0.5) * shakeRef.current;
       shakeRef.current *= 0.85; // Natural decay
    } else if (shakeRef.current > 0) {
       camera.position.copy(originalCamPos.current);
       shakeRef.current = 0;
    }

     entitiesRef.current.forEach(p => {
      if (p.dead || p.type === 'tree' || p.type === 'house' || p.type === 'scorch') return;
      
      if (p.type === 'plane') {
         p.x += p.vx * ds;
         p.z += p.vz * ds;
         
         // Play engine sound periodically
         p.engineSoundTimer = (p.engineSoundTimer || 0) + 1;
         if (p.engineSoundTimer > 60) { // Every ~1 second at 60fps
            AudioManager.play('plane_engine', { volume: 0.1, duration: 0.3 });
            p.engineSoundTimer = 0;
         }
         
         // Calculate distance to drop target
         const dx = p.dropX - p.x;
         const dz = p.dropZ - p.z;
         const distToTarget = Math.sqrt(dx * dx + dz * dz);
         const prevDist = p.prevDist || Infinity;
         
         if (!p.dropped && (distToTarget < 80 || (distToTarget > prevDist && distToTarget < 300))) {
            p.dropped = true;
            entitiesRef.current.push({
               id: `bomb-${Date.now()}`, type: 'bomb',
               x: p.x, y: p.y - 10, z: p.z,
               vx: p.vx * 0.3, vy: -3, vz: p.vz * 0.3, grav: 0.5,
               dead: false
            });
            setNukeCount(n => n + 0.0001); // Force React Re-render to show bomb instantly
         }
         
         // Despawn when far away from the center (2000 units instead of just checking X)
         if (p.dropped && (Math.abs(p.x) > 2500 || Math.abs(p.z) > 2500)) p.dead = true;
         
         p.prevDist = distToTarget;
      }
      else if (p.type === 'bomb') {
         p.x += (p.vx || 0) * ds;
         p.y += (p.vy || 0) * ds;
         p.z += (p.vz || 0) * ds;
         p.vy -= (p.grav || 0.1) * ds;
         if (p.y < 0 && !p.detonated) {
           p.detonated = true;
           p.dead = true;

           // Play Nuclear Explosion Sound
           AudioManager.play('nuke');

           // Trigger 2D NuclearExplosion effect on screen
           const screenPos = new THREE.Vector3(p.x, 0, p.z).project(camera);
           const screenX = (screenPos.x + 1) * window.innerWidth / 2;
           const screenY = (-screenPos.y + 1) * window.innerHeight / 2;
           window.dispatchEvent(new CustomEvent('fallout-nuke-effect', {
             detail: { x: screenX, y: screenY }
           }));

           // Trigger conventional damage natively! (No 'fallout-explosion' event needed)
           entitiesRef.current.push({
               id: `scorch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: 'scorch',
               x: p.x, z: p.z, radius: 80, dead: false
           });

           // Spawn Mushroom Cloud effect
           entitiesRef.current.push({
               id: `mushroom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: 'mushroom',
               x: p.x, z: p.z, dead: false
           });
           
           entitiesRef.current.forEach(other => {
              if (other.dead || other.type === 'scorch' || other.type === 'plane' || other.type === 'bomb' || other.type === 'mushroom') return;
              const dist = Math.sqrt(Math.pow(other.x - p.x, 2) + Math.pow(other.z - p.z, 2));
              if (other.type === 'kaiju' || other.type === 'bunker') {
                  const damage = Math.max(0, 400 - dist) * 2.5; 
                  other.hp -= damage;
                  if (other.hp <= 0) { 
                      other.dead = true; 
                      if (other.type === 'bunker') AudioManager.play('bomb'); 
                  }
              } else if (dist < 150) {
                  if (other.type === 'house' || other.type === 'tree') other.state = 'broken';
                  else other.dead = true;
              }
           });
         }
      }
      else if (p.type === 'car') {
        p.x += p.vx * ds;
        if (p.vy !== undefined) {
           p.y = (p.y || 0) + p.vy * ds;
           p.vy -= 1.5 * ds; // Gravity
           if (p.y < 0) {
             p.y = 0; p.vy = -p.vy * 0.4; // Bounce
             if (Math.abs(p.vy) < 2) p.vy = undefined;
           }
        }
        if (p.state === 'fleeing') {
          if (p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2) p.dead = true;
        } else {
          if (p.x < -WORLD_WIDTH/2 - 100) p.x = WORLD_WIDTH/2 + 100;
          if (p.x > WORLD_WIDTH/2 + 100) p.x = -WORLD_WIDTH/2 - 100;
        }
      } 
      else if (p.type === 'bird') {
        p.x += p.vx * ds; p.y += p.vy * ds; p.z += p.vz * ds;
        if (p.state === 'fleeing') {
          if (p.y > 500 || p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2) p.dead = true;
        } else {
          if (Math.random() < 0.02) p.vy = (Math.random() - 0.5) * 2;
          else p.vy *= 0.95;
          if (p.x < -WORLD_WIDTH/2 - 50) p.x = WORLD_WIDTH/2 + 50;
          if (p.x > WORLD_WIDTH/2 + 50) p.x = -WORLD_WIDTH/2 - 50;
          if (p.z < -WORLD_DEPTH/2 - 50) p.z = WORLD_DEPTH/2 + 50;
          if (p.z > WORLD_DEPTH/2 + 50) p.z = -WORLD_DEPTH/2 - 50;
          if (p.y < 40) { p.y = 40; p.vy = Math.abs(p.vy); }
          if (p.y > 150) { p.y = 150; p.vy = -Math.abs(p.vy); }
        }
      } 
      else if (p.type === 'person') {
         const bunkers = entitiesRef.current.filter(e => e.type === 'bunker' && !e.dead);
         if (bunkers.length > 0) {
             let nearestBunker = bunkers[0];
             let minDist = Infinity;
             bunkers.forEach(b => {
                 const kd = Math.sqrt(Math.pow(b.x - p.x, 2) + Math.pow(b.z - p.z, 2));
                 if (kd < minDist) { minDist = kd; nearestBunker = b; }
             });
             
             if (minDist < 30) {
                 p.dead = true; // Hidden inside safely
             } else {
                 p.state = 'fleeing';
                 const aAngle = Math.atan2(nearestBunker.z - p.z, nearestBunker.x - p.x);
                 p.x += Math.cos(aAngle) * 3.5 * ds;
                 p.z += Math.sin(aAngle) * 3.5 * ds;
             }
         } else {
             p.state = 'fleeing';
             p.x += (Math.random() - 0.5) * 6 * ds;
             p.z += (Math.random() - 0.5) * 6 * ds;
             if (Math.random() < 0.005) AudioManager.play('scream');
         }
      }
      else if (p.type === 'soldier') {
         let nearestKaiju = null;
         let minDist = Infinity;
         entitiesRef.current.forEach(k => {
            if (k.type === 'kaiju' && !k.dead) {
               const kd = Math.sqrt(Math.pow(k.x - p.x, 2) + Math.pow(k.z - p.z, 2));
               if (kd < minDist) { minDist = kd; nearestKaiju = k; }
            }
         });

         if (nearestKaiju && minDist < 300) {
            const dx = nearestKaiju.x - p.x;
            const dz = nearestKaiju.z - p.z;
            const aAngle = Math.atan2(dz, dx);

            if (minDist < 100) {
               p.state = 'attacking_kaiju';
               // Shoot tiny lasers with visual effect
               if (Math.random() < 0.08) {
                   AudioManager.play('gun');
                   nearestKaiju.hp -= 0.02; // Reduced damage - nuke is main damage
                   if (nearestKaiju.hp <= 0) nearestKaiju.dead = true;
                   // Spawn bullet tracer effect
                   entitiesRef.current.push({
                       id: `bullet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                       type: 'bullet',
                       x: p.x, y: 10, z: p.z,
                       targetX: nearestKaiju.x, targetY: nearestKaiju.y + 30, targetZ: nearestKaiju.z,
                       age: 0, dead: false
                   });
               }
               // Stand ground and turn 
               p.color = '#14532d';
               p.vx = 0; p.vz = 0;
            } else {
               p.color = '#166534';
               p.x += Math.cos(aAngle) * 3.5 * ds;
               p.z += Math.sin(aAngle) * 3.5 * ds;
               p.state = 'fleeing'; 
            }
         } else if (p.state === 'fleeing') {
          p.x += p.fleeVx * ds;
          p.z += p.fleeVz * ds;
          p.fleeVx *= 0.99; p.fleeVz *= 0.99;
          
          if (p.vy !== undefined) {
             p.y = (p.y || 0) + p.vy * ds;
             p.vy -= 1.0 * ds; // Gravity
             if (p.y < 0) { 
               p.y = 0; p.vy = -p.vy * 0.5; // Bounce
               if (Math.abs(p.vy) < 2) p.vy = undefined;
             }
          }
          
          p.idleTimer--;
          
          if (p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2 || p.z < -WORLD_DEPTH/2 || p.z > WORLD_DEPTH/2) {
             p.dead = true;
             return;
          }
          if (p.idleTimer <= 0 || (Math.abs(p.fleeVx) < 0.5 && Math.abs(p.fleeVz) < 0.5)) {
            p.state = 'idle';
            p.vx = (Math.random() - 0.5) * 1; p.vz = (Math.random() - 0.5) * 1;
            p.idleTimer = 100 + Math.random() * 200;
          }
        } else if (p.state === 'walking') {
          p.x += p.vx * ds; p.z += p.vz * ds;
          p.idleTimer--;
          if (p.idleTimer <= 0) { p.state = 'idle'; p.idleTimer = 20 + Math.random() * 60; /* Stand briefly */ }
        } else {
          p.idleTimer--;
          if (p.idleTimer <= 0) {
            p.state = 'walking';
            p.vx = (Math.random() - 0.5) * 2; p.vz = (Math.random() - 0.5) * 1.5;
            p.idleTimer = 150 + Math.random() * 300; // Walk for a long time
          }
        }

        if (p.state !== 'fleeing') {
          if (p.x < -WORLD_WIDTH/2) { p.x = -WORLD_WIDTH/2; p.vx = Math.abs(p.vx); }
          if (p.x > WORLD_WIDTH/2) { p.x = WORLD_WIDTH/2; p.vx = -Math.abs(p.vx); }
          if (p.z < -WORLD_DEPTH/2) { p.z = -WORLD_DEPTH/2; p.vz = Math.abs(p.vz); }
          if (p.z > WORLD_DEPTH/2) { p.z = WORLD_DEPTH/2; p.vz = -Math.abs(p.vz); }
        }
      }
      else if (p.type === 'jet') {
         // Fighter Jet AI - Circle around target until missile fired, then peel out
         p.flightAge = (p.flightAge || 0) + 0.05 * ds;
         
         if (!p.fired) {
            // Seek toward kaiju with sweeping arcs
            const dx = p.targetKaiju.x - p.x;
            const dz = p.targetKaiju.z - p.z;
            const angleToTarget = Math.atan2(dz, dx);
            const currentAngle = Math.atan2(p.vz, p.vx);
            
            // Steer toward target gently
            let diff = angleToTarget - currentAngle;
            // Normalize angle diff
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            const newAngle = currentAngle + diff * 0.03 * ds;
            const speed = 12; // High speed
            
            p.vx = Math.cos(newAngle) * speed;
            p.vz = Math.sin(newAngle) * speed;
            
            p.x += p.vx * ds;
            p.z += p.vz * ds;
            
            // Add vertical swoop
            p.y = 200 + Math.sin(p.flightAge) * 100;
            
            // Fire missile when aligned and close enough
            if (Math.abs(diff) < 0.2 && Math.sqrt(dx*dx + dz*dz) < 400) {
                p.fired = true;
                entitiesRef.current.push({
                   id: `missile-${Date.now()}-${Math.random()}`,
                   type: 'missile',
                   x: p.x, y: p.y - 10, z: p.z,
                   targetX: p.targetKaiju.x, 
                   targetY: p.targetKaiju.y + 40,
                   targetZ: p.targetKaiju.z,
                   dead: false
                });
                AudioManager.play('missile_launch');
            }
         } else {
            // Fired! Pull up and peel away sharply
            p.vx *= 1.02; // Accelerate away
            p.vz *= 1.02;
            p.y += 5 * ds; // Climb fast
            p.x += p.vx * ds;
            p.z += p.vz * ds;
         }
         
         if (p.fired && (Math.abs(p.x) > 3000 || Math.abs(p.z) > 3000 || p.y > 1000)) p.dead = true;
         // Safety despawn
         if (!p.fired && p.flightAge > 30) p.dead = true;
      }
      else if (p.type === 'missile') {
         const dx = p.targetX - p.x;
         const dy = p.targetY - p.y;
         const dz = p.targetZ - p.z;
         const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
         const prevDist = p.prevDist || Infinity;
         
         if (dist < 30 || (dist > prevDist && dist < 150)) {
            p.dead = true;
            entitiesRef.current.push({
               id: `missile-impact-${Date.now()}`,
               type: 'missile_impact',
               x: p.targetX, y: p.targetY, z: p.targetZ,
               dead: false
            });
            
            // Damage Kaiju
            const kaijus = entitiesRef.current.filter(e => e.type === 'kaiju' && !e.dead);
            kaijus.forEach(k => {
               const kd = Math.sqrt(Math.pow(k.x - p.targetX, 2) + Math.pow(k.z - p.targetZ, 2));
               if (kd < 150) {
                  k.hp -= 40;
                  if (k.hp <= 0) k.dead = true;
               }
            });
            AudioManager.play('bomb');
         } else {
            const speed = 14;
            p.x += (dx / dist) * speed * ds;
            p.y += (dy / dist) * speed * ds;
            p.z += (dz / dist) * speed * ds;
         }
         p.prevDist = dist;
      }
    });
  });

  if (!mounted) return null;

  return (
    <>
      <DynamicEntitySync entitiesRef={entitiesRef} setGameState={setGameState} />
      {/* PERFECT STATIC RENDER: Only runs once on mount! Everything moves natively via WebGL updates, saving 1500 React node reconciliations! */}
      {entitiesRef.current.map((p, idx) => {
        if (p.type === 'person' || p.type === 'soldier') return <EntityPerson key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'car') return <EntityCar key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'tank') return <EntityTank key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bird') return <EntityBird key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'house') return <EntityHouse key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'tree') return <EntityTree key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bunker') return <MemoEntityBunker key={p.id} index={idx} entitiesRef={entitiesRef} />;
        return null;
      })}
    </>
  );
};

// === GAME HUD: Shows bunker HP, military counts, tips ===
const GameHUD = () => {
  const [stats, setStats] = useState({ bunkers: [], tanks: 0, soldiers: 0, jets: 0, kaijus: [] });
  
  useEffect(() => {
    const interval = setInterval(() => {
      // Read from window-level shared state (set by VillageScene)
      if (window._falloutGameStats) {
        setStats({ ...window._falloutGameStats });
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute top-4 left-4 z-30 pointer-events-none select-none" style={{ fontFamily: "'Courier New', monospace" }}>
      {/* Bunker Status */}
      <div style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '12px 16px',
        marginBottom: '8px',
        minWidth: '220px'
      }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', letterSpacing: '2px', marginBottom: '8px', fontWeight: 700 }}>
          🏰 BUNKERS
        </div>
        {stats.bunkers.map((b, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: b.hp <= 0 ? '#ef4444' : '#e2e8f0', marginBottom: '2px' }}>
              <span>{b.hp <= 0 ? '💀' : '🛡️'} Bunker {i + 1}</span>
              <span>{b.hp <= 0 ? 'DESTROYED' : `${Math.round(b.hp)}/${b.maxHp}`}</span>
            </div>
            <div style={{ height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(0, (b.hp / b.maxHp) * 100)}%`,
                height: '100%',
                background: b.hp / b.maxHp > 0.5 ? '#22c55e' : b.hp / b.maxHp > 0.2 ? '#eab308' : '#ef4444',
                borderRadius: '2px',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Military Units */}
      <div style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '12px 16px',
        marginBottom: '8px',
        minWidth: '220px'
      }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', letterSpacing: '2px', marginBottom: '6px', fontWeight: 700 }}>
          ⚔️ MILITARY
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#e2e8f0' }}>
          <span>🪖 ×{stats.soldiers}</span>
          <span>🚜 ×{stats.tanks}</span>
          <span>✈️ ×{stats.jets}</span>
        </div>
      </div>

      {/* Kaiju Status */}
      {stats.kaijus.length > 0 && (
        <div style={{
          background: 'rgba(80,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,80,80,0.2)',
          borderRadius: '12px',
          padding: '12px 16px',
          minWidth: '220px'
        }}>
          <div style={{ fontSize: '11px', color: '#fca5a5', letterSpacing: '2px', marginBottom: '6px', fontWeight: 700 }}>
            🦎 KAIJU THREAT
          </div>
          {stats.kaijus.map((k, i) => (
            <div key={i} style={{ marginBottom: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: k.dead ? '#666' : '#fca5a5', marginBottom: '2px' }}>
                <span>{k.dead ? '💀' : '👹'} {k.variant}</span>
                <span>{k.dead ? 'DEAD' : `${Math.round(k.hp)}/${k.maxHp}`}</span>
              </div>
              {!k.dead && (
                <div style={{ height: '4px', background: '#450a0a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(0, (k.hp / k.maxHp) * 100)}%`,
                    height: '100%',
                    background: '#ef4444',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function FalloutPeople({ theme, isIdleMode }) {
  const isFallout = (theme === 'retro' || theme === 'fallout') && isIdleMode;
  
  const [nukeCount, setNukeCount] = useState(0);
  const [activeTheme, setActiveTheme] = useState(null);
  const [gameState, setGameState] = useState('playing'); // 'playing', 'won', 'lost'
  const [nukeEffects, setNukeEffects] = useState([]); // 2D nuclear explosion effects
  const nukeIdRef = useRef(0);

  useEffect(() => {
    if (isFallout) {
      setNukeCount(0);
      setGameState('playing');
      window._nukeInteractionTriggered = false;
      setActiveTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
    } else {
      setActiveTheme(null);
      // Cleanup audio context and cached noise buffers when game ends
      AudioManager.cleanup();
      window._falloutGameStats = null;
    }
    return () => {
      AudioManager.cleanup();
      window._falloutGameStats = null;
    };
  }, [isFallout]);

  // Listen for 2D nuclear explosion effects
  useEffect(() => {
    if (!isFallout) return;
    
    const handleNukeEffect = (e) => {
      const { x, y } = e.detail;
      const id = nukeIdRef.current++;
      setNukeEffects(prev => [...prev, { id, x, y }]);
    };
    
    window.addEventListener('fallout-nuke-effect', handleNukeEffect);
    return () => {
      window.removeEventListener('fallout-nuke-effect', handleNukeEffect);
    };
  }, [isFallout]);

  const removeNukeEffect = (id) => {
    setNukeEffects(prev => prev.filter(n => n.id !== id));
  };

  const VICTORY_MESSAGES = [
     "YOU SAVED HUMANITY... But at what cost?",
     "THE BEAST IS DEAD. The city is glowing.",
     "KAIJU ELIMINATED! Enjoy the nuclear winter.",
     "Mankind prevails! (Hope you like radiation.)",
     "Target destroyed. We are the real monsters.",
  ];
  
  const DEFEAT_MESSAGES = [
     "THE KAIJU HAS DESTROYED THE CITY.",
     "HUMANITY HAS FALLEN.",
     "GAME OVER. The beast consumes all.",
     "Our weapons were useless.",
     "The monster reached Ground Zero. We are doomed.",
  ];
  
  // Use useMemo to pick a random message when game state changes to prevent flickering
  const endMessage = useMemo(() => {
     if (gameState === 'won') return VICTORY_MESSAGES[Math.floor(Math.random() * VICTORY_MESSAGES.length)];
     if (gameState === 'lost') return DEFEAT_MESSAGES[Math.floor(Math.random() * DEFEAT_MESSAGES.length)];
     return '';
  }, [gameState]);

  if (!activeTheme) return null;

  // Progressive Apocalypse Scale (0 = peaceful, 1 = total nuclear winter)
  // Takes 10 massive bombs to completely blot out the sun!
  const pollution = Math.min(nukeCount * 0.1, 1);
  
  // Sky transitions: blue → amber → bright red → dark red
  const skyStages = pollution < 0.3 
    ? new THREE.Color(activeTheme.skyColor).lerp(new THREE.Color('#d97706'), pollution / 0.3)
    : pollution < 0.6
    ? new THREE.Color('#d97706').lerp(new THREE.Color('#991b1b'), (pollution - 0.3) / 0.3)
    : new THREE.Color('#991b1b').lerp(new THREE.Color('#450a0a'), (pollution - 0.6) / 0.4);
  const bgColor = skyStages.getStyle();
  
  // Ground: green → brown → warm dark gray
  const groundColor = new THREE.Color(activeTheme.groundColor)
    .lerp(new THREE.Color(activeTheme.groundPolluted), Math.min(pollution * 2, 1))
    .lerp(new THREE.Color('#1c1917'), Math.max(0, (pollution - 0.5) * 2))
    .getStyle();
  
  // Sun: yellow → blood red, sinks toward horizon
  const sunColor = new THREE.Color(activeTheme.sunColor)
    .lerp(new THREE.Color('#dc2626'), pollution)
    .lerp(new THREE.Color('#7f1d1d'), Math.max(0, pollution - 0.7) * 3);
  const sunY = Math.max(0, 400 * (1 - pollution * 1.5));
  const sunSize = 300 * (1 + pollution * 0.8);
  
  // Fog: slightly transparent so we can still see things
  const fogColor = new THREE.Color(bgColor);
  const fogNear = 1200 - pollution * 600;
  const fogFar = 3000 - pollution * 1000;
  
  // Ambient darkening (don't go pitch black, maintain visibility)
  const ambientIntensity = Math.max(0.4, 0.9 - pollution * 0.5);
  const directionalIntensity = Math.max(0.25, 1.0 - pollution * 0.75);

  return (
    <div className="fixed inset-0 z-[5]" style={{ overflow: 'hidden' }}>
      {/* 2D Nuclear Explosion Effects */}
      {nukeEffects.map(nuke => (
        <NuclearExplosion 
          key={nuke.id} 
          id={nuke.id} 
          x={nuke.x} 
          y={nuke.y} 
          onComplete={() => removeNukeEffect(nuke.id)} 
        />
      ))}
      {/* Apocalyptic screen overlay (progressive vignette + color grading) */}
      {pollution > 0.1 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${pollution * 0.4}) 100%)`,
            mixBlendMode: 'multiply',
          }}
        />
      )}
      {/* Radioactive dust / ash overlay */}
      {pollution > 0.3 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `linear-gradient(transparent, rgba(120, 53, 15, ${pollution * 0.15}))`,
            animation: 'fallout-ash-drift 8s linear infinite',
          }}
        />
      )}
      
      <Canvas 
         frameloop="always"
         shadows={false} 
         dpr={0.5}
         gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
         camera={{ position: [0, 400, 600], fov: 60, rotation: [-Math.PI / 8, 0, 0], far: 3000 }}
      >
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
        <ambientLight intensity={ambientIntensity} color={pollution > 0.5 ? '#ff6b35' : '#ffffff'} />
        <directionalLight 
          position={[200, 500, 200]} 
          intensity={directionalIntensity}
          color={pollution > 0.3 ? '#ff8c42' : '#ffffff'}
        />
        
        {/* Sun — bloats and sinks as apocalypse progresses */}
        <mesh position={[100, sunY, -1200]} rotation={[0, 0, 0]}>
           <circleGeometry args={[sunSize, 32]} />
           <meshBasicMaterial color={sunColor} fog={false} />
        </mesh>
        {/* Sun glow halo (intensifies during apocalypse) */}
        {pollution > 0.2 && (
          <mesh position={[100, sunY, -1210]}>
            <circleGeometry args={[sunSize * 1.8, 32]} />
            <meshBasicMaterial color={sunColor} fog={false} transparent opacity={0.15 + pollution * 0.2} />
          </mesh>
        )}
        
        <VillageScene themeConfig={activeTheme} setNukeCount={setNukeCount} setGameState={setGameState} />

        {/* Fallout Rain / Ash Particles (3D) — spawn after first nuke */}
        {pollution > 0.1 && Array.from({ length: Math.floor(pollution * 20) }, (_, i) => (
          <FalloutAshParticle key={`ash-${i}`} index={i} pollution={pollution} />
        ))}
        
        {/* Ground */}
        <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[WORLD_WIDTH * 2, WORLD_DEPTH * 2]} />
          <meshLambertMaterial color={groundColor} />
        </mesh>
      </Canvas>

      {/* === GAME HUD === */}
      {gameState === 'playing' && (
        <GameHUD />
      )}

      {/* Game Over / Victory Overlay */}
      {gameState !== 'playing' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
           <div className="text-center p-12 border border-[var(--text-primary)]/20 shadow-2xl bg-black/50 rounded-2xl max-w-2xl">
              <h1 className={`text-6xl font-black mb-6 tracking-widest uppercase ${gameState === 'won' ? 'text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]' : 'text-red-600 drop-shadow-[0_0_20px_rgba(220,38,38,0.6)]'}`}>
                 {gameState === 'won' ? 'VICTORY' : 'GAME OVER'}
              </h1>
              <p className="text-2xl text-white font-mono uppercase leading-relaxed font-semibold">
                 {endMessage}
              </p>
              <p className="mt-12 text-sm text-[var(--text-secondary)]/70 font-mono animate-pulse uppercase">Toggle Wasteland off and on to play again.</p>
           </div>
        </div>
      )}
    </div>
  );
}

// Falling ash / radioactive debris particles in the 3D sky
const FalloutAshParticle = ({ index, pollution }) => {
  const ref = useRef();
  const speed = useRef(0.5 + Math.random() * 1.5);
  const startX = useRef((Math.random() - 0.5) * WORLD_WIDTH * 2);
  const startZ = useRef((Math.random() - 0.5) * WORLD_DEPTH * 2);
  const drift = useRef((Math.random() - 0.5) * 0.5);
  
  useFrame((state) => {
    state.invalidate();
    if (!ref.current) return;
    ref.current.position.y -= speed.current;
    ref.current.position.x += drift.current;
    ref.current.rotation.x += 0.02;
    ref.current.rotation.z += 0.01;
    // Reset when below ground
    if (ref.current.position.y < -10) {
      ref.current.position.y = 350 + Math.random() * 100;
      ref.current.position.x = startX.current + (Math.random() - 0.5) * 200;
      ref.current.position.z = startZ.current + (Math.random() - 0.5) * 200;
    }
  });
  
  const size = 2 + Math.random() * 4;
  const shade = pollution > 0.6 ? '#292524' : '#78716c';
  
  return (
    <mesh 
      ref={ref} 
      position={[startX.current, 200 + Math.random() * 200, startZ.current]}
    >
      <boxGeometry args={[size, size * 0.3, size * 0.8]} />
      <meshBasicMaterial color={shade} transparent opacity={0.4 + pollution * 0.3} />
    </mesh>
  );
};
