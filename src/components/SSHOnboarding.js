'use client';

import { SpotlightOverlay } from '@/components/OnboardingSpotlight';

import { createPortal } from 'react-dom';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, ChevronRight, ChevronLeft, ArrowRight, Sparkles,
  Monitor, Plus, Terminal, FolderOpen,
  Database, Star, Zap, CircleCheckBig, CircleHelp,
  Server, Shield
} from 'lucide-react';

const STORAGE_KEY = 'ssh-onboarding-completed';

const STEPS = [
  {
    id: 'welcome',
    icon: Monitor,
    color: '#6366f1',
    accentColor: '#818cf8',
    spotlight: null,
    side: null,
    hasTip: false,
    isDone: false,
  },
  {
    id: 'sidebar',
    icon: Plus,
    color: '#10b981',
    accentColor: '#34d399',
    spotlight: 'sidebar',
    side: 'right',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'dashboard',
    icon: Star,
    color: '#f59e0b',
    accentColor: '#fbbf24',
    spotlight: 'nav-dashboard',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'terminal',
    icon: Terminal,
    color: '#06b6d4',
    accentColor: '#22d3ee',
    spotlight: 'nav-terminal',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'files',
    icon: FolderOpen,
    color: '#a855f7',
    accentColor: '#c084fc',
    spotlight: 'nav-files',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'database',
    icon: Database,
    color: '#f43f5e',
    accentColor: '#fb7185',
    spotlight: 'nav-database',
    side: 'bottom',
    hasTip: false,
    isDone: false,
  },
  {
    id: 'help-btn',
    icon: CircleHelp,
    color: '#6366f1',
    accentColor: '#818cf8',
    spotlight: 'help-btn',
    side: 'left',
    hasTip: false,
    isDone: false,
  },
  {
    id: 'done',
    icon: Zap,
    color: '#6366f1',
    accentColor: '#818cf8',
    spotlight: null,
    side: null,
    hasTip: false,
    isDone: true,
  },
];

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
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${color}40, transparent)`,
            animation: `ob-float ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// Animated typing text
function TypedText({ text, speed = 30, delay = 0, style }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const startTimer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(startTimer);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const timer = setInterval(() => {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, started]);

  return <span style={style}>{displayed}<span style={{ animation: 'ob-blink 1s step-end infinite', opacity: 0.8 }}>|</span></span>;
}

