'use client';

import { SpotlightOverlay } from '@/components/OnboardingSpotlight';

import { createPortal } from 'react-dom';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, ChevronRight, ChevronLeft, Sparkles, Rocket,
  GitBranch, Code, Network, Send, Layout, Terminal,
  Database, Zap, CircleCheckBig, CircleHelp
} from 'lucide-react';

const STORAGE_KEY = 'autodeploy-onboarding-completed-v2';

const STEPS = [
  { id: 'welcome', icon: Rocket, color: '#6366f1', accentColor: '#818cf8', spotlight: null, section: null, side: null, hasTip: false, isDone: false },
  { id: 'nav', icon: Layout, color: '#0ea5e9', accentColor: '#38bdf8', spotlight: 'deploy-nav', section: 'overview', side: 'bottom', hasTip: true, isDone: false },
  { id: 'connection', icon: GitBranch, color: '#10b981', accentColor: '#34d399', spotlight: 'deploy-connection', section: 'connection', side: 'bottom', hasTip: true, isDone: false },
  { id: 'script', icon: Code, color: '#a855f7', accentColor: '#c084fc', spotlight: 'deploy-script', section: 'script', side: 'top', hasTip: true, isDone: false },
  { id: 'target', icon: Network, color: '#f59e0b', accentColor: '#fbbf24', spotlight: 'deploy-target', section: 'target', side: 'top', hasTip: true, isDone: false },
  { id: 'alerts', icon: Send, color: '#06b6d4', accentColor: '#22d3ee', spotlight: 'deploy-alerts', section: 'alerts', side: 'top', hasTip: true, isDone: false },
  { id: 'assistant', icon: Sparkles, color: '#ec4899', accentColor: '#f472b6', spotlight: 'deploy-assistant', section: 'assistant', side: 'top', hasTip: true, isDone: false },
  { id: 'actions', icon: Zap, color: '#22c55e', accentColor: '#4ade80', spotlight: 'deploy-actions', section: null, side: 'left', hasTip: true, isDone: false },
  { id: 'done', icon: Rocket, color: '#10b981', accentColor: '#34d399', spotlight: null, section: null, side: null, hasTip: false, isDone: true },
];

const COPY = {
  welcome: { title: 'Auto Deploy Quick Start', description: 'Ship code automatically on every git push. Let\u2019s set up your first deployment in under a minute.' },
  nav: { title: 'Section Navigator', description: 'Everything is organized into focused steps. Jump between them anytime \u2014 your progress is always saved.', tip: 'Click any section in this bar to jump straight to it.' },
  connection: { title: 'Connect Repository', description: 'Choose GitHub or Bitbucket, connect your account, and select the repository and branch that trigger deploys.', tip: 'A webhook URL is generated here \u2014 paste it into your repo settings.' },
  script: { title: 'Deployment Script', description: 'These shell commands run on your server every time a push arrives. Keep them simple and idempotent.', tip: 'The AI Assistant can write this script for you.' },
  target: { title: 'Deployment Target', description: 'Deploy on this machine or over SSH to any saved server. Set timeouts and working paths here.', tip: 'SSH targets reuse your SSH Manager connections.' },
  alerts: { title: 'Telegram Notifications', description: 'Get pinged when deploys succeed or fail. Link a bot token and pick the chats to notify.', tip: 'Use the Test button to verify delivery end-to-end.' },
  assistant: { title: 'AI Deploy Assistant', description: 'Describe your stack and AI writes the settings and deploy script \u2014 Standard or Swarm mode.', tip: 'A great starting point; tweak whatever it generates.' },
  actions: { title: 'Save & Deploy', description: 'Save stores your configuration. Deploy Now runs it immediately \u2014 Retry, Cancel and Force Reset appear when needed.', tip: 'Green means go. You are ready to ship.' },
  done: { title: 'You\u2019re All Set!', description: 'Your pipeline is configured. Push code and watch it deploy \u2014 logs stream live in the Logs section.' },
};

