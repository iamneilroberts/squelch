// clip → transcript → triage → geocode → incident; publishes everything on `bus`.
import { EventEmitter } from 'node:events';
import { rmSync, renameSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { insertCall, tagCall, createIncident, updateIncident, openIncidentsFor, expireAudio, pruneHistory, setGate, currentThread, saveThread } from '../db.mjs';
import { withTrace, linkTraceToCall, pruneSpans, span, setTraceVad } from '../meter.mjs';
import { loudnessSpread } from './vad.mjs';
import { gate } from '../ai/jev.mjs';
import { startStream } from './stream.mjs';
import { transcribe, transcriberReady } from '../ai/transcribe.mjs';
import { triage } from '../ai/triage.mjs';
import { nextThread } from '../ai/thread.mjs';
import { considerThread } from '../notify.mjs';
import { llmReady } from '../ai/llm.mjs';
import { geocode } from './geocode.mjs';

export const bus = new EventEmitter();
export const status = {}; // source id → { state, lastSegment, lastCall, error }

const setStatus = (id, patch) => {
  status[id] = { ...status[id], ...patch, at: new Date().toISOString() };
  bus.emit('status', { id, ...status[id] });
};

let regionById = new Map();

// Jev gate policy. Thresholds from bench/RESULTS.md and the first day of shadow data.
export const GATE = {
  mode: process.env.JEV_GATE || 'active',                  // active | shadow | off
  skipBelow: Number(process.env.JEV_SKIP_BELOW || 0.2),     // newsworthy p below this skips LLM triage
  speechBelow: Number(process.env.JEV_SPEECH_BELOW || 0.3), // speech p below this drops the clip as model filler
  auditRate: Number(process.env.JEV_AUDIT_RATE || 0.05),    // share of skipped calls triaged anyway, to catch misses
};

// Speech detector policy (src/ingest/vad.mjs). shadow: score every clip but transcribe all of them.
export const VAD = {
  mode: process.env.VAD_MODE || 'shadow',                   // active | shadow | off
  minSpread: Number(process.env.VAD_MIN_SPREAD_DB || 4),    // loudness spread below this = no speech
  auditRate: Number(process.env.VAD_AUDIT_RATE || 0.05),    // share of quiet clips transcribed anyway
};

export function startIngest(sources, regions) {
  regionById = new Map(regions.map((r) => [r.id, r]));
  const missing = [(!transcriberReady() || !llmReady()) && 'OPENROUTER_API_KEY'].filter(Boolean);
  if (missing.length) {
    console.warn(`[ingest] off — set ${missing.join(' and ')} in .env`);
    for (const s of sources) setStatus(s.id, { state: s.kind === 'stream' ? 'standby' : 'listen-only' });
    return;
  }
  const stops = [];
  for (const s of sources) {
    if (s.kind !== 'stream' || !s.streamUrl) { setStatus(s.id, { state: 'listen-only' }); continue; }
    stops.push(startStream(s, {
      onStatus: (p) => setStatus(s.id, p),
      onClip: (clip) => withTrace({ kind: 'clip', label: s.short, source_id: s.id }, () => handleClip(s, clip)),
    }));
  }
  // Don't leave ffmpeg children running after the server stops.
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stops.forEach((stop) => stop()); process.exit(0); });
  // Every transmission is recorded; clips older than RECORD_DAYS are deleted unless a daily digest kept them,
  // and transcripts and stories after 30 days.
  const keepHours = Number(process.env.RECORD_DAYS || 7) * 24;
  setInterval(() => {
    expireAudio(keepHours).forEach((f) => rmSync(join('data', 'audio', f), { force: true }));
    pruneSpans(30);
    pruneHistory(30);
  }, 3600e3);
}

