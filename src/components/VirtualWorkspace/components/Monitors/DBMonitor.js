'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function DBMonitor({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  isActive = false,
  dbName = 'PostgreSQL',
  queryCount = 0,
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

    const pulse = Math.sin(time * 4) * 0.3 + 0.7;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = `rgba(0, 255, 136, ${pulse})`;
    ctx.font = 'bold 20px monospace';
    ctx.fillText('DATABASE', 200, 40);

    ctx.fillStyle = '#00ff00';
    ctx.font = '14px monospace';
    ctx.fillText('Status: Connected', 20, 80);
    ctx.fillText(`Engine: ${dbName}`, 20, 105);
    ctx.fillText(`Queries: ${queryCount}`, 20, 130);

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText('SELECT * FROM users', 20, 170);
    ctx.fillText('INSERT INTO logs ...', 20, 190);
    ctx.fillText('UPDATE status SET ...', 20, 210);

    ctx.fillStyle = `rgba(0, 255, 136, ${pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(460, 40, 15, 0, Math.PI * 2);
    ctx.fill();

    texture.needsUpdate = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <Monitor position={position} rotation={rotation} screenContent={texture} isActive={isActive} color={color} />;
}
