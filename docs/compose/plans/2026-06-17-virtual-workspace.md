# Virtual Workspace Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a toggle-overlay 3D virtual workspace that mirrors SSH monitoring actions in a Jibi/Chibi style with toon shading.

**Architecture:** Modular React Three Fiber components with procedural geometry, custom toon shaders, and a state bridge hook that translates AppContext events into 3D scene updates.

**Tech Stack:** React Three Fiber, Three.js, GLSL shaders, existing AppContext/OSContext

---

## File Structure

```
src/components/VirtualWorkspace/
├── WorkspaceScene.js          # Main Canvas + scene setup
├── WorkspaceToggle.js         # Toggle button component
├── components/
│   ├── Desk.js                # Procedural desk with toon material
│   ├── Character.js           # Chibi character (primitives + shader)
│   ├── Monitor.js             # Reusable monitor component
│   ├── Chair.js               # Office chair
│   ├── Keyboard.js            # Keyboard accessory
│   ├── Mouse.js               # Mouse accessory
│   ├── CoffeeMug.js           # Coffee mug accessory
│   ├── Environment.js         # Room, lighting, sky
│   ├── StatusIndicators.js    # Floating status icons
│   └── Monitors/
│       ├── SSHMonitor.js      # Shows terminal output
│       ├── DBMonitor.js       # Shows database connections
│       ├── DeployMonitor.js   # Shows deployment status
│       └── ServerMonitor.js   # Shows server health
├── shaders/
│   ├── ToonMaterial.js        # Cel-shading material
│   └── OutlineMaterial.js     # Edge detection outline
├── hooks/
│   └── useWorkspaceState.js   # Bridges app state to 3D
└── utils/
    └── exportGLB.js           # GLB export utility
```

---

### Task 1: Project Setup & Folder Structure

**Covers:** S3

**Files:**
- Create: `src/components/VirtualWorkspace/` directory structure

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/components/VirtualWorkspace/components/Monitors
mkdir -p src/components/VirtualWorkspace/shaders
mkdir -p src/components/VirtualWorkspace/hooks
mkdir -p src/components/VirtualWorkspace/utils
```

- [ ] **Step 2: Verify directories exist**

```bash
ls -la src/components/VirtualWorkspace/
```

Expected: directories components, shaders, hooks, utils

- [ ] **Step 3: Commit**

```bash
git add src/components/VirtualWorkspace/
git commit -m "feat: create VirtualWorkspace directory structure"
```

---

### Task 2: Toon Shader Material

**Covers:** S4

**Files:**
- Create: `src/components/VirtualWorkspace/shaders/ToonMaterial.js`

- [ ] **Step 1: Create ToonMaterial component**

```javascript
'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef, useMemo } from 'react';

const ToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color(0x88ccff),
    uShadowColor: new THREE.Color(0x4466aa),
    uHighlightColor: new THREE.Color(0xffffff),
    uLightDir: new THREE.Vector3(1, 1, 1).normalize(),
    uShadowThreshold: 0.3,
    uHighlightThreshold: 0.7,
    uOutlineThickness: 0.05,
    uTime: 0,
  },
  // Vertex shader
  `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // Fragment shader
  `
    uniform vec3 uColor;
    uniform vec3 uShadowColor;
    uniform vec3 uHighlightColor;
    uniform vec3 uLightDir;
    uniform float uShadowThreshold;
    uniform float uHighlightThreshold;
    uniform float uTime;
    
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    
    void main() {
      vec3 normal = normalize(vNormal);
      float NdotL = dot(normal, normalize(uLightDir));
      
      // 3-tone cel shading
      vec3 color = uShadowColor;
      color = mix(color, uColor, step(uShadowThreshold, NdotL));
      color = mix(color, uHighlightColor, step(uHighlightThreshold, NdotL));
      
      gl_FragColor = vec4(color, 1.0);
    }
  `
);

extend({ ToonShaderMaterial });

export function useToonMaterial({ color = 0x88ccff, shadowColor = 0x4466aa, highlightColor = 0xffffff } = {}) {
  const materialRef = useRef();
  
  const material = useMemo(() => {
    return new ToonShaderMaterial({
      uColor: new THREE.Color(color),
      uShadowColor: new THREE.Color(shadowColor),
      uHighlightColor: new THREE.Color(highlightColor),
    });
  }, [color, shadowColor, highlightColor]);
  
  return material;
}

export default ToonShaderMaterial;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/shaders/ToonMaterial.js
git commit -m "feat: add toon shader material for chibi aesthetic"
```

---

### Task 3: Outline Shader Material

**Covers:** S4

**Files:**
- Create: `src/components/VirtualWorkspace/shaders/OutlineMaterial.js`

- [ ] **Step 1: Create OutlineMaterial component**

