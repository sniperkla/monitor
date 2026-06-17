'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Monitor({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  screenContent = null,
  isActive = false,
  color = 0x333333
}) {
  const groupRef = useRef();
  const screenRef = useRef();
  const frameMaterial = useToonMaterial({
    color,
    shadowColor: 0x111111,
    highlightColor: 0x555555
  });

  const screenTexture = useMemo(() => {
    if (screenContent instanceof THREE.CanvasTexture) {
      return screenContent;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = '#00ff00';
    ctx.font = '14px monospace';
    ctx.fillText('$ ssh user@server', 20, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Welcome to Ubuntu 22.04 LTS', 20, 55);
    ctx.fillText('Last login: Mon Jun 16 2026', 20, 75);
    ctx.fillStyle = '#00ff00';
    ctx.fillText('$ _', 20, 95);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, [screenContent]);

  useFrame((state) => {
    if (screenRef.current && isActive) {
      screenRef.current.material.emissiveIntensity =
        0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.2;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh material={frameMaterial}>
        <boxGeometry args={[0.8, 0.5, 0.05]} />
      </mesh>

      <mesh ref={screenRef} position={[0, 0, 0.026]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial
          map={screenTexture}
          emissive={isActive ? 0x00ff88 : 0x000000}
          emissiveIntensity={isActive ? 0.5 : 0}
          toneMapped={false}
        />
      </mesh>

      <mesh material={frameMaterial} position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
      </mesh>

      <mesh material={frameMaterial} position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.02, 16]} />
      </mesh>
    </group>
  );
}
