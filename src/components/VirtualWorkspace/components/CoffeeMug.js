'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function CoffeeMug({ position = [0, 0, 0], color = 0xffffff }) {
  const material = useToonMaterial({ color, shadowColor: 0xcccccc, highlightColor: 0xffffff });
  
  return (
    <group position={position}>
      <mesh material={material}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 16]} />
      </mesh>
      <mesh material={material} position={[0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.02, 0.008, 8, 16, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.01, 16]} />
        <meshStandardMaterial color={0x3a1a0a} />
      </mesh>
    </group>
  );
}
