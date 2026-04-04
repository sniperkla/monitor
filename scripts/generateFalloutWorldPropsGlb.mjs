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
  side,
  map,
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
  const tex = map !== undefined ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4)
      ? autoMap(color) : null;
  if (tex) m.map = tex;
  return m;
};

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

const addSymmetricWindowSet = ({
  parent,
  windowNamePrefix,
  trimNamePrefix,
  x = 0,
  y = 14,
  z = 14.95,
  width = 6,
  height = 6,
  depth = 1,
  gap = 12,
  frameDepth = 0.38,
  glassColor = '#475569',
  frameColor = '#d6d3d1',
  rotation = [0, 0, 0],
  emissiveIntensity = 0.14
}) => {
  [-gap / 2, gap / 2].forEach((offset, index) => {
    addMesh({
      parent,
      name: `${windowNamePrefix}_${index}`,
      geometry: new THREE.BoxGeometry(width, height, depth),
      material: makeMaterial({
        color: glassColor,
        emissive: glassColor,
        emissiveIntensity,
        roughness: 0.18,
        metalness: 0.24
      }),
      position: [x + offset, y, z],
      rotation
    });
    addMesh({
      parent,
      name: `${trimNamePrefix}_frame_${index}`,
      geometry: new THREE.BoxGeometry(width + 1.1, height + 1.1, frameDepth),
      material: makeMaterial({ color: frameColor, roughness: 0.84 }),
      position: [
        x + offset,
        y,
        z + Math.cos(rotation[1] || 0) * 0.06
      ],
      rotation
    });
    addMesh({
      parent,
      name: `${trimNamePrefix}_mullion_${index}`,
      geometry: new THREE.BoxGeometry(0.34, height + 0.4, frameDepth + 0.04),
      material: makeMaterial({ color: frameColor, roughness: 0.8 }),
      position: [x + offset, y, z + Math.cos(rotation[1] || 0) * 0.1],
      rotation
    });
    addMesh({
      parent,
      name: `${trimNamePrefix}_crossbar_${index}`,
      geometry: new THREE.BoxGeometry(width - 0.8, 0.28, frameDepth + 0.04),
      material: makeMaterial({ color: frameColor, roughness: 0.8 }),
      position: [x + offset, y + 0.4, z + Math.cos(rotation[1] || 0) * 0.1],
      rotation
    });
  });
};

