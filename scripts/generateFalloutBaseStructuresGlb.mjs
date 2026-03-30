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
const outPath = path.join(outDir, 'base_structures.glb');

const root = new THREE.Group();
root.name = 'base_structures_root';

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.84,
  metalness = 0.14,
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

const addPipeRun = (parent, prefix, material, startX, y, z, count, spacing) => {
  for (let i = 0; i < count; i++) {
    addMesh({
      parent,
      name: `${prefix}_${i}`,
      geometry: new THREE.CylinderGeometry(0.8, 0.8, 22, 8),
      material,
      position: [startX + i * spacing, y, z],
      rotation: [0, 0, Math.PI / 2]
    });
  }
};

const cloneGroupWithUniqueMaterials = (source, name) => {
  const clone = source.clone(true);
  clone.name = name;
  clone.traverse((node) => {
    if (!node.isMesh) return;
    if (Array.isArray(node.material)) {
      node.material = node.material.map((material) => material.clone());
    } else if (node.material) {
      node.material = node.material.clone();
    }
  });
  return clone;
};

const tweakNode = (rootGroup, objectName, {
  position = null,
  rotation = null,
  scale = null,
  visible
} = {}) => {
  const node = rootGroup.getObjectByName(objectName);
  if (!node) return;
  if (position) {
    node.position.x += position[0] || 0;
    node.position.y += position[1] || 0;
    node.position.z += position[2] || 0;
  }
  if (rotation) {
    node.rotation.x += rotation[0] || 0;
    node.rotation.y += rotation[1] || 0;
    node.rotation.z += rotation[2] || 0;
  }
  if (scale) {
    node.scale.multiply(new THREE.Vector3(scale[0], scale[1], scale[2]));
  }
  if (visible !== undefined) {
    node.visible = visible;
  }
};

const damageStructureMaterials = (group, {
  brightness = 0.52,
  emberColor = '#421212'
} = {}) => {
  const ember = new THREE.Color(emberColor);
  group.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      if (material.color) {
        material.color.multiplyScalar(brightness);
      }
      if (material.emissive) {
        material.emissive.copy(ember);
        material.emissiveIntensity = Math.max((material.emissiveIntensity || 0) * 0.2, 0.08);
      }
      material.roughness = Math.min(1, (material.roughness ?? 0.8) + 0.14);
      material.metalness = Math.max(0, (material.metalness ?? 0.2) * 0.9);
    });
  });
};

const addBrokenGround = (group, prefix, radiusX = 24, radiusZ = 20) => {
  addMesh({
    parent: group,
    name: `${prefix}_scorch_outer`,
    geometry: new THREE.CylinderGeometry(1, 1.08, 0.28, 18),
    material: makeMaterial({ color: '#151718', roughness: 1, metalness: 0.02 }),
    position: [0, 0.2, 0],
    scale: [radiusX, 1, radiusZ]
  });
  addMesh({
    parent: group,
    name: `${prefix}_scorch_inner`,
    geometry: new THREE.CylinderGeometry(1, 1.04, 0.22, 18),
    material: makeMaterial({ color: '#2c120d', roughness: 1, metalness: 0.02 }),
    position: [0, 0.34, 0],
    scale: [radiusX * 0.68, 1, radiusZ * 0.64]
  });
};

