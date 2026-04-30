import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { textures } from './falloutTextureUtils.mjs';
import {
  addMesh,
  cloneUvToUv2,
  makeExtrudedPlanform,
  makeLatheAlongX,
  makeMaterial,
  mergeMeshGroupByMaterial,
} from './generateUtils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'fallout');
const outPath = path.join(outDir, 'airstrike_assets.glb');

const cloneTexture = (texture, repeatX = 1, repeatY = 1) => {
  if (!texture) return null;
  const clone = texture.clone();
  clone.needsUpdate = true;
  clone.repeat.set(repeatX, repeatY);
  return clone;
};

const makeDataTexture = (width, height, fillFn, { color = true } = {}) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a = 255] = fillFn(x, y, width, height);
      data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[idx + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
};

const buildBomberPlane = () => {
  const group = new THREE.Group();
  group.name = 'bomber_plane';

  const bomberPbr = (() => {
    const width = 256;
    const height = 256;
    const base = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const panelLine = panelX < 2 || panelY < 2;
      const rivet = ((panelX === 6 || panelX === 42) && (panelY === 6 || panelY === 26)) ? 1 : 0;
      const streak = Math.sin((x / width) * Math.PI * 32 + y * 0.05) * 4;
      const oxidation = Math.sin((x / width) * Math.PI * 4.2 + y * 0.018) * 7;
      const grime = Math.max(0, Math.sin((y / height) * Math.PI * 5.5 + x * 0.012)) * 5;
      const patch = ((Math.floor(x / 48) + Math.floor(y / 32)) % 2 === 0) ? -4 : 3;
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const noise = ((grain < 0 ? grain + 1 : grain) - 0.5) * 10;
      const shade = 160 + streak + oxidation - grime + patch + noise + (panelLine ? -24 : 0) + (rivet ? -34 : 0);
      return [shade, shade + 6, shade + 12, 255];
    });
    const normal = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const panelLine = panelX < 2 || panelY < 2;
      const rivet = ((panelX === 6 || panelX === 42) && (panelY === 6 || panelY === 26)) ? 1 : 0;
      const wrinkle = Math.sin((x / width) * Math.PI * 12 + y * 0.03) * 5;
      const nx = panelX < 2 ? 166 : panelX > 45 ? 90 : 128;
      const ny = panelY < 2 ? 166 : panelY > 29 ? 90 : 128;
      const bump = rivet ? 154 : 128 + wrinkle;
      return [panelLine ? nx : bump, panelLine ? ny : bump, 255, 255];
    }, { color: false });
    const roughness = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const panelLine = panelX < 2 || panelY < 2;
      const patch = ((Math.floor(x / 48) + Math.floor(y / 32)) % 3) * 8;
      const grime = Math.max(0, Math.sin((y / height) * Math.PI * 6.2 + x * 0.02)) * 18;
      const value = panelLine ? 176 : 102 + ((x + y) % 9) + patch + grime;
      return [value, value, value, 255];
    }, { color: false });
    const ao = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const edge = (panelX < 3 || panelX > 44 || panelY < 3 || panelY > 28) ? 178 : 236;
      return [edge, edge, edge, 255];
    }, { color: false });
    [base, normal, roughness, ao].forEach((texture) => texture.repeat.set(3.2, 1.8));
    return { base, normal, roughness, ao };
  })();

  const darkPbr = (() => {
    const base = textures.METAL_DARK.clone();
    base.needsUpdate = true;
    base.repeat.set(3, 3);
    const normal = makeDataTexture(128, 128, (x, y) => {
      const band = (x % 24) < 3 ? 145 : 128;
      const ripple = Math.sin((y / 128) * Math.PI * 8 + x * 0.04) * 4;
      return [band, 128 + ripple, 255, 255];
    }, { color: false });
    const roughness = makeDataTexture(128, 128, (x, y) => {
      const grime = Math.max(0, Math.sin((y / 128) * Math.PI * 5 + x * 0.06)) * 14;
      const value = 124 + grime + ((x + y) % 5);
      return [value, value, value, 255];
    }, { color: false });
    const ao = makeDataTexture(128, 128, (x, y) => {
      const edge = (x % 24) < 2 || (y % 24) < 2 ? 190 : 235;
      return [edge, edge, edge, 255];
    }, { color: false });
    [normal, roughness, ao].forEach((texture) => texture.repeat.set(3, 3));
    return { base, normal, roughness, ao };
  })();

  const glassPbr = (() => {
    const width = 128;
    const height = 128;
    const base = makeDataTexture(width, height, (x, y) => {
      const vertical = y / Math.max(1, height - 1);
      const centerBias = 1 - Math.abs((x / Math.max(1, width - 1)) * 2 - 1);
      const tint = 118 + vertical * 28 + centerBias * 12;
      return [tint - 18, tint + 10, tint + 24, 255];
    });
    const normal = makeDataTexture(width, height, (x, y) => {
      const frameLine = (x % 42) < 2 ? 148 : 128;
      const flow = Math.sin((y / height) * Math.PI * 8 + x * 0.02) * 4;
      return [frameLine, 128 + flow, 255, 255];
    }, { color: false });
    const roughness = makeDataTexture(width, height, (x, y) => {
      const vertical = y / Math.max(1, height - 1);
      const value = 78 + vertical * 18 + ((x + y) % 4);
      return [value, value, value, 255];
    }, { color: false });
    [base, normal, roughness].forEach((texture) => texture.repeat.set(1.2, 1));
    return { base, normal, roughness };
  })();

  const makeBomberMetalMaterial = ({
    color = '#9ba8b6',
    dark = false,
    emissive = '#000000',
    emissiveIntensity = 0,
    transparent = false,
    opacity = 1,
    roughness = dark ? 0.56 : 0.42,
    metalness = dark ? 0.74 : 0.78,
    side,
  } = {}) => {
    const set = dark ? darkPbr : bomberPbr;
    return makeMaterial({
      color,
      emissive,
      emissiveIntensity,
      roughness,
      metalness,
      envMapIntensity: dark ? 0.62 : 0.88,
      transparent,
      opacity,
      side,
      map: set.base,
      normalMap: set.normal,
      roughnessMap: set.roughness,
      aoMap: set.ao,
      aoMapIntensity: 0.72,
      normalScale: dark ? [0.55, 0.55] : [0.7, 0.7],
    });
  };

  const skinMat = makeBomberMetalMaterial({ color: '#97a6b4' });
  const wingMat = makeBomberMetalMaterial({ color: '#9cabb8', side: THREE.DoubleSide });
  const trimMat = makeBomberMetalMaterial({ color: '#6d7b89', dark: true });
  const darkMat = makeBomberMetalMaterial({ color: '#2a313b', dark: true });
  const antiGlareMat = makeBomberMetalMaterial({ color: '#4e5964', dark: true, roughness: 0.68, metalness: 0.36 });
  const glassMat = makeMaterial({
    color: '#9bb7c8',
    roughness: 0.12,
    metalness: 0.22,
    envMapIntensity: 1.05,
    transparent: true,
    opacity: 0.36,
    emissive: '#5f89a1',
    emissiveIntensity: 0.05,
    map: glassPbr.base,
    normalMap: glassPbr.normal,
    roughnessMap: glassPbr.roughness,
    normalScale: [0.22, 0.22],
  });
  const glowMat = makeMaterial({
    color: '#88d5ff',
    emissive: '#4fc3ff',
    emissiveIntensity: 2.4,
    transparent: true,
    opacity: 0.58,
  });

  const fuselageGeo = makeLatheAlongX([
    [0.4, -143],
    [1.7, -136],
    [3.4, -128],
    [5.6, -118],
    [7.2, -104],
    [9.0, -72],
    [9.6, -18],
    [9.9, 34],
    [10.2, 66],
    [9.2, 94],
    [7.4, 114],
    [4.1, 128],
    [1.6, 137],
    [0.5, 142],
  ], 20);
  const fuselageMesh = addMesh({ parent: group, name: 'bomber_fuselage', geometry: fuselageGeo, material: skinMat });

  addMesh({
    parent: group,
    name: 'bomber_nose_radome',
    geometry: makeLatheAlongX([
      [0.25, -24],
      [1.0, -20],
      [1.8, -12],
      [2.6, -2],
      [3.2, 10],
      [3.5, 20],
      [3.1, 27],
    ], 18),
    material: trimMat,
    position: [126, -0.1, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1.05, 0.96, 0.96],
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_deck',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(28, 4.2, 12)),
    material: skinMat,
    position: [108, 5.2, 0],
    rotation: [0, 0, -0.14],
  });
  addMesh({
    parent: group,
    name: 'bomber_nose_chine',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(22, 2.2, 10)),
    material: trimMat,
    position: [116, 2.6, 0],
    rotation: [0, 0, -0.12],
  });
  addMesh({
    parent: group,
    name: 'bomber_anti_glare',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(26, 1.2, 8.6)),
    material: antiGlareMat,
    position: [108, 8.8, 0],
    rotation: [0, 0, -0.16],
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_boat',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.6, 3.7, 18, 10)),
    material: trimMat,
    position: [-145, -0.6, 0],
    rotation: [0, 0, Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_cone',
    geometry: makeLatheAlongX([
      [0.4, -28],
      [2.2, -24],
      [4.3, -12],
      [5.3, 4],
      [4.2, 17],
      [2.1, 25],
      [0.3, 29],
    ], 18),
    material: skinMat,
    position: [-118, 4.6, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1.05, 0.82, 0.82],
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_fillet',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(36, 8, 12)),
    material: skinMat,
    position: [-108, 13.5, 0],
    rotation: [0, 0, -0.1],
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_deck',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(34, 2.2, 10)),
    material: trimMat,
    position: [-109, 18.8, 0],
    rotation: [0, 0, -0.06],
  });
  const spineMesh = addMesh({
    parent: group,
    name: 'bomber_spine',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(1.8, 110, 4, 8)),
    material: skinMat,
    position: [-2, 9.6, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1, 0.78, 0.6],
  });
  addMesh({
    parent: group,
    name: 'bomber_bomb_bay',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(76, 2.6, 20)),
    material: trimMat,
    position: [-4, -9.6, 0],
  });
  addMesh({
    parent: group,
    name: 'bomber_bay_door_left',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(74, 1.3, 8.5)),
    material: darkMat,
    position: [-4, -11.1, 5.6],
  });
  addMesh({
    parent: group,
    name: 'bomber_bay_door_right',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(74, 1.3, 8.5)),
    material: darkMat,
    position: [-4, -11.1, -5.6],
  });
  [-24, 0, 24].forEach((rackX, rackIndex) => {
    addMesh({
      parent: group,
      name: `bomber_rotary_rack_${rackIndex}`,
      geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.0, 2.4, 18, 10)),
      material: trimMat,
      position: [rackX, -8.2, 0],
      rotation: [0, 0, -Math.PI / 2],
    });
    [-1, 1].forEach((side, sideIndex) => {
      addMesh({
        parent: group,
        name: `bomber_internal_bomb_${rackIndex}_${sideIndex}`,
        geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.1, 2.8, 16, 10)),
        material: darkMat,
        position: [rackX, -12, side * 4.2],
        rotation: [0, 0, -Math.PI / 2],
      });
    });
  });

  const canopyGeo = cloneUvToUv2(new THREE.SphereGeometry(9.6, 12, 10));
  addMesh({
    parent: group,
    name: 'bomber_cockpit_canopy',
    geometry: canopyGeo,
    material: glassMat,
    position: [94, 10.2, 0],
    scale: [2.25, 0.38, 0.8],
  });
  const cockpitSillMesh = addMesh({
    parent: group,
    name: 'bomber_cockpit_sill',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(42, 3.2, 14)),
    material: skinMat,
    position: [94, 6.6, 0],
  });
  addMesh({
    parent: group,
    name: 'bomber_nav_blister',
    geometry: cloneUvToUv2(new THREE.SphereGeometry(4.7, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)),
    material: glassMat,
    position: [67, -7.5, 0],
    scale: [1.3, 0.8, 1],
  });
  addMesh({
    parent: group,
    name: 'bomber_cockpit_deck',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(54, 2.2, 12)),
    material: trimMat,
    position: [95, 11.9, 0],
    rotation: [0, 0, -0.12],
  });
  addMesh({
    parent: group,
    name: 'bomber_cockpit_frame_front',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(2.2, 7, 12.5)),
    material: trimMat,
    position: [111, 8.7, 0],
    rotation: [0, 0, -0.22],
  });
  addMesh({
    parent: group,
    name: 'bomber_cockpit_frame_mid',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(1.8, 6.4, 12)),
    material: trimMat,
    position: [96, 9.6, 0],
    rotation: [0, 0, -0.1],
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_cheek_fairing_${index}`,
      geometry: cloneUvToUv2(new THREE.SphereGeometry(6.4, 10, 8)),
      material: skinMat,
      position: [101, 3.8, side * 7],
      scale: [1.75, 0.34, 0.48],
    });
  });

  const wingGeometry = makeExtrudedPlanform([
    [46, 12],
    [-12, 68],
    [-102, 178],
    [-132, 178],
    [-64, 36],
    [18, 10],
  ], 6.5, -3.2);
  wingGeometry.rotateX(-0.045);
  wingGeometry.rotateZ(-0.02);

  addMesh({ parent: group, name: 'bomber_wing_right', geometry: wingGeometry, material: wingMat });
  addMesh({ parent: group, name: 'bomber_wing_left', geometry: wingGeometry, material: wingMat, scale: [1, 1, -1] });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_wing_root_fairing_${index}`,
      geometry: cloneUvToUv2(new THREE.SphereGeometry(13, 12, 10)),
      material: skinMat,
      position: [2, -1.8, side * 20],
      scale: [1.55, 0.38, 1.18],
    });
    addMesh({
      parent: group,
      name: `bomber_wing_glove_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(38, 4.8, 24)),
      material: skinMat,
      position: [24, -2.6, side * 28],
      rotation: [0, 0, side * -0.08],
    });
    addMesh({
      parent: group,
      name: `bomber_tip_pod_${index}`,
      geometry: makeLatheAlongX([
        [0.5, -11],
        [2.0, -8],
        [2.9, -1],
        [2.9, 5],
        [2.1, 10],
        [0.6, 13],
      ], 16),
      material: trimMat,
      position: [-109, -7.8, side * 182],
      rotation: [0, 0, 0],
      scale: [0.92, 0.92, 0.92],
    });
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_tail_root_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(34, 4.4, 16)),
      material: trimMat,
      position: [-104, 10.6, side * 24],
      rotation: [0, 0, side * -0.08],
    });
  });

  const finGeo = makeExtrudedPlanform([
    [-92, 0],
    [-126, 0],
    [-137, 18],
    [-131, 72],
    [-113, 86],
    [-96, 58],
  ], 5.4, -2.7);
  addMesh({ parent: group, name: 'bomber_vertical_fin', geometry: finGeo, material: wingMat });
  addMesh({
    parent: group,
    name: 'bomber_fin_cap',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(14, 2.6, 6)),
    material: trimMat,
    position: [-116, 84, 0],
    rotation: [0, 0, -0.18],
  });

  const stabGeometry = makeExtrudedPlanform([
    [-92, 8],
    [-116, 20],
    [-142, 42],
    [-138, 58],
    [-112, 52],
    [-82, 18],
  ], 3.2, -1.6);
  stabGeometry.rotateX(-0.03);
  addMesh({ parent: group, name: 'bomber_stab_right', geometry: stabGeometry, material: wingMat });
  addMesh({ parent: group, name: 'bomber_stab_left', geometry: stabGeometry, material: wingMat, scale: [1, 1, -1] });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_stab_fairing_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(18, 3.2, 8)),
      material: skinMat,
      position: [-97, 9.4, side * 17],
      rotation: [0, 0, side * -0.1],
    });
  });

  const nacelleProfile = [
    [3.5, -24],
    [4.4, -18],
    [5.0, -3],
    [5.4, 12],
    [4.9, 23],
    [4.0, 28],
  ];
  const pylonDefs = [
    { z: -46, x: -6, label: 'inner_left' },
    { z: -104, x: -26, label: 'outer_left' },
    { z: 46, x: -6, label: 'inner_right' },
    { z: 104, x: -26, label: 'outer_right' },
  ];
  const nacelleGeo = makeLatheAlongX(nacelleProfile, 16);
  const intakeGeo = cloneUvToUv2(new THREE.TorusGeometry(5.25, 0.75, 8, 12));
  const nozzleGeo = cloneUvToUv2(new THREE.CylinderGeometry(2.7, 3.7, 10, 10));
  const exhaustGlowGeo = cloneUvToUv2(new THREE.CylinderGeometry(2.8, 4.2, 18, 10));
  pylonDefs.forEach(({ z, x, label }, pairIdx) => {
    const pylonPoints = z > 0
      ? [[x + 10, z - 5], [x - 4, z - 5], [x - 18, z + 5], [x + 4, z + 5]]
      : [[x + 10, z + 5], [x - 4, z + 5], [x - 18, z - 5], [x + 4, z - 5]];
    const pylonGeo = makeExtrudedPlanform(pylonPoints, 20, -22);
    addMesh({ parent: group, name: `bomber_pylon_${label}`, geometry: pylonGeo, material: trimMat });
    addMesh({
      parent: group,
      name: `bomber_cradle_${label}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(54, 4.5, 10)),
      material: trimMat,
      position: [x - 4, -22, z],
    });

    [15, -15].forEach((xOffset, engineIndex) => {
      const index = pairIdx * 2 + engineIndex;
      addMesh({
        parent: group,
        name: `bomber_nacelle_${index}`,
        geometry: nacelleGeo,
        material: darkMat,
        position: [x + xOffset, -22, z],
      });
      addMesh({
        parent: group,
        name: `bomber_intake_${index}`,
        geometry: intakeGeo,
        material: trimMat,
        position: [x + xOffset + 28, -22, z],
        rotation: [0, Math.PI / 2, 0],
      });
      addMesh({
        parent: group,
        name: `bomber_nozzle_${index}`,
        geometry: nozzleGeo,
        material: trimMat,
        position: [x + xOffset - 29, -22, z],
        rotation: [0, 0, -Math.PI / 2],
      });
      if (engineIndex === 0) {
        addMesh({
          parent: group,
          name: `bomber_exhaust_glow_${pairIdx}`,
          geometry: exhaustGlowGeo,
          material: glowMat,
          position: [x + xOffset - 40, -22, z],
          rotation: [0, 0, -Math.PI / 2],
        });
      }
    });
  });
  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_root_strake_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(28, 1.8, 34)),
      material: wingMat,
      position: [52, -1.6, side * 22],
      rotation: [0, 0, side * -0.1],
    });
  });

  mergeMeshGroupByMaterial({
    parent: group,
    name: 'bomber_hull_merged',
    meshes: [fuselageMesh, spineMesh, cockpitSillMesh],
  });

  for (let index = 0; index < 4; index++) {
    const propGroup = new THREE.Group();
    propGroup.name = `bomber_prop_${index}`;
    propGroup.position.set(0, -1000 - index, 0);
    group.add(propGroup);
  }

  [-96, 96].forEach((z, index) => {
    addMesh({
      parent: group,
      name: `bomber_insignia_${index}`,
      geometry: cloneUvToUv2(new THREE.CircleGeometry(12.5, 24)),
      material: makeMaterial({ color: '#274f9a', transparent: true, opacity: 0.82 }),
      position: [-14, 3.5, z],
      rotation: [-Math.PI / 2, 0, 0],
    });
    addMesh({
      parent: group,
      name: `bomber_star_${index}`,
      geometry: cloneUvToUv2(new THREE.CircleGeometry(5.8, 5)),
      material: makeMaterial({ color: '#eef2f7', transparent: true, opacity: 0.9 }),
      position: [-14, 3.7, z],
      rotation: [-Math.PI / 2, 0, Math.PI / 10],
    });
  });

  return group;
};

