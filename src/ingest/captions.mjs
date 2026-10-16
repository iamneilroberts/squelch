// Closed captions for a recorded clip. Transcripts carry no timings, so the caption lines are laid
// over the parts of the clip that actually contain voice (the squelch's spectral speech regions),
// each line getting time in proportion to its length. Good enough to follow along; not word-exact.
import { speechRegions } from './vad.mjs';

const MAX_LINE = 42; // characters per caption line

export async function buildCues(file, transcript) {
  const words = String(transcript || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const { regions, duration } = await speechRegions(file);
  const spans = regions.length ? regions : [[0, duration]];
  const voiced = spans.reduce((a, [s, e]) => a + (e - s), 0) || duration;

  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && `${cur} ${w}`.length > MAX_LINE) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);

  // Map a position on the voiced-only timeline back to clip time.
  const clipTime = (v) => {
    for (const [s, e] of spans) { if (v <= e - s) return s + v; v -= e - s; }
    return spans[spans.length - 1][1];
  };
  const chars = lines.reduce((a, l) => a + l.length, 0);
  let v = 0;
  return lines.map((text) => {
    const d = (voiced * text.length) / chars;
    const cue = { start: round(clipTime(v)), end: round(Math.max(clipTime(v + d), clipTime(v) + 0.4)), text };
    v += d;
    return cue;
  });
}

const round = (x) => Math.round(x * 100) / 100;
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n')}`;
}