const addBrokenDebris = (group, prefix, items) => {
  const concreteMat = makeMaterial({ color: '#343c45', roughness: 0.98, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#3a414d', roughness: 0.82, metalness: 0.38 });
  items.forEach((item, index) => {
    addMesh({
      parent: group,
      name: `${prefix}_debris_${index}`,
      geometry: item.geometry || new THREE.BoxGeometry(item.size?.[0] || 8, item.size?.[1] || 3, item.size?.[2] || 5),
      material: item.metal ? steelMat : concreteMat,
      position: item.position || [0, 2, 0],
      rotation: item.rotation || [0, 0, 0]
    });
  });
};

const createBrokenVariant = (source, {
  name,
  rootOffset = [0, 0, 0],
  rootRotation = [0, 0, 0],
  brightness = 0.52,
  emberColor = '#421212',
  scorchRadius = [24, 20],
  tweaks = [],
  debris = []
}) => {
  const broken = cloneGroupWithUniqueMaterials(source, name);
  broken.position.set(rootOffset[0], rootOffset[1], rootOffset[2]);
  broken.rotation.set(rootRotation[0], rootRotation[1], rootRotation[2]);
  damageStructureMaterials(broken, { brightness, emberColor });
  tweaks.forEach((tweak) => tweakNode(broken, tweak.name, tweak));
  addBrokenGround(broken, name, scorchRadius[0], scorchRadius[1]);
  addBrokenDebris(broken, name, debris);
  return broken;
};

const buildVaultBunker = () => {
  const group = new THREE.Group();
  group.name = 'vault_bunker';

  const concreteMat = makeMaterial({ color: '#8a8f98', roughness: 0.96, metalness: 0.08 });
  const darkConcreteMat = makeMaterial({ color: '#5b616b', roughness: 0.98, metalness: 0.05 });
  const steelMat = makeMaterial({ color: '#9ba6b2', roughness: 0.34, metalness: 0.78 });
  const darkSteelMat = makeMaterial({ color: '#3a4755', roughness: 0.42, metalness: 0.72 });
  const amberLightMat = makeMaterial({ color: '#ffd08a', emissive: '#f59e0b', emissiveIntensity: 1.8, roughness: 0.22, metalness: 0.22 });

  const shell = new THREE.Group();
  shell.name = 'bunker_shell';
  group.add(shell);

  addMesh({
    parent: shell,
    name: 'bunker_foundation',
    geometry: new THREE.BoxGeometry(56, 5, 72),
    material: darkConcreteMat,
    position: [0, 2.5, 6]
  });
  addMesh({
    parent: shell,
    name: 'bunker_mound',
    geometry: new THREE.CylinderGeometry(25, 34, 18, 10),
    material: makeMaterial({ color: '#4c5c40', roughness: 1, metalness: 0.02 }),
    position: [0, 7, -8],
    scale: [1.28, 0.72, 1.8]
  });
  addMesh({
    parent: shell,
    name: 'bunker_hull',
    geometry: new THREE.CylinderGeometry(18, 22, 48, 18, 1, false, 0, Math.PI),
    material: concreteMat,
    position: [0, 18, -4],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.18, 1, 1.2]
  });
  addMesh({
    parent: shell,
    name: 'bunker_rear_buttress',
    geometry: new THREE.BoxGeometry(38, 15, 18),
    material: concreteMat,
    position: [0, 14, -24]
  });
  addMesh({
    parent: shell,
    name: 'bunker_front_block',
    geometry: new THREE.BoxGeometry(34, 20, 20),
    material: concreteMat,
    position: [0, 12, 23]
  });
  addMesh({
    parent: shell,
    name: 'bunker_roof_beam',
    geometry: new THREE.BoxGeometry(30, 4, 14),
    material: darkConcreteMat,
    position: [0, 23, 16]
  });
  addMesh({
    parent: shell,
    name: 'bunker_apron',
    geometry: new THREE.BoxGeometry(28, 1.4, 28),
    material: makeMaterial({ color: '#6b7280', roughness: 0.92, metalness: 0.08 }),
    position: [0, 0.8, 31]
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: shell,
      name: `bunker_retaining_wall_${index}`,
      geometry: new THREE.BoxGeometry(6, 16, 26),
      material: darkConcreteMat,
      position: [side * 18, 9, 25],
      rotation: [0, side * -0.18, 0]
    });
    addMesh({
      parent: shell,
      name: `bunker_vent_stack_${index}`,
      geometry: new THREE.CylinderGeometry(2, 2.6, 16, 10),
      material: steelMat,
      position: [side * 12, 28, -10]
    });
    addMesh({
      parent: shell,
      name: `bunker_vent_cap_${index}`,
      geometry: new THREE.CylinderGeometry(3.6, 3.2, 2.8, 10),
      material: darkSteelMat,
      position: [side * 12, 36, -10]
    });
  });

  const entry = new THREE.Group();
  entry.name = 'bunker_entry';
  entry.position.set(0, 12, 34);
  group.add(entry);

  addMesh({
    parent: entry,
    name: 'bunker_entry_frame',
    geometry: new THREE.CylinderGeometry(12, 12, 6, 28),
    material: darkSteelMat,
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: entry,
    name: 'bunker_entry_ring',
    geometry: new THREE.TorusGeometry(11.8, 1.1, 10, 28),
    material: steelMat,
    rotation: [Math.PI / 2, 0, 0]
  });

  const door = new THREE.Group();
  door.name = 'bunker_door';
  door.position.set(0, 0, 2.4);
  entry.add(door);

  addMesh({
    parent: door,
    name: 'bunker_door_disc',
    geometry: new THREE.CylinderGeometry(10.4, 10.4, 2.8, 28),
    material: steelMat,
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: door,
    name: 'bunker_door_hub',
    geometry: new THREE.CylinderGeometry(2.4, 2.4, 2.2, 18),
    material: darkSteelMat,
    position: [0, 0, 1.2],
    rotation: [Math.PI / 2, 0, 0]
  });
  for (let i = 0; i < 6; i++) {
    addMesh({
      parent: door,
      name: `bunker_door_spoke_${i}`,
      geometry: new THREE.BoxGeometry(13.5, 1.2, 1.3),
      material: darkSteelMat,
      position: [0, 0, 1.45],
      rotation: [0, 0, (i * Math.PI) / 3]
    });
  }

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: entry,
      name: `bunker_guardrail_post_${index}_a`,
      geometry: new THREE.BoxGeometry(1.2, 8, 1.2),
      material: steelMat,
      position: [side * 10, -5, 6]
    });
    addMesh({
      parent: entry,
      name: `bunker_guardrail_post_${index}_b`,
      geometry: new THREE.BoxGeometry(1.2, 8, 1.2),
      material: steelMat,
      position: [side * 10, -5, 14]
    });
    addMesh({
      parent: entry,
      name: `bunker_guardrail_bar_${index}`,
      geometry: new THREE.BoxGeometry(1.1, 1.1, 10),
      material: steelMat,
      position: [side * 10, -2.2, 10]
    });
  });

  addMesh({
    parent: group,
    name: 'bunker_light_0',
    geometry: new THREE.BoxGeometry(2.8, 2.6, 2.4),
    material: amberLightMat,
    position: [-8, 22, 28]
  });
  addMesh({
    parent: group,
    name: 'bunker_light_1',
    geometry: new THREE.BoxGeometry(2.8, 2.6, 2.4),
    material: amberLightMat,
    position: [8, 22, 28]
  });

  return group;
};

