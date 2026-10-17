// Listener counts from Broadcastify. A feed suddenly drawing far more listeners than usual often
// means something is happening, so a surge gets a closer look: one AI call re-scores the channel's
// current story, which can raise its alert and so notify. LISTENER_POLL_S=0 turns this off.
import { db, currentThread, boostThread, newThread } from './db.mjs';
import { closerLook } from './ai/thread.mjs';
import { llmReady } from './ai/llm.mjs';
import { considerThread } from './notify.mjs';
import { status } from './ingest/pipeline.mjs';

const POLL_S = Number(process.env.LISTENER_POLL_S ?? 180);
const COOLDOWN_MS = 45 * 60e3; // per feed, between closer looks
const DAY = 864e5;

db.exec('CREATE TABLE IF NOT EXISTS listener_samples (source_id TEXT NOT NULL, at TEXT NOT NULL, n INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS listener_samples_source ON listener_samples (source_id, at)');

export const feedId = (s) => (/audio\.broadcastify\.com\/(\d+)/.exec(s.streamUrl || '') || /broadcastify\.com\/listen\/feed\/(\d+)/.exec(s.listenUrl || ''))?.[1] ?? null;
const lastLook = new Map();

// The feed's usual audience at this time: the median for this hour of the week over 4 weeks, else
// for this hour of the day over a week, else over the last day.
function usual(sourceId, now) {
  const rows = db.prepare('SELECT at, n FROM listener_samples WHERE source_id = ? AND at >= ?').all(sourceId, new Date(now - 28 * DAY).toISOString())
    .map((r) => ({ t: new Date(r.at), n: r.n }));
  const sets = [
    [rows.filter((r) => r.t.getDay() === now.getDay() && r.t.getHours() === now.getHours()), 3],
    [rows.filter((r) => now - r.t < 7 * DAY && r.t.getHours() === now.getHours()), 3],
    [rows.filter((r) => now - r.t < DAY), 10],
  ];
  const set = sets.find(([s, min]) => s.length >= min)?.[0];
  if (!set) return null;
  const v = set.map((r) => r.n).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

export async function pollListeners(sources) {
  const now = new Date();
  for (const s of sources) {
    const id = feedId(s);
    if (!id) continue;
    const r = await fetch(`https://api.broadcastify.com/listeners/feed/${id}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const raw = r?.ok ? Number((await r.text()).trim()) : NaN;
    if (!Number.isFinite(raw)) continue;
    const connected = ['receiving', 'tuning'].includes(status[s.id]?.state);
    const n = Math.max(0, raw - (connected ? 1 : 0)); // our own recorder is one of the listeners
    const u = usual(s.id, now);
    db.prepare('INSERT INTO listener_samples (source_id, at, n) VALUES (?,?,?)').run(s.id, now.toISOString(), n);
    if (u != null && n >= 6 && n >= Math.max(u * 3, u + 5) && Date.now() - (lastLook.get(s.id) || 0) > COOLDOWN_MS) {
      lastLook.set(s.id, Date.now());
      await surge(s, n, u).catch((e) => console.warn('[listeners]', e.message));
    }
  }
  db.prepare('DELETE FROM listener_samples WHERE at < ?').run(new Date(Date.now() - 35 * DAY).toISOString());
}

async function surge(source, n, u) {
  const fact = { label: 'Listeners', value: `${n} (usually ${u})` };
  const ratio = `${Math.round(n / Math.max(u, 1))}× usual listeners`;
  const story = currentThread(source.id, 20);
  if (story && llmReady()) {
    const look = await closerLook({ source, listeners: n, usual: u, story });
    boostThread(story.id, { alert: Number(look.alert) || 0, why: [look.why, ratio].filter(Boolean).join(' · '), fact });
    console.log(`[listeners] ${source.id}: ${n} vs usual ${u} → story ${story.id} re-scored ${look.alert}`);
    return considerThread(story.id);
  }
  // Nothing transcribed lately (or a listen-only feed): only a big surge becomes a story on its own.
  if (n < 10 || n < u * 5) return;
  console.log(`[listeners] ${source.id}: ${n} vs usual ${u} → surge story`);
  return considerThread(newThread(source.id, { subject: 'Listener surge', facts: [fact], type: 'other', alert: 0.6, why: `${ratio}, nothing transcribed to explain it yet` }));
}

export function startListeners(sources) {
  if (!POLL_S) return;
  const run = () => pollListeners(sources).catch((e) => console.warn('[listeners]', e.message));
  setTimeout(run, 30e3);
  setInterval(run, POLL_S * 1000);
}
