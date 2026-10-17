// Pass 1 of the two-pass cartoon: the director plans the cartoon as a beat sheet (scenes, camera, cast tracks,
// sight gags) using only what the library can draw. The catalogue and the schema's enums come from the library
// itself (read in a vm), so they stay in sync with it. The engine (pass 2) renders the sheet in the browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { RULES } from './script.mjs';
import { scrub } from './track.mjs';
import { studioJson } from './llm.mjs';

const ASSETS = new URL('./assets/', import.meta.url).pathname;
export const LIB = readFileSync(join(ASSETS, 'cartoon-lib.js'), 'utf8');
export const ENGINE = readFileSync(join(ASSETS, 'cartoon-engine.js'), 'utf8');
export const CAT = new Script(`${LIB};CL.catalog()`).runInNewContext({});
const COMP = Object.fromEntries(CAT.components.map((c) => [c.name, c]));
const SETS = Object.fromEntries(CAT.sets.map((s) => [s.name, s]));

// ---------- the schema ----------
const uniq = (a) => [...new Set(a)];
const n = { type: 'number' }, s = { type: 'string' }, e = (a) => ({ type: 'string', enum: a });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const KINDS = Object.keys(COMP), VARIANTS = uniq(['mixed', ...CAT.components.flatMap((c) => c.variants)]);
const HATS = uniq(['mixed', ...CAT.components.flatMap((c) => c.hats)]), CARRIES = uniq(['band', ...CAT.components.flatMap((c) => c.carries)]);
const MOTIONS = Object.keys(CAT.motions), GAGS = Object.keys(CAT.gags);
const look = { kind: e(KINDS), variant: e(VARIANTS), color: e(CAT.colours), hat: e(HATS), carry: e(CARRIES) };
const CAST = obj({ id: s, ...look, label: s, count: { type: 'integer' }, formation: e(Object.keys(CAT.formations)), spacing: n, scale: n, flip: { type: 'boolean' },
  x: n, y: n, to_x: n, to_y: n, move_from: n, move_to: n, motion: e(MOTIONS), then: e(MOTIONS), enter: n, exit: n });
const GAG = obj({ type: e(GAGS), at: n, until: n, target: s, x: n, y: n, text: s });
const SCENE = obj({ start: n, end: n, idea: s, set: e(Object.keys(SETS)), sky: e(CAT.skies), labels: { type: 'array', items: s },
  camera: obj({ x: n, y: n, zoom: n, to_x: n, to_y: n, to_zoom: n, follow: s }), cast: { type: 'array', items: CAST }, gags: { type: 'array', items: GAG } });
export const BEAT_SCHEMA = obj({ title: s, punch: { type: 'array', items: s }, scenes: { type: 'array', items: SCENE }, finale: { type: 'array', items: obj(look) } });

// ---------- the brief ----------
const catalogueText = () => [
  'COMPONENTS (name [kind w×h at scale 1] variants · motions · hats · carries · label — notes):',
  ...CAT.components.map((c) => `- ${c.name} [${c.kind} ${c.w}×${c.h}${c.roof ? `, roof ${c.roof}` : ''}] ${c.variants.join('|')} · ${c.motions.join('|')}${c.hats.length > 1 ? ` · hats ${c.hats.join('|')}` : ''}${c.carries.length > 1 ? ` · carries ${c.carries.join('|')}` : ''}${c.label ? ` · label: ${c.label}` : ''} — ${c.desc}`),
  'SETS (ground lines: walk = sidewalk/back, far = far lane, near = near lane):',
  ...CAT.sets.map((x) => `- ${x.name}: ${x.desc}; walk ${x.ground.walk}, far ${x.ground.far}, near ${x.ground.near}`),
  `SKIES: ${CAT.skies.join(', ')}. COLOURS: ${CAT.colours.join(', ')} (auto = the component's own).`,
  'MOTIONS:', ...Object.entries(CAT.motions).map(([k, v]) => `- ${k}: ${v}`),
  'GAGS:', ...Object.entries(CAT.gags).map(([k, v]) => `- ${k}: ${v}`),
  'FORMATIONS (count > 1):', ...Object.entries(CAT.formations).map(([k, v]) => `- ${k}: ${v}`),
].join('\n');

