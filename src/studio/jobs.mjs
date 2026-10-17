// Studio jobs: one at a time, server-side. Each runs script → pictures → render → files, metering every
// model call and checking the daily cap before each one. Progress lives in memory; the row is the record.
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, getThread } from '../db.mjs';
import { withTrace } from '../meter.mjs';
import { sources } from '../config.mjs';
import { createAnimation, updateAnimation, getAnimation, animDir, scanFiles, guestJobsToday, queuedUsd, guestUsd } from './library.mjs';
import { guard, safeScore } from './humor.mjs';
import { MODELS, estimate, checkCap, spentToday, dailyCap, guestCap } from './spend.mjs';
import { dayBounds, localDate } from '../digest.mjs';
import { STYLES, SCRIPT_SCHEMA, scriptPrompt } from './script.mjs';
import { pickClips, buildTrack } from './track.mjs';
import { makeComic } from './comic.mjs';
import { makeCartoon } from './cartoon.mjs';
import { chromePath } from './browser.mjs';
import { studioJson, pickProvider, defaultProvider, subscriptionModel, PROVIDERS } from './llm.mjs';
import { directorPrompt } from './director.mjs';
import { cleanNotes } from './notes.mjs';

// The cartoon is two-pass (director + library) unless STUDIO_CARTOON_MODE=oneshot; the row's prompt_version records which.
const cartoonMode = () => (process.env.STUDIO_CARTOON_MODE === 'oneshot' ? 'oneshot' : 'twopass');
const PROMPT_VERSION = { comic: () => 'comic-1', cartoon: () => (cartoonMode() === 'oneshot' ? 'cartoon-1' : 'twopass-1') };
const PANELS = 5;
const progress = new Map(); // id → { step, frac }

// A server restart loses the job in progress; queued ones are picked up again.
db.prepare(`UPDATE animations SET status = 'failed', error = 'The server restarted during the job', finished_at = ? WHERE status = 'running'`).run(new Date().toISOString());

export class JobError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

// The story, if the content guard lets it be animated.
function storyFor(threadId) {
  const t = getThread(Number(threadId));
  const why = guard(t);
  if (why) throw new JobError(`The content guard keeps this story out (${why})`, 403);
  if (!safeScore(t)) throw new JobError('This story isn’t scored as light and safe in its current form (Refresh scores new and changed stories)', 403);
  return t;
}

// What a job should cost, call by call, from per-token prices.
// Text steps on the Claude subscription cost $0 here (and don't count against the cap).
export async function estimateJob(threadId, style, llm, by = 'owner') {
  if (!STYLES[style]) throw new JobError('unknown style', 400);
  const t = storyFor(threadId);
  const kind = STYLES[style].kind, provider = pickProvider(llm), sub = provider === 'claude';
  const text = async (purpose, model, tokens) => ({ purpose, model: sub ? subscriptionModel(model) : model, usd: sub ? 0 : await estimate(model, tokens) });
  const said = t.events.map((e) => e.transcript || '').join(' ').length;
  const lines = [await text('studio:script', MODELS.script(), { inTok: 1800 + said / 3.5, outTok: 2500 })];
  if (kind === 'comic') lines.push({ purpose: 'studio:image', model: MODELS.image(), calls: PANELS, usd: PANELS * await estimate(MODELS.image(), { inTok: 2200, imageTok: 1290 }) });
  else if (cartoonMode() === 'oneshot') lines.push({ purpose: 'studio:cartoon', model: MODELS.cartoon(), usd: await estimate(MODELS.cartoon(), { inTok: 9000, outTok: 14000 }) });
  else {
    const p = directorPrompt({ title: '', cast: '', beats: [], punch: [] }, { end: 0, total: 0, clips: [], captions: [] });
    lines.push(await text('studio:director', MODELS.director(), { inTok: (p.system.length + p.user.length + 2500) / 1.6, outTok: 4000 })); // the catalogue and examples are JSON-dense: ~1.6 chars a token
    lines.push({ purpose: 'studio:render', model: 'library + headless Chrome', usd: 0 });
  }
  const usd = lines.reduce((a, l) => a + l.usd, 0);
  const today = spentToday(), queued = queuedUsd(); // queued jobs haven't spent anything yet but will
  const dailyOk = today + queued + usd <= dailyCap();
  const guestSpent = by === 'owner' ? 0 : guestUsd(dayBounds(localDate())[0]);
  const guestOk = by === 'owner' || guestSpent + usd <= guestCap();
  return {
    kind, style, usd, lines, today: today + queued, cap: dailyCap(), dailyOk, guestOk, fits: dailyOk && guestOk, llm: provider, llmName: PROVIDERS[provider],
    format: kind === 'comic' ? 'mp4+web' : chromePath() ? 'mp4+web' : 'web',
    note: kind === 'comic' ? 'A panel that comes back without a picture is redrawn once.'
      : cartoonMode() === 'oneshot' ? 'A cartoon that fails its check is rewritten once, which can roughly double its cost.'
        : 'A plan with problems goes back to the director once, which can roughly double that step.',
  };
}

