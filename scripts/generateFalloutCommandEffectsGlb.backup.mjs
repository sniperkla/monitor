import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { installPolyfills, textures, autoMap } from './falloutTextureUtils.mjs';

class NodeFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onloadend = null;
    this.onerror = null;
  }

  #finish(callback) {
    setTimeout(() => {
      if (callback) callback({ target: this });
    }, 0);
  }

  readAsArrayBuffer(blob) {
    blob.arrayBuffer()
      .then((result) => {
        this.result = result;
        this.#finish(this.onloadend);
      })
      .catch((error) => {
        this.error = error;
        this.#finish(this.onerror);
      });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer()
      .then((result) => {
        const base64 = Buffer.from(result).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        this.#finish(this.onloadend);
      })
      .catch((error) => {
        this.error = error;
        this.#finish(this.onerror);
      });
  }
}

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = NodeFileReader;
}
installPolyfills();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'fallout');
const outPath = path.join(outDir, 'command_effects.glb');

const mat = ({
  color,
  emissive = color,
  emissiveIntensity = 1.0,
  opacity = 1,
  roughness = 0.38,
  metalness = 0.08,
  side,
  map,
}) => {
  const m = new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity, roughness, metalness,
    transparent: opacity < 1, opacity,
    depthWrite: opacity >= 0.98,
    ...(side !== undefined ? { side } : {})
  });
  const tex = map !== undefined ? map
    : (opacity >= 0.95 && emissiveIntensity <= 0.4)
      ? autoMap(color) : null;
  if (tex) m.map = tex;
  return m;
};

