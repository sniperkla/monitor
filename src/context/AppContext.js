'use client';

import { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';

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
      // Avoid duplicates for same connection - but UPDATE with new settings if found
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
      // Avoid duplicates for same connection - but UPDATE with new settings if found
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
    return fetch(url, { ...options, headers, credentials: 'include' });
  }, [state.dbConfig?.uri, state.dbConfig?.tunnel]);

  const fetchConnections = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    
    let dbConnections = [];
    let localConnections = [];

    // 1. Fetch from LocalStorage (for backward compatibility)
    if (typeof window !== 'undefined') {
       const saved = localStorage.getItem('ssh_monitor_connections');
       if (saved) {
         localConnections = JSON.parse(saved).map(c => ({ ...c, storage: 'localstorage' }));
       }
    }

    // 2. Fetch from DB
    try {
      const res = await apiFetch('/api/connections');
      const data = await res.json();
      if (data.success) {
        dbConnections = data.data.map(c => ({ ...c, storage: 'db' }));
      }
    } catch (err) {
      console.error('Failed to fetch DB connections:', err);
    }

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

  // 3. Auto-refresh connections when DB Config changes
  useEffect(() => {
    fetchConnections();
  }, [state.dbConfig?.uri, fetchConnections]);

  return (
    <AppContext.Provider value={{ state, dispatch, fetchConnections, apiFetch }}>
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
