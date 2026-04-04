import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { installPolyfills, textures } from './falloutTextureUtils.mjs';

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
  const m = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: !transparent,
    ...(side !== undefined ? { side } : {})
  });
  if (map !== undefined) {
    m.map = mapRepeat ? tileMap(map, mapRepeat, mapRotation, mapOffset) : map;
  }
  return m;
};

// ── High-poly geometry wrappers — enforce smooth minimum segment counts ──
// These are drop-in replacements that clamp segment parameters to a floor
// so every curved surface renders smooth instead of faceted / LEGO-like.
const hpSphere = (r, ws, hs, ...rest) =>
  new THREE.SphereGeometry(r, Math.max(ws || 32, 32), Math.max(hs || 24, 24), ...rest);

const hpCapsule = (r, len, capSeg, radSeg) =>
  new THREE.CapsuleGeometry(r, len, Math.max(capSeg || 16, 16), Math.max(radSeg || 32, 32));

const hpCylinder = (rTop, rBot, h, radSeg, ...rest) =>
  new THREE.CylinderGeometry(rTop, rBot, h, Math.max(radSeg || 32, 24), ...rest);

const hpCone = (r, h, radSeg, ...rest) =>
  new THREE.ConeGeometry(r, h, Math.max(radSeg || 16, 12), ...rest);

const hpTorus = (r, tube, radSeg, tubSeg, ...rest) =>
  new THREE.TorusGeometry(r, tube, Math.max(radSeg || 20, 16), Math.max(tubSeg || 48, 36), ...rest);

const addMesh = ({
  parent,
  name,
  geometry,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1]
}) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  parent.add(mesh);
  return mesh;
};

