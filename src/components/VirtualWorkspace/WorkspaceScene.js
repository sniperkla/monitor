'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { X, Download, Sun, Moon, Sunset } from 'lucide-react';

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
import useCharacterRoutine from './hooks/useCharacterRoutine';
import { exportSceneToGLB } from './utils/exportGLB';

const ENV_PRESETS = [
  { id: 'office', label: 'Office' },
  { id: 'space', label: 'Space' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'outdoor', label: 'Outdoor' },
];

const TIME_OPTIONS = [
  { id: 'day', label: 'Day', icon: Sun },
  { id: 'sunset', label: 'Sunset', icon: Sunset },
  { id: 'night', label: 'Night', icon: Moon },
];

function Scene({ envPreset, timeOfDay, onSceneRef }) {
  const { scene } = useThree();
  const workspace = useWorkspaceState();
  const routine = useCharacterRoutine({ sshActive: workspace.sshCount > 0 });

  useEffect(() => {
    onSceneRef(scene);
  }, [scene, onSceneRef]);

  const firstSSH = workspace.sshConnections[0];
  const firstDB = workspace.dbConnections[0];
  const hasServers = workspace.servers.length > 0;

  return (
    <>
      <Environment preset={envPreset} timeOfDay={timeOfDay} />
      <OrbitControls
        makeDefault
        minDistance={2}
        maxDistance={8}
        maxPolarAngle={Math.PI / 2 + 0.2}
        target={[0, 1.2, 0]}
      />

      <Desk position={[0, 0, 0]} />
      <Chair position={[0, 0, 0.6]} />
      <Character
        position={[0, 0, 0.5]}
        isTyping={workspace.sshCount > 0}
        routineState={routine.state}
        targetPosition={routine.targetPosition}
        isMoving={routine.isMoving}
      />
      <Keyboard position={[0, 0.79, 0.15]} />
      <Mouse position={[0.35, 0.79, 0.15]} />
      <CoffeeMug position={[-0.7, 0.79, 0.25]} />

      <SSHMonitor
        position={[-0.5, 1.25, -0.35]}
        rotation={[0, 0.2, 0]}
        isActive={workspace.sshCount > 0}
        host={firstSSH?.host || 'server-01'}
        username={firstSSH?.username || 'admin'}
      />
      <DBMonitor
        position={[0.5, 1.25, -0.35]}
        rotation={[0, -0.2, 0]}
        isActive={workspace.dbCount > 0}
        dbName={firstDB?.database || 'PostgreSQL'}
        queryCount={workspace.dbCount * 12}
      />
      <DeployMonitor
        position={[-1.2, 1.25, -0.2]}
        rotation={[0, 0.4, 0]}
        isActive={workspace.deployActive}
        branch="main"
        progress={workspace.deployActive ? 65 : 0}
      />
      <ServerMonitor
        position={[1.2, 1.25, -0.2]}
        rotation={[0, -0.4, 0]}
        isActive={hasServers}
        servers={workspace.servers.map((s, i) => ({
          name: s.name,
          status: s.hasSSH ? 'online' : 'idle',
          cpu: 20 + ((i * 17) % 40),
          ram: 40 + ((i * 13) % 30),
        }))}
      />

      <StatusIndicators
        position={[0, 2.2, 0]}
        sshCount={workspace.sshCount}
        dbCount={workspace.dbCount}
        deployActive={workspace.deployActive}
        serverOnline={hasServers}
      />
    </>
  );
}

export default function WorkspaceScene({ onClose }) {
  const [envPreset, setEnvPreset] = useState('office');
  const [timeOfDay, setTimeOfDay] = useState('day');
  const [exporting, setExporting] = useState(false);
  const sceneRef = useRef(null);

  const handleSceneRef = useCallback((scene) => {
    sceneRef.current = scene;
  }, []);

  const handleExport = useCallback(async () => {
    if (!sceneRef.current || exporting) return;
    setExporting(true);
    try {
      await exportSceneToGLB(sceneRef.current);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  // Prevent clicks from propagating to desktop
  const stopPropagation = useCallback((e) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      {/* 3D Canvas - takes full space */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
        <Canvas
          shadows
          camera={{ position: [2.5, 2.5, 3], fov: 50 }}
          gl={{ preserveDrawingBuffer: true }}
          style={{ width: '100%', height: '100%' }}
        >
          <Scene envPreset={envPreset} timeOfDay={timeOfDay} onSceneRef={handleSceneRef} />
        </Canvas>

        {/* Controls overlay - pointer-events: none so Canvas receives events */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          padding: '12px 16px',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              pointerEvents: 'auto',
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#fff',
              cursor: 'pointer',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>

          {/* Settings panel */}
          <div style={{
            pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '10px',
            padding: '10px 14px',
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
            backdropFilter: 'blur(8px)',
          }}>
            {/* Environment preset selector */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {ENV_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEnvPreset(p.id)}
                  style={{
                    background: envPreset === p.id ? 'rgba(255,255,255,0.2)' : 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: envPreset === p.id ? '#fff' : 'rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)' }} />

            {/* Time of day selector */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {TIME_OPTIONS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTimeOfDay(t.id)}
                    title={t.label}
                    style={{
                      background: timeOfDay === t.id ? 'rgba(255,255,255,0.2)' : 'transparent',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      color: timeOfDay === t.id ? '#fff' : 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Icon size={14} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)' }} />

            {/* Export GLB button */}
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                background: exporting ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                color: exporting ? 'rgba(255,255,255,0.3)' : '#fff',
                cursor: exporting ? 'default' : 'pointer',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
            >
              <Download size={14} />
              {exporting ? 'Exporting...' : 'Export GLB'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
