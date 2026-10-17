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

export const ANIM_DIR = join('data', 'animations');
export const animDir = (id) => join(ANIM_DIR, String(id));

const parse = (r) => r && { ...r, models: JSON.parse(r.models), files: JSON.parse(r.files) };

export const listAnimations = () => db.prepare('SELECT * FROM animations ORDER BY id DESC').all().map(parse);
export const getAnimation = (id) => parse(db.prepare('SELECT * FROM animations WHERE id = ?').get(id));

export function createAnimation(a) {
  const id = Number(db.prepare(`INSERT INTO animations (thread_id, source_id, title, style, format, status, created_at, finished_at, duration_s, render_s, cost_usd, models, prompt_version, files, error, notes, rating)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.thread_id ?? null, a.source_id ?? null, a.title, a.style, a.format, a.status || 'queued',
    a.created_at || new Date().toISOString(), a.finished_at ?? null, a.duration_s ?? null, a.render_s ?? null, a.cost_usd ?? null, JSON.stringify(a.models || []),
    a.prompt_version ?? null, JSON.stringify(a.files || []), a.error ?? null, a.notes ?? null, a.rating ?? null).lastInsertRowid);
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
  rmSync(animDir(id), { recursive: true, force: true });
}

// The files actually in an animation's folder, for the row's `files` list.
const KIND = { '.mp4': 'mp4', '.html': 'web', '.png': 'image', '.jpg': 'image', '.mp3': 'audio', '.json': 'data' };
export function scanFiles(id) {
  const dir = animDir(id);
  return readdirSync(dir).sort().map((name) => ({ name, kind: KIND[name.slice(name.lastIndexOf('.'))] || 'other', bytes: statSync(join(dir, name)).size }));
}
