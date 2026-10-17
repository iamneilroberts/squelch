import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/scanner.db');

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  at TEXT NOT NULL,
  duration REAL,
  audio TEXT,
  transcript TEXT,
  incident_id INTEGER,
  category TEXT
);
CREATE INDEX IF NOT EXISTS calls_at ON calls(at);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT,
  category TEXT,
  type TEXT,
  location_text TEXT,
  lat REAL, lng REAL,
  precision TEXT,
  units TEXT,
  confidence REAL
);
CREATE INDEX IF NOT EXISTS incidents_updated ON incidents(updated_at);
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY,
  incident_id INTEGER NOT NULL,
  call_id INTEGER,
  at TEXT NOT NULL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS geocache (
  q TEXT PRIMARY KEY,
  lat REAL, lng REAL,
  label TEXT
);
`);

const parseIncident = (r) => r && { ...r, units: r.units ? JSON.parse(r.units) : [] };

export function insertCall(c) {
  const r = db.prepare(`INSERT INTO calls (source_id, at, duration, audio, transcript) VALUES (?,?,?,?,?)`)
    .run(c.source_id, c.at, c.duration, c.audio, c.transcript);
  return Number(r.lastInsertRowid);
}

export function tagCall(id, incidentId, category) {
  db.prepare(`UPDATE calls SET incident_id = ?, category = ? WHERE id = ?`).run(incidentId, category, id);
}

export function createIncident(i) {
  const r = db.prepare(`INSERT INTO incidents
    (source_id, opened_at, updated_at, headline, summary, category, type, location_text, lat, lng, precision, units, confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(i.source_id, i.at, i.at, i.headline, i.summary, i.category, i.type, i.location_text,
      i.lat, i.lng, i.precision, JSON.stringify(i.units || []), i.confidence);
  const id = Number(r.lastInsertRowid);
  db.prepare(`INSERT INTO updates (incident_id, call_id, at, summary) VALUES (?,?,?,?)`)
    .run(id, i.call_id ?? null, i.at, i.summary);
  return getIncident(id);
}

export function updateIncident(id, u) {
  const cur = getIncident(id);
  if (!cur) return null;
  const units = [...new Set([...cur.units, ...(u.units || [])])];
  // A geocoded address beats the source's fallback position; never downgrade.
  const better = u.lat != null && u.precision !== 'source' && (cur.precision === 'source' || cur.lat == null);
  db.prepare(`UPDATE incidents SET updated_at = ?, summary = ?, units = ?,
      category = CASE WHEN ? = 'breaking' THEN 'breaking' ELSE category END,
      location_text = ?, lat = ?, lng = ?, precision = ? WHERE id = ?`)
    .run(u.at, u.summary || cur.summary, JSON.stringify(units), u.category,
      better ? u.location_text : cur.location_text,
      better ? u.lat : cur.lat, better ? u.lng : cur.lng, better ? u.precision : cur.precision, id);
  db.prepare(`INSERT INTO updates (incident_id, call_id, at, summary) VALUES (?,?,?,?)`)
    .run(id, u.call_id ?? null, u.at, u.summary);
  return getIncident(id);
}

export function getIncident(id) {
  const inc = parseIncident(db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id));
  if (inc) inc.updates = db.prepare(`SELECT u.at, u.summary, c.transcript, c.audio, c.thread_id FROM updates u
    LEFT JOIN calls c ON c.id = u.call_id WHERE u.incident_id = ? ORDER BY u.at`).all(id);
  return inc;
}

export function recentIncidents(hours = 12) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  return db.prepare(`SELECT id FROM incidents WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 300`)
    .all(since).map((r) => {
      const inc = getIncident(r.id);
      for (const u of inc.updates) delete u.transcript; // fetched per incident when opened (/api/incidents/<id>)
      return inc;
    });
}

export function openIncidentsFor(sourceId, minutes = 45) {
  const since = new Date(Date.now() - minutes * 60e3).toISOString();
  return db.prepare(`SELECT id, headline, location_text, units FROM incidents
    WHERE source_id = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 15`).all(sourceId, since);
}

export function recentCalls(limit = 100) {
  return db.prepare(`SELECT * FROM calls WHERE transcript IS NOT NULL AND transcript != ''
    ORDER BY at DESC LIMIT ?`).all(limit);
}

export const geocache = {
  get: (q) => db.prepare(`SELECT lat, lng, label FROM geocache WHERE q = ?`).get(q),
  set: (q, v) => db.prepare(`INSERT OR REPLACE INTO geocache (q, lat, lng, label) VALUES (?,?,?,?)`)
    .run(q, v?.lat ?? null, v?.lng ?? null, v?.label ?? null),
};

