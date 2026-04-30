/**
 * falloutTextureUtils.mjs
 *
 * Shared utilities for all Fallout GLB generator scripts:
 *   1. Pure-JS PNG encoder (uses fflate for DEFLATE compression)
 *   2. OffscreenCanvas + ImageData polyfills (needed by THREE.GLTFExporter in Node.js)
 *   3. Procedural texture generators (camo, metal, scales, concrete, fire, plasma …)
 *   4. autoMap(colorStr) – automatically selects a texture based on a hex color
 *
 * Usage in each GLB script:
 *   import { installPolyfills, textures, autoMap } from './falloutTextureUtils.mjs';
 *   installPolyfills();   // call once, before using GLTFExporter
 */

import { zlibSync } from 'fflate';
import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════════
// 1.  CRC-32 (needed for valid PNG chunks)
// ═══════════════════════════════════════════════════════════════════════════════
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(arr, off, val) {
  arr[off]     = (val >>> 24) & 0xff;
  arr[off + 1] = (val >>> 16) & 0xff;
  arr[off + 2] = (val >>>  8) & 0xff;
  arr[off + 3] =  val         & 0xff;
}

// Build a PNG chunk: [length(4)] [type(4)] [data(n)] [crc(4)]
function pngChunk(type, data) {
  const typeBytes = [
    type.charCodeAt(0), type.charCodeAt(1),
    type.charCodeAt(2), type.charCodeAt(3),
  ];
  const len = data.length;
  const buf = new Uint8Array(12 + len);
  writeU32BE(buf, 0, len);
  buf[4] = typeBytes[0]; buf[5] = typeBytes[1];
  buf[6] = typeBytes[2]; buf[7] = typeBytes[3];
  buf.set(data, 8);
  writeU32BE(buf, 8 + len, crc32(buf, 4, 8 + len));
  return buf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2.  PNG encoder  (RGBA8 only)
// ═══════════════════════════════════════════════════════════════════════════════
export function encodePNG(width, height, rgba) {
  const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA  (0=compression 0=filter 0=interlace)

  // Raw scanlines: filter-byte(0=None) + RGBA per pixel
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * stride + 1 + x * 4;
      raw[di]     = rgba[si]     < 0 ? 0 : rgba[si]     > 255 ? 255 : rgba[si];
      raw[di + 1] = rgba[si + 1] < 0 ? 0 : rgba[si + 1] > 255 ? 255 : rgba[si + 1];
      raw[di + 2] = rgba[si + 2] < 0 ? 0 : rgba[si + 2] > 255 ? 255 : rgba[si + 2];
      raw[di + 3] = rgba[si + 3] < 0 ? 0 : rgba[si + 3] > 255 ? 255 : rgba[si + 3];
    }
  }

  const compressed = zlibSync(raw, { level: 6 });

  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', compressed);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const total = PNG_SIG.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(PNG_SIG, off);   off += PNG_SIG.length;
  out.set(ihdrChunk, off); off += ihdrChunk.length;
  out.set(idatChunk, off); off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.  Node.js polyfills required by THREE.GLTFExporter
