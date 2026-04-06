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
const outPath = path.join(outDir, 'human_units.glb');

const makeMat = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.1,
  transparent = false,
  opacity = 1,
  side,
  map,
}) => {
  const m = new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity, roughness, metalness,
    transparent, opacity, depthWrite: !transparent,
    ...(side !== undefined ? { side } : {})
  });
  const tex = map !== undefined ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4)
      ? autoMap(color) : null;
  if (tex) m.map = tex;
  return m;
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

// ─── SHARED MATERIALS ────────────────────────────────────────────────────────
const MAT = {
  metalDark:   makeMat({ color: '#3a4657', roughness: 0.34, metalness: 0.72 }),
  metalMid:    makeMat({ color: '#5b687c', roughness: 0.42, metalness: 0.58 }),
  metalLight:  makeMat({ color: '#9aa8ba', roughness: 0.3, metalness: 0.66 }),
  brightSteel: makeMat({ color: '#cbd5e1', roughness: 0.24, metalness: 0.82 }),
  polymer:     makeMat({ color: '#3b434c', roughness: 0.72, metalness: 0.14 }),
  polymerGrey: makeMat({ color: '#566273', roughness: 0.68, metalness: 0.18 }),
  wood:        makeMat({ color: '#7c5a3a', roughness: 0.94, metalness: 0.04 }),
  olive:       makeMat({ color: '#6d8450', roughness: 0.78, metalness: 0.14 }),
  rubber:      makeMat({ color: '#4a4f52', roughness: 0.9, metalness: 0.04 }),
  warning:     makeMat({ color: '#d97706', roughness: 0.54, metalness: 0.22 }),
  brass:       makeMat({ color: '#b5902a', roughness: 0.36, metalness: 0.72 }),
  redMark:     makeMat({ color: '#dc2626', roughness: 0.6,  metalness: 0.1  }),
  scope:       makeMat({ color: '#030712', roughness: 0.08, metalness: 0.92, transparent: true, opacity: 0.82 }),
};

// Helper – cylinder aligned along X axis
const addCyl = (parent, name, radiusT, radiusB, length, segs, mat, pos, rot = [0, 0, Math.PI / 2]) =>
  addMesh({ parent, name, geometry: new THREE.CylinderGeometry(radiusT, radiusB, length, segs), material: mat, position: pos, rotation: rot });

const addBox = (parent, name, w, h, d, mat, pos, rot = [0, 0, 0]) =>
  addMesh({ parent, name, geometry: new THREE.BoxGeometry(w, h, d), material: mat, position: pos, rotation: rot });

const addPivot = (parent, name, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  group.rotation.set(...rotation);
  group.scale.set(...scale);
  parent.add(group);
  return group;
};

// ─── WEAPON BUILDERS ─────────────────────────────────────────────────────────

// RIFLEMAN – realistic M4A1 carbine (polymer lower, quad-rail upper, 14.5" barrel, ACOG, vertical foregrip)
const buildRiflemanWeapon = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_weapon';
  g.position.set(4.6, 12.4, 3.2);
  g.rotation.set(0.08, 0.06, -Math.PI / 2);
  parent.add(g);

  // Lower receiver + pistol grip
  addBox(g, 'w_lower_receiver', 2.9, 0.92, 0.82, MAT.polymer, [-0.5, 0, 0]);
  addBox(g, 'w_pistol_grip', 0.45, 1.5, 0.56, MAT.polymerGrey, [-0.9, -1.05, 0], [0.22, 0, 0]);
  addBox(g, 'w_trigger_guard', 0.9, 0.18, 0.62, MAT.metalDark, [-0.5, -0.58, 0]);
  // Mag – curved STANAG 30rd
  addMesh({ parent: g, name: 'w_mag', geometry: new THREE.BoxGeometry(0.52, 1.62, 0.58), material: MAT.metalMid, position: [-0.3, -1.22, 0], rotation: [0.14, 0, 0] });
  // Upper receiver
  addBox(g, 'w_upper_receiver', 2.8, 0.88, 0.8, MAT.metalDark, [-0.5, 0.48, 0]);
  // Charging handle
  addBox(g, 'w_charging_handle', 0.28, 0.34, 0.22, MAT.metalMid, [-1.32, 0.72, 0]);
  // Quad-rail handguard
  addBox(g, 'w_handguard', 2.85, 0.72, 0.75, MAT.metalMid, [1.9, 0.46, 0]);
  addBox(g, 'w_rail_top', 2.9, 0.18, 0.14, MAT.metalLight, [1.9, 0.88, 0]);
  addBox(g, 'w_rail_left', 0.18, 0.72, 0.14, MAT.metalLight, [1.9, 0.46, 0.38]);
  addBox(g, 'w_rail_right', 0.18, 0.72, 0.14, MAT.metalLight, [1.9, 0.46, -0.38]);
  // Barrel (14.5")
  addCyl(g, 'w_barrel', 0.12, 0.12, 5.2, 10, MAT.metalDark, [5.55, 0.42, 0]);
  // A2 flash hider (birdcage)
  addCyl(g, 'w_flash_hider', 0.18, 0.16, 0.65, 6, MAT.brightSteel, [8.25, 0.42, 0]);
  // Gas block
  addBox(g, 'w_gas_block', 0.42, 0.44, 0.44, MAT.metalDark, [4.2, 0.42, 0]);
  addCyl(g, 'w_gas_tube', 0.05, 0.05, 2.6, 6, MAT.metalLight, [2.9, 0.68, 0]);
  // Collapsible stock
  addBox(g, 'w_stock_body', 1.85, 0.72, 0.74, MAT.polymer, [-2.9, 0.15, 0]);
  addBox(g, 'w_stock_spine', 0.18, 0.36, 0.18, MAT.metalMid, [-3.35, 0.15, 0.24]);
  addBox(g, 'w_butt_plate', 0.24, 1.02, 0.68, MAT.rubber, [-3.88, 0.15, 0]);
  // ACOG scope (TA31)
  addCyl(g, 'w_scope_body', 0.22, 0.24, 1.9, 12, MAT.metalDark, [-0.4, 0.96, 0]);
  addMesh({ parent: g, name: 'w_scope_lens', geometry: new THREE.CircleGeometry(0.16, 10), material: MAT.scope, position: [0.57, 0.96, 0], rotation: [0, Math.PI / 2, 0] });
  addBox(g, 'w_scope_mount', 1.05, 0.2, 0.36, MAT.metalLight, [-0.4, 0.68, 0]);
  // Vertical foregrip
  addBox(g, 'w_foregrip_body', 0.34, 1.25, 0.34, MAT.polymer, [2.4, -0.22, 0]);
  addBox(g, 'w_foregrip_base', 0.34, 0.2, 0.34, MAT.metalMid, [2.4, 0.3, 0]);
  // Rear BUIS
  addBox(g, 'w_rear_sight', 0.2, 0.48, 0.18, MAT.metalLight, [-1.62, 0.88, 0]);
  // Sling swivel front
  addBox(g, 'w_sling_front', 0.1, 0.28, 0.52, MAT.metalLight, [3.5, 0.12, 0]);
};

