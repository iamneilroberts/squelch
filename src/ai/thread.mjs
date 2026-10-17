// The running stories of one channel: each a title line, a few key facts that are rewritten as traffic
// arrives (units dispatched, command, size-up, status…), and a one-line chronology note per transmission.
// Each transmission continues one of the channel's open stories (a busy dispatch channel interleaves
// several) or starts a new one. Same model as triage; one call per transmission.
import { chatJson } from './llm.mjs';

export const DEFAULT_THREAD_MODEL = 'openai/gpt-6-luna';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['story', 'subject', 'facts', 'note', 'type', 'alert', 'why'],
  properties: {
    story: { type: 'integer', description: 'Number of the open story the new transmission continues, or 0 for a new story' },
    subject: { type: 'string', description: 'Max 8 words, e.g. "Structure fire, Elm St"' },
    facts: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string' }, value: { type: 'string' } },
      },
    },
    note: { type: 'string', description: 'One short line for the chronology, or empty' },
    type: { type: 'string', enum: ['fire', 'medical', 'crash', 'rescue', 'hazmat', 'police', 'pursuit', 'aviation', 'marine', 'rail', 'weather', 'routine', 'other'] },
    alert: { type: 'number', description: '0 to 1: how much the story as it stands now deserves a notification' },
    why: { type: 'string', description: 'Max 10 words: what makes it notable, or empty' },
  },
};

const ALERT_SCALE = `alert — 0 to 1, for the whole story as it stands now (not just this transmission), judged as a local news editor would:
- 0–0.2 routine traffic, unit status, minor medical or lift assists, normal ATC
- 0.3–0.5 an ordinary incident worth a glance: a crash without serious injury, an alarm, a small outside fire
- 0.6–0.8 a significant incident: working structure fire, crash with injuries or entrapment, pursuit, missing child, water rescue, hazmat leak, road closed
- 0.9–1 a major event: multiple alarms or mutual aid, mass casualties, aircraft or vessel in distress (mayday, pan-pan), officer needs help, large evacuation`;

const SYSTEM = `You keep the running stories of one scanner-radio channel. Its open stories are listed most recent first; a busy dispatch channel interleaves several incidents.

story — which open story does the new transmission continue? Answer its number, or 0 for a new story.
- Default: the most recent story. Keep it for follow-ups, replies, acknowledgements ("copy", "10-4"), unit numbers, and short, garbled or unclear transmissions.
- An older listed story when the transmission clearly belongs to it: its address, command name or units working that scene, or a later report on that matter (a utility company arriving, "attic's clear", units clearing from it).
- 0 only when (a) a clearly different matter is dispatched or reported (a new call type or a new address) that none of the open stories covers, or (b) the matter has clearly ended (units clear or back in service) and the new transmission is about something else, or (c) there are no open stories.
- Routine traffic is one ongoing story: tower clearances, taxi and frequency changes are "Tower traffic" (add the runway in use if known); unit status checks are "Unit status checks". Only an emergency or unusual event breaks out of it.

subject — max 8 words, headline style, e.g. "Structure fire, Elm St", "Pursuit, Hwy 98 westbound", "Tower traffic, runway 14 in use". When continuing a story, return its subject exactly unless the new transmission adds a key missing fact (what happened, or where); then sharpen it. Never write "unclear", "unknown" or "transmission"; if a new subject can't be told, use the channel's routine one ("Fire dispatch traffic", "Tower traffic").

facts — the chosen story's key facts as it stands now, at most 6, each a short label and value. Return the full updated list: keep its earlier facts, update the ones the new transmission changes, add new ones. Pick labels that fit the matter, for example:
- fire: Units (dispatched/on scene), Command (who and the command name), Size-up, Actions, Status
- medical or crash: Units, Patient(s) (age/sex/condition only), Location, Status
- pursuit: Vehicle, Direction, Last location, Units, Status
- aviation: Runway, Aircraft, Event
Only state what was said. Empty list for routine traffic with nothing to track.

note — one short line (max 14 words) for the chronology: what this transmission adds, e.g. "Engine 6 on scene, smoke showing from roof", "Command established, Elm St command". Empty when it adds nothing (noise, bare acknowledgements).

type — what kind of story it is ("routine" for chatter with nothing to track).

${ALERT_SCALE}
Raise it as a story escalates; never lower it below an earlier peak just because the latest transmission is routine.

why — max 10 words on what makes it notable ("Second alarm requested, crews pulled out"), empty for routine.

Never include personal names, phone numbers or plates anywhere.`;

// stories: the channel's open stories, most recent first: { id, subject, facts[], notes[] (oldest first), transcripts[], updated_at }.
export async function nextThread({ source, stories, transcript }, model = process.env.THREAD_MODEL || DEFAULT_THREAD_MODEL) {
  const story = (s, i) => `Story ${s.id}${i ? '' : ' (most recent)'}, last heard ${Math.round((Date.now() - Date.parse(s.updated_at)) / 60e3)} min ago: ${s.subject}\n`
    + `Facts:\n${s.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(none)'}\n`
    + `Chronology:\n${s.notes.map((n) => `- ${n}`).join('\n') || '(none)'}\n`
    + (s.transcripts.length ? `Latest transmissions:\n${s.transcripts.map((t) => `- ${t}`).join('\n')}\n` : '');
  const user = `Channel: ${source.name} (${source.band})\n`
    + (stories.length ? `Open stories, most recent first:\n\n${stories.map(story).join('\n')}` : 'Open stories: (none)\n')
    + `\nNew transmission:\n${transcript}`;
  const r = await chatJson({ model, system: SYSTEM, user, schema: SCHEMA, name: 'thread', purpose: 'thread', maxTokens: 800 });
  return r.data;
}

// A listener surge (src/listeners.mjs): far more people than usual just tuned in to this channel.
// Re-score its current story with that in mind.
const LOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['alert', 'why'],
  properties: { alert: { type: 'number' }, why: { type: 'string', description: 'Max 10 words, or empty' } },
};
const LOOK_SYSTEM = `You re-check a scanner-radio channel's current story because far more people than usual just tuned in to it; a jump like that often means word is spreading about something happening.

${ALERT_SCALE}
The surge is supporting evidence, not proof: raise the score only as far as the traffic supports it. If the story is routine and nothing in it explains the surge, keep the score low.

why — max 10 words on what makes it notable, empty if nothing does. Never include personal names, phone numbers or plates.`;

export async function closerLook({ source, listeners, usual, story }, model = process.env.THREAD_MODEL || DEFAULT_THREAD_MODEL) {
  const user = `Channel: ${source.name} (${source.band})\nListeners now: ${listeners} (usually ${usual})\n\n`
    + `Current subject: ${story.subject}\nFacts:\n${story.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(none)'}\n`
    + `Chronology:\n${story.notes.map((n) => `- ${n}`).join('\n') || '(none)'}\n`
    + `Latest transmissions:\n${story.transcripts.map((t) => `- ${t}`).join('\n')}`;
  const r = await chatJson({ model, system: LOOK_SYSTEM, user, schema: LOOK_SCHEMA, name: 'closer_look', purpose: 'listener-surge', maxTokens: 300 });
  return r.data;
}
