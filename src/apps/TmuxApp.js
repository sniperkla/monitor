'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Laptop, Terminal as TermIcon, Play, Square, Settings, RefreshCw, Layers, List, MonitorPlay, History, ExternalLink, Zap } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import TerminalView from '@/components/TerminalView';
import { io } from 'socket.io-client';

export default function TmuxApp({ initialConnection }) {
  const { state, dispatch } = useApp();
  const { showConfirm } = useOS();
  const { t } = useTranslation();
  
  // App state
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, terminal
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [newSessionPrompt, setNewSessionPrompt] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [tmuxDetected, setTmuxDetected] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  
  // Connection selection
  const { connections, dbConfig } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');
  const [selectedConnection, setSelectedConnection] = useState(initialConnection || null);

  // Hidden terminal socket just for running tmux commands in the background
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
    const SENTINEL_START = '---TMUX_LS_START---';
    const SENTINEL_END   = '---TMUX_LS_END---';
    const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '');

    const emitLs = () => {
      if (socketRef.current) {
        // robustly handle format strings by writing to a tmp file first
        const formatString = '#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}|#{?pane_current_command,#{pane_current_command},bash}';
        const setupEcho = `echo "${formatString}" > /tmp/.web_tmux_fmt && echo "${SENTINEL_START}" && tmux list-sessions -F "$(cat /tmp/.web_tmux_fmt)" 2>/dev/null; echo "${SENTINEL_END}"\r`;
        socketRef.current.emit('ssh:input', setupEcho);
      }
    };

    socketRef.current.on('connect', () => {
      socketRef.current.emit('ssh:connect', {
        connectionId: selectedConnection._id,
        connection: selectedConnection,
      });
    });

    socketRef.current.on('ssh:connected', () => {
      setTimeout(() => {
        if (!socketRef.current) return;
        const installCheck = `if ! command -v tmux &>/dev/null; then if command -v apt-get &>/dev/null; then sudo apt-get update && sudo apt-get install -y tmux -qq; elif command -v yum &>/dev/null; then sudo yum install -y tmux -q; elif command -v apk &>/dev/null; then sudo apk add tmux -q; fi; fi`;
        const formatString = '#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}|#{?pane_current_command,#{pane_current_command},bash}';
        const setupEcho = `${installCheck}; echo "${formatString}" > /tmp/.web_tmux_fmt && echo "${SENTINEL_START}" && tmux list-sessions -F "$(cat /tmp/.web_tmux_fmt)" 2>/dev/null; echo "${SENTINEL_END}"\r`;
        socketRef.current.emit('ssh:input', setupEcho);
      }, 500);
    });

    // Robust parser: extract content between our sentinels, strip ANSI, parse tmux ls lines
    const parseTmuxOutput = (raw) => {
      const clean = stripAnsi(raw);
      const si = clean.indexOf(SENTINEL_START);
      const ei = clean.indexOf(SENTINEL_END, si);
      if (si === -1 || ei === -1) return null; // not complete yet
      const block = clean.slice(si + SENTINEL_START.length, ei);
      const parsed = [];
      const lines = block.split('\n').filter(l => l.trim() && l.includes('|'));
      
      for (const line of lines) {
        const [name, windows, attached, activity, command] = line.trim().split('|');
        if (name) {
          parsed.push({ 
            name: name.trim(), 
            windows: windows || '1', 
            attached: attached === '1', 
            activity: parseInt(activity) || Date.now() / 1000,
            command: command || 'bash',
            raw: line 
          });
        }
      }
      return parsed;
    };
    
    socketRef.current.on('ssh:data', (data) => {
      stdoutBuffer += data;
      
      // Check for 'tmux not found' or similar in the whole stream if we haven't confirmed detection yet
      if (stripAnsi(data).includes('tmux: command not found') || stripAnsi(data).includes('not found: tmux')) {
          setTmuxDetected(false);
      } else if (stripAnsi(data).includes(SENTINEL_START)) {
          setTmuxDetected(true);
      }

      const result = parseTmuxOutput(stdoutBuffer);
      if (result !== null) {
        setSessions(result);
        setIsLoading(false);
        setTmuxDetected(true);
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

  const TMUX_SENTINEL_START = '---TMUX_LS_START---';
  const TMUX_SENTINEL_END   = '---TMUX_LS_END---';

  const emitTmuxLs = () => {
    if (!socketRef.current) return;
    const formatString = '#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}|#{?pane_current_command,#{pane_current_command},bash}';
    const setupEcho = `echo "${formatString}" > /tmp/.web_tmux_fmt && echo "${TMUX_SENTINEL_START}" && tmux list-sessions -F "$(cat /tmp/.web_tmux_fmt)" 2>/dev/null; echo "${TMUX_SENTINEL_END}"\r`;
    socketRef.current.emit('ssh:input', setupEcho);
  };

  // Handle re-fetching sessions
  const fetchSessions = () => {
    if (socketRef.current) {
      setIsLoading(true);
      emitTmuxLs();
      setTimeout(() => setIsLoading(false), 4000); // safety fallback
    }
  };

  const handleCreateSession = (name) => {
    if (!socketRef.current) return;
    const safeName = (name || `session-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || `session-${Date.now()}`;
    socketRef.current.emit('ssh:input', `tmux new-session -d -s "${safeName}"\r`);
    setIsLoading(true);
    setTimeout(() => emitTmuxLs(), 1200);
  };

  const handleKillSession = (name) => {
    if (!socketRef.current) return;
    setIsLoading(true);
    socketRef.current.emit('ssh:input', `tmux kill-session -t "${name}"\r`);
    setTimeout(() => emitTmuxLs(), 1200);
  };

  const fixScrolling = () => {
    if (!socketRef.current) return;
    setIsLoading(true);
    // Add to config AND apply immediately to the current server session
    const cmd = `echo "set -g mouse on" >> ~/.tmux.conf; tmux source-file ~/.tmux.conf 2>/dev/null; tmux set-option -g mouse on\r`;
    socketRef.current.emit('ssh:input', cmd);
    setTimeout(() => {
        setIsLoading(false);
        alert("Tmux Mouse Mode enabled. You can now use your mouse wheel to scroll!");
    }, 1000);
  };

  const handleInstallTmux = () => {
    if (!socketRef.current) return;
    setIsInstalling(true);
    const cmd = `if command -v apt-get &>/dev/null; then sudo apt-get update && sudo apt-get install -y tmux; elif command -v yum &>/dev/null; then sudo yum install -y tmux; elif command -v apk &>/dev/null; then sudo apk add tmux; fi\r`;
    socketRef.current.emit('ssh:input', cmd);
    setTimeout(() => {
        setIsInstalling(false);
        fetchSessions();
    }, 10000);
  };

  const attachToSession = (sessionName) => {
    setActiveSession(sessionName);
    setActiveTab('terminal');
  };

  useEffect(() => {
    const handleClosePreview = (e) => {
      if (e.detail?.session === activeSession) {
        setActiveTab('dashboard');
        setActiveSession(null);
      }
    };
    window.addEventListener('close-tmux-manager-preview', handleClosePreview);
    return () => window.removeEventListener('close-tmux-manager-preview', handleClosePreview);
  }, [activeSession]);

  // 1. SELECT CONNECTION SCREEN
  if (!selectedConnection) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
        <div className="flex-1 overflow-y-auto z-20">
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <MonitorPlay size={22} className="text-blue-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Tmux Dashboard</h1>
                  <p className="text-[var(--text-secondary)] text-sm font-mono">$ select a server to manage tmux sessions</p>
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
                      <MonitorPlay size={14} />
                  </div>
                  <span className="text-sm font-bold">{selectedConnection.name}</span>
                  <span className="text-xs text-[var(--text-muted)] font-mono hidden md:inline ml-2">{selectedConnection.host}</span>
              </div>
              
              <div className="h-4 w-px bg-[var(--border-color)] mx-2"></div>
              
              <button 
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}
              >
                  <Layers size={14} />
                  Dashboard
              </button>
              
              <div
                  draggable={!!activeSession}
                  onDragStart={(e) => {
                    if (activeSession) {
                      e.dataTransfer.setData('application/ssh-connection', JSON.stringify(selectedConnection));
                      e.dataTransfer.setData('application/terminal-command', `tmux attach -t ${activeSession}\r`);
                      e.dataTransfer.setData('application/source-app-type', 'tmux');
                      e.dataTransfer.setData('application/tmux-session', activeSession);
                      // Signal that this is a pop-out
                      const ghost = document.createElement('div');
                      ghost.style.cssText = `background:${selectedConnection.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;border-radius:8px;padding:6px 14px;color:white;font-size:11px;font-weight:700;`;
                      ghost.textContent = `🐚 Session: ${activeSession}`;
                      document.body.appendChild(ghost);
                      e.dataTransfer.setDragImage(ghost, 0, 0);
                      setTimeout(() => document.body.removeChild(ghost), 0);
                    }
                  }}
                  onDragEnd={(e) => {
                    if (e.dataTransfer.dropEffect !== 'none' || e.dataTransfer.dropEffect === 'copy') {
                      setActiveTab('dashboard');
                      setActiveSession(null);
                    }
                  }}
                  className="flex items-center"
              >
                  <button 
                      onClick={() => setActiveTab('terminal')}
                      disabled={!activeSession}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'terminal' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-30'}`}
                  >
                      <TermIcon size={14} />
                      Terminal {activeSession ? `(${activeSession})` : ''}
                  </button>
                  {activeSession && activeTab === 'terminal' && (
                      <button 
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('pop-out-terminal', {
                            detail: { 
                              connection: selectedConnection,
                              initialCommand: `tmux attach -t ${activeSession}\r`
                            }
                          }));
                          setActiveTab('dashboard');
                          setActiveSession(null);
                        }}
                        className="ml-1 p-1 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
                        title="Pop out to separate window"
                      >
                        <ExternalLink size={12} />
                      </button>
                  )}
              </div>
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
                    
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                Tmux Sessions
                                {isLoading && <RefreshCw size={14} className="animate-spin text-[var(--text-muted)] ml-2" />}
                            </h2>
                            <p className="text-sm text-[var(--text-muted)]">View and manage background terminal sessions</p>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={fixScrolling}
                                className="px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 flex items-center gap-2 text-xs font-semibold transition-all"
                                title="Enable mouse support for scrolling & window selection"
                            >
                                <Zap size={12} />
                                Fix Scroll
                            </button>
                            <button 
                                onClick={fetchSessions}
                                className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-white/5 hover:bg-white/10 flex items-center gap-2 text-xs font-semibold transition-all"
                            >
                                <RefreshCw size={12} />
                                Refresh
                            </button>
                            <button 
                                onClick={() => { setNewSessionName(''); setNewSessionPrompt(true); }}
                                className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 flex items-center gap-2 text-xs font-semibold transition-all"
                            >
                                <Play size={12} />
                                New Session
                            </button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Session Cards */}
                        {sessions.map(session => (
                            <div 
                                key={session.name} 
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('application/ssh-connection', JSON.stringify(selectedConnection));
                                    e.dataTransfer.setData('application/terminal-command', `tmux attach -t ${session.name}\r`);
                                    e.dataTransfer.setData('application/source-app-type', 'tmux');
                                    e.dataTransfer.setData('application/tmux-session', session.name);
                                    const ghost = document.createElement('div');
                                    ghost.style.cssText = `background:${selectedConnection.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;border-radius:8px;padding:6px 14px;color:white;font-size:11px;font-weight:700;`;
                                    ghost.textContent = `🐚 Session: ${session.name}`;
                                    document.body.appendChild(ghost);
                                    e.dataTransfer.setDragImage(ghost, 0, 0);
                                    setTimeout(() => document.body.removeChild(ghost), 0);
                                }}
                                onDragEnd={(e) => {
                                    if (e.dataTransfer.dropEffect !== 'none' || e.dataTransfer.dropEffect === 'copy') {
                                        setTimeout(() => emitTmuxLs(), 1500); 
                                    }
                                }}
                                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 flex flex-col gap-4 group transition-all hover:border-blue-500/30 shadow-sm cursor-grab active:cursor-grabbing hover:bg-white/5"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2.5 h-2.5 rounded-full ${session.name.startsWith('ai-') ? 'bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : 'bg-blue-400'}`} />
                                        <h3 className="font-bold text-[var(--text-primary)] tracking-wide">{session.name}</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {session.attached && (
                                            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/30">
                                                Attached
                                            </span>
                                        )}
                                        {session.name.startsWith('ai-') && (
                                            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                                                AI Agent
                                            </span>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="flex flex-col gap-2 bg-black/30 p-3 rounded-lg border border-white/5">
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-1.5 text-blue-400">
                                            <Play size={10} />
                                            <span>Active Process</span>
                                        </div>
                                        <span className="text-white/80 bg-white/5 px-1.5 py-0.5 rounded italic">{session.command}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-1.5 text-white/30">
                                            <Layers size={10} />
                                            <span>Structure</span>
                                        </div>
                                        <span className="text-white/40">{session.windows} windows</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono border-t border-white/5 pt-1.5 mt-0.5">
                                        <div className="flex items-center gap-1.5 text-white/30">
                                            <History size={10} />
                                            <span>Last Act</span>
                                        </div>
                                        <span className="text-white/40">
                                            {Math.floor((Date.now() / 1000 - session.activity) / 60)}m ago
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2 mt-auto pt-2 grid grid-cols-2">
                                    <button 
                                        onClick={() => attachToSession(session.name)}
                                        className="col-span-1 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5"
                                    >
                                        <TermIcon size={12} />
                                        Attach
                                    </button>
                                    <button 
                                        onClick={() => {
                                            showConfirm(
                                                `Are you sure you want to kill tmux session '${session.name}'?`,
                                                () => handleKillSession(session.name),
                                                'Kill Session',
                                                'Kill',
                                                'Cancel'
                                            );
                                        }}
                                        className="col-span-1 py-2 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-all flex justify-center items-center gap-1.5 opacity-0 group-hover:opacity-100"
                                    >
                                        <Square size={12} />
                                        Kill
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    {!isLoading && sessions.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-[var(--border-color)] bg-black/10 mt-4">
                            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                                {tmuxDetected ? (
                                    <History size={24} className="text-[var(--text-muted)]" />
                                ) : (
                                    <Zap size={24} className="text-amber-500 animate-pulse" />
                                )}
                            </div>
                            <h3 className="font-bold text-[var(--text-primary)] mb-2">
                                {tmuxDetected ? 'No active sessions' : 'Tmux not installed'}
                            </h3>
                            <p className="text-sm text-[var(--text-muted)] max-w-sm">
                                {tmuxDetected 
                                    ? 'There are no active tmux sessions on this server. Sessions created by the AI agent or manually will appear here.'
                                    : 'Your server is missing the tmux package. You need to install it to take advantage of background tasks and persistent sessions.'
                                }
                            </p>
                            
                            {tmuxDetected ? (
                                <button 
                                    onClick={() => { setNewSessionName(''); setNewSessionPrompt(true); }}
                                    className="mt-6 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all"
                                >
                                    Create Session
                                </button>
                            ) : (
                                <button 
                                    onClick={handleInstallTmux}
                                    disabled={isInstalling}
                                    className="mt-6 px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                                >
                                    {isInstalling ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                                    {isInstalling ? 'Installing Tmux...' : 'Install Tmux Now'}
                                </button>
                            )}
                        </div>
                    )}

                    {/* New Session Name Prompt */}
                    {newSessionPrompt && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setNewSessionPrompt(false)}>
                            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
                                <h3 className="font-bold text-[var(--text-primary)] mb-1">New Tmux Session</h3>
                                <p className="text-xs text-[var(--text-muted)] mb-4">Enter a name for the new session (letters, numbers, hyphens)</p>
                                <input
                                    autoFocus
                                    value={newSessionName}
                                    onChange={e => setNewSessionName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && newSessionName.trim()) {
                                            handleCreateSession(newSessionName.trim());
                                            setNewSessionPrompt(false);
                                        } else if (e.key === 'Escape') {
                                            setNewSessionPrompt(false);
                                        }
                                    }}
                                    placeholder="my-session"
                                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 mb-4"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setNewSessionPrompt(false)}
                                        className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-muted)] hover:bg-white/5 transition-colors"
                                    >Cancel</button>
                                    <button
                                        onClick={() => {
                                            if (newSessionName.trim()) {
                                                handleCreateSession(newSessionName.trim());
                                                setNewSessionPrompt(false);
                                            }
                                        }}
                                        disabled={!newSessionName.trim()}
                                        className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs transition-colors"
                                    >Create</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Terminal View */}
            <div style={{ display: activeTab === 'terminal' ? 'block' : 'none', height: '100%' }}>
                {activeSession && (
                    <TerminalView 
                      connectionId={selectedConnection._id}
                      connectionName={`${selectedConnection.name} [${activeSession}]`}
                      host={selectedConnection.host}
                      color={selectedConnection.color}
                      connection={selectedConnection}
                      onClose={() => setActiveTab('dashboard')}
                      // We inject an initial command to automatically attach to the target session when it opens
                      initialCommand={`tmux attach -t ${activeSession}\r`}
                    />
                )}
            </div>
        </div>
    </div>
  );
}