```javascript
'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';

const OutlineShaderMaterial = shaderMaterial(
  {
    uOutlineColor: new THREE.Color(0x000000),
    uOutlineThickness: 0.05,
  },
  // Vertex shader - inverted hull method
  `
    uniform float uOutlineThickness;
    
    void main() {
      // Expand along normals
      vec3 expanded = position + normal * uOutlineThickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
    }
  `,
  // Fragment shader
  `
    uniform vec3 uOutlineColor;
    
    void main() {
      gl_FragColor = vec4(uOutlineColor, 1.0);
    }
  `
);

extend({ OutlineShaderMaterial });

export function useOutlineMaterial({ color = 0x000000, thickness = 0.05 } = {}) {
  const material = useMemo(() => {
    return new OutlineShaderMaterial({
      uOutlineColor: new THREE.Color(color),
      uOutlineThickness: thickness,
      side: THREE.BackSide,
    });
  }, [color, thickness]);
  
  return material;
}

export default OutlineShaderMaterial;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/shaders/OutlineMaterial.js
git commit -m "feat: add outline shader for chibi style edges"
```

---

### Task 4: Desk Component

**Covers:** S4

**Files:**
- Create: `src/components/VirtualWorkspace/components/Desk.js`

- [ ] **Step 1: Create Desk component**

```javascript
'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Desk({ position = [0, 0, 0], color = 0x8B6914 }) {
  const groupRef = useRef();
  const material = useToonMaterial({ 
    color, 
    shadowColor: 0x5a4510, 
    highlightColor: 0xc49a2a 
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* Desktop surface */}
      <mesh material={material} position={[0, 0.75, 0]}>
        <boxGeometry args={[2.0, 0.08, 1.0]} />
      </mesh>
      
      {/* Legs */}
      {[[-0.9, 0.375, -0.4], [0.9, 0.375, -0.4], [-0.9, 0.375, 0.4], [0.9, 0.375, 0.4]].map((pos, i) => (
        <mesh key={i} material={material} position={pos}>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
        </mesh>
      ))}
      
      {/* Drawer */}
      <mesh material={material} position={[0.6, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.35, 0.9]} />
      </mesh>
      
      {/* Drawer handle */}
      <mesh position={[0.6, 0.55, 0.46]}>
        <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
        <meshStandardMaterial color={0x888888} metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/Desk.js
git commit -m "feat: add procedural desk with toon shader"
```

---

### Task 5: Character Component

**Covers:** S4

**Files:**
- Create: `src/components/VirtualWorkspace/components/Character.js`

- [ ] **Step 1: Create Character component**

```javascript
'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Character({ position = [0, 0, 0], color = 0xffcc99 }) {
  const groupRef = useRef();
  const bodyMaterial = useToonMaterial({ 
    color: 0x4488ff, 
    shadowColor: 0x2244aa, 
    highlightColor: 0x66aaff 
  });
  const skinMaterial = useToonMaterial({ 
    color, 
    shadowColor: 0xcc9966, 
    highlightColor: 0xffddbb 
  });
  const hairMaterial = useToonMaterial({ 
    color: 0x333333, 
    shadowColor: 0x111111, 
    highlightColor: 0x555555 
  });
  
  useFrame((state) => {
    if (groupRef.current) {
      // Subtle breathing animation
      groupRef.current.scale.y = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.02;
    }
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* Head - exaggerated size for chibi */}
      <mesh material={skinMaterial} position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
      </mesh>
      
      {/* Hair */}
      <mesh material={hairMaterial} position={[0, 1.55, -0.05]}>
        <sphereGeometry args={[0.37, 16, 16]} />
      </mesh>
      
      {/* Eyes */}
      {[[-0.12, 1.45, 0.3], [0.12, 1.45, 0.3]].map((pos, i) => (
        <group key={i} position={pos}>
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
      ))}
      
      {/* Mouth */}
      <mesh position={[0, 1.35, 0.33]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color={0xff6666} />
      </mesh>
      
      {/* Body - small for chibi proportions */}
      <mesh material={bodyMaterial} position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
      </mesh>
      
      {/* Arms */}
      {[[-0.35, 1.0, 0], [0.35, 1.0, 0]].map((pos, i) => (
        <mesh key={i} material={bodyMaterial} position={pos} rotation={[0, 0, i === 0 ? -0.3 : 0.3]}>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
        </mesh>
      ))}
      
      {/* Legs */}
      {[[-0.12, 0.45, 0], [0.12, 0.45, 0]].map((pos, i) => (
        <mesh key={i} material={bodyMaterial} position={pos}>
          <capsuleGeometry args={[0.1, 0.2, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/Character.js
git commit -m "feat: add chibi character with toon shading"
```

---

### Task 6: Monitor Component

**Covers:** S4, S5

**Files:**
- Create: `src/components/VirtualWorkspace/components/Monitor.js`

- [ ] **Step 1: Create Monitor component**

