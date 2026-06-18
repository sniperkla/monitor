'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { X, Download, Sun, Moon, Sunset } from 'lucide-react';
import * as THREE from 'three';

const ENV_PRESETS = [
  { id: 'office', label: 'Office' },
  { id: 'space', label: 'Space' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'outdoor', label: 'Outdoor' },
];

const TIME_OPTIONS = [
  { id: 'day', label: 'Day', icon: Sun },
  { id: 'sunset', label: 'Sunset', icon: Sunset },
  { id: 'night', label: 'Night', icon: Moon },
];

function Character({ position = [0, 0, 0] }) {
  const groupRef = useRef();
  const headRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.5) * 0.015;
      groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.02;
    }
    if (headRef.current) {
      headRef.current.rotation.z = Math.sin(t * 0.6) * 0.05;
      headRef.current.rotation.y = Math.sin(t * 0.4) * 0.08;
    }
    if (leftArmRef.current && rightArmRef.current) {
      leftArmRef.current.rotation.z = -0.3 + Math.sin(t * 1.2) * 0.05;
      rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 1.2 + 1) * 0.05;
      leftArmRef.current.rotation.x = Math.sin(t * 0.9) * 0.03;
      rightArmRef.current.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <group ref={headRef} position={[0, 1.4, 0]}>
        <mesh>
          <sphereGeometry args={[0.35, 16, 16]} />
          <meshStandardMaterial color={0xffcc99} />
        </mesh>
        <mesh position={[0, 0.15, -0.05]}>
          <sphereGeometry args={[0.37, 16, 16]} />
          <meshStandardMaterial color={0x333333} />
        </mesh>
        {[[-0.12, 0.05, 0.3], [0.12, 0.05, 0.3]].map((pos, i) => (
          <mesh key={i} position={pos}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={0x000000} />
          </mesh>
        ))}
        <mesh position={[0, -0.05, 0.33]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color={0xff6666} />
        </mesh>
      </group>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
        <meshStandardMaterial color={0x4488ff} />
      </mesh>
      <group ref={leftArmRef} position={[-0.35, 1.0, 0]} rotation={[0, 0, -0.3]}>
        <mesh>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
          <meshStandardMaterial color={0x4488ff} />
        </mesh>
        <mesh position={[0, -0.22, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color={0xffcc99} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.35, 1.0, 0]} rotation={[0, 0, 0.3]}>
        <mesh>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
          <meshStandardMaterial color={0x4488ff} />
        </mesh>
        <mesh position={[0, -0.22, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color={0xffcc99} />
        </mesh>
      </group>
      {[[-0.12, 0.45, 0], [0.12, 0.45, 0]].map((pos, i) => (
        <group key={i} position={pos}>
          <mesh>
            <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
            <meshStandardMaterial color={0x4488ff} />
          </mesh>
          <mesh position={[0, -0.18, 0.05]}>
            <boxGeometry args={[0.12, 0.06, 0.18]} />
            <meshStandardMaterial color={0x222222} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Desk({ position = [0, 0, 0] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[2.0, 0.08, 1.0]} />
        <meshStandardMaterial color={0x8B6914} />
      </mesh>
      {[[-0.9, 0.375, -0.4], [0.9, 0.375, -0.4], [-0.9, 0.375, 0.4], [0.9, 0.375, 0.4]].map((pos, i) => (
        <mesh key={i} position={pos}>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
          <meshStandardMaterial color={0x8B6914} />
        </mesh>
      ))}
      <mesh position={[0.6, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.35, 0.9]} />
        <meshStandardMaterial color={0x8B6914} />
      </mesh>
    </group>
  );
}

function Chair({ position = [0, 0, 0] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial color={0x222222} />
      </mesh>
      <mesh position={[0, 0.75, -0.22]}>
        <boxGeometry args={[0.5, 0.55, 0.06]} />
        <meshStandardMaterial color={0x222222} />
      </mesh>
      {[[-0.2, 0.22, -0.2], [0.2, 0.22, -0.2], [-0.2, 0.22, 0.2], [0.2, 0.22, 0.2]].map((pos, i) => (
        <mesh key={i} position={pos}>
          <cylinderGeometry args={[0.025, 0.025, 0.44, 8]} />
          <meshStandardMaterial color={0x222222} />
        </mesh>
      ))}
    </group>
  );
}

function Monitor({ position = [0, 0, 0], rotation = [0, 0, 0], color = 0x333333 }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[0.8, 0.5, 0.05]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial color={0x1a1a2e} emissive={0x004444} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.02, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function Room() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color={0x8b7355} />
      </mesh>
      <mesh position={[0, 2.5, -5]}>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color={0xe8e0d4} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color={0xf5f0e8} />
      </mesh>
    </>
  );
}

function Scene({ envPreset, timeOfDay, onSceneRef }) {
  const { scene } = useThree();

  useEffect(() => {
    onSceneRef(scene);
  }, [scene, onSceneRef]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      <OrbitControls
        makeDefault
        minDistance={2}
        maxDistance={8}
        maxPolarAngle={Math.PI / 2 + 0.2}
        target={[0, 1.2, 0]}
      />

      <Room />
      <Desk position={[0, 0, 0]} />
      <Chair position={[0, 0, 0.6]} />
      <Character position={[0, 0, 0.5]} />

      <mesh position={[0, 0.79, 0.15]}>
        <boxGeometry args={[0.4, 0.02, 0.15]} />
        <meshStandardMaterial color={0x444444} />
      </mesh>
      <mesh position={[0.35, 0.81, 0.15]}>
        <capsuleGeometry args={[0.03, 0.06, 8, 16]} />
        <meshStandardMaterial color={0x555555} />
      </mesh>
      <mesh position={[-0.7, 0.83, 0.25]}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 16]} />
        <meshStandardMaterial color={0xffffff} />
      </mesh>

      <Monitor position={[-0.5, 1.25, -0.35]} rotation={[0, 0.2, 0]} />
      <Monitor position={[0.5, 1.25, -0.35]} rotation={[0, -0.2, 0]} />
      <Monitor position={[-1.2, 1.25, -0.2]} rotation={[0, 0.4, 0]} />
      <Monitor position={[1.2, 1.25, -0.2]} rotation={[0, -0.4, 0]} />
    </>
  );
}

export default function WorkspaceScene({ onClose }) {
  const [envPreset, setEnvPreset] = useState('office');
  const [timeOfDay, setTimeOfDay] = useState('day');
  const stopPropagation = useCallback((e) => e.stopPropagation(), []);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000' }}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      <Canvas
        camera={{ position: [2.5, 2.5, 3], fov: 50 }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => { gl.setClearColor('#1a1a2e'); }}
      >
        <Scene envPreset={envPreset} timeOfDay={timeOfDay} onSceneRef={() => {}} />
      </Canvas>

      {/* Controls */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 10 }}>
        <button
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', cursor: 'pointer', padding: 8 }}
        >
          <X size={20} />
        </button>
      </div>
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4, zIndex: 10 }}>
        {ENV_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setEnvPreset(p.id)}
            style={{
              background: envPreset === p.id ? 'rgba(255,255,255,0.2)' : 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: envPreset === p.id ? '#fff' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 12,
            }}
          >
            {p.label}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        {TIME_OPTIONS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTimeOfDay(t.id)}
              style={{
                background: timeOfDay === t.id ? 'rgba(255,255,255,0.2)' : 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: timeOfDay === t.id ? '#fff' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
              }}
            >
              <Icon size={14} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
