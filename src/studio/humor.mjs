// Studio suggestions: light stories from the last 48 h, ranked by how funny an animation of them could be.
import { db, getThread } from '../db.mjs';
import { chatJson } from '../ai/llm.mjs';
import { withTrace } from '../meter.mjs';
import { MODELS, estimate, checkCap } from './spend.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS studio_humor (
  thread_id INTEGER PRIMARY KEY,
  updated_at TEXT NOT NULL,     -- the story's updated_at when it was scored; a newer one means re-score
  humor REAL NOT NULL,
  pitch TEXT,
  safe INTEGER NOT NULL,
  why TEXT,
  model TEXT,
  version TEXT,                 -- the prompt's version; a new prompt re-scores everything
  scored_at TEXT NOT NULL
)`);

/* Content guard: only light stories. Never injuries, deaths, victims, arrests, medical calls, minors,
   or anything alerting at 0.5 or more. Words are matched anywhere in the story, so a guarded story
   stays out even if the model would have called it safe. */
const SERIOUS = /\b(injur\w*|hurt|wound\w*|bleed\w*|blood\w*|dead|death\w*|died|dies|dying|deceased|fatal\w*|doa|cpr|coroner|unresponsive|not breathing|overdos\w*|victim\w*|arrest\w*|custody|handcuff\w*|warrant\w*|jail\w*|juvenile\w*|minors?|child\w*|kids?|infant\w*|bab(y|ies)|toddler\w*|teen\w*|student\w*|school\w*|shoot\w*|shots?|gun\w*|glock\w*|pistol\w*|rifle\w*|revolver\w*|9mm|ammo|ammunition|firearm\w*|weapon\w*|stab\w*|knife|assault\w*|domestic|suicid\w*|rape|sexual\w*|abuse\w*|missing person|amber alert|ambulance\w*|ems|medic\w*|paramedic\w*|hospital\w*|patient\w*|seizure\w*|cardiac|chest pain|stroke|trauma\w*|entrap\w*|personal injury|pursuit)\b/i;

const storyText = (t) => [t.subject, t.why, ...t.facts.map((f) => `${f.label}: ${f.value}`), ...t.events.flatMap((e) => [e.note, e.transcript])].filter(Boolean).join('\n');

// The serious word in a piece of text, or null: the same word list the guard applies to a story.
// Violence, sex and drugs aren't in the story guard (stories rarely say them) but must not get in through viewer notes or model output.
const EXTRA = /\b(kill\w*|murder\w*|violen\w*|bomb\w*|explo(?:de|des|ded|sion\w*)|terror\w*|attack\w*|gore|gory|tortur\w*|nude|naked|sex|sexy|porn\w*|cocaine|heroin|meth|drugs?|gangs?|crime|criminal\w*)\b/i;
export const flagged = (text) => SERIOUS.exec(text)?.[0] ?? EXTRA.exec(text)?.[0] ?? null;

// Why a story can't be animated, or null when it can.
export function guard(t) {
  if (!t) return 'no such story';
  if (t.type === 'medical') return 'medical call';
  if (t.alert >= 0.5) return `alert ${t.alert}`;
  const hit = SERIOUS.exec(storyText(t));
  if (hit) return `mentions “${hit[0].toLowerCase()}”`;
  if (!t.events.some((e) => e.audio)) return 'no recordings left';
  if (t.events.map((e) => e.transcript || '').join(' ').length < 60) return 'too little said';
  return null;
}

function candidates(hours = 48) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const ok = [], excluded = [];
  for (const { id } of db.prepare('SELECT id FROM threads WHERE updated_at >= ? ORDER BY updated_at DESC').all(since)) {
    const t = getThread(id);
    const why = guard(t);
    if (why) excluded.push({ id, subject: t.subject, source_id: t.source_id, reason: why });
    else ok.push(t);
  }
  return { ok, excluded };
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'humor', 'pitch', 'safe', 'why'],
        properties: {
          id: { type: 'integer' },
          humor: { type: 'number', description: '0 = nothing funny, 1 = a short cartoon would be a gem' },
          pitch: { type: 'string', description: 'The cartoon in at most 12 words' },
          safe: { type: 'boolean', description: 'False if anyone could be hurt, in danger, in trouble with the law, a minor, or the butt of the joke' },
          why: { type: 'string', description: 'One short sentence: what makes it funny (or not), and why it is safe (or not)' },
        },
      },
    },
  },
};

const SYSTEM = `You pick police and fire radio stories for short, gentle cartoons. For each story, judge:
- humor (0–1): how funny a 1-minute cartoon of it could be. Absurd situations, animals loose, deadpan radio understatement, things that turn out to be nothing, small-town oddities score high. Routine traffic stops, alarms, and paperwork score low.
- safe: false if someone was actually hurt, sick, killed, arrested or detained, if a minor or a crime victim is involved, if it's a medical call, or if the joke would mock a real, identifiable person or their misfortune. A risk that didn't happen (an animal loose, an alarm, a stalled truck, a hazard that was cleared) is not a reason for false: a pack of shelter dogs touring Main Street is safe.
- pitch: the cartoon in at most 12 words, e.g. "Shelter dogs stage a parade; deputies find none". No names, no unit numbers, no addresses.
Return one item per story id.`;

const BATCH = 12, PARALLEL = 4;
const VERSION = 'humor-2';
const brief = (t) => ({
  id: t.id, type: t.type, subject: t.subject, facts: t.facts.map((f) => `${f.label}: ${f.value}`),
  radio: t.events.map((e) => e.transcript).filter(Boolean).join(' / ').slice(0, 900),
});

const cached = db.prepare('SELECT * FROM studio_humor WHERE thread_id = ?');
const save = db.prepare(`INSERT INTO studio_humor (thread_id, updated_at, humor, pitch, safe, why, model, version, scored_at) VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(thread_id) DO UPDATE SET updated_at = excluded.updated_at, humor = excluded.humor, pitch = excluded.pitch, safe = excluded.safe, why = excluded.why, model = excluded.model, version = excluded.version, scored_at = excluded.scored_at`);
const fresh = (t) => { const s = cached.get(t.id); return s?.updated_at === t.updated_at && s.version === VERSION; };

// Score the stories that are new or changed since they were last scored. Returns { cost, scored }.
async function scoreStale(stories) {
  const stale = stories.filter((t) => !fresh(t));
  const model = MODELS.humor();
  let cost = 0, scored = 0;
  const one = async (batch) => {
    const user = JSON.stringify(batch.map(brief));
    checkCap(await estimate(model, { inTok: (SYSTEM.length + user.length) / 3.5, outTok: 90 * batch.length }));
    const r = await chatJson({ model, system: SYSTEM, user, schema: SCHEMA, name: 'humor', maxTokens: 4000, purpose: 'studio:humor' });
    cost += r.costUsd || 0;
    const now = new Date().toISOString();
    for (const t of batch) {
      const it = r.data.items.find((x) => x.id === t.id);
      if (!it) continue;
      save.run(t.id, t.updated_at, Math.max(0, Math.min(1, Number(it.humor) || 0)), String(it.pitch).split(/\s+/).slice(0, 12).join(' '), it.safe ? 1 : 0, it.why, model, VERSION, now);
      scored++;
    }
  };
  const batches = [];
  for (let i = 0; i < stale.length; i += BATCH) batches.push(stale.slice(i, i + BATCH));
  for (let i = 0; i < batches.length; i += PARALLEL) await Promise.all(batches.slice(i, i + PARALLEL).map(one));
  return { cost, scored };
}

// Top stories by humor; with `refresh`, new and changed stories are scored first (that's the only spend).
export async function suggestions({ refresh = false, top = 5 } = {}) {
  const { ok, excluded } = candidates();
  const run = refresh ? await withTrace({ kind: 'studio', label: 'Humor scores' }, () => scoreStale(ok)) : null;
  const rows = ok.map((t) => ({ t, s: cached.get(t.id) })).filter((x) => x.s);
  const unsafe = rows.filter((x) => !x.s.safe).map(({ t, s }) => ({ id: t.id, subject: t.subject, source_id: t.source_id, reason: `model: ${s.why}` }));
  const ranked = rows.filter((x) => x.s.safe).sort((a, b) => b.s.humor - a.s.humor).slice(0, top).map(({ t, s }) => ({
    thread_id: t.id, source_id: t.source_id, subject: t.subject, type: t.type, updated_at: t.updated_at, clips: t.events.filter((e) => e.audio).length,
    humor: s.humor, pitch: s.pitch, why: s.why, stale: !fresh(t),
  }));
  return {
    top: ranked, candidates: ok.length, scored: rows.length, unscored: ok.filter((t) => !fresh(t)).length,
    excluded: [...excluded, ...unsafe], refresh: run,
  };
}

// The cached verdict for one story, if it was scored and judged safe at its current version.
export const safeScore = (t) => (fresh(t) && cached.get(t.id).safe ? cached.get(t.id) : null);