// ═══════════════════════════════════════════════════════════════════════════════
export function installPolyfills() {
  // ImageData  ─────────────────────────────────────────────────────────────────
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data   = data instanceof Uint8ClampedArray
          ? data
          : new Uint8ClampedArray(data.buffer ?? data);
        this.width  = width;
        this.height = height !== undefined ? height : (data.length / 4 / width) | 0;
      }
    };
  }

  // OffscreenCanvas  ───────────────────────────────────────────────────────────
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    globalThis.OffscreenCanvas = class OffscreenCanvas {
      constructor(w, h) {
        this.width  = w;
        this.height = h;
        this._pixels = new Uint8ClampedArray(w * h * 4).fill(0);
        this._pw = w;
        this._ph = h;
      }

      getContext(/* type */) {
        const self = this;
        const parseColor = (value) => {
          const normalized = String(value || '#000000').trim().toLowerCase();
          if (normalized.startsWith('#')) {
            const hex = normalized.slice(1);
            if (hex.length === 3) {
              return [
                parseInt(hex[0] + hex[0], 16),
                parseInt(hex[1] + hex[1], 16),
                parseInt(hex[2] + hex[2], 16),
                255,
              ];
            }
            if (hex.length === 6) {
              return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16),
                255,
              ];
            }
          }
          return [0, 0, 0, 255];
        };
        const blit = (src, sw, sh, dx, dy, dw = sw, dh = sh) => {
          if (!src || !sw || !sh || !dw || !dh) return;
          const target = self._pixels;
          for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
              const sx = Math.min(sw - 1, Math.max(0, Math.floor((x / dw) * sw)));
              const sy = Math.min(sh - 1, Math.max(0, Math.floor((y / dh) * sh)));
              const srcIndex = (sy * sw + sx) * 4;
              const tx = dx + x;
              const ty = dy + y;
              if (tx < 0 || ty < 0 || tx >= self._pw || ty >= self._ph) continue;
              const dstIndex = (ty * self._pw + tx) * 4;
              target[dstIndex] = src[srcIndex];
              target[dstIndex + 1] = src[srcIndex + 1];
              target[dstIndex + 2] = src[srcIndex + 2];
              target[dstIndex + 3] = src[srcIndex + 3];
            }
          }
        };
        const ctx = {
          fillStyle: '#000000',
          translate() {},
          scale() {},
          fillRect(x, y, w, h) {
            const [r, g, b, a] = parseColor(ctx.fillStyle);
            for (let iy = Math.max(0, y); iy < Math.min(self._ph, y + h); iy++) {
              for (let ix = Math.max(0, x); ix < Math.min(self._pw, x + w); ix++) {
                const di = (iy * self._pw + ix) * 4;
                self._pixels[di] = r;
                self._pixels[di + 1] = g;
                self._pixels[di + 2] = b;
                self._pixels[di + 3] = a;
              }
            }
          },
          clearRect(x, y, w, h) {
            for (let iy = Math.max(0, y); iy < Math.min(self._ph, y + h); iy++) {
              for (let ix = Math.max(0, x); ix < Math.min(self._pw, x + w); ix++) {
                const di = (iy * self._pw + ix) * 4;
                self._pixels[di] = 0;
                self._pixels[di + 1] = 0;
                self._pixels[di + 2] = 0;
                self._pixels[di + 3] = 0;
              }
            }
          },
          drawImage(source, dx = 0, dy = 0, dw, dh) {
            const srcPixels = source?.data || source?._pixels || source?.image?.data || null;
            const sw = source?.width || source?.image?.width || source?._pw || 0;
            const sh = source?.height || source?.image?.height || source?._ph || 0;
            blit(srcPixels, sw, sh, dx, dy, dw ?? sw, dh ?? sh);
          },
          putImageData(imgData, _dx, _dy) {
            self._pixels = imgData.data;
            self._pw = imgData.width;
            self._ph = imgData.height;
          },
          getImageData(sx, sy, sw, sh) {
            const data = new Uint8ClampedArray(sw * sh * 4);
            for (let y = 0; y < sh; y++) {
              for (let x = 0; x < sw; x++) {
                const tx = sx + x;
                const ty = sy + y;
                const srcIndex = (ty * self._pw + tx) * 4;
                const dstIndex = (y * sw + x) * 4;
                data[dstIndex] = self._pixels[srcIndex] ?? 0;
                data[dstIndex + 1] = self._pixels[srcIndex + 1] ?? 0;
                data[dstIndex + 2] = self._pixels[srcIndex + 2] ?? 0;
                data[dstIndex + 3] = self._pixels[srcIndex + 3] ?? 0;
              }
            }
            return new ImageData(data, sw, sh);
          },
        };
        return ctx;
      }

      convertToBlob({ type = 'image/png' } = {}) {   // eslint-disable-line no-unused-vars
        const w  = this._pw;
        const h  = this._ph;
        const px = this._pixels ?? new Uint8ClampedArray(w * h * 4).fill(255);
        const pngData = encodePNG(w, h, px);
        return Promise.resolve(new Blob([pngData], { type: 'image/png' }));
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4.  Low-level noise / math helpers
// ═══════════════════════════════════════════════════════════════════════════════
function u32(n) { return n >>> 0; }

/** Integer hash → float in [0, 1) */
function hash2(x, y) {
  let h = u32((u32(x * 1619) ^ u32(y * 31337)));
  h = u32(Math.imul(h ^ (h >>> 16), 0x45d9f3b));
  h = u32(Math.imul(h ^ (h >>> 16), 0x45d9f3b));
  h = h ^ (h >>> 16);
  return u32(h) / 0xffffffff;
}

/** Smooth value noise – px,py in noise-space (pixels × frequency) */
function valueNoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix & 255,       iy & 255);
  const b = hash2((ix + 1) & 255, iy & 255);
  const c = hash2(ix & 255,       (iy + 1) & 255);
  const d = hash2((ix + 1) & 255, (iy + 1) & 255);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) +
         c * (1 - sx) * sy       + d * sx * sy;
}

