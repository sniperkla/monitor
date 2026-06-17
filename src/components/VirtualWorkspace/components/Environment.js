'use client';

import { useMemo } from 'react';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';

const TIME_CONFIGS = {
  day: {
    sunPosition: [10, 20, 10],
    ambientIntensity: 0.6,
    ambientColor: 0xffffff,
    directionalIntensity: 1.2,
    directionalColor: 0xffffff,
    skyTurbidity: 2,
    skyRayleigh: 1,
  },
  sunset: {
    sunPosition: [20, 2, 10],
    ambientIntensity: 0.4,
    ambientColor: 0xffaa66,
    directionalIntensity: 0.8,
    directionalColor: 0xff8844,
    skyTurbidity: 8,
    skyRayleigh: 3,
  },
  night: {
    sunPosition: [-10, -5, 10],
    ambientIntensity: 0.15,
    ambientColor: 0x334466,
    directionalIntensity: 0.2,
    directionalColor: 0x4466aa,
    skyTurbidity: 10,
    skyRayleigh: 0.1,
  },
};

const ROOM_SIZE = { width: 12, height: 5, depth: 10 };

function RoomWalls({ wallColor, floorColor, ceilingColor }) {
  const { width, height, depth } = ROOM_SIZE;
  const halfW = width / 2;
  const halfD = depth / 2;

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.8} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={ceilingColor} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, height / 2, -halfD]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.7} />
      </mesh>

      {/* Left wall */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-halfW, height / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.7} />
      </mesh>

      {/* Right wall */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[halfW, height / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.7} />
      </mesh>
    </group>
  );
}

function OfficeRoom() {
  return (
    <RoomWalls
      wallColor={0xe8e0d4}
      floorColor={0x8b7355}
      ceilingColor={0xf5f0e8}
    />
  );
}

function SpaceStation() {
  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x333844,
        metalness: 0.8,
        roughness: 0.3,
      }),
    []
  );

  const panelMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x222833,
        metalness: 0.9,
        roughness: 0.2,
        emissive: 0x111822,
        emissiveIntensity: 0.2,
      }),
    []
  );

  const stripMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x00ccff,
        emissive: 0x00ccff,
        emissiveIntensity: 1.5,
        toneMapped: false,
      }),
    []
  );

  const { width, height, depth } = ROOM_SIZE;
  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={wallMaterial} receiveShadow>
        <planeGeometry args={[width, depth]} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]} material={panelMaterial}>
        <planeGeometry args={[width, depth]} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, halfH, -halfD]} material={panelMaterial}>
        <planeGeometry args={[width, height]} />
      </mesh>

      {/* Left wall */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-halfW, halfH, 0]} material={wallMaterial}>
        <planeGeometry args={[depth, height]} />
      </mesh>

      {/* Right wall */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[halfW, halfH, 0]} material={wallMaterial}>
        <planeGeometry args={[depth, height]} />
      </mesh>

      {/* Glowing floor strips */}
      {[-3, 0, 3].map((z, i) => (
        <mesh key={`strip-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, z]} material={stripMaterial}>
          <planeGeometry args={[width, 0.08]} />
        </mesh>
      ))}

      {/* Ceiling panel lights */}
      {[-2, 2].map((x, i) => (
        <mesh key={`panel-${i}`} rotation={[Math.PI / 2, 0, 0]} position={[x, height - 0.01, 0]} material={stripMaterial}>
          <planeGeometry args={[0.15, depth * 0.6]} />
        </mesh>
      ))}
    </group>
  );
}

function GamingRoom({ accentColor }) {
  const accent = useMemo(() => new THREE.Color(accentColor), [accentColor]);

  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        roughness: 0.6,
      }),
    []
  );

  const accentStrip = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 2.0,
        toneMapped: false,
      }),
    [accent]
  );

  const { width, height, depth } = ROOM_SIZE;
  const halfW = width / 2;
  const halfD = depth / 2;

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={0x0f0f1a} roughness={0.4} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]} material={wallMaterial}>
        <planeGeometry args={[width, depth]} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, height / 2, -halfD]} material={wallMaterial}>
        <planeGeometry args={[width, height]} />
      </mesh>

      {/* Left wall */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-halfW, height / 2, 0]} material={wallMaterial}>
        <planeGeometry args={[depth, height]} />
      </mesh>

      {/* Right wall */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[halfW, height / 2, 0]} material={wallMaterial}>
        <planeGeometry args={[depth, height]} />
      </mesh>

      {/* Baseboard accent strips - floor level */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -halfD + 0.1]} material={accentStrip}>
        <planeGeometry args={[width, 0.06]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, halfD - 0.1]} material={accentStrip}>
        <planeGeometry args={[width, 0.06]} />
      </mesh>

      {/* Wall edge accent strips */}
      {[-1, 1].map((side, i) => (
        <group key={`wall-strip-${i}`}>
          <mesh position={[side * halfW, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={accentStrip}>
            <planeGeometry args={[0.06, depth]} />
          </mesh>
          <mesh position={[0, height, side * halfD * (i === 0 ? 1 : -1)]} rotation={[Math.PI / 2, 0, 0]} material={accentStrip}>
            <planeGeometry args={[width, 0.06]} />
          </mesh>
        </group>
      ))}

      {/* Accent point light */}
      <pointLight
        color={accentColor}
        intensity={1.5}
        distance={8}
        position={[0, 0.3, 0]}
      />
    </group>
  );
}

function OutdoorEnvironment({ timeOfDay }) {
  const config = TIME_CONFIGS[timeOfDay];
  const sunPos = useMemo(() => new THREE.Vector3(...config.sunPosition), [config.sunPosition]);

  return (
    <group>
      <Sky
        sunPosition={sunPos}
        turbidity={config.skyTurbidity}
        rayleigh={config.skyRayleigh}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color={0x558833} roughness={1} />
      </mesh>
    </group>
  );
}

export default function Environment({
  preset = 'office',
  timeOfDay = 'day',
  accentColor = '#ff00ff',
}) {
  const config = TIME_CONFIGS[timeOfDay];
  const accentColorValue = useMemo(() => {
    if (typeof accentColor === 'string') return accentColor;
    return `#${new THREE.Color(accentColor).getHexString()}`;
  }, [accentColor]);

  return (
    <group>
      {/* Ambient light - base fill */}
      <ambientLight
        color={config.ambientColor}
        intensity={config.ambientIntensity}
      />

      {/* Directional light - sun/key light */}
      <directionalLight
        color={config.directionalColor}
        intensity={config.directionalIntensity}
        position={config.sunPosition}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* Preset-specific environment */}
      {preset === 'office' && <OfficeRoom />}
      {preset === 'space' && <SpaceStation />}
      {preset === 'gaming' && <GamingRoom accentColor={accentColorValue} />}
      {preset === 'outdoor' && <OutdoorEnvironment timeOfDay={timeOfDay} />}
    </group>
  );
}
