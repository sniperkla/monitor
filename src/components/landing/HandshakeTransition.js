'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './DataStream';

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Connection audio. Four scheduled layers, all queued up-front on the audio
 * thread: typed keystrokes, a rising carrier as the socket opens, filtered
 * data chatter through the key exchange, and a two-note connected chime.
 */
function playHandshakeAudio(durationMs) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const dur = durationMs / 1000;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(0.3, now + 0.12);
    master.gain.setValueAtTime(0.3, now + dur * 0.8);
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    master.connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // 1 — Keystrokes while the command types out.
    const keys = 18;
    for (let i = 0; i < keys; i++) {
      const kt = now + 0.05 + (i / keys) * dur * 0.055;
      const k = ctx.createBufferSource();
      k.buffer = noiseBuf;
      const kf = ctx.createBiquadFilter();
      kf.type = 'bandpass';
      kf.frequency.value = 1800 + Math.random() * 900;
      kf.Q.value = 3;
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.0001, kt);
      kg.gain.linearRampToValueAtTime(0.16, kt + 0.004);
      kg.gain.exponentialRampToValueAtTime(0.0001, kt + 0.035);
      k.connect(kf);
      kf.connect(kg);
      kg.connect(master);
      k.start(kt, Math.random());
      k.stop(kt + 0.05);
    }

    // 2 — Carrier sweep as the socket opens (modem handshake flavour).
    const carrier = ctx.createOscillator();
    const carrierGain = ctx.createGain();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(320, now + dur * 0.06);
    carrier.frequency.exponentialRampToValueAtTime(1180, now + dur * 0.19);
    carrier.frequency.exponentialRampToValueAtTime(760, now + dur * 0.27);
    carrierGain.gain.setValueAtTime(0.0001, now + dur * 0.06);
    carrierGain.gain.linearRampToValueAtTime(0.09, now + dur * 0.1);
    carrierGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.32);
    carrier.connect(carrierGain);
    carrierGain.connect(master);
    carrier.start(now + dur * 0.06);
    carrier.stop(now + dur * 0.34);

    // 3 — Data chatter through negotiation + key exchange.
    const chatterStart = now + dur * 0.2;
    const chatterEnd = now + dur * 0.72;
    const bursts = 26;
    for (let i = 0; i < bursts; i++) {
      const bt = chatterStart + (i / bursts) * (chatterEnd - chatterStart);
      const b = ctx.createBufferSource();
      b.buffer = noiseBuf;
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.value = 900 + Math.random() * 2600;
      bf.Q.value = 1.6;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, bt + 0.006);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.03 + Math.random() * 0.04);
      b.connect(bf);
      bf.connect(bg);
      bg.connect(master);
      b.start(bt, Math.random());
      b.stop(bt + 0.09);
    }

    // 4 — Sub layer under the key exchange so it has weight.
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, now + dur * 0.3);
    sub.frequency.linearRampToValueAtTime(96, now + dur * 0.55);
    subGain.gain.setValueAtTime(0.0001, now + dur * 0.3);
    subGain.gain.linearRampToValueAtTime(0.13, now + dur * 0.4);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.78);
    sub.connect(subGain);
    subGain.connect(master);
    sub.start(now + dur * 0.3);
    sub.stop(now + dur * 0.8);

    // 5 — Connected chime (two notes, rising fourth).
    [
      { f: 587.33, at: dur * 0.78 },
      { f: 783.99, at: dur * 0.83 },
    ].forEach(({ f, at }) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = now + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.17, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.55);
    });

    return () => {
      try {
        ctx.close();
      } catch (_) {
        /* noop */
      }
    };
  } catch (_) {
    return null;
  }
}

const TOTAL_DURATION = 4200;

/**
 * The real SSH connection sequence, in the order it actually happens.
 * `at` is the normalized time the line starts printing.
 */