/** Fractional Brownian Motion (multi-octave noise), output in [0,1] */
function fbm(x, y, scale, octaves = 4) {
  let val = 0, amp = 0.5, freq = 1 / scale;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise(x * freq, y * freq) * amp;
    amp  *= 0.5;
    freq *= 2;
  }
  return Math.max(0, Math.min(1, val));
}

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp  = (a, b, t) => a + (b - a) * t;

// ═══════════════════════════════════════════════════════════════════════════════
// 5.  DataTexture factory
// ═══════════════════════════════════════════════════════════════════════════════
function makeDataTex(width, height, fillFn, wrapS = THREE.RepeatWrapping, wrapT = THREE.RepeatWrapping) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fillFn(x, y, width, height);
      data[i]     = clamp(Math.round(r), 0, 255);
      data[i + 1] = clamp(Math.round(g), 0, 255);
      data[i + 2] = clamp(Math.round(b), 0, 255);
      data[i + 3] = clamp(Math.round(a), 0, 255);
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  return tex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6.  Procedural textures  (128×128 unless noted)
// ═══════════════════════════════════════════════════════════════════════════════

/** Woodland BDU military camouflage */
function genCamo() {
  return makeDataTex(128, 128, (x, y) => {
    const n1 = fbm(x, y,       32, 3);
    const n2 = fbm(x + 73, y + 29, 18, 2);
    const v  = n1 * 0.65 + n2 * 0.35;
    const grain = (hash2(x, y) - 0.5) * 14;
    let r, g, b;
    if      (v < 0.27) { r = 42;  g = 55;  b = 32;  }  // dark shadow
    else if (v < 0.47) { r = 63;  g = 79;  b = 43;  }  // forest green
    else if (v < 0.67) { r = 96;  g = 79;  b = 49;  }  // earth brown
    else               { r = 126; g = 111; b = 73;  }  // sand tan
    return [r + grain, g + grain * 0.9, b + grain * 0.5, 255];
  });
}

/** Dark tactical gear — close woven fabric */
function genGear() {
  return makeDataTex(64, 64, (x, y) => {
    const onWarp = (x % 4) === 0;
    const onWeft = (y % 4) === 0;
    const thread = onWarp || onWeft;
    const base   = thread ? 36 : 52;
    const grain  = (hash2(x, y) - 0.5) * 9;
    return [base + grain, base + grain, base * 0.78 + grain, 255];
  });
}

/** Brushed steel / gunmetal — weapon bodies & frames */
function genMetalGrey() {
  return makeDataTex(128, 64, (x, y) => {
    const brush = valueNoise(x * 0.05, y * 4.0) * 22;
    const grain = (hash2(x, y) - 0.5) * 16;
    const panel = ((x % 32) < 2 || (y % 16) < 1) ? -35 : 0;
    const base  = 128 + brush + grain + panel;
    return [base, base, base + 4, 255];
  });
}

/** Dark gunmetal — barrels, rails, dark metal parts */
function genMetalDark() {
  return makeDataTex(64, 64, (x, y) => {
    const grain = (hash2(x * 3, y * 3) - 0.5) * 12;
    const brush = valueNoise(x * 0.1, y * 6.0) * 8;
    const base  = 58 + grain + brush;
    return [base, base, base + 5, 255];
  });
}

/** Riveted aircraft aluminium panels */
function genRivetMetal() {
  return makeDataTex(128, 128, (x, y) => {
    const rx = x % 32, ry = y % 32;
    const isRivet = (rx === 4 || rx === 27) && (ry === 4 || ry === 27);
    const isPanelLine = (x % 32) < 2 || (y % 32) < 2;
    const grain = (hash2(x, y) - 0.5) * 10;
    const base  = 188 + grain;
    const dark  = isPanelLine ? -55 : isRivet ? -75 : 0;
    return [base + dark, base + dark, base + dark, 255];
  });
}

