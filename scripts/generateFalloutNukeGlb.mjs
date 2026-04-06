import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { installPolyfills } from './falloutTextureUtils.mjs';

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
const outPath = path.join(outDir, 'nuke_cloud.glb');

const makeMat = ({ color, emissive = '#000000', emissiveIntensity = 0, roughness = 0.76, metalness = 0.04, transparent = false, opacity = 1 }) => (
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: !transparent,
    side: THREE.DoubleSide,
  })
);

const smokeMat = makeMat({ color: '#9ca3af', emissive: '#fb923c', emissiveIntensity: 0.14, transparent: true, opacity: 0.52, roughness: 0.96 });
const hotSmokeMat = makeMat({ color: '#d1d5db', emissive: '#fdba74', emissiveIntensity: 0.24, transparent: true, opacity: 0.58, roughness: 0.88 });
const emberMat = makeMat({ color: '#f97316', emissive: '#fb923c', emissiveIntensity: 2.0, transparent: true, opacity: 0.72, roughness: 0.18 });
const flashMat = makeMat({ color: '#fff7ed', emissive: '#ffffff', emissiveIntensity: 3.4, transparent: true, opacity: 0.62, roughness: 0.04 });
const dustMat = makeMat({ color: '#b8a38b', emissive: '#d97706', emissiveIntensity: 0.08, transparent: true, opacity: 0.3, roughness: 0.98 });

const addMesh = ({ parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
};

const addBillow = (parent, name, radius, position, scale = [1, 1, 1], material = smokeMat) => (
  addMesh({ parent, name, geometry: new THREE.IcosahedronGeometry(radius, 2), material, position, scale })
);

const root = new THREE.Group();
root.name = 'nuke_root';

const stemLayout = [
  { radiusTop: 7, radiusBottom: 24, height: 28, y: 14, color: '#6b7280', ei: 0.26 },
  { radiusTop: 9, radiusBottom: 15, height: 26, y: 40, color: '#7c8794', ei: 0.2 },
  { radiusTop: 11, radiusBottom: 11, height: 22, y: 66, color: '#9aa4b1', ei: 0.14 },
  { radiusTop: 16, radiusBottom: 12, height: 20, y: 88, color: '#b8c2ce', ei: 0.12 },
];
stemLayout.forEach((segment, index) => {
  addMesh({
    parent: root,
    name: `nuke_stem_${index}`,
    geometry: new THREE.CylinderGeometry(segment.radiusTop, segment.radiusBottom, segment.height, 16, 2, true),
    material: makeMat({ color: segment.color, emissive: '#f97316', emissiveIntensity: segment.ei, transparent: true, opacity: 0.56, roughness: 0.92 }),
    position: [0, segment.y, 0],
  });
});

for (let index = 0; index < 6; index += 1) {
  const angle = (index / 6) * Math.PI * 2;
  const radius = 16 + (index % 2) * 7;
  const height = 56 + (index % 3) * 20;
  addMesh({
    parent: root,
    name: `nuke_updraft_${index}`,
    geometry: new THREE.CylinderGeometry(3.2 + (index % 2), 5.2 + (index % 3), height, 10, 1, true),
    material: makeMat({ color: '#a8b0ba', emissive: '#f97316', emissiveIntensity: 0.06, transparent: true, opacity: 0.28, roughness: 0.98 }),
    position: [Math.cos(angle) * radius, height * 0.5 + 8, Math.sin(angle) * radius],
    rotation: [0.08 * Math.sin(angle), angle * 0.12, 0.08 * Math.cos(angle)],
  });
}

addBillow(root, 'nuke_plume', 22, [0, 92, 0], [1.32, 0.72, 1.32], hotSmokeMat);
addBillow(root, 'nuke_cap', 40, [0, 132, 0], [1.34, 0.76, 1.34], hotSmokeMat);

const lobeLayout = [
  [-28, 120, 18, 18], [26, 116, 10, 17], [18, 136, -22, 18], [-20, 138, -16, 16], [0, 148, 0, 24], [-34, 110, -8, 15], [10, 144, 24, 14], [-12, 152, -20, 13]
];
lobeLayout.forEach(([x, y, z, radius], index) => {
  addBillow(root, `nuke_lobe_${index}`, radius, [x, y, z], [1 + (index % 3) * 0.08, 0.72 + (index % 2) * 0.12, 1 + ((index + 1) % 3) * 0.06], index >= 4 ? hotSmokeMat : smokeMat);
});

addMesh({ parent: root, name: 'nuke_smoke_ring', geometry: new THREE.TorusGeometry(32, 9, 12, 28), material: makeMat({ color: '#b3bac3', emissive: '#fdba74', emissiveIntensity: 0.1, transparent: true, opacity: 0.36, roughness: 0.96 }), position: [0, 98, 0], rotation: [Math.PI / 2, 0, 0] });
addMesh({ parent: root, name: 'nuke_fire_core', geometry: new THREE.IcosahedronGeometry(15, 1), material: emberMat, position: [0, 24, 0], scale: [1.2, 1.0, 1.2] });
addMesh({ parent: root, name: 'nuke_ember', geometry: new THREE.IcosahedronGeometry(10, 1), material: emberMat, position: [0, 8, 0], scale: [1.2, 0.72, 1.2] });

for (let index = 0; index < 3; index += 1) {
  addMesh({
    parent: root,
    name: `nuke_ring_${index}`,
    geometry: new THREE.TorusGeometry(40 + index * 18, 3.8 - index * 0.55, 8, 28),
    material: makeMat({ color: '#fed7aa', emissive: '#fdba74', emissiveIntensity: 1.0 - index * 0.2, transparent: true, opacity: 0.48 - index * 0.1, roughness: 0.18 }),
    position: [0, 6 + index * 2, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
}

addMesh({ parent: root, name: 'nuke_flash', geometry: new THREE.OctahedronGeometry(26, 2), material: flashMat, position: [0, 34, 0], scale: [1.4, 1.0, 1.4] });
addMesh({ parent: root, name: 'nuke_dust_skirt', geometry: new THREE.CylinderGeometry(56, 64, 5, 24, 1, true), material: dustMat, position: [0, 2, 0] });

for (let index = 0; index < 8; index += 1) {
  const angle = (index / 8) * Math.PI * 2 + index * 0.38;
  const dist = 22 + (index % 3) * 12;
  addMesh({
    parent: root,
    name: `nuke_debris_${index}`,
    geometry: new THREE.DodecahedronGeometry(1.8 + (index % 3) * 0.9, 0),
    material: makeMat({ color: '#6b5c50', emissive: '#92400e', emissiveIntensity: 0.05, roughness: 0.96, metalness: 0.02 }),
    position: [Math.cos(angle) * dist, 6 + (index % 4) * 9, Math.sin(angle) * dist],
  });
}

addMesh({ parent: root, name: 'nuke_heat_column', geometry: new THREE.CylinderGeometry(18, 26, 164, 12, 1, true), material: makeMat({ color: '#f3f4f6', emissive: '#fbbf24', emissiveIntensity: 0.04, transparent: true, opacity: 0.08, roughness: 0.24 }), position: [0, 82, 0] });
addMesh({ parent: root, name: 'nuke_cap_glow', geometry: new THREE.CircleGeometry(34, 24), material: makeMat({ color: '#fb923c', emissive: '#f97316', emissiveIntensity: 1.8, transparent: true, opacity: 0.42, roughness: 0.08 }), position: [0, 108, 0], rotation: [Math.PI / 2, 0, 0] });

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
