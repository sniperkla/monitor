'use client';

import { useState } from 'react';
import { AlertTriangle, X, RefreshCw, CloudUpload, WifiOff, ArrowRight } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export default function MongoDeadBanner() {
  const { dispatch, fetchConnections, mongoDown, relayDown, autoSwitchedToServer } = useApp();
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(null); // { mongoUp, relayUp }

  if ((!mongoDown && !relayDown) || dismissed) return null;

  // If user is already on server mode, relay being down is irrelevant — don't nag
  const currentMode = typeof window !== 'undefined'
    ? localStorage.getItem('ssh_monitor_preferred_relay') || localStorage.getItem('ssh_monitor_ssh_mode')
    : null;
  const isServerMode = currentMode === 'server' || autoSwitchedToServer;
  if (isServerMode && !mongoDown) return null;

  const isRelayOnly = relayDown && !mongoDown;
  const accentColor = isRelayOnly ? '#fbbf24' : '#f87171';
  const borderColor = isRelayOnly ? 'rgba(234,179,8,0.25)' : 'rgba(239,68,68,0.25)';
  const bgColor = isRelayOnly
    ? 'rgba(234,179,8,0.07)'
    : 'rgba(239,68,68,0.09)';

  const title = mongoDown ? 'MongoDB unreachable' : 'Relay not connected';
  const detail = mongoDown && relayDown
    ? 'MongoDB and relay agent are both down.'
    : mongoDown
    ? 'Check that mongod is running on localhost.'
    : 'Local relay agent is offline.';

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      // Only dismiss when EVERYTHING that was reported down is now back up.
      // A failed retry must keep the banner visible.
      const mongoOk = !mongoDown || !!data.mongo?.up;
      const relayOk = !relayDown || !!data.relay?.up;
      if (mongoOk && relayOk) {
        dispatch({ type: 'SET_HEALTH_STATUS', payload: { mongoDown: false, relayDown: false, autoSwitchedToServer: false } });
        fetchConnections();
        setDismissed(true);
      } else {
        setRetryFailed({ mongoUp: !!data.mongo?.up, relayUp: !!data.relay?.up });
      }
    } catch (_) {
      // Health check itself unreachable — definitely still down
      setRetryFailed({ mongoUp: false, relayUp: false });
    }
    finally { setRetrying(false); }
  };

  const handleSwitchToServer = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ssh_monitor_ssh_mode', 'server');
      dispatch({ type: 'SET_HEALTH_STATUS', payload: { autoSwitchedToServer: true } });
      window.dispatchEvent(new Event('ssh-mode-changed'));
    }
  };

  return (
    <div
      className="mx-2 my-2 rounded-lg border p-2.5 text-xs"
      style={{ background: bgColor, borderColor }}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {isRelayOnly
            ? <WifiOff size={13} style={{ color: accentColor, flexShrink: 0 }} />
            : <AlertTriangle size={13} style={{ color: accentColor, flexShrink: 0 }} />
          }
          <span className="font-bold truncate" style={{ color: accentColor }}>{title}</span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>

      {/* Retry result — shown only when the retry FAILED; banner stays visible */}
      {retryFailed && (
        <p className="leading-snug mb-1.5 font-medium" style={{ color: accentColor }}>
          Still down after retry — MongoDB: {retryFailed.mongoUp ? 'up' : 'down'} · Relay agent: {retryFailed.relayUp ? 'connected' : 'offline'}
        </p>
      )}

      {/* Detail */}
      <p className="leading-snug mb-2" style={{ color: 'var(--text-muted)' }}>
        {detail}
        {autoSwitchedToServer && (
          <span className="ml-1 text-sky-400 font-medium">Auto-switched to server mode.</span>
        )}
      </p>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md font-bold transition-all disabled:opacity-50"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--text-primary)',
          }}
        >
          <RefreshCw size={10} className={retrying ? 'animate-spin' : ''} />
          Retry
        </button>
        {!autoSwitchedToServer && (
          <button
            onClick={handleSwitchToServer}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md font-bold transition-all"
            style={{
              background: 'rgba(14,165,233,0.15)',
              border: '1px solid rgba(14,165,233,0.3)',
              color: '#38bdf8',
            }}
            title="Switch to cloud server mode"
          >
            <CloudUpload size={10} />
            Server Mode
          </button>
        )}
      </div>
    </div>
  );
}
