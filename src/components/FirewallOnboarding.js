'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X, ChevronRight, ChevronLeft, Sparkles,
  Shield, Server, Workflow, Layers, Radar,
  CircleCheckBig, Zap, Ban, Power
} from 'lucide-react';

const STORAGE_KEY = 'firewall-onboarding-completed';

const STEPS = [
  {
    id: 'welcome',
    icon: Shield,
    color: '#10b981',
    accentColor: '#34d399',
    spotlight: null,
    side: null,
    hasTip: false,
    isDone: false,
  },
  {
    id: 'serverSelect',
    icon: Server,
    color: '#0ea5e9',
    accentColor: '#38bdf8',
    spotlight: 'firewall-server-select',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'autoSync',
    icon: Workflow,
    color: '#6366f1',
    accentColor: '#818cf8',
    spotlight: 'firewall-tab-autosync',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'manualImport',
    icon: Layers,
    color: '#a855f7',
    accentColor: '#c084fc',
    spotlight: 'firewall-tab-manual',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'quickBlock',
    icon: Ban,
    color: '#f43f5e',
    accentColor: '#fb7185',
    spotlight: 'firewall-quick-block',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'telemetry',
    icon: Radar,
    color: '#f59e0b',
    accentColor: '#fbbf24',
    spotlight: 'firewall-tab-telemetry',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'docker',
    icon: Zap,
    color: '#06b6d4',
    accentColor: '#22d3ee',
    spotlight: 'firewall-docker-badge',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'lastResort',
    icon: Power,
    color: '#ef4444',
    accentColor: '#f87171',
    spotlight: 'firewall-last-resort',
    side: 'top',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'done',
    icon: Zap,
    color: '#10b981',
    accentColor: '#34d399',
    spotlight: null,
    side: null,
    hasTip: false,
    isDone: true,
  },
];

function FloatingParticles({ color, count = 20 }) {
  // Deterministic seeded PRNG keeps render pure (stable across re-renders)
  const particles = useMemo(() => {
    // Stateless hash-based PRNG: deterministic and pure (no reassignment)
    const rand = (i) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: rand(i + 1) * 100,
      y: rand(i + 2) * 100,
      size: rand(i + 3) * 4 + 2,
      duration: rand(i + 4) * 20 + 10,
      delay: rand(i + 5) * 5,
    }));
  }, [count]);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size, borderRadius: '50%',
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

