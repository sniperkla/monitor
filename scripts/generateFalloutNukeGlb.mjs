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

// ─── Material helpers ────────────────────────────────────────────────────────
const makeMat = (color, emissive = color, emissiveIntensity = 0.4, transparent = false, opacity = 1) =>
  new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity,
    roughness: 0.72, metalness: 0.04,
    transparent, opacity, depthWrite: !transparent,
    side: THREE.DoubleSide
  });

const makeAdditiveMat = (color, emissive, emissiveIntensity = 1, opacity = 0.6) =>
  new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity,
    roughness: 0.3, metalness: 0.0,
    transparent: true, opacity, depthWrite: false
  });

const root = new THREE.Group();
root.name = 'nuke_root';

// ══════════════════════════════════════════════════════════════════════════════
// 1. MULTI-SEGMENT STEM — tapered cylinder stack for organic feel
// ══════════════════════════════════════════════════════════════════════════════
const stemSegments = [
  { radiusTop: 6, radiusBot: 22, height: 24, y: 12, color: '#78716c', emissive: '#f97316', ei: 0.28 },
  { radiusTop: 8, radiusBot: 12, height: 22, y: 35, color: '#6b7280', emissive: '#ea580c', ei: 0.22 },
  { radiusTop: 10, radiusBot: 9, height: 20, y: 56, color: '#9ca3af', emissive: '#fb923c', ei: 0.16 },
  { radiusTop: 14, radiusBot: 10, height: 18, y: 74, color: '#a1a1aa', emissive: '#fdba74', ei: 0.12 },
];
stemSegments.forEach((seg, i) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(seg.radiusTop, seg.radiusBot, seg.height, 12, 1, false),
    makeMat(seg.color, seg.emissive, seg.ei)
  );
  mesh.name = `nuke_stem_${i}`;
  mesh.position.y = seg.y;
  root.add(mesh);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. UPDRAFT SMOKE COLUMNS — vertical tubes around the stem
// ══════════════════════════════════════════════════════════════════════════════
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const r = 14 + (i % 2) * 6;
  const h = 45 + (i % 3) * 15;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(3 + (i % 2), 5 + (i % 3), h, 8, 1, false),
    makeMat('#a8a29e', '#f97316', 0.08, true, 0.35)
  );
  mesh.name = `nuke_updraft_${i}`;
  mesh.position.set(Math.cos(angle) * r, h * 0.5, Math.sin(angle) * r);
  root.add(mesh);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. PRIMARY CAP — large squashed sphere
// ══════════════════════════════════════════════════════════════════════════════
const cap = new THREE.Mesh(
  new THREE.SphereGeometry(36, 16, 12),
  makeMat('#9ca3af', '#fb923c', 0.24)
);
cap.name = 'nuke_cap';
cap.position.y = 110;
cap.scale.set(1.28, 0.78, 1.28);
root.add(cap);

// ══════════════════════════════════════════════════════════════════════════════
// 4. SECONDARY BILLOWS — irregularly placed cloud spheres around the cap
// ══════════════════════════════════════════════════════════════════════════════
const lobeConfigs = [
  { pos: [-22, 104, 16], r: 18, color: '#cbd5e1', ei: 0.18 },
  { pos: [24, 100, 10], r: 16, color: '#d1d5db', ei: 0.16 },
  { pos: [16, 116, -20], r: 17, color: '#c5ccd6', ei: 0.20 },
  { pos: [-18, 114, -14], r: 15, color: '#d4d4d8', ei: 0.14 },
  { pos: [0, 124, 0], r: 23, color: '#e2e8f0', ei: 0.28 },
  { pos: [-28, 96, -4], r: 14, color: '#b8c0cc', ei: 0.12 },
  { pos: [8, 120, 22], r: 13, color: '#c8cfd8', ei: 0.15 },
  { pos: [-10, 126, -18], r: 12, color: '#dde3ea', ei: 0.22 },
];
lobeConfigs.forEach((cfg, i) => {
  const lobe = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.r, 10, 8),
    makeMat(cfg.color, '#fb923c', cfg.ei)
  );
  lobe.name = `nuke_lobe_${i}`;
  lobe.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  lobe.scale.set(1 + (i % 3) * 0.06, 0.72 + (i % 2) * 0.12, 1 + ((i + 1) % 3) * 0.06);
  root.add(lobe);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ROLLING SMOKE RING — torus belt where stem meets cap
// ══════════════════════════════════════════════════════════════════════════════
const smokeRing = new THREE.Mesh(
  new THREE.TorusGeometry(28, 8, 10, 20),
  makeMat('#a8a29e', '#fdba74', 0.10, true, 0.42)
);
smokeRing.name = 'nuke_smoke_ring';
smokeRing.rotation.x = Math.PI / 2;
smokeRing.position.y = 86;
root.add(smokeRing);

