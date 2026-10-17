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

// Score needed to notify, by sensitivity. Favourite channels count 1.4× toward it.
export const LEVELS = { quiet: 0.8, normal: 0.6, chatty: 0.4 };
const FAVOURITE = 1.4;
const ESCALATION = 0.25; // a story already notified only notifies again after rising this much
const PER_HOUR = 6; // per browser, except major events (alert ≥ 0.9)

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
    const score = t.alert * (favourite ? FAVOURITE : 1);
    if (score < LEVELS[s.level]) continue;
    const last = db.prepare('SELECT alert FROM notifications WHERE sub_id = ? AND thread_id = ? ORDER BY id DESC LIMIT 1').get(s.id, t.id);
    if (last && t.alert < last.alert + ESCALATION) continue;
    const recent = db.prepare('SELECT COUNT(*) n FROM notifications WHERE sub_id = ? AND at >= ?').get(s.id, hourAgo).n;
    if (recent >= PER_HOUR && t.alert < 0.9) continue;

    const reasons = [favourite && '★ Favourite', t.alert >= 0.9 ? 'Major' : t.alert >= 0.6 ? 'Significant' : null, last && 'Update'].filter(Boolean);
    const title = `${source?.short || t.source_id}: ${t.subject}`;
    const body = [t.why || t.facts.slice(0, 2).map((f) => `${f.label}: ${f.value}`).join(' · '), reasons.join(' · ')].filter(Boolean).join('\n');
    const id = Number(db.prepare(`INSERT INTO notifications (sub_id, at, thread_id, source_id, type, alert, score, title, body) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(s.id, new Date().toISOString(), t.id, t.source_id, t.type, t.alert, score, title, body).lastInsertRowid);
    // tag: a newer notification about the same story replaces the older one on the device.
    await push(s, { title, body, tag: `story-${t.id}`, url: `/?n=${id}&story=${t.id}`, n: id }, t.alert >= 0.9 ? 'high' : 'normal');
  }
}
