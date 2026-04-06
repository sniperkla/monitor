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
const outPath = path.join(outDir, 'world_props.glb');

const root = new THREE.Group();
root.name = 'world_props_root';

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

const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.08,
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
    ...(side !== undefined ? { side } : {}),
  });
  const tex = map !== undefined ? map : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.4 ? autoMap(color) : null);
  if (tex) material.map = tex;
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

const makeLatheAlongX = (profile, segments = 22) => {
  const geometry = new THREE.LatheGeometry(profile.map(([radius, x]) => new THREE.Vector2(radius, x)), segments);
  geometry.rotateZ(-Math.PI / 2);
  geometry.computeVertexNormals();
  return cloneUvToUv2(geometry);
};

const makeExtrudedPlanform = (points, thickness, offsetY = 0) => {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) shape.lineTo(points[index][0], points[index][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
  geometry.applyMatrix4(new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, offsetY,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ));
  geometry.computeVertexNormals();
  return cloneUvToUv2(geometry);
};

const addWindow = (parent, name, trimName, width, height, position, rotation = [0, 0, 0], glass = '#586b7a', trim = '#ece8de', intensity = 0.18) => {
  addMesh({
    parent,
    name,
    geometry: cloneUvToUv2(new THREE.BoxGeometry(width, height, 0.8)),
    material: makeMaterial({ color: glass, emissive: glass, emissiveIntensity: intensity, roughness: 0.14, metalness: 0.22 }),
    position,
    rotation,
  });
  addMesh({
    parent,
    name: `${trimName}_frame`,
    geometry: cloneUvToUv2(new THREE.BoxGeometry(width + 0.9, height + 0.9, 0.26)),
    material: makeMaterial({ color: trim, roughness: 0.8, metalness: 0.12, map: cloneTexture(textures.METAL_GREY, 1.2, 1.2) }),
    position: [position[0], position[1], position[2] + Math.cos(rotation[1] || 0) * 0.05],
    rotation,
  });
};

const addRubble = (parent, prefix, color, pieces) => {
  pieces.forEach((piece, index) => {
    addMesh({
      parent,
      name: `${prefix}_${index}`,
      geometry: cloneUvToUv2(new THREE.BoxGeometry(piece[3], piece[4], piece[5])),
      material: makeMaterial({ color, roughness: 0.96 }),
      position: [piece[0], piece[1], piece[2]],
      rotation: [piece[6] || 0, piece[7] || 0, piece[8] || 0],
    });
  });
};

const buildResidentialHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_residential';
  const foundationMat = makeMaterial({ color: '#706354', roughness: 0.96, map: cloneTexture(textures.METAL_GREY, 2.2, 2.2) });
  const bodyMat = makeMaterial({ color: '#d9cfbb', roughness: 0.84, map: cloneTexture(textures.CAMO, 2.6, 2.0) });
  const trimMat = makeMaterial({ color: '#f0ece3', roughness: 0.78, metalness: 0.12, map: cloneTexture(textures.METAL_GREY, 1.8, 1.8) });
  const roofMat = makeMaterial({ color: '#7f4a2b', roughness: 0.78, metalness: 0.12, map: cloneTexture(textures.OLIVE_METAL || textures.CAMO, 2.4, 1.8) });
  const accentMat = makeMaterial({ color: '#8799aa', roughness: 0.56, metalness: 0.24, map: cloneTexture(textures.RIVET_METAL, 1.8, 1.8) });
  const doorMat = makeMaterial({ color: '#544337', roughness: 0.8, map: cloneTexture(textures.METAL_DARK, 1.8, 1.6) });
  const chimneyMat = makeMaterial({ color: '#8d6a4d', roughness: 0.88, map: cloneTexture(textures.METAL_GREY, 1.4, 1.4) });

  addMesh({ parent: group, name: 'house_foundation', geometry: cloneUvToUv2(new THREE.BoxGeometry(31, 6, 31)), material: foundationMat, position: [0, 4.4, 0] });
  addMesh({ parent: group, name: 'house_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(28.6, 22.2, 27.2)), material: bodyMat, position: [0, 18.2, -0.8] });
  addMesh({ parent: group, name: 'house_body_front_bay', geometry: cloneUvToUv2(new THREE.BoxGeometry(16.5, 17.5, 9.5)), material: bodyMat, position: [0, 15.5, 14.4] });
  addMesh({ parent: group, name: 'house_trim_belt', geometry: cloneUvToUv2(new THREE.BoxGeometry(30.4, 1.0, 30.0)), material: trimMat, position: [0, 28.5, -0.2] });
  addMesh({ parent: group, name: 'house_trim_porch', geometry: cloneUvToUv2(new THREE.BoxGeometry(18, 1.0, 9)), material: trimMat, position: [0, 8.2, 18.0] });
  addMesh({ parent: group, name: 'house_trim_steps', geometry: cloneUvToUv2(new THREE.BoxGeometry(13, 1.6, 6.4)), material: foundationMat, position: [0, 1.4, 21.2] });
  addMesh({ parent: group, name: 'house_roof_left', geometry: makeExtrudedPlanform([[-15.5, 0], [0, 9], [15.5, 0], [15.5, -15], [-15.5, -15]], 16.2, -8.1), material: roofMat, position: [0, 29.8, -0.2] });
  addMesh({ parent: group, name: 'house_roof_right', geometry: makeExtrudedPlanform([[-15.5, 0], [0, -9], [15.5, 0], [15.5, 15], [-15.5, 15]], 16.2, -8.1), material: roofMat, position: [0, 29.8, -0.2] });
  addMesh({ parent: group, name: 'house_roof', geometry: cloneUvToUv2(new THREE.BoxGeometry(28, 1.0, 3.0)), material: roofMat, position: [0, 39.2, -0.2] });
  addMesh({ parent: group, name: 'house_door_frame', geometry: cloneUvToUv2(new THREE.BoxGeometry(7.0, 13.4, 0.4)), material: trimMat, position: [0, 9.2, 19.0] });
  addMesh({ parent: group, name: 'house_door', geometry: cloneUvToUv2(new THREE.BoxGeometry(5.8, 12.4, 1.0)), material: doorMat, position: [0, 8.8, 19.2] });
  addMesh({ parent: group, name: 'house_chimney', geometry: cloneUvToUv2(new THREE.BoxGeometry(3.8, 14, 3.8)), material: chimneyMat, position: [-8.6, 37.2, -7.2] });
  addMesh({ parent: group, name: 'house_chimney_cap', geometry: cloneUvToUv2(new THREE.BoxGeometry(4.6, 1.1, 4.6)), material: trimMat, position: [-8.6, 44.1, -7.2] });
  addMesh({ parent: group, name: 'house_accent_porch_post_left', geometry: cloneUvToUv2(new THREE.BoxGeometry(0.9, 13, 0.9)), material: accentMat, position: [-7.2, 14.5, 17.8] });
  addMesh({ parent: group, name: 'house_accent_porch_post_right', geometry: cloneUvToUv2(new THREE.BoxGeometry(0.9, 13, 0.9)), material: accentMat, position: [7.2, 14.5, 17.8] });

  addWindow(group, 'house_window_front_0', 'house_trim_front_0', 6.2, 6.0, [-6.2, 16.2, 18.4]);
  addWindow(group, 'house_window_front_1', 'house_trim_front_1', 6.2, 6.0, [6.2, 16.2, 18.4]);
  addWindow(group, 'house_window_back_0', 'house_trim_back_0', 5.8, 6.2, [-6.2, 16.4, -15.2], [0, Math.PI, 0], '#4b5f6f');
  addWindow(group, 'house_window_back_1', 'house_trim_back_1', 5.8, 6.2, [6.2, 16.4, -15.2], [0, Math.PI, 0], '#4b5f6f');
  addWindow(group, 'house_window_side_left_0', 'house_trim_side_left_0', 8.0, 5.6, [-15.2, 17.2, -1.8], [0, Math.PI / 2, 0]);
  addWindow(group, 'house_window_side_right_0', 'house_trim_side_right_0', 8.0, 5.6, [15.2, 17.2, -1.8], [0, Math.PI / 2, 0]);

  return group;
};

const buildTowerHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_tower';
  const foundationMat = makeMaterial({ color: '#4b5663', roughness: 0.94, map: cloneTexture(textures.METAL_GREY, 2.0, 2.0) });
  const bodyMat = makeMaterial({ color: '#9daec2', roughness: 0.76, metalness: 0.08, map: cloneTexture(textures.CAMO, 2.2, 2.0) });
  const trimMat = makeMaterial({ color: '#dbe3ec', roughness: 0.74, metalness: 0.14, map: cloneTexture(textures.METAL_GREY, 1.8, 1.8) });
  const accentMat = makeMaterial({ color: '#71879e', roughness: 0.56, metalness: 0.26, map: cloneTexture(textures.RIVET_METAL, 1.8, 1.8) });
  const roofMat = makeMaterial({ color: '#7b8fa4', roughness: 0.66, metalness: 0.18, map: cloneTexture(textures.METAL_GREY, 1.8, 1.8) });
  const doorMat = makeMaterial({ color: '#55697b', roughness: 0.68, metalness: 0.18, map: cloneTexture(textures.METAL_DARK, 1.8, 1.6) });

  addMesh({ parent: group, name: 'house_foundation', geometry: cloneUvToUv2(new THREE.BoxGeometry(32, 5, 32)), material: foundationMat, position: [0, 2.5, 0] });
  addMesh({ parent: group, name: 'house_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(17.8, 35.4, 17.8)), material: bodyMat, position: [0, 38.0, 0] });
  addMesh({ parent: group, name: 'house_body_podium', geometry: cloneUvToUv2(new THREE.BoxGeometry(24, 18, 24)), material: bodyMat, position: [0, 14, 0] });
  addMesh({ parent: group, name: 'house_trim_cap', geometry: cloneUvToUv2(new THREE.BoxGeometry(20.8, 3.0, 20.8)), material: trimMat, position: [0, 56.7, 0] });
  addMesh({ parent: group, name: 'house_trim_band_low', geometry: cloneUvToUv2(new THREE.BoxGeometry(25.2, 1.0, 25.2)), material: trimMat, position: [0, 22.2, 0] });
  addMesh({ parent: group, name: 'house_trim_band_mid', geometry: cloneUvToUv2(new THREE.BoxGeometry(19.0, 0.9, 19.0)), material: trimMat, position: [0, 45.0, 0] });
  addMesh({ parent: group, name: 'house_accent_column_left', geometry: cloneUvToUv2(new THREE.BoxGeometry(2.2, 36, 2.2)), material: accentMat, position: [-8.8, 38, 8.8] });
  addMesh({ parent: group, name: 'house_accent_column_right', geometry: cloneUvToUv2(new THREE.BoxGeometry(2.2, 36, 2.2)), material: accentMat, position: [8.8, 38, 8.8] });
  addMesh({ parent: group, name: 'house_accent_spine', geometry: cloneUvToUv2(new THREE.BoxGeometry(4.2, 30, 1.1)), material: accentMat, position: [0, 40, 9.4] });
  addMesh({ parent: group, name: 'house_roof', geometry: cloneUvToUv2(new THREE.BoxGeometry(14.6, 2.6, 14.6)), material: roofMat, position: [0, 61.0, 0] });
  addMesh({ parent: group, name: 'house_roof_unit_left', geometry: cloneUvToUv2(new THREE.BoxGeometry(5.6, 5.2, 5.6)), material: accentMat, position: [-4.4, 64.0, -2.0] });
  addMesh({ parent: group, name: 'house_roof_unit_right', geometry: cloneUvToUv2(new THREE.BoxGeometry(4.8, 4.8, 4.8)), material: accentMat, position: [4.8, 63.8, 3.2] });
  addMesh({ parent: group, name: 'house_roof_antenna', geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.22, 0.28, 12, 8)), material: trimMat, position: [-6.0, 71.5, -4.0] });
  addMesh({ parent: group, name: 'house_roof_dish', geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.8, 2.8, 0.5, 16)), material: trimMat, position: [5.7, 66.4, -2], rotation: [0.24, 0.48, 0.12] });
  addMesh({ parent: group, name: 'house_door_frame', geometry: cloneUvToUv2(new THREE.BoxGeometry(8.0, 13.0, 0.45)), material: trimMat, position: [0, 8.4, 16.0] });
  addMesh({ parent: group, name: 'house_door', geometry: cloneUvToUv2(new THREE.BoxGeometry(6.4, 12.0, 1.0)), material: doorMat, position: [0, 8.0, 16.2] });

  [[0, 16.5, 16.0, 20, 4.2], [0, 28.0, 9.0, 12, 4.0], [0, 38.5, 9.0, 12, 4.0], [0, 49.0, 9.0, 12, 4.0]].forEach((windowDef, index) => {
    addWindow(group, `house_window_front_${index}`, `house_trim_front_${index}`, windowDef[3], windowDef[4], [windowDef[0], windowDef[1], windowDef[2]], [0, 0, 0], '#62768d', '#dbe3ec', 0.22);
  });
  [[16.0, 28.0, 0], [16.0, 39.0, 0], [-16.0, 28.0, 0], [-16.0, 39.0, 0]].forEach(([x, y, z], index) => {
    addWindow(group, `house_window_side_${index}`, `house_trim_side_${index}`, 12.0, 4.2, [x, y, z], [0, Math.PI / 2, 0], '#62768d', '#dbe3ec', 0.22);
  });

  return group;
};

const buildBrokenHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_broken';
  const baseMat = makeMaterial({ color: '#372116', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 2.2, 2.2) });
  const roofMat = makeMaterial({ color: '#784327', roughness: 0.88, map: cloneTexture(textures.OLIVE_METAL || textures.CAMO, 2.0, 1.6) });
  const bodyMat = makeMaterial({ color: '#4d2c1c', roughness: 0.94, map: cloneTexture(textures.CAMO, 2.2, 1.8) });
  const beamMat = makeMaterial({ color: '#1d1714', roughness: 0.92, map: cloneTexture(textures.METAL_DARK, 2.0, 2.0) });

  addMesh({ parent: group, name: 'house_wreck_base', geometry: cloneUvToUv2(new THREE.BoxGeometry(38, 7.2, 36)), material: baseMat, position: [0, 3.6, 0] });
  addMesh({ parent: group, name: 'house_wreck_roof', geometry: cloneUvToUv2(new THREE.BoxGeometry(23, 4.2, 18)), material: roofMat, position: [6, 15, -4], rotation: [0.42, -0.12, 0.72] });
  addMesh({ parent: group, name: 'house_wreck_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(22, 10, 16)), material: bodyMat, position: [-6, 12, 6], rotation: [-0.28, 0.34, -0.24] });
  [[-11, 10, -4, 0.18, 0.0, 0.34], [9, 9, 8, 0.34, 0.14, 0.42], [-2, 8, 12, 0.56, 0.3, -0.24]].forEach((beam, index) => {
    addMesh({ parent: group, name: `house_wreck_beam_${index}`, geometry: cloneUvToUv2(new THREE.BoxGeometry(2.2, 14, 2.2)), material: beamMat, position: [beam[0], beam[1], beam[2]], rotation: [beam[3], beam[4], beam[5]] });
  });
  addMesh({ parent: group, name: 'house_wreck_beam_cross', geometry: cloneUvToUv2(new THREE.BoxGeometry(16, 1.8, 2.0)), material: beamMat, position: [3.5, 8.2, 1.5], rotation: [0.24, 0.32, 0.64] });
  addRubble(group, 'house_wreck_base_rubble', '#28160d', [[-12, 2.4, 9, 6.2, 2.6, 7.4, 0.12, 0.18, 0.28], [11, 2.1, -9, 5.8, 2.2, 6.4, 0.1, -0.12, -0.24], [1, 2.6, 13, 8.8, 2.4, 4.8, 0.18, 0.32, 0.18], [-4, 2.0, -12, 5.0, 2.2, 5.8, 0.14, -0.28, -0.12], [7, 1.8, 2, 4.2, 2.0, 4.6, 0.05, 0.2, -0.16]]);

  return group;
};

const buildRuinedHouse = () => {
  const group = new THREE.Group();
  group.name = 'house_ruined';
  const baseMat = makeMaterial({ color: '#24140c', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 2.2, 2.2) });
  const roofMat = makeMaterial({ color: '#734122', roughness: 0.92, map: cloneTexture(textures.OLIVE_METAL || textures.CAMO, 1.8, 1.6) });
  const bodyMat = makeMaterial({ color: '#422312', roughness: 0.96, map: cloneTexture(textures.CAMO, 2.0, 1.8) });
  const beamMat = makeMaterial({ color: '#1c1614', roughness: 0.94, map: cloneTexture(textures.METAL_DARK, 2.0, 2.0) });

  addMesh({ parent: group, name: 'house_wreck_base', geometry: cloneUvToUv2(new THREE.BoxGeometry(40, 5.2, 40)), material: baseMat, position: [0, 2.6, 0] });
  addMesh({ parent: group, name: 'house_wreck_roof', geometry: cloneUvToUv2(new THREE.BoxGeometry(20, 4.4, 23)), material: roofMat, position: [7, 8.8, -6], rotation: [0.58, 0.18, 0.92] });
  addMesh({ parent: group, name: 'house_wreck_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(24, 7, 16)), material: bodyMat, position: [-8, 6.5, 8], rotation: [-0.48, -0.24, -0.66] });
  [[-12, 8.5, -5, 0.12, 0.0, 0.44], [10, 10.5, 6, 0.44, 0.18, 0.38], [0, 9.2, 13, 0.7, 0.36, 0.34]].forEach((beam, index) => {
    addMesh({ parent: group, name: `house_wreck_beam_${index}`, geometry: cloneUvToUv2(new THREE.BoxGeometry(1.8, 14.5, 1.8)), material: beamMat, position: [beam[0], beam[1], beam[2]], rotation: [beam[3], beam[4], beam[5]] });
  });
  addMesh({ parent: group, name: 'house_wreck_roof_fragment', geometry: cloneUvToUv2(new THREE.BoxGeometry(11, 2.4, 13)), material: roofMat, position: [-1.5, 5.6, -10], rotation: [0.4, 0.16, -0.56] });
  addRubble(group, 'house_wreck_base_rubble', '#24140b', [[-12, 1.5, 9, 8.2, 2.4, 7.2, 0.16, -0.12, 0.18], [11, 1.6, -10, 7.4, 2.2, 8.1, 0.12, 0.24, -0.22], [0, 1.2, 0, 11, 1.8, 10, 0.05, 0.14, 0.08], [8, 2.0, 12, 5.4, 2.4, 4.8, 0.22, 0.38, -0.1], [-5, 1.4, -13, 5.0, 1.8, 6.0, 0.12, -0.3, 0.1]]);

  return group;
};

const buildBroadleafTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broadleaf';
  const trunkMat = makeMaterial({ color: '#986237', roughness: 0.94, map: cloneTexture(textures.METAL_DARK, 2.0, 1.8) });
  const rootMat = makeMaterial({ color: '#6d4528', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 1.6, 1.6) });
  const canopyMat = makeMaterial({ color: '#34704b', roughness: 0.86, map: cloneTexture(textures.CAMO, 2.4, 2.4) });
  const accentMat = makeMaterial({ color: '#58b174', roughness: 0.82, map: cloneTexture(textures.CAMO, 2.8, 2.8) });

  addMesh({ parent: group, name: 'tree_root', geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.2, 5.4, 4.4, 8)), material: rootMat, position: [0, 2.2, 0] });
  addMesh({ parent: group, name: 'tree_trunk', geometry: makeLatheAlongX([[0.7, -8], [1.8, -5], [2.6, 0], [2.1, 7], [1.2, 12]], 14), material: trunkMat, position: [0, 12, 0], rotation: [0, Math.PI / 2, 0], scale: [1.0, 1.25, 1.0] });
  [[-4.6, 13, -2.0, -0.8, 7.5], [5.2, 15.2, 1.5, 0.74, 8.4], [-1.5, 18.5, 4.5, -0.3, 7.0], [3.6, 20.2, -4.8, 0.46, 6.4]].forEach((branch, index) => {
    addMesh({ parent: group, name: `tree_branch_${index}`, geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.5, 0.9, branch[4], 6)), material: trunkMat, position: [branch[0], branch[1], branch[2]], rotation: [0.16, 0, branch[3]] });
  });
  [[-6, 20, -2, 8.6], [5.5, 22, -1, 8.0], [-1.0, 26, 3.2, 7.6], [2.6, 18.5, 6.5, 6.6]].forEach((blob, index) => {
    addMesh({ parent: group, name: `tree_canopy_${index}`, geometry: cloneUvToUv2(new THREE.IcosahedronGeometry(blob[3], 1)), material: canopyMat, position: [blob[0], blob[1], blob[2]], scale: [1.0, 0.9, 1.0] });
  });
  [[-1, 23.5, -5.5, 4.8], [7.5, 19.2, 4.2, 5.0], [-5.4, 27.4, 4.5, 4.2]].forEach((blob, index) => {
    addMesh({ parent: group, name: `tree_canopy_accent_${index}`, geometry: cloneUvToUv2(new THREE.IcosahedronGeometry(blob[3], 1)), material: accentMat, position: [blob[0], blob[1], blob[2]], scale: [1.0, 0.88, 1.0] });
  });

  return group;
};

const buildPineTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_pine';
  const trunkMat = makeMaterial({ color: '#9b6337', roughness: 0.94, map: cloneTexture(textures.METAL_DARK, 2.0, 1.8) });
  const rootMat = makeMaterial({ color: '#6b4426', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 1.6, 1.6) });
  const canopyMat = makeMaterial({ color: '#2f6b4f', roughness: 0.86, map: cloneTexture(textures.CAMO, 2.4, 2.4) });
  const accentMat = makeMaterial({ color: '#6ecf53', roughness: 0.82, map: cloneTexture(textures.CAMO, 2.8, 2.8) });

  addMesh({ parent: group, name: 'tree_root', geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.0, 5.2, 4.2, 8)), material: rootMat, position: [0, 2.1, 0] });
  addMesh({ parent: group, name: 'tree_trunk', geometry: makeLatheAlongX([[0.8, -10], [1.9, -6], [2.4, 0], [1.8, 8], [1.0, 14]], 14), material: trunkMat, position: [0, 13, 0], rotation: [0, Math.PI / 2, 0], scale: [0.92, 1.3, 0.92] });
  [[12, 16], [10, 22], [8.2, 28], [6.4, 33.5]].forEach((layer, index) => {
    addMesh({ parent: group, name: `tree_canopy_${index}`, geometry: cloneUvToUv2(new THREE.ConeGeometry(layer[0], 10, 7)), material: index === 2 ? accentMat : canopyMat, position: [0, layer[1], 0] });
  });
  [[-2.8, 15.2, 0, -0.9], [2.9, 18.1, 0, 0.92]].forEach((branch, index) => {
    addMesh({ parent: group, name: `tree_branch_${index}`, geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.34, 0.54, 4.8, 6)), material: trunkMat, position: [branch[0], branch[1], branch[2]], rotation: [0.15, 0, branch[3]] });
  });
  addMesh({ parent: group, name: 'tree_canopy_accent_top', geometry: cloneUvToUv2(new THREE.ConeGeometry(4.0, 8.5, 6)), material: accentMat, position: [0, 38, 0] });

  return group;
};

const buildBrokenBroadleafTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broken_broadleaf';
  const trunkMat = makeMaterial({ color: '#87512d', roughness: 0.96, map: cloneTexture(textures.METAL_DARK, 2.0, 1.8) });
  const rootMat = makeMaterial({ color: '#6a4426', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 1.6, 1.6) });
  const canopyMat = makeMaterial({ color: '#35704b', roughness: 0.86, map: cloneTexture(textures.CAMO, 2.4, 2.4) });
  const accentMat = makeMaterial({ color: '#5fbe77', roughness: 0.82, map: cloneTexture(textures.CAMO, 2.8, 2.8) });

  addMesh({ parent: group, name: 'tree_root', geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.2, 5.2, 4.2, 8)), material: rootMat, position: [0, 2.1, 0] });
  addMesh({ parent: group, name: 'tree_trunk', geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.1, 2.8, 14, 8)), material: trunkMat, position: [0, 7, 0] });
  addMesh({ parent: group, name: 'tree_fallen_trunk', geometry: cloneUvToUv2(new THREE.CylinderGeometry(1.4, 1.9, 22, 8)), material: trunkMat, position: [8.5, 4.8, -6.4], rotation: [0.14, 0.18, -1.02] });
  addMesh({ parent: group, name: 'tree_canopy_0', geometry: cloneUvToUv2(new THREE.IcosahedronGeometry(6.5, 1)), material: canopyMat, position: [12, 7, -9] });
  addMesh({ parent: group, name: 'tree_canopy_accent_0', geometry: cloneUvToUv2(new THREE.IcosahedronGeometry(5.2, 1)), material: accentMat, position: [16, 8, -12] });
  [[1.4, 13.3, 0.5, 0.4], [-1.5, 12.7, -0.7, -0.34], [0.0, 13.8, -1.0, 0.16]].forEach((splinter, index) => {
    addMesh({ parent: group, name: `tree_splinter_${index}`, geometry: cloneUvToUv2(new THREE.BoxGeometry(0.9, 6.8, 0.9)), material: trunkMat, position: [splinter[0], splinter[1], splinter[2]], rotation: [0.1, 0.16, splinter[3]] });
  });

  return group;
};

