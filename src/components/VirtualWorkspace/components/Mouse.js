'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Mouse({ position = [0, 0, 0] }) {
  const material = useToonMaterial({ color: 0x555555, shadowColor: 0x333333, highlightColor: 0x777777 });
  
  return (
    <group position={position}>
      <mesh material={material}>
        <capsuleGeometry args={[0.03, 0.06, 8, 16]} />
      </mesh>
      <mesh position={[0, 0.03, 0.02]}>
        <cylinderGeometry args={[0.008, 0.008, 0.02, 8]} />
        <meshStandardMaterial color={0x888888} />
      </mesh>
    </group>
  );
}
