// Daily digest: one LLM pass over a day's transcripts picks the most interesting storylines,
// then their clips are stitched into a highlight reel.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chatJson } from './ai/llm.mjs';
import { callsBetween, keepCalls, saveDigest, getDigest } from './db.mjs';
import { withTrace } from './meter.mjs';
import { station, regions } from './config.mjs';

const run = promisify(execFile);
const TZ = station.timezone;
// Bench 2026-10-16: 13 models found all 7 planted storylines; this one costs $0.002/day. Writing quality isn't scored.
export const DEFAULT_DIGEST_MODEL = 'openai/gpt-6-luna-pro';

export const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overview', 'highlights'],
  properties: {
    headline: { type: 'string', description: 'Newspaper-style title for the day, max 10 words' },
    overview: { type: 'string', description: '3–5 sentences: what the day on the radio was like' },
    highlights: {
      type: 'array',
      description: 'The most interesting storylines, best first, at most 10',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'summary', 'why', 'call_ids'],
        properties: {
          title: { type: 'string', description: 'Max 8 words' },
          kind: { type: 'string', enum: ['breaking', 'notable', 'funny', 'weird'] },
          summary: { type: 'string', description: 'What happened, start to finish, 1–3 sentences' },
          why: { type: 'string', description: 'One short phrase: why it made the cut' },
          call_ids: { type: 'array', items: { type: 'integer' }, description: 'Every transmission id in this storyline, in order' },
        },
      },
    },
  },
};

export const DIGEST_SYSTEM = `You are the night editor for a public scanner-radio log of one local area, named at the top of the log.
You get one day of transcribed radio traffic, one transmission per line: "#id HH:MM FEED: text". Most of it is routine.
Pick the storylines a local reader would most want to hear about: emergencies with real stakes (fires, entrapments, rescues, aircraft or vessel emergencies, serious crashes, hazmat), anything that disrupted the community (closures, outages, evacuations), and the genuinely funny or strange. A storyline usually spans several transmissions, possibly far apart in time and on different feeds — group them and list every id.
Skip routine traffic: status changes, radio checks, normal ATC, transports, train authorities, bridge-to-bridge passing arrangements.
Return up to 10 highlights, best first; return fewer if the day was quiet. Never include names of private people, phone numbers, plate numbers, or medical details beyond the call type.`;

const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

// Pure: day's calls + feed names → validated digest body. Shared by the app and the bench.
export async function distill({ date, calls, feedName, area = 'the local area', model = process.env.DIGEST_MODEL || DEFAULT_DIGEST_MODEL }) {
  const lines = calls.map((c) => `#${c.id} ${hhmm(c.at)} ${feedName(c.source_id)}: ${c.transcript.slice(0, 400)}`);
  const r = await chatJson({
    model, system: DIGEST_SYSTEM, schema: DIGEST_SCHEMA, name: 'digest', purpose: 'digest', maxTokens: 16000,
    user: `Area: ${area}\nRadio log for ${date} (${calls.length} transmissions):\n${lines.join('\n')}`,
  });
  const ids = new Set(calls.map((c) => c.id));
  const highlights = (r.data.highlights || [])
    .map((h) => ({ ...h, call_ids: h.call_ids.filter((id) => ids.has(id)) }))
    .filter((h) => h.call_ids.length)
    .slice(0, 10);
  return { body: { ...r.data, highlights }, costUsd: r.costUsd, ms: r.ms, model };
}

// Offset (ms) of the station's time zone from UTC at instant `ts`.
function tzOffset(ts) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ts).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
// UTC instant of local midnight on y-m-d in the station's time zone (DST-safe).
function localMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const t = guess - tzOffset(guess);
  return new Date(guess - tzOffset(t));
}

// UTC bounds of a local calendar day in the station's time zone.
export function dayBounds(date) {
  const [y, m, d] = date.split('-').map(Number);
  return [localMidnight(y, m, d).toISOString(), localMidnight(y, m, d + 1).toISOString()];
}

export const localDate = (t = new Date()) => t.toLocaleDateString('en-CA', { timeZone: TZ });

// Builds (or rebuilds) one region's digest for `date`, keeps its clips past retention, and writes a highlight reel.
export function buildDigest(date, region, sources) {
  return withTrace({ kind: 'digest', label: `${region} ${date}` }, () => build(date, region, sources));
}

async function build(date, region, sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const calls = callsBetween(...dayBounds(date)).filter((c) => byId.get(c.source_id)?.region === region);
  if (!calls.length) return null;
  const area = regions.find((r) => r.id === region)?.name || region;
  const { body, costUsd, model } = await distill({ date, calls, area, feedName: (id) => byId.get(id)?.short || id });
  const callMap = new Map(calls.map((c) => [c.id, c]));
  for (const h of body.highlights) {
    h.calls = h.call_ids.map((id) => callMap.get(id)).filter(Boolean)
      .map((c) => ({ id: c.id, at: c.at, source_id: c.source_id, transcript: c.transcript, audio: c.audio }));
  }
  const clipIds = body.highlights.flatMap((h) => h.call_ids);
  keepCalls(clipIds);
  const reel = await makeReel(`${date}-${region}`, body.highlights.flatMap((h) => h.calls.map((c) => c.audio)).filter(Boolean));
  saveDigest({ date, region, created_at: new Date().toISOString(), model, cost: costUsd, calls: calls.length, reel, body });
  return getDigest(date, region);
}

// Concatenates clips with a short two-tone "chirp" between transmissions.
async function makeReel(date, files) {
  const paths = files.map((f) => join('data', 'audio', f)).filter(existsSync);
  if (!paths.length) return null;
  mkdirSync(join('data', 'digests'), { recursive: true });
  const list = join('data', 'digests', `${date}.txt`);
  const chirp = join('data', 'digests', 'chirp.mp3');
  if (!existsSync(chirp)) {
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1200:d=0.12', '-f', 'lavfi', '-i', 'sine=f=900:d=0.12',
      '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono:d=0.5', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1,volume=0.25', '-ac', '1', '-ar', '16000', '-b:a', '32k', chirp]);
  }
  writeFileSync(list, paths.flatMap((p) => [`file '${join(process.cwd(), p)}'`, `file '${join(process.cwd(), chirp)}'`]).join('\n'));
  const name = `${date}.mp3`;
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-ac', '1', '-ar', '16000', '-b:a', '32k', join('data', 'digests', name)]);
  return name;
}
