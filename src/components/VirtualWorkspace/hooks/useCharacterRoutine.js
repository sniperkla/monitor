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

  const transitionToRef = useRef(null);

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
          transitionToRef.current(nextInSequence);
        }, duration);
      }, walkDuration);
    } else {
      setCurrentState(nextState);
      setTargetPosition(getLocationForState(nextState));

      const duration = randomDuration(nextState);
      timerRef.current = setTimeout(() => {
        routineIndexRef.current++;
        const nextInSequence = ROUTINE_SEQUENCE[routineIndexRef.current % ROUTINE_SEQUENCE.length];
        transitionToRef.current(nextInSequence);
      }, duration);
    }
  }, [getLocationForState]);

  useEffect(() => {
    transitionToRef.current = transitionTo;
  }, [transitionTo]);

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
      transitionTo(STATES.CODING); // eslint-disable-line react-hooks/set-state-in-effect -- intentional state transition on prop change
    }
  }, [sshActive, currentState, clearTimer, transitionTo]);

  // Reactive: App idle forces resting
  useEffect(() => {
    if (isAppIdle && currentState === STATES.IDLE) {
      clearTimer();
      routineIndexRef.current = ROUTINE_SEQUENCE.indexOf(STATES.RESTING);
      transitionTo(STATES.RESTING); // eslint-disable-line react-hooks/set-state-in-effect -- intentional state transition on prop change
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