// MARKSMAN – realistic SR-25/M110 semi-auto sniper rifle (20" free-float, MRAD scope, folding bipod, adj. stock)
const buildMarksmanWeapon = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_weapon';
  g.position.set(4.6, 12.4, 3.2);
  g.rotation.set(0.06, 0.04, -Math.PI / 2);
  parent.add(g);

  addBox(g, 'w_lower_receiver', 3.2, 0.96, 0.84, MAT.polymer, [-0.4, 0, 0]);
  addBox(g, 'w_pistol_grip', 0.46, 1.6, 0.58, MAT.polymerGrey, [-0.8, -1.1, 0], [0.18, 0, 0]);
  addBox(g, 'w_trigger_guard', 0.9, 0.18, 0.62, MAT.metalDark, [-0.4, -0.6, 0]);
  addMesh({ parent: g, name: 'w_mag', geometry: new THREE.BoxGeometry(0.46, 1.4, 0.54), material: MAT.metalMid, position: [-0.2, -1.18, 0], rotation: [0.1, 0, 0] });
  addBox(g, 'w_upper_receiver', 3.1, 0.9, 0.82, MAT.metalDark, [-0.4, 0.5, 0]);
  // Free-float tube handguard (octagonal cross-section)
  addCyl(g, 'w_ffl_tube', 0.38, 0.38, 4.2, 8, MAT.metalMid, [2.8, 0.46, 0]);
  addBox(g, 'w_top_rail', 4.2, 0.18, 0.14, MAT.metalLight, [2.8, 0.7, 0]);
  // Heavy match barrel 20"
  addCyl(g, 'w_barrel', 0.15, 0.14, 7.2, 10, MAT.metalDark, [7.0, 0.42, 0]);
  addCyl(g, 'w_muzzle_brake', 0.22, 0.2, 0.82, 10, MAT.brightSteel, [10.7, 0.42, 0]);
  addBox(g, 'w_muzzle_brake_ports', 0.82, 0.18, 0.52, MAT.metalDark, [10.7, 0.42, 0]);
  // Gas block low-profile
  addBox(g, 'w_gas_block', 0.38, 0.4, 0.4, MAT.metalDark, [5.6, 0.42, 0]);
  // Adjustable stock (folding cheekpiece)
  addBox(g, 'w_stock_body', 2.2, 0.78, 0.76, MAT.polymer, [-3.05, 0.2, 0]);
  addBox(g, 'w_cheek_riser', 1.0, 0.38, 0.52, MAT.polymer, [-2.65, 0.72, 0]);
  addBox(g, 'w_butt_plate', 0.22, 1.1, 0.72, MAT.rubber, [-4.2, 0.2, 0]);
  // MRAD/Nightforce scope – large, long
  addCyl(g, 'w_scope_tube', 0.3, 0.3, 3.8, 12, MAT.metalDark, [-0.2, 1.06, 0]);
  addCyl(g, 'w_scope_obj', 0.38, 0.32, 0.88, 14, MAT.metalDark, [1.75, 1.06, 0]);
  addCyl(g, 'w_scope_eye', 0.28, 0.32, 0.72, 12, MAT.metalDark, [-2.1, 1.06, 0]);
  addMesh({ parent: g, name: 'w_scope_lens', geometry: new THREE.CircleGeometry(0.28, 12), material: MAT.scope, position: [2.22, 1.06, 0], rotation: [0, Math.PI / 2, 0] });
  addBox(g, 'w_scope_turret_v', 0.3, 0.55, 0.3, MAT.metalLight, [-0.2, 1.48, 0]);
  addBox(g, 'w_scope_turret_h', 0.3, 0.3, 0.55, MAT.metalLight, [-0.2, 1.06, 0.38]);
  addBox(g, 'w_scope_mount_rear', 0.52, 0.22, 0.42, MAT.metalLight, [-1.2, 0.78, 0]);
  addBox(g, 'w_scope_mount_fwd', 0.52, 0.22, 0.42, MAT.metalLight, [0.8, 0.78, 0]);
  // Folding bipod (Harris style)
  addBox(g, 'w_bipod_base', 0.34, 0.28, 0.56, MAT.metalLight, [3.8, 0.14, 0]);
  addBox(g, 'w_bipod_leg_l', 0.14, 1.35, 0.14, MAT.metalMid, [3.8, -0.78, 0.22], [-0.2, 0, 0.08]);
  addBox(g, 'w_bipod_leg_r', 0.14, 1.35, 0.14, MAT.metalMid, [3.8, -0.78, -0.22], [-0.2, 0, -0.08]);
  addBox(g, 'w_bipod_foot_l', 0.14, 0.14, 0.38, MAT.rubber, [3.8, -1.5, 0.3]);
  addBox(g, 'w_bipod_foot_r', 0.14, 0.14, 0.38, MAT.rubber, [3.8, -1.5, -0.3]);
};

