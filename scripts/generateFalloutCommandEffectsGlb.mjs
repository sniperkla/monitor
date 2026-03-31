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
const outPath = path.join(outDir, 'command_effects.glb');

const makeMaterial = ({
  color,
  emissive = color,
  emissiveIntensity = 0.6,
  opacity = 1,
  roughness = 0.52,
  metalness = 0.06
}) => new THREE.MeshStandardMaterial({
  color,
  emissive,
  emissiveIntensity,
  roughness,
  metalness,
  transparent: opacity < 1,
  opacity,
  depthWrite: opacity >= 0.98
});

const makeOrbitalLance = () => {
  const root = new THREE.Group();
  root.name = 'support_orbital_lance';

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 9, 280, 16, 1, false),
    makeMaterial({ color: '#7dd3fc', emissive: '#67e8f9', emissiveIntensity: 1.2, opacity: 0.52, roughness: 0.22 })
  );
  beam.name = 'support_orbital_lance_beam';
  beam.position.y = 140;
  root.add(beam);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(18, 14, 10),
    makeMaterial({ color: '#e0f2fe', emissive: '#bae6fd', emissiveIntensity: 1.6, opacity: 0.72, roughness: 0.18 })
  );
  core.name = 'support_orbital_lance_core';
  core.position.y = 14;
  core.scale.set(1.2, 0.72, 1.2);
  root.add(core);

  const ringInner = new THREE.Mesh(
    new THREE.TorusGeometry(38, 4.6, 10, 40),
    makeMaterial({ color: '#38bdf8', emissive: '#7dd3fc', emissiveIntensity: 1.0, opacity: 0.46, roughness: 0.24 })
  );
  ringInner.name = 'support_orbital_lance_ring_inner';
  ringInner.rotation.x = Math.PI / 2;
  ringInner.position.y = 4;
  root.add(ringInner);

  const ringOuter = new THREE.Mesh(
    new THREE.TorusGeometry(62, 5.4, 10, 56),
    makeMaterial({ color: '#93c5fd', emissive: '#bfdbfe', emissiveIntensity: 0.95, opacity: 0.34, roughness: 0.28 })
  );
  ringOuter.name = 'support_orbital_lance_ring_outer';
  ringOuter.rotation.x = Math.PI / 2;
  ringOuter.position.y = 2;
  root.add(ringOuter);

  const flareTop = new THREE.Mesh(
    new THREE.SphereGeometry(24, 12, 10),
    makeMaterial({ color: '#f8fafc', emissive: '#e0f2fe', emissiveIntensity: 1.3, opacity: 0.4, roughness: 0.14 })
  );
  flareTop.name = 'support_orbital_lance_flare_top';
  flareTop.position.y = 264;
  flareTop.scale.set(1.8, 0.55, 1.8);
  root.add(flareTop);

  const flareBase = new THREE.Mesh(
    new THREE.TorusGeometry(28, 7, 10, 30),
    makeMaterial({ color: '#a5f3fc', emissive: '#67e8f9', emissiveIntensity: 1.05, opacity: 0.45, roughness: 0.22 })
  );
  flareBase.name = 'support_orbital_lance_flare_base';
  flareBase.rotation.x = Math.PI / 2;
  flareBase.position.y = 10;
  root.add(flareBase);

  const impact = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 36, 34, 18, 1, true),
    makeMaterial({ color: '#e0f2fe', emissive: '#7dd3fc', emissiveIntensity: 1.6, opacity: 0.64, roughness: 0.12 })
  );
  impact.name = 'support_orbital_lance_impact';
  impact.position.y = 14;
  root.add(impact);

  const shock = new THREE.Mesh(
    new THREE.TorusGeometry(92, 9, 12, 64),
    makeMaterial({ color: '#bae6fd', emissive: '#e0f2fe', emissiveIntensity: 1.05, opacity: 0.36, roughness: 0.18 })
  );
  shock.name = 'support_orbital_lance_shock';
  shock.rotation.x = Math.PI / 2;
  shock.position.y = 2;
  root.add(shock);

  return root;
};

