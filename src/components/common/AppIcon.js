import React from 'react';
import {
  Terminal, Settings, Monitor, Database, Folder, MonitorPlay, Server, FileText,
  Globe, StickyNote, Book, BookOpen, Shield, Radio, Radiation, Cpu, HardDrive,
  Wrench, Archive, CloudSync, Rocket, CloudCog, ShieldCheck, BrickWallShield,
  Activity, ScrollText,
} from 'lucide-react';

// ── Canonical id resolution ──────────────────────────────────────────────────
// Full window/app ids are mapped to unique canonical keys so every app gets
// its own design (previously "docker-logs" collapsed into "docker" and
// "server-monitor"/"server-backup" shared one icon).
const ID_MAP = {
  'firewall-blocklist': 'firewall',
  'server-monitor': 'monitor',
  'server-backup': 'backup',
  'database-browser': 'database',
  'database': 'database',
  'mongo-backup': 'mongo',
  'rclone-backup': 'rclone',
  'docker-app': 'docker',
  'docker-logs': 'logs',
  'files-app': 'files',
  'ssh-manager': 'ssh',
  'auto-deploy': 'auto',
};

// ── Per-app design tokens (default dark/light themes) ───────────────────────
// Every app gets a unique gradient, accent and micro-detail — no two icons
// share the same combination.
const DARK_TOKENS = {
  terminal:  { from: '#059669', to: '#022c22', accent: '#34d399' },
  ssh:       { from: '#4f46e5', to: '#1e1b4b', accent: '#a5b4fc' },
  docker:    { from: '#0284c7', to: '#082f49', accent: '#38bdf8' },
  logs:      { from: '#be123c', to: '#4c0519', accent: '#fb7185' },
  files:     { from: '#d97706', to: '#451a03', accent: '#fcd34d' },
  tmux:      { from: '#0d9488', to: '#042f2e', accent: '#5eead4' },
  settings:  { from: '#475569', to: '#1e293b', accent: '#cbd5e1' },
  wiki:      { from: '#2563eb', to: '#172554', accent: '#60a5fa' },
  notepad:   { from: '#ea580c', to: '#431407', accent: '#fdba74' },
  database:  { from: '#7c3aed', to: '#2e1065', accent: '#c4b5fd' },
  mongo:     { from: '#10b981', to: '#064e3b', accent: '#6ee7b7' },
  rclone:    { from: '#0891b2', to: '#164e63', accent: '#67e8f9' },
  monitor:   { from: '#a21caf', to: '#4a044e', accent: '#f0abfc' },
  backup:    { from: '#334155', to: '#0f172e', accent: '#7dd3fc' },
  firewall:  { from: '#065f46', to: '#022c22', accent: '#f87171' },
  auto:      { from: '#dc2626', to: '#450a0a', accent: '#fca5a5' },
};

const LIGHT_TOKENS = {
  terminal:  { from: '#d1fae5', to: '#a7f3d0', accent: '#065f46', glyph: '#065f46' },
  ssh:       { from: '#e0e7ff', to: '#c7d2fe', accent: '#3730a3', glyph: '#3730a3' },
  docker:    { from: '#e0f2fe', to: '#bae6fd', accent: '#075985', glyph: '#075985' },
  logs:      { from: '#ffe4e6', to: '#fecdd3', accent: '#9f1239', glyph: '#9f1239' },
  files:     { from: '#fef3c7', to: '#fde68a', accent: '#92400e', glyph: '#92400e' },
  tmux:      { from: '#ccfbf1', to: '#99f6e4', accent: '#115e59', glyph: '#115e59' },
  settings:  { from: '#f1f5f9', to: '#e2e8f0', accent: '#334155', glyph: '#334155' },
  wiki:      { from: '#dbeafe', to: '#bfdbfe', accent: '#1e40af', glyph: '#1e40af' },
  notepad:   { from: '#ffedd5', to: '#fed7aa', accent: '#9a3412', glyph: '#9a3412' },
  database:  { from: '#ede9fe', to: '#ddd6fe', accent: '#5b21b6', glyph: '#5b21b6' },
  mongo:     { from: '#ecfdf5', to: '#d1fae5', accent: '#047857', glyph: '#047857' },
  rclone:    { from: '#cffafe', to: '#a5f3fc', accent: '#155e75', glyph: '#155e75' },
  monitor:   { from: '#fae8ff', to: '#f5d0fe', accent: '#86198f', glyph: '#86198f' },
  backup:    { from: '#f1f5f9', to: '#e2e8f0', accent: '#0ea5e9', glyph: '#1e3a5f' },
  firewall:  { from: '#dcfce7', to: '#bbf7d0', accent: '#dc2626', glyph: '#166534' },
  auto:      { from: '#fee2e2', to: '#fecaca', accent: '#991b1b', glyph: '#991b1b' },
};

