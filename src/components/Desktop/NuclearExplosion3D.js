'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// === PERLIN NOISE IMPLEMENTATION FOR TURBULENCE ===
class PerlinNoise {
  constructor(seed = Math.random()) {
    this.permutation = [];
    for (let i = 0; i < 256; i++) this.permutation[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor((seed * (i + 1)) % (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
    this.permutation = [...this.permutation, ...this.permutation];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }
  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const A = this.permutation[X] + Y, AA = this.permutation[A] + Z, AB = this.permutation[A + 1] + Z;
    const B = this.permutation[X + 1] + Y, BA = this.permutation[B] + Z, BB = this.permutation[B + 1] + Z;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad(this.permutation[AA], x, y, z), this.grad(this.permutation[BA], x - 1, y, z), u),
        this.lerp(this.grad(this.permutation[AB], x, y - 1, z), this.grad(this.permutation[BB], x - 1, y - 1, z), u), v),
      this.lerp(
        this.lerp(this.grad(this.permutation[AA + 1], x, y, z - 1), this.grad(this.permutation[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(this.permutation[AB + 1], x, y - 1, z - 1), this.grad(this.permutation[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  fbm(x, y, z, octaves = 4) {
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise(x * frequency, y * frequency, z * frequency);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / maxValue;
  }
}

// === VOLUMETRIC SMOKE LAYER COMPONENT ===
const VolumetricSmokeLayer = ({ position, scale, color, opacity, noiseOffset, noiseScale, layerIndex }) => {
  const meshRef = useRef();
  const materialRef = useRef();
  const perlin = useRef(new PerlinNoise(layerIndex * 0.1));
  
  useFrame((state, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // Turbulent rotation
    meshRef.current.rotation.y += delta * 0.1 * (layerIndex % 2 === 0 ? 1 : -1);
    meshRef.current.rotation.x = Math.sin(time * 0.3 + layerIndex) * 0.1;
    
    // Noise-based scale pulsing
    const noiseVal = perlin.current.noise(time * 0.5 + noiseOffset, layerIndex, 0);
    const scalePulse = 1 + noiseVal * 0.15;
    meshRef.current.scale.setScalar(scale * scalePulse);
    
    // Fade based on time
    const fadeProgress = Math.min(1, time * 0.1);
    materialRef.current.opacity = opacity * (1 - fadeProgress * 0.3);
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[1, 16, 16]} />
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

// === FIREBALL CORE COMPONENT ===
const FireballCore = ({ initialScale = 5 }) => {
  const groupRef = useRef();
  const coreRef = useRef();
  const outerRef = useRef();
  const haloRef = useRef();
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
    if (haloRef.current) {
      haloRef.current.scale.setScalar(expansionScale * 2);
      haloRef.current.material.opacity = Math.max(0, 0.4 - t * 0.1);
    }
    
    // Light intensity decay
    if (groupRef.current.children[3]) {
      groupRef.current.children[3].intensity = Math.max(0, 50 * temp * temp);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Inner core - brightest */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      
      {/* Outer fireball */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial
          color="#ff6600"
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* HDR bloom halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color="#ffff00"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
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

// === MUSHROOM CLOUD STEM ===
const MushroomStem = ({ baseY = 0, maxHeight = 300 }) => {
  const groupRef = useRef();
  const segmentsRef = useRef([]);
  const timeRef = useRef(0);
  const perlin = useRef(new PerlinNoise(0.5));
  
  const segments = useMemo(() => {
    const segs = [];
    for (let i = 0; i < 20; i++) {
      segs.push({
        y: i * 15,
        scale: 8 + Math.random() * 4,
        noiseOffset: Math.random() * 100,
        rotationSpeed: (Math.random() - 0.5) * 0.5,
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
      
      // Turbulent motion
      const noiseX = perlin.current.noise(t * 0.3, i * 0.5, 0) * 10;
      const noiseZ = perlin.current.noise(0, t * 0.3, i * 0.5) * 10;
      
      seg.position.x = noiseX;
      seg.position.z = noiseZ;
      seg.position.y = targetY;
      
      // Scale with height (thinner at top)
      const heightFactor = 1 - (i / segments.length) * 0.4;
      const scalePulse = segData.scale * heightFactor * (1 + riseProgress * 2);
      seg.scale.setScalar(scalePulse);
      
      // Rotation for turbulence effect
      seg.rotation.y += delta * segData.rotationSpeed;
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
          <sphereGeometry args={[seg.scale, 12, 12]} />
          <meshStandardMaterial
            color={i < 5 ? '#ff4400' : i < 10 ? '#666666' : '#444444'}
            transparent
            opacity={0.7 - i * 0.02}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
    </group>
  );
};

// === MUSHROOM CLOUD CAP ===
const MushroomCap = ({ y = 200, scale = 80 }) => {
  const groupRef = useRef();
  const layersRef = useRef([]);
  const timeRef = useRef(0);
  const perlin = useRef(new PerlinNoise(0.8));
  
  const layers = useMemo(() => {
    const lys = [];
    for (let i = 0; i < 15; i++) {
      lys.push({
        offsetY: i * 5,
        scale: scale * (1 + i * 0.15),
        color: i < 3 ? '#ff3300' : i < 6 ? '#aa4422' : i < 10 ? '#555555' : '#333333',
        opacity: 0.6 - i * 0.03,
        noiseOffset: Math.random() * 100,
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
      
      // Kelvin-Helmholtz instability simulation
      const noiseVal = perlin.current.fbm(t * 0.2, i * 0.3, 0, 3);
      const scaleX = expansion * (1 + noiseVal * 0.2);
      const scaleZ = expansion * (1 - noiseVal * 0.1);
      
      layer.scale.set(scaleX, expansion * 0.4, scaleZ);
      
      // Turbulent rotation
      layer.rotation.y += delta * 0.05 * (i % 2 === 0 ? 1 : -1);
      
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
          <sphereGeometry args={[1, 16, 16]} />
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
      <ringGeometry args={[0.8, 1, 64]} />
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

// === DEBRIS PARTICLES ===
const DebrisParticles = ({ count = 200, originY = 0 }) => {
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
      rotationSpeed: Math.random() * 5,
      life: 0,
      maxLife: 3 + Math.random() * 5,
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
      p.velocity.y -= 20 * delta;
      
      // Buoyancy for lighter particles
      if (p.scale < 1) {
        p.velocity.y += 10 * delta;
      }
      
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

// === ASH AND DUST PARTICLES ===
const AshParticles = ({ count = 100 }) => {
  const instancedMeshRef = useRef();
  const particlesData = useRef([]);
  const timeRef = useRef(0);
  const perlin = useRef(new PerlinNoise(0.3));
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    particlesData.current = Array(count).fill(0).map(() => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 100,
        50 + Math.random() * 200,
        (Math.random() - 0.5) * 100
      ),
      baseY: 50 + Math.random() * 200,
      scale: 0.2 + Math.random() * 0.5,
      driftSpeed: 0.5 + Math.random() * 1,
      noiseOffset: Math.random() * 100,
    }));
  }, [count]);

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;
    
    timeRef.current += delta;
    const t = timeRef.current;
    
    particlesData.current.forEach((p, i) => {
      // Rising with turbulence
      const buoyancy = Math.max(0, 1 - t * 0.05) * 20;
      p.position.y += buoyancy * delta;
      
      // Horizontal drift
      const noiseX = perlin.current.noise(t * 0.1 + p.noiseOffset, i * 0.1, 0);
      const noiseZ = perlin.current.noise(0, t * 0.1 + p.noiseOffset, i * 0.1);
      p.position.x += noiseX * p.driftSpeed * delta * 10;
      p.position.z += noiseZ * p.driftSpeed * delta * 10;
      
      // Slowly spread outward
      const spread = 0.5 * delta;
      p.position.x += p.position.x > 0 ? spread : -spread;
      p.position.z += p.position.z > 0 ? spread : -spread;
      
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
        opacity={0.5}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

// === HEAT DISTORTION SHADER ===
const HeatDistortion = ({ radius = 100, strength = 0.1 }) => {
  const meshRef = useRef();
  const timeRef = useRef(0);
  
  useFrame((state, delta) => {
    timeRef.current += delta;
    if (meshRef.current) {
      meshRef.current.material.uniforms.time.value = timeRef.current;
      meshRef.current.material.uniforms.strength.value = strength * Math.max(0, 1 - timeRef.current * 0.1);
    }
  });

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      strength: { value: strength },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float strength;
      varying vec2 vUv;
      
      void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        
        // Ripple distortion
        float ripple = sin(dist * 20.0 - time * 5.0) * strength;
        ripple *= smoothstep(0.5, 0.0, dist);
        
        vec2 distortedUv = vUv + normalize(center) * ripple * 0.1;
        
        float alpha = ripple * 2.0 + 0.1;
        alpha *= smoothstep(0.5, 0.2, dist);
        
        gl_FragColor = vec4(1.0, 0.9, 0.8, alpha * 0.3);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [strength]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 5, 0]}>
      <planeGeometry args={[radius * 2, radius * 2, 32, 32]} />
      <primitive object={shaderMaterial} attach="material" />
    </mesh>
  );
};

// === MAIN NUCLEAR EXPLOSION COMPONENT ===
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
      <ShockwaveRing delay={0.2} maxRadius={700} color="#ff4400" />
      
      {/* Dust ring on ground */}
      <ShockwaveRing delay={0.3} maxRadius={400} color="#8b7355" />
      
      {/* Debris particles */}
      <DebrisParticles count={300} originY={0} />
      
      {/* Ash particles */}
      <AshParticles count={150} />
      
      {/* Heat distortion */}
      <HeatDistortion radius={150} strength={0.15} />
      
      {/* Global illumination light */}
      <pointLight
        ref={lightRef}
        position={[0, 100, 0]}
        color="#ff6600"
        intensity={100}
        distance={2000}
        decay={1}
      />
      
      {/* Secondary fill lights */}
      <pointLight position={[100, 50, 100]} color="#ff4400" intensity={20} distance={500} />
      <pointLight position={[-100, 50, -100]} color="#ff2200" intensity={20} distance={500} />
    </group>
  );
}
