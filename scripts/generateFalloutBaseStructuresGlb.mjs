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
const outPath = path.join(outDir, 'base_structures.glb');

const root = new THREE.Group();
root.name = 'base_structures_root';

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.84,
  metalness = 0.16,
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
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.42 ? autoMap(color) : null);
  if (texture) material.map = texture;
  return material;
};

const addMesh = ({
  parent,
  name,
  geometry,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
}) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  parent.add(mesh);
  return mesh;
};

const addPipeRun = (parent, prefix, material, startX, y, z, count, spacing, rotation = [0, 0, Math.PI / 2]) => {
  for (let index = 0; index < count; index += 1) {
    addMesh({
      parent,
      name: `${prefix}_${index}`,
      geometry: new THREE.CylinderGeometry(0.74, 0.9, 24, 10),
      material,
      position: [startX + index * spacing, y, z],
      rotation,
    });
  }
};

const addRadialBoxes = ({
  parent,
  prefix,
  count,
  radius,
  geometry,
  material,
  y = 0,
  rotationY = 0,
  inward = false,
}) => {
  for (let index = 0; index < count; index += 1) {
    const angle = rotationY + (index / count) * Math.PI * 2;
    addMesh({
      parent,
      name: `${prefix}_${index}`,
      geometry,
      material,
      position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
      rotation: [0, inward ? -angle : angle, 0],
    });
  }
};

const addTowerLegs = ({
  parent,
  prefix,
  material,
  radius = 10,
  height = 36,
  topInset = 3,
  y = 0,
}) => {
  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 4 + (index / 4) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const leanX = Math.cos(angle) * topInset;
    const leanZ = Math.sin(angle) * topInset;
    addMesh({
      parent,
      name: `${prefix}_${index}`,
      geometry: new THREE.BoxGeometry(2.1, height, 2.1),
      material,
      position: [x - leanX * 0.45, y + height * 0.5, z - leanZ * 0.45],
      rotation: [0, -angle, index % 2 === 0 ? -0.12 : 0.12],
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
  visible,
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
  emberColor = '#421212',
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
        material.emissiveIntensity = Math.max((material.emissiveIntensity || 0) * 0.24, 0.08);
      }
      material.roughness = Math.min(1, (material.roughness ?? 0.8) + 0.16);
      material.metalness = Math.max(0, (material.metalness ?? 0.2) * 0.88);
    });
  });
};

const addBrokenGround = (group, prefix, radiusX = 24, radiusZ = 20) => {
  addMesh({
    parent: group,
    name: `${prefix}_scorch_outer`,
    geometry: new THREE.CylinderGeometry(1, 1.08, 0.26, 18),
    material: makeMaterial({ color: '#141617', roughness: 1, metalness: 0.02 }),
    position: [0, 0.18, 0],
    scale: [radiusX, 1, radiusZ],
  });
  addMesh({
    parent: group,
    name: `${prefix}_scorch_inner`,
    geometry: new THREE.CylinderGeometry(1, 1.04, 0.2, 18),
    material: makeMaterial({ color: '#2b120c', roughness: 1, metalness: 0.02 }),
    position: [0, 0.3, 0],
    scale: [radiusX * 0.66, 1, radiusZ * 0.62],
  });
};

