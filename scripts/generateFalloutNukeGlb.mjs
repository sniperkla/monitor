import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { addMesh, makeMaterial } from './generateUtils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'fallout');
const outPath = path.join(outDir, 'nuke_cloud.glb');

const makeMat = ({ roughness = 0.76, metalness = 0.04, transparent = false, opacity = 1, ...options }) => (
  makeMaterial({
    roughness,
    metalness,
    transparent,
    opacity,
    side: THREE.DoubleSide,
    ...options,
  })
);

const smokeMat = makeMat({ color: '#969da7', emissive: '#fb923c', emissiveIntensity: 0.1, transparent: true, opacity: 0.42, roughness: 0.96 });
const hotSmokeMat = makeMat({ color: '#c5ccd4', emissive: '#fdba74', emissiveIntensity: 0.14, transparent: true, opacity: 0.46, roughness: 0.9 });
const emberMat = makeMat({ color: '#f97316', emissive: '#fb923c', emissiveIntensity: 1.5, transparent: true, opacity: 0.62, roughness: 0.18 });
const flashMat = makeMat({ color: '#fff7ed', emissive: '#ffffff', emissiveIntensity: 1.8, transparent: true, opacity: 0.5, roughness: 0.04 });
const dustMat = makeMat({ color: '#b8a38b', emissive: '#d97706', emissiveIntensity: 0.05, transparent: true, opacity: 0.22, roughness: 0.98 });
const updraftMat = makeMat({ color: '#a8b0ba', emissive: '#f97316', emissiveIntensity: 0.04, transparent: true, opacity: 0.2, roughness: 0.98 });
const smokeRingMat = makeMat({ color: '#b3bac3', emissive: '#fdba74', emissiveIntensity: 0.08, transparent: true, opacity: 0.24, roughness: 0.96 });
const ring0Mat = makeMat({ color: '#fed7aa', emissive: '#fdba74', emissiveIntensity: 0.65, transparent: true, opacity: 0.36, roughness: 0.18 });
const ring1Mat = makeMat({ color: '#fdba74', emissive: '#fb923c', emissiveIntensity: 0.42, transparent: true, opacity: 0.24, roughness: 0.22 });
const debrisMat = makeMat({ color: '#6b5c50', emissive: '#92400e', emissiveIntensity: 0.04, roughness: 0.96, metalness: 0.02, transparent: false, opacity: 1 });
const heatColumnMat = makeMat({ color: '#f3f4f6', emissive: '#fbbf24', emissiveIntensity: 0.03, transparent: true, opacity: 0.05, roughness: 0.24 });

const addBillow = (parent, name, radius, position, scale = [1, 1, 1], material = smokeMat) => (
  addMesh({ parent, name, geometry: new THREE.IcosahedronGeometry(radius, 1), material, position, scale })
);

const root = new THREE.Group();
root.name = 'nuke_root';

const stemLayout = [
  { radiusTop: 7, radiusBottom: 24, height: 30, y: 15, color: '#6b7280', ei: 0.18 },
  { radiusTop: 10, radiusBottom: 16, height: 30, y: 45, color: '#7c8794', ei: 0.14 },
  { radiusTop: 15, radiusBottom: 12, height: 24, y: 78, color: '#b8c2ce', ei: 0.1 },
];
stemLayout.forEach((segment, index) => {
  addMesh({
    parent: root,
    name: `nuke_stem_${index}`,
    geometry: new THREE.CylinderGeometry(segment.radiusTop, segment.radiusBottom, segment.height, 10, 1, true),
    material: makeMat({ color: segment.color, emissive: '#f97316', emissiveIntensity: segment.ei, transparent: true, opacity: 0.42, roughness: 0.92 }),
    position: [0, segment.y, 0],
  });
});

for (let index = 0; index < 4; index += 1) {
  const angle = (index / 4) * Math.PI * 2;
  const radius = 18 + (index % 2) * 8;
  const height = 62 + (index % 2) * 18;
  addMesh({
    parent: root,
    name: `nuke_updraft_${index}`,
    geometry: new THREE.CylinderGeometry(3.2 + (index % 2), 5.0 + (index % 2), height, 8, 1, true),
    material: updraftMat,
    position: [Math.cos(angle) * radius, height * 0.5 + 8, Math.sin(angle) * radius],
    rotation: [0.08 * Math.sin(angle), angle * 0.12, 0.08 * Math.cos(angle)],
  });
}

addBillow(root, 'nuke_plume', 18, [0, 86, 0], [1.22, 0.68, 1.22], hotSmokeMat);
addBillow(root, 'nuke_cap', 32, [0, 124, 0], [1.24, 0.72, 1.24], hotSmokeMat);

const lobeLayout = [
  [-24, 114, 16, 16], [24, 114, 8, 15], [16, 132, -18, 16], [-18, 134, -14, 15], [0, 144, 0, 20]
];
lobeLayout.forEach(([x, y, z, radius], index) => {
  addBillow(root, `nuke_lobe_${index}`, radius, [x, y, z], [1 + (index % 3) * 0.08, 0.72 + (index % 2) * 0.12, 1 + ((index + 1) % 3) * 0.06], index >= 4 ? hotSmokeMat : smokeMat);
});

addMesh({ parent: root, name: 'nuke_smoke_ring', geometry: new THREE.TorusGeometry(30, 7, 8, 18), material: smokeRingMat, position: [0, 92, 0], rotation: [Math.PI / 2, 0, 0] });
addMesh({ parent: root, name: 'nuke_fire_core', geometry: new THREE.IcosahedronGeometry(15, 1), material: emberMat, position: [0, 24, 0], scale: [1.2, 1.0, 1.2] });
addMesh({ parent: root, name: 'nuke_ember', geometry: new THREE.IcosahedronGeometry(8, 0), material: emberMat, position: [0, 8, 0], scale: [1.1, 0.68, 1.1] });

[
  { name: 'nuke_ring_0', radius: 42, tube: 3.6, material: ring0Mat, y: 6 },
  { name: 'nuke_ring_1', radius: 62, tube: 2.8, material: ring1Mat, y: 9 },
].forEach(({ name, radius, tube, material, y }) => {
  addMesh({
    parent: root,
    name,
    geometry: new THREE.TorusGeometry(radius, tube, 6, 18),
    material,
    position: [0, y, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
});

addMesh({ parent: root, name: 'nuke_flash', geometry: new THREE.OctahedronGeometry(22, 1), material: flashMat, position: [0, 30, 0], scale: [1.3, 0.9, 1.3] });
addMesh({ parent: root, name: 'nuke_dust_skirt', geometry: new THREE.CylinderGeometry(52, 60, 4, 14, 1, true), material: dustMat, position: [0, 2, 0] });

for (let index = 0; index < 4; index += 1) {
  const angle = (index / 4) * Math.PI * 2 + index * 0.32;
  const dist = 24 + (index % 2) * 14;
  addMesh({
    parent: root,
    name: `nuke_debris_${index}`,
    geometry: new THREE.BoxGeometry(3 + index * 0.4, 2.2 + index * 0.3, 2.6 + (index % 2) * 0.5),
    material: debrisMat,
    position: [Math.cos(angle) * dist, 6 + (index % 4) * 9, Math.sin(angle) * dist],
  });
}

addMesh({ parent: root, name: 'nuke_heat_column', geometry: new THREE.CylinderGeometry(16, 22, 150, 8, 1, true), material: heatColumnMat, position: [0, 78, 0] });

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
