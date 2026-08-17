'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Zap, Server, Play, Square, RefreshCw, Copy, Check, 
  Terminal, Shield, Trash2, CheckCircle2, AlertTriangle, 
  Cpu, X, ExternalLink, HelpCircle, Download, CheckCircle
} from 'lucide-react';

export default function AgentSetupWizard({ 
  isOpen, 
  onClose, 
  connection, 
  relayToken,
  onRefreshStatus,
  apiFetch 
}) {
  const [activeTab, setActiveTab] = useState('tmux'); // 'tmux' | 'service' | 'manual' | 'uninstall'
  const [status, setStatus] = useState({ loading: true, isRunning: false, nodeInstalled: false, inTmux: false, inService: false });
  const [executing, setExecuting] = useState(false);
  const [outputLog, setOutputLog] = useState('');
  const [copied, setCopied] = useState('');
  const [installSuccess, setInstallSuccess] = useState(false);

  const [agentToken, setAgentToken] = useState(relayToken || '');

  const serverUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const effectiveToken = agentToken || relayToken || 'GENERATING_TOKEN...';

  const fetchToken = useCallback(async () => {
    try {
      const res = await apiFetch('/api/relay/token', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.token) setAgentToken(data.token);
      }
    } catch (err) {
      console.error('Failed to generate agent token:', err);
    }
  }, [apiFetch]);

  const checkAgentStatus = useCallback(async () => {
    if (!connection?._id) return;
    setStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection._id, action: 'status' })
      });
      if (res.ok) {
        const data = await res.json();
        setStatus({
          loading: false,
          isRunning: data.isRunning,
          nodeInstalled: data.nodeInstalled,
          nodeVersion: data.nodeVersion,
          inTmux: data.inTmux,
          inService: data.inService
        });
      } else {
        setStatus(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error('Failed to check agent status:', err);
      setStatus(prev => ({ ...prev, loading: false }));
    }
  }, [connection?._id, apiFetch]);

  useEffect(() => {
    if (isOpen) {
      fetchToken();
      if (connection?._id) {
        checkAgentStatus();
        setOutputLog('');
        setInstallSuccess(false);
      }
    }
  }, [isOpen, connection?._id, fetchToken, checkAgentStatus]);

  const handleInstallNode = async () => {
    if (!connection?._id) return;
    setExecuting(true);
    setOutputLog(`⏳ Installing Node.js 20 LTS on ${connection.name || connection.host}...\nThis may take 15-30 seconds depending on your server speed...\n`);

    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connection._id,
          action: 'install_node',
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setOutputLog(prev => prev + `\n` + (data.output || '🎉 Node.js successfully installed!'));
        await checkAgentStatus();
      } else {
        setOutputLog(prev => prev + `\n❌ Node.js Installation Failed:\n` + (data.error || data.output || 'Unknown error'));
      }
    } catch (err) {
      setOutputLog(prev => prev + `\n❌ Network Error: ` + err.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleInstall = async (method) => {
    if (!connection?._id) return;
    setExecuting(true);
    setInstallSuccess(false);
    setOutputLog(`⏳ Installing Relay Agent on ${connection.name || connection.host} via ${method.toUpperCase()}...\n`);

    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connection._id,
          action: 'install',
          method,
          serverUrl,
          token: agentToken || undefined
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.token) setAgentToken(data.token);
        setOutputLog(prev => prev + `\n` + (data.output || '✅ Agent successfully launched!') + `\n\n🎉 Done! Real-time WebRTC telemetry is now active.`);
        await checkAgentStatus();
        if (onRefreshStatus) onRefreshStatus();
        setInstallSuccess(true);
      } else {
        setOutputLog(prev => prev + `\n❌ Installation Error:\n` + (data.error || data.output || 'Unknown error'));
      }
    } catch (err) {
      setOutputLog(prev => prev + `\n❌ Network Error: ` + err.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleUninstall = async () => {
    if (!connection?._id) return;
    setExecuting(true);
    setInstallSuccess(false);
    setOutputLog(`⏳ Stopping and removing Relay Agent from ${connection.name || connection.host}...\n`);

    try {
      const res = await apiFetch('/api/server-monitor/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connection._id,
          action: 'uninstall',
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setOutputLog(prev => prev + `\n` + (data.output || '✅ Agent removed cleanly.'));
        await checkAgentStatus();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setOutputLog(prev => prev + `\n❌ Uninstall failed:\n` + (data.error || data.output || 'Unknown error'));
      }
    } catch (err) {
      setOutputLog(prev => prev + `\n❌ Error: ` + err.message);
    } finally {
      setExecuting(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  if (!isOpen) return null;

  const connIdFlag = connection?._id ? ` --connection-id '${connection._id}'` : '';
  const tmuxCommand = `curl -sSL -H 'Cache-Control: no-cache' '${serverUrl}/monitor-agent.min.js' -o /tmp/.agent.js && NODE_BIN=\$(command -v node || which node || echo node) && tmux new-session -d -s monitor-agent "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:\$PATH; \$NODE_BIN /tmp/.agent.js --server '${serverUrl}' --token '${effectiveToken}'${connection?._id ? ` --connection-id '${connection._id}'` : ''} >> ~/.monitor-agent.log 2>&1" && rm -f /tmp/.agent.js`;
  const serviceCommand = `curl -sSL -H 'Cache-Control: no-cache' '${serverUrl}/monitor-agent.min.js' -o /tmp/.agent.js && node /tmp/.agent.js --install --server '${serverUrl}' --token '${effectiveToken}'${connIdFlag} && rm -f /tmp/.agent.js`;
  const foregroundCommand = `curl -sSL -H 'Cache-Control: no-cache' '${serverUrl}/monitor-agent.min.js' | node - --server '${serverUrl}' --token '${effectiveToken}'${connIdFlag}`;
  const uninstallCommand = `systemctl --user stop server-monitor-agent.service 2>/dev/null; systemctl --user disable server-monitor-agent.service 2>/dev/null; tmux kill-session -t monitor-agent 2>/dev/null; pkill -9 -f '[.]monitor-agent' 2>/dev/null; pkill -9 -f '[m]onitor-agent.js' 2>/dev/null; rm -rf ~/.config/server-monitor-agent ~/.monitor-agent.js ~/.monitor-agent-launcher.sh /tmp/.agent.js 2>/dev/null; echo "✅ Done"`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Zap size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                Server Relay Agent Setup
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-normal">
                  0ms WebRTC Real-Time
                </span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Target: <span className="text-[var(--text-primary)] font-medium">{connection?.name || connection?.host || 'Unknown Server'}</span> ({connection?.username}@{connection?.host})
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Status Bar */}
        <div className="px-6 py-2.5 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-color)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">Target Status:</span>
              {status.loading ? (
                <span className="flex items-center gap-1 text-[var(--text-muted)]">
                  <RefreshCw size={12} className="animate-spin text-indigo-400" /> Checking...
                </span>
              ) : status.isRunning ? (
                <span className="flex items-center gap-1.5 text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 size={12} /> Running on Server {status.inTmux ? '(tmux)' : status.inService ? '(systemd)' : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-400 font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle size={12} /> Not Running (Agentless Mode)
                </span>
              )}
            </div>

            {!status.loading && (
              <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Cpu size={12} />
                <span>Node: {status.nodeInstalled ? status.nodeVersion : 'Not Found'}</span>
              </div>
            )}
          </div>

          <button
            onClick={checkAgentStatus}
            disabled={status.loading}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded transition-colors disabled:opacity-50"
            title="Refresh Status"
          >
            <RefreshCw size={12} className={status.loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-6 pt-2 gap-2 text-xs">
          {[
            { id: 'tmux', label: '⚡ tmux (Fastest)', icon: Play },
            { id: 'service', label: '⚙️ System Service', icon: Shield },
            { id: 'manual', label: '📋 Manual Command', icon: Terminal },
            { id: 'uninstall', label: '🗑️ Uninstall', icon: Trash2 },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setInstallSuccess(false); }}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-all ${
                activeTab === t.id
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5 rounded-t-md'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">

          {/* ── Install Success / Ready State ── */}
          {installSuccess ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-5">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                <div className="relative w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle size={38} className="text-emerald-400" />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-[var(--text-primary)]">Agent Running! 🎉</p>
                <p className="text-sm text-emerald-400">
                  {status.inTmux
                    ? 'Running in tmux background session'
                    : status.inService
                    ? 'Running as systemd service'
                    : 'Agent is active on server'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Real-time WebRTC telemetry is now active on{' '}
                  <span className="text-amber-300 font-medium">{connection?.name || connection?.host}</span>
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setInstallSuccess(false)}
                  className="px-5 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-xl text-sm font-medium transition-all"
                >
                  View Details
                </button>
                <button
                  onClick={onClose}
                  className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] rounded-xl text-white text-sm font-bold transition-all shadow-lg shadow-emerald-500/20"
                >
                  Done ✓
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Missing Node.js 1-Click Banner */}
              {!status.nodeInstalled && !status.loading && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 flex items-center justify-between gap-3 shadow-sm animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={17} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-xs text-amber-200">Node.js is not installed on this server</p>
                      <p className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
                        The agent requires Node.js (v18+) to run. You can install it automatically in 1-click.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleInstallNode}
                    disabled={executing}
                    className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg text-xs shrink-0 transition-all shadow-md shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {executing ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
                    <span>Install Node.js 20</span>
                  </button>
                </div>
              )}

              {activeTab === 'tmux' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 space-y-1.5">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      <Zap size={16} className="text-indigo-400" />
                      1-Click tmux Installation (Recommended)
                    </p>
                    <p className="text-[11px] leading-relaxed text-indigo-200/80">
                      Installs and launches the Relay Agent in a detached <code className="bg-black/30 px-1 py-0.5 rounded text-indigo-300">tmux</code> background session on the remote server.
                      Requires no root privileges and survives SSH disconnections.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[var(--text-muted)] font-medium">Command that will be executed over SSH:</label>
                    <div className="relative group bg-black/60 border border-[var(--border-color)] rounded-lg p-3 font-mono text-[11px] text-indigo-300 break-all">
                      {tmuxCommand}
                      <button
                        onClick={() => copyToClipboard(tmuxCommand, 'tmux')}
                        className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded border border-white/10 text-white transition-colors"
                        title="Copy command"
                      >
                        {copied === 'tmux' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Session name: <code className="text-indigo-400">monitor-agent</code>
                    </span>
                    <button
                      onClick={() => handleInstall('tmux')}
                      disabled={executing || status.loading}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {executing ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                      <span>Install & Launch in tmux</span>
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'service' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 space-y-1.5">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      <Shield size={16} className="text-purple-400" />
                      systemd User Service (Auto-Start on Boot)
                    </p>
                    <p className="text-[11px] leading-relaxed text-purple-200/80">
                      Installs the agent as a persistent background systemd service (<code className="bg-black/30 px-1 py-0.5 rounded text-purple-300">server-monitor-agent.service</code>).
                      It will automatically start whenever the server reboots.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[var(--text-muted)] font-medium">Command that will be executed over SSH:</label>
                    <div className="relative group bg-black/60 border border-[var(--border-color)] rounded-lg p-3 font-mono text-[11px] text-purple-300 break-all">
                      {serviceCommand}
                      <button
                        onClick={() => copyToClipboard(serviceCommand, 'service')}
                        className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded border border-white/10 text-white transition-colors"
                        title="Copy command"
                      >
                        {copied === 'service' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Service name: <code className="text-purple-400">ssh-monitor-relay</code>
                    </span>
                    <button
                      onClick={() => handleInstall('service')}
                      disabled={executing || status.loading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg shadow-lg shadow-purple-600/30 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {executing ? <RefreshCw size={14} className="animate-spin" /> : <Shield size={14} />}
                      <span>Install as System Service</span>
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'manual' && (
                <div className="space-y-4">
                  <p className="text-[var(--text-secondary)]">
                    Prefer to run it yourself? Connect to your server terminal and paste any of these commands:
                  </p>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                        <span>1. In Background tmux Session:</span>
                        <button 
                          onClick={() => copyToClipboard(tmuxCommand, 'man-tmux')}
                          className="text-indigo-400 hover:underline flex items-center gap-1"
                        >
                          {copied === 'man-tmux' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <div className="bg-black/60 border border-[var(--border-color)] rounded-lg p-2.5 font-mono text-[11px] text-indigo-300 break-all">
                        {tmuxCommand}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                        <span>2. Foreground Test (Ctrl+C to stop):</span>
                        <button 
                          onClick={() => copyToClipboard(foregroundCommand, 'man-fg')}
                          className="text-indigo-400 hover:underline flex items-center gap-1"
                        >
                          {copied === 'man-fg' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <div className="bg-black/60 border border-[var(--border-color)] rounded-lg p-2.5 font-mono text-[11px] text-emerald-300 break-all">
                        {foregroundCommand}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'uninstall' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-1.5">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      <Trash2 size={16} className="text-red-400" />
                      Uninstall & Clean Up Agent
                    </p>
                    <p className="text-[11px] leading-relaxed text-red-200/80">
                      Terminates the <code className="bg-black/30 px-1 py-0.5 rounded text-red-300">monitor-relay</code> tmux session, stops the systemd user service, and removes all agent background tasks on this server.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[var(--text-muted)] font-medium">Uninstall command:</label>
                    <div className="relative group bg-black/60 border border-[var(--border-color)] rounded-lg p-3 font-mono text-[11px] text-red-300 break-all">
                      {uninstallCommand}
                      <button
                        onClick={() => copyToClipboard(uninstallCommand, 'uninst')}
                        className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded border border-white/10 text-white transition-colors"
                        title="Copy command"
                      >
                        {copied === 'uninst' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleUninstall}
                      disabled={executing || status.loading}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg shadow-lg shadow-red-600/30 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {executing ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      <span>Uninstall Agent from Server</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Terminal Execution Log Window */}
              {outputLog && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span className="font-medium flex items-center gap-1.5">
                      <Terminal size={12} className="text-indigo-400" /> Output Log
                    </span>
                    <button
                      onClick={() => setOutputLog('')}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="bg-black/80 border border-white/10 rounded-lg p-3 font-mono text-[11px] text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                    {outputLog}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between text-xs">
          <span className="text-[var(--text-muted)] flex items-center gap-1">
            <HelpCircle size={13} /> Pure SSH polling continues to work even without the agent.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
