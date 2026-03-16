'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Laptop, Terminal as TermIcon, Play, Square, RefreshCw, Box, Layers, MonitorPlay, ExternalLink, AlertTriangle, Trash2, Folder } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import TerminalView from '@/components/TerminalView';
import FileManager from '@/components/FileManager';
import { io } from 'socket.io-client';

export default function DockerApp({ initialConnection, initialConnectionId, windowId }) {
  const { state } = useApp();
  const { showConfirm } = useOS();
  const { t } = useTranslation();
  
  // App state
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, terminal
  const [containers, setContainers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeContainer, setActiveContainer] = useState(null);
  const [isDockerInstalled, setIsDockerInstalled] = useState(true);
  
  // Connection selection
  const { connections, dbConfig } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');
  const [selectedConnection, setSelectedConnection] = useState(initialConnection || null);

  const initialConnIdRef = useRef(initialConnectionId);
  const { dispatch: osDispatch } = useOS();

  // Update window title when connection is selected
  useEffect(() => {
    if (selectedConnection && windowId) {
       osDispatch({ 
         type: 'SET_WINDOW_TITLE', 
         payload: { id: windowId, title: `Docker: ${selectedConnection.name}` } 
       });
    }
  }, [selectedConnection, windowId, osDispatch]);

  // Restore mode: auto-connect from initialConnectionId or localStorage
  useEffect(() => {
    if (selectedConnection) return;
    if (!connections || connections.length === 0) return;

    // 1. Try initial connection ID (passed via props on hydration)
    if (initialConnectionId) {
      const conn = connections.find(c => c._id === initialConnectionId);
      if (conn) {
        setSelectedConnection(conn);
        return;
      }
    }

    // 2. Fallback to localStorage persisted ID
    if (windowId) {
      const savedConnId = localStorage.getItem(`docker-connection-${windowId}`);
      if (savedConnId) {
        const conn = connections.find(c => c._id === savedConnId);
        if (conn) setSelectedConnection(conn);
      }
    }
  }, [connections, initialConnectionId, windowId]);

  // Save selected connection whenever it changes
  useEffect(() => {
    if (selectedConnection?._id && windowId) {
      localStorage.setItem(`docker-connection-${windowId}`, selectedConnection._id);
    }
  }, [selectedConnection, windowId]);

  // Restore mode: auto-connect from persisted initialConnectionId
  useEffect(() => {
    if (selectedConnection) return;
    if (!initialConnIdRef.current) return;
    if (!connections || connections.length === 0) return;

    const conn = connections.find((c) => c._id === initialConnIdRef.current);
    if (!conn) return;

    initialConnIdRef.current = null;
    setSelectedConnection(conn);
  }, [connections, selectedConnection]);

  // Hidden terminal socket just for running docker commands in the background
  const socketRef = useRef(null);

  // Connect background socket when a connection is selected
  useEffect(() => {
    if (!selectedConnection) return;
    
    setIsLoading(true);
    socketRef.current = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      query: {
        dbUri: dbConfig?.uri || ''
      }
    });

    let stdoutBuffer = '';
    const SENTINEL_CHECK_START = '---DOCKER_CHK_START---';
    const SENTINEL_CHECK_END = '---DOCKER_CHK_END---';
    const SENTINEL_START = '---DOCKER_LS_START---';
    const SENTINEL_END   = '---DOCKER_LS_END---';
    const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '');

    socketRef.current.on('connect', () => {
        socketRef.current.emit('ssh:connect', {
          connectionId: selectedConnection._id,
          connection: selectedConnection,
        });
      });
  
      socketRef.current.on('ssh:connected', () => {
        setTimeout(() => {
          if (!socketRef.current) return;
          // First check if docker is installed and accessible
          const checkCmd = `echo "${SENTINEL_CHECK_START}" && if command -v docker &> /dev/null && docker info &> /dev/null; then echo "OK"; else echo "MISSING"; fi && echo "${SENTINEL_CHECK_END}"\r`;
          socketRef.current.emit('ssh:input', checkCmd);
        }, 500);
      });

    // Robust parser
    const parseOutput = (raw) => {
        const clean = stripAnsi(raw);
        
        // Handle docker installation check
        const chkStart = clean.indexOf(SENTINEL_CHECK_START);
        const chkEnd = clean.indexOf(SENTINEL_CHECK_END, chkStart);
        if (chkStart !== -1 && chkEnd !== -1) {
            const block = clean.slice(chkStart + SENTINEL_CHECK_START.length, chkEnd).trim();
            if (block.includes("MISSING")) {
                setIsDockerInstalled(false);
                setIsLoading(false);
                stdoutBuffer = '';
                return;
            } else if (block.includes("OK")) {
                setIsDockerInstalled(true);
                stdoutBuffer = '';
                // Now list containers
                emitDockerLs();
                return;
            }
        }

        const si = clean.indexOf(SENTINEL_START);
        const ei = clean.indexOf(SENTINEL_END, si);
        if (si === -1 || ei === -1) return null; // not complete yet
        
        const block = clean.slice(si + SENTINEL_START.length, ei);
        const parsed = [];
        const lines = block.split('\n').filter(l => l.trim() && l.includes('|'));
        
        for (const line of lines) {
          // Format expected: ID|Names|Image|Status|State|Ports
          const [id, name, image, status, state, ports] = line.trim().split('|');
          if (id && name) {
            parsed.push({ 
              id: id.trim(),
              name: name.trim(), 
              image: image || '', 
              status: status || '', 
              state: state ? state.toLowerCase().trim() : 'unknown',
              ports: ports || '',
              raw: line 
            });
          }
        }
        return parsed;
      };

    socketRef.current.on('ssh:data', (data) => {
      stdoutBuffer += data;
      const result = parseOutput(stdoutBuffer);
      if (Array.isArray(result)) {
        setContainers(result);
        setIsLoading(false);
        stdoutBuffer = ''; // clear so next command starts fresh
      }
    });

    socketRef.current.on('ssh:error', () => {
      setIsLoading(false);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [selectedConnection]);

  const DOCKER_SENTINEL_START = '---DOCKER_LS_START---';
  const DOCKER_SENTINEL_END   = '---DOCKER_LS_END---';

  const emitDockerLs = () => {
    if (!socketRef.current) return;
    const formatString = '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}';
    const setupEcho = `echo "${DOCKER_SENTINEL_START}" && docker ps -a --format "${formatString}" 2>/dev/null; echo "${DOCKER_SENTINEL_END}"\r`;
    socketRef.current.emit('ssh:input', setupEcho);
  };

  const fetchContainers = () => {
    if (socketRef.current) {
      setIsLoading(true);
      emitDockerLs();
      setTimeout(() => setIsLoading(false), 4000); // safety fallback
    }
  };

  const handleContainerAction = (id, action) => { // action: start, stop, restart, rm
    if (!socketRef.current) return;
    setIsLoading(true);
    let cmd = '';
    if (action === 'rm') cmd = `docker rm -f "${id}"\r`;
    else cmd = `docker ${action} "${id}"\r`;
    
    socketRef.current.emit('ssh:input', cmd);
    setTimeout(() => emitDockerLs(), 1200);
  };

  const attachToContainer = (containerId, containerName) => {
    window.dispatchEvent(new CustomEvent('open-terminal', {
      detail: {
        connection: selectedConnection,
        initialCommand: `docker exec -it ${containerId} sh || docker exec -it ${containerId} bash\r`,
        title: `${selectedConnection.name} (${containerName}) (Docker)`
      }
    }));
  };

  const browseContainer = (containerId, containerName) => {
    window.dispatchEvent(new CustomEvent('open-files', {
      detail: {
        connection: selectedConnection,
        connectionIdOverride: `docker-${containerId}:${selectedConnection._id}`,
        title: `Files: ${selectedConnection.name} (${containerName}) (Docker)`
      }
    }));
  };

  // 1. SELECT CONNECTION SCREEN
  if (!selectedConnection) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
        <div className="flex-1 overflow-y-auto z-20">
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '1px solid rgba(14, 165, 233, 0.3)' }}>
                  <Box size={22} className="text-sky-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Docker Manager</h1>
                  <p className="text-[var(--text-secondary)] text-sm font-mono">$ select a server to manage docker containers</p>
                </div>
              </div>

              {/* Connection Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sshConnections.map(conn => (
                  <div 
                    key={conn._id}
                    onClick={() => setSelectedConnection(conn)}
                    className="group relative p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] hover:bg-white/5"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${conn.color}18`, border: `1px solid ${conn.color}30` }}>
                        <Laptop size={16} style={{ color: conn.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-[var(--text-primary)] truncate text-sm">{conn.name}</h3>
                        <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{conn.host}</p>
                      </div>
                    </div>
                  </div>
                ))}
                
                {sshConnections.length === 0 && (
                  <div className="col-span-full py-16 text-center rounded-2xl border border-dashed border-[var(--border-color)]">
                    <p className="text-xs text-[var(--text-muted)] opacity-60">No SSH connections available.</p>
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    );
  }

  // 2. DASHBOARD OR TERMINAL TAB SCREEN
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
        {/* App Tab Bar */}
        <div className="flex items-center justify-between bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-4 h-12 shrink-0">
          <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${selectedConnection.color}20`, color: selectedConnection.color }}>
                      <Box size={14} />
                  </div>
                  <span className="text-sm font-bold">{selectedConnection.name}</span>
                  <span className="text-xs text-[var(--text-muted)] font-mono hidden md:inline ml-2">{selectedConnection.host}</span>
              </div>
              
              <div className="h-4 w-px bg-[var(--border-color)] mx-2"></div>
              
              <button 
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}
              >
                  <Layers size={14} />
                  Containers
              </button>
          </div>
          
          <div className="flex items-center gap-2">
              <button onClick={() => setSelectedConnection(null)} className="text-xs px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  Change Server
              </button>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="flex-1 relative overflow-hidden bg-[var(--bg-primary)]">
            
            {/* Dashboard View */}
            <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none', height: '100%' }}>
                <div className="p-6 h-full overflow-y-auto">
                    
                    {!isDockerInstalled ? (
                        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-rose-500/30 bg-rose-500/5 mt-4">
                            <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mb-4">
                                <AlertTriangle size={24} className="text-rose-400" />
                            </div>
                            <h3 className="font-bold text-[var(--text-primary)] mb-2">Docker Unavailable</h3>
                            <p className="text-sm text-[var(--text-muted)] max-w-md">
                                Docker is either not installed or you don't have permissions to run the 'docker' command. Ensure Docker is installed and the user is in the 'docker' group, or use sudo.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h2 className="text-xl font-bold flex items-center gap-2">
                                        Docker Containers
                                        {isLoading && <RefreshCw size={14} className="animate-spin text-[var(--text-muted)] ml-2" />}
                                    </h2>
                                </div>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={fetchContainers}
                                        className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-white/5 hover:bg-white/10 flex items-center gap-2 text-xs font-semibold transition-all"
                                    >
                                        <RefreshCw size={12} />
                                        Refresh
                                    </button>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                {containers.map(container => (
                                    <div 
                                        key={container.id} 
                                        className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 flex flex-col gap-4 group transition-all hover:border-sky-500/30 shadow-sm"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-3 h-3 rounded-full ${container.state === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-rose-400/50'}`} />
                                                <h3 className="font-bold text-[var(--text-primary)] tracking-wide">{container.name}</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${container.state === 'running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                                    {container.state}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col gap-2 bg-black/30 p-3 rounded-lg border border-white/5 overflow-hidden">
                                            <div className="flex items-center justify-between text-[11px] font-mono">
                                                <span className="text-sky-400">Image</span>
                                                <span className="text-white/80 bg-white/5 px-1.5 py-0.5 rounded truncate max-w-[200px]" title={container.image}>{container.image}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] font-mono">
                                                <span className="text-white/30">Status</span>
                                                <span className="text-white/60 truncate" title={container.status}>{container.status}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] font-mono">
                                                <span className="text-white/30">Ports</span>
                                                <span className="text-white/60 truncate max-w-[200px]" title={container.ports}>{container.ports || 'None'}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] font-mono border-t border-white/5 pt-1.5 mt-0.5">
                                                <span className="text-white/30">Container ID</span>
                                                <span className="text-white/40">{container.id}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2 mt-auto pt-2">
                                            {container.state === 'running' ? (
                                                <button 
                                                    onClick={() => handleContainerAction(container.id, 'stop')}
                                                    className="flex-1 py-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5"
                                                >
                                                    <Square size={12} /> Stop
                                                </button>
                                            ) : (
                                                <button 
                                                    onClick={() => handleContainerAction(container.id, 'start')}
                                                    className="flex-1 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5"
                                                >
                                                    <Play size={12} /> Start
                                                </button>
                                            )}
                                            
                                            <button 
                                                onClick={() => handleContainerAction(container.id, 'restart')}
                                                className="flex-1 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-white/5 text-[var(--text-secondary)] text-xs font-bold transition-all flex justify-center items-center gap-1.5"
                                            >
                                                <RefreshCw size={12} /> Restart
                                            </button>
                                            
                                            <button 
                                                onClick={() => browseContainer(container.id, container.name)}
                                                disabled={container.state !== 'running'}
                                                className="flex-1 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5 disabled:opacity-30 disabled:hover:bg-indigo-500/10"
                                            >
                                                <Folder size={12} /> Files
                                            </button>
                                            
                                            <button 
                                                onClick={() => attachToContainer(container.id, container.name)}
                                                disabled={container.state !== 'running'}
                                                className="flex-1 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5 disabled:opacity-30 disabled:hover:bg-sky-500/10"
                                            >
                                                <TermIcon size={12} /> Exec
                                            </button>
                                            
                                            <button 
                                                onClick={() => {
                                                    showConfirm(
                                                        `Are you sure you want to completely remove container '${container.name}'?`,
                                                        () => handleContainerAction(container.id, 'rm'),
                                                        'Remove Container',
                                                        'Remove',
                                                        'Cancel'
                                                    );
                                                }}
                                                className="w-8 flex-shrink-0 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-red-400 transition-all flex justify-center items-center"
                                                title="Remove Container"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            {!isLoading && containers.length === 0 && (
                                <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-[var(--border-color)] bg-black/10 mt-4">
                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                                        <Box size={24} className="text-[var(--text-muted)]" />
                                    </div>
                                    <h3 className="font-bold text-[var(--text-primary)] mb-2">No containers found</h3>
                                    <p className="text-sm text-[var(--text-muted)] max-w-sm">
                                        There are no docker containers on this server, or the command could not be executed.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
}