export const GUEST_JOBS_PER_DAY = 2;

// The viewer's notes, cleaned and guarded; a JobError (400) says why when they can't be used.
export function checkNotes(raw) {
  const { text, error } = cleanNotes(raw);
  if (error) throw new JobError(error, 400);
  return text;
}

// `by` is 'owner' or 'guest <email or address>'. A guest's job always plans with OpenRouter (never the owner's Claude subscription)
// and is limited to GUEST_JOBS_PER_DAY a day per guest and to the guests' share of the daily cap.
export async function queueJob(threadId, style, llm, by = 'owner', { notes = '' } = {}) {
  const guest = by !== 'owner';
  const instructions = checkNotes(notes);
  const est = await estimateJob(threadId, style, guest ? 'openrouter' : llm, by);
  if (!est.guestOk) throw new JobError(`Guests have used their share of today’s Studio budget (STUDIO_GUEST_USD, $${guestCap().toFixed(2)}). Try again tomorrow.`, 429);
  if (!est.dailyOk) throw new JobError(`That would pass today’s Studio cap: $${est.today.toFixed(3)} spent, about $${est.usd.toFixed(3)} more, cap $${est.cap.toFixed(2)} (STUDIO_DAILY_USD)`, 429);
  if (guest && guestJobsToday(by, dayBounds(localDate())[0]) >= GUEST_JOBS_PER_DAY) throw new JobError(`Guests can make ${GUEST_JOBS_PER_DAY} animations a day each, and you’ve made them for today. Try again tomorrow.`, 429);
  const t = getThread(Number(threadId));
  const id = createAnimation({ thread_id: t.id, source_id: t.source_id, title: t.subject, style, format: est.format, status: 'queued', prompt_version: PROMPT_VERSION[est.kind](), llm: est.llm, requested_by: by, est_usd: est.usd, instructions });
  setImmediate(pump);
  return getAnimation(id);
}

export const activeJobs = () => db.prepare(`SELECT id, title, style, status, created_at FROM animations WHERE status IN ('queued', 'running') ORDER BY id`).all()
  .map((r) => ({ ...r, progress: progress.get(r.id) || null }));

let busy = false;
async function pump() {
  if (busy) return;
  const next = db.prepare(`SELECT id FROM animations WHERE status = 'queued' ORDER BY id LIMIT 1`).get();
  if (!next) return;
  busy = true;
  try { await run(next.id); } finally { busy = false; progress.delete(next.id); setImmediate(pump); }
}
setTimeout(pump, 5e3);