// Audio clips older than `hours` are deleted from disk (the transcript stays), except clips a digest kept.
// Transcripts, updates and stories older than `days` are deleted; calls a daily digest kept stay.
export function pruneHistory(days) {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  db.prepare('DELETE FROM calls WHERE at < ? AND keep = 0').run(before);
  db.prepare('DELETE FROM updates WHERE at < ?').run(before);
  db.prepare('DELETE FROM threads WHERE updated_at < ? AND id NOT IN (SELECT thread_id FROM calls WHERE thread_id IS NOT NULL)').run(before);
}

export function expireAudio(hours) {
  const before = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = db.prepare(`SELECT audio FROM calls WHERE at < ? AND audio IS NOT NULL AND keep = 0`).all(before);
  db.prepare(`UPDATE calls SET audio = NULL WHERE at < ? AND keep = 0`).run(before);
  return rows.map((r) => r.audio);
}

/* ───────── Daily digests ───────── */
for (const col of ['keep INTEGER NOT NULL DEFAULT 0', 'jev_speech REAL', 'jev_news REAL', 'gate TEXT', 'cues TEXT', 'subject TEXT', 'thread_id INTEGER', 'note TEXT']) {
  try { db.exec(`ALTER TABLE calls ADD COLUMN ${col}`); } catch { /* already there */ }
}

// Caption cues (JSON [{start,end,text}]) are built on first playback and cached here.
db.exec('CREATE INDEX IF NOT EXISTS calls_audio ON calls (audio)');
export const callByAudio = (audio) => db.prepare('SELECT id, audio, transcript, cues FROM calls WHERE audio = ?').get(audio);
// Transmissions as the scan announces them (src/scan.mjs): what the page shows, without the caption cues.
const SCAN_COLS = 'id, source_id, at, duration, audio, transcript, incident_id, category, subject, thread_id';
export const scanCall = (id) => db.prepare(`SELECT ${SCAN_COLS} FROM calls WHERE id = ?`).get(id);
export const scanCallsSince = (since) => db.prepare(`SELECT ${SCAN_COLS} FROM calls
  WHERE audio IS NOT NULL AND transcript IS NOT NULL AND transcript != '' AND at >= ? ORDER BY at DESC LIMIT 30`).all(since);
/* Channel stories (src/ai/thread.mjs): a thread is one conversation on one channel. Its calls carry
   the subject at that moment and a one-line chronology note. */
