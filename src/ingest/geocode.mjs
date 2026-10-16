// Nominatim geocoder, bounded to the Mobile/Baldwin area, cached in SQLite, max 1 request/second
// per the OSM usage policy.
import { geocache } from '../db.mjs';
import { span } from '../meter.mjs';

const UA = process.env.GEOCODER_UA || 'PortCityMonitor/0.1 (local scanner map)';
let queue = Promise.resolve();

// bbox = [south, west, north, east] of the feed's region; results outside it are rejected.
export function geocode(query, bbox) {
  const q = query.trim().toLowerCase();
  if (!q || !bbox) return Promise.resolve(null);
  const viewbox = [bbox[1], bbox[2], bbox[3], bbox[0]].join(',');
  const key = `${viewbox}|${q}`;
  const hit = geocache.get(key);
  if (hit) return Promise.resolve(hit.lat == null ? null : hit);
  const job = queue.then(async () => {
    // Nominatim can't do intersections; fall back to the first street of "A & B, City, AL".
    const [head, ...tail] = q.split(',');
    const firstStreet = head.includes('&') ? [head.split('&')[0].trim(), ...tail].join(',') : null;
    const result = await lookup(q, viewbox) ?? (firstStreet ? await lookup(firstStreet, viewbox) : null);
    geocache.set(key, result);
    return result;
  });
  queue = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return job;
}

async function lookup(q, viewbox) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
  const [r] = await span({ kind: 'http', purpose: 'geocode', provider: 'nominatim' }, async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    return res.json();
  }, () => ({ cost: 0 })).catch(() => []);
  return r ? { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name } : null;
}
