'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function DeployMonitor({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  isActive = false,
  branch = 'main',
  progress = 0,
  color = 0x333333
}) {
  const { ctx, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return { ctx, texture };
  }, []);

  /* eslint-disable react-hooks/immutability -- CanvasTexture requires imperative mutation for per-frame updates */
  useFrame((state) => {
    if (!isActive) return;
    const time = state.clock.elapsedTime;

    const dots = '.'.repeat(Math.floor(time * 2) % 4);
    const clampedProgress = Math.min(progress, 100);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('DEPLOYMENT', 190, 40);

    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.fillText(`Branch: ${branch}`, 20, 80);
    ctx.fillText(`Status: Deploying${dots}`, 20, 105);

    ctx.fillStyle = '#333333';
    ctx.fillRect(20, 140, 472, 30);

    ctx.fillStyle = '#00ff88';
    ctx.fillRect(22, 142, (468 * clampedProgress) / 100, 26);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${Math.round(clampedProgress)}%`, 230, 160);

    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px monospace';
    ctx.fillText('Building...', 20, 200);
    ctx.fillText('Testing...', 20, 220);
    ctx.fillText('Deploying...', 20, 240);

    texture.needsUpdate = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <Monitor position={position} rotation={rotation} screenContent={texture} isActive={isActive} color={color} />;
}