const addRubbleCluster = ({
  parent,
  namePrefix,
  color = '#3b2213',
  pieces = []
}) => {
  pieces.forEach((piece, index) => {
    addMesh({
      parent,
      name: `${namePrefix}_${index}`,
      geometry: new THREE.BoxGeometry(piece[3], piece[4], piece[5]),
      material: makeMaterial({ color, roughness: 0.95 }),
      position: [piece[0], piece[1], piece[2]],
      rotation: [piece[6] || 0, piece[7] || 0, piece[8] || 0]
    });
  });
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
    name: 'house_trim_belt',
    geometry: new THREE.BoxGeometry(29.4, 1.2, 29.4),
    material: makeMaterial({ color: '#d6d3d1', roughness: 0.82 }),
    position: [0, 30.2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_porch',
    geometry: new THREE.BoxGeometry(16, 1.2, 8.5),
    material: makeMaterial({ color: '#d6d3d1', roughness: 0.82 }),
    position: [0, 8.2, 18.4]
  });
  addMesh({
    parent: group,
    name: 'house_trim_steps',
    geometry: new THREE.BoxGeometry(12, 1.6, 5.5),
    material: makeMaterial({ color: '#7c6f64', roughness: 0.94 }),
    position: [0, 1.4, 21]
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
    name: 'house_door_frame',
    geometry: new THREE.BoxGeometry(6.7, 13.2, 0.5),
    material: makeMaterial({ color: '#d6d3d1', roughness: 0.84 }),
    position: [5, 8, 14.35]
  });
  addMesh({
    parent: group,
    name: 'house_door_awning',
    geometry: new THREE.BoxGeometry(8, 0.7, 4.4),
    material: makeMaterial({ color: '#8b4513', roughness: 0.9 }),
    position: [5, 14.6, 16.7],
    rotation: [-0.12, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'house_chimney',
    geometry: new THREE.BoxGeometry(3.4, 11, 3.4),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.9 }),
    position: [6.6, 39, -2]
  });
  addMesh({
    parent: group,
    name: 'house_roof_ridge',
    geometry: new THREE.BoxGeometry(26, 1.1, 2),
    material: makeMaterial({ color: '#6b3412', roughness: 0.84 }),
    position: [0, 42.2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_gutter_front',
    geometry: new THREE.BoxGeometry(31.4, 0.5, 0.6),
    material: makeMaterial({ color: '#9ca3af', roughness: 0.52, metalness: 0.35 }),
    position: [0, 34.4, 14.8]
  });
  addMesh({
    parent: group,
    name: 'house_trim_gutter_back',
    geometry: new THREE.BoxGeometry(31.4, 0.5, 0.6),
    material: makeMaterial({ color: '#9ca3af', roughness: 0.52, metalness: 0.35 }),
    position: [0, 34.4, -14.8]
  });
  addMesh({
    parent: group,
    name: 'house_trim_downspout',
    geometry: new THREE.BoxGeometry(0.55, 18, 0.55),
    material: makeMaterial({ color: '#9ca3af', roughness: 0.52, metalness: 0.35 }),
    position: [-13.8, 16, 14.2]
  });

  addSymmetricWindowSet({
    parent: group,
    windowNamePrefix: 'house_window_front',
    trimNamePrefix: 'house_trim_front',
    y: 15,
    z: 14.95,
    gap: 12.4,
    glassColor: '#475569',
    frameColor: '#d6d3d1'
  });
  addSymmetricWindowSet({
    parent: group,
    windowNamePrefix: 'house_window_back',
    trimNamePrefix: 'house_trim_back',
    y: 15,
    z: -14.95,
    gap: 12.4,
    glassColor: '#475569',
    frameColor: '#d6d3d1',
    rotation: [0, Math.PI, 0]
  });
  addMesh({
    parent: group,
    name: 'house_window_side_left_0',
    geometry: new THREE.BoxGeometry(7.5, 5.4, 0.9),
    material: makeMaterial({
      color: '#475569',
      emissive: '#475569',
      emissiveIntensity: 0.12,
      roughness: 0.18,
      metalness: 0.24
    }),
    position: [-14.95, 17, 0],
    rotation: [0, Math.PI / 2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_window_side_right_0',
    geometry: new THREE.BoxGeometry(7.5, 5.4, 0.9),
    material: makeMaterial({
      color: '#475569',
      emissive: '#475569',
      emissiveIntensity: 0.12,
      roughness: 0.18,
      metalness: 0.24
    }),
    position: [14.95, 17, 0],
    rotation: [0, Math.PI / 2, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_shutter_left',
    geometry: new THREE.BoxGeometry(1.3, 6.5, 0.45),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.92 }),
    position: [-9.8, 15, 14.5]
  });
  addMesh({
    parent: group,
    name: 'house_trim_shutter_right',
    geometry: new THREE.BoxGeometry(1.3, 6.5, 0.45),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.92 }),
    position: [9.8, 15, 14.5]
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
    name: 'house_accent_column_left',
    geometry: new THREE.BoxGeometry(2.4, 30, 2.2),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.72 }),
    position: [-10.8, 19, 13.8]
  });
  addMesh({
    parent: group,
    name: 'house_accent_column_right',
    geometry: new THREE.BoxGeometry(2.4, 30, 2.2),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.72 }),
    position: [10.8, 19, 13.8]
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
  addMesh({
    parent: group,
    name: 'house_door',
    geometry: new THREE.BoxGeometry(6.5, 11.4, 1),
    material: makeMaterial({ color: '#5b6b80', roughness: 0.66, metalness: 0.28 }),
    position: [0, 7.6, 15.05]
  });
  addMesh({
    parent: group,
    name: 'house_trim_entry_canopy',
    geometry: new THREE.BoxGeometry(12, 0.9, 5.2),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.74 }),
    position: [0, 14.5, 17.1],
    rotation: [-0.08, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'house_trim_entry_step',
    geometry: new THREE.BoxGeometry(11, 1.6, 6.5),
    material: makeMaterial({ color: '#475569', roughness: 0.94 }),
    position: [0, 1.4, 18]
  });

  [-8.4, 0, 8.4].forEach((yOffset, row) => {
    addMesh({
      parent: group,
      name: `house_window_front_${row}`,
      geometry: new THREE.BoxGeometry(20, 3.4, 0.7),
      material: makeMaterial({
        color: '#5f738a',
        emissive: '#475569',
        emissiveIntensity: 0.24,
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
        color: '#5f738a',
        emissive: '#475569',
        emissiveIntensity: 0.2,
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
    material: makeMaterial({ color: '#8ea0b3', roughness: 0.76 }),
    position: [0, 42, 0]
  });
  addMesh({
    parent: group,
    name: 'house_roof_unit_left',
    geometry: new THREE.BoxGeometry(7, 4, 7),
    material: makeMaterial({ color: '#8ea0b3', roughness: 0.8 }),
    position: [-6, 46, -4]
  });
  addMesh({
    parent: group,
    name: 'house_roof_unit_right',
    geometry: new THREE.BoxGeometry(7, 4, 7),
    material: makeMaterial({ color: '#8ea0b3', roughness: 0.8 }),
    position: [6, 46, 4]
  });
  addMesh({
    parent: group,
    name: 'house_roof_rail_front',
    geometry: new THREE.BoxGeometry(22, 1.2, 0.8),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.54, metalness: 0.38 }),
    position: [0, 44.4, 10.6]
  });
  addMesh({
    parent: group,
    name: 'house_roof_rail_back',
    geometry: new THREE.BoxGeometry(22, 1.2, 0.8),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.54, metalness: 0.38 }),
    position: [0, 44.4, -10.6]
  });
  addMesh({
    parent: group,
    name: 'house_roof_antenna',
    geometry: new THREE.CylinderGeometry(0.22, 0.28, 12, 8),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.34, metalness: 0.64 }),
    position: [-8, 52, 2]
  });
  addMesh({
    parent: group,
    name: 'house_roof_dish',
    geometry: new THREE.CylinderGeometry(2.6, 2.6, 0.55, 18),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.36, metalness: 0.54 }),
    position: [8, 48.3, -3],
    rotation: [0.18, 0.3, 0.14]
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
  addRubbleCluster({
    parent: group,
    namePrefix: 'house_wreck_base_rubble',
    color: '#2b160d',
    pieces: [
      [-11, 3, 8, 6, 3, 7, 0.1, 0.2, 0.35],
      [10, 2.5, -8, 5, 2.5, 6, 0.06, -0.15, -0.28],
      [2, 2.2, 11, 7, 2.2, 4, 0.12, 0.4, 0.2],
      [-4, 2.6, -12, 4.4, 2.8, 5, 0.18, -0.22, -0.16]
    ]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_beam_cross',
    geometry: new THREE.BoxGeometry(15, 1.8, 1.8),
    material: makeMaterial({ color: '#1c1917', roughness: 0.92 }),
    position: [4, 7.8, 2],
    rotation: [0.25, 0.42, 0.62]
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
  addRubbleCluster({
    parent: group,
    namePrefix: 'house_wreck_base_rubble',
    color: '#24140b',
    pieces: [
      [-12, 1.8, 9, 8, 2.2, 7, 0.18, -0.15, 0.22],
      [11, 1.8, -10, 7, 2.1, 8, 0.12, 0.28, -0.26],
      [0, 1.4, 0, 10, 1.8, 9, 0.04, 0.12, 0.1],
      [8, 2.4, 12, 5, 2.6, 4.5, 0.22, 0.4, -0.1]
    ]
  });
  addMesh({
    parent: group,
    name: 'house_wreck_roof_fragment',
    geometry: new THREE.BoxGeometry(10, 2.2, 12),
    material: makeMaterial({ color: '#8b4513', roughness: 0.95 }),
    position: [-2, 5, -10],
    rotation: [0.42, 0.18, -0.58]
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
    material: makeMaterial({ color: '#a66a3a', roughness: 0.92 }),
    position: [0, 9, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_root',
    geometry: new THREE.CylinderGeometry(3.8, 5, 4.2, 8),
    material: makeMaterial({ color: '#704626', roughness: 0.96 }),
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
      material: makeMaterial({ color: index === 1 ? '#4ade80' : '#2f855a', roughness: 0.88 }),
      position: [leaf[0], leaf[1], leaf[2]]
    });
  });
  [
    [-8, 18, -4, 5.6],
    [8, 16, 4, 5.2],
    [0, 28, -5, 4.8],
    [3, 23, 8, 5.1]
  ].forEach((leaf, index) => {
    addMesh({
      parent: group,
      name: `tree_canopy_accent_cluster_${index}`,
      geometry: new THREE.SphereGeometry(leaf[3], 10, 10),
      material: makeMaterial({ color: index % 2 === 0 ? '#52a071' : '#4ade80', roughness: 0.86 }),
      position: [leaf[0], leaf[1], leaf[2]]
    });
  });
  [
    [-3.5, 12, -1.5, -0.88],
    [3.5, 12, 1.5, 0.88],
    [-1.5, 17, 4.5, -0.35],
    [2.8, 18, -5, 0.48]
  ].forEach((branch, index) => {
    addMesh({
      parent: group,
      name: `tree_branch_${index}`,
      geometry: new THREE.CylinderGeometry(0.55, 0.85, 9, 6),
      material: makeMaterial({ color: '#a66a3a', roughness: 0.92 }),
      position: [branch[0], branch[1], branch[2]],
      rotation: [0.2, 0, branch[3]]
    });
  });
  addMesh({
    parent: group,
    name: 'tree_root_stone_0',
    geometry: new THREE.DodecahedronGeometry(2.2, 0),
    material: makeMaterial({ color: '#4b5563', roughness: 1 }),
    position: [3.4, 1.2, 2.8],
    rotation: [0.2, 0.4, 0]
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
    material: makeMaterial({ color: '#a66a3a', roughness: 0.92 }),
    position: [0, 9, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_root',
    geometry: new THREE.CylinderGeometry(3.8, 5, 4.2, 8),
    material: makeMaterial({ color: '#704626', roughness: 0.96 }),
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
      material: makeMaterial({ color: index === 1 ? '#84cc16' : '#2f855a', roughness: 0.86 }),
      position: [0, 18 + index * 6, 0]
    });
  });
  [
    [9.4, 16.5, 0],
    [8.2, 22.2, 0],
    [6.2, 27.8, 0],
    [4.5, 33.5, 0]
  ].forEach((cone, index) => {
    addMesh({
      parent: group,
      name: `tree_canopy_layer_${index}`,
      geometry: new THREE.ConeGeometry(cone[0], 8.5, 8),
      material: makeMaterial({ color: index % 2 === 0 ? '#2f855a' : '#84cc16', roughness: 0.88 }),
      position: [0, cone[1], 0]
    });
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_accent_top',
    geometry: new THREE.ConeGeometry(4.5, 10, 6),
    material: makeMaterial({ color: '#4ade80', roughness: 0.84 }),
    position: [0, 36, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_branch_stub_left',
    geometry: new THREE.CylinderGeometry(0.35, 0.55, 4.5, 6),
    material: makeMaterial({ color: '#a66a3a', roughness: 0.92 }),
    position: [-2.8, 14.5, 0],
    rotation: [0.15, 0, -0.92]
  });
  addMesh({
    parent: group,
    name: 'tree_branch_stub_right',
    geometry: new THREE.CylinderGeometry(0.35, 0.55, 4.5, 6),
    material: makeMaterial({ color: '#7c4a22', roughness: 0.96 }),
    position: [2.8, 17, 0],
    rotation: [-0.12, 0, 0.88]
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
    material: makeMaterial({ color: '#8a542b', roughness: 0.96 }),
    position: [0, 7, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_fallen_trunk',
    geometry: new THREE.CylinderGeometry(1.5, 1.9, 20, 8),
    material: makeMaterial({ color: '#9b6236', roughness: 0.94 }),
    position: [8, 5, -6],
    rotation: [0.12, 0.15, -1.05]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_0',
    geometry: new THREE.SphereGeometry(6.5, 10, 10),
    material: makeMaterial({ color: '#2f855a', roughness: 0.86 }),
    position: [11, 7, -9]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_accent_0',
    geometry: new THREE.SphereGeometry(5, 10, 10),
    material: makeMaterial({ color: '#4ade80', roughness: 0.84 }),
    position: [15, 8, -12]
  });
  addMesh({
    parent: group,
    name: 'tree_splinter_0',
    geometry: new THREE.BoxGeometry(1, 7, 1),
    material: makeMaterial({ color: '#a66a3a', roughness: 0.94 }),
    position: [1.4, 13.5, 0.6],
    rotation: [0.12, 0.18, 0.38]
  });
  addMesh({
    parent: group,
    name: 'tree_splinter_1',
    geometry: new THREE.BoxGeometry(0.8, 6, 0.8),
    material: makeMaterial({ color: '#a66a3a', roughness: 0.94 }),
    position: [-1.6, 12.8, -0.8],
    rotation: [-0.1, -0.22, -0.34]
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
    material: makeMaterial({ color: '#8a542b', roughness: 0.96 }),
    position: [0, 7, 0]
  });
  addMesh({
    parent: group,
    name: 'tree_fallen_trunk',
    geometry: new THREE.CylinderGeometry(1.5, 1.9, 20, 8),
    material: makeMaterial({ color: '#9b6236', roughness: 0.94 }),
    position: [8, 5, -6],
    rotation: [0.12, 0.15, -1.05]
  });
  addMesh({
    parent: group,
    name: 'tree_canopy_0',
    geometry: new THREE.ConeGeometry(10, 18, 6),
    material: makeMaterial({ color: '#2f855a', roughness: 0.86 }),
    position: [14, 7, -10],
    rotation: [0.2, 0.5, -0.8]
  });
  addMesh({
    parent: group,
    name: 'tree_splinter_0',
    geometry: new THREE.BoxGeometry(0.9, 7.5, 0.9),
    material: makeMaterial({ color: '#a66a3a', roughness: 0.94 }),
    position: [1.2, 13.2, 0.5],
    rotation: [0.08, 0.15, 0.42]
  });
  addMesh({
    parent: group,
    name: 'tree_root_stone_0',
    geometry: new THREE.DodecahedronGeometry(2, 0),
    material: makeMaterial({ color: '#374151', roughness: 1 }),
    position: [-3.6, 1, 2.2]
  });

  return group;
};

const buildStreetLamp = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_lamp';

  addMesh({
    parent: group,
    name: 'street_metal_pole',
    geometry: new THREE.CylinderGeometry(0.42, 0.6, 28, 10),
    material: makeMaterial({ color: '#475569', roughness: 0.5, metalness: 0.56 }),
    position: [0, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'street_metal_base',
    geometry: new THREE.CylinderGeometry(2.4, 2.8, 1.4, 12),
    material: makeMaterial({ color: '#334155', roughness: 0.68, metalness: 0.36 }),
    position: [0, 0.7, 0]
  });
  addMesh({
    parent: group,
    name: 'street_metal_arm',
    geometry: new THREE.CylinderGeometry(0.24, 0.24, 7.5, 8),
    material: makeMaterial({ color: '#64748b', roughness: 0.42, metalness: 0.58 }),
    position: [2.8, 26.4, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'street_metal_head',
    geometry: new THREE.BoxGeometry(2.6, 1.2, 1.8),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.34, metalness: 0.62 }),
    position: [6.1, 25.8, 0]
  });
  addMesh({
    parent: group,
    name: 'street_emissive_lamp',
    geometry: new THREE.BoxGeometry(2.1, 0.45, 1.2),
    material: makeMaterial({ color: '#fef3c7', emissive: '#fde68a', emissiveIntensity: 0.48, roughness: 0.18, metalness: 0.1 }),
    position: [6.1, 25.1, 0]
  });

  return group;
};

