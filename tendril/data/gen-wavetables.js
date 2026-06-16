/**
 * TENDRIL — Wavetable Generator
 * =============================
 * Generates two single-cycle wavetable banks as 32-bit float mono WAV:
 *   tendril_wt_a.wav  (OSC A — "analog" leaning)
 *   tendril_wt_b.wav  (OSC B — "digital" leaning)
 *
 * Each file = 64 frames (a 4x4x4 cube) laid end to end.
 * Frame layout index:  f = xi + yi*4 + zi*16   (xi,yi,zi in 0..3)
 *   X axis = TONE   (brightness / harmonic count)
 *   Y axis = BODY   (odd/even harmonic balance: hollow <-> full)
 *   Z axis = AIR    (spectral tilt / shape: dark saw <-> bright formant)
 *
 * Every frame is built additively from band-limited sine partials and
 * peak-normalized, so there are NO silent or harsh frames — the cube is
 * "modulation-safe by construction" (you can morph anywhere and it's
 * always a full-bodied, anti-aliased single cycle). This is the whole
 * point: Stride can sweep TONE/BODY/AIR across the full range safely.
 *
 * Run:   node gen-wavetables.js
 * Output lands next to this file. Then point gen~ Buffer objects at them
 * (see ../BUILD-IN-MAX.md). FRAME and NFR here MUST match tendril_voice.genexpr.
 */

const fs = require('fs');
const path = require('path');

const SR     = 48000;   // sample rate written into the WAV header
const FRAME  = 2048;    // samples per single-cycle frame  (must match genexpr FRAME)
const NFR    = 4;       // cube edge -> 4*4*4 = 64 frames   (must match genexpr NFR)
const FRAMES = NFR * NFR * NFR;

// ─── build one single-cycle frame ──────────────────────────
// xi,yi,zi in 0..NFR-1. bank 0 = A (analog), 1 = B (digital).
function buildFrame(xi, yi, zi, bank) {
  const x = xi / (NFR - 1);   // 0..1 brightness
  const y = yi / (NFR - 1);   // 0..1 odd/even balance
  const z = zi / (NFR - 1);   // 0..1 tilt / shape

  // number of partials grows with brightness (kept band-limited: never
  // beyond Nyquist for the lowest musical note region — table itself is clean).
  const maxH = Math.max(2, Math.floor(2 + x * 62));

  const out = new Float32Array(FRAME);
  for (let n = 0; n < FRAME; n++) {
    const ph = (n / FRAME) * 2 * Math.PI;
    let s = 0;
    for (let h = 1; h <= maxH; h++) {
      const odd = (h % 2) === 1;

      // base saw-ish amplitude
      let amp = 1 / h;

      // BODY: fade evens out as y->0 (hollow/square-ish) up to full saw at y=1
      if (!odd) amp *= y;

      // AIR/tilt: z brightens (less roll-off) or darkens (more roll-off)
      const rolloff = Math.pow(0.5 + (1 - z) * 0.5, (h - 1) * 0.08);
      amp *= rolloff;

      // bank character:
      //  A (analog) = pure cosine-phase partials, slight even softening
      //  B (digital) = phase offsets per harmonic -> sharper/edgier spectrum
      let phase = 0;
      if (bank === 1) {
        phase = (h * h) * 0.013 * (0.4 + z);     // dispersive, metallic
        amp *= (0.6 + 0.4 * Math.cos(h * 0.7));  // comb-ish ripple
      } else {
        amp *= (1 - 0.10 * (h % 3 === 0 ? 1 : 0)); // gentle analog dip
      }

      s += amp * Math.sin(h * ph + phase);
    }
    out[n] = s;
  }

  // remove DC + peak normalize so every frame has equal, full level
  let mean = 0;
  for (let n = 0; n < FRAME; n++) mean += out[n];
  mean /= FRAME;
  let peak = 1e-9;
  for (let n = 0; n < FRAME; n++) { out[n] -= mean; peak = Math.max(peak, Math.abs(out[n])); }
  for (let n = 0; n < FRAME; n++) out[n] /= peak;

  return out;
}

// ─── assemble a bank (64 frames concatenated) ──────────────
function buildBank(bank) {
  const data = new Float32Array(FRAME * FRAMES);
  for (let zi = 0; zi < NFR; zi++)
    for (let yi = 0; yi < NFR; yi++)
      for (let xi = 0; xi < NFR; xi++) {
        const f = xi + yi * NFR + zi * NFR * NFR;   // matches genexpr indexing
        data.set(buildFrame(xi, yi, zi, bank), f * FRAME);
      }
  return data;
}

// ─── minimal 32-bit float mono WAV writer ──────────────────
function writeWavFloat32(filePath, samples, sampleRate) {
  const numSamples = samples.length;
  const dataBytes  = numSamples * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  let o = 0;
  const u32 = v => { buf.writeUInt32LE(v, o); o += 4; };
  const u16 = v => { buf.writeUInt16LE(v, o); o += 2; };
  const str = s => { buf.write(s, o, 'ascii'); o += s.length; };

  str('RIFF'); u32(36 + dataBytes); str('WAVE');
  str('fmt '); u32(16); u16(3);          // 3 = IEEE float
  u16(1);                                  // mono
  u32(sampleRate);
  u32(sampleRate * 4);                     // byte rate (1 ch * 4 bytes)
  u16(4);                                  // block align
  u16(32);                                 // bits per sample
  str('data'); u32(dataBytes);
  for (let i = 0; i < numSamples; i++) { buf.writeFloatLE(samples[i], o); o += 4; }

  fs.writeFileSync(filePath, buf);
  console.log(`wrote ${path.basename(filePath)}  (${numSamples} samples = ${FRAMES} frames x ${FRAME})`);
}

// ─── go ────────────────────────────────────────────────────
writeWavFloat32(path.join(__dirname, 'tendril_wt_a.wav'), buildBank(0), SR);
writeWavFloat32(path.join(__dirname, 'tendril_wt_b.wav'), buildBank(1), SR);
console.log('done. point gen~ Buffer "tendril_wt_a" / "tendril_wt_b" at these files.');
