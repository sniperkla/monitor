# Character Routine System - Design Spec

## [S1] Problem

The virtual workspace character is static - it just sits at the desk. The user wants the character to have a daily routine with activities like walking, coding, eating, drinking coffee, resting, and idle behaviors. The character should be reactive to app state (SSH open = coding, app idle = resting).

## [S2] Solution Overview

A state machine-driven routine system where the character cycles through activities based on app state and random intervals. Activities are activity-based (not time-based), meaning each activity runs for a natural duration before transitioning.

## [S3] State Machine

### States
- **IDLE**: Character stands, looks around, stretches (10-20s)
- **WALKING**: Character moves between locations (2-3s)
- **CODING**: Character sits at desk, types on keyboard (5-15s)
- **COFFEE**: Character walks to mug, drinks (3-5s)
- **EATING**: Character eats food at desk (4-6s)
- **RESTING**: Character sits back in chair, relaxed (8-12s)

### Transitions
```
IDLE → WALKING → COFFEE → WALKING → CODING → WALKING → EATING → WALKING → RESTING → WALKING → IDLE
```

### Reactive Overrides
- SSH connection opens → force transition to CODING
- App idle 30+ seconds → transition to RESTING
- Database query → brief CURIOSITY animation
- Random coffee break every 2-3 activities

## [S4] Walk Locations

- **Desk**: `[0, 0, 0.5]` - Coding position
- **Coffee Mug**: `[-0.7, 0.79, 0.25]` - Drinking position
- **Rest Area**: `[0, 0, 1.2]` - Behind chair
- **Front Desk**: `[0, 0, 0.8]` - Idle/look around

## [S5] Animations Per State

### IDLE
- Look around (head rotation)
- Stretch (arms up briefly)
- Shift weight (subtle body sway)

### WALKING
- Leg alternating motion
- Arm swing
- Body bob up/down
- Smooth lerp between positions

### CODING
- Seated at desk
- Arms forward on keyboard
- Typing motion (alternating arms)
- Occasional head tilt

### COFFEE
- Walk to mug location
- Reach for mug (arm extend)
- Bring to mouth (drinking pose)
- Return to idle stance

### EATING
- Seated at desk
- Hand to mouth motion
- Chewing animation

### RESTING
- Lean back in chair
- Relaxed arm position
- Slow breathing
- Occasional yawn

## [S6] App State Integration

### useWorkspaceState Hook Extensions
- `isAppIdle`: boolean (no activity for 30+ seconds)
- `sshActive`: boolean (SSH connection open)
- `dbQuerying`: boolean (database query in progress)
- `lastActivityTime`: timestamp of last app action

### State Override Logic
```javascript
if (sshActive && currentState !== CODING) {
  forceTransition('CODING');
} else if (isAppIdle && currentState === IDLE) {
  transition('RESTING');
}
```

## [S7] Implementation Structure

### New Files
- `hooks/useCharacterRoutine.js` - State machine and routine logic
- `components/Character.js` - Updated with animation states

### Modified Files
- `WorkspaceScene.js` - Pass app state to Character
- `useWorkspaceState.js` - Add idle detection

## [S8] Success Criteria

1. Character automatically cycles through all 6 activities
2. Walking animation shows smooth movement between locations
3. Each activity has distinct, recognizable animation
4. Character reacts to SSH connections (starts coding)
5. Character rests when app is idle
6. Transitions are smooth, no snapping or jumping
7. Performance remains at 60fps
