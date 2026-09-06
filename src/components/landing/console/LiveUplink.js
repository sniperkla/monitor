'use client';

import { useEffect, useRef } from 'react';

/* ── Live uplink — ambient telemetry that never re-renders React ── */
const UPLINK_SCENES = [
  [
    { text: 'ssh monitor@10.0.0.1', type: 'cmd' },
    { text: 'Authenticating... ', type: 'out', suffix: 'OK', sc: '#4ade80' },
    { text: 'Last login: 2h ago from 192.168.1.5', type: 'out' },
    { text: 'uptime', type: 'cmd' },
    { text: ' 14:23:07 up 47 days, load avg: 0.42', type: 'out' },
    { text: 'Disk usage elevated ', type: 'out', suffix: 'WARN', sc: '#eab308' },
  ],
  [
    { text: 'docker ps', type: 'cmd' },
    { text: 'CONTAINER   IMAGE          STATUS', type: 'out' },
    { text: 'a3f2 nginx:alpine    Up 14d', type: 'out' },
    { text: 'b7c1 postgres:16     Up 14d', type: 'out' },
    { text: 'All containers healthy ', type: 'out', suffix: '3/3 RUNNING', sc: '#4ade80' },
  ],
  [
    { text: 'fail2ban-client status sshd', type: 'cmd' },
    { text: 'Currently failed: 2', type: 'out' },
    { text: 'Currently banned: 1', type: 'out' },
    { text: 'Jail active, protecting SSH ', type: 'out', suffix: 'ACTIVE', sc: '#4ade80' },
  ],
  [
    { text: 'vault status', type: 'cmd' },
    { text: 'Seal Type       shamir', type: 'out' },
    { text: 'Sealed          false', type: 'out' },
    { text: 'Vault unsealed and ready ', type: 'out', suffix: 'SECURE', sc: '#4ade80' },
  ],
  [
    { text: 'rclone sync /srv s3:backups', type: 'cmd' },
    { text: 'Transferred: 1.24 GiB (38 MiB/s)', type: 'out' },
    { text: 'Checks: 1042 files, 0 differs', type: 'out' },
    { text: 'Nightly sync complete ', type: 'out', suffix: 'VERIFIED', sc: '#4ade80' },
  ],
  [
    { text: 'mission-control status', type: 'cmd' },
    { text: 'STATION   ORBITAL RELAY 7   NOMINAL', type: 'out' },
    { text: 'DRIVE     HYPERWARP          100%', type: 'out' },
    { text: 'Ready for hyperwarp ', type: 'out', suffix: 'WAITING ON ACCESS', sc: '#22d3ee' },
  ],
];

function pickUplinkScene() {
  return UPLINK_SCENES[Math.floor(Math.random() * UPLINK_SCENES.length)];
}

function LiveUplink({ reduced }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const box = bodyRef.current;
    if (!box) return undefined;

    if (reduced) {
      box.innerHTML = '';
      pickUplinkScene().forEach((line) => {
        if (line.type === 'blank') return;
        const div = document.createElement('div');
        div.className = 'flex items-start';
        div.textContent = (line.type === 'cmd' ? '$ ' : '  ') + line.text + (line.suffix ? ` ${line.suffix}` : '');
        box.appendChild(div);
      });
      return undefined;
    }

    let timer;
    let scene = pickUplinkScene();
    let lineIdx = 0;
    let charIdx = 0;
    let cur = null;

    const appendLine = (line) => {
      const div = document.createElement('div');
      div.className = 'flex items-start';
      const text = document.createElement('span');
      text.className = 'whitespace-pre';
      if (line.type === 'cmd') {
        const prompt = document.createElement('span');
        prompt.className = 'text-emerald-400/80 mr-1 shrink-0';
        prompt.textContent = '$';
        div.append(prompt, text);
      } else {
        div.append(text);
      }
      box.appendChild(div);
      while (box.children.length > 10) box.removeChild(box.firstChild);
      return { div, text };
    };

    const tick = () => {
      if (lineIdx >= scene.length) {
        timer = setTimeout(() => {
          box.style.opacity = '0';
          timer = setTimeout(() => {
            box.innerHTML = '';
            box.style.opacity = '1';
            scene = pickUplinkScene();
            lineIdx = 0;
            charIdx = 0;
            tick();
          }, 450);
        }, 2600);
        return;
      }

      const line = scene[lineIdx];
      if (line.type === 'blank') {
        const { div } = appendLine(line);
        div.style.height = '8px';
        lineIdx += 1;
        charIdx = 0;
        timer = setTimeout(tick, 90);
        return;
      }

      if (charIdx === 0) cur = appendLine(line);
      charIdx += 1;
      cur.text.textContent = line.text.slice(0, charIdx);

      if (charIdx >= line.text.length) {
        if (line.suffix) {
          const badge = document.createElement('span');
          badge.className = 'ml-1.5 font-bold shrink-0';
          badge.style.color = line.sc || '#4ade80';
          badge.textContent = line.suffix;
          cur.div.appendChild(badge);
        }
        lineIdx += 1;
        charIdx = 0;
        timer = setTimeout(tick, line.type === 'cmd' ? 240 : (line.delay || 50));
        return;
      }

      const speed = line.type === 'cmd' ? 14 + Math.random() * 18 : 5 + Math.random() * 8;
      timer = setTimeout(tick, speed);
    };

    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <div
      data-uplink-panel
      className="fixed top-5 left-5 z-[4] pointer-events-none hidden sm:block w-[min(26rem,38vw)]"
    >
      <div
        className="px-3 py-2.5 font-mono text-[9px] leading-relaxed border-l border-slate-600/40"
        style={{
          background:
            'linear-gradient(90deg, rgba(2,4,10,0.68) 0%, rgba(2,4,10,0.28) 74%, transparent 100%)',
          maskImage: 'linear-gradient(90deg, black 0%, black 78%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(90deg, black 0%, black 78%, transparent 100%)',
        }}
      >
        <p className="mb-1.5 text-[8px] tracking-[0.22em] uppercase text-slate-500">Live uplink</p>
        <div ref={bodyRef} style={{ transition: 'opacity 0.4s ease' }} />
      </div>
    </div>
  );
}


export { LiveUplink };
