'use client';

/* Sound removed by design — the product is silent. The beep API is kept as
   no-ops so notification/bell call sites stay valid; desktop notifications
   (below) are not sound and still work. */

export function playBeep() {}

export function playSuccess() {}

export function playError() {}

export function playBell() {}

export function showDesktopNotification(title, message, type = 'info') {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;

  const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  try {
    new Notification(`${icon} ${title}`, {
      body: message,
      tag: `ssh-monitor-${type}`,
      silent: true,
    });
  } catch {}
}
