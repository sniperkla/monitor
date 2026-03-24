'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { 
  Laptop, Terminal as TermIcon, Play, Square, RefreshCw, Box, Layers, 
  ExternalLink, AlertTriangle, Trash2, Folder, FileText, Star, Archive,
  Download, Search, X, RotateCcw, Cpu, HardDrive, Clock, Activity,
  ChevronDown, ChevronRight, Zap, Globe, Package, Shield, Plus, Share2,
  Upload, Eye, EyeOff, Settings, CircleCheck, CircleAlert
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import DockerLogApp from '@/apps/DockerLogApp';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import ConfigEditorModal from '@/components/ConfigEditorModal';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';


const commonTags = ['latest', 'alpine', 'slim', 'edge', 'dev'];
function getPresetsForImage(imageName) {
  if (!imageName) return { ports: '', volumes: '', env: '' };
  const img = imageName.toLowerCase();
  let presets = { ports: '', volumes: '', env: '' };

  if (img.includes('nginx')) {
    presets.ports = '80:80';
    presets.volumes = '/var/www/html:/usr/share/nginx/html';
  } else if (img.includes('redis')) {
    presets.ports = '6379:6379';
  } else if (img.includes('postgres')) {
    presets.ports = '5432:5432';
    presets.volumes = 'pgdata:/var/lib/postgresql/data';
  } else if (img.includes('mysql')) {
    presets.ports = '3306:3306';
    presets.volumes = 'mysql_data:/var/lib/mysql';
  } else if (img.includes('node')) {
    presets.ports = '3000:3000';
  } else if (img.includes('mongo')) {
    presets.ports = '27017:27017';
    presets.env = 'MONGO_INITDB_ROOT_USERNAME=root,MONGO_INITDB_ROOT_PASSWORD=password123';
    presets.volumes = 'mongo_data:/data/db';
  }
  return presets;
}

// ── Utility & Sub-components ──────────────────
function formatUptime(status) {
  if (!status) return '';
  const m = status.match(/Up\s+(.+)/i);
  return m ? m[1] : status;
}

function StatCard({ icon: Icon, label, value, color = 'sky', sub }) {
  const colors = {
    sky: 'bg-sky-500/5 border-sky-500/15 text-sky-400',
    emerald: 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400',
    rose: 'bg-rose-500/5 border-rose-500/15 text-rose-400',
    amber: 'bg-amber-500/5 border-amber-500/15 text-amber-400',
    violet: 'bg-violet-500/5 border-violet-500/15 text-violet-400',
  };
  return (
    <div className={`flex-1 min-w-[120px] border rounded-xl p-3 flex items-center gap-3 ${colors[color]}`}>
      <div className="opacity-60"><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-[9px] opacity-50">{sub}</p>}
      </div>
    </div>
  );
}

