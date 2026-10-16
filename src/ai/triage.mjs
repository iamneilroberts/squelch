// Turns a radio transcript into structured incidents.
import { chatJson } from './llm.mjs';

// Bench 2026-10-16: 98% at $0.12 per 1k calls (claude-opus-5.5 also 98%, at $8.69).
export const DEFAULT_TRIAGE_MODEL = 'openai/gpt-6-luna';

const TYPES = ['fire', 'medical', 'crash', 'rescue', 'hazmat', 'police', 'aviation', 'marine', 'rail', 'weather', 'other'];

export const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'incident_id', 'category', 'type', 'headline', 'summary', 'location_text', 'geocode_query', 'units', 'confidence'],
        properties: {
          action: { type: 'string', enum: ['new', 'update', 'routine'] },
          incident_id: { type: 'integer', description: 'Open incident id when action is update, else 0' },
          category: { type: 'string', enum: ['breaking', 'notable', 'routine'] },
          type: { type: 'string', enum: TYPES },
          headline: { type: 'string', description: 'Max 8 words, e.g. "Structure fire, Cottage Hill Rd"' },
          summary: { type: 'string', description: 'One or two plain sentences of what was said' },
          location_text: { type: 'string', description: 'Location as spoken, or empty' },
          geocode_query: { type: 'string', description: 'Best geocoder query: "1234 Street Name, City, AL" or "Landmark, City, AL"; empty if none' },
          units: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

export const TRIAGE_SYSTEM = `You triage scanner radio transcripts for a public incident map. Each transcript comes with the feed it was heard on and that feed's area.
Transcripts come from speech-to-text and contain errors: fix obvious mishearings of local street and place names, but never invent details that were not said.

For each distinct event in the transcript, output one item:
- action "update" with that incident_id when it continues one of the open incidents listed (same address, same units, or obvious follow-up). Otherwise "new". Use "routine" (incident_id 0) for chatter with no public interest: radio checks, unit status changes, "en route"/"on scene" with no new detail, test tones, ATC clearances on normal operations, weather readouts.
- category: "breaking" for working structure fires, serious crashes with entrapment, mayday/pan-pan, water rescues, aircraft emergencies, hazmat; "notable" for other real incidents; "routine" otherwise.
- Never include names of people, phone numbers, plate numbers, or medical details beyond the call type (e.g. "medical call", "fall injury").
- geocode_query: make it something OpenStreetMap Nominatim can resolve. For intersections use "Street A & Street B, City, ST". Default city and state to the feed's area when unstated.
Return an empty items array when the transcript is noise or unintelligible.`;

export function triagePrompt({ transcript, source, openIncidents }) {
  const open = openIncidents.length
    ? openIncidents.map((i) => `#${i.id}: ${i.headline} @ ${i.location_text || 'unknown'} units=${i.units}`).join('\n')
    : '(none)';
  return `Feed: ${source.name} (${source.band}). Area: ${source.area || 'not stated'}. Coverage: ${source.coverage}\nOpen incidents on this feed:\n${open}\n\nTranscript:\n${transcript}`;
}

// Returns { items, costUsd, ms, ... }.
export async function triage(input, model = process.env.TRIAGE_MODEL || DEFAULT_TRIAGE_MODEL) {
  const r = await chatJson({ model, system: TRIAGE_SYSTEM, user: triagePrompt(input), schema: TRIAGE_SCHEMA, name: 'triage', purpose: 'triage', maxTokens: 4000 });
  return { ...r, items: r.data.items ?? [] };
}