```javascript
'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Monitor({ 
  position = [0, 0, 0], 
  rotation = [0, 0, 0],
  screenContent = null, // Canvas or texture
  isActive = false,
  color = 0x333333 
}) {
  const groupRef = useRef();
  const screenRef = useRef();
  const frameMaterial = useToonMaterial({ 
    color, 
    shadowColor: 0x111111, 
    highlightColor: 0x555555 
  });
  
  // Create screen texture from canvas
  const screenTexture = useMemo(() => {
    if (screenContent instanceof THREE.CanvasTexture) {
      return screenContent;
    }
    // Default screen with gradient
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    
    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);
    
    // Terminal-like content
    ctx.fillStyle = '#00ff00';
    ctx.font = '14px monospace';
    ctx.fillText('$ ssh user@server', 20, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Welcome to Ubuntu 22.04 LTS', 20, 55);
    ctx.fillText('Last login: Mon Jun 16 2026', 20, 75);
    ctx.fillStyle = '#00ff00';
    ctx.fillText('$ _', 20, 95);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, [screenContent]);
  
  // Glow effect for active monitors
  useFrame((state) => {
    if (screenRef.current && isActive) {
      screenRef.current.material.emissiveIntensity = 
        0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.2;
    }
  });
  
  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Monitor frame */}
      <mesh material={frameMaterial}>
        <boxGeometry args={[0.8, 0.5, 0.05]} />
      </mesh>
      
      {/* Screen */}
      <mesh ref={screenRef} position={[0, 0, 0.026]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial 
          map={screenTexture}
          emissive={isActive ? 0x00ff88 : 0x000000}
          emissiveIntensity={isActive ? 0.5 : 0}
          toneMapped={false}
        />
      </mesh>
      
      {/* Stand */}
      <mesh material={frameMaterial} position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
      </mesh>
      
      {/* Base */}
      <mesh material={frameMaterial} position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.02, 16]} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/Monitor.js
git commit -m "feat: add reusable monitor component with screen texture"
```

---

### Task 7: Accessory Components (Chair, Keyboard, Mouse, CoffeeMug)

**Covers:** S4

**Files:**
- Create: `src/components/VirtualWorkspace/components/Chair.js`
- Create: `src/components/VirtualWorkspace/components/Keyboard.js`
- Create: `src/components/VirtualWorkspace/components/Mouse.js`
- Create: `src/components/VirtualWorkspace/components/CoffeeMug.js`

- [ ] **Step 1: Create Chair component**

