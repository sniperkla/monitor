'use client';

import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useVault } from '@/context/VaultContext';
import { getLocalConnections } from '@/utils/localConnections';
import { dedupedFetch, clearDedupCache } from '@/utils/requestDedup';
import { fetchRelayStatus, onRelayStatusRefresh } from '@/utils/relayStatus';

const AppContext = createContext();

// Relay status cadence. The relay is installed from a terminal on the user's
// own machine, so the browser has to go looking for it. Poll briskly while it
// is missing (that is the window right after an install), relax once it is
// attached, and go quiet while the tab is hidden — the visibility handler
// below forces an immediate re-check the moment the tab is looked at again,
// which is precisely when someone returns from running the installer.
const RELAY_POLL_WAITING_MS = 5000;   // relay not attached yet
const RELAY_POLL_CONNECTED_MS = 20000; // relay attached — just watch for drops
const RELAY_POLL_HIDDEN_MS = 60000;    // tab in the background
const HEALTH_POLL_MS = 20000;          // MongoDB liveness
// ~2 minutes of brisk polling after a relay goes missing, then ease off.
const RELAY_FAST_POLL_TICKS = 24;

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
    // Route through the request-dedup layer so duplicate GETs (and
    // overlapping in-flight requests of any method) are coalesced at the
    // network layer. Callers can opt out per-call with `{ dedup: false }`.
    const res = await dedupedFetch(
      url,
      { ...options, headers, credentials: 'include' },
      async (u, o) => {
        const r = await fetch(u, o);

        // Check for explicit 401 Unauthorized
        if (r.status === 401) {
          console.warn('[apiFetch] 401 Unauthorized for:', u);
          throw new Error('SESSION_EXPIRED');
        }

        // Check if response is HTML (likely a redirect to sign-in page or error page)
        const contentType = r.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          const resUrl = r.url || '';
          console.warn('[apiFetch] HTML response received:', { url: u, status: r.status, responseUrl: resUrl });
          // If redirected to auth pages, it's a session issue
          if (resUrl.includes('/api/auth/signin') || resUrl.includes('/api/auth/callback') || r.status === 401) {
            throw new Error('SESSION_EXPIRED');
          }
          // Otherwise it's a server error
          throw new Error('SERVER_ERROR');
        }

        return r;
      },
    );

    return res;
  }, [state.dbConfig]);

  const latestRequestIdRef = useRef(0);

  const fetchConnections = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    // A previous request may have completed while the vault was still locked
    // or while a local relay was reconnecting. Treat every refresh as pending
    // until it settles so dependent apps never mistake a stale empty list for
    // a usable connection inventory.
    dispatch({ type: 'SET_CONNECTIONS_READY', payload: false });
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

  // Stable handle on fetchConnections for the polling loops below. Keying those
  // effects on the callback itself would tear down and restart the timers on
  // every dbConfig change, and each restart would look like a fresh "first
  // reading" — which is precisely the state that must not fire a refetch.
  const fetchConnectionsRef = useRef(fetchConnections);
  useEffect(() => { fetchConnectionsRef.current = fetchConnections; }, [fetchConnections]);

  // Mirrors of the health flags, kept in sync from state so the pollers can
  // skip no-op dispatches. Other code paths (the relayRequired branch in
  // fetchConnections, the banner's retry) also move these flags, so the mirror
  // has to follow state rather than being owned by the poller.
  const relayDownRef = useRef(state.relayDown);
  useEffect(() => { relayDownRef.current = state.relayDown; }, [state.relayDown]);
  const mongoDownRef = useRef(state.mongoDown);
  useEffect(() => { mongoDownRef.current = state.mongoDown; }, [state.mongoDown]);

  // 1. Initialize storage mode from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mode = localStorage.getItem('ssh_monitor_storage_mode');
      if (mode) dispatch({ type: 'SET_STORAGE_MODE', payload: mode });
    }
  }, []);

  // 2. Sync DB config from Vault when vault is unlocked.
  // This effect must ONLY sync config — it must NOT call fetchConnections().
  // It keys on dbConfig identity, and effect 5 below also refetches on
  // dbConfig.uri, so fetching here fires a DUPLICATE request on every unlock.
  // The transition refetch now lives in its own effect (2b) below.
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
  }, [vaultStatus, decryptedUri, decryptedTunnel, state.dbConfig?.uri, state.dbConfig?.tunnel]);

  // 2b. Refetch EXACTLY ONCE on the locked/setup -> unlocked transition.
  // Any fetch that ran before unlock went out WITHOUT the x-mongodb-uri header
  // (center DB), leaving a stale/empty connection list until a full reload.
  // Leaving unlocked clears the dedup cache so a second user on this browser
  // cannot be served the previous user's cached GET responses.
  const prevVaultStatusRef = useRef(null);
  useEffect(() => {
    const prev = prevVaultStatusRef.current;
    prevVaultStatusRef.current = vaultStatus;
    if (prev === null) return; // first pass — effect 5 already fetches on mount
    if (prev === 'unlocked') {
      clearDedupCache();
      return;
    }
    if (vaultStatus === 'unlocked') fetchConnections();
  }, [vaultStatus, fetchConnections]);


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

  // 4. Auto-fetch connections when SSH mode or preferred relay changes (deduplicated)
  const prevModeRef = useRef(typeof window !== 'undefined' ? `${localStorage.getItem('ssh_monitor_ssh_mode') || ''}:${localStorage.getItem('ssh_monitor_preferred_relay') || ''}` : '');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleModeChange = () => {
      const curMode = `${localStorage.getItem('ssh_monitor_ssh_mode') || ''}:${localStorage.getItem('ssh_monitor_preferred_relay') || ''}`;
      if (prevModeRef.current === curMode) return;
      prevModeRef.current = curMode;
      console.log('📡 [AppContext] SSH mode/relay changed — auto-fetching connections');
      fetchConnections();
    };
    window.addEventListener('ssh-mode-changed', handleModeChange);
    return () => window.removeEventListener('ssh-mode-changed', handleModeChange);
  }, [fetchConnections]);

  // 5. Load the shared inventory only after authentication has resolved. This
  // avoids caching the unauthenticated/empty response obtained during the
  // initial SessionProvider loading phase; without this gate, connection-aware
  // apps can render an empty picker until SSH Manager happens to force a retry.
  const sessionStatus = session === undefined ? 'loading' : (session ? 'authenticated' : 'unauthenticated');
  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated') {
      dispatch({ type: 'SET_CONNECTIONS', payload: [] });
      dispatch({ type: 'SET_CONNECTIONS_READY', payload: true });
      return;
    }
    console.log(`📡 [AppContext] Fetching connections after session ready (URI: ${state.dbConfig?.uri ? 'PRIVATE' : 'CENTER'})`);
    fetchConnections();
  }, [sessionStatus, state.dbConfig?.uri, fetchConnections]);


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

  // 5. Relay status — user-scoped and CONTINUOUSLY polled.
  //
  // This used to fetch /api/relay/token exactly once on mount. The install runs
  // in a terminal on the user's own machine and the browser is never told it
  // finished, so every consumer of relayInfo stayed stale: the sidebar kept
  // saying "Relay not connected / Local relay agent is offline" until something
  // happened to force a refetch.
  //
  // Relay liveness is deliberately NOT taken from /api/health — that endpoint
  // reports `global.__activeRelays?.size > 0`, i.e. whether ANY tenant has a
  // relay attached, which is the wrong question on a multi-user server.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Unauthenticated callers get a 401 from /api/relay/token — nothing to poll.
    if (sessionStatus === 'loading' || sessionStatus === 'unauthenticated') return;

    let cancelled = false;
    let timer = null;
    let inFlight = false;
    // null = never resolved yet. Distinguishes "first reading" from a real
    // down -> up transition, which is the only one worth refetching for.
    let lastConnected = null;
    // Consecutive "still missing" readings. Drives a gentle backoff: /api/relay/token
    // costs a DB lookup plus a supporter check, so a tab parked in local mode
    // with no relay must not poll it every 5s forever.
    let missingTicks = 0;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const applyStatus = (connected, relays) => {
      dispatch({
        type: 'SET_RELAY_INFO',
        payload: { connected, relays, checkDone: true },
      });

      if (connected) missingTicks = 0;

      if (!connected) {
        // "Relay is down" only means something if this browser actually wants
        // one. Now that this flag is correct per-user (it used to come from
        // /api/health, whose global count was wrong in both directions),
        // setting it unconditionally would nag every server-mode user who
        // never installed a relay. Intent = local mode, an explicitly chosen
        // relay, or a relay discovered on this machine.
        const wantsRelay =
          localStorage.getItem('ssh_monitor_ssh_mode') === 'local' ||
          !!localStorage.getItem('ssh_monitor_preferred_relay') ||
          !!localStorage.getItem('ssh_monitor_local_relay');
        if (wantsRelay && !relayDownRef.current) {
          relayDownRef.current = true;
          dispatch({ type: 'SET_HEALTH_STATUS', payload: { relayDown: true } });
        }
        missingTicks++;
        lastConnected = false;
        return;
      }

      // Relay (re)attached. Pin this browser to local mode and to the relay
      // that just appeared, BEFORE any refetch: apiFetch reads both keys from
      // localStorage at call time, so writing them afterwards would route the
      // request through the previous relay — or through none at all.
      let changed = false;
      // An explicit "continue with direct connection" (cloud server / phone)
      // outranks auto-pinning. Without this the poll below would flip the mode
      // straight back to 'local' a few seconds later, undoing the user's choice
      // — a phone can never run a relay, so it would be stuck on local mode
      // and every request would keep trying a relay it cannot use.
      const relayOptedOut = localStorage.getItem('ssh_monitor_relay_optout') === '1';
      if (!relayOptedOut && localStorage.getItem('ssh_monitor_ssh_mode') !== 'local') {
        localStorage.setItem('ssh_monitor_ssh_mode', 'local');
        changed = true;
      }
      // Preserve an explicitly selected relay while it is still connected.
      // The status endpoint may reorder relays between polls; blindly taking
      // relays[0] made switching to a different Mac appear to work, then
      // silently switched the browser back a few seconds later.
      const savedPreferred = localStorage.getItem('ssh_monitor_preferred_relay');
      const preferred = savedPreferred
        ? relays.find((relay) => (relay.relayName || relay.relayId) === savedPreferred)
        : null;
      const selected = preferred || relays[0] || null;
      const relayName = selected ? (selected.relayName || selected.relayId) : null;
      if (relayName && savedPreferred !== relayName) {
        localStorage.setItem('ssh_monitor_preferred_relay', relayName);
        changed = true;
      }

      if (relayDownRef.current) {
        relayDownRef.current = false;
        dispatch({
          type: 'SET_HEALTH_STATUS',
          payload: { relayDown: false, autoSwitchedToServer: false },
        });
      }

      if (changed) window.dispatchEvent(new Event('ssh-mode-changed'));

      // A genuine recovery, or a first reading that changed which relay this
      // browser should route through. Mount already fetched, so a first
      // reading that changes nothing must not fire a duplicate request.
      if (lastConnected === false || changed) fetchConnectionsRef.current();

      lastConnected = true;
    };

    const tick = async () => {
      if (cancelled) return;
      if (inFlight) { schedule(); return; }
      inFlight = true;
      try {
        const { connected, relays } = await fetchRelayStatus();
        if (!cancelled) applyStatus(connected, relays);
      } catch (_) {
        // Transient failure — keep the last known state instead of flapping
        // the banner on every dropped request.
      } finally {
        inFlight = false;
      }
      schedule();
    };

    const schedule = () => {
      clearTimer();
      if (cancelled) return;
      let delay;
      if (document.hidden) {
        delay = RELAY_POLL_HIDDEN_MS;
      } else if (lastConnected) {
        delay = RELAY_POLL_CONNECTED_MS;
      } else {
        // Briskly at first — that is the window right after an install — then
        // ease off. A tab permanently parked in local mode with no relay must
        // not poll a DB-backed endpoint every 5s forever.
        delay = missingTicks < RELAY_FAST_POLL_TICKS
          ? RELAY_POLL_WAITING_MS
          : RELAY_POLL_CONNECTED_MS;
      }
      timer = setTimeout(tick, delay);
    };

    tick();

    // Wake up the instant the tab is looked at again — that is exactly when
    // someone comes back from running the installer in their terminal.
    const onVisible = () => {
      if (document.hidden) return;
      clearTimer();
      // Coming back to the tab is the likeliest moment an install just
      // finished, so give it the brisk cadence again rather than whatever
      // backoff it had decayed to.
      missingTicks = 0;
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    // Anything that just changed relay state (pairing approval, install
    // wizard finishing) asks for an immediate re-read.
    const offRefresh = onRelayStatusRefresh(onVisible);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      offRefresh();
    };
  }, [sessionStatus]);

  // 6. MongoDB liveness — every 20 seconds.
  //
  // The interval here was missing entirely: despite the comment, only a single
  // mount-time call ran, so a mongod that died after startup was never noticed.
  // Relay health is intentionally absent — see effect 5 for why /api/health's
  // global relay count is not a usable per-user signal.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const pollHealth = async () => {
      // Skip while the page is hidden (phone locked / tab backgrounded)
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/health', {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        const mongoUp = data.mongo?.up ?? res.ok;
        // Only dispatch on an actual change — SET_HEALTH_STATUS always returns
        // a fresh state object, and doing that on a 20s timer re-renders every
        // consumer in the tree for nothing.
        if (mongoUp === !mongoDownRef.current) return;
        mongoDownRef.current = !mongoUp;
        dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: !mongoUp } });
        // NOTE: we do NOT auto-switch SSH mode here — MongoDB downtime is a
        // server-side issue unrelated to relay mode. Switching would drop
        // every active terminal.
      } catch (_) {
        // /api/health itself unreachable (server down) — don't flip state.
      }
    };

    pollHealth();
    const id = setInterval(pollHealth, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
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

  // Memoize the context value. Without this, every AppProvider render produces a
  // NEW object, re-rendering EVERY consumer in the tree — including renders that
  // come from VaultProvider above us, where `state` has not changed at all.
  // That re-render storm is what turns any unstable dep anywhere in the app into
  // a request loop. `dispatch` is stable and `state` only changes on dispatch,
  // so this memo now only invalidates on a genuine state change.
  const value = useMemo(() => ({
    state,
    dispatch,
    fetchConnections,
    apiFetch,
    relayInfo: state.relayInfo,
    connectionsReady: state.connectionsReady,
    mongoDown: state.mongoDown,
    relayDown: state.relayDown,
    autoSwitchedToServer: state.autoSwitchedToServer,
  }), [
    state,
    dispatch,
    fetchConnections,
    apiFetch,
    state.relayInfo,
    state.connectionsReady,
    state.mongoDown,
    state.relayDown,
    state.autoSwitchedToServer,
  ]);

  return (
    <AppContext.Provider value={value}>
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
