// "Problems & suggestions": POST /api/report files a GitHub issue through the gh CLI (never a shell; the body
// goes in on stdin). gh reads its token from the keyring or from GH_TOKEN/GITHUB_TOKEN in .env.
// "My reports": GET /api/report/status reads back the status label and the owner's replies, and a poller
// pushes a reporter's browser when either changes (and owners when a fix is ready to ship).
import { execFile } from 'node:child_process';
import { db } from './db.mjs';
import { pushReady, pushTo, pushToEndpoint, subId, ownerSubIds } from './notify.mjs';

export const REPO = process.env.REPORT_REPO || 'iamneilroberts/squelch';
const OWNER = (process.env.REPORT_OWNER || REPO.split('/')[0]).toLowerCase(); // files every report, so only its replies count
// The status vocabulary, as labels. No status label yet means "received". `ship` is the owner's go-ahead to deploy a ready fix.
const STATUS = { received: 'received', planned: 'planned', 'in-progress': 'in progress', ready: 'fix ready', fixed: 'fixed', 'wont-do': 'won’t do', 'needs-info': 'needs more info', closed: 'closed' };
const LABELS = [['from-app', '5319e7'], ...Object.keys(STATUS).filter((s) => s !== 'closed').map((s) => [`status:${s}`, 'c5def5']), ['ship', '0e8a16']];
const MARK = '<!-- squelch-reply -->'; // an owner comment starting with this line is a reply to the reporter
const CACHE_MS = Number(process.env.REPORT_CACHE_MS ?? 5 * 60e3);
const POLL_MS = Number(process.env.REPORT_POLL_MS || 10 * 60e3);
const PER_IP_HOUR = 3, PER_DAY = 20, MIN = 10, MAX = 4000;
const hits = new Map(); // ip → timestamps of reports in the last hour
let day = { start: Date.now(), n: 0 };

const gh = (args, input) => new Promise((resolve, reject) => {
  const p = execFile('gh', args, { timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
  if (input != null) p.stdin.end(input); else p.stdin.end();
});

// gh present and signed in? Checked on first use; a "no" is rechecked after a minute so fixing it needs no restart.
let auth = null; // { ok, at }
let labelsMade = false;
async function ghReady() {
  if (auth?.ok || (auth && Date.now() - auth.at < 60_000)) return auth.ok;
  const ok = await gh(['auth', 'status']).then(() => true, (e) => { console.log(`[report] gh unavailable: ${String(e.stderr || e.message).split('\n')[0]}`); return false; });
  auth = { ok, at: Date.now() };
  if (ok && !labelsMade) { // "already exists" is fine
    labelsMade = true;
    for (const [name, color] of LABELS) await gh(['label', 'create', name, '--color', color, '-R', REPO]).catch(() => {});
  }
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
    if (typeof b.endpoint === 'string' && subId(b.endpoint)) // this browser gets a notification when the report moves
      db.prepare('INSERT OR IGNORE INTO report_watch (issue, endpoint, last_status) VALUES (?, ?, ?)').run(Number(url[1]), b.endpoint, 'received');
    return json(res, { url: url[0], number: Number(url[1]) });
  } catch (e) {
    console.log(`[report] gh issue create failed: ${String(e.stderr || e.message).slice(0, 300)}`);
    return json(res, { error: 'Couldn’t file it just now.', fallback: true }, 502);
  }
}

/* ───────── My reports ───────── */
// Browsers by push endpoint: report_subs kept push_subs ids, and SQLite gives a deleted browser's id to the next one.
db.exec('CREATE TABLE IF NOT EXISTS report_watch (issue INTEGER NOT NULL, endpoint TEXT NOT NULL, last_status TEXT, last_reply_id INTEGER, PRIMARY KEY (issue, endpoint))');
if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'report_subs'").get()) {
  db.exec('INSERT OR IGNORE INTO report_watch SELECT r.issue, p.endpoint, r.last_status, r.last_reply_id FROM report_subs r JOIN push_subs p ON p.id = r.sub_id; DROP TABLE report_subs');
}
db.exec('CREATE TABLE IF NOT EXISTS report_ready (issue INTEGER PRIMARY KEY, at TEXT NOT NULL)'); // owners already told "fix ready"

