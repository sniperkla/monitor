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
const outPath = path.join(outDir, 'airstrike_assets.glb');

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.72,
  metalness = 0.16,
  transparent = false,
  opacity = 1,
  side
}) => new THREE.MeshStandardMaterial({
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

const buildBomberPlane = () => {
  const group = new THREE.Group();
  group.name = 'bomber_plane';

  const bodyMat = makeMaterial({ color: '#8b949e', roughness: 0.42, metalness: 0.56 });
  const trimMat = makeMaterial({ color: '#707b86', roughness: 0.44, metalness: 0.42 });
  const darkMat = makeMaterial({ color: '#1f2937', roughness: 0.28, metalness: 0.58 });
  const glassMat = makeMaterial({ color: '#bcd3df', roughness: 0.08, metalness: 0.82, transparent: true, opacity: 0.5 });
  const glowMat = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 1.6, transparent: true, opacity: 0.38 });

  addMesh({
    parent: group,
    name: 'bomber_fuselage',
    geometry: new THREE.CylinderGeometry(11.5, 14, 268, 22),
    material: bodyMat,
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_shell',
    geometry: new THREE.SphereGeometry(28, 20, 16),
    material: bodyMat,
    position: [92, 4, 0],
    scale: [1.1, 0.92, 1.02]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_tip',
    geometry: new THREE.ConeGeometry(11.2, 34, 16),
    material: trimMat,
    position: [124, 2, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_greenhouse',
    geometry: new THREE.SphereGeometry(11, 18, 14),
    material: glassMat,
    position: [82, 13, 0],
    scale: [1.75, 0.82, 0.92]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_glass',
    geometry: new THREE.SphereGeometry(8.8, 16, 12),
    material: glassMat,
    position: [103, 5, 0],
    scale: [1.55, 0.9, 0.95]
  });
  addMesh({
    parent: group,
    name: 'bomber_spine',
    geometry: new THREE.BoxGeometry(142, 5, 18),
    material: trimMat,
    position: [-6, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_belly_bay',
    geometry: new THREE.BoxGeometry(54, 4.6, 24),
    material: trimMat,
    position: [-10, -10.4, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_dorsal_turret_base',
    geometry: new THREE.SphereGeometry(5.5, 14, 12),
    material: bodyMat,
    position: [16, 23, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_dorsal_turret',
    geometry: new THREE.CylinderGeometry(0.55, 0.55, 11, 8),
    material: darkMat,
    position: [22, 22.3, 6.1],
    rotation: [0, 0.22, 0.08]
  });

  addMesh({
    parent: group,
    name: 'bomber_tail_boom',
    geometry: new THREE.CylinderGeometry(6.5, 8.5, 58, 16),
    material: trimMat,
    position: [-95, 9, 0],
    rotation: [0, 0, Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_vertical_tail',
    geometry: new THREE.BoxGeometry(52, 5, 92),
    material: trimMat,
    position: [-110, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_rudder',
    geometry: new THREE.BoxGeometry(18, 58, 8),
    material: trimMat,
    position: [-108, 52, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_cap',
    geometry: new THREE.SphereGeometry(12.5, 14, 10),
    material: bodyMat,
    position: [-122, 31, 0],
    scale: [0.95, 1.24, 0.56]
  });

  addMesh({
    parent: group,
    name: 'bomber_main_wing',
    geometry: new THREE.BoxGeometry(138, 4.6, 354),
    material: bodyMat,
    position: [-4, 4.6, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'bomber_outer_wing_left' : 'bomber_outer_wing_right',
      geometry: new THREE.BoxGeometry(130, 3.6, 122),
      material: trimMat,
      position: [-10, 4.2, side * 166],
      rotation: [0, side * 0.04, side * -0.03]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'bomber_tailplane_left' : 'bomber_tailplane_right',
      geometry: new THREE.BoxGeometry(56, 3.6, 74),
      material: trimMat,
      position: [-108, 31, side * 40]
    });
  });

  const enginePositions = [
    [12, -8, -134],
    [12, -8, -60],
    [12, -8, 60],
    [12, -8, 134]
  ];
  enginePositions.forEach((pos, index) => {
    addMesh({
      parent: group,
      name: `bomber_engine_${index}`,
      geometry: new THREE.CylinderGeometry(14.4, 12.8, 30, 18),
      material: trimMat,
      position: pos,
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: group,
      name: `bomber_engine_cowl_${index}`,
      geometry: new THREE.TorusGeometry(11.8, 1.8, 8, 20),
      material: darkMat,
      position: [pos[0] + 13, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    addMesh({
      parent: group,
      name: `bomber_exhaust_glow_${index}`,
      geometry: new THREE.CylinderGeometry(4.9, 2.7, 9, 12),
      material: glowMat,
      position: [pos[0] - 20.5, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    const propGroup = new THREE.Group();
    propGroup.name = `bomber_prop_${index}`;
    propGroup.position.set(pos[0] - 18.5, pos[1], pos[2]);
    for (let blade = 0; blade < 4; blade++) {
      addMesh({
        parent: propGroup,
        name: `bomber_prop_blade_${index}_${blade}`,
        geometry: new THREE.BoxGeometry(1.1, 31, 2.6),
        material: darkMat,
        rotation: [Math.PI / 2, 0, blade * (Math.PI / 2)]
      });
    }
    addMesh({
      parent: propGroup,
      name: `bomber_prop_hub_${index}`,
      geometry: new THREE.SphereGeometry(2.3, 10, 10),
      material: darkMat
    });
    group.add(propGroup);
  });

  addMesh({
    parent: group,
    name: 'bomber_mark_left',
    geometry: new THREE.CircleGeometry(12, 24),
    material: makeMaterial({ color: '#f3f4f6', transparent: true, opacity: 0.22 }),
    position: [8, 5.1, -132],
    rotation: [-Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_mark_right',
    geometry: new THREE.CircleGeometry(12, 24),
    material: makeMaterial({ color: '#f3f4f6', transparent: true, opacity: 0.22 }),
    position: [8, 5.1, 132],
    rotation: [-Math.PI / 2, 0, 0]
  });

  return group;
};

const buildParachuteNuke = () => {
  const group = new THREE.Group();
  group.name = 'nuke_bomb';

  const bombMat = makeMaterial({ color: '#4b5563', roughness: 0.28, metalness: 0.72 });
  const trimMat = makeMaterial({ color: '#6b7280', roughness: 0.32, metalness: 0.66 });
  const darkMat = makeMaterial({ color: '#111827', roughness: 0.24, metalness: 0.7 });
  const stripeMat = makeMaterial({ color: '#facc15', roughness: 0.24, metalness: 0.08, emissive: '#f59e0b', emissiveIntensity: 0.22 });
  const canopyMat = makeMaterial({ color: '#c1121f', roughness: 0.82, metalness: 0.06, side: THREE.DoubleSide });
  const canopyRingMat = makeMaterial({ color: '#fecaca', roughness: 0.7, metalness: 0.16 });
  const fabricGlowMat = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 0.65, transparent: true, opacity: 0.18 });
  const cordMat = new THREE.MeshBasicMaterial({ color: '#f5f5f4' });

  addMesh({
    parent: group,
    name: 'nuke_body',
    geometry: new THREE.SphereGeometry(6.8, 20, 18),
    material: bombMat,
    position: [0, 0, 0],
    scale: [1, 1.08, 1]
  });
  addMesh({
    parent: group,
    name: 'nuke_mid',
    geometry: new THREE.CylinderGeometry(5.6, 6.9, 20, 18),
    material: trimMat,
    position: [0, -10.5, 0]
  });
  addMesh({
    parent: group,
    name: 'nuke_tail',
    geometry: new THREE.ConeGeometry(5.2, 13, 14),
    material: darkMat,
    position: [0, -24, 0]
  });
  addMesh({
    parent: group,
    name: 'nuke_band',
    geometry: new THREE.BoxGeometry(8.2, 12.2, 0.28),
    material: stripeMat,
    position: [0, -10.5, 5.7],
    rotation: [Math.PI / 2, 0, 0]
  });
  [-4.5, 4.5].forEach((x, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_${index}`,
      geometry: new THREE.BoxGeometry(1.45, 8.5, 0.42),
      material: darkMat,
      position: [x, -12.6, 0],
      rotation: [0, 0, Math.PI / 4]
    });
  });
  [-4.5, 4.5].forEach((z, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_cross_${index}`,
      geometry: new THREE.BoxGeometry(0.42, 8.5, 1.45),
      material: darkMat,
      position: [0, -12.6, z],
      rotation: [Math.PI / 4, 0, 0]
    });
  });

  const chuteRoot = new THREE.Group();
  chuteRoot.name = 'nuke_parachute';
  chuteRoot.position.set(0, 34, 0);
  group.add(chuteRoot);

  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy',
    geometry: new THREE.SphereGeometry(24, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    material: canopyMat
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_ring',
    geometry: new THREE.TorusGeometry(23.2, 1.2, 10, 28),
    material: canopyRingMat,
    position: [0, 0.6, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_vent',
    geometry: new THREE.SphereGeometry(7, 12, 8),
    material: fabricGlowMat,
    position: [0, 8, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_harness',
    geometry: new THREE.CylinderGeometry(1.2, 1.6, 6, 8),
    material: trimMat,
    position: [0, -8, 0]
  });

  const cordsRoot = new THREE.Group();
  cordsRoot.name = 'nuke_cords_root';
  group.add(cordsRoot);

  [
    [-13, 31, -13],
    [13, 31, -13],
    [-13, 31, 13],
    [13, 31, 13],
    [0, 31, -16],
    [0, 31, 16]
  ].forEach(([x, y, z], index) => {
    addMesh({
      parent: cordsRoot,
      name: `nuke_cord_${index}`,
      geometry: new THREE.CylinderGeometry(0.16, 0.16, 30, 6),
      material: cordMat,
      position: [x * 0.45, y * 0.45, z * 0.45],
      rotation: [0.6, 0, x < 0 ? -0.4 : 0.4]
    });
  });

  addMesh({
    parent: group,
    name: 'nuke_status_glow',
    geometry: new THREE.SphereGeometry(2.4, 10, 10),
    material: makeMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 2.2, transparent: true, opacity: 0.28 }),
    position: [0, -2.6, 0]
  });

  return group;
};

const root = new THREE.Group();
root.name = 'airstrike_assets_root';
root.add(buildBomberPlane());
root.add(buildParachuteNuke());

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
