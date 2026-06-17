'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';

const OutlineShaderMaterial = shaderMaterial(
  {
    uOutlineColor: new THREE.Color(0x000000),
    uOutlineThickness: 0.05,
  },
  // Vertex shader - inverted hull method
  `
    uniform float uOutlineThickness;
    
    void main() {
      // Expand along normals
      vec3 expanded = position + normal * uOutlineThickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
    }
  `,
  // Fragment shader
  `
    uniform vec3 uOutlineColor;
    
    void main() {
      gl_FragColor = vec4(uOutlineColor, 1.0);
    }
  `
);

extend({ OutlineShaderMaterial });

export function useOutlineMaterial({ color = 0x000000, thickness = 0.05 } = {}) {
  const material = useMemo(() => {
    return new OutlineShaderMaterial({
      uOutlineColor: new THREE.Color(color),
      uOutlineThickness: thickness,
      side: THREE.BackSide,
    });
  }, [color, thickness]);
  
  return material;
}

export default OutlineShaderMaterial;
