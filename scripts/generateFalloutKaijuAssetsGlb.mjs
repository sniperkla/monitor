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
const outPath = path.join(outDir, 'kaiju_assets.glb');

const root = new THREE.Group();
root.name = 'kaiju_assets_root';

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.76,
  metalness = 0.12,
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

const addSymmetric = (count, builder) => {
  for (let i = 0; i < count; i++) builder(i);
};

const buildGodzilla = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_godzilla';

  const hideMat = makeMaterial({ color: '#1b2330', roughness: 0.56, metalness: 0.28 });
  const hideDarkMat = makeMaterial({ color: '#111827', roughness: 0.68, metalness: 0.22 });
  const boneMat = makeMaterial({ color: '#d6d3d1', roughness: 0.22, metalness: 0.16 });
  const seamMat = makeMaterial({ color: '#3f6212', emissive: '#16a34a', emissiveIntensity: 0.72, roughness: 0.28, metalness: 0.22 });

  addMesh({
    parent: group,
    name: 'kaiju_godzilla_pelvis',
    geometry: new THREE.SphereGeometry(15, 18, 14),
    material: hideDarkMat,
    position: [0, 18, -8],
    scale: [1.05, 0.9, 1.2]
  });
  addMesh({
    parent: group,
    name: 'kaiju_godzilla_torso',
    geometry: new THREE.CapsuleGeometry(14, 32, 8, 14),
    material: hideMat,
    position: [0, 30, 2],
    rotation: [0.12, 0, 0],
    scale: [1.08, 1.3, 1.05]
  });
  addMesh({
    parent: group,
    name: 'kaiju_godzilla_chest_seam',
    geometry: new THREE.BoxGeometry(10, 24, 2.4),
    material: seamMat,
    position: [0, 30, 15],
    rotation: [0.08, 0, 0]
  });

  const head = new THREE.Group();
  head.name = 'kaiju_godzilla_head';
  head.position.set(0, 54, 12);
  group.add(head);

  addMesh({
    parent: head,
    name: 'kaiju_godzilla_skull',
    geometry: new THREE.CapsuleGeometry(8.6, 18, 8, 12),
    material: hideDarkMat,
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.08, 0.86, 1.34]
  });
  addMesh({
    parent: head,
    name: 'kaiju_godzilla_snout',
    geometry: new THREE.BoxGeometry(12, 8, 14),
    material: hideDarkMat,
    position: [0, -1.6, 11]
  });
  addMesh({
    parent: head,
    name: 'kaiju_godzilla_eye_left',
    geometry: new THREE.SphereGeometry(1.5, 8, 8),
    material: makeMaterial({ color: '#fca5a5', emissive: '#ef4444', emissiveIntensity: 1.8 }),
    position: [-5.5, 3.8, 12.8]
  });
  addMesh({
    parent: head,
    name: 'kaiju_godzilla_eye_right',
    geometry: new THREE.SphereGeometry(1.5, 8, 8),
    material: makeMaterial({ color: '#fca5a5', emissive: '#ef4444', emissiveIntensity: 1.8 }),
    position: [5.5, 3.8, 12.8]
  });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_godzilla_jaw';
  jaw.position.set(0, -4, 5);
  head.add(jaw);

  addMesh({
    parent: jaw,
    name: 'kaiju_godzilla_jaw_shell',
    geometry: new THREE.BoxGeometry(12.5, 5.4, 18),
    material: hideDarkMat,
    position: [0, -2.2, 5]
  });
  addSymmetric(10, (i) => {
    addMesh({
      parent: jaw,
      name: `kaiju_godzilla_tooth_${i}`,
      geometry: new THREE.ConeGeometry(0.55, 4.4, 4),
      material: boneMat,
      position: [-5.5 + i * 1.2, 0.6, 10.5 - (i % 2) * 1.8],
      rotation: [Math.PI / 2, 0, 0]
    });
  });

  [-1, 1].forEach((side, index) => {
    const arm = new THREE.Group();
    arm.name = `kaiju_godzilla_arm_${index}`;
    arm.position.set(side * 15.5, 33, 6);
    group.add(arm);
    addMesh({
      parent: arm,
      name: `kaiju_godzilla_arm_upper_${index}`,
      geometry: new THREE.CapsuleGeometry(4.2, 12, 6, 10),
      material: hideDarkMat,
      rotation: [0.2, 0, side * -0.85]
    });
    addMesh({
      parent: arm,
      name: `kaiju_godzilla_arm_lower_${index}`,
      geometry: new THREE.CapsuleGeometry(3.2, 10, 6, 10),
      material: hideMat,
      position: [side * 6.8, -7.8, 3.4],
      rotation: [0.28, 0, side * -0.42]
    });
  });

  [-1, 1].forEach((side, index) => {
    const leg = new THREE.Group();
    leg.name = `kaiju_godzilla_leg_${index}`;
    leg.position.set(side * 12, 8, -2);
    group.add(leg);
    addMesh({
      parent: leg,
      name: `kaiju_godzilla_thigh_${index}`,
      geometry: new THREE.CapsuleGeometry(6.6, 14, 8, 12),
      material: hideMat,
      rotation: [0.1, 0, side * -0.16],
      scale: [0.9, 1.15, 1]
    });
    addMesh({
      parent: leg,
      name: `kaiju_godzilla_shin_${index}`,
      geometry: new THREE.CylinderGeometry(4.2, 6.4, 18, 12),
      material: hideDarkMat,
      position: [0, -12, 4.8],
      rotation: [0.18, 0, 0]
    });
    addMesh({
      parent: leg,
      name: `kaiju_godzilla_foot_${index}`,
      geometry: new THREE.BoxGeometry(9, 4, 16),
      material: hideDarkMat,
      position: [0, -22, 12]
    });
  });

  for (let i = 0; i < 9; i++) {
    const tailScale = 1 - i * 0.075;
    addMesh({
      parent: group,
      name: `kaiju_godzilla_tail_${i}`,
      geometry: new THREE.SphereGeometry(9.5 * tailScale, 14, 12),
      material: hideDarkMat,
      position: [0, 14 - i * 1.4, -24 - i * 11],
      rotation: [-0.05, 0, 0],
      scale: [1, 0.82, 1.4]
    });
  }
  for (let i = 0; i < 8; i++) {
    addMesh({
      parent: group,
      name: `kaiju_godzilla_spine_${i}`,
      geometry: new THREE.ConeGeometry(2.8 - i * 0.12, 11 + i, 5),
      material: makeMaterial({ color: '#0f172a', emissive: '#16a34a', emissiveIntensity: i % 3 === 0 ? 0.7 : 0.2 }),
      position: [0, 45 - i * 5.2, -8 - i * 4],
      rotation: [-0.5, 0, i % 2 === 0 ? 0.18 : -0.18]
    });
  }

  return group;
};

