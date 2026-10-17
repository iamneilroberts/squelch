// A story on its own page: /s/<id> plays without the app, with a map, the transmissions in order, word-by-word
// captions and a link-preview card (/s/<id>/card.jpg, a screenshot of /s/<id>/card). Transcripts follow the app's
// rule (`hidden`, src/server.mjs). Links and previews use PUBLIC_URL when set, so a link shared from the LAN works outside.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db, getThread } from './db.mjs';
import { sources, station } from './config.mjs';
import { withBrowser } from './studio/browser.mjs';

const CARDS = join('data', 'share');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: station.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Where it happened: the story's best-placed incident (geocoded first, then latest), else the channel's home, marked approximate.
function placeOf(t, source) {
  const i = db.prepare(`SELECT i.lat, i.lng, i.location_text, i.precision FROM calls c JOIN incidents i ON i.id = c.incident_id
    WHERE c.thread_id = ? AND i.lat IS NOT NULL ORDER BY i.precision = 'geocoded' DESC, c.at DESC LIMIT 1`).get(t.id);
  if (i) return { lat: i.lat, lng: i.lng, label: i.location_text || source?.area || null, approx: i.precision !== 'geocoded' };
  return source?.lat != null ? { lat: source.lat, lng: source.lng, label: source.area || source.name, approx: true } : null;
}

function story(id, transcripts) {
  const t = getThread(id);
  if (!t) return null;
  const source = sources.find((s) => s.id === t.source_id);
  return {
    id: t.id, subject: t.subject, why: t.why, type: t.type, facts: t.facts, started_at: t.started_at, updated_at: t.updated_at,
    channel: { short: source?.short || t.source_id, name: source?.name || '', band: source?.band || null },
    place: placeOf(t, source),
    transcripts,
    station: { script: station.script, caps: station.caps, timezone: station.timezone },
    events: t.events.map((e) => ({
      at: e.at, note: e.note,
      audio: e.audio ? `/audio/${encodeURIComponent(e.audio)}` : null,
      ...(transcripts && { transcript: e.transcript, captions: e.audio && e.transcript ? `/api/captions/${encodeURIComponent(e.audio)}.vtt` : null }),
    })),
  };
}

const summary = (s) => s.why || s.facts[0]?.value || '';
const describe = (s) => [summary(s), `${s.channel.short} · ${when(s.started_at)}${s.place?.label ? ` · ${s.place.label}` : ''}`].filter(Boolean).join(' — ');
const fill = (html, vars) => html.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? '');

// Cards render one at a time (each is a Chrome), are kept until the story changes, and a failed one isn't retried
// for 5 minutes.
const rendering = new Map(); // file → promise
const failed = new Map(); // id → when
let queue = Promise.resolve();
function card(id, port) {
  const t = db.prepare('SELECT updated_at FROM threads WHERE id = ?').get(id);
  if (!t || Date.now() - (failed.get(id) || 0) < 5 * 60e3) return Promise.resolve(null);
  const file = join(CARDS, `${id}-${Date.parse(t.updated_at)}.jpg`);
  if (existsSync(file)) return Promise.resolve(file);
  if (!rendering.has(file)) {
    const run = queue.then(() => withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630 });
      await page.goto(`http://127.0.0.1:${port}/s/${id}/card`, { waitUntil: 'networkidle0', timeout: 15e3 });
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(CARDS, { recursive: true });
      await page.screenshot({ path: `${file}.part.jpg`, type: 'jpeg', quality: 85 });
      renameSync(`${file}.part.jpg`, file);
      for (const f of readdirSync(CARDS)) if (f.startsWith(`${id}-`) && join(CARDS, f) !== file) unlinkSync(join(CARDS, f)); // the story's older cards
      return file;
    })).then((f) => { if (!f) failed.set(id, Date.now()); return f; }, (e) => { console.warn('[share] card', id, e.message); failed.set(id, Date.now()); return null; })
      .finally(() => rendering.delete(file));
    queue = run;
    rendering.set(file, run);
  }
  return rendering.get(file);
}

// /s/<id>, /s/<id>/card, /s/<id>/card.jpg. Returns false for any other path.
export async function shareRoute(req, res, { p, hidden, remote, port, page, serveFile }) {
  const m = p.match(/^\/s\/(\d+)(\/card(?:\.jpg)?)?$/);
  if (!m) return false;
  const id = Number(m[1]);
  if (m[2] === '/card.jpg') {
    const file = await card(id, port);
    if (!file) { res.writeHead(302, { Location: '/icon-512.png' }); res.end(); return true; }
    serveFile(res, CARDS, file.slice(CARDS.length + 1));
    return true;
  }
  const s = story(id, !hidden);
  if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('That story isn’t here any more. Stories are kept for 30 days.'); return true; }
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.headers['x-forwarded-proto'] || (remote ? 'https' : 'http')}://${req.headers.host}`;
  const template = m[2] ? 'share-card.html' : 'share.html';
  const html = fill(readFileSync(join('public', template), 'utf8'), {
    title: esc(`${s.channel.short}: ${s.subject}`),
    description: esc(short(describe(s), 200)),
    url: esc(`${origin}/s/${id}`),
    image: esc(`${origin}/s/${id}/card.jpg?v=${Date.parse(s.updated_at)}`),
    site: esc(`${station.script} ${station.caps}`),
    when: esc(when(s.started_at)),
    place: esc(s.place?.label || ''),
    script: esc(station.script),
    channel: esc(s.channel.name || s.channel.short),
    summary: esc(short(summary(s), 160)),
    count: `${s.events.length} transmission${s.events.length === 1 ? '' : 's'}`,
    // Inside <script type="application/json">: "<" escaped so no text in it can close the tag.
    data: JSON.stringify({ ...s, url: `${origin}/s/${id}` }).replace(/</g, '\\u003c'),
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page(html));
  return true;
}