function PullingFloater({ pullingTasks }) {
  const entries = Object.entries(pullingTasks);
  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm" style={{ pointerEvents: 'auto' }}>
      {entries.map(([name, task]) => (
        <div 
          key={name} 
          className="bg-[#1a1f2e]/95 backdrop-blur-xl border border-sky-500/20 rounded-2xl p-4 shadow-2xl shadow-sky-500/5 animate-[slideUp_0.3s_ease-out]"
        >
          <div className="flex justify-between items-center mb-2">
            <div className="min-w-0 mr-3">
              <div className="flex items-center gap-2">
                <Download size={12} className="text-sky-400 animate-bounce" />
                <h4 className="text-xs font-bold truncate text-white">{name}</h4>
              </div>
              <p className="text-[10px] text-sky-400/70 font-mono italic truncate mt-0.5">{task.lastLine}</p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-lg font-bold text-sky-400 tabular-nums">{task.progress}%</span>
              <p className="text-[9px] text-sky-400/60">{task.status}</p>
            </div>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ 
                width: `${task.progress}%`,
                backgroundImage: task.progress >= 100 
                  ? 'linear-gradient(90deg, #10b981, #34d399)' 
                  : 'linear-gradient(90deg, #0ea5e9, #38bdf8, #0ea5e9)',
                backgroundSize: '200% 100%',
                animation: task.progress < 100 ? 'shimmer 2s ease-in-out infinite' : 'none'
              }} 
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ImageComboBox({ value, onChange, options }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Show suggestions if typed or explicitly opened
  const filtered = options.filter(o => o.toLowerCase().includes((value || '').toLowerCase()));
  const showDropdown = isOpen && filtered.length > 0;

  return (
    <div className="relative" onBlur={() => setTimeout(() => { setIsOpen(false); setIsFocused(false); }, 150)}>
      <div className="relative flex items-center">
        <input 
          type="text"
          required
          autoFocus={!value} // Only autoFocus if empty
          autoComplete="off"
          value={value || ''}
          onFocus={() => setIsFocused(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          placeholder="e.g. nginx:latest, node:alpine..."
          className="w-full bg-black/20 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
        />
        <div 
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] cursor-pointer hover:text-white transition-colors p-1"
          onClick={() => {
            setIsOpen((prev) => !prev);
            setIsFocused(true);
          }}
        >
          <ChevronDown size={14} className={`transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
        </div>
      </div>
      
      {showDropdown && (
        <div className="absolute z-[70000] left-0 right-0 top-[calc(100%+4px)] max-h-[160px] overflow-y-auto custom-scrollbar bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-2xl backdrop-blur-xl">
          {filtered.map(opt => (
            <div 
              key={opt}
              className="px-3 py-2 text-sm font-mono text-[var(--text-primary)] hover:bg-emerald-500/20 cursor-pointer transition-colors border-b border-white/[0.02] last:border-0"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur
                onChange(opt);
                setIsOpen(false);
                setIsFocused(false);
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



// ── Main Component ────────────────────────────
export default function DockerApp({ initialConnection, initialConnectionId, windowId }) {
  const { state } = useApp();
  const { showConfirm, showPrompt, addNotification, openWindow, dispatch: osDispatch } = useOS();
  const { t } = useTranslation();
  
  // App state
  const [portStatus, setPortStatus] = useState(null); // 'checking', 'free', 'in-use', null
  const [activeTab, setActiveTab] = useState('containers');
  const [containers, setContainers] = useState([]);
  const [images, setImages] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [pullingTasks, setPullingTasks] = useState({});
  const [createModal, setCreateModal] = useState({ isOpen: false, image: '', name: '', ports: '', env: '', volumes: '', isManual: true });
  const [configEditor, setConfigEditor] = useState({ isOpen: false, file: '', content: '', containerId: '', containerName: '' });
  const [pruneVolumesModal, setPruneVolumesModal] = useState({ isOpen: false, confirmText: '' });
  const [selectedVolumes, setSelectedVolumes] = useState([]);

  const [pendingActions, setPendingActions] = useState({}); // { id: actionName }




  const pullingTasksRef = useRef({});

  // Export / Import state
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [showExportPw, setShowExportPw] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [showImportPw, setShowImportPw] = useState(false);
  const [importData, setImportData] = useState(null); 
  const importFileRef = useRef(null);

  useEffect(() => {
    pullingTasksRef.current = pullingTasks;
  }, [pullingTasks]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isDockerInstalled, setIsDockerInstalled] = useState(true);
  const [expandedContainer, setExpandedContainer] = useState(null);
  const [containerFilter, setContainerFilter] = useState('all'); // all, running, stopped
  
  // Connection selection
  const { connections, dbConfig } = state;
  const sshConnections = connections.filter(c => c.type !== 'database');
  const [selectedConnection, setSelectedConnection] = useState(initialConnection || null);

  const initialConnIdRef = useRef(initialConnectionId);

  // Update window title
  useEffect(() => {
    if (selectedConnection && windowId) {
       osDispatch({ 
         type: 'SET_WINDOW_TITLE', 
         payload: { id: windowId, title: `Docker: ${selectedConnection.name}` } 
       });
    }
  }, [selectedConnection, windowId, osDispatch]);

  // Restore connection state
  useEffect(() => {
    if (selectedConnection) return;
    if (!connections || connections.length === 0) return;
    if (initialConnectionId) {
      const conn = connections.find(c => c._id === initialConnectionId);
      if (conn) { setSelectedConnection(conn); return; }
    }
    if (windowId) {
      const savedConnId = localStorage.getItem(`docker-connection-${windowId}`);
      if (savedConnId) {
        const conn = connections.find(c => c._id === savedConnId);
        if (conn) setSelectedConnection(conn);
      }
    }
  }, [connections, initialConnectionId, windowId, selectedConnection]);

  // Restore active tab state
  useEffect(() => {
    if (windowId) {
      const savedTab = localStorage.getItem(`docker-tab-${windowId}`);
      if (savedTab) setActiveTab(savedTab);
    }
  }, [windowId]);

  // Save selected connection and tab
  useEffect(() => {
    if (windowId) {
      if (selectedConnection?._id) localStorage.setItem(`docker-connection-${windowId}`, selectedConnection._id);
      localStorage.setItem(`docker-tab-${windowId}`, activeTab);
    }
  }, [selectedConnection, activeTab, windowId]);

  const socketRef = useRef(null);

  const emitDockerLs = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('docker:command', { action: 'list' });
    socketRef.current.emit('docker:command', { action: 'images' });
    socketRef.current.emit('docker:command', { action: 'volumes' });
    socketRef.current.emit('docker:command', { action: 'networks' });
    socketRef.current.emit('docker:command', { action: 'vol-assoc' });
  }, []);

  useEffect(() => {
    if (!selectedConnection) return;
    
    setIsLoading(true);
    socketRef.current = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      query: { dbUri: dbConfig?.uri || '' }
    });

    socketRef.current.on('connect', () => {
      socketRef.current.emit('ssh:connect', {
        connectionId: selectedConnection._id,
        connection: selectedConnection,
      });
    });

    // Background Polling logic to keep list fresh if changed externally
    const pollInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
         // Background refresh without triggering global loading state
         socketRef.current.emit('docker:command', { action: 'list' });
         socketRef.current.emit('docker:command', { action: 'images' });
         socketRef.current.emit('docker:command', { action: 'volumes' });
         socketRef.current.emit('docker:command', { action: 'networks' });
      }
    }, 15000); // 15s is standard for decent balance between freshness and overhead

    socketRef.current.on('ssh:connected', () => {
      socketRef.current.emit('docker:command', { action: 'info' });
    });

    socketRef.current.on('docker:result', ({ action, output, args }) => {
      setIsLoading(false);
      const targetId = args?.[0];
      if (targetId) setPendingActions(prev => { const n = { ...prev }; delete n[targetId]; return n; });
      
      if (action === 'check-port') {
        const isUsed = output.includes('IN_USE');
        setPortStatus(isUsed ? 'in-use' : 'free');
        return;
      }

      if (action === 'inspect') {
        try {
          const inspected = JSON.parse(output)[0];
          if (inspected) {
             const image = inspected.Config.Image;
             const name = inspected.Name.replace(/^\//, '');
             const portObj = inspected.HostConfig.PortBindings || {};
             const ports = Object.keys(portObj).map(k => (portObj[k] && portObj[k][0]) ? `${portObj[k][0].HostPort}:${k.split('/')[0]}` : null).filter(x => x).join(',');
             const envArr = (inspected.Config.Env || []).filter(e => !e.startsWith('PATH='));
             const env = envArr.join(',');
             
             // Extract mounts
             const mounts = (inspected.Mounts || []).map(m => `${m.Source}:${m.Destination}`).join(',');
             
             setCreateModal({ isOpen: true, image, name: name + '-config', ports, env, volumes: mounts });
          }

        } catch(e) {
          console.error('Inspect parse error:', e);
          addNotification({ title: 'Error', message: 'Failed to parse config', type: 'error' });
        }
      }

      // Clean up run tasks from floater

      if (['start', 'stop', 'restart', 'rm', 'rmi', 'run'].includes(action)) {
        emitDockerLs();
        
        // Clean up any tasks associated with this run/image
        if (action === 'run' || action === 'pull' || action === 'build') {
           const targetName = args?.[0]; // Generic target
           setPullingTasks(prev => {
             const n = { ...prev };
             Object.keys(n).forEach(key => {
               if (key === targetName || key.toLowerCase() === (targetName || '').toLowerCase()) {
                 delete n[key];
               }
             });
             return n;
           });
        }
      }

      if (action === 'info') {
        setIsDockerInstalled(true);
        emitDockerLs();
      } else if (action === 'list') {
        try {
          const lines = output.split('\n').filter(l => l.trim());
          const parsed = lines.map(line => {
            const data = JSON.parse(line);
            const labels = data.Labels || '';
            const stackMatch = labels.match(/com\.docker\.compose\.project=([^,]+)/);
            
            return {
              id: data.ID,
              name: data.Names,
              image: data.Image,
              status: data.Status,
              state: data.State ? data.State.toLowerCase() : 'unknown',
              ports: data.Ports,
              size: data.Size,
              createdAt: data.CreatedAt,
              networks: data.Networks,
              stack: stackMatch ? stackMatch[1] : null,
              mounts: data.Mounts
            };
          });
          setContainers(parsed);
        } catch (e) {
          console.error("Failed to parse Docker containers JSON:", e);
        }
      } else if (action === 'images') {
        try {
          const lines = output.split('\n').filter(l => l.trim());
          const parsed = lines.map(line => JSON.parse(line));
          setImages(parsed);
        } catch (e) {
          console.error("Failed to parse Docker images JSON:", e);
        }
      } else if (action === 'volumes') {
        try {
          const lines = output.split('\n').filter(l => l.trim());
          const parsed = lines.map(line => JSON.parse(line));
          setVolumes(parsed);
        } catch (e) { /* volumes may not be supported */ }
      } else if (action === 'vol-assoc') {
        const lines = output.split('\n').filter(l => l.startsWith('assoc:'));
        const mapping = {};
        lines.forEach(line => {
           const parts = line.replace('assoc:', '').split('\t');
           if (parts.length >= 3) {
              const id = parts[0].trim();
              const name = parts[1].trim().replace(/^\//, ''); // docker inspect names start with /
              const vols = (parts[2] || '').trim().split(/\s+/).filter(v => v);
              mapping[id] = vols;
              mapping[name] = vols; // allow lookup by name too
           }
        });
        
        setContainers(prev => prev.map(c => {
           // Enrich container with detailed volume info if found
           const detailedVols = mapping[c.id] || mapping[c.name] || [];
           if (detailedVols.length > 0) {
              return { ...c, detailedMounts: detailedVols.join(',') };
           }
           return c;
        }));
      } else if (action === 'networks') {
        try {
          const lines = output.split('\n').filter(l => l.trim());
          const parsed = lines.map(line => JSON.parse(line));
          setNetworks(parsed);
        } catch (e) { /* networks may not be supported */ }
      } else if (action === 'search') {
        setIsSearching(false);
        try {
          const lines = output.split('\n').filter(l => l.trim());
          const parsed = lines.map(line => JSON.parse(line));
          setSearchResults(parsed);
        } catch (e) {
          console.error("Failed to parse Docker search JSON:", e);
        }
      } else if (action === 'pull:status' || action === 'build:status') {
        const imageName = args?.[0];
        if (!imageName || !pullingTasksRef.current[imageName]) return;

        const taskType = pullingTasksRef.current[imageName].isBuild ? 'Build' : 'Pull';
        const isFinished = output.includes('---FINISHED---');
        const lines = output.split(/[\r\n]+/).filter(l => l.trim() && !l.includes('---FINISHED---'));
        
        // Exclude nohup warnings
        const cleanLines = lines.filter(l => !l.includes('nohup:'));
        
        let progress = pullingTasksRef.current[imageName].progress || 0;
        let status = pullingTasksRef.current[imageName].status || `${taskType}ing Layers...`;
        let lastLine = cleanLines[cleanLines.length - 1] || 'Waiting for status...';

        if (action === 'pull:status') {
          cleanLines.forEach(line => {
              const barMatch = line.match(/\[(=+)>?\s*\]/);
              if (barMatch) {
                  const bar = barMatch[1];
                  const p = Math.min(Math.round((bar.length / 25) * 100), 99);
                  if (p > progress) progress = p;
                  if (line.includes('Downloading')) status = 'Downloading...';
                  if (line.includes('Extracting')) status = 'Extracting...';
              }
              const pctMatch = line.match(/(\d+(?:\.\d+)?)%/);
              if (pctMatch) {
                  const p = Math.min(Math.round(parseFloat(pctMatch[1])), 99);
                  if (p > progress) progress = p;
              }
          });

          if (output.includes('Pull complete') || output.includes('up to date') || output.includes('Downloaded newer image')) {
              progress = 100;
              status = 'Complete';
          }
        } else {
          // Build status logic
          cleanLines.forEach(line => {
            if (line.includes('DONE')) {
                progress = Math.min(progress + 10, 99);
            }
          });
          if (output.includes('naming to docker.io') || output.includes('writing image') || output.includes('Successfully built')) {
              progress = 100;
              status = 'Complete';
          }
        }

        if (isFinished && progress < 100) {
            progress = 100;
            status = 'Complete';
        }

        const prevTask = pullingTasksRef.current[imageName];
        if (isFinished && prevTask.runAfterBuild && !prevTask.runDispatched) {
           const finalName = prevTask.runAfterBuild.name;
           const targetTag = prevTask.runAfterBuild.tag;
           
           // Automatically Run the container since build is done
           socketRef.current.emit('docker:command', { action: 'run', args: [finalName, targetTag] });
           emitDockerLs();
           addNotification({ title: 'Docker', message: `Custom image ${targetTag} built and started.`, type: 'success' });
        }

        setPullingTasks(prev => ({
            ...prev,
            [imageName]: { 
              ...prev[imageName], 
              lastLine, status, progress, 
              isFinished, 
              runDispatched: isFinished ? true : prev[imageName].runDispatched 
            }
        }));

        if (isFinished || status === 'Complete') {
            // Refresh immediately when we detect completion
            if (pullingTasksRef.current[imageName]?.status !== 'Complete') {
                emitDockerLs();
            }

            setTimeout(() => {
                setPullingTasks(prev => {
                    const next = { ...prev };
                    delete next[imageName];
                    return next;
                });
                emitDockerLs();
            }, 3000);
        }
      } else if (action === 'pull' || action === 'build') {
        // action started — no further action needed
      } else if (action === 'rmi') {
        emitDockerLs();
        addNotification({ title: 'Docker', message: 'Image removed successfully', type: 'success' });
        } else if (action === 'backup' || action === 'backup:status') {
          const targetId = args?.[0];
          if (!targetId || !pullingTasksRef.current[targetId]) return;

          const isFinished = output.includes('---FINISHED---');
          const lines = output.split(/[\r\n]+/).filter(l => l.trim() && !l.includes('---FINISHED---'));
          let lastLine = lines[lines.length - 1] || 'Processing backup...';
          
          let status = 'Packaging...';
          let progress = pullingTasksRef.current[targetId].progress || 10;

          if (isFinished) {
            progress = 100;
            status = 'Complete';
            const pathMatch = output.match(/BACKUP_PATH:(.+)/);
            if (pathMatch) {
              const fullPath = pathMatch[1].trim();
              addNotification({ 
                title: 'Backup Ready', 
                message: `Project archived to ${fullPath}. You can now download it via File Manager.`, 
                type: 'success' 
              });
            }
          } else {
            progress = Math.min(progress + 5, 95);
          }

          setPullingTasks(prev => ({
            ...prev,
            [targetId]: { ...prev[targetId], lastLine, status, progress, isFinished }
          }));

          if (isFinished) {
            setTimeout(() => {
              setPullingTasks(prev => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
            }, 5000);
          }
        } else if (action === 'find-config') {
          setIsLoading(false);
          const parts = output.trim().split(':');
          const type = parts[0];
          const path = parts.slice(1).join(':');
          if (type === 'FILE' && path) {
             const cContext = window._currentConfigSearchContainer || {};
             // We found a file. Read it.
             socketRef.current.emit('docker:command', { action: 'read-config', args: [cContext.id, path] });
          } else if (type === 'DIR' && path) {
             // Found a dir. We don't have a GUI file manager for containers yet, so fallback to terminal
             const cContext = window._currentConfigSearchContainer || { id: args[0], name: 'Container' };
             const cmd = `docker exec -it ${cContext.id} sh -c "cd '${path}' 2>/dev/null && ls -la && echo '---' && echo 'Edit: vi <filename>' && sh; exit 0"`;
             window.dispatchEvent(new CustomEvent('open-terminal', {
               detail: { connection: selectedConnection, initialCommand: `${cmd}\r`, title: `Config: ${cContext.name}` }
             }));
             addNotification({ title: 'Config Search', message: 'Directory found, opened in terminal.', type: 'info' });
          } else {
             const cContext = window._currentConfigSearchContainer || { id: args[0], name: 'Container' };
             const cmd = `docker exec -it ${cContext.id} sh -c "cd /etc && ls -la *.conf 2>/dev/null; echo '---'; echo 'Config not found automatically.'; sh"`;
             window.dispatchEvent(new CustomEvent('open-terminal', {
               detail: { connection: selectedConnection, initialCommand: `${cmd}\r`, title: `Config: ${cContext.name} (Fallback)` }
             }));
             addNotification({ title: 'Config Search', message: 'No config file found. Opening terminal fallback.', type: 'warning' });
          }
        } else if (action === 'read-config') {
          setIsLoading(false);
          const cContext = window._currentConfigSearchContainer || { id: args[0], name: 'Container' };
          setConfigEditor({ isOpen: true, file: args[1], content: output, containerId: cContext.id, containerName: cContext.name });
        } else if (action === 'write-config') {
          setIsLoading(false);
          addNotification({ title: 'Config Saved', message: `Saved ${args[1]} to container. Restart it for changes to apply.`, type: 'success' });
        } else if (action === 'prune-volumes') {
          setIsLoading(false);
          addNotification({ title: 'Volumes Pruned', message: 'Unused volumes have been successfully deleted.', type: 'success' });
          socketRef.current.emit('docker:command', { action: 'volumes' });
        } else if (action === 'rm-volumes') {
          setIsLoading(false);
          addNotification({ title: 'Volumes Deleted', message: 'Selected volumes were deleted successfully.', type: 'success' });
          setSelectedVolumes([]);
          socketRef.current.emit('docker:command', { action: 'volumes' });
        } else {
          emitDockerLs();
        }
      });

    socketRef.current.on('docker:error', (err) => {
      setIsLoading(false);
      setPendingActions({});

      if (err.includes('command not found') || err.includes('not found')) {
        setIsDockerInstalled(false);
      } else {
        addNotification({ title: 'Docker Error', message: err, type: 'error' });
      }
    });

    return () => {
      clearInterval(pollInterval);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [selectedConnection, dbConfig, emitDockerLs]);

  // Poll for pulling tasks
  useEffect(() => {
    const activeTaskNames = Object.keys(pullingTasks).filter(name => !pullingTasks[name].isFinished);
    if (activeTaskNames.length === 0 || !socketRef.current) return;

    const interval = setInterval(() => {
        activeTaskNames.forEach(name => {
            const task = pullingTasksRef.current[name];
            let action = 'pull:status';
            if (task?.isBuild) action = 'build:status';
            if (task?.isBackup) action = 'backup:status';
            socketRef.current.emit('docker:command', { action, args: [name] });
        });
    }, 2000);

    return () => clearInterval(interval);
  }, [pullingTasks]);

  // Debounced Auto-Search
  useEffect(() => {
    if (!searchQuery.trim() || !socketRef.current) {
      if (!searchQuery.trim()) setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      socketRef.current.emit('docker:command', { action: 'search', args: [searchQuery] });
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedConnection]);

  const fetchContainers = () => {
    if (socketRef.current) {
      setIsLoading(true);
      emitDockerLs();
    }
  };

  // Handle auto-presets when image changes
  useEffect(() => {
    if (createModal.isOpen && createModal.image) {
      const presets = getPresetsForImage(createModal.image);
      setCreateModal(prev => {
        // Only auto-fill if the field is currently empty or was previously a preset
        const newState = { ...prev };
        if (!prev.ports) newState.ports = presets.ports;
        if (!prev.env) newState.env = presets.env;
        if (!prev.volumes) newState.volumes = presets.volumes;
        if (!prev.name && createModal.image) {
          newState.name = createModal.image.split(':')[0].split('/').pop() + '_app';
        }
        return newState;
      });
    }
  }, [createModal.image, createModal.isOpen]);

  useEffect(() => {
    if (createModal.isOpen && createModal.ports) {
      const parts = createModal.ports.split(':');
      const hostPort = parts[0]?.trim();
      if (hostPort && !isNaN(hostPort) && socketRef.current) {
        setPortStatus('checking');
        socketRef.current.emit('docker:command', { action: 'check-port', args: [hostPort] });
      } else {
        setPortStatus(null);
      }
    } else {
      setPortStatus(null);
    }
  }, [createModal.ports, createModal.isOpen]);

  const handleOpenCreateModal = (imageName = '', fromAction = false) => {
    let defaultPorts = '';
    let defaultName = '';
    
    const imgL = imageName.toLowerCase();
    if (imgL.includes('nginx')) { defaultPorts = '80:80'; defaultName = 'nginx_app'; }
    else if (imgL.includes('mysql')) { defaultPorts = '3306:3306'; defaultName = 'mysql_db'; }
    else if (imgL.includes('mongo')) { defaultPorts = '27017:27017'; defaultName = 'mongo_db'; }
    else if (imgL.includes('redis')) { defaultPorts = '6379:6379'; defaultName = 'redis_cache'; }
    else if (imgL.includes('postgres')) { defaultPorts = '5432:5432'; defaultName = 'postgres_db'; }
    else if (imgL.includes('mariadb')) { defaultPorts = '3306:3306'; defaultName = 'mariadb_db'; }
    else if (imgL.includes('rabbitmq')) { defaultPorts = '5672:5672'; defaultName = 'rabbitmq_srv'; }
    else if (imgL.includes('influxdb')) { defaultPorts = '8086:8086'; defaultName = 'influx_db'; }

    setCreateModal({ 
      isOpen: true, 
      image: imageName, 
      name: defaultName || '', 
      ports: defaultPorts || '', 
      env: '', 
      volumes: '',
      isManual: !imageName && !fromAction
    });
  };


  const submitCreateContainer = (e) => {
    if (e) e.preventDefault();
    if (!createModal.image.trim()) return;
    if (socketRef.current) {
      setIsLoading(true);
      const finalName = (createModal.name || '').trim() || `app_${Math.floor(Math.random() * 100000)}`;
      const image = (createModal.image || '').trim();
      const ports = (createModal.ports || '').trim(); // e.g. "8080:80"
      const env = (createModal.env || '').trim();     // e.g. "KEY=VAL"
      const volumes = (createModal.volumes || '').trim(); // e.g. "/host/path:/container/path"
      
      socketRef.current.emit('docker:command', { 
        action: 'run', 
        args: [finalName, image, ports, env, volumes] 
      });


      // Add to pullingTasks for visual feedback in the floater
      setPullingTasks(prev => ({
        ...prev,
        [finalName || image]: { 
          progress: 50, 
          status: 'Creating...', 
          lastLine: `Initializing container ${finalName || image}`, 
          startTime: Date.now() 
        }
      }));
    }

    setCreateModal({ isOpen: false, image: '', name: '', ports: '', env: '', volumes: '' });
  };


  const handleContainerAction = (id, action) => {
    if (!socketRef.current) return;
    setPendingActions(prev => ({ ...prev, [id]: action }));
    socketRef.current.emit('docker:command', { action, args: [id] });
  };

  const handleSearchImage = (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || !socketRef.current) return;
    setIsSearching(true);
    setSearchResults([]);
    socketRef.current.emit('docker:command', { action: 'search', args: [searchQuery] });
  };

  const handlePullImage = (imageName) => {
    if (!socketRef.current) return;
    addNotification({ title: 'Docker', message: `Background pull started for ${imageName}`, type: 'info' });
    socketRef.current.emit('docker:command', { action: 'pull', args: [imageName] });
    setPullingTasks(prev => ({
        ...prev,
        [imageName]: { progress: 0, status: 'Starting...', lastLine: 'Initializing...', startTime: Date.now() }
    }));
    setSearchResults([]);
    setSearchQuery('');
    setCreateModal(prev => ({ ...prev, pullingImage: null }));
  };

  const handleDeleteImage = (imageId, imageName) => {
    showConfirm(`Remove image ${imageName}?`, () => {
      if (!socketRef.current) return;
      setIsLoading(true);
      socketRef.current.emit('docker:command', { action: 'rmi', args: [imageId] });
    }, 'Remove', 'Delete');
  };


  const fetchLogs = (id, name) => {
    openWindow(
      `docker-logs-${id}`,
      `Logs: ${name}`,
      <DockerLogApp initialConnection={selectedConnection} initialContainerId={id} initialContainerName={name} />,
      FileText,
      { 
        initialWidth: 900, 
        initialHeight: 600, 
        appType: 'docker-logs',
        props: { initialConnectionId: selectedConnection._id, initialContainerId: id, initialContainerName: name } 
      }
    );
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

  const handleBackup = (containerId, containerName) => {
    if (!socketRef.current) return;
    addNotification({ title: 'Migration', message: `Calculating project size and starting backup for ${containerName}...`, type: 'info' });
    socketRef.current.emit('docker:command', { action: 'backup', args: [containerId] });
    setPullingTasks(prev => ({
      ...prev,
      [containerId]: { 
        progress: 5, 
        status: 'Backup Starting...', 
        lastLine: 'Analyzing Docker Compose project...', 
        startTime: Date.now(),
        isBackup: true
      }
    }));
  };

  const handleExportProject = async (container) => {
    // Collect all relevant project data
    const projectData = {
      name: container.name,
      image: container.image,
      stack: container.stack,
      networks: container.networks,
      ports: container.ports,
      source: 'docker-app-export',
      timestamp: new Date().toISOString()
    };
    
    const payload = JSON.stringify(projectData, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `docker_project_${container.name}_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    addNotification({ title: 'Export', message: 'Project configuration exported successfully', type: 'success' });
  };

  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.source !== 'docker-app-export') {
           throw new Error('Invalid project export file');
        }
        setImportData(parsed);
        setCreateModal({
          isOpen: true,
          name: `${parsed.name}-imported`,
          image: parsed.image,
          ports: '',
          env: '',
          volumes: ''
        });

        addNotification({ title: 'Import', message: 'Configuration loaded into creation modal', type: 'info' });
      } catch (err) {
        addNotification({ title: 'Error', message: 'Invalid JSON file', type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleOpenServiceConfig = (c) => {
    if (c.state !== 'running') return;
    const img = (c.image || '').toLowerCase();

    // Define candidate config paths per service (ordered by likelihood)
    let candidates = null;

    if (img.includes('nginx')) {
      candidates = { paths: ['/etc/nginx/nginx.conf', '/etc/nginx/conf.d/default.conf', '/etc/nginx/conf.d'], isDir: false };
    } else if (img.includes('apache') || img.includes('httpd')) {
      candidates = { paths: ['/usr/local/apache2/conf/httpd.conf', '/etc/apache2/apache2.conf', '/etc/httpd/conf/httpd.conf'], isDir: false };
    } else if (img.includes('redis')) {
      candidates = { paths: ['/usr/local/etc/redis/redis.conf', '/etc/redis/redis.conf', '/etc/redis.conf'], isDir: false };
    } else if (img.includes('postgres')) {
      candidates = { paths: ['/var/lib/postgresql/data/postgresql.conf', '/etc/postgresql/postgresql.conf'], isDir: false };
    } else if (img.includes('mysql') || img.includes('mariadb')) {
      candidates = { paths: ['/etc/mysql/my.cnf', '/etc/my.cnf', '/etc/mysql/conf.d'], isDir: false };
    } else if (img.includes('mongo')) {
      candidates = { paths: ['/data/configdb/mongod.conf', '/etc/mongod.conf', '/etc/mongod.conf.orig', '/etc/mongo.conf'], isDir: false };
    }

    if (candidates) {
      window._currentConfigSearchContainer = { id: c.id, name: c.name };
      setIsLoading(true);
      socketRef.current.emit('docker:command', { action: 'find-config', args: [c.id, ...candidates.paths] });
    } else {
      // Generic fallback — drop into /etc and list common config files
      const cmd = `docker exec -it ${c.id} sh -c "cd /etc && ls -la *.conf 2>/dev/null; echo '---'; sh"`;
      window.dispatchEvent(new CustomEvent('open-terminal', {
        detail: {
          connection: selectedConnection,
          initialCommand: `${cmd}\r`,
          title: `Config: ${c.name}`
        }
      }));
    }
  };


  const browseContainer = (containerId, containerName, initialPath = '/') => {
    window.dispatchEvent(new CustomEvent('open-files', {
      detail: {
        connection: selectedConnection,
        connectionIdOverride: `docker-${containerId}:${selectedConnection._id}`,
        title: `Files: ${containerName}`
      }
    }));
  };

  // Filtered containers
  const filteredContainers = useMemo(() => {
    if (containerFilter === 'all') return containers;
    if (containerFilter === 'running') return containers.filter(c => c.state === 'running');
    return containers.filter(c => c.state !== 'running');
  }, [containers, containerFilter]);

  const runningCount = containers.filter(c => c.state === 'running').length;
  const stoppedCount = containers.filter(c => c.state !== 'running').length;

  // ── Connection Selector ──
  if (!selectedConnection) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)] p-8">
        <div className="max-w-4xl mx-auto w-full text-center">
            <div className="w-20 h-20 rounded-2xl bg-sky-500/10 flex items-center justify-center mx-auto mb-6">
              <Box size={36} className="text-sky-400" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Docker Manager</h1>
            <p className="text-sm text-[var(--text-muted)] mb-8">Select a server to manage Docker containers</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sshConnections.map(conn => (
                <div key={conn._id} onClick={() => setSelectedConnection(conn)} className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:bg-white/5 hover:border-sky-500/30 transition-all text-left group">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110" style={{ background: `${conn.color}20`, color: conn.color }}>
                            <Laptop size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold">{conn.name}</h3>
                            <p className="text-xs text-[var(--text-muted)]">{conn.host}</p>
                        </div>
                    </div>
                </div>
                ))}
            </div>
        </div>
      </div>
    );
  }

  // ── Tab config ──
  const tabs = [
    { id: 'containers', label: 'CONTAINERS', count: containers.length, color: 'sky' },
    { id: 'images', label: 'IMAGES', count: images.length, color: 'emerald' },
    { id: 'volumes', label: 'VOLUMES', count: volumes.length, color: 'violet' },
    { id: 'networks', label: 'NETWORKS', count: networks.length, color: 'amber' },
  ];

  const tabColors = { sky: 'bg-sky-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500', amber: 'bg-amber-500' };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-4 h-12 shrink-0">
            <div className="flex items-center gap-4">
                <span className="text-sm font-bold flex items-center gap-2">
                    <Box size={14} className="text-sky-400" />
                    {selectedConnection.name}
                </span>
                <div className="flex items-center gap-0.5 bg-black/20 p-0.5 rounded-lg">
                    {tabs.map(tab => (
                      <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)} 
                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1.5 ${
                          activeTab === tab.id 
                            ? `${tabColors[tab.color]} text-white shadow-lg` 
                            : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {tab.label}
                        <span className={`text-[8px] px-1 py-0 rounded ${activeTab === tab.id ? 'bg-white/20' : 'bg-white/5'}`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-3">
                {/* Export/Import Buttons like SSH Manager */}
                <div className="flex items-center gap-1.5 bg-black/20 p-0.5 rounded-lg mr-2">
                  <button 
                    onClick={() => importFileRef.current?.click()}
                    className="px-2 py-1 text-[10px] font-bold rounded-md text-[var(--text-muted)] hover:text-white hover:bg-white/5 transition-all flex items-center gap-1"
                    title="Import Project Metadata"
                  >
                    <Upload size={12} /> IMPORT
                  </button>
                  <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFileChange} />
                </div>
                
                <button onClick={fetchContainers} className="p-1.5 hover:bg-white/5 rounded-lg text-sky-400 transition-colors active:scale-90" title="Refresh">
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
                <div className="w-px h-4 bg-white/10" />
                <button onClick={() => setSelectedConnection(null)} className="text-[10px] text-[var(--text-muted)] hover:text-white transition-colors">SWITCH</button>
            </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
            {!isDockerInstalled ? (
                <div className="text-center py-20">
                    <AlertTriangle size={48} className="text-rose-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Docker Not Installed</h2>
                    <p className="text-sm text-[var(--text-muted)]">Docker was not found on this server</p>
                </div>
            ) : (
                <>
                    {/* ── CONTAINERS TAB ── */}
                    {activeTab === 'containers' && (
                        <div className="flex flex-col gap-5">
                            {/* Stats row */}
                            <div className="flex gap-3 flex-wrap">
                                <StatCard icon={Box} label="Total" value={containers.length} color="sky" />
                                <StatCard icon={Activity} label="Running" value={runningCount} color="emerald" />
                                <StatCard icon={Square} label="Stopped" value={stoppedCount} color="rose" />
                            </div>

                            {/* Filter and Action bar */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {['all', 'running', 'stopped'].map(f => (
                                      <button 
                                        key={f}
                                        onClick={() => setContainerFilter(f)}
                                        className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                                          containerFilter === f 
                                            ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' 
                                            : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5 border border-transparent'
                                        }`}
                                      >
                                        {f} {f === 'all' ? containers.length : f === 'running' ? runningCount : stoppedCount}
                                      </button>
                                    ))}
                                </div>
                                <button 
                                  onClick={() => handleOpenCreateModal()}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 shadow-lg active:scale-95 transition-all flex items-center gap-1.5"
                                >
                                  <Plus size={12} /> CREATE CONTAINER
                                </button>
                            </div>

                            {/* Container list */}
                            {filteredContainers.length === 0 ? (
                              <div className="text-center py-24 bg-black/10 rounded-3xl border border-dashed border-white/5">
                                {isLoading ? (
                                  <div className="flex flex-col items-center gap-4">
                                     <div className="w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                                     <p className="text-sm font-bold text-emerald-400">Fetching Containers...</p>
                                  </div>
                                ) : (
                                  <>
                                    <Box size={40} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-sm font-bold opacity-60">No containers found</p>
                                    <p className="text-[10px] mt-1 opacity-40">Pull an image and run it to get started</p>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                <AnimatePresence mode="popLayout">
                                  {filteredContainers.map(c => {
                                    const isExpanded = expandedContainer === c.id;
                                    const isPending = pendingActions[c.id];
                                    return (
                                      <motion.div 
                                        key={c.id} 
                                        layout
                                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.8, x: -20, filter: 'blur(8px)' }}
                                        transition={{ duration: 0.2, ease: "easeOut" }}
                                        className={`rounded-2xl border bg-[var(--bg-card)] transition-all duration-200 ${
                                          isPending ? 'opacity-60 pointer-events-none' : ''
                                        } ${
                                          c.state === 'running' 
                                            ? 'border-emerald-500/15 hover:border-emerald-500/30' 
                                            : 'border-[var(--border-color)] hover:border-sky-500/20'
                                        } ${isExpanded ? 'ring-1 ring-sky-500/20' : ''}`}
                                      >

                                      {/* Container header */}
                                      <div 
                                        className="p-4 cursor-pointer flex items-start justify-between"
                                        onClick={() => setExpandedContainer(isExpanded ? null : c.id)}
                                      >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                              c.state === 'running' 
                                                ? 'bg-emerald-500/10 text-emerald-500' 
                                                : 'bg-rose-500/10 text-rose-500'
                                            }`}>
                                                <Box size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-sm truncate flex items-center gap-2">
                                                  <span>{c.name}</span>
                                                  {c.stack && (
                                                    <span className="px-1.5 py-0.5 text-[8px] bg-purple-500/10 text-purple-400 font-bold uppercase rounded-lg border border-purple-500/20 shadow-sm align-middle">
                                                      ★ {c.stack}
                                                    </span>
                                                  )}
                                                </h3>
                                                <p className="text-[10px] font-mono text-[var(--text-muted)] truncate">{c.image}</p>
                                                {c.ports && (
                                                  <p className="text-[9px] font-mono text-sky-400/70 flex items-center gap-1 mt-0.5 truncate">
                                                    <ExternalLink size={8} /> {c.ports}
                                                  </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                            c.state === 'running' 
                                              ? 'bg-emerald-500/10 text-emerald-400' 
                                              : 'bg-rose-500/10 text-rose-400'
                                          }`}>
                                            {c.state === 'running' ? `● ${formatUptime(c.status)}` : c.status}
                                          </span>
                                          {isExpanded ? <ChevronDown size={14} className="opacity-30" /> : <ChevronRight size={14} className="opacity-30" />}
                                        </div>
                                      </div>

                                      {/* Container details (expandable) */}
                                      {isExpanded && (
                                        <div className="px-4 pb-4 pt-0 border-t border-white/5 animate-[slideDown_0.15s_ease-out]">
                                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10px] text-[var(--text-muted)] py-3">
                                            <div className="flex justify-between"><span>ID</span><span className="font-mono">{c.id.substring(0, 12)}</span></div>
                                            <div className="flex justify-between"><span>Network</span><span className="font-mono">{c.networks || '-'}</span></div>
                                            <div className="flex justify-between col-span-2 mt-1 border-t border-white/5 pt-1">
                                              <span>Mounts</span>
                                              <span className="font-mono truncate ml-4 opacity-70" title={c.mounts}>{c.mounts || '-'}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Action buttons */}
                                      <div className="flex items-center gap-1.5 px-4 pb-4">
                                          {c.state === 'running' ? (
                                              <button onClick={(e) => { e.stopPropagation(); handleContainerAction(c.id, 'stop'); }} className="flex-1 py-1.5 rounded-lg bg-orange-500/10 text-orange-400 text-[10px] font-bold hover:bg-orange-500/15 transition-all flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden">
                                                {isPending === 'stop' ? <RefreshCw size={9} className="animate-spin" /> : <Square size={9} />} {isPending === 'stop' ? 'STOPPING' : 'STOP'}
                                              </button>
                                          ) : (
                                              <button onClick={(e) => { e.stopPropagation(); handleContainerAction(c.id, 'start'); }} className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/15 transition-all flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden">
                                                {isPending === 'start' ? <RefreshCw size={9} className="animate-spin" /> : <Play size={9} />} {isPending === 'start' ? 'STARTING' : 'START'}
                                              </button>
                                          )}
                                          <button onClick={(e) => { e.stopPropagation(); handleContainerAction(c.id, 'restart'); }} className="py-1.5 px-2.5 rounded-lg bg-white/5 text-[10px] font-bold hover:bg-white/10 transition-all flex items-center justify-center" title="Restart">
                                            {isPending === 'restart' ? <RefreshCw size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                                          </button>
                                          <button onClick={(e) => { e.stopPropagation(); fetchLogs(c.id, c.name); }} className="flex-1 py-1.5 rounded-lg bg-white/5 text-[10px] font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-1">
                                            <FileText size={9} /> LOGS
                                          </button>
                                          <button onClick={(e) => { e.stopPropagation(); browseContainer(c.id, c.name); }} disabled={c.state !== 'running'} className="py-1.5 px-2.5 rounded-lg bg-white/5 text-[10px] font-bold disabled:opacity-20 hover:bg-white/10 transition-all" title="Files">
                                            <Folder size={10} />
                                          </button>
                                          <button onClick={(e) => { e.stopPropagation(); attachToContainer(c.id, c.name); }} disabled={c.state !== 'running'} className="py-1.5 px-2.5 rounded-lg bg-white/5 text-[10px] font-bold disabled:opacity-20 hover:bg-white/10 transition-all" title="Exec">
                                            <TermIcon size={10} />
                                          </button>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); handleBackup(c.id, c.name); }} 
                                            className="py-1.5 px-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/20 transition-all flex items-center gap-1" 
                                            title="Backup Files & Data (Heavy)"
                                          >
                                            <Archive size={10} />
                                          </button>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); handleOpenServiceConfig(c); }} 
                                            disabled={c.state !== 'running'}
                                            className="py-1.5 px-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-[10px] font-bold disabled:opacity-20 hover:bg-indigo-500/20 transition-all flex items-center gap-1"
                                            title="Service Config"
                                          >
                                            <Settings size={10} />
                                          </button>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); handleExportProject(c); }} 
                                            className="py-1.5 px-2.5 rounded-lg bg-sky-500/10 text-sky-400 text-[10px] font-bold hover:bg-sky-500/20 transition-all flex items-center gap-1" 
                                            title="Export Configuration (Light)"
                                          >
                                            <Share2 size={10} />
                                          </button>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); showConfirm(`Delete ${c.name}?`, () => handleContainerAction(c.id, 'rm'), 'Remove', 'Delete'); }} 
                                            className="py-1.5 px-2 rounded-lg border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 transition-all flex items-center justify-center min-w-[32px]"
                                            disabled={isPending}
                                          >
                                            {isPending === 'rm' ? <RefreshCw size={10} className="animate-spin text-rose-400" /> : <Trash2 size={10} />}
                                          </button>
                                      </div>
                                    </motion.div>
                                  );
                                })}
                                </AnimatePresence>
                              </div>
                            )}
                        </div>
                    )}

                    {/* ── IMAGES TAB ── */}
                    {activeTab === 'images' && (
                        <div className="flex flex-col gap-5">
                            {/* Stats row */}
                            <div className="flex gap-3 flex-wrap">
                                <StatCard icon={Layers} label="Local Images" value={images.length} color="emerald" />
                                <StatCard 
                                  icon={Package} 
                                  label="Unused" 
                                  value={images.filter(img => !containers.some(c => c.image.includes(img.Repository))).length} 
                                  color="rose" 
                                />
                                <StatCard icon={Download} label="Pulling" value={Object.keys(pullingTasks).length} color="sky" />
                            </div>

                            {/* Search */}
                            <form onSubmit={handleSearchImage} className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors group-focus-within:text-emerald-400">
                                  <Search size={16} />
                                </div>
                                <input 
                                  type="text" 
                                  value={searchQuery} 
                                  onChange={(e) => setSearchQuery(e.target.value)} 
                                  placeholder="Search Docker Hub..." 
                                  className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-3 pl-11 pr-28 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors" 
                                />
                                {searchQuery && (
                                  <button 
                                    type="button"
                                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                                    className="absolute right-[90px] top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                                  >
                                    <X size={14} className="opacity-40" />
                                  </button>
                                )}
                                <button 
                                  type="submit" 
                                  disabled={isSearching}
                                  className="absolute right-2 top-1.5 bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-600 transition-all disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {isSearching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                                  SEARCH
                                </button>
                            </form>

                            {/* Pulling Progress Area (inline) */}
                            {Object.entries(pullingTasks).map(([name, task]) => (
                                <div key={name} className="bg-sky-500/5 border border-sky-500/10 rounded-2xl p-4 flex flex-col gap-2">
                                    <div className="flex justify-between items-center">
                                        <div className="min-w-0 mr-3">
                                            <div className="flex items-center gap-2">
                                              <Download size={12} className="text-sky-400 animate-bounce shrink-0" />
                                              <h4 className="text-xs font-bold truncate">{name}</h4>
                                            </div>
                                            <p className="text-[10px] text-sky-400 font-mono italic truncate mt-0.5">{task.lastLine}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-lg font-bold text-sky-400 tabular-nums">{task.progress}%</span>
                                            <p className="text-[9px] text-sky-400/60">{task.status}</p>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div 
                                          className="h-full rounded-full transition-all duration-700" 
                                          style={{ 
                                            width: `${task.progress}%`,
                                            backgroundImage: task.progress >= 100 
                                              ? 'linear-gradient(90deg, #10b981, #34d399)' 
                                              : 'linear-gradient(90deg, #0ea5e9, #38bdf8)',
                                          }} 
                                        />
                                    </div>
                                </div>
                            ))}

                            {/* Search Results */}
                            {searchResults.length > 0 && (
                                <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
                                    <div className="flex justify-between items-center px-4 py-3 border-b border-white/5">
                                        <h3 className="text-[10px] font-bold text-emerald-400 tracking-widest flex items-center gap-2">
                                          <Globe size={12} />
                                          DOCKER HUB RESULTS
                                          <span className="text-white/30 font-mono">{searchResults.length}</span>
                                        </h3>
                                        <button onClick={() => setSearchResults([])} className="text-[10px] opacity-50 hover:opacity-100 transition-opacity flex items-center gap-1">
                                          <X size={10} /> CLEAR
                                        </button>
                                    </div>
                                    <div className="flex flex-col divide-y divide-white/5 max-h-[400px] overflow-y-auto scrollbar-hide">
                                        {searchResults.map((res, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 hover:bg-white/[0.03] transition-all group/res">
                                                <div className="min-w-0 mr-4 flex-1">
                                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                        <span className="font-bold text-sm text-white">{res.Name}</span>
                                                        {res.IsOfficial === "[OK]" && (
                                                            <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                                                                <Shield size={8} /> OFFICIAL
                                                            </span>
                                                        )}
                                                        <div className="flex items-center gap-1 bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                                            <Star size={9} fill="currentColor" />
                                                            {res.StarCount || res.Stars || 0}
                                                        </div>
                                                    </div>
                                                    <p className="text-[10px] text-[var(--text-muted)] line-clamp-1 leading-relaxed opacity-70 group-hover/res:opacity-100 transition-opacity">
                                                        {res.Description || "No description provided."}
                                                    </p>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                      setCreateModal(prev => ({ ...prev, pullingImage: res }));
                                                    }}
                                                    disabled={!!pullingTasks[res.Name] || !!pullingTasks[`${res.Name}:latest`]}
                                                    className="shrink-0 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 transition-all shadow-lg active:scale-95 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {pullingTasks[res.Name] || pullingTasks[`${res.Name}:latest`] 
                                                      ? <><RefreshCw size={11} className="animate-spin" /> PULLING</>
                                                      : <><Download size={11} /> PULL TAG</>
                                                    }
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Tag Selection Modal (Internal) */}
                            {createModal.pullingImage && createPortal(
                              <MacOSModalWindow
                                isOpen={!!createModal.pullingImage}
                                onClose={() => setCreateModal(prev => ({ ...prev, pullingImage: null }))}
                                title={`Pull Image: ${createModal.pullingImage.Name}`}
                                icon={Download}
                                defaultWidth={400}
                                defaultHeight={320}
                                zIndexClassName="z-[75000]"
                              >
                                <div className="p-6 flex flex-col h-full">
                                  <p className="text-sm text-[var(--text-muted)] mb-4 font-mono">{createModal.pullingImage.Name}</p>
                                  
                                  <label className="block text-xs font-bold text-[var(--text-muted)] mb-2 uppercase tracking-wide">Select Tag</label>
                                  <div className="flex flex-wrap gap-1.5 mb-4">
                                    {(commonTags || []).map(tag => (
                                      <button 
                                        key={tag}
                                        onClick={() => handlePullImage(`${createModal.pullingImage.Name}:${tag}`)}
                                        className="px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-bold hover:bg-sky-500/20 transition-all"
                                      >
                                        {tag}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="relative mt-2">
                                    <label className="block text-xs font-bold text-[var(--text-muted)] mb-2 uppercase tracking-wide">Or Custom Tag</label>
                                    <div className="flex gap-2">
                                      <input 
                                        type="text" 
                                        defaultValue="latest"
                                        id="custom-tag-input"
                                        placeholder="e.g. 1.21-alpine"
                                        className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handlePullImage(`${createModal.pullingImage.Name}:${e.target.value || 'latest'}`);
                                          }
                                        }}
                                      />
                                      <button 
                                        onClick={() => {
                                          const val = document.getElementById('custom-tag-input').value;
                                          handlePullImage(`${createModal.pullingImage.Name}:${val || 'latest'}`);
                                        }}
                                        className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 shadow-lg"
                                      >
                                        PULL
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-auto pt-4 flex justify-end">
                                    <button 
                                      onClick={() => setCreateModal(prev => ({ ...prev, pullingImage: null }))}
                                      className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-white"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </MacOSModalWindow>,
                              document.body
                            )}

                            {/* Image Grid */}
                            {images.length === 0 ? (
                              <div className="text-center py-16 opacity-40">
                                <Layers size={40} className="mx-auto mb-3" />
                                <p className="text-sm font-bold">No images found</p>
                                <p className="text-xs mt-1">Search Docker Hub and pull an image</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                  {images.map((img, idx) => {
                                      const fullTag = `${img.Repository}:${img.Tag}`;
                                      const users = containers.filter(c => c.image === fullTag || c.image === img.ID || c.image.includes(img.Repository));
                                      const isNone = img.Repository === '<none>';
                                      return (
                                          <div key={img.ID + idx} className="p-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] hover:border-emerald-500/20 transition-all group">
                                              <div className="flex justify-between items-start mb-3">
                                                  <div className="flex items-center gap-3 min-w-0">
                                                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                                        isNone ? 'bg-white/5 text-white/30' : 'bg-emerald-500/10 text-emerald-500'
                                                      }`}>
                                                        <Layers size={18} />
                                                      </div>
                                                      <div className="min-w-0">
                                                          <h3 className={`font-bold text-sm truncate ${isNone ? 'italic opacity-50' : ''}`}>
                                                            {isNone ? '(untagged)' : img.Repository}
                                                          </h3>
                                                          <p className="text-[10px] text-[var(--text-muted)]">
                                                            {isNone ? img.ID.substring(0, 20) : `Tag: ${img.Tag}`}
                                                          </p>
                                                      </div>
                                                  </div>
                                                  <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-emerald-400 text-[10px] font-bold">{img.Size}</span>
                                                    <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${
                                                      users.length > 0 ? 'bg-sky-500/10 text-sky-400' : 'bg-rose-500/10 text-rose-400'
                                                    }`}>
                                                      {users.length > 0 ? `${users.length} USED` : 'UNUSED'}
                                                    </span>
                                                  </div>
                                              </div>
                                              
                                              {users.length > 0 && (
                                                <div className="mb-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {users.map(u => (
                                                          <span key={u.id} className="px-1.5 py-0.5 text-[9px] bg-sky-500/10 text-sky-400 rounded-md border border-sky-500/10">{u.name}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                              )}

                                              <div className="flex items-center gap-1.5">
                                                <button 
                                                  onClick={() => handleOpenCreateModal(!isNone ? fullTag : img.ID, true)} 
                                                  className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/15 transition-all flex items-center justify-center gap-1"
                                                >
                                                  <Play size={9} /> RUN
                                                </button>
                                                <button 
                                                  onClick={() => handleDeleteImage(img.ID, isNone ? img.ID.substring(0,12) : fullTag)}
                                                  disabled={users.length > 0}
                                                  className="py-1.5 px-2.5 rounded-lg border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                                                  title={users.length > 0 ? 'Image is in use' : 'Remove image'}
                                                >
                                                  <Trash2 size={10} />
                                                </button>
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                            )}
                        </div>
                    )}

                    {/* ── VOLUMES TAB ── */}
                    {activeTab === 'volumes' && (
                      <div className="flex flex-col gap-5">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex gap-3">
                            <StatCard icon={HardDrive} label="Volumes" value={volumes.length} color="violet" />
                          </div>
                          <div className="flex gap-2">
                            {selectedVolumes.length > 0 && (
                              <button 
                                onClick={() => {
                                  showConfirm(
                                    `Are you sure you want to delete ${selectedVolumes.length} selected volume(s)? This cannot be undone.`,
                                    () => {
                                      setIsLoading(true);
                                      socketRef.current.emit('docker:command', { action: 'rm-volumes', args: selectedVolumes });
                                    },
                                    'Delete Volumes'
                                  );
                                }}
                                className="px-4 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-rose-500/20 hover:bg-rose-600"
                              >
                                <Trash2 size={14} />
                                Delete Selected ({selectedVolumes.length})
                              </button>
                            )}
                            <button 
                              onClick={() => setPruneVolumesModal({ isOpen: true, confirmText: '' })}
                              className="px-4 py-2 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-rose-500/20"
                            >
                              <Trash2 size={14} />
                              Prune Unused
                            </button>
                          </div>
                        </div>
                        {volumes.length === 0 ? (
                          <div className="text-center py-16 opacity-40">
                            <HardDrive size={40} className="mx-auto mb-3" />
                            <p className="text-sm font-bold">No volumes found</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            {volumes.map((vol, i) => {
                              const isSelected = selectedVolumes.includes(vol.Name);
                              return (
                                <div 
                                  key={i} 
                                  onClick={() => {
                                    if (isSelected) {
                                      setSelectedVolumes(prev => prev.filter(v => v !== vol.Name));
                                    } else {
                                      setSelectedVolumes(prev => [...prev, vol.Name]);
                                    }
                                  }}
                                  className={`p-4 rounded-2xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                                    isSelected ? 'border-violet-500 bg-violet-500/10' : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-violet-500/30'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 mb-2 relative z-10">
                                    <div className={`w-4 h-4 rounded my-auto flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-violet-500 border-violet-500' : 'border border-[var(--border-color)] group-hover:border-violet-500/50'}`}>
                                      {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                    </div>
                                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 text-violet-400 flex items-center justify-center shrink-0">
                                      <HardDrive size={14} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <h3 className="font-bold text-sm truncate">{vol.Name || vol.Driver || 'unnamed'}</h3>
                                      <p className="text-[10px] text-[var(--text-muted)]">Driver: {vol.Driver || 'local'}</p>
                                    </div>
                                  </div>
                                  {vol.Mountpoint && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.dispatchEvent(new CustomEvent('open-files', {
                                          detail: {
                                            connection: selectedConnection,
                                            initialPath: vol.Mountpoint,
                                            title: `Host Volume: ${vol.Name?.substring(0,12) || 'Unnamed'}`
                                          }
                                        }));
                                      }}
                                      className="text-left cursor-pointer group/link block w-full outline-none focus:outline-none focus:bg-white/5 rounded pl-[50px] pr-2 py-0.5 mt-1 transition-colors"
                                      title="Open in Files App (Host)"
                                    >
                                      <span className="text-[9px] font-mono text-[var(--accent-indigo)] group-hover/link:underline truncate block relative z-10 duration-200">{vol.Mountpoint}</span>
                                    </button>
                                  )}
                                  
                                  {(() => {
                                    const vName = (vol.Name || '').toLowerCase().trim();
                                    if (!vName) return null;
                                    const associated = containers.filter(c => {
                                      const mounts = (c.detailedMounts || c.mounts || '').toLowerCase();
                                      return mounts.includes(vName);
                                    });
                                    if (associated.length === 0) return null;
                                    return (
                                      <div className="flex flex-wrap gap-1 mt-3 pl-[50px] relative z-10">
                                        {associated.map(c => (
                                          <span key={c.id} className="px-1.5 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/10 rounded-md text-[9px] font-bold">
                                            {c.name}
                                          </span>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── NETWORKS TAB ── */}
                    {activeTab === 'networks' && (
                      <div className="flex flex-col gap-5">
                        <div className="flex gap-3">
                          <StatCard icon={Globe} label="Networks" value={networks.length} color="amber" />
                        </div>
                        {networks.length === 0 ? (
                          <div className="text-center py-16 opacity-40">
                            <Globe size={40} className="mx-auto mb-3" />
                            <p className="text-sm font-bold">No networks found</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            {networks.map((net, i) => (
                              <div key={i} className="p-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] hover:border-amber-500/20 transition-all">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                                      <Globe size={14} />
                                    </div>
                                    <div className="min-w-0">
                                      <h3 className="font-bold text-sm truncate">{net.Name || 'unnamed'}</h3>
                                      <p className="text-[10px] text-[var(--text-muted)]">
                                        {net.Driver || 'bridge'} · {net.Scope || 'local'}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-mono text-[var(--text-muted)]">{net.ID?.substring(0, 12)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                </>
            )}
        </div>

        {/* Floating pull progress (visible from all tabs) */}
        {activeTab !== 'images' && <PullingFloater pullingTasks={pullingTasks} />}

        {/* Create Container Modal */}
        {createModal.isOpen && createPortal(
          <MacOSModalWindow
            isOpen={createModal.isOpen}
            onClose={() => setCreateModal(prev => ({ ...prev, isOpen: false }))}
            title="Create Container"
            icon={Box}
            defaultWidth={480}
            defaultHeight={460}
            enableMaximize={false}
            enableMinimize={false}
            zIndexClassName="z-[60000]"
          >
            <form onSubmit={submitCreateContainer} className="flex flex-col h-full gap-4">
              <div className="flex-1">
              <div className="flex-1 space-y-5">
                <div className="relative">
                  <label className="block text-xs font-black text-[var(--text-muted)] mb-2 uppercase tracking-tight opacity-50">Base Image</label>
                  {!createModal.isManual ? (
                    <div className="flex items-center gap-3 bg-black/40 border border-sky-500/20 rounded-2xl p-4 transition-all hover:bg-black/50 hover:border-sky-500/40 group">
                       <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform">
                          <Package size={20} />
                       </div>
                       <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-white truncate">{createModal.image}</h4>
                          <p className="text-[10px] text-sky-400 font-mono tracking-wider">LOCKED FROM ACTION</p>
                       </div>
                       <button 
                         type="button" 
                         onClick={() => setCreateModal(prev => ({ ...prev, isManual: true }))}
                         className="text-[10px] text-[var(--text-muted)] hover:text-white underline px-3 py-1 opacity-50 hover:opacity-100"
                        >Change</button>
                    </div>
                  ) : (
                    <>
                      <ImageComboBox 
                        value={createModal.image}
                        onChange={(val) => setCreateModal(prev => ({ ...prev, image: val }))}
                        options={Array.from(new Set(images.filter(img => img.Repository !== '<none>').map(img => `${img.Repository}:${img.Tag}`)))}
                      />
                      <p className="mt-1.5 text-[9px] text-[var(--text-muted)] font-mono opacity-50 italic">Tip: Use fully qualified names (e.g., node:20-alpine)</p>
                    </>
                  )}
                </div>


                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-[var(--text-muted)] mb-2 uppercase tracking-tight opacity-50">Container Name</label>
                    <input 
                      type="text"
                      value={createModal.name}
                      onChange={(e) => setCreateModal(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. my-app"
                      className="w-full bg-black/30 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-[var(--text-muted)] mb-2 uppercase tracking-tight opacity-50 text-amber-400">Port Mapping</label>
                    <div className="relative">
                      <input 
                        type="text"
                        value={createModal.ports}
                        onChange={(e) => setCreateModal(prev => ({ ...prev, ports: e.target.value }))}
                        placeholder="e.g. 8080:80"
                        className={`w-full bg-black/30 border rounded-xl px-4 py-2.5 text-sm font-mono transition-all ${
                          portStatus === 'in-use' ? 'border-rose-500/50 text-rose-300' : 
                          portStatus === 'free' ? 'border-emerald-500/50 text-emerald-300' :
                          'border-amber-500/10 text-amber-200 focus:border-amber-500/50'
                        }`}
                      />
                      {portStatus && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                          {portStatus === 'checking' && <RefreshCw size={10} className="animate-spin text-amber-400 opacity-50" />}
                          {portStatus === 'free' && <CircleCheck size={10} className="text-emerald-400" />}
                          {portStatus === 'in-use' && <CircleAlert size={10} className="text-rose-400" />}
                          <span className={`text-[8px] font-bold uppercase ${
                            portStatus === 'in-use' ? 'text-rose-400' : 
                            portStatus === 'free' ? 'text-emerald-400' : 
                            'text-amber-400 opacity-50'
                          }`}>
                            {portStatus}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-[var(--text-muted)] mb-2 uppercase tracking-tight opacity-50 text-emerald-400">Environment Variables</label>
                  <input 
                    type="text"
                    value={createModal.env}
                    onChange={(e) => setCreateModal(prev => ({ ...prev, env: e.target.value }))}
                    placeholder="e.g. NODE_ENV=production,PORT=3000"
                    className="w-full bg-black/30 border border-emerald-500/10 rounded-xl px-4 py-2.5 text-sm text-emerald-200 focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              </div>
              
              <div className="mt-4 px-6 pb-6">
                <label className="block text-xs font-black text-[var(--text-muted)] mb-2 uppercase tracking-tight opacity-50 text-indigo-400">Volume Mounts (Bind Mounts)</label>
                <input 
                  type="text"
                  value={createModal.volumes}
                  onChange={(e) => setCreateModal(prev => ({ ...prev, volumes: e.target.value }))}
                  placeholder="e.g. /home/user/conf:/etc/nginx/conf.d, data_volume:/data"
                  className="w-full bg-black/30 border border-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-indigo-200 focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                />
                <p className="mt-2 text-[10px] text-[var(--text-muted)] font-medium opacity-40">
                  Tip: Mount local folders or files to paths inside the container.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5 mt-auto">
                <button 
                  type="button" 
                  onClick={() => setCreateModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-[var(--text-muted)] hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={!createModal.image.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-all disabled:opacity-50 shadow-lg"
                >
                  Create
                </button>
              </div>
            </form>
          </MacOSModalWindow>,
          document.body
        )}

        {configEditor.isOpen && (
          <ConfigEditorModal
            file={configEditor.file}
            initialContent={configEditor.content}
            onClose={() => setConfigEditor(prev => ({ ...prev, isOpen: false }))}
            onSave={(newContent) => {
              setIsLoading(true);
              const b64 = btoa(unescape(encodeURIComponent(newContent)));
              socketRef.current.emit('docker:command', { 
                action: 'write-config', 
                args: [configEditor.containerId, configEditor.file, b64] 
              });
            }}
          />
        )}

        {pruneVolumesModal.isOpen && (
          <MacOSModalWindow
            isOpen
            title="Prune Volumes"
            icon={AlertTriangle}
            onClose={() => setPruneVolumesModal({ isOpen: false, confirmText: '' })}
            zIndexClassName="z-[9999]"
            defaultWidth={360}
            defaultHeight={200}
            maxWidthClassName="max-w-[360px]"
            closeOnOverlayClick
          >
            <div className="p-5 flex flex-col h-full bg-[var(--bg-primary)]">
              <div className="text-[13px] leading-relaxed text-[var(--text-primary)] mb-4">
                This will destroy all unused volumes and their data irreversibly.
                To confirm, type <strong className="text-rose-400">delete</strong> below:
              </div>
              <input 
                autoFocus
                type="text"
                placeholder="delete"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none font-mono text-[var(--text-primary)] focus:border-rose-500/50 transition-colors"
                value={pruneVolumesModal.confirmText}
                onChange={(e) => setPruneVolumesModal(prev => ({ ...prev, confirmText: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pruneVolumesModal.confirmText === 'delete') {
                    setIsLoading(true);
                    socketRef.current.emit('docker:command', { action: 'prune-volumes' });
                    setPruneVolumesModal({ isOpen: false, confirmText: '' });
                  }
                }}
              />
              <div className="mt-auto flex justify-end gap-2 pt-4 border-t border-white/5">
                <button 
                  onClick={() => setPruneVolumesModal({ isOpen: false, confirmText: '' })}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-[var(--text-muted)] hover:bg-white/5 transition-all"
                >Cancel</button>
                <button 
                  disabled={pruneVolumesModal.confirmText !== 'delete'}
                  onClick={() => {
                    setIsLoading(true);
                    socketRef.current.emit('docker:command', { action: 'prune-volumes' });
                    setPruneVolumesModal({ isOpen: false, confirmText: '' });
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 transition-all disabled:opacity-50"
               >Prune</button>
              </div>
            </div>
          </MacOSModalWindow>
        )}

        <style jsx>{`
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes slideDown {
            from { opacity: 0; max-height: 0; }
            to   { opacity: 1; max-height: 200px; }
          }
          @keyframes shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
    </div>
  );
}