const buildOctopus = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_octopus';

  const mantleMat = makeMaterial({ color: '#24104a', roughness: 0.44, metalness: 0.24 });
  const membraneMat = makeMaterial({ color: '#6b21a8', roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.36, side: THREE.DoubleSide });
  const darkMat = makeMaterial({ color: '#140b26', roughness: 0.82, metalness: 0.06 });
  const toxicMat = makeMaterial({ color: '#7c3aed', emissive: '#34d399', emissiveIntensity: 0.52, roughness: 0.22, metalness: 0.06 });

  addMesh({
    parent: group,
    name: 'kaiju_octopus_mantle',
    geometry: new THREE.SphereGeometry(12.5, 18, 14),
    material: mantleMat,
    position: [0, 18, 0],
    scale: [1.08, 1.24, 1.08]
  });
  addMesh({
    parent: group,
    name: 'kaiju_octopus_membrane',
    geometry: new THREE.SphereGeometry(11.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8),
    material: membraneMat,
    position: [0, 20, 0],
    scale: [1.24, 1.1, 1.24]
  });
  addMesh({
    parent: group,
    name: 'kaiju_octopus_beak',
    geometry: new THREE.ConeGeometry(4.2, 8.4, 10),
    material: darkMat,
    position: [0, 8, 5],
    rotation: [Math.PI / 4, 0, 0]
  });
  [[-4.2, 14, 9], [4.2, 14, 9], [-1.8, 13, 11], [1.8, 13, 11]].forEach((eye, index) => {
    addMesh({
      parent: group,
      name: `kaiju_octopus_eye_${index}`,
      geometry: new THREE.SphereGeometry(1.35, 8, 8),
      material: toxicMat,
      position: eye
    });
  });

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const tentacle = new THREE.Group();
    tentacle.name = `kaiju_octopus_tentacle_${i}`;
    tentacle.position.set(Math.cos(angle) * 5, 10, Math.sin(angle) * 5);
    tentacle.rotation.set(0.9, angle, 0);
    group.add(tentacle);

    addMesh({
      parent: tentacle,
      name: `kaiju_octopus_tentacle_upper_${i}`,
      geometry: new THREE.CylinderGeometry(2.6, 2, 16, 10),
      material: mantleMat,
      position: [0, -1.5, 8]
    });
    addMesh({
      parent: tentacle,
      name: `kaiju_octopus_tentacle_lower_${i}`,
      geometry: new THREE.CylinderGeometry(1.8, 0.38, 18, 10),
      material: makeMaterial({ color: '#4c1d95', roughness: 0.56, metalness: 0.1 }),
      position: [0, -7, 18],
      rotation: [0.44 + Math.sin(i) * 0.08, 0, 0]
    });
  }

  return group;
};