// Circular progress ring
function ProgressRing({ progress, color, size = 44, strokeWidth = 3 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

// Spotlight hook
// ── Dynamic focus ── tracks the target live (poll + resize) so the spotlight
// follows it through window drags/resizes/minimize-restore at ANY window size.
// If a scrollable ancestor clips the target, it is scrolled into view first.
function useSpotlightRect(target) {
  const [measured, setMeasured] = useState(null);
  useEffect(() => {
    if (!target) { setMeasured(null); return; }
    let scrolled = false; // one smooth scroll per step — repeating restarts animation
    const measure = () => {
      const el = document.querySelector(`[data-onboarding="${target}"]`);
      if (!el) { scrolled = false; setMeasured(null); return; }
      if (!scrolled) {
        // Walk up to the nearest scrollable ancestor actually clipping the target
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
    measure();
    const raf = requestAnimationFrame(() => { setTimeout(measure, 50); });
    const id = setInterval(measure, 150);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); clearInterval(id); window.removeEventListener('resize', measure); };
  }, [target]);
  return measured;
}

// Feature card for immersive display
function FeatureCard({ icon: Icon, title, description, color, index, isActive }) {
  return (
    <div style={{
      position: 'relative',
      padding: '20px',
      borderRadius: 16,
      background: isActive 
        ? `linear-gradient(135deg, ${color}15, ${color}05)`
        : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isActive ? `${color}40` : 'rgba(255,255,255,0.05)'}`,
      transition: 'all 0.4s cubic-bezier(0.34, 1.3, 0.64, 1)',
      transform: isActive ? 'scale(1.02)' : 'scale(1)',
      boxShadow: isActive ? `0 8px 32px ${color}20, inset 0 1px 0 ${color}30` : 'none',
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 1,
        background: `linear-gradient(90deg, transparent, ${color}50, transparent)`,
        opacity: isActive ? 1 : 0,
        transition: 'opacity 0.3s',
      }} />
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `linear-gradient(135deg, ${color}20, ${color}05)`,
          border: `1px solid ${color}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={24} style={{ color }} />
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{
            margin: '0 0 6px',
            fontSize: 15,
            fontWeight: 700,
            color: '#f1f5f9',
          }}>{title}</h4>
          <p style={{
            margin: 0,
            fontSize: 12,
            color: '#94a3b8',
            lineHeight: 1.5,
          }}>{description}</p>
        </div>
      </div>
    </div>
  );
}

// Immersive center panel for welcome screen
function ImmersiveCenterPanel({ step, meta, total, contentStep, contentTotal, onNext, onPrev, onDismiss, show }) {
  const { t } = useTranslation();
  const isWelcome = meta.id === 'welcome';
  const isLast = step === STEPS.length - 1;
  
  // Show features grid on welcome step
  if (isWelcome) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999997,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        pointerEvents: show ? 'auto' : 'none',
        opacity: show ? 1 : 0,
        transition: 'opacity 0.5s ease',
      }}>
        <FloatingParticles color={meta.color} count={30} />
        
        <div style={{
          maxWidth: 880,
          width: '100%',
          textAlign: 'center',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          {/* Hero */}
          <div style={{
            marginBottom: 40,
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 999,
              background: `${meta.color}15`,
              border: `1px solid ${meta.color}30`,
              marginBottom: 24,
            }}>
              <Sparkles size={14} style={{ color: meta.color }} />
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: meta.color,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}>Welcome Tour</span>
            </div>
            
            <h1 style={{
              margin: '0 0 16px',
              fontSize: 42,
              fontWeight: 800,
              background: `linear-gradient(135deg, #fff, ${meta.accentColor})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.1,
            }}>
              {t(`ssh.onboarding.steps.${meta.id}.title`)}
            </h1>
            
            <p style={{
              margin: '0 auto',
              maxWidth: 520,
              fontSize: 16,
              color: '#94a3b8',
              lineHeight: 1.6,
            }}>
              <TypedText 
                text={t(`ssh.onboarding.steps.${meta.id}.description`)} 
                speed={15}
                delay={300}
              />
            </p>
          </div>
          
          {/* Feature Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginBottom: 40,
          }}>
            {[
              { icon: Server, title: 'Server Management', desc: 'Connect to unlimited servers with one click' },
              { icon: Terminal, title: 'Full Terminal', desc: 'xterm.js powered with multi-session support' },
              { icon: FolderOpen, title: 'File Browser', desc: 'Visual SFTP with drag & drop uploads' },
              { icon: Shield, title: 'Secure Vault', desc: 'End-to-end encrypted credential storage' },
            ].map((feature, i) => (
              <div
                key={i}
                style={{
                  padding: 20,
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  textAlign: 'left',
                  opacity: show ? 1 : 0,
                  transform: show ? 'translateY(0)' : 'translateY(20px)',
                  transition: `all 0.5s ease ${i * 0.1}s`,
                }}
              >
                <feature.icon size={24} style={{ color: meta.color, marginBottom: 12 }} />
                <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{feature.title}</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{feature.desc}</p>
              </div>
            ))}
          </div>
          
          {/* Actions */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}>
            <button onClick={onDismiss} style={{
              padding: '12px 24px',
              borderRadius: 12,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#64748b',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#94a3b8'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#64748b'; }}
            >
              Skip Tour
            </button>
            
            <button onClick={onNext} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 28px',
              borderRadius: 14,
              background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
              border: 'none',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: `0 8px 32px ${meta.color}40`,
              transition: 'all 0.2s',
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
        position: 'fixed',
        inset: 0,
        zIndex: 999997,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        pointerEvents: show ? 'auto' : 'none',
        opacity: show ? 1 : 0,
        transition: 'opacity 0.5s ease',
      }}>
        <FloatingParticles color={meta.color} count={40} />
        
        <div style={{
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          <div style={{
            width: 100,
            height: 100,
            margin: '0 auto 24px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${meta.color}30, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'ob-pulse-glow 2s ease-in-out infinite',
          }}>
            <div style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 8px 40px ${meta.color}60`,
            }}>
              <CircleCheckBig size={36} style={{ color: '#fff' }} />
            </div>
          </div>
          
          <h1 style={{
            margin: '0 0 12px',
            fontSize: 32,
            fontWeight: 800,
            color: '#f1f5f9',
          }}>
            {t(`ssh.onboarding.steps.${meta.id}.title`)}
          </h1>
          
          <p style={{
            margin: '0 0 32px',
            fontSize: 15,
            color: '#94a3b8',
            lineHeight: 1.6,
          }}>
            {t(`ssh.onboarding.steps.${meta.id}.description`)}
          </p>
          
          <button onClick={onNext} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '16px 32px',
            borderRadius: 14,
            background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
            border: 'none',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: `0 8px 32px ${meta.color}40`,
            transition: 'all 0.2s',
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
            <div style={{
              position: 'relative',
              width: 64,
              height: 64,
              flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 18,
                background: `linear-gradient(135deg, ${meta.color}20, ${meta.color}05)`,
                border: `1px solid ${meta.color}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <meta.icon size={28} style={{ color: meta.color }} />
              </div>
              <div style={{
                position: 'absolute',
                top: -4,
                right: -4,
              }}>
                <ProgressRing 
                  progress={(contentStep / contentTotal) * 100} 
                  color={meta.color}
                  size={32}
                  strokeWidth={2}
                />
                <span style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#f1f5f9',
                }}>{contentStep}</span>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: `${meta.color}15`,
                  border: `1px solid ${meta.color}30`,
                  color: meta.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  {t('ssh.onboarding.stepOf', { step: contentStep, total: contentTotal })}
                </span>
              </div>
              
              <h3 style={{
                margin: '0 0 8px',
                fontSize: 20,
                fontWeight: 800,
                color: '#f1f5f9',
                lineHeight: 1.2,
              }}>
                {t(`ssh.onboarding.steps.${meta.id}.title`)}
              </h3>
              
              <p style={{
                margin: 0,
                fontSize: 14,
                color: '#94a3b8',
                lineHeight: 1.6,
              }}>
                <TypedText text={t(`ssh.onboarding.steps.${meta.id}.description`)} speed={10} delay={100} />
              </p>

              {meta.hasTip && (
                <div style={{
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 12,
                  background: `${meta.color}08`,
                  border: `1px solid ${meta.color}20`,
                }}>
                  <ArrowRight size={14} style={{ color: meta.color, flexShrink: 0, marginTop: 2, transform: 'rotate(45deg)' }} />
                  <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                    {t(`ssh.onboarding.steps.${meta.id}.tip`)}
                  </span>
                </div>
              )}
            </div>

            <button onClick={onDismiss} style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#f1f5f9'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#64748b'; }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            {/* Step dots */}
            <div style={{ display: 'flex', gap: 6 }}>
              {STEPS.slice(1, -1).map((s, i) => (
                <div
                  key={i}
                  style={{
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
                  }}
                />
              ))}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {step > 1 && (
                <button onClick={onPrev} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#64748b',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                >
                  <ChevronLeft size={14} />
                  Back
                </button>
              )}
              
              <button onClick={onDismiss} style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'color 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; }}
              >
                Skip
              </button>

              <button onClick={onNext} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '12px 24px',
                borderRadius: 12,
                background: `linear-gradient(135deg, ${meta.color}, ${meta.accentColor})`,
                border: 'none',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: `0 4px 20px ${meta.color}40`,
                transition: 'all 0.2s',
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

// Main component
export default function SSHOnboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [panelShow, setPanelShow] = useState(false);

  const meta = STEPS[step];
  const rect = useSpotlightRect(meta.spotlight);
  const total = STEPS.length;
  const contentTotal = total - 2; // exclude welcome and done
  const contentStep = step;       // step 1 = content step 1, step 2 = content step 2, etc.

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

  // Portal to document.body: guarantees true full-screen coverage and correct
  // spotlight coordinates regardless of transformed ancestors inside the app
  // window (framer-motion scale + backdrop-filter create containing blocks).
  return createPortal(
    <>
      {/* Global styles */}
      <style>{`
        @keyframes ob-float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.4; }
          50% { transform: translateY(-20px) translateX(10px); opacity: 0.8; }
        }
        @keyframes ob-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes ob-ring-pulse {
          0%, 100% { box-shadow: 0 0 20px ${meta.color}60, inset 0 0 20px ${meta.color}20; }
          50% { box-shadow: 0 0 40px ${meta.color}80, inset 0 0 30px ${meta.color}30; }
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
      <SpotlightOverlay rect={rect} color={meta.color} show={showOverlay && !meta.isDone && meta.id !== 'welcome'} />

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
      />
    </>,
      document.body
  );
}

// Utilities
export function hasCompletedSSHOnboarding() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetSSHOnboarding() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