async function handleClip(source, clip) {
  const region = regionById.get(source.region);

  // Local speech detector: in active mode, steady hiss/hum never reaches the paid transcriber.
  if (VAD.mode !== 'off') {
    const spread = await span({ kind: 'local', purpose: 'vad', provider: 'ffmpeg' }, () => loudnessSpread(clip.file), () => ({ cost: 0 })).catch(() => null);
    const quiet = spread != null && spread < VAD.minSpread;
    const skip = VAD.mode === 'active' && quiet && Math.random() >= VAD.auditRate;
    setTraceVad(spread, skip);
    if (skip) { rmSync(clip.file, { force: true }); return; }
  }

  const { text: transcript } = await transcribe(clip.file, undefined, region?.vocab);
  if (!transcript) {
    // Shadow mode keeps real "no speech" clips (capped) so the detector can be calibrated on actual feed noise.
    const dir = join('data', 'vad-samples');
    if (VAD.mode === 'shadow' && (!existsSync(dir) || readdirSync(dir).length < 400)) {
      mkdirSync(dir, { recursive: true });
      renameSync(clip.file, join(dir, `${source.id}-${Date.now()}.mp3`));
    } else rmSync(clip.file, { force: true });
    return;
  }

  // Jev gate. active: drop non-speech, skip triage for clearly routine traffic (with an audit sample);
  // shadow: run beside triage and only record; off: triage everything. A failed gate call falls back to triage.
  const runTriage = async () => (await triage({ transcript, source, openIncidents: openIncidentsFor(source.id) })).items;
  let g = null, items, decision = null;
  if (GATE.mode === 'active') {
    g = await gate({ transcript, source });
    if (g?.speech != null && g.speech < GATE.speechBelow) { rmSync(clip.file, { force: true }); return; }
  }
  const callId = insertCall({ source_id: source.id, at: clip.at, duration: clip.duration, audio: clip.audio, transcript });
  linkTraceToCall(callId);
  // The scan (src/scan.mjs) can play it now; its story and incident follow with the 'call' event.
  bus.emit('clip-ready', { id: callId, source_id: source.id, at: clip.at, duration: clip.duration, audio: clip.audio, transcript, subject: null, thread_id: null, incident_id: null });
  // The channel's story runs beside triage. On failure the call just isn't added to it.
  const current = currentThread(source.id);
  const threadP = nextThread({ source, current, transcript }).then(
    (t) => ({ thread_id: saveThread(callId, source.id, clip.at, t.same && current ? current.id : null, t), subject: t.subject }),
    () => ({ thread_id: null, subject: current?.subject ?? null }));
  setStatus(source.id, { lastCall: clip.at, error: null });

  if (GATE.mode === 'active') {
    const routine = g?.newsworthy != null && g.newsworthy < GATE.skipBelow;
    decision = !g ? null : !routine ? 'pass' : Math.random() < GATE.auditRate ? 'audit' : 'skip';
    items = decision === 'skip' ? [] : await runTriage();
  } else if (GATE.mode === 'shadow') {
    [items, g] = await Promise.all([runTriage(), gate({ transcript, source })]);
  } else {
    items = await runTriage();
  }
  setGate(callId, g, decision);
  const { thread_id, subject } = await threadP;
  considerThread(thread_id).catch((e) => console.warn('[notify]', e.message));
  let category = 'routine';
  let incidentId = null;
  for (const it of items) {
    if (it.action === 'routine') continue;
    const geo = it.geocode_query ? await geocode(it.geocode_query, region?.bbox) : null;
    const where = geo
      ? { lat: geo.lat, lng: geo.lng, precision: 'geocoded' }
      : { lat: source.lat, lng: source.lng, precision: 'source' };
    const fields = {
      ...where, at: clip.at, call_id: callId, source_id: source.id,
      headline: it.headline, summary: it.summary, category: it.category, type: it.type,
      location_text: it.location_text || null, units: it.units, confidence: it.confidence,
    };
    const inc = it.action === 'update' && it.incident_id
      ? updateIncident(it.incident_id, fields)
      : null;
    const saved = inc ?? createIncident(fields);
    incidentId = saved.id;
    category = it.category === 'breaking' || category === 'breaking' ? 'breaking' : it.category;
    bus.emit('incident', saved);
  }
  tagCall(callId, incidentId, category);
  bus.emit('call', { id: callId, source_id: source.id, at: clip.at, duration: clip.duration, audio: clip.audio, transcript, incident_id: incidentId, category, subject, thread_id });
}
