// What's new: the server's git history (newest first, by day), then the hand-written "Before release" list.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REPO = 'https://github.com/iamneilroberts/squelch';
const text = (s) => esc(s).replace(/(^|[^&\w])#(\d+)\b/g, `$1<a href="${REPO}/issues/$2" target="_blank" rel="noopener">#$2</a>`);
const docsOnly = (c) => /^(Manual|README)\b/.test(c.subject);
let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
function dayLabel(iso) {
  const key = dayKey(iso), now = Date.now();
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 864e5)) return 'Yesterday';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

const sha = (c) => `<a class="sha" href="${REPO}/commit/${c.sha}" target="_blank" rel="noopener">${esc(c.short)}</a>`;
const entry = (c) => `<li class="chg">${c.body
  ? `<details><summary>${text(c.subject)}</summary><p>${text(c.body)}</p></details>`
  : `<div class="chg-line">${text(c.subject)}</div>`}${sha(c)}</li>`;

function render(list) {
  const days = [];
  for (const c of list) {
    const k = dayKey(c.date);
    if (days.at(-1)?.k !== k) days.push({ k, label: dayLabel(c.date), items: [], docs: [] });
    days.at(-1)[docsOnly(c) ? 'docs' : 'items'].push(c);
  }
  return days.map((d) => `<section class="chg-day"><h3>${esc(d.label)}</h3><ul class="chg-list">${d.items.map(entry).join('')}</ul>${d.docs.length
    ? `<details class="chg-docs"><summary>${d.items.length ? 'and docs' : 'Docs'} <span class="na">(${d.docs.length})</span></summary><ul class="chg-list">${d.docs.map(entry).join('')}</ul></details>` : ''}</section>`).join('');
}

function renderHistory(h) {
  return `<section class="chg-day chg-before"><h3>${esc(h.title)}</h3><p class="na">${esc(h.note)}</p><ul class="chg-list">${h.entries.map((e) => `<li class="chg"><div class="chg-line"><b>${esc(e.title)}</b><br>${esc(e.body)}</div></li>`).join('')}</ul></section>`;
}

const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
try { TZ = (await get('/api/config')).station?.timezone || TZ; } catch { /* the browser's zone */ }
const [live, history] = await Promise.all([get('/api/changes?limit=200').catch(() => ({ changes: [] })), get('/changes-history.json').catch(() => null)]);
$('changes-list').innerHTML = (live.changes.length ? render(live.changes) : '<p class="na">The change list isn’t available on this install.</p>') + (history ? renderHistory(history) : '');