/** Olive-drab metal — bomber fuselage panels */
function genOliveMetal() {
  return makeDataTex(128, 128, (x, y) => {
    const rx = x % 40, ry = y % 24;
    const isRivet = (rx === 4 || rx === 35) && (ry === 3 || ry === 20);
    const isPanelLine = (x % 40) < 2 || (y % 24) < 1;
    const n = fbm(x + 300, y + 300, 40, 2) * 12;
    const grain = (hash2(x + 100, y + 100) - 0.5) * 8;
    const base  = 75 + n + grain;
    const dark  = isPanelLine ? -30 : isRivet ? -40 : 0;
    const r = base + dark;
    const g = base * 1.05 + dark;
    const b = base * 0.55 + dark;
    return [r, g, b, 255];
  });
}

/** Reptile scale pattern — layered armored plates with deep grooves and vein-like highlights */
function genScales() {
  return makeDataTex(256, 256, (x, y) => {
    // Primary hex scale grid — larger, sharper
    const row  = Math.floor(y / 18);
    const offX = (row % 2) * 12;
    const sx   = ((x + offX) % 24) - 12;
    const sy   = (y % 18) - 9;
    const dist = Math.sqrt(sx * sx + sy * sy * 1.5);
    const edge = dist > 7.5 ? clamp((dist - 7.5) / 1.2, 0, 1) : 0;
    // Sub-scale micro detail
    const row2  = Math.floor(y / 7);
    const offX2 = (row2 % 2) * 4;
    const sx2   = ((x + offX2) % 8) - 4;
    const sy2   = (y % 7) - 3.5;
    const dist2 = Math.sqrt(sx2 * sx2 + sy2 * sy2 * 1.8);
    const micro = dist2 > 2.8 ? clamp((dist2 - 2.8) / 0.8, 0, 1) * 0.18 : 0;
    // Noise layers for organic variation
    const n1    = fbm(x, y, 28, 5) * 30;
    const n2    = valueNoise(x / 8, y / 8) * 12;
    const grain = (hash2(x + 200, y + 200) - 0.5) * 9;
    // Vein network — dark red threads in the grooves
    const veinNoise = fbm(x + 77, y + 33, 12, 3);
    const vein = (veinNoise > 0.58 && edge > 0.3) ? 0.6 : 0;
    // Scar tissue — rare bright streaks
    const scar = (fbm(x + 444, y + 222, 8, 2) > 0.78) ? 18 : 0;
    const base = 48 + n1 + n2 + grain + scar;
    const lit  = base * (1 - edge * 0.82 - micro);
    const r = lit * 0.62 + vein * 35;
    const g = lit * 0.78;
    const b = lit * 0.42 + vein * 8;
    return [r, g, b, 255];
  });
}

/** Organic hide — thick wrinkled skin with veins, pustules, and wet membrane texture */
function genOrganicSkin() {
  return makeDataTex(256, 256, (x, y) => {
    // Multi-octave skin folds
    const n1 = fbm(x, y, 20, 5);
    const n2 = fbm(x + 99, y + 99, 10, 3);
    // Deep wrinkle network
    const wrinkle1 = Math.abs(Math.sin(x * 0.14 + n1 * 6.0)) * 0.5;
    const wrinkle2 = Math.abs(Math.sin(y * 0.11 + n2 * 5.0)) * 0.4;
    const wrinkleDepth = Math.max(wrinkle1, wrinkle2);
    // Vein network — branching dark lines
    const veinN = fbm(x + 177, y + 311, 9, 4);
    const vein = veinN > 0.62 ? (veinN - 0.62) / 0.38 : 0;
    // Pustule / bump clusters
    const pustX = ((x + 3) % 22) - 11;
    const pustY = ((y + 7) % 28) - 14;
    const pustDist = Math.sqrt(pustX * pustX + pustY * pustY);
    const pustule = (pustDist < 4 && fbm(x + 555, y + 555, 14, 2) > 0.65) ? 0.35 : 0;
    // Pore micro-grain
    const grain = (hash2(x + 500, y + 500) - 0.5) * 18;
    const spot = valueNoise(x / 6, y / 6) > 0.75 ? 0.55 : 1.0;
    const base = lerp(62, 145, n1 * 0.6 + n2 * 0.4) * spot;
    const lit = base * (1 - wrinkleDepth * 0.5);
    const highlight = wrinkleDepth < 0.18 ? 14 : 0;
    const r = lit * 0.98 + vein * 56 + pustule * 42 + grain + highlight;
    const g = lit * 0.66 - vein * 10 + grain * 0.8 + highlight * 0.5;
    const b = lit * 0.42 - vein * 6 + grain * 0.45;
    return [r, g, b, 255];
  });
}

