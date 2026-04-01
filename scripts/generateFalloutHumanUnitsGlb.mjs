import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'fallout');
const outPath = path.join(outDir, 'human_units.glb');

const makeMat = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.1
}) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness, metalness });

const addMesh = ({ parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
};

const buildWeapon = ({ parent, longBarrel = false, heavy = false, tool = false, launcher = false, missileRack = false }) => {
  const profile = tool
    ? 'engineer'
    : missileRack
      ? 'missile'
      : launcher
        ? 'rpg'
        : heavy
          ? 'gunner'
          : longBarrel
            ? 'marksman'
            : 'rifleman';

  const root = new THREE.Group();
  root.name = tool ? 'unit_tool' : 'unit_weapon';
  root.position.set(
    profile === 'missile' ? 4.4 : profile === 'rpg' ? 5.0 : profile === 'gunner' ? 5.1 : 5.3,
    profile === 'missile' ? 13.0 : 12.2,
    profile === 'missile' ? 2.8 : profile === 'rpg' ? 3.0 : 3.4
  );
  root.rotation.set(
    profile === 'missile' ? 0.2 : 0.1,
    profile === 'missile' ? 0.18 : 0.1,
    -Math.PI / 2
  );
  parent.add(root);

  const metalDark = makeMat({ color: '#111827', roughness: 0.44, metalness: 0.6 });
  const metalMid = makeMat({ color: '#374151', roughness: 0.52, metalness: 0.44 });
  const metalLight = makeMat({ color: '#64748b', roughness: 0.4, metalness: 0.54 });
  const polymer = makeMat({ color: '#1f2937', roughness: 0.76, metalness: 0.18 });
  const wood = makeMat({ color: '#6b4f37', roughness: 0.92, metalness: 0.05 });
  const olive = makeMat({ color: '#4d5b2d', roughness: 0.8, metalness: 0.16 });
  const warning = makeMat({ color: '#f59e0b', roughness: 0.62, metalness: 0.24 });
  const brightSteel = makeMat({ color: '#cbd5e1', roughness: 0.32, metalness: 0.72 });

  const addBarrel = (name, length, radius, position, material = metalDark) => addMesh({
    parent: root,
    name,
    geometry: new THREE.CylinderGeometry(radius, radius, length, 10),
    material,
    position,
    rotation: [0, 0, Math.PI / 2]
  });

  const addRail = (name, size, position, material = metalMid) => addMesh({
    parent: root,
    name,
    geometry: new THREE.BoxGeometry(...size),
    material,
    position
  });

  if (profile === 'rifleman' || profile === 'marksman' || profile === 'gunner') {
    addRail('weapon_receiver', [3.6, 1.0, 1.0], [-0.2, 0.1, 0], metalDark);
    addRail('weapon_stock', [2.3, 0.9, 0.95], [-2.8, -0.15, 0], profile === 'marksman' ? polymer : wood);
    addRail('weapon_butt', [0.55, 1.15, 1.05], [-3.95, -0.28, 0], polymer);
    addRail('weapon_handguard', [profile === 'marksman' ? 3.9 : profile === 'gunner' ? 3.2 : 2.8, 0.75, 0.9], [2.45, 0.02, 0], profile === 'gunner' ? olive : polymer);
    addBarrel('weapon_barrel', profile === 'marksman' ? 5.8 : profile === 'gunner' ? 4.8 : 4.1, profile === 'marksman' ? 0.16 : 0.13, [5.25, 0.08, 0]);
    addBarrel('weapon_muzzle', 0.65, profile === 'gunner' ? 0.18 : 0.15, [7.55, 0.08, 0], brightSteel);
    addRail('weapon_front_sight', [0.18, 0.62, 0.18], [6.45, 0.45, 0], metalLight);
    addRail('weapon_rear_sight', [0.22, 0.42, 0.2], [0.45, 0.55, 0], metalLight);
    addRail('weapon_grip', [0.42, 1.45, 0.54], [0.0, -0.95, 0], polymer);

    if (profile === 'marksman') {
      addRail('weapon_mag', [0.44, 1.2, 0.52], [0.65, -0.9, 0], metalMid);
      addBarrel('weapon_scope', 2.7, 0.24, [0.8, 0.78, 0], metalDark);
      addRail('weapon_scope_mount', [1.1, 0.22, 0.38], [0.82, 0.46, 0], metalMid);
      addRail('weapon_cheek_rest', [1.1, 0.28, 0.52], [-2.2, 0.32, 0], polymer);
    } else if (profile === 'gunner') {
      addRail('weapon_boxmag', [1.4, 1.85, 1.05], [0.75, -1.08, 0], olive);
      addRail('weapon_top_cover', [2.1, 0.26, 0.7], [0.3, 0.62, 0], metalLight);
      addRail('weapon_foregrip', [0.36, 1.2, 0.4], [2.15, -0.88, 0], polymer);
      addBarrel('weapon_support_rod', 1.5, 0.08, [4.0, -0.6, 0.22], metalMid);
      addBarrel('weapon_support_rod_mirror', 1.5, 0.08, [4.0, -0.6, -0.22], metalMid);
    } else {
      addRail('weapon_mag', [0.48, 1.55, 0.6], [0.7, -0.98, 0], metalMid);
      addRail('weapon_top_rail', [1.55, 0.2, 0.42], [0.7, 0.52, 0], metalMid);
    }
  }

  if (profile === 'rpg') {
    addBarrel('weapon_tube', 10.4, 0.52, [0.8, 0, 0], olive);
    addBarrel('weapon_tube_inner', 10.1, 0.33, [0.9, 0, 0], metalDark);
    addRail('weapon_rear_guard', [1.0, 1.0, 1.1], [-4.1, 0, 0], metalMid);
    addRail('weapon_front_shield', [0.9, 1.0, 1.15], [2.9, 0, 0], metalMid);
    addRail('weapon_trigger', [0.48, 1.65, 0.62], [-0.5, -0.88, 0], polymer);
    addRail('weapon_shoulder_pad', [1.7, 0.5, 1.0], [-5.0, -0.3, 0], polymer);
    addMesh({
      parent: root,
      name: 'weapon_warhead',
      geometry: new THREE.ConeGeometry(0.56, 1.8, 10),
      material: warning,
      position: [6.1, 0, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
    addBarrel('weapon_probe', 0.9, 0.08, [7.05, 0, 0], brightSteel);
    addRail('weapon_front_sight', [0.2, 0.9, 0.2], [3.15, 0.72, 0], brightSteel);
    addRail('weapon_rear_sight', [0.2, 0.7, 0.2], [-1.85, 0.62, 0], brightSteel);
  }

  if (profile === 'missile') {
    addRail('weapon_frame', [7.4, 1.2, 1.8], [0.8, 0.0, 0], metalMid);
    addRail('weapon_shoulder_stock', [2.1, 1.05, 1.2], [-3.1, -0.15, 0], polymer);
    addRail('weapon_grip', [0.5, 1.55, 0.72], [-0.8, -1.0, 0], polymer);
    addRail('weapon_optics', [1.9, 0.65, 0.75], [0.45, 1.02, 0], metalDark);
    addRail('weapon_rack_top', [6.6, 0.34, 0.34], [1.0, 0.95, 0], metalLight);
    addRail('weapon_rack_bottom', [6.6, 0.34, 0.34], [1.0, -0.95, 0], metalLight);
    addRail('weapon_mid_brace', [0.34, 2.4, 0.34], [-0.65, 0, 0], metalLight);
    addRail('weapon_front_brace', [0.34, 2.4, 0.34], [2.45, 0, 0], metalLight);

    const addMountedMissile = (name, y, bodyColor, tipColor) => {
      addBarrel(`${name}_body`, 5.6, 0.42, [2.0, y, 0], makeMat({ color: bodyColor, roughness: 0.4, metalness: 0.26 }));
      addMesh({
        parent: root,
        name: `${name}_tip`,
        geometry: new THREE.ConeGeometry(0.44, 1.4, 10),
        material: makeMat({ color: tipColor, roughness: 0.34, metalness: 0.2 }),
        position: [5.5, y, 0],
        rotation: [0, 0, -Math.PI / 2]
      });
      addRail(`${name}_fin_top`, [0.2, 0.78, 0.08], [0.3, y + 0.5, 0], metalLight);
      addRail(`${name}_fin_bottom`, [0.2, 0.78, 0.08], [0.3, y - 0.5, 0], metalLight);
    };

    addMountedMissile('weapon_missile_top', 0.95, '#475569', '#fde68a');
    addMountedMissile('weapon_missile_bottom', -0.95, '#64748b', '#bfdbfe');
  }

  if (profile === 'engineer') {
    addRail('weapon_fuel_tank', [2.1, 1.55, 1.45], [-1.3, -0.05, 0], warning);
    addRail('weapon_housing', [2.5, 1.0, 1.1], [0.7, 0.08, 0], metalMid);
    addRail('weapon_handle', [0.48, 1.6, 0.6], [-0.15, -1.0, 0], polymer);
    addBarrel('weapon_nozzle', 3.5, 0.22, [2.9, 0.1, 0], brightSteel);
    addMesh({
      parent: root,
      name: 'weapon_nozzle_tip',
      geometry: new THREE.ConeGeometry(0.28, 0.82, 10),
      material: brightSteel,
      position: [4.95, 0.1, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
    addBarrel('weapon_hose', 2.3, 0.1, [0.85, -0.58, 0.45], metalDark);
    addRail('weapon_canister_mount', [0.42, 0.9, 1.0], [-2.25, -0.05, 0], metalMid);
  }
};

const buildSoldier = ({
  name,
  coatColor,
  gearColor,
  padColor,
  helmetColor,
  heavyWeapon = false,
  marksman = false,
  engineer = false,
  launcher = false,
  missileRack = false
}) => {
  const root = new THREE.Group();
  root.name = name;

  const bootMat = makeMat({ color: '#1c1917', roughness: 0.95, metalness: 0.06 });
  const skinMat = makeMat({ color: '#c68642', roughness: 0.82, metalness: 0 });
  const clothMat = makeMat({ color: coatColor, roughness: 0.9, metalness: 0.06 });
  const gearMat = makeMat({ color: gearColor, roughness: 0.72, metalness: 0.16 });
  const padMat = makeMat({ color: padColor, roughness: 0.68, metalness: 0.24 });
  const helmetMat = makeMat({ color: helmetColor, roughness: 0.64, metalness: 0.2 });

  addMesh({ parent: root, name: 'unit_leg_left', geometry: new THREE.CapsuleGeometry(1.35, 7.8, 5, 8), material: clothMat, position: [-1.8, 5.2, 0] });
  addMesh({ parent: root, name: 'unit_leg_right', geometry: new THREE.CapsuleGeometry(1.35, 7.8, 5, 8), material: clothMat, position: [1.8, 5.2, 0] });
  addMesh({ parent: root, name: 'unit_boot_left', geometry: new THREE.BoxGeometry(2.2, 1.2, 4.4), material: bootMat, position: [-1.8, 0.7, 0.8] });
  addMesh({ parent: root, name: 'unit_boot_right', geometry: new THREE.BoxGeometry(2.2, 1.2, 4.4), material: bootMat, position: [1.8, 0.7, 0.8] });

  addMesh({ parent: root, name: 'unit_torso', geometry: new THREE.CapsuleGeometry(3.4, 10.4, 6, 10), material: clothMat, position: [0, 14.8, 0] });
  addMesh({ parent: root, name: 'unit_vest', geometry: new THREE.BoxGeometry(7.8, 7.2, 4.6), material: gearMat, position: [0, 15.1, 1.4] });
  addMesh({ parent: root, name: 'unit_belt', geometry: new THREE.BoxGeometry(7.4, 1.1, 3.6), material: padMat, position: [0, 10.6, 0.8] });
  addMesh({ parent: root, name: 'unit_pack', geometry: new THREE.BoxGeometry(5.4, engineer ? 7.8 : 6.2, 3.4), material: padMat, position: [0, 15.2, -3.2] });

  addMesh({ parent: root, name: 'unit_arm_left', geometry: new THREE.CapsuleGeometry(1.05, 8.4, 5, 8), material: clothMat, position: [-5.2, 15.4, 0.4], rotation: [0.1, 0, 0.3] });
  addMesh({ parent: root, name: 'unit_arm_right', geometry: new THREE.CapsuleGeometry(1.05, 8.4, 5, 8), material: clothMat, position: [5.1, 14.9, 1.7], rotation: [0.28, 0.05, -0.7] });
  addMesh({ parent: root, name: 'unit_pad_left', geometry: new THREE.BoxGeometry(2.4, 1.8, 2.1), material: padMat, position: [-4.9, 17.9, 0.4], rotation: [0.12, 0, 0.24] });
  addMesh({ parent: root, name: 'unit_pad_right', geometry: new THREE.BoxGeometry(2.4, 1.8, 2.1), material: padMat, position: [4.8, 17.2, 1.3], rotation: [0.2, 0, -0.46] });

  addMesh({ parent: root, name: 'unit_head', geometry: new THREE.SphereGeometry(3.1, 16, 12), material: skinMat, position: [0, 24.8, 0.3] });
  addMesh({ parent: root, name: 'unit_helmet', geometry: new THREE.SphereGeometry(3.45, 16, 12), material: helmetMat, position: [0, 25.7, 0], scale: [1, 0.72, 1] });
  addMesh({ parent: root, name: 'unit_visor', geometry: new THREE.BoxGeometry(4.2, 1.3, 0.4), material: makeMat({ color: engineer ? '#67e8f9' : marksman ? '#93c5fd' : '#e5e7eb', emissive: engineer ? '#0f766e' : '#000000', emissiveIntensity: engineer ? 0.2 : 0, roughness: 0.28, metalness: 0.42 }), position: [0, 24.9, 2.9] });
  addMesh({ parent: root, name: 'unit_neck_wrap', geometry: new THREE.CylinderGeometry(1.55, 1.75, 1.6, 10), material: gearMat, position: [0, 21.8, 0.2] });

  if (engineer) {
    addMesh({ parent: root, name: 'unit_tool_canister', geometry: new THREE.BoxGeometry(2.1, 4.5, 2.1), material: makeMat({ color: '#f59e0b', roughness: 0.7, metalness: 0.2 }), position: [3.6, 14.2, -3.5] });
    addMesh({ parent: root, name: 'unit_torch', geometry: new THREE.CylinderGeometry(0.22, 0.22, 4.6, 8), material: makeMat({ color: '#fde68a', roughness: 0.4, metalness: 0.62 }), position: [6.7, 12.5, 1.2], rotation: [0.4, 0.2, -0.28] });
  }

  buildWeapon({ parent: root, longBarrel: marksman, heavy: heavyWeapon, tool: engineer, launcher, missileRack });
  return root;
};

const root = new THREE.Group();
root.name = 'human_units_root';
root.add(buildSoldier({
  name: 'unit_soldier_rifleman',
  coatColor: '#556b2f',
  gearColor: '#3f4f30',
  padColor: '#475569',
  helmetColor: '#4b5563'
}));
root.add(buildSoldier({
  name: 'unit_soldier_marksman',
  coatColor: '#374151',
  gearColor: '#334155',
  padColor: '#64748b',
  helmetColor: '#1f2937',
  marksman: true
}));
root.add(buildSoldier({
  name: 'unit_soldier_gunner',
  coatColor: '#3f6212',
  gearColor: '#495b18',
  padColor: '#3f3f46',
  helmetColor: '#374151',
  heavyWeapon: true
}));
root.add(buildSoldier({
  name: 'unit_soldier_rpg',
  coatColor: '#713f12',
  gearColor: '#4d3a16',
  padColor: '#a16207',
  helmetColor: '#3f3f46',
  launcher: true
}));
root.add(buildSoldier({
  name: 'unit_soldier_missile',
  coatColor: '#1e3a8a',
  gearColor: '#1d4ed8',
  padColor: '#475569',
  helmetColor: '#0f172a',
  missileRack: true
}));
root.add(buildSoldier({
  name: 'unit_soldier_engineer',
  coatColor: '#155e75',
  gearColor: '#0f766e',
  padColor: '#f59e0b',
  helmetColor: '#334155',
  engineer: true
}));

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