const AppIcon = ({ id, size = 32, className = "", theme = "dark", iconStyle = "glass", isDesktop = false }) => {
  const iconId = ID_MAP[id] || id?.split('-')[0] || id;

  const isRetro = theme === 'retro' || theme === 'fallout';
  const isFallout = theme === 'fallout';
  const isCyberpunk = theme === 'cyberpunk';
  const isSynthwave = theme === 'synthwave';
  const isLight = theme === 'light';

  const baseContainer = `relative w-full h-full flex items-center justify-center transition-all duration-300 overflow-hidden ${className}`;

  // ── Per-app micro-detail for the default themes ───────────────────────────
  // Small, percentage-positioned marks that make each icon instantly
  // recognizable even at 16px taskbar size.
  const defaultDetail = (accent) => {
    switch (iconId) {
      case 'terminal':
        return <div className="absolute bottom-[16%] right-[16%] w-[8%] h-[20%] rounded-[1px] animate-pulse pointer-events-none" style={{ backgroundColor: accent, boxShadow: `0 0 4px ${accent}80` }} />;
      case 'ssh':
        return (
          <div className="absolute inset-0 pointer-events-none">
            {[55, 78].map((d, i) => (
              <div key={i} className="absolute rounded-full border" style={{ width: `${d}%`, height: `${d}%`, top: '11%', left: '11%', borderColor: `${accent}${i === 0 ? '35' : '18'}` }} />
            ))}
          </div>
        );
      case 'docker':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute bottom-[16%] left-[18%] w-[16%] h-[2px] rounded-full" style={{ backgroundColor: `${accent}30` }} />
            <div className="absolute bottom-[16%] right-[18%] w-[16%] h-[2px] rounded-full" style={{ backgroundColor: `${accent}30` }} />
          </div>
        );
      case 'logs':
        return (
          <div className="absolute bottom-[18%] left-1/2 -translate-x-1/2 flex gap-[6%] pointer-events-none">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-[6%] aspect-square rounded-full animate-pulse" style={{ backgroundColor: accent, opacity: 0.35 + i * 0.25, animationDelay: `${i * 0.25}s` }} />
            ))}
          </div>
        );
      case 'files':
        return <div className="absolute top-0 left-[18%] w-[26%] h-[14%] rounded-b-[3px] pointer-events-none" style={{ backgroundColor: `${accent}45` }} />;
      case 'tmux':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[22%] left-1/2 w-[1px] h-[56%]" style={{ backgroundColor: `${accent}30` }} />
            <div className="absolute top-1/2 left-[22%] w-[56%] h-[1px]" style={{ backgroundColor: `${accent}22` }} />
          </div>
        );
      case 'settings':
        return (
          <div className="absolute inset-0 pointer-events-none animate-[spin_9s_linear_infinite]">
            {[0, 120, 240].map(deg => (
              <div key={deg} className="absolute w-[7%] aspect-square rounded-full" style={{ backgroundColor: `${accent}50`, top: '50%', left: '50%', transform: `rotate(${deg}deg) translateY(-38%) translate(-50%, -50%)` }} />
            ))}
          </div>
        );
      case 'wiki':
        return <div className="absolute top-0 right-[22%] w-[9%] h-[26%] pointer-events-none" style={{ backgroundColor: `${accent}50`, borderRadius: '0 0 2px 2px' }} />;
      case 'notepad':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute bottom-[24%] left-[24%] w-[38%] h-[2px] rounded-full" style={{ backgroundColor: `${accent}45` }} />
            <div className="absolute bottom-[15%] left-[24%] w-[24%] h-[2px] rounded-full" style={{ backgroundColor: `${accent}30` }} />
          </div>
        );
      case 'database':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[20%] left-[24%] w-[52%] h-[1.5px]" style={{ backgroundColor: `${accent}40` }} />
            <div className="absolute bottom-[20%] left-[24%] w-[52%] h-[1.5px]" style={{ backgroundColor: `${accent}25` }} />
          </div>
        );
      case 'mongo':
        return (
          <div className="absolute inset-0 pointer-events-none animate-[spin_5s_linear_infinite]">
            <div className="absolute w-[9%] aspect-square rounded-full top-[8%] left-1/2 -translate-x-1/2" style={{ backgroundColor: accent, boxShadow: `0 0 5px ${accent}90` }} />
          </div>
        );
      case 'rclone':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[14%] right-[14%] w-[14%] h-[2px]" style={{ backgroundColor: `${accent}70` }} />
            <div className="absolute top-[14%] right-[14%] w-[2px] h-[14%]" style={{ backgroundColor: `${accent}70` }} />
            <div className="absolute bottom-[14%] left-[14%] w-[14%] h-[2px]" style={{ backgroundColor: `${accent}40` }} />
            <div className="absolute bottom-[14%] left-[14%] w-[2px] h-[14%]" style={{ backgroundColor: `${accent}40` }} />
          </div>
        );
      case 'monitor':
        return (
          <div className="absolute bottom-[12%] left-[14%] right-[14%] pointer-events-none" style={{ height: '26%' }}>
            <svg width="100%" height="100%" viewBox="0 0 40 12" fill="none" stroke={accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.55">
              <polyline points="1,7 7,7 10,2 14,11 17,5 20,7 39,7" />
            </svg>
          </div>
        );
      case 'backup':
        return (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <svg width="72%" height="72%" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="17" stroke={`${accent}35`} strokeWidth="1.6" strokeDasharray="6 4" />
            </svg>
          </div>
        );
      case 'firewall':
        return (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[24%] left-[16%] w-[68%] h-[1.5px]" style={{ backgroundColor: `${accent}55` }} />
            <div className="absolute bottom-[26%] left-[28%] w-[44%] h-[1.5px]" style={{ backgroundColor: `${accent}35` }} />
          </div>
        );
      case 'auto':
        return (
          <div className="absolute inset-x-0 bottom-[10%] flex flex-col items-center gap-[4%] pointer-events-none">
            {[0, 1].map(i => (
              <svg key={i} width="26%" viewBox="0 0 12 6" style={{ opacity: 0.5 - i * 0.2 }}>
                <polyline points="1,5 6,1 11,5" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const wrapIcon = (content, bgColor, textColor) => {
    let styles = { background: bgColor, color: textColor };

    if (iconStyle === 'minimal') {
        styles.background = 'transparent';
        styles.boxShadow = 'none';
        styles.border = 'none';
    } else if (iconStyle === 'outline') {
        styles.background = 'transparent';
        styles.border = `2px solid ${textColor}`;
    } else if (iconStyle === 'flat') {
        styles.boxShadow = 'none';
    } else if (iconStyle === 'neumorphic') {
        styles.boxShadow = isLight ? '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff' : '4px 4px 8px #080a12, -2px -2px 6px #1e293b';
        styles.border = 'none';
    }

    // ========== FALLOUT / RETRO THEME ==========
    if (isRetro) {
        const falloutPalette = {
          terminal:  { primary: '#18e12c', glow: 'rgba(24,225,44,0.4)', accent: '#0dff2a' },
          ssh:       { primary: '#00e5ff', glow: 'rgba(0,229,255,0.35)', accent: '#40f0ff' },
          docker:    { primary: '#ff9f1c', glow: 'rgba(255,159,28,0.35)', accent: '#ffb84d' },
          files:     { primary: '#ffd166', glow: 'rgba(255,209,102,0.3)', accent: '#ffe08a' },
          tmux:      { primary: '#06d6a0', glow: 'rgba(6,214,160,0.35)', accent: '#33e0b3' },
          settings:  { primary: '#ef476f', glow: 'rgba(239,71,111,0.3)', accent: '#f2728e' },
          wiki:      { primary: '#118ab2', glow: 'rgba(17,138,178,0.3)', accent: '#1ca3d1' },
          notepad:   { primary: '#fca311', glow: 'rgba(252,163,17,0.35)', accent: '#fdb544' },
          logs:      { primary: '#e63946', glow: 'rgba(230,57,70,0.3)', accent: '#eb636e' },
          mongo:     { primary: '#10b981', glow: 'rgba(16,185,129,0.35)', accent: '#34d399' },
          rclone:    { primary: '#8b5cf6', glow: 'rgba(139,92,246,0.4)', accent: '#a78bfa' },
          monitor:   { primary: '#38bdf8', glow: 'rgba(56,189,248,0.35)', accent: '#7dd3fc' },
          backup:    { primary: '#a3e635', glow: 'rgba(163,230,53,0.3)', accent: '#bef264' },
          database:  { primary: '#f97316', glow: 'rgba(249,115,22,0.35)', accent: '#fb923c' },
          firewall:  { primary: '#22c55e', glow: 'rgba(34,197,94,0.35)', accent: '#4ade80' },
          auto:      { primary: '#ff5500', glow: 'rgba(255,85,0,0.35)', accent: '#ff7733' },
        };
        const pal = falloutPalette[iconId] || falloutPalette.terminal;

        const falloutGimmick = () => {
          switch (iconId) {
            case 'terminal':
              return <div className="absolute bottom-[7px] right-[8px] w-[3px] h-[8px] animate-pulse pointer-events-none" style={{ backgroundColor: pal.primary, boxShadow: `0 0 3px ${pal.glow}` }} />;
            case 'ssh':
              return (
                <div className="absolute top-[6px] left-[6px] pointer-events-none">
                  {[0,1,2].map(i => (
                    <div key={i} className="absolute rounded-full border animate-ping pointer-events-none" style={{ width: 5 + i * 5, height: 5 + i * 5, borderColor: `${pal.primary}${i === 0 ? '80' : i === 1 ? '40' : '20'}`, top: -(i * 2), left: -(i * 2), animationDuration: `${1.5 + i * 0.4}s`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'docker':
              return (
                <div className="absolute top-[5px] left-[6px] pointer-events-none" style={{ color: pal.primary }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2a10 10 0 0 1 8.66 5" />
                    <path d="M12 2a10 10 0 0 0-8.66 5" />
                    <path d="M20.66 17a10 10 0 0 1-17.32 0" />
                  </svg>
                </div>
              );
            case 'files':
              return <div className="absolute top-[4px] left-[5px] w-[12px] h-[12px] rounded-full border flex items-center justify-center pointer-events-none" style={{ borderColor: `${pal.primary}50`, fontSize: '6px', color: `${pal.primary}90`, fontFamily: 'monospace', fontWeight: 'bold' }}>13</div>;
            case 'tmux':
              return (
                <>
                  <div className="absolute top-[20%] left-1/2 w-[1px] h-[60%] pointer-events-none" style={{ backgroundColor: `${pal.primary}35` }} />
                  <div className="absolute top-1/2 left-[20%] w-[60%] h-[1px] pointer-events-none" style={{ backgroundColor: `${pal.primary}25` }} />
                </>
              );
            case 'settings':
              return (
                <div className="absolute inset-0 pointer-events-none animate-[spin_8s_linear_infinite]">
                  {[0,90,180,270].map(deg => (
                    <div key={deg} className="absolute w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${pal.primary}40`, top: '50%', left: '50%', transform: `rotate(${deg}deg) translateY(-${size * 0.35}px) translate(-50%, -50%)` }} />
                  ))}
                </div>
              );
            case 'wiki':
              return <div className="absolute top-0 right-[10px] w-[5px] h-[10px] pointer-events-none" style={{ backgroundColor: `${pal.primary}50`, borderRadius: '0 0 2px 2px' }} />;
            case 'notepad':
              return <div className="absolute bottom-[8px] left-[8px] w-[12px] h-[1.5px] pointer-events-none" style={{ backgroundColor: pal.primary, transform: 'rotate(-30deg)' }} />;
            case 'logs':
              // Teletype feed dots
              return (
                <div className="absolute bottom-[7px] left-1/2 -translate-x-1/2 flex gap-[3px] pointer-events-none">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-[3px] h-[3px] rounded-full animate-pulse" style={{ backgroundColor: pal.primary, opacity: 0.4 + i * 0.25, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'mongo':
              return (
                <div className="absolute inset-0 pointer-events-none animate-[spin_4s_linear_infinite]">
                  <div className="absolute w-[4px] h-[4px] rounded-full top-[15%] left-1/2 -translate-x-1/2" style={{ backgroundColor: pal.primary, boxShadow: `0 0 5px ${pal.glow}` }} />
                  <div className="absolute w-[4px] h-[4px] rounded-full bottom-[15%] left-1/2 -translate-x-1/2" style={{ backgroundColor: pal.primary, boxShadow: `0 0 5px ${pal.glow}` }} />
                </div>
              );
            case 'rclone':
              return (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-[5px] right-[5px] w-[8px] h-[1px]" style={{ backgroundColor: `${pal.primary}60` }} />
                  <div className="absolute top-[5px] right-[5px] w-[1px] h-[8px]" style={{ backgroundColor: `${pal.primary}60` }} />
                  <div className="absolute bottom-[5px] left-[5px] w-[8px] h-[1px]" style={{ backgroundColor: `${pal.primary}60` }} />
                  <div className="absolute bottom-[5px] left-[5px] w-[1px] h-[8px]" style={{ backgroundColor: `${pal.primary}60` }} />
                </div>
              );
            case 'monitor':
              // CRT heartbeat trace
              return (
                <div className="absolute bottom-[8px] left-[6px] right-[6px] pointer-events-none" style={{ height: '10px' }}>
                  <svg width="100%" height="100%" viewBox="0 0 40 12" fill="none" stroke={pal.primary} strokeWidth="1.2" opacity="0.6">
                    <polyline points="1,7 8,7 11,2 15,11 18,5 21,7 39,7" />
                  </svg>
                </div>
              );
            case 'backup':
              // Tape reel spinner
              return (
                <div className="absolute inset-0 pointer-events-none animate-[spin_6s_linear_infinite]">
                  <div className="absolute w-[5px] h-[5px] rounded-full top-[10%] right-[20%]" style={{ backgroundColor: `${pal.primary}70` }} />
                  <div className="absolute w-[5px] h-[5px] rounded-full bottom-[10%] left-[20%]" style={{ backgroundColor: `${pal.primary}40` }} />
                </div>
              );
            case 'database':
              // Punch-card stripes
              return (
                <div className="absolute inset-0 pointer-events-none flex flex-col justify-center gap-[3px] px-[26%]">
                  {[0.5, 0.35, 0.2].map((op, i) => (
                    <div key={i} className="h-[1.5px]" style={{ backgroundColor: pal.primary, opacity: op }} />
                  ))}
                </div>
              );
            case 'firewall':
              // Hazard barricade stripes
              return (
                <div className="absolute bottom-[6px] left-[5px] right-[5px] h-[5px] flex overflow-hidden rounded-[1px] pointer-events-none" style={{ border: `1px solid ${pal.primary}50` }}>
                  {[0,1,2,3,4,5].map(i => (
                    <div key={i} className="flex-1" style={{ backgroundColor: i % 2 === 0 ? `${pal.primary}35` : 'transparent' }} />
                  ))}
                </div>
              );
            case 'auto':
              return (
                <div className="bottom-[6px] left-[10px] right-[10px] h-[4px] flex justify-between pointer-events-none absolute">
                  <div className="w-[3px] h-[3px] rounded-full animate-ping" style={{ backgroundColor: '#ff2200', animationDuration: '0.8s' }} />
                  <div className="w-[3px] h-[3px] rounded-full animate-ping" style={{ backgroundColor: '#ffaa00', animationDuration: '1.2s', animationDelay: '0.2s' }} />
                  <div className="w-[3px] h-[3px] rounded-full animate-ping" style={{ backgroundColor: '#ff2200', animationDuration: '0.8s', animationDelay: '0.4s' }} />
                </div>
              );
            default:
              return null;
          }
        };

        return (
            <div
              className={`${baseContainer} rounded-lg`}
              style={{
                background: `radial-gradient(ellipse at 30% 20%, ${pal.glow}, transparent 60%), linear-gradient(170deg, #0a0e0a 0%, #0d120d 50%, #080b08 100%)`,
                border: `1.5px solid ${pal.primary}55`,
                boxShadow: `0 0 12px ${pal.glow}, inset 0 1px 0 ${pal.primary}15, inset 0 0 20px rgba(0,0,0,0.5)`,
              }}
            >
                {/* Animated scanlines */}
                <div className="absolute inset-0 opacity-[0.07] pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.5)_50%)] bg-[length:100%_3px]" />

                {/* Corner brackets - Pip-Boy style */}
                <div className="absolute top-[3px] left-[3px] w-2 h-2 border-t border-l pointer-events-none" style={{ borderColor: `${pal.primary}66` }}/>
                <div className="absolute top-[3px] right-[3px] w-2 h-2 border-t border-r pointer-events-none" style={{ borderColor: `${pal.primary}66` }}/>
                <div className="absolute bottom-[3px] left-[3px] w-2 h-2 border-b border-l pointer-events-none" style={{ borderColor: `${pal.primary}66` }}/>
                <div className="absolute bottom-[3px] right-[3px] w-2 h-2 border-b border-r pointer-events-none" style={{ borderColor: `${pal.primary}66` }}/>

                {/* Status dot - pulsing */}
                <div
                  className="absolute top-[5px] right-[5px] w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: pal.primary, boxShadow: `0 0 4px ${pal.glow}` }}
                />

                {/* Bottom label bar */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-[3px]"
                  style={{ background: `linear-gradient(90deg, transparent, ${pal.primary}40, ${pal.primary}60, ${pal.primary}40, transparent)` }}
                />

                {/* Per-app unique gimmick */}
                {falloutGimmick()}

                {/* Icon with glow */}
                <div className="relative z-10 flex items-center justify-center" style={{ filter: `drop-shadow(0 0 4px ${pal.glow})` }}>
                  {content}
                </div>
            </div>
        );
    }

    // ========== CYBERPUNK THEME ==========
    if (isCyberpunk) {
        const cpPalette = {
          terminal:  { primary: '#00ff9f', secondary: '#ff00ff', glow: 'rgba(0,255,159,0.3)' },
          ssh:       { primary: '#00d4ff', secondary: '#ff6ec7', glow: 'rgba(0,212,255,0.3)' },
          docker:    { primary: '#ff6ec7', secondary: '#00ffff', glow: 'rgba(255,110,199,0.3)' },
          files:     { primary: '#ffd700', secondary: '#ff00ff', glow: 'rgba(255,215,0,0.25)' },
          tmux:      { primary: '#7b68ee', secondary: '#00ff9f', glow: 'rgba(123,104,238,0.3)' },
          settings:  { primary: '#ff4444', secondary: '#00ffff', glow: 'rgba(255,68,68,0.3)' },
          wiki:      { primary: '#00bfff', secondary: '#ff69b4', glow: 'rgba(0,191,255,0.25)' },
          notepad:   { primary: '#ff8c00', secondary: '#da70d6', glow: 'rgba(255,140,0,0.3)' },
          logs:      { primary: '#ff1493', secondary: '#00ffff', glow: 'rgba(255,20,147,0.3)' },
          mongo:     { primary: '#00ff66', secondary: '#ffd700', glow: 'rgba(0,255,102,0.3)' },
          rclone:    { primary: '#bf5fff', secondary: '#00d4ff', glow: 'rgba(191,95,255,0.35)' },
          monitor:   { primary: '#00fef0', secondary: '#ff6ec7', glow: 'rgba(0,254,240,0.3)' },
          backup:    { primary: '#c0ff00', secondary: '#00d4ff', glow: 'rgba(192,255,0,0.3)' },
          database:  { primary: '#ff7b00', secondary: '#00ff9f', glow: 'rgba(255,123,0,0.3)' },
          firewall:  { primary: '#00ff88', secondary: '#ff004d', glow: 'rgba(0,255,136,0.35)' },
          auto:      { primary: '#ff0055', secondary: '#00ffff', glow: 'rgba(255,0,85,0.3)' },
        };
        const cp = cpPalette[iconId] || cpPalette.terminal;
        const cpClip = 'polygon(0 12%, 12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%)';

        const cpGimmick = () => {
          switch (iconId) {
            case 'terminal':
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[15,35,55,75,88].map((x, i) => (
                    <div key={i} className="absolute w-[2px] rounded-full animate-pulse" style={{ left: `${x}%`, top: `${10 + i * 12}%`, height: `${6 + i * 2}px`, backgroundColor: `${cp.primary}${30 + i * 8}`, animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              );
            case 'ssh':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="absolute w-[70%] h-[70%] rounded-full border animate-ping" style={{ borderColor: `${cp.primary}15`, animationDuration: '2s' }} />
                  <div className="absolute w-[50%] h-[50%] rounded-full border animate-ping" style={{ borderColor: `${cp.secondary}12`, animationDuration: '2.5s', animationDelay: '0.5s' }} />
                </div>
              );
            case 'docker':
              return (
                <div className="absolute inset-0 pointer-events-none opacity-[0.12]">
                  <svg width="100%" height="100%" viewBox="0 0 40 40">
                    <polygon points="20,2 34,10 34,26 20,34 6,26 6,10" fill="none" stroke={cp.primary} strokeWidth="0.5" />
                    <polygon points="20,8 28,13 28,23 20,28 12,23 12,13" fill="none" stroke={cp.secondary} strokeWidth="0.3" />
                  </svg>
                </div>
              );
            case 'files':
              return (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-[18%] left-[8%] w-[15%] h-[1px]" style={{ backgroundColor: `${cp.primary}25` }} />
                  <div className="absolute top-[18%] left-[23%] w-[1px] h-[25%]" style={{ backgroundColor: `${cp.primary}25` }} />
                  <div className="absolute bottom-[18%] right-[8%] w-[15%] h-[1px]" style={{ backgroundColor: `${cp.secondary}25` }} />
                  <div className="absolute bottom-[18%] right-[23%] w-[1px] h-[25%]" style={{ backgroundColor: `${cp.secondary}25` }} />
                  <div className="absolute top-[18%] left-[8%] w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${cp.primary}40` }} />
                  <div className="absolute bottom-[18%] right-[8%] w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${cp.secondary}40` }} />
                </div>
              );
            case 'tmux':
              return (
                <>
                  <div className="absolute top-[15%] left-1/2 w-[1px] h-[70%] pointer-events-none" style={{ background: `linear-gradient(180deg, transparent, ${cp.primary}30, ${cp.secondary}30, transparent)` }} />
                  <div className="absolute top-[45%] left-[15%] w-[70%] h-[1px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, ${cp.secondary}25, ${cp.primary}25, transparent)` }} />
                </>
              );
            case 'settings':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_6s_linear_infinite]">
                  <svg width="80%" height="80%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke={cp.primary} strokeWidth="0.7" strokeDasharray="6 20" opacity="0.3" />
                    <circle cx="20" cy="20" r="13" fill="none" stroke={cp.secondary} strokeWidth="0.5" strokeDasharray="4 22" opacity="0.2" />
                  </svg>
                </div>
              );
            case 'wiki':
              return <div className="absolute top-0 right-[25%] w-[4px] h-[30%] pointer-events-none" style={{ background: `linear-gradient(180deg, ${cp.primary}50, ${cp.secondary}20, transparent)`, borderRadius: '0 0 2px 2px' }} />;
            case 'notepad':
              return (
                <div className="absolute pointer-events-none animate-pulse" style={{ top: '30%', left: '10%', width: '25%', height: '2px', backgroundColor: `${cp.secondary}25`, animationDuration: '3s' }} />
              );
            case 'logs':
              // Glitch data streaks
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[30, 55, 75].map((y, i) => (
                    <div key={i} className="absolute h-[1.5px] animate-pulse" style={{ top: `${y}%`, left: '12%', width: `${28 + i * 10}%`, background: `linear-gradient(90deg, transparent, ${i % 2 ? cp.secondary : cp.primary}55)`, animationDelay: `${i * 0.25}s` }} />
                  ))}
                </div>
              );
            case 'mongo':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_10s_linear_infinite]">
                  <svg width="70%" height="70%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="14" fill="none" stroke={cp.primary} strokeWidth="1" strokeDasharray="8 8" opacity="0.4" />
                  </svg>
                </div>
              );
            case 'rclone':
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[20, 45, 70].map((x, i) => (
                    <div key={i} className="absolute w-[1px] animate-pulse" style={{ left: `${x}%`, top: '15%', height: '25%', background: `linear-gradient(180deg, transparent, ${cp.primary}40)`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'monitor':
              // EKG neon trace
              return (
                <div className="absolute bottom-[10%] left-[10%] right-[10%] pointer-events-none" style={{ height: '30%' }}>
                  <svg width="100%" height="100%" viewBox="0 0 40 12" fill="none" stroke={cp.primary} strokeWidth="1.3" strokeLinecap="round" opacity="0.7">
                    <polyline points="1,7 8,7 11,1 15,11 18,5 21,7 39,7" />
                  </svg>
                </div>
              );
            case 'backup':
              // Rotating data-ring segments
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_7s_linear_infinite]">
                  <svg width="75%" height="75%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke={cp.primary} strokeWidth="1" strokeDasharray="10 6" opacity="0.35" />
                    <circle cx="20" cy="20" r="12" fill="none" stroke={cp.secondary} strokeWidth="0.7" strokeDasharray="4 10" opacity="0.25" />
                  </svg>
                </div>
              );
            case 'database':
              // Neon stack tiers
              return (
                <div className="absolute inset-0 pointer-events-none flex flex-col justify-center gap-[8%] px-[24%]">
                  {[0.55, 0.35, 0.2].map((op, i) => (
                    <div key={i} className="h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${i % 2 ? cp.secondary : cp.primary}, transparent)`, opacity: op }} />
                  ))}
                </div>
              );
            case 'firewall':
              // Neon laser grid
              return (
                <div className="absolute inset-0 pointer-events-none opacity-[0.25]">
                  {[25, 50, 75].map(y => (
                    <div key={y} className="absolute h-[1px]" style={{ top: `${y}%`, left: '12%', right: '12%', background: `linear-gradient(90deg, transparent, ${cp.primary}60, transparent)` }} />
                  ))}
                </div>
              );
            case 'auto':
              return (
                <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 flex flex-col gap-[2px] pointer-events-none">
                  <div className="w-[8px] h-[2px] rounded-full animate-bounce" style={{ backgroundColor: cp.primary, animationDuration: '0.8s' }} />
                  <div className="w-[8px] h-[2px] rounded-full animate-bounce" style={{ backgroundColor: cp.secondary, animationDuration: '0.8s', animationDelay: '0.2s' }} />
                  <div className="w-[8px] h-[2px] rounded-full animate-bounce" style={{ backgroundColor: cp.primary, animationDuration: '0.8s', animationDelay: '0.4s' }} />
                </div>
              );
            default:
              return null;
          }
        };

        return (
            <div
              className={`${baseContainer}`}
              style={{
                clipPath: cpClip,
                background: `linear-gradient(135deg, #0a0a0f 0%, #12121a 40%, #0d0d15 100%)`,
                boxShadow: `0 0 15px ${cp.glow}, inset 0 0 30px rgba(0,0,0,0.6)`,
              }}
            >
                {/* Neon border effect */}
                <div className="absolute inset-0 pointer-events-none" style={{ clipPath: cpClip, border: `1.5px solid ${cp.primary}55` }} />

                {/* Top-right accent bar */}
                <div className="absolute top-0 right-0 h-[2px] animate-pulse" style={{ width: '40%', background: `linear-gradient(90deg, transparent, ${cp.primary})` }} />

                {/* Bottom-left accent bar */}
                <div className="absolute bottom-0 left-0 h-[2px] animate-pulse" style={{ width: '35%', background: `linear-gradient(90deg, ${cp.secondary}, transparent)`, animationDelay: '0.5s' }} />

                {/* Left vertical neon strip */}
                <div className="absolute top-[15%] left-0 w-[2px]" style={{ height: '30%', background: `linear-gradient(180deg, ${cp.secondary}80, transparent)` }} />

                {/* Right vertical neon strip */}
                <div className="absolute bottom-[15%] right-0 w-[2px]" style={{ height: '30%', background: `linear-gradient(0deg, ${cp.primary}80, transparent)` }} />

                {/* Data stream scanlines */}
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(255,255,255,0.15)_50%)] bg-[length:100%_4px]" />

                {/* Holographic shimmer overlay */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{ background: `linear-gradient(135deg, ${cp.primary}20 0%, transparent 40%, ${cp.secondary}15 60%, transparent 100%)` }} />

                {/* Per-app unique gimmick */}
                {cpGimmick()}

                {/* Icon with neon glow */}
                <div className="relative z-10 flex items-center justify-center" style={{ filter: `drop-shadow(0 0 5px ${cp.glow}) drop-shadow(0 0 2px ${cp.primary}40)` }}>
                  {content}
                </div>
            </div>
        );
    }

    // ========== SYNTHWAVE THEME ==========
    if (isSynthwave) {
        const swPalette = {
          terminal:  { primary: '#ff2d96', secondary: '#0affcd', glow: 'rgba(255,45,150,0.35)' },
          ssh:       { primary: '#bf5fff', secondary: '#ff2d96', glow: 'rgba(191,95,255,0.3)' },
          docker:    { primary: '#0affcd', secondary: '#ffb800', glow: 'rgba(10,255,205,0.3)' },
          files:     { primary: '#ffb800', secondary: '#ff2d96', glow: 'rgba(255,184,0,0.3)' },
          tmux:      { primary: '#ff2d96', secondary: '#bf5fff', glow: 'rgba(255,45,150,0.3)' },
          settings:  { primary: '#bf5fff', secondary: '#0affcd', glow: 'rgba(191,95,255,0.3)' },
          wiki:      { primary: '#0affcd', secondary: '#ff2d96', glow: 'rgba(10,255,205,0.3)' },
          notepad:   { primary: '#ffb800', secondary: '#bf5fff', glow: 'rgba(255,184,0,0.3)' },
          logs:      { primary: '#ff2d96', secondary: '#0affcd', glow: 'rgba(255,45,150,0.3)' },
          mongo:     { primary: '#0affcd', secondary: '#bf5fff', glow: 'rgba(10,255,205,0.3)' },
          rclone:    { primary: '#bf5fff', secondary: '#0affcd', glow: 'rgba(191,95,255,0.35)' },
          monitor:   { primary: '#0affcd', secondary: '#ffb800', glow: 'rgba(10,255,205,0.35)' },
          backup:    { primary: '#ffb800', secondary: '#0affcd', glow: 'rgba(255,184,0,0.35)' },
          database:  { primary: '#ff2d96', secondary: '#ffb800', glow: 'rgba(255,45,150,0.3)' },
          firewall:  { primary: '#0affcd', secondary: '#ff2d96', glow: 'rgba(10,255,205,0.35)' },
          auto:      { primary: '#ff2d96', secondary: '#ffb800', glow: 'rgba(255,45,150,0.35)' },
        };
        const sw = swPalette[iconId] || swPalette.terminal;

        const swGimmick = () => {
          switch (iconId) {
            case 'terminal':
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[20, 40, 60, 80].map((y, i) => (
                    <div key={i} className="absolute h-[1px] animate-pulse" style={{ top: `${y}%`, left: 0, width: `${50 + i * 12}%`, background: `linear-gradient(90deg, transparent, ${sw.primary}${40 + i * 10})`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'ssh':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {[0.35, 0.55, 0.75].map((scale, i) => (
                    <div key={i} className="absolute border animate-ping" style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, borderColor: `${i % 2 === 0 ? sw.primary : sw.secondary}${20 - i * 5}`, transform: 'rotate(45deg)', animationDuration: `${1.8 + i * 0.5}s`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'docker':
              return (
                <div className="absolute inset-0 flex flex-col justify-evenly pointer-events-none px-[15%]">
                  {[0.4, 0.7, 1.0].map((op, i) => (
                    <div key={i} className="h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, ${sw.secondary}${Math.floor(op * 60)}, ${sw.primary}${Math.floor(op * 80)}, ${sw.secondary}${Math.floor(op * 60)})` }} />
                  ))}
                </div>
              );
            case 'settings':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_5s_linear_infinite]">
                  <svg width="80%" height="80%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke={sw.primary} strokeWidth="0.8" strokeDasharray="5 18" opacity="0.35" />
                    <circle cx="20" cy="20" r="12" fill="none" stroke={sw.secondary} strokeWidth="0.6" strokeDasharray="3 22" opacity="0.25" />
                  </svg>
                </div>
              );
            case 'logs':
              // Sunset gradient streaks
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[35, 60, 82].map((y, i) => (
                    <div key={i} className="absolute h-[1.5px] animate-pulse" style={{ top: `${y}%`, left: '10%', width: `${30 + i * 12}%`, background: `linear-gradient(90deg, transparent, ${i % 2 ? sw.primary : sw.secondary}60)`, animationDelay: `${i * 0.35}s` }} />
                  ))}
                </div>
              );
            case 'mongo':
              return (
                <div className="absolute inset-0 pointer-events-none animate-[spin_3s_linear_infinite]">
                  <div className="absolute w-[5px] h-[5px] rounded-full top-[10%] left-1/2 -translate-x-1/2" style={{ backgroundColor: sw.primary, boxShadow: `0 0 8px ${sw.glow}` }} />
                  <div className="absolute w-[3px] h-[3px] rounded-full bottom-[10%] left-1/2 -translate-x-1/2" style={{ backgroundColor: sw.secondary, boxShadow: '0 0 5px rgba(10,255,205,0.5)' }} />
                </div>
              );
            case 'rclone':
              return (
                <div className="absolute inset-0 pointer-events-none">
                  {[25, 50, 75].map((y, i) => (
                    <div key={i} className="absolute h-[1px] animate-pulse" style={{ top: `${y}%`, left: '20%', width: '60%', background: `linear-gradient(90deg, transparent, ${sw.primary}30, transparent)`, animationDelay: `${i * 0.4}s` }} />
                  ))}
                </div>
              );
            case 'monitor':
              // Retro Vitalscope trace
              return (
                <div className="absolute bottom-[10%] left-[10%] right-[10%] pointer-events-none" style={{ height: '28%' }}>
                  <svg width="100%" height="100%" viewBox="0 0 40 12" fill="none" stroke={sw.primary} strokeWidth="1.3" strokeLinecap="round" opacity="0.7">
                    <polyline points="1,7 8,7 11,1 15,11 18,5 21,7 39,7" />
                  </svg>
                </div>
              );
            case 'backup':
              // Sun-ring orbit
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_8s_linear_infinite]">
                  <svg width="78%" height="78%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="17" fill="none" stroke={sw.primary} strokeWidth="0.9" strokeDasharray="12 8" opacity="0.35" />
                    <circle cx="20" cy="20" r="12" fill="none" stroke={sw.secondary} strokeWidth="0.6" strokeDasharray="5 12" opacity="0.25" />
                  </svg>
                </div>
              );
            case 'database':
              // Horizon stack lines
              return (
                <div className="absolute inset-0 pointer-events-none flex flex-col justify-center gap-[8%] px-[22%]">
                  {[0.5, 0.32, 0.18].map((op, i) => (
                    <div key={i} className="h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${i % 2 ? sw.secondary : sw.primary}, transparent)`, opacity: op }} />
                  ))}
                </div>
              );
            case 'firewall':
              // Chrome grid horizon
              return (
                <div className="absolute inset-0 pointer-events-none opacity-[0.3]">
                  {[28, 46, 64].map(y => (
                    <div key={y} className="absolute h-[1px]" style={{ top: `${y}%`, left: '14%', right: '14%', background: `linear-gradient(90deg, transparent, ${sw.primary}70, transparent)` }} />
                  ))}
                </div>
              );
            case 'server':
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="absolute w-[50%] h-[50%] rounded-full animate-ping" style={{ backgroundColor: `${sw.primary}10`, animationDuration: '2.5s' }} />
                </div>
              );
            case 'auto':
              return (
                <div className="absolute inset-x-0 bottom-[8%] flex flex-col items-center gap-[2px] pointer-events-none">
                  {[0,1,2].map(i => (
                    <div key={i} className="animate-bounce" style={{ animationDuration: '0.9s', animationDelay: `${i * 0.15}s` }}>
                      <svg width="12" height="6" viewBox="0 0 12 6"><polyline points="1,5 6,1 11,5" fill="none" stroke={i % 2 === 0 ? sw.primary : sw.secondary} strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </div>
                  ))}
                </div>
              );
            default:
              return null;
          }
        };

        return (
            <div
              className={`${baseContainer}`}
              style={{
                background: `linear-gradient(160deg, #0d0015 0%, #1a003a 50%, #0d0015 100%)`,
                boxShadow: `0 0 18px ${sw.glow}, inset 0 0 30px rgba(0,0,0,0.7)`,
                borderRadius: '4px',
              }}
            >
                {/* Top neon bar */}
                <div className="absolute top-0 left-0 right-0 h-[2px] animate-pulse" style={{ background: `linear-gradient(90deg, transparent, ${sw.primary}, ${sw.secondary}, ${sw.primary}, transparent)` }} />
                {/* Bottom neon bar */}
                <div className="absolute bottom-0 left-0 right-0 h-[2px] animate-pulse" style={{ background: `linear-gradient(90deg, transparent, ${sw.secondary}, ${sw.primary}, ${sw.secondary}, transparent)`, animationDelay: '0.5s' }} />
                {/* Left vert strip */}
                <div className="absolute top-[10%] left-0 w-[2px]" style={{ height: '40%', background: `linear-gradient(180deg, transparent, ${sw.primary}90, transparent)` }} />
                {/* Right vert strip */}
                <div className="absolute bottom-[10%] right-0 w-[2px]" style={{ height: '40%', background: `linear-gradient(0deg, transparent, ${sw.secondary}90, transparent)` }} />
                {/* Scanlines */}
                <div className="absolute inset-0 opacity-[0.05] pointer-events-none bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(255,45,150,0.2)_50%)] bg-[length:100%_4px]" />
                {/* Per-app gimmick */}
                {swGimmick()}
                {/* Icon with synthwave neon glow */}
                <div className="relative z-10 flex items-center justify-center" style={{ filter: `drop-shadow(0 0 6px ${sw.glow}) drop-shadow(0 0 2px ${sw.primary}60)` }}>
                  {content}
                </div>
            </div>
        );
    }

    // ========== DEFAULT THEMES (dark & light) — unique per-app gradient design ==========
    const tokens = (isLight ? LIGHT_TOKENS : DARK_TOKENS)[iconId] || (isLight ? LIGHT_TOKENS.settings : DARK_TOKENS.settings);
    const isGlass = iconStyle === 'glass' || iconStyle == null || iconStyle === undefined;

    return (
        <div
            className={`${baseContainer} rounded-[22%]`}
            style={{
                ...styles,
                background: (iconStyle === 'minimal' || iconStyle === 'outline')
                    ? styles.background
                    : `linear-gradient(145deg, ${tokens.from} 0%, ${tokens.to} 100%)`,
                color: tokens.glyph || '#ffffff',
                boxShadow: iconStyle === 'flat' || iconStyle === 'minimal' || iconStyle === 'outline'
                    ? styles.boxShadow
                    : `0 4px 12px rgba(0,0,0,${isLight ? 0.18 : 0.45}), 0 0 10px ${tokens.accent}26`,
            }}
        >
            {/* Glass top highlight */}
            {isGlass && (
                <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(180deg, rgba(255,255,255,${isLight ? 0.55 : 0.18}) 0%, transparent 45%)`, borderRadius: 'inherit' }} />
            )}
            {/* Inner accent ring */}
            {isGlass && (
                <div className="absolute inset-[6%] rounded-[18%] pointer-events-none" style={{ border: `1px solid ${tokens.accent}${isLight ? '35' : '22'}` }} />
            )}
            {/* Per-app micro-detail */}
            {iconStyle !== 'minimal' && iconStyle !== 'outline' && defaultDetail(tokens.accent)}
            {/* Glyph */}
            <div className="relative z-10 flex items-center justify-center" style={{ filter: isLight ? 'none' : `drop-shadow(0 1px 3px rgba(0,0,0,0.4))` }}>
                {content}
            </div>
        </div>
    );
  };

  const getIcon = (IconComponent) => {
      const iconSize = size * 0.75;
    let color = isLight ? '#475569' : 'white';

    // Desktop icons in Outline or Minimal modes need high visibility against wallpapers
    let dropShadow = 'none';
    if (isDesktop && (iconStyle === 'outline' || iconStyle === 'minimal')) {
       color = 'white';
       dropShadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.9)) drop-shadow(0 0 2px rgba(0,0,0,0.8))';
    }

    const themeColorMaps = {
      cyberpunk: {
        terminal:  '#00ff9f', ssh: '#00d4ff', docker: '#ff6ec7', files: '#ffd700',
        tmux: '#7b68ee', settings: '#ff4444', wiki: '#00bfff', notepad: '#ff8c00',
        logs: '#ff1493', mongo: '#00ff66', rclone: '#bf5fff', monitor: '#00fef0',
        backup: '#c0ff00', database: '#ff7b00', firewall: '#00ff88', auto: '#ff0055',
      },
      fallout: {
        terminal:  '#18e12c', ssh: '#00e5ff', docker: '#ff9f1c', files: '#ffd166',
        tmux: '#06d6a0', settings: '#ef476f', wiki: '#118ab2', notepad: '#fca311',
        logs: '#e63946', mongo: '#10b981', rclone: '#8b5cf6', monitor: '#38bdf8',
        backup: '#a3e635', database: '#f97316', firewall: '#22c55e', auto: '#ff5500',
      },
      synthwave: {
        terminal:  '#ff2d96', ssh: '#bf5fff', docker: '#0affcd', files: '#ffb800',
        tmux: '#ff2d96', settings: '#bf5fff', wiki: '#0affcd', notepad: '#ffb800',
        logs: '#ff2d96', mongo: '#0affcd', rclone: '#bf5fff', monitor: '#0affcd',
        backup: '#ffb800', database: '#ff2d96', firewall: '#0affcd', auto: '#ff2d96',
      },
    };

    if (isCyberpunk) color = themeColorMaps.cyberpunk[iconId] || '#00ffff';
    if (isRetro) color = themeColorMaps.fallout[iconId] || '#18e12c';
    if (isSynthwave) color = themeColorMaps.synthwave[iconId] || '#ff2d96';

    // Default dark/light themes: unique accent per app (keep desktop
    // minimal/outline white glyphs for wallpaper visibility)
    if (!isRetro && !isCyberpunk && !isSynthwave && !(isDesktop && (iconStyle === 'outline' || iconStyle === 'minimal'))) {
      const tokens = (isLight ? LIGHT_TOKENS : DARK_TOKENS)[iconId];
      if (tokens) color = tokens.glyph || tokens.accent;
    }

    const rawStyle = { color, filter: dropShadow };
    switch (iconId) {
        case 'terminal':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2.5} />;
        case 'ssh':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2.5} />;
        case 'docker':
            if (isRetro) {
                return (
                    <div className="flex flex-col gap-[1px] items-center" style={{ color }}>
                        <div className="rounded-sm" style={{ width: iconSize * 0.55, height: Math.max(2, iconSize * 0.12), backgroundColor: color, opacity: 0.4 }} />
                        <div className="rounded-sm" style={{ width: iconSize * 0.65, height: Math.max(2, iconSize * 0.12), backgroundColor: color, opacity: 0.6 }} />
                        <div className="rounded-sm" style={{ width: iconSize * 0.75, height: Math.max(2, iconSize * 0.12), backgroundColor: color, opacity: 0.8 }} />
                        <IconComponent size={iconSize * 0.6} style={{ color }} />
                    </div>
                );
            }
            return (
                <div className="flex flex-col gap-[2px] items-center" style={{ filter: dropShadow, color }}>
                    <div className="rounded-[2px] opacity-40" style={{ width: iconSize * 0.7, height: Math.max(2, iconSize * 0.15), backgroundColor: 'currentColor' }} />
                    <div className="rounded-[2px] opacity-60" style={{ width: iconSize * 0.7, height: Math.max(2, iconSize * 0.15), backgroundColor: 'currentColor' }} />
                    <IconComponent size={iconSize * 0.7} style={{ color }} />
                </div>
            );
        case 'files':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2.5} />;
        case 'tmux':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={1.5} />;
        case 'settings':
            if (isRetro) {
                return <Wrench size={iconSize} style={rawStyle} strokeWidth={2.5} />;
            }
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2} />;
        case 'wiki':
        case 'notepad':
        case 'database':
        case 'mongo':
        case 'monitor':
        case 'backup':
        case 'firewall':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2} />;
        case 'auto':
            return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2} />;
        default:
            return <IconComponent size={iconSize} style={{ color }} />;
    }
  };

  const IconComp = {
    terminal: Terminal,
    ssh: (isRetro || isCyberpunk || isSynthwave) ? Radio : Monitor,
    docker: isRetro ? HardDrive : ((isCyberpunk || isSynthwave) ? Database : Server),
    files: isRetro ? Archive : Folder,
    tmux: (isRetro || isCyberpunk || isSynthwave) ? Cpu : MonitorPlay,
    settings: (isRetro || isCyberpunk || isSynthwave) ? Wrench : Settings,
    logs: isRetro ? FileText : ScrollText,
    wiki: BookOpen,
    notepad: StickyNote,
    database: Database,
    mongo: Database,
    rclone: isRetro ? CloudSync : CloudCog,
    monitor: Activity,
    backup: isRetro ? HardDrive : Archive,
    server: ShieldCheck,
    firewall: BrickWallShield,
    auto: Rocket,
  }[iconId] || Globe;

  return (
    <div className={`w-full h-full flex items-center justify-center ${className}`}>
        {wrapIcon(getIcon(IconComp), '#334155', '#ffffff')}
    </div>
  );
};

export default AppIcon;
