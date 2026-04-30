import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { textures } from './falloutTextureUtils.mjs';
import { addMesh, makeMaterial as baseMakeMaterial } from './generateUtils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'fallout');
const outPath = path.join(outDir, 'kaiju_assets.glb');

const root = new THREE.Group();
root.name = 'kaiju_assets_root';

const tileMap = (map, repeat = [1, 1], rotation = 0, offset = [0, 0]) => {
  if (!map) return null;
  const tiledMap = map.clone();
  tiledMap.wrapS = THREE.RepeatWrapping;
  tiledMap.wrapT = THREE.RepeatWrapping;
  tiledMap.repeat.set(repeat[0], repeat[1]);
  tiledMap.offset.set(offset[0], offset[1]);
  tiledMap.rotation = rotation;
  tiledMap.needsUpdate = true;
  return tiledMap;
};

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.76,
  metalness = 0.12,
  transparent = false,
  opacity = 1,
  side,
  map,
  mapRepeat,
  mapRotation = 0,
  mapOffset = [0, 0],
}) => {
  const m = baseMakeMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    transparent,
    opacity,
    ...(side !== undefined ? { side } : {})
  });
  if (map !== undefined) {
    m.map = mapRepeat ? tileMap(map, mapRepeat, mapRotation, mapOffset) : map;
  }
  return m;
};

// ── Lower-cost geometry wrappers — cap segment counts for web render budgets ──
const capSegments = (value, fallback, max) => Math.min(value ?? fallback, max);

const hpSphere = (r, ws, hs, ...rest) =>
  new THREE.SphereGeometry(r, capSegments(ws, 12, 14), capSegments(hs, 10, 12), ...rest);

const hpCapsule = (r, len, capSeg, radSeg) =>
  new THREE.CapsuleGeometry(r, len, capSegments(capSeg, 4, 6), capSegments(radSeg, 6, 8));

const hpCylinder = (rTop, rBot, h, radSeg, ...rest) =>
  new THREE.CylinderGeometry(rTop, rBot, h, capSegments(radSeg, 8, 10), ...rest);

const hpCone = (r, h, radSeg, ...rest) =>
  new THREE.ConeGeometry(r, h, capSegments(radSeg, 6, 8), ...rest);

const hpTorus = (r, tube, radSeg, tubSeg, ...rest) =>
  new THREE.TorusGeometry(r, tube, capSegments(radSeg, 6, 8), capSegments(tubSeg, 18, 20), ...rest);