// GUNNER – realistic M249 SAW (belt-fed LMG: heavy barrel, top cover, box mag, folding foregrip, bipod)
const buildGunnerWeapon = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_weapon';
  g.position.set(4.2, 12.2, 3.0);
  g.rotation.set(0.08, 0.06, -Math.PI / 2);
  parent.add(g);

  // Receiver (boxier than AR)
  addBox(g, 'w_receiver', 4.2, 1.15, 0.96, MAT.metalDark, [0.0, 0, 0]);
  addBox(g, 'w_top_cover', 3.8, 0.28, 0.78, MAT.metalMid, [0.0, 0.72, 0]);
  // Feed tray/dust cover
  addBox(g, 'w_feed_tray', 1.1, 0.22, 0.66, MAT.metalMid, [0.5, 0.72, 0]);
  // Pistol grip
  addBox(g, 'w_pistol_grip', 0.48, 1.55, 0.6, MAT.polymer, [-0.8, -0.96, 0], [0.16, 0, 0]);
  addBox(g, 'w_trigger_guard', 1.0, 0.18, 0.64, MAT.metalDark, [-0.4, -0.6, 0]);
  // Ammo box (200rd soft pouch)
  addBox(g, 'w_ammo_box', 1.6, 2.05, 1.18, MAT.olive, [0.45, -1.24, -0.52]);
  addBox(g, 'w_belt_strip', 0.28, 0.14, 0.86, MAT.brass, [0.6, -0.48, -0.45]);
  // Heavy fluted barrel (20")
  addBox(g, 'w_heat_shield', 3.3, 0.65, 0.72, MAT.metalMid, [3.6, 0.4, 0]);
  addCyl(g, 'w_barrel', 0.16, 0.15, 6.8, 10, MAT.metalDark, [7.5, 0.36, 0]);
  addCyl(g, 'w_flash_hider', 0.2, 0.18, 0.72, 6, MAT.brightSteel, [11.05, 0.36, 0]);
  addBox(g, 'w_gas_block', 0.46, 0.5, 0.48, MAT.metalDark, [4.6, 0.36, 0]);
  addCyl(g, 'w_gas_tube', 0.07, 0.07, 2.8, 6, MAT.metalLight, [2.8, 0.72, 0]);
  // Underbarrel foregrip (folding)
  addBox(g, 'w_foregrip_arm', 0.2, 0.9, 0.24, MAT.metalMid, [2.8, -0.32, 0], [-0.5, 0, 0]);
  addBox(g, 'w_foregrip_grip', 0.34, 1.05, 0.34, MAT.polymer, [2.8, -0.92, 0.3], [-0.2, 0, 0]);
  // Folding para stock
  addBox(g, 'w_stock_body', 2.4, 0.9, 0.82, MAT.metalMid, [-3.3, 0.15, 0]);
  addBox(g, 'w_shoulder_rest', 0.22, 1.1, 0.78, MAT.rubber, [-4.55, 0.15, 0]);
  // Carry handle
  addBox(g, 'w_carry_handle', 2.4, 0.3, 0.24, MAT.metalMid, [0.0, 1.32, 0]);
  addBox(g, 'w_carry_post', 0.2, 0.64, 0.2, MAT.metalMid, [-0.7, 0.98, 0]);
  addBox(g, 'w_carry_post2', 0.2, 0.64, 0.2, MAT.metalMid, [0.7, 0.98, 0]);
  // Bipod (extended for suppressive fire stance)
  addBox(g, 'w_bipod_base', 0.4, 0.3, 0.6, MAT.metalLight, [4.8, 0.0, 0]);
  addBox(g, 'w_bipod_leg_l', 0.14, 1.45, 0.14, MAT.metalMid, [4.8, -0.88, 0.26], [-0.25, 0, 0.1]);
  addBox(g, 'w_bipod_leg_r', 0.14, 1.45, 0.14, MAT.metalMid, [4.8, -0.88, -0.26], [-0.25, 0, -0.1]);
  // Rear sight aperture
  addBox(g, 'w_rear_sight', 0.24, 0.54, 0.18, MAT.metalLight, [-1.2, 0.84, 0]);
  // Front sight post
  addBox(g, 'w_front_sight_base', 0.42, 0.5, 0.42, MAT.metalDark, [5.4, 0.72, 0]);
  addBox(g, 'w_front_sight_post', 0.14, 0.48, 0.14, MAT.brightSteel, [5.4, 1.04, 0]);
};

