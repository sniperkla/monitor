'use client';

import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';
import { getLocalConnections } from '@/utils/localConnections';

const AppContext = createContext();

const initialState = {
  connections: [],
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
    }
    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Session expired or server error');
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
      }
      // Relay agent required — store warning so UI can prompt the user
      if (data.relayRequired) {
        dispatch({ type: 'SET_RELAY_WARNING', payload: data.relayMessage || 'Local Relay Agent is required to access localhost databases.' });
      }
    } catch (err) {
      console.error('Failed to fetch DB connections:', err);
      // If a newer request has started, ignore this error
      if (requestId !== latestRequestIdRef.current) return;
    }

    // 3. Update State
    console.log(`✅ [AppContext] Connections updated: ${dbConnections.length} (DB) + ${localConnections.length} (Local)`);
    dispatch({ type: 'SET_CONNECTIONS', payload: [...dbConnections, ...localConnections] });
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


  // 3. Auto-refresh connections when DB Config changes or on Mount
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

  // 5. Fetch relay status once on mount
  useEffect(() => {
    fetch('/api/relay/token')
      .then(r => r.json())
      .then(data => {
        dispatch({
          type: 'SET_RELAY_INFO',
          payload: { connected: data.connected || false, relays: data.relays || [], checkDone: true },
        });
      })
      .catch(() => {
        dispatch({ type: 'SET_RELAY_INFO', payload: { connected: false, relays: [], checkDone: true } });
      });
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
    <AppContext.Provider value={{ state, dispatch, fetchConnections, apiFetch, relayInfo: state.relayInfo }}>
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
