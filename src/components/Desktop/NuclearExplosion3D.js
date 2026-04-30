'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// === SIMPLIFIED VOLUMETRIC SMOKE LAYER COMPONENT ===
const VolumetricSmokeLayer = ({ position, scale, color, opacity, layerIndex }) => {
  const meshRef = useRef();
  const materialRef = useRef();
  
  useFrame((state, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // Simple rotation instead of noise-based
    meshRef.current.rotation.y += delta * 0.05 * (layerIndex % 2 === 0 ? 1 : -1);
    
    // Simple scale pulsing with sine wave
    const scalePulse = 1 + Math.sin(time * 0.5 + layerIndex) * 0.1;
    meshRef.current.scale.setScalar(scale * scalePulse);
    
    // Fade based on time
    const fadeProgress = Math.min(1, time * 0.1);
    materialRef.current.opacity = opacity * (1 - fadeProgress * 0.3);
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

// === FIREBALL CORE COMPONENT (SIMPLIFIED) ===
const FireballCore = ({ initialScale = 5 }) => {
  const groupRef = useRef();
  const coreRef = useRef();
  const outerRef = useRef();
  const timeRef = useRef(0);
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    timeRef.current += delta;
    const t = timeRef.current;
    
    // Temperature-based color shift: white -> yellow -> orange -> dark red
    const temp = Math.max(0, 1 - t * 0.15);
    let coreColor;
    if (temp > 0.8) {
      coreColor = new THREE.Color('#ffffff');
    } else if (temp > 0.6) {
      coreColor = new THREE.Color().lerpColors(
        new THREE.Color('#ffff00'), new THREE.Color('#ffffff'), (temp - 0.6) / 0.2
      );
    } else if (temp > 0.3) {
      coreColor = new THREE.Color().lerpColors(
        new THREE.Color('#ff6600'), new THREE.Color('#ffff00'), (temp - 0.3) / 0.3
      );
    } else {
      coreColor = new THREE.Color().lerpColors(
        new THREE.Color('#330000'), new THREE.Color('#ff6600'), temp / 0.3
      );
    }
    
    if (coreRef.current) {
      if (coreRef.current.material.color) {
        coreRef.current.material.color.copy(coreColor);
      }
      if (coreRef.current.material.emissive) {
        coreRef.current.material.emissive.copy(coreColor);
      }
      coreRef.current.material.emissiveIntensity = temp * 2;
    }
    
    // Rapid expansion then slow contraction
    const expansionScale = initialScale * (1 + t * 8) * Math.exp(-t * 0.3);
    if (coreRef.current) {
      coreRef.current.scale.setScalar(expansionScale);
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar(expansionScale * 1.3);
      outerRef.current.material.opacity = Math.max(0, 0.8 - t * 0.2);
    }
    
    // Light intensity decay
    if (groupRef.current.children[2]) {
      groupRef.current.children[2].intensity = Math.max(0, 50 * temp * temp);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Inner core - brightest */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      
      {/* Outer fireball */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial
          color="#ff6600"
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Point light for global illumination */}
      <pointLight
        color="#ff6600"
        intensity={50}
        distance={1000}
        decay={2}
      />
    </group>
  );
};

// === MUSHROOM STEM (REDUCED SEGMENTS) ===
const MushroomStem = ({ baseY = 0, maxHeight = 300 }) => {
  const groupRef = useRef();
  const segmentsRef = useRef([]);
  const timeRef = useRef(0);
  
  const segments = useMemo(() => {
    const segs = [];
    for (let i = 0; i < 10; i++) {
      segs.push({
        y: i * 20,
        scale: 6 + Math.random() * 3,
      });
    }
    return segs;
  }, []);

  useFrame((state, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;
    
    // Buoyancy-driven rise
    const riseProgress = Math.min(1, t * 0.1);
    const currentHeight = maxHeight * riseProgress * Math.pow(1 - riseProgress * 0.3, 0.5);
    
    segmentsRef.current.forEach((seg, i) => {
      if (!seg) return;
      
      const segData = segments[i];
      const targetY = baseY + segData.y * riseProgress;
      
      // Simple sinusoidal movement instead of noise
      const noiseX = Math.sin(t * 0.5 + i * 0.3) * 5;
      const noiseZ = Math.cos(t * 0.5 + i * 0.3) * 5;
      
      seg.position.x = noiseX;
      seg.position.z = noiseZ;
      seg.position.y = targetY;
      
      // Scale with height (thinner at top)
      const heightFactor = 1 - (i / segments.length) * 0.4;
      const scalePulse = segData.scale * heightFactor * (1 + riseProgress * 2);
      seg.scale.setScalar(scalePulse);
      
      // Slower rotation
      seg.rotation.y += delta * 0.1;
    });
  });

  return (
    <group ref={groupRef}>
      {segments.map((seg, i) => (
        <mesh
          key={i}
          ref={el => segmentsRef.current[i] = el}
          position={[0, seg.y, 0]}
        >
          <sphereGeometry args={[seg.scale, 8, 8]} />
          <meshStandardMaterial
            color={i < 3 ? '#ff4400' : '#555555'}
            transparent
            opacity={0.7 - i * 0.04}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
    </group>
  );
};

// === MUSHROOM CAP (REDUCED LAYERS) ===
const MushroomCap = ({ y = 200, scale = 80 }) => {
  const groupRef = useRef();
  const layersRef = useRef([]);
  const timeRef = useRef(0);
  
  const layers = useMemo(() => {
    const lys = [];
    for (let i = 0; i < 8; i++) {
      lys.push({
        offsetY: i * 4,
        scale: scale * (1 + i * 0.12),
        color: i < 2 ? '#ff3300' : i < 4 ? '#aa4422' : '#444444',
        opacity: 0.6 - i * 0.05,
      });
    }
    return lys;
  }, [scale]);

  useFrame((state, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;
    
    const riseProgress = Math.min(1, t * 0.08);
    
    layersRef.current.forEach((layer, i) => {
      if (!layer) return;
      
      const layerData = layers[i];
      
      // Rising motion
      layer.position.y = y * riseProgress + layerData.offsetY * riseProgress;
      
      // Expanding cap
      const expansion = layerData.scale * (1 + riseProgress * 1.5);
      
      // Simple sine-based wobble instead of noise
      const scaleX = expansion * (1 + Math.sin(t * 0.3 + i * 0.5) * 0.1);
      const scaleZ = expansion * (1 + Math.cos(t * 0.3 + i * 0.5) * 0.1);
      
      layer.scale.set(scaleX, expansion * 0.4, scaleZ);
      
      // Slower rotation
      layer.rotation.y += delta * 0.03 * (i % 2 === 0 ? 1 : -1);
      
      // Fade over time
      layer.material.opacity = layerData.opacity * (1 - riseProgress * 0.2);
    });
  });

  return (
    <group ref={groupRef}>
      {layers.map((layer, i) => (
        <mesh
          key={i}
          ref={el => layersRef.current[i] = el}
          position={[0, layer.offsetY, 0]}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial
            color={layer.color}
            transparent
            opacity={layer.opacity}
            roughness={1}
            metalness={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
};

// === SHOCKWAVE RING ===
const ShockwaveRing = ({ delay = 0, maxRadius = 400, color = '#ffaa00' }) => {
  const ringRef = useRef();
  const timeRef = useRef(-delay);
  const materialRef = useRef();
  
  useFrame((state, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;
    
    if (t < 0) {
      if (ringRef.current) ringRef.current.visible = false;
      return;
    }
    
    if (!ringRef.current) return;
    ringRef.current.visible = true;
    
    // Expanding shockwave
    const progress = Math.min(1, t * 0.3);
    const radius = maxRadius * Math.pow(progress, 0.5);
    ringRef.current.scale.set(radius, 1, radius);
    
    // Fade out
    if (materialRef.current) {
      materialRef.current.opacity = Math.max(0, 0.8 - progress * 0.8);
    }
    
    // Ground-level dust ring
    ringRef.current.position.y = 1;
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.8, 1, 32]} />
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={0.8}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

// === DEBRIS PARTICLES (REDUCED COUNT) ===
const DebrisParticles = ({ count = 50, originY = 0 }) => {
  const instancedMeshRef = useRef();
  const particlesData = useRef([]);
  const timeRef = useRef(0);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    particlesData.current = Array(count).fill(0).map(() => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        originY + Math.random() * 10,
        (Math.random() - 0.5) * 20
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 30,
        Math.random() * 80 + 40,
        (Math.random() - 0.5) * 30
      ),
      scale: 0.5 + Math.random() * 2,
      rotationSpeed: Math.random() * 3,
      life: 0,
      maxLife: 3 + Math.random() * 4,
    }));
  }, [count, originY]);

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;
    
    timeRef.current += delta;
    const t = timeRef.current;
    
    particlesData.current.forEach((p, i) => {
      if (p.life > p.maxLife) return;
      
      p.life += delta;
      
      // Gravity
      p.velocity.y -= 15 * delta;
      
      // Air resistance
      p.velocity.multiplyScalar(0.99);
      
      // Update position
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      
      // Ground collision
      if (p.position.y < 0) {
        p.position.y = 0;
        p.velocity.y *= -0.3;
        p.velocity.x *= 0.8;
        p.velocity.z *= 0.8;
      }
      
      // Update instance matrix
      dummy.position.copy(p.position);
      dummy.rotation.set(
        p.life * p.rotationSpeed,
        p.life * p.rotationSpeed * 0.7,
        p.life * p.rotationSpeed * 0.5
      );
      const fadeScale = p.scale * (1 - p.life / p.maxLife);
      dummy.scale.setScalar(Math.max(0, fadeScale));
      dummy.updateMatrix();
      
      instancedMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={instancedMeshRef} args={[null, null, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#442200"
        roughness={1}
        metalness={0}
        emissive="#ff4400"
        emissiveIntensity={0.3}
      />
    </instancedMesh>
  );
};

// === ASH PARTICLES (REDUCED COUNT) ===
const AshParticles = ({ count = 30 }) => {
  const instancedMeshRef = useRef();
  const particlesData = useRef([]);
  const timeRef = useRef(0);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    particlesData.current = Array(count).fill(0).map(() => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 80,
        40 + Math.random() * 150,
        (Math.random() - 0.5) * 80
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        5 + Math.random() * 10,
        (Math.random() - 0.5) * 2
      ),
      scale: 0.2 + Math.random() * 0.4,
    }));
  }, [count]);

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;
    
    timeRef.current += delta;
    const t = timeRef.current;
    
    particlesData.current.forEach((p, i) => {
      // Simple rising with sine wave drift
      p.position.y += p.velocity.y * delta;
      p.position.x += p.velocity.x * delta + Math.sin(t * 0.2 + i * 0.1) * 0.5;
      p.position.z += p.velocity.z * delta + Math.cos(t * 0.2 + i * 0.1) * 0.5;
      
      // Update instance
      dummy.position.copy(p.position);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      
      instancedMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={instancedMeshRef} args={[null, null, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial
        color="#666666"
        transparent
        opacity={0.4}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

// === MAIN NUCLEAR EXPLOSION COMPONENT
export default function NuclearExplosion3D({ position = [0, 0, 0], scale = 1, onExplosionEnd }) {
  const groupRef = useRef();
  const timeRef = useRef(0);
  const lightRef = useRef();
  
  useFrame((state, delta) => {
    timeRef.current += delta;
    
    // Global illumination decay
    if (lightRef.current) {
      const intensity = Math.max(0, 100 * Math.exp(-timeRef.current * 0.2));
      lightRef.current.intensity = intensity;
    }
    
    // Callback when explosion ends
    if (timeRef.current > 15 && onExplosionEnd) {
      onExplosionEnd();
    }
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {/* Initial flash - HDR bloom */}
      <FireballCore initialScale={10} />
      
      {/* Mushroom cloud stem */}
      <MushroomStem baseY={20} maxHeight={400} />
      
      {/* Mushroom cloud cap */}
      <MushroomCap y={300} scale={100} />
      
      {/* Shockwave rings */}
      <ShockwaveRing delay={0} maxRadius={500} color="#ffaa00" />
      <ShockwaveRing delay={0.1} maxRadius={600} color="#ff6600" />
      
      {/* Debris particles */}
      <DebrisParticles count={50} originY={0} />
      
      {/* Ash particles */}
      <AshParticles count={30} />
      
      {/* Global illumination light */}
      <pointLight
        ref={lightRef}
        position={[0, 100, 0]}
        color="#ff6600"
        intensity={100}
        distance={2000}
        decay={1}
      />
    </group>
  );
}