const SYSTEM = `You direct short flat-vector cartoons that play over real police, fire and marine radio audio. You don't draw: you plan the cartoon as a beat sheet (JSON) that an engine renders from a fixed library of hand-drawn characters, vehicles, sets and props.
How the world works:
- The view is 1000×700. Camera {x:500, y:350, zoom:1} shows x 0–1000, y 0–700. Phones and the MP4 only see x 180–820 of the view, so keep everything that matters within ±300 of the camera's x (÷ zoom). zoom 2 shows half as much.
- Every component stands on its (x, y): y is where its feet or wheels touch. Use the set's ground lines. Sizes are w×h at scale 1; things in the far lane look right at scale 0.8–0.9. A detector hangs from its (x, y).
- Times are absolute seconds on the audio timeline. Scenes tile 0 → END exactly, in order, each at least 2 s. After END the engine adds the closing cards itself: your three punch lines pop in over a stage, with your 1–3 finale stars dancing underneath.
- A cast entry moves from (x, y) to (to_x, to_y) between move_from and move_to using motion, and does "then" the rest of the time (before and after). A cast entry that stays put has to_x = x and to_y = y. It faces the way it travels; flip mirrors it. It is on screen from enter to exit (use the scene's start and end for always; a later enter pops it in). count > 1 makes a group with a formation and spacing (px between members); variant "mixed" gives each member a different look, hat "mixed" mixes hats, carry "band" hands out instruments. Use "auto" colour, "none" hat/carry, "" label and 0 for anything that doesn't apply.
- Cast order is drawing order: later entries are in front (list a bush after the dogs hiding behind it; a dog stack on a car roof after the car).
- Gags are timed events (at → until). target is a cast id (the gag appears over its head, or at its feet for dust/smoke) or "" with x, y in view coordinates (burst and badge: x, y are where in the 1000×700 view).
- The camera goes from x, y, zoom at the scene start to to_x, to_y, to_zoom at its end; follow = a cast id to pan with it (else "").
- The first scene gets the story title over its top third for its first seconds: open on a wide establishing shot with nothing important above y 330.
What makes it funny (the bar is a hand-made cartoon in which a parade of escaped shelter dogs, in hats and with instruments, marches down Main Street at 3 AM while the patrol car never quite sees them):
- The animals and objects are the stars. Give them personality: costumes, instruments, sneaking, hiding, disguises, stacking, freezing like statues, peeking out, a sign of their own.
- Visual irony against the radio: show what the officers can't see or what the words leave out. Escalate across scenes; call back an earlier gag near the end.
- Sync: put each gag on the caption it answers (a "?" on "didn't see any", a burst on the surprising line, a badge on a number, a bubble on a "10-4").
- Every scene has movement and 1–3 sight gags. Vary the sets and the camera (wide, follow, punch-in). Stay true to the story: right place, right animals, right vehicles.
- Deputies, firefighters, EMTs and dispatchers are competent and good-humoured: never the butt of a joke, never clumsy, never mocked.
${RULES}
- People are generic figures with no faces. No names, badges, unit numbers, plates or house numbers in any label, sign or bubble.
Reply with the beat sheet JSON only.`;

const EXAMPLES = ['dog-parade', 'gator-mailbox'].map((k) => JSON.parse(readFileSync(join(ASSETS, 'beats', `${k}.json`), 'utf8')));
const exampleText = (x, i) => `EXAMPLE ${i + 1}: "${x.beat.title}"\ntimeline: ${JSON.stringify(x.timeline)}\nbeat sheet: ${JSON.stringify(x.beat)}`;

