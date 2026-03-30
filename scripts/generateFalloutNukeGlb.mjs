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
const outPath = path.join(outDir, 'nuke_cloud.glb');

const makeMaterial = (color, emissive = color, emissiveIntensity = 0.4, transparent = false, opacity = 1) => (
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.72,
    metalness: 0.04,
    transparent,
    opacity,
    depthWrite: !transparent
  })
);

const root = new THREE.Group();
root.name = 'nuke_root';

const stem = new THREE.Mesh(
  new THREE.CylinderGeometry(7, 18, 70, 8, 1, false),
  makeMaterial('#6b7280', '#f97316', 0.18)
);
stem.name = 'nuke_stem';
stem.position.y = 42;
root.add(stem);

const cap = new THREE.Mesh(
  new THREE.SphereGeometry(34, 10, 8),
  makeMaterial('#9ca3af', '#fb923c', 0.22)
);
cap.name = 'nuke_cap';
cap.position.y = 108;
cap.scale.set(1.22, 0.82, 1.22);
root.add(cap);

const plume = new THREE.Mesh(
  new THREE.SphereGeometry(18, 9, 7),
  makeMaterial('#d1d5db', '#fdba74', 0.16)
);
plume.name = 'nuke_plume';
plume.position.y = 74;
plume.scale.set(1.18, 0.72, 1.18);
root.add(plume);

const ember = new THREE.Mesh(
  new THREE.SphereGeometry(10, 8, 6),
  makeMaterial('#f97316', '#fb923c', 1.2, true, 0.78)
);
ember.name = 'nuke_ember';
ember.position.y = 16;
root.add(ember);

const shockRing = new THREE.Mesh(
  new THREE.TorusGeometry(38, 4.5, 6, 18),
  makeMaterial('#fed7aa', '#fdba74', 0.9, true, 0.45)
);
shockRing.name = 'nuke_ring';
shockRing.rotation.x = Math.PI / 2;
shockRing.position.y = 8;
root.add(shockRing);

const flash = new THREE.Mesh(
  new THREE.SphereGeometry(24, 8, 6),
  makeMaterial('#fff7ed', '#ffffff', 1.8, true, 0.52)
);
flash.name = 'nuke_flash';
flash.position.y = 28;
flash.scale.set(1.2, 0.9, 1.2);
root.add(flash);

const lobeOffsets = [
  [-18, 101, 14],
  [20, 98, 8],
  [14, 113, -17],
  [-16, 111, -12],
  [0, 121, 0]
];

lobeOffsets.forEach((offset, index) => {
  const lobe = new THREE.Mesh(
    new THREE.SphereGeometry(index === lobeOffsets.length - 1 ? 21 : 16, 8, 6),
    makeMaterial('#cbd5e1', '#fb923c', index === lobeOffsets.length - 1 ? 0.26 : 0.18)
  );
  lobe.name = `nuke_lobe_${index}`;
  lobe.position.set(offset[0], offset[1], offset[2]);
  lobe.scale.set(
    index === lobeOffsets.length - 1 ? 1.15 : 1,
    index === lobeOffsets.length - 1 ? 0.82 : 0.78,
    index === lobeOffsets.length - 1 ? 1.15 : 1
  );
  root.add(lobe);
});

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