async function run(id) {
  const row = getAnimation(id);
  const dir = animDir(id);
  mkdirSync(dir, { recursive: true });
  updateAnimation(id, { status: 'running', error: null });
  const models = new Map(); // `${model}\n${purpose}` → { model, purpose, calls, cost }
  let cost = 0;
  const job = {
    id, dir, notes: row.instructions || '',
    models: { image: MODELS.image(), cartoon: MODELS.cartoon(), director: MODELS.director() },
    progress: (step, frac = null) => progress.set(id, { step, frac }),
    // One paid call: refused first if it could pass the cap; its actual cost (usage.cost) is recorded.
    async call(purpose, model, tokens, fn, costOf) {
      checkCap(await estimate(model, tokens));
      const key = `${model}\n${purpose}`;
      const m = models.get(key) || { model, purpose, calls: 0, cost: 0 };
      models.set(key, m);
      m.calls++;
      try {
        const r = await fn();
        const c = Number(costOf(r)) || 0;
        m.cost += c; cost += c;
        return r;
      } finally {
        updateAnimation(id, { models: [...models.values()].map((x) => ({ ...x, cost: +x.cost.toFixed(6) })), cost_usd: +cost.toFixed(6) });
      }
    },
    // One subscription call: $0 here and no cap check; the CLI's notional cost and its time are kept for comparison.
    async free(purpose, model, fn, metaOf) {
      const key = `${model}\n${purpose}`;
      const m = models.get(key) || { model, purpose, calls: 0, cost: 0, notional_usd: 0, ms: 0 };
      models.set(key, m);
      m.calls++;
      try {
        const r = await fn();
        const x = metaOf(r) || {};
        m.notional_usd = +(m.notional_usd + (Number(x.notional_usd) || 0)).toFixed(6);
        m.ms += Number(x.ms) || 0;
        return r;
      } finally {
        updateAnimation(id, { models: [...models.values()].map((x) => ({ ...x, cost: +x.cost.toFixed(6) })), cost_usd: +cost.toFixed(6) });
      }
    },
  };
  try {
    await withTrace({ kind: 'studio', label: row.title, source_id: row.source_id }, async () => {
      const t = storyFor(row.thread_id); // checked again: the story may have changed since it was queued
      const kind = STYLES[row.style].kind;
      const src = sources.find((s) => s.id === t.source_id);
      const subtitle = `${src?.area || src?.name || t.source_id} · real radio`;

      job.progress('gathering the radio clips');
      const clips = await pickClips(t);
      if (!clips.length) throw new Error('None of the story’s recordings are left');

      job.progress('writing the script');
      const { system, user } = scriptPrompt(t, clips, row.style, job.notes);
      const provider = row.llm || defaultProvider();
      const { data: script } = await studioJson(job, { provider, purpose: 'studio:script', model: MODELS.script(), system, user, schema: SCRIPT_SCHEMA, name: 'script', maxTokens: 8000, outTok: 2500 });
      updateAnimation(id, { title: script.title || row.title });
      writeFileSync(join(dir, 'script.json'), JSON.stringify(script, null, 1));

      // Only the clips the script kept, in order, re-indexed for captions and panels.
      const keep = [...new Set(script.use)].filter((i) => clips[i]).sort((a, b) => a - b);
      const used = keep.length ? keep.map((i) => clips[i]) : clips;
      const remap = (i) => Math.max(0, keep.filter((k) => k <= i).length - 1); // a dropped clip's panel starts on the kept one before it
      script.captions = script.captions.map((c) => ({ ...c, clip: keep.length ? keep.indexOf(c.clip) : c.clip })).filter((c) => c.clip >= 0);
      script.panels = script.panels.map((p) => ({ ...p, from_clip: keep.length ? remap(p.from_clip) : p.from_clip }));

      job.progress('mixing the audio');
      const file = join(dir, 'track.mp3');
      const track = { ...await buildTrack(used, file, kind === 'comic' ? {} : { intro: 1.5, tail: 5 }), file };

      const made = kind === 'comic' ? await makeComic(job, { script, track, style: row.style, subtitle }) : await makeCartoon(job, { script, track, subtitle, provider, mode: row.prompt_version === 'cartoon-1' ? 'oneshot' : 'twopass' });
      rmSync(join(dir, 'work'), { recursive: true, force: true });
      const files = scanFiles(id);
      updateAnimation(id, {
        status: 'done', finished_at: new Date().toISOString(), duration_s: made.duration_s, render_s: made.render_s, files, notes: made.notes ?? null,
        format: files.some((f) => f.kind === 'mp4') ? 'mp4+web' : 'web',
      });
    });
  } catch (e) {
    console.warn(`[studio] job ${id} failed:`, e.message);
    rmSync(join(dir, 'work'), { recursive: true, force: true });
    updateAnimation(id, { status: 'failed', error: String(e.message).slice(0, 500), finished_at: new Date().toISOString(), files: scanFiles(id) });
  }
}
