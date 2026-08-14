import { Terminal, Settings, Monitor, Database, Folder, AlertCircle, StickyNote, Book, MonitorPlay, Server, FileText, GitBranch, CloudSync, Rocket, HardDrive, CloudCog, ShieldCheck, Activity } from 'lucide-react';

import TerminalApp from '@/apps/TerminalApp';
import SettingsApp from '@/apps/SettingsApp';
import AutoDeployApp from '@/apps/AutoDeployApp';
import SSHApp from '@/apps/SSHApp';
import FilesApp from '@/apps/FilesApp';
import NotepadApp from '@/apps/NotepadApp';
import WikiApp from '@/apps/WikiApp';
import TmuxApp from '@/apps/TmuxApp';
import DockerApp from '@/apps/DockerApp';
import DockerLogApp from '@/apps/DockerLogApp';
import DatabaseBrowser from '@/components/DatabaseBrowser';
import MongoBackupApp from '@/apps/MongoBackupApp';
import ServerBackupApp from '@/apps/ServerBackupApp';
import RcloneApp from '@/apps/RcloneApp';
import ServerMonitorApp from '@/apps/ServerMonitorApp';

// Add other apps here as needed
export const AppRegistry = {
  'server-monitor': {
    component: ServerMonitorApp,
    icon: Activity,
    defaultTitle: 'Server Monitor'
  },
  'rclone': {
    component: RcloneApp,
    icon: CloudCog,
    defaultTitle: 'Rclone Cloud Sync'
  },
  'rclone-backup': {
    component: RcloneApp,
    icon: CloudCog,
    defaultTitle: 'Rclone Cloud Sync'
  },
  'server-backup': {
    component: ServerBackupApp,
    icon: ShieldCheck,
    defaultTitle: 'Server Backup'
  },
  'mongo-backup': {
    component: MongoBackupApp,
    icon: Database,
    defaultTitle: 'Mongo Sync & Backup'
  },
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
  'auto-deploy': {
    component: AutoDeployApp,
    icon: Rocket,
    defaultTitle: 'Auto Deploy'
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
  'docker-logs': {
    component: DockerLogApp,
    icon: FileText,
    defaultTitle: 'Docker Logs'
  },
  // Add other known apps here if they are openable via window ID
};

export const getAppInfo = (appType) => {
  return AppRegistry[appType] || null;
};
