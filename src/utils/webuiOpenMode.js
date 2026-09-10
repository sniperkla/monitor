'use client';

/**
 * How the agent Web UI is opened from the AI Agents app.
 *
 * Two mutually exclusive transports, and the user picks per device:
 *
 *   'in-app'    — the Web UI is framed INSIDE monitor (same-origin
 *                 /api/agents/webui-proxy). No popup, no Local Network Access
 *                 check, no dependency on this device running a relay, so it is
 *                 the one route that behaves identically on a phone, a tablet
 *                 and a desktop.
 *   'external'  — a real browser tab (Local Relay direct transfer on the relay
 *                 host, otherwise the same-origin server proxy).
 *
 * The preference is deliberately stored per-device (localStorage): a phone and
 * a desktop want different answers, and both are "the user".
 */

export const WEBUI_OPEN_MODE_KEY = 'ssh_monitor_webui_open_mode';
export const WEBUI_OPEN_MODE_IN_APP = 'in-app';
export const WEBUI_OPEN_MODE_EXTERNAL = 'external';

const VALID_MODES = [WEBUI_OPEN_MODE_IN_APP, WEBUI_OPEN_MODE_EXTERNAL];

export function readWebUIOpenMode() {
  if (typeof window === 'undefined') return '';
  try {
    const v = window.localStorage.getItem(WEBUI_OPEN_MODE_KEY);
    return VALID_MODES.includes(v) ? v : '';
  } catch {
    return '';
  }
}

export function writeWebUIOpenMode(mode) {
  if (typeof window === 'undefined') return;
  try {
    if (!mode) window.localStorage.removeItem(WEBUI_OPEN_MODE_KEY);
    else window.localStorage.setItem(WEBUI_OPEN_MODE_KEY, mode);
  } catch {
    /* private mode / storage disabled — the choice just is not remembered */
  }
}

/**
 * Phone / tablet heuristic. Kept deliberately close to
 * `detectMobileDevice()` in src/hooks/useIsMobileDevice.js, plus the
 * viewport-width leg that AIAgentsApp's Web UI routing has always used: a
 * narrow window behaves like a phone even on a desktop UA (iPadOS desktop
 * mode reports a Macintosh UA but keeps maxTouchPoints > 1, and a small
 * browser window is a small browser window).
 */
export function isMobileLikeBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768) return true;
  return false;
}

/**
 * Open `url` in a new browser tab as reliably as a browser allows.
 *
 * Order matters, and each step is a real fallback for a real failure:
 *
 *   1. window.open — works when called synchronously from a user gesture, and
 *      is the only variant that hands back a handle we can navigate later.
 *   2. synthetic <a target="_blank"> click — the escape hatch on mobile
 *      Safari and in iOS standalone/PWA mode, where window.open is refused
 *      outright but a link activation still opens a tab. This is the concrete
 *      reason "open in a new tab" failed on phones in standard mobile mode
 *      while desktop mode appeared to work.
 *   3. null — caller decides (pre-claimed tab, or copy the URL).
 *
 * No `features` string: passing one turns the target into a sized popup
 * window on desktop instead of a tab.
 */
export function openExternalUrl(url) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !url) return null;
  try {
    const w = window.open(url, '_blank');
    if (w) {
      try { w.opener = null; } catch { /* cross-origin, already isolated */ }
      return w;
    }
  } catch {
    /* popup blocked — fall through */
  }
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.position = 'fixed';
    a.style.left = '-9999px';
    a.style.width = '1px';
    a.style.height = '1px';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'anchor';
  } catch {
    return null;
  }
}
