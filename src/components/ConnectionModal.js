'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/context/AppContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSession, signIn } from 'next-auth/react';
import {
  X, Server, User, Lock, Key, Upload, FileKey, Hash, Tag, Palette, StickyNote, Database, HardDrive, Cpu, Eye, EyeOff
} from 'lucide-react';

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
];

export default function ConnectionModal({ onClose, editConnection = null }) {
  const { state, dispatch, fetchConnections, apiFetch } = useApp();
  const { t } = useTranslation();
  const { data: session } = useSession();
  const fileInputRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [form, setForm] = useState({
    name: editConnection?.name || '',
    host: editConnection?.host || '',
    port: editConnection?.port || 22,
    username: editConnection?.username || '',
    authType: editConnection?.authType || 'password',
    password: '',
    privateKey: '',
    keyFileName: editConnection?.keyFileName || '',
    passphrase: '',
    tags: editConnection?.tags?.join(', ') || '',
    color: editConnection?.color || '#6366f1',
    notes: editConnection?.notes || '',
    targetStorage: editConnection?.storage || state.storageMode || 'db',
  });

  // Auto-fallback: if not logged in and default was 'db', switch to 'localstorage'
  useEffect(() => {
    if (!session && form.targetStorage === 'db' && !editConnection) {
      setForm(prev => ({ ...prev, targetStorage: 'localstorage' }));
    }
  }, [session]);

  const handleChange = (field, value) => {
    setForm(prev => {
      const newForm = { ...prev, [field]: value };
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
      host: form.host,
      port: parseInt(form.port) || 22,
      username: form.username,
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
        toast.success(editConnection ? t('ssh.modal.buttons.update') : t('ssh.modal.buttons.save'));
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

        toast.success(editConnection ? t('ssh.modal.toasts.manualUpdate') : t('ssh.modal.toasts.manualSuccess'));
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
        
        toast.success(editConnection ? t('ssh.modal.toasts.dbUpdate') : t('ssh.modal.toasts.dbSuccess'));
        await fetchConnections();
        onClose();
      } else {
        toast.error(resData.error || t('ssh.modal.toasts.saveFail'));
      }
    } catch (err) {
      toast.error(t('ssh.modal.toasts.errorPrefix') + err.message);
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

  return createPortal(
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {editConnection ? t('ssh.modal.titleEdit') : t('ssh.modal.titleNew')}
          </h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

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
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                        : isDisabled
                        ? 'bg-black/10 border-white/5 text-gray-600 cursor-not-allowed opacity-50'
                        : 'bg-black/20 border-white/5 text-gray-500 hover:border-white/10'
                    }`}
                  >
                    <div className={`mb-1.5 ${form.targetStorage === opt.id ? 'text-indigo-400' : ''}`}>
                      {opt.icon}
                    </div>
                    <span className="text-[10px] font-bold">{opt.label}</span>
                    {isDisabled && (
                      <span className="text-[8px] text-amber-400 mt-0.5">{t('vault.loginRequired')}</span>
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
                  className="ml-auto px-2 py-1 bg-white text-black text-[10px] font-bold rounded hover:bg-gray-200 transition-all flex items-center gap-1.5"
                >
                  <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-2.5 h-2.5" alt="" />
                  {t('vault.loginBtn')}
                </button>
              </div>
            )}
            {form.targetStorage === 'db' && session && (
              <div className="flex items-start gap-2 p-2 mt-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-300">
                <Lock size={10} className="mt-0.5 shrink-0" />
                <span className="opacity-80">{t('vault.masterKeyInfo')}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
             <div className="space-y-5">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    <StickyNote size={14} /> {t('ssh.modal.form.name')}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('ssh.modal.placeholders.name')}
                    value={form.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    required
                  />
                </div>

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
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <Hash size={14} /> {t('ssh.modal.form.port')}
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      value={form.port}
                      onChange={(e) => handleChange('port', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    <User size={14} /> {t('ssh.modal.form.username')}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('ssh.modal.placeholders.username')}
                    value={form.username}
                    onChange={(e) => handleChange('username', e.target.value)}
                    required
                  />
                </div>
             </div>

             <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>
                    {t('ssh.modal.auth.title')}
                  </label>
                  <div className="flex bg-white/5 p-1 rounded-lg">
                    <button
                      type="button"
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        form.authType === 'password'
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                      onClick={() => handleChange('authType', 'password')}
                    >
                      {t('ssh.modal.auth.password')}
                    </button>
                    <button
                      type="button"
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        form.authType === 'privateKey'
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                      onClick={() => handleChange('authType', 'privateKey')}
                    >
                      {t('ssh.modal.auth.key')}
                    </button>
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
                        required={!editConnection}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
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
                          <span className="text-xs text-indigo-400 font-medium truncate max-w-full px-2">
                             {form.keyFileName}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-500 lowercase">{t('ssh.modal.placeholders.dropKey')}</span>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-white/5">
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

          <div className="flex gap-3 mt-6 pt-6 border-t border-white/5">
            <button
              type="submit"
              className="btn-primary flex-1 justify-center py-3 font-bold"
              disabled={isSubmitting || (form.targetStorage === 'db' && !session)}
            >
              {isSubmitting ? t('ssh.modal.buttons.saving') : (editConnection ? t('ssh.modal.buttons.update') : t('ssh.modal.buttons.save'))}
            </button>
            <button type="button" className="px-6 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-sm font-medium" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
