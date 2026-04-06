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
  normalMap,
  roughnessMap,
  aoMap,
  aoMapIntensity = 1,
  normalScale,
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
    ...(side !== undefined ? { side } : {}),
    ...(normalMap ? { normalMap } : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
    ...(aoMap ? { aoMap, aoMapIntensity } : {}),
  });
  const tex = map !== undefined ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4)
      ? autoMap(color) : null;
  if (tex) m.map = tex;
  if (normalScale) {
    m.normalScale = Array.isArray(normalScale)
      ? new THREE.Vector2(normalScale[0], normalScale[1])
      : normalScale;
  }
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

const cloneUvToUv2 = (geometry) => {
  if (!geometry?.attributes?.uv || geometry.attributes.uv2) return geometry;
  geometry.setAttribute('uv2', new THREE.BufferAttribute(geometry.attributes.uv.array.slice(), 2));
  return geometry;
};

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

const makeLatheAlongX = (profile, segments = 28) => {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, x]) => new THREE.Vector2(radius, x)),
    segments,
  );
  geometry.rotateZ(-Math.PI / 2);
  geometry.computeVertexNormals();
  return cloneUvToUv2(geometry);
};

const makeExtrudedPlanform = (points, thickness, offsetY = 0) => {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) {
    shape.lineTo(points[index][0], points[index][1]);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geometry.applyMatrix4(new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, offsetY,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ));
  geometry.computeVertexNormals();
  return cloneUvToUv2(geometry);
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
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const noise = ((grain < 0 ? grain + 1 : grain) - 0.5) * 10;
      const shade = 162 + streak + noise + (panelLine ? -24 : 0) + (rivet ? -34 : 0);
      return [shade, shade + 7, shade + 14, 255];
    });
    const normal = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const panelLine = panelX < 2 || panelY < 2;
      const rivet = ((panelX === 6 || panelX === 42) && (panelY === 6 || panelY === 26)) ? 1 : 0;
      const nx = panelX < 2 ? 166 : panelX > 45 ? 90 : 128;
      const ny = panelY < 2 ? 166 : panelY > 29 ? 90 : 128;
      const bump = rivet ? 154 : 128;
      return [panelLine ? nx : bump, panelLine ? ny : bump, 255, 255];
    }, { color: false });
    const roughness = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const panelLine = panelX < 2 || panelY < 2;
      const value = panelLine ? 170 : 108 + ((x + y) % 9);
      return [value, value, value, 255];
    }, { color: false });
    const ao = makeDataTexture(width, height, (x, y) => {
      const panelX = x % 48;
      const panelY = y % 32;
      const edge = (panelX < 3 || panelX > 44 || panelY < 3 || panelY > 28) ? 180 : 236;
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
      return [band, 128, 255, 255];
    }, { color: false });
    const roughness = makeDataTexture(128, 128, () => [132, 132, 132, 255], { color: false });
    const ao = makeDataTexture(128, 128, (x, y) => {
      const edge = (x % 24) < 2 || (y % 24) < 2 ? 190 : 235;
      return [edge, edge, edge, 255];
    }, { color: false });
    [normal, roughness, ao].forEach((texture) => texture.repeat.set(3, 3));
    return { base, normal, roughness, ao };
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
  const glassMat = makeMaterial({
    color: '#88b8c8',
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: 0.42,
    emissive: '#67a4be',
    emissiveIntensity: 0.08,
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
  ], 34);
  addMesh({ parent: group, name: 'bomber_fuselage', geometry: fuselageGeo, material: skinMat });

  addMesh({
    parent: group,
    name: 'bomber_nose_radome',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(2.5, 20, 18)),
    material: trimMat,
    position: [149, -0.2, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'bomber_tail_boat',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.6, 3.7, 18, 14)),
    material: trimMat,
    position: [-145, -0.6, 0],
    rotation: [0, 0, Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'bomber_spine',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(1.8, 110, 4, 10)),
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

  const canopyGeo = cloneUvToUv2(new THREE.SphereGeometry(9.6, 20, 14));
  addMesh({
    parent: group,
    name: 'bomber_cockpit_canopy',
    geometry: canopyGeo,
    material: glassMat,
    position: [84, 11.1, 0],
    scale: [1.75, 0.54, 0.92],
  });
  addMesh({
    parent: group,
    name: 'bomber_cockpit_sill',
    geometry: cloneUvToUv2(new THREE.BoxGeometry(30, 3.4, 18)),
    material: skinMat,
    position: [83, 7.2, 0],
  });
  addMesh({
    parent: group,
    name: 'bomber_nav_blister',
    geometry: cloneUvToUv2(new THREE.SphereGeometry(4.7, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)),
    material: glassMat,
    position: [67, -7.5, 0],
    scale: [1.3, 0.8, 1],
  });

  const makeWingGeometry = (side) => {
    const root = 12 * side;
    const tip = 178 * side;
    const points = side > 0
      ? [[46, root], [-12, 68], [-102, tip], [-132, tip], [-64, 36], [18, 10]]
      : [[46, root], [18, -10], [-64, -36], [-132, tip], [-102, tip], [-12, -68]];
    const geometry = makeExtrudedPlanform(points, 6.5, -3.2);
    geometry.rotateX(side * -0.045);
    geometry.rotateZ(side * -0.02);
    return geometry;
  };

  addMesh({ parent: group, name: 'bomber_wing_right', geometry: makeWingGeometry(1), material: wingMat });
  addMesh({ parent: group, name: 'bomber_wing_left', geometry: makeWingGeometry(-1), material: wingMat });

  [-1, 1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `bomber_wing_root_fairing_${index}`,
      geometry: cloneUvToUv2(new THREE.SphereGeometry(13, 18, 12)),
      material: skinMat,
      position: [2, -1.8, side * 20],
      scale: [1.55, 0.38, 1.18],
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

  const finGeo = makeExtrudedPlanform([
    [-84, 0],
    [-138, 0],
    [-124, 72],
    [-92, 72],
  ], 6, -3);
  addMesh({ parent: group, name: 'bomber_vertical_fin', geometry: finGeo, material: wingMat });

  const makeStabGeometry = (side) => {
    const root = 10 * side;
    const tip = 60 * side;
    const points = side > 0
      ? [[-88, root], [-116, 24], [-130, tip], [-100, tip], [-78, 18]]
      : [[-88, root], [-78, -18], [-100, tip], [-130, tip], [-116, -24]];
    const geometry = makeExtrudedPlanform(points, 3.8, -1.8);
    geometry.rotateX(side * -0.03);
    return geometry;
  };
  addMesh({ parent: group, name: 'bomber_stab_right', geometry: makeStabGeometry(1), material: wingMat });
  addMesh({ parent: group, name: 'bomber_stab_left', geometry: makeStabGeometry(-1), material: wingMat });

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
      const nacelleGeo = makeLatheAlongX(nacelleProfile, 22);
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
        geometry: cloneUvToUv2(new THREE.TorusGeometry(5.25, 0.75, 8, 18)),
        material: trimMat,
        position: [x + xOffset + 28, -22, z],
        rotation: [0, Math.PI / 2, 0],
      });
      addMesh({
        parent: group,
        name: `bomber_nozzle_${index}`,
        geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.7, 3.7, 10, 14)),
        material: trimMat,
        position: [x + xOffset - 29, -22, z],
        rotation: [0, 0, -Math.PI / 2],
      });
      if (engineIndex === 0) {
        addMesh({
          parent: group,
          name: `bomber_exhaust_glow_${pairIdx}`,
          geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.8, 4.2, 18, 14)),
          material: glowMat,
          position: [x + xOffset - 40, -22, z],
          rotation: [0, 0, -Math.PI / 2],
        });
      }
    });
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

  const bombMat = makeMaterial({ color: '#596571', roughness: 0.26, metalness: 0.78, map: cloneTexture(textures.METAL_GREY, 2.2, 1.6) });
  const trimMat = makeMaterial({ color: '#7b8794', roughness: 0.34, metalness: 0.68, map: cloneTexture(textures.RIVET_METAL, 2.6, 1.5) });
  const darkMat = makeMaterial({ color: '#1a2029', roughness: 0.28, metalness: 0.72, map: cloneTexture(textures.METAL_DARK, 3, 2) });
  const stripeMat = makeMaterial({ color: '#facc15', roughness: 0.36, metalness: 0.06, emissive: '#f59e0b', emissiveIntensity: 0.18 });
  const canopyMat = makeMaterial({ color: '#c1121f', roughness: 0.82, metalness: 0.06, side: THREE.DoubleSide });
  const canopyRingMat = makeMaterial({ color: '#fecaca', roughness: 0.7, metalness: 0.16 });
  const fabricGlowMat = makeMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 0.65, transparent: true, opacity: 0.18 });
  const cordMat = new THREE.MeshBasicMaterial({ color: '#f5f5f4' });

  addMesh({
    parent: group,
    name: 'nuke_body',
    geometry: makeLatheAlongX([
      [0.4, -31], [2.8, -28], [5.5, -20], [7.2, -8], [7.4, 8], [5.4, 20], [2.4, 29], [0.3, 32],
    ], 28),
    material: bombMat,
    rotation: [0, Math.PI / 2, 0],
  });
  addMesh({
    parent: group,
    name: 'nuke_mid_band',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(7.3, 7.3, 6, 24)),
    material: trimMat,
    position: [2, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.2, 5.9, 18, 18)),
    material: darkMat,
    position: [-24, 0, 0],
    rotation: [0, 0, -Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_tail_cap',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(3.4, 10, 14)),
    material: darkMat,
    position: [-38, 0, 0],
    rotation: [0, 0, Math.PI / 2],
  });
  addMesh({
    parent: group,
    name: 'nuke_band',
    geometry: cloneUvToUv2(new THREE.CylinderGeometry(7.5, 7.5, 2.2, 24)),
    material: stripeMat,
    position: [10, 0, 0],
    rotation: [0, 0, -Math.PI / 2]
  });
  [1, -1].forEach((side, index) => {
    addMesh({
      parent: group,
      name: `nuke_fin_${index}`,
      geometry: makeExtrudedPlanform([
        [-26, side * 2.2],
        [-41, side * 9.2],
        [-39, side * 14.8],
        [-19, side * 5.6],
      ], 0.9, -0.45),
      material: darkMat,
    });
    addMesh({
      parent: group,
      name: `nuke_fin_cross_${index}`,
      geometry: makeExtrudedPlanform([
        [-26, side * 2.2],
        [-41, side * 9.2],
        [-39, side * 14.8],
        [-19, side * 5.6],
      ], 0.9, -0.45),
      material: darkMat,
      rotation: [Math.PI / 2, 0, 0],
    });
  });

  const chuteRoot = new THREE.Group();
  chuteRoot.name = 'nuke_parachute';
  chuteRoot.position.set(0, 34, 0);
  group.add(chuteRoot);

  for (let segment = 0; segment < 8; segment++) {
    const angle = (segment / 8) * Math.PI * 2;
    addMesh({
      parent: chuteRoot,
      name: `nuke_canopy_panel_${segment}`,
      geometry: cloneUvToUv2(new THREE.SphereGeometry(16, 10, 8, 0, Math.PI / 4, 0, Math.PI / 2)),
      material: canopyMat,
      position: [Math.cos(angle) * 5.2, 0, Math.sin(angle) * 5.2],
      rotation: [0, -angle, 0],
      scale: [1.6, 1.16, 1.08],
    });
  }
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

  const bodyMat = makeMaterial({ color: '#b0bdcb', roughness: 0.28, metalness: 0.7, emissive: '#b0bdcb', emissiveIntensity: 0.05, map: cloneTexture(textures.RIVET_METAL, 2.8, 1.8) });
  const trimMat = makeMaterial({ color: '#7c8a9a', roughness: 0.36, metalness: 0.56, map: cloneTexture(textures.METAL_GREY, 3, 2) });
  const darkMat = makeMaterial({ color: '#46515e', roughness: 0.24, metalness: 0.64, map: cloneTexture(textures.METAL_DARK, 3, 2) });
  const glassMat = makeMaterial({ color: '#8eb7d0', roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.52 });
  const glowMat = makeMaterial({ color: '#38bdf8', emissive: '#67e8f9', emissiveIntensity: 1.8, transparent: true, opacity: 0.42 });

  addMesh({
    parent: group,
    name: 'jet_fuselage',
    geometry: makeLatheAlongX([
      [0.25, -74], [2.8, -68], [6.8, -48], [8.2, -8], [7.2, 20], [5.6, 45], [2.1, 64], [0.2, 76],
    ], 24),
    material: bodyMat,
    rotation: [0, Math.PI / 2, 0]
  });
  addMesh({
    parent: group,
    name: 'jet_nose',
    geometry: cloneUvToUv2(new THREE.ConeGeometry(3.4, 22, 16)),
    material: trimMat,
    position: [87, 0.5, 0],
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
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(2.4, 36, 4, 8)),
    material: trimMat,
    position: [2, 7.4, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1.1, 0.72, 0.8]
  });
  addMesh({
    parent: group,
    name: 'jet_main_wing',
    geometry: makeExtrudedPlanform([
      [24, 10], [-8, 44], [-60, 118], [-86, 118], [-44, 28], [8, 8],
    ], 3.2, -1.6),
    material: bodyMat,
    position: [0, 0.4, 0]
  });
  [-1, 1].forEach((side) => {
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_wingtip_left' : 'jet_wingtip_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-36, -48], [-52, -78], [-63, -78], [-48, -42]]
        : [[-36, 48], [-48, 42], [-63, 78], [-52, 78]], 2.2, -1.1),
      material: trimMat,
      position: [0, 0.2, 0]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_tailplane_left' : 'jet_tailplane_right',
      geometry: makeExtrudedPlanform(side < 0
        ? [[-34, -8], [-48, -22], [-64, -34], [-50, -34]]
        : [[-34, 8], [-50, 34], [-64, 34], [-48, 22]], 2.2, -0.9),
      material: trimMat,
      position: [0, 6, 0]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_stabilizer_left' : 'jet_stabilizer_right',
      geometry: makeExtrudedPlanform([
        [-46, 0], [-62, 0], [-56, 24], [-48, 24],
      ], 2.2, side * 5.6),
      material: trimMat,
      position: [0, 0, 0],
      rotation: [0.08, 0, side * 0.18]
    });
    addMesh({
      parent: group,
      name: side < 0 ? 'jet_intake_left' : 'jet_intake_right',
      geometry: makeLatheAlongX([[2.8, -10], [4.1, -6], [4.6, 4], [4.2, 10], [3.3, 14]], 18),
      material: darkMat,
      position: [6, -1.6, side * 13.5]
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
    geometry: cloneUvToUv2(new THREE.BoxGeometry(26, 8.2, 17)),
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

  const hullMat = makeMaterial({ color: hullColor, roughness: 0.54, metalness: 0.34, emissive: hullColor, emissiveIntensity: 0.08, map: cloneTexture(textures.CAMO, 2.6, 1.4) });
  const turretMat = makeMaterial({ color: turretColor, roughness: 0.46, metalness: 0.4, emissive: turretColor, emissiveIntensity: 0.07, map: cloneTexture(textures.CAMO, 2.2, 1.4) });
  const trackMat = makeMaterial({ color: '#434c58', roughness: 0.72, metalness: 0.22, map: cloneTexture(textures.METAL_DARK, 4, 1.5) });
  const trimMat = makeMaterial({ color: '#7b8794', roughness: 0.42, metalness: 0.46, map: cloneTexture(textures.METAL_GREY, 2, 2) });
  const glowMat = makeMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.45, transparent: true, opacity: 0.38 });

  const hullGeo = makeExtrudedPlanform([
    [-hullLength * 0.52, 4],
    [-hullLength * 0.44, hullHeight * 0.96],
    [hullLength * 0.18, hullHeight * 1.02],
    [hullLength * 0.46, hullHeight * 0.68],
    [hullLength * 0.54, 6],
    [hullLength * 0.26, 0],
    [-hullLength * 0.42, 0],
  ], hullWidth, 2);
  addMesh({
    parent: group,
    name: 'vehicle_hull_base',
    geometry: hullGeo,
    material: hullMat,
    position: [0, 5.5, 0]
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
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(3.1, hullLength * 0.9, 6, 14)),
    material: trackMat,
    position: [0, 3.8, hullWidth * 0.45],
    rotation: [0, 0, Math.PI / 2]
  });
  addMesh({
    parent: group,
    name: 'vehicle_track_right',
    geometry: cloneUvToUv2(new THREE.CapsuleGeometry(3.1, hullLength * 0.9, 6, 14)),
    material: trackMat,
    position: [0, 3.8, -hullWidth * 0.45],
    rotation: [0, 0, Math.PI / 2]
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
      ? cloneUvToUv2(new THREE.BoxGeometry(22, 8, 17))
      : makeLatheAlongX([[2.5, -11], [7.5, -7], [turretRadius, 0], [turretRadius * 0.86, 7], [5.4, 11]], 20),
    material: turretMat,
    position: [0, 0, 0],
    rotation: apc ? [0, 0, 0] : [0, Math.PI / 2, 0]
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
    });
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

const root = new THREE.Group();
root.name = 'airstrike_assets_root';
root.add(buildBomberPlane());
root.add(buildParachuteNuke());
root.add(buildStrikeJet());
root.add(buildA10Warthog());
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
