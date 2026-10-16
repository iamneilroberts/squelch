# Squelch

A scanner-radio receiver for your part of the world. Squelch listens to public scanner feeds, transcribes every transmission, triages them into incidents on a map, and prints a daily log of the stories worth hearing — dressed as a 1950s tabletop radio.

<p align="center">
  <img src="docs/screenshots/desktop.webp" alt="Squelch in a desktop browser: the slide-rule tuning dial, band keys, Location knob and volume knob above a map with an incident popup and the green-bar printed incident log" width="760">
  &nbsp;
  <img src="docs/screenshots/phone.webp" alt="Squelch on a phone: badge, swipeable dial, band keys, Location and volume knobs side by side, and the incident map" width="220">
</p>
<p align="center"><sub>Shown with the Gulf Coast example config and sample data.</sub></p>

- **Live map** of incidents (fires, crashes, rescues, police calls, hazards), each with its transcript and audio clip
- **Dial, band keys and a Location knob** to tune any feed live or **Scan** new traffic across the channels you pick
- **Daily log**: after midnight, each area's day is read back and the best storylines are printed, with a highlight reel of the real audio
- **Live map layers**: aircraft (ADS-B), Amtrak trains, NWS weather alerts, tide gauges, ships (AIS)
- **Station Ledger** (`/costs.html`): every AI and API call with timing, tokens and cost

## Requirements

| | Why | Cost |
|---|---|---|
| Node.js 22.13+ | built-in SQLite | free |
| `ffmpeg` + `ffprobe` on PATH | stream capture and audio processing | free |
| [OpenRouter](https://openrouter.ai) API key | speech-to-text, triage, daily digest, speech gate | roughly **$1–2 a day** for ~10 busy feeds; the Ledger shows your actual spend |
| [Broadcastify Premium](https://www.broadcastify.com/premium/) | the stream server only admits Premium accounts (a free account gets `401`) | $15 / 6 months or $30 / year |

## Install

```
git clone https://github.com/iamneilroberts/squelch && cd squelch
npm install
cp .env.example .env
cp sources.example.json sources.json
npm start
```

Then open http://localhost:8077.

1. In `.env`, set `OPENROUTER_API_KEY`, `BROADCASTIFY_LOGIN` (your RadioReference/Broadcastify **username**, not your email) and `BROADCASTIFY_PASSWORD`.
2. In `sources.json`, describe your area and its feeds — see **[docs/ADD-YOUR-REGION.md](docs/ADD-YOUR-REGION.md)**.
3. Restart. Green lamps along the bottom mean a feed is being received.

To see a complete, real configuration, run the Gulf Coast example (Mobile & Baldwin AL, George/Greene and the MS Gulf Coast): `SOURCES_FILE=examples/gulf-coast.json npm start`.

No keys yet? `DB_PATH=data/demo.db SOURCES_FILE=examples/gulf-coast.json node scripts/seed-demo.mjs` then `DB_PATH=data/demo.db SOURCES_FILE=examples/gulf-coast.json INGEST=0 PORT=8078 npm start` renders sample incidents and a sample day.

## How it works

```
feed ─► ffmpeg 45 s segments ─► squelch ─► speech-to-text ─► Jev gate ─► triage ─► geocode ─► map / log
                                   │                             │
                     hum & dead air dropped here      routine chatter skips triage
                     (no transcription cost)          (every transmission is still recorded)
```

| Step | Where | Default |
|---|---|---|
| Silence + **adaptive squelch** | `src/ingest/stream.mjs`, `src/ingest/vad.mjs` | keeps only what rises above each clip's own background in 16 spectral bands; drops hum/static clips before they cost anything |
| Speech-to-text | `src/ai/transcribe.mjs` | `xiaomi/mimo-v2.6-flash` via OpenRouter audio input |
| Speech + newsworthy gate | `src/ai/jev.mjs` | TypeSafe Jev: drops model filler, skips triage for routine traffic (5 % audited) |
| Incident triage | `src/ai/triage.mjs` | `openai/gpt-6-luna`, strict JSON; merges follow-ups into open incidents |
| Geocoding | `src/ingest/geocode.mjs` | OpenStreetMap Nominatim, bounded to the feed's region |
| Daily digest + reel | `src/digest.mjs` | `openai/gpt-6-luna-pro` |

Models are chosen by the bench (`npm run bench`, results in `bench/RESULTS.md`) and can be overridden with `TRANSCRIBE_MODEL`, `TRIAGE_MODEL`, `DIGEST_MODEL`. Claude models go direct through the Anthropic SDK when `ANTHROPIC_API_KEY` is set.

## Sharing it

Squelch is built to run at home. To let a few people see it, put it behind a Cloudflare Tunnel with Cloudflare Access — see **[docs/SHARING.md](docs/SHARING.md)**. Tunnel visitors don't see raw transcripts unless you switch that on, and they listen live with **their own** Broadcastify Premium login, never yours.

## Use it responsibly

- **Personal use.** Broadcastify's terms restrict re-streaming. Keep your instance private or invitation-only.
- **Encrypted traffic stays encrypted.** Many police talkgroups are encrypted; Squelch only uses audio that public feeds already carry. Don't attempt to decrypt anything.
- **Transcripts contain personal details** (names, addresses, plates). Triage keeps them out of incidents; raw transcripts are hidden from remote visitors by default.
- **AI makes mistakes.** Transcribers can invent plausible dispatches from static; the squelch and gate catch most of it, not all. This is a hobby monitor, not an emergency service — call 911.
- LiveATC and NOAA Weather Radio entries are listen-only links; their audio isn't recorded.

## Development

- `npm run bench -- all` — model bench (triage, transcription, digest) against `bench/fixtures/`
- `src/meter.mjs` — every AI/API call is a span; the Ledger reads them
- Settings worth knowing: `RECORD_DAYS` (audio retention, default 7), `JEV_GATE` (`active` / `shadow` / `off`), `ADAPTIVE_SQUELCH=0`, `INGEST=0` (map only)

## License

MIT — see [LICENSE](LICENSE).
