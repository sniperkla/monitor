# Character Routine System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a state machine-driven routine system where the chibi character automatically cycles through activities (walking, coding, coffee, eating, resting, idle) and reacts to app state.

**Architecture:** A `useCharacterRoutine` hook manages state transitions and timing. The Character component receives the current state and position, driving animations via `useFrame`. App state integration detects SSH activity and idle periods.

**Tech Stack:** React hooks, @react-three/fiber useFrame, Three.js lerp

---

### Task 1: useCharacterRoutine Hook

**Covers:** S3, S6

**Files:**
- Create: `src/components/VirtualWorkspace/hooks/useCharacterRoutine.js`

- [ ] **Step 1: Create the state machine hook**

```javascript
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const STATES = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  CODING: 'CODING',
  COFFEE: 'COFFEE',
  EATING: 'EATING',
  RESTING: 'RESTING',
};

const LOCATIONS = {
  desk: [0, 0, 0.5],
  coffee: [-0.7, 0.79, 0.25],
  rest: [0, 0, 1.2],
  frontDesk: [0, 0, 0.8],
};

const DURATIONS = {
  [STATES.IDLE]: [10000, 20000],
  [STATES.WALKING]: [2000, 3000],
  [STATES.CODING]: [5000, 15000],
  [STATES.COFFEE]: [3000, 5000],
  [STATES.EATING]: [4000, 6000],
  [STATES.RESTING]: [8000, 12000],
};

const ROUTINE_SEQUENCE = [
  STATES.IDLE,
  STATES.COFFEE,
  STATES.CODING,
  STATES.EATING,
  STATES.CODING,
  STATES.RESTING,
  STATES.IDLE,
];

function randomDuration(state) {
  const [min, max] = DURATIONS[state] || [5000, 10000];
  return min + Math.random() * (max - min);
}

export default function useCharacterRoutine({ sshActive = false, isAppIdle = false } = {}) {
  const [currentState, setCurrentState] = useState(STATES.IDLE);
  const [targetPosition, setTargetPosition] = useState(LOCATIONS.frontDesk);
  const [isMoving, setIsMoving] = useState(false);
  const routineIndexRef = useRef(0);
  const timerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getLocationForState = useCallback((state) => {
    switch (state) {
      case STATES.CODING: return LOCATIONS.desk;
      case STATES.COFFEE: return LOCATIONS.coffee;
      case STATES.RESTING: return LOCATIONS.rest;
      case STATES.EATING: return LOCATIONS.desk;
      case STATES.IDLE: return LOCATIONS.frontDesk;
      default: return LOCATIONS.frontDesk;
    }
  }, []);

  const transitionTo = useCallback((nextState) => {
    const targetLoc = getLocationForState(nextState);
    
    if (nextState === STATES.WALKING) {
      setCurrentState(STATES.WALKING);
      setIsMoving(true);
      setTargetPosition(targetLoc);
      
      const walkDuration = randomDuration(STATES.WALKING);
      timerRef.current = setTimeout(() => {
        setIsMoving(false);
        const actualState = ROUTINE_SEQUENCE[routineIndexRef.current % ROUTINE_SEQUENCE.length];
        setCurrentState(actualState);
        setTargetPosition(getLocationForState(actualState));
        
        const duration = randomDuration(actualState);
        timerRef.current = setTimeout(() => {
          routineIndexRef.current++;
          const nextInSequence = ROUTINE_SEQUENCE[routineIndexRef.current % ROUTINE_SEQUENCE.length];
          transitionTo(nextInSequence);
        }, duration);
      }, walkDuration);
    } else {
      setCurrentState(nextState);
      setTargetPosition(getLocationForState(nextState));
      
      const duration = randomDuration(nextState);
      timerRef.current = setTimeout(() => {
        routineIndexRef.current++;
        const nextInSequence = ROUTINE_SEQUENCE[routineIndexRef.current % ROUTINE_SEQUENCE.length);
        transitionTo(nextInSequence);
      }, duration);
    }
  }, [getLocationForState]);

  // Start routine
  useEffect(() => {
    const initialDuration = randomDuration(STATES.IDLE);
    timerRef.current = setTimeout(() => {
      routineIndexRef.current = 1;
      transitionTo(STATES.WALKING);
    }, initialDuration);

    return clearTimer;
  }, [transitionTo, clearTimer]);

  // Reactive: SSH active forces coding
  useEffect(() => {
    if (sshActive && currentState !== STATES.CODING && currentState !== STATES.WALKING) {
      clearTimer();
      routineIndexRef.current = ROUTINE_SEQUENCE.indexOf(STATES.CODING);
      transitionTo(STATES.CODING);
    }
  }, [sshActive, currentState, clearTimer, transitionTo]);

  // Reactive: App idle forces resting
  useEffect(() => {
    if (isAppIdle && currentState === STATES.IDLE) {
      clearTimer();
      routineIndexRef.current = ROUTINE_SEQUENCE.indexOf(STATES.RESTING);
      transitionTo(STATES.RESTING);
    }
  }, [isAppIdle, currentState, clearTimer, transitionTo]);

  return {
    state: currentState,
    targetPosition,
    isMoving,
    STATES,
    LOCATIONS,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/hooks/useCharacterRoutine.js
git commit -m "feat: add character routine state machine hook"
```