const buildUtilityPole = () => {
  const group = new THREE.Group();
  group.name = 'prop_utility_pole';

  addMesh({
    parent: group,
    name: 'street_wood_pole',
    geometry: new THREE.CylinderGeometry(0.65, 0.95, 32, 8),
    material: makeMaterial({ color: '#7c4a22', roughness: 0.96 }),
    position: [0, 16, 0]
  });
  addMesh({
    parent: group,
    name: 'street_metal_crossbar',
    geometry: new THREE.BoxGeometry(9.5, 0.5, 0.5),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.86, metalness: 0.08 }),
    position: [0, 27.4, 0]
  });
  [-3.2, 0, 3.2].forEach((x, index) => {
    addMesh({
      parent: group,
      name: `street_metal_insulator_${index}`,
      geometry: new THREE.CylinderGeometry(0.34, 0.34, 0.48, 8),
      material: makeMaterial({ color: '#cbd5e1', roughness: 0.3, metalness: 0.54 }),
      position: [x, 26.8, 0]
    });
  });
  addMesh({
    parent: group,
    name: 'street_metal_transformer',
    geometry: new THREE.CylinderGeometry(1.6, 1.6, 3.4, 12),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.38, metalness: 0.58 }),
    position: [2.7, 22.2, 0]
  });

  return group;
};

