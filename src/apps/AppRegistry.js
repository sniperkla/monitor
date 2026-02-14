import { Terminal, Settings, Monitor, Database, Folder, AlertCircle } from 'lucide-react';

import TerminalApp from '@/apps/TerminalApp';
import SettingsApp from '@/apps/SettingsApp';
import SSHApp from '@/apps/SSHApp';
import FilesApp from '@/apps/FilesApp';

// Add other apps here as needed
export const AppRegistry = {
  'terminal': {
    component: TerminalApp,
    icon: Terminal,
    defaultTitle: 'Terminal'
  },
  'settings': {
    component: SettingsApp,
    icon: Settings,
    defaultTitle: 'Settings'
  },
  'ssh-manager': {
    component: SSHApp,
    icon: Monitor,
    defaultTitle: 'SSH Manager'
  },
  'files-app': {
    component: FilesApp,
    icon: Folder,
    defaultTitle: 'Files'
  },
  'files': {
    component: FilesApp,
    icon: Folder,
    defaultTitle: 'Files'
  },
  // Add other known apps here if they are openable via window ID
};

export const getAppInfo = (appType) => {
  return AppRegistry[appType] || null;
};
