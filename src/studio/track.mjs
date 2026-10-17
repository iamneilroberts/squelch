// The story's sound: its real clips in order (up to ~75 s of radio), with short gaps, as one MP3,
// plus the timing that captions and pictures hang on.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { station } from '../config.mjs';

const run = promisify(execFile);
const MAX_RADIO = 75, GAP = 0.6;

const duration = async (f) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).stdout);
export const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: station.timezone, hour: 'numeric', minute: '2-digit' });

// The clips that fit: whole transmissions in order until ~75 s, the first trimmed if it alone runs longer.
export async function pickClips(thread) {
  const out = [];
  let radio = 0;
  for (const e of thread.events) {
    const file = e.audio && join('data', 'audio', e.audio);
    if (!file || !existsSync(file)) continue;
    const d = await duration(file);
    if (!(d > 0.3)) continue;
    if (out.length && radio + d > MAX_RADIO) break;
    out.push({ file, dur: Math.min(d, MAX_RADIO), at: e.at, clock: clock(e.at), transcript: e.transcript || '', note: e.note || '' });
    radio += d;
  }
  return out;
}

// Writes the MP3 and returns { clips: [{ start, dur, clock, … }], end (after the last clip), total }.
export async function buildTrack(clips, out, { intro = 0.5, tail = 4.5 } = {}) {
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-t', String(intro), '-i', 'anullsrc=r=22050:cl=mono'];
  let t = intro;
  const timed = clips.map((c, i) => {
    args.push('-t', c.dur.toFixed(3), '-i', c.file);
    const start = +t.toFixed(3);
    t += c.dur + (i < clips.length - 1 ? GAP : 0);
    return { ...c, start };
  });
  args.push('-f', 'lavfi', '-t', String(tail), '-i', 'anullsrc=r=22050:cl=mono');
  // Every input to one rate and layout; each clip but the last is followed by the gap.
  const n = clips.length + 2;
  const norm = [...Array(n).keys()].map((i) => `[${i}:a]aresample=22050,aformat=sample_fmts=fltp:channel_layouts=mono${i >= 1 && i < n - 2 ? `,apad=pad_dur=${GAP}` : ''}[a${i}];`).join('');
  args.push('-filter_complex', `${norm}${[...Array(n).keys()].map((i) => `[a${i}]`).join('')}concat=n=${n}:v=0:a=1[out]`,
    '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '64k', out);
  await run('ffmpeg', args);
  return { clips: timed.map(({ file, ...c }) => c), end: +t.toFixed(3), total: +(t + tail).toFixed(3) };
}

// Caption lines spread across their clip, in proportion to their length: [[from, to, text], …].
export function timeCaptions(clips, linesPerClip) {
  const caps = [];
  clips.forEach((c, i) => {
    const lines = (linesPerClip[i] || []).filter(Boolean);
    const w = lines.map((l) => l.length + 6), sum = w.reduce((a, b) => a + b, 0);
    let t = c.start;
    lines.forEach((l, j) => { const d = (c.dur * w[j]) / sum; caps.push([+t.toFixed(2), +(t + d).toFixed(2), l]); t += d; });
  });
  return caps;
}

// A last net under the script's own rules: no callsigns, plates, phone or house numbers (3+ digits).
export const scrub = (s) => String(s).replace(/\b\d{3,}\b/g, '').replace(/\s+([,.!?…])/g, '$1').replace(/\s{2,}/g, ' ').trim();
