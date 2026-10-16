// The running story of one channel's current conversation: a title line, a few key facts that are
// rewritten as traffic arrives (units dispatched, command, size-up, status…), and a one-line
// chronology note per transmission. Each transmission either continues the story or starts a new
// one. Same model as triage; one call per transmission.
import { chatJson } from './llm.mjs';

export const DEFAULT_THREAD_MODEL = 'openai/gpt-6-luna';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['same', 'subject', 'facts', 'note'],
  properties: {
    same: { type: 'boolean', description: 'true if the new transmission continues the current story' },
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
  },
};

const SYSTEM = `You keep the running story of one scanner-radio channel's current conversation.

same — does the new transmission continue the current story?
- Default true. Keep it true for follow-ups, replies, acknowledgements ("copy", "10-4"), unit numbers, and short, garbled or unclear transmissions.
- false only when (a) a clearly different matter is dispatched or reported (a new call type or a new address), or (b) the current matter has clearly ended (units clear or back in service) and the new transmission is about something else, or (c) there is no current story.
- Routine traffic is one ongoing story: tower clearances, taxi and frequency changes are "Tower traffic" (add the runway in use if known); unit status checks are "Unit status checks". Only an emergency or unusual event breaks out of it.

subject — max 8 words, headline style, e.g. "Structure fire, Elm St", "Pursuit, Hwy 98 westbound", "Tower traffic, runway 14 in use". When same is true, return the current subject exactly unless the new transmission adds a key missing fact (what happened, or where); then sharpen it. Never write "unclear", "unknown" or "transmission"; if a new subject can't be told, use the channel's routine one ("Fire dispatch traffic", "Tower traffic").

facts — the story's key facts as it stands now, at most 6, each a short label and value. Return the full updated list: keep earlier facts, update the ones the new transmission changes, add new ones. Pick labels that fit the matter, for example:
- fire: Units (dispatched/on scene), Command (who and the command name), Size-up, Actions, Status
- medical or crash: Units, Patient(s) (age/sex/condition only), Location, Status
- pursuit: Vehicle, Direction, Last location, Units, Status
- aviation: Runway, Aircraft, Event
Only state what was said. Empty list for routine traffic with nothing to track.

note — one short line (max 14 words) for the chronology: what this transmission adds, e.g. "Engine 6 on scene, smoke showing from roof", "Command established, Elm St command". Empty when it adds nothing (noise, bare acknowledgements).

Never include personal names, phone numbers or plates anywhere.`;

// current: { subject, facts[], notes[] (oldest first), transcripts[] } or null.
export async function nextThread({ source, current, transcript }, model = process.env.THREAD_MODEL || DEFAULT_THREAD_MODEL) {
  const user = `Channel: ${source.name} (${source.band})\n`
    + (current
      ? `Current subject: ${current.subject}\nCurrent facts:\n${current.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(none)'}\n`
        + `Chronology so far:\n${current.notes.map((n) => `- ${n}`).join('\n') || '(none)'}\n`
        + `Latest transmissions:\n${current.transcripts.map((t) => `- ${t}`).join('\n')}\n`
      : 'Current story: (none)\n')
    + `\nNew transmission:\n${transcript}`;
  const r = await chatJson({ model, system: SYSTEM, user, schema: SCHEMA, name: 'thread', purpose: 'thread', maxTokens: 800 });
  return r.data;
}
