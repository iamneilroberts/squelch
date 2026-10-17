// What's new: the server's own git history, so each deploy (git pull, with or without a restart) shows up on its own.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 500;
const git = (args) => new Promise((done) => execFile('git', args, { cwd: ROOT, timeout: 5e3, maxBuffer: 16e6 }, (err, out) => done(err ? null : out)));

let cache = null; // { head, changes }: parsed once per HEAD

function parse(out) {
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, date, subject, body = ''] = r.split('\x1f');
    const first = body.replace(/^Claude-Session:.*$/gm, '').trim().split(/\n\s*\n/)[0].trim();
    return { sha, short: sha.slice(0, 7), date, subject, body: first };
  });
}

// { head, changes } newest first; an empty list (never an error) when git or the history isn't there.
export async function changes(limit = 200) {
  const head = (await git(['rev-parse', 'HEAD']))?.trim();
  if (!head) return { head: null, changes: [] };
  if (cache?.head !== head) {
    const out = await git(['log', `-n${MAX}`, '--format=%H%x1f%aI%x1f%s%x1f%b%x1e']);
    cache = out ? { head, changes: parse(out) } : null;
  }
  return { head, changes: cache ? cache.changes.slice(0, Math.max(1, Math.min(MAX, limit))) : [] };
}