```javascript
'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Chair({ position = [0, 0, 0], color = 0x222222 }) {
  const material = useToonMaterial({ color, shadowColor: 0x111111, highlightColor: 0x444444 });
  
  return (
    <group position={position}>
      {/* Seat */}
      <mesh material={material} position={[0, 0.45, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
      </mesh>
      
      {/* Back */}
      <mesh material={material} position={[0, 0.75, -0.22]}>
        <boxGeometry args={[0.5, 0.55, 0.06]} />
      </mesh>
      
      {/* Legs */}
      {[[-0.2, 0.22, -0.2], [0.2, 0.22, -0.2], [-0.2, 0.22, 0.2], [0.2, 0.22, 0.2]].map((pos, i) => (
        <mesh key={i} material={material} position={pos}>
          <cylinderGeometry args={[0.025, 0.025, 0.44, 8]} />
        </mesh>
      ))}
      
      {/* Wheels */}
      {[[-0.2, 0.02, -0.2], [0.2, 0.02, -0.2], [-0.2, 0.02, 0.2], [0.2, 0.02, 0.2]].map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color={0x444444} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Create Keyboard component**

```javascript
'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Keyboard({ position = [0, 0, 0] }) {
  const material = useToonMaterial({ color: 0x444444, shadowColor: 0x222222, highlightColor: 0x666666 });
  
  return (
    <group position={position}>
      <mesh material={material}>
        <boxGeometry args={[0.4, 0.02, 0.15]} />
      </mesh>
      {/* Key rows */}
      {[-0.12, -0.04, 0.04, 0.12].map((z, i) => (
        <mesh key={i} position={[0, 0.015, z]}>
          <boxGeometry args={[0.35, 0.01, 0.03]} />
          <meshStandardMaterial color={0x555555} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 3: Create Mouse component**

```javascript
'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function Mouse({ position = [0, 0, 0] }) {
  const material = useToonMaterial({ color: 0x555555, shadowColor: 0x333333, highlightColor: 0x777777 });
  
  return (
    <group position={position}>
      <mesh material={material}>
        <capsuleGeometry args={[0.03, 0.06, 8, 16]} />
      </mesh>
      {/* Scroll wheel */}
      <mesh position={[0, 0.03, 0.02]}>
        <cylinderGeometry args={[0.008, 0.008, 0.02, 8]} />
        <meshStandardMaterial color={0x888888} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 4: Create CoffeeMug component**

```javascript
'use client';

import { useToonMaterial } from '../shaders/ToonMaterial';

export default function CoffeeMug({ position = [0, 0, 0], color = 0xffffff }) {
  const material = useToonMaterial({ color, shadowColor: 0xcccccc, highlightColor: 0xffffff });
  
  return (
    <group position={position}>
      {/* Mug body */}
      <mesh material={material}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 16]} />
      </mesh>
      {/* Handle */}
      <mesh material={material} position={[0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.02, 0.008, 8, 16, Math.PI]} />
      </mesh>
      {/* Coffee */}
      <mesh position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.01, 16]} />
        <meshStandardMaterial color={0x3a1a0a} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 5: Commit all accessories**

```bash
git add src/components/VirtualWorkspace/components/Chair.js src/components/VirtualWorkspace/components/Keyboard.js src/components/VirtualWorkspace/components/Mouse.js src/components/VirtualWorkspace/components/CoffeeMug.js
git commit -m "feat: add chair, keyboard, mouse, and coffee mug accessories"
```

---

### Task 8: Environment Component

**Covers:** S6

**Files:**
- Create: `src/components/VirtualWorkspace/components/Environment.js`

- [ ] **Step 1: Create Environment component**

```javascript
'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Sky } from '@react-three/drei';

export default function Environment({ 
  preset = 'office', // 'office' | 'space' | 'gaming' | 'outdoor'
  timeOfDay = 'day', // 'day' | 'sunset' | 'night'
  accentColor = 0x4488ff 
}) {
  const lightRef = useRef();
  
  // Time of day settings
  const timeSettings = useMemo(() => {
    const settings = {
      day: { sunPosition: [10, 20, 10], intensity: 1.0, ambient: 0.4, color: 0xffffff },
      sunset: { sunPosition: [20, 5, 10], intensity: 0.8, ambient: 0.3, color: 0xff8844 },
      night: { sunPosition: [-10, 5, 10], intensity: 0.3, ambient: 0.15, color: 0x4466aa },
    };
    return settings[timeOfDay] || settings.day;
  }, [timeOfDay]);
  
  // Room based on preset
  const RoomGeometry = useMemo(() => {
    switch (preset) {
      case 'space':
        return (
          <>
            {/* Space station walls */}
            <mesh position={[0, 2, -3]}>
              <planeGeometry args={[8, 4]} />
              <meshStandardMaterial color={0x222233} metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Window to space */}
            <mesh position={[0, 2, -2.98]}>
              <planeGeometry args={[2, 1.5]} />
              <meshStandardMaterial 
                color={0x000011} 
                emissive={0x001133}
                emissiveIntensity={0.5}
              />
            </mesh>
          </>
        );
      case 'gaming':
        return (
          <>
            {/* RGB wall */}
            <mesh position={[0, 2, -3]}>
              <planeGeometry args={[8, 4]} />
              <meshStandardMaterial color={0x111111} />
            </mesh>
            {/* RGB strip */}
            <mesh position={[0, 0.1, -2.98]}>
              <boxGeometry args={[6, 0.05, 0.02]} />
              <meshStandardMaterial 
                color={accentColor} 
                emissive={accentColor}
                emissiveIntensity={1}
              />
            </mesh>
          </>
        );
      case 'outdoor':
        return (
          <>
            <Sky sunPosition={[10, 20, 10]} />
            {/* Ground */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
              <planeGeometry args={[20, 20]} />
              <meshStandardMaterial color={0x44aa44} />
            </mesh>
            {/* Trees */}
            {[[-3, 0, -2], [3, 0, -3], [-2, 0, -4]].map((pos, i) => (
              <group key={i} position={pos}>
                <mesh position={[0, 1, 0]}>
                  <cylinderGeometry args={[0.15, 0.15, 2, 8]} />
                  <meshStandardMaterial color={0x8B4513} />
                </mesh>
                <mesh position={[0, 2.5, 0]}>
                  <sphereGeometry args={[0.8, 8, 8]} />
                  <meshStandardMaterial color={0x228B22} />
                </mesh>
              </group>
            ))}
          </>
        );
      default: // office
        return (
          <>
            {/* Back wall */}
            <mesh position={[0, 2, -3]}>
              <planeGeometry args={[8, 4]} />
              <meshStandardMaterial color={0xf5f5f5} />
            </mesh>
            {/* Floor */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
              <planeGeometry args={[8, 6]} />
              <meshStandardMaterial color={0x8B7355} />
            </mesh>
            {/* Window */}
            <mesh position={[2, 2, -2.98]}>
              <planeGeometry args={[1.5, 1.5]} />
              <meshStandardMaterial 
                color={0x87CEEB} 
                emissive={0x87CEEB}
                emissiveIntensity={0.3}
              />
            </mesh>
          </>
        );
    }
  }, [preset, accentColor]);
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={timeSettings.ambient} />
      <directionalLight 
        ref={lightRef}
        position={timeSettings.sunPosition} 
        intensity={timeSettings.intensity}
        color={timeSettings.color}
        castShadow
      />
      
      {/* Room */}
      {RoomGeometry}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/Environment.js
git commit -m "feat: add environment with room presets and time-of-day lighting"
```

---

### Task 9: Status Indicators Component

**Covers:** S5

**Files:**
- Create: `src/components/VirtualWorkspace/components/StatusIndicators.js`

- [ ] **Step 1: Create StatusIndicators component**

```javascript
'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function StatusIcon({ position, color, icon, pulse = false }) {
  const meshRef = useRef();
  
  useFrame((state) => {
    if (meshRef.current && pulse) {
      meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * 0.15);
    }
  });
  
  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshStandardMaterial 
        color={color} 
        emissive={color}
        emissiveIntensity={0.8}
        toneMapped={false}
      />
    </mesh>
  );
}

export default function StatusIndicators({ 
  position = [0, 2, 0],
  sshCount = 0,
  dbCount = 0,
  deployActive = false,
  serverOnline = true 
}) {
  const groupRef = useRef();
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 1.5) * 0.05;
    }
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* SSH indicator */}
      {sshCount > 0 && (
        <StatusIcon 
          position={[-0.3, 0, 0]} 
          color={0x00ff88} 
          pulse={true} 
        />
      )}
      
      {/* Database indicator */}
      {dbCount > 0 && (
        <StatusIcon 
          position={[-0.1, 0, 0]} 
          color={0xffaa00} 
          pulse={true} 
        />
      )}
      
      {/* Deploy indicator */}
      {deployActive && (
        <StatusIcon 
          position={[0.1, 0, 0]} 
          color={0xff4444} 
          pulse={true} 
        />
      )}
      
      {/* Server status */}
      <StatusIcon 
        position={[0.3, 0, 0]} 
        color={serverOnline ? 0x44ff44 : 0xff0000} 
        pulse={!serverOnline} 
      />
    </group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/StatusIndicators.js
git commit -m "feat: add floating status indicators above character"
```

---

### Task 10: Specialized Monitor Components

**Covers:** S5

**Files:**
- Create: `src/components/VirtualWorkspace/components/Monitors/SSHMonitor.js`
- Create: `src/components/VirtualWorkspace/components/Monitors/DBMonitor.js`
- Create: `src/components/VirtualWorkspace/components/Monitors/DeployMonitor.js`
- Create: `src/components/VirtualWorkspace/components/Monitors/ServerMonitor.js`

- [ ] **Step 1: Create SSHMonitor component**

```javascript
'use client';

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function SSHMonitor({ position, connection, isActive = false }) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);
  
  // Create canvas texture for terminal
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    canvasRef.current = canvas;
    textureRef.current = new THREE.CanvasTexture(canvas);
    textureRef.current.needsUpdate = true;
    
    // Draw initial terminal state
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = '#00ff00';
    ctx.font = '14px monospace';
    ctx.fillText(`$ ssh ${connection?.username || 'user'}@${connection?.host || 'server'}`, 20, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Connected successfully', 20, 55);
    ctx.fillText(`Last login: ${new Date().toLocaleString()}`, 20, 75);
    ctx.fillStyle = '#00ff00';
    ctx.fillText('$ _', 20, 95);
    
    textureRef.current.needsUpdate = true;
  }, [connection]);
  
  // Animate cursor blink
  useFrame((state) => {
    if (canvasRef.current && isActive) {
      const ctx = canvasRef.current.getContext('2d');
      const showCursor = Math.sin(state.clock.elapsedTime * 3) > 0;
      
      // Redraw cursor area
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(20, 80, 20, 20);
      if (showCursor) {
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px monospace';
        ctx.fillText('_', 20, 95);
      }
      textureRef.current.needsUpdate = true;
    }
  });
  
  return (
    <Monitor 
      position={position} 
      screenContent={textureRef.current}
      isActive={isActive}
    />
  );
}
```

- [ ] **Step 2: Create DBMonitor component**

```javascript
'use client';

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function DBMonitor({ position, connection, queryCount = 0 }) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);
  
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    canvasRef.current = canvas;
    textureRef.current = new THREE.CanvasTexture(canvas);
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);
    
    // Database icon
    ctx.fillStyle = '#ffaa00';
    ctx.font = '24px sans-serif';
    ctx.fillText('🗄️ Database', 20, 40);
    
    // Connection info
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.fillText(`Host: ${connection?.host || 'localhost'}`, 20, 80);
    ctx.fillText(`Status: Connected`, 20, 100);
    ctx.fillStyle = '#00ff88';
    ctx.fillText(`Queries: ${queryCount}`, 20, 120);
    
    textureRef.current.needsUpdate = true;
  }, [connection, queryCount]);
  
  // Pulse effect for queries
  useFrame((state) => {
    if (canvasRef.current && queryCount > 0) {
      const ctx = canvasRef.current.getContext('2d');
      const pulse = Math.sin(state.clock.elapsedTime * 5) > 0;
      
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(20, 130, 200, 30);
      if (pulse) {
        ctx.fillStyle = '#ffaa00';
        ctx.font = '14px monospace';
        ctx.fillText('⚡ Processing...', 20, 150);
      }
      textureRef.current.needsUpdate = true;
    }
  });
  
  return (
    <Monitor 
      position={position} 
      screenContent={textureRef.current}
      isActive={queryCount > 0}
    />
  );
}
```

- [ ] **Step 3: Create DeployMonitor component**

```javascript
'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function DeployMonitor({ position, deployStatus = null }) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);
  
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    canvasRef.current = canvas;
    textureRef.current = new THREE.CanvasTexture(canvas);
    
    updateCanvas(canvas, deployStatus);
    textureRef.current.needsUpdate = true;
  }, [deployStatus]);
  
  const updateCanvas = (canvas, status) => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);
    
    ctx.fillStyle = '#ff4444';
    ctx.font = '24px sans-serif';
    ctx.fillText('🚀 Deploy', 20, 40);
    
    if (status) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText(`Branch: ${status.branch || 'main'}`, 20, 80);
      ctx.fillText(`Status: ${status.state || 'idle'}`, 20, 100);
      
      // Progress bar
      const progress = status.progress || 0;
      ctx.fillStyle = '#333333';
      ctx.fillRect(20, 120, 300, 20);
      ctx.fillStyle = status.state === 'failed' ? '#ff4444' : '#00ff88';
      ctx.fillRect(20, 120, 300 * (progress / 100), 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${progress}%`, 330, 137);
    } else {
      ctx.fillStyle = '#888888';
      ctx.font = '14px monospace';
      ctx.fillText('No active deployments', 20, 80);
    }
  };
  
  useFrame((state) => {
    if (canvasRef.current && deployStatus?.state === 'deploying') {
      const ctx = canvasRef.current.getContext('2d');
      const dots = '.'.repeat(Math.floor(state.clock.elapsedTime * 2) % 4);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(20, 150, 200, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText(`Deploying${dots}`, 20, 170);
      textureRef.current.needsUpdate = true;
    }
  });
  
  return (
    <Monitor 
      position={position} 
      screenContent={textureRef.current}
      isActive={deployStatus?.state === 'deploying'}
    />
  );
}
```

- [ ] **Step 4: Create ServerMonitor component**

```javascript
'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Monitor from '../Monitor';

