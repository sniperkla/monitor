'use client';

import * as THREE from 'three';
import { useMemo } from 'react';

const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uShadowColor;
  uniform vec3 uHighlightColor;
  uniform vec3 uLightDir;
  uniform float uShadowThreshold;
  uniform float uHighlightThreshold;
  
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  
  void main() {
    vec3 normal = normalize(vNormal);
    float NdotL = dot(normal, normalize(uLightDir));
    
    // 3-tone cel shading
    vec3 color = uShadowColor;
    color = mix(color, uColor, step(uShadowThreshold, NdotL));
    color = mix(color, uHighlightColor, step(uHighlightThreshold, NdotL));
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function useToonMaterial({ color = 0x88ccff, shadowColor = 0x4466aa, highlightColor = 0xffffff } = {}) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uShadowColor: { value: new THREE.Color(shadowColor) },
        uHighlightColor: { value: new THREE.Color(highlightColor) },
        uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
        uShadowThreshold: { value: 0.3 },
        uHighlightThreshold: { value: 0.7 },
      },
      vertexShader,
      fragmentShader,
    });
  }, [color, shadowColor, highlightColor]);
  
  return material;
}

export default useToonMaterial;
