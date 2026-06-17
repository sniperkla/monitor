'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const INDICATOR_CONFIGS = {
  ssh: { color: 0x00ff88, label: 'SSH' },
  db: { color: 0xff8800, label: 'DB' },
  deploy: { color: 0xff00aa, label: 'Deploy' },
  server: { color: 0x00aaff, label: 'Server' },
};

function StatusSphere({ position, color, intensity = 1, pulseSpeed = 2 }) {
  const meshRef = useRef();
  const glowRef = useRef();

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        toneMapped: false,
      }),
    [color, intensity]
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity * 2,
        transparent: true,
        opacity: 0.3,
        toneMapped: false,
      }),
    [color, intensity]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (meshRef.current) {
      const pulse = 1 + Math.sin(t * pulseSpeed) * 0.2;
      meshRef.current.scale.setScalar(pulse);
      material.emissiveIntensity = intensity * (0.8 + Math.sin(t * pulseSpeed) * 0.4);
    }
    if (glowRef.current) {
      const glowPulse = 1 + Math.sin(t * pulseSpeed) * 0.3;
      glowRef.current.scale.setScalar(glowPulse);
      glowMaterial.opacity = 0.2 + Math.sin(t * pulseSpeed) * 0.15;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef} material={material}>
        <sphereGeometry args={[0.06, 12, 12]} />
      </mesh>
      <mesh ref={glowRef} material={glowMaterial}>
        <sphereGeometry args={[0.12, 12, 12]} />
      </mesh>
    </group>
  );
}

export default function StatusIndicators({
  position = [0, 2.0, 0],
  sshCount = 0,
  dbCount = 0,
  deployActive = false,
  serverOnline = false,
}) {
  const groupRef = useRef();

  const indicators = useMemo(() => {
    const items = [];
    let index = 0;

    if (sshCount > 0) {
      items.push({
        key: 'ssh',
        ...INDICATOR_CONFIGS.ssh,
        intensity: Math.min(1 + sshCount * 0.3, 2.5),
        pulseSpeed: 2 + sshCount * 0.5,
      });
      index++;
    }

    if (dbCount > 0) {
      items.push({
        key: 'db',
        ...INDICATOR_CONFIGS.db,
        intensity: Math.min(1 + dbCount * 0.3, 2.5),
        pulseSpeed: 1.5 + dbCount * 0.3,
      });
      index++;
    }

    if (deployActive) {
      items.push({
        key: 'deploy',
        ...INDICATOR_CONFIGS.deploy,
        intensity: 2.0,
        pulseSpeed: 4,
      });
      index++;
    }

    if (serverOnline) {
      items.push({
        key: 'server',
        ...INDICATOR_CONFIGS.server,
        intensity: 1.5,
        pulseSpeed: 1,
      });
      index++;
    }

    return items;
  }, [sshCount, dbCount, deployActive, serverOnline]);

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime;
      groupRef.current.position.y = position[1] + Math.sin(t * 1.5) * 0.05;
    }
  });

  if (indicators.length === 0) return null;

  const spacing = 0.2;
  const startX = -((indicators.length - 1) * spacing) / 2;

  return (
    <group ref={groupRef} position={position}>
      {indicators.map((ind, i) => (
        <StatusSphere
          key={ind.key}
          position={[startX + i * spacing, 0, 0]}
          color={ind.color}
          intensity={ind.intensity}
          pulseSpeed={ind.pulseSpeed}
        />
      ))}
    </group>
  );
}