// RPG TROOPER – realistic RPG-7 (launch tube, booster motor, PGO-7 scope, two-stage warhead)
const buildRpgWeapon = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_weapon';
  g.position.set(4.8, 12.8, 2.8);
  g.rotation.set(0.08, 0.1, -Math.PI / 2);
  parent.add(g);

  // Main launch tube (flared muzzle end)
  addCyl(g, 'w_tube_main', 0.56, 0.52, 9.6, 14, MAT.olive, [0.5, 0, 0]);
  addCyl(g, 'w_tube_rear', 0.72, 0.56, 1.8, 12, MAT.olive, [-4.5, 0, 0]);
  // Muzzle flare guard ring
  addMesh({ parent: g, name: 'w_muzzle_ring', geometry: new THREE.TorusGeometry(0.68, 0.08, 8, 18), material: MAT.metalDark, position: [5.55, 0, 0], rotation: [0, Math.PI / 2, 0] });
  // Blast cone (rear opening)
  addCyl(g, 'w_blast_cone', 0.95, 0.72, 0.6, 12, MAT.metalDark, [-5.55, 0, 0]);
  // Front grip (pistol grip style trigger mechanism housing)
  addBox(g, 'w_trigger_housing', 1.1, 0.96, 0.88, MAT.metalMid, [-0.4, -0.56, 0]);
  addBox(g, 'w_trigger_grip', 0.46, 1.6, 0.56, MAT.rubber, [-0.4, -1.54, 0], [0.2, 0, 0]);
  addBox(g, 'w_trigger_guard', 0.88, 0.18, 0.64, MAT.metalDark, [-0.4, -0.72, 0]);
  // Rear pistol grip
  addBox(g, 'w_rear_grip', 0.44, 1.5, 0.52, MAT.rubber, [-3.2, -1.0, 0], [0.18, 0, 0]);
  // Shoulder pad (heat shield)
  addBox(g, 'w_shoulder_pad', 1.85, 0.44, 1.02, MAT.rubber, [-2.0, 0.58, 0]);
  // PGO-7 telescope sight
  addBox(g, 'w_scope_housing', 0.62, 0.56, 0.62, MAT.metalDark, [-0.6, 0.74, 0]);
  addCyl(g, 'w_scope_eye', 0.24, 0.26, 0.7, 10, MAT.metalDark, [-0.6, 0.74, -0.56], [Math.PI / 2, 0, 0]);
  addMesh({ parent: g, name: 'w_scope_lens_r', geometry: new THREE.CircleGeometry(0.18, 10), material: MAT.scope, position: [-0.6, 0.74, -0.94], rotation: [Math.PI / 2, 0, 0] });
  // PG-7VL warhead (HEAT + booster motor)
  addCyl(g, 'w_booster_motor', 0.45, 0.48, 2.8, 12, MAT.metalMid, [2.5, 0, 0]);
  addCyl(g, 'w_warhead_body', 0.62, 0.46, 2.4, 14, MAT.metalMid, [5.4, 0, 0]);
  // Piezoelectric tip
  addMesh({ parent: g, name: 'w_warhead_cone', geometry: new THREE.ConeGeometry(0.16, 1.1, 10), material: MAT.warning, position: [6.8, 0, 0], rotation: [0, 0, Math.PI / 2] });
  addCyl(g, 'w_probe', 0.06, 0.06, 0.8, 6, MAT.brightSteel, [7.45, 0, 0]);
  // 4 stabilising fins on booster
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    addBox(g, `w_fin_${i}`, 1.4, 0.08, 0.52, MAT.metalDark, [1.2, Math.sin(a) * 0.52, Math.cos(a) * 0.52], [a, 0, 0]);
  }
  // Sling swivel points
  addBox(g, 'w_sling_fwd', 0.1, 0.3, 0.52, MAT.metalLight, [2.2, 0.38, 0]);
  addBox(g, 'w_sling_rear', 0.1, 0.3, 0.52, MAT.metalLight, [-3.8, 0.38, 0]);
};

