'use client';

import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import {
  Server, Terminal, Activity, Clock, Globe, Shield, Cpu, HardDrive, Database,
  BarChart3, TrendingUp, Zap, Plus, RefreshCw, ChevronRight, AlertCircle,
  CheckCircle2, AlertTriangle, Star, Download, Upload, Eye, EyeOff
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';

export default function Dashboard({ onNewConnection, onEditConnection }) {
  const { state, dispatch, fetchConnections, apiFetch } = useApp();
  const { addNotification } = useOS();
  const { t } = useTranslation();
  const { connections, relayWarning } = state;
  const [refreshing, setRefreshing] = useState(false);

  // Export / Import state
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [showExportPw, setShowExportPw] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [showImportPw, setShowImportPw] = useState(false);
  const [importData, setImportData] = useState(null); // parsed connections from file
  const importFileRef = useRef(null);

  const handleExport = async () => {
    if (!exportPassword) {
      addNotification({ title: t('common.error'), message: 'A password is required to export connections.', type: 'error' });
      return;
    }
    try {
      const params = new URLSearchParams({ mode: 'encrypted', password: exportPassword });
      const res = await apiFetch(`/api/connections/export?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const payload = JSON.stringify(
        { connections: data.data, encrypted: data.encrypted, password_protected: data.password_protected, _verify: data._verify },
        null, 2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `connections_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      addNotification({ title: 'Export', message: t('ssh.toasts.exportSuccess'), type: 'success' });
      setShowExportPanel(false);
      setExportPassword('');
    } catch (err) {
      addNotification({ title: t('common.error'), message: t('ssh.toasts.exportFail'), type: 'error' });
    }
  };

  const doImport = async (connections, password) => {
    try {
      const body = { connections, ...(password ? { password } : {}), ...( importData?._verify ? { _verify: importData._verify } : {}) };
      const res = await apiFetch('/api/connections/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.error === 'WRONG_PASSWORD') {
          addNotification({ title: '🔑 Wrong Password', message: 'The password does not match. Connections cannot be decrypted — please try again with the correct password.', type: 'error' });
        } else {
          throw new Error(data.error);
        }
        return;
      }
      if (data.credentialFailures > 0) {
        addNotification({
          title: '⚠️ Credential Warning',
          message: `${data.credentialFailures} connection(s) had credentials that could not be decrypted — they were imported without passwords/keys. Please edit those connections and re-enter their credentials.`,
          type: 'warning'
        });
      }
      addNotification({ title: 'Import', message: t('ssh.toasts.importSuccess'), type: 'success' });
      fetchConnections();
      setShowImportPanel(false);
      setImportData(null);
      setImportPassword('');
    } catch (err) {
      addNotification({ title: t('common.error'), message: err.message || t('ssh.toasts.importFail'), type: 'error' });
    }
  };

  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const conns = Array.isArray(parsed) ? parsed : (parsed.connections || []);
        setImportData({ connections: conns, _verify: parsed._verify || null });
        setImportPassword('');
        setShowImportPanel(true);
      } catch {
        addNotification({ title: t('common.error'), message: 'Invalid JSON file', type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const stats = {
    total: connections.length,
    online: connections.filter(c => c.status === 'online').length,
    offline: connections.filter(c => c.status === 'offline').length,
    unknown: connections.filter(c => c.status === 'unknown' || !c.status).length,
  };

  const recentConnections = connections
    .filter(c => c.lastConnected)
    .sort((a, b) => new Date(b.lastConnected) - new Date(a.lastConnected))
    .slice(0, 6);

  const favorites = connections.filter(c => c.isFavorite);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    // Use parallel testing for speed but sequential state update if needed, 
    // actually let's just do them and then fetch.
    const promises = connections.map(conn => 
      fetch(`/api/connections/${conn._id}/test`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection: conn })
      }).catch(() => null)
    );
    await Promise.all(promises);
    await fetchConnections();
    setRefreshing(false);
  };

  const handleQuickConnect = (conn) => {
    if (conn.storage === 'manual') {
      onEditConnection(conn);
      return;
    }

    if (conn.type === 'database') {
      const existing = state.activeDatabaseBrowsers.find(b => b.connectionId === conn._id);
      if (existing) {
        dispatch({ type: 'SET_VIEW', payload: 'database' });
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

    // SSH Duplicate Check
    const existing = state.activeTerminals.find(t => t.connectionId === conn._id);
    if (existing) {
      dispatch({ type: 'SET_VIEW', payload: 'terminal' });
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

  const timeAgo = (dateStr) => {
    if (!dateStr) return t('common.time.never');
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `${diff}${t('common.time.seconds_short')}`;
    if (diff < 3600) return `${Math.floor(diff / 60)}${t('common.time.minutes_short')}`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}${t('common.time.hours_short')}`;
    return `${Math.floor(diff / 86400)}${t('common.time.days_short')}`;
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  return (
    <motion.div 
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="h-full overflow-y-auto p-4 pb-16 lg:p-6 custom-scrollbar"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-5 gap-3">
        <div>
          <motion.h1 
            variants={itemVariants}
            className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] uppercase"
          >
            {t('ssh.dashboard_ui.systemOverview')}
          </motion.h1>
          <motion.p 
            variants={itemVariants}
            className="text-[var(--text-muted)] mt-1 flex items-center gap-2"
          >
            <Activity size={14} className="text-emerald-500" />
            {t('ssh.dashboard_ui.monitoring')} {stats.total} {t('ssh.dashboard_ui.nodesAcross')}
          </motion.p>
        </div>
        <motion.div variants={itemVariants} className="flex gap-3 flex-wrap">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all active:scale-95"
            onClick={handleRefreshAll}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            <span className="text-sm font-medium">{refreshing ? t('ssh.dashboard_ui.syncing') : t('ssh.dashboard_ui.refreshStatus')}</span>
          </button>

          {/* Export button */}
          <div className="relative">
            <button
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all active:scale-95 text-sm font-medium ${
                showExportPanel
                  ? 'bg-[var(--bg-selected)] border-[var(--accent-indigo)]/50 text-[var(--text-selected)]'
                  : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
              onClick={() => { setShowExportPanel(p => !p); setShowImportPanel(false); }}
            >
              <Download size={16} />
              <span>Export</span>
            </button>
            {showExportPanel && (
              <div className="absolute right-0 top-full mt-2 w-64 p-3 rounded-xl border shadow-xl z-50" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <p className="text-[11px] text-[var(--text-muted)] mb-1">Credentials are encrypted with this password.</p>
                <p className="text-[11px] text-amber-400 mb-2">⚠ Required — you'll need it to import.</p>
                <div className="relative mb-2">
                  <input
                    type={showExportPw ? 'text' : 'password'}
                    className="input-field text-xs w-full pr-8"
                    placeholder="Export password (required)"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && exportPassword) handleExport(); }}
                    autoFocus
                  />
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    onClick={() => setShowExportPw(p => !p)}
                  >
                    {showExportPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <button
                  className="btn-primary w-full justify-center text-xs py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={handleExport}
                  disabled={!exportPassword}
                >
                  <Download size={13} /> Download JSON
                </button>
              </div>
            )}
          </div>

          {/* Import button */}
          <div className="relative">
            <button
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all active:scale-95 text-sm font-medium ${
                showImportPanel
                  ? 'bg-[var(--bg-selected)] border-[var(--accent-indigo)]/50 text-[var(--text-selected)]'
                  : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
              onClick={() => { setShowExportPanel(false); importFileRef.current?.click(); }}
            >
              <Upload size={16} />
              <span>Import</span>
            </button>
            {showImportPanel && importData && (
              <div className="absolute right-0 top-full mt-2 w-64 p-3 rounded-xl border shadow-xl z-50" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <p className="text-[11px] font-medium text-[var(--accent-indigo)] mb-1">{importData.connections.length} connections found</p>
                <p className="text-[11px] text-[var(--text-muted)] mb-1">Enter the password used when exporting.</p>
                <p className="text-[11px] text-amber-400 mb-2">⚠ Required to decrypt credentials.</p>
                <div className="relative mb-2">
                  <input
                    type={showImportPw ? 'text' : 'password'}
                    className="input-field text-xs w-full pr-8"
                    placeholder="Import password (required)"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && importPassword) doImport(importData.connections, importPassword); }}
                    autoFocus
                  />
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    onClick={() => setShowImportPw(p => !p)}
                  >
                    {showImportPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 btn-primary justify-center text-xs py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => doImport(importData.connections, importPassword)}
                    disabled={!importPassword}
                  >
                    <Upload size={13} /> Import
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-all"
                    onClick={() => { setShowImportPanel(false); setImportData(null); setImportPassword(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <button 
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[var(--bg-selected)] border border-[var(--accent-indigo)]/50 text-[var(--text-selected)] hover:opacity-90 transition-all shadow-lg shadow-[var(--glow-indigo)]/20 active:scale-95" 
            onClick={onNewConnection}
          >
            <Plus size={18} /> 
            <span className="text-sm font-semibold">{t('ssh.dashboard_ui.newServer')}</span>
          </button>

          {/* Hidden file input for import */}
          <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFileChange} />
        </motion.div>
      </div>

      {/* Cloud Sync Promotion */}
      {state.connections.some(c => c.storage === 'localstorage') && (
        <motion.div 
          variants={itemVariants}
          className="mb-5 p-4 rounded-2xl bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 backdrop-blur-xl relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
             <RefreshCw size={80} className="animate-spin-slow" />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[var(--bg-selected)] border border-[var(--accent-indigo)]/30 flex items-center justify-center shadow-lg shadow-[var(--glow-indigo)]/20">
                <Globe size={28} className="text-[var(--text-selected)]" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{t('ssh.dashboard_ui.syncPromo.title')}</h2>
                <p className="text-sm text-[var(--text-muted)] max-w-lg">
                  {t('ssh.dashboard_ui.syncPromo.desc')}
                </p>
              </div>
            </div>
            <button 
              onClick={async () => {
                const localConns = state.connections.filter(c => c.storage === 'localstorage');
                if (localConns.length === 0) return;
                
                setRefreshing(true);
                try {
                  for (const conn of localConns) {
                    await fetch('/api/connections', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...conn, storage: 'db' })
                    });
                    // Cleanup local storage for this item
                    const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
                    const updated = saved.filter(c => c._id !== conn._id);
                    localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
                  }
                  await fetchConnections();
                  dispatch({ type: 'ADD_NOTIFICATION', payload: { title: t('ssh.dashboard_ui.syncPromo.synced'), message: t('ssh.dashboard_ui.syncPromo.syncedDesc'), type: 'success' } });
                } catch (e) {
                  console.error(e);
                } finally {
                  setRefreshing(false);
                }
              }}
              className="px-6 py-3 bg-white dark:bg-slate-100 text-indigo-600 font-bold rounded-2xl hover:bg-slate-100 dark:hover:bg-white transition-all shadow-xl border border-indigo-200 dark:border-transparent whitespace-nowrap"
            >
              {t('ssh.dashboard_ui.syncPromo.btn')}
            </button>
          </div>
        </motion.div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard 
          icon={Server} 
          label={t('ssh.dashboard_ui.totalNodes')} 
          value={stats.total} 
          color="indigo" 
          subValue={t('ssh.dashboard_ui.statsSub.total')}
        />
        <StatCard 
          icon={CheckCircle2} 
          label={t('ssh.dashboard_ui.healthy')} 
          value={stats.online} 
          color="emerald" 
          subValue={t('ssh.dashboard_ui.statsSub.healthy')}
        />
        <StatCard 
          icon={AlertTriangle} 
          label={t('ssh.dashboard_ui.down')} 
          value={stats.offline} 
          color="rose" 
          subValue={t('ssh.dashboard_ui.statsSub.down')}
        />
        <StatCard 
          icon={Globe} 
          label={t('ssh.dashboard_ui.unknown')} 
          value={stats.unknown} 
          color="slate" 
          subValue={t('ssh.dashboard_ui.statsSub.unknown')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Quick Connect - Favorites */}
        <motion.div variants={itemVariants} className="xl:col-span-2 group">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-base font-bold flex items-center gap-2 text-[var(--text-primary)]">
              <Zap size={18} className="text-amber-400 fill-amber-400" />
              {t('ssh.pinnedServers')}
            </h2>
            <button className="text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] font-medium transition-colors">
              {t('ssh.dashboard_ui.manageFavorites')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AnimatePresence mode="popLayout">
              {favorites.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="col-span-2 py-6 rounded-2xl border border-dashed border-[var(--border-color)] flex flex-col items-center justify-center text-center bg-[var(--bg-card)]"
                >
                  <Star className="text-[var(--text-muted)] mb-3" size={32} />
                  <p className="text-sm text-[var(--text-muted)]">{t('ssh.dashboard_ui.noPinned')}</p>
                  <p className="text-xs text-[var(--text-muted)] opacity-60 mt-1">{t('ssh.dashboard_ui.starPrompt')}</p>
                </motion.div>
              ) : (
                favorites.map((conn, index) => (
                  <ConnectionCard 
                    key={conn._id || `fav-${index}`} 
                    onClick={() => handleQuickConnect(conn)} 
                  />
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div variants={itemVariants} className="group">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-base font-bold flex items-center gap-2 text-[var(--text-primary)]">
              <Clock size={18} className="text-[var(--text-secondary)]" />
              {t('ssh.dashboard_ui.recentLogs')}
            </h2>
          </div>

          <div className="space-y-2 bg-[var(--bg-card)] rounded-2xl p-3 border border-[var(--border-color)] relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-3xl rounded-full -mr-10 -mt-10" />
            
            {recentConnections.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-[var(--text-muted)]">{t('ssh.dashboard_ui.noActivity')}</p>
              </div>
            ) : (
              recentConnections.map((conn, index) => (
                <motion.div
                  key={conn._id || `recent-${index}`}
                  whileHover={{ x: 4, backgroundColor: 'var(--bg-card-hover)' }}
                  className="flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border border-transparent hover:border-[var(--border-hover)] group/link"
                  onClick={() => handleQuickConnect(conn)}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-[var(--bg-tertiary)] to-transparent">
                     <div className="absolute inset-0 bg-cyan-500/10 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                     {conn.type === 'database' ? (
                       <Database size={18} style={{ color: conn.color }} />
                     ) : (
                       <Server size={18} style={{ color: conn.color }} />
                     )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate block group-hover/link:text-indigo-400 transition-colors">
                      {conn.name}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 font-medium">
                      <Clock size={10} />
                      {timeAgo(conn.lastConnected)}
                      <span className="mx-1">•</span>
                      {conn.type === 'database' ? (conn.dbProvider || 'db').toUpperCase() : 'SSH'}
                    </span>
                  </div>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    conn.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                    conn.status === 'offline' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-gray-600'
                  }`} />
                </motion.div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* Relay Agent Warning Banner */}
      {relayWarning && (
        <motion.div
          variants={itemVariants}
          className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3"
        >
          <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">{t('relay.warningTitle', 'Local Relay Agent Required')}</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              {t('relay.warningDesc', 'Your database URI targets localhost, but the Local Relay Agent is not running. Go to Settings → Database to install and start the relay agent, or use a remote database URI.')}
            </p>
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_RELAY_WARNING', payload: null })}
            className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </motion.div>
      )}

      {/* Empty state for no connections */}
      {connections.length === 0 && (
        <motion.div 
          variants={itemVariants}
          className="mt-10 relative group overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 blur-3xl opacity-20 -z-10" />
          <div className="rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] p-12 text-center backdrop-blur-sm">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-2xl shadow-indigo-500/30 transform rotate-12 group-hover:rotate-0 transition-transform duration-500">
               <Shield size={44} className="text-white" />
            </div>
            <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{t('ssh.dashboard_ui.buildNetwork')}</h3>
            <p className="text-[var(--text-muted)] mb-8 max-w-md mx-auto">
              {t('ssh.dashboard_ui.addDescription')}
            </p>
            <button 
              className="px-8 py-3 bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold rounded-2xl hover:opacity-90 transition-all flex items-center gap-2 mx-auto shadow-xl" 
              onClick={onNewConnection}
            >
              <Plus size={20} />
              {t('ssh.dashboard_ui.addFirstServer')}
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function StatCard({ icon: Icon, label, value, color, subValue }) {
  const colorMap = {
    indigo: { bg: 'bg-indigo-500/10', icon: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20', shadow: 'shadow-indigo-500/10' },
    emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', shadow: 'shadow-emerald-500/10' },
    rose: { bg: 'bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20', shadow: 'shadow-rose-500/10' },
    slate: { bg: 'bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/20', shadow: 'shadow-slate-500/10' },
  };
  const theme = colorMap[color];

  return (
    <motion.div
      variants={{
        hidden: { scale: 0.9, opacity: 0 },
        visible: { scale: 1, opacity: 1 }
      }}
      whileHover={{ y: -4 }}
      className={`relative overflow-hidden p-4 rounded-2xl bg-[var(--bg-tertiary)]/20 border ${theme.border} ${theme.shadow} backdrop-blur-md group`}
    >
      <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
         <div className={`w-2 h-2 rounded-full ${theme.icon.replace('text-', 'bg-')}`} />
      </div>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-2xl ${theme.bg} flex items-center justify-center transition-transform group-hover:scale-110 duration-500`}>
          <Icon size={24} className={theme.icon} />
        </div>
        <div className="text-right">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
          <div className="text-3xl font-black text-[var(--text-primary)] mt-0.5 tracking-tight">{value}</div>
        </div>
      </div>
      <div className="text-xs text-[var(--text-muted)] font-medium flex items-center gap-1.5 opacity-80">
         <TrendingUp size={12} className={theme.icon} />
         {subValue}
      </div>
    </motion.div>
  );
}

function ConnectionCard({ conn, onClick }) {
  const { t } = useTranslation();
  const isOnline = conn.status === 'online';
  
  return (
    <motion.div
      layout
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02, backgroundColor: 'var(--bg-card-hover)' }}
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
      className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] cursor-grab active:cursor-grabbing relative group transition-all"
      onClick={onClick}
    >
      <div className="absolute top-4 right-4 flex gap-1 items-center">
         <span className="text-[9px] font-bold uppercase py-0.5 px-2 bg-white/5 rounded-full border border-white/10" style={{ color: conn.color }}>
           {conn.type === 'database' ? (conn.dbProvider || 'db').toUpperCase() : 'SSH'}
         </span>
         <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner relative overflow-hidden" 
             style={{ background: `${conn.color}15` }}>
           <div className="absolute inset-0 opacity-10" style={{ background: conn.color }} />
           {conn.type === 'database' ? (
             <Database size={22} style={{ color: conn.color }} />
           ) : (
             <Server size={22} style={{ color: conn.color }} />
           )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[var(--text-primary)] truncate text-base tracking-tight">{conn.name}</h3>
          <p className="text-xs text-[var(--text-muted)] font-mono truncate">{conn.host || conn.database || t('common.untitled')}</p>
        </div>
      </div>

      <div className="space-y-3">
        {conn.info && (
          <div className="px-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
             <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400 mb-1">
                <Shield size={10} />
                <span className="text-[9px] font-bold uppercase tracking-widest">{t('ssh.dashboard_ui.healthState')}</span>
             </div>
             <p className="text-[10px] text-[var(--text-muted)] font-mono leading-relaxed line-clamp-1">
               {conn.info}
             </p>
          </div>
        )}
        
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-1.5">
             {conn.tags?.slice(0, 2).map(tag => (
                <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/10 font-medium">
                  {tag}
                </span>
             ))}
          </div>
          <button className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all">
            <Terminal size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