const buildBrokenPineTree = () => {
  const group = new THREE.Group();
  group.name = 'tree_broken_pine';
  const trunkMat = makeMaterial({ color: '#87512d', roughness: 0.96, map: cloneTexture(textures.METAL_DARK, 2.0, 1.8) });
  const rootMat = makeMaterial({ color: '#6a4426', roughness: 0.98, map: cloneTexture(textures.METAL_GREY, 1.6, 1.6) });
  const canopyMat = makeMaterial({ color: '#2f6b4f', roughness: 0.86, map: cloneTexture(textures.CAMO, 2.4, 2.4) });
  const accentMat = makeMaterial({ color: '#6fcf52', roughness: 0.82, map: cloneTexture(textures.CAMO, 2.8, 2.8) });

  addMesh({ parent: group, name: 'tree_root', geometry: cloneUvToUv2(new THREE.CylinderGeometry(4.0, 5.0, 4.0, 8)), material: rootMat, position: [0, 2.0, 0] });
  addMesh({ parent: group, name: 'tree_trunk', geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.0, 2.6, 14, 8)), material: trunkMat, position: [0, 7, 0] });
  addMesh({ parent: group, name: 'tree_fallen_trunk', geometry: cloneUvToUv2(new THREE.CylinderGeometry(1.4, 1.8, 22, 8)), material: trunkMat, position: [8.2, 5.0, -6.2], rotation: [0.12, 0.16, -1.04] });
  addMesh({ parent: group, name: 'tree_canopy_0', geometry: cloneUvToUv2(new THREE.ConeGeometry(10, 20, 7)), material: canopyMat, position: [14, 7, -10], rotation: [0.24, 0.48, -0.82] });
  addMesh({ parent: group, name: 'tree_canopy_accent_0', geometry: cloneUvToUv2(new THREE.ConeGeometry(6.4, 10, 6)), material: accentMat, position: [17, 9.2, -13.5], rotation: [0.18, 0.32, -0.78] });
  [[1.2, 13.1, 0.5, 0.42], [-0.7, 13.8, -0.2, -0.24]].forEach((splinter, index) => {
    addMesh({ parent: group, name: `tree_splinter_${index}`, geometry: cloneUvToUv2(new THREE.BoxGeometry(0.9, 7.2, 0.9)), material: trunkMat, position: [splinter[0], splinter[1], splinter[2]], rotation: [0.08, 0.14, splinter[3]] });
  });
  addMesh({ parent: group, name: 'tree_root_stone_0', geometry: cloneUvToUv2(new THREE.DodecahedronGeometry(2.0, 0)), material: makeMaterial({ color: '#3a434f', roughness: 1.0 }), position: [-3.4, 1.0, 2.4] });

  return group;
};

