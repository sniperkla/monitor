'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Chair({ position = [0, 0, 0], color = 0x222222 }) {
  const material = useToonMaterial({ color, shadowColor: 0x111111, highlightColor: 0x444444 });
  
  return (
    <group position={position}>
      <mesh material={material} position={[0, 0.45, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
      </mesh>
      <mesh material={material} position={[0, 0.75, -0.22]}>
        <boxGeometry args={[0.5, 0.55, 0.06]} />
      </mesh>
      {[[-0.2, 0.22, -0.2], [0.2, 0.22, -0.2], [-0.2, 0.22, 0.2], [0.2, 0.22, 0.2]].map((pos, i) => (
        <mesh key={i} material={material} position={pos}>
          <cylinderGeometry args={[0.025, 0.025, 0.44, 8]} />
        </mesh>
      ))}
      {[[-0.2, 0.02, -0.2], [0.2, 0.02, -0.2], [-0.2, 0.02, 0.2], [0.2, 0.02, 0.2]].map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color={0x444444} />
        </mesh>
      ))}
    </group>
  );
}
