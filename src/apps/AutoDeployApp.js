'use client';

import SettingsApp from '@/apps/SettingsApp';

export default function AutoDeployApp({ windowId, activeTab, ...props }) {
  return <SettingsApp windowId={windowId} initialTab={activeTab || "deployment"} activeTab={activeTab} deploymentOnly {...props} />;
}
