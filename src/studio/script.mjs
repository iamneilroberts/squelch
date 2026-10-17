// Step one of every animation: a model reads the story and writes the script (title, captions per clip,
// the closing gag, and the pictures), keeping to the content rules.
import { sources } from '../config.mjs';
import { notesBlock } from './notes.mjs';

export const STYLES = {
  sunday: { kind: 'comic', name: 'Sunday comic', art: 'bold flat-colour Sunday-newspaper comic strip panel, thick clean black ink outlines, limited cheerful palette (mustard yellow, sky teal, brick red, cream), simple halftone-dot shading, friendly rounded cartoon shapes' },
  ink: { kind: 'comic', name: 'Newspaper ink', art: 'black-and-white newspaper editorial cartoon, confident brush-and-pen ink lines, cross-hatching and stippled shading, one spot colour (brick red) used sparingly, off-white newsprint paper texture' },
  pixel: { kind: 'comic', name: 'Pixel art', art: '16-bit retro video-game pixel art scene, crisp visible square pixels, limited 32-colour palette, dithered shading, chunky readable sprites, no anti-aliasing' },
  vector: { kind: 'cartoon', name: 'Flat vector', art: 'flat vector cartoon' },
};

export const RULES = `Content rules (strict):
- No real people's names, faces or likeness: people are simple generic cartoon figures, seen from behind or at a distance when possible.
- No badge numbers, unit numbers, callsigns, licence plates, phone numbers or exact house numbers anywhere (captions, titles, pictures). Street and town names are fine.
- Keep it kind: the joke is the situation, never a real person.`;

export const SCRIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'use', 'captions', 'punch', 'cast', 'panels', 'beats'],
  properties: {
    title: { type: 'string', description: 'Headline, at most 5 words, e.g. "Loose dogs, Main Street"' },
    use: { type: 'array', items: { type: 'integer' }, description: 'Indexes of the clips that belong to the story, in order (drop unrelated chatter)' },
    captions: {
      type: 'array', description: 'One entry per used clip, in order',
      items: {
        type: 'object', additionalProperties: false, required: ['clip', 'lines'],
        properties: { clip: { type: 'integer' }, lines: { type: 'array', items: { type: 'string' }, description: 'What is said, cleaned up, in order, in chunks of at most 8 words; drop callsigns and unit numbers; keep 10-codes' } },
      },
    },
    punch: { type: 'array', items: { type: 'string' }, description: 'Exactly 3 short closing cards (at most 4 words each), e.g. "15–20 DOGS", "0 SIGHTINGS", "PARADE ROUTE: UNKNOWN"' },
    cast: { type: 'string', description: 'One paragraph fixing the look of every recurring character, animal, vehicle and place, so every picture matches' },
    panels: {
      type: 'array', description: 'Comic only (else empty): 4 or 5 panels in story order',
      items: {
        type: 'object', additionalProperties: false, required: ['from_clip', 'scene', 'focus_x', 'focus_y'],
        properties: {
          from_clip: { type: 'integer', description: 'The used clip this panel starts on; the first panel starts on the first clip, and they never go backwards' },
          scene: { type: 'string', description: 'What the picture shows, concretely: setting, characters, action, the funny detail. At most one short speech balloon or sign, with its exact words in quotes' },
          focus_x: { type: 'number', description: '0–1, where the funny detail sits across the picture' },
          focus_y: { type: 'number', description: '0–1, where it sits down the picture' },
        },
      },
    },
    beats: { type: 'array', items: { type: 'string' }, description: 'Cartoon only (else empty): 5–8 scene beats, each "clip N: what we see"' },
  },
};

export function scriptPrompt(thread, clips, style, notes = '') {
  const s = STYLES[style];
  const src = sources.find((x) => x.id === thread.source_id);
  const system = `You write scripts for short, gentle, funny animations of real police, fire and marine radio traffic. The real radio audio plays underneath, so captions follow what is actually said; the pictures supply the joke.
${RULES}
The format is a ${s.kind === 'comic' ? `vertical comic: 4–5 still panels in ${s.name} style, with slow pans and zooms` : 'flat vector SVG cartoon with characters that move'}.${notesBlock(notes)}`;
  const user = JSON.stringify({
    story: thread.subject, type: thread.type, facts: thread.facts.map((f) => `${f.label}: ${f.value}`),
    channel: src ? `${src.name}${src.area ? `, ${src.area}` : ''}` : thread.source_id,
    clips: clips.map((c, i) => ({ clip: i, time: c.clock, seconds: +c.dur.toFixed(1), said: c.transcript, note: c.note })),
  });
  return { system, user, place: src?.area || src?.name || '' };
}
