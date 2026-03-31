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
  const root = new THREE.Group();
  root.name = tool ? 'unit_tool' : 'unit_weapon';
  root.position.set(5.3, 12.2, 3.4);
  root.rotation.set(0.1, 0.1, -Math.PI / 2);
  parent.add(root);

  addMesh({
    parent: root,
    name: 'weapon_body',
    geometry: new THREE.BoxGeometry(
      tool ? 4.6 : missileRack ? 8.4 : launcher ? 7.8 : longBarrel ? 8.8 : heavy ? 7.1 : 7.4,
      launcher || missileRack ? 0.9 : 0.65,
      tool ? 0.9 : launcher ? 1.05 : missileRack ? 1.1 : 0.7
    ),
    material: makeMat({ color: tool ? '#f59e0b' : '#1f2937', roughness: 0.62, metalness: 0.28 }),
    position: [0, 0, 0]
  });
  addMesh({
    parent: root,
    name: 'weapon_stock',
    geometry: new THREE.BoxGeometry(2.5, 0.7, 0.8),
    material: makeMat({ color: tool ? '#92400e' : '#6b4f37', roughness: 0.9, metalness: 0.04 }),
    position: [-2.3, -0.2, 0]
  });
  if (!tool && !missileRack) {
    addMesh({
      parent: root,
      name: 'weapon_barrel',
      geometry: new THREE.CylinderGeometry(launcher ? 0.34 : 0.14, launcher ? 0.34 : 0.14, launcher ? 5.6 : longBarrel ? 6.2 : 4.1, 8),
      material: makeMat({ color: '#0f172a', roughness: 0.38, metalness: 0.52 }),
      position: [launcher ? 4.1 : longBarrel ? 4.8 : 3.6, 0, 0],
      rotation: [0, 0, Math.PI / 2]
    });
  }
  if (heavy) {
    addMesh({
      parent: root,
      name: 'weapon_boxmag',
      geometry: new THREE.BoxGeometry(1.7, 1.5, 0.95),
      material: makeMat({ color: '#374151', roughness: 0.7, metalness: 0.24 }),
      position: [0.4, -1.0, 0]
    });
  }
  if (longBarrel) {
    addMesh({
      parent: root,
      name: 'weapon_scope',
      geometry: new THREE.CylinderGeometry(0.24, 0.24, 2.5, 10),
      material: makeMat({ color: '#111827', roughness: 0.34, metalness: 0.56 }),
      position: [1.1, 0.7, 0],
      rotation: [0, 0, Math.PI / 2]
    });
  }
  if (launcher) {
    addMesh({
      parent: root,
      name: 'weapon_warhead',
      geometry: new THREE.ConeGeometry(0.5, 1.4, 8),
      material: makeMat({ color: '#fbbf24', roughness: 0.42, metalness: 0.3 }),
      position: [6.4, 0, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: root,
      name: 'weapon_backtube',
      geometry: new THREE.CylinderGeometry(0.3, 0.3, 2.8, 8),
      material: makeMat({ color: '#374151', roughness: 0.5, metalness: 0.3 }),
      position: [-4.4, 0, 0],
      rotation: [0, 0, Math.PI / 2]
    });
  }
  if (missileRack) {
    addMesh({
      parent: root,
      name: 'weapon_rack_top',
      geometry: new THREE.CylinderGeometry(0.28, 0.28, 7.4, 8),
      material: makeMat({ color: '#334155', roughness: 0.42, metalness: 0.34 }),
      position: [1.2, 0.7, 0],
      rotation: [0, 0, Math.PI / 2]
    });
    addMesh({
      parent: root,
      name: 'weapon_rack_bottom',
      geometry: new THREE.CylinderGeometry(0.28, 0.28, 7.4, 8),
      material: makeMat({ color: '#334155', roughness: 0.42, metalness: 0.34 }),
      position: [1.2, -0.7, 0],
      rotation: [0, 0, Math.PI / 2]
    });
    addMesh({
      parent: root,
      name: 'weapon_missile_tip_top',
      geometry: new THREE.ConeGeometry(0.42, 1.2, 8),
      material: makeMat({ color: '#fde68a', roughness: 0.36, metalness: 0.22 }),
      position: [5.2, 0.7, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: root,
      name: 'weapon_missile_tip_bottom',
      geometry: new THREE.ConeGeometry(0.42, 1.2, 8),
      material: makeMat({ color: '#bfdbfe', roughness: 0.36, metalness: 0.22 }),
      position: [5.2, -0.7, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
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
