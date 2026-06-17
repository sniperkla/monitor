'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function SSHMonitor({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  isActive = false,
  host = 'prod-server-01',
  username = 'admin',
  color = 0x333333
}) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);
  const cursorVisible = useRef(true);
  const lastBlink = useRef(0);

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

    if (time - lastBlink.current > 0.5) {
      cursorVisible.current = !cursorVisible.current;
      lastBlink.current = time;
    }

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = '#00ff00';
    ctx.font = '14px monospace';
    ctx.fillText(`ssh ${username}@${host}`, 20, 30);

    ctx.fillStyle = '#ffffff';
    ctx.fillText('Connection established.', 20, 55);
    ctx.fillText(`Last login: ${new Date().toLocaleDateString()}`, 20, 75);
    ctx.fillText(`Host: ${host}`, 20, 95);
    ctx.fillText(`User: ${username}`, 20, 115);

    ctx.fillStyle = '#00ff00';
    ctx.fillText('$ ' + (cursorVisible.current ? '_' : ' '), 20, 140);

    texture.needsUpdate = true;
  });

  return <Monitor position={position} rotation={rotation} screenContent={texture} isActive={isActive} color={color} />;
}
