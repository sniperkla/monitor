'use client';

import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';
import { getLocalConnections } from '@/utils/localConnections';

const AppContext = createContext();

const initialState = {
  connections: [],
  connectionsReady: false, // true once fetchConnections has resolved at least once
  activeTerminals: [], // SSH Manager Tabs { id, connectionId, connectionName, host }
  standaloneTerminals: [], // Dedicated Terminal App { id, connectionId, connectionName, host }
  activeFileManagers: [], // { id, connectionId, connectionName }
  selectedConnection: null,
  isLoading: false,
  sidebarOpen: true,
  view: 'dashboard', // 'dashboard' | 'terminal' | 'files' | 'settings'
  storageMode: 'db', // 'db', 'localstorage', 'manual'
  clipboard: null, // { file, action: 'copy' | 'cut', sourcePath, connectionId }
  relayWarning: null, // Set when DB URI is localhost but relay agent is not running
  // Health monitoring
  mongoDown: false,           // true when local MongoDB is unreachable
  relayDown: false,           // true when local relay agent is not connected
  autoSwitchedToServer: false, // true when we auto-swapped from local to server mode
  dbConfig: {
    uri: '',    // Decrypted URI from vault (in memory only)
    tunnel: null, // SSH tunnel config from vault (in memory only)
  },
  activeDatabaseBrowsers: [], // { id, connectionId, connectionName }
  standaloneDatabaseBrowsers: [], // Dedicated Database App
  activeTerminalId: null,
  activeFileManagerId: null,
  activeDatabaseBrowserId: null,
  wikiChatWindows: [], // { id, guide }
  relayInfo: { connected: false, relays: [], checkDone: false },
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONNECTIONS':
      return { ...state, connections: action.payload };
    case 'ADD_CONNECTION':
      return { ...state, connections: [action.payload, ...state.connections] };
    case 'UPDATE_CONNECTION':
      return {
        ...state,
        connections: state.connections.map(c =>
          c._id === action.payload._id ? { ...c, ...action.payload } : c
        ),
      };
    case 'REMOVE_CONNECTION':
      return {
        ...state,
        connections: state.connections.filter(c => c._id !== action.payload),
        activeTerminals: state.activeTerminals.filter(t => t.connectionId !== action.payload),
      };
    case 'OPEN_TERMINAL':
      // Prevent duplicate terminals for the same connection
      const existingTermIndex = state.activeTerminals.findIndex(t => t.connectionId === action.payload.connectionId);
      if (existingTermIndex >= 0) {
        const updatedTerminals = [...state.activeTerminals];
        updatedTerminals[existingTermIndex] = { ...updatedTerminals[existingTermIndex], ...action.payload };
        return { 
          ...state, 
          activeTerminals: updatedTerminals,
          view: 'terminal', 
          activeTerminalId: updatedTerminals[existingTermIndex].id 
        };
      }
      return {
        ...state,
        activeTerminals: [...state.activeTerminals, action.payload],
        activeTerminalId: action.payload.id,
        view: 'terminal',
      };
    case 'CLOSE_TERMINAL':
      const newTerms = state.activeTerminals.filter(t => t.id !== action.payload);
      return {
        ...state,
        activeTerminals: newTerms,
        activeTerminalId: state.activeTerminalId === action.payload 
          ? (newTerms.length > 0 ? newTerms[newTerms.length - 1].id : null)
          : state.activeTerminalId
      };
    case 'OPEN_STANDALONE_TERMINAL':
      if (state.standaloneTerminals.find(t => t.id === action.payload.id)) return state;
      return {
        ...state,
        standaloneTerminals: [...state.standaloneTerminals, action.payload],
      };
    case 'CLOSE_STANDALONE_TERMINAL':
      return {
        ...state,
        standaloneTerminals: state.standaloneTerminals.filter(t => t.id !== action.payload),
      };
    case 'OPEN_FILE_MANAGER':
      // Prevent duplicate file managers for the same connection
      const existingFMIndex = state.activeFileManagers.findIndex(f => f.connectionId === action.payload.connectionId);
      if (existingFMIndex >= 0) {
        const updatedFMs = [...state.activeFileManagers];
        updatedFMs[existingFMIndex] = { ...updatedFMs[existingFMIndex], ...action.payload };
        return { 
          ...state, 
          activeFileManagers: updatedFMs,
          view: 'files', 
          activeFileManagerId: updatedFMs[existingFMIndex].id 
        };
      }
      return {
        ...state,
        activeFileManagers: [...state.activeFileManagers, action.payload],
        activeFileManagerId: action.payload.id,
        view: 'files',
      };
    case 'CLOSE_FILE_MANAGER':
      const newFms = state.activeFileManagers.filter(f => f.id !== action.payload);
      return {
        ...state,
        activeFileManagers: newFms,
        activeFileManagerId: state.activeFileManagerId === action.payload
          ? (newFms.length > 0 ? newFms[newFms.length - 1].id : null)
          : state.activeFileManagerId
      };
    case 'REORDER_TERMINALS': {
      const terms = [...state.activeTerminals];
      const [moved] = terms.splice(action.payload.fromIndex, 1);
      terms.splice(action.payload.toIndex, 0, moved);
      return { ...state, activeTerminals: terms };
    }
    case 'REORDER_FILE_MANAGERS': {
      const fms = [...state.activeFileManagers];
      const [moved] = fms.splice(action.payload.fromIndex, 1);
      fms.splice(action.payload.toIndex, 0, moved);
      return { ...state, activeFileManagers: fms };
    }
    case 'SELECT_CONNECTION':
      return { ...state, selectedConnection: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_VIEW':
      return { ...state, view: action.payload };
    case 'SET_STORAGE_MODE':
      if (typeof window !== 'undefined') {
        localStorage.setItem('ssh_monitor_storage_mode', action.payload);
      }
      return { ...state, storageMode: action.payload };
    case 'SET_DB_CONFIG':
      // NO LONGER stored in localStorage — only in memory via vault
      return { ...state, dbConfig: action.payload };
    case 'SET_RELAY_WARNING':
      return { ...state, relayWarning: action.payload };
    case 'SET_CLIPBOARD':
      return { ...state, clipboard: action.payload };
    case 'OPEN_DATABASE_BROWSER':
      // Avoid duplicates for same connection - but UPDATE with new settings if found
      const existingDBIndex = state.activeDatabaseBrowsers.findIndex(b => b.connectionId === action.payload.connectionId);
      if (existingDBIndex >= 0) {
        const updatedDBs = [...state.activeDatabaseBrowsers];
        updatedDBs[existingDBIndex] = { ...updatedDBs[existingDBIndex], ...action.payload };
        return { 
          ...state, 
          activeDatabaseBrowsers: updatedDBs,
          view: 'database', 
          activeDatabaseBrowserId: updatedDBs[existingDBIndex].id 
        };
      }
      return {
        ...state,
        activeDatabaseBrowsers: [...state.activeDatabaseBrowsers, action.payload],
        activeDatabaseBrowserId: action.payload.id,
        view: 'database',
      };
    case 'CLOSE_DATABASE_BROWSER':
      const newDbs = state.activeDatabaseBrowsers.filter(b => b.id !== action.payload);
      return {
        ...state,
        activeDatabaseBrowsers: newDbs,
        activeDatabaseBrowserId: state.activeDatabaseBrowserId === action.payload
          ? (newDbs.length > 0 ? newDbs[newDbs.length - 1].id : null)
          : state.activeDatabaseBrowserId
      };
    case 'OPEN_STANDALONE_DATABASE_BROWSER':
      if (state.standaloneDatabaseBrowsers.find(b => b.id === action.payload.id)) return state;
      return {
        ...state,
        standaloneDatabaseBrowsers: [...state.standaloneDatabaseBrowsers, action.payload],
      };
    case 'CLOSE_STANDALONE_DATABASE_BROWSER':
      return {
        ...state,
        standaloneDatabaseBrowsers: state.standaloneDatabaseBrowsers.filter(b => b.id !== action.payload),
      };
    case 'SET_ACTIVE_TERMINAL':
      return { ...state, activeTerminalId: action.payload };
    case 'SET_ACTIVE_FILE_MANAGER':
      return { ...state, activeFileManagerId: action.payload };
    case 'SET_ACTIVE_DATABASE_BROWSER':
      return { ...state, activeDatabaseBrowserId: action.payload };

    case 'OPEN_WIKI_CHAT':
      return { ...state, wikiChatWindows: [...state.wikiChatWindows, action.payload] };
    case 'CLOSE_WIKI_CHAT':
      return { ...state, wikiChatWindows: state.wikiChatWindows.filter(w => w.id !== action.payload) };
    case 'SET_RELAY_INFO':
      return { ...state, relayInfo: action.payload };
    case 'SET_HEALTH_STATUS':
      return {
        ...state,
        mongoDown: action.payload.mongoDown ?? state.mongoDown,
        relayDown: action.payload.relayDown ?? state.relayDown,
        autoSwitchedToServer: action.payload.autoSwitchedToServer ?? state.autoSwitchedToServer,
      };
    case 'SET_ACTIVE_TERMINALS':
      return { ...state, activeTerminals: action.payload };
    case 'SET_ACTIVE_FILE_MANAGERS':
      return { ...state, activeFileManagers: action.payload };
    case 'SET_ACTIVE_DATABASE_BROWSERS':
      return { ...state, activeDatabaseBrowsers: action.payload };
    case 'SET_ACTIVE_STANDALONE_TERMINALS':
      return { ...state, standaloneTerminals: action.payload };
    case 'SET_ACTIVE_STANDALONE_DATABASE_BROWSERS':
      return { ...state, standaloneDatabaseBrowsers: action.payload };
    case 'SET_CONNECTIONS_READY':
      return { ...state, connectionsReady: action.payload };
    case 'FETCH_CONNECTIONS': // no-op — handled by the useEffect watching this dispatch
      return state;
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { data: session } = useSession();
  const { vaultStatus, decryptedUri, decryptedTunnel } = useVault();

  const apiFetch = useCallback(async (url, options = {}) => {
    const headers = { ...options.headers };
    if (state.dbConfig?.uri) {
      headers['x-mongodb-uri'] = state.dbConfig.uri;
    }
    if (state.dbConfig?.tunnel?.enabled) {
      headers['x-vault-tunnel'] = JSON.stringify(state.dbConfig.tunnel);
    }
    if (typeof window !== 'undefined') {
      const preferredRelay = localStorage.getItem('ssh_monitor_preferred_relay');
      if (preferredRelay) {
        headers['x-preferred-relay'] = preferredRelay;
      }
      const sshMode = localStorage.getItem('ssh_monitor_ssh_mode');
      if (sshMode) {
        headers['x-ssh-mode'] = sshMode;
      }
    }
    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    
    // Check for explicit 401 Unauthorized
    if (res.status === 401) {
      console.warn('[apiFetch] 401 Unauthorized for:', url);
      throw new Error('SESSION_EXPIRED');
    }
    
    // Check if response is HTML (likely a redirect to sign-in page or error page)
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const resUrl = res.url || '';
      console.warn('[apiFetch] HTML response received:', { url, status: res.status, responseUrl: resUrl });
      // If redirected to auth pages, it's a session issue
      if (resUrl.includes('/api/auth/signin') || resUrl.includes('/api/auth/callback') || res.status === 401) {
        throw new Error('SESSION_EXPIRED');
      }
      // Otherwise it's a server error
      throw new Error('SERVER_ERROR');
    }
    
    return res;
  }, [state.dbConfig]);

  const latestRequestIdRef = useRef(0);

  const fetchConnections = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    dispatch({ type: 'SET_LOADING', payload: true });
    
    let dbConnections = [];
    let localConnections = [];

    // 1. Fetch from LocalStorage (secure client-side decrypted)
    if (typeof window !== 'undefined') {
       try {
         const secureConns = await getLocalConnections();
         if (secureConns !== null) {
           localConnections = secureConns.map(c => ({ ...c, storage: 'localstorage' }));
         }
       } catch (e) {
         console.error('Failed to parse secure local connections:', e);
       }
    }

    // 2. Fetch from DB
    try {
      const res = await apiFetch('/api/connections');
      const data = await res.json();
      
      // If a newer request has started, ignore this response
      if (requestId !== latestRequestIdRef.current) return;

      if (data.success) {
        dbConnections = data.data.map(c => ({ ...c, storage: 'db' }));
        // Clear any previous relay warning when connections load successfully
        if (!data.relayRequired) {
          dispatch({ type: 'SET_RELAY_WARNING', payload: null });
        }
        // If we previously auto-switched and DB is now reachable, clear the flag
        if (state.autoSwitchedToServer) {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: false, autoSwitchedToServer: false } });
        }
      }
      // Relay agent required — store warning so UI can prompt the user
      if (data.relayRequired) {
        dispatch({ type: 'SET_RELAY_WARNING', payload: data.relayMessage || 'Local Relay Agent is required to access localhost databases.' });

        // Auto-switch to server mode if not already there
        if (typeof window !== 'undefined') {
          const currentMode = localStorage.getItem('ssh_monitor_ssh_mode');
          if (currentMode !== 'server') {
            console.warn('[AppContext] Relay required but not available — auto-switching to server mode');
            localStorage.setItem('ssh_monitor_ssh_mode', 'server');
            dispatch({ type: 'SET_HEALTH_STATUS', payload: { relayDown: true, autoSwitchedToServer: true } });
            window.dispatchEvent(new Event('ssh-mode-changed'));
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch DB connections:', err);
      // If a newer request has started, ignore this error
      if (requestId !== latestRequestIdRef.current) return;

      // Network/DB error — mark mongo as down and auto-switch to server mode
      const isDbError = err.message && (
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('MongoNetworkError') ||
        err.message.includes('topology was destroyed') ||
        err.message.includes('buffering timed out') ||
        err.message.includes('SERVER_ERROR')
      );
      if (isDbError && typeof window !== 'undefined') {
        const currentMode = localStorage.getItem('ssh_monitor_ssh_mode');
        if (currentMode !== 'server') {
          console.warn('[AppContext] DB unreachable — auto-switching to server mode');
          localStorage.setItem('ssh_monitor_ssh_mode', 'server');
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: true, autoSwitchedToServer: true } });
          window.dispatchEvent(new Event('ssh-mode-changed'));
        } else {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: true } });
        }
      }
    }

    // 3. Update State
    console.log(`✅ [AppContext] Connections updated: ${dbConnections.length} (DB) + ${localConnections.length} (Local)`);
    dispatch({ type: 'SET_CONNECTIONS', payload: [...dbConnections, ...localConnections] });
    dispatch({ type: 'SET_CONNECTIONS_READY', payload: true }); // signal all apps that connections are loaded
    dispatch({ type: 'SET_LOADING', payload: false });
  }, [apiFetch]);

  // 1. Initialize storage mode from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mode = localStorage.getItem('ssh_monitor_storage_mode');
      if (mode) dispatch({ type: 'SET_STORAGE_MODE', payload: mode });
    }
  }, []);

  // 2. Sync DB config from Vault when vault is unlocked
  useEffect(() => {
    if (vaultStatus === 'unlocked' && decryptedUri) {
      // Only update if different to prevent loops
      if (decryptedUri !== state.dbConfig?.uri || decryptedTunnel !== state.dbConfig?.tunnel) {
        dispatch({
          type: 'SET_DB_CONFIG',
          payload: { uri: decryptedUri, tunnel: decryptedTunnel || null },
        });
      }
    } else if (vaultStatus === 'no_auth') {
      // Not logged in and no vault — ensure config is empty
      if (state.dbConfig?.uri) {
        dispatch({ type: 'SET_DB_CONFIG', payload: { uri: '', tunnel: null } });
      }
    }
  }, [vaultStatus, decryptedUri, decryptedTunnel]);


  // 3. Auto-detect local relay on mount (if discovery server running on localhost:48923)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const detectLocalRelay = async () => {
      try {
        const res = await fetch('http://127.0.0.1:48923', { signal: AbortSignal.timeout(1000) });
        const data = await res.json();
        if (data.relayName) {
          localStorage.setItem('ssh_monitor_local_relay', data.relayName);
          const currentMode = localStorage.getItem('ssh_monitor_ssh_mode');
          if (!currentMode) {
            localStorage.setItem('ssh_monitor_ssh_mode', 'local');
            window.dispatchEvent(new Event('ssh-mode-changed'));
          }
        }
      } catch (_) {}
    };
    detectLocalRelay();
  }, []);

  // 4. Auto-fetch connections when SSH mode or preferred relay changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleModeChange = () => {
      console.log('📡 [AppContext] SSH mode/relay changed — auto-fetching connections');
      fetchConnections();
    };
    window.addEventListener('ssh-mode-changed', handleModeChange);
    return () => window.removeEventListener('ssh-mode-changed', handleModeChange);
  }, [fetchConnections]);

  // 5. Auto-refresh connections when DB Config changes or on Mount
  useEffect(() => {
    console.log(`📡 [AppContext] Fetching connections (URI: ${state.dbConfig?.uri ? 'PRIVATE' : 'CENTER'})`);
    fetchConnections();
  }, [state.dbConfig?.uri, fetchConnections]);


  // 4. Persistence: Load active workspace state from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedTerms = localStorage.getItem('ssh_monitor_active_terminals');
      if (savedTerms) {
        const terms = JSON.parse(savedTerms);
        if (Array.isArray(terms) && terms.length > 0) {
          dispatch({ type: 'SET_ACTIVE_TERMINALS', payload: terms });
        }
      }
      const savedFms = localStorage.getItem('ssh_monitor_active_file_managers');
      if (savedFms) {
        const fms = JSON.parse(savedFms);
        if (Array.isArray(fms) && fms.length > 0) {
          dispatch({ type: 'SET_ACTIVE_FILE_MANAGERS', payload: fms });
        }
      }
      const savedDbs = localStorage.getItem('ssh_monitor_active_database_browsers');
      if (savedDbs) {
        const dbs = JSON.parse(savedDbs);
        if (Array.isArray(dbs) && dbs.length > 0) {
          dispatch({ type: 'SET_ACTIVE_DATABASE_BROWSERS', payload: dbs });
        }
      }
      const savedStandaloneTerms = localStorage.getItem('ssh_monitor_standalone_terminals');
      if (savedStandaloneTerms) {
        const terms = JSON.parse(savedStandaloneTerms);
        if (Array.isArray(terms) && terms.length > 0) {
          dispatch({ type: 'SET_ACTIVE_STANDALONE_TERMINALS', payload: terms });
        }
      }
      const savedStandaloneDbs = localStorage.getItem('ssh_monitor_standalone_database_browsers');
      if (savedStandaloneDbs) {
        const dbs = JSON.parse(savedStandaloneDbs);
        if (Array.isArray(dbs) && dbs.length > 0) {
          dispatch({ type: 'SET_ACTIVE_STANDALONE_DATABASE_BROWSERS', payload: dbs });
        }
      }
      const savedActiveTermId = localStorage.getItem('ssh_monitor_active_terminal_id');
      if (savedActiveTermId) dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: savedActiveTermId });
      
      const savedActiveDbId = localStorage.getItem('ssh_monitor_active_database_browser_id');
      if (savedActiveDbId) dispatch({ type: 'SET_ACTIVE_DATABASE_BROWSER', payload: savedActiveDbId });
      
      const savedActiveFmId = localStorage.getItem('ssh_monitor_active_file_manager_id');
      if (savedActiveFmId) dispatch({ type: 'SET_ACTIVE_FILE_MANAGER', payload: savedActiveFmId });
      
      const savedView = localStorage.getItem('ssh_monitor_active_view');
      if (savedView) dispatch({ type: 'SET_VIEW', payload: savedView });
    } catch (e) {
      console.error('Failed to restore workspace state:', e);
    }
  }, []);

  // 5. Fetch relay status once on mount & prioritize local relay if connected
  useEffect(() => {
    fetch('/api/relay/token')
      .then(r => r.json())
      .then(data => {
        const isConnected = data.connected || false;
        dispatch({
          type: 'SET_RELAY_INFO',
          payload: { connected: isConnected, relays: data.relays || [], checkDone: true },
        });
        if (isConnected && typeof window !== 'undefined') {
          const currentMode = localStorage.getItem('ssh_monitor_ssh_mode');
          if (!currentMode || currentMode !== 'local') {
            localStorage.setItem('ssh_monitor_ssh_mode', 'local');
            window.dispatchEvent(new Event('ssh-mode-changed'));
          }
        }
      })
      .catch(() => {
        dispatch({ type: 'SET_RELAY_INFO', payload: { connected: false, relays: [], checkDone: true } });
      });
  }, []);

  // 6. Health polling — every 20 seconds, detect MongoDB dead + relay dead, auto-switch
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let consecutiveFailures = 0;
    const MAX_FAILURES_BEFORE_SWITCH = 2; // switch after 2 consecutive failures (~40s)

    const pollHealth = async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        const data = await res.json();

        const mongoUp = data.mongo?.up ?? res.ok;
        const relayUp = data.relay?.up ?? false;

        if (!mongoUp) {
          consecutiveFailures++;
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: true } });
          // NOTE: We do NOT auto-switch SSH mode here — MongoDB downtime is a server-side
          // issue unrelated to SSH relay mode. Switching would disconnect all active terminals.
        } else {
          // MongoDB is back up
          if (consecutiveFailures > 0) {
            consecutiveFailures = 0;
            dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: false } });
          }
        }

        if (!relayUp) {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { relayDown: true } });
        } else {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { relayDown: false } });
        }
      } catch (_) {
        // /api/health itself unreachable (server down) — don't flip state aggressively
        consecutiveFailures++;
      }
    };

    // Poll immediately then every 20 seconds
    pollHealth();
    const interval = setInterval(pollHealth, 20000);
    return () => clearInterval(interval);
  }, []);

  // 6. Persistence: Save active workspace state to localStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('ssh_monitor_active_terminals', JSON.stringify(state.activeTerminals));
      localStorage.setItem('ssh_monitor_active_file_managers', JSON.stringify(state.activeFileManagers));
      localStorage.setItem('ssh_monitor_active_database_browsers', JSON.stringify(state.activeDatabaseBrowsers));
      localStorage.setItem('ssh_monitor_standalone_terminals', JSON.stringify(state.standaloneTerminals));
      localStorage.setItem('ssh_monitor_standalone_database_browsers', JSON.stringify(state.standaloneDatabaseBrowsers));
      localStorage.setItem('ssh_monitor_active_terminal_id', state.activeTerminalId || '');
      localStorage.setItem('ssh_monitor_active_database_browser_id', state.activeDatabaseBrowserId || '');
      localStorage.setItem('ssh_monitor_active_file_manager_id', state.activeFileManagerId || '');
      localStorage.setItem('ssh_monitor_active_view', state.view);
    } catch (e) {
      console.error('Failed to save workspace state:', e);
    }
  }, [state.activeTerminals, state.activeFileManagers, state.activeDatabaseBrowsers, state.standaloneTerminals, state.standaloneDatabaseBrowsers, state.activeTerminalId, state.activeDatabaseBrowserId, state.activeFileManagerId, state.view]);

  return (
    <AppContext.Provider value={{ state, dispatch, fetchConnections, apiFetch, relayInfo: state.relayInfo, connectionsReady: state.connectionsReady, mongoDown: state.mongoDown, relayDown: state.relayDown, autoSwitchedToServer: state.autoSwitchedToServer }}>
      {children}
    </AppContext.Provider>
  );

}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
