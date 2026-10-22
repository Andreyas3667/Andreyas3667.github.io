/* CabaiScan core: synthetic leaf generator, colour + texture feature extraction, KNN.
   Pure JS on RGBA pixel arrays so it runs in the browser and in Node tests. */
(function (root) {
  "use strict";
  const SIZE = 128;

  // ---------- seeded random ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- colour helpers ----------
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }

  // ---------- synthetic leaves ----------
  // Classes modelled loosely on common chili (Capsicum) leaf conditions.
  const CLASSES = [
    { id: "healthy", name: "Healthy" },
    { id: "spot", name: "Leaf spot" },
    { id: "chlorosis", name: "Yellowing (chlorosis)" },
    { id: "mosaic", name: "Yellow mosaic / curl virus" },
  ];

  function makeLeaf(cls, seed) {
    const R = rng(seed);
    const px = new Uint8ClampedArray(SIZE * SIZE * 4);
    const cx = SIZE / 2 + (R() - 0.5) * 10, cy = SIZE / 2 + (R() - 0.5) * 10;
    const ang = (R() - 0.5) * 1.4;
    const len = 54 + R() * 8;
    const wid = cls === "mosaic" ? 19 + R() * 5 : 25 + R() * 6;
    const wave = cls === "mosaic" ? 2.5 + R() * 2.5 : R() * 0.8;
    const ca = Math.cos(ang), sa = Math.sin(ang);

    let base;
    if (cls === "chlorosis") base = [62 + R() * 14, 0.55 + R() * 0.15, 0.45 + R() * 0.08];
    else base = [100 + R() * 16, 0.42 + R() * 0.16, 0.27 + R() * 0.08];

    const spots = [];
    if (cls === "spot") {
      const n = 6 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) spots.push({ u: (R() - 0.5) * 1.5 * len, v: (R() - 0.5) * 1.1 * wid, r: 2 + R() * 4.5 });
    }
    const blot = [];
    if (cls === "mosaic") {
      const n = 14 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) blot.push({ u: (R() - 0.5) * 1.8 * len, v: (R() - 0.5) * 1.6 * wid, r: 4 + R() * 7 });
    }

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        const dx = x - cx, dy = y - cy;
        const u = dx * ca + dy * sa;      // along midrib
        const v = -dx * sa + dy * ca;     // across leaf
        const t = u / len;                // -1..1
        let half = wid * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.35 * Math.max(0, t)); // pointed tip
        half += wave * Math.sin(u * 0.35);
        const inside = Math.abs(t) <= 1 && Math.abs(v) <= half;
        if (!inside) {
          const n = 236 + R() * 14;
          px[i] = n; px[i + 1] = n; px[i + 2] = n - 2; px[i + 3] = 255;
          continue;
        }
        let [h, s, l] = base;
        // fine texture noise
        l += (R() - 0.5) * 0.05;
        // veins: midrib + laterals
        const lateral = Math.abs(Math.sin((u - Math.abs(v) * 0.9) * 0.42));
        if (Math.abs(v) < 1.1) l += 0.12;
        else if (lateral < 0.08) l += cls === "chlorosis" ? -0.12 : 0.05;
        if (cls === "chlorosis" && Math.abs(v) < 1.6) { h = 105; s = 0.45; l = 0.32; }
        for (const sp of spots) {
          const d = Math.hypot(u - sp.u, v - sp.v);
          if (d < sp.r) { h = 26 + R() * 8; s = 0.45; l = 0.22 + (d / sp.r) * 0.08; }
          else if (d < sp.r + 1.8) { h = 58; s = 0.6; l = 0.5; }
        }
        for (const b of blot) {
          const d = Math.hypot(u - b.u, v - b.v);
          if (d < b.r) { const k = 1 - d / b.r; h = h + (62 - h) * k; s = s + (0.65 - s) * k; l = l + (0.5 - l) * k; }
        }
        const [r, g, bb] = hsl2rgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
        px[i] = r; px[i + 1] = g; px[i + 2] = bb; px[i + 3] = 255;
      }
    }
    return px;
  }

  // ---------- resizing (for user photos) ----------
  // src: {data,width,height}; returns SIZE x SIZE RGBA via area averaging (cover crop to square).
  function toSquare(src) {
    const { data, width: w, height: h } = src;
    const side = Math.min(w, h), ox = (w - side) / 2, oy = (h - side) / 2;
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    const step = side / SIZE;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const x0 = Math.floor(ox + x * step), y0 = Math.floor(oy + y * step);
      const x1 = Math.max(x0 + 1, Math.floor(ox + (x + 1) * step)), y1 = Math.max(y0 + 1, Math.floor(oy + (y + 1) * step));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) for (let xx = x0; xx < x1 && xx < w; xx++) {
        const j = (yy * w + xx) * 4; r += data[j]; g += data[j + 1]; b += data[j + 2]; n++;
      }
      const o = (y * SIZE + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    return out;
  }

  // ---------- segmentation ----------
  // Leaf vs background: background is bright & unsaturated, or very dark.
  function segment(px) {
    const n = SIZE * SIZE, mask = new Uint8Array(n);
    let count = 0;
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const [, s, v] = rgb2hsv(px[i], px[i + 1], px[i + 2]);
      const exg = 2 * px[i + 1] - px[i] - px[i + 2];
      const bg = (s < 0.16 && v > 0.62) || v < 0.08;
      if (!bg && (s > 0.18 || exg > 12)) { mask[p] = 1; count++; }
    }
    if (count < n * 0.04) { mask.fill(1); count = n; } // fall back to whole image
    return { mask, coverage: count / n };
  }

  // ---------- features ----------
  const H_BINS = 12, S_BINS = 4, V_BINS = 4, GL = 16;
  const FEATURE_NAMES = [];
  for (let b = 0; b < H_BINS; b++) FEATURE_NAMES.push(`Hue ${b * 30}–${b * 30 + 30}°`);
  for (let b = 0; b < S_BINS; b++) FEATURE_NAMES.push(`Saturation bin ${b + 1}`);
  for (let b = 0; b < V_BINS; b++) FEATURE_NAMES.push(`Value bin ${b + 1}`);
  FEATURE_NAMES.push("Mean hue", "Std hue", "Mean saturation", "Std saturation", "Mean value", "Std value");
  FEATURE_NAMES.push("GLCM contrast", "GLCM dissimilarity", "GLCM homogeneity", "GLCM energy", "GLCM entropy", "GLCM correlation");
  const COLOR_IDX = FEATURE_NAMES.map((_, i) => i).filter((i) => i < 26);
  const TEXTURE_IDX = FEATURE_NAMES.map((_, i) => i).filter((i) => i >= 26);

  function extract(px) {
    const { mask, coverage } = segment(px);
    const n = SIZE * SIZE;
    const hH = new Float64Array(H_BINS), hS = new Float64Array(S_BINS), hV = new Float64Array(V_BINS);
    let cnt = 0, sh = 0, sh2 = 0, ss = 0, ss2 = 0, sv = 0, sv2 = 0;
    const gray = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      gray[p] = Math.min(GL - 1, Math.floor(((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 256) * GL));
      if (!mask[p]) continue;
      const [h, s, v] = rgb2hsv(px[i], px[i + 1], px[i + 2]);
      hH[Math.min(H_BINS - 1, Math.floor(h / 30))]++;
      hS[Math.min(S_BINS - 1, Math.floor(s * S_BINS))]++;
      hV[Math.min(V_BINS - 1, Math.floor(v * V_BINS))]++;
      const hn = h / 360;
      sh += hn; sh2 += hn * hn; ss += s; ss2 += s * s; sv += v; sv2 += v * v; cnt++;
    }
    const f = [];
    for (const arr of [hH, hS, hV]) for (const x of arr) f.push(x / cnt);
    const m = (a) => a / cnt, sd = (a, a2) => Math.sqrt(Math.max(0, a2 / cnt - (a / cnt) ** 2));
    f.push(m(sh), sd(sh, sh2), m(ss), sd(ss, ss2), m(sv), sd(sv, sv2));

    // GLCM over 4 directions, symmetric, masked pairs only
    const offs = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    const acc = [0, 0, 0, 0, 0, 0];
    const glcm = new Float64Array(GL * GL);
    for (const [dx, dy] of offs) {
      glcm.fill(0); let tot = 0;
      for (let y = 0; y < SIZE - dy; y++) for (let x = Math.max(0, -dx); x < SIZE - Math.max(0, dx); x++) {
        const p = y * SIZE + x, q = (y + dy) * SIZE + (x + dx);
        if (!mask[p] || !mask[q]) continue;
        const a = gray[p], b = gray[q];
        glcm[a * GL + b]++; glcm[b * GL + a]++; tot += 2;
      }
      if (!tot) continue;
      let con = 0, dis = 0, hom = 0, asm = 0, ent = 0, mi = 0, mj = 0;
      for (let a = 0; a < GL; a++) for (let b = 0; b < GL; b++) {
        const pv = glcm[a * GL + b] / tot; if (!pv) continue;
        const d = a - b;
        con += pv * d * d; dis += pv * Math.abs(d); hom += pv / (1 + d * d); asm += pv * pv; ent -= pv * Math.log2(pv);
        mi += a * pv; mj += b * pv;
      }
      let vi = 0, vj = 0, cov = 0;
      for (let a = 0; a < GL; a++) for (let b = 0; b < GL; b++) {
        const pv = glcm[a * GL + b] / tot; if (!pv) continue;
        vi += pv * (a - mi) ** 2; vj += pv * (b - mj) ** 2; cov += pv * (a - mi) * (b - mj);
      }
      const corr = vi > 0 && vj > 0 ? cov / Math.sqrt(vi * vj) : 1;
      acc[0] += con; acc[1] += dis; acc[2] += hom; acc[3] += Math.sqrt(asm); acc[4] += ent; acc[5] += corr;
    }
    for (const x of acc) f.push(x / offs.length);
    return { features: f, mask, coverage };
  }

  // ---------- KNN ----------
  function stats(samples, idx) {
    const mu = idx.map(() => 0), sd = idx.map(() => 0);
    for (const s of samples) idx.forEach((k, j) => (mu[j] += s.features[k]));
    mu.forEach((_, j) => (mu[j] /= samples.length));
    for (const s of samples) idx.forEach((k, j) => (sd[j] += (s.features[k] - mu[j]) ** 2));
    sd.forEach((_, j) => (sd[j] = Math.sqrt(sd[j] / samples.length) || 1));
    return { mu, sd };
  }
  function featureIdx(set) { return set === "color" ? COLOR_IDX : set === "texture" ? TEXTURE_IDX : COLOR_IDX.concat(TEXTURE_IDX); }

  function classify(samples, features, k, set) {
    const idx = featureIdx(set);
    const { mu, sd } = stats(samples, idx);
    const z = (f) => idx.map((kk, j) => (f[kk] - mu[j]) / sd[j]);
    const q = z(features);
    const ranked = samples.map((s) => {
      const zs = z(s.features);
      let d = 0; for (let j = 0; j < q.length; j++) d += (q[j] - zs[j]) ** 2;
      return { sample: s, dist: Math.sqrt(d) };
    }).sort((a, b) => a.dist - b.dist);
    const nn = ranked.slice(0, Math.min(k, ranked.length));
    const votes = {};
    nn.forEach((r) => { votes[r.sample.label] = (votes[r.sample.label] || 0) + 1; });
    const best = Math.max(...Object.values(votes));
    const tied = Object.keys(votes).filter((l) => votes[l] === best);
    const label = tied.length === 1 ? tied[0] : nn.find((r) => tied.includes(r.sample.label)).sample.label; // tie -> nearest
    return { label, confidence: best / nn.length, votes, neighbors: nn };
  }

  function loocv(samples, k, set, labels) {
    const conf = {}; labels.forEach((a) => { conf[a] = {}; labels.forEach((b) => (conf[a][b] = 0)); });
    let ok = 0;
    samples.forEach((s, i) => {
      const rest = samples.filter((_, j) => j !== i);
      const r = classify(rest, s.features, k, set);
      conf[s.label][r.label]++; if (r.label === s.label) ok++;
    });
    return { accuracy: samples.length ? ok / samples.length : 0, confusion: conf };
  }

  const api = { SIZE, CLASSES, FEATURE_NAMES, COLOR_IDX, TEXTURE_IDX, rng, rgb2hsv, makeLeaf, toSquare, segment, extract, classify, loocv };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CabaiCore = api;
})(typeof window !== "undefined" ? window : globalThis);
