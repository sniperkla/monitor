'use client';

import { useEffect } from 'react';

/* ═══════════════════ Scroll engine ═══════════════════
   One capture-phase scroll listener (the scroll root is a fixed div, so
   window listeners never fire), rAF-throttled. Everything is measured in
   content coordinates once and then cheap math per scroll frame. */
function useScrollStory({ motionOff, heroRef, railRef, storyRailRef, cmdRef }) {
  useEffect(() => {
    const root = document.querySelector('[data-scroll-root]') || document.scrollingElement;
    if (!root) return undefined;

    let px = []; // parallax ghosts + mocks: { node, speed, docCenter }
    let sections = []; // [{ cmd, docTop }]
    let dots = []; // [HTMLElement]
    let queued = false;
    let raf = 0;
    let lastActiveCmd = null;

    // offsetTop chains are unreliable here (transformed ancestors become
    // offsetParents in some engines); rects are exact and this page only
    // carries a ≤26px pre-reveal offset on measured nodes.
    const docTop = (node) => node.getBoundingClientRect().top + root.scrollTop;

    const measure = () => {
      px = Array.from(root.querySelectorAll('[data-px]')).map((node) => ({
        node,
        speed: parseFloat(node.dataset.px) || 0.08,
        docCenter: docTop(node) + node.offsetHeight / 2,
      }));
      sections = Array.from(root.querySelectorAll('[data-cmd]'))
        .map((node) => ({ cmd: node.dataset.cmd, docTop: docTop(node) }))
        .sort((a, b) => a.docTop - b.docTop);
      dots = Array.from(root.querySelectorAll('[data-dot]'));
      apply();
    };

    const apply = () => {
      const st = root.scrollTop;
      const vh = window.innerHeight;

      // Hero recedes and docks away: slight lag, fade and a scale step so it
      // reads as depth — the console pulling back as the story takes over.
      if (heroRef.current) {
        const p = Math.min(1, st / vh);
        heroRef.current.style.opacity = Math.max(0, 1 - p * 1.15).toFixed(3);
        heroRef.current.style.transform =
          `translate3d(0, ${(st * 0.3).toFixed(1)}px, 0) scale(${(1 - p * 0.07).toFixed(4)})`;
      }

      if (!motionOff) {
        const mid = st + vh / 2;
        for (let i = 0; i < px.length; i++) {
          const it = px[i];
          const rel = it.docCenter - mid;
          if (rel > vh * 1.4 || rel < -vh * 1.4) continue;
          it.node.style.transform = `translate3d(0, ${(rel * it.speed).toFixed(1)}px, 0)`;
        }
      }

      if (railRef.current) {
        const max = Math.max(1, root.scrollHeight - vh);
        railRef.current.style.transform = `scaleY(${Math.min(1, st / max).toFixed(4)})`;
      }

      // The statusline follows the story like a shell prompt would, and the
      // timeline node of the active section lights up. data-cmd carries the
      // "$ " prompt but data-dot does not, so normalize before matching.
      if (sections.length) {
        let cur = null;
        for (let i = 0; i < sections.length; i++) {
          if (sections[i].docTop <= st + vh * 0.55) cur = sections[i].cmd;
        }
        if (cmdRef.current) {
          const next = cur || 'auth: PENDING';
          if (cmdRef.current.textContent !== next) cmdRef.current.textContent = next;
        }
        if (cur !== lastActiveCmd) {
          lastActiveCmd = cur;
          const bare = cur ? cur.replace(/^\$ /, '') : null;
          for (let i = 0; i < dots.length; i++) {
            const on = bare !== null && dots[i].dataset.dot === bare;
            if (dots[i].classList.contains('dot-active') !== on) {
              dots[i].classList.toggle('dot-active', on);
            }
          }
        }
      }

      // Story rail: fills along the timeline between the first and last
      // sections as the reader advances.
      if (storyRailRef.current && scenes.length >= 2) {
        const start = scenes[0].docTop - vh * 0.5;
        const end = scenes[scenes.length - 1].docTop + vh * 0.4;
        const p = Math.min(1, Math.max(0, (st + vh * 0.55 - start) / Math.max(1, end - start)));
        storyRailRef.current.style.transform = `scaleY(${p.toFixed(4)})`;
      }

    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(() => {
        queued = false;
        apply();
      });
    };

    // Reveals: one observer, one class, CSS does the rest.
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('in-view');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    root.querySelectorAll('.io').forEach((el) => io.observe(el));

    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', onScroll, { capture: true });
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [motionOff, heroRef, railRef, storyRailRef, cmdRef]);
}


export { useScrollStory };