const replyText = (body) => body.trimStart().slice(MARK.length).split(/<details/i)[0].replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 1500);
// One issue as the app shows it, or null when it wasn't filed from the app (or doesn't exist). Cached for CACHE_MS.
const cache = new Map(); // n → { at, p }
function issueStatus(n) {
  const hit = cache.get(n);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = (async () => {
    const i = await gh(['api', `repos/${REPO}/issues/${n}`]).then(JSON.parse, (e) => (/HTTP 404|Not Found/.test(e.stderr) ? null : Promise.reject(e)));
    const labels = (i?.labels || []).map((l) => l.name);
    if (!i || i.pull_request || !labels.includes('from-app') || i.user?.login?.toLowerCase() !== OWNER) return null;
    const replies = JSON.parse(await gh(['api', `repos/${REPO}/issues/${n}/comments?per_page=100`]))
      .filter((c) => c.user?.login?.toLowerCase() === OWNER && c.body?.trimStart().startsWith(MARK));
    const last = replies.at(-1);
    return {
      n: i.number, title: i.title.replace(/^\[(Problem|Suggestion)\]\s*/, ''), state: i.state,
      status: labels.find((l) => l.startsWith('status:'))?.slice(7) || (i.state === 'closed' ? 'closed' : 'received'),
      reply: last ? replyText(last.body) : null, reply_at: last?.created_at ?? null, reply_id: last?.id ?? null,
      fixed_in: replies.map((c) => /\bFixed in `?([0-9a-f]{7,40})\b/.exec(c.body)?.[1]).filter(Boolean).at(-1) ?? null,
      url: i.html_url, updated_at: i.updated_at,
    };
  })();
  cache.set(n, { at: Date.now(), p });
  p.catch(() => cache.delete(n));
  return p;
}

// GET /api/report/status?n=3,4 → { reports, refused (not from the app), failed (GitHub didn't answer) }
export async function reportStatus(url, res, json) {
  const ns = [...new Set(String(url.searchParams.get('n') || '').split(',').map(Number))].filter((n) => Number.isInteger(n) && n > 0 && n < 1e6).slice(0, 20);
  if (!(await ghReady())) return json(res, { error: 'Reporting isn’t set up on this receiver.' }, 503);
  const out = { reports: [], refused: [], failed: [] };
  (await Promise.allSettled(ns.map(issueStatus))).forEach((r, k) => {
    if (r.status === 'rejected') out.failed.push(ns[k]);
    else if (!r.value) out.refused.push(ns[k]);
    else { const { reply_id, ...shown } = r.value; out.reports.push(shown); }
  });
  return json(res, out);
}

const short = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
// Every POLL_MS: a reporter's browser hears when its report's status or latest reply changes; owners hear when a fix is ready.
let polling = false;
export async function pollReports() {
  if (!pushReady || polling) return;
  db.prepare('DELETE FROM report_watch WHERE endpoint NOT IN (SELECT endpoint FROM push_subs)').run(); // browsers that unsubscribed
  const rows = db.prepare('SELECT * FROM report_watch').all();
  const owners = ownerSubIds();
  if ((!rows.length && !owners.length) || !(await ghReady())) return;
  polling = true;
  try {
    for (const n of new Set(rows.map((r) => r.issue))) {
      const s = await issueStatus(n).catch(() => undefined);
      if (s === undefined) continue; // GitHub didn't answer: next time
      for (const r of rows.filter((x) => x.issue === n)) {
        if (s && s.status === r.last_status && s.reply_id === r.last_reply_id) continue;
        if (s) await pushToEndpoint(r.endpoint, { title: `Your report #${n}: ${STATUS[s.status] || s.status} — ${short(s.title, 60)}`, body: s.reply && s.reply_id !== r.last_reply_id ? short(s.reply.replace(/\s+/g, ' '), 160) : 'Tap to see it.', tag: `report-${n}`, url: '/?report=mine' });
        if (!s || s.state === 'closed') db.prepare('DELETE FROM report_watch WHERE issue = ? AND endpoint = ?').run(n, r.endpoint); // its last word
        else db.prepare('UPDATE report_watch SET last_status = ?, last_reply_id = ? WHERE issue = ? AND endpoint = ?').run(s.status, s.reply_id, n, r.endpoint);
      }
    }
    if (owners.length) {
      const ready = JSON.parse(await gh(['issue', 'list', '-R', REPO, '--label', 'status:ready', '--state', 'open', '--json', 'number,title,url', '--limit', '50']));
      const told = new Set(db.prepare('SELECT issue FROM report_ready').all().map((r) => r.issue));
      for (const i of ready.filter((x) => !told.has(x.number))) {
        for (const id of owners) await pushTo(id, { title: `Fix for #${i.number} is ready — add the ship label to deploy`, body: short(i.title, 120), tag: `ready-${i.number}`, url: i.url });
        db.prepare('INSERT OR IGNORE INTO report_ready (issue, at) VALUES (?, ?)').run(i.number, new Date().toISOString());
      }
      db.prepare(`DELETE FROM report_ready WHERE issue NOT IN (${ready.map((x) => Number(x.number)).join(',') || 0})`).run(); // ready again later → told again
    }
  } catch (e) {
    console.log(`[report] poll: ${String(e.stderr || e.message).slice(0, 200)}`);
  } finally {
    polling = false;
  }
}
setInterval(pollReports, POLL_MS).unref(); // the server keeps the process alive, not this