// ─── ORBITAL LANCE (ION beam from orbit) ─────────────────────────────────────
const makeOrbitalLance = () => {
  const root = new THREE.Group();
  root.name = 'support_orbital_lance';

  // ── NAMED NODES (driven by animation code) ──

  // Outer plasma sheath – wide, hazy, translucent blue glow
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 22, 290, 24, 4, true),
    mat({ color: '#1e3a5f', emissive: '#0ea5e9', emissiveIntensity: 2.2, opacity: 0.28, roughness: 0.12 })
  );
  beam.name = 'support_orbital_lance_beam';
  beam.position.y = 145;
  root.add(beam);

  // White-hot impact core – compressed oblate sphere at ground zero
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(20, 22, 16),
    mat({ color: '#f0f9ff', emissive: '#e0f2fe', emissiveIntensity: 3.8, opacity: 0.88, roughness: 0.04 })
  );
  core.name = 'support_orbital_lance_core';
  core.position.y = 12;
  core.scale.set(1.1, 0.42, 1.1);
  root.add(core);

  // Inner rotating energy ring — tight, bright, crackling
  const ringInner = new THREE.Mesh(
    new THREE.TorusGeometry(32, 3.2, 14, 52),
    mat({ color: '#38bdf8', emissive: '#7dd3fc', emissiveIntensity: 3.2, opacity: 0.72, roughness: 0.08 })
  );
  ringInner.name = 'support_orbital_lance_ring_inner';
  ringInner.rotation.x = Math.PI / 2;
  ringInner.position.y = 3;
  root.add(ringInner);

  // Outer pressure ring — expanding shockwave disc
  const ringOuter = new THREE.Mesh(
    new THREE.TorusGeometry(68, 6.5, 12, 64),
    mat({ color: '#0284c7', emissive: '#38bdf8', emissiveIntensity: 1.8, opacity: 0.34, roughness: 0.18 })
  );
  ringOuter.name = 'support_orbital_lance_ring_outer';
  ringOuter.rotation.x = Math.PI / 2;
  ringOuter.position.y = 1.5;
  root.add(ringOuter);

  // Atmospheric entry lens flare — where beam pierces sky
  const flareTop = new THREE.Mesh(
    new THREE.SphereGeometry(28, 18, 12),
    mat({ color: '#f0f9ff', emissive: '#bae6fd', emissiveIntensity: 2.8, opacity: 0.52, roughness: 0.06 })
  );
  flareTop.name = 'support_orbital_lance_flare_top';
  flareTop.position.y = 278;
  flareTop.scale.set(2.4, 0.28, 2.4);
  root.add(flareTop);

  // Superheated ground splash disc — molten ejecta ring at base
  const flareBase = new THREE.Mesh(
    new THREE.TorusGeometry(24, 5.5, 12, 36),
    mat({ color: '#7dd3fc', emissive: '#0ea5e9', emissiveIntensity: 2.6, opacity: 0.58, roughness: 0.1 })
  );
  flareBase.name = 'support_orbital_lance_flare_base';
  flareBase.rotation.x = Math.PI / 2;
  flareBase.position.y = 6;
  root.add(flareBase);

  // Plasma ejecta crown — inverted funnel of vaporised material
  const impact = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 48, 52, 22, 2, true),
    mat({ color: '#bae6fd', emissive: '#0ea5e9', emissiveIntensity: 2.2, opacity: 0.52, roughness: 0.08 })
  );
  impact.name = 'support_orbital_lance_impact';
  impact.position.y = 22;
  root.add(impact);

  // Far-field blast shockwave ring
  const shock = new THREE.Mesh(
    new THREE.TorusGeometry(110, 8, 12, 72),
    mat({ color: '#e0f2fe', emissive: '#7dd3fc', emissiveIntensity: 1.4, opacity: 0.24, roughness: 0.22 })
  );
  shock.name = 'support_orbital_lance_shock';
  shock.rotation.x = Math.PI / 2;
  shock.position.y = 1;
  root.add(shock);

  // ── EXTRA UNNAMED DETAIL LAYERS ──

  // Inner plasma beam — narrow, near-white, intensely bright
  const innerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 4.5, 290, 14, 2, false),
    mat({ color: '#f0f9ff', emissive: '#e0f2fe', emissiveIntensity: 4.5, opacity: 0.82, roughness: 0.04 })
  );
  innerBeam.position.y = 145;
  root.add(innerBeam);

  // Mid-sheath beam — ionized plasma between inner and outer
  const midBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 12, 285, 18, 2, true),
    mat({ color: '#0ea5e9', emissive: '#38bdf8', emissiveIntensity: 2.8, opacity: 0.44, roughness: 0.1 })
  );
  midBeam.position.y = 142;
  root.add(midBeam);

  // Ground scorch mark — dark concentric burn pattern
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(55, 40),
    mat({ color: '#0c1a2e', emissive: '#0369a1', emissiveIntensity: 0.6, opacity: 0.82, roughness: 0.95 })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.15;
  root.add(scorch);

  // Inner molten scorch
  const scorchHot = new THREE.Mesh(
    new THREE.CircleGeometry(18, 30),
    mat({ color: '#1e40af', emissive: '#3b82f6', emissiveIntensity: 1.8, opacity: 0.72, roughness: 0.9 })
  );
  scorchHot.rotation.x = -Math.PI / 2;
  scorchHot.position.y = 0.2;
  root.add(scorchHot);

  // Electric arc tendrils branching off beam (6 angled thin cylinders)
  for (let i = 0; i < 6; i++) {
    const arcAngle = (i / 6) * Math.PI * 2;
    const arcTilt = 0.18 + (i % 3) * 0.09;
    const arc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.08, 45 + i * 8, 6, 1, false),
      mat({ color: '#bae6fd', emissive: '#e0f2fe', emissiveIntensity: 3.6, opacity: 0.68, roughness: 0.04 })
    );
    arc.position.set(
      Math.sin(arcAngle) * 6,
      85 + i * 18,
      Math.cos(arcAngle) * 6
    );
    arc.rotation.set(arcTilt * Math.sin(arcAngle), 0, -arcTilt * Math.cos(arcAngle));
    root.add(arc);
  }

  // Secondary shockwave ring (closer)
  const shock2 = new THREE.Mesh(
    new THREE.TorusGeometry(55, 4.5, 10, 52),
    mat({ color: '#7dd3fc', emissive: '#bae6fd', emissiveIntensity: 2.2, opacity: 0.3, roughness: 0.16 })
  );
  shock2.rotation.x = Math.PI / 2;
  shock2.position.y = 1;
  root.add(shock2);

  // Ground debris ejecta shards (8 tilted cones)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 22 + (i % 3) * 8;
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 14 + i * 2, 5, 1, false),
      mat({ color: '#0c2a4a', emissive: '#0ea5e9', emissiveIntensity: 0.8, opacity: 0.78, roughness: 0.72 })
    );
    shard.position.set(Math.sin(a) * r, 7, Math.cos(a) * r);
    shard.rotation.set(0.55 + (i % 2) * 0.22, a, 0.35);
    root.add(shard);
  }

  // Plasma splash ejecta disc (flat ring of molten material)
  const splash = new THREE.Mesh(
    new THREE.TorusGeometry(36, 9, 8, 40),
    mat({ color: '#0369a1', emissive: '#0ea5e9', emissiveIntensity: 2.0, opacity: 0.42, roughness: 0.12 })
  );
  splash.rotation.x = Math.PI / 2;
  splash.position.y = 8;
  root.add(splash);

  return root;
};