// Floating particles component
function FloatingParticles({ color, count = 20 }) {
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 20 + 10,
    delay: Math.random() * 5,
  }));

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: 1,
    }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: p.size,
          height: p.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}40, transparent)`,
          animation: `ob-float ${p.duration}s ease-in-out infinite`,
          animationDelay: `${p.delay}s`,
        }} />
      ))}
    </div>
  );
}

function TypedText({ text, speed = 30, delay = 0, style }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setStarted(true), delay); return () => clearTimeout(t); }, [delay]);
  useEffect(() => {
    if (!started) return;
    let i = 0;
    const timer = setInterval(() => { if (i <= text.length) { setDisplayed(text.slice(0, i)); i++; } else clearInterval(timer); }, speed);
    return () => clearInterval(timer);
  }, [text, speed, started]);
  return <span style={style}>{displayed}<span style={{ animation: 'ob-blink 1s step-end infinite', opacity: 0.8 }}>|</span></span>;
}

function ProgressRing({ progress, color, size = 44, strokeWidth = 3 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
    </svg>
  );
}

// ── Dynamic focus spotlight hook ── live-tracks the target at ANY window size;
// auto-scrolls it into view when a scrollable ancestor clips it.
function useSpotlightRect(target) {
  const [measured, setMeasured] = useState(null);
  useEffect(() => {
    if (!target) { setMeasured(null); return; }
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector(`[data-onboarding="${target}"]`);
      if (!el) { scrolled = false; setMeasured(null); return; }
      if (!scrolled) {
        let node = el.parentElement;
        while (node && node !== document.body) {
          const st = window.getComputedStyle(node);
          if (/(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflow)) {
            const cr = node.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            if (er.top < cr.top || er.bottom > cr.bottom) {
              scrolled = true;
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            break;
          }
          node = node.parentElement;
        }
      }
      const r = el.getBoundingClientRect();
      setMeasured({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const raf = requestAnimationFrame(() => { setTimeout(measure, 50); });
    const id = setInterval(measure, 150);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); clearInterval(id); window.removeEventListener('resize', measure); };
  }, [target]);
  return measured;
}

// Main component
export default function DeploymentOnboarding({ onComplete, onSectionChange }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [panelShow, setPanelShow] = useState(false);

  const meta = STEPS[step];
  const rect = useSpotlightRect(meta.spotlight);
  const total = STEPS.length;
  const contentTotal = total - 2; // exclude welcome and done
  const contentStep = step;       // step 1 = content step 1, etc.

  // Ask the parent app to activate the section for the current step.
  // The spotlight hook polls, so focus locks on once the section renders.
  const onSectionChangeRef = useRef(onSectionChange);
  useEffect(() => { onSectionChangeRef.current = onSectionChange; });
  useEffect(() => {
    if (!visible || !meta.section) return;
    if (typeof onSectionChangeRef.current === 'function') {
      try { onSectionChangeRef.current(meta.section); } catch (_) {}
    }
  }, [step, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 50);
    const t2 = setTimeout(() => setPanelShow(true), 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    setPanelShow(false);
    const t = setTimeout(() => setPanelShow(true), 100);
    return () => clearTimeout(t);
  }, [step]);

  const dismiss = useCallback(() => {
    setExiting(true);
    setPanelShow(false);
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, 'true');
      onComplete?.();
    }, 500);
  }, [onComplete]);

  const next = useCallback(() => {
    if (step === STEPS.length - 1) dismiss();
    else setStep(s => s + 1);
  }, [step, dismiss]);

  const prev = useCallback(() => {
    if (step > 1) setStep(s => s - 1);
  }, [step]);

  const showOverlay = visible && !exiting;

  if (!visible) return null;

  const copy = COPY[meta.id] || { title: '', description: '' };
  const isWelcome = meta.id === 'welcome';

  // Portal to document.body: guarantees true full-screen coverage and correct
  // spotlight coordinates regardless of transformed ancestors inside the app
  // window (framer-motion scale + backdrop-filter create containing blocks).
  return createPortal(
    <>
      <style>{`
        @keyframes ob-float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.4; }
          50% { transform: translateY(-20px) translateX(10px); opacity: 0.8; }
        }
        @keyframes ob-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes ob-pulse-glow {
          0%, 100% { box-shadow: 0 0 40px ${meta.color}40; }
          50% { box-shadow: 0 0 80px ${meta.color}60; }
        }
      `}</style>

      {/* Dim backdrop */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999990,
        background: rect ? 'transparent' : 'rgba(0,0,0,0.9)',
        backdropFilter: rect ? 'none' : 'blur(8px)',
        WebkitBackdropFilter: rect ? 'none' : 'blur(8px)',
        opacity: showOverlay ? 1 : 0,
        transition: 'opacity 0.4s ease',
        pointerEvents: showOverlay ? 'auto' : 'none',
      }} />

      {/* Spotlight */}
      <SpotlightOverlay rect={rect} color={meta.color} show={showOverlay && !meta.isDone && !isWelcome} />

      {/* Content panel */}
      <ImmersiveCenterPanel
        step={step}
        meta={meta}
        total={total}
        contentStep={contentStep}
        contentTotal={contentTotal}
        onNext={next}
        onPrev={prev}
        onDismiss={dismiss}
        show={panelShow && showOverlay}
        copy={copy}
      />
    </>,
    document.body
  );
}

// Immersive center panel (welcome / steps / done) \u2014 mirrors SSHOnboarding
function ImmersiveCenterPanel({ step, meta, total, contentStep, contentTotal, onNext, onPrev, onDismiss, show, copy }) {
  const isWelcome = meta.id === 'welcome';
  const isLast = step === STEPS.length - 1;

  if (isWelcome) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999997,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        pointerEvents: show ? 'auto' : 'none',
        opacity: show ? 1 : 0, transition: 'opacity 0.5s ease',
      }}>
        <FloatingParticles color={meta.color} count={30} />
        <div style={{
          maxWidth: 880, width: '100%', textAlign: 'center',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          <div style={{ marginBottom: 40 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px',
              borderRadius: 999, background: `${meta.color}15`, border: `1px solid ${meta.color}30`, marginBottom: 24,
            }}>
              <Sparkles size={14} style={{ color: meta.color }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Auto Deploy Quick Start
              </span>
            </div>
            <h1 style={{
              margin: '0 0 16px', fontSize: 42, fontWeight: 800,
              background: `linear-gradient(135deg, #fff, ${meta.accentColor})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.1,
            }}>
              {copy.title}
            </h1>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, color: '#94a3b8', lineHeight: 1.6 }}>
              <TypedText text={copy.description} speed={15} delay={300} />
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 40 }}>
            {[
              { icon: GitBranch, title: 'Connect', desc: 'GitHub or Bitbucket, branch-watched triggers' },
              { icon: Code, title: 'Deploy Script', desc: 'Shell commands that run on every push' },
              { icon: Network, title: 'Any Target', desc: 'Local host or SSH servers over Relay' },
              { icon: Terminal, title: 'Live Logs', desc: 'Realtime output with error jump-to' },
            ].map((feature, i) => (
              <div key={i} style={{
                padding: 20, borderRadius: 16,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'left', opacity: show ? 1 : 0,
                transform: show ? 'translateY(0)' : 'translateY(20px)',
                transition: `all 0.5s ease ${i * 0.1}s`,
              }}>
                <feature.icon size={24} style={{ color: meta.color, marginBottom: 12 }} />
                <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{feature.title}</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{feature.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <button onClick={onDismiss} style={{
              padding: '12px 24px', borderRadius: 12,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#94a3b8'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#64748b'; }}
            >
              Skip Tour
            </button>
            <button onClick={onNext} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 28px', borderRadius: 14,
              background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
              border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              boxShadow: `0 8px 32px ${meta.color}40`, transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 12px 40px ${meta.color}60`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 8px 32px ${meta.color}40`; }}
            >
              Start Tour
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Final celebration screen
  if (isLast) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999997,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        pointerEvents: show ? 'auto' : 'none',
        opacity: show ? 1 : 0, transition: 'opacity 0.5s ease',
      }}>
        <FloatingParticles color={meta.color} count={40} />
        <div style={{
          maxWidth: 480, width: '100%', textAlign: 'center',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          <div style={{
            width: 100, height: 100, margin: '0 auto 24px', borderRadius: '50%',
            background: `radial-gradient(circle, ${meta.color}30, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'ob-pulse-glow 2s ease-in-out infinite',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 8px 40px ${meta.color}60`,
            }}>
              <CircleCheckBig size={36} style={{ color: '#fff' }} />
            </div>
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 32, fontWeight: 800, color: '#f1f5f9' }}>
            {copy.title}
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 15, color: '#94a3b8', lineHeight: 1.6 }}>
            {copy.description}
          </p>
          <button onClick={onNext} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '16px 32px', borderRadius: 14,
            background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
            border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            boxShadow: `0 8px 32px ${meta.color}40`, transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 12px 40px ${meta.color}60`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 8px 32px ${meta.color}40`; }}
          >
            <Sparkles size={18} />
            Get Started
          </button>
        </div>
      </div>
    );
  }

  // Regular step panel (floating card style)
  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      left: '50%',
      transform: `translateX(-50%) ${show ? 'translateY(0)' : 'translateY(120px)'}`,
      zIndex: 999997,
      opacity: show ? 1 : 0,
      transition: 'all 0.5s cubic-bezier(0.34, 1.3, 0.64, 1)',
      pointerEvents: show ? 'auto' : 'none',
    }}>
      <div style={{
        width: 'calc(100vw - 64px)',
        maxWidth: 720,
        background: 'linear-gradient(165deg, rgba(15,23,42,0.98) 0%, rgba(8,12,24,0.99) 100%)',
        border: `1px solid ${meta.color}35`,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: `0 8px 48px rgba(0,0,0,0.5), 0 0 80px ${meta.color}15`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        {/* Progress bar */}
        <div style={{ height: 2, background: 'rgba(255,255,255,0.05)' }}>
          <div style={{
            height: '100%',
            width: `${(contentStep / contentTotal) * 100}%`,
            background: `linear-gradient(90deg, ${meta.color}, ${meta.accentColor})`,
            transition: 'width 0.5s ease',
          }} />
        </div>

        <div style={{ padding: '24px 28px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 20 }}>
            <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 18,
                background: `linear-gradient(135deg, ${meta.color}20, ${meta.color}05)`,
                border: `1px solid ${meta.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <meta.icon size={28} style={{ color: meta.color }} />
              </div>
              <div style={{ position: 'absolute', top: -4, right: -4 }}>
                <ProgressRing
                  progress={(contentStep / contentTotal) * 100}
                  color={meta.color}
                  size={32}
                  strokeWidth={2}
                />
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: '#f1f5f9',
                }}>{contentStep}</span>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: `${meta.color}15`, border: `1px solid ${meta.color}30`, color: meta.color,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {copy.title}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
                <TypedText text={copy.description} speed={12} delay={200} />
              </p>
              {copy.tip && (
                <div style={{
                  marginTop: 10, padding: '7px 10px', borderRadius: 10,
                  background: `${meta.color}12`, border: `1px solid ${meta.color}30`,
                  fontSize: 11, color: meta.accentColor,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <Sparkles size={11} /> {copy.tip}
                </div>
              )}
            </div>
            <button onClick={onDismiss} style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: 10,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
              color: '#94a3b8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = '#f1f5f9'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {STEPS.slice(1, -1).map((s, i) => (
                <div key={i} style={{
                  width: i + 1 === step ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i + 1 === step
                    ? `linear-gradient(90deg, ${meta.color}, ${meta.accentColor})`
                    : i + 1 < step
                      ? `${meta.color}40`
                      : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s ease',
                  boxShadow: i + 1 === step ? `0 0 12px ${meta.color}60` : 'none',
                }} />
              ))}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {step > 1 && (
                <button onClick={onPrev} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '10px 16px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                >
                  <ChevronLeft size={14} />
                  Back
                </button>
              )}

              <button onClick={onDismiss} style={{
                padding: '10px 16px', borderRadius: 10,
                background: 'transparent', border: 'none',
                color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'color 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; }}
              >
                Skip
              </button>

              <button onClick={onNext} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '12px 24px', borderRadius: 12,
                background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
                border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                boxShadow: `0 4px 20px ${meta.color}40`, transition: 'all 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 28px ${meta.color}50`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 4px 20px ${meta.color}40`; }}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function hasCompletedDeploymentOnboarding() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetDeploymentOnboarding() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
