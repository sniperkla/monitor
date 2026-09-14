/**
 * Which server connection a tunneled agent Web UI should be dialed through.
 *
 * Extracted from `AgentWebUIBrowserApp.navigateAddress` so the rule can be
 * tested for real. The component is not importable from `node --test` (it pulls
 * in React and the whole desktop shell), so this used to be a source regex —
 * which cannot catch a wrong value, only a missing string.
 *
 * The bug this exists to prevent: the agent-shortcut branch resolved the target
 * as `connectionId || 'local'`. `local` is not a database id — it is the
 * `sshMode` sentinel — so `getSshConfig()` threw "Connection not found", the
 * proxy route answered **500**, and the browser app surfaced it as a
 * "Web UI Unreachable" card quoting the raw 500 body. Measured, with no server
 * selected, from the desktop Web Browser's Explore page:
 *
 *     500 GET /api/agents/webui-proxy/m2/local/9119
 *
 * The desktop mounts that app with no connection at all
 * (`DesktopEnvironment`: `<AgentWebUIBrowserApp initialMode="explore" />`), so
 * the fallback fired for every agent bookmark, every time.
 *
 * Rule: resolve from real state, and if there is none, return `''` and let the
 * caller say so. Never invent an id.
 */

/**
 * @param {object} sources
 * @param {string} [sources.tabConnectionId]    the tab's own connection
 * @param {string} [sources.propConnectionId]   the `connectionId` prop
 * @param {string} [sources.selectedConnectionId] app-level selection
 * @returns {string} a connection id, or `''` when none is known
 */
export function resolveTunnelConnectionId({
  tabConnectionId,
  propConnectionId,
  selectedConnectionId,
} = {}) {
  // The TAB wins. `connectionId` is a mount-time prop, and the server selector
  // writes the new choice onto the tab — so after the user switches servers the
  // prop still points at the previous one. Preferring the prop here would
  // silently tunnel to the wrong host.
  const id = tabConnectionId || propConnectionId || selectedConnectionId;
  return typeof id === 'string' ? id : '';
}

/**
 * Whether an id could be a real connection id.
 *
 * Mirrors the shape the proxy route itself accepts when it parses a path-keyed
 * asset URL (`/^[A-Za-z0-9_-]{6,64}$/`). Anything shorter — notably the 5-char
 * `local` — cannot be one, so a caller holding such a value has a bug, not a
 * connection.
 */
export function isPlausibleConnectionId(id) {
  return /^[A-Za-z0-9_-]{6,64}$/.test(String(id || ''));
}