db.exec(`CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  facts TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
for (const col of ['type TEXT', 'alert REAL NOT NULL DEFAULT 0', 'why TEXT']) {
  try { db.exec(`ALTER TABLE threads ADD COLUMN ${col}`); } catch { /* already there */ }
}
db.exec('CREATE INDEX IF NOT EXISTS threads_source ON threads (source_id, updated_at)');
db.exec('CREATE INDEX IF NOT EXISTS calls_thread ON calls (thread_id)');
db.exec('CREATE INDEX IF NOT EXISTS updates_incident ON updates (incident_id)');

// The channel's ongoing story: its latest thread, if that was updated within `minutes`.
export function currentThread(sourceId, minutes = 30) {
  const since = new Date(Date.now() - minutes * 60e3).toISOString();
  const t = db.prepare('SELECT * FROM threads WHERE source_id = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1').get(sourceId, since);
  if (!t) return null;
  const calls = db.prepare('SELECT note, transcript FROM calls WHERE thread_id = ? ORDER BY id').all(t.id);
  return { id: t.id, subject: t.subject, facts: JSON.parse(t.facts), notes: calls.map((c) => c.note).filter(Boolean).slice(-12), transcripts: calls.slice(-2).map((c) => c.transcript) };
}

// Continue thread `threadId`, or start a new one when it's null. Returns the thread id.
export function saveThread(callId, sourceId, at, threadId, { subject, facts, note, type, alert, why }) {
  let id = threadId;
  const a = Math.max(0, Math.min(1, Number(alert) || 0));
  if (id) db.prepare('UPDATE threads SET subject = ?, facts = ?, updated_at = ?, type = ?, alert = ?, why = ? WHERE id = ?').run(subject, JSON.stringify(facts), at, type || null, a, why || null, id);
  else id = Number(db.prepare('INSERT INTO threads (source_id, subject, facts, started_at, updated_at, type, alert, why) VALUES (?,?,?,?,?,?,?,?)').run(sourceId, subject, JSON.stringify(facts), at, at, type || null, a, why || null).lastInsertRowid);
  db.prepare('UPDATE calls SET thread_id = ?, subject = ?, note = ? WHERE id = ?').run(id, subject, note || null, callId);
  return id;
}

// A listener surge records the audience as a fact and may raise the story's alert (never lower it).
export function boostThread(id, { alert, why, fact }) {
  const t = db.prepare('SELECT alert, why, facts FROM threads WHERE id = ?').get(id);
  const facts = [...JSON.parse(t.facts).filter((f) => f.label !== fact.label), fact].slice(-6);
  const higher = alert > t.alert;
  db.prepare('UPDATE threads SET alert = ?, why = ?, facts = ? WHERE id = ?').run(higher ? Math.min(1, alert) : t.alert, higher ? why : t.why, JSON.stringify(facts), id);
}

// A story with no transmissions behind it (a listener surge nobody on the channel has explained yet).
export function newThread(sourceId, { subject, facts, type, alert, why }) {
  const at = new Date().toISOString();
  return Number(db.prepare('INSERT INTO threads (source_id, subject, facts, started_at, updated_at, type, alert, why) VALUES (?,?,?,?,?,?,?,?)')
    .run(sourceId, subject, JSON.stringify(facts), at, at, type, alert, why).lastInsertRowid);
}

export function getThread(id) {
  const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  if (!t) return null;
  const events = db.prepare('SELECT id, at, note, audio, transcript FROM calls WHERE thread_id = ? ORDER BY at').all(id);
  return { ...t, facts: JSON.parse(t.facts), events };
}

// Stories updated in the last `hours`, latest first, each with its transmission count and newest transmission.
export function recentThreads(hours = 3) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  return db.prepare(`SELECT t.id, t.source_id, t.subject, t.type, t.alert, t.started_at, t.updated_at, t.facts,
      (SELECT COUNT(*) FROM calls WHERE thread_id = t.id) AS count, c.id AS last_id, c.at, c.note, c.transcript
    FROM threads t LEFT JOIN calls c ON c.id = (SELECT id FROM calls WHERE thread_id = t.id ORDER BY at DESC, id DESC LIMIT 1)
    WHERE t.updated_at >= ? ORDER BY t.updated_at DESC LIMIT 50`).all(since)
    .map(({ last_id, at, note, transcript, ...t }) => ({ ...t, facts: JSON.parse(t.facts), last: last_id ? { id: last_id, at, note, transcript } : null }));
}

export const setCues = (id, cues) => db.prepare('UPDATE calls SET cues = ? WHERE id = ?').run(JSON.stringify(cues), id);

// Jev gate answers per call; `decision` is pass | skip | audit in active mode, null otherwise.
export function setGate(callId, g, decision = null) {
  db.prepare('UPDATE calls SET jev_speech = ?, jev_news = ?, gate = ? WHERE id = ?').run(g?.speech ?? null, g?.newsworthy ?? null, decision, callId);
}
db.exec(`CREATE TABLE IF NOT EXISTS digests (
  date TEXT NOT NULL,
  region TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model TEXT,
  cost REAL,
  calls INTEGER,
  reel TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (date, region)
)`);

export function callsBetween(fromIso, toIso) {
  return db.prepare(`SELECT id, source_id, at, duration, audio, transcript, category FROM calls
    WHERE at >= ? AND at < ? AND transcript IS NOT NULL AND transcript != '' ORDER BY at`).all(fromIso, toIso);
}

// Wider catch-up candidates (src/ai/wider.mjs): playable transmissions on any channel outside one story,
// with what threading and triage made of them.
export function widerCandidates(fromIso, toIso, threadId) {
  return db.prepare(`SELECT c.id, c.source_id, c.at, c.audio, c.transcript, c.note, c.thread_id, c.incident_id, t.subject, i.headline, i.location_text, i.units
    FROM calls c LEFT JOIN threads t ON t.id = c.thread_id LEFT JOIN incidents i ON i.id = c.incident_id
    WHERE c.at >= ? AND c.at < ? AND c.audio IS NOT NULL AND c.transcript IS NOT NULL AND c.transcript != ''
      AND (c.thread_id IS NULL OR c.thread_id != ?) ORDER BY c.at`).all(fromIso, toIso, threadId);
}

export function keepCalls(ids) {
  const stmt = db.prepare(`UPDATE calls SET keep = 1 WHERE id = ?`);
  for (const id of ids) stmt.run(id);
}

export function saveDigest(d) {
  db.prepare(`INSERT OR REPLACE INTO digests (date, region, created_at, model, cost, calls, reel, body) VALUES (?,?,?,?,?,?,?,?)`)
    .run(d.date, d.region, d.created_at, d.model, d.cost, d.calls, d.reel, JSON.stringify(d.body));
}

const parseDigest = (r) => r && { ...r, body: JSON.parse(r.body) };
export const getDigest = (date, region) => parseDigest(db.prepare(`SELECT * FROM digests WHERE date = ? AND region = ?`).get(date, region));
export const listDigests = () => db.prepare(`SELECT date, region, created_at, calls, reel, json_extract(body, '$.headline') AS headline
  FROM digests ORDER BY date DESC, region LIMIT 120`).all();