// MISSILE OPERATOR – realistic FIM-92 Stinger MANPADS (gripstock, IFF antenna, thermal seeker, two-tube launch pod)
const buildMissileWeapon = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_weapon';
  g.position.set(4.2, 13.4, 2.8);
  g.rotation.set(0.14, 0.14, -Math.PI / 2);
  parent.add(g);

  // BCU gripstock
  addBox(g, 'w_gripstock_body', 1.2, 1.1, 1.0, MAT.polymer, [-3.0, 0, 0]);
  addBox(g, 'w_pistol_grip', 0.46, 1.55, 0.56, MAT.polymer, [-2.8, -1.05, 0], [0.14, 0, 0]);
  addBox(g, 'w_trigger_guard', 0.84, 0.18, 0.58, MAT.metalDark, [-2.8, -0.58, 0]);
  addBox(g, 'w_shoulder_rest', 0.2, 1.12, 0.76, MAT.rubber, [-3.95, 0.0, 0]);
  // IFF interrogator antenna
  addBox(g, 'w_iff_antenna_base', 0.4, 0.3, 0.4, MAT.metalMid, [-2.6, 0.74, 0]);
  addBox(g, 'w_iff_antenna_rod', 0.08, 1.4, 0.08, MAT.brightSteel, [-2.6, 1.52, 0]);
  // Argon coolant unit
  addBox(g, 'w_bcu_body', 0.9, 0.88, 0.88, MAT.metalMid, [-1.55, -0.62, 0]);
  // Launch tube assembly
  addCyl(g, 'w_launch_tube', 0.58, 0.58, 9.5, 16, MAT.olive, [1.4, 0, 0]);
  // Muzzle ring
  addMesh({ parent: g, name: 'w_muzzle_ring', geometry: new THREE.TorusGeometry(0.64, 0.1, 8, 18), material: MAT.metalDark, position: [6.3, 0, 0], rotation: [0, Math.PI / 2, 0] });
  // Rear ring
  addMesh({ parent: g, name: 'w_rear_ring', geometry: new THREE.TorusGeometry(0.64, 0.1, 8, 18), material: MAT.metalDark, position: [-3.5, 0, 0], rotation: [0, Math.PI / 2, 0] });
  // Seeker dome (IR homing head)
  addCyl(g, 'w_seeker_dome', 0.52, 0.48, 0.72, 14, MAT.metalLight, [6.7, 0, 0]);
  addMesh({ parent: g, name: 'w_seeker_lens', geometry: new THREE.CircleGeometry(0.32, 14), material: MAT.scope, position: [7.1, 0, 0], rotation: [0, Math.PI / 2, 0] });
  // Missile body (inside tube, tip visible)
  addCyl(g, 'w_missile_body', 0.42, 0.42, 8.4, 14, MAT.metalDark, [1.2, 0, 0]);
  addMesh({ parent: g, name: 'w_missile_cone', geometry: new THREE.ConeGeometry(0.38, 1.4, 12), material: MAT.metalMid, position: [5.6, 0, 0], rotation: [0, 0, Math.PI / 2] });
  // 4 clip-on launch fins
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    addBox(g, `w_launch_fin_${i}`, 1.1, 0.06, 0.55, MAT.metalDark, [-1.6, Math.sin(a) * 0.7, Math.cos(a) * 0.7], [a, 0, 0]);
  }
  // Carry/aiming handle
  addBox(g, 'w_carry_handle', 2.8, 0.28, 0.22, MAT.polymer, [0.2, 0.8, 0]);
  addBox(g, 'w_handle_post_f', 0.18, 0.56, 0.18, MAT.polymer, [1.2, 0.55, 0]);
  addBox(g, 'w_handle_post_r', 0.18, 0.56, 0.18, MAT.polymer, [-0.8, 0.55, 0]);
};

// ENGINEER – realistic M2 flamethrower (dual-cylinder backpack tanks via unit_tool_canister, wand + hose, pilot flame)
const buildEngineerTool = (parent) => {
  const g = new THREE.Group();
  g.name = 'unit_tool';
  g.position.set(4.2, 12.8, 3.0);
  g.rotation.set(0.06, 0.08, -Math.PI / 2);
  parent.add(g);

  // Wand (gun assembly)
  addCyl(g, 'w_wand_body', 0.28, 0.32, 3.2, 10, MAT.metalMid, [1.0, 0, 0]);
  addCyl(g, 'w_wand_nozzle', 0.18, 0.28, 1.2, 10, MAT.metalDark, [2.6, 0, 0]);
  // Muzzle tip (angled)
  addCyl(g, 'w_wand_tip', 0.08, 0.18, 0.45, 8, MAT.brightSteel, [3.3, 0.05, 0]);
  // Trigger / valve handle
  addBox(g, 'w_valve_grip', 0.4, 1.45, 0.54, MAT.rubber, [-0.7, -0.9, 0], [0.2, 0, 0]);
  addBox(g, 'w_valve_body', 0.72, 0.72, 0.6, MAT.metalMid, [-0.5, 0.12, 0]);
  addBox(g, 'w_trigger_guard', 0.78, 0.18, 0.54, MAT.metalDark, [-0.5, -0.44, 0]);
  // Flexible armoured fuel hose
  addCyl(g, 'w_hose_seg1', 0.14, 0.14, 1.5, 8, MAT.rubber, [-1.65, -0.3, 0.2], [0.5, 0.2, Math.PI / 2]);
  addCyl(g, 'w_hose_seg2', 0.14, 0.14, 1.1, 8, MAT.rubber, [-2.5, -0.5, 0.35], [0.35, 0.15, Math.PI / 2]);
  // Quick-disconnect coupling
  addCyl(g, 'w_coupling', 0.22, 0.22, 0.42, 8, MAT.metalLight, [-1.2, -0.15, 0.1]);
  // Pilot flame nozzle (small side pipe)
  addCyl(g, 'w_pilot_tube', 0.06, 0.06, 0.62, 6, MAT.brightSteel, [3.1, 0.28, 0.16]);
  addMesh({ parent: g, name: 'w_pilot_flame', geometry: new THREE.ConeGeometry(0.08, 0.32, 8), material: makeMat({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 2.2, transparent: true, opacity: 0.72 }), position: [3.48, 0.36, 0.16], rotation: [0, 0, Math.PI / 2] });
  // Wrist brace
  addBox(g, 'w_wrist_brace', 0.62, 0.26, 0.56, MAT.polymer, [-1.1, -1.5, 0]);
};

// ─── BODY BUILDER ────────────────────────────────────────────────────────────

