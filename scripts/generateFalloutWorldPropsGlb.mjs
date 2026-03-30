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
const outPath = path.join(outDir, 'world_props.glb');

const root = new THREE.Group();
root.name = 'world_props_root';

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.08,
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

const buildResidentialHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_residential';

  addMesh({
    parent: group,
    name: 'house_foundation',
    geometry: new THREE.BoxGeometry(30, 4, 30),
    material: makeMaterial({ color: '#7c6f64', roughness: 0.94 }),
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_body',
    geometry: new THREE.BoxGeometry(28, 30, 28),
    material: makeMaterial({ color: '#e8d6b2', roughness: 0.82 }),
    position: [0, 19, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_front',
    geometry: new THREE.BoxGeometry(22, 24, 1.1),
    material: makeMaterial({ color: '#d6d3d1', roughness: 0.76 }),
    position: [0, 19, 14.7]
  });
  addMesh({
    parent: group,
    name: 'house_roof_left',
    geometry: new THREE.BoxGeometry(30, 3.4, 20),
    material: makeMaterial({ color: '#8b4513', roughness: 0.84 }),
    position: [0, 37.3, -4.8],
    rotation: [0.58, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'house_roof_right',
    geometry: new THREE.BoxGeometry(30, 3.4, 20),
    material: makeMaterial({ color: '#8b4513', roughness: 0.84 }),
    position: [0, 37.3, 4.8],
    rotation: [-0.58, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'house_door',
    geometry: new THREE.BoxGeometry(5.5, 12, 1.2),
    material: makeMaterial({ color: '#4b2e1f', roughness: 0.86 }),
    position: [5, 8, 14.8]
  });
  addMesh({
    parent: group,
    name: 'house_chimney',
    geometry: new THREE.BoxGeometry(3.4, 11, 3.4),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.9 }),
    position: [6.6, 39, -2]
  });

  [
    [-6.2, 15, 14.95, 0],
    [6.2, 15, 14.95, 0],
    [-6.2, 15, -14.95, Math.PI],
    [6.2, 15, -14.95, Math.PI]
  ].forEach((windowSpec, index) => {
    addMesh({
      parent: group,
      name: `house_window_${index}`,
      geometry: new THREE.BoxGeometry(6, 6, 1),
      material: makeMaterial({
        color: '#475569',
        emissive: '#475569',
        emissiveIntensity: 0.14,
        roughness: 0.22,
        metalness: 0.22
      }),
      position: [windowSpec[0], windowSpec[1], windowSpec[2]],
      rotation: [0, windowSpec[3], 0]
    });
  });

  return group;
};

const buildTowerHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_tower';

  addMesh({
    parent: group,
    name: 'house_foundation',
    geometry: new THREE.BoxGeometry(30, 4, 30),
    material: makeMaterial({ color: '#475569', roughness: 0.92 }),
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_body',
    geometry: new THREE.BoxGeometry(28, 30, 28),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.7, metalness: 0.12 }),
    position: [0, 19, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_cap',
    geometry: new THREE.BoxGeometry(30, 6, 30),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.78 }),
    position: [0, 37, 0]
  });
  addMesh({
    parent: group,
    name: 'house_accent_front',
    geometry: new THREE.BoxGeometry(14, 6, 0.9),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.62, metalness: 0.18 }),
    position: [0, 10, 14.95]
  });

  [-8.4, 0, 8.4].forEach((yOffset, row) => {
    addMesh({
      parent: group,
      name: `house_window_front_${row}`,
      geometry: new THREE.BoxGeometry(20, 3.4, 0.7),
      material: makeMaterial({
        color: '#334155',
        emissive: '#334155',
        emissiveIntensity: 0.18,
        roughness: 0.16,
        metalness: 0.3
      }),
      position: [0, 18 + yOffset, 15.1]
    });
    addMesh({
      parent: group,
      name: `house_window_side_${row}`,
      geometry: new THREE.BoxGeometry(18, 3.2, 0.7),
      material: makeMaterial({
        color: '#334155',
        emissive: '#334155',
        emissiveIntensity: 0.14,
        roughness: 0.16,
        metalness: 0.3
      }),
      position: [15.1, 18 + yOffset, 0],
      rotation: [0, Math.PI / 2, 0]
    });
  });

  addMesh({
    parent: group,
    name: 'house_roof_cap',
    geometry: new THREE.BoxGeometry(26, 4, 26),
    material: makeMaterial({ color: '#64748b', roughness: 0.8 }),
    position: [0, 42, 0]
  });
  addMesh({
    parent: group,
    name: 'house_roof_unit_left',
    geometry: new THREE.BoxGeometry(7, 4, 7),
    material: makeMaterial({ color: '#64748b', roughness: 0.84 }),
    position: [-6, 46, -4]
  });
  addMesh({
    parent: group,
    name: 'house_roof_unit_right',
    geometry: new THREE.BoxGeometry(7, 4, 7),
    material: makeMaterial({ color: '#64748b', roughness: 0.84 }),
    position: [6, 46, 4]
  });

  return group;
};

const buildBrokenHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_broken';

  addMesh({
    parent: group,
    name: 'house_wreck_base',
    geometry: new THREE.BoxGeometry(36, 9, 36),
    material: makeMaterial({ color: '#3b2213', roughness: 0.96 }),
    position: [0, 4, 0]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_roof',
    geometry: new THREE.BoxGeometry(18, 6, 22),
    material: makeMaterial({ color: '#8b4513', roughness: 0.92 }),
    position: [4, 14, -5],
    rotation: [0.38, 0.15, 0.72]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_body',
    geometry: new THREE.BoxGeometry(20, 8, 15),
    material: makeMaterial({ color: '#4b2d18', roughness: 0.94 }),
    position: [-6, 11, 7],
    rotation: [-0.26, 0.42, -0.34]
  });
  [
    [-10, 10, -5, 0.15, 0.0, 0.32],
    [8, 8, 10, 0.35, 0.18, 0.32],
    [0, 7, -12, 0.55, 0.36, 0.32]
  ].forEach((beam, index) => {
    addMesh({
      parent: group,
      name: `house_wreck_beam_${index}`,
      geometry: new THREE.BoxGeometry(2.4, 13, 2.4),
      material: makeMaterial({ color: '#1c1917', roughness: 0.92 }),
      position: [beam[0], beam[1], beam[2]],
      rotation: [beam[3], beam[4], beam[5]]
    });
  });

  return group;
};

const buildRuinedHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_ruined';

  addMesh({
    parent: group,
    name: 'house_wreck_base',
    geometry: new THREE.BoxGeometry(38, 6, 38),
    material: makeMaterial({ color: '#24140b', roughness: 0.98 }),
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_roof',
    geometry: new THREE.BoxGeometry(18, 5, 24),
    material: makeMaterial({ color: '#8b4513', roughness: 0.95 }),
    position: [6, 8, -6],
    rotation: [0.6, 0.2, 0.9]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_body',
    geometry: new THREE.BoxGeometry(22, 6, 14),
    material: makeMaterial({ color: '#402211', roughness: 0.95 }),
    position: [-8, 6, 8],
    rotation: [-0.5, -0.3, -0.7]
  });
  [
    [-12, 8, -5, 0.1, 0.0, 0.4],
    [10, 10, 6, 0.4, 0.2, 0.4],
    [0, 9, 13, 0.7, 0.4, 0.4]
  ].forEach((beam, index) => {
    addMesh({
      parent: group,
      name: `house_wreck_beam_${index}`,
      geometry: new THREE.BoxGeometry(2, 14, 2),
      material: makeMaterial({ color: '#1c1917', roughness: 0.92 }),
      position: [beam[0], beam[1], beam[2]],
      rotation: [beam[3], beam[4], beam[5]]
    });
  });

  return group;
};

const buildBroadleafTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broadleaf';

  addMesh({
    parent: group,
    name: 'tree_trunk',
    geometry: new THREE.CylinderGeometry(1.7, 2.8, 18, 8),
    material: makeMaterial({ color: '#7c4a22', roughness: 0.96 }),
    position: [0, 9, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_root',
    geometry: new THREE.CylinderGeometry(3.8, 5, 4.2, 8),
    material: makeMaterial({ color: '#4b2e16', roughness: 1 }),
    position: [0, 2.2, 0]
  });
  [
    [-5, 18, 0, 9.5],
    [6, 21, -2, 8.5],
    [0, 25, 3, 7.5]
  ].forEach((leaf, index) => {
    addMesh({
      parent: group,
      name: index === 1 ? `tree_canopy_accent_${index}` : `tree_canopy_${index}`,
      geometry: new THREE.SphereGeometry(leaf[3], 12, 12),
      material: makeMaterial({ color: index === 1 ? '#22c55e' : '#166534', roughness: 0.92 }),
      position: [leaf[0], leaf[1], leaf[2]]
    });
  });
  [
    [-3.5, 12, -1.5, -0.88],
    [3.5, 12, 1.5, 0.88]
  ].forEach((branch, index) => {
    addMesh({
      parent: group,
      name: `tree_branch_${index}`,
      geometry: new THREE.CylinderGeometry(0.55, 0.85, 9, 6),
      material: makeMaterial({ color: '#7c4a22', roughness: 0.96 }),
      position: [branch[0], branch[1], branch[2]],
      rotation: [0.2, 0, branch[3]]
    });
  });

  return group;
};

const buildPineTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_pine';

  addMesh({
    parent: group,
    name: 'tree_trunk',
    geometry: new THREE.CylinderGeometry(1.7, 2.8, 18, 8),
    material: makeMaterial({ color: '#7c4a22', roughness: 0.96 }),
    position: [0, 9, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_root',
    geometry: new THREE.CylinderGeometry(3.8, 5, 4.2, 8),
    material: makeMaterial({ color: '#4b2e16', roughness: 1 }),
    position: [0, 2.2, 0]
  });
  [
    [12, 18, 0],
    [9.8, 24, 0],
    [7.6, 30, 0]
  ].forEach((cone, index) => {
    addMesh({
      parent: group,
      name: index === 1 ? `tree_canopy_accent_${index}` : `tree_canopy_${index}`,
      geometry: new THREE.ConeGeometry(cone[0], cone[1], 7),
      material: makeMaterial({ color: index === 1 ? '#4d7c0f' : '#166534', roughness: 0.9 }),
      position: [0, 18 + index * 6, 0]
    });
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_accent_top',
    geometry: new THREE.ConeGeometry(4.5, 10, 6),
    material: makeMaterial({ color: '#22c55e', roughness: 0.88 }),
    position: [0, 36, 0]
  });

  return group;
};

const buildBrokenBroadleafTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broken_broadleaf';

  addMesh({
    parent: group,
    name: 'tree_trunk',
    geometry: new THREE.CylinderGeometry(2.1, 2.7, 14, 8),
    material: makeMaterial({ color: '#45210b', roughness: 1 }),
    position: [0, 7, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_fallen_trunk',
    geometry: new THREE.CylinderGeometry(1.5, 1.9, 20, 8),
    material: makeMaterial({ color: '#5b2d0f', roughness: 0.98 }),
    position: [8, 5, -6],
    rotation: [0.12, 0.15, -1.05]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_0',
    geometry: new THREE.SphereGeometry(6.5, 10, 10),
    material: makeMaterial({ color: '#166534', roughness: 0.92 }),
    position: [11, 7, -9]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_accent_0',
    geometry: new THREE.SphereGeometry(5, 10, 10),
    material: makeMaterial({ color: '#22c55e', roughness: 0.9 }),
    position: [15, 8, -12]
  });

  return group;
};

const buildBrokenPineTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broken_pine';

  addMesh({
    parent: group,
    name: 'tree_trunk',
    geometry: new THREE.CylinderGeometry(2.1, 2.7, 14, 8),
    material: makeMaterial({ color: '#45210b', roughness: 1 }),
    position: [0, 7, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_fallen_trunk',
    geometry: new THREE.CylinderGeometry(1.5, 1.9, 20, 8),
    material: makeMaterial({ color: '#5b2d0f', roughness: 0.98 }),
    position: [8, 5, -6],
    rotation: [0.12, 0.15, -1.05]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_0',
    geometry: new THREE.ConeGeometry(10, 18, 6),
    material: makeMaterial({ color: '#166534', roughness: 0.92 }),
    position: [14, 7, -10],
    rotation: [0.2, 0.5, -0.8]
  });

  return group;
};

[
  buildResidentialHouse(),
  buildTowerHouse(),
  buildBrokenHouse(),
  buildRuinedHouse(),
  buildBroadleafTree(),
  buildPineTree(),
  buildBrokenBroadleafTree(),
  buildBrokenPineTree()
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
