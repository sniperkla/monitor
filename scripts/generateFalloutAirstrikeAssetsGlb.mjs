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
const outPath = path.join(outDir, 'airstrike_assets.glb');

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.72,
  metalness = 0.16,
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

const buildBomberPlane = () => {
  const group = new THREE.Group();
  group.name = 'bomber_plane';

  const bodyMat = makeMaterial({ color: '#8b949e', roughness: 0.42, metalness: 0.56 });
  const trimMat = makeMaterial({ color: '#707b86', roughness: 0.44, metalness: 0.42 });
  const darkMat = makeMaterial({ color: '#1f2937', roughness: 0.28, metalness: 0.58 });
  const glassMat = makeMaterial({ color: '#bcd3df', roughness: 0.08, metalness: 0.82, transparent: true, opacity: 0.5 });
  const glowMat = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 1.6, transparent: true, opacity: 0.38 });

  addMesh({
    parent: group,
    name: 'bomber_fuselage',
    geometry: new THREE.CylinderGeometry(11.5, 14, 268, 22),
    material: bodyMat,
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_shell',
    geometry: new THREE.SphereGeometry(28, 20, 16),
    material: bodyMat,
    position: [92, 4, 0],
    scale: [1.1, 0.92, 1.02]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_tip',
    geometry: new THREE.ConeGeometry(11.2, 34, 16),
    material: trimMat,
    position: [124, 2, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_greenhouse',
    geometry: new THREE.SphereGeometry(11, 18, 14),
    material: glassMat,
    position: [82, 13, 0],
    scale: [1.75, 0.82, 0.92]
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_glass',
    geometry: new THREE.SphereGeometry(8.8, 16, 12),
    material: glassMat,
    position: [103, 5, 0],
    scale: [1.55, 0.9, 0.95]
  });
  addMesh({
    parent: group,
    name: 'bomber_spine',
    geometry: new THREE.BoxGeometry(142, 5, 18),
    material: trimMat,
    position: [-6, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_belly_bay',
    geometry: new THREE.BoxGeometry(54, 4.6, 24),
    material: trimMat,
    position: [-10, -10.4, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_dorsal_turret_base',
    geometry: new THREE.SphereGeometry(5.5, 14, 12),
    material: bodyMat,
    position: [16, 23, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_dorsal_turret',
    geometry: new THREE.CylinderGeometry(0.55, 0.55, 11, 8),
    material: darkMat,
    position: [22, 22.3, 6.1],
    rotation: [0, 0.22, 0.08]
  });

  addMesh({
    parent: group,
    name: 'bomber_tail_boom',
    geometry: new THREE.CylinderGeometry(6.5, 8.5, 58, 16),
    material: trimMat,
    position: [-95, 9, 0],
    rotation: [0, 0, Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'bomber_vertical_tail',
    geometry: new THREE.BoxGeometry(52, 5, 92),
    material: trimMat,
    position: [-110, 14, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_rudder',
    geometry: new THREE.BoxGeometry(18, 58, 8),
    material: trimMat,
    position: [-108, 52, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_cap',
    geometry: new THREE.SphereGeometry(12.5, 14, 10),
    material: bodyMat,
    position: [-122, 31, 0],
    scale: [0.95, 1.24, 0.56]
  });

  addMesh({
    parent: group,
    name: 'bomber_main_wing',
    geometry: new THREE.BoxGeometry(138, 4.6, 354),
    material: bodyMat,
    position: [-4, 4.6, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'bomber_outer_wing_left' : 'bomber_outer_wing_right',
      geometry: new THREE.BoxGeometry(130, 3.6, 122),
      material: trimMat,
      position: [-10, 4.2, side * 166],
      rotation: [0, side * 0.04, side * -0.03]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'bomber_tailplane_left' : 'bomber_tailplane_right',
      geometry: new THREE.BoxGeometry(56, 3.6, 74),
      material: trimMat,
      position: [-108, 31, side * 40]
    });
  });

  const enginePositions = [
    [12, -8, -134],
    [12, -8, -60],
    [12, -8, 60],
    [12, -8, 134]
  ];
  enginePositions.forEach((pos, index) => {
    addMesh({
      parent: group,
      name: `bomber_engine_${index}`,
      geometry: new THREE.CylinderGeometry(14.4, 12.8, 30, 18),
      material: trimMat,
      position: pos,
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: group,
      name: `bomber_engine_cowl_${index}`,
      geometry: new THREE.TorusGeometry(11.8, 1.8, 8, 20),
      material: darkMat,
      position: [pos[0] + 13, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    addMesh({
      parent: group,
      name: `bomber_exhaust_glow_${index}`,
      geometry: new THREE.CylinderGeometry(4.9, 2.7, 9, 12),
      material: glowMat,
      position: [pos[0] - 20.5, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    const propGroup = new THREE.Group();
    propGroup.name = `bomber_prop_${index}`;
    propGroup.position.set(pos[0] - 18.5, pos[1], pos[2]);
    for (let blade = 0; blade < 4; blade++) {
      addMesh({
        parent: propGroup,
        name: `bomber_prop_blade_${index}_${blade}`,
        geometry: new THREE.BoxGeometry(1.1, 31, 2.6),
        material: darkMat,
        rotation: [Math.PI / 2, 0, blade * (Math.PI / 2)]
      });
    }
    addMesh({
      parent: propGroup,
      name: `bomber_prop_hub_${index}`,
      geometry: new THREE.SphereGeometry(2.3, 10, 10),
      material: darkMat
    });
    group.add(propGroup);
  });

  addMesh({
    parent: group,
    name: 'bomber_mark_left',
    geometry: new THREE.CircleGeometry(12, 24),
    material: makeMaterial({ color: '#f3f4f6', transparent: true, opacity: 0.22 }),
    position: [8, 5.1, -132],
    rotation: [-Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'bomber_mark_right',
    geometry: new THREE.CircleGeometry(12, 24),
    material: makeMaterial({ color: '#f3f4f6', transparent: true, opacity: 0.22 }),
    position: [8, 5.1, 132],
    rotation: [-Math.PI / 2, 0, 0]
  });

  return group;
};

const buildParachuteNuke = () => {
  const group = new THREE.Group();
  group.name = 'nuke_bomb';

  const bombMat = makeMaterial({ color: '#4b5563', roughness: 0.28, metalness: 0.72 });
  const trimMat = makeMaterial({ color: '#6b7280', roughness: 0.32, metalness: 0.66 });
  const darkMat = makeMaterial({ color: '#111827', roughness: 0.24, metalness: 0.7 });
  const stripeMat = makeMaterial({ color: '#facc15', roughness: 0.24, metalness: 0.08, emissive: '#f59e0b', emissiveIntensity: 0.22 });
  const canopyMat = makeMaterial({ color: '#c1121f', roughness: 0.82, metalness: 0.06, side: THREE.DoubleSide });
  const canopyRingMat = makeMaterial({ color: '#fecaca', roughness: 0.7, metalness: 0.16 });
  const fabricGlowMat = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 0.65, transparent: true, opacity: 0.18 });
  const cordMat = new THREE.MeshBasicMaterial({ color: '#f5f5f4' });

  addMesh({
    parent: group,
    name: 'nuke_body',
    geometry: new THREE.SphereGeometry(6.8, 20, 18),
    material: bombMat,
    position: [0, 0, 0],
    scale: [1, 1.08, 1]
  });
  addMesh({
    parent: group,
    name: 'nuke_mid',
    geometry: new THREE.CylinderGeometry(5.6, 6.9, 20, 18),
    material: trimMat,
    position: [0, -10.5, 0]
  });
  addMesh({
    parent: group,
    name: 'nuke_tail',
    geometry: new THREE.ConeGeometry(5.2, 13, 14),
    material: darkMat,
    position: [0, -24, 0]
  });
  addMesh({
    parent: group,
    name: 'nuke_band',
    geometry: new THREE.BoxGeometry(8.2, 12.2, 0.28),
    material: stripeMat,
    position: [0, -10.5, 5.7],
    rotation: [Math.PI / 2, 0, 0]
  });
  [-4.5, 4.5].forEach((x, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_${index}`,
      geometry: new THREE.BoxGeometry(1.45, 8.5, 0.42),
      material: darkMat,
      position: [x, -12.6, 0],
      rotation: [0, 0, Math.PI / 4]
    });
  });
  [-4.5, 4.5].forEach((z, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_cross_${index}`,
      geometry: new THREE.BoxGeometry(0.42, 8.5, 1.45),
      material: darkMat,
      position: [0, -12.6, z],
      rotation: [Math.PI / 4, 0, 0]
    });
  });

  const chuteRoot = new THREE.Group();
  chuteRoot.name = 'nuke_parachute';
  chuteRoot.position.set(0, 34, 0);
  group.add(chuteRoot);

  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy',
    geometry: new THREE.SphereGeometry(24, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    material: canopyMat
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_ring',
    geometry: new THREE.TorusGeometry(23.2, 1.2, 10, 28),
    material: canopyRingMat,
    position: [0, 0.6, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_vent',
    geometry: new THREE.SphereGeometry(7, 12, 8),
    material: fabricGlowMat,
    position: [0, 8, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_harness',
    geometry: new THREE.CylinderGeometry(1.2, 1.6, 6, 8),
    material: trimMat,
    position: [0, -8, 0]
  });

  const cordsRoot = new THREE.Group();
  cordsRoot.name = 'nuke_cords_root';
  group.add(cordsRoot);

  [
    [-13, 31, -13],
    [13, 31, -13],
    [-13, 31, 13],
    [13, 31, 13],
    [0, 31, -16],
    [0, 31, 16]
  ].forEach(([x, y, z], index) => {
    addMesh({
      parent: cordsRoot,
      name: `nuke_cord_${index}`,
      geometry: new THREE.CylinderGeometry(0.16, 0.16, 30, 6),
      material: cordMat,
      position: [x * 0.45, y * 0.45, z * 0.45],
      rotation: [0.6, 0, x < 0 ? -0.4 : 0.4]
    });
  });

  addMesh({
    parent: group,
    name: 'nuke_status_glow',
    geometry: new THREE.SphereGeometry(2.4, 10, 10),
    material: makeMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 2.2, transparent: true, opacity: 0.28 }),
    position: [0, -2.6, 0]
  });

  return group;
};

const buildStrikeJet = () => {
  const group = new THREE.Group();
  group.name = 'strike_jet';

  const bodyMat = makeMaterial({ color: '#7b8794', roughness: 0.34, metalness: 0.68 });
  const trimMat = makeMaterial({ color: '#4b5563', roughness: 0.4, metalness: 0.54 });
  const darkMat = makeMaterial({ color: '#111827', roughness: 0.28, metalness: 0.64 });
  const glassMat = makeMaterial({ color: '#8eb7d0', roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.52 });
  const glowMat = makeMaterial({ color: '#38bdf8', emissive: '#67e8f9', emissiveIntensity: 1.8, transparent: true, opacity: 0.42 });

  addMesh({
    parent: group,
    name: 'jet_fuselage',
    geometry: new THREE.CylinderGeometry(4.6, 7.8, 126, 18),
    material: bodyMat,
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'jet_nose',
    geometry: new THREE.ConeGeometry(5.2, 30, 16),
    material: trimMat,
    position: [74, 0.5, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'jet_canopy',
    geometry: new THREE.SphereGeometry(6.8, 18, 14),
    material: glassMat,
    position: [28, 8.4, 0],
    scale: [1.85, 0.7, 0.92]
  });
  addMesh({
    parent: group,
    name: 'jet_spine',
    geometry: new THREE.BoxGeometry(42, 5, 10),
    material: trimMat,
    position: [-2, 7.4, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_main_wing',
    geometry: new THREE.BoxGeometry(48, 2.4, 120),
    material: bodyMat,
    position: [-6, 0.4, 0],
    rotation: [0, 0, -0.09]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_wingtip_left' : 'jet_wingtip_right',
      geometry: new THREE.BoxGeometry(40, 1.8, 42),
      material: trimMat,
      position: [-26, 0.2, side * 58],
      rotation: [0, side * 0.08, side * -0.22]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_tailplane_left' : 'jet_tailplane_right',
      geometry: new THREE.BoxGeometry(20, 1.7, 34),
      material: trimMat,
      position: [-46, 6, side * 22],
      rotation: [0, side * 0.06, side * -0.06]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_stabilizer_left' : 'jet_stabilizer_right',
      geometry: new THREE.BoxGeometry(14, 18, 2.2),
      material: trimMat,
      position: [-50, 16, side * 7],
      rotation: [0.12, 0, side * 0.24]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_intake_left' : 'jet_intake_right',
      geometry: new THREE.CylinderGeometry(3.4, 4.4, 16, 12),
      material: darkMat,
      position: [4, -1.6, side * 13.5],
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_afterburner_left' : 'jet_afterburner_right',
      geometry: new THREE.CylinderGeometry(2.6, 1.4, 12, 12),
      material: glowMat,
      position: [-66, -1.1, side * 4.2],
      rotation: [0, 0, -Math.PI / 2]
    });
  });
  addMesh({
    parent: group,
    name: 'jet_engine_block',
    geometry: new THREE.BoxGeometry(22, 7.5, 16),
    material: darkMat,
    position: [-54, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_centerline_tank',
    geometry: new THREE.CylinderGeometry(2.8, 3.4, 22, 10),
    material: trimMat,
    position: [-20, -5.4, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_pylon_left' : 'jet_pylon_right',
      geometry: new THREE.BoxGeometry(12, 2, 6),
      material: darkMat,
      position: [-12, -4.4, side * 30]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_missile_left' : 'jet_missile_right',
      geometry: new THREE.CylinderGeometry(1.1, 1.4, 18, 10),
      material: trimMat,
      position: [-10, -6.2, side * 30],
      rotation: [0, 0, -Math.PI / 2]
    });
  });

  return group;
};

const buildGroundArmor = ({
  name,
  hullColor,
  turretColor,
  accentColor,
  barrelLength = 24,
  hullLength = 48,
  hullHeight = 14,
  hullWidth = 28,
  turretRadius = 10,
  apc = false
}) => {
  const group = new THREE.Group();
  group.name = name;

  const hullMat = makeMaterial({ color: hullColor, roughness: 0.62, metalness: 0.32 });
  const turretMat = makeMaterial({ color: turretColor, roughness: 0.54, metalness: 0.38 });
  const trackMat = makeMaterial({ color: '#161b22', roughness: 0.84, metalness: 0.18 });
  const trimMat = makeMaterial({ color: '#475569', roughness: 0.5, metalness: 0.42 });
  const glowMat = makeMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.45, transparent: true, opacity: 0.38 });

  addMesh({
    parent: group,
    name: 'vehicle_hull_base',
    geometry: new THREE.BoxGeometry(hullLength, hullHeight, hullWidth),
    material: hullMat,
    position: [0, 9, 0]
  });
  addMesh({
    parent: group,
    name: 'vehicle_glacis',
    geometry: new THREE.BoxGeometry(hullLength * 0.42, hullHeight * 0.45, hullWidth * 0.86),
    material: trimMat,
    position: [hullLength * 0.18, 15.5, 0],
    rotation: [0, 0, -0.2]
  });
  addMesh({
    parent: group,
    name: 'vehicle_rear_deck',
    geometry: new THREE.BoxGeometry(hullLength * 0.36, hullHeight * 0.3, hullWidth * 0.72),
    material: trimMat,
    position: [-hullLength * 0.18, 14.5, 0]
  });
  addMesh({
    parent: group,
    name: 'vehicle_track_left',
    geometry: new THREE.BoxGeometry(hullLength * 1.05, 6, 5.8),
    material: trackMat,
    position: [0, 3.8, hullWidth * 0.45]
  });
  addMesh({
    parent: group,
    name: 'vehicle_track_right',
    geometry: new THREE.BoxGeometry(hullLength * 1.05, 6, 5.8),
    material: trackMat,
    position: [0, 3.8, -hullWidth * 0.45]
  });
  addMesh({
    parent: group,
    name: 'vehicle_track_guard_left',
    geometry: new THREE.BoxGeometry(hullLength * 0.9, 3.8, 4.4),
    material: trimMat,
    position: [0, 10, hullWidth * 0.41]
  });
  addMesh({
    parent: group,
    name: 'vehicle_track_guard_right',
    geometry: new THREE.BoxGeometry(hullLength * 0.9, 3.8, 4.4),
    material: trimMat,
    position: [0, 10, -hullWidth * 0.41]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `vehicle_exhaust_glow_${index}`,
      geometry: new THREE.CylinderGeometry(1.6, 1.1, 8, 10),
      material: glowMat,
      position: [-hullLength * 0.54, 11.5, side * 5.4],
      rotation: [0, 0, -Math.PI / 2]
    });
  });
  addMesh({
    parent: group,
    name: 'vehicle_sensor_glow',
    geometry: new THREE.SphereGeometry(1.8, 10, 10),
    material: glowMat,
    position: [hullLength * 0.14, 18.8, apc ? 4 : 0]
  });

  const turretRoot = new THREE.Group();
  turretRoot.name = 'vehicle_turret_root';
  turretRoot.position.set(apc ? 4 : 2, apc ? 17 : 19, 0);
  group.add(turretRoot);

  addMesh({
    parent: turretRoot,
    name: 'vehicle_turret_body',
    geometry: apc
      ? new THREE.BoxGeometry(20, 7, 16)
      : new THREE.CylinderGeometry(turretRadius, turretRadius * 1.08, 8, 18),
    material: turretMat,
    position: [0, 0, 0]
  });
  addMesh({
    parent: turretRoot,
    name: 'vehicle_barrel',
    geometry: new THREE.CylinderGeometry(apc ? 1.2 : 1.5, apc ? 1.4 : 1.8, barrelLength, 12),
    material: trackMat,
    position: [barrelLength * 0.5 + (apc ? 8 : 10), 0.6, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: turretRoot,
    name: 'vehicle_barrel_shroud',
    geometry: new THREE.CylinderGeometry(apc ? 2.1 : 2.8, apc ? 2.4 : 3.2, apc ? 10 : 14, 12),
    material: trimMat,
    position: [apc ? 11 : 12, 0.6, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: turretRoot,
    name: 'vehicle_muzzle_glow',
    geometry: new THREE.SphereGeometry(apc ? 1.2 : 1.4, 10, 10),
    material: glowMat,
    position: [barrelLength + (apc ? 8 : 10), 0.6, 0]
  });

  if (apc) {
    addMesh({
      parent: group,
      name: 'vehicle_troop_compartment',
      geometry: new THREE.BoxGeometry(24, 11, 20),
      material: turretMat,
      position: [-6, 18, 0]
    });
    addMesh({
      parent: group,
      name: 'vehicle_rear_door',
      geometry: new THREE.BoxGeometry(5, 10, 16),
      material: trimMat,
      position: [-hullLength * 0.5 + 2, 15, 0]
    });
  }

  return group;
};

const root = new THREE.Group();
root.name = 'airstrike_assets_root';
root.add(buildBomberPlane());
root.add(buildParachuteNuke());
root.add(buildStrikeJet());
root.add(buildGroundArmor({
  name: 'battle_tank',
  hullColor: '#4b5d3a',
  turretColor: '#3f5332',
  accentColor: '#f59e0b',
  barrelLength: 28,
  hullLength: 50,
  hullHeight: 14,
  hullWidth: 28,
  turretRadius: 9.5
}));
root.add(buildGroundArmor({
  name: 'battle_apc',
  hullColor: '#2f4f7f',
  turretColor: '#26436b',
  accentColor: '#38bdf8',
  barrelLength: 18,
  hullLength: 46,
  hullHeight: 13,
  hullWidth: 26,
  turretRadius: 8,
  apc: true
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