const buildSpider = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spider';

  const chitinMat = makeMaterial({ color: '#070b12', roughness: 0.82, metalness: 0.08 });
  const chitinSoftMat = makeMaterial({ color: '#111827', roughness: 0.74, metalness: 0.12 });
  const woundMat = makeMaterial({ color: '#4c1010', emissive: '#7f1d1d', emissiveIntensity: 0.36, roughness: 0.84, metalness: 0.04 });
  const eyeMat = makeMaterial({ color: '#f5f5f4', emissive: '#dc2626', emissiveIntensity: 0.46, roughness: 0.16, metalness: 0.06 });
  const fangMat = makeMaterial({ color: '#e7e5e4', roughness: 0.18, metalness: 0.12 });

  const rootNode = new THREE.Group();
  rootNode.name = 'kaiju_spider_root';
  rootNode.position.set(0, 4.8, 0);
  group.add(rootNode);

  const abdomen = new THREE.Group();
  abdomen.name = 'kaiju_spider_abdomen';
  abdomen.position.set(0, 15.2, -20);
  rootNode.add(abdomen);
  addMesh({
    parent: abdomen,
    name: 'kaiju_spider_abdomen_core',
    geometry: new THREE.SphereGeometry(11, 18, 14),
    material: chitinMat,
    rotation: [-0.14, 0, 0],
    scale: [1.12, 0.9, 1.75]
  });
  addMesh({
    parent: abdomen,
    name: 'kaiju_spider_abdomen_sac',
    geometry: new THREE.SphereGeometry(8, 14, 12),
    material: woundMat,
    position: [0, 0.6, -1.8],
    rotation: [-0.1, 0, 0],
    scale: [0.92, 0.42, 1.18]
  });
  [[-2.5, 7.8, -1], [0, 8.6, 2.8], [2.6, 7.5, 5.2]].forEach((spine, index) => {
    addMesh({
      parent: abdomen,
      name: `kaiju_spider_abdomen_spine_${index}`,
      geometry: new THREE.ConeGeometry(1.05 - index * 0.08, 5.2 - index * 0.4, 5),
      material: chitinSoftMat,
      position: spine,
      rotation: [-0.7, index * 0.18, 0]
    });
  });

  const thorax = new THREE.Group();
  thorax.name = 'kaiju_spider_thorax';
  thorax.position.set(0, 10.6, -1.8);
  rootNode.add(thorax);
  addMesh({
    parent: thorax,
    name: 'kaiju_spider_thorax_core',
    geometry: new THREE.SphereGeometry(9.5, 18, 14),
    material: chitinSoftMat,
    rotation: [0.08, 0, 0],
    scale: [1.12, 0.68, 1.18]
  });
  [[-5.4, -0.6, -4.2], [5.4, -0.6, -4.2], [-5.8, -0.2, 2.4], [5.8, -0.2, 2.4]].forEach((socket, index) => {
    addMesh({
      parent: thorax,
      name: `kaiju_spider_socket_${index}`,
      geometry: new THREE.SphereGeometry(1.6, 8, 8),
      material: chitinMat,
      position: socket,
      scale: [1.15, 0.62, 0.92]
    });
  });

  const head = new THREE.Group();
  head.name = 'kaiju_spider_head';
  head.position.set(0, 9.2, 12.5);
  rootNode.add(head);
  addMesh({
    parent: head,
    name: 'kaiju_spider_head_core',
    geometry: new THREE.SphereGeometry(6.7, 16, 12),
    material: chitinMat,
    rotation: [-0.08, 0, 0],
    scale: [1.04, 0.74, 1.14]
  });
  addMesh({
    parent: head,
    name: 'kaiju_spider_face_plate',
    geometry: new THREE.SphereGeometry(4.8, 12, 10),
    material: woundMat,
    position: [0, 0.2, 4.2],
    scale: [0.74, 0.18, 0.42]
  });
  [[-2.7, 1.7, 4.6], [2.7, 1.7, 4.6], [-4.1, 0.2, 3.9], [4.1, 0.2, 3.9], [-1.4, -1.1, 4.8], [1.4, -1.1, 4.8]].forEach((eye, index) => {
    addMesh({
      parent: head,
      name: `kaiju_spider_eye_${index}`,
      geometry: new THREE.SphereGeometry(0.72, 8, 8),
      material: eyeMat,
      position: eye
    });
  });
  [-1, 1].forEach((side, index) => {
    const pedipalp = new THREE.Group();
    pedipalp.name = `kaiju_spider_pedipalp_${index}`;
    pedipalp.position.set(side * 2.4, -1.4, 3.6);
    head.add(pedipalp);
    addMesh({
      parent: pedipalp,
      name: `kaiju_spider_pedipalp_mesh_${index}`,
      geometry: new THREE.CapsuleGeometry(0.52, 4.2, 4, 8),
      material: chitinSoftMat,
      position: [side * 1.8, -1.6, 1.2],
      rotation: [0.42, 0, side * 0.28]
    });
    addMesh({
      parent: head,
      name: `kaiju_spider_fang_${index}`,
      geometry: new THREE.CylinderGeometry(0.24, 0.06, 5.8, 8),
      material: fangMat,
      position: [side * 1.7, -4.7, 5.6],
      rotation: [0.92, side * 0.12, side * -0.24]
    });
  });

  const anchorZ = [9, 3, -4, -12];
  anchorZ.forEach((z, row) => {
    [-1, 1].forEach((side) => {
      const index = row * 2 + (side === 1 ? 1 : 0);
      const anchor = [side === -1 ? -8.2 + row * 0.2 : 8.2 - row * 0.2, 9.6 - row * 0.3, z];
      const legGroup = new THREE.Group();
      legGroup.name = `kaiju_spider_leg_${index}`;
      legGroup.position.set(anchor[0], anchor[1], anchor[2]);
      rootNode.add(legGroup);

      const upper = new THREE.Group();
      upper.name = `kaiju_spider_leg_${index}_upper`;
      legGroup.add(upper);
      addMesh({
        parent: upper,
        name: `kaiju_spider_leg_${index}_upper_mesh`,
        geometry: new THREE.CylinderGeometry(1.08, 0.92, 14, 8),
        material: chitinMat,
        position: [side * 6.8, -0.6, side * 0.35],
        rotation: [0.08, 0, side * -0.48]
      });
      addMesh({
        parent: upper,
        name: `kaiju_spider_leg_${index}_upper_joint`,
        geometry: new THREE.SphereGeometry(1.35, 8, 8),
        material: chitinSoftMat,
        position: [side * 12.2, -1.2, side * 1.4]
      });

      const mid = new THREE.Group();
      mid.name = `kaiju_spider_leg_${index}_mid`;
      mid.position.set(side * 12.2, -1.2, side * 1.4);
      upper.add(mid);
      addMesh({
        parent: mid,
        name: `kaiju_spider_leg_${index}_mid_mesh`,
        geometry: new THREE.CylinderGeometry(0.82, 0.62, 15.5, 8),
        material: chitinSoftMat,
        position: [side * 6.9, -3.8, 0],
        rotation: [0.08, 0, side * 0.26]
      });
      addMesh({
        parent: mid,
        name: `kaiju_spider_leg_${index}_mid_joint`,
        geometry: new THREE.SphereGeometry(1.08, 8, 8),
        material: chitinSoftMat,
        position: [side * 13, -7.2, 0]
      });

      const lower = new THREE.Group();
      lower.name = `kaiju_spider_leg_${index}_lower`;
      lower.position.set(side * 13, -7.2, 0);
      mid.add(lower);
      addMesh({
        parent: lower,
        name: `kaiju_spider_leg_${index}_lower_mesh`,
        geometry: new THREE.CylinderGeometry(0.52, 0.18, 14.8, 7),
        material: chitinSoftMat,
        position: [side * 6.7, -4.6, 0.4],
        rotation: [0.12, 0, side * 0.2]
      });
      addMesh({
        parent: lower,
        name: `kaiju_spider_leg_${index}_tip`,
        geometry: new THREE.ConeGeometry(0.42, 3.8, 5),
        material: fangMat,
        position: [side * 12.8, -9.1, 0.8],
        rotation: [0.22, 0, side * 0.12]
      });
    });
  });

  return group;
};

