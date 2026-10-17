// Records every AI and API call as a span (timing, tokens, cost), grouped into traces —
// one trace per radio clip or digest build. The trace context rides along in AsyncLocalStorage,
// so callers only wrap the top of a unit of work in withTrace().
import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS traces (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  source_id TEXT,
  call_id INTEGER
);
CREATE TABLE IF NOT EXISTS spans (
  id INTEGER PRIMARY KEY,
  trace_id INTEGER,
  at TEXT NOT NULL,
  offset_ms INTEGER,
  ms INTEGER,
  kind TEXT NOT NULL,      -- llm | stt | jev | http
  purpose TEXT NOT NULL,   -- transcribe | triage | gate | digest | geocode | overlay:aircraft ...
  provider TEXT,
  model TEXT,
  in_tok INTEGER,
  out_tok INTEGER,
  cost REAL,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS spans_at ON spans(at);
CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS traces_at ON traces(at);
`);

const store = new AsyncLocalStorage();

// $ per million tokens, only for calls whose provider doesn't report cost (direct Anthropic).
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
export const priceOf = (model, inTok, outTok) => {
  const p = PRICES[model];
  return p ? (inTok * p[0] + outTok * p[1]) / 1e6 : null;
};

export function withTrace({ kind, label = null, source_id = null }, fn) {
  const at = new Date();
  const id = Number(db.prepare('INSERT INTO traces (at, kind, label, source_id) VALUES (?,?,?,?)')
    .run(at.toISOString(), kind, label, source_id).lastInsertRowid);
  return store.run({ id, t0: at.getTime() }, fn);
}

try { db.exec('ALTER TABLE traces ADD COLUMN vad REAL'); } catch { /* already there */ }
try { db.exec('ALTER TABLE traces ADD COLUMN vad_skip INTEGER'); } catch { /* already there */ }

// Speech-detector result for the current clip: loudness spread in dB, and whether STT was skipped.
export function setTraceVad(spread, skipped) {
  const t = store.getStore();
  if (t) db.prepare('UPDATE traces SET vad = ?, vad_skip = ? WHERE id = ?').run(spread, skipped ? 1 : 0, t.id);
}

export function linkTraceToCall(callId) {
  const t = store.getStore();
  if (t) db.prepare('UPDATE traces SET call_id = ? WHERE id = ?').run(callId, t.id);
}

// Times `fn` and records it. `describe(result)` returns { provider, model, in_tok, out_tok, cost } from the response.
export async function span({ kind, purpose, provider = null, model = null }, fn, describe = () => ({})) {
  const t = store.getStore();
  const start = Date.now();
  let result, error = null;
  try {
    result = await fn();
    return result;
  } catch (e) {
    error = String(e.message || e).slice(0, 300);
    throw e;
  } finally {
    let d = {};
    try { d = result !== undefined ? describe(result) || {} : {}; } catch { /* describe is best-effort */ }
    try {
      db.prepare(`INSERT INTO spans (trace_id, at, offset_ms, ms, kind, purpose, provider, model, in_tok, out_tok, cost, ok, error)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        t?.id ?? null, new Date(start).toISOString(), t ? start - t.t0 : null, Date.now() - start,
        kind, purpose, d.provider ?? provider, d.model ?? model, d.in_tok ?? null, d.out_tok ?? null, d.cost ?? null,
        error ? 0 : 1, error);
    } catch { /* metering must never break the pipeline */ }
  }
}

/* ───────── Reads for the costs page ───────── */
export function costSummary(hours) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = db.prepare(`SELECT kind, purpose, provider, model, COUNT(*) AS n, SUM(ok = 0) AS errors,
      SUM(in_tok) AS in_tok, SUM(out_tok) AS out_tok, SUM(cost) AS cost, SUM(cost IS NULL AND kind != 'http') AS unpriced
    FROM spans WHERE at >= ? GROUP BY kind, purpose, provider, model ORDER BY cost DESC NULLS LAST, n DESC`).all(since);
  for (const r of rows) {
    const ms = db.prepare(`SELECT ms FROM spans WHERE at >= ? AND purpose = ? AND COALESCE(model,'') = ? ORDER BY ms`).all(since, r.purpose, r.model ?? '').map((x) => x.ms);
    r.p50 = ms[Math.floor(ms.length * 0.5)] ?? null;
    r.p95 = ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] ?? null;
  }
  const clips = db.prepare(`SELECT COUNT(*) AS n FROM traces WHERE kind = 'clip' AND at >= ?`).get(since).n;
  const first = db.prepare(`SELECT MIN(at) AS t FROM spans WHERE at >= ?`).get(since).t;
  // Hours actually covered by data, so a fresh install doesn't divide 10 minutes of spend by 24 h.
  const coveredHours = first ? Math.max(1 / 60, (Date.now() - new Date(first)) / 3600e3) : 0;
  return { hours, since, coveredHours, rows, clips };
}

export function recentTraces(limit = 40, kind = null) {
  const traces = db.prepare(`SELECT t.*, c.transcript, c.category, c.jev_speech, c.jev_news,
      c.audio, c.duration, c.subject, c.thread_id, c.incident_id, i.headline,
      (SELECT SUM(cost) FROM spans s WHERE s.trace_id = t.id) AS cost,
      (SELECT MAX(offset_ms + ms) FROM spans s WHERE s.trace_id = t.id) AS ms
    FROM traces t LEFT JOIN calls c ON c.id = t.call_id LEFT JOIN incidents i ON i.id = c.incident_id
    WHERE EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id) ${kind ? 'AND t.kind = ?' : ''}
    ORDER BY t.id DESC LIMIT ?`).all(...(kind ? [kind, limit] : [limit]));
  const spans = db.prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY offset_ms');
  return traces.map((t) => ({ ...t, spans: spans.all(t.id) }));
}

