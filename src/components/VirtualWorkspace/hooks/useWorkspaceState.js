'use client';

import { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';

export default function useWorkspaceState() {
  const { state: appState } = useApp();
  const { state: osState } = useOS();

  const workspaceState = useMemo(() => {
    const connections = appState.connections || [];
    const activeTerminals = appState.activeTerminals || [];
    const standaloneTerminals = appState.standaloneTerminals || [];
    const activeDatabaseBrowsers = appState.activeDatabaseBrowsers || [];
    const standaloneDatabaseBrowsers = appState.standaloneDatabaseBrowsers || [];
    const windows = osState.windows || [];

    const allTerminals = [...activeTerminals, ...standaloneTerminals];
    const allDatabases = [...activeDatabaseBrowsers, ...standaloneDatabaseBrowsers];

    const sshConnections = allTerminals.map((term) => {
      const conn = connections.find((c) => c._id === term.connectionId);
      return {
        id: term.id,
        connectionId: term.connectionId,
        connectionName: term.connectionName || conn?.name || 'Unknown',
        host: term.host || conn?.host || 'unknown',
        username: conn?.username || '',
        isActive: true,
      };
    });

    const dbConnections = allDatabases.map((db) => {
      const conn = connections.find((c) => c._id === db.connectionId);
      return {
        id: db.id,
        connectionId: db.connectionId,
        connectionName: db.connectionName || conn?.name || 'Unknown',
        host: conn?.host || 'unknown',
        database: conn?.database || '',
        isActive: true,
      };
    });

    const servers = connections.map((conn) => ({
      id: conn._id,
      name: conn.name,
      host: conn.host,
      hasSSH: allTerminals.some((t) => t.connectionId === conn._id),
      hasDB: allDatabases.some((d) => d.connectionId === conn._id),
      hasFileManager: (appState.activeFileManagers || []).some(
        (f) => f.connectionId === conn._id
      ),
    }));

    const deployWindow = windows.find(
      (w) => w.appType === 'deploy' || w.id?.startsWith('deploy-')
    );

    return {
      sshCount: allTerminals.length,
      dbCount: allDatabases.length,
      sshConnections,
      dbConnections,
      servers,
      deployActive: !!deployWindow,
      deployStatus: deployWindow?.props?.deployStatus || null,
      anyActive:
        allTerminals.length > 0 ||
        allDatabases.length > 0 ||
        !!deployWindow,
    };
  }, [
    appState.connections,
    appState.activeTerminals,
    appState.standaloneTerminals,
    appState.activeDatabaseBrowsers,
    appState.standaloneDatabaseBrowsers,
    appState.activeFileManagers,
    osState.windows,
  ]);

  return workspaceState;
}