const buildSpicieBird = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_spicie_bird';

  const featherMat = makeMaterial({ color: '#111827', roughness: 0.68, metalness: 0.16 });
  const featherDarkMat = makeMaterial({ color: '#0b1220', roughness: 0.74, metalness: 0.12 });
  const seamMat = makeMaterial({ color: '#4c1d1d', emissive: '#7f1d1d', emissiveIntensity: 0.34, roughness: 0.44, metalness: 0.06 });
  const beakMat = makeMaterial({ color: '#facc15', roughness: 0.38, metalness: 0.08 });
  const talonMat = makeMaterial({ color: '#e5e7eb', roughness: 0.2, metalness: 0.12 });

  const birdRoot = new THREE.Group();
  birdRoot.name = 'kaiju_bird_root';
  birdRoot.position.set(0, 10, 0);
  group.add(birdRoot);

  addMesh({
    parent: birdRoot,
    name: 'kaiju_bird_body',
    geometry: new THREE.CapsuleGeometry(12.5, 22, 8, 14),
    material: featherMat,
    position: [0, 15, -2],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 0.82, 1.55]
  });
  addMesh({
    parent: birdRoot,
    name: 'kaiju_bird_body_seam',
    geometry: new THREE.BoxGeometry(10, 12, 2),
    material: seamMat,
    position: [0, 16, -6]
  });

  const head = new THREE.Group();
  head.name = 'kaiju_bird_head';
  head.position.set(0, 20, 17);
  birdRoot.add(head);
  addMesh({
    parent: head,
    name: 'kaiju_bird_skull',
    geometry: new THREE.CapsuleGeometry(6.8, 8, 8, 12),
    material: featherDarkMat,
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 0.76, 1.2]
  });
  addMesh({
    parent: head,
    name: 'kaiju_bird_beak',
    geometry: new THREE.ConeGeometry(2.8, 8.8, 7),
    material: beakMat,
    position: [0, -0.8, 7.2],
    rotation: [-0.1, 0, 0]
  });
  [[-2.1, 1.5, 5.1], [2.1, 1.5, 5.1], [-0.9, 0.9, 5.8], [0.9, 0.9, 5.8]].forEach((eye, index) => {
    addMesh({
      parent: head,
      name: `kaiju_bird_eye_${index}`,
      geometry: new THREE.SphereGeometry(0.82, 8, 8),
      material: makeMaterial({ color: '#f8fafc', emissive: '#f97316', emissiveIntensity: 0.72 }),
      position: eye
    });
  });

  const leftWing = new THREE.Group();
  leftWing.name = 'kaiju_bird_left_wing';
  leftWing.position.set(-14, 16, -2);
  birdRoot.add(leftWing);
  addMesh({
    parent: leftWing,
    name: 'kaiju_bird_left_wing_bone',
    geometry: new THREE.BoxGeometry(30, 1.8, 11),
    material: featherMat,
    rotation: [0.08, 0.04, -0.2]
  });
  addMesh({
    parent: leftWing,
    name: 'kaiju_bird_left_wing_secondary',
    geometry: new THREE.BoxGeometry(17, 1.1, 8),
    material: featherDarkMat,
    position: [-12, -1, 2],
    rotation: [0.2, 0, -0.25]
  });

  const rightWing = new THREE.Group();
  rightWing.name = 'kaiju_bird_right_wing';
  rightWing.position.set(14, 16, -2);
  birdRoot.add(rightWing);
  addMesh({
    parent: rightWing,
    name: 'kaiju_bird_right_wing_bone',
    geometry: new THREE.BoxGeometry(30, 1.8, 11),
    material: featherMat,
    rotation: [0.08, -0.04, 0.2]
  });
  addMesh({
    parent: rightWing,
    name: 'kaiju_bird_right_wing_secondary',
    geometry: new THREE.BoxGeometry(17, 1.1, 8),
    material: featherDarkMat,
    position: [12, -1, 2],
    rotation: [0.2, 0, 0.25]
  });

  const tail = new THREE.Group();
  tail.name = 'kaiju_bird_tail';
  tail.position.set(0, 14, -25);
  birdRoot.add(tail);
  addMesh({
    parent: tail,
    name: 'kaiju_bird_tail_fin',
    geometry: new THREE.BoxGeometry(8, 1.1, 16),
    material: featherDarkMat,
    rotation: [0.34, 0, 0]
  });
  addMesh({
    parent: tail,
    name: 'kaiju_bird_tail_spike',
    geometry: new THREE.ConeGeometry(3.8, 8, 6),
    material: featherMat,
    position: [0, -0.5, -7.2],
    rotation: [0.5, 0, 0]
  });

  [-1, 1].forEach((side, legIndex) => {
    addMesh({
      parent: birdRoot,
      name: `kaiju_bird_leg_${legIndex}`,
      geometry: new THREE.CylinderGeometry(0.48, 0.38, 6.4, 8),
      material: makeMaterial({ color: '#374151', roughness: 0.58, metalness: 0.28 }),
      position: [side * 4.6, 7.6, 8],
      rotation: [0.7, 0, side * 0.1]
    });
    for (let claw = 0; claw < 3; claw++) {
      addMesh({
        parent: birdRoot,
        name: `kaiju_bird_claw_${legIndex}_${claw}`,
        geometry: new THREE.ConeGeometry(0.32, 2.8, 5),
        material: talonMat,
        position: [side * (4.6 + (claw - 1) * 0.9), 4.8, 9.4 + claw * 0.8],
        rotation: [1, 0, side * (0.08 + claw * 0.05)]
      });
    }
  });

  return group;
};