const buildSoldier = ({
  name,
  coatColor,
  gearColor,
  padColor,
  helmetColor,
  helmetType = 'standard',   // 'standard' | 'bump' | 'sniper'
  visorColor = '#d1d5db',
  visorEmissive = '#000000',
  visorEmissiveInt = 0,
  heavyWeapon = false,
  marksman = false,
  engineer = false,
  launcher = false,
  missileRack = false,
  buildWeaponFn
}) => {
  const root = new THREE.Group();
  root.name = name;

  const bootMat    = makeMat({ color: '#141008', roughness: 0.96, metalness: 0.04 });
  const skinMat    = makeMat({ color: '#c07840', roughness: 0.84, metalness: 0 });
  const clothMat   = makeMat({ color: coatColor, roughness: 0.92, metalness: 0.04 });
  const gearMat    = makeMat({ color: gearColor, roughness: 0.68, metalness: 0.18 });
  const padMat     = makeMat({ color: padColor, roughness: 0.66, metalness: 0.22 });
  const helmetMat  = makeMat({ color: helmetColor, roughness: 0.62, metalness: 0.18 });
  const beltMat    = makeMat({ color: '#2d2d2d', roughness: 0.72, metalness: 0.26 });

  const legLeft = addPivot(root, 'unit_leg_left', [-1.85, 10.0, 0]);
  addMesh({ parent: legLeft, name: 'unit_leg_left_mesh', geometry: new THREE.CapsuleGeometry(1.45, 8.2, 6, 10), material: clothMat, position: [0, -4.6, 0] });
  addBox(legLeft, 'unit_knee_pad_l', 2.6, 1.5, 1.5, padMat, [0, -6.8, 0.85]);
  addBox(legLeft, 'unit_pocket_l', 1.7, 1.2, 0.65, clothMat, [-0.95, -4.0, -0.4]);

  const legRight = addPivot(root, 'unit_leg_right', [1.85, 10.0, 0]);
  addMesh({ parent: legRight, name: 'unit_leg_right_mesh', geometry: new THREE.CapsuleGeometry(1.45, 8.2, 6, 10), material: clothMat, position: [0, -4.6, 0] });
  addBox(legRight, 'unit_knee_pad_r', 2.6, 1.5, 1.5, padMat, [0, -6.8, 0.85]);
  addBox(legRight, 'unit_pocket_r', 1.7, 1.2, 0.65, clothMat, [0.95, -4.0, -0.4]);

  const bootLeft = addPivot(root, 'unit_boot_left', [-1.85, 2.0, 0.2]);
  addMesh({ parent: bootLeft, name: 'unit_boot_left_mesh', geometry: new THREE.BoxGeometry(2.35, 1.6, 4.8), material: bootMat, position: [0, -1.1, 0.7] });
  addMesh({ parent: bootLeft, name: 'unit_boot_ankle_l', geometry: new THREE.CylinderGeometry(1.3, 1.4, 1.2, 10), material: bootMat, position: [0, -0.3, -0.4] });

  const bootRight = addPivot(root, 'unit_boot_right', [1.85, 2.0, 0.2]);
  addMesh({ parent: bootRight, name: 'unit_boot_right_mesh', geometry: new THREE.BoxGeometry(2.35, 1.6, 4.8), material: bootMat, position: [0, -1.1, 0.7] });
  addMesh({ parent: bootRight, name: 'unit_boot_ankle_r', geometry: new THREE.CylinderGeometry(1.3, 1.4, 1.2, 10), material: bootMat, position: [0, -0.3, -0.4] });

  const torso = addPivot(root, 'unit_torso', [0, 15.1, 0]);
  addMesh({ parent: torso, name: 'unit_torso_mesh', geometry: new THREE.CapsuleGeometry(3.55, 11.2, 8, 12), material: clothMat, position: [0, 0, 0] });
  addCyl(root, 'unit_hydro_hose', 0.12, 0.12, 3.5, 6, beltMat, [-3.8, 18.5, 0.8], [0.4, 0, Math.PI / 2]);

  const vest = addPivot(root, 'unit_vest', [0, 15.4, 2.0]);
  addBox(vest, 'unit_vest_front', 8.0, 8.0, 1.5, gearMat, [0, 0, 0]);
  for (let i = -1; i <= 1; i++) {
    addBox(vest, `unit_vest_pouch_${i + 1}`, 1.7, 2.0, 0.82, gearMat, [i * 2.2, -2.8, 0.48]);
  }
  addBox(vest, 'unit_vest_side_l', 1.2, 5.8, 3.8, gearMat, [-4.4, -0.8, -2.0]);
  addBox(vest, 'unit_vest_side_r', 1.2, 5.8, 3.8, gearMat, [4.4, -0.8, -2.0]);
  addBox(vest, 'unit_vest_back_plate', 7.4, 7.5, 1.3, gearMat, [0, -0.2, -4.4]);

  const belt = addPivot(root, 'unit_belt', [0, 10.8, 0.8]);
  addMesh({ parent: belt, name: 'unit_belt_mesh', geometry: new THREE.BoxGeometry(8.2, 1.35, 3.8), material: beltMat, position: [0, 0, 0] });
  addBox(belt, 'unit_belt_buckle', 1.0, 1.0, 0.3, makeMat({ color: '#9ca3af', roughness: 0.3, metalness: 0.8 }), [0, 0, 1.95]);
  addBox(belt, 'unit_belt_utility_l', 1.4, 1.1, 1.0, gearMat, [-3.4, -0.6, 0.7]);
  addBox(belt, 'unit_belt_utility_r', 1.4, 1.1, 1.0, gearMat, [3.4, -0.6, 0.7]);

  const pack = addPivot(root, 'unit_pack', [0, 15.4, -3.8]);
  addMesh({ parent: pack, name: 'unit_pack_mesh', geometry: new THREE.BoxGeometry(5.8, engineer ? 8.4 : 7.0, 3.8), material: padMat, position: [0, 0, 0] });
  addBox(pack, 'unit_pack_top_flap', 5.2, 1.0, 3.4, padMat, [0, 4.4, 0.2]);
  addBox(pack, 'unit_pack_front_zip', 3.6, 3.2, 0.48, padMat, [0, -1.2, -1.9]);

  const armLeft = addPivot(root, 'unit_arm_left', [-4.9, 19.0, 0.6]);
  addMesh({ parent: armLeft, name: 'unit_arm_left_mesh', geometry: new THREE.CapsuleGeometry(1.15, 8.8, 6, 10), material: clothMat, position: [-0.5, -3.4, -0.1], rotation: [0.1, 0, 0.28] });
  addBox(armLeft, 'unit_elbow_l', 2.2, 1.3, 1.4, padMat, [-0.9, -6.0, -0.2]);
  addMesh({ parent: armLeft, name: 'unit_hand_l', geometry: new THREE.SphereGeometry(1.05, 10, 8), material: beltMat, position: [-0.9, -8.8, 0.4], scale: [0.96, 1.3, 0.82] });

  const armRight = addPivot(root, 'unit_arm_right', [4.7, 18.6, 1.2]);
  addMesh({ parent: armRight, name: 'unit_arm_right_mesh', geometry: new THREE.CapsuleGeometry(1.15, 8.8, 6, 10), material: clothMat, position: [0.5, -3.4, 0.4], rotation: [0.26, 0.04, -0.68] });
  addBox(armRight, 'unit_elbow_r', 2.2, 1.3, 1.4, padMat, [0.8, -6.1, 0.3]);
  addMesh({ parent: armRight, name: 'unit_hand_r', geometry: new THREE.SphereGeometry(1.05, 10, 8), material: beltMat, position: [0.9, -8.8, 1.0], scale: [0.96, 1.3, 0.82] });

  const padLeft = addPivot(root, 'unit_pad_left', [-4.8, 19.0, 0.6]);
  addMesh({ parent: padLeft, name: 'unit_pad_left_mesh', geometry: new THREE.SphereGeometry(1.8, 12, 8), material: padMat, position: [0, 0, 0], scale: [1, 0.62, 0.88] });
  const padRight = addPivot(root, 'unit_pad_right', [4.8, 18.5, 1.2]);
  addMesh({ parent: padRight, name: 'unit_pad_right_mesh', geometry: new THREE.SphereGeometry(1.8, 12, 8), material: padMat, position: [0, 0, 0], scale: [1, 0.62, 0.88] });

  const head = addPivot(root, 'unit_head', [0, 23.8, 0.3]);
  addMesh({ parent: head, name: 'unit_head_mesh', geometry: new THREE.SphereGeometry(3.15, 18, 14), material: skinMat, position: [0, 1.4, 0.1] });
  const neckWrap = addPivot(root, 'unit_neck_wrap', [0, 22.4, 0.3]);
  addMesh({ parent: neckWrap, name: 'unit_neck_wrap_mesh', geometry: new THREE.CylinderGeometry(1.65, 1.85, 2.0, 12), material: gearMat, position: [0, 0, 0] });
  const helmet = addPivot(root, 'unit_helmet', [0, 25.8, 0.2]);

  if (helmetType === 'sniper') {
    addMesh({ parent: helmet, name: 'unit_helmet_shell', geometry: new THREE.CylinderGeometry(4.8, 4.4, 1.8, 16), material: helmetMat, position: [0, 1.4, 0] });
    addMesh({ parent: helmet, name: 'unit_helmet_crown', geometry: new THREE.SphereGeometry(3.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), material: helmetMat, position: [0, 1.2, 0] });
  } else if (helmetType === 'bump') {
    addMesh({ parent: helmet, name: 'unit_helmet_shell', geometry: new THREE.SphereGeometry(3.6, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), material: helmetMat, position: [0, 0.4, 0] });
    addBox(helmet, 'unit_helmet_rail_l', 0.22, 2.4, 0.18, makeMat({ color: helmetColor, roughness: 0.62, metalness: 0.32 }), [-3.0, 0.7, 0]);
    addBox(helmet, 'unit_helmet_rail_r', 0.22, 2.4, 0.18, makeMat({ color: helmetColor, roughness: 0.62, metalness: 0.32 }), [3.0, 0.7, 0]);
    addBox(helmet, 'unit_nvg_mount', 1.0, 0.5, 0.52, MAT.metalDark, [0, 1.2, 3.0]);
    addBox(helmet, 'unit_nvg_arm', 0.2, 0.7, 0.24, MAT.metalDark, [0, 1.8, 3.3]);
  } else {
    addMesh({ parent: helmet, name: 'unit_helmet_shell', geometry: new THREE.SphereGeometry(3.62, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.66), material: helmetMat, position: [0, 0.2, 0], scale: [1, 0.8, 1] });
    addBox(helmet, 'unit_helmet_brim', 7.8, 0.45, 7.2, helmetMat, [0, -1.8, 0]);
    addBox(helmet, 'unit_chin_strap', 5.8, 0.22, 0.18, beltMat, [0, -2.6, 2.3]);
  }
  addBox(helmet, 'unit_ear_l', 0.25, 1.0, 0.9, MAT.metalDark, [-3.2, -0.3, 0]);
  addBox(helmet, 'unit_ear_r', 0.25, 1.0, 0.9, MAT.metalDark, [3.2, -0.3, 0]);

  const visor = addPivot(root, 'unit_visor', [0, 25.2, 3.25]);
  addMesh({ parent: visor, name: 'unit_visor_mesh', geometry: new THREE.BoxGeometry(4.4, 1.4, 0.36), material: makeMat({ color: visorColor, emissive: visorEmissive, emissiveIntensity: visorEmissiveInt, roughness: 0.22, metalness: 0.46, transparent: visorEmissiveInt > 0, opacity: visorEmissiveInt > 0 ? 0.85 : 1 }), position: [0, 0, 0] });

  if (engineer) {
    const toolCanister = addPivot(root, 'unit_tool_canister', [-3.8, 14.2, -4.8]);
    addMesh({ parent: toolCanister, name: 'unit_tool_canister_mesh', geometry: new THREE.CylinderGeometry(1.15, 1.2, 5.2, 14), material: makeMat({ color: '#92400e', roughness: 0.64, metalness: 0.28 }), position: [0, 0, 0], rotation: [0.1, 0, 0.18] });
    addBox(root, 'unit_tool_canister2', 1.8, 4.6, 1.8, makeMat({ color: '#78350f', roughness: 0.66, metalness: 0.26 }), [0.5, 13.8, -5.2]);
    addCyl(root, 'unit_fuel_line', 0.12, 0.12, 3.8, 6, makeMat({ color: '#1a1a1a', roughness: 0.9, metalness: 0.1 }), [-1.5, 15.0, -5.0], [0.4, 0.3, Math.PI / 2]);
    const torch = addPivot(root, 'unit_torch', [5.5, 12.8, 1.0]);
    addMesh({ parent: torch, name: 'unit_torch_mesh', geometry: new THREE.CylinderGeometry(0.24, 0.24, 5.0, 8), material: makeMat({ color: '#d97706', roughness: 0.38, metalness: 0.66 }), position: [0, 0, 0], rotation: [0.3, 0.1, -0.22] });
    addBox(torch, 'unit_torch_handle', 0.5, 1.6, 0.5, MAT.rubber, [0, -1.6, 0]);
  }

  // ── WEAPON ──
  buildWeaponFn(root);
  return root;
};