// Shadow-mode scorecard: Jev's gate vs. the LLM triage verdict on the same live transcripts.
export function gateAgreement(hours) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  // Skipped calls never reached the LLM, so they carry no verdict to compare against.
  const rows = db.prepare(`SELECT jev_news AS p, category FROM calls WHERE at >= ? AND jev_news IS NOT NULL AND category IS NOT NULL AND COALESCE(gate, '') != 'skip'`).all(since);
  const decisions = Object.fromEntries(db.prepare(`SELECT gate, COUNT(*) AS n FROM calls WHERE at >= ? AND gate IS NOT NULL GROUP BY gate`).all(since).map((r) => [r.gate, r.n]));
  const audit = db.prepare(`SELECT COUNT(*) AS n, SUM(category != 'routine') AS missed FROM calls WHERE at >= ? AND gate = 'audit'`).get(since);
  const dropped = db.prepare(`SELECT COUNT(*) AS n FROM traces t WHERE t.at >= ? AND t.call_id IS NULL
    AND EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id AND s.purpose = 'gate')`).get(since).n;
  const llmNews = (r) => r.category !== 'routine';
  const count = (f) => rows.filter(f).length;
  const at = (t) => ({
    t,
    skipped: count((r) => r.p < t) / (rows.length || 1),
    missed: count((r) => r.p < t && llmNews(r)),
  });
  return {
    n: rows.length,
    agree: count((r) => (r.p >= 0.5) === llmNews(r)),
    jevOnly: count((r) => r.p >= 0.5 && !llmNews(r)),
    llmOnly: count((r) => r.p < 0.5 && llmNews(r)),
    thresholds: [0.1, 0.2, 0.3, 0.5].map(at),
    lowSpeech: db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE at >= ? AND jev_speech < 0.3`).get(since).n,
    active: { pass: decisions.pass || 0, skip: decisions.skip || 0, audit: audit.n || 0, auditMissed: audit.missed || 0, dropped },
  };
}

// Clips the adaptive squelch dropped before transcription (steady hum / open carrier, no voice above it).
db.exec('CREATE TABLE IF NOT EXISTS squelch_drops (at TEXT NOT NULL, source_id TEXT NOT NULL, seconds REAL)');
export function noteSquelchDrop(sourceId, seconds) {
  try { db.prepare('INSERT INTO squelch_drops (at, source_id, seconds) VALUES (?,?,?)').run(new Date().toISOString(), sourceId, seconds); } catch { /* never break ingest */ }
}
export function squelchReport(hours) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const byFeed = db.prepare('SELECT source_id, COUNT(*) AS n FROM squelch_drops WHERE at >= ? GROUP BY source_id ORDER BY n DESC').all(since);
  const transcribed = db.prepare(`SELECT COUNT(*) AS n, SUM(cost) AS c FROM spans WHERE kind = 'stt' AND at >= ?`).get(since);
  const avg = transcribed.n ? (transcribed.c || 0) / transcribed.n : 0;
  const dropped = byFeed.reduce((a, r) => a + r.n, 0);
  return { dropped, byFeed, transcribed: transcribed.n, avgStt: avg, saved: dropped * avg, share: dropped / ((dropped + transcribed.n) || 1) };
}

// Speech-detector scorecard: per cutoff, what skipping STT below it saves and what it would lose.
// "Lost" = clips that, once transcribed, survived the filters (a call row) or became an incident.
export function vadReport(hours) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = db.prepare(`SELECT t.vad, t.vad_skip, t.call_id, c.category,
      (SELECT SUM(cost) FROM spans s WHERE s.trace_id = t.id AND s.kind = 'stt') AS stt
    FROM traces t LEFT JOIN calls c ON c.id = t.call_id
    WHERE t.kind = 'clip' AND t.at >= ? AND t.vad IS NOT NULL`).all(since);
  const transcribed = rows.filter((r) => !r.vad_skip);
  const avgStt = transcribed.length ? transcribed.reduce((a, r) => a + (r.stt || 0), 0) / transcribed.length : 0;
  const at = (t) => {
    const quiet = transcribed.filter((r) => r.vad < t);
    return {
      t,
      skipped: transcribed.length ? quiet.length / transcribed.length : 0,
      saved: quiet.reduce((a, r) => a + (r.stt || 0), 0),
      lostCalls: quiet.filter((r) => r.call_id).length,
      lostIncidents: quiet.filter((r) => r.category && r.category !== 'routine').length,
    };
  };
  const skipped = rows.filter((r) => r.vad_skip).length;
  return {
    clips: rows.length, transcribed: transcribed.length, skipped, savedActive: skipped * avgStt, avgStt,
    sttSpend: transcribed.reduce((a, r) => a + (r.stt || 0), 0),
    thresholds: [2, 3, 4, 6, 8].map(at),
  };
}

export function pruneSpans(days = 30) {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  db.prepare('DELETE FROM spans WHERE at < ?').run(before);
  db.prepare('DELETE FROM traces WHERE at < ? AND id NOT IN (SELECT DISTINCT trace_id FROM spans WHERE trace_id IS NOT NULL)').run(before);
}