const addBrokenDebris = (group, prefix, items) => {
  const concreteMat = makeMaterial({ color: '#323a43', roughness: 0.98, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#404856', roughness: 0.8, metalness: 0.36 });
  items.forEach((item, index) => {
    addMesh({
      parent: group,
      name: `${prefix}_debris_${index}`,
      geometry: item.geometry || new THREE.BoxGeometry(item.size?.[0] || 8, item.size?.[1] || 3, item.size?.[2] || 5),
      material: item.metal ? steelMat : concreteMat,
      position: item.position || [0, 2, 0],
      rotation: item.rotation || [0, 0, 0],
      scale: item.scale || [1, 1, 1],
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
  debris = [],
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

  const concreteMat = makeMaterial({ color: '#c9d0d7', roughness: 0.9, metalness: 0.08 });
  const darkConcreteMat = makeMaterial({ color: '#95a1ae', roughness: 0.92, metalness: 0.05 });
  const steelMat = makeMaterial({ color: '#dfe6ed', roughness: 0.28, metalness: 0.8 });
  const darkSteelMat = makeMaterial({ color: '#738398', roughness: 0.34, metalness: 0.74 });
  const earthMat = makeMaterial({ color: '#8fa36a', roughness: 0.96, metalness: 0.02 });
  const amberLightMat = makeMaterial({ color: '#ffd29a', emissive: '#f59e0b', emissiveIntensity: 2, roughness: 0.22, metalness: 0.28 });

  const shell = new THREE.Group();
  shell.name = 'bunker_shell';
  group.add(shell);

  addMesh({
    parent: shell,
    name: 'bunker_foundation',
    geometry: new THREE.BoxGeometry(64, 4.4, 82),
    material: darkConcreteMat,
    position: [0, 2.2, 6],
  });
  addMesh({
    parent: shell,
    name: 'bunker_mound',
    geometry: new THREE.CylinderGeometry(24, 36, 18, 18),
    material: earthMat,
    position: [0, 8, -10],
    scale: [1.32, 0.72, 2.04],
  });
  addMesh({
    parent: shell,
    name: 'bunker_hull',
    geometry: new THREE.CylinderGeometry(18, 23, 56, 20, 1, false, 0, Math.PI),
    material: concreteMat,
    position: [0, 18, -6],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.16, 1, 1.22],
  });
  addMesh({
    parent: shell,
    name: 'bunker_rear_buttress',
    geometry: new THREE.BoxGeometry(42, 16, 18),
    material: concreteMat,
    position: [0, 13, -28],
  });
  addMesh({
    parent: shell,
    name: 'bunker_front_block',
    geometry: new THREE.BoxGeometry(38, 20, 22),
    material: concreteMat,
    position: [0, 12, 24],
  });
  addMesh({
    parent: shell,
    name: 'bunker_roof_beam',
    geometry: new THREE.BoxGeometry(34, 4, 15),
    material: darkConcreteMat,
    position: [0, 24, 15],
  });
  addMesh({
    parent: shell,
    name: 'bunker_apron',
    geometry: new THREE.BoxGeometry(34, 1.2, 36),
    material: makeMaterial({ color: '#8f98a4', roughness: 0.9, metalness: 0.08 }),
    position: [0, 0.7, 32],
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: shell,
      name: `bunker_retaining_wall_${index}`,
      geometry: new THREE.BoxGeometry(6, 17, 30),
      material: darkConcreteMat,
      position: [side * 21, 9, 27],
      rotation: [0, side * -0.18, 0],
    });
    addMesh({
      parent: shell,
      name: `bunker_vent_stack_${index}`,
      geometry: new THREE.CylinderGeometry(2.2, 2.8, 18, 12),
      material: steelMat,
      position: [side * 14, 30, -12],
    });
    addMesh({
      parent: shell,
      name: `bunker_vent_cap_${index}`,
      geometry: new THREE.CylinderGeometry(4, 3.4, 3.2, 12),
      material: darkSteelMat,
      position: [side * 14, 40, -12],
    });
    addMesh({
      parent: shell,
      name: `bunker_flyout_${index}`,
      geometry: new THREE.BoxGeometry(7, 4, 13),
      material: darkSteelMat,
      position: [side * 15.5, 20, 8],
      rotation: [0.12, side * 0.28, 0],
    });
  });

  for (let index = 0; index < 4; index += 1) {
    addMesh({
      parent: shell,
      name: `bunker_rib_${index}`,
      geometry: new THREE.TorusGeometry(15.8 + index * 0.35, 0.88, 10, 28, Math.PI),
      material: darkSteelMat,
      position: [0, 18 + index * 0.18, 4 - index * 6.4],
      rotation: [0, 0, Math.PI],
      scale: [1.06, 1, 1.1],
    });
  }

  const entry = new THREE.Group();
  entry.name = 'bunker_entry';
  entry.position.set(0, 11.8, 35.5);
  group.add(entry);

  addMesh({
    parent: entry,
    name: 'bunker_entry_frame',
    geometry: new THREE.CylinderGeometry(13, 13, 7.2, 32),
    material: darkSteelMat,
    rotation: [Math.PI / 2, 0, 0],
  });
  addMesh({
    parent: entry,
    name: 'bunker_entry_ring',
    geometry: new THREE.TorusGeometry(12.3, 1.3, 12, 32),
    material: steelMat,
    rotation: [Math.PI / 2, 0, 0],
  });
  addMesh({
    parent: entry,
    name: 'bunker_entry_shroud',
    geometry: new THREE.CylinderGeometry(11.5, 12.5, 8.6, 28, 1, true),
    material: makeMaterial({ color: '#64748b', roughness: 0.42, metalness: 0.62, side: THREE.DoubleSide }),
    rotation: [Math.PI / 2, 0, 0],
    position: [0, 0, -1.4],
  });

  const door = new THREE.Group();
  door.name = 'bunker_door';
  door.position.set(0, 0, 2.7);
  entry.add(door);

  addMesh({
    parent: door,
    name: 'bunker_door_disc',
    geometry: new THREE.CylinderGeometry(10.7, 10.7, 3, 32),
    material: steelMat,
    rotation: [Math.PI / 2, 0, 0],
  });
  addMesh({
    parent: door,
    name: 'bunker_door_hub',
    geometry: new THREE.CylinderGeometry(2.8, 2.8, 2.4, 20),
    material: darkSteelMat,
    position: [0, 0, 1.3],
    rotation: [Math.PI / 2, 0, 0],
  });
  for (let index = 0; index < 6; index += 1) {
    addMesh({
      parent: door,
      name: `bunker_door_spoke_${index}`,
      geometry: new THREE.BoxGeometry(14.4, 1.35, 1.4),
      material: darkSteelMat,
      position: [0, 0, 1.55],
      rotation: [0, 0, (index * Math.PI) / 3],
    });
  }
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: door,
      name: `bunker_door_clamp_${index}`,
      geometry: new THREE.BoxGeometry(2.2, 5.6, 1.8),
      material: darkSteelMat,
      position: [side * 7.9, 0, 1.4],
    });
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: entry,
      name: `bunker_guardrail_post_${index}_a`,
      geometry: new THREE.BoxGeometry(1.2, 8, 1.2),
      material: steelMat,
      position: [side * 12, -5, 6],
    });
    addMesh({
      parent: entry,
      name: `bunker_guardrail_post_${index}_b`,
      geometry: new THREE.BoxGeometry(1.2, 8, 1.2),
      material: steelMat,
      position: [side * 12, -5, 16],
    });
    addMesh({
      parent: entry,
      name: `bunker_guardrail_bar_${index}`,
      geometry: new THREE.BoxGeometry(1.1, 1.1, 12),
      material: steelMat,
      position: [side * 12, -2.2, 11],
    });
  });

  addMesh({
    parent: group,
    name: 'bunker_light_0',
    geometry: new THREE.BoxGeometry(2.8, 2.4, 2.4),
    material: amberLightMat,
    position: [-8.8, 22.2, 28],
  });
  addMesh({
    parent: group,
    name: 'bunker_light_1',
    geometry: new THREE.BoxGeometry(2.8, 2.4, 2.4),
    material: amberLightMat,
    position: [8.8, 22.2, 28],
  });

  return group;
};

