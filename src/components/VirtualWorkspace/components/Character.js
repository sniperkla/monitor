'use client';

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Character({
  position = [0, 0, 0],
  color = 0xffcc99,
  isTyping = false,
  routineState = 'IDLE',
  targetPosition = [0, 0, 0],
  isMoving = false,
}) {
  const groupRef = useRef();
  const headRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const mouthRef = useRef();
  const leftLegRef = useRef();
  const rightLegRef = useRef();
  const positionRef = useRef(new THREE.Vector3(...position));

  const bodyMaterial = useToonMaterial({
    color: 0x4488ff,
    shadowColor: 0x2244aa,
    highlightColor: 0x66aaff,
  });
  const skinMaterial = useToonMaterial({
    color,
    shadowColor: 0xcc9966,
    highlightColor: 0xffddbb,
  });
  const hairMaterial = useToonMaterial({
    color: 0x333333,
    shadowColor: 0x111111,
    highlightColor: 0x555555,
  });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Smooth position lerping when moving
    if (groupRef.current) {
      if (isMoving) {
        const targetVec = new THREE.Vector3(...targetPosition);
        positionRef.current.lerp(targetVec, delta * 3);
        groupRef.current.position.copy(positionRef.current);
      } else {
        positionRef.current.set(...targetPosition);
        groupRef.current.position.copy(positionRef.current);
      }
    }

    // Body animations based on routine state
    if (groupRef.current) {
      switch (routineState) {
        case 'WALKING':
          // Walking body bob and sway
          groupRef.current.position.y = positionRef.current.y + Math.abs(Math.sin(t * 6)) * 0.03;
          groupRef.current.rotation.z = Math.sin(t * 6) * 0.05;
          break;
        case 'CODING':
        case 'EATING':
          // Seated - subtle breathing
          groupRef.current.position.y = positionRef.current.y + Math.sin(t * 1.5) * 0.008;
          groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.01;
          break;
        case 'RESTING':
          // Lean back slightly
          groupRef.current.position.y = positionRef.current.y + Math.sin(t * 1.2) * 0.005;
          groupRef.current.rotation.z = Math.sin(t * 0.5) * 0.015;
          groupRef.current.rotation.x = -0.05;
          break;
        case 'COFFEE':
          // Slight forward lean
          groupRef.current.position.y = positionRef.current.y + Math.sin(t * 1.5) * 0.01;
          groupRef.current.rotation.z = Math.sin(t * 1) * 0.02;
          break;
        default: // IDLE
          groupRef.current.position.y = positionRef.current.y + Math.sin(t * 1.5) * 0.015;
          groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.02;
          groupRef.current.rotation.x = 0;
          break;
      }
    }

    // Head animations based on routine state
    if (headRef.current) {
      switch (routineState) {
        case 'WALKING':
          // Look forward while walking
          headRef.current.rotation.z = Math.sin(t * 6) * 0.03;
          headRef.current.rotation.y = Math.sin(t * 2) * 0.05;
          headRef.current.position.y = 1.4 + Math.abs(Math.sin(t * 6)) * 0.005;
          break;
        case 'CODING':
          // Look down at screen
          headRef.current.rotation.x = -0.15 + Math.sin(t * 0.5) * 0.02;
          headRef.current.rotation.y = Math.sin(t * 0.3) * 0.04;
          headRef.current.rotation.z = Math.sin(t * 0.6) * 0.03;
          headRef.current.position.y = 1.4;
          break;
        case 'COFFEE':
          // Look toward mug
          headRef.current.rotation.y = -0.3 + Math.sin(t * 1) * 0.05;
          headRef.current.rotation.z = Math.sin(t * 0.8) * 0.03;
          headRef.current.position.y = 1.4 + Math.sin(t * 1.5) * 0.005;
          break;
        case 'EATING':
          // Look down, occasional glance
          headRef.current.rotation.x = -0.1 + Math.sin(t * 0.8) * 0.03;
          headRef.current.rotation.y = Math.sin(t * 0.5) * 0.06;
          headRef.current.position.y = 1.4;
          break;
        case 'RESTING':
          // Lean back, relaxed
          headRef.current.rotation.x = -0.08;
          headRef.current.rotation.z = Math.sin(t * 0.4) * 0.04;
          headRef.current.rotation.y = Math.sin(t * 0.3) * 0.06;
          headRef.current.position.y = 1.4 + Math.sin(t * 1.2) * 0.003;
          break;
        default: // IDLE
          headRef.current.rotation.z = Math.sin(t * 0.6) * 0.05;
          headRef.current.rotation.y = Math.sin(t * 0.4) * 0.08;
          headRef.current.position.y = 1.4 + Math.sin(t * 1.5) * 0.005;
          headRef.current.rotation.x = 0;
          break;
      }
    }

    // Arm animations based on routine state
    if (leftArmRef.current && rightArmRef.current) {
      switch (routineState) {
        case 'WALKING':
          // Arm swing while walking
          leftArmRef.current.rotation.z = -0.3;
          rightArmRef.current.rotation.z = 0.3;
          leftArmRef.current.rotation.x = Math.sin(t * 6) * 0.4;
          rightArmRef.current.rotation.x = Math.sin(t * 6 + Math.PI) * 0.4;
          break;
        case 'CODING':
          // Typing animation
          leftArmRef.current.rotation.z = -0.3 + Math.sin(t * 8) * 0.15;
          rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 8 + Math.PI) * 0.15;
          leftArmRef.current.rotation.x = Math.sin(t * 8) * 0.1;
          rightArmRef.current.rotation.x = Math.sin(t * 8 + Math.PI) * 0.1;
          break;
        case 'COFFEE':
          // Reach toward mug (left side)
          leftArmRef.current.rotation.z = -0.6 + Math.sin(t * 2) * 0.1;
          leftArmRef.current.rotation.x = -0.5 + Math.sin(t * 1.5) * 0.1;
          rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 1.2) * 0.05;
          rightArmRef.current.rotation.x = Math.sin(t * 0.9) * 0.03;
          break;
        case 'EATING':
          // Hand to mouth motion
          leftArmRef.current.rotation.z = -0.3;
          rightArmRef.current.rotation.z = 0.2 + Math.sin(t * 3) * 0.15;
          rightArmRef.current.rotation.x = -0.3 + Math.sin(t * 3) * 0.1;
          leftArmRef.current.rotation.x = Math.sin(t * 1.5) * 0.05;
          break;
        case 'RESTING':
          // Relaxed arms, slightly back
          leftArmRef.current.rotation.z = -0.2 + Math.sin(t * 0.8) * 0.03;
          rightArmRef.current.rotation.z = 0.2 + Math.sin(t * 0.8 + 1) * 0.03;
          leftArmRef.current.rotation.x = 0.1 + Math.sin(t * 0.6) * 0.02;
          rightArmRef.current.rotation.x = 0.1 + Math.sin(t * 0.6 + 1) * 0.02;
          break;
        default: // IDLE
          leftArmRef.current.rotation.z = -0.3 + Math.sin(t * 1.2) * 0.05;
          rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 1.2 + 1) * 0.05;
          leftArmRef.current.rotation.x = Math.sin(t * 0.9) * 0.03;
          rightArmRef.current.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;
          break;
      }
    }

    // Leg animations
    if (leftLegRef.current && rightLegRef.current) {
      if (routineState === 'WALKING') {
        // Alternating leg motion while walking
        leftLegRef.current.rotation.x = Math.sin(t * 6) * 0.3;
        rightLegRef.current.rotation.x = Math.sin(t * 6 + Math.PI) * 0.3;
      } else {
        // Reset legs when not walking
        leftLegRef.current.rotation.x *= 0.9;
        rightLegRef.current.rotation.x *= 0.9;
      }
    }

    // Eye blink animation (base layer for all states)
    if (leftEyeRef.current && rightEyeRef.current) {
      const blinkCycle = (t % 3) / 3;
      const isBlinking = blinkCycle > 0.95;
      const blinkScale = isBlinking ? 0.1 : 1;
      leftEyeRef.current.scale.y = blinkScale;
      rightEyeRef.current.scale.y = blinkScale;
    }

    // Mouth animation (subtle, base layer)
    if (mouthRef.current) {
      mouthRef.current.scale.x = 1 + Math.sin(t * 2) * 0.1;
      mouthRef.current.scale.y = 1 + Math.sin(t * 3) * 0.05;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Head - exaggerated size for chibi */}
      <group ref={headRef} position={[0, 1.4, 0]}>
        <mesh material={skinMaterial}>
          <sphereGeometry args={[0.35, 16, 16]} />
        </mesh>

        {/* Hair */}
        <mesh material={hairMaterial} position={[0, 0.15, -0.05]}>
          <sphereGeometry args={[0.37, 16, 16]} />
        </mesh>

        {/* Eyes */}
        <group ref={leftEyeRef} position={[-0.12, 0.05, 0.3]}>
          <mesh>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={0x000000} />
          </mesh>
          {/* Eye highlight */}
          <mesh position={[0.02, 0.02, 0.05]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={0.5} />
          </mesh>
        </group>

        <group ref={rightEyeRef} position={[0.12, 0.05, 0.3]}>
          <mesh>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={0x000000} />
          </mesh>
          {/* Eye highlight */}
          <mesh position={[0.02, 0.02, 0.05]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={0.5} />
          </mesh>
        </group>

        {/* Blush marks */}
        <mesh position={[-0.2, -0.02, 0.28]} rotation={[0, 0, 0.2]}>
          <circleGeometry args={[0.04, 8]} />
          <meshStandardMaterial color={0xff8888} transparent opacity={0.4} />
        </mesh>
        <mesh position={[0.2, -0.02, 0.28]} rotation={[0, 0, -0.2]}>
          <circleGeometry args={[0.04, 8]} />
          <meshStandardMaterial color={0xff8888} transparent opacity={0.4} />
        </mesh>

        {/* Mouth */}
        <mesh ref={mouthRef} position={[0, -0.05, 0.33]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color={0xff6666} />
        </mesh>
      </group>

      {/* Body - small for chibi proportions */}
      <mesh material={bodyMaterial} position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
      </mesh>

      {/* Arms with refs for animation */}
      <group ref={leftArmRef} position={[-0.35, 1.0, 0]} rotation={[0, 0, -0.3]}>
        <mesh material={bodyMaterial}>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
        </mesh>
        {/* Hand */}
        <mesh material={skinMaterial} position={[0, -0.22, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
        </mesh>
      </group>

      <group ref={rightArmRef} position={[0.35, 1.0, 0]} rotation={[0, 0, 0.3]}>
        <mesh material={bodyMaterial}>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
        </mesh>
        {/* Hand */}
        <mesh material={skinMaterial} position={[0, -0.22, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
        </mesh>
      </group>

      {/* Legs */}
      <group ref={leftLegRef} position={[-0.12, 0.45, 0]}>
        <mesh material={bodyMaterial}>
          <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
        </mesh>
        {/* Shoes */}
        <mesh position={[0, -0.18, 0.05]}>
          <boxGeometry args={[0.12, 0.06, 0.18]} />
          <meshStandardMaterial color={0x222222} />
        </mesh>
      </group>

      <group ref={rightLegRef} position={[0.12, 0.45, 0]}>
        <mesh material={bodyMaterial}>
          <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
        </mesh>
        {/* Shoes */}
        <mesh position={[0, -0.18, 0.05]}>
          <boxGeometry args={[0.12, 0.06, 0.18]} />
          <meshStandardMaterial color={0x222222} />
        </mesh>
      </group>
    </group>
  );
}