// ─── FIRESTORM (napalm carpet strike) ────────────────────────────────────────
const makeFirestorm = () => {
  const root = new THREE.Group();
  root.name = 'support_firestorm';

  // ── NAMED NODES ──

  // Primary fire ring — expanding ignition wave at ground
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(82, 7, 14, 56),
    mat({ color: '#7c2d12', emissive: '#ea580c', emissiveIntensity: 2.4, opacity: 0.58, roughness: 0.18 })
  );
  ring.name = 'support_firestorm_ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 3;
  root.add(ring);

  // Central fireball core — dense white-orange burst
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(32, 20, 14),
    mat({ color: '#fff7ed', emissive: '#f97316', emissiveIntensity: 3.2, opacity: 0.78, roughness: 0.08 })
  );
  core.name = 'support_firestorm_core';
  core.position.y = 18;
  core.scale.set(1.25, 0.55, 1.25);
  root.add(core);

  // 6 individual fire columns — varied height/position/intensity
  const flameData = [
    { pos: [0, 0, 0],       r: 22, h: 68, tilt: 0 },
    { pos: [38, 0, -22],    r: 14, h: 52, tilt:  0.12 },
    { pos: [-42, 0, -20],   r: 13, h: 48, tilt: -0.1 },
    { pos: [52, 0, 28],     r: 15, h: 55, tilt:  0.08 },
    { pos: [-50, 0, 22],    r: 13, h: 50, tilt: -0.14 },
    { pos: [10, 0, 58],     r: 14, h: 54, tilt:  0.1 }
  ];
  flameData.forEach(({ pos, r, h, tilt }, index) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 12, 3, true),
      mat({ color: '#fbbf24', emissive: '#f97316', emissiveIntensity: 2.8, opacity: 0.72, roughness: 0.1 })
    );
    flame.name = `support_firestorm_flame_${index}`;
    flame.position.set(pos[0], 22 + index, pos[2]);
    flame.rotation.z = tilt;
    root.add(flame);
  });

  // 4 billowing smoke columns — dark, thick, realistic
  const smokeData = [
    { pos: [-28, 42, -12], r: 20 },
    { pos: [22, 58, 16],   r: 24 },
    { pos: [6, 74, -28],   r: 28 },
    { pos: [-14, 90, 22],  r: 32 }
  ];
  smokeData.forEach(({ pos, r }, index) => {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      mat({ color: '#1c0a00', emissive: '#431407', emissiveIntensity: 0.18, opacity: 0.55, roughness: 0.98, metalness: 0 })
    );
    smoke.name = `support_firestorm_smoke_${index}`;
    smoke.position.set(pos[0], pos[1], pos[2]);
    smoke.scale.set(1.4, 0.72, 1.4);
    root.add(smoke);
  });

  // Far shockwave ring — overpressure wave
  const shock = new THREE.Mesh(
    new THREE.TorusGeometry(138, 9, 12, 68),
    mat({ color: '#9a3412', emissive: '#f97316', emissiveIntensity: 1.6, opacity: 0.22, roughness: 0.24 })
  );
  shock.name = 'support_firestorm_shock';
  shock.rotation.x = Math.PI / 2;
  shock.position.y = 2;
  root.add(shock);

  // Tall mushroom smoke plume — rises and billows
  const plume = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 55, 120, 18, 3, true),
    mat({ color: '#292524', emissive: '#7c2d12', emissiveIntensity: 0.55, opacity: 0.38, roughness: 0.96 })
  );
  plume.name = 'support_firestorm_plume';
  plume.position.y = 62;
  root.add(plume);

  // ── EXTRA UNNAMED DETAIL ──

  // Ground char — large flat burn scar
  const charBase = new THREE.Mesh(
    new THREE.CircleGeometry(110, 44),
    mat({ color: '#0c0502', emissive: '#7c2d12', emissiveIntensity: 0.4, opacity: 0.86, roughness: 0.98 })
  );
  charBase.rotation.x = -Math.PI / 2;
  charBase.position.y = 0.1;
  root.add(charBase);

  // Hot ember centre — glowing ground
  const emberBase = new THREE.Mesh(
    new THREE.CircleGeometry(38, 32),
    mat({ color: '#431407', emissive: '#dc2626', emissiveIntensity: 1.6, opacity: 0.74, roughness: 0.94 })
  );
  emberBase.rotation.x = -Math.PI / 2;
  emberBase.position.y = 0.2;
  root.add(emberBase);

  // Inner white-hot core ground
  const hotCore = new THREE.Mesh(
    new THREE.CircleGeometry(14, 24),
    mat({ color: '#fef3c7', emissive: '#fbbf24', emissiveIntensity: 2.8, opacity: 0.62, roughness: 0.88 })
  );
  hotCore.rotation.x = -Math.PI / 2;
  hotCore.position.y = 0.3;
  root.add(hotCore);

  // Rolling ground fire — flat ring skimming the surface
  const groundFire = new THREE.Mesh(
    new THREE.TorusGeometry(52, 12, 8, 44),
    mat({ color: '#dc2626', emissive: '#f97316', emissiveIntensity: 2.0, opacity: 0.48, roughness: 0.14 })
  );
  groundFire.rotation.x = Math.PI / 2;
  groundFire.position.y = 8;
  root.add(groundFire);

  // Inner fire ring (napalm puddle boundary)
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(28, 6.5, 10, 36),
    mat({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 2.4, opacity: 0.62, roughness: 0.1 })
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 5;
  root.add(innerRing);

  // Mid smoke billow (dark grey)
  const midSmoke = new THREE.Mesh(
    new THREE.SphereGeometry(42, 14, 10),
    mat({ color: '#1c1917', emissive: '#292524', emissiveIntensity: 0.12, opacity: 0.42, roughness: 0.98 })
  );
  midSmoke.position.set(0, 36, 0);
  midSmoke.scale.set(1.55, 0.62, 1.55);
  root.add(midSmoke);

  // Ember spark disc — tiny glowing scatter particles (thin flattened sphere)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 18 + (i % 4) * 12;
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(1.4 + (i % 3) * 0.6, 6, 5),
      mat({ color: '#fef08a', emissive: '#fbbf24', emissiveIntensity: 3.5, opacity: 0.82 })
    );
    ember.position.set(Math.sin(a) * r, 4 + (i % 5) * 3, Math.cos(a) * r);
    root.add(ember);
  }

  // Secondary plume cap — mushroom top
  const plumeTop = new THREE.Mesh(
    new THREE.SphereGeometry(38, 14, 10),
    mat({ color: '#292524', emissive: '#57534e', emissiveIntensity: 0.22, opacity: 0.48, roughness: 0.96 })
  );
  plumeTop.position.set(0, 124, 0);
  plumeTop.scale.set(1.8, 0.52, 1.8);
  root.add(plumeTop);

  // Radial fire streaks on ground (8 thin quads)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const streak = new THREE.Mesh(
      new THREE.BoxGeometry(82, 0.6, 4.5),
      mat({ color: '#7c2d12', emissive: '#f97316', emissiveIntensity: 1.4, opacity: 0.44, roughness: 0.88 })
    );
    streak.position.set(Math.sin(a) * 32, 0.5, Math.cos(a) * 32);
    streak.rotation.y = a;
    root.add(streak);
  }

  return root;
};

