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
const outPath = path.join(outDir, 'human_units.glb');

const makeMat = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.12,
  transparent = false,
  opacity = 1,
  side,
  map,
}) => {
  const material = new THREE.MeshStandardMaterial({
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
  const texture = map !== undefined
    ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4 ? autoMap(color) : null);
  if (texture) material.map = texture;
  return material;
};

const addMesh = ({ parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  parent.add(mesh);
  return mesh;
};

const addPivot = (parent, name, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(position[0], position[1], position[2]);
  group.rotation.set(rotation[0], rotation[1], rotation[2]);
  group.scale.set(scale[0], scale[1], scale[2]);
  parent.add(group);
  return group;
};

const addBox = (parent, name, width, height, depth, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => (
  addMesh({ parent, name, geometry: new THREE.BoxGeometry(width, height, depth), material, position, rotation, scale })
);

const addCyl = (parent, name, radiusTop, radiusBottom, length, radialSegments, material, position, rotation = [0, 0, Math.PI / 2], scale = [1, 1, 1]) => (
  addMesh({ parent, name, geometry: new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radialSegments), material, position, rotation, scale })
);

const addHexPrism = (parent, name, radius, length, material, position, rotation = [0, 0, Math.PI / 2], scale = [1, 1, 1]) => (
  addMesh({ parent, name, geometry: new THREE.CylinderGeometry(radius, radius, length, 6), material, position, rotation, scale })
);

const addPlate = (parent, name, width, height, depth, material, position) => {
  addBox(parent, `${name}_core`, width, height, depth, material, position);
  addBox(parent, `${name}_trim`, width - 0.18, height - 0.18, depth + 0.08, material, [position[0], position[1], position[2] + depth * 0.22], [0, 0, 0], [1, 0.96, 0.92]);
};

const PALETTE = {
  steelDark: makeMat({ color: '#344255', roughness: 0.38, metalness: 0.76 }),
  steelMid: makeMat({ color: '#607289', roughness: 0.44, metalness: 0.6 }),
  steelLight: makeMat({ color: '#b0bccb', roughness: 0.28, metalness: 0.82 }),
  carbon: makeMat({ color: '#202833', roughness: 0.72, metalness: 0.14 }),
  polymer: makeMat({ color: '#38414a', roughness: 0.74, metalness: 0.12 }),
  rubber: makeMat({ color: '#191c20', roughness: 0.96, metalness: 0.02 }),
  lens: makeMat({ color: '#0f172a', roughness: 0.08, metalness: 0.92, transparent: true, opacity: 0.82 }),
  brass: makeMat({ color: '#b5912f', roughness: 0.34, metalness: 0.74 }),
  hazard: makeMat({ color: '#d97706', roughness: 0.54, metalness: 0.22 }),
};

const buildRiflemanWeapon = (parent) => {
  const group = addPivot(parent, 'unit_weapon', [4.9, 12.8, 3.2], [0.06, 0.08, -Math.PI / 2]);
  addHexPrism(group, 'w_receiver', 0.48, 4.2, PALETTE.steelDark, [0.1, 0.1, 0]);
  addBox(group, 'w_magwell', 0.9, 1.2, 0.86, PALETTE.carbon, [-0.4, -0.36, 0]);
  addBox(group, 'w_mag', 0.56, 1.7, 0.62, PALETTE.steelMid, [-0.2, -1.32, 0], [0.12, 0, 0]);
  addHexPrism(group, 'w_handguard', 0.38, 4.8, PALETTE.steelMid, [3.2, 0.16, 0]);
  addCyl(group, 'w_barrel', 0.11, 0.12, 5.8, 10, PALETTE.steelDark, [6.8, 0.12, 0]);
  addCyl(group, 'w_flash_hider', 0.17, 0.15, 0.7, 8, PALETTE.steelLight, [9.8, 0.12, 0]);
  addBox(group, 'w_stock', 2.2, 0.84, 0.84, PALETTE.polymer, [-3.3, 0.06, 0]);
  addBox(group, 'w_butt_plate', 0.22, 1.04, 0.76, PALETTE.rubber, [-4.45, 0.06, 0]);
  addBox(group, 'w_grip', 0.44, 1.55, 0.58, PALETTE.polymer, [-1.0, -1.05, 0], [0.18, 0, 0]);
  addCyl(group, 'w_scope_body', 0.24, 0.26, 2.2, 12, PALETTE.steelDark, [0.4, 0.98, 0]);
  addMesh({ parent: group, name: 'w_scope_lens', geometry: new THREE.CircleGeometry(0.18, 12), material: PALETTE.lens, position: [1.52, 0.98, 0], rotation: [0, Math.PI / 2, 0] });
  addBox(group, 'w_scope_mount', 1.2, 0.24, 0.4, PALETTE.steelLight, [0.4, 0.68, 0]);
  addBox(group, 'w_foregrip', 0.36, 1.2, 0.36, PALETTE.polymer, [2.6, -0.28, 0]);
};

const buildMarksmanWeapon = (parent) => {
  const group = addPivot(parent, 'unit_weapon', [5.2, 13.0, 3.2], [0.04, 0.05, -Math.PI / 2]);
  addHexPrism(group, 'w_receiver', 0.5, 4.8, PALETTE.steelDark, [0.1, 0.1, 0]);
  addBox(group, 'w_mag', 0.48, 1.5, 0.58, PALETTE.steelMid, [-0.15, -1.2, 0], [0.1, 0, 0]);
  addHexPrism(group, 'w_handguard', 0.4, 5.8, PALETTE.steelMid, [3.9, 0.16, 0]);
  addCyl(group, 'w_barrel', 0.14, 0.13, 8.2, 10, PALETTE.steelDark, [8.2, 0.12, 0]);
  addCyl(group, 'w_muzzle_brake', 0.22, 0.2, 0.9, 10, PALETTE.steelLight, [12.55, 0.12, 0]);
  addBox(group, 'w_stock', 2.6, 0.82, 0.8, PALETTE.polymer, [-3.8, 0.2, 0]);
  addBox(group, 'w_cheek_riser', 1.1, 0.34, 0.54, PALETTE.polymer, [-3.2, 0.82, 0]);
  addBox(group, 'w_butt_plate', 0.24, 1.12, 0.76, PALETTE.rubber, [-5.1, 0.2, 0]);
  addBox(group, 'w_grip', 0.44, 1.56, 0.58, PALETTE.polymer, [-0.9, -1.02, 0], [0.18, 0, 0]);
  addCyl(group, 'w_scope_tube', 0.32, 0.32, 4.2, 12, PALETTE.steelDark, [0.4, 1.12, 0]);
  addCyl(group, 'w_scope_obj', 0.42, 0.34, 0.9, 12, PALETTE.steelDark, [2.65, 1.12, 0]);
  addMesh({ parent: group, name: 'w_scope_lens', geometry: new THREE.CircleGeometry(0.3, 12), material: PALETTE.lens, position: [3.15, 1.12, 0], rotation: [0, Math.PI / 2, 0] });
  addBox(group, 'w_bipod_l', 0.12, 1.5, 0.12, PALETTE.steelMid, [4.4, -0.88, 0.28], [-0.24, 0, 0.06]);
  addBox(group, 'w_bipod_r', 0.12, 1.5, 0.12, PALETTE.steelMid, [4.4, -0.88, -0.28], [-0.24, 0, -0.06]);
};

const buildGunnerWeapon = (parent) => {
  const group = addPivot(parent, 'unit_weapon', [4.7, 12.7, 3.0], [0.08, 0.08, -Math.PI / 2]);
  addBox(group, 'w_receiver', 4.8, 1.24, 1.04, PALETTE.steelDark, [0.5, 0.12, 0]);
  addBox(group, 'w_top_cover', 4.2, 0.3, 0.86, PALETTE.steelMid, [0.6, 0.84, 0]);
  addBox(group, 'w_ammo_box', 1.8, 2.15, 1.26, PALETTE.hazard, [0.9, -1.2, -0.48]);
  addBox(group, 'w_belt_strip', 0.34, 0.14, 0.88, PALETTE.brass, [1.15, -0.42, -0.42]);
  addHexPrism(group, 'w_heat_shield', 0.44, 4.6, PALETTE.steelMid, [4.4, 0.4, 0]);
  addCyl(group, 'w_barrel', 0.16, 0.15, 7.2, 10, PALETTE.steelDark, [8.5, 0.34, 0]);
  addCyl(group, 'w_flash_hider', 0.22, 0.18, 0.8, 8, PALETTE.steelLight, [12.2, 0.34, 0]);
  addBox(group, 'w_stock', 2.4, 0.94, 0.84, PALETTE.steelMid, [-3.2, 0.14, 0]);
  addBox(group, 'w_butt_plate', 0.24, 1.12, 0.8, PALETTE.rubber, [-4.52, 0.14, 0]);
  addBox(group, 'w_grip', 0.46, 1.6, 0.6, PALETTE.polymer, [-0.8, -1.04, 0], [0.18, 0, 0]);
  addBox(group, 'w_foregrip', 0.32, 1.2, 0.32, PALETTE.polymer, [3.4, -0.92, 0.24], [-0.18, 0, 0]);
  addBox(group, 'w_bipod_l', 0.12, 1.5, 0.12, PALETTE.steelMid, [5.2, -0.92, 0.28], [-0.22, 0, 0.08]);
  addBox(group, 'w_bipod_r', 0.12, 1.5, 0.12, PALETTE.steelMid, [5.2, -0.92, -0.28], [-0.22, 0, -0.08]);
};

const buildRpgWeapon = (parent) => {
  const group = addPivot(parent, 'unit_weapon', [5.2, 13.1, 2.8], [0.08, 0.12, -Math.PI / 2]);
  addCyl(group, 'w_tube_main', 0.58, 0.54, 10.2, 14, makeMat({ color: '#62744d', roughness: 0.78, metalness: 0.16 }), [0.8, 0, 0]);
  addCyl(group, 'w_tube_rear', 0.82, 0.62, 2.1, 12, PALETTE.steelDark, [-4.8, 0, 0]);
  addBox(group, 'w_trigger_housing', 1.2, 1.0, 0.96, PALETTE.steelMid, [-0.5, -0.58, 0]);
  addBox(group, 'w_trigger_grip', 0.46, 1.55, 0.56, PALETTE.rubber, [-0.45, -1.56, 0], [0.2, 0, 0]);
  addBox(group, 'w_rear_grip', 0.42, 1.4, 0.52, PALETTE.rubber, [-3.2, -1.06, 0], [0.16, 0, 0]);
  addBox(group, 'w_scope_housing', 0.64, 0.58, 0.62, PALETTE.steelDark, [-0.7, 0.78, 0]);
  addCyl(group, 'w_scope_eye', 0.24, 0.26, 0.8, 10, PALETTE.steelDark, [-0.72, 0.78, -0.58], [Math.PI / 2, 0, 0]);
  addMesh({ parent: group, name: 'w_scope_lens', geometry: new THREE.CircleGeometry(0.18, 10), material: PALETTE.lens, position: [-0.72, 0.78, -1.0], rotation: [Math.PI / 2, 0, 0] });
  addCyl(group, 'w_booster_motor', 0.46, 0.48, 3.0, 12, PALETTE.steelMid, [2.8, 0, 0]);
  addCyl(group, 'w_warhead_body', 0.72, 0.48, 2.8, 14, PALETTE.steelMid, [6.1, 0, 0]);
  addMesh({ parent: group, name: 'w_warhead_cone', geometry: new THREE.ConeGeometry(0.2, 1.3, 10), material: PALETTE.hazard, position: [7.75, 0, 0], rotation: [0, 0, Math.PI / 2] });
  addCyl(group, 'w_probe', 0.05, 0.05, 0.9, 6, PALETTE.steelLight, [8.45, 0, 0]);
};

const buildMissileWeapon = (parent) => {
  const group = addPivot(parent, 'unit_weapon', [4.6, 13.5, 2.8], [0.12, 0.16, -Math.PI / 2]);
  addBox(group, 'w_gripstock_body', 1.3, 1.16, 1.0, PALETTE.polymer, [-3.0, 0, 0]);
  addBox(group, 'w_pistol_grip', 0.46, 1.6, 0.56, PALETTE.polymer, [-2.8, -1.08, 0], [0.16, 0, 0]);
  addBox(group, 'w_bcu_body', 0.94, 0.92, 0.88, PALETTE.steelMid, [-1.65, -0.62, 0]);
  addBox(group, 'w_iff_antenna_rod', 0.08, 1.5, 0.08, PALETTE.steelLight, [-2.65, 1.56, 0]);
  addCyl(group, 'w_launch_tube', 0.6, 0.6, 10.1, 16, makeMat({ color: '#5d7851', roughness: 0.76, metalness: 0.16 }), [1.5, 0, 0]);
  addCyl(group, 'w_seeker_dome', 0.52, 0.48, 0.78, 14, PALETTE.steelLight, [6.7, 0, 0]);
  addMesh({ parent: group, name: 'w_seeker_lens', geometry: new THREE.CircleGeometry(0.32, 14), material: PALETTE.lens, position: [7.14, 0, 0], rotation: [0, Math.PI / 2, 0] });
  addCyl(group, 'w_missile_body', 0.42, 0.42, 8.8, 12, PALETTE.steelDark, [1.2, 0, 0]);
  addMesh({ parent: group, name: 'w_missile_cone', geometry: new THREE.ConeGeometry(0.38, 1.5, 12), material: PALETTE.steelMid, position: [5.9, 0, 0], rotation: [0, 0, Math.PI / 2] });
  addBox(group, 'w_carry_handle', 2.8, 0.28, 0.22, PALETTE.polymer, [0.2, 0.84, 0]);
};

const buildEngineerTool = (parent) => {
  const group = addPivot(parent, 'unit_tool', [4.5, 12.9, 3.0], [0.08, 0.1, -Math.PI / 2]);
  addCyl(group, 'w_wand_body', 0.28, 0.3, 3.4, 10, PALETTE.steelMid, [1.2, 0, 0]);
  addCyl(group, 'w_wand_nozzle', 0.18, 0.28, 1.5, 10, PALETTE.steelDark, [3.1, 0.02, 0]);
  addCyl(group, 'w_wand_tip', 0.08, 0.16, 0.54, 8, PALETTE.steelLight, [4.0, 0.08, 0]);
  addBox(group, 'w_valve_body', 0.84, 0.74, 0.66, PALETTE.steelMid, [-0.4, 0.12, 0]);
  addBox(group, 'w_valve_grip', 0.44, 1.48, 0.56, PALETTE.rubber, [-0.72, -0.96, 0], [0.18, 0, 0]);
  addCyl(group, 'w_hose_seg1', 0.14, 0.14, 1.8, 8, PALETTE.rubber, [-1.9, -0.3, 0.24], [0.52, 0.2, Math.PI / 2]);
  addCyl(group, 'w_hose_seg2', 0.14, 0.14, 1.2, 8, PALETTE.rubber, [-2.9, -0.52, 0.35], [0.36, 0.16, Math.PI / 2]);
  addCyl(group, 'w_coupling', 0.22, 0.22, 0.46, 8, PALETTE.steelLight, [-1.32, -0.12, 0.16]);
  addCyl(group, 'w_pilot_tube', 0.06, 0.06, 0.7, 6, PALETTE.steelLight, [3.72, 0.28, 0.18]);
  addMesh({ parent: group, name: 'w_pilot_flame', geometry: new THREE.ConeGeometry(0.09, 0.36, 8), material: makeMat({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 2.2, transparent: true, opacity: 0.74 }), position: [4.15, 0.38, 0.18], rotation: [0, 0, Math.PI / 2] });
};

const buildSoldier = ({ name, clothColor, armorColor, accentColor, helmetColor, visorColor = '#cbd5e1', visorEmissive = '#000000', visorEmissiveIntensity = 0, helmetType = 'assault', heavy = false, engineer = false, buildWeaponFn }) => {
  const root = new THREE.Group();
  root.name = name;

  const clothMat = makeMat({ color: clothColor, roughness: 0.92, metalness: 0.04 });
  const armorMat = makeMat({ color: armorColor, roughness: 0.6, metalness: 0.22 });
  const accentMat = makeMat({ color: accentColor, roughness: 0.44, metalness: 0.28 });
  const helmetMat = makeMat({ color: helmetColor, roughness: 0.62, metalness: 0.22 });
  const skinMat = makeMat({ color: '#b97848', roughness: 0.82, metalness: 0 });
  const beltMat = makeMat({ color: '#25282d', roughness: 0.76, metalness: 0.12 });
  const visorMat = makeMat({ color: visorColor, emissive: visorEmissive, emissiveIntensity: visorEmissiveIntensity, roughness: 0.16, metalness: 0.52, transparent: visorEmissiveIntensity > 0, opacity: visorEmissiveIntensity > 0 ? 0.86 : 1 });

  const legLeft = addPivot(root, 'unit_leg_left', [-1.85, 10.2, 0]);
  addMesh({ parent: legLeft, name: 'unit_leg_left_mesh', geometry: new THREE.CapsuleGeometry(1.34, 8.8, 6, 10), material: clothMat, position: [0, -4.8, 0] });
  addPlate(legLeft, 'unit_leg_left_plate', 2.1, 3.0, 0.7, armorMat, [0, -5.7, 1.0]);
  addBox(legLeft, 'unit_knee_pad_l', 2.4, 1.5, 1.4, accentMat, [0, -7.0, 0.86]);

  const legRight = addPivot(root, 'unit_leg_right', [1.85, 10.2, 0]);
  addMesh({ parent: legRight, name: 'unit_leg_right_mesh', geometry: new THREE.CapsuleGeometry(1.34, 8.8, 6, 10), material: clothMat, position: [0, -4.8, 0] });
  addPlate(legRight, 'unit_leg_right_plate', 2.1, 3.0, 0.7, armorMat, [0, -5.7, 1.0]);
  addBox(legRight, 'unit_knee_pad_r', 2.4, 1.5, 1.4, accentMat, [0, -7.0, 0.86]);

  const bootLeft = addPivot(root, 'unit_boot_left', [-1.85, 2.2, 0.4]);
  addBox(bootLeft, 'unit_boot_left_mesh', 2.4, 1.6, 4.9, PALETTE.rubber, [0, -1.08, 0.7]);
  addCyl(bootLeft, 'unit_boot_ankle_l', 1.28, 1.36, 1.2, 10, PALETTE.rubber, [0, -0.26, -0.32], [0, 0, 0]);

  const bootRight = addPivot(root, 'unit_boot_right', [1.85, 2.2, 0.4]);
  addBox(bootRight, 'unit_boot_right_mesh', 2.4, 1.6, 4.9, PALETTE.rubber, [0, -1.08, 0.7]);
  addCyl(bootRight, 'unit_boot_ankle_r', 1.28, 1.36, 1.2, 10, PALETTE.rubber, [0, -0.26, -0.32], [0, 0, 0]);

  const torso = addPivot(root, 'unit_torso', [0, 15.4, 0]);
  addMesh({ parent: torso, name: 'unit_torso_mesh', geometry: new THREE.CapsuleGeometry(3.45, 11.2, 8, 12), material: clothMat, position: [0, 0, 0] });
  addPlate(torso, 'unit_torso_chest', 7.6, 6.4, 1.0, armorMat, [0, 1.0, 1.9]);
  addPlate(torso, 'unit_torso_ab', 5.4, 3.6, 0.8, accentMat, [0, -2.4, 1.8]);
  addCyl(root, 'unit_hydro_hose', 0.12, 0.12, 3.6, 6, beltMat, [-3.7, 18.8, 0.7], [0.36, 0, Math.PI / 2]);

  const vest = addPivot(root, 'unit_vest', [0, 15.6, 2.1]);
  addBox(vest, 'unit_vest_front', 8.2, 7.8, 1.5, armorMat, [0, 0, 0]);
  addBox(vest, 'unit_vest_back_plate', 7.2, 7.4, 1.2, armorMat, [0, -0.1, -4.2]);
  addBox(vest, 'unit_vest_side_l', 1.2, 5.7, 3.8, armorMat, [-4.4, -0.9, -2.0]);
  addBox(vest, 'unit_vest_side_r', 1.2, 5.7, 3.8, armorMat, [4.4, -0.9, -2.0]);
  for (let index = 0; index < (heavy ? 4 : 3); index += 1) {
    addBox(vest, `unit_vest_pouch_${index}`, 1.7, 2.0, 0.84, accentMat, [(-1.5 + index) * 2.1, -2.8, 0.52]);
  }

  const belt = addPivot(root, 'unit_belt', [0, 10.9, 0.8]);
  addBox(belt, 'unit_belt_mesh', 8.6, 1.36, 3.8, beltMat, [0, 0, 0]);
  addBox(belt, 'unit_belt_buckle', 1.05, 1.0, 0.28, PALETTE.steelLight, [0, 0, 1.96]);
  addBox(belt, 'unit_belt_utility_l', 1.5, 1.2, 1.0, accentMat, [-3.5, -0.6, 0.6]);
  addBox(belt, 'unit_belt_utility_r', 1.5, 1.2, 1.0, accentMat, [3.5, -0.6, 0.6]);

  const pack = addPivot(root, 'unit_pack', [0, 15.6, -3.9]);
  addBox(pack, 'unit_pack_mesh', engineer ? 6.6 : 5.8, engineer ? 8.8 : 7.2, 4.0, armorMat, [0, 0, 0]);
  addBox(pack, 'unit_pack_top_flap', 5.2, 1.0, 3.4, accentMat, [0, 4.4, 0.2]);
  addBox(pack, 'unit_pack_front_zip', 3.7, 3.2, 0.5, accentMat, [0, -1.1, -2.02]);

  const armLeft = addPivot(root, 'unit_arm_left', [-4.9, 19.1, 0.7]);
  addMesh({ parent: armLeft, name: 'unit_arm_left_mesh', geometry: new THREE.CapsuleGeometry(1.12, 9.0, 6, 10), material: clothMat, position: [-0.52, -3.4, 0], rotation: [0.08, 0, 0.24] });
  addBox(armLeft, 'unit_elbow_l', 2.1, 1.26, 1.4, accentMat, [-0.92, -6.1, -0.1]);
  addMesh({ parent: armLeft, name: 'unit_hand_l', geometry: new THREE.SphereGeometry(1.0, 10, 8), material: beltMat, position: [-0.9, -8.8, 0.35], scale: [0.96, 1.26, 0.8] });

  const armRight = addPivot(root, 'unit_arm_right', [4.8, 18.9, 1.2]);
  addMesh({ parent: armRight, name: 'unit_arm_right_mesh', geometry: new THREE.CapsuleGeometry(1.12, 9.0, 6, 10), material: clothMat, position: [0.56, -3.42, 0.3], rotation: [0.24, 0.04, -0.62] });
  addBox(armRight, 'unit_elbow_r', 2.1, 1.26, 1.4, accentMat, [0.82, -6.08, 0.24]);
  addMesh({ parent: armRight, name: 'unit_hand_r', geometry: new THREE.SphereGeometry(1.0, 10, 8), material: beltMat, position: [0.92, -8.82, 0.84], scale: [0.96, 1.26, 0.8] });

  const padLeft = addPivot(root, 'unit_pad_left', [-4.8, 19.0, 0.7]);
  addMesh({ parent: padLeft, name: 'unit_pad_left_mesh', geometry: new THREE.SphereGeometry(1.9, 12, 8), material: armorMat, position: [0, 0, 0], scale: [1, 0.58, 0.92] });
  const padRight = addPivot(root, 'unit_pad_right', [4.8, 18.7, 1.2]);
  addMesh({ parent: padRight, name: 'unit_pad_right_mesh', geometry: new THREE.SphereGeometry(1.9, 12, 8), material: armorMat, position: [0, 0, 0], scale: [1, 0.58, 0.92] });

  const head = addPivot(root, 'unit_head', [0, 23.9, 0.28]);
  addMesh({ parent: head, name: 'unit_head_mesh', geometry: new THREE.SphereGeometry(3.05, 18, 14), material: skinMat, position: [0, 1.36, 0.1] });

  const neckWrap = addPivot(root, 'unit_neck_wrap', [0, 22.4, 0.3]);
  addCyl(neckWrap, 'unit_neck_wrap_mesh', 1.7, 1.86, 2.0, 12, accentMat, [0, 0, 0], [0, 0, 0]);

  const helmet = addPivot(root, 'unit_helmet', [0, 25.7, 0.18]);
  if (helmetType === 'marksman') {
    addCyl(helmet, 'unit_helmet_shell', 4.6, 4.2, 1.9, 12, helmetMat, [0, 1.3, 0], [0, 0, 0]);
    addMesh({ parent: helmet, name: 'unit_helmet_crown', geometry: new THREE.SphereGeometry(3.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), material: helmetMat, position: [0, 1.2, 0] });
  } else if (helmetType === 'recon') {
    addMesh({ parent: helmet, name: 'unit_helmet_shell', geometry: new THREE.SphereGeometry(3.7, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), material: helmetMat, position: [0, 0.45, 0] });
    addBox(helmet, 'unit_helmet_rail_l', 0.22, 2.4, 0.18, armorMat, [-3.0, 0.8, 0]);
    addBox(helmet, 'unit_helmet_rail_r', 0.22, 2.4, 0.18, armorMat, [3.0, 0.8, 0]);
    addBox(helmet, 'unit_nvg_mount', 1.1, 0.54, 0.54, PALETTE.steelDark, [0, 1.18, 3.0]);
  } else {
    addMesh({ parent: helmet, name: 'unit_helmet_shell', geometry: new THREE.SphereGeometry(3.66, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.66), material: helmetMat, position: [0, 0.24, 0], scale: [1, 0.82, 1] });
    addBox(helmet, 'unit_helmet_brim', 7.6, 0.44, 7.0, helmetMat, [0, -1.8, 0]);
    addBox(helmet, 'unit_chin_strap', 5.6, 0.22, 0.18, beltMat, [0, -2.56, 2.25]);
  }
  addBox(helmet, 'unit_ear_l', 0.26, 1.0, 0.92, PALETTE.steelDark, [-3.18, -0.28, 0]);
  addBox(helmet, 'unit_ear_r', 0.26, 1.0, 0.92, PALETTE.steelDark, [3.18, -0.28, 0]);

  const visor = addPivot(root, 'unit_visor', [0, 25.15, 3.2]);
  addBox(visor, 'unit_visor_mesh', 4.4, 1.42, 0.34, visorMat, [0, 0, 0]);

  if (engineer) {
    const toolCanister = addPivot(root, 'unit_tool_canister', [-3.9, 14.3, -4.9]);
    addCyl(toolCanister, 'unit_tool_canister_mesh', 1.18, 1.22, 5.6, 14, PALETTE.hazard, [0, 0, 0], [0.12, 0, 0.2]);
    addBox(root, 'unit_tool_canister2', 1.9, 4.8, 1.9, makeMat({ color: '#78350f', roughness: 0.66, metalness: 0.26 }), [0.6, 13.8, -5.3]);
    addCyl(root, 'unit_fuel_line', 0.12, 0.12, 4.1, 6, PALETTE.rubber, [-1.5, 15.0, -5.0], [0.4, 0.3, Math.PI / 2]);
    const torch = addPivot(root, 'unit_torch', [5.7, 12.9, 1.0]);
    addCyl(torch, 'unit_torch_mesh', 0.24, 0.24, 5.2, 8, PALETTE.hazard, [0, 0, 0], [0.3, 0.12, -0.22]);
    addBox(torch, 'unit_torch_handle', 0.5, 1.62, 0.5, PALETTE.rubber, [0, -1.62, 0]);
  }

  buildWeaponFn(root);
  return root;
};

const root = new THREE.Group();
root.name = 'human_units_root';

root.add(buildSoldier({ name: 'unit_soldier_rifleman', clothColor: '#5c7354', armorColor: '#4a5967', accentColor: '#7b8a7b', helmetColor: '#5b6f56', visorColor: '#94a3b8', helmetType: 'assault', buildWeaponFn: buildRiflemanWeapon }));
root.add(buildSoldier({ name: 'unit_soldier_marksman', clothColor: '#7c7466', armorColor: '#545a63', accentColor: '#a1937f', helmetColor: '#6c6557', visorColor: '#8fa5b0', helmetType: 'marksman', buildWeaponFn: buildMarksmanWeapon }));
root.add(buildSoldier({ name: 'unit_soldier_gunner', clothColor: '#536a42', armorColor: '#41474f', accentColor: '#6d6d6d', helmetColor: '#4d6142', visorColor: '#6b7280', helmetType: 'recon', heavy: true, buildWeaponFn: buildGunnerWeapon }));
root.add(buildSoldier({ name: 'unit_soldier_rpg', clothColor: '#877152', armorColor: '#5b5147', accentColor: '#b39468', helmetColor: '#665848', visorColor: '#b5a28e', helmetType: 'assault', buildWeaponFn: buildRpgWeapon }));
root.add(buildSoldier({ name: 'unit_soldier_missile', clothColor: '#475c77', armorColor: '#30445c', accentColor: '#6a7e99', helmetColor: '#30465e', visorColor: '#38bdf8', visorEmissive: '#0369a1', visorEmissiveIntensity: 0.34, helmetType: 'recon', buildWeaponFn: buildMissileWeapon }));
root.add(buildSoldier({ name: 'unit_soldier_engineer', clothColor: '#406862', armorColor: '#27514b', accentColor: '#d97706', helmetColor: '#39635c', visorColor: '#34d399', visorEmissive: '#059669', visorEmissiveIntensity: 0.3, helmetType: 'recon', engineer: true, buildWeaponFn: buildEngineerTool }));

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