// ─────────────────────────────────────────────────────────────────────────────
// GODZILLA — thick organic build, layered hide, heavy limbs, no gap joints
// ─────────────────────────────────────────────────────────────────────────────
const buildGodzilla = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_godzilla';

  const shellMat = makeMaterial({ color: '#263647', roughness: 0.64, metalness: 0.18, map: textures.SCALES, mapRepeat: [3.2, 2.8], mapRotation: 0.08 });
  const shellDarkMat = makeMaterial({ color: '#172230', roughness: 0.76, metalness: 0.12, map: textures.SCALES, mapRepeat: [4.2, 3.2], mapRotation: -0.06 });
  const plateMat = makeMaterial({ color: '#4f647b', roughness: 0.46, metalness: 0.34, map: textures.CHITIN, mapRepeat: [4.6, 4.1], mapRotation: 0.12 });
  const ventMat = makeMaterial({ color: '#334155', roughness: 0.54, metalness: 0.08, map: textures.ORGANIC_SKIN, mapRepeat: [2.8, 4.2], mapRotation: -0.08 });
  const seamMat = makeMaterial({ color: '#0f172a', emissive: '#34d399', emissiveIntensity: 1.55, roughness: 0.16, metalness: 0.18 });
  const eyeMat = makeMaterial({ color: '#fca5a5', emissive: '#ef4444', emissiveIntensity: 3.0, roughness: 0.04, metalness: 0.0 });
  const mawMat = makeMaterial({ color: '#450a0a', roughness: 0.86, metalness: 0.04, map: textures.ORGANIC_SKIN, mapRepeat: [3.0, 2.8] });
  const boneMat = makeMaterial({ color: '#d1d5db', roughness: 0.18, metalness: 0.14 });
  const spineGlowMat = (index) => makeMaterial({ color: '#08130f', emissive: index % 2 === 0 ? '#22c55e' : '#86efac', emissiveIntensity: index < 3 ? 1.8 : 1.0, roughness: 0.14, metalness: 0.24, transparent: true, opacity: 0.92 });

  addMesh({ parent: group, name: 'kaiju_godzilla_pelvis', geometry: hpSphere(16.5, 22, 16), material: shellDarkMat, position: [0, 18, -7], scale: [1.2, 0.82, 1.16] });
  addMesh({ parent: group, name: 'kaiju_godzilla_hip_fill', geometry: hpCapsule(11, 12, 8, 12), material: plateMat, position: [0, 25, -2], rotation: [0.16, 0, 0], scale: [1.18, 0.86, 1.05] });

  addMesh({ parent: group, name: 'kaiju_godzilla_torso', geometry: hpCapsule(15.5, 30, 12, 18), material: shellMat, position: [0, 36, 2], rotation: [0.08, 0, 0], scale: [1.0, 1.28, 0.94] });
  addMesh({ parent: group, name: 'kaiju_godzilla_belly', geometry: hpCapsule(9.2, 24, 8, 14), material: ventMat, position: [0, 34, 11], rotation: [-0.1, 0, 0], scale: [0.78, 1.08, 0.56] });
  [-1, 1].forEach((side) => {
    addMesh({ parent: group, name: `kaiju_godzilla_pec_${side < 0 ? 'l' : 'r'}`, geometry: hpCone(5.4, 15, 6), material: plateMat, position: [side * 8.6, 40, 8], rotation: [-0.3, 0, side * 0.26], scale: [0.9, 0.9, 1.08] });
  });
  addMesh({ parent: group, name: 'kaiju_godzilla_chest_seam', geometry: hpCapsule(2.8, 22, 6, 10), material: seamMat, position: [0, 36, 15], rotation: [0.04, 0, 0], scale: [0.8, 1, 0.7] });
  [-1, 1].forEach((side) => {
    addMesh({ parent: group, name: `kaiju_godzilla_shoulder_fill_${side < 0 ? 0 : 1}`, geometry: hpSphere(7.0, 12, 10), material: plateMat, position: [side * 15, 40, 4], scale: [0.96, 0.74, 0.82] });
  });

  const head = new THREE.Group();
  head.name = 'kaiju_godzilla_head';
  head.position.set(0, 58, 14);
  group.add(head);
  addMesh({ parent: head, name: 'kaiju_godzilla_skull', geometry: hpSphere(10.2, 20, 16), material: shellDarkMat, scale: [0.96, 0.74, 1.36] });
  addMesh({ parent: head, name: 'kaiju_godzilla_brow', geometry: hpCone(5.6, 14, 6), material: plateMat, position: [0, 4.8, 6], rotation: [-0.74, 0, 0], scale: [1.45, 0.45, 0.76] });
  addMesh({ parent: head, name: 'kaiju_godzilla_snout', geometry: hpCone(5.4, 16, 6), material: shellDarkMat, position: [0, -1.8, 12.2], rotation: [-Math.PI / 2, 0, 0], scale: [1.0, 1.0, 1.28] });
  [-1, 1].forEach((side) => {
    addMesh({ parent: head, name: `kaiju_godzilla_cheek_${side < 0 ? 0 : 1}`, geometry: hpSphere(5.2, 12, 10), material: plateMat, position: [side * 7.2, -0.6, 8], scale: [0.7, 0.46, 0.82] });
  });
  [[-5.2, 4.2, 10.0], [5.2, 4.2, 10.0]].forEach(([x, y, z], i) => {
    addMesh({ parent: head, name: `kaiju_godzilla_eye_${i}`, geometry: hpSphere(1.9, 12, 10), material: eyeMat, position: [x, y, z] });
    addMesh({ parent: head, name: `kaiju_godzilla_eye_socket_${i}`, geometry: hpSphere(3.2, 10, 8), material: shellDarkMat, position: [x, y - 0.4, z - 1.0], scale: [1, 0.64, 0.68] });
  });
  addMesh({ parent: head, name: 'kaiju_godzilla_neck', geometry: hpCapsule(8.8, 15, 8, 12), material: shellMat, position: [0, -9.5, -5], rotation: [0.26, 0, 0], scale: [1.0, 1.0, 0.84] });
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: head, name: `kaiju_godzilla_crown_horn_${index}`, geometry: hpCone(2.1, 10.5, 5), material: plateMat, position: [side * 5.8, 8.4, 3.8], rotation: [-0.36, 0, side * 0.3], scale: [0.82, 1.0, 0.72] });
  });
  addMesh({ parent: head, name: 'kaiju_godzilla_nose_horn', geometry: hpCone(1.1, 6.4, 5), material: boneMat, position: [0, 4.6, 14.6], rotation: [-0.52, 0, 0], scale: [0.8, 1.0, 0.72] });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_godzilla_jaw';
  jaw.position.set(0, -5.5, 5.5);
  head.add(jaw);
  addMesh({ parent: jaw, name: 'kaiju_godzilla_jaw_shell', geometry: hpCone(6.4, 13, 6), material: shellDarkMat, position: [0, -3.0, 6.5], rotation: [-Math.PI / 2, 0, 0], scale: [1.2, 0.82, 1.0] });
  addMesh({ parent: jaw, name: 'kaiju_godzilla_jaw_maw', geometry: hpSphere(6.2, 12, 10), material: mawMat, position: [0, -1.8, 6.8], scale: [0.9, 0.38, 1.06] });
  for (let i = 0; i < 12; i++) {
    addMesh({ parent: jaw, name: `kaiju_godzilla_tooth_${i}`, geometry: hpCone(0.62 - (i % 3) * 0.08, 4.8 - (i % 4) * 0.5, 5), material: boneMat, position: [-5.5 + i * 1.0, 1.0, 10.0 - (i % 2) * 1.2], rotation: [Math.PI / 2, 0, i % 2 === 0 ? 0.08 : -0.08] });
  }

  [-1, 1].forEach((side, index) => {
    const arm = new THREE.Group();
    arm.name = `kaiju_godzilla_arm_${index}`;
    arm.position.set(side * 17, 40, 6);
    group.add(arm);
    addMesh({ parent: arm, name: `kaiju_godzilla_shoulder_cap_${index}`, geometry: hpSphere(6.4, 14, 12), material: plateMat, scale: [0.96, 0.76, 0.86] });
    addMesh({ parent: arm, name: `kaiju_godzilla_arm_upper_${index}`, geometry: hpCapsule(4.8, 14, 8, 12), material: shellDarkMat, position: [side * 3.4, -7, 2.2], rotation: [0.18, 0, side * -0.74] });
    addMesh({ parent: arm, name: `kaiju_godzilla_elbow_${index}`, geometry: hpSphere(4.2, 10, 8), material: plateMat, position: [side * 9.2, -11, 4.8], scale: [0.84, 0.74, 0.84] });
    addMesh({ parent: arm, name: `kaiju_godzilla_arm_lower_${index}`, geometry: hpCapsule(3.4, 12, 8, 10), material: shellMat, position: [side * 12.6, -14, 6.8], rotation: [0.28, 0, side * -0.34] });
    for (let c = 0; c < 3; c++) {
      addMesh({ parent: arm, name: `kaiju_godzilla_claw_${index}_${c}`, geometry: hpCone(0.92, 5.8, 5), material: boneMat, position: [side * (15.7 + c * 1.6), -18 + c * 0.5, 8.8 + c * 0.5], rotation: [0.62, 0, side * (-0.2 + c * 0.12)] });
    }
  });

  [-1, 1].forEach((side, index) => {
    const leg = new THREE.Group();
    leg.name = `kaiju_godzilla_leg_${index}`;
    leg.position.set(side * 13, 8, -2);
    group.add(leg);
    addMesh({ parent: leg, name: `kaiju_godzilla_thigh_${index}`, geometry: hpCapsule(7.8, 16, 10, 14), material: shellMat, rotation: [0.08, 0, side * -0.12], scale: [0.9, 1.12, 0.96] });
    addMesh({ parent: leg, name: `kaiju_godzilla_knee_${index}`, geometry: hpSphere(6.8, 12, 10), material: plateMat, position: [0, -13.6, 3.2], scale: [0.82, 0.68, 0.86] });
    addMesh({ parent: leg, name: `kaiju_godzilla_shin_${index}`, geometry: hpCapsule(5.0, 18, 8, 12), material: shellDarkMat, position: [0, -20, 5.8], rotation: [0.18, 0, side * 0.03] });
    addMesh({ parent: leg, name: `kaiju_godzilla_ankle_${index}`, geometry: hpSphere(5.2, 12, 10), material: shellDarkMat, position: [0, -30, 8.8], scale: [0.96, 0.66, 0.82] });
    addMesh({ parent: leg, name: `kaiju_godzilla_foot_${index}`, geometry: hpCylinder(4.6, 8.8, 5.5, 12), material: shellDarkMat, position: [0, -35, 13] });
    for (let t = 0; t < 4; t++) {
      addMesh({ parent: leg, name: `kaiju_godzilla_toe_${index}_${t}`, geometry: hpCone(1.2, 6.6, 5), material: boneMat, position: [(t - 1.5) * 3, -37, 17 + t * 0.3], rotation: [0.72, 0, (t - 1.5) * 0.1] });
    }
  });

  for (let i = 0; i < 9; i++) {
    const r = 10.2 - i * 0.76;
    addMesh({ parent: group, name: `kaiju_godzilla_tail_${i}`, geometry: hpSphere(r, 16, 14), material: i < 3 ? shellDarkMat : shellMat, position: [Math.sin(i * 0.3) * 2.6, 14 - i * 1.1, -26 - i * 11.2], scale: [1.0, 0.78, 1.34] });
  }
  addMesh({ parent: group, name: 'kaiju_godzilla_tail_tip', geometry: hpCone(2.6, 11, 8), material: shellDarkMat, position: [Math.sin(9 * 0.3) * 2.6, 14 - 9 * 1.1, -26 - 9 * 11.2], rotation: [Math.PI / 2, 0, 0] });

  for (let i = 0; i < 8; i++) {
    const w = 3.4 - i * 0.16;
    const h = 14 + i * 0.5;
    addMesh({ parent: group, name: `kaiju_godzilla_spine_${i}`, geometry: hpCone(w, h, 5), material: spineGlowMat(i), position: [0, 50 - i * 4.8, -6 - i * 4.4], rotation: [-0.32, 0, i % 2 === 0 ? 0.08 : -0.08], scale: [1.0, 1.0, 1.5] });
    [-1, 1].forEach((side) => {
      addMesh({ parent: group, name: `kaiju_godzilla_spine_sub_${i}_${side < 0 ? 0 : 1}`, geometry: hpCone(w * 0.45, h * 0.58, 5), material: spineGlowMat(i + 1), position: [side * (w + 1.0), 49 - i * 4.8, -6 - i * 4.4], rotation: [-0.28, side * 0.22, side * 0.34], scale: [0.8, 1.0, 1.2] });
    });
  }
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: group, name: `kaiju_godzilla_shoulder_blade_${index}`, geometry: hpCone(3.0, 16, 5), material: plateMat, position: [side * 16.8, 46.5, 1.2], rotation: [-0.18, 0, side * 0.72], scale: [0.7, 1.0, 1.5] });
  });
  for (let i = 0; i < 4; i++) {
    addMesh({ parent: group, name: `kaiju_godzilla_tail_blade_${i}`, geometry: hpCone(1.6 - i * 0.18, 8.5 - i * 0.6, 5), material: spineGlowMat(i + 2), position: [0, 10 - i * 1.2, -58 - i * 18], rotation: [-0.18, 0, i % 2 === 0 ? 0.12 : -0.12], scale: [0.8, 1.0, 1.8] });
  }

  return group;
};