const buildBeetle = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_beetle';

  const shellMat = makeMaterial({ color: '#3c2413', roughness: 0.58, metalness: 0.18 });
  const shellDarkMat = makeMaterial({ color: '#1f140d', roughness: 0.72, metalness: 0.14 });
  const amberMat = makeMaterial({ color: '#d97706', emissive: '#f59e0b', emissiveIntensity: 0.36, roughness: 0.3, metalness: 0.08 });

  addMesh({
    parent: group,
    name: 'kaiju_beetle_body',
    geometry: new THREE.CapsuleGeometry(12, 24, 8, 14),
    material: shellMat,
    position: [0, 22, 0],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.12, 0.82, 1.48]
  });
  addMesh({
    parent: group,
    name: 'kaiju_beetle_elytra',
    geometry: new THREE.BoxGeometry(20, 12, 24),
    material: shellDarkMat,
    position: [0, 25, -4],
    rotation: [0.1, 0, 0]
  });
  addMesh({
    parent: group,
    name: 'kaiju_beetle_collar',
    geometry: new THREE.CylinderGeometry(8.6, 10, 10, 14),
    material: shellDarkMat,
    position: [0, 18, 18],
    rotation: [Math.PI / 2, 0, 0]
  });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_beetle_jaw';
  jaw.position.set(0, 18, 25);
  group.add(jaw);
  addMesh({
    parent: jaw,
    name: 'kaiju_beetle_horn',
    geometry: new THREE.ConeGeometry(3.6, 16, 10),
    material: shellDarkMat,
    position: [0, 4, 8],
    rotation: [-0.58, 0, 0]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: jaw,
      name: `kaiju_beetle_mandible_${index}`,
      geometry: new THREE.CapsuleGeometry(1.1, 7, 4, 8),
      material: amberMat,
      position: [side * 4.8, -2.5, 6.2],
      rotation: [0.38, side * 0.18, side * -0.42]
    });
  });

  for (let i = 0; i < 3; i++) {
    const z = 12 - i * 12;
    [-1, 1].forEach((side, index) => {
      addMesh({
        parent: group,
        name: `kaiju_beetle_leg_${i}_${index}`,
        geometry: new THREE.CylinderGeometry(1.4 - i * 0.18, 0.5, 18, 8),
        material: shellDarkMat,
        position: [side * (10 + i * 2), 12 - i * 1.5, z],
        rotation: [0.18, 0, side * (1.05 - i * 0.18)]
      });
    });
  }

  return group;
};

