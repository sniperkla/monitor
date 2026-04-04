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
const outPath = path.join(outDir, 'airstrike_assets.glb');

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.72,
  metalness = 0.16,
  transparent = false,
  opacity = 1,
  side,
  map,
}) => {
  const m = new THREE.MeshStandardMaterial({
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
  const tex = map !== undefined ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4)
      ? autoMap(color) : null;
  if (tex) m.map = tex;
  return m;
};

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

  // WW2 B-29 Superfortress style materials
  const oliveMat    = makeMaterial({ color: '#7f8d68', roughness: 0.66, metalness: 0.18, emissive: '#7f8d68', emissiveIntensity: 0.06 });
  const oliveDkMat  = makeMaterial({ color: '#667453', roughness: 0.74, metalness: 0.14 });
  const alumMat     = makeMaterial({ color: '#9daaa2', roughness: 0.32, metalness: 0.66 });
  const darkMat     = makeMaterial({ color: '#465247', roughness: 0.28, metalness: 0.58 });
  const rubberMat   = makeMaterial({ color: '#788171', roughness: 0.56, metalness: 0.22 });
  const glassMat    = makeMaterial({ color: '#a8ccd8', roughness: 0.06, metalness: 0.78, transparent: true, opacity: 0.54 });
  const glowMat     = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 1.9, transparent: true, opacity: 0.44 });

  // ── FUSELAGE – large oval pressurised tube (B-29 circular cross-section) ──
  addMesh({
    parent: group, name: 'bomber_fuselage',
    geometry: new THREE.CylinderGeometry(12.5, 12.5, 255, 26),
    material: oliveMat,
    rotation: [0, 0, -Math.PI / 2],
    scale: [1, 1, 1.18]
  });
  // Forward tapered section
  addMesh({
    parent: group, name: 'bomber_nose_section',
    geometry: new THREE.CylinderGeometry(6.5, 12.5, 62, 22),
    material: oliveMat,
    position: [103, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
    scale: [1, 1, 1.18]
  });
  // Aft tapered section leading to tail boom
  addMesh({
    parent: group, name: 'bomber_tail_taper',
    geometry: new THREE.CylinderGeometry(5.8, 12.5, 76, 20),
    material: oliveMat,
    position: [-113, 2, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1, 1, 1.18]
  });
  // Fuselage panel rings (rivet-line detail)
  [-80, -40, 0, 40, 80].forEach((x, i) => {
    addMesh({
      parent: group, name: `bomber_panel_ring_${i}`,
      geometry: new THREE.TorusGeometry(12.8, 0.45, 8, 28),
      material: oliveDkMat,
      position: [x, 0, 0],
      rotation: [0, Math.PI / 2, 0]
    });
  });

  // ── NOSE – stepped B-29 greenhouse (flat multi-panel nose) ──
  addMesh({
    parent: group, name: 'bomber_nose_shell',
    geometry: new THREE.SphereGeometry(15, 24, 18),
    material: oliveMat,
    position: [120, 0, 0],
    scale: [1.35, 0.82, 0.82]
  });
  // Lower bombardier greenhouse dome
  addMesh({
    parent: group, name: 'bomber_greenhouse',
    geometry: new THREE.SphereGeometry(11.5, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
    material: glassMat,
    position: [108, 4, 0],
    rotation: [Math.PI, 0, Math.PI / 2],
    scale: [1.85, 0.86, 0.86]
  });
  // Upper nose glass section
  addMesh({
    parent: group, name: 'bomber_nose_glass',
    geometry: new THREE.SphereGeometry(8.8, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.44),
    material: glassMat,
    position: [124, 2, 0],
    rotation: [Math.PI, 0, Math.PI / 2],
    scale: [1.3, 0.82, 0.82]
  });
  // Nose tip
  addMesh({
    parent: group, name: 'bomber_nose_tip',
    geometry: new THREE.SphereGeometry(5.2, 14, 10),
    material: alumMat,
    position: [136, 0, 0],
    scale: [1.55, 0.65, 0.65]
  });
  // Nose frame strips
  [-1, 1].forEach((s, i) => {
    addMesh({
      parent: group, name: `bomber_nose_frame_${i}`,
      geometry: new THREE.BoxGeometry(30, 1.4, 2.5),
      material: alumMat,
      position: [110, 9.5, s * 5],
      rotation: [0, 0, 0.22]
    });
  });

  // ── SPINE & BELLY ──
  addMesh({
    parent: group, name: 'bomber_spine',
    geometry: new THREE.BoxGeometry(188, 5.2, 11),
    material: oliveDkMat,
    position: [-8, 13.8, 0]
  });
  addMesh({
    parent: group, name: 'bomber_belly_bay',
    geometry: new THREE.BoxGeometry(72, 3.8, 24),
    material: darkMat,
    position: [-5, -13, 0]
  });
  // Bomb-bay door panels (two halves)
  [-1, 1].forEach((s, i) => {
    addMesh({
      parent: group, name: `bomber_bay_door_${i}`,
      geometry: new THREE.BoxGeometry(72, 1.2, 11),
      material: oliveDkMat,
      position: [-5, -13.5, s * 6.2]
    });
  });

  // ── DORSAL TURRET (top amidships) ──
  addMesh({
    parent: group, name: 'bomber_dorsal_turret_base',
    geometry: new THREE.SphereGeometry(6.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    material: oliveMat,
    position: [18, 13.8, 0]
  });
  addMesh({
    parent: group, name: 'bomber_dorsal_turret_ring',
    geometry: new THREE.TorusGeometry(6.4, 0.75, 8, 22),
    material: alumMat,
    position: [18, 13.8, 0],
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: group, name: 'bomber_dorsal_glass',
    geometry: new THREE.SphereGeometry(5.9, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    material: glassMat,
    position: [18, 13.8, 0]
  });
  // Twin dorsal guns
  [-1, 1].forEach((s, gi) => {
    addMesh({
      parent: group, name: gi === 0 ? 'bomber_dorsal_turret' : 'bomber_dorsal_gun_2',
      geometry: new THREE.CylinderGeometry(0.68, 0.68, 15, 8),
      material: darkMat,
      position: [23, 19.8, s * 2.8],
      rotation: [0, 0, 0.16]
    });
  });

  // ── VENTRAL TURRET (belly gun blister) ──
  addMesh({
    parent: group, name: 'bomber_ventral_base',
    geometry: new THREE.SphereGeometry(5.6, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    material: oliveMat,
    position: [-20, -12.5, 0]
  });
  addMesh({
    parent: group, name: 'bomber_ventral_glass',
    geometry: new THREE.SphereGeometry(4.8, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    material: glassMat,
    position: [-20, -12.5, 0]
  });
  [-1, 1].forEach((s, gi) => {
    addMesh({
      parent: group, name: `bomber_ventral_gun_${gi}`,
      geometry: new THREE.CylinderGeometry(0.6, 0.6, 13, 8),
      material: darkMat,
      position: [-20, -18.5, s * 2.8],
      rotation: [0, 0, Math.PI / 2]
    });
  });

  // ── TAIL BOOM ──
  addMesh({
    parent: group, name: 'bomber_tail_boom',
    geometry: new THREE.CylinderGeometry(5.6, 8.8, 52, 18),
    material: oliveMat,
    position: [-118, 2, 0],
    rotation: [0, 0, Math.PI / 2]
  });
  addMesh({
    parent: group, name: 'bomber_tail_cap',
    geometry: new THREE.SphereGeometry(5.6, 14, 10),
    material: oliveMat,
    position: [-145, 2, 0],
    scale: [1.1, 0.88, 0.88]
  });

  // ── VERTICAL TAIL FIN – large swept like B-29 ──
  addMesh({
    parent: group, name: 'bomber_vertical_tail',
    geometry: new THREE.BoxGeometry(4.8, 66, 56),
    material: oliveMat,
    position: [-118, 27, 0],
    rotation: [0, 0, 0.06]
  });
  // Leading-edge spar
  addMesh({
    parent: group, name: 'bomber_tail_fin_edge',
    geometry: new THREE.CylinderGeometry(2.2, 2.2, 68, 10),
    material: oliveDkMat,
    position: [-103, 27, 0],
    rotation: [Math.PI / 2, 0, 0.06]
  });
  addMesh({
    parent: group, name: 'bomber_rudder',
    geometry: new THREE.BoxGeometry(4.2, 50, 30),
    material: rubberMat,
    position: [-133, 27, 0],
    rotation: [0, 0, 0.04]
  });
  addMesh({
    parent: group, name: 'bomber_rudder_tab',
    geometry: new THREE.BoxGeometry(2.4, 14, 6.5),
    material: alumMat,
    position: [-140, 22, 0]
  });

  // ── HORIZONTAL STABILISERS ──
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group, name: side < 0 ? 'bomber_tailplane_left' : 'bomber_tailplane_right',
      geometry: new THREE.BoxGeometry(46, 3.6, 65),
      material: oliveMat,
      position: [-118, 6, side * 37],
      rotation: [0, side * 0.07, side * -0.04]
    });
    addMesh({
      parent: group, name: side < 0 ? 'bomber_elevator_left' : 'bomber_elevator_right',
      geometry: new THREE.BoxGeometry(18, 2.8, 32),
      material: rubberMat,
      position: [-133, 6, side * 44]
    });
  });

  // ── TAIL GUN POSITION ──
  addMesh({
    parent: group, name: 'bomber_tail_gun_mount',
    geometry: new THREE.SphereGeometry(4.6, 12, 10),
    material: oliveMat,
    position: [-148, 3, 0]
  });
  addMesh({
    parent: group, name: 'bomber_tail_gun_glass',
    geometry: new THREE.SphereGeometry(4, 10, 8, 0, Math.PI, 0, Math.PI),
    material: glassMat,
    position: [-148, 3, 0],
    rotation: [0, Math.PI / 2, 0]
  });
  [-1, 1].forEach((s, gi) => {
    addMesh({
      parent: group, name: `bomber_tail_gun_${gi}`,
      geometry: new THREE.CylinderGeometry(0.6, 0.6, 17, 8),
      material: darkMat,
      position: [-158, 3, s * 2.6],
      rotation: [0, 0, -Math.PI / 2]
    });
  });

  // ── MAIN WINGS – high-aspect, slightly tapered, mild dihedral ──
  addMesh({
    parent: group, name: 'bomber_main_wing',
    geometry: new THREE.BoxGeometry(114, 5.8, 278),
    material: oliveMat,
    position: [-6, 0, 0]
  });
  [-1, 1].forEach((side) => {
    // Outer tapered panel
    addMesh({
      parent: group, name: side < 0 ? 'bomber_outer_wing_left' : 'bomber_outer_wing_right',
      geometry: new THREE.BoxGeometry(102, 4.2, 112),
      material: oliveDkMat,
      position: [-20, 1, side * 157],
      rotation: [0, side * 0.045, side * -0.048]
    });
    // Wingtip
    addMesh({
      parent: group, name: side < 0 ? 'bomber_wingtip_left' : 'bomber_wingtip_right',
      geometry: new THREE.BoxGeometry(56, 2.4, 36),
      material: oliveDkMat,
      position: [-34, 2.5, side * 208],
      rotation: [0, side * 0.09, side * -0.09]
    });
    // Aileron
    addMesh({
      parent: group, name: side < 0 ? 'bomber_aileron_left' : 'bomber_aileron_right',
      geometry: new THREE.BoxGeometry(26, 2.2, 40),
      material: rubberMat,
      position: [-52, -0.2, side * 152]
    });
    // Inboard flap
    addMesh({
      parent: group, name: side < 0 ? 'bomber_flap_left' : 'bomber_flap_right',
      geometry: new THREE.BoxGeometry(34, 2.2, 54),
      material: oliveDkMat,
      position: [8, -0.6, side * 98]
    });
    // Wing rib line
    addMesh({
      parent: group, name: side < 0 ? 'bomber_wing_rib_left' : 'bomber_wing_rib_right',
      geometry: new THREE.BoxGeometry(112, 1.0, 2.6),
      material: oliveDkMat,
      position: [-6, 3, side * 96]
    });
  });

  // ── 4 RADIAL ENGINES on wing (B-29: inboard + outboard pairs) ──
  const enginePositions = [
    [22, -10, -90],   // inboard left
    [22, -10, -152],  // outboard left
    [22, -10,  90],   // inboard right
    [22, -10,  152]   // outboard right
  ];
  enginePositions.forEach((pos, index) => {
    // Nacelle body – long streamlined
    addMesh({
      parent: group, name: `bomber_engine_${index}`,
      geometry: new THREE.CylinderGeometry(11, 9.5, 58, 22),
      material: alumMat,
      position: pos,
      rotation: [0, 0, -Math.PI / 2]
    });
    // Nacelle rear cowling
    addMesh({
      parent: group, name: `bomber_nacelle_rear_${index}`,
      geometry: new THREE.CylinderGeometry(8.2, 6.5, 24, 18),
      material: oliveMat,
      position: [pos[0] - 38, pos[1], pos[2]],
      rotation: [0, 0, -Math.PI / 2]
    });
    // NACA cowl ring (front intake lip)
    addMesh({
      parent: group, name: `bomber_engine_cowl_${index}`,
      geometry: new THREE.TorusGeometry(10.4, 2.4, 10, 24),
      material: darkMat,
      position: [pos[0] + 28, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    // Inner cowl ring
    addMesh({
      parent: group, name: `bomber_cowl_inner_${index}`,
      geometry: new THREE.TorusGeometry(8.4, 1.3, 8, 22),
      material: darkMat,
      position: [pos[0] + 26, pos[1], pos[2]],
      rotation: [0, Math.PI / 2, 0]
    });
    // 6-stack radial exhaust stubs (like B-29 turbosupercharger stacks)
    for (let stack = 0; stack < 6; stack++) {
      const angle = (stack / 6) * Math.PI * 2 + Math.PI / 12;
      const er = 9.0;
      addMesh({
        parent: group, name: `bomber_exhaust_stack_${index}_${stack}`,
        geometry: new THREE.CylinderGeometry(0.85, 0.95, 5.5, 7),
        material: darkMat,
        position: [pos[0] - 18, pos[1] + Math.sin(angle) * er, pos[2] + Math.cos(angle) * er],
        rotation: [0, 0, -Math.PI / 2]
      });
    }
    // Exhaust heat glow
    addMesh({
      parent: group, name: `bomber_exhaust_glow_${index}`,
      geometry: new THREE.CylinderGeometry(5.8, 3.2, 13, 14),
      material: glowMat,
      position: [pos[0] - 34, pos[1], pos[2]],
      rotation: [0, 0, -Math.PI / 2]
    });
    // Nacelle-to-wing fillet fairing
    addMesh({
      parent: group, name: `bomber_nacelle_fillet_${index}`,
      geometry: new THREE.BoxGeometry(54, 3.8, 17),
      material: oliveMat,
      position: [pos[0] - 4, pos[1] + 8.5, pos[2]]
    });

    // ── PROPELLER GROUP (rotation node) ──
    const propGroup = new THREE.Group();
    propGroup.name = `bomber_prop_${index}`;
    propGroup.position.set(pos[0] + 33, pos[1], pos[2]);
    group.add(propGroup);

    // 4-blade Hamilton Standard style props
    for (let blade = 0; blade < 4; blade++) {
      const bAngle = blade * (Math.PI / 2);
      addMesh({
        parent: propGroup, name: `bomber_prop_blade_${index}_${blade}`,
        geometry: new THREE.BoxGeometry(1.5, 38, 4.8),
        material: darkMat,
        position: [0, Math.cos(bAngle) * 13, Math.sin(bAngle) * 13],
        rotation: [bAngle, 0, -0.09]
      });
      // Blade root bulge
      addMesh({
        parent: propGroup, name: `bomber_blade_root_${index}_${blade}`,
        geometry: new THREE.SphereGeometry(2.6, 8, 8),
        material: darkMat,
        position: [0, Math.cos(bAngle) * 3.5, Math.sin(bAngle) * 3.5]
      });
    }
    // Spinner cone
    addMesh({
      parent: propGroup, name: `bomber_prop_hub_${index}`,
      geometry: new THREE.ConeGeometry(4.4, 12, 16),
      material: alumMat,
      position: [5, 0, 0],
      rotation: [0, 0, Math.PI / 2]
    });
    // Spinner base disc
    addMesh({
      parent: propGroup, name: `bomber_spinner_base_${index}`,
      geometry: new THREE.CylinderGeometry(4.6, 4.6, 2.5, 16),
      material: darkMat,
      position: [-1, 0, 0],
      rotation: [0, 0, Math.PI / 2]
    });
  });

  // ── NATIONAL INSIGNIA – US star-and-bar on wings ──
  addMesh({
    parent: group, name: 'bomber_mark_left',
    geometry: new THREE.CircleGeometry(15, 6),
    material: makeMaterial({ color: '#1a4896', transparent: true, opacity: 0.88 }),
    position: [2, 3.4, -108],
    rotation: [-Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: group, name: 'bomber_mark_right',
    geometry: new THREE.CircleGeometry(15, 6),
    material: makeMaterial({ color: '#1a4896', transparent: true, opacity: 0.88 }),
    position: [2, 3.4, 108],
    rotation: [-Math.PI / 2, 0, 0]
  });
  // White star centres
  [-108, 108].forEach((z, i) => {
    addMesh({
      parent: group, name: `bomber_mark_star_${i}`,
      geometry: new THREE.CircleGeometry(7.5, 5),
      material: makeMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.9 }),
      position: [2, 3.6, z],
      rotation: [-Math.PI / 2, 0, Math.PI / 10]
    });
  });
  // Fuselage ID band
  addMesh({
    parent: group, name: 'bomber_fuselage_stripe',
    geometry: new THREE.CylinderGeometry(12.7, 12.7, 5.5, 26),
    material: makeMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.28 }),
    position: [50, 0, 0],
    rotation: [0, 0, Math.PI / 2]
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

  const bodyMat = makeMaterial({ color: '#b0bdcb', roughness: 0.28, metalness: 0.7, emissive: '#b0bdcb', emissiveIntensity: 0.05 });
  const trimMat = makeMaterial({ color: '#7c8a9a', roughness: 0.36, metalness: 0.56 });
  const darkMat = makeMaterial({ color: '#46515e', roughness: 0.24, metalness: 0.64 });
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

  const hullMat = makeMaterial({ color: hullColor, roughness: 0.54, metalness: 0.34, emissive: hullColor, emissiveIntensity: 0.08 });
  const turretMat = makeMaterial({ color: turretColor, roughness: 0.46, metalness: 0.4, emissive: turretColor, emissiveIntensity: 0.07 });
  const trackMat = makeMaterial({ color: '#434c58', roughness: 0.72, metalness: 0.22 });
  const trimMat = makeMaterial({ color: '#7b8794', roughness: 0.42, metalness: 0.46 });
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
  hullColor: '#768f5f',
  turretColor: '#667f52',
  accentColor: '#f59e0b',
  barrelLength: 28,
  hullLength: 50,
  hullHeight: 14,
  hullWidth: 28,
  turretRadius: 9.5
}));
root.add(buildGroundArmor({
  name: 'battle_apc',
  hullColor: '#5b82bb',
  turretColor: '#496eaa',
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