/** Chitin plates — cracked exoskeleton with acid seep, deep grooves, reflective facets */
function genChitin() {
  return makeDataTex(256, 256, (x, y) => {
    // Large plate segments
    const seg    = valueNoise(x / 22, y / 22);
    const segEdge = Math.abs(seg - 0.5) < 0.04 ? 1.0 : 0;
    // Multi-scale noise for surface variation
    const n1 = fbm(x, y, 24, 5);
    const n2 = fbm(x + 88, y + 88, 11, 3) * 14;
    // Crack network — jagged fracture lines
    const crackN = fbm(x + 333, y + 111, 7, 4);
    const crack = (crackN > 0.64 && crackN < 0.68) ? 1.0 : 0;
    // Acid / ichor seeping through cracks
    const acidSeep = crack * (fbm(x + 222, y + 444, 14, 2) > 0.4 ? 1.0 : 0.3);
    // Surface micro-scratches
    const scratch = (hash2(x * 3 + 700, y + 700) > 0.955) ? 34 : 0;
    // Facet highlight — makes chitin look glassy in spots
    const facet = (fbm(x + 600, y + 600, 18, 2) > 0.69) ? 26 : 0;
    const grain = (hash2(x + 700, y + 700) - 0.5) * 14;
    const base = 52 + n1 * 54 + n2 * 1.2 + grain + seg * 22;
    const dark = base * (1 - segEdge * 0.78 - crack * 0.72);
    const r = dark * 0.62 + scratch + facet + acidSeep * 8;
    const g = dark * 0.52 + scratch * 0.72 + acidSeep * 44;
    const b = dark * 0.28 + scratch * 0.34 + acidSeep * 12;
    return [r, g, b, 255];
  });
}

/** Feathers — ragged battle-worn plumage with blood-tipped quills and molting scars */
function genFeathers() {
  return makeDataTex(256, 256, (x, y) => {
    // Rachis (quill shaft) — diagonal lines
    const angle = 0.35;
    const rach = Math.abs(Math.sin((x * Math.cos(angle) + y * Math.sin(angle)) * 0.28));
    const rachis = rach < 0.06 ? 0.35 : 1.0;
    // Barb lines — irregular spacing
    const barbSpace = 5 + Math.floor(valueNoise(x / 30, y / 30) * 4);
    const barb = (y % barbSpace) < 1 ? 0.42 : 1.0;
    // Ragged/torn edges — some barbs missing
    const torn = fbm(x + 444, y + 111, 8, 3) > 0.74 ? 0.55 : 1.0;
    // Multi-octave noise
    const n = fbm(x, y, 18, 5) * 0.5 + 0.5;
    // Blood/red tips on damaged feathers
    const bloodN = fbm(x + 666, y + 333, 11, 2);
    const blood = (bloodN > 0.72 && y < 60) ? (bloodN - 0.72) / 0.28 : 0;
    // Molt patches — bare/raw skin showing through
    const molt = fbm(x + 888, y + 555, 16, 2) > 0.8 ? 0.4 : 0;
    const grain = (hash2(x + 900, y) - 0.5) * 18;
    const base = lerp(56, 146, n) * barb * rachis * torn;
    const highlight = rach < 0.035 ? 20 : 0;
    const r = base * 0.64 + grain + blood * 60 + molt * 34 + highlight;
    const g = base * 0.54 + grain * 0.84 - blood * 10 + highlight * 0.55;
    const b = base * 0.30 + grain * 0.55 - blood * 8 + highlight * 0.22;
    return [r, g, b, 255];
  });
}