const buildWyrm = () => {
  const group = new THREE.Group();
  group.name = 'kaiju_wyrm';

  const scaleMat = makeMaterial({ color: '#16351e', roughness: 0.74, metalness: 0.08 });
  const darkScaleMat = makeMaterial({ color: '#0c1d13', roughness: 0.82, metalness: 0.06 });
  const glowMat = makeMaterial({ color: '#365314', emissive: '#84cc16', emissiveIntensity: 0.34, roughness: 0.42, metalness: 0.06 });

  for (let i = 0; i < 8; i++) {
    const scale = 1 - i * 0.075;
    addMesh({
      parent: group,
      name: `kaiju_wyrm_segment_${i}`,
      geometry: new THREE.SphereGeometry(11 * scale, 14, 12),
      material: i < 2 ? scaleMat : darkScaleMat,
      position: [Math.sin(i * 0.35) * 5, 14 - i * 0.8, -i * 12],
      scale: [1, 0.86, 1.55]
    });
    if (i < 6) {
      addMesh({
        parent: group,
        name: `kaiju_wyrm_spine_${i}`,
        geometry: new THREE.ConeGeometry(1.8 - i * 0.12, 7.5 - i * 0.35, 5),
        material: glowMat,
        position: [Math.sin(i * 0.35) * 5, 22 - i * 0.6, -i * 12],
        rotation: [-0.4, 0, i % 2 === 0 ? 0.12 : -0.12]
      });
    }
  }

  const head = new THREE.Group();
  head.name = 'kaiju_wyrm_head';
  head.position.set(0, 18, 12);
  group.add(head);
  addMesh({
    parent: head,
    name: 'kaiju_wyrm_skull',
    geometry: new THREE.CapsuleGeometry(7.5, 12, 8, 12),
    material: scaleMat,
    rotation: [Math.PI / 2, 0, 0],
    scale: [1, 0.76, 1.34]
  });
  addMesh({
    parent: head,
    name: 'kaiju_wyrm_crest',
    geometry: new THREE.BoxGeometry(4, 5, 14),
    material: glowMat,
    position: [0, 5.2, 6]
  });

  const jaw = new THREE.Group();
  jaw.name = 'kaiju_wyrm_jaw';
  jaw.position.set(0, -2.8, 4.5);
  head.add(jaw);
  addMesh({
    parent: jaw,
    name: 'kaiju_wyrm_jaw_shell',
    geometry: new THREE.BoxGeometry(10, 4, 16),
    material: darkScaleMat,
    position: [0, -1.6, 4.8]
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: jaw,
      name: `kaiju_wyrm_fang_${index}`,
      geometry: new THREE.CylinderGeometry(0.28, 0.08, 4.4, 8),
      material: makeMaterial({ color: '#f3f4f6', roughness: 0.16, metalness: 0.08 }),
      position: [side * 2.4, -0.5, 8.2],
      rotation: [0.5, side * 0.12, side * -0.16]
    });
  });

  return group;
};

[
  buildGodzilla(),
  buildOctopus(),
  buildSpider(),
  buildSpicieBird(),
  buildBeetle(),
  buildWyrm()
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