const HANDSHAKE = [
  { at: 0.05, label: 'resolving host', value: 'monitor.eaqdragon.com → 203.0.113.42' },
  { at: 0.11, label: 'tcp connect', value: '203.0.113.42:22  established  14 ms' },
  { at: 0.18, label: 'local version', value: 'SSH-2.0-OpenSSH_9.6p1' },
  { at: 0.23, label: 'remote version', value: 'SSH-2.0-OpenSSH_8.9p1' },
  { at: 0.29, label: 'kex algorithm', value: 'curve25519-sha256' },
  { at: 0.33, label: 'host key algorithm', value: 'ssh-ed25519' },
  { at: 0.37, label: 'cipher both ways', value: 'chacha20-poly1305@openssh.com' },
  { at: 0.42, label: 'mac', value: 'implicit (AEAD)' },
  { at: 0.47, label: 'ecdh exchange', value: '256-bit shared secret' },
  { at: 0.57, label: 'host fingerprint', value: 'SHA256:vS9x7Qm2Lk4R  verified' },
  { at: 0.63, label: 'new keys', value: 'rekey after 1073741824 blocks' },
  { at: 0.69, label: 'authentication', value: 'publickey ed25519  accepted' },
  { at: 0.75, label: 'session channel', value: 'channel 0 opened' },
];

const MOTD_LINES = [
  { at: 0.82, text: 'Authenticated to monitor.eaqdragon.com ([203.0.113.42]:22).', cls: 'text-emerald-400' },
  { at: 0.86, text: '', cls: '' },
  { at: 0.87, text: 'Linux monitor 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC', cls: 'text-slate-400' },
  { at: 0.9, text: '', cls: '' },
  { at: 0.91, text: '  load   0.42 0.38 0.31      up 42 days,  7:12', cls: 'text-slate-400' },
  { at: 0.94, text: '  memory 3.1 GiB / 7.7 GiB   swap 0 B', cls: 'text-slate-400' },
  { at: 0.96, text: '  disk / 48% of 96 GiB', cls: 'text-slate-400' },
];

function getPhase(t) {
  if (t < 0.06) return 0; // command typed
  if (t < 0.18) return 1; // resolve + tcp connect
  if (t < 0.36) return 2; // version + algorithm negotiation
  if (t < 0.56) return 3; // key exchange
  if (t < 0.76) return 4; // verify + authenticate
  return 5; // session open → MOTD → shell
}

