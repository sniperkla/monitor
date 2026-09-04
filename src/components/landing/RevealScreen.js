'use client';

import { signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Shield, ChevronRight, Server, Database, Mail, LoaderCircle, Fingerprint } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Nebula } from './BackgroundEffects';
import { CinematicAuthModal } from './CinematicAuthModal';
import { signInWithPasskey, passkeysSupported } from '@/utils/passkey';
import {
  DataStreamCanvas,
  ForegroundDust,
  ParallaxLayer,
  useSmoothedPointer,
  prefersReducedMotion,
} from './DataStream';

/* ── Render Phase Hook — drives sequential reveal ── */
function useRenderSequence(totalPhases, phaseGap = 400) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (phase >= totalPhases) return undefined;
    const timer = setTimeout(() => setPhase((p) => p + 1), phaseGap);
    return () => clearTimeout(timer);
  }, [phase, totalPhases, phaseGap]);

  return phase;
}

/* ── Block Cursor ── */
function BlockCursor({ visible }) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!visible) return undefined;
    const blink = setInterval(() => setOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, [visible]);

  if (!visible) return null;

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: on ? 1 : 0 }}
      className="inline-block w-[10px] h-[20px] ml-1 align-middle shrink-0"
      style={{
        background: '#4ade80',
        boxShadow: on ? '0 0 8px rgba(74,222,128,0.7)' : 'none',
      }}
    />
  );
}

/* ── Typewriter Text ── */
function TypewriterText({ text, speed = 35, onComplete, className, style }) {
  const [displayed, setDisplayed] = useState('');
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return undefined;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        doneRef.current = true;
        onComplete?.();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return (
    <span className={className} style={style}>
      {displayed}
    </span>
  );
}

