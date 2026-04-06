import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { installPolyfills, autoMap } from './falloutTextureUtils.mjs';

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
const outPath = path.join(outDir, 'command_effects.glb');

const mat = ({ color, emissive = '#000000', emissiveIntensity = 0, roughness = 0.54, metalness = 0.18, opacity = 1, side, transparent = opacity < 1 }) => {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: opacity >= 0.96,
    ...(side !== undefined ? { side } : {})
  });
  if (opacity >= 0.96 && emissiveIntensity <= 0.35) material.map = autoMap(color);
  return material;
};

const addMesh = ({ parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
};

const addDisc = (parent, name, radius, material, y = 0, innerRadius = null) => {
  const geometry = innerRadius == null
    ? new THREE.CircleGeometry(radius, 40)
    : new THREE.RingGeometry(innerRadius, radius, 44);
  return addMesh({ parent, name, geometry, material, position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0] });
};

const addCylinder = (parent, name, radiusTop, radiusBottom, height, radialSegments, material, position, rotation = [0, 0, 0], openEnded = false) => (
  addMesh({ parent, name, geometry: new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 2, openEnded), material, position, rotation })
);

const addTorus = (parent, name, radius, tube, material, position = [0, 0, 0], rotation = [Math.PI / 2, 0, 0]) => (
  addMesh({ parent, name, geometry: new THREE.TorusGeometry(radius, tube, 12, 56), material, position, rotation })
);

const ORBIT = {
  steel: mat({ color: '#15324d', emissive: '#38bdf8', emissiveIntensity: 0.45, roughness: 0.28, metalness: 0.76 }),
  glow: mat({ color: '#38bdf8', emissive: '#7dd3fc', emissiveIntensity: 2.6, opacity: 0.34, roughness: 0.08, metalness: 0.08, side: THREE.DoubleSide }),
  core: mat({ color: '#f0f9ff', emissive: '#ffffff', emissiveIntensity: 3.2, opacity: 0.72, roughness: 0.02, metalness: 0.24 }),
  scorch: mat({ color: '#08111b', emissive: '#0f172a', emissiveIntensity: 0.24, roughness: 0.96, metalness: 0.02 }),
};

const FIRE = {
  smoke: mat({ color: '#1c1714', emissive: '#3f1b0f', emissiveIntensity: 0.18, roughness: 0.98, metalness: 0.01, opacity: 0.52, side: THREE.DoubleSide }),
  flame: mat({ color: '#fb923c', emissive: '#f97316', emissiveIntensity: 2.6, roughness: 0.14, metalness: 0.02, opacity: 0.68, side: THREE.DoubleSide }),
  ember: mat({ color: '#f59e0b', emissive: '#fbbf24', emissiveIntensity: 2.2, roughness: 0.08, metalness: 0.02, opacity: 0.74 }),
  char: mat({ color: '#120805', emissive: '#431407', emissiveIntensity: 0.18, roughness: 0.98, metalness: 0.02 }),
};

const SPEAR = {
  rod: mat({ color: '#d1d5db', emissive: '#f97316', emissiveIntensity: 0.32, roughness: 0.16, metalness: 0.94 }),
  plasma: mat({ color: '#f97316', emissive: '#fb923c', emissiveIntensity: 2.2, roughness: 0.08, metalness: 0.04, opacity: 0.28, side: THREE.DoubleSide }),
  flash: mat({ color: '#fff7ed', emissive: '#ffffff', emissiveIntensity: 3.6, roughness: 0.04, metalness: 0.06, opacity: 0.72 }),
  crater: mat({ color: '#0f0a08', emissive: '#431407', emissiveIntensity: 0.2, roughness: 0.98, metalness: 0.02 }),
};