const buildStreetLamp = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_lamp';
  const metalMat = makeMaterial({ color: '#4a5a6d', roughness: 0.48, metalness: 0.58, map: cloneTexture(textures.RIVET_METAL, 2.0, 2.0) });
  const trimMat = makeMaterial({ color: '#8ea0b3', roughness: 0.38, metalness: 0.62, map: cloneTexture(textures.METAL_GREY, 2.0, 2.0) });
  const lampMat = makeMaterial({ color: '#fff1bf', emissive: '#fde68a', emissiveIntensity: 0.6, roughness: 0.18, metalness: 0.08 });

  addMesh({ parent: group, name: 'street_metal_base', geometry: cloneUvToUv2(new THREE.CylinderGeometry(2.8, 3.2, 1.4, 12)), material: metalMat, position: [0, 0.7, 0] });
  addMesh({ parent: group, name: 'street_metal_pole', geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.46, 0.62, 27.5, 10)), material: metalMat, position: [0, 14, 0] });
  addMesh({ parent: group, name: 'street_metal_arm', geometry: cloneUvToUv2(new THREE.CapsuleGeometry(0.22, 8, 4, 8)), material: trimMat, position: [2.8, 26.5, 0], rotation: [0, 0, -Math.PI / 2] });
  addMesh({ parent: group, name: 'street_metal_head', geometry: cloneUvToUv2(new THREE.BoxGeometry(2.8, 1.3, 2.0)), material: trimMat, position: [6.4, 26, 0] });
  addMesh({ parent: group, name: 'street_emissive_lamp', geometry: cloneUvToUv2(new THREE.BoxGeometry(2.1, 0.52, 1.3)), material: lampMat, position: [6.4, 25.2, 0] });

  return group;
};

const buildUtilityPole = () => {
  const group = new THREE.Group();
  group.name = 'prop_utility_pole';
  addMesh({ parent: group, name: 'street_wood_pole', geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.66, 0.98, 33, 8)), material: makeMaterial({ color: '#744725', roughness: 0.96, map: cloneTexture(textures.METAL_DARK, 2.0, 2.4) }), position: [0, 16.5, 0] });
  addMesh({ parent: group, name: 'street_metal_crossbar', geometry: cloneUvToUv2(new THREE.BoxGeometry(10.5, 0.6, 0.6)), material: makeMaterial({ color: '#8f613f', roughness: 0.84, metalness: 0.08 }), position: [0, 27.8, 0] });
  [-3.4, 0, 3.4].forEach((x, index) => {
    addMesh({ parent: group, name: `street_metal_insulator_${index}`, geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.36, 0.36, 0.5, 8)), material: makeMaterial({ color: '#d8dee8', roughness: 0.34, metalness: 0.44 }), position: [x, 27.2, 0] });
  });
  addMesh({ parent: group, name: 'street_metal_transformer', geometry: cloneUvToUv2(new THREE.CylinderGeometry(1.7, 1.7, 3.8, 12)), material: makeMaterial({ color: '#98a8b7', roughness: 0.42, metalness: 0.58, map: cloneTexture(textures.METAL_GREY, 1.6, 1.6) }), position: [2.8, 22.5, 0] });
  return group;
};

const buildStreetSign = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_sign';
  addMesh({ parent: group, name: 'street_metal_pole', geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.24, 0.3, 11, 8)), material: makeMaterial({ color: '#66788a', roughness: 0.44, metalness: 0.56 }), position: [0, 5.5, 0] });
  addMesh({ parent: group, name: 'street_panel_trim', geometry: cloneUvToUv2(new THREE.BoxGeometry(7.4, 3.8, 0.2)), material: makeMaterial({ color: '#eef2f7', roughness: 0.74, metalness: 0.22 }), position: [0, 10.2, -0.1] });
  addMesh({ parent: group, name: 'street_panel_main', geometry: cloneUvToUv2(new THREE.BoxGeometry(6.8, 3.2, 0.36)), material: makeMaterial({ color: '#2353a4', roughness: 0.28, metalness: 0.18 }), position: [0, 10.2, 0] });
  addMesh({ parent: group, name: 'street_warning_plate', geometry: cloneUvToUv2(new THREE.BoxGeometry(2.6, 1.5, 0.24)), material: makeMaterial({ color: '#f6a11a', roughness: 0.54, metalness: 0.12 }), position: [0, 7.2, 0] });
  return group;
};