/* ── Terminal Run Text (ambient telemetry across the top of the scene) ── */
const TERMINAL_SCENES = [
  [
    { text: 'ssh monitor@10.0.0.1', type: 'cmd' },
    { text: 'Authenticating... ', type: 'out', suffix: 'OK', sc: '#4ade80' },
    { text: 'Last login: 2h ago from 192.168.1.5', type: 'out' },
    { text: 'Welcome back, monitor.', type: 'out', delay: 200 },
    { text: '', type: 'blank' },
    { text: 'uptime', type: 'cmd' },
    { text: ' 14:23:07 up 47 days, 12:33, 1 user, load avg: 0.42, 0.38, 0.35', type: 'out' },
    { text: 'df -h /', type: 'cmd' },
    { text: 'Filesystem  Size  Used  Avail Use% Mounted', type: 'out' },
    { text: '/dev/nvme0  120G  82G   38G   68% /', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Disk usage elevated ', type: 'out', suffix: 'WARN', sc: '#eab308' },
  ],
  [
    { text: 'docker ps', type: 'cmd' },
    { text: 'CONTAINER   IMAGE          STATUS       PORTS', type: 'out' },
    { text: 'a3f2 nginx:alpine    Up 14d       0.0.0.0:443->443/tcp', type: 'out' },
    { text: 'b7c1 postgres:16     Up 14d       5432/tcp', type: 'out' },
    { text: 'e9d4 redis:7         Up 14d       6379/tcp', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'All containers healthy ', type: 'out', suffix: '3/3 RUNNING', sc: '#4ade80' },
  ],
  [
    { text: 'nmap -sV 10.0.0.1', type: 'cmd' },
    { text: 'Starting Nmap 7.94 ( https://nmap.org )', type: 'out', delay: 300 },
    { text: 'PORT    STATE SERVICE  VERSION', type: 'out' },
    { text: '22/tcp  open  ssh      OpenSSH 9.6', type: 'out' },
    { text: '80/tcp  open  http     nginx 1.25.4', type: 'out' },
    { text: '443/tcp open  ssl/http nginx 1.25.4', type: 'out' },
    { text: '', type: 'blank' },
    { text: '3 services detected.', type: 'out', suffix: 'DONE', sc: '#4ade80' },
  ],
  [
    { text: 'fail2ban-client status sshd', type: 'cmd' },
    { text: 'Status for the jail: sshd', type: 'out' },
    { text: '|- Filter', type: 'out' },
    { text: '|  |- Currently failed: 2', type: 'out' },
    { text: '|  |- Total failed: 147', type: 'out' },
    { text: '`- Actions', type: 'out' },
    { text: '   |- Currently banned: 1', type: 'out' },
    { text: '   `- Total banned: 23', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Jail active, protecting SSH ', type: 'out', suffix: 'ACTIVE', sc: '#4ade80' },
  ],
  [
    { text: 'tail -f /var/log/auth.log', type: 'cmd' },
    { text: 'Jun 21 14:20:01 sshd[8841]: Accepted publickey for monitor', type: 'out' },
    { text: 'Jun 21 14:20:01 sshd[8841]: pam_unix(sshd:session): session opened', type: 'out' },
    { text: 'Jun 21 14:19:55 sshd[8837]: Failed password for admin from 45.33.22.11', type: 'out' },
    { text: 'Jun 21 14:19:55 sshd[8837]: Connection closed by authenticating user', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Monitoring auth log ', type: 'out', suffix: 'STREAMING', sc: '#22d3ee' },
  ],
  [
    { text: 'git pull origin main --rebase', type: 'cmd' },
    { text: 'remote: Enumerating objects: 7, done.', type: 'out' },
    { text: 'remote: Counting objects: 100% (7/7), done.', type: 'out' },
    { text: 'Unpacking objects: 100% (3/3), 1.24 KiB | 1.24 MiB/s, done.', type: 'out' },
    { text: 'Successfully rebased and updated refs/heads/main.', type: 'out', suffix: 'OK', sc: '#4ade80' },
  ],
  [
    { text: 'vault status', type: 'cmd' },
    { text: 'Key             Value', type: 'out' },
    { text: '---             -----', type: 'out' },
    { text: 'Seal Type       shamir', type: 'out' },
    { text: 'Initialized     true', type: 'out' },
    { text: 'Sealed          false', type: 'out' },
    { text: 'Total Shares    5', type: 'out' },
    { text: 'Threshold       3', type: 'out' },
    { text: 'Version         1.15.4', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Vault unsealed and ready ', type: 'out', suffix: 'SECURE', sc: '#4ade80' },
  ],
  [
    { text: 'systemctl status nginx', type: 'cmd' },
    { text: '● nginx.service - A high performance web server', type: 'out' },
    { text: '   Active: active (running) since Mon 2024-06-03', type: 'out' },
    { text: '   Main PID: 1234 (nginx)', type: 'out' },
    { text: '   Memory: 12.4M', type: 'out' },
    { text: '   CGroup: /system.slice/nginx.service', type: 'out' },
    { text: '           ├─1234 "nginx: master process"', type: 'out' },
    { text: '           ├─1235 "nginx: worker process"', type: 'out' },
    { text: '           └─1236 "nginx: worker process"', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Service running normally ', type: 'out', suffix: 'HEALTHY', sc: '#4ade80' },
  ],
  [
    { text: 'free -h', type: 'cmd' },
    { text: '              total    used    free   shared  buff/cache  available', type: 'out' },
    { text: 'Mem:          3.8Gi   1.2Gi   1.8Gi   128Mi      856Mi     2.3Gi', type: 'out' },
    { text: 'Swap:         1.0Gi    0.0B   1.0Gi', type: 'out' },
    { text: '', type: 'blank' },
    { text: 'Memory usage normal ', type: 'out', suffix: '30% USED', sc: '#4ade80' },
  ],
];

function pickRandomScene() {
  const scene = TERMINAL_SCENES[Math.floor(Math.random() * TERMINAL_SCENES.length)];
  return scene.map((line) => ({ ...line, delay: line.delay || 0 }));
}

function TerminalRunText({ active }) {
  const [currentLines, setCurrentLines] = useState([]);
  const timerRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCurrentLines([]);
      return undefined;
    }

    const scene = pickRandomScene();
    let lineIdx = 0;
    let charIdx = 0;

    const tick = () => {
      if (!activeRef.current) return;
      if (lineIdx >= scene.length) return;

      const line = scene[lineIdx];

      if (line.type === 'blank') {
        const rendered = scene.slice(0, lineIdx).map((l) => ({ ...l, done: true }));
        rendered.push({ ...line, done: true, displayed: '' });
        setCurrentLines(rendered);
        lineIdx++;
        charIdx = 0;
        timerRef.current = setTimeout(tick, 60 + Math.random() * 80);
        return;
      }

      charIdx++;
      const partial = line.text.slice(0, charIdx);
      const rendered = scene.slice(0, lineIdx).map((l) => ({ ...l, done: true }));
      rendered.push({ ...line, displayed: partial, done: false });
      setCurrentLines(rendered);

      if (charIdx >= line.text.length) {
        rendered[rendered.length - 1] = { ...line, done: true };
        setCurrentLines([...rendered]);
        lineIdx++;
        charIdx = 0;
        const gap =
          line.type === 'cmd' ? 180 + Math.random() * 250 : (line.delay || 40) + Math.random() * 80;
        timerRef.current = setTimeout(tick, gap);
        return;
      }

      const speed = line.type === 'cmd' ? 12 + Math.random() * 18 : 4 + Math.random() * 8;
      timerRef.current = setTimeout(tick, speed);
    };

    timerRef.current = setTimeout(tick, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active]);

  if (!active || currentLines.length === 0) return null;

  return (
    <div className="absolute top-0 left-0 right-0 z-[3] pointer-events-none overflow-hidden">
      <div
        className="px-6 pt-5 pb-3 font-mono text-[9px] leading-relaxed"
        style={{
          background:
            'linear-gradient(to bottom, rgba(2,4,10,0.72) 0%, rgba(6,8,24,0.35) 65%, transparent 100%)',
        }}
      >
        {currentLines.map((line, i) => (
          <div key={i} className="flex items-start">
            {line.type === 'cmd' && <span className="text-emerald-400/80 mr-1 shrink-0">$</span>}
            {line.type === 'blank' ? (
              <div className="h-2" />
            ) : (
              <>
                <span className="text-slate-400/70 whitespace-pre">
                  {line.done ? line.text : line.displayed}
                </span>
                {line.done && line.suffix && (
                  <span className="ml-1.5 font-bold" style={{ color: line.sc || '#4ade80' }}>
                    {line.suffix}
                  </span>
                )}
                {!line.done && i === currentLines.length - 1 && (
                  <span
                    className="inline-block w-[4px] h-[8px] ml-0.5 shrink-0"
                    style={{
                      background: 'rgba(74,222,128,0.7)',
                      boxShadow: '0 0 4px rgba(74,222,128,0.3)',
                    }}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Glitch CSS ── */
const GLITCH_CSS = `
@keyframes glitch-anim {
  0%, 100% { clip-path: inset(0 0 0 0); transform: translate(0); }
  10% { clip-path: inset(20% 0 60% 0); transform: translate(-3px, 1px); }
  20% { clip-path: inset(50% 0 20% 0); transform: translate(3px, -1px); }
  30% { clip-path: inset(10% 0 70% 0); transform: translate(-2px, 2px); }
  40% { clip-path: inset(80% 0 5% 0); transform: translate(1px, -2px); }
  50% { clip-path: inset(0 0 0 0); transform: translate(0); }
}
@keyframes glitch-anim-2 {
  0%, 100% { clip-path: inset(0 0 0 0); transform: translate(0); }
  15% { clip-path: inset(40% 0 30% 0); transform: translate(2px, 1px); }
  25% { clip-path: inset(10% 0 60% 0); transform: translate(-3px, -1px); }
  35% { clip-path: inset(70% 0 10% 0); transform: translate(2px, -2px); }
  45% { clip-path: inset(30% 0 50% 0); transform: translate(-1px, 2px); }
  55% { clip-path: inset(0 0 0 0); transform: translate(0); }
}
.glitch-text { position: relative; }
.glitch-text::before, .glitch-text::after {
  content: attr(data-text);
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: transparent;
}
.glitch-text::before { color: #ff006a; animation: glitch-anim 4s infinite linear; opacity: 0.6; }
.glitch-text::after { color: #00d4ff; animation: glitch-anim-2 4s infinite linear; animation-delay: 0.15s; opacity: 0.6; }
@keyframes scanSweep {
  0% { top: -2px; }
  100% { top: 100%; }
}
@keyframes crestRing {
  0% { transform: scale(1); opacity: 0.34; }
  100% { transform: scale(2.9); opacity: 0; }
}
`;

/* ── Floating crest — no card, just a glyph suspended in the starfield ── */
function CrestMark() {
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCursorOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  return (
    <div className="relative flex items-center justify-center mb-8">
      {/* Expanding sensor rings */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute rounded-full border border-cyan-400/25"
          style={{
            width: 88,
            height: 88,
            animation: `crestRing 5s ${i * 1.65}s infinite cubic-bezier(0.16, 1, 0.3, 1)`,
          }}
        />
      ))}

      {/* Ambient bloom */}
      <div
        className="absolute w-60 h-36 rounded-full"
        style={{
          background: 'radial-gradient(ellipse, rgba(99,102,241,0.18) 0%, transparent 70%)',
          filter: 'blur(28px)',
        }}
      />

      <div className="relative w-14 h-14 flex items-center justify-center">
        <span
          className="text-xl font-bold"
          style={{ color: '#818cf8', textShadow: '0 0 16px rgba(129,140,248,0.75)' }}
        >
          {'>'}
        </span>
        <span
          className="inline-block w-[2px] h-[18px] ml-1"
          style={{
            background: cursorOn ? '#22d3ee' : 'transparent',
            boxShadow: cursorOn ? '0 0 8px rgba(34,211,238,0.85)' : 'none',
            transition: 'background 0.1s, box-shadow 0.1s',
          }}
        />
      </div>
    </div>
  );
}

/* ── Staggered Item Wrapper ── */
function RenderItem({ phase, targetPhase, children, direction = 'up' }) {
  const visible = phase >= targetPhase;
  const initial = direction === 'up' ? { opacity: 0, y: 14 } : { opacity: 0, scale: 0.95 };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={initial}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * TiltStage — one rAF-driven transform for the whole content column.
 * Combines parallax translation and 3D tilt so nothing fights over `transform`.
 */
function TiltStage({ pointerRef, reduced, children }) {
  const ref = useRef(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const p = pointerRef && pointerRef.current;
      if (el && p && !reduced) {
        el.style.transform = `perspective(1400px) translate3d(${(-p.x * 14).toFixed(2)}px, ${(
          -p.y * 10
        ).toFixed(2)}px, 0) rotateX(${(-p.y * 2.2).toFixed(3)}deg) rotateY(${(
          p.x * 3
        ).toFixed(3)}deg)`;
      } else if (el) {
        el.style.transform = 'perspective(1400px) translate3d(0, 0, 0)';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pointerRef, reduced]);

  return (
    <div
      ref={ref}
      className="relative z-10 w-full flex flex-col items-center will-change-transform"
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </div>
  );
}

/* ── Main Reveal Screen — full-bleed cinematic ── */
export function RevealScreen({ onDismiss }) {
  const pointer = useSmoothedPointer(0.06);
  const [reduced] = useState(() => prefersReducedMotion());
  const [hovered, setHovered] = useState(false);

  // 0=crest, 1=title, 2=subtitle, 3=buttons, 4=features, 5=footer, 6=done
  const phase = useRenderSequence(7, 450);
  const showCursor = phase < 6;

  // Email & Password Auth State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'register' | 'forgot' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [name, setName] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);

  // Passkey state — only offered when the browser can actually do WebAuthn.
  const [passkeySupported] = useState(() => (typeof window !== 'undefined' ? passkeysSupported() : false));
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState(null);

  const handlePasskeySignIn = async () => {
    setPasskeyError(null);
    setPasskeyLoading(true);
    try {
      await signInWithPasskey({ callbackUrl: '/' });
    } catch (err) {
      setPasskeyError(err.message || 'Passkey sign-in failed.');
      setPasskeyLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        if (!email || !password || !confirmPassword) {
          setAuthError('Please fill in all required fields.');
          setAuthLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setAuthError('Passphrases do not match. Please verify your password.');
          setAuthLoading(false);
          return;
        }

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Registration failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Account registered! Verification code sent to your email.');
        setAuthMode('verify');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'verify') {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'confirm',
            email: email.trim().toLowerCase(),
            code: verifyCodeInput,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Email verification failed.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Email verified successfully! You can now sign in.');
        setAuthMode('signin');
        setAuthLoading(false);
        return;
      }

      if (authMode === 'forgot') {
        if (!email) {
          setAuthError('Please enter your email address.');
          setAuthLoading(false);
          return;
        }
        if (!resetCode) {
          // Request reset code
          const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          const data = await res.json();
          if (!data.success) {
            setAuthError(data.error || 'Failed to send password reset code.');
            setAuthLoading(false);
            return;
          }
          setAuthSuccess('Password reset code sent to your email. Please enter it below.');
          setAuthLoading(false);
          return;
        }

        // Confirm reset code & set new password
        if (!newPassword) {
          setAuthError('Please enter your new password.');
          setAuthLoading(false);
          return;
        }
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: resetCode,
            newPassword,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAuthError(data.error || 'Failed to reset password.');
          setAuthLoading(false);
          return;
        }
        setAuthSuccess('Password reset successfully! You can now sign in.');
        setAuthMode('signin');
        setResetCode('');
        setNewPassword('');
        setAuthLoading(false);
        return;
      }

      // Perform Credentials Sign In via NextAuth
      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setAuthError(
          result.error === 'CredentialsSignin' ? 'Invalid email or password' : result.error
        );
        setAuthLoading(false);
      } else if (result?.ok) {
        window.location.href = result.url || '/';
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please try again.');
      setAuthLoading(false);
    }
  };

  const features = [
    { icon: Terminal, label: 'SSH Terminal', desc: 'Multi-session management', color: '#4ade80' },
    { icon: Database, label: 'Database', desc: 'Browse & query data', color: '#6366f1' },
    { icon: Shield, label: 'Encrypted Vault', desc: 'Zero-knowledge security', color: '#eab308' },
    { icon: Server, label: 'Auto Deploy', desc: 'CI/CD pipeline', color: '#a855f7' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.1, ease: 'easeOut' }}
      className="relative w-full min-h-screen overflow-hidden bg-black"
    >
      <style>{GLITCH_CSS}</style>

      {/* ── Depth 0: the same network the handshake will accelerate through ── */}
      <DataStreamCanvas
        className="absolute inset-0 z-0 block"
        count={reduced ? 90 : 200}
        onFrame={(ds) => {
          const s = ds.state;
          const p = pointer.current;
          // Idle drift: a quiet network, signed out. dim, slow, no tunnel.
          s.speed = reduced ? 0.3 : 1.1;
          s.intensity = 0.05;
          s.tunnel = 0;
          s.exposure = 1;
          s.glitch = 0;
          s.fade = 0.9;
          s.brightness = 0.5;
          s.scanlines = 0.3;
          s.parallaxX = -p.x * 26;
          s.parallaxY = -p.y * 17;
          s.shake = 0;
          s.roll = 0;
        }}
      />
      <Nebula />

      {/* ── Depth 1: soft scrim so floating text stays legible ── */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 64% 58% at 50% 46%, rgba(2,4,10,0.76) 0%, rgba(2,4,10,0.44) 46%, rgba(2,4,10,0) 78%)',
        }}
      />

      {/* Ambient terminal telemetry, triggered by hovering the crest/title */}
      <TerminalRunText active={hovered} />

      {/* ── Depth 2: content floating in the scene ── */}
      <TiltStage pointerRef={pointer} reduced={reduced}>
        <div className="w-full flex flex-col items-center px-6 py-14">
          {/* Crest */}
          <ParallaxLayer pointerRef={pointer} depth={0.35}>
            <RenderItem phase={phase} targetPhase={0}>
              <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{ opacity: hovered ? 0.2 : 1, transition: 'opacity 0.5s ease-out' }}
              >
                <CrestMark />
              </div>
            </RenderItem>
          </ParallaxLayer>

          {/* Title */}
          <ParallaxLayer
            pointerRef={pointer}
            depth={0.55}
            className="w-full flex flex-col items-center"
          >
            <div className="flex items-center justify-center mb-2 min-h-[52px]">
              {phase >= 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                  className="flex items-center"
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => setHovered(false)}
                >
                  <h1
                    className="glitch-text text-4xl md:text-6xl font-extrabold tracking-[0.2em] text-center uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-100 to-cyan-200 font-sans"
                    data-text="SSH MONITOR"
                    style={{ textShadow: '0 0 60px rgba(129,140,248,0.25)' }}
                  >
                    SSH MONITOR
                  </h1>
                  <BlockCursor visible={phase === 1} />
                </motion.div>
              )}
            </div>

            {/* Subtitle */}
            <div className="flex items-center justify-center mb-9 min-h-[18px]">
              {phase >= 2 && (
                <div className="flex items-center">
                  <p className="text-[10px] md:text-xs text-slate-400 font-mono tracking-[0.25em] text-center uppercase">
                    {'> '}
                    <TypewriterText text="Terminal & Server Control Center" speed={40} />
                  </p>
                  <BlockCursor visible={phase === 2} />
                </div>
              )}
            </div>
          </ParallaxLayer>

          {/* Auth actions */}
          <ParallaxLayer pointerRef={pointer} depth={0.9} className="w-full flex justify-center">
            <div className="w-full max-w-sm space-y-2.5 mb-8">
              <RenderItem phase={phase} targetPhase={3}>
                <div className="space-y-2.5">
                  {/* Primary Google Auth */}
                  <motion.button
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => signIn('google', { callbackUrl: '/' })}
                    className="relative w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl text-xs font-semibold cursor-pointer overflow-hidden group transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                      boxShadow:
                        '0 4px 24px rgba(79, 70, 229, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                      color: '#ffffff',
                    }}
                  >
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
                      initial={{ x: '-100%' }}
                      animate={{ x: '100%' }}
                      transition={{ repeat: Infinity, duration: 2.2, ease: 'linear', repeatDelay: 1.5 }}
                      style={{ transform: 'skewX(-20deg)' }}
                    />
                    <span className="relative flex items-center justify-center w-5 h-5 rounded-full bg-white shadow-sm shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24">
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                    </span>
                    <span className="relative font-bold text-white tracking-wide">
                      Continue with Google
                    </span>
                  </motion.button>

                  {/* WebAuthn Passkey */}
                  {passkeySupported && (
                    <>
                      <motion.button
                        whileHover={{ scale: 1.015 }}
                        whileTap={{ scale: 0.985 }}
                        onClick={handlePasskeySignIn}
                        disabled={passkeyLoading}
                        className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer text-emerald-300 transition-all bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-500/30 shadow-sm disabled:opacity-60"
                      >
                        {passkeyLoading ? (
                          <LoaderCircle size={15} className="text-emerald-400 animate-spin" />
                        ) : (
                          <Fingerprint size={15} className="text-emerald-400" />
                        )}
                        <span>{passkeyLoading ? 'Verifying Passkey…' : 'Sign in with Passkey'}</span>
                      </motion.button>
                      {passkeyError && (
                        <p className="text-[10px] text-red-400/90 text-center -mt-1">{passkeyError}</p>
                      )}
                    </>
                  )}

                  {/* Email & Passphrase Sign In */}
                  <motion.button
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setShowAuthModal(true)}
                    className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer text-slate-200 transition-all bg-slate-900/60 hover:bg-slate-800/70 border border-slate-700/50 hover:border-cyan-500/40 shadow-sm"
                  >
                    <Mail size={14} className="text-cyan-400" />
                    <span>Email &amp; Password Login</span>
                  </motion.button>

                  {/* Guest bypass */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={onDismiss}
                    className="w-full flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-[11px] font-medium cursor-pointer text-slate-400 hover:text-slate-200 transition-colors bg-white/[0.03] hover:bg-white/[0.07] border border-white/5"
                  >
                    <span>Continue to Demo Mode</span>
                    <ChevronRight size={13} className="opacity-60" />
                  </motion.button>
                </div>
              </RenderItem>
            </div>
          </ParallaxLayer>

          {/* Feature strip */}
          <ParallaxLayer pointerRef={pointer} depth={1.15} className="w-full flex justify-center">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 w-full max-w-2xl mb-8">
              {features.map((f, i) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, y: 16, scale: 0.96 }}
                  animate={phase >= 4 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.96 }}
                  transition={{ delay: i * 0.1, duration: 0.45, ease: 'easeOut' }}
                  whileHover={{ scale: 1.04, translateY: -3 }}
                  className="relative p-3 md:p-3.5 rounded-xl border border-white/[0.07] bg-slate-950/40 backdrop-blur-md overflow-hidden group cursor-default transition-colors duration-300 hover:border-white/15"
                >
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{
                      background: `radial-gradient(circle at center, ${f.color}15, transparent 70%)`,
                    }}
                  />
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${f.color}10`, border: `1px solid ${f.color}20` }}
                    >
                      <f.icon size={15} style={{ color: f.color }} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[11px] font-bold text-slate-200 group-hover:text-white transition-colors">
                        {f.label}
                      </h3>
                      <p className="text-[9px] text-slate-500 truncate">{f.desc}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </ParallaxLayer>

          {/* Footer */}
          <ParallaxLayer pointerRef={pointer} depth={0.7} className="w-full flex justify-center">
            <div className="min-h-[14px] flex items-center justify-center">
              <RenderItem phase={phase} targetPhase={5}>
                <div className="flex items-center">
                  <p className="text-[9px] md:text-[10px] text-center text-slate-500 max-w-xs leading-relaxed">
                    Login to sync settings, connections, and vault across devices.
                  </p>
                  <BlockCursor visible={showCursor && phase === 5} />
                </div>
              </RenderItem>
            </div>
          </ParallaxLayer>
        </div>
      </TiltStage>

      {/* ── Depth 3: dust drifting IN FRONT of the content ── */}
      <ForegroundDust
        count={reduced ? 6 : 14}
        pointerRef={pointer}
        className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
      />

      {/* ── Immersive & Cinematic Email & Password Authentication Modal ── */}
      <AnimatePresence>
        {showAuthModal && (
          <CinematicAuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
            authMode={authMode}
            setAuthMode={setAuthMode}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            name={name}
            setName={setName}
            resetCode={resetCode}
            setResetCode={setResetCode}
            verifyCodeInput={verifyCodeInput}
            setVerifyCodeInput={setVerifyCodeInput}
            authLoading={authLoading}
            authError={authError}
            setAuthError={setAuthError}
            authSuccess={authSuccess}
            setAuthSuccess={setAuthSuccess}
            handleAuthSubmit={handleAuthSubmit}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