// ─────────────────────────────────────────────────────────────────────────────
// GODZILLA — thick organic build, layered hide, heavy limbs, no gap joints
// ─────────────────────────────────────────────────────────────────────────────
const buildGodzilla = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_godzilla';

  const hideMat      = makeMaterial({ color: '#35506a', roughness: 0.72, metalness: 0.14, map: textures.SCALES, mapRepeat: [3.4, 2.8], mapRotation: 0.08 });
  const hideDarkMat  = makeMaterial({ color: '#223647', roughness: 0.78, metalness: 0.12, map: textures.SCALES, mapRepeat: [4.2, 3.1], mapRotation: -0.06, mapOffset: [0.12, 0.04] });
  const hideRidgeMat = makeMaterial({ color: '#4e6d88', roughness: 0.56, metalness: 0.24, map: textures.SCALES, mapRepeat: [5.1, 3.4], mapRotation: 0.16, mapOffset: [0.2, 0.1] });
  const underbodyMat = makeMaterial({ color: '#476b44', roughness: 0.66, metalness: 0.08, map: textures.ORGANIC_SKIN, mapRepeat: [2.6, 4.2], mapRotation: -0.1 });
  const boneMat      = makeMaterial({ color: '#c8c0b4', roughness: 0.22, metalness: 0.18 });
  const seamMat      = makeMaterial({ color: '#1a3f10', emissive: '#22c55e', emissiveIntensity: 1.6, roughness: 0.18, metalness: 0.22 });
  const eyeMat       = makeMaterial({ color: '#ff4444', emissive: '#ff0000', emissiveIntensity: 3.5, roughness: 0.05, metalness: 0.0 });
  const mawMat       = makeMaterial({ color: '#4a1208', roughness: 0.88, metalness: 0.04, map: textures.ORGANIC_SKIN, mapRepeat: [3.2, 2.8], mapRotation: 0.12 });
  const spineGlowMat = (i) => makeMaterial({ color: '#061208', emissive: '#00ff66', emissiveIntensity: i % 3 === 0 ? 1.8 : 0.65, roughness: 0.15, metalness: 0.22 });

  // ── PELVIS (large fused hip mass, no gap to torso) ──
  addMesh({
    parent: group, name: 'kaiju_godzilla_pelvis',
    geometry: hpSphere(16, 22, 16),
    material: hideDarkMat,
    position: [0, 18, -6],
    scale: [1.15, 0.88, 1.28]
  });
  // hip overlap fill — bridges pelvis→torso seam
  addMesh({
    parent: group, name: 'kaiju_godzilla_hip_fill',
    geometry: hpSphere(13, 18, 14),
    material: hideDarkMat,
    position: [0, 25, -1],
    scale: [1.05, 1.0, 1.1]
  });

  // ── TORSO ──
  addMesh({
    parent: group, name: 'kaiju_godzilla_torso',
    geometry: hpCapsule(15, 30, 12, 18),
    material: hideMat,
    position: [0, 36, 2],
    rotation: [0.1, 0, 0],
    scale: [1.12, 1.22, 1.08]
  });
  // belly underbody plate
  addMesh({
    parent: group, name: 'kaiju_godzilla_belly',
    geometry: hpCapsule(10, 22, 8, 14),
    material: underbodyMat,
    position: [0, 34, 10],
    rotation: [-0.12, 0, 0],
    scale: [0.82, 1.1, 0.68]
  });
  // chest ridge panels (left / right)
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group, name: `kaiju_godzilla_pec_${side < 0 ? 'l' : 'r'}`,
      geometry: hpSphere(9, 14, 12),
      material: hideRidgeMat,
      position: [side * 9, 40, 8],
      scale: [0.7, 0.55, 0.9]
    });
  });
  // chest seam glow
  addMesh({
    parent: group, name: 'kaiju_godzilla_chest_seam',
    geometry: hpCapsule(3.2, 18, 6, 10),
    material: seamMat,
    position: [0, 36, 15.2],
    rotation: [0.06, 0, 0]
  });
  // shoulder bridge fills (removes gap between arm & torso)
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group, name: `kaiju_godzilla_shoulder_fill_${side < 0 ? 0 : 1}`,
      geometry: hpSphere(7.5, 12, 10),
      material: hideDarkMat,
      position: [side * 14.5, 40, 5],
      scale: [1.0, 0.82, 0.88]
    });
  });

  // ── HEAD GROUP ──
  const head = new THREE.Group();
  head.name = 'kaiju_godzilla_head';
  head.position.set(0, 58, 14);
  group.add(head);

  // main skull
  addMesh({
    parent: head, name: 'kaiju_godzilla_skull',
    geometry: hpSphere(10.5, 20, 16),
    material: hideDarkMat,
    rotation: [0, 0, 0],
    scale: [1.0, 0.82, 1.42]
  });
  // brow ridge
  addMesh({
    parent: head, name: 'kaiju_godzilla_brow',
    geometry: hpCapsule(8.5, 6, 6, 12),
    material: hideRidgeMat,
    position: [0, 5.5, 7],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 0.38, 0.72]
  });
  // snout — tapered, broad base
  addMesh({
    parent: head, name: 'kaiju_godzilla_snout',
    geometry: hpCylinder(5, 8.5, 14, 14),
    material: hideDarkMat,
    position: [0, -2.4, 12.5],
    rotation: [Math.PI / 2, 0, 0]
  });
  // cheek pads
  [-1, 1].forEach((side) => {
    addMesh({
      parent: head, name: `kaiju_godzilla_cheek_${side < 0 ? 0 : 1}`,
      geometry: hpSphere(5.5, 12, 10),
      material: hideRidgeMat,
      position: [side * 7.5, -0.5, 8],
      scale: [0.72, 0.58, 0.88]
    });
  });
  // eyes
  [[-5.8, 4.6, 10.8], [5.8, 4.6, 10.8]].forEach(([x, y, z], i) => {
    addMesh({
      parent: head, name: `kaiju_godzilla_eye_${i}`,
      geometry: hpSphere(2.1, 14, 12),
      material: eyeMat,
      position: [x, y, z]
    });
    // eye socket recess
    addMesh({
      parent: head, name: `kaiju_godzilla_eye_socket_${i}`,
      geometry: hpSphere(3.6, 10, 8),
      material: hideDarkMat,
      position: [x, y - 0.3, z - 1.0],
      scale: [1, 0.72, 0.72]
    });
  });
  // neck fill (head→torso bridge)
  addMesh({
    parent: head, name: 'kaiju_godzilla_neck',
    geometry: hpCylinder(9.5, 13, 16, 14),
    material: hideMat,
    position: [0, -10, -6],
    rotation: [0.22, 0, 0]
  });

  // ── JAW GROUP ──
  const jaw = new THREE.Group();
  jaw.name = 'kaiju_godzilla_jaw';
  jaw.position.set(0, -5.5, 5.5);
  head.add(jaw);

  addMesh({
    parent: jaw, name: 'kaiju_godzilla_jaw_shell',
    geometry: hpCylinder(7, 8.5, 10, 14),
    material: hideDarkMat,
    position: [0, -3.2, 5.5],
    rotation: [Math.PI / 2, 0, 0]
  });
  // maw interior
  addMesh({
    parent: jaw, name: 'kaiju_godzilla_jaw_maw',
    geometry: hpSphere(6.5, 12, 10),
    material: mawMat,
    position: [0, -1.8, 6.8],
    scale: [0.88, 0.42, 1.1]
  });
  // teeth row — tapered natural cones
  for (let i = 0; i < 12; i++) {
    addMesh({
      parent: jaw, name: `kaiju_godzilla_tooth_${i}`,
      geometry: hpCone(0.62 - (i % 3) * 0.1, 4.8 - (i % 4) * 0.6, 5),
      material: boneMat,
      position: [-5.5 + i * 1.0, 1.2, 10.2 - (i % 2) * 1.4],
      rotation: [Math.PI / 2, 0, i % 2 === 0 ? 0.08 : -0.08]
    });
  }

  // ── ARMS — thick, overlapping upper/lower, fused shoulder fill ──
  [-1, 1].forEach((side, index) => {
    const arm = new THREE.Group();
    arm.name = `kaiju_godzilla_arm_${index}`;
    arm.position.set(side * 17, 40, 6);
    group.add(arm);

    // shoulder cap
    addMesh({
      parent: arm, name: `kaiju_godzilla_shoulder_cap_${index}`,
      geometry: hpSphere(6.5, 14, 12),
      material: hideRidgeMat,
      position: [0, 0, 0],
      scale: [1.0, 0.85, 0.9]
    });
    // upper arm
    addMesh({
      parent: arm, name: `kaiju_godzilla_arm_upper_${index}`,
      geometry: hpCapsule(5.2, 14, 8, 14),
      material: hideDarkMat,
      position: [side * 3.5, -7, 2.5],
      rotation: [0.18, 0, side * -0.72]
    });
    // elbow sphere (smooths transition)
    addMesh({
      parent: arm, name: `kaiju_godzilla_elbow_${index}`,
      geometry: hpSphere(4.8, 12, 10),
      material: hideDarkMat,
      position: [side * 9.5, -11, 5],
      scale: [0.88, 0.78, 0.88]
    });
    // lower arm
    addMesh({
      parent: arm, name: `kaiju_godzilla_arm_lower_${index}`,
      geometry: hpCapsule(3.8, 12, 8, 12),
      material: hideMat,
      position: [side * 13, -14, 7],
      rotation: [0.26, 0, side * -0.32]
    });
    // hand claws
    for (let c = 0; c < 3; c++) {
      addMesh({
        parent: arm, name: `kaiju_godzilla_claw_${index}_${c}`,
        geometry: hpCone(0.9, 5.5, 6),
        material: boneMat,
        position: [side * (16 + c * 1.6), -18 + c * 0.5, 9 + c * 0.5],
        rotation: [0.6, 0, side * (-0.2 + c * 0.12)]
      });
    }
  });

  // ── LEGS — massive, pillar-like, overlapping thigh/shin/foot ──
  [-1, 1].forEach((side, index) => {
    const leg = new THREE.Group();
    leg.name = `kaiju_godzilla_leg_${index}`;
    leg.position.set(side * 13, 8, -2);
    group.add(leg);

    // thigh mass
    addMesh({
      parent: leg, name: `kaiju_godzilla_thigh_${index}`,
      geometry: hpCapsule(8, 16, 10, 16),
      material: hideMat,
      position: [0, 0, 0],
      rotation: [0.08, 0, side * -0.12],
      scale: [0.92, 1.12, 1.05]
    });
    // knee fill sphere
    addMesh({
      parent: leg, name: `kaiju_godzilla_knee_${index}`,
      geometry: hpSphere(7.5, 14, 12),
      material: hideRidgeMat,
      position: [0, -13.5, 3.5],
      scale: [0.88, 0.78, 0.92]
    });
    // shin
    addMesh({
      parent: leg, name: `kaiju_godzilla_shin_${index}`,
      geometry: hpCapsule(5.5, 18, 8, 14),
      material: hideDarkMat,
      position: [0, -20, 6],
      rotation: [0.2, 0, side * 0.04]
    });
    // ankle fill
    addMesh({
      parent: leg, name: `kaiju_godzilla_ankle_${index}`,
      geometry: hpSphere(5.8, 12, 10),
      material: hideDarkMat,
      position: [0, -30, 9],
      scale: [1.0, 0.72, 0.88]
    });
    // foot pad
    addMesh({
      parent: leg, name: `kaiju_godzilla_foot_${index}`,
      geometry: hpCylinder(5, 8.5, 5.5, 14),
      material: hideDarkMat,
      position: [0, -35, 13]
    });
    // toe claws
    for (let t = 0; t < 4; t++) {
      addMesh({
        parent: leg, name: `kaiju_godzilla_toe_${index}_${t}`,
        geometry: hpCone(1.2, 6.5, 6),
        material: boneMat,
        position: [(t - 1.5) * 3, -37, 17 + t * 0.4],
        rotation: [0.72, 0, (t - 1.5) * 0.1]
      });
    }
  });

  // ── TAIL — graduated spheres that blend into each other ──
  for (let i = 0; i < 9; i++) {
    const r = 10 - i * 0.78;
    addMesh({
      parent: group, name: `kaiju_godzilla_tail_${i}`,
      geometry: hpSphere(r, 16, 14),
      material: hideDarkMat,
      position: [Math.sin(i * 0.28) * 2, 14 - i * 1.2, -26 - i * 11.5],
      scale: [1.0, 0.84, 1.45]
    });
  }
  // tail tip
  addMesh({
    parent: group, name: 'kaiju_godzilla_tail_tip',
    geometry: hpCone(2.8, 10, 10),
    material: hideDarkMat,
    position: [Math.sin(9 * 0.28) * 2, 14 - 9 * 1.2, -26 - 9 * 11.5],
    rotation: [Math.PI / 2, 0, 0]
  });

  // ── DORSAL SPINES — elaborate layered blades ──
  for (let i = 0; i < 8; i++) {
    const w = 3.2 - i * 0.15;
    const h = 13 + i * 0.4;
    // main blade
    addMesh({
      parent: group, name: `kaiju_godzilla_spine_${i}`,
      geometry: hpCone(w, h, 6),
      material: spineGlowMat(i),
      position: [0, 50 - i * 4.8, -6 - i * 4.2],
      rotation: [-0.42, 0, i % 2 === 0 ? 0.12 : -0.12]
    });
    // sub-blade on each side
    [-1, 1].forEach((side) => {
      addMesh({
        parent: group, name: `kaiju_godzilla_spine_sub_${i}_${side < 0 ? 0 : 1}`,
        geometry: hpCone(w * 0.48, h * 0.6, 5),
        material: spineGlowMat(i + 1),
        position: [side * (w + 0.8), 49 - i * 4.8, -6 - i * 4.2],
        rotation: [-0.42, side * 0.22, side * 0.38]
      });
    });
  }

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// OCTOPUS — smooth bulging mantle, flowing tentacles, layered skin texture
// ─────────────────────────────────────────────────────────────────────────────
const buildOctopus = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_octopus';

  const mantleMat   = makeMaterial({ color: '#39206f', roughness: 0.3, metalness: 0.28, map: textures.ORGANIC_SKIN, mapRepeat: [3.4, 4.8], mapRotation: 0.14 });
  const mantleMid   = makeMaterial({ color: '#54308d', roughness: 0.36, metalness: 0.24, map: textures.ORGANIC_SKIN, mapRepeat: [4.4, 5.4], mapRotation: -0.12, mapOffset: [0.08, 0.02] });
  const membraneMat = makeMaterial({ color: '#3a1280', roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
  const innerGlow   = makeMaterial({ color: '#6020cc', emissive: '#00ffaa', emissiveIntensity: 1.4, roughness: 0.14, metalness: 0.1, transparent: true, opacity: 0.6 });
  const darkMat     = makeMaterial({ color: '#221145', roughness: 0.78, metalness: 0.06, map: textures.ORGANIC_SKIN, mapRepeat: [5.2, 5.2], mapRotation: 0.2, mapOffset: [0.18, 0.1] });
  const eyeMat      = makeMaterial({ color: '#e0aaff', emissive: '#cc44ff', emissiveIntensity: 3.0, roughness: 0.05, metalness: 0.0 });
  const suckerMat   = makeMaterial({ color: '#4a1870', roughness: 0.52, metalness: 0.12, map: textures.ORGANIC_SKIN, mapRepeat: [6.4, 6.4], mapRotation: 0.08 });
  const toxicMat    = makeMaterial({ color: '#2e0e60', emissive: '#00ff88', emissiveIntensity: 1.2, roughness: 0.18, metalness: 0.12 });

  // ── MANTLE — multi-layer bulging dome ──
  addMesh({
    parent: group, name: 'kaiju_octopus_mantle',
    geometry: hpSphere(14.5, 24, 18),
    material: mantleMat,
    position: [0, 22, 0],
    scale: [1.12, 1.32, 1.12]
  });
  // inner glow layer (gives subsurface feel)
  addMesh({
    parent: group, name: 'kaiju_octopus_mantle_glow',
    geometry: hpSphere(13, 20, 16),
    material: innerGlow,
    position: [0, 22, 0],
    scale: [1.04, 1.22, 1.04]
  });
  // mantle texture ridge ring
  addMesh({
    parent: group, name: 'kaiju_octopus_mantle_ridge',
    geometry: hpTorus(11, 2.4, 10, 28),
    material: mantleMid,
    position: [0, 18, 0],
    rotation: [Math.PI / 2, 0, 0]
  });
  // siphon nozzle
  addMesh({
    parent: group, name: 'kaiju_octopus_siphon',
    geometry: hpCylinder(2.2, 3.6, 10, 12),
    material: darkMat,
    position: [6, 14, -5],
    rotation: [0.5, 0.3, 0.2]
  });

  // ── MEMBRANE SKIRT ──
  addMesh({
    parent: group, name: 'kaiju_octopus_membrane',
    geometry: hpSphere(13.5, 22, 14, 0, Math.PI * 2, 0, Math.PI / 1.7),
    material: membraneMat,
    position: [0, 23, 0],
    scale: [1.32, 1.04, 1.32]
  });

  // ── BEAK — complex multi-part ──
  addMesh({
    parent: group, name: 'kaiju_octopus_beak',
    geometry: hpCone(5.2, 11, 12),
    material: darkMat,
    position: [0, 8.5, 7.5],
    rotation: [Math.PI / 3.8, 0, 0]
  });
  addMesh({
    parent: group, name: 'kaiju_octopus_beak_lower',
    geometry: hpCone(4.5, 8.5, 12),
    material: darkMat,
    position: [0, 6.2, 8.8],
    rotation: [-Math.PI / 3.2, 0, 0],
    scale: [0.9, 1, 0.9]
  });

  // ── EYES — large, jewel-like ──
  [
    [-5.2, 16.5, 11.2], [5.2, 16.5, 11.2],
    [-2.2, 14.5, 13.8], [2.2, 14.5, 13.8]
  ].forEach(([x, y, z], i) => {
    addMesh({
      parent: group, name: `kaiju_octopus_eye_${i}`,
      geometry: hpSphere(i < 2 ? 2.2 : 1.4, 14, 12),
      material: eyeMat,
      position: [x, y, z]
    });
    // orbital ring
    addMesh({
      parent: group, name: `kaiju_octopus_orbital_${i}`,
      geometry: hpTorus(i < 2 ? 2.6 : 1.8, 0.7, 8, 18),
      material: toxicMat,
      position: [x, y, z - 0.4]
    });
  });

  // ── TENTACLES — each with 3 segments, irregular curves, sucker rings ──
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const tentacle = new THREE.Group();
    tentacle.name = `kaiju_octopus_tentacle_${i}`;
    tentacle.position.set(Math.cos(angle) * 7, 10, Math.sin(angle) * 7);
    tentacle.rotation.set(0.85, angle, 0);
    group.add(tentacle);

    // root segment — thick
    addMesh({
      parent: tentacle, name: `kaiju_octopus_tentacle_root_${i}`,
      geometry: hpCylinder(3.2, 2.4, 14, 12),
      material: mantleMid,
      position: [0, -2, 9]
    });
    // mid segment
    addMesh({
      parent: tentacle, name: `kaiju_octopus_tentacle_upper_${i}`,
      geometry: hpCylinder(2.4, 1.8, 16, 12),
      material: mantleMat,
      position: [0, -6, 18],
      rotation: [0.38 + Math.sin(i) * 0.12, 0, 0]
    });
    // lower taper
    addMesh({
      parent: tentacle, name: `kaiju_octopus_tentacle_lower_${i}`,
      geometry: hpCylinder(1.6, 0.28, 20, 10),
      material: makeMaterial({ color: '#3b0764', roughness: 0.58, metalness: 0.1 }),
      position: [0, -12, 30],
      rotation: [0.55 + Math.sin(i + 1) * 0.1, 0, Math.cos(i) * 0.08]
    });
    // sucker row
    for (let s = 0; s < 5; s++) {
      addMesh({
        parent: tentacle, name: `kaiju_octopus_sucker_${i}_${s}`,
        geometry: hpCylinder(0.7, 0.9, 0.8, 8),
        material: suckerMat,
        position: [0, -4 + s * (-3.4), 11 + s * 4.2],
        rotation: [Math.PI / 2 + 0.38 + s * 0.08, 0, 0]
      });
    }
  }

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// SPIDER — chitin-armoured, segmented abdomen, compound eyes, fluid leg joints
// ─────────────────────────────────────────────────────────────────────────────
const buildSpider = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spider';

  const chitinMat     = makeMaterial({ color: '#2b3440', roughness: 0.72, metalness: 0.12, map: textures.CHITIN, mapRepeat: [4.8, 4.4], mapRotation: 0.1 });
  const chitinSoftMat = makeMaterial({ color: '#3a4758', roughness: 0.66, metalness: 0.16, map: textures.CHITIN, mapRepeat: [5.4, 4.8], mapRotation: -0.06, mapOffset: [0.12, 0.06] });
  const chitinShine   = makeMaterial({ color: '#526273', roughness: 0.26, metalness: 0.44, map: textures.CHITIN, mapRepeat: [6.0, 5.4], mapRotation: 0.16, mapOffset: [0.06, 0.14] });
  const woundMat      = makeMaterial({ color: '#2a0404', emissive: '#cc0000', emissiveIntensity: 1.2, roughness: 0.82, metalness: 0.04 });
  const eyeMat        = makeMaterial({ color: '#ff2222', emissive: '#ff0000', emissiveIntensity: 3.5, roughness: 0.05, metalness: 0.0 });
  const fangMat       = makeMaterial({ color: '#f0ece8', roughness: 0.1, metalness: 0.32 });

  const rootNode = new THREE.Group();
  rootNode.name = 'kaiju_spider_root';
  rootNode.position.set(0, 4.8, 0);
  group.add(rootNode);

  // ── ABDOMEN ──
  const abdomen = new THREE.Group();
  abdomen.name = 'kaiju_spider_abdomen';
  abdomen.position.set(0, 16, -22);
  rootNode.add(abdomen);

  addMesh({
    parent: abdomen, name: 'kaiju_spider_abdomen_core',
    geometry: hpSphere(12.5, 22, 18),
    material: chitinMat,
    scale: [1.08, 0.92, 1.82]
  });
  addMesh({
    parent: abdomen, name: 'kaiju_spider_abdomen_mark',
    geometry: hpSphere(8, 16, 12),
    material: chitinShine,
    position: [0, 3, 2],
    scale: [0.48, 0.3, 1.2]
  });
  addMesh({
    parent: abdomen, name: 'kaiju_spider_abdomen_sac',
    geometry: hpSphere(6.5, 14, 12),
    material: woundMat,
    position: [0, 1, 0.5],
    scale: [0.55, 0.32, 0.88]
  });
  for (let s = 0; s < 4; s++) {
    const sx = (s % 2 === 0 ? -1 : 1) * 2.4;
    const sz = (s < 2 ? -11 : -14);
    addMesh({
      parent: abdomen, name: `kaiju_spider_spinneret_${s}`,
      geometry: hpCylinder(0.8, 1.4, 3.5, 8),
      material: chitinSoftMat,
      position: [sx, -2.5, sz],
      rotation: [Math.PI / 2.4, 0, 0]
    });
  }
  for (let r = 0; r < 5; r++) {
    addMesh({
      parent: abdomen, name: `kaiju_spider_abdomen_ridge_${r}`,
      geometry: hpTorus(8.5 - r * 0.6, 0.9, 8, 22),
      material: chitinShine,
      position: [0, 0.5 - r * 1.8, -2 - r * 0.8],
      rotation: [0.12, 0, 0],
      scale: [1, 0.3, 1.65]
    });
  }
  [[-2.8, 8.8, -2], [0, 9.8, 2.5], [2.8, 8.2, 5.5]].forEach(([x, y, z], i) => {
    addMesh({
      parent: abdomen, name: `kaiju_spider_abdomen_spine_${i}`,
      geometry: hpCone(1.1 - i * 0.1, 5.8 - i * 0.4, 5),
      material: chitinSoftMat,
      position: [x, y, z],
      rotation: [-0.6, i * 0.2, 0]
    });
  });

  // ── THORAX ──
  const thorax = new THREE.Group();
  thorax.name = 'kaiju_spider_thorax';
  thorax.position.set(0, 11.5, -1.5);
  rootNode.add(thorax);

  addMesh({
    parent: thorax, name: 'kaiju_spider_thorax_core',
    geometry: hpSphere(10.5, 20, 16),
    material: chitinSoftMat,
    scale: [1.14, 0.72, 1.24]
  });
  addMesh({
    parent: thorax, name: 'kaiju_spider_thorax_plate',
    geometry: hpSphere(9.5, 16, 14),
    material: chitinShine,
    position: [0, 1.5, 0],
    scale: [1.0, 0.38, 1.15]
  });
  addMesh({
    parent: thorax, name: 'kaiju_spider_pedicel',
    geometry: hpSphere(4.2, 12, 10),
    material: chitinMat,
    position: [0, -0.5, -12],
    scale: [0.82, 0.92, 0.72]
  });

  // ── HEAD ──
  const head = new THREE.Group();
  head.name = 'kaiju_spider_head';
  head.position.set(0, 9.8, 14);
  rootNode.add(head);

  addMesh({
    parent: head, name: 'kaiju_spider_head_core',
    geometry: hpSphere(7.5, 18, 14),
    material: chitinMat,
    scale: [1.06, 0.76, 1.18]
  });
  addMesh({
    parent: head, name: 'kaiju_spider_face_plate',
    geometry: hpSphere(5.5, 14, 12),
    material: woundMat,
    position: [0, 0.4, 5.2],
    scale: [0.82, 0.2, 0.48]
  });
  addMesh({
    parent: head, name: 'kaiju_spider_clypeus',
    geometry: hpCapsule(5.8, 2, 6, 12),
    material: chitinShine,
    position: [0, 2.8, 4.5],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 0.32, 0.68]
  });
  // compound eye array
  [
    [-3.2, 2.2, 5.5], [3.2, 2.2, 5.5],
    [-4.8, 0.5, 4.8], [4.8, 0.5, 4.8],
    [-1.6, -0.9, 5.8], [1.6, -0.9, 5.8],
    [-3.0, -0.5, 5.2], [3.0, -0.5, 5.2]
  ].forEach(([x, y, z], i) => {
    addMesh({
      parent: head, name: `kaiju_spider_eye_${i}`,
      geometry: hpSphere(i < 4 ? 0.88 : 0.64, 10, 8),
      material: eyeMat,
      position: [x, y, z]
    });
  });
  // chelicerae
  [-1, 1].forEach((side, ci) => {
    addMesh({
      parent: head, name: `kaiju_spider_chelicera_${ci}`,
      geometry: hpCapsule(1.4, 5.5, 6, 10),
      material: chitinSoftMat,
      position: [side * 3.2, -2.5, 5.8],
      rotation: [0.72, 0, side * 0.12]
    });
    addMesh({
      parent: head, name: `kaiju_spider_fang_${ci}`,
      geometry: hpCylinder(0.28, 0.06, 6.8, 8),
      material: fangMat,
      position: [side * 2.8, -6.2, 7.5],
      rotation: [1.1, side * 0.12, side * -0.2]
    });
  });
  // pedipalps
  [-1, 1].forEach((side, pi) => {
    const pedipalp = new THREE.Group();
    pedipalp.name = `kaiju_spider_pedipalp_${pi}`;
    pedipalp.position.set(side * 2.8, -1.8, 4.2);
    head.add(pedipalp);
    addMesh({
      parent: pedipalp, name: `kaiju_spider_pedipalp_upper_${pi}`,
      geometry: hpCapsule(0.72, 4.8, 5, 8),
      material: chitinSoftMat,
      position: [side * 1.4, -1.2, 1.4],
      rotation: [0.42, 0, side * 0.28]
    });
    addMesh({
      parent: pedipalp, name: `kaiju_spider_pedipalp_mesh_${pi}`,
      geometry: hpCapsule(0.56, 3.8, 4, 8),
      material: chitinMat,
      position: [side * 2.8, -3.5, 2.5],
      rotation: [0.68, 0, side * 0.38]
    });
  });

  // ── LEGS — 4 per side, 3 segments each ──
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
      addMesh({
        parent: upper, name: `kaiju_spider_leg_${legIndex}_upper_mesh`,
        geometry: hpCylinder(1.28, 1.05, 15, 10),
        material: chitinMat,
        position: [side * 7.5, -0.8, side * 0.4],
        rotation: [0.08, 0, side * -0.5]
      });
      addMesh({
        parent: upper, name: `kaiju_spider_leg_${legIndex}_upper_joint`,
        geometry: hpSphere(1.6, 10, 8),
        material: chitinShine,
        position: [side * 14.5, -1.6, side * 1.6]
      });

      const mid = new THREE.Group();
      mid.name = `kaiju_spider_leg_${legIndex}_mid`;
      mid.position.set(side * 14.5, -1.6, side * 1.6);
      upper.add(mid);
      addMesh({
        parent: mid, name: `kaiju_spider_leg_${legIndex}_mid_mesh`,
        geometry: hpCylinder(0.96, 0.72, 17, 10),
        material: chitinSoftMat,
        position: [side * 7.8, -4.2, 0],
        rotation: [0.08, 0, side * 0.28]
      });
      addMesh({
        parent: mid, name: `kaiju_spider_leg_${legIndex}_mid_joint`,
        geometry: hpSphere(1.2, 10, 8),
        material: chitinShine,
        position: [side * 14.8, -8.2, 0]
      });

      const lower = new THREE.Group();
      lower.name = `kaiju_spider_leg_${legIndex}_lower`;
      lower.position.set(side * 14.8, -8.2, 0);
      mid.add(lower);
      addMesh({
        parent: lower, name: `kaiju_spider_leg_${legIndex}_lower_mesh`,
        geometry: hpCylinder(0.6, 0.22, 16.5, 8),
        material: chitinSoftMat,
        position: [side * 7.5, -5.0, 0.4],
        rotation: [0.14, 0, side * 0.22]
      });
      addMesh({
        parent: lower, name: `kaiju_spider_leg_${legIndex}_tip`,
        geometry: hpCone(0.52, 4.5, 6),
        material: fangMat,
        position: [side * 14.2, -10.2, 0.8],
        rotation: [0.24, 0, side * 0.14]
      });
    });
  });

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// SPICIE BIRD — pterodactyl-like, layered feather-plate wings, talons
// ─────────────────────────────────────────────────────────────────────────────
const buildSpicieBird = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spicie_bird';

  const featherMat  = makeMaterial({ color: '#2b3646', roughness: 0.58, metalness: 0.18, map: textures.FEATHERS, mapRepeat: [3.8, 6.2], mapRotation: 0.04 });
  const featherDark = makeMaterial({ color: '#202b38', roughness: 0.64, metalness: 0.14, map: textures.FEATHERS, mapRepeat: [4.6, 7.0], mapRotation: -0.08, mapOffset: [0.1, 0.02] });
  const featherMid  = makeMaterial({ color: '#445468', roughness: 0.46, metalness: 0.24, map: textures.FEATHERS, mapRepeat: [5.4, 7.4], mapRotation: 0.12, mapOffset: [0.05, 0.12] });
  const seamMat     = makeMaterial({ color: '#3a0808', emissive: '#ff2222', emissiveIntensity: 1.4, roughness: 0.32, metalness: 0.12 });
  const beakMat     = makeMaterial({ color: '#b08a08', roughness: 0.25, metalness: 0.2 });
  const eyeMat      = makeMaterial({ color: '#ffe0a0', emissive: '#ff6600', emissiveIntensity: 3.0 });
  const talonMat    = makeMaterial({ color: '#e0dce0', roughness: 0.12, metalness: 0.36 });
  const crestMat    = makeMaterial({ color: '#4a0a0a', emissive: '#ff2200', emissiveIntensity: 1.2, roughness: 0.22, metalness: 0.16 });

  const birdRoot = new THREE.Group();
  birdRoot.name = 'kaiju_bird_root';
  birdRoot.position.set(0, 12, 0);
  group.add(birdRoot);

  // ── BODY ──
  addMesh({
    parent: birdRoot, name: 'kaiju_bird_body',
    geometry: hpSphere(13.5, 22, 18),
    material: featherMat,
    position: [0, 16, -1],
    scale: [1.0, 0.86, 1.65]
  });
  addMesh({
    parent: birdRoot, name: 'kaiju_bird_keel',
    geometry: hpCapsule(5.5, 14, 6, 12),
    material: featherMid,
    position: [0, 13, 7],
    rotation: [Math.PI / 2, 0, 0],
    scale: [0.55, 1.0, 0.68]
  });
  addMesh({
    parent: birdRoot, name: 'kaiju_bird_body_seam',
    geometry: hpCapsule(3.5, 10, 6, 10),
    material: seamMat,
    position: [0, 15.5, -5.5],
    rotation: [0.1, 0, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: birdRoot, name: `kaiju_bird_scapular_${side < 0 ? 0 : 1}`,
      geometry: hpSphere(7.5, 12, 10),
      material: featherDark,
      position: [side * 9.5, 18, -5],
      scale: [0.62, 0.42, 1.1]
    });
  });

  // ── HEAD ──
  const head = new THREE.Group();
  head.name = 'kaiju_bird_head';
  head.position.set(0, 22, 20);
  birdRoot.add(head);

  addMesh({
    parent: head, name: 'kaiju_bird_skull',
    geometry: hpSphere(7.2, 18, 14),
    material: featherDark,
    scale: [1.0, 0.78, 1.25]
  });
  for (let c = 0; c < 5; c++) {
    addMesh({
      parent: head, name: `kaiju_bird_crest_${c}`,
      geometry: hpCone(1.8 - c * 0.22, 7 - c * 0.5, 5),
      material: crestMat,
      position: [(c - 2) * 2.4, 7.5 + c * 0.5, -1],
      rotation: [-0.3, 0, (c - 2) * 0.12]
    });
  }
  addMesh({
    parent: head, name: 'kaiju_bird_beak',
    geometry: hpCylinder(1.5, 4, 11, 10),
    material: beakMat,
    position: [0, -0.8, 8.5],
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: head, name: 'kaiju_bird_beak_lower',
    geometry: hpCylinder(1.2, 3.5, 9, 10),
    material: beakMat,
    position: [0, -2.8, 8],
    rotation: [Math.PI / 2, 0, 0]
  });
  [[-3.2, 1.8, 5.6], [3.2, 1.8, 5.6]].forEach(([x, y, z], i) => {
    addMesh({
      parent: head, name: `kaiju_bird_eye_${i}`,
      geometry: hpSphere(1.2, 12, 10),
      material: eyeMat,
      position: [x, y, z],
      scale: [0.58, 1.0, 0.72]
    });
    addMesh({
      parent: head, name: `kaiju_bird_brow_${i}`,
      geometry: hpCone(0.8, 4.5, 5),
      material: featherDark,
      position: [x, y + 2.8, z - 1.5],
      rotation: [-0.5, 0, (i === 0 ? -1 : 1) * 0.12]
    });
  });
  addMesh({
    parent: head, name: 'kaiju_bird_neck',
    geometry: hpCylinder(6, 9, 18, 14),
    material: featherMat,
    position: [0, -12, -8],
    rotation: [0.28, 0, 0]
  });

  // ── LEFT WING ──
  const leftWing = new THREE.Group();
  leftWing.name = 'kaiju_bird_left_wing';
  leftWing.position.set(-15.5, 18, -1);
  birdRoot.add(leftWing);

  addMesh({
    parent: leftWing, name: 'kaiju_bird_left_wing_bone',
    geometry: hpCapsule(2.2, 26, 6, 12),
    material: featherDark,
    position: [-13, -0.5, 0], rotation: [0, 0, -0.2]
  });
  addMesh({
    parent: leftWing, name: 'kaiju_bird_left_wing_membrane',
    geometry: hpSphere(1, 8, 6),
    material: makeMaterial({ color: '#0d1520', roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.62 }),
    position: [-10, -1.5, 3], scale: [14, 1.2, 8]
  });
  for (let f = 0; f < 6; f++) {
    addMesh({
      parent: leftWing, name: `kaiju_bird_left_primary_${f}`,
      geometry: new THREE.BoxGeometry(1.4, 0.7, 10 - f * 0.5),
      material: featherDark,
      position: [-8 - f * 3.8, -2.5 + f * 0.2, 3 - f * 0.4],
      rotation: [0.15, 0, -0.18 - f * 0.04]
    });
  }
  addMesh({
    parent: leftWing, name: 'kaiju_bird_left_wing_secondary',
    geometry: hpSphere(1, 8, 6),
    material: featherMid,
    position: [-7, -1, -3], scale: [10, 0.9, 6]
  });

  // ── RIGHT WING ──
  const rightWing = new THREE.Group();
  rightWing.name = 'kaiju_bird_right_wing';
  rightWing.position.set(15.5, 18, -1);
  birdRoot.add(rightWing);

  addMesh({
    parent: rightWing, name: 'kaiju_bird_right_wing_bone',
    geometry: hpCapsule(2.2, 26, 6, 12),
    material: featherDark,
    position: [13, -0.5, 0], rotation: [0, 0, 0.2]
  });
  addMesh({
    parent: rightWing, name: 'kaiju_bird_right_wing_membrane',
    geometry: hpSphere(1, 8, 6),
    material: makeMaterial({ color: '#0d1520', roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.62 }),
    position: [10, -1.5, 3], scale: [14, 1.2, 8]
  });
  for (let f = 0; f < 6; f++) {
    addMesh({
      parent: rightWing, name: `kaiju_bird_right_primary_${f}`,
      geometry: new THREE.BoxGeometry(1.4, 0.7, 10 - f * 0.5),
      material: featherDark,
      position: [8 + f * 3.8, -2.5 + f * 0.2, 3 - f * 0.4],
      rotation: [0.15, 0, 0.18 + f * 0.04]
    });
  }
  addMesh({
    parent: rightWing, name: 'kaiju_bird_right_wing_secondary',
    geometry: hpSphere(1, 8, 6),
    material: featherMid,
    position: [7, -1, -3], scale: [10, 0.9, 6]
  });

  // ── TAIL ──
  const tail = new THREE.Group();
  tail.name = 'kaiju_bird_tail';
  tail.position.set(0, 15, -27);
  birdRoot.add(tail);

  addMesh({
    parent: tail, name: 'kaiju_bird_tail_base',
    geometry: hpSphere(6.5, 14, 12),
    material: featherMat,
    scale: [1, 0.62, 1.2]
  });
  for (let f = 0; f < 5; f++) {
    addMesh({
      parent: tail, name: `kaiju_bird_tail_feather_${f}`,
      geometry: new THREE.BoxGeometry(2.4 - f * 0.2, 0.8, 14 + f * 0.8),
      material: featherDark,
      position: [(f - 2) * 3, -1 - f * 0.1, -6 - f * 0.5],
      rotation: [0.32 + f * 0.04, 0, 0]
    });
  }
  addMesh({
    parent: tail, name: 'kaiju_bird_tail_fin',
    geometry: new THREE.BoxGeometry(9.5, 1.0, 18),
    material: featherDark,
    rotation: [0.32, 0, 0]
  });
  addMesh({
    parent: tail, name: 'kaiju_bird_tail_spike',
    geometry: hpCone(3.5, 9, 6),
    material: featherMat,
    position: [0, -0.5, -8],
    rotation: [0.52, 0, 0]
  });

  // ── LEGS + TALONS ──
  [-1, 1].forEach((side, li) => {
    addMesh({
      parent: birdRoot, name: `kaiju_bird_leg_upper_${li}`,
      geometry: hpCylinder(1.8, 1.4, 10, 10),
      material: makeMaterial({ color: '#1f2937', roughness: 0.62, metalness: 0.22 }),
      position: [side * 5.5, 8, 10],
      rotation: [0.62, 0, side * 0.1]
    });
    addMesh({
      parent: birdRoot, name: `kaiju_bird_leg_${li}`,
      geometry: hpCylinder(1.2, 0.85, 8, 10),
      material: makeMaterial({ color: '#374151', roughness: 0.58, metalness: 0.28 }),
      position: [side * 5.5, 2.5, 13.5],
      rotation: [0.82, 0, side * 0.1]
    });
    for (let c = 0; c < 4; c++) {
      addMesh({
        parent: birdRoot, name: `kaiju_bird_claw_${li}_${c}`,
        geometry: hpCone(0.38, 4.0, 5),
        material: talonMat,
        position: [side * (5.5 + (c - 1.5) * 1.2), 0.5, 16.5 + c * 0.5],
        rotation: [1.1, 0, side * (0.06 + c * 0.06)]
      });
    }
  });

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// BEETLE — armoured tank, layered elytra, horn, serrated mandibles
// ─────────────────────────────────────────────────────────────────────────────
const buildBeetle = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_beetle';

  const shellMat  = makeMaterial({ color: '#6b3416', roughness: 0.38, metalness: 0.28, map: textures.CHITIN, mapRepeat: [4.2, 4.0], mapRotation: 0.14 });
  const shellMid  = makeMaterial({ color: '#84411d', roughness: 0.46, metalness: 0.24, map: textures.CHITIN, mapRepeat: [5.0, 4.6], mapRotation: -0.1, mapOffset: [0.08, 0.05] });
  const shellDark = makeMaterial({ color: '#48230f', roughness: 0.62, metalness: 0.18, map: textures.CHITIN, mapRepeat: [5.8, 5.2], mapRotation: 0.2, mapOffset: [0.16, 0.08] });
  const underMat  = makeMaterial({ color: '#5a3a22', roughness: 0.7, metalness: 0.08, map: textures.ORGANIC_SKIN, mapRepeat: [3.2, 4.4], mapRotation: -0.08 });
  const amberMat  = makeMaterial({ color: '#8a3a00', emissive: '#ff8800', emissiveIntensity: 1.4, roughness: 0.22, metalness: 0.14 });
  const amberDim  = makeMaterial({ color: '#6a2a04', emissive: '#ee6600', emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.1 });
  const eyeMat    = makeMaterial({ color: '#ffcc44', emissive: '#ff8800', emissiveIntensity: 3.0 });
  const boneMat   = makeMaterial({ color: '#d0ccc8', roughness: 0.16, metalness: 0.2 });

  // ── BODY ──
  addMesh({
    parent: group, name: 'kaiju_beetle_body',
    geometry: hpSphere(14, 22, 18),
    material: shellMat,
    position: [0, 22, 0],
    scale: [1.14, 0.84, 1.55]
  });
  addMesh({
    parent: group, name: 'kaiju_beetle_underbody',
    geometry: hpSphere(12, 18, 14),
    material: underMat,
    position: [0, 17, 1],
    scale: [1.05, 0.52, 1.42]
  });
  addMesh({
    parent: group, name: 'kaiju_beetle_pronotal_ring',
    geometry: hpTorus(11.5, 2.2, 10, 26),
    material: shellMid,
    position: [0, 27, 8],
    rotation: [Math.PI / 2.2, 0, 0]
  });

  // ── ELYTRA ──
  addMesh({
    parent: group, name: 'kaiju_beetle_elytra',
    geometry: hpSphere(13.5, 20, 16),
    material: shellDark,
    position: [0, 26, -2],
    scale: [1.2, 0.62, 1.48],
    rotation: [0.06, 0, 0]
  });
  addMesh({
    parent: group, name: 'kaiju_beetle_suture',
    geometry: hpCapsule(0.9, 20, 5, 10),
    material: shellMid,
    position: [0, 27, -2],
    rotation: [Math.PI / 2, 0, 0]
  });
  [-1, 1].forEach((side) => {
    for (let r = 0; r < 4; r++) {
      addMesh({
        parent: group, name: `kaiju_beetle_elytra_rib_${side < 0 ? 'l' : 'r'}_${r}`,
        geometry: hpCapsule(0.7, 14 - r * 1.5, 4, 8),
        material: shellMid,
        position: [side * (4 + r * 2.5), 27.5, -2 - r * 0.5],
        rotation: [Math.PI / 2, 0, 0]
      });
    }
  });

  // ── COLLAR (pronotum) ──
  addMesh({
    parent: group, name: 'kaiju_beetle_collar',
    geometry: hpSphere(10, 18, 14),
    material: shellDark,
    position: [0, 22, 18],
    scale: [1.12, 0.68, 0.92]
  });
  for (let s = 0; s < 6; s++) {
    const ang = (s / 6) * Math.PI - Math.PI / 2;
    addMesh({
      parent: group, name: `kaiju_beetle_collar_spike_${s}`,
      geometry: hpCone(1.0 - s * 0.08, 4.5, 5),
      material: shellDark,
      position: [Math.cos(ang) * 11, 24, 18 + Math.sin(ang) * 5],
      rotation: [-0.4, ang, 0]
    });
  }

  // ── JAW / HEAD GROUP ──
  const jaw = new THREE.Group();
  jaw.name = 'kaiju_beetle_jaw';
  jaw.position.set(0, 20, 28);
  group.add(jaw);

  addMesh({
    parent: jaw, name: 'kaiju_beetle_head',
    geometry: hpSphere(8.5, 18, 14),
    material: shellDark,
    scale: [1.05, 0.78, 1.12]
  });
  addMesh({
    parent: jaw, name: 'kaiju_beetle_clypeus',
    geometry: hpSphere(6.5, 14, 12),
    material: shellMid,
    position: [0, 0.5, 6.5],
    scale: [0.88, 0.38, 0.62]
  });
  [[-5.5, 2.5, 5.5], [5.5, 2.5, 5.5]].forEach(([x, y, z], i) => {
    addMesh({
      parent: jaw, name: `kaiju_beetle_eye_${i}`,
      geometry: hpSphere(2.4, 14, 12),
      material: eyeMat,
      position: [x, y, z]
    });
    addMesh({
      parent: jaw, name: `kaiju_beetle_eye_ring_${i}`,
      geometry: hpTorus(2.8, 0.7, 8, 16),
      material: amberDim,
      position: [x, y, z - 0.6]
    });
  });
  addMesh({
    parent: jaw, name: 'kaiju_beetle_horn',
    geometry: hpCone(3.5, 18, 10),
    material: shellDark,
    position: [0, 5.5, 8.5],
    rotation: [-0.52, 0, 0]
  });
  addMesh({
    parent: jaw, name: 'kaiju_beetle_horn_base',
    geometry: hpCylinder(4.5, 5, 5, 12),
    material: shellMid,
    position: [0, 3.5, 7.5],
    rotation: [-0.52, 0, 0]
  });
  [-1, 1].forEach((side, mi) => {
    addMesh({
      parent: jaw, name: `kaiju_beetle_mandible_${mi}`,
      geometry: hpCapsule(1.4, 9, 5, 8),
      material: amberMat,
      position: [side * 6, -2, 8.5],
      rotation: [0.32, side * 0.2, side * -0.38]
    });
    for (let t = 0; t < 3; t++) {
      addMesh({
        parent: jaw, name: `kaiju_beetle_mandible_tooth_${mi}_${t}`,
        geometry: hpCone(0.55, 2.8, 5),
        material: boneMat,
        position: [side * (5.5 + t * 0.8), -3 - t * 0.5, 10 + t * 1.5],
        rotation: [0.6, side * 0.1, side * (-0.3 + t * 0.08)]
      });
    }
  });

  // ── LEGS — 3 pairs ──
  for (let row = 0; row < 3; row++) {
    const z = 12 - row * 12;
    [-1, 1].forEach((side, li) => {
      addMesh({
        parent: group, name: `kaiju_beetle_leg_${row}_${li}`,
        geometry: hpCylinder(1.8 - row * 0.18, 0.55, 20, 10),
        material: shellDark,
        position: [side * (12 + row * 1.8), 11 - row * 1.5, z],
        rotation: [0.18, 0, side * (1.0 - row * 0.16)]
      });
      addMesh({
        parent: group, name: `kaiju_beetle_coxa_${row}_${li}`,
        geometry: hpSphere(2.8 - row * 0.2, 10, 8),
        material: shellMid,
        position: [side * (8.5 + row * 0.8), 13 - row * 1.2, z]
      });
      addMesh({
        parent: group, name: `kaiju_beetle_spur_${row}_${li}`,
        geometry: hpCone(1.0, 4.5, 6),
        material: shellDark,
        position: [side * (14 + row * 0.8), 9 - row * 1.5, z + 2],
        rotation: [0.5, 0, side * 0.3]
      });
    });
  }

  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// WYRM — serpentine worm-dragon, overlapping body segments, fin ridge