const buildPowerPlant = () => {
  const group = new THREE.Group();
  group.name = 'facility_powerplant';

  const concreteMat = makeMaterial({ color: '#808893', roughness: 0.9, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#64707d', roughness: 0.62, metalness: 0.42 });
  const darkSteelMat = makeMaterial({ color: '#364152', roughness: 0.56, metalness: 0.58 });
  const copperGlowMat = makeMaterial({ color: '#ffd08a', emissive: '#f59e0b', emissiveIntensity: 1.4, roughness: 0.24, metalness: 0.24 });

  addMesh({
    parent: group,
    name: 'facility_powerplant_pad',
    geometry: new THREE.BoxGeometry(58, 3, 64),
    material: concreteMat,
    position: [0, 1.5, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_hall',
    geometry: new THREE.BoxGeometry(42, 22, 30),
    material: steelMat,
    position: [0, 14, 6]
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_roof',
    geometry: new THREE.BoxGeometry(44, 3, 32),
    material: darkSteelMat,
    position: [0, 26.5, 6]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_powerplant_cooler_${index}`,
      geometry: new THREE.CylinderGeometry(7, 10, 26, 12),
      material: concreteMat,
      position: [side * 15, 14, -17],
      scale: [1.05, 1, 1.05]
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_stack_${index}`,
      geometry: new THREE.CylinderGeometry(2.6, 3.2, 32, 10),
      material: darkSteelMat,
      position: [side * 11, 33, 16]
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_stack_cap_${index}`,
      geometry: new THREE.CylinderGeometry(3.6, 3.2, 2.8, 10),
      material: steelMat,
      position: [side * 11, 50, 16]
    });
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_powerplant_transformer_${index}`,
      geometry: new THREE.BoxGeometry(10, 8, 8),
      material: darkSteelMat,
      position: [side * 20, 7, 22]
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_transformer_glow_${index}`,
      geometry: new THREE.BoxGeometry(7, 1.2, 6),
      material: copperGlowMat,
      position: [side * 20, 11.5, 22]
    });
  });
  addPipeRun(group, 'facility_powerplant_pipe', steelMat, -18, 18, -5, 4, 12);

  return group;
};

const buildWarFactory = () => {
  const group = new THREE.Group();
  group.name = 'facility_war_factory';

  const concreteMat = makeMaterial({ color: '#707784', roughness: 0.92, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#4b5563', roughness: 0.64, metalness: 0.48 });
  const darkSteelMat = makeMaterial({ color: '#1f2937', roughness: 0.54, metalness: 0.6 });

  addMesh({
    parent: group,
    name: 'facility_war_factory_pad',
    geometry: new THREE.BoxGeometry(66, 3, 58),
    material: concreteMat,
    position: [0, 1.5, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_hangar',
    geometry: new THREE.BoxGeometry(52, 24, 38),
    material: steelMat,
    position: [0, 15, -2]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_roof',
    geometry: new THREE.BoxGeometry(54, 4, 40),
    material: darkSteelMat,
    position: [0, 29, -2]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_bay_frame',
    geometry: new THREE.BoxGeometry(28, 18, 3),
    material: darkSteelMat,
    position: [0, 12, 18.5]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_bay_door',
    geometry: new THREE.BoxGeometry(22, 14, 2),
    material: makeMaterial({ color: '#94a3b8', roughness: 0.46, metalness: 0.68 }),
    position: [0, 11, 19.8]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_annex',
    geometry: new THREE.BoxGeometry(18, 14, 18),
    material: steelMat,
    position: [-21, 10, -18]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_crane_beam',
    geometry: new THREE.BoxGeometry(36, 2.2, 4),
    material: darkSteelMat,
    position: [0, 24, -10]
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_crane_trolley',
    geometry: new THREE.BoxGeometry(6, 4, 4),
    material: makeMaterial({ color: '#b45309', roughness: 0.62, metalness: 0.24 }),
    position: [-4, 21, -10]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_war_factory_exhaust_${index}`,
      geometry: new THREE.BoxGeometry(5, 18, 5),
      material: darkSteelMat,
      position: [side * 18, 34, -16]
    });
    addMesh({
      parent: group,
      name: `facility_war_factory_track_${index}`,
      geometry: new THREE.BoxGeometry(9, 2.8, 20),
      material: darkSteelMat,
      position: [side * 17, 3.3, -14]
    });
  });

  return group;
};

const buildFieldHospital = () => {
  const group = new THREE.Group();
  group.name = 'facility_field_hospital';

  const concreteMat = makeMaterial({ color: '#d8dee7', roughness: 0.88, metalness: 0.08 });
  const roofMat = makeMaterial({ color: '#94a3b8', roughness: 0.68, metalness: 0.18 });
  const tentMat = makeMaterial({ color: '#eef2f7', roughness: 0.96, metalness: 0.02 });
  const redMat = makeMaterial({ color: '#dc2626', roughness: 0.48, metalness: 0.06 });

  addMesh({
    parent: group,
    name: 'facility_field_hospital_pad',
    geometry: new THREE.BoxGeometry(60, 2.5, 58),
    material: makeMaterial({ color: '#9ca3af', roughness: 0.94, metalness: 0.04 }),
    position: [0, 1.25, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_core',
    geometry: new THREE.BoxGeometry(30, 18, 26),
    material: concreteMat,
    position: [0, 12, -2]
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_roof',
    geometry: new THREE.BoxGeometry(32, 3, 28),
    material: roofMat,
    position: [0, 22.5, -2]
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_cross_h',
    geometry: new THREE.BoxGeometry(8, 6, 2.4),
    material: redMat,
    position: [0, 18, 12.6]
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_cross_v',
    geometry: new THREE.BoxGeometry(2.4, 10, 2.4),
    material: redMat,
    position: [0, 18, 12.8]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_field_hospital_tent_${index}`,
      geometry: new THREE.BoxGeometry(16, 8, 18),
      material: tentMat,
      position: [side * 18, 6, -10],
      rotation: [0, side * 0.08, 0]
    });
    addMesh({
      parent: group,
      name: `facility_field_hospital_tent_roof_${index}`,
      geometry: new THREE.BoxGeometry(18, 2.2, 12),
      material: roofMat,
      position: [side * 18, 11, -10],
      rotation: [0.26, 0, 0]
    });
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_triage',
    geometry: new THREE.BoxGeometry(22, 10, 12),
    material: concreteMat,
    position: [0, 8, 16]
  });

  return group;
};

const buildTechLab = () => {
  const group = new THREE.Group();
  group.name = 'facility_tech_lab';

  const concreteMat = makeMaterial({ color: '#6b7280', roughness: 0.92, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#475569', roughness: 0.56, metalness: 0.54 });
  const darkSteelMat = makeMaterial({ color: '#0f172a', roughness: 0.48, metalness: 0.62 });
  const glowMat = makeMaterial({ color: '#67e8f9', emissive: '#22d3ee', emissiveIntensity: 1.6, roughness: 0.18, metalness: 0.52 });

  addMesh({
    parent: group,
    name: 'facility_tech_lab_pad',
    geometry: new THREE.BoxGeometry(54, 3, 54),
    material: concreteMat,
    position: [0, 1.5, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_core',
    geometry: new THREE.CylinderGeometry(13, 15, 24, 16),
    material: steelMat,
    position: [0, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_annex',
    geometry: new THREE.BoxGeometry(26, 14, 16),
    material: darkSteelMat,
    position: [0, 9, 17]
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_tower',
    geometry: new THREE.CylinderGeometry(4.5, 5.5, 26, 12),
    material: steelMat,
    position: [0, 34, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_sensor',
    geometry: new THREE.SphereGeometry(3.2, 12, 12),
    material: glowMat,
    position: [0, 48, 0]
  });

  const dish = new THREE.Group();
  dish.name = 'facility_tech_lab_dish';
  dish.position.set(0, 40, 0);
  group.add(dish);

  addMesh({
    parent: dish,
    name: 'facility_tech_lab_dish_bowl',
    geometry: new THREE.CylinderGeometry(0.6, 8.6, 4.4, 24, 1, true),
    material: makeMaterial({ color: '#dbeafe', roughness: 0.24, metalness: 0.82, side: THREE.DoubleSide }),
    rotation: [-Math.PI / 2.9, 0, 0]
  });
  addMesh({
    parent: dish,
    name: 'facility_tech_lab_dish_emitter',
    geometry: new THREE.SphereGeometry(1.8, 10, 10),
    material: glowMat,
    position: [0, 0, -3.2]
  });

  return group;
};

const buildRadarTower = () => {
  const group = new THREE.Group();
  group.name = 'facility_radar_tower';

  const concreteMat = makeMaterial({ color: '#7c8592', roughness: 0.92, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#a3afbd', roughness: 0.42, metalness: 0.68 });
  const darkSteelMat = makeMaterial({ color: '#334155', roughness: 0.52, metalness: 0.62 });
  const glowMat = makeMaterial({ color: '#67e8f9', emissive: '#22d3ee', emissiveIntensity: 1.3, roughness: 0.2, metalness: 0.46 });

  addMesh({
    parent: group,
    name: 'facility_radar_tower_pad',
    geometry: new THREE.CylinderGeometry(18, 21, 4, 14),
    material: concreteMat,
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_radar_tower_core',
    geometry: new THREE.CylinderGeometry(4, 5.4, 34, 10),
    material: darkSteelMat,
    position: [0, 19, 0]
  });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    addMesh({
      parent: group,
      name: `facility_radar_tower_brace_${i}`,
      geometry: new THREE.BoxGeometry(2, 36, 2),
      material: steelMat,
      position: [Math.cos(angle) * 8, 18, Math.sin(angle) * 8],
      rotation: [0.08, 0, i < 2 ? -0.18 : 0.18]
    });
  }
  addMesh({
    parent: group,
    name: 'facility_radar_tower_glow',
    geometry: new THREE.SphereGeometry(4.2, 12, 12),
    material: glowMat,
    position: [0, 48, 0]
  });

  const dish = new THREE.Group();
  dish.name = 'facility_radar_tower_dish';
  dish.position.set(0, 39, 0);
  group.add(dish);

  addMesh({
    parent: dish,
    name: 'facility_radar_tower_frame',
    geometry: new THREE.TorusGeometry(12, 1.1, 8, 28),
    material: steelMat
  });
  addMesh({
    parent: dish,
    name: 'facility_radar_tower_bar_h',
    geometry: new THREE.BoxGeometry(22, 1.4, 1.4),
    material: steelMat
  });
  addMesh({
    parent: dish,
    name: 'facility_radar_tower_bar_v',
    geometry: new THREE.BoxGeometry(1.4, 22, 1.4),
    material: steelMat
  });

  return group;
};

const buildAASite = () => {
  const group = new THREE.Group();
  group.name = 'facility_aa_site';

  const concreteMat = makeMaterial({ color: '#6b7280', roughness: 0.94, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#475569', roughness: 0.48, metalness: 0.66 });
  const darkSteelMat = makeMaterial({ color: '#111827', roughness: 0.58, metalness: 0.62 });
  const screenMat = makeMaterial({ color: '#7dd3fc', emissive: '#22d3ee', emissiveIntensity: 1.1, roughness: 0.16, metalness: 0.46 });

  addMesh({
    parent: group,
    name: 'facility_aa_site_ring',
    geometry: new THREE.CylinderGeometry(22, 24, 4, 18),
    material: concreteMat,
    position: [0, 2, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_aa_site_bunker',
    geometry: new THREE.CylinderGeometry(14, 16, 14, 16),
    material: darkSteelMat,
    position: [0, 11, 0]
  });
  addMesh({
    parent: group,
    name: 'facility_aa_site_platform',
    geometry: new THREE.CylinderGeometry(11, 12, 5, 14),
    material: steelMat,
    position: [0, 20, 0]
  });

  const turret = new THREE.Group();
  turret.name = 'facility_aa_site_turret';
  turret.position.set(0, 23, 0);
  group.add(turret);

  addMesh({
    parent: turret,
    name: 'facility_aa_site_turret_body',
    geometry: new THREE.BoxGeometry(16, 5, 12),
    material: darkSteelMat
  });
  addMesh({
    parent: turret,
    name: 'facility_aa_site_sensor',
    geometry: new THREE.BoxGeometry(4.2, 2.4, 2.8),
    material: screenMat,
    position: [0, 1.8, -3.2]
  });

  const barrel = new THREE.Group();
  barrel.name = 'facility_aa_site_barrel';
  barrel.position.set(0, 0.9, 5.6);
  turret.add(barrel);

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: barrel,
      name: `facility_aa_site_gun_${index}`,
      geometry: new THREE.CylinderGeometry(0.68, 0.78, 12, 8),
      material: steelMat,
      position: [side * 2.6, 0, 0],
      rotation: [Math.PI / 2, 0, 0]
    });
  });
  addMesh({
    parent: barrel,
    name: 'facility_aa_site_gun_mount',
    geometry: new THREE.BoxGeometry(6.5, 1.4, 4.8),
    material: darkSteelMat,
    position: [0, 0, -2.2]
  });

  return group;
};

const vaultBunker = buildVaultBunker();
const powerPlant = buildPowerPlant();
const warFactory = buildWarFactory();
const fieldHospital = buildFieldHospital();
const techLab = buildTechLab();
const radarTower = buildRadarTower();
const aaSite = buildAASite();

[
  vaultBunker,
  createBrokenVariant(vaultBunker, {
    name: 'vault_bunker_broken',
    rootOffset: [0, -1.6, 0],
    rootRotation: [0.05, 0, -0.08],
    scorchRadius: [26, 18],
    tweaks: [
      { name: 'bunker_hull', position: [0, -2.4, -1.6], rotation: [-0.08, 0, 0] },
      { name: 'bunker_front_block', position: [0, -1.8, 1.2], rotation: [0.04, 0.02, 0] },
      { name: 'bunker_entry', position: [0, 0, -2.2], rotation: [0.02, 0, 0] },
      { name: 'bunker_door', position: [-3.2, 0, 2.6], rotation: [0, -0.6, 0] },
      { name: 'bunker_light_0', visible: false },
      { name: 'bunker_light_1', visible: false }
    ],
    debris: [
      { position: [-8, 2.4, 22], rotation: [0.24, 0.32, 0.18], size: [8, 3, 6] },
      { position: [8, 2.8, 18], rotation: [0.14, -0.42, 0.28], size: [6, 4, 5], metal: true },
      { position: [0, 2, 29], rotation: [0.12, 0.5, 0.36], size: [10, 2.6, 5] }
    ]
  }),
  powerPlant,
  createBrokenVariant(powerPlant, {
    name: 'facility_powerplant_broken',
    rootOffset: [0, -1.1, 0],
    rootRotation: [0.02, 0, -0.05],
    scorchRadius: [28, 24],
    tweaks: [
      { name: 'facility_powerplant_hall', position: [0, -1.2, 0], rotation: [0.02, 0.02, 0] },
      { name: 'facility_powerplant_stack_0', position: [-1, -2, 0], rotation: [0.02, 0, -0.12] },
      { name: 'facility_powerplant_stack_1', position: [1, -3, 1], rotation: [-0.02, 0, 0.14] },
      { name: 'facility_powerplant_transformer_0', position: [-3, -1, 2], rotation: [0.12, 0.24, 0.18] },
      { name: 'facility_powerplant_transformer_1', position: [4, -1, -3], rotation: [0.06, -0.3, -0.12] }
    ],
    debris: [
      { position: [-15, 2.2, 18], rotation: [0.28, 0.4, 0.16], size: [9, 3, 7], metal: true },
      { position: [10, 2.4, 8], rotation: [0.1, -0.2, 0.24], size: [12, 4, 6] },
      { position: [0, 2.1, -12], rotation: [0.34, 0.22, 0.12], size: [7, 2.8, 7], metal: true }
    ]
  }),
  warFactory,
  createBrokenVariant(warFactory, {
    name: 'facility_war_factory_broken',
    rootOffset: [0, -1.2, 0],
    rootRotation: [0.03, 0, 0.04],
    scorchRadius: [30, 26],
    tweaks: [
      { name: 'facility_war_factory_hangar', position: [0, -1.2, -1], rotation: [0.02, 0, 0] },
      { name: 'facility_war_factory_roof', position: [0, -2, 0], rotation: [0.03, 0, -0.05] },
      { name: 'facility_war_factory_bay_door', position: [0, -5, 1.6], rotation: [0.04, 0, 0.18] },
      { name: 'facility_war_factory_crane_beam', rotation: [0, 0, 0.08] },
      { name: 'facility_war_factory_crane_trolley', position: [5, -2, 1], rotation: [0.08, 0.2, 0.26] }
    ],
    debris: [
      { position: [-12, 2.6, 15], rotation: [0.26, 0.16, 0.24], size: [12, 4, 5], metal: true },
      { position: [13, 2.2, -8], rotation: [0.18, -0.3, 0.1], size: [10, 3.4, 7] },
      { position: [0, 2.4, 22], rotation: [0.1, 0.48, 0.34], size: [14, 3, 4], metal: true }
    ]
  }),
  fieldHospital,
  createBrokenVariant(fieldHospital, {
    name: 'facility_field_hospital_broken',
    rootOffset: [0, -0.9, 0],
    rootRotation: [0.02, 0, -0.03],
    scorchRadius: [28, 24],
    tweaks: [
      { name: 'facility_field_hospital_core', position: [0, -1, -1], rotation: [0.02, 0, -0.05] },
      { name: 'facility_field_hospital_cross_h', position: [0, -2, -0.4], rotation: [0.3, 0, 0.22] },
      { name: 'facility_field_hospital_cross_v', position: [0, -2, -0.4], rotation: [0.18, 0, 0.22] },
      { name: 'facility_field_hospital_tent_0', scale: [1, 0.55, 1], rotation: [0, 0, -0.18], position: [-1, -1.8, 2] },
      { name: 'facility_field_hospital_tent_1', scale: [1, 0.5, 1], rotation: [0, 0, 0.2], position: [1, -1.8, -2] }
    ],
    debris: [
      { position: [-10, 1.8, -14], rotation: [0.14, 0.3, 0.12], size: [10, 2, 6] },
      { position: [8, 2.1, 10], rotation: [0.2, -0.24, 0.34], size: [8, 2.8, 4] },
      { position: [0, 1.8, 18], rotation: [0.24, 0.12, 0.1], size: [7, 2.2, 6], metal: true }
    ]
  }),
  techLab,
  createBrokenVariant(techLab, {
    name: 'facility_tech_lab_broken',
    rootOffset: [0, -1.2, 0],
    rootRotation: [0.02, 0, 0.05],
    scorchRadius: [26, 22],
    tweaks: [
      { name: 'facility_tech_lab_core', position: [0, -1.2, 0], rotation: [0, 0, 0.03] },
      { name: 'facility_tech_lab_tower', position: [0, -2.8, 0], rotation: [0, 0, 0.11] },
      { name: 'facility_tech_lab_sensor', position: [0, -6, 0], visible: false },
      { name: 'facility_tech_lab_dish', position: [0, -1.8, 0], rotation: [-0.8, 0.36, 0.18] }
    ],
    debris: [
      { position: [-9, 2.2, 12], rotation: [0.18, 0.4, 0.22], size: [9, 3, 5], metal: true },
      { position: [10, 2.2, -8], rotation: [0.12, -0.36, 0.18], size: [11, 3.4, 6] },
      { position: [0, 2, 20], rotation: [0.32, 0.18, 0.12], size: [8, 2.2, 8], metal: true }
    ]
  }),
  radarTower,
  createBrokenVariant(radarTower, {
    name: 'facility_radar_tower_broken',
    rootOffset: [0, -0.9, 0],
    rootRotation: [0.03, 0, -0.04],
    scorchRadius: [22, 20],
    tweaks: [
      { name: 'facility_radar_tower_core', position: [0, -1.8, 0], rotation: [0.02, 0, 0.1] },
      { name: 'facility_radar_tower_glow', visible: false },
      { name: 'facility_radar_tower_dish', position: [0, -3.4, 0], rotation: [0.44, 0.32, 0.62] }
    ],
    debris: [
      { position: [-6, 2.1, 8], rotation: [0.24, 0.22, 0.18], size: [6, 3, 4], metal: true },
      { position: [7, 2.4, -6], rotation: [0.14, -0.34, 0.2], size: [8, 3.2, 5] },
      { position: [0, 1.8, 0], rotation: [0.32, 0.1, 0.28], size: [4, 2, 9], metal: true }
    ]
  }),
  aaSite,
  createBrokenVariant(aaSite, {
    name: 'facility_aa_site_broken',
    rootOffset: [0, -1.1, 0],
    rootRotation: [0.02, 0, 0.04],
    scorchRadius: [24, 20],
    tweaks: [
      { name: 'facility_aa_site_platform', position: [0, -1.2, 0] },
      { name: 'facility_aa_site_turret', position: [0, -2, 0], rotation: [-0.14, 0.56, 0.12] },
      { name: 'facility_aa_site_barrel', position: [0, -0.6, -1], rotation: [0.42, 0, 0.04] },
      { name: 'facility_aa_site_sensor', visible: false }
    ],
    debris: [
      { position: [-7, 2, 7], rotation: [0.2, 0.26, 0.18], size: [8, 2.8, 5], metal: true },
      { position: [8, 2.2, -5], rotation: [0.16, -0.24, 0.32], size: [6, 3.2, 6] },
      { position: [0, 2.3, 12], rotation: [0.28, 0.48, 0.14], size: [10, 2.2, 4], metal: true }
    ]
  })
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