const makeOrbitalLance = () => {
  const root = new THREE.Group();
  root.name = 'support_orbital_lance';

  addCylinder(root, 'support_orbital_lance_beam', 16, 26, 320, 20, ORBIT.glow, [0, 160, 0], [0, 0, 0], true);
  addCylinder(root, 'support_orbital_lance_core', 3.8, 6.2, 314, 12, ORBIT.core, [0, 157, 0]);
  addTorus(root, 'support_orbital_lance_ring_inner', 34, 3.8, ORBIT.glow, [0, 6, 0]);
  addTorus(root, 'support_orbital_lance_ring_outer', 78, 6.8, mat({ color: '#7dd3fc', emissive: '#bae6fd', emissiveIntensity: 1.8, opacity: 0.24, roughness: 0.1 }), [0, 2, 0]);
  addMesh({ parent: root, name: 'support_orbital_lance_flare_top', geometry: new THREE.OctahedronGeometry(16, 2), material: ORBIT.core, position: [0, 308, 0], scale: [1.8, 0.26, 1.8] });
  addMesh({ parent: root, name: 'support_orbital_lance_flare_base', geometry: new THREE.SphereGeometry(18, 16, 10), material: mat({ color: '#38bdf8', emissive: '#7dd3fc', emissiveIntensity: 2.8, opacity: 0.58, roughness: 0.04 }), position: [0, 10, 0], scale: [2.1, 0.42, 2.1] });
  addCylinder(root, 'support_orbital_lance_impact', 10, 42, 58, 18, mat({ color: '#7dd3fc', emissive: '#0ea5e9', emissiveIntensity: 1.9, opacity: 0.42, roughness: 0.1, side: THREE.DoubleSide }), [0, 24, 0], [0, 0, 0], true);
  addTorus(root, 'support_orbital_lance_shock', 122, 9, mat({ color: '#dbeafe', emissive: '#7dd3fc', emissiveIntensity: 1.1, opacity: 0.16, roughness: 0.16 }), [0, 1, 0]);

  addDisc(root, 'orbital_scorch', 64, ORBIT.scorch, 0.12);
  addDisc(root, 'orbital_scorch_hot', 20, mat({ color: '#0f3b66', emissive: '#38bdf8', emissiveIntensity: 1.2, opacity: 0.74, roughness: 0.84 }), 0.16);
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    addCylinder(
      root,
      `orbital_arc_${index}`,
      0.3,
      0.08,
      48 + index * 9,
      6,
      mat({ color: '#e0f2fe', emissive: '#ffffff', emissiveIntensity: 3.2, opacity: 0.66, roughness: 0.04 }),
      [Math.sin(angle) * 7, 82 + index * 18, Math.cos(angle) * 7],
      [0.18 * Math.sin(angle), 0, -0.22 * Math.cos(angle)]
    );
  }
  return root;
};

const makeFireLobe = (radius, height, material) => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(radius * 0.42, height * 0.14, radius * 0.92, height * 0.46, 0, height);
  shape.bezierCurveTo(-radius * 0.82, height * 0.54, -radius * 0.42, height * 0.14, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: radius * 0.26, bevelEnabled: true, bevelSize: radius * 0.08, bevelThickness: radius * 0.06, bevelSegments: 2, curveSegments: 16 });
  geometry.center();
  return new THREE.Mesh(geometry, material);
};