function useSpotlightRect(target) {
  const [measured, setMeasured] = useState(null);
  useEffect(() => {
    if (!target) return;
    let scrolled = false; // scrollIntoView once per step — repeating it restarts the smooth scroll
    const measure = () => {
      const el = document.querySelector(`[data-onboarding="${target}"]`);
      if (el) {
        // Anchor may live below the fold (e.g. quick-block card) — bring it into view
        const r = el.getBoundingClientRect();
        if (!scrolled && (r.bottom > window.innerHeight - 80 || r.top < 80)) {
          scrolled = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setMeasured({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      else { scrolled = false; setMeasured(null); }
    };
    const raf = requestAnimationFrame(() => { setTimeout(measure, 50); });
    const id = setInterval(measure, 150);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); clearInterval(id); window.removeEventListener('resize', measure); };
  }, [target]);
  return target ? measured : null;
}

function ImmersiveCenterPanel({ step, meta, total, contentStep, contentTotal, onNext, onPrev, onDismiss, show }) {
  const { t } = useTranslation();
  const isWelcome = meta.id === 'welcome';
  const isLast = step === STEPS.length - 1;

  if (isWelcome) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 210,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        pointerEvents: show ? 'auto' : 'none', opacity: show ? 1 : 0, transition: 'opacity 0.5s ease',
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
                Firewall Protection Quick Start
              </span>
            </div>
            <h1 style={{
              margin: '0 0 16px', fontSize: 42, fontWeight: 800,
              background: `linear-gradient(135deg, #fff, ${meta.accentColor})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.1,
            }}>
              {t(`firewall.onboarding.steps.${meta.id}.title`)}
            </h1>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, color: '#94a3b8', lineHeight: 1.6 }}>
              <TypedText text={t(`firewall.onboarding.steps.${meta.id}.description`)} speed={15} delay={300} />
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
            {[
              { icon: Workflow, title: 'Automated Sync', desc: 'Custom cron intervals for automatic threat intelligence feeds' },
              { icon: Zap, title: 'Docker & Swarm Protection', desc: 'DOCKER-USER and FORWARD chain shielding with auto-recovery' },
              { icon: Radar, title: 'Live Threat Telemetry', desc: '1s realtime drop-rate charts with 24/7 attack history via Server Agent' },
              { icon: Ban, title: 'Instant Quick Blocks', desc: 'Block or unblock IPs live — survives re-applies and auto-syncs' },
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
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.18)',
              color: '#94a3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)'; e.currentTarget.style.color = '#cbd5e1'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; e.currentTarget.style.color = '#94a3b8'; }}
            >{t('firewall.onboarding.skipTour')}</button>
            <button onClick={onNext} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderRadius: 14,
              background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
              border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              boxShadow: `0 8px 32px ${meta.color}40`, transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 12px 40px ${meta.color}60`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 8px 32px ${meta.color}40`; }}
            >{t('firewall.onboarding.startTour')} <ChevronRight size={18} /></button>
          </div>
        </div>
      </div>
    );
  }

  if (isLast) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 210,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        pointerEvents: show ? 'auto' : 'none', opacity: show ? 1 : 0, transition: 'opacity 0.5s ease',
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
            {t(`firewall.onboarding.steps.${meta.id}.title`)}
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 15, color: '#94a3b8', lineHeight: 1.6 }}>
            {t(`firewall.onboarding.steps.${meta.id}.description`)}
          </p>
          <button onClick={onNext} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '16px 32px', borderRadius: 14,
            background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
            border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            boxShadow: `0 8px 32px ${meta.color}40`, transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 12px 40px ${meta.color}60`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 8px 32px ${meta.color}40`; }}
          >
            <Sparkles size={18} /> {t('firewall.onboarding.getStarted')}
          </button>
        </div>
      </div>
    );
  }

  // Regular step panel
  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%',
      transform: `translateX(-50%) ${show ? 'translateY(0)' : 'translateY(120px)'}`,
      zIndex: 210, opacity: show ? 1 : 0,
      transition: 'all 0.5s cubic-bezier(0.34, 1.3, 0.64, 1)',
      pointerEvents: show ? 'auto' : 'none',
    }}>
      <div style={{
        width: 'calc(100vw - 64px)', maxWidth: 720,
        background: 'linear-gradient(165deg, rgba(15,23,42,0.98) 0%, rgba(8,12,24,0.99) 100%)',
        border: `1px solid ${meta.color}35`, borderRadius: 24, overflow: 'hidden',
        boxShadow: `0 8px 48px rgba(0,0,0,0.5), 0 0 80px ${meta.color}15`,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      }}>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.05)' }}>
          <div style={{
            height: '100%', width: `${(contentStep / contentTotal) * 100}%`,
            background: `linear-gradient(90deg, ${meta.color}, ${meta.accentColor})`,
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ padding: '24px 28px' }}>
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
                <ProgressRing progress={(contentStep / contentTotal) * 100} color={meta.color} size={32} strokeWidth={2} />
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
                  background: `${meta.color}15`, border: `1px solid ${meta.color}30`,
                  color: meta.color, textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {t('firewall.onboarding.stepOf', { step: contentStep, total: contentTotal })}
                </span>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.2 }}>
                {t(`firewall.onboarding.steps.${meta.id}.title`)}
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
                <TypedText text={t(`firewall.onboarding.steps.${meta.id}.description`)} speed={10} delay={100} />
              </p>
              {meta.hasTip && (
                <div style={{
                  marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '12px 16px', borderRadius: 12,
                  background: `${meta.color}08`, border: `1px solid ${meta.color}20`,
                }}>
                  <ChevronRight size={14} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                    {t(`firewall.onboarding.steps.${meta.id}.tip`)}
                  </span>
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
                  width: i + 1 === step ? 24 : 8, height: 8, borderRadius: 4,
                  background: i + 1 === step
                    ? `linear-gradient(90deg, ${meta.color}, ${meta.accentColor})`
                    : i + 1 < step ? `${meta.color}40` : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s ease',
                  boxShadow: i + 1 === step ? `0 0 12px ${meta.color}60` : 'none',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {step > 1 && (
                <button onClick={onPrev} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '10px 16px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
                  color: '#cbd5e1', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                ><ChevronLeft size={14} /> {t('firewall.onboarding.back')}</button>
              )}
              <button onClick={onDismiss} style={{
                padding: '10px 16px', borderRadius: 10,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              >{t('firewall.onboarding.skip')}</button>
              <button onClick={onNext} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '10px 20px', borderRadius: 10,
                background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: `0 4px 16px ${meta.color}40`, transition: 'all 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = `0 6px 24px ${meta.color}60`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 4px 16px ${meta.color}40`; }}
              >{t('firewall.onboarding.next')} <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FirewallOnboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const meta = STEPS[step];
  const total = STEPS.length;
  const contentTotal = total - 2; // exclude welcome and done
  const contentStep = step;       // step 1 = content step 1, step 2 = content step 2, etc.
  const spotlightRect = useSpotlightRect(meta.spotlight);

  const handleNext = useCallback(() => {
    if (step === total - 1) {
      localStorage.setItem(STORAGE_KEY, 'true');
      setIsVisible(false);
      setTimeout(() => { if (onComplete) onComplete(); }, 300);
    } else {
      setStep(s => s + 1);
    }
  }, [step, total, onComplete]);

  const handlePrev = useCallback(() => { if (step > 0) setStep(s => s - 1); }, [step]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsVisible(false);
    setTimeout(() => { if (onComplete) onComplete(); }, 300);
  }, [onComplete]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isVisible) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, handleNext, handlePrev, handleDismiss]);

  if (!isVisible) return null;

  // Portal to document.body: guarantees true full-screen coverage
  // regardless of transformed ancestors inside the app window.
  return createPortal(
    <>
      {!spotlightRect && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          zIndex: 200,
        }} />
      )}
      {spotlightRect && (
        <div style={{
          position: 'fixed',
          top: spotlightRect.top - 8, left: spotlightRect.left - 8,
          width: spotlightRect.width + 16, height: spotlightRect.height + 16,
          borderRadius: 12, boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.72)`,
          border: `2px solid ${meta.color}`, zIndex: 205, pointerEvents: 'none',
          animation: 'ob-spotlight-pulse 2s ease-in-out infinite',
        }} />
      )}
      <ImmersiveCenterPanel
        step={step} meta={meta} total={total}
        contentStep={contentStep} contentTotal={contentTotal}
        onNext={handleNext} onPrev={handlePrev} onDismiss={handleDismiss}
        show={isVisible}
      />
      <style jsx global>{`
        @keyframes ob-float {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.5; }
          50% { transform: translateY(-20px) rotate(180deg); opacity: 1; }
        }
        @keyframes ob-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes ob-spotlight-pulse {
          0%, 100% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.72), 0 0 20px ${meta.color}60; }
          50% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.72), 0 0 40px ${meta.color}90; }
        }
        @keyframes ob-pulse-glow {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `}</style>
    </>,
    document.body
  );
}

export function hasCompletedFirewallOnboarding() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetFirewallOnboarding() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