const root = new THREE.Group();
root.name = 'human_units_root';

// RIFLEMAN – olive drab BDU, IOTV plate carrier, ACH helmet, M4A1 carbine
root.add(buildSoldier({
  name: 'unit_soldier_rifleman',
  coatColor: '#6b8450', gearColor: '#58713d', padColor: '#7c8f76', helmetColor: '#627b43',
  helmetType: 'standard', visorColor: '#9ca3af',
  buildWeaponFn: buildRiflemanWeapon
}));

// MARKSMAN – multicam-style grey/tan, reduced kit, sniper boonie, SR-25
root.add(buildSoldier({
  name: 'unit_soldier_marksman',
  coatColor: '#817b68', gearColor: '#66604d', padColor: '#9d917d', helmetColor: '#716958',
  helmetType: 'sniper', visorColor: '#78909c',
  marksman: true,
  buildWeaponFn: buildMarksmanWeapon
}));

// GUNNER – green heavy uniform, extra pouches, Ops-Core bump, M249 SAW
root.add(buildSoldier({
  name: 'unit_soldier_gunner',
  coatColor: '#58723a', gearColor: '#48642f', padColor: '#676767', helmetColor: '#516739',
  helmetType: 'bump', visorColor: '#6b7280',
  heavyWeapon: true,
  buildWeaponFn: buildGunnerWeapon
}));