// ─────────────────────────────────────────────────────────────────────────────
const buildWyrm = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_wyrm';

  const scaleMat  = makeMaterial({ color: '#25543b', roughness: 0.66, metalness: 0.1, map: textures.SCALES, mapRepeat: [3.8, 4.6], mapRotation: 0.12 });
  const scaleDark = makeMaterial({ color: '#173924', roughness: 0.76, metalness: 0.08, map: textures.SCALES, mapRepeat: [4.8, 5.0], mapRotation: -0.08, mapOffset: [0.1, 0.04] });
  const scaleMid  = makeMaterial({ color: '#347354', roughness: 0.52, metalness: 0.16, map: textures.SCALES, mapRepeat: [5.6, 5.4], mapRotation: 0.18, mapOffset: [0.16, 0.1] });
  const glowMat   = makeMaterial({ color: '#0e3008', emissive: '#44ff88', emissiveIntensity: 1.2, roughness: 0.26, metalness: 0.16 });
  const deepGlow  = makeMaterial({ color: '#041e0c', emissive: '#00ff55', emissiveIntensity: 1.8, roughness: 0.14, metalness: 0.22 });
  const boneMat   = makeMaterial({ color: '#e8e8ec', roughness: 0.14, metalness: 0.12 });
  const mawMat    = makeMaterial({ color: '#380808', roughness: 0.88, metalness: 0.04, map: textures.ORGANIC_SKIN, mapRepeat: [3.4, 3.2], mapRotation: 0.1 });

  // ── BODY SEGMENTS — overlapping spheres ──
  for (let i = 0; i < 8; i++) {
    const r = 12.5 - i * 0.72;
    const ovlp = 4;
    addMesh({
      parent: group, name: `kaiju_wyrm_segment_${i}`,
      geometry: hpSphere(r, 18, 14),
      material: i < 2 ? scaleMat : i < 5 ? scaleMid : scaleDark,
      position: [Math.sin(i * 0.32) * 4.5, 14 - i * 0.7, -(i * (r * 2 - ovlp))],
      scale: [1.0, 0.88, 1.62]
    });
    [-1, 1].forEach((side) => {
      addMesh({
        parent: group, name: `kaiju_wyrm_scale_plate_${i}_${side < 0 ? 0 : 1}`,
        geometry: hpSphere(r * 0.52, 10, 8),
        material: scaleMid,
        position: [side * r * 0.88, 14 - i * 0.7, -(i * (r * 2 - ovlp))],
        scale: [0.42, 0.52, 1.35]
      });
    });
    addMesh({
      parent: group, name: `kaiju_wyrm_ventral_${i}`,
      geometry: hpSphere(r * 0.62, 12, 10),
      material: scaleMid,
      position: [0, 14 - i * 0.7 - r * 0.55, -(i * (r * 2 - ovlp))],
      scale: [0.78, 0.38, 1.45]
    });
    if (i < 6) {
      addMesh({
        parent: group, name: `kaiju_wyrm_spine_${i}`,
        geometry: hpCone(2.2 - i * 0.16, 9.5 - i * 0.5, 6),
        material: i < 2 ? deepGlow : glowMat,
        position: [Math.sin(i * 0.32) * 4.5, 22 - i * 0.5, -(i * (r * 2 - ovlp))],
        rotation: [-0.35, 0, i % 2 === 0 ? 0.1 : -0.1]
      });
      if (i < 5) {
        addMesh({
          parent: group, name: `kaiju_wyrm_fin_web_${i}`,
          geometry: new THREE.BoxGeometry(1.5, 6.5 - i * 0.4, 8 + i * 0.5),
          material: makeMaterial({ color: '#14532d', emissive: '#4ade80', emissiveIntensity: 0.24, roughness: 0.35, metalness: 0.08, transparent: true, opacity: 0.72 }),
          position: [0, 20 - i * 0.5, -(i * (r * 2 - ovlp)) - (r * 2 - ovlp) / 2]
        });
      }
    }
  }

  // ── HEAD GROUP ──
  const head = new THREE.Group();
  head.name = 'kaiju_wyrm_head';
  head.position.set(0, 18, 15);
  group.add(head);

  addMesh({
    parent: head, name: 'kaiju_wyrm_skull',
    geometry: hpSphere(9, 20, 16),
    material: scaleMat,
    scale: [1.02, 0.78, 1.42]
  });
  addMesh({
    parent: head, name: 'kaiju_wyrm_snout',
    geometry: hpCylinder(4.5, 7, 14, 14),
    material: scaleMat,
    position: [0, -2, 12],
    rotation: [Math.PI / 2, 0, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: head, name: `kaiju_wyrm_brow_${side < 0 ? 0 : 1}`,
      geometry: hpSphere(5, 12, 10),
      material: scaleMid,
      position: [side * 5.5, 4.5, 7],
      scale: [0.58, 0.35, 0.92]
    });
  });
  [[-4.5, 3.5, 10.5], [4.5, 3.5, 10.5]].forEach(([x, y, z], i) => {
    addMesh({
      parent: head, name: `kaiju_wyrm_eye_${i}`,
      geometry: hpSphere(1.9, 14, 12),
      material: makeMaterial({ color: '#d1fae5', emissive: '#4ade80', emissiveIntensity: 1.4 }),
      position: [x, y, z]
    });
    addMesh({
      parent: head, name: `kaiju_wyrm_eye_slit_${i}`,
      geometry: hpSphere(0.9, 8, 6),
      material: makeMaterial({ color: '#000', roughness: 1 }),
      position: [x, y, z + 1.2],
      scale: [0.3, 1.0, 0.5]
    });
  });
  addMesh({
    parent: head, name: 'kaiju_wyrm_crest',
    geometry: hpCapsule(2.8, 12, 16, 32),
    material: deepGlow,
    position: [0, 7, 5.5],
    scale: [0.9, 1.0, 2.8]
  });
  for (let f = 0; f < 4; f++) {
    addMesh({
      parent: head, name: `kaiju_wyrm_crest_spike_${f}`,
      geometry: hpCone(1.2 - f * 0.15, 5 + f * 0.3, 5),
      material: deepGlow,
      position: [(f - 1.5) * 2.2, 11.5, 4 + f * 0.5],
      rotation: [-0.15, 0, (f - 1.5) * 0.1]
    });
  }

  // ── JAW ──
  const jaw = new THREE.Group();
  jaw.name = 'kaiju_wyrm_jaw';
  jaw.position.set(0, -3.5, 6.5);
  head.add(jaw);

  addMesh({
    parent: jaw, name: 'kaiju_wyrm_jaw_shell',
    geometry: hpCylinder(4, 6.5, 10, 14),
    material: scaleDark,
    position: [0, -1.8, 6.5],
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: jaw, name: 'kaiju_wyrm_jaw_maw',
    geometry: hpSphere(5.5, 12, 10),
    material: mawMat,
    position: [0, -1.5, 7.5],
    scale: [0.85, 0.38, 0.98]
  });
  [-1, 1].forEach((side, fi) => {
    addMesh({
      parent: jaw, name: `kaiju_wyrm_fang_${fi}`,
      geometry: hpCylinder(0.32, 0.08, 5.5, 8),
      material: boneMat,
      position: [side * 3, -0.5, 9.5],
      rotation: [0.52, side * 0.14, side * -0.18]
    });
    addMesh({
      parent: jaw, name: `kaiju_wyrm_tooth_${fi}`,
      geometry: hpCone(0.6, 3.8, 5),
      material: boneMat,
      position: [side * 1.5, 0.5, 10.2],
      rotation: [Math.PI / 2, 0, 0]
    });
  });
  addMesh({
    parent: jaw, name: 'kaiju_wyrm_tongue',
    geometry: hpCapsule(0.8, 7, 4, 8),
    material: deepGlow,
    position: [0, -1, 8.5],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 1, 0.42]
  });

  return group;
};

[
  buildGodzilla(),
  buildOctopus(),
  buildSpider(),
  buildSpicieBird(),
  buildBeetle(),
  buildWyrm()
].forEach((group) => root.add(group));

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