const buildStreetSign = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_sign';

  addMesh({
    parent: group,
    name: 'street_metal_pole',
    geometry: new THREE.CylinderGeometry(0.24, 0.3, 10.5, 8),
    material: makeMaterial({ color: '#64748b', roughness: 0.42, metalness: 0.56 }),
    position: [0, 5.25, 0]
  });
  addMesh({
    parent: group,
    name: 'street_panel_main',
    geometry: new THREE.BoxGeometry(6.8, 3.2, 0.34),
    material: makeMaterial({ color: '#1d4ed8', roughness: 0.3, metalness: 0.18 }),
    position: [0, 10.1, 0]
  });
  addMesh({
    parent: group,
    name: 'street_panel_trim',
    geometry: new THREE.BoxGeometry(7.3, 3.7, 0.18),
    material: makeMaterial({ color: '#e2e8f0', roughness: 0.72, metalness: 0.26 }),
    position: [0, 10.1, -0.16]
  });
  addMesh({
    parent: group,
    name: 'street_warning_plate',
    geometry: new THREE.BoxGeometry(2.4, 1.4, 0.22),
    material: makeMaterial({ color: '#f59e0b', roughness: 0.56, metalness: 0.16 }),
    position: [0, 7.1, 0]
  });

  return group;
};

const buildRoadBarrier = () => {
  const group = new THREE.Group();
  group.name = 'prop_road_barrier';

  addMesh({
    parent: group,
    name: 'street_warning_block',
    geometry: new THREE.BoxGeometry(9, 2.8, 2.6),
    material: makeMaterial({ color: '#f97316', roughness: 0.74, metalness: 0.08 }),
    position: [0, 1.4, 0]
  });
  addMesh({
    parent: group,
    name: 'street_warning_stripe',
    geometry: new THREE.BoxGeometry(8.8, 0.45, 0.18),
    material: makeMaterial({ color: '#f8fafc', roughness: 0.82 }),
    position: [0, 1.4, 1.36],
    rotation: [0, 0, 0.2]
  });
  addMesh({
    parent: group,
    name: 'street_warning_stripe_back',
    geometry: new THREE.BoxGeometry(8.8, 0.45, 0.18),
    material: makeMaterial({ color: '#f8fafc', roughness: 0.82 }),
    position: [0, 1.4, -1.36],
    rotation: [0, Math.PI, -0.2]
  });
  [-2.5, 2.5].forEach((x, index) => {
    addMesh({
      parent: group,
      name: `street_metal_foot_${index}`,
      geometry: new THREE.BoxGeometry(2.2, 0.7, 3.4),
      material: makeMaterial({ color: '#475569', roughness: 0.58, metalness: 0.28 }),
      position: [x, 0.35, 0]
    });
  });

  return group;
};

