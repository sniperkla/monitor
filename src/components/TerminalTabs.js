'use client';

import { useApp } from '@/context/AppContext';
import TerminalView from '@/components/TerminalView';
import { X, Terminal, Plus } from 'lucide-react';
import { useState } from 'react';

export default function TerminalTabs() {
  const { state, dispatch } = useApp();
  const { activeTerminals } = state;
  const activeTab = state.activeTerminalId;

  const setActiveTab = (id) => {
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: id });
  };

  const handleCloseTab = (termId) => {
    dispatch({ type: 'CLOSE_TERMINAL', payload: termId });
    if (activeTab === termId) {
      const remaining = activeTerminals.filter(t => t.id !== termId);
      setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  if (activeTerminals.length === 0) {
    return (
      <div className="h-full flex items-center justify-center" style={{ position: 'relative', zIndex: 1 }}>
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2))' }}>
            <Terminal size={36} style={{ color: 'var(--accent-emerald)' }} />
          </div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No active terminals
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Double-click a connection in the sidebar or use the connect button to open a terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ position: 'relative', zIndex: 1 }}>
      {/* Tab bar */}
      <div 
        className="tab-bar"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const connData = e.dataTransfer.getData('application/ssh-connection');
          if (connData) {
            try {
              const conn = JSON.parse(connData);
              const termId = `term-${conn._id}-${Date.now()}`;
              dispatch({
                type: 'OPEN_TERMINAL',
                payload: {
                  id: termId,
                  connectionId: conn._id,
                  connectionName: conn.name,
                  host: conn.host,
                  color: conn.color,
                  connection: conn
                }
              });
              setActiveTab(termId);
            } catch (err) {
              console.error('Drop parse error:', err);
            }
          }
        }}
      >
        {activeTerminals.map((term, index) => (
          <div
            key={term.id}
            draggable
            className={`tab-item ${activeTab === term.id ? 'active' : ''}`}
            onClick={() => setActiveTab(term.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('term-index', index.toString());
              // Also allow dragging to desktop to open standalone terminal
              if (term.connection) {
                e.dataTransfer.setData('application/ssh-connection', JSON.stringify(term.connection));
              }
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation(); // Prevent bubble to tab-bar
              const fromIndex = e.dataTransfer.getData('term-index');
              if (fromIndex !== "" && parseInt(fromIndex) !== index) {
                dispatch({ 
                  type: 'REORDER_TERMINALS', 
                  payload: { fromIndex: parseInt(fromIndex), toIndex: index } 
                });
              } else {
                // Handle connection drop on tab (same as tab-bar)
                const connData = e.dataTransfer.getData('application/ssh-connection');
                if (connData) {
                  const conn = qJSON.parse(connData);
                  const termId = `term-${conn._id}-${Date.now()}`;
                  dispatch({ type: 'OPEN_TERMINAL', payload: { id: termId, connectionId: conn._id, connectionName: conn.name, host: conn.host, color: conn.color, connection: conn } });
                  setActiveTab(termId);
                }
              }
            }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: term.color || '#6366f1' }} />
            <span>{term.connectionName}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{term.host}</span>
            <button
              className="ml-1 p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
              onClick={(e) => { e.stopPropagation(); handleCloseTab(term.id); }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0">
        {activeTerminals.map(term => (
          <div
            key={term.id}
            className="h-full"
            style={{ display: activeTab === term.id ? 'block' : 'none' }}
          >
            <TerminalView
              connectionId={term.connectionId}
              connectionName={term.connectionName}
              host={term.host}
              color={term.color}
              connection={term.connection}
              onClose={() => handleCloseTab(term.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
