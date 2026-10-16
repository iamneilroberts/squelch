// Station config: SOURCES_FILE if set, else sources.json, else the bundled sources.example.json.
// See docs/ADD-YOUR-REGION.md for the format.
import { readFileSync, existsSync } from 'node:fs';

export const configFile = process.env.SOURCES_FILE || (existsSync('sources.json') ? 'sources.json' : 'sources.example.json');
const raw = JSON.parse(readFileSync(configFile, 'utf8'));

export const station = {
  script: 'Squelch',                 // the chrome badge's script line
  caps: 'Monitor',                   // the spaced capitals under it
  badge: 'Scanner radio, transcribed', // badge subtitle when the Location knob is on "All"
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...raw.station,
};
export const regions = raw.regions;
export const sources = raw.sources;
