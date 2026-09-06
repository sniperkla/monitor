'use client';

import { useViewportSize } from '@/hooks/useViewportSize';

/**
 * Responsive metrics for the onboarding step panels.
 *
 * The nine onboarding components build their panels entirely from inline
 * styles, which cannot carry media-query breakpoints — every value is a hard
 * pixel literal that renders identically on a 27" monitor and a 375px phone.
 * Rewriting all nine onto Tailwind is a large, risky change; this hook exposes
 * just the values that actually break, so the existing inline styles can read
 * them instead.
 *
 * `isShort` matters as much as `isMobile`. The step panel is `position: fixed`
 * to the bottom of the viewport with no height cap, so on a landscape phone
 * (or any short window) tall content runs off the top of the screen with no
 * way to scroll to it. That is the one genuinely broken case, not just ugly.
 *
 * Heights use `dvh` rather than `vh`: on mobile Safari `vh` includes the area
 * behind the browser chrome, so a `vh`-capped fixed panel extends underneath
 * it. `dvh` tracks the visible viewport.
 */
export function useOnboardingLayout() {
  const vp = useViewportSize();

  const isMobile = vp.w < 640;
  const isShort = vp.h < 720;

  const overlayPad = isMobile ? 16 : 20;
  const cardPad = isMobile ? 14 : 20;
  const panelBottom = isMobile ? 12 : 32;

  return {
    isMobile,
    isShort,

    // Welcome overlay gutters.
    overlayPad,

    // Feature card padding.
    cardPad,

    // Hero headline. 42px is unreadable at 375px wide and pushes the feature
    // grid off-screen; 29px still reads as a hero.
    //
    // NOTE: below 768px this value is inert. globals.css:1710, inside
    // `@media (max-width: 768px)`, sets `h1 { font-size: 1.5rem !important }`
    // and `!important` beats an inline style. The mobile hero therefore renders
    // 24px regardless. Kept because it is correct on its own terms and would
    // take effect the moment that global rule changes.
    heroSize: isMobile ? 29 : 42,

    // Step panel.
    panelBottom,
    panelWidth: isMobile ? 'calc(100vw - 20px)' : 'calc(100vw - 64px)',

    // The panel is anchored to `bottom: panelBottom`, so the cap has to leave
    // room for that offset *plus* a matching gap at the top — otherwise a tall
    // panel grows straight past the top edge and the header is unreachable.
    // Measured: at 844x260 an unconditional `100dvh - 24px` put the card at
    // top = 260 - 32 - 236 = -8px, i.e. clipped.
    panelMaxHeight: isShort
      ? `calc(100dvh - ${panelBottom * 2}px)`
      : 'calc(100dvh - 120px)',

    // The panel is a flex column: progress bar on top, then a scrollable body.
    // The body gets zero bottom padding because the sticky footer supplies its
    // own — otherwise the footer would pin 24px above the edge and let content
    // scroll visibly behind it.
    contentPad: isMobile ? '16px 16px 0' : '24px 28px 0',
    footerPad: isMobile ? 16 : 24,

    // Header row: a 64px icon beside the title collapses badly under ~400px,
    // so it stacks instead.
    stackHeader: isMobile,
    headerGap: isMobile ? 12 : 20,
  };
}