const buildParachuteNuke = () => {
  const group = new THREE.Group();
  group.name = 'nuke_bomb';

  const bombMat = makeMaterial({ color: '#5f6974', roughness: 0.24, metalness: 0.82, map: cloneTexture(textures.METAL_GREY, 2.4, 1.7) });
  const trimMat = makeMaterial({ color: '#93a0ad', roughness: 0.3, metalness: 0.7, map: cloneTexture(textures.RIVET_METAL, 2.8, 1.6) });
  const darkMat = makeMaterial({ color: '#141b24', roughness: 0.26, metalness: 0.74, map: cloneTexture(textures.METAL_DARK, 3.2, 2.2) });
  const stripeMat = makeMaterial({ color: '#facc15', roughness: 0.36, metalness: 0.08, emissive: '#f59e0b', emissiveIntensity: 0.22 });
  const accentMat = makeMaterial({ color: '#ef4444', roughness: 0.42, metalness: 0.12, emissive: '#ef4444', emissiveIntensity: 0.12 });
  const canopyMat = makeMaterial({ color: '#b91c1c', roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide });
  const canopyAccentMat = makeMaterial({ color: '#fecaca', roughness: 0.74, metalness: 0.08, side: THREE.DoubleSide });
  const canopyFrameMat = makeMaterial({ color: '#7f1d1d', roughness: 0.54, metalness: 0.22 });
  const fabricGlowMat = makeMaterial({ color: '#ffe29a', emissive: '#ffd166', emissiveIntensity: 0.8, transparent: true, opacity: 0.22 });
  const cordMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });

  addMesh({
    parent: group,
    name: 'nuke_body',
    geometry: makeLatheAlongX([
      [0.16, -40], [1.8, -37], [4.4, -30], [6.8, -16], [7.6, -4], [7.8, 10], [7.0, 24], [5.1, 36], [2.3, 44], [0.2, 47],
    ], 32),
    material: bombMat,
    rotation: [0, Math.PI / 2, 0],
  });
  addMesh({
    parent: group,
    name: 'nuke_mid_band',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(7.7, 7.7, 7, 28)),
    material: trimMat,
    position: [8, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_shoulder_ring',
    geometry: new THREE.TorusGeometry(7.9, 0.8, 10, 26),
    material: trimMat,
    position: [18, 0, 0],
    rotation: [0, Math.PI / 2, 0],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.6, 6.2, 22, 20)),
    material: darkMat,
    position: [-28, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail_cap',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(3.9, 12, 16)),
    material: darkMat,
    position: [-45, 0, 0],
    rotation: [0, 0, Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail_motor',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.8, 3.5, 8.4, 16)),
    material: trimMat,
    position: [-36, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_band',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(7.9, 7.9, 2.6, 26)),
    material: stripeMat,
    position: [19, 0, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'nuke_nose_cap',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(2.2, 9, 16)),
    material: accentMat,
    position: [45, 0, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'nuke_nose_sensor',
    geometry: cloneUvToUv2(new THREE.SphereGeometry(1.8, 12, 10)),
    material: accentMat,
    position: [41.5, 0, 0],
  });
  [1, -1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_${index}`,
      geometry: makeExtrudedPlanform([
        [-28, side * 2.4],
        [-46, side * 9.6],
        [-43, side * 16.8],
        [-18, side * 6.0],
      ], 1.0, -0.5),
      material: darkMat,
    });
    addMesh({
      parent: group,
      name: `nuke_fin_cross_${index}`,
      geometry: makeExtrudedPlanform([
        [-28, side * 2.4],
        [-46, side * 9.6],
        [-43, side * 16.8],
        [-18, side * 6.0],
      ], 1.0, -0.5),
      material: darkMat,
      rotation: [Math.PI / 2, 0, 0],
    });
  });
  [1, -1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `nuke_body_strake_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(26, 1.0, 5.0)),
      material: trimMat,
      position: [-2, side * 0.2, side * 7.5],
      rotation: [side * 0.08, 0, 0],
    });
    addMesh({
      parent: group,
      name: `nuke_tail_fin_side_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(12, 0.9, 9.6)),
      material: trimMat,
      position: [-33.5, 0, side * 5.8],
      rotation: [0, 0, side * 0.1],
    });
  });
  addMesh({
    parent: group,
    name: 'nuke_tail_fin_top',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(12, 10.4, 0.9)),
    material: trimMat,
    position: [-33.5, 6.0, 0],
    rotation: [0, 0, 0.1],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail_fin_bottom',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(12, 10.4, 0.9)),
    material: trimMat,
    position: [-33.5, -6.0, 0],
    rotation: [0, 0, -0.1],
  });
  addMesh({
    parent: group,
    name: 'nuke_access_panel',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(15, 5.4, 0.56)),
    material: trimMat,
    position: [10, 1.0, 7.45],
  });
  [0, 1, 2].forEach((index) => {
    addMesh({
      parent: group,
      name: `nuke_service_panel_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(5.2, 2.2, 0.44)),
      material: index === 1 ? accentMat : trimMat,
      position: [18 - index * 10, index === 1 ? -2.5 : 2.4, 7.42],
      rotation: [0, 0, index === 1 ? 0.08 : -0.04]
    });
  });

  const chuteRoot = new THREE.Group();
  chuteRoot.name = 'nuke_parachute';
  chuteRoot.position.set(0, 38, 0);
  group.add(chuteRoot);

  const canopySegmentCount = 10;
  for (let segment = 0; segment < canopySegmentCount; segment++) {
    const angle = (segment / canopySegmentCount) * Math.PI * 2;
    addMesh({
      parent: chuteRoot,
      name: `nuke_canopy_panel_${segment}`,
      geometry: cloneUvToUv2(new THREE.SphereGeometry(17.5, 12, 10, 0, Math.PI / 5, 0, Math.PI / 2.25)),
      material: segment % 2 === 0 ? canopyMat : canopyAccentMat,
      position: [Math.cos(angle) * 5.8, segment % 2 === 0 ? 0 : 0.5, Math.sin(angle) * 5.8],
      rotation: [0, -angle, 0],
      scale: [1.6, 0.96, 1.14],
    });
  }
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_ring',
    geometry: new THREE.TorusGeometry(24.4, 1.0, 10, 32),
    material: canopyFrameMat,
    position: [0, -0.2, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_vent',
    geometry: new THREE.SphereGeometry(7.2, 12, 10),
    material: fabricGlowMat,
    position: [0, 6.8, 0],
    scale: [1, 0.55, 1]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_cap',
    geometry: new THREE.CylinderGeometry(4.8, 6.4, 3.2, 10),
    material: canopyFrameMat,
    position: [0, 7.2, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_canopy_skirt',
    geometry: new THREE.TorusGeometry(18.6, 1.4, 8, 28),
    material: canopyAccentMat,
    position: [0, -2.8, 0],
    rotation: [Math.PI / 2, 0, 0]
  });
  addMesh({
    parent: chuteRoot,
    name: 'nuke_harness',
    geometry: new THREE.CylinderGeometry(1.5, 1.9, 7.5, 10),
    material: trimMat,
    position: [0, -11, 0]
  });
  [0, 1, 2, 3].forEach((index) => {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    addMesh({
      parent: chuteRoot,
      name: `nuke_harness_arm_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(8.8, 0.55, 0.75)),
      material: canopyFrameMat,
      position: [Math.cos(angle) * 3.3, -8.2, Math.sin(angle) * 3.3],
      rotation: [0, -angle, 0]
    });
  });

  const cordsRoot = new THREE.Group();
  cordsRoot.name = 'nuke_cords_root';
  group.add(cordsRoot);

  [
    [-13, 36, -10],
    [-4, 35, -15],
    [4, 35, -15],
    [13, 36, -10],
    [-15, 35, 0],
    [15, 35, 0],
    [-13, 36, 10],
    [-4, 35, 15],
    [4, 35, 15],
    [13, 36, 10]
  ].forEach(([x, y, z], index) => {
    addMesh({
      parent: cordsRoot,
      name: `nuke_cord_${index}`,
      geometry: new THREE.CylinderGeometry(0.12, 0.12, 36, 6),
      material: cordMat,
      position: [x * 0.48, y * 0.48, z * 0.48],
      rotation: [0.72, 0, Math.atan2(z, x) * 0.28]
    });
  });
  [
    [-4.4, 19, -4.4],
    [4.4, 19, -4.4],
    [-4.4, 19, 4.4],
    [4.4, 19, 4.4]
  ].forEach((point, index) => {
    addMesh({
      parent: cordsRoot,
      name: `nuke_bridle_${index}`,
      geometry: new THREE.CylinderGeometry(0.15, 0.15, 14, 6),
      material: cordMat,
      position: point,
      rotation: [0.38, 0, index < 2 ? -0.32 : 0.32]
    });
  });

  addMesh({
    parent: group,
    name: 'nuke_status_glow',
    geometry: new THREE.SphereGeometry(2.4, 10, 10),
    material: makeMaterial({ color: '#fb7185', emissive: '#ef4444', emissiveIntensity: 2.4, transparent: true, opacity: 0.32 }),
    position: [15, -1.2, 0]
  });

  return group;
};

const buildStrikeJet = () => {
  const group = new THREE.Group();
  group.name = 'strike_jet';

  const bodyMat = makeMaterial({ color: '#b0bdcb', roughness: 0.28, metalness: 0.7, emissive: '#b0bdcb', emissiveIntensity: 0.05, map: cloneTexture(textures.RIVET_METAL, 2.8, 1.8) });
  const trimMat = makeMaterial({ color: '#7c8a9a', roughness: 0.36, metalness: 0.56, map: cloneTexture(textures.METAL_GREY, 3, 2) });
  const darkMat = makeMaterial({ color: '#46515e', roughness: 0.24, metalness: 0.64, map: cloneTexture(textures.METAL_DARK, 3, 2) });
  const glassMat = makeMaterial({ color: '#8eb7d0', roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.52 });
  const glowMat = makeMaterial({ color: '#38bdf8', emissive: '#67e8f9', emissiveIntensity: 1.8, transparent: true, opacity: 0.42 });

  addMesh({
    parent: group,
    name: 'jet_fuselage',
    geometry: makeLatheAlongX([
      [0.16, -92], [1.8, -86], [4.6, -66], [8.6, -24], [9.8, 8], [8.6, 30], [6.4, 56], [3.2, 80], [0.24, 92],
    ], 28),
    material: bodyMat,
    rotation: [0, Math.PI / 2, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_nose',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(3.1, 28, 18)),
    material: trimMat,
    position: [104, 0.2, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'jet_canopy',
    geometry: new THREE.SphereGeometry(7.4, 20, 16),
    material: glassMat,
    position: [36, 9.8, 0],
    scale: [2.1, 0.62, 0.86]
  });
  addMesh({
    parent: group,
    name: 'jet_canopy_frame',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(18, 1.2, 8.8)),
    material: trimMat,
    position: [36, 10.1, 0],
    rotation: [0, 0, -0.08]
  });
  addMesh({
    parent: group,
    name: 'jet_spine',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(2.6, 52, 5, 10)),
    material: trimMat,
    position: [6, 8.4, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1.08, 0.7, 0.78]
  });
  addMesh({
    parent: group,
    name: 'jet_main_wing',
    geometry: makeExtrudedPlanform([
      [28, 10], [0, 44], [-28, 88], [-74, 134], [-104, 132], [-70, 50], [-26, 20], [12, 12],
    ], 2.8, -1.4),
    material: bodyMat,
    position: [4, -0.2, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_lerx',
    geometry: makeExtrudedPlanform([
      [30, 9], [12, 28], [-8, 40], [-24, 18], [2, 8],
    ], 2.2, -1.1),
    material: trimMat,
    position: [18, 1.8, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_engine_block',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(34, 10, 18)),
    material: darkMat,
    position: [-58, 1.2, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_centerline_tank',
    geometry: new THREE.CylinderGeometry(2.9, 3.6, 34, 14),
    material: trimMat,
    position: [-18, -6.2, 0],
    rotation: [0, 0, -Math.PI / 2]
  });

  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_wingtip_left' : 'jet_wingtip_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-74, -132], [-96, -150], [-110, -146], [-96, -120]]
        : [[-74, 132], [-96, 120], [-110, 146], [-96, 150]], 1.8, -0.8),
      material: trimMat,
      position: [0, 0.1, 0]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_tailplane_left' : 'jet_tailplane_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-42, -12], [-68, -30], [-92, -42], [-72, -18]]
        : [[-42, 12], [-72, 18], [-92, 42], [-68, 30]], 2, -0.9),
      material: trimMat,
      position: [0, 6.2, 0]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_stabilizer_left' : 'jet_stabilizer_right',
      geometry: makeExtrudedPlanform([
        [-56, 0], [-78, 0], [-70, 34], [-60, 28],
      ], 2.2, side * 7),
      material: trimMat,
      position: [0, 6.2, 0],
      rotation: [0.02, 0, side * 0.28]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_intake_left' : 'jet_intake_right',
      geometry: makeLatheAlongX([[3.2, -14], [5.1, -9], [6.1, 0], [5.4, 9], [4.2, 15]], 20),
      material: darkMat,
      position: [12, -0.8, side * 13.2],
      scale: [1.1, 1.05, 1]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_afterburner_left' : 'jet_afterburner_right',
      geometry: new THREE.CylinderGeometry(2.8, 1.6, 16, 14),
      material: glowMat,
      position: [-78, 0.6, side * 5.4],
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_engine_pod_left' : 'jet_engine_pod_right',
      geometry: makeLatheAlongX([[2.2, -18], [4.8, -12], [6, 0], [5.4, 11], [3.4, 18]], 18),
      material: darkMat,
      position: [-60, 4.5, side * 5.4],
      rotation: [0, Math.PI / 2, 0]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_pylon_left' : 'jet_pylon_right',
      geometry: new THREE.BoxGeometry(14, 2.2, 6),
      material: darkMat,
      position: [-24, -4.4, side * 42]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_missile_left' : 'jet_missile_right',
      geometry: new THREE.CylinderGeometry(1.15, 1.35, 24, 12),
      material: trimMat,
      position: [-18, -6.4, side * 42],
      rotation: [0, 0, -Math.PI / 2]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_outer_pylon_left' : 'jet_outer_pylon_right',
      geometry: new THREE.BoxGeometry(10, 1.8, 5),
      material: darkMat,
      position: [-54, -3.8, side * 88]
    });
  });

  addMesh({
    parent: group,
    name: 'jet_targeting_pod',
    geometry: new THREE.CylinderGeometry(1.8, 2.1, 14, 10),
    material: darkMat,
    position: [8, -5.2, -11],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'jet_targeting_glow',
    geometry: new THREE.SphereGeometry(1.6, 10, 10),
    material: glowMat,
    position: [15, -5.2, -11]
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

  const hullMat = makeMaterial({ color: hullColor, roughness: 0.54, metalness: 0.34, emissive: hullColor, emissiveIntensity: 0.08, map: cloneTexture(textures.CAMO, 2.6, 1.4) });
  const turretMat = makeMaterial({ color: turretColor, roughness: 0.46, metalness: 0.4, emissive: turretColor, emissiveIntensity: 0.07, map: cloneTexture(textures.CAMO, 2.2, 1.4) });
  const trackMat = makeMaterial({ color: '#434c58', roughness: 0.72, metalness: 0.22, map: cloneTexture(textures.METAL_DARK, 4, 1.5) });
  const trimMat = makeMaterial({ color: '#7b8794', roughness: 0.42, metalness: 0.46, map: cloneTexture(textures.METAL_GREY, 2, 2) });
  const rubberMat = makeMaterial({ color: '#15181d', roughness: 0.9, metalness: 0.08, map: cloneTexture(textures.METAL_DARK, 3.8, 1.8) });
  const stowageMat = makeMaterial({ color: apc ? '#6e6254' : '#72634d', roughness: 0.88, metalness: 0.06, map: cloneTexture(textures.CAMO, 1.6, 1.2) });
  const glowMat = makeMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.45, transparent: true, opacity: 0.38 });

  const hullBaseLength = hullLength * (apc ? 1.02 : 1.08);
  const hullBaseWidth = hullWidth * (apc ? 1.02 : 1.1);
  const hullLowerHeight = hullHeight * 0.38;
  const trackOffsetZ = hullBaseWidth * 0.46;
  const sideSkirtWidth = apc ? 2.1 : 1.9;
  const sideSkirtY = hullHeight * 0.44;
  const upperDeckY = hullHeight * 0.74;
  const roadWheelRadius = apc ? 3.7 : 4.2;
  const roadWheelWidth = apc ? 3.2 : 3.5;
  const roadWheelCount = apc ? 4 : 5;

  addMesh({
    parent: group,
    name: 'vehicle_hull_base',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(hullBaseLength, hullLowerHeight, hullBaseWidth)),
    material: rubberMat,
    position: [-hullLength * 0.04, hullLowerHeight * 0.5 + 1.2, 0]
  });
  addMesh({
    parent: group,
    name: 'vehicle_upper_hull',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.62, hullHeight * 0.46, hullWidth * 0.88)),
    material: hullMat,
    position: [-hullLength * (apc ? 0.08 : 0.12), upperDeckY, 0]
  });
  addMesh({
    parent: group,
    name: 'vehicle_glacis',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * (apc ? 0.26 : 0.3), hullHeight * 0.42, hullWidth * 0.9)),
    material: trimMat,
    position: [hullLength * (apc ? 0.22 : 0.24), hullHeight * 0.6, 0],
    rotation: [0, 0, apc ? -0.18 : -0.22]
  });
  addMesh({
    parent: group,
    name: 'vehicle_driver_block',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.24, hullHeight * 0.18, hullWidth * 0.62)),
    material: trimMat,
    position: [-hullLength * (apc ? 0.12 : 0.2), hullHeight * 0.88, 0]
  });
  addMesh({
    parent: group,
    name: 'vehicle_rear_deck',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.32, hullHeight * 0.22, hullWidth * 0.72)),
    material: trimMat,
    position: [-hullLength * 0.28, hullHeight * 0.92, 0]
  });

  [-1, 1].forEach((side, sideIndex) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'vehicle_track_left' : 'vehicle_track_right',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.94, hullHeight * 0.34, hullWidth * 0.12)),
      material: trackMat,
      position: [-hullLength * 0.02, hullHeight * 0.18, side * trackOffsetZ]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'vehicle_track_guard_left' : 'vehicle_track_guard_right',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.88, hullHeight * 0.24, sideSkirtWidth)),
      material: trimMat,
      position: [-hullLength * 0.02, sideSkirtY, side * (trackOffsetZ + 0.4)]
    });

    const wheelSpan = hullLength * (apc ? 0.76 : 0.82);
    const wheelStart = -wheelSpan * 0.5;
    const wheelStep = roadWheelCount > 1 ? wheelSpan / (roadWheelCount - 1) : 0;
    for (let wheelIndex = 0; wheelIndex < roadWheelCount; wheelIndex += 1) {
      addMesh({
        parent: group,
        name: `vehicle_road_wheel_${sideIndex}_${wheelIndex}`,
        geometry: new THREE.CylinderGeometry(roadWheelRadius, roadWheelRadius, roadWheelWidth, 18),
        material: wheelIndex % 2 === 0 ? trimMat : trackMat,
        position: [wheelStart + wheelStep * wheelIndex, roadWheelRadius * 0.66, side * trackOffsetZ],
        rotation: [Math.PI / 2, 0, 0]
      });
    }

    [-hullLength * 0.5, hullLength * 0.5].forEach((wheelX, idlerIndex) => {
      addMesh({
        parent: group,
        name: `vehicle_end_wheel_${sideIndex}_${idlerIndex}`,
        geometry: new THREE.CylinderGeometry(roadWheelRadius * 1.22, roadWheelRadius * 1.22, roadWheelWidth * 1.08, 20),
        material: idlerIndex === 0 ? trimMat : trackMat,
        position: [wheelX, roadWheelRadius * 1.08, side * trackOffsetZ],
        rotation: [Math.PI / 2, 0, 0]
      });
    });

    addMesh({
      parent: group,
      name: `vehicle_exhaust_glow_${sideIndex}`,
      geometry: new THREE.CylinderGeometry(1.45, 1.05, 8, 10),
      material: glowMat,
      position: [-hullLength * 0.42, hullHeight * 0.7, side * (apc ? 4.6 : 5.6)],
      rotation: [0, 0, -Math.PI / 2]
    });
  });

  [-hullLength * 0.22, -2, hullLength * 0.18].forEach((stowX, idx) => {
    addMesh({
      parent: group,
      name: `vehicle_stowage_${idx}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.1, hullHeight * 0.18, hullWidth * 0.44)),
      material: idx === 1 ? trimMat : stowageMat,
      position: [stowX, hullHeight * 1.02, 0]
    });
  });

  if (apc) {
    addMesh({
      parent: group,
      name: 'vehicle_troop_compartment',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.54, hullHeight * 0.76, hullWidth * 0.78)),
      material: turretMat,
      position: [-hullLength * 0.04, hullHeight * 1.34, 0]
    });
    addMesh({
      parent: group,
      name: 'vehicle_troop_front',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.2, hullHeight * 0.42, hullWidth * 0.72)),
      material: hullMat,
      position: [hullLength * 0.2, hullHeight * 1.4, 0],
      rotation: [0, 0, -0.16]
    });
    addMesh({
      parent: group,
      name: 'vehicle_rear_door',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(hullLength * 0.12, hullHeight * 0.6, hullWidth * 0.62)),
      material: trimMat,
      position: [-hullLength * 0.48, hullHeight * 1.2, 0]
    });
  }

  const turretRoot = new THREE.Group();
  turretRoot.name = 'vehicle_turret_root';
  turretRoot.position.set(apc ? hullLength * 0.24 : hullLength * 0.08, apc ? hullHeight * 1.56 : hullHeight * 1.48, 0);
  group.add(turretRoot);

  if (apc) {
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_body',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(12, 6, 12)),
      material: turretMat,
      position: [0, 0, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_cheek',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(8, 4, 10)),
      material: hullMat,
      position: [4.5, 0.6, 0],
      rotation: [0, 0, -0.12]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_cupola',
      geometry: new THREE.CylinderGeometry(2.2, 2.5, 2.2, 14),
      material: trimMat,
      position: [-2.2, 3, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_sensor_glow',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(2.6, 1.5, 3.8)),
      material: glowMat,
      position: [3.4, 2.2, 0]
    });
  } else {
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_ring',
      geometry: new THREE.CylinderGeometry(turretRadius * 0.76, turretRadius * 0.88, 2, 20),
      material: trimMat,
      position: [-1.4, -1.8, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_body',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(18, 7, 20)),
      material: turretMat,
      position: [0, 0, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_front',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(11, 5, 18)),
      material: hullMat,
      position: [7, 0.8, 0],
      rotation: [0, 0, -0.14]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_bustle',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(8, 4, 16)),
      material: hullMat,
      position: [-8, 1.2, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_turret_roof',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(7, 1.4, 9)),
      material: trimMat,
      position: [-6.2, 4.2, 0]
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_cupola',
      geometry: new THREE.CylinderGeometry(2.1, 2.4, 2.2, 14),
      material: trimMat,
      position: [-2.5, 4, 0]
    });
    [-1, 1].forEach((side, cheekIndex) => {
      addMesh({
        parent: turretRoot,
        name: `vehicle_turret_cheek_${cheekIndex}`,
        geometry: cloneUvToUv2(new THREE.BoxGeometry(8, 4.2, 7.5)),
        material: hullMat,
        position: [8.6, -0.7, side * 4.8],
        rotation: [0, side > 0 ? 0.22 : -0.22, -0.18]
      });
    });
    addMesh({
      parent: turretRoot,
      name: 'vehicle_sensor_glow',
      geometry: cloneUvToUv2(new THREE.BoxGeometry(2.9, 1.7, 4.2)),
      material: glowMat,
      position: [6.2, 2.2, 0]
    });
  }

  addMesh({
    parent: turretRoot,
    name: 'vehicle_barrel_shroud',
    geometry: new THREE.CylinderGeometry(apc ? 1.35 : 1.75, apc ? 1.65 : 2.1, apc ? 12 : 16, 14),
    material: trimMat,
    position: [apc ? 10.2 : 15.8, apc ? 0.4 : 0.8, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: turretRoot,
    name: 'vehicle_barrel',
    geometry: new THREE.CylinderGeometry(apc ? 0.68 : 0.82, apc ? 0.78 : 0.94, apc ? 15 : barrelLength, 14),
    material: trackMat,
    position: [apc ? 17.6 : (barrelLength * 0.5 + 15.8), apc ? 0.4 : 0.8, 0],
    rotation: [0, 0, -Math.PI / 2]
  });

  if (!apc) {
    addMesh({
      parent: turretRoot,
      name: 'vehicle_muzzle_brake',
      geometry: new THREE.CylinderGeometry(1.15, 1.15, 3.8, 12),
      material: trimMat,
      position: [barrelLength + 15.9, 0.8, 0],
      rotation: [0, 0, -Math.PI / 2]
    });
  }

  addMesh({
    parent: turretRoot,
    name: 'vehicle_muzzle_glow',
    geometry: new THREE.SphereGeometry(apc ? 1.3 : 1.5, 10, 10),
    material: glowMat,
    position: [apc ? 25.4 : barrelLength + 18.1, apc ? 0.4 : 0.8, 0]
  });

  return group;
};

const buildA10Warthog = () => {
  const group = new THREE.Group();
  group.name = 'a10_warthog';

  // A-10 Thunderbolt II (Warthog) — distinctive ground-attack aircraft
  // with straight wings, twin podded rear engines, twin tails, and GAU-8 nose cannon
  const bodyMat    = makeMaterial({ color: '#5c6355', roughness: 0.52, metalness: 0.38, emissive: '#5c6355', emissiveIntensity: 0.05, map: cloneTexture(textures.OLIVE_METAL, 2.8, 1.6) });
  const trimMat    = makeMaterial({ color: '#3e4739', roughness: 0.60, metalness: 0.30, map: cloneTexture(textures.CAMO, 2.4, 1.6) });
  const darkMat    = makeMaterial({ color: '#1c201b', roughness: 0.22, metalness: 0.68, map: cloneTexture(textures.METAL_DARK, 3, 2) });
  const alumMat    = makeMaterial({ color: '#8a9490', roughness: 0.28, metalness: 0.72, map: cloneTexture(textures.RIVET_METAL, 2.6, 1.5) });
  const glassMat   = makeMaterial({ color: '#8ecad8', roughness: 0.05, metalness: 0.88, transparent: true, opacity: 0.50 });
  const glowMat    = makeMaterial({ color: '#60a5fa', emissive: '#38bdf8', emissiveIntensity: 1.6, transparent: true, opacity: 0.36 });
  const muzzleGlow = makeMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 2.0, transparent: true, opacity: 0.0 });
  const rubberMat  = makeMaterial({ color: '#4a5240', roughness: 0.64, metalness: 0.18 });

  // ── FUSELAGE ──
  addMesh({
    parent: group, name: 'warthog_fuselage',
    geometry: makeLatheAlongX([
      [0.4, -84], [6.8, -76], [10.8, -56], [13.5, -18], [13.8, 18], [12.4, 46], [8.4, 72], [3.6, 90], [0.6, 98],
    ], 28),
    material: bodyMat,
    position: [-2, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 0.86, 1.02]
  });
  addMesh({
    parent: group, name: 'warthog_spine',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(3.4, 62, 4, 10)),
    material: trimMat,
    position: [6, 9.5, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1, 0.76, 0.72]
  });
  addMesh({
    parent: group, name: 'warthog_belly',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(2.2, 64, 4, 8)),
    material: trimMat,
    position: [-4, -9.4, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1, 0.7, 0.72]
  });
  addMesh({
    parent: group, name: 'warthog_nose_section',
    geometry: makeLatheAlongX([[0.5, -24], [4, -18], [7.2, -6], [9.4, 10], [10.8, 22]], 20),
    material: bodyMat,
    position: [78, -1, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 0.94, 0.96]
  });
  addMesh({
    parent: group, name: 'warthog_tail_section',
    geometry: makeLatheAlongX([[0.5, -22], [4.8, -16], [8.6, -4], [10.8, 18]], 18),
    material: bodyMat,
    position: [-70, 2, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 0.88, 0.9]
  });
  addMesh({
    parent: group, name: 'warthog_tail_cap',
    geometry: new THREE.SphereGeometry(7, 12, 10),
    material: trimMat,
    position: [-79, 2, 0],
    scale: [1.2, 0.82, 0.82]
  });

  // ── NOSE ── pointed, with the GAU-8 slightly offset left-below-center
  addMesh({
    parent: group, name: 'warthog_nose_tip',
    geometry: new THREE.ConeGeometry(8.5, 22, 16),
    material: trimMat,
    position: [91, -1.5, -1.8],
    rotation: [0, 0, -Math.PI / 2]
  });
  addMesh({
    parent: group, name: 'warthog_nose_cone',
    geometry: new THREE.SphereGeometry(8.5, 14, 10),
    material: bodyMat,
    position: [84, -1, -1.2],
    scale: [1.15, 0.88, 0.88]
  });

  // ── GAU-8 AVENGER – 7-barrel Gatling rotary cannon cluster in the nose ──
  // The barrel housing — large cylinder offset slightly left and below center
  addMesh({
    parent: group, name: 'warthog_gau8_housing',
    geometry: new THREE.CylinderGeometry(5.2, 5.8, 28, 14),
    material: darkMat,
    position: [73, -5.5, -2.5],
    rotation: [0, 0, -Math.PI / 2]
  });
  // GAU-8 barrel shroud
  addMesh({
    parent: group, name: 'warthog_gau8_shroud',
    geometry: new THREE.CylinderGeometry(3.8, 4.8, 18, 12),
    material: alumMat,
    position: [88, -5.5, -2.5],
    rotation: [0, 0, -Math.PI / 2]
  });
  // 7-barrel cluster (outer ring of 6 + 1 centre)
  const barrelOffset = 2.5;
  for (let b = 0; b < 6; b++) {
    const ang = (b / 6) * Math.PI * 2;
    addMesh({
      parent: group, name: `warthog_barrel_${b}`,
      geometry: new THREE.CylinderGeometry(0.65, 0.65, 22, 7),
      material: darkMat,
      position: [96, -5.5 + Math.sin(ang) * barrelOffset, -2.5 + Math.cos(ang) * barrelOffset],
      rotation: [0, 0, -Math.PI / 2]
    });
  }
  addMesh({
    parent: group, name: 'warthog_barrel_centre',
    geometry: new THREE.CylinderGeometry(0.7, 0.7, 22, 8),
    material: alumMat,
    position: [96, -5.5, -2.5],
    rotation: [0, 0, -Math.PI / 2]
  });
  // Muzzle flash plane (invisible by default — set visible when firing)
  addMesh({
    parent: group, name: 'warthog_muzzle_glow',
    geometry: new THREE.SphereGeometry(3.8, 10, 8),
    material: muzzleGlow,
    position: [108, -5.5, -2.5]
  });

  // ── COCKPIT – raised bubble canopy ──
  addMesh({
    parent: group, name: 'warthog_cockpit_base',
    geometry: new THREE.BoxGeometry(26, 8, 14),
    material: trimMat,
    position: [44, 10, 0]
  });
  addMesh({
    parent: group, name: 'warthog_armor_bathtub',
    geometry: new THREE.BoxGeometry(24, 4.6, 16),
    material: darkMat,
    position: [43, 6.4, 0]
  });
  addMesh({
    parent: group, name: 'warthog_canopy',
    geometry: new THREE.SphereGeometry(9.5, 18, 12),
    material: glassMat,
    position: [42, 14, 0],
    scale: [1.7, 0.72, 0.82]
  });
  // Canopy frame
  addMesh({
    parent: group, name: 'warthog_canopy_frame_front',
    geometry: new THREE.BoxGeometry(1.2, 9, 15),
    material: trimMat,
    position: [49, 11, 0]
  });
  addMesh({
    parent: group, name: 'warthog_canopy_frame_rear',
    geometry: new THREE.BoxGeometry(1.2, 9, 15),
    material: trimMat,
    position: [34, 11, 0]
  });

  // ── MAIN WINGS – high-aspect, straight, unswept (A-10's most distinctive feature) ──
  addMesh({
    parent: group, name: 'warthog_wing_center',
    geometry: makeExtrudedPlanform([
      [26, 14], [-36, 30], [-64, 120], [-84, 120], [-52, 22], [18, 10],
    ], 4.5, -2.25),
    material: bodyMat,
    position: [4, -1, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group, name: side < 0 ? 'warthog_outer_wing_left' : 'warthog_outer_wing_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-8, -32], [-24, -86], [-50, -138], [-68, -138], [-44, -78]]
        : [[-8, 32], [-44, 78], [-68, 138], [-50, 138], [-24, 86]], 3.8, -1.9),
      material: trimMat,
      position: [0, 0, 0]
    });
    addMesh({
      parent: group, name: side < 0 ? 'warthog_wingtip_left' : 'warthog_wingtip_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-46, -140], [-62, -156], [-72, -156], [-58, -138]]
        : [[-46, 140], [-58, 138], [-72, 156], [-62, 156]], 2.6, -1.3),
      material: trimMat,
      position: [0, 0, 0]
    });
    // Aileron
    addMesh({
      parent: group, name: side < 0 ? 'warthog_aileron_left' : 'warthog_aileron_right',
      geometry: new THREE.BoxGeometry(18, 2.2, 28),
      material: rubberMat,
      position: [-30, -2, side * 86]
    });
    // Flap
    addMesh({
      parent: group, name: side < 0 ? 'warthog_flap_left' : 'warthog_flap_right',
      geometry: new THREE.BoxGeometry(20, 2.2, 36),
      material: trimMat,
      position: [2, -2.2, side * 60]
    });
    // Wing hardpoints / pylons (A-10 has 11 hardpoints — show 3 each side)
    [-38, -62, -88].forEach((z, pi) => {
      addMesh({
        parent: group, name: `warthog_pylon_${side < 0 ? 'l' : 'r'}${pi}`,
        geometry: new THREE.BoxGeometry(10, 3, 5),
        material: darkMat,
        position: [-8, -4, side * Math.abs(z)]
      });
      addMesh({
        parent: group, name: `warthog_store_${side < 0 ? 'l' : 'r'}${pi}`,
        geometry: pi === 0
          ? new THREE.CylinderGeometry(2.0, 2.4, 18, 10)
          : pi === 1
          ? new THREE.CylinderGeometry(1.3, 1.6, 22, 10)
          : new THREE.CylinderGeometry(1.0, 1.2, 16, 10),
        material: pi === 2 ? trimMat : alumMat,
        position: [-12 - pi * 6, -7.2, side * Math.abs(z)],
        rotation: [0, 0, -Math.PI / 2]
      });
    });
    addMesh({
      parent: group, name: side < 0 ? 'warthog_tip_rail_left' : 'warthog_tip_rail_right',
      geometry: new THREE.BoxGeometry(14, 2, 4),
      material: darkMat,
      position: [-66, -2.6, side * 152]
    });
  });
  addMesh({
    parent: group, name: 'warthog_belly_fairing',
    geometry: new THREE.BoxGeometry(30, 4.4, 12),
    material: trimMat,
    position: [22, -7.4, 0],
    rotation: [0, 0, -0.08]
  });
  addMesh({
    parent: group, name: 'warthog_ecm_blister',
    geometry: new THREE.SphereGeometry(5.2, 10, 8),
    material: alumMat,
    position: [-8, 2.8, 0],
    scale: [1.2, 0.5, 0.7]
  });

  // ── TWIN TF34 TURBOFAN ENGINES – pod-mounted high on rear fuselage ──
  [-1, 1].forEach((side) => {
    const eZ = side * 20;
    // Engine nacelle body
    addMesh({
      parent: group, name: side < 0 ? 'warthog_engine_left' : 'warthog_engine_right',
      geometry: makeLatheAlongX([[0.8, -28], [8.4, -24], [10.3, -6], [10.8, 10], [9.6, 24], [7.4, 30]], 22),
      material: alumMat,
      position: [-26, 16, eZ],
      rotation: [0, Math.PI / 2, 0]
    });
    // Front intake lip
    addMesh({
      parent: group, name: side < 0 ? 'warthog_intake_lip_left' : 'warthog_intake_lip_right',
      geometry: new THREE.TorusGeometry(9.4, 2.2, 10, 20),
      material: darkMat,
      position: [-1, 16, eZ],
      rotation: [0, Math.PI / 2, 0]
    });
    // Inner intake ring
    addMesh({
      parent: group, name: side < 0 ? 'warthog_intake_inner_left' : 'warthog_intake_inner_right',
      geometry: new THREE.CylinderGeometry(7.5, 9.5, 8, 14),
      material: darkMat,
      position: [-4, 16, eZ],
      rotation: [0, 0, -Math.PI / 2]
    });
    // Engine fan face disc
    addMesh({
      parent: group, name: side < 0 ? 'warthog_fan_face_left' : 'warthog_fan_face_right',
      geometry: new THREE.CircleGeometry(7.2, 16),
      material: darkMat,
      position: [-2, 16, eZ],
      rotation: [0, Math.PI / 2, 0]
    });
    // Nozzle
    addMesh({
      parent: group, name: side < 0 ? 'warthog_nozzle_left' : 'warthog_nozzle_right',
      geometry: new THREE.CylinderGeometry(7, 9, 10, 14),
      material: darkMat,
      position: [-52, 16, eZ],
      rotation: [0, 0, -Math.PI / 2]
    });
    // Exhaust glow (emissive)
    addMesh({
      parent: group, name: side < 0 ? 'warthog_exhaust_glow_left' : 'warthog_exhaust_glow_right',
      geometry: new THREE.CylinderGeometry(5.5, 2.8, 14, 12),
      material: glowMat,
      position: [-58, 16, eZ],
      rotation: [0, 0, -Math.PI / 2]
    });
    // Pylon from engine to fuselage
    addMesh({
      parent: group, name: side < 0 ? 'warthog_engine_pylon_left' : 'warthog_engine_pylon_right',
      geometry: new THREE.BoxGeometry(44, 10, 5),
      material: trimMat,
      position: [-26, 8, eZ]
    });
  });

  // ── EMPENNAGE – twin vertical stabilizers angled slightly outward ──
  [-1, 1].forEach((side) => {
    // Horizontal stabilizer
    addMesh({
      parent: group, name: side < 0 ? 'warthog_tailplane_left' : 'warthog_tailplane_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-50, -12], [-66, -34], [-92, -58], [-74, -58], [-58, -22]]
        : [[-50, 12], [-58, 22], [-74, 58], [-92, 58], [-66, 34]], 3.2, -1.6),
      material: bodyMat,
      position: [0, 4, 0]
    });
    // Elevator
    addMesh({
      parent: group, name: side < 0 ? 'warthog_elevator_left' : 'warthog_elevator_right',
      geometry: new THREE.BoxGeometry(14, 2.4, 22),
      material: rubberMat,
      position: [-76, 4, side * 38]
    });
    // Vertical stabilizer fin (canted outward on real A-10)
    addMesh({
      parent: group, name: side < 0 ? 'warthog_vtail_left' : 'warthog_vtail_right',
      geometry: makeExtrudedPlanform([
        [-58, 0], [-86, 0], [-72, 46], [-60, 46],
      ], 4, side * 22),
      material: bodyMat,
      position: [0, 0, 0],
      rotation: [0, 0, side * 0.09]
    });
    addMesh({
      parent: group, name: side < 0 ? 'warthog_tail_brace_left' : 'warthog_tail_brace_right',
      geometry: new THREE.BoxGeometry(22, 6, 5),
      material: trimMat,
      position: [-54, 11, side * 16],
      rotation: [0, 0, side * 0.14]
    });
    // Rudder
    addMesh({
      parent: group, name: side < 0 ? 'warthog_rudder_left' : 'warthog_rudder_right',
      geometry: new THREE.BoxGeometry(3.4, 34, 22),
      material: rubberMat,
      position: [-76, 26, side * 28],
      rotation: [0, 0, side * 0.06]
    });
    // Fin leading edge spar
    addMesh({
      parent: group, name: side < 0 ? 'warthog_fin_edge_left' : 'warthog_fin_edge_right',
      geometry: new THREE.CylinderGeometry(1.8, 1.8, 50, 8),
      material: alumMat,
      position: [-52, 26, side * 24],
      rotation: [Math.PI / 2, 0, 0.08]
    });
  });

  // ── NATIONAL MARKINGS – US Air Force roundel on wings ──
  [-1, 1].forEach((side, i) => {
    addMesh({
      parent: group, name: `warthog_roundel_${i}`,
      geometry: new THREE.CircleGeometry(11, 6),
      material: makeMaterial({ color: '#1a4896', transparent: true, opacity: 0.82 }),
      position: [2, 2.4, side * 72],
      rotation: [-Math.PI / 2, 0, 0]
    });
    addMesh({
      parent: group, name: `warthog_roundel_star_${i}`,
      geometry: new THREE.CircleGeometry(5.5, 5),
      material: makeMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.88 }),
      position: [2, 2.6, side * 72],
      rotation: [-Math.PI / 2, 0, Math.PI / 10]
    });
  });

  // ── SPEED BRAKE panels on rear fuselage ──
  [-1, 1].forEach((side, i) => {
    addMesh({
      parent: group, name: `warthog_speed_brake_${i}`,
      geometry: new THREE.BoxGeometry(18, 2, 6.5),
      material: trimMat,
      position: [-42, -10.5, side * 8]
    });
  });

  return group;
};

