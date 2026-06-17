'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Character({ position = [0, 0, 0], color = 0xffcc99 }) {
  const groupRef = useRef();
  const bodyMaterial = useToonMaterial({ 
    color: 0x4488ff, 
    shadowColor: 0x2244aa, 
    highlightColor: 0x66aaff 
  });
  const skinMaterial = useToonMaterial({ 
    color, 
    shadowColor: 0xcc9966, 
    highlightColor: 0xffddbb 
  });
  const hairMaterial = useToonMaterial({ 
    color: 0x333333, 
    shadowColor: 0x111111, 
    highlightColor: 0x555555 
  });
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.scale.y = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.02;
    }
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* Head - exaggerated size for chibi */}
      <mesh material={skinMaterial} position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
      </mesh>
      
      {/* Hair */}
      <mesh material={hairMaterial} position={[0, 1.55, -0.05]}>
        <sphereGeometry args={[0.37, 16, 16]} />
      </mesh>
      
      {/* Eyes */}
      {[[-0.12, 1.45, 0.3], [0.12, 1.45, 0.3]].map((pos, i) => (
        <group key={i} position={pos}>
          <mesh>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={0x000000} />
          </mesh>
          {/* Eye highlight */}
          <mesh position={[0.02, 0.02, 0.05]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}
      
      {/* Mouth */}
      <mesh position={[0, 1.35, 0.33]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color={0xff6666} />
      </mesh>
      
      {/* Body - small for chibi proportions */}
      <mesh material={bodyMaterial} position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
      </mesh>
      
      {/* Arms */}
      {[[-0.35, 1.0, 0], [0.35, 1.0, 0]].map((pos, i) => (
        <mesh key={i} material={bodyMaterial} position={pos} rotation={[0, 0, i === 0 ? -0.3 : 0.3]}>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
        </mesh>
      ))}
      
      {/* Legs */}
      {[[-0.12, 0.45, 0], [0.12, 0.45, 0]].map((pos, i) => (
        <mesh key={i} material={bodyMaterial} position={pos}>
          <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}
