'use client';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import {
  Server, Star, StarOff, Wifi, WifiOff, Clock, MoreVertical, Terminal, Edit, Trash2,  
  RotateCw, Plus, Search, Filter, Key, Lock, BarChart3, TrendingUp, Zap, RefreshCw, Folder, Box, AlertTriangle, X, Database,
  PanelLeftClose, PanelLeft, CloudUpload, CloudDownload, Check, Cpu, MemoryStick, HardDrive
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import { useVault } from '@/context/VaultContext';
import { encryptWithPassword } from '@/utils/clientCrypto';
import { getLocalConnections, saveLocalConnections } from '@/utils/localConnections';
import MongoDeadBanner from '@/components/MongoDeadBanner';

export default function Sidebar({ onNewConnection, onEditConnection }) {
  const { state, dispatch, fetchConnections, apiFetch } = useApp();
  const { state: osState, addNotification, showConfirm, closeWindow } = useOS();
  const { getMasterPassword, isUnlocked } = useVault();
  const { t } = useTranslation();
  const { connections, sidebarOpen } = state;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, favorites, online, offline
  const [activeSection, setActiveSection] = useState('all'); // all, ssh, database
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [cloudProgress, setCloudProgress] = useState(null); // { current, total, done, error }
  const [syncedFingerprints, setSyncedFingerprints] = useState(new Set());
  const [fetchingSpecs, setFetchingSpecs] = useState(new Set());
  const [hoverPanel, setHoverPanel] = useState(null); // { conn, x, y }
  const [menuPosition, setMenuPosition] = useState(null);
  const hoverTimerRef = useRef(null);
  const hoverPanelRef = useRef(null);

  // Generate a fingerprint for dedup (hash of name+host+type)
  const getFingerprint = (conn) => {
    const raw = `${conn.name || ''}|${conn.host || ''}|${conn.type || ''}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  };

  // Fetch synced fingerprints from server
  const fetchSyncedFingerprints = async () => {
    try {
      const res = await apiFetch('/api/user/synced-connections');
      if (res.ok) {
        const data = await res.json();
        setSyncedFingerprints(new Set((data.connections || []).map(c => c.fingerprint)));
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (isUnlocked) fetchSyncedFingerprints();
  }, [isUnlocked]);

  // Alert user when vault password changes — old synced connections are now undecryptable
  useEffect(() => {
    const handlePasswordChanged = () => {
      setSyncedFingerprints(new Set());
      addNotification({
        title: 'Vault Password Changed',
        message: 'Your synced connections were cleared. Please re-sync with your new password.',
        type: 'warning',
      });
    };
    window.addEventListener('vault-password-changed', handlePasswordChanged);
    return () => window.removeEventListener('vault-password-changed', handlePasswordChanged);
  }, [addNotification]);

  // Sync all connections to server (encrypted with vault master password)
  const handleSyncAll = async () => {
    const masterPwd = getMasterPassword();
    if (!masterPwd) {
      addNotification({ title: 'Vault Locked', message: 'Unlock your vault first to sync connections.', type: 'warning' });
      return;
    }

    if (connections.length === 0) {
      addNotification({ title: 'Nothing to Sync', message: 'No connections found to sync.', type: 'info' });
      return;
    }

    setIsSyncing(true);
    try {
      const encrypted = [];
      for (const conn of connections) {
        // For db connections, fetch full data (with encrypted password) from server
        let fullConn = conn;
        if (conn.storage === 'db' && conn._id) {
          try {
            const res = await apiFetch(`/api/connections/${conn._id}`);
            const data = await res.json();
            if (data.success && data.data) fullConn = data.data;
          } catch (_) { /* use sanitized data as fallback */ }
        }

        const payload = JSON.stringify({
          host: fullConn.host, port: fullConn.port, username: fullConn.username,
          authType: fullConn.authType, password: fullConn.password, privateKey: fullConn.privateKey,
          passphrase: fullConn.passphrase, database: fullConn.database, dbProvider: fullConn.dbProvider,
          isSrv: fullConn.isSrv, authSource: fullConn.authSource, dbOptions: fullConn.dbOptions,
          sshTunnel: fullConn.sshTunnel, sshTunnelHost: fullConn.sshTunnelHost, sshTunnelPort: fullConn.sshTunnelPort,
          sshTunnelUser: fullConn.sshTunnelUser, sshTunnelAuth: fullConn.sshTunnelAuth,
          sshTunnelPassword: fullConn.sshTunnelPassword, sshTunnelPrivateKey: fullConn.sshTunnelPrivateKey,
          sshTunnelPassphrase: fullConn.sshTunnelPassphrase, tags: fullConn.tags, color: fullConn.color,
          notes: fullConn.notes, keyFileName: fullConn.keyFileName,
        });
        const { encrypted: enc, salt, iv } = await encryptWithPassword(payload, masterPwd);
        encrypted.push({
          fingerprint: getFingerprint(conn),
          name: conn.name, host: conn.host, type: conn.type,
          encryptedData: enc, salt, iv,
        });
      }

      const res = await apiFetch('/api/user/synced-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connections: encrypted }),
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Synced', message: `${data.added} added, ${data.updated} updated.`, type: 'success' });
        setSyncedFingerprints(new Set(encrypted.map(c => c.fingerprint)));
      } else {
        addNotification({ title: 'Sync Failed', message: data.error || 'Unknown error', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Sync Error', message: err.message, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync a single connection
  const handleSyncOne = async (conn) => {
    const masterPwd = getMasterPassword();
    if (!masterPwd) {
      addNotification({ title: 'Vault Locked', message: 'Unlock your vault first.', type: 'warning' });
      return;
    }

    try {
      // For db connections, fetch full data (with encrypted password) from server
      let fullConn = conn;
      if (conn.storage === 'db' && conn._id) {
        try {
          const res = await apiFetch(`/api/connections/${conn._id}`);
          const data = await res.json();
          if (data.success && data.data) fullConn = data.data;
        } catch (_) { /* use sanitized data as fallback */ }
      }

      const payload = JSON.stringify({
        host: fullConn.host, port: fullConn.port, username: fullConn.username,
        authType: fullConn.authType, password: fullConn.password, privateKey: fullConn.privateKey,
        passphrase: fullConn.passphrase, database: fullConn.database, dbProvider: fullConn.dbProvider,
        isSrv: fullConn.isSrv, authSource: fullConn.authSource, dbOptions: fullConn.dbOptions,
        sshTunnel: fullConn.sshTunnel, sshTunnelHost: fullConn.sshTunnelHost, sshTunnelPort: fullConn.sshTunnelPort,
        sshTunnelUser: fullConn.sshTunnelUser, sshTunnelAuth: fullConn.sshTunnelAuth,
        sshTunnelPassword: fullConn.sshTunnelPassword, sshTunnelPrivateKey: fullConn.sshTunnelPrivateKey,
        sshTunnelPassphrase: fullConn.sshTunnelPassphrase, tags: fullConn.tags, color: fullConn.color,
        notes: fullConn.notes, keyFileName: fullConn.keyFileName,
      });
      const { encrypted: enc, salt, iv } = await encryptWithPassword(payload, masterPwd);
      const fp = getFingerprint(conn);

      const res = await apiFetch('/api/user/synced-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connections: [{
          fingerprint: fp, name: conn.name, host: conn.host, type: conn.type,
          encryptedData: enc, salt, iv,
        }] }),
      });
      const data = await res.json();
      if (data.success) {
        addNotification({ title: 'Synced', message: `"${conn.name}" synced to server.`, type: 'success' });
        setSyncedFingerprints(prev => new Set([...prev, fp]));
      }
    } catch (err) {
      addNotification({ title: 'Sync Error', message: err.message, type: 'error' });
    }
  };

  // Pull synced connections from server (decrypt with vault master password)
  const handlePullSynced = async () => {
    const masterPwd = getMasterPassword();
    if (!masterPwd) {
      addNotification({ title: 'Vault Locked', message: 'Unlock your vault first to pull connections.', type: 'warning' });
      return;
    }

    setIsSyncing(true);
    try {
      const res = await apiFetch('/api/user/synced-connections');
      const data = await res.json();
      if (!data.connections || data.connections.length === 0) {
        addNotification({ title: 'No Synced Data', message: 'No synced connections found on server.', type: 'info' });
        return;
      }

      // Live-probe the DB reachability instead of relying on cached storageMode preference.
      // If /api/connections returns relayRequired=true the relay/DB is not reachable on this
      // machine, so we fall back to localStorage. Otherwise we save straight to the DB so
      // pulled connections always get the "DB" tag when the local relay is active.
      let existing = [];
      let dbReachable = false;
      try {
        const existingRes = await apiFetch('/api/connections');
        const existingData = await existingRes.json();
        if (existingData.success && !existingData.relayRequired) {
          dbReachable = true;
          existing = existingData.data || [];
        }
      } catch (_) {}

      // Also include localStorage connections to prevent cross-storage duplicates
      try {
        const localConns = (await getLocalConnections()) || [];
        for (const lc of localConns) {
          if (!existing.some(e => e.name === lc.name && e.host === lc.host && e.type === lc.type)) {
            existing.push(lc);
          }
        }
      } catch (_) {}

      let imported = 0;
      let usedFallback = false;

      for (const sc of data.connections) {
        try {
          const decrypted = await import('@/utils/clientCrypto').then(m => m.decryptWithPassword(sc.encryptedData, sc.salt, sc.iv, masterPwd));
          const parsed = JSON.parse(decrypted);
          const alreadyExists = existing.some(e => e.name === sc.name && e.host === sc.host && e.type === sc.type);
          if (alreadyExists) continue;

          if (dbReachable) {
            // DB is live — save there so the connection gets the "DB" tag
            try {
              const saveRes = await apiFetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: sc.name,
                  type: sc.type || 'ssh',
                  host: parsed.host,
                  port: parsed.port,
                  username: parsed.username,
                  authType: parsed.authType,
                  password: parsed.password,
                  privateKey: parsed.privateKey,
                  passphrase: parsed.passphrase,
                  database: parsed.database,
                  dbProvider: parsed.dbProvider,
                  tags: parsed.tags,
                  color: parsed.color,
                  notes: parsed.notes,
                  keyFileName: parsed.keyFileName,
                  relayName: null,
                }),
              });
              const saveData = await saveRes.json();
              if (!saveData.success) throw new Error(saveData.error);
            } catch (dbErr) {
              // DB write failed mid-way — fall back to localStorage for this entry
              console.warn(`DB save failed for "${sc.name}", saving to localStorage:`, dbErr.message);
              existing.push({ ...parsed, name: sc.name, type: sc.type, storage: 'localstorage', _id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}` });
              usedFallback = true;
            }
          } else {
            // DB not reachable (relay offline / no relay installed) — use localStorage as fallback
            existing.push({ ...parsed, name: sc.name, type: sc.type, storage: 'localstorage', _id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}` });
            usedFallback = true;
          }
          imported++;
        } catch (err) { console.error(`Skip "${sc.name}":`, err.message); }
      }

      if (usedFallback) {
        await saveLocalConnections(existing.filter(c => c.storage === 'localstorage'));
      }
      fetchConnections();
      const storage = dbReachable && !usedFallback
        ? 'database (local relay)'
        : usedFallback && dbReachable
        ? 'database + local storage (some DB writes failed)'
        : 'local storage (relay not connected)';
      addNotification({ title: 'Pulled', message: `${imported} connection(s) imported to ${storage}.`, type: 'success' });
    } catch (err) {
      addNotification({ title: 'Pull Error', message: err.message, type: 'error' });
    } finally {
      setIsSyncing(false);
    }
  };

  // Export / Import state — moved to Dashboard

  // Save ALL connections to cloud with highest-sensitivity E2E encryption
  // Uses Argon2id (64 MB, 3 iterations) + AES-256-GCM — same as vault
  const handleSaveToCloud = async () => {
    const masterPwd = getMasterPassword();
    if (!masterPwd) {
      addNotification({ title: 'Vault Locked', message: 'Unlock your vault first to save to cloud.', type: 'warning' });
      return;
    }

    if (connections.length === 0) {
      addNotification({ title: 'Nothing to Save', message: 'No connections found.', type: 'info' });
      return;
    }

    setIsMigrating(true);
    setCloudProgress({ current: 0, total: connections.length, done: false, error: null });

    try {
      const encrypted = [];
      let i = 0;

      for (const conn of connections) {
        i++;
        setCloudProgress(prev => ({ ...prev, current: i }));

        // Skip manual/temporary connections
        if (conn.storage === 'manual') continue;

        // Fetch full sensitive data from server for DB-stored connections
        let fullConn = conn;
        if (conn.storage === 'db' && conn._id) {
          try {
            const res = await apiFetch(`/api/connections/${conn._id}`);
            const data = await res.json();
            if (data.success && data.data) fullConn = data.data;
          } catch (_) { /* use sanitized fallback */ }
        }

        // Build the full payload with all sensitive fields
        const payload = JSON.stringify({
          host: fullConn.host,
          port: fullConn.port,
          username: fullConn.username,
          authType: fullConn.authType,
          password: fullConn.password,
          privateKey: fullConn.privateKey,
          passphrase: fullConn.passphrase,
          database: fullConn.database,
          dbProvider: fullConn.dbProvider,
          isSrv: fullConn.isSrv,
          authSource: fullConn.authSource,
          dbOptions: fullConn.dbOptions,
          sshTunnel: fullConn.sshTunnel,
          sshTunnelHost: fullConn.sshTunnelHost,
          sshTunnelPort: fullConn.sshTunnelPort,
          sshTunnelUser: fullConn.sshTunnelUser,
          sshTunnelAuth: fullConn.sshTunnelAuth,
          sshTunnelPassword: fullConn.sshTunnelPassword,
          sshTunnelPrivateKey: fullConn.sshTunnelPrivateKey,
          sshTunnelPassphrase: fullConn.sshTunnelPassphrase,
          tags: fullConn.tags,
          color: fullConn.color,
          notes: fullConn.notes,
          keyFileName: fullConn.keyFileName,
        });

        // Encrypt with Argon2id + AES-256-GCM (highest sensitivity tier)
        const { encrypted: enc, salt, iv } = await encryptWithPassword(payload, masterPwd);

        // Fingerprint for deduplication
        const raw = `${conn.name || ''}|${conn.host || ''}|${conn.type || ''}`;
        let hash = 0;
        for (let j = 0; j < raw.length; j++) {
          hash = ((hash << 5) - hash + raw.charCodeAt(j)) | 0;
        }
        const fingerprint = `fp_${Math.abs(hash).toString(36)}`;

        encrypted.push({
          fingerprint,
          name: conn.name,
          host: conn.host,
          type: conn.type || 'ssh',
          encryptedData: enc,
          salt,
          iv,
        });
      }

      if (encrypted.length === 0) {
        setCloudProgress({ current: 0, total: 0, done: true, error: 'No eligible connections to save.' });
        setIsMigrating(false);
        return;
      }

      // Send to cloud-migrate endpoint (replaces all existing cloud connections)
      const res = await apiFetch('/api/user/cloud-migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connections: encrypted, replace: true }),
      });
      const data = await res.json();

      if (data.success) {
        setCloudProgress({
          current: encrypted.length,
          total: encrypted.length,
          done: true,
          saved: data.saved,
          error: null,
        });
        addNotification({
          title: '☁️ Saved to Cloud',
          message: `${data.saved} connection(s) encrypted and saved to cloud with Argon2id + AES-256-GCM.`,
          type: 'success',
        });
      } else {
        setCloudProgress(prev => ({ ...prev, done: true, error: data.error || 'Unknown error' }));
        addNotification({ title: 'Cloud Save Failed', message: data.error || 'Unknown error', type: 'error' });
      }
    } catch (err) {
      setCloudProgress(prev => ({ ...prev, done: true, error: err.message }));
      addNotification({ title: 'Cloud Save Error', message: err.message, type: 'error' });
    } finally {
      setIsMigrating(false);
      // Auto-clear progress after 4 seconds
      setTimeout(() => setCloudProgress(null), 4000);
    }
  };





  // Proactively fetch connections when Sidebar mounts (ensures re-opening works)
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Position Hover Action Panel dynamically within safe boundaries
  useEffect(() => {
    if (!hoverPanel) {
      setMenuPosition(null);
      return;
    }

    const measureAndPosition = () => {
      if (hoverPanelRef.current) {
        const rect = hoverPanelRef.current.getBoundingClientRect();
        const menuH = rect.height;
        const menuW = rect.width;
        
        const taskbarPos = osState?.taskbarPosition || 'bottom';
        const taskbarSize = 56;
        
        let topBoundary = taskbarPos === 'top' ? taskbarSize + 8 : 8;
        let bottomBoundary = taskbarPos === 'bottom' ? window.innerHeight - taskbarSize - 8 : window.innerHeight - 8;
        let leftBoundary = taskbarPos === 'left' ? taskbarSize + 8 : 8;
        let rightBoundary = taskbarPos === 'right' ? window.innerWidth - taskbarSize - 8 : window.innerWidth - 8;

        let left = hoverPanel.x;
        if (left + menuW > rightBoundary) {
          left = Math.max(leftBoundary, window.innerWidth - menuW - 16);
        }

        let top = hoverPanel.y;
        if (top + menuH > bottomBoundary) {
          top = Math.max(topBoundary, bottomBoundary - menuH);
        }

        setMenuPosition({ left, top });
      }
    };

    measureAndPosition();
    const rafId = requestAnimationFrame(measureAndPosition);
    
    window.addEventListener('resize', measureAndPosition);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureAndPosition);
    };
  }, [hoverPanel, osState?.taskbarPosition]);

  const filtered = connections.filter(conn => {
    const matchSearch = (conn.name || '').toLowerCase().includes((search || '').toLowerCase()) ||
      (conn.host || '').toLowerCase().includes((search || '').toLowerCase()) ||
      conn.tags?.some(t => (t || '').toLowerCase().includes((search || '').toLowerCase()));
    
    const matchSection = activeSection === 'all' ||
      (activeSection === 'ssh' && (conn.type === 'ssh' || !conn.type)) ||
      (activeSection === 'database' && conn.type === 'database');

    if (filter === 'favorites') return matchSearch && matchSection && conn.isFavorite;
    if (filter === 'online') return matchSearch && matchSection && conn.status === 'online';
    if (filter === 'offline') return matchSearch && matchSection && conn.status === 'offline';
    return matchSearch && matchSection;
  });

  const sshConnections = filtered.filter(c => c.type === 'ssh' || !c.type);
  const dbConnections = filtered.filter(c => c.type === 'database');

  const stats = {
    total: connections.length,
    ssh: connections.filter(c => c.type === 'ssh' || !c.type).length,
    db: connections.filter(c => c.type === 'database').length,
    online: connections.filter(c => c.status === 'online').length,
    offline: connections.filter(c => c.status === 'offline').length,
  };

  const handleFetchSpecs = async (conn) => {
    if (!conn._id || conn._id.startsWith('local-')) {
      addNotification({ title: 'Save First', message: 'Save the connection to DB before fetching specs.', type: 'warning' });
      return;
    }
    setFetchingSpecs(prev => new Set([...prev, conn._id]));
    try {
      const res = await apiFetch('/api/ssh/specs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: conn._id }),
      });
      const data = await res.json();
      if (data.success) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: { _id: conn._id, systemInfo: data.systemInfo } });
        addNotification({ title: 'System Specs', message: data.info || 'Fetched successfully', type: 'success' });
      } else {
        addNotification({ title: 'Fetch Failed', message: data.error || 'Could not fetch specs', type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setFetchingSpecs(prev => { const next = new Set(prev); next.delete(conn._id); return next; });
    }
  };

  const handleConnect = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }
    
    if (conn.type === 'database') {
      const existing = state.activeDatabaseBrowsers.find(b => b.connectionId === conn._id);
      if (existing) {
        addNotification({ title: t('common.database'), message: t('ssh.toasts.alreadyConnected', { name: conn.name }), type: 'info' });
        dispatch({ type: 'SET_VIEW', payload: 'database' });
        dispatch({ type: 'SET_ACTIVE_DATABASE_BROWSER', payload: existing.id });
        return;
      }
      // Terminate any existing standalone database window
      closeWindow(`standalone-db-${conn._id}`);

      // Also remove from standalone state if it exists
      const standaloneDb = state.standaloneDatabaseBrowsers.find(b => b.connectionId === conn._id);
      if (standaloneDb) {
        dispatch({ type: 'CLOSE_STANDALONE_DATABASE_BROWSER', payload: standaloneDb.id });
      }
      
      dispatch({
        type: 'OPEN_DATABASE_BROWSER',
        payload: {
          id: `db-${conn._id}-${Date.now()}`,
          connectionId: conn._id,
          connectionName: conn.name,
          color: conn.color,
          connection: conn,
        },
      });
      return;
    }

    if (conn.type === 'ssh' || !conn.type) {
      // Check if a terminal for this connection already exists — focus it instead of spawning a duplicate
      const existingTerm = state.activeTerminals.find(t => t.connectionId === conn._id);
      if (existingTerm) {
        dispatch({ type: 'SET_VIEW', payload: 'terminal' });
        dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: existingTerm.id });
        return;
      }

      // Switch to terminal view and signal TmuxLayout to open this connection.
      dispatch({ type: 'SET_VIEW', payload: 'terminal' });
      dispatch({
        type: 'OPEN_TERMINAL',
        payload: {
          id: `term-${conn._id}-${Date.now()}`,
          connectionId: conn._id,
          connectionName: conn.name,
          host: conn.host,
          color: conn.color,
          connection: conn,
        },
      });
      return;
    }
  };

  const handleFiles = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }

    // Check if a file manager for this connection already exists — focus it instead of spawning a duplicate
    const existingFM = state.activeFileManagers.find(f => f.connectionId === conn._id);
    if (existingFM) {
      dispatch({ type: 'SET_VIEW', payload: 'files' });
      dispatch({ type: 'SET_ACTIVE_FILE_MANAGER', payload: existingFM.id });
      return;
    }

    // Terminate any existing standalone files window
    closeWindow(`standalone-files-${conn._id}`);

    dispatch({ type: 'SET_VIEW', payload: 'files' });
    dispatch({
      type: 'OPEN_FILE_MANAGER',
      payload: {
        id: `files-${conn._id}-${Date.now()}`,
        connectionId: conn._id,
        connectionName: conn.name,
        color: conn.color,
        connection: conn,
      },
    });
  };

  const handleDelete = (id) => {
    const conn = state.connections.find(c => c._id === id);
    if (!conn) return;

    showConfirm(
      t('ssh.deleteConfirm'),
      async () => {
        if (conn.storage === 'localstorage') {
          const saved = (await getLocalConnections()) || [];
          const updated = saved.filter(c => c._id !== id);
          await saveLocalConnections(updated);
          dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          addNotification({ title: t('common.delete'), message: t('ssh.toasts.deletedLocal'), type: 'success' });
          return;
        }

        if (conn.storage === 'manual') {
          dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          addNotification({ title: t('common.removed'), message: t('ssh.toasts.removedSession'), type: 'info' });
          return;
        }

        try {
          const res = await apiFetch(`/api/connections/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            addNotification({ title: t('common.delete'), message: t('ssh.toasts.deleteSuccess'), type: 'success' });
            dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          }
        } catch (err) {
          addNotification({ title: t('common.error') || 'Error', message: t('ssh.toasts.deleteFail'), type: 'error' });
          console.error(err);
        }
      },
      t('ssh.deleteTitle'),
      t('common.delete'),
      t('common.cancel')
    );
  };

  const handleToggleFavorite = async (id) => {
    const conn = state.connections.find(c => c._id === id);
    if (!conn) return;

    if (conn.storage === 'localstorage') {
       const saved = (await getLocalConnections()) || [];
       const updated = saved.map(c => {
         if (c._id === id) return { ...c, isFavorite: !c.isFavorite };
         return c;
       });
       await saveLocalConnections(updated);
       const match = updated.find(c => c._id === id);
       dispatch({ type: 'UPDATE_CONNECTION', payload: match });
       return;
    }

    if (conn.storage === 'manual') {
       dispatch({ type: 'UPDATE_CONNECTION', payload: { ...conn, isFavorite: !conn?.isFavorite } });
       return;
    }

    try {
      const res = await apiFetch(`/api/connections/${id}/favorite`, { method: 'PUT' });
      const data = await res.json();
      if (data.success) {
        dispatch({ type: 'UPDATE_CONNECTION', payload: data.data });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async (id) => {
    dispatch({ type: 'UPDATE_CONNECTION', payload: { _id: id, status: 'testing' } });
    const conn = state.connections.find(c => c._id === id);
    try {
      const res = await apiFetch(`/api/connections/${id}/test`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection: conn })
      });
      const data = await res.json();
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: {
          _id: id,
          status: data.success ? 'online' : 'offline',
          lastConnected: data.success ? new Date().toISOString() : undefined,
          info: data.success ? data.info : undefined,
        },
      });
      if (data.success) {
        addNotification({ title: t('common.connected'), message: t('common.connected'), type: 'success' });
        
        // If local storage, also persist the lastConnected status
        if (conn && conn.storage === 'localstorage') {
            const saved = (await getLocalConnections()) || [];
            const updated = saved.map(c => {
                if (c._id === id) return { ...c, status: 'online', lastConnected: new Date().toISOString() };
                return c;
            });
            await saveLocalConnections(updated);
        }
      } else {
        addNotification({ title: t('ssh.status.error') || 'Error', message: t('ssh.toasts.testFail') + ': ' + data.error, type: 'error' });
        if (conn && conn.storage === 'localstorage') {
            const saved = (await getLocalConnections()) || [];
            const updated = saved.map(c => {
                if (c._id === id) return { ...c, status: 'offline' };
                return c;
            });
            await saveLocalConnections(updated);
        }
      }
    } catch (err) {
      addNotification({ title: t('common.error') || 'Error', message: t('ssh.toasts.testFail'), type: 'error' });
      dispatch({ type: 'UPDATE_CONNECTION', payload: { _id: id, status: 'offline' } });
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div 
          className="sidebar-backdrop md:hidden" 
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        />
      )}
      <div className={`sidebar flex flex-col shrink-0 ${sidebarOpen ? 'open' : ''} ${!sidebarOpen ? 'hidden' : ''}`} style={{ width: '100%', height: '100%', borderRight: '1px solid var(--border-color)' }}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--bg-selected)] shadow-[var(--glow-indigo)] border border-[var(--accent-indigo)]/30">
              <Terminal size={18} className="text-[var(--text-selected)]" />
            </div>
            <div>
              <h1 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('common.connections')}</h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.manage')}</p>
            </div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'TOGGLE_SIDEBAR' }); }}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Collapse Sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* Stats mini bar */}
        <div className="flex items-center gap-1.5 mb-3 px-1">
          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{stats.total}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.total')}</span>
          <span className="text-[var(--text-muted)] opacity-30 mx-0.5">·</span>
          <span className="font-bold text-sm text-indigo-400">{stats.ssh}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>SSH</span>
          <span className="text-[var(--text-muted)] opacity-30 mx-0.5">·</span>
          <span className="font-bold text-sm text-emerald-400">{stats.db}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>DB</span>
        </div>

        {/* Section toggle */}
        <div className="flex gap-1 p-1 rounded-lg mb-3" style={{ background: 'var(--bg-secondary)' }}>
          {[
            { key: 'all', label: 'All', icon: null },
            { key: 'ssh', label: 'SSH', icon: Server },
            { key: 'database', label: 'Database', icon: Database },
          ].map((s) => {
            const IconComp = s.icon;
            return (
              <button
                key={s.key}
                className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md transition-all font-medium ${
                  activeSection === s.key
                    ? s.key === 'ssh'
                      ? 'bg-indigo-500/20 text-indigo-400 shadow-sm border border-indigo-500/30'
                      : s.key === 'database'
                      ? 'bg-emerald-500/20 text-emerald-400 shadow-sm border border-emerald-500/30'
                      : 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-sm border border-[var(--accent-indigo)]/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => setActiveSection(s.key)}
              >
                {IconComp && <IconComp size={11} />}
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="input-field text-sm"
            style={{ paddingLeft: '2.25rem' }}
            placeholder={t('ssh.searchPlaceHolder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          {[
            { key: 'all', label: t('ssh.filters.all') },
            { key: 'favorites', label: t('ssh.filters.favorites') },
            { key: 'online', label: t('ssh.filters.online') },
            { key: 'offline', label: t('common.offline') || 'Offline' },
          ].map((f, i) => (
            <button
              key={f.key || i}
              className={`flex-1 text-xs py-1.5 rounded-md transition-all font-medium ${
                filter === f.key
                  ? 'bg-[var(--bg-selected)] text-[var(--text-selected)] shadow-sm border border-[var(--accent-indigo)]/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* MongoDB / Relay Dead Banner */}
      <MongoDeadBanner />

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 ? (
          <div className="empty-state py-10">
            <Server size={40} />
            <p className="text-sm mt-2">{t('ssh.noConnections')}</p>
          </div>
        ) : activeSection === 'all' ? (
          <>
            {/* SSH Section */}
            {sshConnections.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <Server size={11} className="text-indigo-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">SSH Servers</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">{sshConnections.length}</span>
                  <div className="flex-1 h-px bg-indigo-500/15" />
                </div>
                {sshConnections.map((conn, index) => (
                  <ConnectionItem key={conn._id || `conn-ssh-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} t={t} />
                ))}
              </>
            )}
            {/* Database Section */}
            {dbConnections.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 mt-2">
                  <div className="flex items-center gap-1.5">
                    <Database size={11} className="text-emerald-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Databases</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{dbConnections.length}</span>
                  <div className="flex-1 h-px bg-emerald-500/15" />
                </div>
                {dbConnections.map((conn, index) => (
                  <ConnectionItem key={conn._id || `conn-db-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} t={t} />
                ))}
              </>
            )}
          </>
        ) : (
          filtered.map((conn, index) => (
            <ConnectionItem key={conn._id || `conn-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} t={t} />
          ))
        )}
      </div>

      {/* Footer: Sync + Add connection */}
      <div className="p-4 border-t pb-16 md:pb-4 space-y-2" style={{ borderColor: 'var(--border-color)' }}>
        {isUnlocked && (
          <>
            {/* Save to Cloud — full-width prominent button */}
            <button
              onClick={handleSaveToCloud}
              disabled={isMigrating || connections.length === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-bold rounded-lg transition-all disabled:opacity-50 relative overflow-hidden"
              style={{
                background: isMigrating
                  ? 'rgba(99,102,241,0.15)'
                  : 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(14,165,233,0.2) 100%)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#a5b4fc',
              }}
              title="Save all connections to cloud with Argon2id + AES-256-GCM encryption (highest sensitivity)"
            >
              {isMigrating && cloudProgress && cloudProgress.total > 0 && (
                <div
                  className="absolute inset-0 transition-all duration-300"
                  style={{
                    background: 'rgba(99,102,241,0.2)',
                    width: `${Math.round((cloudProgress.current / cloudProgress.total) * 100)}%`,
                    left: 0,
                  }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {isMigrating ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    {cloudProgress
                      ? `Encrypting ${cloudProgress.current}/${cloudProgress.total}…`
                      : 'Preparing…'}
                  </>
                ) : cloudProgress?.done ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-emerald-400">
                      {cloudProgress.error
                        ? `Error: ${cloudProgress.error}`
                        : `Saved ${cloudProgress.saved ?? ''}!`}
                    </span>
                  </>
                ) : (
                  <>
                    <CloudUpload size={13} />
                    Save to Cloud
                  </>
                )}
              </span>
            </button>

            {/* Load from Cloud */}
            <button
              onClick={handlePullSynced}
              disabled={isSyncing}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
              style={{
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.2)',
                color: 'var(--text-muted)',
              }}
              title="Pull all synced connections from cloud and import to local"
            >
              {isSyncing ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <CloudDownload size={13} />
                  Load from Cloud
                </>
              )}
            </button>
          </>
        )}
        <button className="btn-primary w-full justify-center" onClick={onNewConnection}>
          <Plus size={16} /> {t('ssh.newConnection')}
        </button>
      </div>

    </div>

    {/* Hover Action Panel - appears after 2s hold */}
    {hoverPanel && createPortal(
      <div
        ref={hoverPanelRef}
        className="fixed z-[99999] animate-in fade-in zoom-in-95 duration-200"
        style={{
          left: menuPosition ? menuPosition.left : hoverPanel.x,
          top: menuPosition ? menuPosition.top : hoverPanel.y,
          opacity: menuPosition ? 1 : 0,
          pointerEvents: menuPosition ? 'auto' : 'none',
        }}
        onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
        onMouseLeave={() => setHoverPanel(null)}
      >
        <div className="w-56 max-h-[70vh] overflow-y-auto rounded-xl border shadow-2xl p-2 space-y-0.5 custom-scrollbar" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          {/* Header */}
          <div className="px-2 py-1.5 mb-1">
            <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{hoverPanel.conn.name}</div>
            <div className="text-[10px] font-mono opacity-50 truncate">{hoverPanel.conn.username}@{hoverPanel.conn.host}</div>
          </div>

          <div className="h-px" style={{ background: 'var(--border-color)' }} />

          {/* Actions */}
          <PanelItem icon={hoverPanel.conn.type === 'database' ? Database : Terminal} label={hoverPanel.conn.type === 'database' ? 'Open Database' : 'Connect Terminal'} color="text-emerald-400" onClick={() => { handleConnect(hoverPanel.conn); setHoverPanel(null); }} />
          {hoverPanel.conn.type === 'ssh' && (
            <PanelItem icon={Folder} label="File Manager" color="text-blue-400" onClick={() => { handleFiles(hoverPanel.conn); setHoverPanel(null); }} />
          )}
          {hoverPanel.conn.type === 'ssh' && (
            <PanelItem icon={Box} label="Docker Manager" color="text-sky-400" onClick={() => { window.dispatchEvent(new CustomEvent('open-docker-manager', { detail: { connection: hoverPanel.conn } })); setHoverPanel(null); }} />
          )}

          <div className="h-px" style={{ background: 'var(--border-color)' }} />

          <PanelItem icon={Star} label={hoverPanel.conn.isFavorite ? 'Remove Favorite' : 'Add Favorite'} color="text-amber-400" onClick={() => { handleToggleFavorite(hoverPanel.conn._id); setHoverPanel(null); }} />
          {hoverPanel.conn.type === 'ssh' && (
            <PanelItem icon={Cpu} label={fetchingSpecs.has(hoverPanel.conn._id) ? 'Fetching...' : 'Refresh Specs'} color="text-purple-400" disabled={fetchingSpecs.has(hoverPanel.conn._id)} onClick={() => { handleFetchSpecs(hoverPanel.conn); setHoverPanel(null); }} />
          )}
          {isUnlocked && hoverPanel.conn.storage !== 'manual' && (
            <PanelItem icon={CloudUpload} label="Sync to Server" color="text-sky-400" onClick={() => { handleSyncOne(hoverPanel.conn); setHoverPanel(null); }} />
          )}

          <div className="h-px" style={{ background: 'var(--border-color)' }} />

          <PanelItem icon={Edit} label="Edit Connection" onClick={() => { onEditConnection(hoverPanel.conn); setHoverPanel(null); }} />
          <PanelItem icon={Trash2} label="Delete Connection" color="text-red-400" onClick={() => { handleDelete(hoverPanel.conn._id); setHoverPanel(null); }} />
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function ConnectionItem({ conn, state, dispatch, hoverPanel, setHoverPanel, hoverTimerRef, fetchingSpecs, handleToggleFavorite, t }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
        e.dataTransfer.effectAllowed = 'copy';
        const ghost = document.createElement('div');
        ghost.style.cssText = `background:var(--accent-indigo);position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;color:white;font-weight:600;`;
        ghost.textContent = `🖥 ${conn.name}`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => document.body.removeChild(ghost), 0);
      }}
      className={`connection-item group relative !p-3 !my-1 cursor-grab active:cursor-grabbing transition-all border ${
        state.selectedConnection?._id === conn._id
          ? 'border-[var(--accent-indigo)]/50 bg-[var(--bg-selected)] shadow-sm'
          : 'border-transparent'
      }`}
      onClick={() => {
        clearTimeout(hoverTimerRef.current);
        const el = document.querySelector(`[data-conn-id="${conn._id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const rect = el.getBoundingClientRect();
          setHoverPanel(prev => prev?.conn?._id === conn._id ? null : { conn, x: rect.right + 8, y: rect.top });
        } else {
          setHoverPanel(prev => prev?.conn?._id === conn._id ? null : { conn, x: 380, y: 200 });
        }
      }}
      onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
      data-conn-id={conn._id}
    >
      <div className="flex items-center gap-3">
        {/* Color indicator */}
        <div className="w-1 rounded-full self-stretch" style={{ background: conn.color }} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`status-dot ${
              conn.status === 'online' ? 'status-online' :
              conn.status === 'offline' ? 'status-offline' : 'status-unknown'
            }`} />
            <span className="text-sm font-semibold truncate" style={{ color: state.selectedConnection?._id === conn._id ? 'var(--text-selected)' : 'var(--text-primary)' }}>
              {conn.name}
            </span>
            <Star size={12} className={`flex-shrink-0 cursor-pointer hover:scale-125 transition-transform ${conn.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-50 hover:!opacity-100'}`} onClick={(e) => { e.stopPropagation(); handleToggleFavorite(conn._id); }} />
            <span className={`text-[8px] font-bold px-1 rounded-sm border uppercase flex-shrink-0 ${
              conn.storage === 'db' ? 'text-[var(--accent-indigo)] border-[var(--accent-indigo)]/30' :
              conn.storage === 'localstorage' ? 'text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30' :
              'text-[var(--accent-amber)] border-[var(--accent-amber)]/30'
            }`}>
              {conn.storage === 'localstorage' ? t('common.storage.local') : conn.storage === 'manual' ? t('common.storage.tmp') : t('common.storage.db')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase py-0.5 px-2 bg-[var(--bg-tertiary)] rounded-full border border-[var(--border-color)]" style={{ color: conn.color }}>
              {conn.type === 'database' ? (conn.dbProvider || 'db').toUpperCase() : 'SSH'}
            </span>
            <span className="text-xs font-mono truncate opacity-60" style={{ color: 'var(--text-muted)' }}>
              {conn.username ? `${conn.username}@` : ''}{conn.host}
            </span>
            {conn.tags?.slice(0, 1).map((tag, tagIndex) => (
              <span key={`${tag}-${tagIndex}`} className="tag-pill !py-0 !px-1 !text-[8px] opacity-70 max-w-[60px] truncate">{tag}</span>
            ))}
          </div>
          {conn.systemInfo && conn.type === 'ssh' && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[8px] font-mono opacity-50 inline-flex items-center gap-0.5" title={conn.systemInfo.distro || conn.systemInfo.os || ''}>
                <HardDrive size={8} />{conn.systemInfo.distro || conn.systemInfo.os?.split(' ')[0] || '?'}
              </span>
              <span className="text-[8px] font-mono opacity-50 inline-flex items-center gap-0.5" title={conn.systemInfo.cpu || ''}>
                <Cpu size={8} />{conn.systemInfo.cores || '?'}c
              </span>
              <span className="text-[8px] font-mono opacity-50 inline-flex items-center gap-0.5" title={`RAM: ${conn.systemInfo.ram || '?'}`}>
                <MemoryStick size={8} />{conn.systemInfo.ram || '?'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelItem({ icon: Icon, label, color, disabled, onClick }) {
  return (
    <button
      className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--bg-tertiary)]'}`}
      style={{ color: color || 'var(--text-primary)' }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}