const buildRoadBarrier = () => {
  const group = new THREE.Group();
  group.name = 'prop_road_barrier';
  addMesh({ parent: group, name: 'street_warning_block', geometry: cloneUvToUv2(new THREE.BoxGeometry(9.5, 3, 2.8)), material: makeMaterial({ color: '#ef7b1a', roughness: 0.72, metalness: 0.08 }), position: [0, 1.5, 0] });
  addMesh({ parent: group, name: 'street_warning_stripe', geometry: cloneUvToUv2(new THREE.BoxGeometry(9.0, 0.5, 0.18)), material: makeMaterial({ color: '#f8fafc', roughness: 0.82 }), position: [0, 1.5, 1.45], rotation: [0, 0, 0.22] });
  addMesh({ parent: group, name: 'street_warning_stripe_back', geometry: cloneUvToUv2(new THREE.BoxGeometry(9.0, 0.5, 0.18)), material: makeMaterial({ color: '#f8fafc', roughness: 0.82 }), position: [0, 1.5, -1.45], rotation: [0, Math.PI, -0.22] });
  [-2.7, 2.7].forEach((x, index) => {
    addMesh({ parent: group, name: `street_metal_foot_${index}`, geometry: cloneUvToUv2(new THREE.BoxGeometry(2.3, 0.7, 3.5)), material: makeMaterial({ color: '#4c5c6d', roughness: 0.58, metalness: 0.26 }), position: [x, 0.35, 0] });
  });
  return group;
};

const buildSupplyCrate = () => {
  const group = new THREE.Group();
  group.name = 'prop_supply_crate';
  addMesh({ parent: group, name: 'street_crate_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(6.2, 4.2, 4.2)), material: makeMaterial({ color: '#845a31', roughness: 0.92, map: cloneTexture(textures.METAL_DARK, 2.0, 1.8) }), position: [0, 2.1, 0] });
  addMesh({ parent: group, name: 'street_crate_lid', geometry: cloneUvToUv2(new THREE.BoxGeometry(6.4, 0.65, 4.4)), material: makeMaterial({ color: '#684424', roughness: 0.88, map: cloneTexture(textures.METAL_DARK, 2.0, 1.6) }), position: [0, 4.4, 0] });
  addMesh({ parent: group, name: 'street_tarp_roll', geometry: cloneUvToUv2(new THREE.CylinderGeometry(0.82, 0.82, 4.6, 10)), material: makeMaterial({ color: '#516172', roughness: 0.82, metalness: 0.1 }), position: [0.1, 5.2, 0], rotation: [0, 0, Math.PI / 2] });
  addMesh({ parent: group, name: 'street_metal_latch', geometry: cloneUvToUv2(new THREE.BoxGeometry(0.65, 0.95, 0.24)), material: makeMaterial({ color: '#d5dde6', roughness: 0.36, metalness: 0.62 }), position: [2.8, 2.4, 2.22] });
  return group;
};

const buildStreetWreck = () => {
  const group = new THREE.Group();
  group.name = 'prop_street_wreck';
  addMesh({ parent: group, name: 'street_wreck_body', geometry: cloneUvToUv2(new THREE.BoxGeometry(13, 4.6, 22.5)), material: makeMaterial({ color: '#6e2020', roughness: 0.78, metalness: 0.2, map: cloneTexture(textures.RIVET_METAL, 2.4, 1.8) }), position: [0, 3.5, 0], rotation: [0.08, 0.16, -0.08] });
  addMesh({ parent: group, name: 'street_wreck_cabin', geometry: cloneUvToUv2(new THREE.BoxGeometry(9.2, 3.6, 10.5)), material: makeMaterial({ color: '#354657', roughness: 0.62, metalness: 0.28, map: cloneTexture(textures.METAL_GREY, 2.2, 1.8) }), position: [0.8, 6.1, -2.4], rotation: [0.18, 0.2, 0.22] });
  addMesh({ parent: group, name: 'street_glass_window', geometry: cloneUvToUv2(new THREE.BoxGeometry(7.0, 1.9, 0.18)), material: makeMaterial({ color: '#97c4fc', emissive: '#60a5fa', emissiveIntensity: 0.12, roughness: 0.12, metalness: 0.22 }), position: [0.8, 6.5, 2.5], rotation: [0.22, 0.2, 0.22] });
  [-4.8, 4.8].forEach((x, index) => {
    addMesh({ parent: group, name: `street_metal_wheel_${index}`, geometry: cloneUvToUv2(new THREE.CylinderGeometry(1.35, 1.35, 1.2, 12)), material: makeMaterial({ color: '#10161e', roughness: 0.66, metalness: 0.3 }), position: [x, 1.2, index === 0 ? 6.6 : -6.6], rotation: [Math.PI / 2, 0.18, 0] });
  });
  return group;
};

[
  buildResidentialHouse(),
  buildTowerHouse(),
  buildBrokenHouse(),
  buildRuinedHouse(),
  buildBroadleafTree(),
  buildPineTree(),
  buildBrokenBroadleafTree(),
  buildBrokenPineTree(),
  buildStreetLamp(),
  buildUtilityPole(),
  buildStreetSign(),
  buildRoadBarrier(),
  buildSupplyCrate(),
  buildStreetWreck(),
].forEach((group) => root.add(group));

const scene = new THREE.Scene();
scene.add(root);

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(
    scene,
    (result) => resolve(result),
    (error) => reject(error),
    { binary: true, onlyVisible: true, includeCustomExtensions: false },
  );
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, Buffer.from(arrayBuffer));

console.log(`Wrote ${outPath}`);