/** Grey concrete — base structures */
function genConcrete() {
  return makeDataTex(128, 128, (x, y) => {
    const n     = fbm(x, y, 26, 4);
    const grain = (hash2(x * 2, y * 2) - 0.5) * 16;
    // Crack network on a 48×64 tile
    const cx = x % 48, cy = y % 64;
    const crack = (cx === 0 && cy > 6 && cy < 57) || (cy === 0 && cx > 4 && cx < 43) ? -58 : 0;
    const base  = 138 + n * 42 + grain + crack;
    return [base, base, base * 0.94, 255];
  });
}

/** Corrugated metal sheet — horizontal ripple with rust patches */
function genCorrugated() {
  return makeDataTex(128, 128, (x, y) => {
    const wave  = (Math.sin((y % 14) / 14 * Math.PI * 2) * 0.5 + 0.5) * 38;
    const grain = (hash2(x + 300, y + 300) - 0.5) * 12;
    const rust  = fbm(x + 200, y + 200, 28, 2) > 0.62 ? -14 : 0;
    const base  = 108 + wave + grain + rust;
    return [base, base * 0.93, base * 0.82, 255];
  });
}

/** Rusty / worn metal — aged structures & props */
function genRust() {
  return makeDataTex(128, 128, (x, y) => {
    const n       = fbm(x, y, 22, 3);
    const isRust  = fbm(x + 111, y + 77, 18, 2) > 0.44;
    const grain   = (hash2(x + 400, y + 400) - 0.5) * 13;
    if (isRust) {
      const r = lerp(128, 178, n) + grain;
      const g = lerp(52,  78,  n) + grain;
      const b = lerp(18,  38,  n) + grain;
      return [r, g, b, 255];
    } else {
      const m = lerp(78, 118, n) + grain;
      return [m, m, m, 255];
    }
  });
}

/** Wood grain — crates & props */
function genWood() {
  return makeDataTex(128, 128, (x, y) => {
    const ring  = Math.sin((x + valueNoise(x / 30, y / 30) * 20) * 0.18) * 0.5 + 0.5;
    const grain = (hash2(x * 2 + 600, y * 2 + 600) - 0.5) * 8;
    const base  = lerp(75, 125, ring) + grain;
    return [base * 1.0, base * 0.72, base * 0.38, 255];
  });
}

/** Plasma / ion energy — command effects */
function genPlasma() {
  return makeDataTex(128, 128, (x, y) => {
    const n1 = fbm(x, y,       16, 4);
    const n2 = fbm(x + 55, y + 33, 9, 3);
    const v  = n1 * 0.62 + n2 * 0.38;
    const bright = v > 0.68 ? (v - 0.68) / 0.32 : 0;
    const r = lerp(0,   175, bright);
    const g = lerp(90,  220, v);
    const b = lerp(195, 255, v);
    return [r, g, b, Math.round(195 + bright * 60)];
  });
}

/** Fire gradient — firestorm command effect */
function genFire() {
  return makeDataTex(128, 128, (x, y) => {
    const yf   = 1.0 - (y / 128);          // 0=top(cool) 1=bottom(hot)
    const turb = fbm(x, y, 13, 3) * 0.28;
    const v    = clamp(yf + turb - 0.08, 0, 1);
    if (v > 0.70) return [255, 240, lerp(80, 200, (v - 0.70) / 0.30), 255];
    if (v > 0.42) return [255, Math.round(lerp(60, 240, (v - 0.42) / 0.28)), 15, 245];
    if (v > 0.16) return [195, 35, 8, 210];
    return [55, 8, 4, Math.round(80 + v * 600)];
  });
}