export function HandshakeTransition({ onComplete }) {
  const [reduced] = useState(() => prefersReducedMotion());

  const stageRef = useRef(null);
  const lineRefs = useRef([]);
  const valueRefs = useRef([]);
  const dotsRefs = useRef([]);
  const motdRefs = useRef([]);
  const shellRef = useRef(null);
  const cursorRef = useRef(null);

  const [hud, setHud] = useState({
    stage: 'OPENING SOCKET',
    detail: '—',
    progress: '0%',
  });

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const doneRef = useRef(false);
  const lastHudRef = useRef(0);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current?.();
  };

  useEffect(() => {
    const cleanupAudio = reduced ? null : playHandshakeAudio(TOTAL_DURATION);
    const t0 = Date.now();
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      last = now;
      try {
        handleFrame(Date.now() - t0);
      } catch (_) {
        // A single bad frame must never kill the loop.
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const safety = setTimeout(finish, TOTAL_DURATION + 1200);
    return () => {
      if (cleanupAudio) cleanupAudio();
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFrame = (elapsed) => {
    const t = Math.min(1, elapsed / TOTAL_DURATION);
    const phase = getPhase(t);

    // ── Handshake lines: pending → working → done ──
    for (let i = 0; i < HANDSHAKE.length; i++) {
      const line = HANDSHAKE[i];
      const el = lineRefs.current[i];
      if (!el) continue;
      const local = (t - line.at) / 0.052;
      if (local < 0) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = Math.min(1, local * 3).toFixed(3);
      const dots = dotsRefs.current[i];
      const val = valueRefs.current[i];
      if (local >= 1) {
        if (dots) dots.style.display = 'none';
        if (val) {
          val.style.opacity = '1';
          val.style.transform = 'translateX(0)';
        }
        el.dataset.done = '1';
      } else {
        if (dots) {
          dots.style.display = '';
          const n = 1 + Math.floor((elapsed / 220 + i) % 3);
          dots.textContent = '·'.repeat(n);
        }
        if (val) {
          val.style.opacity = '0';
          val.style.transform = 'translateX(-4px)';
        }
        el.dataset.done = '0';
      }
    }

    // ── MOTD + shell prompt ──
    for (let i = 0; i < MOTD_LINES.length; i++) {
      const m = MOTD_LINES[i];
      const el = motdRefs.current[i];
      if (!el) continue;
      const local = (t - m.at) / 0.022;
      el.style.opacity = local < 0 ? '0' : Math.min(1, local).toFixed(3);
    }
    if (shellRef.current) {
      const local = clamp01((t - 0.965) / 0.02);
      shellRef.current.style.opacity = local.toFixed(3);
    }
    if (cursorRef.current) {
      cursorRef.current.style.opacity = Math.sin(elapsed / 110) > 0 ? '1' : '0';
    }

    // ── Telemetry (throttled — React state is too expensive per frame) ──
    if (elapsed - lastHudRef.current > 120) {
      lastHudRef.current = elapsed;
      const pct = Math.round(t * 100);
      if (phase === 0) setHud({ stage: 'ESTABLISHING', detail: 'ssh root@monitor:22', progress: `${pct}%` });
      else if (phase === 1) setHud({ stage: 'OPENING SOCKET', detail: '203.0.113.42:22', progress: `${pct}%` });
      else if (phase === 2) setHud({ stage: 'NEGOTIATING', detail: 'curve25519-sha256', progress: `${pct}%` });
      else if (phase === 3) setHud({ stage: 'KEY EXCHANGE', detail: 'ecdh · ed25519', progress: `${pct}%` });
      else if (phase === 4) setHud({ stage: 'AUTHENTICATING', detail: 'publickey', progress: `${pct}%` });
      else setHud({ stage: 'SESSION OPEN', detail: 'channel 0', progress: `${pct}%` });
    }

    if (t >= 1) finish();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[10001] overflow-hidden bg-[#02040a] select-none flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div ref={stageRef} className="relative z-10 w-full max-w-[720px] px-6 will-change-transform">
        {/* ── Terminal window ── */}
        <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-[#04070d]/85 shadow-[0_0_60px_rgba(6,22,18,0.9)] backdrop-blur-[2px]">
          <div className="flex items-center gap-2 border-b border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
            <span className="ml-2 font-mono text-[11px] tracking-wider text-emerald-500/60">
              root@monitor — ssh
            </span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-emerald-500/40">
              {hud.progress}
            </span>
          </div>

          <div className="px-5 py-4 font-mono text-[13px] leading-[1.75] sm:text-[13.5px]">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 text-slate-300">
              <span className="text-emerald-400">$</span>
              <span>ssh root@monitor.eaqdragon.com -p 22</span>
            </div>

            {HANDSHAKE.map((line, i) => (
              <div
                key={line.label}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className="flex items-baseline gap-x-2 whitespace-nowrap"
                style={{ opacity: 0 }}
              >
                <span className="text-emerald-500/70">›</span>
                <span className="w-[170px] shrink-0 text-slate-500 sm:w-[190px]">{line.label}</span>
                <span
                  ref={(el) => {
                    dotsRefs.current[i] = el;
                  }}
                  className="w-6 shrink-0 text-cyan-400/70"
                >
                  ·
                </span>
                <span
                  ref={(el) => {
                    valueRefs.current[i] = el;
                  }}
                  className="truncate text-emerald-300/90 transition-all duration-300"
                >
                  {line.value}
                </span>
              </div>
            ))}

            <div className="mt-3 border-t border-emerald-500/10 pt-3">
              {MOTD_LINES.map((m, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    motdRefs.current[i] = el;
                  }}
                  className={`whitespace-pre-wrap ${m.cls}`}
                  style={{ opacity: 0, minHeight: m.text ? undefined : '0.7em' }}
                >
                  {m.text}
                </div>
              ))}
              <div
                ref={shellRef}
                className="mt-2 flex items-center gap-1 text-emerald-300"
                style={{ opacity: 0 }}
              >
                <span>root@monitor:~$</span>
                <span ref={cursorRef} className="inline-block h-[1.05em] w-[0.55em] bg-emerald-400" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Status strip ── */}
        <div className="mt-3 flex items-center justify-between px-1 font-mono text-[11px] tracking-[0.18em] text-emerald-500/50">
          <span>{hud.stage}</span>
          <span className="text-emerald-500/35">{hud.detail}</span>
        </div>
      </div>
    </motion.div>
  );
}
