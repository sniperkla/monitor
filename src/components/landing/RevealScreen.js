'use client';

import { signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Shield, ChevronRight, Server, Database, Mail, Lock, User as UserIcon, X, LoaderCircle, AlertCircle, CircleCheck } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { GalaxyBackground, ShootingStars, Nebula, MatrixRain } from './BackgroundEffects';
import { CinematicAuthModal } from './CinematicAuthModal';

/* ── Render Phase Hook — drives sequential reveal ── */
function useRenderSequence(totalPhases, phaseGap = 400) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (phase >= totalPhases) return;
    const timer = setTimeout(() => setPhase(p => p + 1), phaseGap);
    return () => clearTimeout(timer);
  }, [phase, totalPhases, phaseGap]);

  return phase;
}

/* ── Block Cursor ── */
function BlockCursor({ visible }) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const blink = setInterval(() => setOn(v => !v), 530);
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
    if (doneRef.current) return;
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

/* ── Terminal Run Text (fake output on hover) ── */
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
  return scene.map(line => ({ ...line, delay: line.delay || 0 }));
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
      return;
    }

    const scene = pickRandomScene();
    let lineIdx = 0;
    let charIdx = 0;

    const tick = () => {
      if (!activeRef.current) return;
      if (lineIdx >= scene.length) return;

      const line = scene[lineIdx];

      if (line.type === 'blank') {
        const rendered = scene.slice(0, lineIdx).map(l => ({ ...l, done: true }));
        rendered.push({ ...line, done: true, displayed: '' });
        setCurrentLines(rendered);
        lineIdx++;
        charIdx = 0;
        timerRef.current = setTimeout(tick, 60 + Math.random() * 80);
        return;
      }

      charIdx++;
      const partial = line.text.slice(0, charIdx);
      const rendered = scene.slice(0, lineIdx).map(l => ({ ...l, done: true }));
      rendered.push({ ...line, displayed: partial, done: false });
      setCurrentLines(rendered);

      if (charIdx >= line.text.length) {
        rendered[rendered.length - 1] = { ...line, done: true };
        setCurrentLines([...rendered]);
        lineIdx++;
        charIdx = 0;
        const gap = line.type === 'cmd' ? 180 + Math.random() * 250 : (line.delay || 40) + Math.random() * 80;
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
    <div className="absolute top-0 left-0 right-0 z-[3] pointer-events-none overflow-hidden rounded-t-[2rem]">
      <div className="px-6 pt-4 pb-2 font-mono text-[9px] leading-relaxed" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(6,8,24,0.3) 70%, transparent 100%)' }}>
        {currentLines.map((line, i) => (
          <div key={i} className="flex items-start">
            {line.type === 'cmd' && <span className="text-emerald-400/80 mr-1 shrink-0">$</span>}
            {line.type === 'blank' ? <div className="h-2" /> : (
              <>
                <span className="text-slate-400/70 whitespace-pre">{line.done ? line.text : line.displayed}</span>
                {line.done && line.suffix && (
                  <span className="ml-1.5 font-bold" style={{ color: line.sc || '#4ade80' }}>{line.suffix}</span>
                )}
                {!line.done && i === currentLines.length - 1 && (
                  <span
                    className="inline-block w-[4px] h-[8px] ml-0.5 shrink-0"
                    style={{ background: 'rgba(74,222,128,0.7)', boxShadow: '0 0 4px rgba(74,222,128,0.3)' }}
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
`;

/* ── Logo Pulse Rings ── */
function LogoWithPulseRings() {
  const [hovering, setHovering] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    const blink = setInterval(() => setCursorOn(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setPulsePhase(p => (p + 1) % 360), 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="relative flex items-center justify-center mb-10 shrink-0"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Ambient glow */}
      <div
        className="absolute w-64 h-32 rounded-full transition-opacity duration-700"
        style={{
          background: 'radial-gradient(ellipse, rgba(99,102,241,0.12) 0%, transparent 70%)',
          filter: 'blur(30px)',
          opacity: hovering ? 1 : 0.5,
        }}
      />

      {/* Main container */}
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="relative flex items-center px-4 py-3 rounded-2xl cursor-default"
        style={{
          background: 'linear-gradient(135deg, rgba(15,23,42,0.8) 0%, rgba(30,27,75,0.6) 50%, rgba(15,23,42,0.8) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(99,102,241,0.15)',
          boxShadow: hovering
            ? '0 0 40px rgba(99,102,241,0.15), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
            : '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)',
          transition: 'box-shadow 0.4s, border-color 0.4s',
          borderColor: hovering ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.15)',
        }}
      >
        {/* Animated gradient border accent (top edge) */}
        <div
          className="absolute top-0 left-4 right-4 h-[1px]"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(99,102,241,${0.3 + Math.sin(pulsePhase * 0.02) * 0.15}), rgba(34,211,238,${0.2 + Math.sin(pulsePhase * 0.02 + 1) * 0.1}), transparent)`,
          }}
        />

        {/* Terminal icon block */}
        <div className="relative">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
              border: '1px solid rgba(99,102,241,0.25)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 20px rgba(99,102,241,0.1)',
            }}
          >
            <div className="flex items-center">
              <span
                className="text-lg font-bold"
                style={{ color: '#6366f1', textShadow: '0 0 8px rgba(99,102,241,0.5)' }}
              >{'>'}</span>
              <span
                className="inline-block w-[2px] h-[18px] ml-0.5"
                style={{
                  background: cursorOn ? '#22d3ee' : 'transparent',
                  boxShadow: cursorOn ? '0 0 6px rgba(34,211,238,0.6)' : 'none',
                  transition: 'background 0.1s, box-shadow 0.1s',
                }}
              />
            </div>
          </div>
          {/* Corner accent */}
          <div
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
            style={{
              background: '#4ade80',
              boxShadow: '0 0 8px rgba(74,222,128,0.5), 0 0 16px rgba(74,222,128,0.2)',
              border: '2px solid rgba(15,23,42,0.9)',
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}

/* ── Holographic Border Hook ── */
function useHolographicBorder(cardRef) {
  const [holoStyle, setHoloStyle] = useState({});

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      setHoloStyle({
        background: `conic-gradient(from ${px * 3.6}deg at ${px}% ${py}%, #ff006a22, #ff6b0022, #ffd70022, #00ff8822, #00d4ff22, #6366f122, #ff006a22)`,
        opacity: 1,
      });
    };
    const handleLeave = () => setHoloStyle({ opacity: 0 });
    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
    return () => { card.removeEventListener('mousemove', handleMove); card.removeEventListener('mouseleave', handleLeave); };
  }, [cardRef]);

  return holoStyle;
}

/* ── 3D Tilt Hook ── */
function use3DTilt(cardRef) {
  const [tiltStyle, setTiltStyle] = useState({});

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setTiltStyle({
        transform: `perspective(1000px) rotateX(${((y - cy) / cy) * -8}deg) rotateY(${((x - cx) / cx) * 8}deg) scale3d(1.02, 1.02, 1.02)`,
        transition: 'transform 0.1s ease-out',
      });
    };
    const handleLeave = () => {
      setTiltStyle({ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)', transition: 'transform 0.5s ease-out' });
    };
    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
    return () => { card.removeEventListener('mousemove', handleMove); card.removeEventListener('mouseleave', handleLeave); };
  }, [cardRef]);

  return tiltStyle;
}

