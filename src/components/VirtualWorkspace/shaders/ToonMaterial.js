'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef, useMemo } from 'react';

const ToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color(0x88ccff),
    uShadowColor: new THREE.Color(0x4466aa),
    uHighlightColor: new THREE.Color(0xffffff),
    uLightDir: new THREE.Vector3(1, 1, 1).normalize(),
    uShadowThreshold: 0.3,
    uHighlightThreshold: 0.7,
    uOutlineThickness: 0.05,
    uTime: 0,
  },
  // Vertex shader
  `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // Fragment shader
  `
    uniform vec3 uColor;
    uniform vec3 uShadowColor;
    uniform vec3 uHighlightColor;
    uniform vec3 uLightDir;
    uniform float uShadowThreshold;
    uniform float uHighlightThreshold;
    uniform float uTime;
    
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
  `
);

extend({ ToonShaderMaterial });

export function useToonMaterial({ color = 0x88ccff, shadowColor = 0x4466aa, highlightColor = 0xffffff } = {}) {
  const materialRef = useRef();
  
  const material = useMemo(() => {
    return new ToonShaderMaterial({
      uColor: new THREE.Color(color),
      uShadowColor: new THREE.Color(shadowColor),
      uHighlightColor: new THREE.Color(highlightColor),
    });
  }, [color, shadowColor, highlightColor]);
  
  return material;
}

export default ToonShaderMaterial;
