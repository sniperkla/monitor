// ── Per-app "size endpoint" contract ─────────────────────────────────────────
// Single source of truth for how big each app wants to be (width/height) and
// how small it may ever get (minWidth/minHeight) before its layout breaks.
//
// This module intentionally imports NOTHING so it can be used safely from
// OSContext (reducer), Window.js and AppRegistry without circular imports.
//
// Values are tuned to each app's real content:
//   - width/height  → the size the app opens at when nothing else is specified
//   - minWidth/minHeight → the smallest size at which the UI stays usable;
//     react-rnd will refuse to resize below this and the window manager will
//     re-enforce it on restore-from-minimize and hydration.

export const APP_ENDPOINTS = {
  'ssh-manager':       { width: 1400, height: 820, minWidth: 860, minHeight: 520 },
  'terminal':          { width: 1100, height: 700, minWidth: 640, minHeight: 380 },
  'files':             { width: 900,  height: 600, minWidth: 620, minHeight: 400 },
  'files-app':         { width: 900,  height: 600, minWidth: 620, minHeight: 400 },
  'docker':            { width: 1000, height: 700, minWidth: 720, minHeight: 460 },
  'docker-app':        { width: 1000, height: 700, minWidth: 720, minHeight: 460 },
  'docker-logs':       { width: 900,  height: 600, minWidth: 520, minHeight: 340 },
  'auto-deploy':       { width: 1100, height: 760, minWidth: 720, minHeight: 480 },
  'settings':          { width: 900,  height: 700, minWidth: 680, minHeight: 460 },
  'wiki':              { width: 1100, height: 750, minWidth: 640, minHeight: 420 },
  'database':          { width: 1000, height: 680, minWidth: 640, minHeight: 420 },
  'database-browser':  { width: 1000, height: 680, minWidth: 640, minHeight: 420 },
  'mongo-backup':      { width: 960,  height: 660, minWidth: 640, minHeight: 420 },
  'server-backup':     { width: 960,  height: 660, minWidth: 640, minHeight: 420 },
  'rclone':            { width: 980,  height: 660, minWidth: 640, minHeight: 420 },
  'rclone-backup':     { width: 980,  height: 660, minWidth: 640, minHeight: 420 },
  'server-monitor':    { width: 960,  height: 640, minWidth: 620, minHeight: 420 },
  'firewall-blocklist':{ width: 860,  height: 600, minWidth: 560, minHeight: 380 },
  'virus-scanner':     { width: 860,  height: 620, minWidth: 560, minHeight: 400 },
  'activity':          { width: 820,  height: 600, minWidth: 520, minHeight: 380 },
  'notepad':           { width: 760,  height: 560, minWidth: 340, minHeight: 280 },
  'tmux':              { width: 1000, height: 640, minWidth: 640, minHeight: 380 },
};

// Fallback for apps/ids not listed above — matches the historical defaults.
export const DEFAULT_ENDPOINT = { width: 800, height: 600, minWidth: 320, minHeight: 220 };

/**
 * Resolve the size endpoint for an app.
 * @param {string} [appType] appType or window id (aliases included above)
 * @returns {{width:number, height:number, minWidth:number, minHeight:number}}
 */
export function getAppEndpoint(appType) {
  if (!appType) return DEFAULT_ENDPOINT;
  return APP_ENDPOINTS[appType]
    || APP_ENDPOINTS[String(appType).replace(/-app$/, '')] // tolerate "docker-app" style ids
    || DEFAULT_ENDPOINT;
}
