// Squelch Studio's API. Owner-only: server.mjs refuses every /api/studio/ request canEdit() doesn't pass.
import { listAnimations, getAnimation, deleteAnimation, updateAnimation, animDir } from './library.mjs';
import { suggestions } from './humor.mjs';
import { CapError, spentToday, dailyCap } from './spend.mjs';
import { estimateJob, queueJob, activeJobs, JobError } from './jobs.mjs';
import { defaultProvider, PROVIDERS } from './llm.mjs';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'animation';

// Generated pages are model-written: they run sandboxed, with nothing from outside allowed in.
const CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";

export async function studioRoute(req, res, url, { json, serveFile, readJson }) {
  const p = url.pathname.slice('/api/studio/'.length);
  if (p === 'animations') return json(res, listAnimations());
  if (p === 'suggestions' || (p === 'suggestions/refresh' && req.method === 'POST')) {
    try {
      return json(res, { ...await suggestions({ refresh: p.endsWith('refresh') }), today: spentToday(), cap: dailyCap(), llm: defaultProvider(), providers: PROVIDERS });
    } catch (e) {
      return json(res, { error: e.message }, e instanceof CapError ? 429 : 502);
    }
  }
  if (p === 'jobs' && req.method === 'GET') return json(res, { jobs: activeJobs(), today: spentToday(), cap: dailyCap() });
  if ((p === 'estimate' || p === 'jobs') && req.method === 'POST') {
    const { thread_id, style, llm } = await readJson(req);
    try {
      return json(res, p === 'estimate' ? await estimateJob(thread_id, style, llm) : await queueJob(thread_id, style, llm), p === 'jobs' ? 202 : 200);
    } catch (e) {
      return json(res, { error: e.message }, e instanceof JobError ? e.code : 502);
    }
  }
  const m = p.match(/^animations\/(\d+)(?:\/(rate|files\/([\w.-]+)))?$/);
  if (!m) return json(res, { error: 'unknown' }, 404);
  const a = getAnimation(Number(m[1]));
  if (!a) return json(res, { error: 'no such animation' }, 404);
  if (m[3]) {
    if (!a.files.some((f) => f.name === m[3])) return json(res, { error: 'no such file' }, 404);
    if (m[3].endsWith('.html')) res.setHeader('Content-Security-Policy', CSP);
    if (url.searchParams.has('download')) res.setHeader('Content-Disposition', `attachment; filename="squelch-${a.id}-${slug(a.title)}${m[3].slice(m[3].lastIndexOf('.'))}"`);
    return serveFile(res, animDir(a.id), m[3], req.headers.range);
  }
  if (m[2] === 'rate' && req.method === 'POST') {
    const { rating } = await readJson(req);
    const r = rating == null ? null : Math.round(Number(rating));
    if (r !== null && !(r >= 1 && r <= 5)) return json(res, { error: 'rating is 1–5, or null to clear it' }, 400);
    updateAnimation(a.id, { rating: r });
    return json(res, getAnimation(a.id));
  }
  if (!m[2] && req.method === 'DELETE') {
    if (a.status === 'running') return json(res, { error: 'It’s being made right now; delete it when it’s done' }, 409);
    deleteAnimation(a.id);
    return json(res, { ok: true });
  }
  if (!m[2]) return json(res, a);
  return json(res, { error: 'unknown' }, 404);
}
