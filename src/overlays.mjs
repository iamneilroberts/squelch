import { span } from './meter.mjs';

// Keyless live data for the map, fetched server-side per region and cached briefly.
// A region here is { id, bbox: [s, w, n, e], points: [[lat, lng], ...], tide }.
const UA = { 'User-Agent': 'PortCityMonitor/0.1 (local scanner map)' };

const cache = new Map();
async function cached(key, ttlMs, fn, empty = []) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit) return hit.value;
    if (e.backoff) return empty; // upstream is cooling off and there's nothing older to show
    throw e;
  }
}
// An upstream that answers 429/420 or times out is left alone for its Retry-After, else 30 s doubling to 5 min.
const cooling = new Map(); // host → { until, fails }
function coolOff(host, retryAfter) {
  const fails = (cooling.get(host)?.fails ?? 0) + 1;
  const secs = Number(retryAfter) || (Date.parse(retryAfter) - Date.now()) / 1000;
  const wait = secs > 0 ? Math.min(secs * 1000, 3600e3) : Math.min(300e3, 30e3 * 2 ** (fails - 1));
  cooling.set(host, { until: Date.now() + wait, fails });
}
// Upstream fetches (cache misses only) are metered as free API calls.
const getJson = (url, headers = UA) => {
  const { host } = new URL(url);
  if (cooling.get(host)?.until > Date.now()) return Promise.reject(Object.assign(new Error(`${host} is cooling off`), { backoff: true }));
  return span({ kind: 'http', purpose: `overlay:${host}`, provider: host }, async () => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) }).catch((e) => {
      if (e.name === 'TimeoutError') coolOff(host);
      throw e;
    });
    if (r.status === 429 || r.status === 420) coolOff(host, r.headers.get('retry-after'));
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    cooling.delete(host);
    return r.json();
  }, () => ({ cost: 0 }));
};
const inBox = ([s, w, n, e], lat, lng) => lat >= s && lat <= n && lng >= w && lng <= e;

export const overlays = {
  // ADS-B aircraft around the region (adsb.lol, community-fed, no key).
  aircraft: (r) => cached(`aircraft:${r.id}`, 10e3, async () => {
    const [s, w, n, e] = r.bbox;
    const lat = (s + n) / 2, lng = (w + e) / 2;
    const nm = Math.min(120, Math.max(40, Math.hypot((n - s) * 60, (e - w) * 60 * Math.cos(lat * Math.PI / 180)) / 2 + 10));
    const d = await getJson(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lng.toFixed(3)}/${Math.round(nm)}`);
    return (d.ac || []).filter((a) => a.lat != null).map((a) => ({
      id: a.hex, flight: (a.flight || '').trim() || a.r || a.hex, type: a.t || '',
      lat: a.lat, lng: a.lon, alt: a.alt_baro, track: a.track ?? 0, speed: a.gs,
      emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null, squawk: a.squawk,
    }));
  }),

  // Amtrak trains in the region — the Mardi Gras Service runs Mobile–New Orleans (Amtraker mirror).
  trains: (r) => cached('trains', 60e3, () => getJson('https://api.amtraker.com/v3/trains'))
    .then((d) => Object.values(d).flat()
      .filter((t) => inBox(r.bbox, t.lat, t.lon))
      .map((t) => ({ id: t.trainID, name: t.routeName, number: t.trainNum, lat: t.lat, lng: t.lon, heading: t.heading, state: t.trainState, timely: t.trainTimely }))),

  // Active NWS alerts at the region's reference points, de-duplicated.
  alerts: (r) => cached(`alerts:${r.id}`, 120e3, async () => {
    const lists = await Promise.all(r.points.map(([lat, lng]) =>
      getJson(`https://api.weather.gov/alerts/active?point=${lat},${lng}`, { ...UA, Accept: 'application/geo+json' })));
    const seen = new Map();
    for (const f of lists.flatMap((d) => d.features || [])) {
      seen.set(f.id, {
        id: f.id, event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline,
        area: f.properties.areaDesc, expires: f.properties.expires, geometry: f.geometry,
      });
    }
    return [...seen.values()];
  }),

  // Water level at the region's NOAA CO-OPS station (region.tide = station id, e.g. "8736897"; false = none).
  tide: (r) => (typeof r.tide !== 'string' ? Promise.resolve(null) : cached(`tide:${r.tide}`, 6 * 60e3, async () => {
    const d = await getJson(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${encodeURIComponent(r.tide)}&product=water_level&date=latest&datum=MLLW&time_zone=gmt&units=english&format=json`);
    const v = d.data?.[0];
    return v ? { station: d.metadata?.name, ft: Number(v.v), at: v.t.replace(' ', 'T') + ':00Z', lat: Number(d.metadata?.lat), lng: Number(d.metadata?.lon) } : null;
  }, null)),

  ships: (r) => Promise.resolve(ships.list().filter((s) => inBox(r.bbox, s.lat, s.lng))),
};

// AIS ship positions via aisstream.io websocket (free key). Off unless AISSTREAM_API_KEY is set.
// Covers the bounding box of all configured regions (see startShips).
const ships = {
  bbox: null,
  map: new Map(),
  list() {
    const cutoff = Date.now() - 20 * 60e3;
    return [...this.map.values()].filter((s) => s.seen > cutoff);
  },
  start() {
    const key = process.env.AISSTREAM_API_KEY;
    if (!key || typeof WebSocket === 'undefined') return;
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    ws.onopen = () => ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[this.bbox[0], this.bbox[1]], [this.bbox[2], this.bbox[3]]]],
      FilterMessageTypes: ['PositionReport'],
    }));
    ws.onmessage = async (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
        const p = m.Message?.PositionReport;
        if (!p) return;
        this.map.set(m.MetaData.MMSI, {
          id: m.MetaData.MMSI, name: (m.MetaData.ShipName || '').trim(), lat: p.Latitude, lng: p.Longitude,
          course: p.Cog, speed: p.Sog, seen: Date.now(),
        });
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => setTimeout(() => this.start(), 30e3);
  },
};

// bbox = [south, west, north, east] of everything the station covers.
export function startShips(bbox) {
  ships.bbox = bbox;
  ships.start();
}