// ─── KINETIC SPEAR (tungsten rod from god) ───────────────────────────────────
const makeKineticSpear = () => {
  const root = new THREE.Group();
  root.name = 'support_kinetic_spear';

  // ── NAMED NODES ──

  // Tungsten rod body — dark metallic, heated to orange/white on skin
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 4.2, 248, 16, 3, false),
    mat({ color: '#292524', emissive: '#f97316', emissiveIntensity: 1.2, roughness: 0.18, metalness: 0.88 })
  );
  shaft.name = 'support_kinetic_spear_shaft';
  shaft.position.y = 136;
  root.add(shaft);

  // Hypersonic nose — ablative white-hot tip
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(6.5, 28, 16, 2, false),
    mat({ color: '#fef9c3', emissive: '#fef08a', emissiveIntensity: 4.5, roughness: 0.04, metalness: 0.96 })
  );
  tip.name = 'support_kinetic_spear_tip';
  tip.position.y = 8;
  root.add(tip);

  // Ground impact flash — intense white sphere
  const flare = new THREE.Mesh(
    new THREE.SphereGeometry(22, 18, 12),
    mat({ color: '#f8fafc', emissive: '#f0f9ff', emissiveIntensity: 4.8, opacity: 0.62, roughness: 0.04 })
  );
  flare.name = 'support_kinetic_spear_flare';
  flare.position.y = 16;
  flare.scale.set(2.2, 0.44, 2.2);
  root.add(flare);

  // Ejecta crown — soil/rock vaporised upward
  const impact = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 55, 58, 24, 2, true),
    mat({ color: '#78350f', emissive: '#f97316', emissiveIntensity: 1.6, opacity: 0.48, roughness: 0.82 })
  );
  impact.name = 'support_kinetic_spear_impact';
  impact.position.y = 22;
  root.add(impact);

  // Primary shockwave ring — fast-expanding overpressure
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(88, 7.5, 14, 68),
    mat({ color: '#e2e8f0', emissive: '#bae6fd', emissiveIntensity: 2.2, opacity: 0.34, roughness: 0.14 })
  );
  ring.name = 'support_kinetic_spear_ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.5;
  root.add(ring);

  // ── EXTRA UNNAMED DETAIL ──

  // Re-entry plasma sheath — wide glowing shroud around rod
  const plasmaSheath = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 16, 252, 20, 3, true),
    mat({ color: '#f97316', emissive: '#fb923c', emissiveIntensity: 1.8, opacity: 0.24, roughness: 0.12 })
  );
  plasmaSheath.position.y = 136;
  root.add(plasmaSheath);

  // Outer plasma glow (very wide, very transparent blue-orange gradient)
  const outerGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 28, 258, 18, 2, true),
    mat({ color: '#fed7aa', emissive: '#f97316', emissiveIntensity: 0.9, opacity: 0.12, roughness: 0.2 })
  );
  outerGlow.position.y = 136;
  root.add(outerGlow);

  // Hypersonic shock cone (Mach cone) around nose
  const shockCone = new THREE.Mesh(
    new THREE.ConeGeometry(45, 95, 22, 2, true),
    mat({ color: '#f0f9ff', emissive: '#7dd3fc', emissiveIntensity: 1.2, opacity: 0.18, roughness: 0.16 })
  );
  shockCone.position.y = 22;
  shockCone.rotation.y = 0;
  root.add(shockCone);

  // Contrail — long white vapour trail in wake
  const contrail = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 22, 180, 14, 2, true),
    mat({ color: '#f0f0f0', emissive: '#e2e8f0', emissiveIntensity: 0.4, opacity: 0.18, roughness: 0.88 })
  );
  contrail.position.y = 220;
  root.add(contrail);

  // Condensation discs along contrail
  for (let i = 0; i < 5; i++) {
    const disc = new THREE.Mesh(
      new THREE.TorusGeometry(12 + i * 2.5, 2.5, 8, 24),
      mat({ color: '#e0f2fe', emissive: '#bae6fd', emissiveIntensity: 0.8, opacity: 0.22, roughness: 0.3 })
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 80 + i * 38;
    root.add(disc);
  }

  // Ground crater — dark depression ring
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(62, 48),
    mat({ color: '#0c0a09', emissive: '#431407', emissiveIntensity: 0.5, opacity: 0.88, roughness: 0.98 })
  );
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = 0.1;
  root.add(crater);

  // Molten crater core (white-orange)
  const craterHot = new THREE.Mesh(
    new THREE.CircleGeometry(18, 32),
    mat({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 3.2, opacity: 0.72, roughness: 0.9 })
  );
  craterHot.rotation.x = -Math.PI / 2;
  craterHot.position.y = 0.2;
  root.add(craterHot);

  // Secondary shockwave (tighter, faster ring)
  const shock2 = new THREE.Mesh(
    new THREE.TorusGeometry(52, 5, 12, 52),
    mat({ color: '#cbd5e1', emissive: '#e2e8f0', emissiveIntensity: 2.8, opacity: 0.38, roughness: 0.12 })
  );
  shock2.rotation.x = Math.PI / 2;
  shock2.position.y = 1;
  root.add(shock2);

  // Tertiary shockwave (outermost, faintest)
  const shock3 = new THREE.Mesh(
    new THREE.TorusGeometry(132, 6, 10, 56),
    mat({ color: '#f1f5f9', emissive: '#e2e8f0', emissiveIntensity: 1.0, opacity: 0.16, roughness: 0.2 })
  );
  shock3.rotation.x = Math.PI / 2;
  shock3.position.y = 0.5;
  root.add(shock3);

  // Rock/earth debris shards (12 cones thrown outward)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 25 + (i % 4) * 10;
    const h = 12 + (i % 5) * 6;
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, h, 5, 1, false),
      mat({ color: '#44403c', emissive: '#f97316', emissiveIntensity: 0.4 + (i % 3) * 0.2, opacity: 0.82, roughness: 0.88 })
    );
    shard.position.set(Math.sin(a) * r, h * 0.4, Math.cos(a) * r);
    shard.rotation.set(0.6 + (i % 3) * 0.2, a, 0.4 + (i % 2) * 0.3);
    root.add(shard);
  }

  // Rod heat wake — trailing orange glow cylinder
  const heatWake = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 4.8, 80, 12, 2, true),
    mat({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 2.4, opacity: 0.38, roughness: 0.08 })
  );
  heatWake.position.y = 68;
  root.add(heatWake);

  return root;
};

const scene = new THREE.Scene();
scene.add(makeOrbitalLance());
scene.add(makeFirestorm());
scene.add(makeKineticSpear());

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(
    scene,
    (result) => resolve(result),
    (error) => reject(error),
    { binary: true, onlyVisible: true, includeCustomExtensions: false }
  );
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, Buffer.from(arrayBuffer));

console.log(`Wrote ${outPath}`);
