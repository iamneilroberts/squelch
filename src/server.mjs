import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { recentIncidents, recentCalls, listDigests, getDigest, callsBetween, callByAudio, setCues, getThread } from './db.mjs';
import { buildCues, toVtt } from './ingest/captions.mjs';
import { pushReady, publicKey, LEVELS, configureNotify, subscription, subscribe, setPrefs, unsubscribe, sendTest } from './notify.mjs';
import { startIngest, bus, status, GATE, VAD } from './ingest/pipeline.mjs';
import { overlays, startShips } from './overlays.mjs';
import { buildDigest, dayBounds, localDate } from './digest.mjs';
import { llmReady } from './ai/llm.mjs';
import { costSummary, recentTraces, gateAgreement, vadReport, squelchReport } from './meter.mjs';
import { station, regions, sources, configFile } from './config.mjs';

const PORT = Number(process.env.PORT || 8077);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png', '.ico': 'image/x-icon' };

// "all" is the union of every region.
const ALL = {
  id: 'all',
  bbox: [Math.min(...regions.map((r) => r.bbox[0])), Math.min(...regions.map((r) => r.bbox[1])), Math.max(...regions.map((r) => r.bbox[2])), Math.max(...regions.map((r) => r.bbox[3]))],
  points: regions.map((r) => r.nwsPoint),
  tide: regions.find((r) => typeof r.tide === 'string')?.tide || false, // NOAA CO-OPS station id
};
startShips(ALL.bbox);
const regionFor = (id) => {
  const r = regions.find((x) => x.id === id);
  return r ? { ...r, points: [r.nwsPoint] } : ALL;
};

