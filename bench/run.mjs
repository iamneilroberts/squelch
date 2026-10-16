// Model bench for every AI step in the app: triage, transcription, daily digest.
//   node --env-file=.env bench/run.mjs [triage|transcribe|digest|all] [--models=a,b] [--reps=2]
// Writes raw outputs to bench/results/<suite>-<stamp>.json and a summary table to bench/RESULTS.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { wer, keyRecall, hasLocation, median } from './score.mjs';

process.env.DB_PATH = 'data/bench.db'; // digest.mjs imports the DB module; keep the app DB untouched
process.env.SOURCES_FILE = 'examples/gulf-coast.json'; // fixtures are Gulf Coast traffic in Central time
const { triage } = await import('../src/ai/triage.mjs');
const { transcribe } = await import('../src/ai/transcribe.mjs');
const { distill } = await import('../src/digest.mjs');
const { gate } = await import('../src/ai/jev.mjs');
const { db } = await import('../src/db.mjs');
const benchStart = new Date().toISOString();
const JEV_ROW = 'typesafe/jev (gate, p ≥ 0.5)';

const TEXT_MODELS = [
  'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5',
  'openai/gpt-6-luna', 'openai/gpt-6-luna-pro', 'openai/gpt-6-sol',
  'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro',
  'qwen/qwen3.8-flash', 'qwen/qwen3.7-plus',
  'google/gemini-3.5-flash-lite', 'google/gemini-3.8-flash',
  'xiaomi/mimo-v2.6-flash', 'z-ai/glm-5.3-flash', 'mistralai/mistral-small-2603',
  'minimax/minimax-m3', 'moonshotai/kimi-k3',
];
const AUDIO_MODELS = [
  'google/gemini-3.5-flash-lite', 'google/gemini-3.1-flash-lite', 'google/gemini-3.8-flash', 'google/gemini-3.5-flash',
  'mistralai/voxtral-small-24b-2507', 'openai/gpt-audio-mini', 'qwen/qwen3.8-omni-flash',
  'xiaomi/mimo-v2.6-flash', 'xiaomi/mimo-v2.6-pro', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const suite = process.argv[2] || 'all';
const pick = (list) => (args.models ? args.models.split(',') : list);
const reps = Number(args.reps || 1);
// The fixtures are Mobile/Baldwin traffic, so the bench always runs against the Gulf Coast example config.
const { sources, regions } = JSON.parse(readFileSync('examples/gulf-coast.json', 'utf8'));
const mobileVocab = regions.find((r) => r.id === 'mobile')?.vocab || '';
const sourceById = new Map(sources.map((s) => [s.id, s]));
// Fixtures may name feeds since removed from the catalog (e.g. saraland-fire); describe them generically.
const sourceFor = (id) => sourceById.get(id) || { id, name: id, short: id, band: 'fire', coverage: '', area: 'Mobile County, AL' };
const load = (f) => JSON.parse(readFileSync(join('bench/fixtures', f), 'utf8'));

// Bounded concurrency across all models.
const LIMIT = Number(args.concurrency || 16);
let active = 0; const waiting = [];
async function slot(fn) {
  if (active >= LIMIT) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const money = (x) => (x == null ? '—' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/* ───────── Triage ───────── */
function scoreTriage(c, items) {
  const e = c.expect;
  const hot = items.filter((i) => i.action !== 'routine' && i.category !== 'routine');
  const checks = { routine: (hot.length > 0) === e.nonRoutine };
  if (e.nonRoutine && hot.length) {
    checks.action = e.action === 'update'
      ? hot.some((i) => i.action === 'update' && i.incident_id === e.incident_id)
      : hot.some((i) => i.action === 'new');
    if (e.action !== 'update') checks.category = (hot.some((i) => i.category === 'breaking') ? 'breaking' : 'notable') === e.category;
    checks.type = hot.some((i) => i.type === e.type);
    if (e.locationTokens?.length) checks.location = e.locationTokens.every((t) => hot.some((i) => hasLocation(i.geocode_query, t)));
  } else if (e.nonRoutine) {
    Object.assign(checks, { action: false, type: false });
    if (e.locationTokens?.length) checks.location = false;
  }
  if (e.forbid?.length) checks.pii = !e.forbid.some((f) => JSON.stringify(items).toLowerCase().includes(f));
  return checks;
}

// Jev can't write headlines, so it's scored only on what the gate decides: real speech? newsworthy?
async function benchGate() {
  const cases = load('triage.json');
  const speechCases = load('gate.json');
  const run = (c) => Array.from({ length: reps }, () => slot(async () => {
    const t0 = Date.now();
    const g = await gate({ transcript: c.transcript, source: sourceFor(c.source_id) });
    return { id: c.id, g, ms: Date.now() - t0 };
  }));
  const news = await Promise.all(cases.flatMap((c) => run(c).map((p) => p.then((r) => ({ ...r, expect: c.expect.nonRoutine })))));
  const speech = await Promise.all(speechCases.flatMap((c) => run(c).map((p) => p.then((r) => ({ ...r, expect: c.speech })))));
  const all = [...news, ...speech];
  const ok = all.filter((r) => r.g?.newsworthy != null);
  const acc = (rs, key, t = 0.5) => mean(rs.filter((r) => r.g?.[key] != null).map((r) => Number((r.g[key] >= t) === r.expect)));
  // As a pre-filter: skip the LLM below threshold t. What share of routine traffic is skipped, and what share of real news is lost?
  const at = (t) => {
    const scored = news.filter((r) => r.g?.newsworthy != null);
    const routine = scored.filter((r) => !r.expect), real = scored.filter((r) => r.expect);
    return { t, skipped: mean(routine.map((r) => Number(r.g.newsworthy < t))), lost: mean(real.map((r) => Number(r.g.newsworthy < t))) };
  };
  return {
    model: JEV_ROW, overall: null, routine: acc(news, 'newsworthy'), speech: acc(speech, 'speech'),
    per1k: null, p50: median(ok.map((r) => r.ms)), errors: all.length - ok.length, results: all,
    thresholds: [0.1, 0.2, 0.3, 0.5].map(at),
  };
}

async function benchTriage(models) {
  const cases = load('triage.json');
  const gateRow = await benchGate();
  const rows = await Promise.all(models.map(async (model) => {
    const results = await Promise.all(cases.flatMap((c) => Array.from({ length: reps }, () => slot(async () => {
      try {
        const r = await triage({ transcript: c.transcript, source: sourceFor(c.source_id), openIncidents: c.open_incidents }, model);
        return { id: c.id, items: r.items, checks: scoreTriage(c, r.items), cost: r.costUsd, ms: r.ms };
      } catch (err) {
        return { id: c.id, error: String(err.message).slice(0, 200), checks: { routine: false } };
      }
    }))));
    const col = (k) => mean(results.map((r) => (k in r.checks ? Number(r.checks[k]) : null)));
    const overall = mean(results.map((r) => mean(Object.values(r.checks).map(Number))));
    const ok = results.filter((r) => !r.error);
    return {
      model, overall, routine: col('routine'), action: col('action'), category: col('category'), type: col('type'), location: col('location'), pii: col('pii'),
      per1k: ok.length ? (mean(ok.map((r) => r.cost)) ?? 0) * 1000 : null, p50: median(ok.map((r) => r.ms)), errors: results.length - ok.length, results,
    };
  }));
  rows.sort((a, b) => b.overall - a.overall || a.per1k - b.per1k);
  // Jev's $ comes from metered spans (gate() returns no cost); per call = total / calls.
  const jevSpend = db.prepare(`SELECT SUM(cost) AS c, COUNT(*) AS n FROM spans WHERE purpose = 'gate' AND at >= ?`).get(benchStart);
  gateRow.per1k = jevSpend.n ? (jevSpend.c / jevSpend.n) * 1000 : null;
  rows.push(gateRow);
  const table = ['| Model | Overall | Routine/not | Speech | Action | Category | Type | Location | PII | $ / 1k calls | p50 | Errors |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | **${pct(r.overall)}** | ${pct(r.routine)} | ${pct(r.speech)} | ${pct(r.action)} | ${pct(r.category)} | ${pct(r.type)} | ${pct(r.location)} | ${pct(r.pii)} | ${money(r.per1k)} | ${r.p50 ? (r.p50 / 1000).toFixed(1) + 's' : '—'} | ${r.errors || ''} |`)];
  const th = gateRow.thresholds.map((x) => `p < ${x.t}: skips ${pct(x.skipped)} of routine, loses ${pct(x.lost)} of real incidents`).join('; ');
  return { rows, table, note: `${cases.length} cases × ${reps} rep(s). Routine/not = flagged the right transcripts as newsworthy; Action = new vs. correct open-incident update; Location = geocode query contains the correctly spelled place; PII = no names/phones/plates echoed. Speech = Jev's real-speech check on ${load('gate.json').length} live-style cases (model filler, name lists, real fragments).\n\n**Jev as a pre-filter** (skip the LLM when newsworthy p is below the threshold): ${th}.` };
}

/* ───────── Transcription ───────── */
async function benchTranscribe(models) {
  const scripts = load('speech.json');
  const refs = load('audio/refs.json');
  const clips = scripts.map((s) => {
    const file = join('bench/fixtures/audio', `${s.id}.mp3`);
    const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
    return { id: s.id, file, secs, ref: refs[s.id] || s.text };
  });
  const audioSecs = clips.reduce((a, c) => a + c.secs, 0) * reps;
  const rows = await Promise.all(models.map(async (model) => {
    const results = await Promise.all(clips.flatMap((c) => Array.from({ length: reps }, () => slot(async () => {
      const t0 = Date.now();
      try {
        const r = await transcribe(c.file, model, mobileVocab);
        return { id: c.id, text: r.text, wer: Math.min(1, wer(c.ref, r.text)), keys: keyRecall(c.ref, r.text), cost: r.costUsd, ms: Date.now() - t0 };
      } catch (err) {
        return { id: c.id, error: String(err.message).slice(0, 200), wer: 1, keys: 0 };
      }
    }))));
    const ok = results.filter((r) => !r.error);
    const cost = ok.reduce((a, r) => a + (r.cost || 0), 0);
    return { model, wer: mean(results.map((r) => r.wer)), keys: mean(results.map((r) => r.keys)), perHour: ok.length ? (cost / audioSecs) * 3600 * (results.length / ok.length) : null, p50: median(ok.map((r) => r.ms)), errors: results.length - ok.length, results };
  }));
  rows.sort((a, b) => a.wer - b.wer);
  const table = ['| Model | WER (lower = better) | Key-term recall | $ / audio hour | p50 | Errors |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | **${pct(r.wer)}** | ${pct(r.keys)} | ${money(r.perHour)} | ${r.p50 ? (r.p50 / 1000).toFixed(1) + 's' : '—'} | ${r.errors || ''} |`)];
  return { rows, table, note: `${clips.length} synthetic dispatch/ATC/marine clips (TTS → 300–3000 Hz bandpass, 8 kHz, pink noise), ${Math.round(audioSecs / reps)} s of audio. Key terms = street names, places and numbers.` };
}

/* ───────── Digest ───────── */
async function benchDigest(models) {
  const day = load('day-log.json');
  const feedName = (id) => sourceById.get(id)?.short || id;
  const rows = await Promise.all(models.map(async (model) => {
    const results = await Promise.all(Array.from({ length: reps }, () => slot(async () => {
      try {
        const r = await distill({ date: day.date, calls: day.calls, feedName, model });
        const hl = r.body.highlights;
        const hit = (g) => hl.filter((h) => h.call_ids.some((id) => g.call_ids.includes(id)));
        const found = day.gold.filter((g) => hit(g).length);
        const completeness = mean(found.map((g) => new Set(hit(g).flatMap((h) => h.call_ids).filter((id) => g.call_ids.includes(id))).size / g.call_ids.length));
        const precision = hl.length ? hl.filter((h) => day.gold.some((g) => h.call_ids.some((id) => g.call_ids.includes(id)))).length / hl.length : 0;
        return { recall: found.length / day.gold.length, completeness, precision, n: hl.length, cost: r.costUsd, ms: r.ms, headline: r.body.headline, titles: hl.map((h) => h.title) };
      } catch (err) {
        return { error: String(err.message).slice(0, 200), recall: 0, precision: 0 };
      }
    })));
    const ok = results.filter((r) => !r.error);
    return { model, recall: mean(results.map((r) => r.recall)), precision: mean(results.map((r) => r.precision)), completeness: mean(ok.map((r) => r.completeness)), n: mean(ok.map((r) => r.n)), cost: mean(ok.map((r) => r.cost)), p50: median(ok.map((r) => r.ms)), errors: results.length - ok.length, results };
  }));
  rows.sort((a, b) => b.recall - a.recall || b.precision - a.precision || a.cost - b.cost);
  const table = ['| Model | Gold recall | Precision | Storyline completeness | Highlights | $ / day | Time | Errors |', '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | **${pct(r.recall)}** | ${pct(r.precision)} | ${pct(r.completeness)} | ${r.n?.toFixed(1) ?? '—'} | ${money(r.cost)} | ${r.p50 ? (r.p50 / 1000).toFixed(0) + 's' : '—'} | ${r.errors || ''} |`)];
  return { rows, table, note: `${day.calls.length}-call synthetic day with ${day.gold.length} planted storylines. Recall = storylines found; precision = highlights that are a planted storyline; completeness = share of each found storyline's transmissions cited.` };
}

/* ───────── Main ───────── */
const SUITES = { triage: [benchTriage, TEXT_MODELS], transcribe: [benchTranscribe, AUDIO_MODELS], digest: [benchDigest, TEXT_MODELS] };
mkdirSync('bench/results', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
const md = existsSync('bench/RESULTS.md') ? readFileSync('bench/RESULTS.md', 'utf8') : '# Model bench results\n';
let out = md;
for (const name of suite === 'all' ? Object.keys(SUITES) : [suite]) {
  const [fn, list] = SUITES[name];
  console.log(`\n▸ ${name}: ${pick(list).length} models`);
  const t0 = Date.now();
  const r = await fn(pick(list));
  writeFileSync(`bench/results/${name}-${stamp}.json`, JSON.stringify(r.rows, null, 2));
  const section = `<!-- ${name} -->\n## ${name[0].toUpperCase() + name.slice(1)} — ${new Date().toISOString().slice(0, 10)}\n\n${r.note}\n\n${r.table.join('\n')}\n<!-- /${name} -->`;
  const re = new RegExp(`<!-- ${name} -->[\\s\\S]*?<!-- /${name} -->`);
  out = re.test(out) ? out.replace(re, section) : `${out}\n${section}\n`;
  console.log(r.table.join('\n'));
  const spend = r.rows.flatMap((row) => row.results).reduce((a, x) => a + (x.cost || 0), 0);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s, spent ${money(spend)})`);
}
writeFileSync('bench/RESULTS.md', out);
