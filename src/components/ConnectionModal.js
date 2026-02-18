'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import { useTranslation } from 'react-i18next';
import { useSession, signIn } from 'next-auth/react';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import {
  X, Server, User, Lock, Key, Upload, FileKey, Hash, Tag, Palette, StickyNote, Database, HardDrive, Cpu, Eye, EyeOff, Activity, RefreshCw
} from 'lucide-react';

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
];

export default function ConnectionModal({ onClose, editConnection = null }) {
  const { state, dispatch, fetchConnections, apiFetch } = useApp();
  const { addNotification, showAlert } = useOS();
  const { t } = useTranslation();
  const { data: session } = useSession();
  const fileInputRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isUriModalOpen, setIsUriModalOpen] = useState(false);
  const [uriInput, setUriInput] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [form, setForm] = useState({
    type: editConnection?.type || 'ssh',
    dbProvider: editConnection?.dbProvider || 'mongodb',
    name: editConnection?.name || '',
    host: editConnection?.host || '',
    port: editConnection?.port || (editConnection?.type === 'database' ? 3306 : 22),
    username: editConnection?.username || '',
    password: '',
    database: editConnection?.database || '',
    authType: editConnection?.authType || 'password',
    privateKey: '',
    keyFileName: editConnection?.keyFileName || '',
    passphrase: '',
    tags: editConnection?.tags?.join(', ') || '',
    color: editConnection?.color || (editConnection?.type === 'database' ? '#10b981' : '#6366f1'),
    notes: editConnection?.notes || '',
    targetStorage: editConnection?.storage || state.storageMode || 'db',
  });

  // Auto-set ports based on provider
  useEffect(() => {
    if (form.type === 'database' && !editConnection) {
        if (form.dbProvider === 'mongodb') handleChange('port', 27017);
        if (form.dbProvider === 'mysql') handleChange('port', 3306);
        if (form.dbProvider === 'postgres') handleChange('port', 5432);
        if (form.dbProvider === 'sqlite') handleChange('port', 0);
    }
  }, [form.dbProvider, form.type]);

  // Auto-fallback: if not logged in and default was 'db', switch to 'localstorage'
  useEffect(() => {
    if (!session && form.targetStorage === 'db' && !editConnection) {
      setForm(prev => ({ ...prev, targetStorage: 'localstorage' }));
    } else if (session && form.targetStorage === 'localstorage' && !editConnection) {
      // Auto-promote to cloud if logged in
      setForm(prev => ({ ...prev, targetStorage: 'db' }));
    }
  }, [session]);

  const handleChange = (field, value) => {
    setForm(prev => {
      const newForm = { ...prev, [field]: value };
      
      // Dynamic color/port defaults when switching type
      if (field === 'type') {
         if (value === 'database') {
            newForm.color = '#10b981'; // Emerald for DB
            newForm.port = 27017;
            newForm.dbProvider = 'mongodb';
         } else {
            newForm.color = '#6366f1'; // Indigo for SSH
            newForm.port = 22;
         }
      }

      // If switching to manual mode, clear sensitive fields as requested
      if (field === 'targetStorage' && value === 'manual') {
        return {
          ...newForm,
          password: '',
          privateKey: '',
          keyFileName: '',
          passphrase: '',
        };
      }
      return newForm;
    });
  };

  // Decrypt on mount if editing any connection
  useEffect(() => {
    if (editConnection) {
       // If it's a manual connection, we don't pre-fill sensitive data (user must re-enter)
       if (editConnection.storage === 'manual') {
         setForm(prev => ({
           ...prev,
           password: '',
           privateKey: '',
           passphrase: '',
         }));
         return;
       }

       // For other connections, we don't decrypt password anymore for security.
       // User can leave blank to keep unchanged.
       setForm(prev => ({
         ...prev,
         password: '', // Don't show old password
         privateKey: '', // Don't show old private key (user re-uploads or leaves blank)
         passphrase: '', // Don't show old passphrase
       }));
    }
  }, [editConnection]);

  const handleFileUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setForm(prev => ({
        ...prev,
        privateKey: e.target.result,
        keyFileName: file.name,
      }));
    };
    reader.readAsText(file);
  };

  const handleParseURI = () => {
    if (!uriInput) return;
    
    try {
      const input = uriInput.trim();
      // Basic validation for protocol
      if (!input.includes('://')) {
        throw new Error('Missing protocol');
      }

      // Handle common variations
      const url = new URL(input);
      const isMongo = url.protocol === 'mongodb:' || url.protocol === 'mongodb+srv:';
      const isMongoSrv = url.protocol === 'mongodb+srv:';
      const isMysql = url.protocol === 'mysql:';
      const isPostgres = url.protocol === 'postgresql:' || url.protocol === 'postgres:';
      
      if (isMongo || isMysql || isPostgres) {
        setForm(prev => {
          const newForm = { ...prev };
          newForm.type = 'database';
          if (isMongo) {
            newForm.dbProvider = 'mongodb';
            newForm.isSrv = isMongoSrv;
          }
          else if (isMysql) newForm.dbProvider = 'mysql';
          else if (isPostgres) newForm.dbProvider = 'postgres';

          newForm.host = url.hostname;
          if (url.port) {
            newForm.port = parseInt(url.port);
          } else {
            // Defaults if port missing
            if (isMongo) newForm.port = isMongoSrv ? 0 : 27017;
            if (isMysql) newForm.port = 3306;
            if (isPostgres) newForm.port = 5432;
          }

          // Always reset auth fields first, then apply if present in URI
          newForm.username = url.username ? decodeURIComponent(url.username) : '';
          if (url.password) {
            newForm.password = decodeURIComponent(url.password);
            newForm.authType = 'password';
          } else {
            newForm.password = '';
            newForm.authType = 'none';
          }

          // Reset database then apply if present
          newForm.database = '';
          if (url.pathname && url.pathname.length > 1) {
            newForm.database = url.pathname.substring(1).split('?')[0];
          }
          
          return newForm;
        });
        addNotification({ title: 'Import successful', message: 'URI details have been applied.', type: 'info' });
        setIsUriModalOpen(false);
        setUriInput('');
      } else {
        showAlert('Only mongodb://, mysql:// and postgresql:// are supported.', 'Unsupported Protocol');
      }
    } catch (e) {
      console.error('URI Parse Error:', e);
      showAlert('The provided string is not a valid URI format.', 'Invalid URI');
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const payload = {
        connection: {
          ...form,
          port: parseInt(form.port) || 0,
        }
      };

      const res = await apiFetch(`/api/connections/local-test/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      
      if (res.status === 429) {
        addNotification({ 
          title: 'Rate Limited', 
          message: data.error || 'Too many requests. Please wait.', 
          type: 'error' 
        });
      } else if (data.success) {
        addNotification({ 
          title: 'Success', 
          message: `${t('ssh.toasts.connectSuccess')}: ${data.info || 'Connected'}`, 
          type: 'success' 
        });
      } else {
        addNotification({ 
          title: 'Connection Failed', 
          message: data.error || t('ssh.toasts.connectFail'), 
          type: 'error' 
        });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = {
      name: form.name,
      type: form.type,
      dbProvider: form.dbProvider,
      host: form.host,
      port: parseInt(form.port) || 0,
      username: form.username,
      database: form.database || null,
      authType: form.authType,
      keyFileName: form.keyFileName || null,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      color: form.color,
      notes: form.notes,
      storage: form.targetStorage,
    };

    if (form.authType === 'password' && form.password) {
      payload.password = form.password;
    }
    
    if (form.authType === 'privateKey') {
      if (form.privateKey) payload.privateKey = form.privateKey;
      if (form.passphrase) payload.passphrase = form.passphrase;
    }

    try {
      let finalPayload = { ...payload };

      // Encrypt if storing locally or manual
      if (form.targetStorage === 'localstorage' || form.targetStorage === 'manual') {
          const encRes = await apiFetch('/api/utils/encrypt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: { 
                password: payload.password, 
                privateKey: payload.privateKey, 
                passphrase: payload.passphrase 
            } }),
          });
          const encData = await encRes.json();
          if (encData.success) {
             finalPayload.password = encData.data.password;
             finalPayload.privateKey = encData.data.privateKey;
             finalPayload.passphrase = encData.data.passphrase;
          }
      }

      const data = { success: true, data: { ...finalPayload, _id: editConnection?._id || `local-${Date.now()}`, updatedAt: new Date().toISOString() } };

      if (form.targetStorage === 'localstorage') {
        const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
        let updated;
        if (editConnection) {
          // Merge with existing to preserve fields like password if not updated
          updated = saved.map(c => c._id === editConnection._id ? { ...c, ...data.data } : c);
          dispatch({ type: 'UPDATE_CONNECTION', payload: data.data });
        } else {
          updated = [data.data, ...saved];
          dispatch({ type: 'ADD_CONNECTION', payload: data.data });
        }
        localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
        addNotification({ title: 'Saved', message: editConnection ? t('ssh.modal.buttons.update') : t('ssh.modal.buttons.save'), type: 'success' });
        
        // AUTO-OPEN after save
        const savedConn = data.data;
        if (savedConn.type === 'database') {
          dispatch({
            type: 'OPEN_DATABASE_BROWSER',
            payload: {
              id: `db-${savedConn._id}-${Date.now()}`,
              connectionId: savedConn._id,
              connectionName: savedConn.name,
              color: savedConn.color,
              connection: savedConn,
            },
          });
        } else {
          dispatch({
            type: 'OPEN_TERMINAL',
            payload: {
              id: `term-${savedConn._id}-${Date.now()}`,
              connectionId: savedConn._id,
              connectionName: savedConn.name,
              host: savedConn.host,
              color: savedConn.color,
              connection: savedConn,
            },
          });
        }

        onClose();
        return;
      }

      if (form.targetStorage === 'manual') {
        const connectionId = editConnection?._id || `local-${Date.now()}`;
        const finalFullData = { ...data.data, _id: connectionId };
        
        // Strip sensitive data for the sidebar/state
        const payloadToSave = { 
          ...finalFullData, 
          password: '', 
          privateKey: '', 
          passphrase: '',
          storage: 'manual'
        };

        if (editConnection) {
          dispatch({ type: 'UPDATE_CONNECTION', payload: payloadToSave });
        } else {
          dispatch({ type: 'ADD_CONNECTION', payload: payloadToSave });
        }

        // AUTO-OPEN Terminal with full credentials (including password)
        // This allows immediate connection without persisting the password in state.
        dispatch({
          type: 'OPEN_TERMINAL',
          payload: {
            id: `term-${connectionId}-${Date.now()}`,
            connectionId: connectionId,
            connectionName: finalFullData.name,
            host: finalFullData.host,
            color: finalFullData.color,
            connection: finalFullData, // Full data with password
          },
        });

        addNotification({ title: 'Session Updated', message: editConnection ? t('ssh.toasts.manualUpdate') : t('ssh.toasts.manualSuccess'), type: 'success' });
        onClose();
        return;
      }

      let url = '/api/connections';
      let method = 'POST';

      if (editConnection && editConnection.storage === 'db' && !editConnection._id.startsWith('local-')) {
        url = `/api/connections/${editConnection._id}`;
        method = 'PUT';
      }


      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (resData.success) {
        // If we were editing a local connection but saved it to DB, cleanup local
        if (editConnection && editConnection.storage === 'localstorage') {
            const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
            const updated = saved.filter(c => c._id !== editConnection._id);
            localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
        }
        
        addNotification({ title: 'Saved to Cloud', message: editConnection ? t('ssh.toasts.dbUpdate') : t('ssh.toasts.dbSuccess'), type: 'success' });
        await fetchConnections();
        
        // AUTO-OPEN after save
        const savedConn = { 
          ...payload, 
          _id: resData.data._id || (editConnection ? editConnection._id : null) 
        };
        
        if (savedConn.type === 'database') {
            dispatch({
              type: 'OPEN_DATABASE_BROWSER',
              payload: {
                id: `db-${savedConn._id}-${Date.now()}`,
                connectionId: savedConn._id,
                connectionName: savedConn.name,
                color: savedConn.color,
                connection: savedConn,
              },
            });
        } else {
            dispatch({
              type: 'OPEN_TERMINAL',
              payload: {
                id: `term-${savedConn._id}-${Date.now()}`,
                connectionId: savedConn._id,
                connectionName: savedConn.name,
                host: savedConn.host,
                color: savedConn.color,
                connection: savedConn,
              },
            });
        }

        onClose();
      } else {
        addNotification({ title: 'Error', message: resData.error || t('ssh.toasts.saveFail'), type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: t('ssh.toasts.errorPrefix') + err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  const storageOptions = [
    { id: 'db', icon: <Database size={16} />, label: t('ssh.modal.storageOptions.db'), desc: t('ssh.modal.storageOptions.dbDesc') },
    { id: 'localstorage', icon: <HardDrive size={16} />, label: t('ssh.modal.storageOptions.local'), desc: t('ssh.modal.storageOptions.localDesc') },
    { id: 'manual', icon: <Cpu size={16} />, label: t('ssh.modal.storageOptions.manual'), desc: t('ssh.modal.storageOptions.manualDesc') },
  ];

  const modalJsx = createPortal(
    <MacOSModalWindow
      isOpen
      title={editConnection ? t('ssh.modal.titleEdit') : t('ssh.modal.titleNew')}
      icon={form.type === 'database' ? Database : Server}
      onClose={onClose}
      zIndexClassName="z-[40000]"
      draggable
      resizable
      defaultWidth={800}
      defaultHeight={600}
      minWidth={600}
      minHeight={500}
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[80vh]"
      contentClassName="p-6 overflow-y-auto custom-scrollbar"
      closeOnOverlayClick
      overlayClassName="bg-black/40 backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
          {/* Storage Selection */}
          <div className="bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/10">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 block text-center">
              {t('ssh.modal.storagePrompt')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {storageOptions.map((opt) => {
                const isDisabled = opt.id === 'db' && !session;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => !isDisabled && handleChange('targetStorage', opt.id)}
                    disabled={isDisabled}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                      form.targetStorage === opt.id
                        ? 'bg-indigo-500/10 dark:bg-indigo-500/20 border-indigo-500/50 text-indigo-700 dark:text-indigo-400'
                        : isDisabled
                        ? 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] cursor-not-allowed opacity-50'
                        : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-primary)]'
                    }`}
                  >
                    <div className={`mb-1.5 ${form.targetStorage === opt.id ? 'text-indigo-400' : ''}`}>
                      {opt.icon}
                    </div>
                    <span className="text-[10px] font-bold">{opt.label}</span>
                    {isDisabled && (
                      <span className="text-[8px] text-[var(--text-muted)] mt-0.5">{t('vault.loginRequired')}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {form.targetStorage === 'db' && !session && (
              <div className="flex items-center gap-2 p-2 mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300">
                <Lock size={10} className="shrink-0" />
                <span className="opacity-90">{t('vault.loginRequiredDesc')}</span>
                <button
                  type="button"
                  onClick={() => signIn('google')}
                  className="ml-auto px-2 py-1 bg-white text-black text-[10px] font-bold rounded hover:bg-slate-200 transition-all flex items-center gap-1.5"
                >
                  <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-2.5 h-2.5" alt="" />
                  {t('vault.loginBtn')}
                </button>
              </div>
            )}
            {form.targetStorage === 'db' && session && (
              <div className="flex items-start gap-2 p-2 mt-2 rounded-lg bg-[var(--glow-indigo)] border border-[var(--glow-indigo)] text-[10px] text-[var(--accent-indigo)]">
                <Lock size={10} className="mt-0.5 shrink-0" />
                <span className="opacity-80">{t('vault.masterKeyInfo')}</span>
              </div>
            )}
          </div>

          {/* Connection Type */}
          <div className="space-y-3">
             <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] block">
               {t('common.type') || 'Connection Type'}
             </label>
             <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-xl">
               {[
                 { id: 'ssh', label: 'SSH Server', icon: Server },
                 { id: 'database', label: 'Database', icon: Database },
               ].map(type => (
                 <button
                   key={type.id}
                   type="button"
                   onClick={() => handleChange('type', type.id)}
                   className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg transition-all ${
                     form.type === type.id
                       ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                       : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                   }`}
                 >
                   <type.icon size={14} />
                   {type.label}
                 </button>
               ))}
             </div>
          </div>

          {/* Database Provider Selection (if database) */}
          {form.type === 'database' && (
             <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--accent-emerald)] block">
                  {t('settings_ui.db.activeDb') || 'Database Provider'}
                </label>
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'mongodb', label: 'MongoDB', color: '#10b981', icon: Database, bg: 'bg-emerald-500/10' },
                      { id: 'mysql', label: 'MySQL', color: '#00758f', icon: Database, bg: 'bg-blue-500/10' },
                      { id: 'postgres', label: 'Postgres', color: '#336791', icon: Database, bg: 'bg-indigo-500/10' },
                      { id: 'sqlite', label: 'SQLite', color: '#003b57', icon: Database, bg: 'bg-slate-500/10' },
                    ].map(prov => (
                      <button 
                        key={prov.id}
                        type="button"
                        onClick={() => handleChange('dbProvider', prov.id)}
                        className={`flex flex-col items-center gap-2 py-3 rounded-xl border transition-all relative overflow-hidden group ${
                          form.dbProvider === prov.id
                            ? 'bg-[var(--bg-primary)] dark:bg-white/5 border-indigo-500/50 scale-95 shadow-lg'
                            : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] hover:border-[var(--border-color)]/50'
                        }`}
                      >
                         <div className={`p-2 rounded-lg ${prov.bg} transition-transform group-hover:scale-110`}>
                           <prov.icon size={16} style={{ color: prov.color }} />
                         </div>
                          <span className={`text-[10px] font-bold ${form.dbProvider === prov.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-[var(--text-muted)]'}`}>
                           {prov.label}
                         </span>
                         {form.dbProvider === prov.id && (
                           <div className="absolute top-1 right-1">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                           </div>
                         )}
                      </button>
                    ))}
                 </div>
              </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
             <div className="space-y-5">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    <StickyNote size={14} /> {t('ssh.modal.form.name')}
                  </label>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Supported:</span>
                      <div className="flex gap-1.5 grayscale opacity-50">
                         <Database size={12} className="text-emerald-500" />
                         <Database size={12} className="text-blue-500" />
                         <Database size={12} className="text-indigo-500" />
                         <Database size={12} className="text-slate-500" />
                      </div>
                    </div>
                    {form.type === 'database' && (
                      <button 
                        type="button"
                        onClick={() => setIsUriModalOpen(true)}
                        className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20"
                      >
                         <Upload size={10} /> Paste URI
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('ssh.modal.placeholders.name')}
                    value={form.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    required
                  />
                </div>

                {form.dbProvider !== 'sqlite' ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                        <Server size={14} /> {t('ssh.modal.form.host')}
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder={t('ssh.modal.placeholders.host')}
                        value={form.host}
                        onChange={(e) => handleChange('host', e.target.value)}
                        required
                      />
                      {form.type === 'database' && (
                        <div className="flex gap-2 mt-2 px-1">
                           <button 
                             type="button"
                             onClick={() => handleChange('host', '127.0.0.1')}
                             className="text-[9px] font-bold px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                           >
                              127.0.0.1
                           </button>
                           <button 
                             type="button"
                             onClick={() => handleChange('host', 'localhost')}
                             className="text-[9px] font-bold px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                           >
                              localhost
                           </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                        <Activity size={14} /> {t('ssh.modal.form.port')}
                      </label>
                      <input
                        type="number"
                        className="input-field"
                        placeholder="22"
                        value={form.port}
                        onChange={(e) => handleChange('port', e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <Server size={14} /> SQLite File Path
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="/path/to/database.sqlite"
                      value={form.host}
                      onChange={(e) => handleChange('host', e.target.value)}
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    <User size={14} /> {form.type === 'database' ? 'Db User' : t('ssh.modal.form.username')}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={form.type === 'database' ? 'root' : t('ssh.modal.placeholders.username')}
                    value={form.username}
                    onChange={(e) => handleChange('username', e.target.value)}
                    required={(form.type !== 'database' || form.dbProvider !== 'sqlite') && form.authType !== 'none'}
                  />
                </div>

                {form.type === 'database' && (
                  <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                    <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <Database size={14} /> Database Name
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. production_db"
                      value={form.database}
                      onChange={(e) => handleChange('database', e.target.value)}
                      required={form.dbProvider !== 'mongodb'}
                    />
                  </div>
                )}
             </div>

             <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>
                    {t('ssh.modal.auth.title')}
                  </label>
                  <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-lg">
                    <button
                      type="button"
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        form.authType === 'password'
                          ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50'
                      }`}
                      onClick={() => handleChange('authType', 'password')}
                    >
                      {t('ssh.modal.auth.password')}
                    </button>
                    <button
                      type="button"
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        form.authType === 'privateKey'
                          ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50'
                      }`}
                      onClick={() => handleChange('authType', 'privateKey')}
                    >
                      {t('ssh.modal.auth.key')}
                    </button>
                    {form.type === 'database' && (
                      <button
                        type="button"
                        className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                          form.authType === 'none'
                            ? 'bg-indigo-700 dark:bg-indigo-600 text-white shadow-lg'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50'
                        }`}
                        onClick={() => handleChange('authType', 'none')}
                      >
                        {t('common.none') || 'None'}
                      </button>
                    )}
                  </div>
                </div>

                {form.authType === 'password' ? (
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <Lock size={14} /> {t('ssh.modal.form.password')}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        className="input-field pr-10"
                        placeholder={editConnection ? t('ssh.modal.placeholders.passwordEdit') : t('ssh.modal.placeholders.password')}
                        value={form.password}
                        onChange={(e) => handleChange('password', e.target.value)}
                        required={!editConnection && form.authType !== 'none'}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                ) : form.authType === 'none' ? (
                   <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-xl flex items-center gap-3">
                     <Activity size={16} className="text-emerald-400 shrink-0" />
                     <span className="text-[10px] text-[var(--text-muted)] italic">
                       No authentication required for this connection. Be careful with open databases.
                     </span>
                   </div>
                ) : (
                  <>
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                        <FileKey size={14} /> {t('ssh.modal.form.keyFile')}
                      </label>
                      <div
                        className={`upload-area ${dragOver ? 'dragover' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e.target.files[0])}
                        />
                        {form.keyFileName ? (
                          <span className="text-xs text-[var(--accent-indigo)] font-medium truncate max-w-full px-2">
                             {form.keyFileName}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-muted)] lowercase text-center px-4">{t('ssh.modal.placeholders.dropKey')}</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <input
                        type="password"
                        className="input-field text-xs"
                        placeholder={t('ssh.modal.placeholders.passphrase')}
                        value={form.passphrase}
                        onChange={(e) => handleChange('passphrase', e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-[var(--border-color)]">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  <Tag size={14} /> {t('ssh.modal.form.tags')}
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={t('ssh.modal.placeholders.tags')}
                  value={form.tags}
                  onChange={(e) => handleChange('tags', e.target.value)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  <Palette size={14} /> {t('ssh.modal.form.color')}
                </label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {COLORS.map(color => (
                    <div
                      key={color}
                      className={`w-6 h-6 rounded-lg cursor-pointer transition-all border-2 ${
                        form.color === color ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ background: color }}
                      onClick={() => handleChange('color', color)}
                    />
                  ))}
                </div>
              </div>
           </div>

            <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-[var(--border-color)]">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting || isSubmitting}
              className="px-6 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isTesting ? <RefreshCw size={16} className="animate-spin" /> : <Activity size={16} />}
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 justify-center py-3 font-bold"
              disabled={isSubmitting || (form.targetStorage === 'db' && !session)}
            >
              {isSubmitting ? t('ssh.modal.buttons.saving') : (editConnection ? t('ssh.modal.buttons.update') : t('ssh.modal.buttons.save'))}
            </button>
            <button type="button" className="px-6 rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/70 transition-all text-sm font-medium" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
    </MacOSModalWindow>,
    document.body
  );

  const uriImportModal = isUriModalOpen && createPortal(
    <MacOSModalWindow
      isOpen
      title="Import Connection URI"
      icon={Database}
      onClose={() => setIsUriModalOpen(false)}
      zIndexClassName="z-[45000]"
      draggable={true}
      resizable={true}
      defaultWidth={480}
      defaultHeight={360}
      minWidth={400}
      minHeight={300}
      contentClassName="p-6 overflow-y-auto custom-scrollbar"
      closeOnOverlayClick
      overlayClassName="bg-black/50 backdrop-blur-sm"
    >
      <div className="space-y-4">
        <p className="text-[10px] text-[var(--text-muted)]">
          Paste string from MongoDB, MySQL or PostgreSQL
        </p>

        <div className="flex flex-wrap gap-2">
          {[
            { label: 'MongoDB', color: '#10b981', uri: 'mongodb://root:password@127.0.0.1:27017/admin?authSource=admin' },
            { label: 'MySQL', color: '#00758f', uri: 'mysql://root:password@127.0.0.1:3306/my_database' },
            { label: 'Postgres', color: '#336791', uri: 'postgresql://postgres:password@127.0.0.1:5432/postgres' },
          ].map(preset => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setUriInput(preset.uri)}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10 transition-all text-[10px] font-bold flex items-center gap-2 group"
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: preset.color }} />
              <span className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">{preset.label}</span>
            </button>
          ))}
        </div>

        <textarea
          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 text-[11px] font-mono min-h-[120px] focus:outline-none focus:border-indigo-500/50 transition-colors custom-scrollbar"
          placeholder="mongodb://user:pass@host:port/dbname"
          value={uriInput}
          onChange={(e) => setUriInput(e.target.value)}
        />
        
        <div className="flex gap-3">
          <button
            onClick={handleParseURI}
            disabled={!uriInput}
            className="flex-1 btn-primary justify-center py-2.5 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import Details
          </button>
          <button
            onClick={() => setIsUriModalOpen(false)}
            className="px-6 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/70 rounded-xl text-xs font-bold transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </MacOSModalWindow>,
    document.body
  );

  return (
    <>
      {modalJsx}
      {uriImportModal}
    </>
  );
}
