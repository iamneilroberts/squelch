// Dev-only: fills a throwaway DB so the UI can be checked without live feeds.
//   DB_PATH=data/demo.db node scripts/seed-demo.mjs && DB_PATH=data/demo.db INGEST=0 PORT=8078 npm start
// Seeds: sample incidents in both regions, plus the bench's synthetic day (bench/fixtures/day-log.json)
// as recorded traffic — with bench audio clips attached — so a real daily digest can be built from it.
import { readFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';

if (!process.env.DB_PATH?.includes('demo')) throw new Error('Refusing to seed: set DB_PATH to a demo database');
const { db, createIncident, updateIncident, insertCall, tagCall } = await import('../src/db.mjs');
db.exec('DELETE FROM calls; DELETE FROM incidents; DELETE FROM updates; DELETE FROM digests;');

const min = (m) => new Date(Date.now() - m * 60e3).toISOString();
const samples = [
  { m: 4, source_id: 'mobile-fire', category: 'breaking', type: 'fire', headline: 'Structure fire, Cottage Hill Rd', summary: 'Engine 12 reports heavy smoke showing from a single-story commercial building; second alarm requested.', location_text: '3300 Cottage Hill Rd', lat: 30.6493, lng: -88.1416, precision: 'geocoded', units: ['E12', 'L3', 'BC2'], transcript: 'Engine 12 on scene, heavy smoke showing, single story commercial, we are going defensive, give me a second alarm.' },
  { m: 11, source_id: 'mobile-fire', category: 'notable', type: 'crash', headline: 'Two-vehicle crash, Airport Blvd & Schillinger', summary: 'Units responding to a two-vehicle wreck with one person reported trapped.', location_text: 'Airport Blvd & Schillinger Rd', lat: 30.6726, lng: -88.2266, precision: 'geocoded', units: ['E27', 'R2'] },
  { m: 23, source_id: 'baldwin-fire-ems', category: 'notable', type: 'medical', headline: 'Medical call, Fairhope pier', summary: 'EMS dispatched to the municipal pier for a fall injury.', location_text: 'Fairhope Municipal Pier', lat: 30.5237, lng: -87.9113, precision: 'geocoded', units: ['Medic 4'] },
  { m: 37, source_id: 'mobile-marine', category: 'breaking', type: 'marine', headline: 'Vessel taking on water near Dauphin Island', summary: 'Coast Guard relaying a pan-pan for a 24-foot boat taking on water south of Dauphin Island, two aboard.', location_text: 'South of Dauphin Island', lat: 30.42, lng: -88.03, precision: 'source', units: ['USCG Sector Mobile'] },
  { m: 52, source_id: 'kbfm-tower', category: 'notable', type: 'aviation', headline: 'Precautionary landing, Brookley', summary: 'Light aircraft reports a rough-running engine and is cleared straight in to runway 33.', location_text: 'Mobile Downtown Airport', lat: 30.6268, lng: -88.0681, precision: 'source', units: [] },
  { m: 8, source_id: 'george-law', category: 'notable', type: 'police', headline: 'Vehicle pursuit, Hwy 98 east of Lucedale', summary: 'Deputies pursuing a vehicle eastbound on Highway 98 toward the Alabama line; Lucedale PD assisting.', location_text: 'Highway 98, Lucedale', lat: 30.92, lng: -88.55, precision: 'geocoded', units: ['GC 12', 'LPD 3'] },
  { m: 29, source_id: 'greene-fire', category: 'breaking', type: 'fire', headline: 'Woods fire threatening home, McLain', summary: 'Greene County fire units requesting Forestry Commission dozer for a woods fire near a residence off Highway 98.', location_text: 'Highway 98, McLain', lat: 31.105, lng: -88.82, precision: 'geocoded', units: ['Station 4', 'MFC'] },
];
for (const s of samples) {
  const at = min(s.m);
  const callId = insertCall({ source_id: s.source_id, at, duration: 9, audio: null, transcript: s.transcript || s.summary });
  const inc = createIncident({ ...s, at, call_id: callId, confidence: 0.85 });
  tagCall(callId, inc.id, s.category);
  if (s.m === 4) updateIncident(inc.id, { at: min(1), summary: 'Second alarm companies arriving; crews report fire through the roof.', units: ['E5', 'L1'], category: 'breaking' });
}

// Yesterday's synthetic day as recorded traffic. Gold storyline calls get a bench clip as stand-in audio.
const day = JSON.parse(readFileSync('bench/fixtures/day-log.json', 'utf8'));
const clips = readdirSync('bench/fixtures/audio').filter((f) => f.endsWith('.mp3'));
const goldIds = new Set(day.gold.flatMap((g) => g.call_ids));
mkdirSync('data/audio', { recursive: true });
let k = 0;
const idMap = new Map();
for (const c of day.calls) {
  let audio = null;
  if (goldIds.has(c.id)) {
    audio = `demo-${c.id}.mp3`;
    copyFileSync(`bench/fixtures/audio/${clips[k++ % clips.length]}`, `data/audio/${audio}`);
  }
  idMap.set(c.id, insertCall({ source_id: c.source_id, at: new Date(c.at).toISOString(), duration: 6, audio, transcript: c.transcript }));
}
console.log(`seeded ${samples.length} incidents and ${day.calls.length} calls for ${day.date}`);
