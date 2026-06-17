'use client';

import { useRef } from 'react';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Desk({ position = [0, 0, 0], color = 0x8B6914 }) {
  const groupRef = useRef();
  const material = useToonMaterial({ 
    color, 
    shadowColor: 0x5a4510, 
    highlightColor: 0xc49a2a 
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* Desktop surface */}
      <mesh material={material} position={[0, 0.75, 0]}>
        <boxGeometry args={[2.0, 0.08, 1.0]} />
      </mesh>
      
      {/* Legs */}
      {[[-0.9, 0.375, -0.4], [0.9, 0.375, -0.4], [-0.9, 0.375, 0.4], [0.9, 0.375, 0.4]].map((pos, i) => (
        <mesh key={i} material={material} position={pos}>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
        </mesh>
      ))}
      
      {/* Drawer */}
      <mesh material={material} position={[0.6, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.35, 0.9]} />
      </mesh>
      
      {/* Drawer handle */}
      <mesh position={[0.6, 0.55, 0.46]}>
        <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
        <meshStandardMaterial color={0x888888} metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}
