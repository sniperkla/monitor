import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { installPolyfills, autoMap } from './falloutTextureUtils.mjs';

export class NodeFileReader {
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

export const cloneUvToUv2 = (geometry) => {
  if (!geometry?.attributes?.uv || geometry.attributes.uv2) return geometry;
  geometry.setAttribute('uv2', new THREE.BufferAttribute(geometry.attributes.uv.array.slice(), 2));
  return geometry;
};

export const makeMaterial = ({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  roughness = 0.82,
  metalness = 0.12,
  envMapIntensity,
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
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: Math.min(emissiveIntensity, 2),
    roughness,
    metalness,
    ...(envMapIntensity !== undefined ? { envMapIntensity } : {}),
    transparent,
    opacity,
    depthWrite: !transparent,
    ...(side !== undefined ? { side } : {}),
    ...(normalMap ? { normalMap } : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
    ...(aoMap ? { aoMap, aoMapIntensity } : {}),
  });

  const texture = map !== undefined
    ? map
    : (!transparent && opacity >= 0.95 && emissiveIntensity <= 0.35 ? autoMap(color) : null);
  if (texture) material.map = texture;

  if (normalMap && normalScale) {
    material.normalScale = Array.isArray(normalScale)
      ? new THREE.Vector2(normalScale[0], normalScale[1])
      : normalScale;
  }

  return material;
};

export const addMesh = ({
  parent,
  name,
  geometry,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
}) => {
  const mesh = new THREE.Mesh(geometry, material);
  if (name) mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  parent.add(mesh);
  return mesh;
};

export const makeLatheAlongX = (profile, segments = 16) => {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, x]) => new THREE.Vector2(radius, x)),
    segments,
  );
  geometry.rotateZ(-Math.PI / 2);
  geometry.computeVertexNormals();
  return cloneUvToUv2(geometry);
};

export const makeExtrudedPlanform = (points, thickness, offsetY = 0, curveSegments = 6) => {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index][0], points[index][1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments,
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

export const mergeMeshGroupByMaterial = ({ parent, name, meshes, removeSources = true }) => {
  if (!parent || !Array.isArray(meshes) || meshes.length === 0) return [];

  parent.updateMatrixWorld(true);
  const parentInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const buckets = new Map();

  meshes.forEach((mesh) => {
    if (!mesh?.isMesh || !mesh.geometry || Array.isArray(mesh.material)) return;
    mesh.updateWorldMatrix(true, false);
    const geometry = cloneUvToUv2(mesh.geometry.clone());
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(parentInverse, mesh.matrixWorld));
    geometry.computeVertexNormals();

    const key = mesh.material.uuid;
    if (!buckets.has(key)) {
      buckets.set(key, { material: mesh.material, geometries: [] });
    }
    buckets.get(key).geometries.push(geometry);
  });

  const mergedMeshes = [];
  let bucketIndex = 0;
  buckets.forEach(({ material, geometries }) => {
    if (geometries.length === 0) return;
    const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!mergedGeometry) return;
    cloneUvToUv2(mergedGeometry);
    const mergedMesh = new THREE.Mesh(mergedGeometry, material);
    mergedMesh.name = buckets.size === 1 ? name : `${name}_${bucketIndex}`;
    parent.add(mergedMesh);
    mergedMeshes.push(mergedMesh);
    bucketIndex += 1;
  });

  if (removeSources) {
    meshes.forEach((mesh) => mesh?.parent?.remove(mesh));
  }

  return mergedMeshes;
};

export { autoMap, mergeGeometries };
