# Mobile responsive audit — 320 / 375 / 414px (+ 640 / 768 / 1024 tablet check)

Measured with headless Chrome against a real session (15 apps + the desktop
shell × 3 widths = 45 measurements), reading geometry rather than screenshots:
`scrollWidth` vs `clientWidth`, `getBoundingClientRect()` against clipping
ancestors, computed font sizes, and a 44px tap-target check.

Baseline: `tmp/mb-harness/probe-baseline.json`. After: `probe-final2.json`.

## Scoreboard

| Metric | Before | After |
|---|---|---|
| Horizontal overflow with **no** scroll container | 2 | **0** |
| Sub-44px tap targets | 327 | **3** (the Mongo Sync `#batchMode` checkbox, 20×20, one per width — has a clickable label as the actual tap target) |
| Clipped elements | 100 | 30 (all known false positives) |
| Document-level horizontal scroll | 0 | 0 |
| Docker tab strip usable width | **4px** | 194px |
| Sub-10px text | 39 | **0** (10px left as-is — see #12) |

## Desktop verified byte-for-byte

A second probe at 1440×900 was run on `HEAD` and on the patched tree. Across
all 16 measurements: counts identical, window widths identical, only difference
is the Uptime header `<span>`'s class string gaining `hidden sm:block` — a
no-op above 640px, same element, same geometry.

## Tablet band (640 / 768 / 1024) — checked because the fix added `sm:`/`lg:`

The fix touched 8 components with `sm:` and `lg:` variants, so the 640–1024px
band is the one range where behaviour changed but nothing had been measured.
Probed after the fix: `probe-tablet.json` (768, 1024) and `probe-640.json`.

- **640px** — 16/16 valid. 0 overflow, 0 sub-44px targets (except the
  `#batchMode` checkbox), 0 document scroll. Clean.
- **768px and 1024px** — every app reports the same 4 overflowing elements:
  `window-container`, `title-bar`, the title row, and the content pane, each at
  `left: 100` with `width = viewport − 20`, so the right edge hangs ~80–100px
  off-screen.
- **Not a regression.** At 1024px every `sm:`/`lg:` class resolves to its
  original desktop value and the `max-width: 768px` CSS block is completely
  inert — yet the finding is byte-identical to 768px. It is window *default
  geometry* in desktop mode (windows open at a fixed size/offset rather than
  fitting the viewport below ~1100px), present before this change. Fixing it
  would mean changing window sizing on desktop, which is out of scope.
- Side note: at exactly 768px the CSS mobile block is active while the JS
  `isMobile` flag is false, so phone-sized tap targets apply in desktop mode.
  Pre-existing (the media query predates this work) and harmless.

---

## 1. Every button in every app was 25px tall — `src/app/globals.css`

**Cause.** `.window-container [class*="flex"] { min-width: 0; min-height: 0 }`
has specificity (0,2,0). The mobile tap-target rule `button { min-height: 44px }`
is (0,0,1). Almost every button class contains `flex` (`flex-1`, `flex
items-center …`), so the reset won and every pill, tab and toolbar button
collapsed to ~25px — half the minimum tap height, app-wide.

**Fix.** Exclude interactive controls from the reset:

```css
.window-container [class*="flex"]:not(button):not(a):not(input):not(select):not(textarea):not([role="button"]) {
  min-width: 0;
  min-height: 0;
}
```

## 2. Icons silently vanishing — `src/app/globals.css`

**Cause.** Lucide SVGs are flex items. In a crowded row they shrink to **0px
wide** (measured 0×14 inside Server Monitor's tab strip, and in Activity,
Auto Deploy and Firewall). `overflow: hidden` on the SVG then hides the shape
entirely, so the icon just disappears with no layout error.

**Fix.** `.window-container svg { flex-shrink: 0 }` (mobile only). This removed
all 25 "clipped path/rect inside svg" findings and caused **zero** new overflow.

## 3. Docker Manager — tab strip crushed to 4px — `src/apps/DockerApp.js`

**Cause.** The right-hand action group (Local/Server badge, IMPORT, PRUNE,
SWITCH) needs 328px in a 320px window and was `shrink-0`. The left group is
`flex-1` (basis 0%), so with negative free space it resolved to **0**, and
`.toolbar-tabs` inherited 4px. Tabs were unusable and SWITCH sat off-screen.

**Fix.** Toolbar stacks to two rows under `sm:`; the action group gets
`min-w-0 overflow-x-auto` and `justify-end`. Tab strip now 194px and scrolls.

## 4. Fixed-width sidebars starved the content pane

| App | Rail | Content left at 320px |
|---|---|---|
| Mongo Sync | `w-56` (224px) | 96px |
| Server Backup | `w-52` (208px) | 112px (type cards squeezed to 32px) |

**Fix.** `flex flex-col sm:flex-row` with a full-width, height-capped,
scrollable rail on phones (`max-h-[38%]` / `max-h-[42%]`), `sm:` restoring the
original side-by-side layout. Files: `MongoBackupApp.js`, `ServerBackupApp.js`.

## 5. Fixed 5-column grids

`grid-cols-5` needs ~490px. → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` in
**ServerBackupApp**, **RcloneApp**, **MongoBackupApp** (cron pickers, backup
types). **VirusScannerApp** severity breakdown `grid-cols-4` →
`grid-cols-2 sm:grid-cols-4`, cards given `min-w-0`.

## 6. SSH Manager connections table — `src/components/Dashboard.js`

**Cause.** `min-w-[400px]` inside a 238px card → +162px horizontal scroll at
320px, +107 at 375px.

**Fix.** `min-w-0 sm:min-w-[400px]`; tighter mobile grid
(`1fr_56px_52px` vs `1fr_80px_80px_100px`); Uptime column `hidden sm:*`;
`px-2 sm:px-4`. Overflow at 320px: **+162 → 0**.

## 7. Firewall Blocklist — 791px row in a 288px column

**Cause.** The quick-action row was `flex items-center gap-2.5 overflow-x-auto`
— 791px of non-wrapping content that only scrolled sideways.

**Fix.** `flex flex-wrap items-center gap-2.5` — actions wrap onto multiple
lines on a phone.

## 8. Server Monitor tab strip — `src/apps/ServerMonitorApp.js`

Four labelled tabs need ~430px in 288px, which crushed each button until its
14px icon hit 0px wide. → `overflow-x-auto no-scrollbar` on the strip plus
`shrink-0` on each tab.

## 9. Virus Scanner hover tooltips — `src/apps/VirusScannerApp.js`

**Cause.** Three `w-72` (288px) tooltips, `opacity-0` + `pointer-events-none`,
anchored to the rightmost scan button. Invisible on touch but still adding
**170px** to `scrollWidth`.

**Fix.** `hidden sm:block` (they only ever showed on `group-hover`, which does
not exist on touch) plus `max-w-[calc(100vw-3rem)]`.

## 10. Tap-target width, and two more cascade traps — `src/app/globals.css`

After fix #1 buttons were 44px tall but still 20–40px wide.

- The resize-resilience reset `.window-container :where([class*='flex'],
  [class*='grid']) > *` is **(0,1,0) and lives outside any media query**, so it
  beat `button { min-width: 44px }` for every button that is a direct child of a
  flex/grid row — i.e. most toolbar buttons. Rather than edit it (which would
  have changed desktop), the tap target is re-asserted at (0,1,1) *inside* the
  mobile block.
- `input:not([type])` was missing from the mobile input rule. An `<input>` with
  no `type` attribute behaves as text but matches no `[type="…"]` selector, so
  Activity's search box stayed 38px. Added, plus `input[type="tel"]`.
- Checkboxes/radios are excluded from the 44px input rule (it would balloon
  them) and get a separate 20×20 minimum.

## 11. 6px-tall range sliders — `src/app/globals.css`

The brightness / glass / terminal-font-size sliders are `appearance-none`
`h-1.5`, so the visible track is just the element's own background. Giving
the input `min-height: 44px` with `padding: 19px 0` and
`background-clip: content-box` grows the hit area to 44px while the 6px band
keeps its look. Verified visually at 320px — track unchanged, element now
246×44.

---

## 12. 8px and 9px text — `src/app/globals.css`

Not in the original scoreboard because the first pass never tracked font
size, but "text that becomes unreadable" was part of the brief. Measured
offenders: an **8px "PRO" badge** in Settings, and five **9px prose
descriptions** in Server Backup ("Source code, configs, public files…",
"Containers, volumes, compose files…") — real sentences, not labels — plus
9px badges in Docker, Mongo Sync and SSH Manager.

One mobile-only rule bumps every sub-10px Tailwind arbitrary size to 11px:
`.window-container :where(.text-[6px], .text-[7px], .text-[8px], .text-[9px],
.text-[9.5px]) { font-size: 11px }`. Covered 6/7/8/9/9.5px because Tailwind
generates all of them and the probe caps findings at 20 per run, so rarer
sizes could hide behind the cap.

**10px is deliberately left alone.** It is the dense-dashboard label idiom
(~213 elements across 12 apps: `text-[10px] font-mono uppercase` stat
headings and counters). Enlarging all of them is a visual redesign with real
risk of re-introducing the toolbar overflow fixed above, so it is a judgement
call, not an oversight — flip it by adding `.text-[10px]` to the selector.

Result: sub-10px text **39 instances → 0**. Re-probed all three phone widths
afterwards — overflow 3→3, tap targets 3→3, clipped 30→30, i.e. the larger
text caused no new overflow anywhere.

---

## Known remaining / not fixed

- **10px text** — see above. Legible on a 2–3× DPR phone, but it is the one
  remaining item if you want larger type everywhere on mobile.
- **Mongo Sync `#batchMode` checkbox** is 20×20. It sits next to a clickable
  label, so the label is the actual tap target. Left at 20×20 to avoid
  blowing out the layout of the form row.
- **ssh-manager "clipped"** reports are viewport-sized `position: fixed` layers
  (sidebar backdrop, drawer) measured against the app window, which is 48px
  shorter than the viewport because of the taskbar. Not a layout break.
- **Firewall / desktop "clipped"** reports are decorative glow orbs that
  intentionally overflow their `overflow-hidden` parent.
- Remaining horizontal scrollers are deliberate: filter chip rows, tab strips,
  data tables.