const cloneMaterial = (material) => {
  if (Array.isArray(material)) return material.map((entry) => cloneMaterial(entry));
  return material?.clone?.() || material;
};

const tintGodzillaVariant = (sourceGroup, {
  groupName,
  baseColor,
  darkColor,
  plateColor,
  seamColor,
  seamEmissive,
  seamIntensity,
  eyeColor,
  eyeEmissive,
  eyeIntensity,
  mawColor,
  boneColor,
  spinePrimary,
  spineSecondary,
  scale = [1, 1, 1]
}) => {
  const variant = sourceGroup.clone(true);
  variant.name = groupName;
  variant.scale.set(scale[0], scale[1], scale[2]);

  variant.traverse((node) => {
    if (!node.isMesh) return;
    node.material = cloneMaterial(node.material);
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((material) => {
      if (!material) return;
      const name = node.name || '';
      if (name.includes('chest_seam')) {
        material.color?.set?.(seamColor);
        material.emissive?.set?.(seamEmissive);
        material.emissiveIntensity = seamIntensity;
      } else if (name.includes('eye_')) {
        material.color?.set?.(eyeColor);
        material.emissive?.set?.(eyeEmissive);
        material.emissiveIntensity = eyeIntensity;
      } else if (name.includes('jaw_maw')) {
        material.color?.set?.(mawColor);
      } else if (name.includes('tooth_') || name.includes('claw_') || name.includes('toe_') || name.includes('nose_horn')) {
        material.color?.set?.(boneColor);
      } else if (name.includes('spine_') || name.includes('tail_blade_')) {
        const isEven = Number.parseInt(name.match(/(\d+)/)?.[0] || '0', 10) % 2 === 0;
        material.color?.set?.('#08130f');
        material.emissive?.set?.(isEven ? spinePrimary : spineSecondary);
        material.emissiveIntensity = material.emissiveIntensity != null ? material.emissiveIntensity * 1.15 : 1.4;
      } else if (name.includes('plate') || name.includes('pec_') || name.includes('shoulder_blade') || name.includes('elbow_') || name.includes('knee_')) {
        material.color?.set?.(plateColor);
      } else if (name.includes('shell') || name.includes('pelvis') || name.includes('torso') || name.includes('tail_') || name.includes('head') || name.includes('neck') || name.includes('arm_') || name.includes('leg_') || name.includes('skull') || name.includes('snout')) {
        const useDark = name.includes('shell') || name.includes('pelvis') || name.includes('skull') || name.includes('jaw_') || name.includes('tail_0') || name.includes('tail_1') || name.includes('shin_') || name.includes('foot_');
        material.color?.set?.(useDark ? darkColor : baseColor);
      }
    });
  });

  return variant;
};

