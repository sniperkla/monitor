'use client';

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function playBeep(frequency = 800, duration = 0.1, volume = 0.15) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

export function playSuccess() {
  playBeep(880, 0.08, 0.12);
  setTimeout(() => playBeep(1100, 0.12, 0.12), 100);
}

export function playError() {
  playBeep(300, 0.15, 0.15);
  setTimeout(() => playBeep(200, 0.2, 0.15), 180);
}

export function playBell() {
  playBeep(800, 0.08, 0.1);
}

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