// ══════════════════════════════════════════════════════════════════════════════
// 6. PLUME — mid-level connecting cloud between stem and cap
// ══════════════════════════════════════════════════════════════════════════════
const plume = new THREE.Mesh(
  new THREE.SphereGeometry(20, 12, 8),
  makeMat('#d1d5db', '#fdba74', 0.16)
);
plume.name = 'nuke_plume';
plume.position.y = 78;
plume.scale.set(1.22, 0.68, 1.22);
root.add(plume);

// ══════════════════════════════════════════════════════════════════════════════
// 7. INNER FIRE CORE — glowing orange sphere inside the stem base
// ══════════════════════════════════════════════════════════════════════════════
const fireCore = new THREE.Mesh(
  new THREE.SphereGeometry(14, 10, 8),
  makeAdditiveMat('#ff6b1a', '#ff8c42', 2.0, 0.72)
);
fireCore.name = 'nuke_fire_core';
fireCore.position.y = 18;
root.add(fireCore);

// ══════════════════════════════════════════════════════════════════════════════
// 8. EMBER — ground-level glowing ball
// ══════════════════════════════════════════════════════════════════════════════
const ember = new THREE.Mesh(
  new THREE.SphereGeometry(10, 8, 6),
  makeAdditiveMat('#f97316', '#fb923c', 1.5, 0.78)
);
ember.name = 'nuke_ember';
ember.position.y = 8;
root.add(ember);

// ══════════════════════════════════════════════════════════════════════════════
// 9. MULTIPLE SHOCK RINGS — concentric expanding torus rings
// ══════════════════════════════════════════════════════════════════════════════
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(36 + i * 14, 3.5 - i * 0.5, 6, 24),
    makeAdditiveMat('#fed7aa', '#fdba74', 1.2 - i * 0.3, 0.5 - i * 0.1)
  );
  ring.name = `nuke_ring_${i}`;
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 6 + i * 2;
  root.add(ring);
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. INITIAL FLASH — bright white sphere
// ══════════════════════════════════════════════════════════════════════════════
const flash = new THREE.Mesh(
  new THREE.SphereGeometry(26, 10, 8),
  makeAdditiveMat('#fff7ed', '#ffffff', 2.2, 0.58)
);
flash.name = 'nuke_flash';
flash.position.y = 30;
flash.scale.set(1.3, 0.95, 1.3);
root.add(flash);

// ══════════════════════════════════════════════════════════════════════════════
// 11. GROUND DUST SKIRT — flat disk expanding outward
// ══════════════════════════════════════════════════════════════════════════════
const dustSkirt = new THREE.Mesh(
  new THREE.CylinderGeometry(50, 55, 4, 20, 1, false),
  makeMat('#a8a29e', '#d97706', 0.06, true, 0.32)
);
dustSkirt.name = 'nuke_dust_skirt';
dustSkirt.position.y = 2;
root.add(dustSkirt);

// ══════════════════════════════════════════════════════════════════════════════
// 12. DEBRIS CHUNKS — small rocks flung outward
// ══════════════════════════════════════════════════════════════════════════════
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2 + (i * 0.37);
  const dist = 20 + (i % 3) * 10;
  const chunk = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.5 + (i % 3) * 0.8, 0),
    makeMat('#78716c', '#92400e', 0.08)
  );
  chunk.name = `nuke_debris_${i}`;
  chunk.position.set(Math.cos(angle) * dist, 4 + (i % 4) * 8, Math.sin(angle) * dist);
  root.add(chunk);
}

// ══════════════════════════════════════════════════════════════════════════════
// 13. HEAT DISTORTION COLUMN — tall transparent cylinder
// ══════════════════════════════════════════════════════════════════════════════
const heatCol = new THREE.Mesh(
  new THREE.CylinderGeometry(18, 24, 140, 10, 1, true),
  makeMat('#f5f5f4', '#fbbf24', 0.04, true, 0.08)
);
heatCol.name = 'nuke_heat_column';
heatCol.position.y = 70;
root.add(heatCol);

// ══════════════════════════════════════════════════════════════════════════════
// 14. CAP UNDERSIDE GLOW — disk under the mushroom cap
// ══════════════════════════════════════════════════════════════════════════════
const capGlow = new THREE.Mesh(
  new THREE.CircleGeometry(30, 16),
  makeAdditiveMat('#ff8c42', '#f97316', 1.8, 0.45)
);
capGlow.name = 'nuke_cap_glow';
capGlow.rotation.x = Math.PI / 2;
capGlow.position.y = 92;
root.add(capGlow);

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