export default function ServerMonitor({ position, servers = [] }) {
  const canvasRef = useRef(null);
  const textureRef = useRef(null);
  
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    canvasRef.current = canvas;
    textureRef.current = new THREE.CanvasTexture(canvas);
    
    updateCanvas(canvas, servers);
    textureRef.current.needsUpdate = true;
  }, [servers]);
  
  const updateCanvas = (canvas, serverList) => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 320);
    
    ctx.fillStyle = '#4488ff';
    ctx.font = '24px sans-serif';
    ctx.fillText('🖥️ Servers', 20, 40);
    
    ctx.font = '14px monospace';
    serverList.slice(0, 4).forEach((server, i) => {
      const y = 70 + i * 50;
      const statusColor = server.online ? '#00ff88' : '#ff4444';
      const statusText = server.online ? 'Online' : 'Offline';
      
      ctx.fillStyle = statusColor;
      ctx.fillText(`● ${server.name || `Server ${i + 1}`}`, 20, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`  ${statusText} | CPU: ${server.cpu || 0}% | RAM: ${server.ram || 0}%`, 20, y + 20);
    });
  };
  
  // Update periodically
  useFrame((state) => {
    if (canvasRef.current && state.clock.elapsedTime % 2 < 0.016) {
      updateCanvas(canvasRef.current, servers);
      textureRef.current.needsUpdate = true;
    }
  });
  
  const anyOnline = servers.some(s => s.online);
  
  return (
    <Monitor 
      position={position} 
      screenContent={textureRef.current}
      isActive={anyOnline}
    />
  );
}
```

- [ ] **Step 5: Commit all monitor components**

```bash
git add src/components/VirtualWorkspace/components/Monitors/
git commit -m "feat: add specialized monitor components for SSH, DB, deploy, server"
```

---

### Task 11: useWorkspaceState Hook

**Covers:** S3, S5

**Files:**
- Create: `src/components/VirtualWorkspace/hooks/useWorkspaceState.js`

- [ ] **Step 1: Create useWorkspaceState hook**

```javascript
'use client';

import { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';

export default function useWorkspaceState() {
  const { state: appState } = useApp();
  const { state: osState } = useOS();
  
  // Derive workspace state from app context
  const workspaceState = useMemo(() => {
    const { 
      connections, 
      activeTerminals, 
      standaloneTerminals,
      activeDatabaseBrowsers,
      activeFileManagers 
    } = appState;
    
    // Count active SSH sessions
    const sshCount = activeTerminals.length + standaloneTerminals.length;
    
    // Count active DB connections
    const dbCount = activeDatabaseBrowsers.length;
    
    // Get connection details for monitors
    const sshConnections = activeTerminals.map(t => {
      const conn = connections.find(c => c._id === t.connectionId);
      return {
        id: t.id,
        host: conn?.host || t.host,
        username: conn?.username || 'user',
        connectionName: t.connectionName,
      };
    });
    
    const dbConnections = activeDatabaseBrowsers.map(b => {
      const conn = connections.find(c => c._id === b.connectionId);
      return {
        id: b.id,
        host: conn?.host || 'localhost',
        connectionName: b.connectionName,
      };
    });
    
    // Server status (from connections)
    const servers = connections.slice(0, 4).map(c => ({
      name: c.name || c.host,
      online: c.status === 'online',
      cpu: c.cpu || Math.floor(Math.random() * 100),
      ram: c.ram || Math.floor(Math.random() * 100),
    }));
    
    // Deploy status (from window state if AutoDeploy is open)
    const deployWindow = Object.values(osState.windows || {}).find(w => 
      w.title?.toLowerCase().includes('deploy')
    );
    const deployActive = !!deployWindow;
    
    return {
      sshCount,
      dbCount,
      sshConnections,
      dbConnections,
      servers,
      deployActive,
      deployStatus: deployActive ? { 
        branch: 'main', 
        state: 'deploying', 
        progress: 45 
      } : null,
      anyActive: sshCount > 0 || dbCount > 0 || deployActive,
    };
  }, [appState, osState]);
  
  return workspaceState;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/hooks/useWorkspaceState.js
git commit -m "feat: add useWorkspaceState hook to bridge app state to 3D"
```

---

### Task 12: GLB Export Utility

**Covers:** S6

**Files:**
- Create: `src/components/VirtualWorkspace/utils/exportGLB.js`

- [ ] **Step 1: Create exportGLB utility**

```javascript
'use client';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function exportSceneToGLB(scene, filename = 'virtual-workspace.glb') {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    
    exporter.parse(
      scene,
      (result) => {
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        resolve(true);
      },
      (error) => {
        console.error('GLB export failed:', error);
        reject(error);
      },
      { binary: true }
    );
  });
}

