// Cheap local speech detector, run on each squelched clip before paying for transcription.
// Decodes the voice band (300–3000 Hz), takes a 20 ms loudness envelope, and returns its spread
// (p90 − p10, in dB). Radio speech swings tens of dB between syllables and pauses; hiss, static and
// carrier hum stay within a couple of dB. Measured 2026-10-16: synthetic hiss/hum/carrier ≤ 2.3 dB,
// kept live speech median 61 dB (p5 3.2 dB). No model, no network — one ffmpeg decode per clip.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FRAME = 320; // 20 ms at 16 kHz

// Voice-band (300–3000 Hz) loudness envelope: one dB value per 20 ms frame.
async function envelope(file) {
  const { stdout } = await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', file,
    '-af', 'highpass=f=300,lowpass=f=3000', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
  { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const n = Math.floor(pcm.length / FRAME);
  const db = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += pcm[i] * pcm[i];
    db[f] = 10 * Math.log10(s / FRAME + 1);
  }
  return db;
}

export async function loudnessSpread(file) {
  const db = [...(await envelope(file))].sort((a, b) => a - b);
  const n = db.length;
  return n < 10 ? 0 : Number((db[Math.floor(n * 0.9)] - db[Math.floor(n * 0.1)]).toFixed(1));
}

// Spectrogram in 16 log-spaced bands (300–3400 Hz), 32 ms frames, dB. Small radix-2 FFT, no deps.
const N_FFT = 512, HOP = 512, BANDS = 16;
const HANN = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1)));
const EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((300 * (3400 / 300) ** (i / BANDS)) / (16000 / N_FFT)));
function fftPower(re) {
  const n = re.length, im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
  return re.map((r, i) => r * r + im[i] * im[i]);
}
async function bandSpectrogram(file) {
  const { stdout } = await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const frames = [];
  for (let off = 0; off + N_FFT <= pcm.length; off += HOP) {
    const buf = new Float64Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) buf[i] = pcm[off + i] * HANN[i];
    const p = fftPower(buf);
    const bands = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      for (let k = EDGES[b]; k < Math.max(EDGES[b] + 1, EDGES[b + 1]); k++) s += p[k];
      bands[b] = 10 * Math.log10(s + 1);
    }
    frames.push(bands);
  }
  return frames;
}

// Adaptive squelch: hum, carrier and static have a steady spectrum; a voice keeps reshaping it.
// For each band, the clip's own background is its 30th-percentile level; a frame is active when
// enough bands rise clearly above their background. Works even when the voice is no louder overall
// than the hum. Returns the regions to keep, in seconds, padded and merged across gaps between words.
export async function speechRegions(file, { bandExcessDb = 6, minBands = 4, minRun = 0.12, mergeGap = 0.6, pad = 0.2 } = {}) {
  const spec = await bandSpectrogram(file);
  const n = spec.length;
  const FRAME_SEC = HOP / 16000;
  const duration = n * FRAME_SEC;
  if (n < 10) return { floor: 0, regions: [], speech: 0, duration: Number(duration.toFixed(2)) };
  const floorBand = Array.from({ length: BANDS }, (_, b) => spec.map((f) => f[b]).sort((x, y) => x - y)[Math.floor(n * 0.3)]);
  const active = spec.map((f) => f.reduce((c, v, b) => c + (v > floorBand[b] + bandExcessDb ? 1 : 0), 0) >= minBands);
  const floor = floorBand.reduce((a, v) => a + v, 0) / BANDS;
  const runs = [];
  let start = -1;
  for (let f = 0; f <= n; f++) {
    const on = f < n && active[f];
    if (on && start < 0) start = f;
    if (!on && start >= 0) { if ((f - start) * FRAME_SEC >= minRun) runs.push([start * FRAME_SEC, f * FRAME_SEC]); start = -1; }
  }
  const regions = [];
  for (const [s, e] of runs) {
    const a = Math.max(0, s - pad), b = Math.min(duration, e + pad);
    const last = regions[regions.length - 1];
    if (last && a - last[1] <= mergeGap) last[1] = Math.max(last[1], b);
    else regions.push([a, b]);
  }
  const speech = regions.reduce((t, [a, b]) => t + (b - a), 0);
  return { floor: Number(floor.toFixed(1)), regions, speech: Number(speech.toFixed(2)), duration: Number(duration.toFixed(2)) };
}
