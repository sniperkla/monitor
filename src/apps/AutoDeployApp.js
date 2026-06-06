'use client';

import SettingsApp from '@/apps/SettingsApp';

export default function AutoDeployApp() {
  return <SettingsApp initialTab="deployment" deploymentOnly />;
}
