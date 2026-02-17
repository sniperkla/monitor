'use client';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import {
  Server, Star, StarOff, Wifi, WifiOff, Clock, MoreVertical, Terminal, Edit, Trash2,  
  RotateCw, Plus, Search, Filter, Key, Lock, BarChart3, TrendingUp, Zap, RefreshCw, Folder, AlertTriangle, X, Database
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOS } from '@/context/OSContext';

export default function Sidebar({ onNewConnection, onEditConnection }) {
  const { state, dispatch, fetchConnections, apiFetch } = useApp();
  const { addNotification, showConfirm } = useOS();
  const { t } = useTranslation();
  const { connections, sidebarOpen } = state;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, favorites, online, offline


  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const filtered = connections.filter(conn => {
    const matchSearch = conn.name.toLowerCase().includes(search.toLowerCase()) ||
      conn.host.toLowerCase().includes(search.toLowerCase()) ||
      conn.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()));
    
    if (filter === 'favorites') return matchSearch && conn.isFavorite;
    if (filter === 'online') return matchSearch && conn.status === 'online';
    if (filter === 'offline') return matchSearch && conn.status === 'offline';
    return matchSearch;
  });

  const stats = {
    total: connections.length,
    online: connections.filter(c => c.status === 'online').length,
    offline: connections.filter(c => c.status === 'offline').length,
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

    // Check if already running
    const existing = state.activeTerminals.find(t => t.connectionId === conn._id);
    if (existing) {
      addNotification({ title: t('ssh.dashboard'), message: t('ssh.toasts.alreadyConnected', { name: conn.name }), type: 'error' });
      dispatch({ type: 'SET_VIEW', payload: 'terminal' });
      dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: existing.id });
      return;
    }
    
    const termId = `term-${conn._id}-${Date.now()}`;
    dispatch({
      type: 'OPEN_TERMINAL',
      payload: {
        id: termId,
        connectionId: conn._id,
        connectionName: conn.name,
        host: conn.host,
        color: conn.color,
        connection: conn,
      },
    });
  };

  const handleFiles = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }

    const existing = state.activeFileManagers.find(f => f.connectionId === conn._id);
    if (existing) {
      addNotification({ title: t('ssh.fileGui'), message: t('ssh.toasts.alreadyConnected', { name: conn.name }), type: 'info' });
      dispatch({ type: 'SET_VIEW', payload: 'files' });
      dispatch({ type: 'SET_ACTIVE_FILE_MANAGER', payload: existing.id });
      return;
    }

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
          const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
          const updated = saved.filter(c => c._id !== id);
          localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
          dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          addNotification({ title: 'Deleted', message: t('ssh.toasts.deletedLocal'), type: 'success' });
          return;
        }

        if (conn.storage === 'manual') {
          dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          addNotification({ title: 'Removed', message: t('ssh.toasts.removedSession'), type: 'info' });
          return;
        }

        try {
          const res = await apiFetch(`/api/connections/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            addNotification({ title: 'Deleted', message: t('ssh.toasts.deleteSuccess'), type: 'success' });
            dispatch({ type: 'REMOVE_CONNECTION', payload: id });
          }
        } catch (err) {
          addNotification({ title: 'Error', message: t('ssh.toasts.deleteFail'), type: 'error' });
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
       const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
       const updated = saved.map(c => {
         if (c._id === id) return { ...c, isFavorite: !c.isFavorite };
         return c;
       });
       localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
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
        addNotification({ title: 'Connected', message: t('common.connected'), type: 'success' });
        
        // If local storage, also persist the lastConnected status
        if (conn && conn.storage === 'localstorage') {
            const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
            const updated = saved.map(c => {
                if (c._id === id) return { ...c, status: 'online', lastConnected: new Date().toISOString() };
                return c;
            });
            localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
        }
      } else {
        addNotification({ title: 'Connection Failed', message: t('ssh.toasts.testFail') + ': ' + data.error, type: 'error' });
        if (conn && conn.storage === 'localstorage') {
            const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
            const updated = saved.map(c => {
                if (c._id === id) return { ...c, status: 'offline' };
                return c;
            });
            localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
        }
      }
    } catch (err) {
      addNotification({ title: 'Error', message: t('ssh.toasts.testFail'), type: 'error' });
      dispatch({ type: 'UPDATE_CONNECTION', payload: { _id: id, status: 'offline' } });
    }
  };

  return (
    <div className={`sidebar flex flex-col ${!sidebarOpen ? 'hidden' : ''}`}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            <Terminal size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('common.connections') || 'Connection Manager'}</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.manage') || 'SSH & Databases'}</p>
          </div>
        </div>

        {/* Stats mini bar */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'var(--bg-tertiary)' }}>
            <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.total') || 'Total'}</div>
          </div>
          <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>
            <div className="text-lg font-bold" style={{ color: 'var(--accent-emerald)' }}>{stats.online}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.online') || 'Online'}</div>
          </div>
          <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'rgba(244, 63, 94, 0.1)' }}>
            <div className="text-lg font-bold" style={{ color: 'var(--accent-rose)' }}>{stats.offline}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.offline') || 'Offline'}</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="input-field pl-9 text-sm"
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
            { key: 'offline', label: t('ssh.filters.offline') },
          ].map(f => (
            <button
              key={f.key}
              className={`flex-1 text-xs py-1.5 rounded-md transition-all font-medium ${
                filter === f.key
                  ? 'text-white shadow'
                  : ''
              }`}
              style={{
                background: filter === f.key ? 'var(--accent-indigo)' : 'transparent',
                color: filter === f.key ? 'white' : 'var(--text-muted)',
              }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 ? (
          <div className="empty-state py-10">
            <Server size={40} />
            <p className="text-sm mt-2">{t('ssh.noConnections')}</p>
          </div>
        ) : (
          filtered.map(conn => (
            <div
              key={conn._id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/ssh-connection', JSON.stringify(conn));
                e.dataTransfer.effectAllowed = 'copy';
                // Create a drag image
                const ghost = document.createElement('div');
                ghost.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white';
                ghost.style.cssText = `background:${conn.color || '#6366f1'};position:fixed;top:-100px;left:-100px;z-index:99999;opacity:0.9;border-radius:8px;padding:6px 14px;pointer-events:none;`;
                ghost.textContent = `🖥 ${conn.name}`;
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                setTimeout(() => document.body.removeChild(ghost), 0);
              }}
              className={`connection-item group relative !p-3 !my-2 cursor-grab active:cursor-grabbing transition-all border ${
                state.selectedConnection?._id === conn._id ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-transparent'
              }`}
              onClick={() => {
                dispatch({ type: 'SELECT_CONNECTION', payload: conn });
                handleConnect(conn);
              }}
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
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {conn.name}
                    </span>
                    <span className={`text-[8px] font-bold px-1 rounded-sm border uppercase flex-shrink-0 ${
                      conn.storage === 'db' ? 'text-indigo-400 border-indigo-400/30' :
                      conn.storage === 'localstorage' ? 'text-emerald-400 border-emerald-400/30' :
                      'text-amber-400 border-amber-400/30'
                    }`}>
                      {conn.storage === 'localstorage' ? t('common.storage.local') : conn.storage === 'manual' ? t('common.storage.tmp') : t('common.storage.db')}
                    </span>
                    {conn.isFavorite && (
                      <Star size={12} className="text-amber-400 fill-amber-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase py-0.5 px-2 bg-white/5 rounded-full border border-white/10" style={{ color: conn.color }}>
                       {conn.type === 'database' ? (conn.dbProvider || 'db').toUpperCase() : 'SSH'}
                    </span>
                    <span className="text-xs font-mono truncate opacity-60" style={{ color: 'var(--text-muted)' }}>
                      {conn.username ? `${conn.username}@` : ''}{conn.host}
                    </span>
                    {conn.tags?.slice(0, 1).map(tag => (
                       <span key={tag} className="tag-pill !py-0.5 !px-1.5 !text-[10px] opacity-70">{tag}</span>
                    ))}
                  </div>
                </div>

                {/* Actions (Absolute Overlay) */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-tertiary)]/90 p-1 rounded-lg backdrop-blur-sm shadow-lg border border-[var(--border-color)]">
                  <button
                    className="btn-icon p-1.5 hover:bg-white/10 rounded"
                    title={conn.type === 'database' ? t('common.database') : t('ssh.modal.actions.connect')}
                    onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                  >
                    {conn.type === 'database' ? (
                      state.activeDatabaseBrowsers.some(b => b.connectionId === conn._id) ? (
                        <div className="relative">
                          <Database size={14} className="text-indigo-400" />
                          <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full border border-[var(--bg-tertiary)]" />
                        </div>
                      ) : (
                        <Database size={14} className="text-emerald-400" />
                      )
                    ) : (
                      state.activeTerminals.some(t => t.connectionId === conn._id) ? (
                        <div className="relative">
                          <Terminal size={14} className="text-indigo-400" />
                          <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full border border-[var(--bg-tertiary)]" />
                        </div>
                      ) : (
                        <Terminal size={14} className="text-emerald-400" />
                      )
                    )}
                  </button>
                  
                  {conn.type !== 'database' && (
                    <button
                      className="btn-icon p-1.5 hover:bg-white/10 rounded"
                      title={t('ssh.modal.actions.files')}
                      onClick={(e) => { e.stopPropagation(); handleFiles(conn); }}
                    >
                      <Folder size={14} className={state.activeFileManagers.some(f => f.connectionId === conn._id) ? "text-indigo-400" : "text-blue-400"} />
                    </button>
                  )}

                  <button
                    className="btn-icon p-1.5 hover:bg-white/10 rounded"
                    title={t('ssh.modal.actions.edit')}
                    onClick={(e) => { e.stopPropagation(); onEditConnection(conn); }}
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    className="btn-icon p-1.5 hover:bg-white/10 rounded"
                    title={t('ssh.modal.actions.delete')}
                    onClick={(e) => { e.stopPropagation(); handleDelete(conn._id); }}
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add button */}
      <div className="p-4 border-t pb-16" style={{ borderColor: 'var(--border-color)' }}>
        <button className="btn-primary w-full justify-center" onClick={onNewConnection}>
          <Plus size={16} /> {t('ssh.newConnection')}
        </button>
      </div>

    </div>
  );
}
