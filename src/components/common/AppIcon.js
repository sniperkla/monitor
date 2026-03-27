import React from 'react';
import { Terminal, Settings, Monitor, Database, Folder, MonitorPlay, Server, FileText, Globe, StickyNote, Book, BookOpen, Shield, Radio, Radiation, Cpu, HardDrive, Wrench, Archive } from 'lucide-react';

const AppIcon = ({ id, size = 32, className = "", theme = "dark", iconStyle = "glass", isDesktop = false }) => {
  const iconId = id?.split('-')[0] || id;

  const isRetro = theme === 'retro' || theme === 'fallout';
  const isFallout = theme === 'fallout';
  const isCyberpunk = theme === 'cyberpunk';
  const isLight = theme === 'light';

  // Base styles shared across icons
  const baseContainer = `relative w-full h-full flex items-center justify-center transition-all duration-300 overflow-hidden ${className}`;

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
        // Per-app unique color accents for Fallout theme
        const falloutPalette = {
          terminal:  { primary: '#18e12c', glow: 'rgba(24,225,44,0.4)', accent: '#0dff2a' },
          ssh:       { primary: '#00e5ff', glow: 'rgba(0,229,255,0.35)', accent: '#40f0ff' },
          docker:    { primary: '#ff9f1c', glow: 'rgba(255,159,28,0.35)', accent: '#ffb84d' },
          files:     { primary: '#ffd166', glow: 'rgba(255,209,102,0.3)', accent: '#ffe08a' },
          tmux:      { primary: '#06d6a0', glow: 'rgba(6,214,160,0.35)', accent: '#33e0b3' },
          settings:  { primary: '#ef476f', glow: 'rgba(239,71,111,0.3)', accent: '#f2728e' },
          wiki:      { primary: '#118ab2', glow: 'rgba(17,138,178,0.3)', accent: '#1ca3d1' },
          notepad:   { primary: '#fca311', glow: 'rgba(252,163,17,0.35)', accent: '#fdb544' },
          'docker-logs': { primary: '#e63946', glow: 'rgba(230,57,70,0.3)', accent: '#eb636e' },
        };
        const pal = falloutPalette[iconId] || falloutPalette.terminal;

        // Per-app unique gimmick for Fallout
        const falloutGimmick = () => {
          switch (iconId) {
            case 'terminal':
              // Blinking cursor caret
              return <div className="absolute bottom-[7px] right-[8px] w-[3px] h-[8px] animate-pulse pointer-events-none" style={{ backgroundColor: pal.primary, boxShadow: `0 0 3px ${pal.glow}` }} />;
            case 'ssh':
              // Signal wave arcs
              return (
                <div className="absolute top-[6px] left-[6px] pointer-events-none">
                  {[0,1,2].map(i => (
                    <div key={i} className="absolute rounded-full border animate-ping pointer-events-none" style={{ width: 5 + i * 5, height: 5 + i * 5, borderColor: `${pal.primary}${i === 0 ? '80' : i === 1 ? '40' : '20'}`, top: -(i * 2), left: -(i * 2), animationDuration: `${1.5 + i * 0.4}s`, animationDelay: `${i * 0.3}s` }} />
                  ))}
                </div>
              );
            case 'docker':
              // Radiation hazard triangle
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
              // Vault door number badge
              return <div className="absolute top-[4px] left-[5px] w-[12px] h-[12px] rounded-full border flex items-center justify-center pointer-events-none" style={{ borderColor: `${pal.primary}50`, fontSize: '6px', color: `${pal.primary}90`, fontFamily: 'monospace', fontWeight: 'bold' }}>13</div>;
            case 'tmux':
              // Split-screen divider lines
              return (
                <>
                  <div className="absolute top-[20%] left-1/2 w-[1px] h-[60%] pointer-events-none" style={{ backgroundColor: `${pal.primary}35` }} />
                  <div className="absolute top-1/2 left-[20%] w-[60%] h-[1px] pointer-events-none" style={{ backgroundColor: `${pal.primary}25` }} />
                </>
              );
            case 'settings':
              // Slow rotating gear ring dots
              return (
                <div className="absolute inset-0 pointer-events-none animate-[spin_8s_linear_infinite]">
                  {[0,90,180,270].map(deg => (
                    <div key={deg} className="absolute w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${pal.primary}40`, top: '50%', left: '50%', transform: `rotate(${deg}deg) translateY(-${size * 0.35}px) translate(-50%, -50%)` }} />
                  ))}
                </div>
              );
            case 'wiki':
              // Bookmark tab
              return <div className="absolute top-0 right-[10px] w-[5px] h-[10px] pointer-events-none" style={{ backgroundColor: `${pal.primary}50`, borderRadius: '0 0 2px 2px' }} />;
            case 'notepad':
              // Tiny pencil line
              return <div className="absolute bottom-[8px] left-[8px] w-[12px] h-[1.5px] pointer-events-none" style={{ backgroundColor: `${pal.primary}50`, transform: 'rotate(-30deg)' }} />;
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
          'docker-logs': { primary: '#ff1493', secondary: '#00ffff', glow: 'rgba(255,20,147,0.3)' },
        };
        const cp = cpPalette[iconId] || cpPalette.terminal;
        const cpClip = 'polygon(0 12%, 12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%)';

        // Per-app unique gimmick for Cyberpunk
        const cpGimmick = () => {
          switch (iconId) {
            case 'terminal':
              // Matrix rain dots falling down
              return (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[15,35,55,75,88].map((x, i) => (
                    <div key={i} className="absolute w-[2px] rounded-full animate-pulse" style={{ left: `${x}%`, top: `${10 + i * 12}%`, height: `${6 + i * 2}px`, backgroundColor: `${cp.primary}${30 + i * 8}`, animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              );
            case 'ssh':
              // Expanding pulse ring
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="absolute w-[70%] h-[70%] rounded-full border animate-ping" style={{ borderColor: `${cp.primary}15`, animationDuration: '2s' }} />
                  <div className="absolute w-[50%] h-[50%] rounded-full border animate-ping" style={{ borderColor: `${cp.secondary}12`, animationDuration: '2.5s', animationDelay: '0.5s' }} />
                </div>
              );
            case 'docker':
              // Hex grid pattern
              return (
                <div className="absolute inset-0 pointer-events-none opacity-[0.12]">
                  <svg width="100%" height="100%" viewBox="0 0 40 40">
                    <polygon points="20,2 34,10 34,26 20,34 6,26 6,10" fill="none" stroke={cp.primary} strokeWidth="0.5" />
                    <polygon points="20,8 28,13 28,23 20,28 12,23 12,13" fill="none" stroke={cp.secondary} strokeWidth="0.3" />
                  </svg>
                </div>
              );
            case 'files':
              // Data-chip circuit traces
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
              // Neon split dividers
              return (
                <>
                  <div className="absolute top-[15%] left-1/2 w-[1px] h-[70%] pointer-events-none" style={{ background: `linear-gradient(180deg, transparent, ${cp.primary}30, ${cp.secondary}30, transparent)` }} />
                  <div className="absolute top-[45%] left-[15%] w-[70%] h-[1px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, ${cp.secondary}25, ${cp.primary}25, transparent)` }} />
                </>
              );
            case 'settings':
              // Rotating arc segments
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[spin_6s_linear_infinite]">
                  <svg width="80%" height="80%" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke={cp.primary} strokeWidth="0.7" strokeDasharray="6 20" opacity="0.3" />
                    <circle cx="20" cy="20" r="13" fill="none" stroke={cp.secondary} strokeWidth="0.5" strokeDasharray="4 22" opacity="0.2" />
                  </svg>
                </div>
              );
            case 'wiki':
              // Holographic bookmark shimmer
              return <div className="absolute top-0 right-[25%] w-[4px] h-[30%] pointer-events-none" style={{ background: `linear-gradient(180deg, ${cp.primary}50, ${cp.secondary}20, transparent)`, borderRadius: '0 0 2px 2px' }} />;
            case 'notepad':
              // Glitch bar flash
              return (
                <div className="absolute pointer-events-none animate-pulse" style={{ top: '30%', left: '10%', width: '25%', height: '2px', backgroundColor: `${cp.secondary}25`, animationDuration: '3s' }} />
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

    // ========== DEFAULT THEMES ==========
    return (
        <div className={`${baseContainer} rounded-2xl`} style={styles}>
            <div className="relative z-10 flex items-center justify-center">{content}</div>
        </div>
    );
  };

  const getIcon = (IconComponent) => {
    const iconSize = size * 0.6;
    let color = isLight ? '#475569' : 'white';
    
    // Desktop icons in Outline or Minimal modes need high visibility against wallpapers
    let dropShadow = 'none';
    if (isDesktop && (iconStyle === 'outline' || iconStyle === 'minimal')) {
       color = 'white';
       dropShadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.9)) drop-shadow(0 0 2px rgba(0,0,0,0.8))';
    }

    // Cyberpunk: each icon gets its OWN unique neon color
    const cyberpunkColors = {
      terminal:  '#00ff9f',
      ssh:       '#00d4ff',
      docker:    '#ff6ec7',
      files:     '#ffd700',
      tmux:      '#7b68ee',
      settings:  '#ff4444',
      wiki:      '#00bfff',
      notepad:   '#ff8c00',
      'docker-logs': '#ff1493',
    };
    if (isCyberpunk) color = cyberpunkColors[iconId] || '#00ffff';

    // Fallout: each icon gets its OWN unique color
    const falloutColors = {
      terminal:  '#18e12c',
      ssh:       '#00e5ff',
      docker:    '#ff9f1c',
      files:     '#ffd166',
      tmux:      '#06d6a0',
      settings:  '#ef476f',
      wiki:      '#118ab2',
      notepad:   '#fca311',
      'docker-logs': '#e63946',
    };
    if (isRetro) color = falloutColors[iconId] || '#18e12c';

    const renderRaw = () => {
        const rawStyle = { color, filter: dropShadow };
        switch (iconId) {
            case 'terminal':
                return <IconComponent size={iconSize} className={(isRetro || isCyberpunk) ? '' : (isLight && !isDesktop ? 'text-slate-700' : 'text-emerald-400')} style={{ color: (isRetro || isCyberpunk) ? color : undefined, filter: dropShadow }} strokeWidth={2.5} />;
            case 'ssh':
            case 'ssh-manager':
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
            case 'files-app':
                return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2.5} />;
            case 'tmux':
                return <IconComponent size={iconSize} style={rawStyle} strokeWidth={1.5} />;
            case 'settings':
                if (isRetro) {
                    return <Wrench size={iconSize} style={rawStyle} strokeWidth={2.5} />;
                }
                return <IconComponent size={iconSize} style={rawStyle} strokeWidth={2} />;
            case 'wiki':
                return <IconComponent size={iconSize} className={(isRetro || isCyberpunk) ? '' : 'text-blue-400'} style={{ color: (isRetro || isCyberpunk) ? color : undefined, filter: dropShadow }} strokeWidth={2} />;
            case 'notepad':
                return <IconComponent size={iconSize} className={(isRetro || isCyberpunk) ? '' : 'text-orange-400'} style={{ color: (isRetro || isCyberpunk) ? color : undefined, filter: dropShadow }} strokeWidth={2} />;
            default:
                return <IconComponent size={iconSize} style={{ color }} />;
        }
    };

    const bgMap = {
        terminal: isLight ? '#f1f5f9' : '#0f172a',
        ssh: isLight ? '#e0e7ff' : '#4338ca',
        docker: isLight ? '#e0f2fe' : '#0284c7',
        files: isLight ? '#fef3c7' : '#d97706',
        tmux: isLight ? '#dcfce7' : '#059669',
        settings: isLight ? '#f8fafc' : '#475569',
        'docker-logs': isLight ? '#ffe4e6' : '#e11d48',
        wiki: isLight ? '#f0f9ff' : '#0369a1',
        notepad: isLight ? '#fff7ed' : '#c2410c',
    };

    return wrapIcon(renderRaw(), bgMap[iconId] || '#334155', color);
  };

  const IconComp = {
    terminal: Terminal,
    ssh: (isRetro || isCyberpunk) ? Radio : Monitor,
    'ssh-manager': (isRetro || isCyberpunk) ? Radio : Monitor,
    docker: isRetro ? HardDrive : (isCyberpunk ? Database : Server),
    files: isRetro ? Archive : Folder,
    'files-app': isRetro ? Archive : Folder,
    tmux: (isRetro || isCyberpunk) ? Cpu : MonitorPlay,
    settings: (isRetro || isCyberpunk) ? Wrench : Settings,
    'docker-logs': FileText,
    wiki: BookOpen,
    notepad: FileText,
  }[iconId] || Globe;

  return (
    <div className={`w-full h-full flex items-center justify-center ${className}`}>
        {getIcon(IconComp)}
    </div>
  );
};

export default AppIcon;