export function downloadGLB(blob, filename = 'virtual-workspace.glb') {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/utils/exportGLB.js
git commit -m "feat: add GLB export utility for 3D scene"
```

---

### Task 13: Main WorkspaceScene Component

**Covers:** S3, S4, S5, S6

**Files:**
- Create: `src/components/VirtualWorkspace/WorkspaceScene.js`

- [ ] **Step 1: Create WorkspaceScene component**

```javascript
'use client';

import { useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Desk from './components/Desk';
import Character from './components/Character';
import Chair from './components/Chair';
import Keyboard from './components/Keyboard';
import Mouse from './components/Mouse';
import CoffeeMug from './components/CoffeeMug';
import Environment from './components/Environment';
import StatusIndicators from './components/StatusIndicators';
import SSHMonitor from './components/Monitors/SSHMonitor';
import DBMonitor from './components/Monitors/DBMonitor';
import DeployMonitor from './components/Monitors/DeployMonitor';
import ServerMonitor from './components/Monitors/ServerMonitor';
import useWorkspaceState from './hooks/useWorkspaceState';
import { exportSceneToGLB } from './utils/exportGLB';

function Scene({ environmentPreset, timeOfDay, accentColor }) {
  const { scene } = useThree();
  const workspaceState = useWorkspaceState();
  
  // Calculate monitor positions
  const monitorPositions = [
    [-1.2, 1.2, -0.5],  // Left monitor
    [0, 1.2, -0.5],     // Center monitor
    [1.2, 1.2, -0.5],   // Right monitor
  ];
  
  return (
    <>
      <Environment 
        preset={environmentPreset} 
        timeOfDay={timeOfDay}
        accentColor={accentColor}
      />
      
      {/* Desk setup */}
      <Desk position={[0, 0, 0]} />
      <Chair position={[0, 0, 0.8]} />
      <Keyboard position={[0, 0.79, 0.1]} />
      <Mouse position={[0.35, 0.79, 0.1]} />
      <CoffeeMug position={[-0.8, 0.79, -0.2]} />
      
      {/* Character */}
      <Character position={[0, 0, 0.6]} />
      
      {/* Status indicators above character */}
      <StatusIndicators 
        position={[0, 2.2, 0.6]}
        sshCount={workspaceState.sshCount}
        dbCount={workspaceState.dbCount}
        deployActive={workspaceState.deployActive}
        serverOnline={workspaceState.servers.some(s => s.online)}
      />
      
      {/* SSH Monitors */}
      {workspaceState.sshConnections.slice(0, 2).map((conn, i) => (
        <SSHMonitor 
          key={conn.id}
          position={monitorPositions[i]}
          connection={conn}
          isActive={true}
        />
      ))}
      
      {/* DB Monitor */}
      {workspaceState.dbConnections.length > 0 && (
        <DBMonitor 
          position={monitorPositions[workspaceState.sshConnections.length] || monitorPositions[2]}
          connection={workspaceState.dbConnections[0]}
          queryCount={5}
        />
      )}
      
      {/* Deploy Monitor */}
      {workspaceState.deployActive && (
        <DeployMonitor 
          position={[1.5, 1.2, -0.8]}
          deployStatus={workspaceState.deployStatus}
        />
      )}
      
      {/* Server Monitor */}
      <ServerMonitor 
        position={[-1.5, 1.2, -0.8]}
        servers={workspaceState.servers}
      />
    </>
  );
}

export default function WorkspaceScene({ onClose }) {
  const canvasRef = useRef();
  const [environmentPreset, setEnvironmentPreset] = useState('office');
  const [timeOfDay, setTimeOfDay] = useState('day');
  const [accentColor, setAccentColor] = useState(0x4488ff);
  
  const handleExportGLB = useCallback(async () => {
    if (canvasRef.current) {
      const scene = canvasRef.current.__r3f.scene;
      await exportSceneToGLB(scene);
    }
  }, []);
  
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
      {/* Controls overlay */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-red-500/80 text-white rounded-lg hover:bg-red-500 transition-colors"
        >
          Close
        </button>
        
        <select
          value={environmentPreset}
          onChange={(e) => setEnvironmentPreset(e.target.value)}
          className="px-3 py-2 bg-gray-800/80 text-white rounded-lg"
        >
          <option value="office">Office</option>
          <option value="space">Space Station</option>
          <option value="gaming">Gaming Room</option>
          <option value="outdoor">Outdoor</option>
        </select>
        
        <select
          value={timeOfDay}
          onChange={(e) => setTimeOfDay(e.target.value)}
          className="px-3 py-2 bg-gray-800/80 text-white rounded-lg"
        >
          <option value="day">Day</option>
          <option value="sunset">Sunset</option>
          <option value="night">Night</option>
        </select>
        
        <button
          onClick={handleExportGLB}
          className="px-4 py-2 bg-blue-500/80 text-white rounded-lg hover:bg-blue-500 transition-colors"
        >
          Export GLB
        </button>
      </div>
      
      {/* 3D Canvas */}
      <Canvas
        ref={canvasRef}
        camera={{ position: [0, 2, 3], fov: 60 }}
        shadows
      >
        <Suspense fallback={null}>
          <Scene 
            environmentPreset={environmentPreset}
            timeOfDay={timeOfDay}
            accentColor={accentColor}
          />
        </Suspense>
        <OrbitControls 
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={1}
          maxDistance={10}
          target={[0, 1, 0]}
        />
      </Canvas>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/WorkspaceScene.js
git commit -m "feat: add main WorkspaceScene with all components"
```

---

### Task 14: Workspace Toggle Component

**Covers:** S7

**Files:**
- Create: `src/components/VirtualWorkspace/WorkspaceToggle.js`

- [ ] **Step 1: Create WorkspaceToggle component**

```javascript
'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Box } from 'lucide-react';

const WorkspaceScene = dynamic(() => import('./WorkspaceScene'), {
  ssr: false,
  loading: () => null,
});

export default function WorkspaceToggle() {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);
  
  return (
    <>
      <button
        onClick={toggle}
        className="fixed bottom-20 right-4 z-40 p-3 bg-purple-500/80 text-white rounded-full shadow-lg hover:bg-purple-500 transition-all hover:scale-110"
        title="Toggle Virtual Workspace (Ctrl+Shift+3)"
      >
        <Box size={24} />
      </button>
      
      {isOpen && <WorkspaceScene onClose={() => setIsOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/WorkspaceToggle.js
git commit -m "feat: add toggle button for virtual workspace"
```

---

### Task 15: Integration with DesktopEnvironment

**Covers:** S7

**Files:**
- Modify: `src/components/Desktop/DesktopEnvironment.js`

- [ ] **Step 1: Add import for WorkspaceToggle**

Add after the existing imports (around line 32):

```javascript
import WorkspaceToggle from '@/components/VirtualWorkspace/WorkspaceToggle';
```

- [ ] **Step 2: Add WorkspaceToggle to render**

Add before the closing `</div>` of the main component (around line 1200):

```jsx
{/* Virtual Workspace Toggle */}
<WorkspaceToggle />
```

- [ ] **Step 3: Add keyboard shortcut**

Add in the useEffect for keyboard shortcuts (find existing keyboard shortcut handler):

```javascript
// Virtual Workspace shortcut
if (e.ctrlKey && e.shiftKey && e.key === '3') {
  e.preventDefault();
  // Trigger workspace toggle
  window.dispatchEvent(new CustomEvent('toggle-virtual-workspace'));
}
```

- [ ] **Step 4: Test the integration**

```bash
npm run dev
```

Expected: App runs, purple cube button appears bottom-right, clicking opens 3D workspace

- [ ] **Step 5: Commit**

```bash
git add src/components/Desktop/DesktopEnvironment.js
git commit -m "feat: integrate virtual workspace toggle into desktop environment"
```

---

### Task 16: Final Testing & Polish

**Covers:** S8, S9

**Files:**
- Modify: Various files for polish

- [ ] **Step 1: Run linter**

```bash
npm run lint
```

Expected: No errors

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Test all features**

1. Toggle workspace open/close
2. Switch environment presets
3. Change time of day
4. Open SSH connection → see monitor update
5. Open database browser → see monitor update
6. Export GLB file
7. Verify toon shading renders correctly
8. Check performance (60fps target)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete virtual workspace simulator with toon shading"
```