// RPG TROOPER – tan/earth tones, scarf, standard ACH, RPG-7
root.add(buildSoldier({
  name: 'unit_soldier_rpg',
  coatColor: '#8b7653', gearColor: '#6a5739', padColor: '#aa926d', helmetColor: '#5e5440',
  helmetType: 'standard', visorColor: '#b0a090',
  launcher: true,
  buildWeaponFn: buildRpgWeapon
}));

// MISSILE OPERATOR – dark blue/grey, Ops-Core bump + NVG mount, Stinger MANPADS
root.add(buildSoldier({
  name: 'unit_soldier_missile',
  coatColor: '#455a7b', gearColor: '#354864', padColor: '#657898', helmetColor: '#31445e',
  helmetType: 'bump', visorColor: '#38bdf8', visorEmissive: '#0369a1', visorEmissiveInt: 0.35,
  missileRack: true,
  buildWeaponFn: buildMissileWeapon
}));

// ENGINEER – teal/green uniform, hazard-yellow vest, Ops-Core bump, flamethrower
root.add(buildSoldier({
  name: 'unit_soldier_engineer',
  coatColor: '#3f6d66', gearColor: '#2c554e', padColor: '#d97706', helmetColor: '#3a625c',
  helmetType: 'bump', visorColor: '#34d399', visorEmissive: '#059669', visorEmissiveInt: 0.28,
  engineer: true,
  buildWeaponFn: buildEngineerTool
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
