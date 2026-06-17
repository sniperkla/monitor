'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useToonMaterial } from '../shaders/ToonMaterial';

function SteamParticles() {
  const particlesRef = useRef();
  const count = 6;

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      // Use deterministic values based on index
      const t = i / count;
      pos[i * 3] = (t - 0.5) * 0.02;
      pos[i * 3 + 1] = 0.05 + t * 0.05;
      pos[i * 3 + 2] = ((t * 7) % 1 - 0.5) * 0.02;
      vel.push({
        x: ((t * 3) % 1 - 0.5) * 0.002,
        y: 0.003 + t * 0.002,
        z: ((t * 5) % 1 - 0.5) * 0.002,
      });
    }
    return { positions: pos, velocities: vel };
  }, []);

  useFrame(() => {
    if (!particlesRef.current) return;
    const pos = particlesRef.current.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      pos.array[i * 3] += velocities[i].x;
      pos.array[i * 3 + 1] += velocities[i].y;
      pos.array[i * 3 + 2] += velocities[i].z;

      // Reset when too high
      if (pos.array[i * 3 + 1] > 0.3) {
        const t = i / count;
        pos.array[i * 3] = (t - 0.5) * 0.02;
        pos.array[i * 3 + 1] = 0.05;
        pos.array[i * 3 + 2] = ((t * 7) % 1 - 0.5) * 0.02;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.015} color={0xffffff} transparent opacity={0.3} sizeAttenuation />
    </points>
  );
}

export default function CoffeeMug({ position = [0, 0, 0], color = 0xffffff }) {
  const material = useToonMaterial({ color, shadowColor: 0xcccccc, highlightColor: 0xffffff });
  const mugRef = useRef();

  useFrame((state) => {
    if (mugRef.current) {
      // Subtle wobble
      mugRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
    }
  });

  return (
    <group ref={mugRef} position={position}>
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
      {/* Steam */}
      <SteamParticles />
    </group>
  );
}