const makeFirestorm = () => {
  const root = new THREE.Group();
  root.name = 'support_firestorm';

  addTorus(root, 'support_firestorm_ring', 88, 8, FIRE.flame, [0, 3, 0]);
  addMesh({ parent: root, name: 'support_firestorm_core', geometry: new THREE.IcosahedronGeometry(28, 1), material: mat({ color: '#fff7ed', emissive: '#f97316', emissiveIntensity: 3.3, opacity: 0.78, roughness: 0.08 }), position: [0, 18, 0], scale: [1.3, 0.56, 1.3] });

  const flameLayout = [
    [0, 0, 0, 22, 72], [40, 0, -24, 15, 54], [-44, 0, -18, 14, 50], [50, 0, 26, 16, 58], [-54, 0, 24, 14, 52], [12, 0, 62, 15, 56]
  ];
  flameLayout.forEach(([x, y, z, radius, height], index) => {
    const flame = makeFireLobe(radius, height, FIRE.flame);
    flame.name = `support_firestorm_flame_${index}`;
    flame.position.set(x, 20 + index, z);
    flame.rotation.z = (index % 2 === 0 ? 1 : -1) * (0.08 + index * 0.02);
    root.add(flame);
  });

  const smokeLayout = [
    [-34, 46, -14, 18], [24, 66, 20, 23], [6, 92, -30, 28], [-18, 118, 26, 32]
  ];
  smokeLayout.forEach(([x, y, z, radius], index) => {
    addMesh({ parent: root, name: `support_firestorm_smoke_${index}`, geometry: new THREE.IcosahedronGeometry(radius, 1), material: FIRE.smoke, position: [x, y, z], scale: [1.35, 0.68, 1.35] });
  });

  addTorus(root, 'support_firestorm_shock', 140, 9.5, mat({ color: '#fb923c', emissive: '#fdba74', emissiveIntensity: 1.4, opacity: 0.2, roughness: 0.18 }), [0, 2, 0]);
  addCylinder(root, 'support_firestorm_plume', 20, 56, 136, 18, FIRE.smoke, [0, 68, 0], [0, 0, 0], true);

  addDisc(root, 'firestorm_char_field', 116, FIRE.char, 0.1);
  addDisc(root, 'firestorm_ember_field', 40, FIRE.ember, 0.16);
  addTorus(root, 'firestorm_ground_roll', 54, 12, mat({ color: '#dc2626', emissive: '#f97316', emissiveIntensity: 1.8, opacity: 0.42, roughness: 0.1 }), [0, 8, 0]);
  return root;
};

const makeKineticSpear = () => {
  const root = new THREE.Group();
  root.name = 'support_kinetic_spear';

  addCylinder(root, 'support_kinetic_spear_shaft', 2.6, 4.1, 300, 14, SPEAR.rod, [0, 150, 0]);
  addMesh({ parent: root, name: 'support_kinetic_spear_tip', geometry: new THREE.ConeGeometry(6.2, 30, 14), material: mat({ color: '#fef9c3', emissive: '#ffffff', emissiveIntensity: 4.1, roughness: 0.04, metalness: 0.38 }), position: [0, 6, 0] });
  addMesh({ parent: root, name: 'support_kinetic_spear_flare', geometry: new THREE.SphereGeometry(20, 16, 10), material: SPEAR.flash, position: [0, 16, 0], scale: [2.2, 0.44, 2.2] });
  addCylinder(root, 'support_kinetic_spear_impact', 12, 52, 62, 20, mat({ color: '#78350f', emissive: '#f97316', emissiveIntensity: 1.5, opacity: 0.38, roughness: 0.8, side: THREE.DoubleSide }), [0, 24, 0], [0, 0, 0], true);
  addTorus(root, 'support_kinetic_spear_ring', 90, 7.5, mat({ color: '#dbeafe', emissive: '#ffffff', emissiveIntensity: 1.8, opacity: 0.28, roughness: 0.14 }), [0, 1.5, 0]);

  addCylinder(root, 'kinetic_plasma_sheath', 10, 18, 306, 16, SPEAR.plasma, [0, 153, 0], [0, 0, 0], true);
  addCylinder(root, 'kinetic_heat_wake', 2.0, 5.2, 96, 12, mat({ color: '#fb923c', emissive: '#f59e0b', emissiveIntensity: 2.0, opacity: 0.34, roughness: 0.08, side: THREE.DoubleSide }), [0, 72, 0], [0, 0, 0], true);
  addDisc(root, 'kinetic_crater', 66, SPEAR.crater, 0.1);
  addDisc(root, 'kinetic_crater_hot', 18, mat({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 2.6, opacity: 0.7, roughness: 0.88 }), 0.16);
  addTorus(root, 'kinetic_ring_outer', 134, 6.2, mat({ color: '#f1f5f9', emissive: '#e2e8f0', emissiveIntensity: 0.8, opacity: 0.12, roughness: 0.18 }), [0, 0.8, 0]);
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
