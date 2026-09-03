'use client';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import {
  Server, Star, StarOff, Wifi, WifiOff, Clock, EllipsisVertical, Terminal, Pen, Trash2,  
  RotateCw, Plus, Search, Filter, Key, Lock, BarChart3, TrendingUp, Zap, RefreshCw, Folder, Box, TriangleAlert, X, Database,
  PanelLeftClose, PanelLeft, CloudUpload, CloudDownload, Check, Cpu, MemoryStick, HardDrive
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';
import { useVault } from '@/context/VaultContext';
import { encryptWithPassword } from '@/utils/clientCrypto';
import { getLocalConnections, saveLocalConnections } from '@/utils/localConnections';
import MongoDeadBanner from '@/components/MongoDeadBanner';
import GlobalScanNotifications from '@/components/GlobalScanNotifications';

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
            const res = await apiFetch(`/api/connections/${conn._id}/reveal`, { method: 'POST' });
            const data = await res.json();
            if (data.success && data.data) fullConn = { ...conn, ...data.data };
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
          const res = await apiFetch(`/api/connections/${conn._id}/reveal`, { method: 'POST' });
          const data = await res.json();
          if (data.success && data.data) fullConn = { ...conn, ...data.data };
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
                  isSrv: parsed.isSrv,
                  authSource: parsed.authSource,
                  dbOptions: parsed.dbOptions,
                  sshTunnel: parsed.sshTunnel,
                  sshTunnelHost: parsed.sshTunnelHost,
                  sshTunnelPort: parsed.sshTunnelPort,
                  sshTunnelUser: parsed.sshTunnelUser,
                  sshTunnelAuth: parsed.sshTunnelAuth,
                  sshTunnelPassword: parsed.sshTunnelPassword,
                  sshTunnelPrivateKey: parsed.sshTunnelPrivateKey,
                  sshTunnelPassphrase: parsed.sshTunnelPassphrase,
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
            const res = await apiFetch(`/api/connections/${conn._id}/reveal`, { method: 'POST' });
            const data = await res.json();
            if (data.success && data.data) fullConn = { ...conn, ...data.data };
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
      <div className="p-3.5 border-b space-y-3" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--accent-indigo)]/15 border border-[var(--accent-indigo)]/30 text-[var(--accent-indigo)] shadow-sm">
              <Terminal size={16} />
            </div>
            <div>
              <h1 className="text-xs font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{t('common.connections')}</h1>
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-mono">
                <span>{stats.total} total</span>
                <span className="opacity-40">•</span>
                <span className="text-indigo-400 font-semibold">{stats.ssh} SSH</span>
                <span className="opacity-40">•</span>
                <span className="text-emerald-400 font-semibold">{stats.db} DB</span>
              </div>
            </div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'TOGGLE_SIDEBAR' }); }}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Collapse Sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            className="w-full bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] rounded-xl py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)]/50 transition-all font-sans"
            placeholder={t('ssh.searchPlaceHolder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Unified Filter Pills */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)] overflow-x-auto no-scrollbar whitespace-nowrap">
          {[
            { key: 'all', label: 'All' },
            { key: 'ssh', label: 'SSH' },
            { key: 'database', label: 'DB' },
            { key: 'favorites', label: '★ Fav' },
            { key: 'online', label: 'Online' },
          ].map((item) => {
            const isActive = (item.key === 'ssh' || item.key === 'database') 
              ? activeSection === item.key 
              : filter === item.key && activeSection === 'all';
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (item.key === 'ssh' || item.key === 'database') {
                    setActiveSection(item.key);
                    setFilter('all');
                  } else {
                    setActiveSection('all');
                    setFilter(item.key);
                  }
                }}
                className={`flex-1 min-w-[42px] px-2 text-[11px] font-semibold py-1 rounded-lg transition-all text-center whitespace-nowrap ${
                  isActive
                    ? 'bg-[var(--accent-indigo)] text-white shadow-sm font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* MongoDB / Relay Dead Banner */}
      <MongoDeadBanner />
      {/* Desktop-wide virus scan finished banners */}
      <GlobalScanNotifications />

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="empty-state py-12 text-center">
            <Server size={32} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
            <p className="text-xs text-[var(--text-muted)]">{t('ssh.noConnections')}</p>
          </div>
        ) : activeSection === 'all' ? (
          <>
            {/* SSH Section */}
            {sshConnections.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between px-1.5 py-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400/80">
                  <div className="flex items-center gap-1.5">
                    <Server size={11} />
                    <span>SSH Servers ({sshConnections.length})</span>
                  </div>
                </div>
                <div className="space-y-1">
                  {sshConnections.map((conn, index) => (
                    <ConnectionItem key={conn._id || `conn-ssh-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} syncedFingerprints={syncedFingerprints} getFingerprint={getFingerprint} t={t} />
                  ))}
                </div>
              </div>
            )}

            {/* Database Section */}
            {dbConnections.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between px-1.5 py-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                  <div className="flex items-center gap-1.5">
                    <Database size={11} />
                    <span>Databases ({dbConnections.length})</span>
                  </div>
                </div>
                <div className="space-y-1">
                  {dbConnections.map((conn, index) => (
                    <ConnectionItem key={conn._id || `conn-db-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} syncedFingerprints={syncedFingerprints} getFingerprint={getFingerprint} t={t} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-1">
            {filtered.map((conn, index) => (
              <ConnectionItem key={conn._id || `conn-${index}`} conn={conn} state={state} dispatch={dispatch} hoverPanel={hoverPanel} setHoverPanel={setHoverPanel} hoverTimerRef={hoverTimerRef} fetchingSpecs={fetchingSpecs} handleToggleFavorite={handleToggleFavorite} syncedFingerprints={syncedFingerprints} getFingerprint={getFingerprint} t={t} />
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t space-y-2 bg-[var(--bg-primary)]/40" style={{ borderColor: 'var(--border-color)' }}>
        {isUnlocked && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleSaveToCloud}
              disabled={isMigrating || connections.length === 0}
              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/25 transition-all disabled:opacity-40"
              title="Save connections to cloud"
            >
              {isMigrating ? <RefreshCw size={12} className="animate-spin" /> : <CloudUpload size={12} />}
              <span>Save Cloud</span>
            </button>
            <button
              onClick={handlePullSynced}
              disabled={isSyncing}
              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 transition-all disabled:opacity-40"
              title="Load connections from cloud"
            >
              {isSyncing ? <RefreshCw size={12} className="animate-spin" /> : <CloudDownload size={12} />}
              <span>Load Cloud</span>
            </button>
          </div>
        )}
        <button
          onClick={onNewConnection}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[var(--accent-indigo)] hover:bg-[var(--accent-indigo)]/90 text-white font-semibold text-xs shadow-md transition-all active:scale-[0.98]"
        >
          <Plus size={14} />
          <span>{t('ssh.newConnection')}</span>
        </button>
      </div>

    </div>

    {/* Hover Action Panel */}
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
          <div className="px-2 py-1.5 mb-1">
            <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{hoverPanel.conn.name}</div>
            <div className="text-[10px] font-mono opacity-50 truncate">{hoverPanel.conn.username}@{hoverPanel.conn.host}</div>
          </div>
          <div className="h-px" style={{ background: 'var(--border-color)' }} />
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

          <div className="h-px" style={{ background: 'var(--border-color)' }} />
          <PanelItem icon={Pen} label="Edit Connection" onClick={() => { onEditConnection(hoverPanel.conn); setHoverPanel(null); }} />
          <PanelItem icon={Trash2} label="Delete Connection" color="text-red-400" onClick={() => { handleDelete(hoverPanel.conn._id); setHoverPanel(null); }} />
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function ConnectionItem({ conn, state, dispatch, hoverPanel, setHoverPanel, hoverTimerRef, fetchingSpecs, handleToggleFavorite, syncedFingerprints, getFingerprint, t }) {
  const isSynced = syncedFingerprints && getFingerprint && syncedFingerprints.has(getFingerprint(conn));
  const isSelected = state.selectedConnection?._id === conn._id;

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
      className={`group relative p-2.5 rounded-xl cursor-pointer transition-all border ${
        isSelected
          ? 'bg-[var(--accent-indigo)]/15 border-[var(--accent-indigo)]/40 shadow-sm'
          : 'bg-[var(--bg-card)]/60 hover:bg-[var(--bg-card)] border-[var(--border-color)]/60 hover:border-[var(--border-color)]'
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
      <div className="flex items-center gap-2.5">
        {/* Connection Type / Color Pill */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
          style={{
            background: `${conn.color || '#6366f1'}15`,
            borderColor: `${conn.color || '#6366f1'}35`,
            color: conn.color || '#6366f1'
          }}
        >
          {conn.type === 'database' ? <Database size={15} /> : <Server size={15} />}
        </div>

        {/* Connection Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                conn.status === 'online' ? 'bg-emerald-400 animate-pulse' :
                conn.status === 'offline' ? 'bg-rose-400' : 'bg-slate-400'
              }`} />
              <span className="text-xs font-semibold truncate text-[var(--text-primary)]">
                {conn.name}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Star
                size={11}
                className={`cursor-pointer hover:scale-125 transition-transform ${
                  conn.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-60'
                }`}
                onClick={(e) => { e.stopPropagation(); handleToggleFavorite(conn._id); }}
              />
              {isSynced && (
                <CloudUpload size={11} className="text-sky-400" title="Synced to Cloud" />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
            <span className="truncate max-w-[150px]">
              {conn.username ? `${conn.username}@` : ''}{conn.host}
            </span>
            {conn.tags && conn.tags.length > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-[9px] truncate max-w-[60px]">
                {conn.tags[0]}
              </span>
            )}
          </div>
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
