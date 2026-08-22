'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, ChevronRight, ChevronLeft, Sparkles,
  Shield, Server, Workflow, Layers, Radar,
  CheckCircle2, Zap
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
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'autoSync',
    icon: Workflow,
    color: '#6366f1',
    accentColor: '#818cf8',
    spotlight: 'firewall-tab-autosync',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'manualImport',
    icon: Layers,
    color: '#a855f7',
    accentColor: '#c084fc',
    spotlight: 'firewall-tab-manual',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'telemetry',
    icon: Radar,
    color: '#f59e0b',
    accentColor: '#fbbf24',
    spotlight: 'firewall-tab-telemetry',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'docker',
    icon: Zap,
    color: '#06b6d4',
    accentColor: '#22d3ee',
    spotlight: 'firewall-docker-badge',
    side: 'bottom',
    hasTip: true,
    isDone: false,
  },
  {
    id: 'done',
    icon: CheckCircle2,
    color: '#10b981',
    accentColor: '#34d399',
    spotlight: null,
    side: null,
    hasTip: false,
    isDone: true,
  },
];

// Floating particles component
function FloatingParticles({ color, count = 24 }) {
  const [particles] = useState(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 20 + 10,
    delay: Math.random() * 5,
  })));

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

// Spotlight hook measuring element bounds
function useSpotlightRect(target) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!target) { setRect(null); return; }
    const measure = () => {
      const el = document.querySelector(`[data-onboarding="${target}"]`) || document.getElementById(target);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    };
    const raf = requestAnimationFrame(() => {
      setTimeout(measure, 60);
    });
    const id = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [target]);
  return rect;
}

