// "Problems & suggestions": POST /api/report files a GitHub issue through the gh CLI (never a shell; the body
// goes in on stdin). gh reads its token from the keyring or from GH_TOKEN/GITHUB_TOKEN in .env.
import { execFile } from 'node:child_process';

export const REPO = process.env.REPORT_REPO || 'iamneilroberts/squelch';
const PER_IP_HOUR = 3, PER_DAY = 20, MIN = 10, MAX = 4000;
const hits = new Map(); // ip → timestamps of reports in the last hour
let day = { start: Date.now(), n: 0 };

const gh = (args, input) => new Promise((resolve, reject) => {
  const p = execFile('gh', args, { timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
  if (input != null) p.stdin.end(input); else p.stdin.end();
});

// gh present and signed in? Checked on first use; a "no" is rechecked after a minute so fixing it needs no restart.
let auth = null; // { ok, at }
let labelMade = false;
async function ghReady() {
  if (auth?.ok || (auth && Date.now() - auth.at < 60_000)) return auth.ok;
  const ok = await gh(['auth', 'status']).then(() => true, (e) => { console.log(`[report] gh unavailable: ${String(e.stderr || e.message).split('\n')[0]}`); return false; });
  auth = { ok, at: Date.now() };
  if (ok && !labelMade) { labelMade = true; await gh(['label', 'create', 'from-app', '--color', '5319e7', '-R', REPO]).catch(() => {}); } // "already exists" is fine
  return ok;
}

// Reports are public: no pings (＠), no hidden HTML comments, no control characters.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/@/g, '＠').replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
const field = (v, n) => clean(v).replace(/\s+/g, ' ').trim().slice(0, n);

export async function reportRoute(req, res, { json, readJson, canEdit, version }) {
  if (req.method === 'GET') return json(res, { repo: REPO, ready: await ghReady() });
  if (req.method !== 'POST') return json(res, { error: 'unknown' }, 404);
  const b = await readJson(req);
  if (b.website) return json(res, { url: `https://github.com/${REPO}/issues` }); // honeypot: pretend, file nothing
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (text.length < MIN || text.length > MAX) return json(res, { error: `Please write between ${MIN} and ${MAX} characters.` }, 400);
  const now = Date.now();
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (now - day.start > 86400e3) day = { start: now, n: 0 };
  if (recent.length >= PER_IP_HOUR || day.n >= PER_DAY) return json(res, { error: 'That’s a lot of reports. Please try again in a while.' }, 429);
  if (!(await ghReady())) return json(res, { error: 'Reporting isn’t set up on this receiver.', fallback: true }, 503);
  recent.push(now); hits.set(ip, recent); day.n++;

  const problem = b.type !== 'suggestion';
  const body = clean(text);
  const c = b.context && typeof b.context === 'object' ? b.context : null;
  const ctx = c && [
    ['App version', version()],
    ['Viewport', field(c.viewport, 20)],
    ['Browser', field(c.ua, 200)],
    ['Tab', field(c.tab, 30)],
    ['Open story', c.story ? `#${Number(c.story.id) || 0} ${field(c.story.subject, 120)}` : 'none'],
    ['Scanning', c.scan ? 'on' : 'off'],
    ['Dial style', field(c.dial, 20)],
    ['Time', new Date().toISOString()],
  ].map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const title = `[${problem ? 'Problem' : 'Suggestion'}] ${field(text, 70)}`;
  const issue = `${body}\n\n${ctx ? `---\n**Context**\n${ctx}\n\n` : '---\n'}_Filed from the Squelch app (${canEdit(req) ? 'owner' : 'guest'})_\n`;
  try {
    const out = await gh(['issue', 'create', '-R', REPO, '--title', title, '--body-file', '-', '--label', 'from-app', '--label', problem ? 'bug' : 'enhancement'], issue);
    const url = out.match(/https:\/\/github\.com\/\S+\/issues\/(\d+)/);
    if (!url) throw new Error(`no issue URL in: ${out.slice(0, 200)}`);
    return json(res, { url: url[0], number: Number(url[1]) });
  } catch (e) {
    console.log(`[report] gh issue create failed: ${String(e.stderr || e.message).slice(0, 300)}`);
    return json(res, { error: 'Couldn’t file it just now.', fallback: true }, 502);
  }
}