/* ── Staggered Item Wrapper ── */
function RenderItem({ phase, targetPhase, children, direction = 'up' }) {
  const visible = phase >= targetPhase;
  const initial = direction === 'up'
    ? { opacity: 0, y: 12 }
    : { opacity: 0, scale: 0.95 };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={initial}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Main Reveal Screen ── */
export function RevealScreen({ onDismiss }) {
  const cardRef = useRef(null);
  const tiltStyle = use3DTilt(cardRef);
  const holoStyle = useHolographicBorder(cardRef);
  const [hovered, setHovered] = useState(false);
  const [cursorBlink, setCursorBlink] = useState(true);

  // 0=logo, 1=title, 2=subtitle, 3=badges, 4=features, 5=buttons, 6=footer, 7=done
  const phase = useRenderSequence(8, 500);
  const showCursor = phase < 7;

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
          body: JSON.stringify({ action: 'confirm', email: email.trim().toLowerCase(), code: verifyCodeInput }),
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
        } else {
          // Confirm reset code & set new password
          if (!newPassword) {
            setAuthError('Please enter your new password.');
            setAuthLoading(false);
            return;
          }
          const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase(), code: resetCode, newPassword }),
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
      }

      // Perform Credentials Sign In via NextAuth
      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setAuthError(result.error === 'CredentialsSignin' ? 'Invalid email or password' : result.error);
        setAuthLoading(false);
      } else if (result?.ok) {
        window.location.href = result.url || '/';
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please try again.');
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    const blink = setInterval(() => setCursorBlink(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

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
      transition={{ duration: 0.8 }}
      className="relative z-10 flex flex-col items-center justify-center w-full min-h-screen px-6 py-12 bg-black overflow-y-auto"
    >
      <style>{GLITCH_CSS}</style>
      <GalaxyBackground />
      <ShootingStars />
      <Nebula />
      <MatrixRain />

      <div style={{ perspective: '1000px' }}>
        <div
          ref={cardRef}
          style={tiltStyle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <motion.div
            animate={{
              y: 0,
              opacity: showAuthModal ? 0 : 1,
              scale: showAuthModal ? 0.95 : 1,
              pointerEvents: showAuthModal ? 'none' : 'auto',
            }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="relative w-full max-w-xl p-10 md:p-12 rounded-[2rem] flex flex-col items-center z-10"


            style={{
              background: 'rgba(6, 8, 24, 0.6)',
              border: hovered ? '1px solid rgba(74, 222, 128, 0.3)' : '1px solid rgba(99, 102, 241, 0.25)',
              backdropFilter: 'blur(20px)',
              boxShadow: hovered
                ? '0 0 50px rgba(74, 222, 128, 0.1), 0 0 100px rgba(99, 102, 241, 0.08), 0 25px 70px rgba(0, 0, 0, 0.6), inset 0 0 30px rgba(74, 222, 128, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                : '0 0 50px rgba(99, 102, 241, 0.15), 0 25px 70px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
              transition: 'border 0.4s, box-shadow 0.4s',
            }}
          >
            {/* Holographic border overlay */}
            <div
              className="absolute inset-0 rounded-[2rem] pointer-events-none z-0"
              style={{ ...holoStyle, mixBlendMode: 'screen', transition: 'opacity 0.3s' }}
            />

            {/* Terminal scanline sweep on hover */}
            <div
              className="absolute inset-0 rounded-[2rem] pointer-events-none overflow-hidden z-[1]"
              style={{ opacity: hovered ? 1 : 0, transition: 'opacity 0.3s' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(74,222,128,0.015) 2px, rgba(74,222,128,0.015) 4px)',
                }}
              />
              <div
                className="absolute left-0 right-0 h-[2px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(74,222,128,0.15), transparent)',
                  animation: hovered ? 'scanSweep 2s linear infinite' : 'none',
                  boxShadow: '0 0 20px rgba(74,222,128,0.1)',
                }}
              />
            </div>

            {/* Terminal cursor indicator - bottom right corner */}
            <div
              className="absolute bottom-3 right-4 z-[2] flex items-center font-mono text-[9px] pointer-events-none"
              style={{ opacity: hovered ? 0.7 : 0, transition: 'opacity 0.3s' }}
            >
              <span className="text-emerald-400/60 mr-1">ssh@monitor:~$</span>
              <span
                className="inline-block w-[5px] h-[10px]"
                style={{
                  background: cursorBlink ? 'rgba(74,222,128,0.8)' : 'transparent',
                  boxShadow: cursorBlink ? '0 0 4px rgba(74,222,128,0.4)' : 'none',
                }}
              />
            </div>

            {/* Fake terminal run text */}
            <TerminalRunText active={hovered} />

            <div className="relative z-10 flex flex-col items-center w-full">

              {/* Phase 0: Logo — fades out when terminal run text is active */}
              <RenderItem phase={phase} targetPhase={0}>
                <div style={{ opacity: hovered ? 0.15 : 1, transition: 'opacity 0.5s ease-out' }}>
                  <LogoWithPulseRings />
                </div>
              </RenderItem>

              {/* Phase 1: Title with glitch + cursor */}
              <div className="flex items-center justify-center mb-1.5 min-h-[44px]">
                {phase >= 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center"
                  >
                    <h1
                      className="glitch-text text-3xl md:text-4xl font-extrabold tracking-[0.15em] text-center uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-200 to-cyan-200 font-sans"
                      data-text="SSH MONITOR"
                    >
                      {phase >= 1 ? 'SSH MONITOR' : ''}
                    </h1>
                    <BlockCursor visible={phase === 1} />
                  </motion.div>
                )}
              </div>

              {/* Phase 2: Subtitle types out + cursor */}
              <div className="flex items-center justify-center mb-5 min-h-[18px]">
                {phase >= 2 && (
                  <div className="flex items-center">
                    <p className="text-[10px] md:text-xs text-slate-400 font-mono tracking-widest text-center uppercase">
                      {'> '}
                      <TypewriterText text="Terminal & Server Control Center" speed={40} />
                    </p>
                    <BlockCursor visible={phase === 2} />
                  </div>
                )}
              </div>

              {/* Phase 3: Badges + cursor */}
              <div className="flex items-center gap-2 mb-6 font-mono text-[10px] tracking-wider text-slate-400 shrink-0 min-h-[24px]">
                <RenderItem phase={phase} targetPhase={3} direction="up">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>ONLINE</span>
                    </div>
                    <div className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                      <span>v1.0.0</span>
                    </div>
                    <div className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                      <span>SECURE</span>
                    </div>
                    <BlockCursor visible={phase === 3} />
                  </div>
                </RenderItem>
              </div>

              {/* Phase 4: Buttons — moved up for better balance */}
              <div className="w-full max-w-xs space-y-3 shrink-0 mb-6">
                <RenderItem phase={phase} targetPhase={4}>
                  <div className="space-y-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => signIn('google', { callbackUrl: '/' })}
                      className="relative w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl text-xs font-semibold cursor-pointer overflow-hidden group transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
                        boxShadow: '0 4px 20px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)',
                        color: '#ffffff',
                      }}
                    >
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ repeat: Infinity, duration: 2, ease: 'linear', repeatDelay: 1 }}
                        style={{ transform: 'skewX(-20deg)' }}
                      />
                      <span className="relative flex items-center justify-center w-5 h-5 rounded-full bg-white shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                      </span>
                      <span className="relative font-bold text-white">Sign in with Google</span>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setShowAuthModal(true)}
                      className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-semibold cursor-pointer text-slate-200 transition-all bg-slate-800/80 hover:bg-slate-700/90 border border-slate-700/60 shadow-md"
                    >
                      <Mail size={15} className="text-cyan-400" />
                      <span>Email & Password Sign In</span>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={onDismiss}
                      className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer text-slate-400 hover:text-slate-200 transition-colors bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10"
                    >
                      <ChevronRight size={14} />
                      <span>Continue without login</span>
                    </motion.button>
                  </div>
                </RenderItem>
              </div>

              {/* Phase 5: Feature cards — compact grid below buttons */}
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-xs shrink-0 mb-5">
                {features.map((f, i) => (
                  <AnimatePresence key={f.label}>
                    {phase >= 5 && (
                      <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: i * 0.1, duration: 0.35, ease: 'easeOut' }}
                        whileHover={{ scale: 1.03, translateY: -2 }}
                        className="relative p-3 rounded-xl border border-white/5 bg-slate-950/40 backdrop-blur-md overflow-hidden group cursor-default transition-all duration-300"
                      >
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                          style={{ background: `radial-gradient(circle at center, ${f.color}15, transparent 70%)` }}
                        />
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                            style={{ background: `${f.color}10`, border: `1px solid ${f.color}20` }}
                          >
                            <f.icon size={15} style={{ color: f.color }} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[11px] font-bold text-slate-200 group-hover:text-white transition-colors">{f.label}</h3>
                            <p className="text-[9px] text-slate-500 truncate">{f.desc}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                ))}
              </div>

              {/* Phase 6: Footer + cursor */}
              <div className="min-h-[14px] flex items-center justify-center">
                <RenderItem phase={phase} targetPhase={6}>
                  <div className="flex items-center">
                    <p className="text-[9px] md:text-[10px] text-center text-slate-500 max-w-xs leading-relaxed">
                      Login to sync settings, connections, and vault across devices.
                    </p>
                    <BlockCursor visible={phase === 6} />
                  </div>
                </RenderItem>
              </div>

            </div>
          </motion.div>
        </div>
      </div>

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