// ─────────────────────────────────────────────────────────────────────────────
// OCTOPUS SLOT → "ABYSSAL BLOOM" — radial abyss titan, petal-crown core,
// ribbon tendrils. Keeps octopus node names for runtime animation hooks.
// ─────────────────────────────────────────────────────────────────────────────
const buildOctopus = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_octopus';

  const coreMat = makeMaterial({ color: '#28133d', roughness: 0.4, metalness: 0.16, map: textures.ORGANIC_SKIN, mapRepeat: [3.4, 4.2], mapRotation: 0.08 });
  const petalMat = makeMaterial({ color: '#433066', roughness: 0.34, metalness: 0.14, map: textures.ORGANIC_SKIN, mapRepeat: [4.8, 5.4], mapRotation: -0.12 });
  const membraneMat = makeMaterial({ color: '#7c3aed', roughness: 0.18, metalness: 0.04, transparent: true, opacity: 0.32, side: THREE.DoubleSide });
  const glowMat = makeMaterial({ color: '#120f24', emissive: '#34d399', emissiveIntensity: 1.25, roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.62 });
  const shardMat = makeMaterial({ color: '#160d26', roughness: 0.72, metalness: 0.06, map: textures.CHITIN, mapRepeat: [4.4, 4.4] });
  const eyeMat = makeMaterial({ color: '#d8b4fe', emissive: '#a855f7', emissiveIntensity: 2.8, roughness: 0.08, metalness: 0.0 });

  const mantle = new THREE.Group();
  mantle.name = 'kaiju_octopus_mantle';
  mantle.position.set(0, 22, 0);
  group.add(mantle);

  addMesh({ parent: mantle, name: 'kaiju_octopus_core', geometry: hpSphere(13.5, 24, 18), material: coreMat, scale: [1.08, 1.26, 1.08] });
  addMesh({ parent: mantle, name: 'kaiju_octopus_glow', geometry: hpSphere(11.2, 20, 16), material: glowMat, scale: [0.92, 1.14, 0.92] });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    addMesh({
      parent: mantle,
      name: `kaiju_octopus_petal_${i}`,
      geometry: hpCone(3.8, 12, 6),
      material: petalMat,
      position: [Math.cos(angle) * 8.2, 2.8, Math.sin(angle) * 8.2],
      rotation: [0.85, -angle, Math.sin(angle) * 0.18],
      scale: [0.85, 1.0, 1.3],
    });
  }
  for (let i = 0; i < 3; i++) {
    addMesh({ parent: mantle, name: `kaiju_octopus_core_spire_${i}`, geometry: hpCone(2.4 - i * 0.35, 9.5 - i * 1.2, 5), material: glowMat, position: [0, 10.5 + i * 4.2, 0], rotation: [0, 0, i % 2 === 0 ? 0.18 : -0.18], scale: [1.0, 1.0, 1.8 - i * 0.2] });
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    addMesh({
      parent: group,
      name: `kaiju_octopus_halo_blade_${i}`,
      geometry: hpCone(1.2, 8.8, 5),
      material: petalMat,
      position: [Math.cos(angle) * 15.5, 18.8, Math.sin(angle) * 15.5],
      rotation: [Math.PI / 2, -angle, 0],
      scale: [0.42, 1.0, 1.8]
    });
  }

  addMesh({
    parent: group, name: 'kaiju_octopus_membrane',
    geometry: hpTorus(16, 4.5, 12, 32),
    material: membraneMat,
    position: [0, 18, 0],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.0, 0.45, 1.0]
  });

  const beak = new THREE.Group();
  beak.name = 'kaiju_octopus_beak';
  beak.position.set(0, 12, 8);
  beak.rotation.set(Math.PI / 4.2, 0, 0);
  group.add(beak);
  addMesh({ parent: beak, name: 'kaiju_octopus_beak_upper', geometry: hpCone(4.4, 9.5, 10), material: shardMat });
  addMesh({ parent: beak, name: 'kaiju_octopus_beak_lower', geometry: hpCone(3.6, 7.5, 10), material: shardMat, position: [0, -3.2, 1.1], rotation: [-0.82, 0, 0] });

  [[-5.8, 18, 9], [5.8, 18, 9], [-2.4, 15.5, 12], [2.4, 15.5, 12]].forEach(([x, y, z], index) => {
    addMesh({ parent: group, name: `kaiju_octopus_eye_${index}`, geometry: hpSphere(index < 2 ? 1.9 : 1.25, 12, 10), material: eyeMat, position: [x, y, z] });
  });

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const tentacle = new THREE.Group();
    tentacle.name = `kaiju_octopus_tentacle_${i}`;
    tentacle.position.set(Math.cos(angle) * 7.5, 10, Math.sin(angle) * 7.5);
    tentacle.rotation.set(0.92, angle, 0);
    group.add(tentacle);

    addMesh({ parent: tentacle, name: `kaiju_octopus_tentacle_core_${i}`, geometry: hpCapsule(2.4, 12, 8, 12), material: petalMat, position: [0, -1.5, 8], rotation: [0.18, 0, 0] });
    addMesh({ parent: tentacle, name: `kaiju_octopus_tentacle_mid_${i}`, geometry: hpCapsule(1.55, 13, 8, 10), material: coreMat, position: [0, -6.5, 20], rotation: [0.42, 0, Math.sin(i) * 0.08] });
    addMesh({ parent: tentacle, name: `kaiju_octopus_tentacle_tip_${i}`, geometry: hpCapsule(0.7, 16, 8, 10), material: glowMat, position: [0, -13, 33], rotation: [0.7, 0, Math.cos(i) * 0.12], scale: [0.9, 1, 0.65] });
    for (let vane = 0; vane < 3; vane++) {
      addMesh({
        parent: tentacle,
        name: `kaiju_octopus_tentacle_vane_${i}_${vane}`,
        geometry: hpCone(1.0 - vane * 0.18, 6 - vane * 0.7, 5),
        material: membraneMat,
        position: [0, -4 - vane * 4.5, 12 + vane * 6.5],
        rotation: [0.9 + vane * 0.16, 0, vane % 2 === 0 ? 0.3 : -0.26],
        scale: [0.4, 1, 1.25],
      });
    }
  }

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// SPIDER SLOT → "SHARD WALKER" — faceted siege crawler with scythe limbs and
// crystal sacs. Keeps spider node names for runtime hooks.
// ─────────────────────────────────────────────────────────────────────────────
const buildSpider = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spider';

  const shellMat = makeMaterial({ color: '#202833', roughness: 0.68, metalness: 0.18, map: textures.CHITIN, mapRepeat: [4.4, 4.2] });
  const plateMat = makeMaterial({ color: '#3a4658', roughness: 0.34, metalness: 0.42, map: textures.CHITIN, mapRepeat: [5.8, 5.2], mapRotation: 0.14 });
  const glowMat = makeMaterial({ color: '#2a0808', emissive: '#ef4444', emissiveIntensity: 1.1, roughness: 0.8, metalness: 0.04 });
  const eyeMat = makeMaterial({ color: '#f8fafc', emissive: '#fb7185', emissiveIntensity: 2.8, roughness: 0.06, metalness: 0.02 });
  const fangMat = makeMaterial({ color: '#d8dee9', roughness: 0.18, metalness: 0.26 });

  const rootNode = new THREE.Group();
  rootNode.name = 'kaiju_spider_root';
  rootNode.position.set(0, 4.8, 0);
  group.add(rootNode);

  const abdomen = new THREE.Group();
  abdomen.name = 'kaiju_spider_abdomen';
  abdomen.position.set(0, 15.5, -20);
  rootNode.add(abdomen);
  addMesh({ parent: abdomen, name: 'kaiju_spider_abdomen_core', geometry: hpSphere(12.8, 24, 18), material: shellMat, scale: [1.0, 0.82, 1.7] });
  addMesh({ parent: abdomen, name: 'kaiju_spider_abdomen_crystal', geometry: hpCone(4.2, 14, 6), material: glowMat, position: [0, 3.4, -1.5], rotation: [-0.22, 0, 0], scale: [0.85, 1, 1.4] });
  for (let rib = 0; rib < 4; rib++) {
    addMesh({ parent: abdomen, name: `kaiju_spider_abdomen_ridge_${rib}`, geometry: hpCapsule(0.9, 10.5 - rib, 4, 8), material: plateMat, position: [0, 2 - rib * 1.8, -2.5 - rib * 1.5], rotation: [Math.PI / 2, 0, 0], scale: [0.75, 0.24, 1.5] });
  }

  const thorax = new THREE.Group();
  thorax.name = 'kaiju_spider_thorax';
  thorax.position.set(0, 11.2, -1.8);
  rootNode.add(thorax);
  addMesh({ parent: thorax, name: 'kaiju_spider_thorax_core', geometry: hpSphere(10.2, 22, 16), material: shellMat, scale: [1.08, 0.7, 1.22] });
  addMesh({ parent: thorax, name: 'kaiju_spider_thorax_plate', geometry: hpCone(7.4, 16, 6), material: plateMat, position: [0, 3, 1], rotation: [-0.65, 0, 0], scale: [1.35, 0.75, 1.0] });
  addMesh({ parent: thorax, name: 'kaiju_spider_pedicel', geometry: hpCapsule(2.6, 8, 4, 8), material: shellMat, position: [0, -0.2, -10.8], rotation: [Math.PI / 2, 0, 0], scale: [0.7, 0.7, 0.9] });
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: thorax, name: `kaiju_spider_thorax_blade_${index}`, geometry: hpCone(2.2, 12.5, 5), material: plateMat, position: [side * 6.5, 5.2, 3.4], rotation: [-0.18, 0, side * 0.72], scale: [0.52, 1.0, 1.6] });
  });

  const head = new THREE.Group();
  head.name = 'kaiju_spider_head';
  head.position.set(0, 9.6, 13.5);
  rootNode.add(head);
  addMesh({ parent: head, name: 'kaiju_spider_head_core', geometry: hpSphere(7.8, 18, 14), material: shellMat, scale: [1.0, 0.7, 1.2] });
  addMesh({ parent: head, name: 'kaiju_spider_face_plate', geometry: hpCone(4.8, 10, 6), material: glowMat, position: [0, -0.2, 5.2], rotation: [-0.7, 0, 0], scale: [1.2, 0.8, 0.8] });
  [[-3.0, 1.6, 5.2], [3.0, 1.6, 5.2], [-4.2, 0.1, 4.4], [4.2, 0.1, 4.4], [-1.5, -1.2, 5.4], [1.5, -1.2, 5.4]].forEach(([x, y, z], index) => {
    addMesh({ parent: head, name: `kaiju_spider_eye_${index}`, geometry: hpSphere(index < 2 ? 0.9 : 0.7, 8, 8), material: eyeMat, position: [x, y, z] });
  });
  addMesh({ parent: head, name: 'kaiju_spider_face_crown', geometry: hpCone(2.0, 10.5, 5), material: glowMat, position: [0, 4.4, 4.8], rotation: [-0.42, 0, 0], scale: [0.7, 1.0, 1.2] });
  [-1, 1].forEach((side, pi) => {
    const pedipalp = new THREE.Group();
    pedipalp.name = `kaiju_spider_pedipalp_${pi}`;
    pedipalp.position.set(side * 2.8, -1.8, 4.2);
    head.add(pedipalp);
    addMesh({ parent: pedipalp, name: `kaiju_spider_pedipalp_upper_${pi}`, geometry: hpCapsule(0.8, 4.4, 5, 8), material: plateMat, position: [side * 1.4, -1.3, 1.2], rotation: [0.42, 0, side * 0.28] });
    addMesh({ parent: pedipalp, name: `kaiju_spider_pedipalp_blade_${pi}`, geometry: hpCone(0.8, 4.5, 5), material: fangMat, position: [side * 2.8, -3.8, 2.8], rotation: [0.98, 0, side * 0.4] });
  });

  const anchorZ = [10, 3.5, -4.5, -12];
  anchorZ.forEach((z, row) => {
    [-1, 1].forEach((side) => {
      const legIndex = row * 2 + (side === 1 ? 1 : 0);
      const anchor = [side === -1 ? -8.5 + row * 0.25 : 8.5 - row * 0.25, 9.4 - row * 0.3, z];
      const legGroup = new THREE.Group();
      legGroup.name = `kaiju_spider_leg_${legIndex}`;
      legGroup.position.set(anchor[0], anchor[1], anchor[2]);
      rootNode.add(legGroup);

      const upper = new THREE.Group();
      upper.name = `kaiju_spider_leg_${legIndex}_upper`;
      legGroup.add(upper);
      addMesh({ parent: upper, name: `kaiju_spider_leg_${legIndex}_upper_mesh`, geometry: hpCylinder(1.3, 0.95, 15, 8), material: shellMat, position: [side * 7.5, -0.8, side * 0.4], rotation: [0.06, 0, side * -0.48] });
      addMesh({ parent: upper, name: `kaiju_spider_leg_${legIndex}_upper_joint`, geometry: hpSphere(1.5, 8, 8), material: plateMat, position: [side * 14.2, -1.6, side * 1.4] });

      const mid = new THREE.Group();
      mid.name = `kaiju_spider_leg_${legIndex}_mid`;
      mid.position.set(side * 14.2, -1.6, side * 1.4);
      upper.add(mid);
      addMesh({ parent: mid, name: `kaiju_spider_leg_${legIndex}_mid_mesh`, geometry: hpCylinder(0.98, 0.64, 17.5, 8), material: plateMat, position: [side * 7.9, -4.2, 0], rotation: [0.04, 0, side * 0.24] });
      addMesh({ parent: mid, name: `kaiju_spider_leg_${legIndex}_mid_joint`, geometry: hpSphere(1.18, 8, 8), material: plateMat, position: [side * 15.0, -8.4, 0] });

      const lower = new THREE.Group();
      lower.name = `kaiju_spider_leg_${legIndex}_lower`;
      lower.position.set(side * 15.0, -8.4, 0);
      mid.add(lower);
      addMesh({ parent: lower, name: `kaiju_spider_leg_${legIndex}_lower_mesh`, geometry: hpCylinder(0.62, 0.18, 16.5, 7), material: shellMat, position: [side * 7.4, -5.1, 0.3], rotation: [0.14, 0, side * 0.18] });
      addMesh({ parent: lower, name: `kaiju_spider_leg_${legIndex}_tip`, geometry: hpCone(0.55, 4.8, 5), material: fangMat, position: [side * 14.0, -10.5, 0.7], rotation: [0.2, 0, side * 0.12] });
    });
  });

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// SPICIE BIRD SLOT → "STORM RAY" — aerial arc-creature with manta-like wings,
// lightning vanes, and spear head. Keeps bird node names for runtime hooks.
// ─────────────────────────────────────────────────────────────────────────────
const buildSpicieBird = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spicie_bird';

  const skinMat = makeMaterial({ color: '#243447', roughness: 0.54, metalness: 0.22, map: textures.FEATHERS, mapRepeat: [3.6, 5.2] });
  const edgeMat = makeMaterial({ color: '#3c5c74', roughness: 0.34, metalness: 0.28, map: textures.FEATHERS, mapRepeat: [5.4, 6.4], mapRotation: 0.12 });
  const arcMat = makeMaterial({ color: '#082f49', emissive: '#38bdf8', emissiveIntensity: 1.35, roughness: 0.24, metalness: 0.12, transparent: true, opacity: 0.7 });
  const eyeMat = makeMaterial({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 2.4, roughness: 0.06, metalness: 0.02 });
  const fangMat = makeMaterial({ color: '#e2e8f0', roughness: 0.18, metalness: 0.26 });

  const birdRoot = new THREE.Group();
  birdRoot.name = 'kaiju_bird_root';
  birdRoot.position.set(0, 12, 0);
  group.add(birdRoot);

  addMesh({ parent: birdRoot, name: 'kaiju_bird_body', geometry: hpSphere(13.8, 22, 18), material: skinMat, position: [0, 16, -1], scale: [0.9, 0.72, 1.72] });
  addMesh({ parent: birdRoot, name: 'kaiju_bird_keel', geometry: hpCapsule(4.2, 18, 6, 12), material: edgeMat, position: [0, 13.5, 4], rotation: [Math.PI / 2, 0, 0], scale: [0.6, 1.0, 0.56] });

  const head = new THREE.Group();
  head.name = 'kaiju_bird_head';
  head.position.set(0, 20, 18);
  birdRoot.add(head);
  addMesh({ parent: head, name: 'kaiju_bird_skull', geometry: hpSphere(7.2, 18, 14), material: edgeMat, scale: [0.95, 0.64, 1.26] });
  addMesh({ parent: head, name: 'kaiju_bird_beak', geometry: hpCone(3.0, 12, 8), material: arcMat, position: [0, -0.5, 9], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1.5] });
  [[-2.6, 1.4, 5.4], [2.6, 1.4, 5.4]].forEach(([x, y, z], i) => {
    addMesh({ parent: head, name: `kaiju_bird_eye_${i}`, geometry: hpSphere(1.25, 12, 10), material: eyeMat, position: [x, y, z], scale: [0.62, 1.0, 0.8] });
  });
  addMesh({ parent: head, name: 'kaiju_bird_neck', geometry: hpCapsule(4.2, 12, 6, 12), material: skinMat, position: [0, -10, -6], rotation: [0.32, 0, 0], scale: [0.76, 1.0, 0.7] });
  addMesh({ parent: head, name: 'kaiju_bird_crest', geometry: hpCone(2.4, 11, 6), material: arcMat, position: [0, 7.2, -1.5], rotation: [0.08, 0, 0], scale: [0.56, 1.0, 1.6] });

  const leftWing = new THREE.Group();
  leftWing.name = 'kaiju_bird_left_wing';
  leftWing.position.set(-14.5, 17, -1);
  birdRoot.add(leftWing);
  addMesh({ parent: leftWing, name: 'kaiju_bird_left_wing_bone', geometry: hpCapsule(2.8, 30, 6, 12), material: edgeMat, position: [-15, -1.5, 0], rotation: [0.04, 0, -0.14] });
  addMesh({ parent: leftWing, name: 'kaiju_bird_left_wing_membrane', geometry: hpSphere(1, 10, 8), material: arcMat, position: [-16, -2, 1], scale: [19, 0.72, 10] });
  for (let vane = 0; vane < 5; vane++) {
    addMesh({ parent: leftWing, name: `kaiju_bird_left_vane_${vane}`, geometry: hpCone(1.4 - vane * 0.16, 9 - vane * 0.7, 5), material: edgeMat, position: [-12 - vane * 6.2, -2.2 + vane * 0.35, 3 - vane * 0.8], rotation: [0.14, 0, -0.9 + vane * 0.06], scale: [0.34, 1, 1.5] });
  }
  addMesh({ parent: leftWing, name: 'kaiju_bird_left_arc_blade', geometry: hpCone(2.2, 18, 5), material: arcMat, position: [-36, -3, 4], rotation: [0.08, 0, -1.02], scale: [0.28, 1.0, 2.4] });

  const rightWing = new THREE.Group();
  rightWing.name = 'kaiju_bird_right_wing';
  rightWing.position.set(14.5, 17, -1);
  birdRoot.add(rightWing);
  addMesh({ parent: rightWing, name: 'kaiju_bird_right_wing_bone', geometry: hpCapsule(2.8, 30, 6, 12), material: edgeMat, position: [15, -1.5, 0], rotation: [0.04, 0, 0.14] });
  addMesh({ parent: rightWing, name: 'kaiju_bird_right_wing_membrane', geometry: hpSphere(1, 10, 8), material: arcMat, position: [16, -2, 1], scale: [19, 0.72, 10] });
  for (let vane = 0; vane < 5; vane++) {
    addMesh({ parent: rightWing, name: `kaiju_bird_right_vane_${vane}`, geometry: hpCone(1.4 - vane * 0.16, 9 - vane * 0.7, 5), material: edgeMat, position: [12 + vane * 6.2, -2.2 + vane * 0.35, 3 - vane * 0.8], rotation: [0.14, 0, 0.9 - vane * 0.06], scale: [0.34, 1, 1.5] });
  }
  addMesh({ parent: rightWing, name: 'kaiju_bird_right_arc_blade', geometry: hpCone(2.2, 18, 5), material: arcMat, position: [36, -3, 4], rotation: [0.08, 0, 1.02], scale: [0.28, 1.0, 2.4] });

  const tail = new THREE.Group();
  tail.name = 'kaiju_bird_tail';
  tail.position.set(0, 14, -25);
  birdRoot.add(tail);
  addMesh({ parent: tail, name: 'kaiju_bird_tail_base', geometry: hpSphere(5.5, 14, 12), material: skinMat, scale: [1.0, 0.48, 1.24] });
  addMesh({ parent: tail, name: 'kaiju_bird_tail_fin', geometry: hpCone(6.2, 18, 6), material: edgeMat, rotation: [Math.PI / 2.4, 0, 0], scale: [1.0, 0.4, 1.45] });
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: tail, name: `kaiju_bird_tail_streamer_${index}`, geometry: hpCone(1.2, 14, 5), material: arcMat, position: [side * 3.2, -0.4, -8], rotation: [Math.PI / 2.5, 0, side * 0.18], scale: [0.32, 1.0, 2.4] });
  });

  [-1, 1].forEach((side, li) => {
    addMesh({ parent: birdRoot, name: `kaiju_bird_leg_upper_${li}`,
      geometry: hpCylinder(1.5, 1.2, 8, 10), material: edgeMat, position: [side * 5.5, 8, 9.2], rotation: [0.68, 0, side * 0.1] });
    addMesh({ parent: birdRoot, name: `kaiju_bird_leg_${li}`,
      geometry: hpCylinder(1.0, 0.7, 7, 10), material: edgeMat, position: [side * 5.5, 3.2, 12.6], rotation: [0.92, 0, side * 0.1] });
    for (let c = 0; c < 4; c++) {
      addMesh({ parent: birdRoot, name: `kaiju_bird_claw_${li}_${c}`, geometry: hpCone(0.42, 4.2, 5), material: fangMat, position: [side * (5.5 + (c - 1.5) * 1.2), 0.8, 15.6 + c * 0.5], rotation: [1.1, 0, side * (0.04 + c * 0.06)] });
    }
  });

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// BEETLE SLOT → "CITADEL RAM" — fortress brute with armored shell canopies and
// ram-jaws. Keeps beetle node names for runtime hooks.
// ─────────────────────────────────────────────────────────────────────────────
const buildBeetle = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_beetle';

  const shellMat  = makeMaterial({ color: '#52301f', roughness: 0.42, metalness: 0.24, map: textures.CHITIN, mapRepeat: [4.0, 4.0] });
  const shellMid  = makeMaterial({ color: '#7a4830', roughness: 0.46, metalness: 0.22, map: textures.CHITIN, mapRepeat: [5.2, 4.8], mapRotation: 0.1 });
  const shellDark = makeMaterial({ color: '#2e1a10', roughness: 0.68, metalness: 0.14, map: textures.CHITIN, mapRepeat: [5.6, 5.0] });
  const amberMat  = makeMaterial({ color: '#7c2d12', emissive: '#fb923c', emissiveIntensity: 0.9, roughness: 0.26, metalness: 0.1 });
  const eyeMat    = makeMaterial({ color: '#fde68a', emissive: '#f59e0b', emissiveIntensity: 2.8 });
  const boneMat   = makeMaterial({ color: '#d1d5db', roughness: 0.18, metalness: 0.18 });

  addMesh({ parent: group, name: 'kaiju_beetle_body', geometry: hpSphere(14.5, 24, 18), material: shellDark, position: [0, 22, 0], scale: [1.15, 0.78, 1.68] });
  addMesh({ parent: group, name: 'kaiju_beetle_core', geometry: hpCapsule(8.4, 16, 6, 12), material: amberMat, position: [0, 20, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.52, 0.44, 1.0] });

  addMesh({ parent: group, name: 'kaiju_beetle_elytra', geometry: hpSphere(13.2, 22, 16), material: shellMat, position: [0, 26, -1], scale: [1.2, 0.56, 1.52], rotation: [0.08, 0, 0] });
  addMesh({ parent: group, name: 'kaiju_beetle_suture', geometry: hpCapsule(0.9, 22, 5, 8), material: shellMid, position: [0, 27, -2], rotation: [Math.PI / 2, 0, 0] });

  addMesh({ parent: group, name: 'kaiju_beetle_collar', geometry: hpSphere(10.6, 18, 14), material: shellMid, position: [0, 23, 17], scale: [1.18, 0.64, 0.92] });
  addMesh({ parent: group, name: 'kaiju_beetle_collar_horn', geometry: hpCone(2.6, 13, 6), material: shellDark, position: [0, 28.5, 24], rotation: [-0.3, 0, 0] });
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: group, name: `kaiju_beetle_elytra_tower_${index}`, geometry: hpCone(2.2, 14, 5), material: shellMid, position: [side * 6.2, 35, -4], rotation: [-0.08, 0, side * 0.22], scale: [0.6, 1.0, 1.6] });
  });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_beetle_jaw';
  jaw.position.set(0, 20, 28);
  group.add(jaw);
  addMesh({ parent: jaw, name: 'kaiju_beetle_head', geometry: hpSphere(8.4, 18, 14), material: shellDark, scale: [1.08, 0.74, 1.12] });
  [[-4.9, 2.4, 5.4], [4.9, 2.4, 5.4]].forEach(([x, y, z], index) => {
    addMesh({ parent: jaw, name: `kaiju_beetle_eye_${index}`, geometry: hpSphere(2.0, 12, 10), material: eyeMat, position: [x, y, z] });
  });
  addMesh({ parent: jaw, name: 'kaiju_beetle_horn', geometry: hpCone(3.2, 16, 8), material: shellDark, position: [0, 5.8, 8.2], rotation: [-0.48, 0, 0] });
  addMesh({ parent: jaw, name: 'kaiju_beetle_ram_plate', geometry: hpCone(5.4, 14.5, 6), material: amberMat, position: [0, -0.4, 10.2], rotation: [-0.86, 0, 0], scale: [1.1, 0.72, 0.82] });
  [-1, 1].forEach((side, mi) => {
    addMesh({ parent: jaw, name: `kaiju_beetle_mandible_${mi}`, geometry: hpCapsule(1.6, 10, 6, 8), material: amberMat, position: [side * 6.2, -1.8, 8.6], rotation: [0.28, side * 0.14, side * -0.42] });
    for (let t = 0; t < 3; t++) {
      addMesh({ parent: jaw, name: `kaiju_beetle_mandible_tooth_${mi}_${t}`, geometry: hpCone(0.58, 3.0, 5), material: boneMat, position: [side * (5.4 + t * 0.9), -3.1 - t * 0.45, 10.3 + t * 1.6], rotation: [0.58, side * 0.08, side * (-0.28 + t * 0.06)] });
    }
  });

  for (let row = 0; row < 3; row++) {
    const z = 12 - row * 12;
    [-1, 1].forEach((side, li) => {
      const leg = new THREE.Group();
      leg.name = `kaiju_beetle_leg_${row}_${li}`;
      leg.position.set(side * (8.8 + row * 0.8), 12 - row * 1.1, z);
      leg.rotation.set(0.14, 0, side * (0.82 - row * 0.12));
      group.add(leg);
      addMesh({ parent: leg, name: `kaiju_beetle_leg_${row}_${li}_mesh`, geometry: hpCylinder(1.8 - row * 0.16, 0.58, 20, 8), material: shellDark, position: [side * 7.2, -1.0, 0], rotation: [0.18, 0, side * 0.18] });
      addMesh({ parent: leg, name: `kaiju_beetle_leg_${row}_${li}_spur`, geometry: hpCone(1.0, 4.6, 5), material: shellDark, position: [side * 14.4, -3.0, 1.8], rotation: [0.48, 0, side * 0.24] });
    });
  }

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// WYRM SLOT → "RIFT SERPENT" — plasma leviathan with floating body modules and
// monolithic head. Keeps wyrm node names for runtime hooks.
// ─────────────────────────────────────────────────────────────────────────────
const buildWyrm = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_wyrm';

  const scaleMat  = makeMaterial({ color: '#214637', roughness: 0.62, metalness: 0.12, map: textures.SCALES, mapRepeat: [4.0, 4.8] });
  const scaleDark = makeMaterial({ color: '#10281d', roughness: 0.76, metalness: 0.06, map: textures.SCALES, mapRepeat: [4.8, 5.2] });
  const scaleMid  = makeMaterial({ color: '#3a7d5e', roughness: 0.46, metalness: 0.14, map: textures.SCALES, mapRepeat: [5.6, 5.6] });
  const glowMat   = makeMaterial({ color: '#0b2615', emissive: '#4ade80', emissiveIntensity: 1.1, roughness: 0.22, metalness: 0.12 });
  const deepGlow  = makeMaterial({ color: '#04150a', emissive: '#22c55e', emissiveIntensity: 1.7, roughness: 0.12, metalness: 0.18 });
  const boneMat   = makeMaterial({ color: '#ecfeff', roughness: 0.16, metalness: 0.08 });
  const mawMat    = makeMaterial({ color: '#2f0808', roughness: 0.88, metalness: 0.04, map: textures.ORGANIC_SKIN, mapRepeat: [3.2, 3.2] });
  const eyeMat    = makeMaterial({ color: '#d1fae5', emissive: '#4ade80', emissiveIntensity: 1.3 });

  for (let i = 0; i < 8; i++) {
    const r = 12.8 - i * 0.74;
    const z = -(i * 18.5);
    addMesh({ parent: group, name: `kaiju_wyrm_segment_${i}`, geometry: hpSphere(r, 18, 14), material: i < 2 ? scaleMat : i < 5 ? scaleMid : scaleDark, position: [Math.sin(i * 0.34) * 5.2, 14 - i * 0.6, z], scale: [1.0, 0.76, 1.48] });
    addMesh({ parent: group, name: `kaiju_wyrm_segment_core_${i}`, geometry: hpCapsule(r * 0.26, r * 0.8, 4, 8), material: i % 2 === 0 ? glowMat : deepGlow, position: [Math.sin(i * 0.34) * 5.2, 14 - i * 0.6, z + 0.8], rotation: [Math.PI / 2, 0, 0], scale: [0.6, 0.34, 1.0] });
    if (i < 6) {
      addMesh({ parent: group, name: `kaiju_wyrm_spine_${i}`, geometry: hpCone(2.4 - i * 0.16, 10.5 - i * 0.5, 5), material: i < 2 ? deepGlow : glowMat, position: [Math.sin(i * 0.34) * 5.2, 21 - i * 0.3, z], rotation: [-0.28, 0, i % 2 === 0 ? 0.1 : -0.1] });
    }
  }

  const head = new THREE.Group();
  head.name = 'kaiju_wyrm_head';
  head.position.set(0, 18, 15);
  group.add(head);
  addMesh({ parent: head, name: 'kaiju_wyrm_skull', geometry: hpSphere(9.4, 20, 16), material: scaleDark, scale: [1.0, 0.7, 1.44] });
  addMesh({ parent: head, name: 'kaiju_wyrm_snout', geometry: hpCone(5.4, 16, 6), material: scaleMat, position: [0, -1.2, 12], rotation: [-Math.PI / 2, 0, 0], scale: [1.0, 1.0, 1.3] });
  [[-4.2, 3.2, 9.5], [4.2, 3.2, 9.5]].forEach(([x, y, z], i) => {
    addMesh({ parent: head, name: `kaiju_wyrm_eye_${i}`, geometry: hpSphere(1.7, 12, 10), material: eyeMat, position: [x, y, z] });
  });
  addMesh({ parent: head, name: 'kaiju_wyrm_crest', geometry: hpCapsule(2.4, 15, 6, 12), material: deepGlow, position: [0, 8.5, 3], scale: [0.9, 1.0, 2.4] });
  [-1, 1].forEach((side, index) => {
    addMesh({ parent: head, name: `kaiju_wyrm_head_fin_${index}`, geometry: hpCone(2.2, 12.8, 5), material: glowMat, position: [side * 5.8, 5.2, 4.0], rotation: [-0.12, 0, side * 0.82], scale: [0.46, 1.0, 1.9] });
  });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_wyrm_jaw';
  jaw.position.set(0, -3.5, 6.5);
  head.add(jaw);
  addMesh({ parent: jaw, name: 'kaiju_wyrm_jaw_shell', geometry: hpCone(4.8, 12, 6), material: scaleDark, position: [0, -1.8, 7.5], rotation: [-Math.PI / 2, 0, 0], scale: [1.1, 0.8, 1.0] });
  addMesh({ parent: jaw, name: 'kaiju_wyrm_jaw_maw', geometry: hpSphere(5.5, 12, 10), material: mawMat, position: [0, -1.4, 7.5], scale: [0.85, 0.36, 1.02] });
  [-1, 1].forEach((side, fi) => {
    addMesh({ parent: jaw, name: `kaiju_wyrm_fang_${fi}`, geometry: hpCylinder(0.32, 0.08, 5.6, 8), material: boneMat, position: [side * 2.9, -0.6, 9.4], rotation: [0.5, side * 0.12, side * -0.16] });
    addMesh({ parent: jaw, name: `kaiju_wyrm_tooth_${fi}`, geometry: hpCone(0.62, 3.9, 5), material: boneMat, position: [side * 1.5, 0.4, 10.0], rotation: [Math.PI / 2, 0, 0] });
  });
  addMesh({ parent: jaw, name: 'kaiju_wyrm_tongue', geometry: hpCapsule(0.8, 7, 4, 8), material: deepGlow, position: [0, -1, 8.5], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.42] });
  for (let i = 0; i < 5; i++) {
    addMesh({ parent: group, name: `kaiju_wyrm_side_fin_${i}`, geometry: hpCone(1.6 - i * 0.14, 10 - i * 0.5, 5), material: i % 2 === 0 ? glowMat : deepGlow, position: [8.8 + i * 0.8, 16 - i * 0.3, -(i * 18.5) - 2], rotation: [0.12, 0, 1.02], scale: [0.34, 1.0, 2.0] });
    addMesh({ parent: group, name: `kaiju_wyrm_side_fin_mirror_${i}`, geometry: hpCone(1.6 - i * 0.14, 10 - i * 0.5, 5), material: i % 2 === 0 ? glowMat : deepGlow, position: [-8.8 - i * 0.8, 16 - i * 0.3, -(i * 18.5) - 2], rotation: [0.12, 0, -1.02], scale: [0.34, 1.0, 2.0] });
  }

  return group;
};

