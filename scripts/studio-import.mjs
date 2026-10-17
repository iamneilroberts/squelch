// Adds an animation made outside the Studio to its library: copies the files and writes the row.
// Run from the server's folder (it writes data/animations/<id>/ and the DB at DB_PATH):
//   node scripts/studio-import.mjs <dir> <meta.json | '{"title":…}'>
// meta: title, style, format, thread_id, source_id, duration_s, cost_usd (null = not metered), models, notes,
// created_at, prompt_version, and files (names in <dir> to copy; default all of them).
import { readFileSync, readdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createAnimation, updateAnimation, animDir, scanFiles, getAnimation } from '../src/studio/library.mjs';

const [dir, metaArg] = process.argv.slice(2);
if (!dir || !metaArg) { console.error('usage: node scripts/studio-import.mjs <dir> <meta.json | json>'); process.exit(1); }
const meta = JSON.parse(existsSync(metaArg) ? readFileSync(metaArg, 'utf8') : metaArg);
const names = meta.files || readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
for (const f of names) if (!existsSync(join(dir, f))) { console.error(`missing ${join(dir, f)}`); process.exit(1); }

const now = new Date().toISOString();
const id = createAnimation({ ...meta, files: [], status: 'done', created_at: meta.created_at || now, finished_at: meta.finished_at || meta.created_at || now });
for (const f of names) copyFileSync(join(dir, f), join(animDir(id), f));
updateAnimation(id, { files: scanFiles(id) });
console.log(JSON.stringify(getAnimation(id), null, 2));
