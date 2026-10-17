// Wider catch-up: the rest of a story that threading can't see because it went out on other channels,
// e.g. fire dispatch on one system and police on another for the same address. One model call picks the
// related transmissions from the last couple of hours and sums up the whole incident; the result is
// cached until the story moves on.
import { chatJson } from './llm.mjs';
import { DEFAULT_THREAD_MODEL } from './thread.mjs';
import { getThread, scanCall, getIncident, widerCandidates } from '../db.mjs';
import { sources } from '../config.mjs';

const WINDOW_H = 2;     // how far back from the story's latest transmission to look
const CANDIDATES = 60;  // at most, the nearest in time to the story (bounds the cost of a call)
const TRIM = 220;       // characters of each candidate's transcript
const CLIPS_MAX = 30;   // the catch-up's length, like a channel catch-up (src/scan.mjs)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['related', 'summary'],
  properties: {
    related: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'why'],
        properties: { id: { type: 'integer' }, why: { type: 'string', description: 'Max 12 words: what ties it to the story' } },
      },
    },
    summary: { type: 'string', description: '2–3 sentences' },
  },
};

const SYSTEM = `You link scanner-radio traffic across channels. You get one channel's story (subject, facts, chronology, its transmissions) and candidate transmissions from other channels and other stories around the same time.

related — the candidates about the same incident as the story: the same address or place, the same units on the same job, another agency working it (police at the fire's address, an ambulance to the crash), or its direct follow-ups. Leave out anything only alike (another fire somewhere else), routine traffic, and anything you aren't sure of. An empty list is a fine answer. For each, why: max 12 words on what ties it to the story, e.g. "Same address, 1200 Airport Blvd", "Medic 34 assigned to this fire".

summary — 2–3 sentences on the whole incident as it stands, across every channel, saying which agencies said what. Only state what was said. No clock times.

Never include personal names, phone numbers or plates.`;

const shortOf = (id) => sources.find((s) => s.id === id)?.short || id;
const hhmm = (at) => at.slice(11, 16);
const one = (t) => String(t).replace(/\s+/g, ' ').trim();
const cache = new Map(); // `${thread id}:${its updated_at}` → Promise of the result (the newest 50 kept)

export function widerCatchup(threadId, model = process.env.THREAD_MODEL || DEFAULT_THREAD_MODEL) {
  const t = getThread(threadId);
  if (!t) return null;
  const key = `${t.id}:${t.updated_at}`;
  if (!cache.has(key)) {
    cache.set(key, build(t, model).catch((e) => { cache.delete(key); throw e; }));
    if (cache.size > 50) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

async function build(t, model) {
  const story = t.events.map((e) => scanCall(e.id));
  const incidents = [...new Set(story.map((c) => c.incident_id).filter(Boolean))].map(getIncident).filter(Boolean);
  const first = new Date(story[0]?.at ?? t.started_at).getTime(), last = new Date(t.updated_at).getTime();
  const near = (c) => { const at = new Date(c.at).getTime(); return at < first ? first - at : at > last ? at - last : 0; };
  // Not the ones their own story found nothing new in (acknowledgements, noise).
  const pool = widerCandidates(new Date(last - WINDOW_H * 3600e3).toISOString(), new Date().toISOString(), t.id)
    .filter((c) => c.note || !c.thread_id).sort((a, b) => near(a) - near(b)).slice(0, CANDIDATES)
    .sort((a, b) => a.at.localeCompare(b.at));
  const user = `Story on ${shortOf(t.source_id)}: ${t.subject}\n`
    + `Facts:\n${t.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(none)'}\n`
    + (incidents.length ? `Incidents:\n${incidents.map((i) => `- ${i.headline}${i.location_text ? ` @ ${i.location_text}` : ''}${i.units ? `; units ${i.units}` : ''}`).join('\n')}\n` : '')
    + `Its transmissions (UTC):\n${story.filter((c) => c.transcript).slice(-15).map((c) => `- ${hhmm(c.at)} ${one(c.transcript).slice(0, TRIM)}`).join('\n')}\n\n`
    + `Candidates (UTC):\n${pool.map((c) => `#${c.id} ${hhmm(c.at)} ${shortOf(c.source_id)}`
      + `${c.subject ? ` [story: ${c.subject}]` : ''}${c.headline ? ` [incident: ${c.headline}${c.location_text ? ` @ ${c.location_text}` : ''}]` : ''}`
      + ` "${one(c.transcript).slice(0, TRIM)}"`).join('\n') || '(none)'}`;
  const r = pool.length ? await chatJson({ model, system: SYSTEM, user, schema: SCHEMA, name: 'wider_catchup', purpose: 'wider-catchup', maxTokens: 1200 }) : { data: { related: [], summary: '' } };
  const byId = new Map(pool.map((c) => [c.id, c]));
  const related = r.data.related.filter((x) => byId.has(x.id)).map((x) => ({ ...byId.get(x.id), why: x.why }));
  // The story's own transmissions that added something, with the related ones, in the order they went out.
  const notes = new Map(t.events.filter((e) => e.note).map((e) => [e.id, e.note]));
  const mine = story.filter((c) => c.audio && notes.has(c.id)).map((c) => ({ ...c, why: notes.get(c.id), own: true }));
  const clips = [...mine, ...related].sort((a, b) => a.at.localeCompare(b.at)).slice(-CLIPS_MAX)
    .map(({ id, source_id, at, audio, why, own = false }) => ({ id, source_id, at, audio, why, own }));
  return { thread: t.id, summary: r.data.summary, clips, candidates: pool.length, related: related.length };
}
