// Web Push notifications. A subscription is one browser, with its own favourite channels and
// sensitivity. Owner browsers may always subscribe; guests (tunnel visitors who aren't owners) only
// while the owner's "guest notifications" switch is on. Setup: docs/NOTIFICATIONS.md.
import webpush from 'web-push';
import { db, getThread } from './db.mjs';
import { sources } from './config.mjs';
import { span } from './meter.mjs';

const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
export const pushReady = Boolean(PUB && PRIV);
export const publicKey = PUB || null;
if (pushReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:squelch@example.com', PUB, PRIV);

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  keys TEXT NOT NULL,
  owner INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  favorites TEXT NOT NULL DEFAULT '[]',
  level TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  sub_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  thread_id INTEGER,
  source_id TEXT,
  type TEXT,
  alert REAL,
  score REAL,
  title TEXT,
  body TEXT,
  opened_at TEXT,
  dwell_s REAL NOT NULL DEFAULT 0,
  feedback INTEGER
)`);
db.exec('CREATE INDEX IF NOT EXISTS notifications_sub ON notifications (sub_id, at)');
try { db.exec('ALTER TABLE push_subs ADD COLUMN reset_at TEXT'); } catch { /* already there */ }

// Score needed to notify, by sensitivity. Favourite channels count 1.4× toward it.
export const LEVELS = { quiet: 0.8, normal: 0.6, chatty: 0.4 };
const FAVOURITE = 1.4;
const ESCALATION = 0.25; // a story already notified only notifies again after rising this much
const PER_HOUR = 6; // per browser, except major events (alert ≥ 0.9)
const DAY = 864e5;

/* Learning. Each sent notification becomes evidence about its channel and its story type:
   More / Fewer = ±2; opened and stayed ≥ 60 s = +1 (≥ 15 s = +0.5, less = 0); not opened within
   30 minutes = ignored, −0.5. Evidence fades by half every 14 days, so tastes drift back to neutral.
   Ignoring alone can't take a feature below −0.8 (×0.76): only Fewer mutes. A feature's score is
   clamped to [−4, 2]; a notification's multiplier is 2^(mean of its features' scores / 2), 0.25–2. */
const HALF_LIFE = 14 * DAY;
const IGNORED_AFTER = 30 * 60e3;
// Not the band: "fewer medical calls on Hancock Fire" shouldn't quiet a structure fire on Mobile Fire.
const featuresOf = (x) => [`channel:${x.source_id}`, `type:${x.type || 'other'}`];

function evidence(r, now) {
  if (r.feedback) return { v: 2 * r.feedback };
  if (r.opened_at) return { v: r.dwell_s >= 60 ? 1 : r.dwell_s >= 15 ? 0.5 : 0 };
  if (now - Date.parse(r.at) > IGNORED_AFTER) return { v: -0.5, ignored: true };
  return null; // too recent to tell
}

export function learned(s) {
  const now = Date.now();
  const since = [new Date(now - 90 * DAY).toISOString(), s.reset_at].filter(Boolean).sort().at(-1);
  const f = new Map();
  for (const r of db.prepare('SELECT * FROM notifications WHERE sub_id = ? AND at >= ?').all(s.id, since)) {
    const e = evidence(r, now);
    const decay = 0.5 ** ((now - Date.parse(r.at)) / HALF_LIFE);
    for (const k of featuresOf(r)) {
      const x = f.get(k) ?? { key: k, sum: 0, ignored: 0, sent: 0, opened: 0, more: 0, fewer: 0 };
      x.sent++;
      if (r.opened_at) x.opened++;
      if (r.feedback > 0) x.more++;
      if (r.feedback < 0) x.fewer++;
      if (e?.ignored) x.ignored += e.v * decay;
      else if (e) x.sum += e.v * decay;
      f.set(k, x);
    }
  }
  for (const x of f.values()) x.score = Math.max(-4, Math.min(2, x.sum + Math.max(-0.8, x.ignored)));
  return f;
}
const multiplier = (f, x) => 2 ** (featuresOf(x).reduce((a, k) => a + (f.get(k)?.score ?? 0), 0) / featuresOf(x).length / 2);

let allowGuests = () => false;
export const configureNotify = (opts) => { allowGuests = opts.allowGuests; };

const subRow = (endpoint) => db.prepare('SELECT * FROM push_subs WHERE endpoint = ?').get(endpoint);
const prefsOf = (s) => s && { favorites: JSON.parse(s.favorites), level: s.level, owner: Boolean(s.owner) };
export const subscription = (endpoint) => prefsOf(subRow(endpoint));

export function subscribe({ subscription: sub, favorites = [], level = 'normal' }, { owner, label }) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('bad subscription');
  db.prepare(`INSERT INTO push_subs (endpoint, keys, owner, label, favorites, level, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, owner = excluded.owner, label = excluded.label`)
    .run(sub.endpoint, JSON.stringify(sub.keys), owner ? 1 : 0, label || null, '[]', 'normal', new Date().toISOString());
  return setPrefs(sub.endpoint, { favorites, level });
}

export function setPrefs(endpoint, { favorites, level }) {
  const s = subRow(endpoint);
  if (!s) return null;
  const favs = Array.isArray(favorites) ? favorites.filter((id) => sources.some((x) => x.id === id)) : JSON.parse(s.favorites);
  db.prepare('UPDATE push_subs SET favorites = ?, level = ? WHERE id = ?').run(JSON.stringify(favs), LEVELS[level] ? level : s.level, s.id);
  return subscription(endpoint);
}

export const unsubscribe = (endpoint) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);

async function push(s, payload, urgency = 'normal') {
  try {
    await span({ kind: 'http', purpose: 'push', provider: new URL(s.endpoint).host },
      () => webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 3600, urgency }));
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id); // browser dropped it
    else console.warn('[notify]', e.statusCode || '', e.message);
    return false;
  }
}

// One notification to one browser by id (src/report.mjs), under the same rule: guests only while guest notifications are on.
export const subId = (endpoint) => subRow(endpoint)?.id ?? null;
export const ownerSubIds = () => db.prepare('SELECT id FROM push_subs WHERE owner = 1').all().map((r) => r.id);
export function pushTo(id, payload) {
  const s = pushReady && db.prepare('SELECT * FROM push_subs WHERE id = ?').get(id);
  return s && (s.owner || allowGuests()) ? push(s, payload) : Promise.resolve(false);
}

export function sendTest(endpoint) {
  const s = subRow(endpoint);
  return s ? push(s, { title: 'Notifications are on', body: 'You’ll hear from this receiver when something notable happens.', tag: 'test', url: '/' }) : false;
}

// Called whenever a channel's story changes (src/ingest/pipeline.mjs).
export async function considerThread(threadId) {
  if (!pushReady || !threadId) return;
  const t = getThread(threadId);
  if (!t || !t.alert) return;
  const source = sources.find((x) => x.id === t.source_id);
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  for (const s of db.prepare('SELECT * FROM push_subs').all()) {
    if (!s.owner && !allowGuests()) continue;
    const favourite = JSON.parse(s.favorites).includes(t.source_id);
    const taste = multiplier(learned(s), t);
    const score = t.alert * (favourite ? FAVOURITE : 1) * taste;
    if (score < LEVELS[s.level] && !(favourite && t.alert >= 0.9)) continue;
    const last = db.prepare('SELECT alert FROM notifications WHERE sub_id = ? AND thread_id = ? ORDER BY id DESC LIMIT 1').get(s.id, t.id);
    if (last && t.alert < last.alert + ESCALATION) continue;
    const recent = db.prepare('SELECT COUNT(*) n FROM notifications WHERE sub_id = ? AND at >= ?').get(s.id, hourAgo).n;
    if (recent >= PER_HOUR && t.alert < 0.9) continue;

    const reasons = [favourite && '★ Favourite', t.alert >= 0.9 ? 'Major' : t.alert >= 0.6 ? 'Significant' : null, taste >= 1.3 && 'You like these', last && 'Update'].filter(Boolean);
    const title = `${source?.short || t.source_id}: ${t.subject}`;
    const body = [t.why || t.facts.slice(0, 2).map((f) => `${f.label}: ${f.value}`).join(' · '), reasons.join(' · ')].filter(Boolean).join('\n');
    const id = Number(db.prepare(`INSERT INTO notifications (sub_id, at, thread_id, source_id, type, alert, score, title, body) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(s.id, new Date().toISOString(), t.id, t.source_id, t.type, t.alert, score, title, body).lastInsertRowid);
    // tag: a newer notification about the same story replaces the older one on the device.
    await push(s, { title, body, tag: `story-${t.id}`, url: `/?n=${id}&story=${t.id}`, n: id }, t.alert >= 0.9 ? 'high' : 'normal');
  }
}