const buildSupplyCrate = () => {
  const group = new THREE.Group();
  group.name = 'prop_supply_crate';

  addMesh({
    parent: group,
    name: 'street_crate_body',
    geometry: new THREE.BoxGeometry(6, 4, 4),
    material: makeMaterial({ color: '#8b5e34', roughness: 0.92 }),
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'street_crate_lid',
    geometry: new THREE.BoxGeometry(6.2, 0.6, 4.2),
    material: makeMaterial({ color: '#6b4423', roughness: 0.9 }),
    position: [0, 4.1, 0]
  });
  addMesh({
    parent: group,
    name: 'street_tarp_roll',
    geometry: new THREE.CylinderGeometry(0.8, 0.8, 4.4, 10),
    material: makeMaterial({ color: '#475569', roughness: 0.82, metalness: 0.12 }),
    position: [0.2, 5.1, 0],
    rotation: [0, 0, Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'street_metal_latch',
    geometry: new THREE.BoxGeometry(0.6, 0.9, 0.22),
    material: makeMaterial({ color: '#cbd5e1', roughness: 0.36, metalness: 0.62 }),
    position: [2.6, 2.2, 2.12]
  });

  return group;
};

const buildStreetWreck = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_wreck';

  addMesh({
    parent: group,
    name: 'street_wreck_body',
    geometry: new THREE.BoxGeometry(12, 4.5, 22),
    material: makeMaterial({ color: '#7f1d1d', roughness: 0.82, metalness: 0.22 }),
    position: [0, 3.5, 0],
    rotation: [0.06, 0.14, -0.1]
  });
  addMesh({
    parent: group,
    name: 'street_wreck_cabin',
    geometry: new THREE.BoxGeometry(8.5, 3.2, 10),
    material: makeMaterial({ color: '#334155', roughness: 0.64, metalness: 0.3 }),
    position: [0.8, 6.1, -2.5],
    rotation: [0.18, 0.2, 0.24]
  });
  addMesh({
    parent: group,
    name: 'street_glass_window',
    geometry: new THREE.BoxGeometry(6.6, 1.8, 0.18),
    material: makeMaterial({ color: '#93c5fd', emissive: '#60a5fa', emissiveIntensity: 0.12, roughness: 0.14, metalness: 0.22 }),
    position: [0.9, 6.5, 2.4],
    rotation: [0.22, 0.2, 0.24]
  });
  [-4.5, 4.5].forEach((x, index) => {
    addMesh({
      parent: group,
      name: `street_metal_wheel_${index}`,
      geometry: new THREE.CylinderGeometry(1.3, 1.3, 1.2, 12),
      material: makeMaterial({ color: '#111827', roughness: 0.64, metalness: 0.32 }),
      position: [x, 1.2, index === 0 ? 6.4 : -6.4],
      rotation: [Math.PI / 2, 0.2, 0]
    });
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
  buildBrokenPineTree(),
  buildStreetLamp(),
  buildUtilityPole(),
  buildStreetSign(),
  buildRoadBarrier(),
  buildSupplyCrate(),
  buildStreetWreck()
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
