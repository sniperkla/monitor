'use client';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function exportSceneToGLB(scene, filename = 'virtual-workspace.glb') {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();

    exporter.parse(
      scene,
      (result) => {
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
        resolve(true);
      },
      (error) => {
        console.error('GLB export failed:', error);
        reject(error);
      },
      { binary: true }
    );
  });
}

export function downloadGLB(blob, filename = 'virtual-workspace.glb') {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