// What happened to a notification. `endpoint` proves it's this browser's own notification.
const ownNotification = (n, endpoint) => {
  const s = subRow(endpoint);
  return s && db.prepare('SELECT * FROM notifications WHERE id = ? AND sub_id = ?').get(Number(n), s.id);
};
export function recordOpened(n, endpoint) {
  const r = ownNotification(n, endpoint);
  if (r && !r.opened_at) db.prepare('UPDATE notifications SET opened_at = ? WHERE id = ?').run(new Date().toISOString(), r.id);
  return Boolean(r);
}
export function recordDwell(n, endpoint, seconds) {
  const r = ownNotification(n, endpoint);
  if (r) db.prepare('UPDATE notifications SET dwell_s = MAX(dwell_s, ?) WHERE id = ?').run(Math.min(3600, Number(seconds) || 0), r.id);
  return Boolean(r);
}
export function recordFeedback(n, endpoint, feedback) {
  const r = ownNotification(n, endpoint);
  if (r) db.prepare('UPDATE notifications SET feedback = ? WHERE id = ?').run(feedback > 0 ? 1 : -1, r.id);
  return Boolean(r);
}

// The "What I've learned" list: features that have moved away from neutral, strongest first.
export function learnedFor(endpoint) {
  const s = subRow(endpoint);
  if (!s) return [];
  const label = (k) => {
    const [kind, v] = k.split(':');
    return kind === 'channel' ? `${sources.find((x) => x.id === v)?.short || v} channel` : `${v} stories`;
  };
  return [...learned(s).values()].filter((x) => Math.abs(x.score) >= 0.25)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .map((x) => ({ label: label(x.key), weight: Math.round(2 ** (x.score / 2) * 100) / 100, sent: x.sent, opened: x.opened, more: x.more, fewer: x.fewer }));
}
export function resetLearning(endpoint) {
  db.prepare('UPDATE push_subs SET reset_at = ? WHERE endpoint = ?').run(new Date().toISOString(), endpoint);
}