---

### Task 2: Update useWorkspaceState with Idle Detection

**Covers:** S6

**Files:**
- Modify: `src/components/VirtualWorkspace/hooks/useWorkspaceState.js`

- [ ] **Step 1: Add idle detection to useWorkspaceState**

Add at the end of the hook, before the return statement:

```javascript
// Idle detection
const [isAppIdle, setIsAppIdle] = useState(false);
const lastActivityRef = useRef(Date.now());

useEffect(() => {
  const checkIdle = () => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityRef.current;
    setIsAppIdle(timeSinceActivity > 30000); // 30 seconds
  };
  
  const interval = setInterval(checkIdle, 5000);
  return () => clearInterval(interval);
}, []);

useEffect(() => {
  // Reset idle timer on any activity
  if (workspaceState.sshCount > 0 || workspaceState.dbCount > 0 || workspaceState.deployActive) {
    lastActivityRef.current = Date.now();
    setIsAppIdle(false);
  }
}, [workspaceState.sshCount, workspaceState.dbCount, workspaceState.deployActive]);
```

Add `isAppIdle` to the return object.

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/hooks/useWorkspaceState.js
git commit -m "feat: add idle detection to workspace state"
```

---

### Task 3: Update Character Component with Routine Animations

**Covers:** S5

**Files:**
- Modify: `src/components/VirtualWorkspace/components/Character.js`

- [ ] **Step 1: Update Character to use routine state**

The Character component needs to:
1. Accept `routineState` and `targetPosition` props
2. Animate movement when walking (lerp position)
3. Play different animations based on state (coding, coffee, eating, resting, idle)
4. Keep existing animations (blink, breathing) as base layer

Key changes:
- Add position lerp in `useFrame` for walking
- Switch arm/head animations based on `routineState`
- Add drinking pose for COFFEE state
- Add eating pose for EATING state  
- Add relaxed pose for RESTING state

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/components/Character.js
git commit -m "feat: add routine-based animations to character"
```

---

### Task 4: Wire Routine into WorkspaceScene

**Covers:** S7

**Files:**
- Modify: `src/components/VirtualWorkspace/WorkspaceScene.js`

- [ ] **Step 1: Import and use useCharacterRoutine**

In the Scene component, import and call the hook:

```javascript
import useCharacterRoutine from './hooks/useCharacterRoutine';

// Inside Scene component:
const workspace = useWorkspaceState();
const routine = useCharacterRoutine({
  sshActive: workspace.sshCount > 0,
  isAppIdle: workspace.isAppIdle,
});
```

Pass routine state to Character:

```jsx
<Character 
  position={[0, 0, 0.5]} 
  routineState={routine.state}
  targetPosition={routine.targetPosition}
  isMoving={routine.isMoving}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VirtualWorkspace/WorkspaceScene.js
git commit -m "feat: wire character routine into workspace scene"
```

---

### Task 5: Verify Build and Lint

**Covers:** S8

- [ ] **Step 1: Run linter on changed files**

```bash
npx eslint src/components/VirtualWorkspace/hooks/useCharacterRoutine.js src/components/VirtualWorkspace/hooks/useWorkspaceState.js src/components/VirtualWorkspace/components/Character.js src/components/VirtualWorkspace/WorkspaceScene.js
```

Expected: No errors

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete character routine system"
```