/** Scorch / heat damage ground mark */
function genScorch() {
  return makeDataTex(128, 128, (x, y) => {
    const cx = x - 64, cy = y - 64;
    const d  = Math.sqrt(cx * cx + cy * cy) / 64;
    const n  = fbm(x, y, 14, 3) * 0.3;
    const v  = clamp(1 - d + n, 0, 1);
    const base = Math.round(v * v * 90);
    return [base * 0.4, base * 0.3, base * 0.2, 255];
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7.  Export texture cache  (created lazily on first import)
// ═══════════════════════════════════════════════════════════════════════════════
function buildTextures() {
  const t = {};
  t.CAMO          = genCamo();          t.CAMO.repeat.set(4, 4);
  t.GEAR          = genGear();          t.GEAR.repeat.set(8, 8);
  t.METAL_GREY    = genMetalGrey();     t.METAL_GREY.repeat.set(3, 3);
  t.METAL_DARK    = genMetalDark();     t.METAL_DARK.repeat.set(4, 4);
  t.RIVET_METAL   = genRivetMetal();    t.RIVET_METAL.repeat.set(3, 3);
  t.OLIVE_METAL   = genOliveMetal();    t.OLIVE_METAL.repeat.set(3, 3);
  t.SCALES        = genScales();        t.SCALES.repeat.set(3, 3);
  t.ORGANIC_SKIN  = genOrganicSkin();   t.ORGANIC_SKIN.repeat.set(3, 3);
  t.CHITIN        = genChitin();        t.CHITIN.repeat.set(3, 3);
  t.FEATHERS      = genFeathers();      t.FEATHERS.repeat.set(4, 4);
  t.CONCRETE      = genConcrete();      t.CONCRETE.repeat.set(3, 3);
  t.CORRUGATED    = genCorrugated();    t.CORRUGATED.repeat.set(2, 4);
  t.RUST          = genRust();          t.RUST.repeat.set(2, 2);
  t.WOOD          = genWood();          t.WOOD.repeat.set(2, 2);
  t.PLASMA        = genPlasma();        t.PLASMA.repeat.set(2, 2);
  t.FIRE          = genFire();          t.FIRE.repeat.set(1, 1);
  t.SCORCH        = genScorch();        t.SCORCH.repeat.set(1, 1);
  return t;
}

export const textures = buildTextures();

// ═══════════════════════════════════════════════════════════════════════════════
// 8.  autoMap(hexColor) – heuristic texture selection by colour
// ═══════════════════════════════════════════════════════════════════════════════
const _hslCache = new Map();
const _autoMapCache = new Map();

function normalizeColorKey(colorValue) {
  if (!colorValue) return '';
  const color = colorValue instanceof THREE.Color ? colorValue : new THREE.Color(colorValue);
  return `#${color.getHexString()}`;
}

function getHSL(colorStr) {
  const key = normalizeColorKey(colorStr);
  if (_hslCache.has(key)) return _hslCache.get(key);
  const c = new THREE.Color(key);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  _hslCache.set(key, hsl);
  return hsl;
}

/**
 * Returns a DataTexture appropriate for the given CSS colour string,
 * or null if no obvious match (transparent, emissive effects, etc.).
 */
export function autoMap(colorStr) {
  if (!colorStr) return null;
  const key = normalizeColorKey(colorStr);
  if (_autoMapCache.has(key)) return _autoMapCache.get(key);

  const { h, s, l } = getHSL(key);
  let texture = null;

  // Very light (near-white highlights, glass)  →  no texture
  if (l > 0.80) {
    _autoMapCache.set(key, null);
    return null;
  }

  // Near black  →  subtle dark metal grain
  if (l < 0.08) texture = textures.METAL_DARK;

  // Near-achromatic (grey/silver)  →  metal
  if (!texture && s < 0.10) {
    texture = l < 0.34 ? textures.METAL_DARK : textures.METAL_GREY;
  }

  // Blue-grey (cool military metals — gun bluing, hardware, vehicle armor)
  if (!texture && h > 0.52 && h < 0.72 && s < 0.40) {
    texture = l < 0.32 ? textures.METAL_DARK : textures.METAL_GREY;
  }

  // Pure blue / cyan (laser effects, screens, plasma)  →  no texture
  if (!texture && h > 0.52 && h < 0.72) {
    _autoMapCache.set(key, null);
    return null;
  }

  // Olive / forest / khaki green  →  military camo
  if (!texture && h > 0.18 && h < 0.42 && s > 0.08) texture = textures.CAMO;

  // Warm saturated brown (wood grain range, medium lightness)
  if (!texture && h > 0.05 && h < 0.15 && s > 0.18 && s < 0.60 && l > 0.26 && l < 0.60) texture = textures.WOOD;

  // Earth brown / tan / desert sand  →  camo (BDU earth tones)
  if (!texture && h > 0.03 && h < 0.20 && l < 0.56) texture = textures.CAMO;

  // Very dark warm tones (near-black leather / rubber)  →  gear
  if (!texture && h < 0.06 && l < 0.28) texture = textures.GEAR;

  _autoMapCache.set(key, texture);
  return texture;
}
