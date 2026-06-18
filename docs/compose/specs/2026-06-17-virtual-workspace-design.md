# Virtual Workspace Simulator - Design Spec

## [S1] Problem

Users want an immersive 3D visualization of their SSH monitoring activities. The current dashboard is functional but lacks engagement. A virtual workspace that mirrors real-time actions (SSH connections, database queries, deployments, server status) in a cute Jibi/Chibi style would make monitoring more intuitive and enjoyable.

## [S2] Solution Overview

A toggle-overlay 3D workspace built with React Three Fiber that:
- Shows a chibi-style office desk with character
- Mirrors app actions on virtual monitors
- Uses toon/cel shading for the aesthetic
- Supports environment customization
- Can export models as GLB files

## [S3] Core Architecture

### Scene Structure
- `WorkspaceScene` - Main `<Canvas>` with camera controls, lighting, and scene graph
- Uses `@react-three/fiber` (already in dependencies)
- OrbitControls for camera movement
- Environment lighting with day/night cycle support

### State Bridge
- `useWorkspaceState` hook subscribes to AppContext/OSContext
- Translates app events (SSH open, DB connect, deploy start) into 3D scene state
- Uses React context to pass state down to monitor components

### Rendering
- Toon shading via custom `ShaderMaterial` with ramp texture
- Outline effect using edge detection post-processing
- Bloom/glow for active elements

## [S4] 3D Models & Shaders

### Procedural Geometry
- **Desk**: Rounded box with beveled edges, wood-like toon material
- **Character**: Sphere head + capsule body + cylinder limbs, exaggerated chibi proportions
- **Monitors**: Flat boxes with emissive screen planes, stand cylinders
- **Chair**: Simple curved back + seat + legs
- **Accessories**: Keyboard, mouse, coffee mug (cylinders/spheres)

### Toon Shader
```glsl
vec3 color = mix(shadowColor, baseColor, step(0.3, dot(normal, lightDir)));
color = mix(color, highlightColor, step(0.7, dot(normal, lightDir)));
```

### Outline Shader
- Inverted hull method (scale mesh slightly, render backfaces with black material)
- Or post-processing edge detection

### Screen Shader (for monitors)
- Emissive plane with dynamic texture
- Updates via `CanvasTexture` from 2D canvas (pattern from FalloutPeople.js)

## [S5] Real-time Action Mirroring

### Event Flow
```
App Action → WebSocket/Context → useWorkspaceState → Monitor Component → Screen Texture Update
```

### SSH Monitor
- When user opens SSH tab → virtual monitor shows terminal animation
- Active connection = glowing screen + typing animation
- Multiple SSH sessions = multiple monitors on desk

### Database Monitor
- Connection status (connected/disconnected) as screen color
- Query activity as pulse animation
- Schema changes as brief flash effect

### Deploy Monitor
- Progress bar on screen
- Success/failure animations (confetti/smoke)
- Git branch info display

### Server Monitor
- Server status cards (online/offline/error)
- CPU/Memory gauges
- Real-time metrics charts on screen

### Status Indicators
- Floating icons above character for quick status
- Glowing halos for active connections
- Particle effects for activity

## [S6] Environment & Customization

### Room Presets
- **Office** - Default desk setup, window with sky
- **Space Station** - Futuristic panels, starfield background
- **Gaming Room** - RGB lighting, posters, gaming setup
- **Outdoor** - Park bench, trees, sky dome

### Time of Day
- Dynamic sun/moon position
- Color temperature shifts (warm sunset, cool night)
- Shadow direction changes
- Window light intensity

### Decorations System
- Placeable objects (plants, photos, figurines)
- Grid-based placement
- Save/load decoration layouts

### Color Themes
- Accent color for UI elements on screens
- Character outfit colors
- Ambient lighting color

### GLB Export
- Button to export current scene as .glb
- Includes all procedural geometry
- Can be imported into Blender or other 3D tools

## [S7] Integration Points

### Toggle Mechanism
- Button in toolbar or keyboard shortcut (Ctrl+Shift+3)
- Smooth transition animation between UIs
- Remembers last state

### Existing Code Integration
- Leverages AppContext for connection state
- Uses OSContext for window/tab state
- WebSocket events from server.js for real-time updates
- Follows patterns from FalloutPeople.js

## [S8] Technical Constraints

- Must work with existing Next.js 16 setup
- Uses existing Three.js v0.183.2 dependency
- Must not break existing functionality
- Performance: maintain 60fps on mid-range hardware
- Mobile: basic support (touch controls)

## [S9] Success Criteria

1. User can toggle between traditional UI and 3D workspace
2. SSH connections appear on virtual monitors in real-time
3. Toon shading creates consistent chibi aesthetic
4. Environment can be customized (time, theme, decorations)
5. Scene can be exported as GLB
6. Performance remains smooth during active monitoring