const exportGroupToGlb = async (group, destinationPath) => {
  const scene = new THREE.Scene();
  scene.add(group);

  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, onlyVisible: true, includeCustomExtensions: false }
    );
  });

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
  console.log(`Wrote ${destinationPath}`);
};

const bomberPlaneAsset = buildBomberPlane();
const parachuteNukeAsset = buildParachuteNuke();
const strikeJetAsset = buildStrikeJet();
const a10WarthogAsset = buildA10Warthog();
const tankAsset = buildGroundArmor({
  name: 'battle_tank',
  hullColor: '#768f5f',
  turretColor: '#667f52',
  accentColor: '#f59e0b',
  barrelLength: 28,
  hullLength: 50,
  hullHeight: 14,
  hullWidth: 28,
  turretRadius: 9.5
});
const apcAsset = buildGroundArmor({
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
});

const root = new THREE.Group();
root.name = 'airstrike_assets_root';
root.add(bomberPlaneAsset);
root.add(parachuteNukeAsset);
root.add(strikeJetAsset);
root.add(a10WarthogAsset);
root.add(tankAsset);
root.add(apcAsset);

await exportGroupToGlb(root, outPath);
await exportGroupToGlb(tankAsset.clone(true), path.join(outDir, 'tank.glb'));
await exportGroupToGlb(apcAsset.clone(true), path.join(outDir, 'apc.glb'));
