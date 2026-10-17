// Squelch Studio's library: one row per animation, its files in data/animations/<id>/ (never auto-pruned).
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS animations (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER,
  source_id TEXT,
  title TEXT NOT NULL,
  style TEXT NOT NULL,          -- sunday | ink | pixel | vector
  format TEXT NOT NULL,         -- mp4+web | web
  status TEXT NOT NULL,         -- queued | running | done | failed
  created_at TEXT NOT NULL,
  finished_at TEXT,
  duration_s REAL,
  render_s REAL,                -- seconds spent rendering the MP4
  cost_usd REAL,                -- null when it wasn't metered
  models TEXT NOT NULL DEFAULT '[]', -- JSON [{ model, purpose, calls, cost }]
  prompt_version TEXT,
  files TEXT NOT NULL DEFAULT '[]',  -- JSON [{ name, kind: mp4 | web | image, bytes }]
  error TEXT,
  notes TEXT,
  rating INTEGER
)`);
try { db.exec('ALTER TABLE animations ADD COLUMN llm TEXT'); } catch { /* already there */ } // openrouter | claude: who wrote the script and plan

try { db.exec('ALTER TABLE animations ADD COLUMN requested_by TEXT'); } catch { /* already there */ } // null or 'owner', or 'guest <ip>'
try { db.exec('ALTER TABLE animations ADD COLUMN est_usd REAL'); } catch { /* already there */ } // the estimate a job was queued at
// A guest's rating of an animation: one per animation per IP, a later one replaces the earlier.
db.exec(`CREATE TABLE IF NOT EXISTS animation_guest_ratings (
  animation_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  rating INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (animation_id, ip)
)`);

export const ANIM_DIR = join('data', 'animations');
export const animDir = (id) => join(ANIM_DIR, String(id));

const parse = (r) => r && { ...r, models: JSON.parse(r.models), files: JSON.parse(r.files) };

export const listAnimations = () => db.prepare('SELECT * FROM animations ORDER BY id DESC').all().map(parse);
export const getAnimation = (id) => parse(db.prepare('SELECT * FROM animations WHERE id = ?').get(id));

export function createAnimation(a) {
  const id = Number(db.prepare(`INSERT INTO animations (thread_id, source_id, title, style, format, status, created_at, finished_at, duration_s, render_s, cost_usd, models, prompt_version, files, error, notes, rating, llm, requested_by, est_usd)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.thread_id ?? null, a.source_id ?? null, a.title, a.style, a.format, a.status || 'queued',
    a.created_at || new Date().toISOString(), a.finished_at ?? null, a.duration_s ?? null, a.render_s ?? null, a.cost_usd ?? null, JSON.stringify(a.models || []),
    a.prompt_version ?? null, JSON.stringify(a.files || []), a.error ?? null, a.notes ?? null, a.rating ?? null, a.llm ?? null, a.requested_by ?? null, a.est_usd ?? null).lastInsertRowid);
  mkdirSync(animDir(id), { recursive: true });
  return id;
}

const COLS = new Set(['title', 'format', 'status', 'finished_at', 'duration_s', 'render_s', 'cost_usd', 'models', 'prompt_version', 'files', 'error', 'notes', 'rating']);
export function updateAnimation(id, u) {
  const keys = Object.keys(u).filter((k) => COLS.has(k));
  if (!keys.length) return;
  db.prepare(`UPDATE animations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => (k === 'models' || k === 'files' ? JSON.stringify(u[k]) : u[k] ?? null)), id);
}

export function deleteAnimation(id) {
  db.prepare('DELETE FROM animations WHERE id = ?').run(id);
  db.prepare('DELETE FROM animation_guest_ratings WHERE animation_id = ?').run(id);
  rmSync(animDir(id), { recursive: true, force: true });
}

// The files actually in an animation's folder, for the row's `files` list.
const KIND = { '.mp4': 'mp4', '.html': 'web', '.png': 'image', '.jpg': 'image', '.mp3': 'audio', '.json': 'data' };
export function scanFiles(id) {
  const dir = animDir(id);
  return readdirSync(dir).sort().map((name) => ({ name, kind: KIND[name.slice(name.lastIndexOf('.'))] || 'other', bytes: statSync(join(dir, name)).size }));
}

export function rateAsGuest(id, ip, rating) {
  if (rating == null) db.prepare('DELETE FROM animation_guest_ratings WHERE animation_id = ? AND ip = ?').run(id, ip);
  else db.prepare('INSERT OR REPLACE INTO animation_guest_ratings (animation_id, ip, rating, at) VALUES (?,?,?,?)').run(id, ip, rating, new Date().toISOString());
}

// What a viewer is shown of an animation. The owner sees who asked for it (a guest's IP included) and how guests rated it;
// a guest sees only "owner" or "a guest", and their own rating in place of the owner's.
export function viewOf(a, ip, owner) {
  if (owner) {
    const g = db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM animation_guest_ratings WHERE animation_id = ?').get(a.id);
    return { ...a, requested_by: a.requested_by || 'owner', guest_ratings: g.n ? { n: g.n, avg: +g.avg.toFixed(1) } : null };
  }
  const mine = db.prepare('SELECT rating FROM animation_guest_ratings WHERE animation_id = ? AND ip = ?').get(a.id, ip);
  const { error, notes, ...rest } = a; // what went wrong and the engine's notes are the owner's
  return { ...rest, requested_by: a.requested_by?.startsWith('guest') ? 'a guest' : 'owner', rating: mine?.rating ?? null };
}

// Guest jobs this IP has queued since local midnight (failed ones count: they spent money too).
export const guestJobsToday = (by, since) => db.prepare('SELECT COUNT(*) AS n FROM animations WHERE requested_by = ? AND created_at >= ?').get(by, since).n;

// Estimates of jobs that are queued and haven't started, and what guests have spent and queued since `since`.
export const queuedUsd = () => db.prepare(`SELECT COALESCE(SUM(est_usd), 0) AS c FROM animations WHERE status = 'queued'`).get().c;
export const guestUsd = (since) => db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'queued' THEN COALESCE(est_usd, 0) ELSE COALESCE(cost_usd, 0) END), 0) AS c FROM animations WHERE requested_by LIKE 'guest %' AND created_at >= ?`).get(since).c;