const buildPowerPlant = () => {
  const group = new THREE.Group();
  group.name = 'facility_powerplant';

  const concreteMat = makeMaterial({ color: '#9ba7b6', roughness: 0.9, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#68778a', roughness: 0.56, metalness: 0.48 });
  const darkSteelMat = makeMaterial({ color: '#4b5b70', roughness: 0.48, metalness: 0.62 });
  const glowMat = makeMaterial({ color: '#fcd34d', emissive: '#f59e0b', emissiveIntensity: 1.7, roughness: 0.22, metalness: 0.24 });

  addMesh({
    parent: group,
    name: 'facility_powerplant_pad',
    geometry: new THREE.BoxGeometry(72, 3.2, 76),
    material: concreteMat,
    position: [0, 1.6, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_hall',
    geometry: new THREE.BoxGeometry(36, 24, 34),
    material: steelMat,
    position: [0, 15, 8],
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_roof',
    geometry: new THREE.BoxGeometry(40, 4, 38),
    material: darkSteelMat,
    position: [0, 29, 8],
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_reactor_spine',
    geometry: new THREE.CylinderGeometry(8, 11, 26, 16),
    material: darkSteelMat,
    position: [0, 18, -12],
    rotation: [0, 0, Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'facility_powerplant_reactor_core',
    geometry: new THREE.TorusGeometry(8.6, 1.4, 14, 32),
    material: glowMat,
    position: [0, 18, -12],
    rotation: [Math.PI / 2, 0, 0],
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_powerplant_cooler_${index}`,
      geometry: new THREE.CylinderGeometry(7, 10.5, 30, 16),
      material: concreteMat,
      position: [side * 18, 16, -22],
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_stack_${index}`,
      geometry: new THREE.CylinderGeometry(2.8, 3.4, 34, 12),
      material: darkSteelMat,
      position: [side * 14, 35, 20],
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_stack_cap_${index}`,
      geometry: new THREE.CylinderGeometry(4, 3.4, 3.4, 12),
      material: steelMat,
      position: [side * 14, 53.5, 20],
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_transformer_${index}`,
      geometry: new THREE.BoxGeometry(12, 9, 10),
      material: darkSteelMat,
      position: [side * 22, 7.5, 24],
    });
    addMesh({
      parent: group,
      name: `facility_powerplant_transformer_glow_${index}`,
      geometry: new THREE.BoxGeometry(8.2, 1.2, 7.2),
      material: glowMat,
      position: [side * 22, 12.3, 24],
    });
  });

  addPipeRun(group, 'facility_powerplant_pipe', steelMat, -24, 20, -2, 5, 12);
  addPipeRun(group, 'facility_powerplant_pipe_upper', steelMat, -18, 24, 10, 4, 12);

  return group;
};

const buildWarFactory = () => {
  const group = new THREE.Group();
  group.name = 'facility_war_factory';

  const concreteMat = makeMaterial({ color: '#8f99a9', roughness: 0.92, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#5f6c7f', roughness: 0.58, metalness: 0.52 });
  const darkSteelMat = makeMaterial({ color: '#3f4d61', roughness: 0.48, metalness: 0.64 });
  const hazardMat = makeMaterial({ color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.6, roughness: 0.46, metalness: 0.22 });

  addMesh({
    parent: group,
    name: 'facility_war_factory_pad',
    geometry: new THREE.BoxGeometry(78, 3.2, 64),
    material: concreteMat,
    position: [0, 1.6, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_hangar',
    geometry: new THREE.BoxGeometry(56, 24, 34),
    material: steelMat,
    position: [0, 15, -2],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_roof',
    geometry: new THREE.BoxGeometry(60, 4, 38),
    material: darkSteelMat,
    position: [0, 29, -2],
  });

  for (let index = 0; index < 3; index += 1) {
    addMesh({
      parent: group,
      name: `facility_war_factory_sawtooth_${index}`,
      geometry: new THREE.BoxGeometry(16, 6, 8),
      material: darkSteelMat,
      position: [-18 + index * 18, 31.5, -2],
      rotation: [0.3, 0, 0],
    });
  }

  addMesh({
    parent: group,
    name: 'facility_war_factory_bay_frame',
    geometry: new THREE.BoxGeometry(32, 18, 3.4),
    material: darkSteelMat,
    position: [0, 12, 18.8],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_bay_door',
    geometry: new THREE.BoxGeometry(24, 14.5, 2.2),
    material: makeMaterial({ color: '#b8c2cf', roughness: 0.38, metalness: 0.74 }),
    position: [0, 11.4, 20.1],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_annex',
    geometry: new THREE.BoxGeometry(20, 14, 20),
    material: steelMat,
    position: [-24, 10, -18],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_crane_beam',
    geometry: new THREE.BoxGeometry(42, 2.4, 4.4),
    material: darkSteelMat,
    position: [0, 25, -10],
  });
  addMesh({
    parent: group,
    name: 'facility_war_factory_crane_trolley',
    geometry: new THREE.BoxGeometry(7, 4.5, 4.5),
    material: hazardMat,
    position: [-6, 22, -10],
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_war_factory_exhaust_${index}`,
      geometry: new THREE.BoxGeometry(6, 20, 6),
      material: darkSteelMat,
      position: [side * 20, 36, -18],
    });
    addMesh({
      parent: group,
      name: `facility_war_factory_track_${index}`,
      geometry: new THREE.BoxGeometry(10, 2.8, 28),
      material: darkSteelMat,
      position: [side * 22, 3.4, -8],
    });
  });

  return group;
};

const buildFieldHospital = () => {
  const group = new THREE.Group();
  group.name = 'facility_field_hospital';

  const padMat = makeMaterial({ color: '#b2bac4', roughness: 0.94, metalness: 0.04 });
  const wallMat = makeMaterial({ color: '#e7edf4', roughness: 0.8, metalness: 0.08 });
  const roofMat = makeMaterial({ color: '#94a3b8', roughness: 0.68, metalness: 0.16 });
  const tentMat = makeMaterial({ color: '#f2f5f9', roughness: 0.96, metalness: 0.02 });
  const redMat = makeMaterial({ color: '#dc2626', roughness: 0.42, metalness: 0.04 });

  addMesh({
    parent: group,
    name: 'facility_field_hospital_pad',
    geometry: new THREE.BoxGeometry(70, 2.6, 64),
    material: padMat,
    position: [0, 1.3, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_core',
    geometry: new THREE.BoxGeometry(32, 20, 28),
    material: wallMat,
    position: [0, 12, -4],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_roof',
    geometry: new THREE.BoxGeometry(36, 3.2, 32),
    material: roofMat,
    position: [0, 23.6, -4],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_cross_h',
    geometry: new THREE.BoxGeometry(8, 6, 2.6),
    material: redMat,
    position: [0, 18, 11],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_cross_v',
    geometry: new THREE.BoxGeometry(2.6, 11, 2.6),
    material: redMat,
    position: [0, 18, 11.1],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_triage',
    geometry: new THREE.BoxGeometry(24, 10, 14),
    material: wallMat,
    position: [0, 8, 18],
  });
  addMesh({
    parent: group,
    name: 'facility_field_hospital_canopy',
    geometry: new THREE.BoxGeometry(28, 1.6, 16),
    material: roofMat,
    position: [0, 14, 18],
  });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `facility_field_hospital_tent_${index}`,
      geometry: new THREE.BoxGeometry(16, 8, 20),
      material: tentMat,
      position: [side * 20, 6, -12],
      rotation: [0, side * 0.08, 0],
    });
    addMesh({
      parent: group,
      name: `facility_field_hospital_tent_roof_${index}`,
      geometry: new THREE.BoxGeometry(18, 2.2, 14),
      material: roofMat,
      position: [side * 20, 11, -12],
      rotation: [0.24, 0, 0],
    });
  });

  return group;
};

const buildTechLab = () => {
  const group = new THREE.Group();
  group.name = 'facility_tech_lab';

  const concreteMat = makeMaterial({ color: '#8f9bad', roughness: 0.9, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#60728a', roughness: 0.5, metalness: 0.56 });
  const darkSteelMat = makeMaterial({ color: '#43546a', roughness: 0.46, metalness: 0.66 });
  const glowMat = makeMaterial({ color: '#7dd3fc', emissive: '#22d3ee', emissiveIntensity: 1.8, roughness: 0.18, metalness: 0.52 });

  addMesh({
    parent: group,
    name: 'facility_tech_lab_pad',
    geometry: new THREE.CylinderGeometry(28, 31, 3, 18),
    material: concreteMat,
    position: [0, 1.5, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_core',
    geometry: new THREE.CylinderGeometry(14, 17, 26, 8),
    material: steelMat,
    position: [0, 15, 0],
    rotation: [0, Math.PI / 8, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_annex',
    geometry: new THREE.BoxGeometry(30, 14, 18),
    material: darkSteelMat,
    position: [0, 9, 19],
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_tower',
    geometry: new THREE.CylinderGeometry(5.2, 6.4, 28, 12),
    material: steelMat,
    position: [0, 35, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_tech_lab_sensor',
    geometry: new THREE.OctahedronGeometry(3.8, 0),
    material: glowMat,
    position: [0, 50, 0],
  });
  addRadialBoxes({
    parent: group,
    prefix: 'facility_tech_lab_fin',
    count: 6,
    radius: 14,
    geometry: new THREE.BoxGeometry(6, 10, 1.2),
    material: darkSteelMat,
    y: 12,
    inward: true,
  });

  const dish = new THREE.Group();
  dish.name = 'facility_tech_lab_dish';
  dish.position.set(0, 41, 0);
  group.add(dish);

  addMesh({
    parent: dish,
    name: 'facility_tech_lab_dish_bowl',
    geometry: new THREE.CylinderGeometry(0.8, 9.6, 4.4, 24, 1, true),
    material: makeMaterial({ color: '#dbeafe', roughness: 0.22, metalness: 0.86, side: THREE.DoubleSide }),
    rotation: [-Math.PI / 2.9, 0, 0],
  });
  addMesh({
    parent: dish,
    name: 'facility_tech_lab_dish_emitter',
    geometry: new THREE.SphereGeometry(1.9, 12, 12),
    material: glowMat,
    position: [0, 0.4, -3.6],
  });
  addMesh({
    parent: dish,
    name: 'facility_tech_lab_dish_ring',
    geometry: new THREE.TorusGeometry(10.5, 0.36, 8, 28),
    material: glowMat,
    rotation: [Math.PI / 2, 0, 0],
  });

  return group;
};

const buildRadarTower = () => {
  const group = new THREE.Group();
  group.name = 'facility_radar_tower';

  const concreteMat = makeMaterial({ color: '#97a3b0', roughness: 0.92, metalness: 0.06 });
  const steelMat = makeMaterial({ color: '#c1cad5', roughness: 0.38, metalness: 0.72 });
  const darkSteelMat = makeMaterial({ color: '#55657a', roughness: 0.48, metalness: 0.64 });
  const glowMat = makeMaterial({ color: '#67e8f9', emissive: '#22d3ee', emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.48 });

  addMesh({
    parent: group,
    name: 'facility_radar_tower_pad',
    geometry: new THREE.CylinderGeometry(20, 24, 4, 16),
    material: concreteMat,
    position: [0, 2, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_radar_tower_core',
    geometry: new THREE.CylinderGeometry(4.2, 6, 40, 12),
    material: darkSteelMat,
    position: [0, 22, 0],
  });
  addTowerLegs({
    parent: group,
    prefix: 'facility_radar_tower_brace',
    material: steelMat,
    radius: 10,
    height: 32,
    topInset: 3,
    y: 4,
  });
  addMesh({
    parent: group,
    name: 'facility_radar_tower_glow',
    geometry: new THREE.SphereGeometry(4.4, 14, 14),
    material: glowMat,
    position: [0, 50, 0],
  });

  const dish = new THREE.Group();
  dish.name = 'facility_radar_tower_dish';
  dish.position.set(0, 40, 0);
  group.add(dish);

  addMesh({
    parent: dish,
    name: 'facility_radar_tower_frame',
    geometry: new THREE.TorusGeometry(13, 1.1, 8, 30),
    material: steelMat,
  });
  addMesh({
    parent: dish,
    name: 'facility_radar_tower_bar_h',
    geometry: new THREE.BoxGeometry(24, 1.5, 1.5),
    material: steelMat,
  });
  addMesh({
    parent: dish,
    name: 'facility_radar_tower_bar_v',
    geometry: new THREE.BoxGeometry(1.5, 24, 1.5),
    material: steelMat,
  });
  addMesh({
    parent: dish,
    name: 'facility_radar_tower_secondary_ring',
    geometry: new THREE.TorusGeometry(7.5, 0.54, 6, 24),
    material: glowMat,
    position: [0, 5, 0],
    rotation: [Math.PI / 2, 0, 0],
  });

  return group;
};

const buildAASite = () => {
  const group = new THREE.Group();
  group.name = 'facility_aa_site';

  const concreteMat = makeMaterial({ color: '#8994a3', roughness: 0.94, metalness: 0.08 });
  const steelMat = makeMaterial({ color: '#617389', roughness: 0.44, metalness: 0.68 });
  const darkSteelMat = makeMaterial({ color: '#43556c', roughness: 0.5, metalness: 0.66 });
  const screenMat = makeMaterial({ color: '#7dd3fc', emissive: '#22d3ee', emissiveIntensity: 1.2, roughness: 0.16, metalness: 0.48 });

  addMesh({
    parent: group,
    name: 'facility_aa_site_ring',
    geometry: new THREE.CylinderGeometry(24, 27, 4, 18),
    material: concreteMat,
    position: [0, 2, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_aa_site_bunker',
    geometry: new THREE.CylinderGeometry(13, 17, 16, 18),
    material: darkSteelMat,
    position: [0, 11, 0],
  });
  addMesh({
    parent: group,
    name: 'facility_aa_site_platform',
    geometry: new THREE.CylinderGeometry(12, 14, 6, 16),
    material: steelMat,
    position: [0, 20, 0],
  });
  addRadialBoxes({
    parent: group,
    prefix: 'facility_aa_site_blade',
    count: 6,
    radius: 15.5,
    geometry: new THREE.BoxGeometry(4, 3.2, 6),
    material: darkSteelMat,
    y: 6.5,
    inward: true,
  });

  const turret = new THREE.Group();
  turret.name = 'facility_aa_site_turret';
  turret.position.set(0, 23.2, 0);
  group.add(turret);

  addMesh({
    parent: turret,
    name: 'facility_aa_site_turret_body',
    geometry: new THREE.BoxGeometry(18, 6, 13),
    material: darkSteelMat,
  });
  addMesh({
    parent: turret,
    name: 'facility_aa_site_sensor',
    geometry: new THREE.BoxGeometry(4.6, 2.6, 3.2),
    material: screenMat,
    position: [0, 2, -3.8],
  });

  const barrel = new THREE.Group();
  barrel.name = 'facility_aa_site_barrel';
  barrel.position.set(0, 1, 6.4);
  turret.add(barrel);

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: barrel,
      name: `facility_aa_site_gun_${index}`,
      geometry: new THREE.CylinderGeometry(0.72, 0.86, 14, 8),
      material: steelMat,
      position: [side * 2.8, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
    });
  });
  addMesh({
    parent: barrel,
    name: 'facility_aa_site_gun_mount',
    geometry: new THREE.BoxGeometry(7, 1.6, 5.4),
    material: darkSteelMat,
    position: [0, 0, -2.4],
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
    rootOffset: [0, -1.8, 0],
    rootRotation: [0.05, 0, -0.08],
    scorchRadius: [28, 20],
    tweaks: [
      { name: 'bunker_hull', position: [0, -2.4, -1.8], rotation: [-0.08, 0, 0] },
      { name: 'bunker_front_block', position: [0, -2.2, 1.6], rotation: [0.04, 0.02, 0] },
      { name: 'bunker_entry', position: [0, 0, -2.6], rotation: [0.02, 0, 0] },
      { name: 'bunker_door', position: [-3.2, 0, 2.8], rotation: [0, -0.6, 0] },
      { name: 'bunker_light_0', visible: false },
      { name: 'bunker_light_1', visible: false }
    ],
    debris: [
      { position: [-9, 2.4, 24], rotation: [0.24, 0.32, 0.18], size: [8, 3, 6] },
      { position: [8, 2.8, 18], rotation: [0.14, -0.42, 0.28], size: [7, 4, 5], metal: true },
      { position: [0, 2, 31], rotation: [0.12, 0.5, 0.36], size: [11, 2.6, 5] }
    ]
  }),
  powerPlant,
  createBrokenVariant(powerPlant, {
    name: 'facility_powerplant_broken',
    rootOffset: [0, -1.1, 0],
    rootRotation: [0.02, 0, -0.05],
    scorchRadius: [30, 26],
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
    scorchRadius: [32, 28],
    tweaks: [
      { name: 'facility_war_factory_hangar', position: [0, -1.2, -1], rotation: [0.02, 0, 0] },
      { name: 'facility_war_factory_roof', position: [0, -2, 0], rotation: [0.03, 0, -0.05] },
      { name: 'facility_war_factory_bay_door', position: [0, -5, 1.6], rotation: [0.04, 0, 0.18] },
      { name: 'facility_war_factory_crane_beam', rotation: [0, 0, 0.08] },
      { name: 'facility_war_factory_crane_trolley', position: [6, -2, 1], rotation: [0.08, 0.2, 0.26] }
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
    rootOffset: [0, -1, 0],
    rootRotation: [0.02, 0, -0.03],
    scorchRadius: [30, 26],
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
    scorchRadius: [28, 24],
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
    scorchRadius: [24, 22],
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
    scorchRadius: [26, 22],
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
