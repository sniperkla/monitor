'use client';

/**
 * Relay status, shared by every consumer that needs to know whether THIS
 * user's relay is attached.
 *
 * Two things make this worth extracting from AppContext:
 *
 *  1. `/api/health` is the wrong source. Its `relay.up` is
 *     `global.__activeRelays?.size > 0` — whether ANY tenant on the server has
 *     a relay up. On a multi-user deployment that reports "up" while the
 *     caller's own relay is offline, and "down" is equally meaningless for a
 *     single user. `/api/relay/token` resolves the session, walks the user's
 *     own relay registrations, and is therefore authoritative.
 *
 *  2. The install runs in a terminal on the user's own machine. The browser is
 *     never told it finished. Anything that only reads relay state on mount
 *     will keep showing "Relay not connected" until something forces a
 *     refetch — which is exactly the bug this module exists to prevent. So the
 *     status is polled, and any part of the app that just did something which
 *     should change it (a pairing approval, an install wizard completing) can
 *     nudge the poller to run now instead of on its next tick.
 */

/** Broadcast on window when relay state may have changed. */
export const RELAY_STATUS_EVENT = 'relay-status-changed';

/** Ask every listener to re-read relay status immediately. */
export function requestRelayStatusRefresh(reason = 'manual') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RELAY_STATUS_EVENT, { detail: { reason } }));
}

/** Subscribe to {@link RELAY_STATUS_EVENT}. Returns an unsubscribe fn. */
export function onRelayStatusRefresh(handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => handler(event?.detail || {});
  window.addEventListener(RELAY_STATUS_EVENT, listener);
  return () => window.removeEventListener(RELAY_STATUS_EVENT, listener);
}

/**
 * Read the current user's relay status. Throws on network/HTTP failure so
 * callers can distinguish "definitely not connected" from "could not tell" and
 * avoid flapping the UI on a transient blip.
 */
export async function fetchRelayStatus({ signal } = {}) {
  const res = await fetch('/api/relay/token', {
    credentials: 'include',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`relay status ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const relays = Array.isArray(data?.relays) ? data.relays : [];
  return {
    connected: !!data?.connected,
    relays,
    // Loopback port of the relay's own web proxy, or 0 when there is none.
    // The in-app browser renders ordinary sites from here so the page bytes
    // never touch the monitor server; a relay too old to host one reports
    // nothing and the caller falls back to the server proxy.
    webProxyPort: Number(relays.find((r) => Number(r?.webProxyPort) > 0)?.webProxyPort) || 0,
  };
}
