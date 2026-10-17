# Add your region

Everything Squelch knows about your area lives in one file, `sources.json` (start from `sources.example.json`; a full real setup is in `examples/gulf-coast.json`). It has three parts: the **station** (name and time zone), **regions** (positions on the Location knob), and **sources** (feeds on the dial).

## 1. Find your feeds (15–30 minutes)

1. Open Broadcastify's directory for your state, then your county: `https://www.broadcastify.com/listen/ctid/<county id>`. Each feed shows a feed ID, what it covers, and whether it's online.
2. Prefer feeds that are **online with recent listeners**. A feed can be "online" and still carry nothing but silence — see step 5.
3. Check [RadioReference](https://www.radioreference.com/db/) for your county. If a law-enforcement talkgroup is marked encrypted, no feed will carry it; fire and EMS are usually in the clear.
4. Good non-public-safety sources: airport tower and marine VHF feeds on Broadcastify, amateur repeaters (SKYWARN storm nets), and [LiveATC](https://www.liveatc.net) for airports (listen-only links — LiveATC's terms bar re-use).
5. After you add feeds and start Squelch, watch the lamps for an hour. A feed that stays green but never produces a transcript may be dead air: record a minute and check its level (`ffmpeg -i <file> -af volumedetect -f null -`). Around −90 dB mean is silence — remove it.

## 2. The station

```json
"station": { "script": "Squelch", "caps": "Monitor", "badge": "Scanner radio, transcribed", "timezone": "America/Denver" }
```

| Field | Meaning |
|---|---|
| `script`, `caps` | the two lines of the chrome badge (e.g. "Port City" / "Monitor") |
| `badge` | subtitle when the Location knob is on **All** |
| `timezone` | IANA zone; decides clock display and where each **daily log** day starts and ends |

## 3. Regions (Location knob positions)

```json
{ "id": "home", "name": "My County", "short": "Home", "badge": "My County · State",
  "bbox": [40.55, -74.30, 40.95, -73.65], "center": [40.75, -73.98], "zoom": 10,
  "nwsPoint": [40.75, -73.98], "tide": false,
  "vocab": "Main Street, Broadway, Route 9, County Hospital" }
```

| Field | Meaning |
|---|---|
| `id` | short, unique, lowercase; sources point at it |
| `name` / `short` / `badge` | full name (digest headings), knob label, badge subtitle |
| `bbox` | `[south, west, north, east]`. The map fits to it, the geocoder only accepts addresses inside it, aircraft/train layers use it. [bboxfinder.com](http://bboxfinder.com) helps. |
| `nwsPoint` | `[lat, lng]` for National Weather Service alerts (US only) |
| `tide` | a NOAA CO-OPS station id (e.g. `"8736897"`) from [tidesandcurrents.noaa.gov](https://tidesandcurrents.noaa.gov), or `false` |
| `vocab` | comma-separated local names that help the transcriber spell streets and towns |

**Keep `vocab` short and certain** — 20–50 real names. The transcriber treats it as "names you may hear", and on a noisy clip it may echo them into an invented dispatch. Leave out anything you're not sure exists.

Regions appear on the knob in the order listed; put them west to east and it reads like a map. Up to five fit comfortably.

## 4. Sources (dial stations)

```json
{ "id": "county-fire", "name": "County Fire Dispatch", "short": "CO FIRE", "dial": "P25",
  "band": "fire", "kind": "stream",
  "streamUrl": "https://audio.broadcastify.com/12345.mp3",
  "listenUrl": "https://www.broadcastify.com/listen/feed/12345",
  "coverage": "County fire and EMS dispatch; mutual aid with City FD.",
  "lat": 40.75, "lng": -73.98, "region": "home", "area": "My County, ST" }
```

| Field | Meaning |
|---|---|
| `id` | unique; stored with every transmission — don't rename once you have history |
| `short` | dial label (≤ 9 characters) |
| `dial` | the "frequency" printed on the dial: a real frequency, `P25`, a channel, anything short |
| `band` | `police`, `fire`, `air`, `marine`, `rail`, `weather` or `ham` — decides the band key and dial group |
| `kind` | `stream` = recorded and transcribed; `link` = listen-only link (opens `listenUrl`) |
| `streamUrl` | Broadcastify: `https://audio.broadcastify.com/<feed id>.mp3` (needs Premium credentials in `.env`) |
| `coverage` | who and what the feed carries. **The triage model reads this**, so be specific. |
| `lat`, `lng` | fallback map position when a transmission names no address |
| `region` | the region `id` |
| `area` | "Town, ST" — the default city/state for geocoding |

## 5. Check it

1. `npm start` and pick each region on the knob: the badge, dial and lamps should change.
2. Green lamp = receiving. Red = the stream refused (check credentials or the feed ID). Grey = listen-only link.
3. Tap a station to listen live. Press **Scan** to hear new transmissions from the visible stations.
4. Open the **Ledger** (`/manual.html#ledger`, or *Station manual ↗* at the bottom of the receiver) after an hour: the Speech detector panel shows how much hum the squelch dropped per feed, and spend per clip.
