// Scan as one continuous MP3 stream. A phone keeps playing a stream with the screen locked but stops
// the page's own timers, so a scan that hops between clip files goes quiet after the first one. Here the
// server does the scanning for each listening page: it queues new transmissions from that page's
// channels, writes their MP3 frames at playing speed with silence frames between, and announces where
// in the stream each one starts, so the page can show what's on air.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { bus } from './ingest/pipeline.mjs';
import { getThread, scanCall, scanCallsSince } from './db.mjs';

const RATE = 16000, KBPS = 32; // the clips' own format (src/ingest/stream.mjs)
const FRAME_S = 576 / RATE;    // an MPEG-2 Layer III frame holds 576 samples
const LEAD = 3;                // seconds of audio kept written ahead of playback: enough for a browser to start promptly
const LINGER = 2.5;            // after a transmission only a reply (or priority traffic) plays for this long, like the page's old scan
const QUEUE_MAX = 20;          // stay close to live
const CATCHUP_MAX = 30;        // a story's latest transmissions, at most

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

function enqueue(s, call) {
  if (!call?.audio || !eligible(s, call)) return;
  const item = { call, frames: null };
  s.queue.push(item);
  const live = s.queue.filter((q) => !q.tag);
  if (live.length > QUEUE_MAX) s.queue = s.queue.filter((q) => q !== live[0]); // the oldest
  load(call.audio).then((f) => {
    item.frames = f;
    // Priority traffic over an ordinary channel cuts off what's playing.
    if (s.current && s.pri.has(call.source_id) && !s.pri.has(s.current.call.source_id)) cut(s);
  }, () => { s.queue = s.queue.filter((q) => q !== item); }); // clip expired or unreadable: skip it
}

// Stop what's playing. A replay or catch-up transmission cut off this way starts again afterwards
// (from queue position `at`).
function cut(s, at = 0) {
  const { call, tag, frames } = s.current;
  if (tag) s.queue.splice(at, 0, { call, tag, frames });
  s.current = null;
}

// A replay or a catch-up: transmissions the listener asked for, played in order ahead of anything new,
// whatever channels are scanned. The first one cuts off what's playing.
function enqueueList(s, calls, tag) {
  const items = calls.filter((c) => c?.audio).map((call, i, all) => ({ call, tag: tag(i, all.length), frames: null }));
  s.queue = [...items, ...s.queue];
  for (const item of items) {
    load(item.call.audio).then((f) => {
      item.frames = f;
      if (item === items[0] && s.current) cut(s, s.queue.indexOf(items.at(-1)) + 1);
    }, () => { s.queue = s.queue.filter((q) => q !== item); });
  }
}

// Next transmission: priority traffic, then a replay or catch-up (in order: a clip still encoding is
// waited for), then oldest first. While lingering on a channel after its transmission, only a reply on
// that channel or priority traffic may play.
function pick(s) {
  s.queue = s.queue.filter((q) => q.tag || eligible(s, q.call)); // channel changed, held elsewhere or locked out
  const lingering = s.written < s.lingerUntil;
  const ok = (q) => q.frames?.length && (!lingering || q.call.source_id === s.lastSource || s.pri.has(q.call.source_id));
  const asked = s.queue.find((x) => x.tag);
  const q = s.queue.find((x) => !x.tag && ok(x) && s.pri.has(x.call.source_id)) ?? (asked ? (asked.frames ? asked : null) : s.queue.find(ok));
  if (!q) return;
  s.queue = s.queue.filter((x) => x !== q);
  s.current = { call: q.call, frames: q.frames, tag: q.tag, i: 0 };
  const play = { sid: s.sid, offset: s.written, duration: q.frames.length * FRAME_S, tag: q.tag || (s.hold ? 'HOLD' : s.pri.has(q.call.source_id) ? 'PRI' : ''), call: q.call };
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

// POST /api/scan/<sid> — the page's channels, priority and hold changed, PREV asked for a replay, or
// Catch up asked for a story so far (`catchup`: its thread id; its transmissions that added something,
// or with `all` (or when none did) every one; 0 ends a catch-up).
export function updateScan(sid, body) {
  const s = sessions.get(sid);
  if (!s) return null;
  apply(s, body);
  if (s.current && !s.current.tag && !eligible(s, s.current.call)) s.current = null; // locked out or held elsewhere mid-transmission
  if (body.replay) enqueueList(s, [scanCall(Number(body.replay))], () => 'REPLAY');
  if (body.catchup !== undefined) {
    const t = getThread(Number(body.catchup));
    const clips = (t?.events ?? []).filter((e) => e.audio);
    const noted = body.all ? [] : clips.filter((e) => e.note);
    const calls = (noted.length ? noted : clips).slice(-CATCHUP_MAX).map((e) => scanCall(e.id)); // none added anything: play them all
    s.queue = s.queue.filter((q) => !q.tag?.startsWith('CATCH UP'));
    if (s.current?.tag?.startsWith('CATCH UP')) s.current = null;
    enqueueList(s, calls, (i, n) => `CATCH UP ${i + 1}/${n}`);
  }
  return { plays: s.plays };
}

// GET /api/scan/<sid> — where each recent transmission sits in the stream (a page catching up after its
// timers were stopped, e.g. with the phone locked).
export const scanPlays = (sid) => (sessions.has(sid) ? { plays: sessions.get(sid).plays } : null);

bus.on('call', (c) => { for (const s of sessions.values()) enqueue(s, c); });
