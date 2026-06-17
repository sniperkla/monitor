'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function ServerMonitor({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  isActive = false,
  servers = [
    { name: 'web-01', status: 'online', cpu: 45, ram: 62 },
    { name: 'api-01', status: 'online', cpu: 30, ram: 55 },
    { name: 'db-01', status: 'warning', cpu: 78, ram: 85 }
  ],
  color = 0x333333
}) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);

  const { texture, canvas, ctx } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    canvasRef.current = canvas;
    textureRef.current = texture;
    return { texture, canvas, ctx };
  }, []);

  useFrame((state) => {
    if (!isActive) return;
    const time = state.clock.elapsedTime;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('SERVER STATUS', 170, 35);

    servers.forEach((server, i) => {
      const y = 60 + i * 80;

      ctx.fillStyle = '#2a2a3e';
      ctx.fillRect(20, y, 472, 70);

      const statusColor = server.status === 'online' ? '#00ff00' : server.status === 'warning' ? '#ffaa00' : '#ff0000';
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(45, y + 20, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(server.name, 60, y + 25);

      ctx.fillStyle = '#aaaaaa';
      ctx.font = '12px monospace';
      ctx.fillText(`CPU: ${server.cpu}%`, 200, y + 25);
      ctx.fillText(`RAM: ${server.ram}%`, 340, y + 25);

      ctx.fillStyle = '#333333';
      ctx.fillRect(20, y + 40, 200, 10);
      ctx.fillRect(260, y + 40, 200, 10);

      const cpuColor = server.cpu > 70 ? '#ff4444' : server.cpu > 50 ? '#ffaa00' : '#00ff00';
      const ramColor = server.ram > 70 ? '#ff4444' : server.ram > 50 ? '#ffaa00' : '#00ff00';

      ctx.fillStyle = cpuColor;
      ctx.fillRect(20, y + 40, 200 * server.cpu / 100, 10);

      ctx.fillStyle = ramColor;
      ctx.fillRect(260, y + 40, 200 * server.ram / 100, 10);
    });

    texture.needsUpdate = true;
  });

  return <Monitor position={position} rotation={rotation} screenContent={texture} isActive={isActive} color={color} />;
}
