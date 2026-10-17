// Scan as one continuous MP3 stream. A phone keeps playing a stream with the screen locked but stops
// the page's own timers, so a scan that hops between clip files goes quiet after the first one. Here the
// server does the scanning for each listening page: it queues new transmissions from that page's
// channels, writes their MP3 frames at playing speed with silence frames between, and announces where
// in the stream each one starts, so the page can show what's on air.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { bus } from './ingest/pipeline.mjs';
import { scanCall, scanCallsSince } from './db.mjs';

const RATE = 16000, KBPS = 32; // the clips' own format (src/ingest/stream.mjs)
const FRAME_S = 576 / RATE;    // an MPEG-2 Layer III frame holds 576 samples
const LEAD = 3;                // seconds of audio kept written ahead of playback: enough for a browser to start promptly
const LINGER = 2.5;            // after a transmission only a reply (or priority traffic) plays for this long, like the page's old scan
const QUEUE_MAX = 20;          // stay close to live

const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// Split MPEG Layer III bytes into frames.
function frames(buf) {
  const list = [];
  for (let i = 0; i + 4 <= buf.length;) {
    const ver = (buf[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const kbps = BITRATES[ver === 3 ? 1 : 2][buf[i + 2] >> 4];
    const rate = RATES[ver]?.[(buf[i + 2] >> 2) & 3];
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0 || ((buf[i + 1] >> 1) & 3) !== 1 || !kbps || !rate) { i++; continue; }
    const size = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / rate) + ((buf[i + 2] >> 1) & 1);
    list.push(buf.subarray(i, i + size));
    i += size;
  }
  return list;
}

// Re-encoded without the bit reservoir, so any frame can follow any other: clip, silence, or another clip.
function encode(input) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', ...input, '-ac', '1', '-ar', String(RATE), '-c:a', 'libmp3lame', '-b:a', `${KBPS}k`,
      '-reservoir', '0', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1']);
    const out = [];
    ff.stdout.on('data', (b) => out.push(b));
    ff.on('error', reject);
    ff.on('close', (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve(frames(Buffer.concat(out)))));
  });
}

let silence = null;
const ready = encode(['-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=mono`, '-t', '1']).then((f) => { silence = f[Math.floor(f.length / 2)]; });

const encoded = new Map(); // clip file → Promise of its frames (shared by every listener; the newest 50 kept)
function load(audio) {
  if (!encoded.has(audio)) {
    encoded.set(audio, encode(['-i', join('data', 'audio', audio)]));
    if (encoded.size > 50) encoded.delete(encoded.keys().next().value);
  }
  return encoded.get(audio);
}

const sessions = new Map(); // page's scan id → session
const ids = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(String).filter((x) => x && x.length <= 64);

function apply(s, settings) {
  if (settings.channels !== undefined) s.channels = new Set(ids(settings.channels));
  if (settings.pri !== undefined) s.pri = new Set(ids(settings.pri));
  if (settings.hold !== undefined) s.hold = ids(settings.hold)[0] || null;
}
const eligible = (s, c) => (s.hold ? c.source_id === s.hold : s.channels.has(c.source_id));

function enqueue(s, call, { replay = false } = {}) {
  if (!call?.audio || (!replay && !eligible(s, call))) return;
  const item = { call, replay, frames: null };
  if (replay) s.queue.unshift(item);
  else s.queue.push(item);
  if (s.queue.length > QUEUE_MAX) s.queue.splice(s.queue.findIndex((q) => !q.replay), 1); // the oldest
  load(call.audio).then((f) => {
    item.frames = f;
    // A replay, or priority traffic over an ordinary channel, cuts off what's playing.
    const cur = s.current?.call;
    if (cur && (replay || (s.pri.has(call.source_id) && !s.pri.has(cur.source_id)))) s.current = null;
  }, () => { s.queue = s.queue.filter((q) => q !== item); }); // clip expired or unreadable: skip it
}

// Next transmission: a replay, then priority channels, then oldest first. While lingering on a channel
// after its transmission, only a reply on that channel or priority traffic may play.
function pick(s) {
  s.queue = s.queue.filter((q) => q.replay || eligible(s, q.call)); // channel changed, held elsewhere or locked out
  const lingering = s.written < s.lingerUntil;
  const ok = (q) => q.frames?.length && (q.replay || !lingering || q.call.source_id === s.lastSource || s.pri.has(q.call.source_id));
  const q = s.queue.find((x) => ok(x) && x.replay) ?? s.queue.find((x) => ok(x) && s.pri.has(x.call.source_id)) ?? s.queue.find(ok);
  if (!q) return;
  s.queue = s.queue.filter((x) => x !== q);
  s.current = { call: q.call, frames: q.frames, i: 0 };
  const play = { sid: s.sid, offset: s.written, duration: q.frames.length * FRAME_S, tag: q.replay ? 'REPLAY' : s.hold ? 'HOLD' : s.pri.has(q.call.source_id) ? 'PRI' : '', call: q.call };
  s.plays.push(play);
  if (s.plays.length > 30) s.plays.shift();
  s.announce(play);
}

function pump(s) {
  const target = (Date.now() - s.start) / 1000 + LEAD;
  const out = [];
  while (s.written < target) {
    if (!s.current) pick(s);
    const cur = s.current;
    out.push(cur ? cur.frames[cur.i++] : silence);
    s.written += FRAME_S;
    if (cur && cur.i >= cur.frames.length) {
      s.lastSource = cur.call.source_id;
      s.lingerUntil = s.hold ? 0 : s.written + LINGER;
      s.current = null;
    }
  }
  if (out.length) s.res.write(Buffer.concat(out));
}

// GET /scan/stream?sid=&channels=&pri=&hold= — the scan's audio for one page.
export async function scanStream(req, res, params, announce) {
  await ready;
  const sid = ids(params.get('sid'))[0];
  if (!sid) { res.writeHead(400); return res.end(); }
  sessions.get(sid)?.close();
  const s = { sid, res, announce, channels: new Set(), pri: new Set(), hold: null, queue: [], current: null, plays: [], written: 0, start: Date.now(), lingerUntil: 0, lastSource: null };
  apply(s, { channels: params.get('channels'), pri: params.get('pri'), hold: params.get('hold') });
  // Prime with the last couple of minutes so there's something to hear straight away.
  for (const c of scanCallsSince(new Date(Date.now() - 2 * 60e3).toISOString()).filter((c) => eligible(s, c)).slice(0, 3).reverse()) enqueue(s, c);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  const timer = setInterval(() => pump(s), 250);
  s.close = () => { clearInterval(timer); if (sessions.get(sid) === s) sessions.delete(sid); res.end(); };
  req.on('close', s.close);
  sessions.set(sid, s);
  pump(s);
}

// POST /api/scan/<sid> — the page's channels, priority and hold changed, or PREV asked for a replay.
export function updateScan(sid, body) {
  const s = sessions.get(sid);
  if (!s) return null;
  apply(s, body);
  if (s.current && !eligible(s, s.current.call)) s.current = null; // locked out or held elsewhere mid-transmission
  if (body.replay) enqueue(s, scanCall(Number(body.replay)), { replay: true });
  return { plays: s.plays };
}

// GET /api/scan/<sid> — where each recent transmission sits in the stream (a page catching up after its
// timers were stopped, e.g. with the phone locked).
export const scanPlays = (sid) => (sessions.has(sid) ? { plays: sessions.get(sid).plays } : null);

bus.on('call', (c) => { for (const s of sessions.values()) enqueue(s, c); });