[(() => {
  const godzilla = buildGodzilla();
  const burningGodzilla = tintGodzillaVariant(godzilla, {
    groupName: 'kaiju_burning_godzilla',
    baseColor: '#3a2621',
    darkColor: '#1b0d0a',
    plateColor: '#6a3423',
    seamColor: '#29140f',
    seamEmissive: '#ff6b2c',
    seamIntensity: 2.35,
    eyeColor: '#fde68a',
    eyeEmissive: '#fb923c',
    eyeIntensity: 3.8,
    mawColor: '#5a1711',
    boneColor: '#f5d0c5',
    spinePrimary: '#ff7a18',
    spineSecondary: '#ffb347',
    scale: [1.03, 1.0, 1.03]
  });
  const mechaGodzilla = tintGodzillaVariant(godzilla, {
    groupName: 'kaiju_mecha_godzilla',
    baseColor: '#5b6776',
    darkColor: '#2b3440',
    plateColor: '#8ea0b5',
    seamColor: '#132433',
    seamEmissive: '#38bdf8',
    seamIntensity: 2.0,
    eyeColor: '#dbeafe',
    eyeEmissive: '#7dd3fc',
    eyeIntensity: 3.4,
    mawColor: '#3b0f18',
    boneColor: '#d1d5db',
    spinePrimary: '#67e8f9',
    spineSecondary: '#93c5fd',
    scale: [1.01, 1.0, 1.0]
  });
  return [godzilla, burningGodzilla, mechaGodzilla];
})(),
  buildOctopus(),
  buildSpider(),
  buildSpicieBird(),
  buildBeetle(),
  buildWyrm()
].flat().forEach((group) => root.add(group));

const scene = new THREE.Scene();
scene.add(root);

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