// Welcome / Done center panel
function ImmersiveCenterPanel({ step, meta, total, onNext, onPrev, onDismiss, show }) {
  const { t } = useTranslation();
  const isWelcome = meta.id === 'welcome';

  if (isWelcome) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 210,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        pointerEvents: show ? 'auto' : 'none',
        opacity: show ? 1 : 0,
        transition: 'opacity 0.5s ease',
      }}>
        <FloatingParticles color={meta.color} count={28} />

        <div style={{
          maxWidth: 860,
          width: '100%',
          textAlign: 'center',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}>
          {/* Hero Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              borderRadius: 999,
              background: `${meta.color}15`,
              border: `1px solid ${meta.color}30`,
              marginBottom: 20,
            }}>
              <Sparkles size={14} style={{ color: meta.color }} />
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: meta.color,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}>Firewall Protection Quick Tour</span>
            </div>

            <h1 style={{
              margin: '0 0 14px',
              fontSize: 38,
              fontWeight: 800,
              background: `linear-gradient(135deg, #fff, ${meta.accentColor})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.15,
            }}>
              {t(`firewall.onboarding.steps.${meta.id}.title`)}
            </h1>

            <p style={{
              margin: '0 auto',
              maxWidth: 640,
              fontSize: 15,
              color: 'rgba(255,255,255,0.7)',
              lineHeight: 1.6,
            }}>
              {t(`firewall.onboarding.steps.${meta.id}.description`)}
            </p>
          </div>

          {/* Quick Feature Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 36,
            textAlign: 'left',
          }}>
            {[
              { icon: Workflow, title: 'Automated Sync', desc: 'Custom cron intervals for automatic threat intelligence feeds.', color: '#6366f1' },
              { icon: Zap, title: 'Docker & Swarm Protection', desc: 'DOCKER-USER and FORWARD chain shielding with auto-recovery.', color: '#06b6d4' },
              { icon: Radar, title: 'Live Threat Telemetry', desc: 'Real-time packet drop rate charts and payload hex dumps.', color: '#f59e0b' },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} style={{
                  padding: 16,
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(12px)',
                }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: `${f.color}18`,
                    border: `1px solid ${f.color}35`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 10,
                  }}>
                    <Icon size={18} style={{ color: f.color }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                    {f.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                    {f.desc}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '12px 24px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.6)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {t('firewall.onboarding.skip')}
            </button>

            <button
              type="button"
              onClick={onNext}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 32px',
                borderRadius: 12,
                background: meta.color,
                color: '#000',
                fontSize: 14,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                boxShadow: `0 0 24px ${meta.color}40`,
                transition: 'all 0.2s',
              }}
            >
              {t('firewall.onboarding.getStarted')}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Done Step
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 210,
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
        maxWidth: 580,
        width: '100%',
        textAlign: 'center',
        padding: 36,
        borderRadius: 24,
        background: 'rgba(12, 17, 26, 0.95)',
        border: `1px solid ${meta.color}35`,
        boxShadow: `0 24px 64px rgba(0,0,0,0.8), 0 0 32px ${meta.color}20`,
        backdropFilter: 'blur(20px)',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          background: `${meta.color}15`,
          border: `1px solid ${meta.color}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <CheckCircle2 size={32} style={{ color: meta.color }} />
        </div>

        <h2 style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#fff',
          margin: '0 0 12px',
        }}>
          {t(`firewall.onboarding.steps.${meta.id}.title`)}
        </h2>

        <p style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.7)',
          lineHeight: 1.6,
          margin: '0 0 28px',
        }}>
          {t(`firewall.onboarding.steps.${meta.id}.description`)}
        </p>

        <button
          type="button"
          onClick={onDismiss}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 32px',
            borderRadius: 12,
            background: meta.color,
            color: '#000',
            fontSize: 14,
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            boxShadow: `0 0 20px ${meta.color}40`,
          }}
        >
          {t('firewall.onboarding.complete')}
          <CheckCircle2 size={16} />
        </button>
      </div>
    </div>
  );
}

// Interactive Spotlight Tooltip for steps 1 to 5
function SpotlightTooltip({ step, meta, total, onNext, onPrev, onDismiss, rect }) {
  const { t } = useTranslation();
  const Icon = meta.icon;
  const progress = Math.round(((step + 1) / total) * 100);

  // Position tooltip relative to spotlight element or fallback to center-bottom
  const style = rect ? {
    position: 'fixed',
    top: Math.min(window.innerHeight - 300, Math.max(80, rect.top + rect.height + 16)),
    left: Math.min(window.innerWidth - 440, Math.max(20, rect.left + rect.width / 2 - 200)),
    width: 400,
    zIndex: 220,
  } : {
    position: 'fixed',
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 420,
    zIndex: 220,
  };

  return (
    <div style={{
      ...style,
      padding: 22,
      borderRadius: 20,
      background: 'rgba(12, 17, 26, 0.96)',
      border: `1px solid ${meta.color}40`,
      boxShadow: `0 20px 50px rgba(0,0,0,0.85), 0 0 25px ${meta.color}25`,
      backdropFilter: 'blur(20px)',
      animation: 'ob-fade-in 0.3s cubic-bezier(0.34, 1.3, 0.64, 1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: `${meta.color}20`,
            border: `1px solid ${meta.color}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={16} style={{ color: meta.color }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('firewall.onboarding.stepOf', { step: step + 1, total })}
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>
              {t(`firewall.onboarding.steps.${meta.id}.title`)}
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Description */}
      <p style={{
        fontSize: 12.5,
        color: 'rgba(255,255,255,0.8)',
        lineHeight: 1.55,
        margin: '0 0 14px',
      }}>
        {t(`firewall.onboarding.steps.${meta.id}.description`)}
      </p>

      {/* Tip */}
      {meta.hasTip && (
        <div style={{
          padding: '8px 12px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          fontSize: 11,
          color: 'rgba(255,255,255,0.7)',
          lineHeight: 1.45,
          marginBottom: 16,
        }}>
          {t(`firewall.onboarding.steps.${meta.id}.tip`)}
        </div>
      )}

      {/* Navigation Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProgressRing progress={progress} color={meta.color} size={32} strokeWidth={3} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
            {progress}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {step > 0 && (
            <button
              type="button"
              onClick={onPrev}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ChevronLeft size={12} />
              {t('firewall.onboarding.back')}
            </button>
          )}

          <button
            type="button"
            onClick={onNext}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              background: meta.color,
              color: '#000',
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: `0 0 12px ${meta.color}40`,
            }}
          >
            {t('firewall.onboarding.next')}
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Export helper to query completion status
export function hasCompletedFirewallOnboarding() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetFirewallOnboarding() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Main FirewallOnboarding Component
export default function FirewallOnboarding({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const meta = STEPS[currentStep] || STEPS[0];
  const rect = useSpotlightRect(meta.spotlight);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      localStorage.setItem(STORAGE_KEY, 'true');
      onComplete?.();
    }
  }, [currentStep, onComplete]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete?.();
  }, [onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, handleDismiss]);

  const isCenterStep = meta.id === 'welcome' || meta.id === 'done';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      pointerEvents: 'auto',
    }}>
      {/* Backdrop overlay */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4, 7, 13, 0.78)',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.3s ease',
      }} />

      {/* Spotlight cutout */}
      {!isCenterStep && rect && (
        <div style={{
          position: 'fixed',
          top: Math.max(0, rect.top - 6),
          left: Math.max(0, rect.left - 6),
          width: rect.width + 12,
          height: rect.height + 12,
          borderRadius: 14,
          border: `2px solid ${meta.color}`,
          boxShadow: `0 0 0 9999px rgba(4, 7, 13, 0.78), 0 0 25px ${meta.color}60`,
          pointerEvents: 'none',
          zIndex: 205,
          transition: 'all 0.35s cubic-bezier(0.34, 1.3, 0.64, 1)',
        }} />
      )}

      {/* Center Welcome / Done */}
      {isCenterStep ? (
        <ImmersiveCenterPanel
          step={currentStep}
          meta={meta}
          total={STEPS.length}
          onNext={handleNext}
          onPrev={handlePrev}
          onDismiss={handleDismiss}
          show={true}
        />
      ) : (
        <SpotlightTooltip
          step={currentStep}
          meta={meta}
          total={STEPS.length}
          onNext={handleNext}
          onPrev={handlePrev}
          onDismiss={handleDismiss}
          rect={rect}
        />
      )}
    </div>
  );
}
