'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Keyboard({ position = [0, 0, 0] }) {
  const material = useToonMaterial({ color: 0x444444, shadowColor: 0x222222, highlightColor: 0x666666 });
  
  return (
    <group position={position}>
      <mesh material={material}>
        <boxGeometry args={[0.4, 0.02, 0.15]} />
      </mesh>
      {[-0.12, -0.04, 0.04, 0.12].map((z, i) => (
        <mesh key={i} position={[0, 0.015, z]}>
          <boxGeometry args={[0.35, 0.01, 0.03]} />
          <meshStandardMaterial color={0x555555} />
        </mesh>
      ))}
    </group>
  );
}