const makeFirestorm = () => {
  const root = new THREE.Group();
  root.name = 'support_firestorm';

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(88, 8, 10, 48),
    makeMaterial({ color: '#fb923c', emissive: '#f97316', emissiveIntensity: 1.1, opacity: 0.38, roughness: 0.24 })
  );
  ring.name = 'support_firestorm_ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2;
  root.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(28, 14, 10),
    makeMaterial({ color: '#fed7aa', emissive: '#fb923c', emissiveIntensity: 1.45, opacity: 0.62, roughness: 0.18 })
  );
  core.name = 'support_firestorm_core';
  core.position.y = 10;
  core.scale.set(1.35, 0.6, 1.35);
  root.add(core);

  const flamePositions = [
    [0, 0, 0],
    [42, 0, -18],
    [-38, 0, -24],
    [54, 0, 26],
    [-56, 0, 18],
    [0, 0, 56]
  ];

  flamePositions.forEach((position, index) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(index === 0 ? 18 : 14, index === 0 ? 52 : 38, 8, 1, true),
      makeMaterial({ color: '#fde68a', emissive: '#f97316', emissiveIntensity: 1.25, opacity: 0.58, roughness: 0.14 })
    );
    flame.name = `support_firestorm_flame_${index}`;
    flame.position.set(position[0], 20 + index * 1.5, position[2]);
    flame.rotation.z = (index % 2 === 0 ? -1 : 1) * 0.08;
    root.add(flame);
  });

  const smokePositions = [
    [-24, 26, -10],
    [20, 34, 12],
    [8, 44, -22],
    [-10, 54, 18]
  ];

  smokePositions.forEach((position, index) => {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(14 + index * 2, 10, 8),
      makeMaterial({ color: '#9a3412', emissive: '#7c2d12', emissiveIntensity: 0.28, opacity: 0.22, roughness: 0.92, metalness: 0.02 })
    );
    smoke.name = `support_firestorm_smoke_${index}`;
    smoke.position.set(position[0], position[1], position[2]);
    smoke.scale.set(1.3, 0.84, 1.3);
    root.add(smoke);
  });

  const shock = new THREE.Mesh(
    new THREE.TorusGeometry(126, 10, 12, 64),
    makeMaterial({ color: '#fdba74', emissive: '#fb923c', emissiveIntensity: 0.95, opacity: 0.28, roughness: 0.22 })
  );
  shock.name = 'support_firestorm_shock';
  shock.rotation.x = Math.PI / 2;
  shock.position.y = 3;
  root.add(shock);

  const plume = new THREE.Mesh(
    new THREE.CylinderGeometry(28, 68, 110, 14, 1, true),
    makeMaterial({ color: '#fed7aa', emissive: '#fb923c', emissiveIntensity: 0.82, opacity: 0.22, roughness: 0.16 })
  );
  plume.name = 'support_firestorm_plume';
  plume.position.y = 48;
  root.add(plume);

  return root;
};

const makeKineticSpear = () => {
  const root = new THREE.Group();
  root.name = 'support_kinetic_spear';

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 5.4, 240, 12, 1, false),
    makeMaterial({ color: '#94a3b8', emissive: '#cbd5e1', emissiveIntensity: 0.42, roughness: 0.24, metalness: 0.72 })
  );
  shaft.name = 'support_kinetic_spear_shaft';
  shaft.position.y = 132;
  root.add(shaft);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(10, 34, 10, 1, false),
    makeMaterial({ color: '#f8fafc', emissive: '#7dd3fc', emissiveIntensity: 0.96, roughness: 0.08, metalness: 0.92 })
  );
  tip.name = 'support_kinetic_spear_tip';
  tip.position.y = 7;
  root.add(tip);

  const flare = new THREE.Mesh(
    new THREE.SphereGeometry(18, 12, 10),
    makeMaterial({ color: '#f8fafc', emissive: '#e2e8f0', emissiveIntensity: 1.28, opacity: 0.36, roughness: 0.12 })
  );
  flare.name = 'support_kinetic_spear_flare';
  flare.position.y = 18;
  flare.scale.set(1.9, 0.5, 1.9);
  root.add(flare);

  const impact = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 44, 40, 16, 1, true),
    makeMaterial({ color: '#f8fafc', emissive: '#7dd3fc', emissiveIntensity: 1.18, opacity: 0.42, roughness: 0.1 })
  );
  impact.name = 'support_kinetic_spear_impact';
  impact.position.y = 10;
  root.add(impact);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(76, 7, 10, 56),
    makeMaterial({ color: '#cbd5e1', emissive: '#7dd3fc', emissiveIntensity: 0.92, opacity: 0.32, roughness: 0.2 })
  );
  ring.name = 'support_kinetic_spear_ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2;
  root.add(ring);

  return root;
};

const scene = new THREE.Scene();
scene.add(makeOrbitalLance());
scene.add(makeFirestorm());
scene.add(makeKineticSpear());

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