export function directorPrompt(script, tl) {
  const timeline = { END: tl.end, TOTAL: tl.total, clips: tl.clips.map((c) => ({ start: c.start, dur: c.dur, clock: c.clock })), captions: tl.captions };
  const user = `${catalogueText()}\n\n${EXAMPLES.map(exampleText).join('\n\n')}\n\nTHIS STORY\nscript: ${JSON.stringify({ title: script.title, cast: script.cast, beats: script.beats, punch: script.punch })}\ntimeline: ${JSON.stringify(timeline)}\n\nPlan the cartoon: ${tl.end < 20 ? '3–5' : '4–8'} scenes, each at least 2 s, from 0 to END=${tl.end}, then the 3 punch lines and the finale stars.`;
  return { system: SYSTEM, user };
}

// ---------- checking and tidying the sheet ----------
const clean = (t, max) => scrub(String(t ?? '')).slice(0, max);
const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
// Returns { beat (tidied), problems: [...] }. Small things are fixed silently; anything the director should redo is a problem.
export function checkBeat(raw, tl, fallbackPunch = []) {
  const problems = [];
  const b = structuredClone(raw);
  let scenes = (b.scenes || []).filter((x) => SETS[x.set]).sort((a, z) => a.start - z.start);
  // A sliver of a scene (under 1.2 s) is folded into the one before rather than sent back.
  scenes = scenes.filter((sc, i) => i === 0 || sc.end - sc.start >= 1.2 || ((scenes[i - 1].end = Math.max(scenes[i - 1].end, sc.end)), false));
  if (scenes.length < (tl.end < 20 ? 3 : 4) || scenes.length > 8) problems.push(`${scenes.length} scenes; make ${tl.end < 20 ? 3 : 4} to 8`);
  scenes = scenes.slice(0, 8);
  if (!scenes.length) return { beat: null, problems: ['no usable scenes'] };
  if (Math.abs(scenes[0].start) > 1) problems.push(`the first scene starts at ${scenes[0].start}; start at 0`);
  if (Math.abs(scenes.at(-1).end - tl.end) > 1.5) problems.push(`the last scene ends at ${scenes.at(-1).end}; end at END = ${tl.end}`);
  scenes.forEach((sc, i) => {
    const want = i ? scenes[i - 1].end : 0;
    if (Math.abs(sc.start - want) > 1) problems.push(`scene ${i + 1} starts at ${sc.start} but the one before ends at ${want}; scenes must tile with no gaps or overlaps`);
    sc.start = want;
    sc.end = i === scenes.length - 1 ? tl.end : Math.max(sc.end, sc.start + .5);
    sc.idea = clean(sc.idea, 200);
    sc.labels = (sc.labels || []).slice(0, 6).map((l) => clean(l, 14).toUpperCase()).filter(Boolean);
    const ids = new Set();
    sc.cast = (sc.cast || []).slice(0, 14);
    if (!sc.cast.length) problems.push(`scene ${i + 1} has no cast`);
    for (const c of sc.cast) {
      const d = COMP[c.kind], who = `scene ${i + 1} ${c.id || c.kind}`;
      if (!c.id || ids.has(c.id)) { c.id = `${c.kind}${ids.size}`; }
      ids.add(c.id);
      if (c.variant !== 'mixed' && !d.variants.includes(c.variant)) { problems.push(`${who}: ${c.kind} has no variant "${c.variant}" (use ${d.variants.join('|')} or mixed)`); c.variant = d.variants[0]; }
      if (c.hat !== 'mixed' && !d.hats.includes(c.hat)) { if (c.hat !== 'none') problems.push(`${who}: ${c.kind} can't wear "${c.hat}"`); c.hat = 'none'; }
      if (!(c.carry === 'band' && c.kind === 'dog') && !d.carries.includes(c.carry)) { if (c.carry !== 'none') problems.push(`${who}: ${c.kind} can't carry "${c.carry}"`); c.carry = 'none'; }
      for (const k of ['motion', 'then']) if (!d.motions.includes(c[k])) { problems.push(`${who}: ${c.kind} can't ${c[k]} (motions: ${d.motions.join('|')})`); c[k] = d.motions.includes('idle') ? 'idle' : d.motions[0]; }
      c.count = clamp(Math.round(c.count), 1, 16, 1);
      c.scale = clamp(c.scale, .15, 4, 1);
      c.spacing = clamp(c.spacing, 0, 600, 0) || Math.round(d.w * .9);
      c.label = clean(c.label, 22);
      c.move_from = clamp(c.move_from, sc.start, sc.end, sc.start);
      c.move_to = clamp(c.move_to, c.move_from, sc.end + 30, sc.end);
      c.enter = clamp(c.enter, sc.start, sc.end, sc.start);
      c.exit = clamp(c.exit, c.enter, sc.end, sc.end) || sc.end;
      if (c.exit <= c.enter) c.exit = sc.end;
    }
    sc.gags = (sc.gags || []).slice(0, 4);
    if (!sc.gags.length) problems.push(`scene ${i + 1} has no sight gag`);
    for (const g of sc.gags) {
      if (g.target && !ids.has(g.target)) { problems.push(`scene ${i + 1} ${g.type} gag targets "${g.target}", which isn't in that scene's cast`); g.target = ''; }
      if (!g.target && /^(stack|freeze|hide|zoom|spray)$/.test(g.type)) problems.push(`scene ${i + 1} ${g.type} gag needs a target`);
      g.at = clamp(g.at, sc.start, sc.end, sc.start);
      g.until = clamp(g.until, g.at, sc.end, sc.end);
      if (g.until <= g.at) g.until = Math.min(sc.end, g.at + 2.5);
      g.text = clean(g.text, 24);
    }
    if (sc.camera.follow && !ids.has(sc.camera.follow)) sc.camera.follow = '';
    for (const k of ['zoom', 'to_zoom']) sc.camera[k] = clamp(sc.camera[k], .5, 3, 1);
  });
  b.scenes = scenes;
  b.title = clean(b.title, 60);
  b.punch = (b.punch || []).map((p) => clean(p, 28)).filter(Boolean).slice(0, 3);
  if (b.punch.length < 3) b.punch = fallbackPunch.slice(0, 3).map((p) => clean(p, 28));
  b.finale = (b.finale || []).filter((x) => COMP[x.kind]).slice(0, 3);
  if (!b.finale.length) problems.push('no finale stars');
  return { beat: b, problems };
}

// Writes the beat sheet: one call, and one repair call if the sheet has problems. Returns the tidied sheet.
export async function direct(job, { script, tl, provider, model }) {
  const { system, user } = directorPrompt(script, tl);
  let ask = user, last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    job.progress(attempt ? 'directing the cartoon (fixing the plan)' : 'directing the cartoon');
    let raw;
    try {
      ({ data: raw } = await studioJson(job, { provider, purpose: 'studio:director', model, system, user: ask, schema: BEAT_SCHEMA, name: 'beat sheet', maxTokens: 16000, outTok: 6000 }));
    } catch (e) {
      if (attempt) throw e;
      ask = `${user}\n\nYour previous reply failed: ${e.message}. Reply with the whole beat sheet JSON.`;
      continue;
    }
    const { beat, problems } = checkBeat(raw, tl, script.punch);
    if (beat && (!problems.length || attempt)) return { beat, problems };
    last = problems;
    ask = `${user}\n\nYour previous beat sheet had these problems:\n- ${problems.slice(0, 20).join('\n- ')}\nHere it is; reply with the whole corrected beat sheet.\n${JSON.stringify(raw)}`;
  }
  throw new Error(`The director's plan didn't work after two tries: ${(last || []).slice(0, 3).join('; ')}`);
}
