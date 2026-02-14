'use client';

import { useApp } from '@/context/AppContext';
import { Database, Laptop, ShieldAlert, Save, RefreshCw, HardDrive, Cpu, Settings as SettingsIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export default function Settings() {
  const { state, dispatch, fetchConnections } = useApp();
  const [loading, setLoading] = useState(false);

  const storageModes = [
    { 
      id: 'db', 
      name: 'Server Database', 
      icon: <Database size={18} />, 
      desc: 'Store connections securely in the MongoDB database configured on your server.',
      color: 'text-indigo-400'
    },
    { 
      id: 'localstorage', 
      name: 'Local Storage', 
      icon: <HardDrive size={18} />, 
      desc: 'Store connections in your browser\'s local storage. Not synced across devices.',
      color: 'text-emerald-400'
    },
    { 
      id: 'manual', 
      name: 'Manual / Session Only', 
      icon: <Cpu size={18} />, 
      desc: 'Connections are only kept in memory during the current session. Forgotten on refresh.',
      color: 'text-amber-400'
    }
  ];

  const handleModeChange = (modeId) => {
    dispatch({ type: 'SET_STORAGE_MODE', payload: modeId });
    toast.success(`Storage mode changed to ${modeId.replace('_', ' ')}`);
    // Re-fetch or clear list based on mode
    if (modeId === 'db') {
        fetchConnections();
    } else if (modeId === 'localstorage') {
        const saved = localStorage.getItem('ssh_monitor_connections');
        dispatch({ type: 'SET_CONNECTIONS', payload: saved ? JSON.parse(saved) : [] });
    } else {
        dispatch({ type: 'SET_CONNECTIONS', payload: [] });
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400">
          <SettingsIcon size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-400 text-sm">Configure how your data is stored and managed</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Storage Mode Section */}
        <section className="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Database size={20} className="text-indigo-400" />
              Storage Management
            </h2>
            <p className="text-sm text-gray-400 mt-1">Choose where your terminal connections and credentials are saved.</p>
          </div>
          
          <div className="p-6 grid gap-4">
            {storageModes.map((mode) => (
              <div 
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                  state.storageMode === mode.id 
                    ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/20' 
                    : 'bg-black/20 border-white/5 hover:border-white/10'
                }`}
              >
                <div className={`mt-1 p-2 rounded-lg bg-black/20 ${mode.color}`}>
                  {mode.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{mode.name}</h3>
                    {state.storageMode === mode.id && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500 text-white">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                    {mode.desc}
                  </p>
                  {mode.id === 'localstorage' && (
                     <div className="mt-3 flex items-center gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
                       <ShieldAlert size={14} className="flex-shrink-0" />
                       <span>Warning: Browser storage is accessible by scripts. Use only for local dev.</span>
                     </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Database Info (Conditional) */}
        {state.storageMode === 'db' && (
          <section className="bg-white/5 rounded-2xl border border-white/5 p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                <Database size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Database Connected</h3>
                <p className="text-xs text-gray-500 mt-0.5">Using AES-256-CBC Encryption for sensitive data</p>
              </div>
            </div>
            <button 
              onClick={() => fetchConnections()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={14} /> Refresh List
            </button>
          </section>
        )}

      </div>
    </div>
  );
}
