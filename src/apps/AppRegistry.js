import { Terminal, Settings, Monitor, Database, Folder, AlertCircle, StickyNote, Book, MonitorPlay, Server } from 'lucide-react';

import TerminalApp from '@/apps/TerminalApp';
import SettingsApp from '@/apps/SettingsApp';
import SSHApp from '@/apps/SSHApp';
import FilesApp from '@/apps/FilesApp';
import NotepadApp from '@/apps/NotepadApp';
import WikiApp from '@/apps/WikiApp';
import TmuxApp from '@/apps/TmuxApp';
import DockerApp from '@/apps/DockerApp';
import DatabaseBrowser from '@/components/DatabaseBrowser';
 
// Add other apps here as needed
export const AppRegistry = {
  'database-browser': {
    component: DatabaseBrowser,
    icon: Database,
    defaultTitle: 'Database Browser'
  },
  'database': {
    component: DatabaseBrowser,
    icon: Database,
    defaultTitle: 'Database Browser'
  },
  'docker-app': {
    component: DockerApp,
    icon: Server,
    defaultTitle: 'Docker'
  },
  'docker': {
    component: DockerApp,
    icon: Server,
    defaultTitle: 'Docker'
  },
  'wiki': {
    component: WikiApp,
    icon: Book,
    defaultTitle: 'Global Wiki'
  },
  'notepad': {
    component: NotepadApp,
    icon: StickyNote,
    defaultTitle: 'Notepad'
  },
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
  'tmux': {
    component: TmuxApp,
    icon: MonitorPlay,
    defaultTitle: 'Tmux Manager'
  },
  // Add other known apps here if they are openable via window ID
};

export const getAppInfo = (appType) => {
  return AppRegistry[appType] || null;
};
