'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Character({ position = [0, 0, 0], color = 0xffcc99, isTyping = false }) {
  const groupRef = useRef();
  const headRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const mouthRef = useRef();

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

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    if (groupRef.current) {
      // Gentle idle bobbing
      groupRef.current.position.y = position[1] + Math.sin(t * 1.5) * 0.015;
      // Subtle body sway
      groupRef.current.rotation.z = Math.sin(t * 0.8) * 0.02;
    }

    if (headRef.current) {
      // Head tilt and look around
      headRef.current.rotation.z = Math.sin(t * 0.6) * 0.05;
      headRef.current.rotation.y = Math.sin(t * 0.4) * 0.08;
      // Slight head bob
      headRef.current.position.y = 1.4 + Math.sin(t * 1.5) * 0.005;
    }

    // Arm animations
    if (leftArmRef.current && rightArmRef.current) {
      if (isTyping) {
        // Typing animation - arms move up and down alternately
        leftArmRef.current.rotation.z = -0.3 + Math.sin(t * 8) * 0.15;
        rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 8 + Math.PI) * 0.15;
        leftArmRef.current.rotation.x = Math.sin(t * 8) * 0.1;
        rightArmRef.current.rotation.x = Math.sin(t * 8 + Math.PI) * 0.1;
      } else {
        // Idle arm sway
        leftArmRef.current.rotation.z = -0.3 + Math.sin(t * 1.2) * 0.05;
        rightArmRef.current.rotation.z = 0.3 + Math.sin(t * 1.2 + 1) * 0.05;
        leftArmRef.current.rotation.x = Math.sin(t * 0.9) * 0.03;
        rightArmRef.current.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;
      }
    }

    // Eye blink animation
    if (leftEyeRef.current && rightEyeRef.current) {
      // Blink every ~3 seconds with some randomness
      const blinkCycle = (t % 3) / 3;
      const isBlinking = blinkCycle > 0.95;
      const blinkScale = isBlinking ? 0.1 : 1;
      leftEyeRef.current.scale.y = blinkScale;
      rightEyeRef.current.scale.y = blinkScale;
    }

    // Mouth animation (subtle)
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
      {[[-0.12, 0.45, 0], [0.12, 0.45, 0]].map((pos, i) => (
        <group key={i} position={pos}>
          <mesh material={bodyMaterial}>
            <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
          </mesh>
          {/* Shoes */}
          <mesh position={[0, -0.18, 0.05]}>
            <boxGeometry args={[0.12, 0.06, 0.18]} />
            <meshStandardMaterial color={0x222222} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
