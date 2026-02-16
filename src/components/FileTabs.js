'use client';

import { useApp } from '@/context/AppContext';
import FileManager from '@/components/FileManager';
import { X, Folder, Plus } from 'lucide-react';
import { useState } from 'react';

export default function FileTabs() {
  const { state, dispatch } = useApp();
  const { activeFileManagers } = state;
  const activeTab = state.activeFileManagerId;

  const setActiveTab = (id) => {
    dispatch({ type: 'SET_ACTIVE_FILE_MANAGER', payload: id });
  };

  const handleCloseTab = (id) => {
    dispatch({ type: 'CLOSE_FILE_MANAGER', payload: id });
    if (activeTab === id) {
      const remaining = activeFileManagers.filter(t => t.id !== id);
      setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  if (activeFileManagers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))' }}>
            <Folder size={36} style={{ color: 'var(--accent-indigo)' }} />
          </div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No active file managers
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Select a connection in the sidebar to open its file manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
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
              const fmId = `fm-${conn._id}-${Date.now()}`;
              dispatch({
                type: 'OPEN_FILE_MANAGER',
                payload: {
                  id: fmId,
                  connectionId: conn._id,
                  connectionName: conn.name,
                  color: conn.color,
                  connection: conn
                }
              });
              setActiveTab(fmId);
            } catch (err) {
              console.error('Drop parse error:', err);
            }
          }
        }}
      >
        {activeFileManagers.map((fm, index) => (
          <div
            key={fm.id}
            draggable
            className={`tab-item ${activeTab === fm.id ? 'active' : ''}`}
            onClick={() => setActiveTab(fm.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('fm-index', index.toString());
              // Also allow dragging to desktop to open standalone files
              if (fm.connection) {
                e.dataTransfer.setData('application/ssh-connection', JSON.stringify(fm.connection));
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
              const fromIndex = e.dataTransfer.getData('fm-index');
              if (fromIndex !== "" && parseInt(fromIndex) !== index) {
                dispatch({ 
                  type: 'REORDER_FILE_MANAGERS', 
                  payload: { fromIndex: parseInt(fromIndex), toIndex: index } 
                });
              } else {
                // Handle connection drop on tab
                const connData = e.dataTransfer.getData('application/ssh-connection');
                if (connData) {
                  const conn = JSON.parse(connData);
                  const fmId = `fm-${conn._id}-${Date.now()}`;
                  dispatch({ type: 'OPEN_FILE_MANAGER', payload: { id: fmId, connectionId: conn._id, connectionName: conn.name, color: conn.color, connection: conn } });
                  setActiveTab(fmId);
                }
              }
            }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: fm.color || '#6366f1' }} />
            <span>{fm.connectionName}</span>
            <button
              className="ml-1 p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
              onClick={(e) => { e.stopPropagation(); handleCloseTab(fm.id); }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 bg-[var(--bg-primary)]">
        {activeFileManagers.map(fm => (
          <div
            key={fm.id}
            className="h-full"
            style={{ display: activeTab === fm.id ? 'block' : 'none' }}
          >
            <FileManager
              connectionId={fm.connectionId}
              connectionName={fm.connectionName}
              connection={fm.connection}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
