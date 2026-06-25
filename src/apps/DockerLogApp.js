'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { FileText, RefreshCw, X, AlertTriangle, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { io } from 'socket.io-client';

export default function DockerLogApp({ initialConnection, initialConnectionId, initialContainerId, initialContainerName, windowId }) {
  const { state } = useApp();
  const { addNotification, dispatch: osDispatch } = useOS();
  const { connections, dbConfig } = state;
  
  const [selectedConnection, setSelectedConnection] = useState(initialConnection || null);
  const [containerId, setContainerId] = useState(initialContainerId || null);
  const [containerName, setContainerName] = useState(initialContainerName || '');
  const [logs, setLogs] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  // Restore state from localStorage if refreshed
  useEffect(() => {
    if (windowId && !selectedConnection) {
      const saved = localStorage.getItem(`docker-log-state-${windowId}`);
      if (saved) {
        try {
          const { connId, contId, contName } = JSON.parse(saved);
          const conn = connections.find(c => c._id === connId);
          if (conn) {
            setSelectedConnection(conn);
            setContainerId(contId);
            setContainerName(contName);
          }
        } catch (e) {
          console.error("Failed to restore docker log state", e);
        }
      }
    }
    
    // Fallback to connection ID prop
    if (initialConnectionId && !selectedConnection) {
        const conn = connections.find(c => c._id === initialConnectionId);
        if (conn) setSelectedConnection(conn);
    }
  }, [connections, initialConnectionId, windowId, selectedConnection]);

  // Persist state
  useEffect(() => {
    if (windowId && selectedConnection && containerId) {
      localStorage.setItem(`docker-log-state-${windowId}`, JSON.stringify({
        connId: selectedConnection._id,
        contId: containerId,
        contName: containerName
      }));
    }
  }, [windowId, selectedConnection, containerId, containerName]);

  // Set window title
  useEffect(() => {
    if (windowId && containerName) {
      osDispatch({
        type: 'SET_WINDOW_TITLE',
        payload: { id: windowId, title: `Logs: ${containerName}` }
      });
    }
  }, [windowId, containerName, osDispatch]);

  const fetchLogs = () => {
    if (!socketRef.current || !containerId) return;
    setIsLoading(true);
    socketRef.current.emit('docker:command', { action: 'logs', args: [containerId] });
  };

  useEffect(() => {
    if (!selectedConnection || !containerId) return;

    socketRef.current = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      query: { dbUri: dbConfig?.uri || '' }
    });

    socketRef.current.on('connect', () => {
      socketRef.current.emit('ssh:connect', {
        connectionId: selectedConnection._id,
        connection: selectedConnection,
        preferredRelay: typeof window !== 'undefined' ? (localStorage.getItem('ssh_monitor_preferred_relay') || undefined) : undefined,
      });
    });

    socketRef.current.on('ssh:connected', () => {
      fetchLogs();
    });

    socketRef.current.on('docker:result', ({ action, output }) => {
      if (action === 'logs') {
        setIsLoading(false);
        setLogs(output || 'No logs found.');
      }
    });

    socketRef.current.on('docker:error', (err) => {
      setIsLoading(false);
      setError(err);
      addNotification({ title: 'Docker Error', message: err, type: 'error' });
    });

    socketRef.current.on('ssh:error', (err) => {
      setIsLoading(false);
      setError(err?.message || 'Connection failed');
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [selectedConnection, containerId]);

  // Auto scroll to bottom when logs arrive
  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const [searchQuery, setSearchQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Update match count when logs or query change
  useEffect(() => {
    if (!logs || !searchQuery) {
      setMatchCount(0);
      setActiveMatchIndex(0);
      return;
    }
    const regex = new RegExp(searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    const matches = logs.match(regex);
    setMatchCount(matches ? matches.length : 0);
    setActiveMatchIndex(prev => matches && prev >= matches.length ? 0 : prev);
  }, [logs, searchQuery]);

  // Scroll to active match
  useEffect(() => {
    if (matchCount > 0) {
        const activeMark = document.querySelector(`[data-match-index="${activeMatchIndex}"]`);
        if (activeMark) {
            activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
  }, [activeMatchIndex, matchCount]);

  const goToNextMatch = () => {
    if (matchCount === 0) return;
    setActiveMatchIndex((prev) => (prev + 1) % matchCount);
  };

  const goToPrevMatch = () => {
    if (matchCount === 0) return;
    setActiveMatchIndex((prev) => (prev - 1 + matchCount) % matchCount);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            goToPrevMatch();
        } else {
            goToNextMatch();
        }
    }
  };

  // Function to highlight search matches
  const renderLogs = () => {
    if (!logs) return null;
    if (!searchQuery) return <pre className="whitespace-pre-wrap break-all">{logs}</pre>;

    const parts = logs.split(new RegExp(`(${searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
    let matchCounter = -1;
    
    const content = parts.map((part, i) => {
        if (part.toLowerCase() === searchQuery.toLowerCase()) {
            matchCounter++;
            const isActive = matchCounter === activeMatchIndex;
            return (
                <mark 
                    key={i} 
                    data-match-index={matchCounter}
                    className={`rounded-sm px-0.5 border transition-all duration-200 ${
                        isActive 
                        ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)] z-10 relative scale-110' 
                        : 'bg-yellow-500/30 text-white border-yellow-500/20'
                    }`}
                >
                    {part}
                </mark>
            );
        }
        return part;
    });

    return <pre className="whitespace-pre-wrap break-all">{content}</pre>;
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-300 overflow-hidden font-mono text-xs">
        {/* Header toolbar */}
        <div className="flex items-center justify-between px-4 h-10 border-b border-white/5 bg-white/5 shrink-0">
            <div className="flex items-center gap-2 truncate pr-4">
                <FileText size={14} className="text-emerald-400" />
                <span className="font-bold text-gray-200 truncate">{containerName || 'Docker Logs'}</span>
                <span className="text-[10px] text-gray-400 opacity-60 pr-2">{containerId?.substring(0, 12)}</span>
            </div>
            
            <div className="flex items-center gap-4">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
                  {typeof window !== 'undefined' && localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ? '⚡ Local' : '☁ Server'}
                </span>
                {/* Find Bar */}
                <div className="relative group flex items-center">
                    <div className="absolute left-2.5 text-white/20">
                        <Search size={12} />
                    </div>
                    <input 
                        type="text"
                        placeholder="Find in logs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="bg-black/40 text-white border border-white/10 rounded-lg pl-8 pr-24 py-1.5 text-[11px] w-48 focus:w-72 focus:border-emerald-500/50 focus:outline-none transition-all placeholder:text-white/30"
                    />
                    {searchQuery && (
                        <div className="absolute right-1.5 flex items-center gap-1">
                            <span className="text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 min-w-[50px] text-center">
                                {matchCount > 0 ? activeMatchIndex + 1 : 0} / {matchCount}
                            </span>
                            <div className="flex flex-col -gap-1">
                                <button onClick={goToPrevMatch} className="p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
                                    <ChevronUp size={10} />
                                </button>
                                <button onClick={goToNextMatch} className="p-0.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
                                    <ChevronDown size={10} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="w-[1px] h-4 bg-white/10 mx-1" />

                <button 
                    onClick={fetchLogs}
                    disabled={isLoading}
                    className="p-1.5 hover:bg-white/10 rounded-lg text-emerald-400 transition-colors disabled:opacity-50"
                    title="Refresh Logs"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>
        </div>

        {/* Logs viewport */}
        <div 
            ref={scrollRef}
            className="flex-1 overflow-auto p-4 leading-relaxed custom-scrollbar selection:bg-emerald-500/30"
        >
            {error ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-red-400/60 p-8 text-center">
                    <AlertTriangle size={32} />
                    <div className="space-y-1">
                        <p className="font-bold text-red-400">Connection Error</p>
                        <p className="text-[10px] max-w-xs mx-auto">{error}</p>
                    </div>
                    <button 
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-xs font-bold transition-all"
                    >
                        Retry Reconnection
                    </button>
                </div>
            ) : logs ? (
                renderLogs()
            ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
                    <RefreshCw size={24} className="animate-spin text-emerald-400" />
                    <p className="animate-pulse">Attaching to container stream...</p>
                </div>
            )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-1.5 border-t border-white/5 bg-black/20 flex justify-between items-center text-[9px] text-white/50 uppercase tracking-widest shrink-0">
            <div className="flex items-center gap-4">
                <span>Tail: 200 lines</span>
                <span>Buffer: {((logs?.length || 0)/1024).toFixed(1)} KB</span>
            </div>
            <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-500/20'}`} />
                <span>{isLoading ? 'Streaming' : 'Idle'}</span>
            </div>
        </div>
    </div>
  );
}