// Raw transcripts can contain names, phone numbers and plates that triage keeps out of incidents.
// Visitors through the Cloudflare tunnel only get them while the LAN-only "share transcripts"
// switch is on (data/settings.json). LAN viewers always see everything.
const isRemote = (req) => Boolean(req.headers['cf-connecting-ip']);
const scrub = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'transcript' ? undefined : v)));
const SETTINGS = join('data', 'settings.json');
// Owners (Cloudflare Access emails allowed to flip settings and use the receiver's Broadcastify account
// remotely) come from OWNER_EMAILS in .env, or an "owners" list in data/settings.json.
const settings = {
  tunnelTranscripts: false,
  guestNotifications: false, // let tunnel guests subscribe to push notifications (as a demo)
  owners: (process.env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  ...(existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {}),
};
const hideFrom = (remote) => remote && !settings.tunnelTranscripts;
// Who may flip settings: anyone on the LAN, or an owner signed in through Cloudflare Access
// (Access sets this header on every request it lets through the tunnel).
const canEdit = (req) => !isRemote(req) || settings.owners.includes(String(req.headers['cf-access-authenticated-user-email'] || '').toLowerCase());

configureNotify({ allowGuests: () => settings.guestNotifications });

const json = (res, body, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Stamp local CSS/JS references with the file's mtime (app.css → app.css?v=1792…), so a changed
// file gets a URL no browser or Cloudflare edge has cached. HTML itself isn't edge-cached.
function versionAssets(html, dir) {
  return html.replace(/(href|src)="([\w-]+\.(?:css|js))"/g, (m, attr, file) => {
    const p = join(dir, file);
    return existsSync(p) ? `${attr}="${file}?v=${Math.round(statSync(p).mtimeMs)}"` : m;
  });
}

// Write the station's name into the page before it's sent, so the browser never flashes the
// generic "Squelch" placeholder before the script loads the config.
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function brand(html) {
  return html
    .replace(/<title>Squelch<\/title>/, `<title>${escHtml(`${station.script} ${station.caps}`)}</title>`)
    .replace(/(class="badge-script">)[^<]*/, `$1${escHtml(station.script)}`)
    .replace(/(id="badge-sub">)[^<]*/, `$1${escHtml(station.badge)}`);
}

function serveFile(res, root, rel, range) {
  const path = normalize(join(root, rel));
  if (!path.startsWith(normalize(root)) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  // no-cache: browsers and Cloudflare's edge revalidate, so tunnel visitors never run a stale app.js.
  const head = { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
  // Byte ranges let the browser seek in recordings (without them, setting currentTime is ignored).
  const size = statSync(path).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, head);
  if (extname(path) === '.html') {
    const html = versionAssets(readFileSync(path, 'utf8'), dirname(path));
    return res.end(path.endsWith('index.html') ? brand(html) : html);
  }
  createReadStream(path).pipe(res);
}

/* Visitors can listen live with their own Broadcastify Premium login. It's checked once against the
   stream server, then kept in memory only (never on disk) under a random HttpOnly session cookie. */
const bcfySessions = new Map(); // token → { user, pass, at }
const SESSION_DAYS = 30;
const sessionToken = (req) => /(?:^|;\s*)bcfy=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
function sessionCreds(req) {
  const t = sessionToken(req);
  const s = t && bcfySessions.get(t);
  return s && Date.now() - s.at < SESSION_DAYS * 864e5 ? s : null;
}
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const attempts = new Map(); // client ip → recent login attempt times (5 per 10 min)

// Returns 'premium' | 'refused' | 'unreachable' by opening a stream with the login and reading only the status.
async function checkBroadcastify(user, pass) {
  for (const s of sources.filter((x) => x.streamUrl?.includes('audio.broadcastify.com')).slice(0, 4)) {
    const ctl = new AbortController();
    try {
      const r = await fetch(s.streamUrl, { headers: { Authorization: basic(user, pass), 'User-Agent': 'Mozilla/5.0 PortCityMonitor' }, signal: ctl.signal });
      ctl.abort();
      if (r.status === 200) return 'premium';
      if (r.status === 401 || r.status === 403) return 'refused';
      // 404 = that feed is offline right now; try the next one.
    } catch { ctl.abort(); }
  }
  return 'unreachable';
}

async function readJson(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 10_000) break; }
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

// Live audio relay: the server fetches the Broadcastify stream and pipes it to the browser, so no login
// prompt appears. LAN/owners use the account in .env; anyone else needs their own Premium login
// (relaying the owner's personal subscription to guests would be re-streaming).
async function relayStream(req, res, id) {
  const s = sources.find((x) => x.id === id && x.streamUrl);
  if (!s) return json(res, { error: 'unknown station' }, 404);
  const own = sessionCreds(req);
  const { user, pass } = canEdit(req) && !own ? { user: process.env.BROADCASTIFY_LOGIN, pass: process.env.BROADCASTIFY_PASSWORD } : own || {};
  if (!user || !pass) return json(res, { error: 'Sign in with your Broadcastify Premium login to listen here', listenUrl: s.listenUrl }, 403);
  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  try {
    const up = await fetch(s.streamUrl, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 PortCityMonitor', Authorization: basic(user, pass) } });
    if (up.status === 401 && own) {
      bcfySessions.delete(sessionToken(req)); // their login stopped working (password changed, Premium lapsed)
      return json(res, { error: 'Broadcastify refused your login — Premium may have lapsed' }, 401);
    }
    if (!up.ok || !up.body) return json(res, { error: `stream returned ${up.status}` }, 502);
    res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' });
    Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, 502);
  }
}

const clients = new Map(); // SSE response → is a tunnel visitor
const broadcast = (ev, data) => {
  const full = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  const safe = `event: ${ev}\ndata: ${JSON.stringify(scrub(data))}\n\n`;
  for (const [c, remote] of clients) c.write(hideFrom(remote) ? safe : full);
};
for (const ev of ['incident', 'call', 'status']) bus.on(ev, (data) => broadcast(ev, data));

/* Daily digests: yesterday's is built automatically after midnight; "today so far" on request. */
const building = new Map(); // key → promise
function digest(date, region) {
  const key = `${date}/${region}`;
  if (!building.has(key)) {
    building.set(key, buildDigest(date, region, sources)
      .then((d) => { if (d) broadcast('digest', { date, region }); return d; })
      .finally(() => setTimeout(() => building.delete(key), 10 * 60e3)));
  }
  return building.get(key);
}
function nightly() {
  if (!llmReady()) return;
  const yesterday = localDate(new Date(Date.now() - 24 * 3600e3));
  for (const r of regions) {
    if (!getDigest(yesterday, r.id) && callsBetween(...dayBounds(yesterday)).some((c) => sources.find((s) => s.id === c.source_id)?.region === r.id)) {
      digest(yesterday, r.id).catch((e) => console.warn('[digest]', e.message));
    }
  }
}
setInterval(nightly, 15 * 60e3);
setTimeout(nightly, 10e3);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const remote = isRemote(req);
  const hidden = hideFrom(remote);
  const out = (body, code) => json(res, hidden ? scrub(body) : body, code);
  try {
    if (p === '/api/config') return json(res, { station, regions, viewer: { remote, transcripts: !hidden, canShare: canEdit(req), canListen: canEdit(req) || Boolean(sessionCreds(req)), broadcastifyUser: sessionCreds(req)?.user || null, sharing: settings.tunnelTranscripts }, sources: sources.map((s) => ({ ...s, status: status[s.id] || { state: 'standby' } })) });
    if (p === '/api/settings' && req.method === 'POST') {
      if (!canEdit(req)) return json(res, { error: 'Only the owner can change this' }, 403);
      const body = JSON.parse(await new Promise((r) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => r(s || '{}')); }));
      if (typeof body.tunnelTranscripts === 'boolean') settings.tunnelTranscripts = body.tunnelTranscripts;
      if (typeof body.guestNotifications === 'boolean') settings.guestNotifications = body.guestNotifications;
      writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
      console.log(`[settings] remote transcripts ${settings.tunnelTranscripts ? 'ON' : 'off'} (by ${remote ? req.headers['cf-access-authenticated-user-email'] : 'LAN'})`);
      broadcast('settings', { sharing: settings.tunnelTranscripts });
      return json(res, settings);
    }
    // Notifications. The browser's push endpoint identifies its subscription, so it travels in POST bodies only.
    if (p.startsWith('/api/notify/') && req.method === 'POST') {
      const body = await readJson(req);
      const owner = canEdit(req);
      const allowed = pushReady && (owner || settings.guestNotifications);
      const action = p.slice('/api/notify/'.length);
      if (action === 'status') return json(res, { ready: pushReady, publicKey, allowed, owner, guests: settings.guestNotifications, levels: Object.keys(LEVELS), sub: body.endpoint ? subscription(body.endpoint) : null });
      if (!allowed) return json(res, { error: pushReady ? 'Notifications are only for the owner here' : 'Notifications aren’t set up on this receiver' }, 403);
      if (action === 'subscribe') return json(res, subscribe(body, { owner, label: remote ? req.headers['cf-access-authenticated-user-email'] : 'LAN' }));
      if (action === 'prefs') return json(res, setPrefs(body.endpoint, body) ?? { error: 'not subscribed' });
      if (action === 'unsubscribe') { unsubscribe(body.endpoint); return json(res, { ok: true }); }
      if (action === 'test') return json(res, { sent: await sendTest(body.endpoint) });
      return json(res, { error: 'unknown' }, 404);
    }
    if (p === '/api/incidents') return out(recentIncidents(Number(url.searchParams.get('hours') || 12)));
    if (p === '/api/calls') return json(res, hidden ? [] : recentCalls(Number(url.searchParams.get('limit') || 150)));
    if (p.startsWith('/api/overlays/')) {
      const fn = overlays[p.slice('/api/overlays/'.length)];
      return fn ? json(res, await fn(regionFor(url.searchParams.get('region')))) : json(res, { error: 'unknown overlay' }, 404);
    }
    if (p === '/api/digests') return json(res, listDigests());
    if (p === '/api/costs') {
      const hours = Math.min(24 * 30, Number(url.searchParams.get('hours') || 24));
      return json(res, { ...costSummary(hours), gate: { ...gateAgreement(hours), ...GATE }, vad: { ...vadReport(hours), ...VAD, squelch: squelchReport(hours) } });
    }
    if (p === '/api/traces') return out(recentTraces(Math.min(200, Number(url.searchParams.get('limit') || 40)), url.searchParams.get('kind')));
    const m = p.match(/^\/api\/digests\/(\d{4}-\d{2}-\d{2})\/([a-z-]+)(\/build)?$/);
    if (m) {
      const [, date, region, build] = m;
      if (!build) return out(getDigest(date, region) ?? { error: 'no digest' }, getDigest(date, region) ? 200 : 404);
      if (req.method !== 'POST') return json(res, { error: 'POST to build' }, 405);
      if (!llmReady()) return json(res, { error: 'Set OPENROUTER_API_KEY to build digests' }, 400);
      const d = await digest(date, region);
      return d ? out(d) : json(res, { error: 'No recorded traffic for that day yet' }, 404);
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 5000\n\n');
      clients.set(res, remote);
      const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (p === '/api/broadcastify/login' && req.method === 'POST') {
      const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
      const recent = (attempts.get(ip) || []).filter((t) => Date.now() - t < 10 * 60e3);
      if (recent.length >= 5) return json(res, { error: 'Too many tries — wait 10 minutes' }, 429);
      attempts.set(ip, [...recent, Date.now()]);
      const { username, password } = await readJson(req);
      if (!username || !password) return json(res, { error: 'Enter your RadioReference/Broadcastify username and password' }, 400);
      const result = await checkBroadcastify(String(username).trim(), String(password));
      if (result === 'refused') return json(res, { error: 'Broadcastify refused that login for direct listening. It needs an active Broadcastify Premium subscription; a free account, an email instead of the username, or a wrong password is refused.' }, 401);
      if (result !== 'premium') return json(res, { error: 'Couldn’t reach Broadcastify’s stream server to check the login — try again shortly' }, 502);
      const token = randomBytes(24).toString('hex');
      bcfySessions.set(token, { user: String(username).trim(), pass: String(password), at: Date.now() });
      res.setHeader('Set-Cookie', `bcfy=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${remote ? '; Secure' : ''}`);
      return json(res, { ok: true, user: String(username).trim() });
    }
    if (p === '/api/broadcastify/logout' && req.method === 'POST') {
      bcfySessions.delete(sessionToken(req));
      res.setHeader('Set-Cookie', 'bcfy=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
      return json(res, { ok: true });
    }
    if (p.startsWith('/listen/')) return relayStream(req, res, p.slice('/listen/'.length));
    const th = p.match(/^\/api\/threads\/(\d+)$/);
    if (th) { const t = getThread(Number(th[1])); return t ? json(res, t) : (res.writeHead(404), res.end()); }
    const cc = p.match(/^\/api\/captions\/([\w.-]+)\.vtt$/);
    if (cc) {
      const call = hidden ? null : callByAudio(cc[1]);
      const file = call?.audio && join('data', 'audio', call.audio);
      if (!call?.transcript || !(call.cues || existsSync(file))) { res.writeHead(404); return res.end(); }
      const cues = call.cues ? JSON.parse(call.cues) : await buildCues(file, call.transcript);
      if (!call.cues) setCues(call.id, cues);
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(toVtt(cues));
    }
    // Web app manifest, named after the station. Needed to add the receiver to a phone's Home Screen,
    // which iPhones require before they deliver push notifications.
    if (p === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({
        name: `${station.script} ${station.caps}`, short_name: station.script, start_url: '/', display: 'standalone',
        background_color: '#3b2414', theme_color: '#5a3a22',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
      }));
    }
    if (p.startsWith('/audio/')) return serveFile(res, join('data', 'audio'), decodeURIComponent(p.slice(7)), req.headers.range);
    if (p.startsWith('/reels/')) return serveFile(res, join('data', 'digests'), decodeURIComponent(p.slice(7)), req.headers.range);
    return serveFile(res, 'public', p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    json(res, { error: e.message }, 502);
  }
}).listen(PORT, () => console.log(`${station.script} ${station.caps} on http://localhost:${PORT} (config: ${configFile})`));

if (process.env.INGEST !== '0') startIngest(sources, regions);
