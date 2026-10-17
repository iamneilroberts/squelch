// Squelch — client.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Engraved key symbols. Inline SVG, so phones can't swap in colour emoji for ▶ and friends.
const ICON_ARROW = '<svg class="ico arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 8.5l5-5M4.5 3.5h4v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // ↗ — iOS turns the character into a blue emoji
const ICON_PLAY = '<svg class="ico" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z"/></svg>';
let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // replaced by the station's time zone at boot
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const longDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const BANDS = [
  { id: 'police', label: 'Law', key: 'Law' },
  { id: 'fire', label: 'Fire · EMS', key: 'Fire' },
  { id: 'air', label: 'Aviation', key: 'Air' },
  { id: 'marine', label: 'Marine', key: 'Marine' },
  { id: 'rail', label: 'Rail', key: 'Rail' },
  { id: 'weather', label: 'Wx', key: 'Wx' },
  { id: 'ham', label: 'Ham', key: 'Ham' },
];
const GLYPH = { fire: 'F', medical: '+', crash: 'C', rescue: 'R', hazmat: 'H', police: 'P', aviation: 'A', marine: 'M', rail: 'RR', weather: 'W', other: '•' };

const state = {
  regions: [],
  sources: [],
  byId: new Map(),
  incidents: new Map(),
  calls: [],
  digests: [],
  digest: null,
  digestBusy: false,
  region: 'all',
  bands: new Set((() => { try { return JSON.parse(store.get('pcm.bands') || '[]'); } catch { return []; } })()), // empty = All
  tab: 'stories',
  stories: new Map(), // thread id → story, with its transmission count and newest transmission (last)
  tuned: null,
  selected: null,
  fresh: new Set(),
};

const regionOf = (sourceId) => state.byId.get(sourceId)?.region;
const inRegion = (sourceId) => state.region === 'all' || regionOf(sourceId) === state.region;
const bandOn = (band) => !state.bands.size || state.bands.has(band);
const inView = (sourceId) => inRegion(sourceId) && bandOn(state.byId.get(sourceId)?.band);
const visibleSources = () => state.sources.filter((s) => inRegion(s.id));

/* ───────── Location selector ───────── */
function buildSelector() {
  const positions = [{ id: 'all', short: 'All' }, ...state.regions];
  // More positions need a wider arc and a longer radius so neighbouring labels clear each other.
  const spread = positions.length > 4 ? 80 : positions.length > 3 ? 75 : 50;
  $('selector').classList.toggle('wide', positions.length > 4);
  const step = positions.length > 1 ? (spread * 2) / (positions.length - 1) : 0;
  positions.forEach((p, i) => { p.angle = -spread + i * step; });
  $('selector').innerHTML = positions.map((p) =>
    `<button class="sel-pos" role="radio" data-region="${p.id}" style="--a:${p.angle}deg" aria-checked="false">${esc(p.short)}</button>`).join('') +
    '<span class="chicken" id="chicken"></span>';
  $('selector').addEventListener('click', (e) => {
    const b = e.target.closest('.sel-pos');
    if (b) setRegion(b.dataset.region);
  });
  state.positions = positions;
}

function setRegion(id, { fly = true } = {}) {
  if (!state.positions.some((p) => p.id === id)) id = 'all';
  state.region = id;
  store.set('pcm.region', id);
  history.replaceState(null, '', id === 'all' ? location.pathname : `#${id}`);
  const pos = state.positions.find((p) => p.id === id);
  $('chicken').style.setProperty('--a', `${pos.angle}deg`);
  for (const b of $('selector').children) if (b.dataset.region) b.setAttribute('aria-checked', b.dataset.region === id);
  const region = state.regions.find((r) => r.id === id);
  $('badge-sub').textContent = region ? region.badge : state.station?.badge || '';
  if (state.bands.size && !visibleSources().some((s) => state.bands.has(s.band))) state.bands.clear();
  buildDial();
  renderLamps();
  renderIncidentMarkers();
  renderLog();
  if (fly) map.flyToBounds(regionBounds(), { duration: 0.9, padding: [20, 20] });
  refreshOverlays();
  if (state.tab === 'digest') loadDigest();
}

function regionBounds() {
  const list = state.region === 'all' ? state.regions : state.regions.filter((r) => r.id === state.region);
  return L.latLngBounds(list.flatMap((r) => [[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]]));
}

/* ───────── Dial ───────── */
function buildDial() {
  const sources = visibleSources();
  const present = BANDS.filter((b) => sources.some((s) => s.band === b.id));
  const order = present.flatMap((b) => sources.filter((s) => s.band === b.id));
  const style = document.documentElement.dataset.dial;
  const tight = style === 'rule' && narrow.matches; // the phone's slide rule: names only, packed closer
  const SPAN = tight ? 66 : 90; // px of dial per station
  const sc = $('dial').parentElement;
  // The drum leaves half a window before the first station and after the last, so each can sit under its fixed needle.
  const GAP = tight ? 0 : 0.7, PAD = style === 'drum' ? Math.max(0.6, sc.clientWidth / 2 / SPAN) : 0.6;
  const total = PAD * 2 + order.length - 1 + GAP * (present.length - 1);
  let pos = PAD, prevBand = null;
  for (const s of order) {
    if (prevBand && prevBand !== s.band) pos += GAP;
    s.x = (pos / total) * 100;
    pos += 1;
    prevBand = s.band;
  }
  const half = 50 / total;
  // Every station gets at least ~90 px of dial (the widest label is ~85 px), so labels never collide;
  // when that's wider than the window the dial scrolls (with edge fades as the cue).
  $('dial').style.minWidth = `${Math.max(tight ? 0 : 640, Math.round(total * SPAN))}px`;
  requestAnimationFrame(() => {
    sc.classList.toggle('scrolls', sc.scrollWidth > sc.clientWidth + 4);
  });

  $('dial-bands').innerHTML = present.map((b) => {
    const xs = order.filter((s) => s.band === b.id).map((s) => s.x);
    const left = Math.min(...xs) - half * 0.9, right = Math.max(...xs) + half * 0.9;
    return `<span class="dial-band" data-band="${b.id}" style="left:${left}%;width:${right - left}%">${b.label}</span>`;
  }).join('');

  // Grouped by band: on a phone the groups become rows of preset keys (app.css); on a wide screen
  // they vanish (display: contents) and each station sits at its place on the slide rule.
  const key = (s) => `
    <button class="station ${playable(s) ? '' : 'link'} ${bandOn(s.band) ? '' : 'dimmed'} ${scan.lockouts.has(s.id) ? 'locked' : ''} ${scan.priority.has(s.id) ? 'pri' : ''}" data-id="${s.id}" style="left:${s.x}%"
      aria-pressed="${state.tuned?.id === s.id}" title="${esc(s.name)} — ${esc(s.coverage)}">
      <span class="station-freq">${esc(s.dial || '')}</span>
      <span class="station-name">${esc(s.short)}</span>
    </button>`;
  $('dial-stations').innerHTML = present.map((b) =>
    `<div class="dial-group" data-band="${b.id}"><span class="dial-group-label">${b.label}</span>${order.filter((s) => s.band === b.id).map(key).join('')}</div>`).join('');
  $('chbar-lamps').innerHTML = present.map((b) =>
    `<span class="chbar-group" data-band="${b.id}"><span>${order.filter((s) => s.band === b.id).map((s) => `<i data-id="${s.id}"></i>`).join('')}</span><small>${b.key}</small></span>`).join('');
  renderBar();

  $('keys').innerHTML = [{ id: 'all', key: 'All' }, ...present].map((b) =>
    `<button class="key" data-band="${b.id}" aria-pressed="${b.id === 'all' ? !state.bands.size : state.bands.has(b.id)}">${b.key}</button>`).join('');
  moveNeedle(state.tuned && order.includes(state.tuned) ? state.tuned : order[0]);
  scanSync(); // the location changed what's scanned
}

$('dial-stations').addEventListener('click', (e) => {
  const b = e.target.closest('.station');
  if (!b) return;
  if (scan.on) cycleStation(b.dataset.id); // while scanning, a tap cycles normal → PRI → L/O
  else tune(state.byId.get(b.dataset.id));
});
$('keys').addEventListener('click', (e) => {
  const k = e.target.closest('.key');
  if (!k) return;
  // Band keys add up (Law + Fire, say); All clears them, and picking every band is the same as All.
  const band = k.dataset.band, keys = [...$('keys').children].filter((el) => el.dataset.band !== 'all');
  if (band === 'all') state.bands.clear();
  else if (!state.bands.delete(band)) state.bands.add(band);
  if (state.bands.size === keys.length) state.bands.clear();
  store.set('pcm.bands', JSON.stringify([...state.bands]));
  for (const el of $('keys').children) el.setAttribute('aria-pressed', el.dataset.band === 'all' ? !state.bands.size : state.bands.has(el.dataset.band));
  for (const el of $('dial-stations').querySelectorAll('.station')) {
    el.classList.toggle('dimmed', !bandOn(state.byId.get(el.dataset.id).band));
  }
  renderBar();
  renderLog();
  renderIncidentMarkers();
  scanSync();
});

function moveNeedle(s, { scroll = true } = {}) {
  if (!s || s.x == null) return;
  const dial = $('dial');
  const px = (s.x / 100) * dial.clientWidth;
  dial.style.setProperty('--needle-px', `${px}px`);
  dial.style.setProperty('--needle-x', `${s.x}%`);
  for (const b of dial.querySelectorAll('.station')) b.classList.toggle('at', b.dataset.id === s.id); // the phone's preset keys show the needle this way
  // On a scrolling (phone-width) dial, keep the tuned station in view.
  const scroller = dial.parentElement;
  if (scroll && scroller.scrollWidth > scroller.clientWidth + 4) {
    scroller.scrollTo({ left: Math.max(0, px - scroller.clientWidth / 2), behavior: 'smooth' });
  }
}
addEventListener('resize', () => moveNeedle(state.tuned || visibleSources().find((s) => s.x != null)));

/* ───────── Look: how the receiver is drawn, remembered per device. The tuning dial is the first choice;
   later skins join it in the same panel. ───────── */
const narrow = matchMedia('(max-width: 720px)');
function applyDialStyle() {
  const pick = store.get('pcm.dial') || 'auto';
  document.documentElement.dataset.dial = pick === 'auto' ? (narrow.matches || document.documentElement.dataset.skin === 'lcd' ? 'bar' : 'rule') : pick; // the LCD skin's window is the channel bar
  if (state.byId.size) buildDial();
}
applyDialStyle();
narrow.addEventListener('change', applyDialStyle);
/* The skin: Classic, or LCD with a choice of backlight and (on a wide screen) of layout. index.html sets the
   attributes before first paint; these keep them in step with the Look card. Auto backlight is blue by day and
   red from sunset to sunrise at the station. */
const LOOK = { 'dial-style': ['pcm.dial', 'auto'], skin: ['pcm.skin', 'classic'], backlight: ['pcm.backlight', 'auto'], 'wide-layout': ['pcm.wideLayout', 'lcd'] };
const html = document.documentElement;
const { sunIsUp, stationLatLng: whereIs } = window.pcmSkin; // skin-boot.js (loaded in <head>) holds the sun maths, shared with the manual
const stationLatLng = () => whereIs(state.regions);
function applyLook() {
  html.dataset.skin = store.get('pcm.skin') === 'lcd' ? 'lcd' : 'classic';
  html.dataset.wide = store.get('pcm.wideLayout') === 'base' ? 'base' : 'lcd';
  const pick = store.get('pcm.backlight') || 'auto', where = stationLatLng();
  const auto = where ? (sunIsUp(...where) ? 'blue' : 'red') : store.get('pcm.autoLight'); // until the config arrives, last time's answer
  if (where) window.pcmSkin.setWhere(where);
  if (auto) store.set('pcm.autoLight', auto);
  html.dataset.backlight = ['blue', 'night', 'red', 'daylight'].includes(pick) ? pick : auto || html.dataset.backlight;
  document.querySelector('meta[name="theme-color"]').content = html.dataset.skin === 'lcd' ? '#141518' : '#5a3a22';
  applyDialStyle();
}
setInterval(applyLook, 60e3);
$('btn-look').addEventListener('click', () => {
  for (const [name, [key, dflt]] of Object.entries(LOOK)) for (const r of document.querySelectorAll(`[name="${name}"]`)) r.checked = r.value === (store.get(key) || dflt);
  $('look').showModal();
});
$('look').addEventListener('change', (e) => {
  if (!LOOK[e.target.name]) return;
  store.set(LOOK[e.target.name][0], e.target.value);
  applyLook();
});
// LCD skin: the volume keys, and the base unit's scroll knob (Scan, then Hold / Resume)
document.addEventListener('click', (e) => {
  const step = e.target.closest('.vol-step');
  if (step) {
    const v = $('volume');
    v.value = Math.max(0, Math.min(11, Number(v.value) + Number(step.dataset.step)));
    v.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (e.target.closest('#scroll-knob')) { // not scanning: start; scanning: hold or resume (once something has played)
    if ($('btn-scan').getAttribute('aria-pressed') !== 'true') $('btn-scan').click();
    else if (!$('btn-hold').disabled) $('btn-hold').click();
  }
});
// A dot on Look and on its What's new link until the newest change has been opened (the manual's What's new tab saves it).
fetch('/api/changes?limit=1').then((r) => r.json()).then((j) => {
  if (j.head && store.get('pcm.changesSeen') !== j.head) for (const el of document.querySelectorAll('.changes-open, #btn-look')) el.classList.add('has-changes');
}).catch(() => {});
$('look-close').addEventListener('click', () => $('look').close());
$('look').addEventListener('click', (e) => { if (e.target === $('look')) $('look').close(); }); // tap on the backdrop

/* ───────── Problems & suggestions: files a GitHub issue through the server. Without gh there, offers a prefilled new-issue link. ───────── */
let reportInfo = null;
async function openReport(mine = false) {
  $('look').close();
  $('report-msg').innerHTML = '';
  $('report-send').hidden = false;
  renderMyReports();
  $('report').showModal();
  if (mine && !$('my-reports').hidden) $('my-reports').scrollIntoView({ block: 'start' });
  reportInfo ??= await getJson('/api/report').catch(() => null);
  await refreshReports();
  renderMyReports({ seen: true });
}
const reportContext = () => ({
  viewport: `${innerWidth}x${innerHeight}`, ua: navigator.userAgent, tab: state.tab, scan: scan.on,
  dial: document.documentElement.dataset.dial,
  story: $('story').open && storyId ? { id: storyId, subject: state.stories.get(storyId)?.subject } : null,
});
function reportFallback(type, text, ctx) {
  const repo = reportInfo?.repo || 'iamneilroberts/squelch';
  const body = `${text}${ctx ? `\n\n---\n${Object.entries({ viewport: ctx.viewport, browser: ctx.ua, tab: ctx.tab, scan: ctx.scan ? 'on' : 'off', dial: ctx.dial }).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}`.replace(/@/g, '＠');
  const q = new URLSearchParams({ title: `[${type === 'suggestion' ? 'Suggestion' : 'Problem'}] ${text.replace(/\s+/g, ' ').slice(0, 70)}`, body });
  return `<a href="https://github.com/${esc(repo)}/issues/new?${esc(q)}" target="_blank" rel="noopener">Open it on GitHub to send it yourself ↗</a>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('.report-open')) openReport(); });
$('report-close').addEventListener('click', () => $('report').close());
$('report').addEventListener('click', (e) => { if (e.target === $('report')) $('report').close(); });
$('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.querySelector('[name="report-type"]:checked').value, text = $('report-text').value.trim();
  const ctx = $('report-ctx').checked ? reportContext() : null, msg = $('report-msg');
  if (reportInfo && !reportInfo.ready) return void (msg.innerHTML = `Sending from here isn’t set up. ${reportFallback(type, text, ctx)}`);
  $('report-send').disabled = true;
  msg.textContent = 'Sending…';
  // With this browser's push endpoint, the receiver can notify it when the report's status or reply changes.
  const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, text, context: ctx, website: $('report-hp').value, endpoint: notify.sub?.endpoint }) })
    .then(async (x) => ({ ok: x.ok, ...(await x.json().catch(() => ({}))) })).catch(() => ({ error: 'Couldn’t reach the receiver.' }));
  $('report-send').disabled = false;
  if (r.ok && r.url) {
    const n = r.url.match(/\/(\d+)$/)?.[1];
    msg.innerHTML = `Thanks: filed as <a href="${esc(r.url)}" target="_blank" rel="noopener">${n ? `#${esc(n)}` : 'the issue'}</a>.`;
    $('report-text').value = '';
    $('report-send').hidden = true;
    if (r.number) {
      storeJson('pcm.reports', [...myReports().filter((x) => x.n !== r.number), { n: r.number, title: text.replace(/\s+/g, ' ').slice(0, 70), at: new Date().toISOString() }].slice(-30));
      storeJson('pcm.reportsSeen', { ...readJson('pcm.reportsSeen', {}), [r.number]: 'received|' });
      renderMyReports();
    }
  } else msg.innerHTML = `${esc(r.error || 'Couldn’t send that.')}${r.fallback ? ` ${reportFallback(type, text, ctx)}` : ''}`;
});
if (new URLSearchParams(location.search).has('report')) { // the manual's link, or a report notification (?report=mine)
  const mine = new URLSearchParams(location.search).get('report') === 'mine';
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => openReport(mine)); // once the rest of this file has run
}

/* My reports: this device's reports (pcm.reports), with their status and the owner's latest reply. A dot on
   "Problems & suggestions" and the Look key says something changed since the list was last seen (pcm.reportsSeen). */
const REPORT_STATUS = { received: 'Received', planned: 'Planned', 'in-progress': 'In progress', ready: 'Fix ready', fixed: 'Fixed', 'wont-do': 'Won’t do', 'needs-info': 'Needs info', closed: 'Closed' };
const readJson = (k, empty) => { try { return JSON.parse(store.get(k)) ?? empty; } catch { return empty; } };
const storeJson = (k, v) => store.set(k, JSON.stringify(v));
const myReports = () => readJson('pcm.reports', []).filter((x) => Number.isInteger(x?.n));
const reportSig = (s) => `${s.status}|${s.reply_at || ''}`;
const reportStatus = new Map(); // n → the server's view of it
let reportsAt = 0;
async function refreshReports() {
  const mine = myReports();
  if (!mine.length) return;
  const r = await getJson(`/api/report/status?n=${mine.map((x) => x.n).join(',')}`).catch(() => null);
  for (const s of r?.reports || []) reportStatus.set(s.n, s);
  reportsAt = Date.now();
  const seen = readJson('pcm.reportsSeen', {});
  const news = [...reportStatus.values()].some((s) => seen[s.n] !== reportSig(s));
  for (const el of document.querySelectorAll('.report-open, #btn-look')) el.classList.toggle('has-news', news);
}
const when = (iso) => (Date.now() - Date.parse(iso) < 864e5 ? ago(iso) : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
function renderMyReports({ seen: markSeen = false } = {}) {
  const mine = myReports().reverse(); // newest first
  $('my-reports').hidden = !mine.length;
  if (!mine.length) return;
  const seen = readJson('pcm.reportsSeen', {});
  $('my-reports-hint').textContent = notify.status?.sub ? 'Sent from this device. You’ll get a notification when one changes.'
    : notify.status?.allowed ? 'Sent from this device. Turn on notifications (the bell) to hear when one changes.' : 'Sent from this device.';
  $('report-list').innerHTML = mine.map((m) => {
    const s = reportStatus.get(m.n);
    const status = s?.status || 'received';
    return `<li class="report-item${s && seen[m.n] !== reportSig(s) ? ' is-new' : ''}">
      <div class="report-line"><span class="report-chip" data-status="${esc(status)}">${esc(REPORT_STATUS[status] || status)}</span> <strong>#${m.n}</strong> ${esc(s?.title || m.title)}</div>
      ${s?.reply ? `<blockquote class="report-reply">${esc(s.reply)}<footer>Reply · ${esc(when(s.reply_at))}</footer></blockquote>` : ''}
      <a class="report-link" href="${esc(s?.url || `https://github.com/${reportInfo?.repo || 'iamneilroberts/squelch'}/issues/${m.n}`)}" target="_blank" rel="noopener">#${m.n} on GitHub ${ICON_ARROW}</a>
    </li>`;
  }).join('');
  if (markSeen && reportStatus.size) {
    storeJson('pcm.reportsSeen', { ...seen, ...Object.fromEntries([...reportStatus.values()].map((s) => [s.n, reportSig(s)])) });
    for (const el of document.querySelectorAll('.has-news')) el.classList.remove('has-news');
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - reportsAt > 5 * 60e3) refreshReports(); });

/* ───────── Channel bar (a phone's dial): what's on, and a lamp per channel; tap it for the preset keys ───────── */
const TRAFFIC_MS = 3 * 60e3; // a lamp stays lit this long after its channel's last transmission
function renderBar() {
  const heard = new Map(); // channel → its newest transmission (state.calls is newest first)
  for (const c of state.calls) if (!heard.has(c.source_id)) heard.set(c.source_id, Date.parse(c.at));
  const air = scan.on ? scan.shown && scan.current : state.tuned?.id || onAirCall?.source_id;
  let lit = 0, first = 0, skipped = 0;
  for (const el of $('chbar-lamps').querySelectorAll('i')) {
    const id = el.dataset.id, on = Date.now() - (heard.get(id) || 0) < TRAFFIC_MS;
    lit += el.classList.toggle('lit', on);
    first += el.classList.toggle('pri', scan.priority.has(id));
    skipped += el.classList.toggle('locked', scan.lockouts.has(id));
    el.classList.toggle('air', id === air);
    el.classList.toggle('dimmed', !bandOn(state.byId.get(id)?.band));
  }
  const s = state.byId.get(air), n = scanChannels().length;
  $('chbar-now').innerHTML = s ? `▸ <strong>${esc(s.short)}</strong> ${esc(s.dial || '')}`
    : scan.on ? `<strong>SCANNING</strong> ${n} channel${n === 1 ? '' : 's'}` : '<strong>Off</strong> · tap to pick a channel';
  $('chbar-mode').textContent = scan.on && s ? (scan.hold ? 'HOLD' : `SCAN ${n} ch`) : '';
  // The LCD skin's readout: state, channel, its dial label, and where and what it is.
  const band = BANDS.find((b) => b.id === s?.band), region = state.regions.find((r) => r.id === s?.region);
  $('lcd-state').textContent = scan.on ? (scan.hold ? 'HOLD' : 'SCAN') : s ? 'LIVE' : 'OFF';
  $('lcd-svc').textContent = scan.on && !scan.hold ? `${n} CH` : '';
  $('lcd-name').textContent = s ? s.short : scan.on ? 'SCANNING' : 'OFF AIR';
  $('lcd-freq').textContent = s?.dial || '';
  $('lcd-kind').textContent = s ? (playable(s) ? 'STREAM' : 'LINK') : '';
  $('lcd-loc').textContent = region ? `LOC: ${region.short}` : '';
  $('lcd-sig').textContent = band ? `SVC: ${band.key}` : '';
  $('chbar-sum').textContent = [`${lit} channel${lit === 1 ? '' : 's'} with traffic`, first && `${first} first`, skipped && `${skipped} skipped`].filter(Boolean).join(', ');
}
$('chbar').addEventListener('click', () => $('chbar').setAttribute('aria-expanded', $('chbar').getAttribute('aria-expanded') !== 'true'));

/* ───────── Audio ───────── */
const radio = $('radio');
radio.volume = 0.7;
let tuneTimer = null;

// Live audio comes through the scanner server (/listen/…), which adds a Broadcastify login — so no
// browser sign-in prompt. The owner/LAN use the receiver's account; anyone else signs in with their own.
const playable = (s) => Boolean(s.streamUrl && state.viewer?.canListen);

function tune(s) {
  const buttons = [...$('dial-stations').querySelectorAll('.station')];
  if (state.tuned === s && !radio.paused) return powerOff();
  state.tuned = s;
  moveNeedle(s);
  buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === s.id));
  renderBar();
  if (!playable(s)) {
    radio.pause();
    radio.removeAttribute('src');
    radio.load();
    setLit(false);
    const page = `<a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">listen on ${s.listenUrl.includes('broadcastify') ? 'Broadcastify' : 'the feed’s page'} ${ICON_ARROW}</a>`;
    $('now-playing').innerHTML = s.streamUrl
      ? `<strong>${esc(s.short)}</strong> — ${page}, or <button type="button" class="linkish" id="bcfy-open">listen here with your Broadcastify Premium login</button>`
      : `<strong>${esc(s.short)}</strong> — ${page}`;
    return;
  }
  $('now-playing').innerHTML = `Tuning <strong>${esc(s.short)}</strong>…`;
  radio.querySelectorAll('track').forEach((t) => t.remove());
  radio.src = `/listen/${encodeURIComponent(s.id)}`;
  radio.dataset.kind = 'live';
  ccLive();
  radio.play().catch(() => {});
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(() => {
    if (state.tuned === s && radio.paused) { radio.pause(); noSignal(s); }
  }, 12e3);
}

function noSignal(s) {
  setLit(false);
  $('now-playing').innerHTML = s
    ? `No signal from <strong>${esc(s.short)}</strong>. The direct stream didn't answer — <a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">listen on the feed's page ${ICON_ARROW}</a>`
    : 'That recording has expired.';
}

function powerOff() {
  stopScan();
  clearTimeout(tuneTimer);
  playlist = [];
  radio.pause();
  radio.removeAttribute('src');
  radio.load(); // drop the connection to a live stream instead of buffering it in the background
  state.tuned = null;
  for (const b of $('dial-stations').querySelectorAll('.station')) b.setAttribute('aria-pressed', 'false');
  renderBar();
  setLit(false);
  $('now-playing').textContent = 'Off the air. Tune a station on the dial to listen live.';
  ccIdle();
  syncTransport();
}

// rest: recordings to play after this one (a story's Play all); any other playback drops them.
let playlist = [];
function playRecording(src, label, kind = 'clip', rest = []) {
  if (kind === 'clip') stopScan(); // playing one recording by hand ends a scan
  playlist = rest;
  state.tuned = null;
  clearTimeout(tuneTimer);
  ccLoad(src);
  radio.src = src;
  radio.dataset.kind = kind;
  radio.dataset.label = label;
  radio.play().catch((e) => { if (e.name === 'NotAllowedError') awaitTap(); });
}

// Browsers won't start sound before the visitor touches the page. The page opens scanning, so the
// first transmission waits here, and the first tap or key anywhere starts it. Only the latest wait
// counts: a story opened from a link replaces the scan the page opened with.
let tapWait = null;
function awaitTap(start = () => { if (radio.getAttribute('src') && radio.paused) radio.play().catch(() => {}); }) {
  $('now-playing').innerHTML = radio.dataset.kind === 'clip'
    ? `<strong>${esc(radio.dataset.label || 'Recording')}</strong> · <strong>tap anywhere to play</strong>`
    : '<strong>SCAN</strong> · traffic waiting — <strong>tap anywhere to listen</strong>';
  const go = () => {
    removeEventListener('pointerdown', go, true);
    removeEventListener('keydown', go, true);
    if (tapWait === go) tapWait = null;
    start();
  };
  if (tapWait) { removeEventListener('pointerdown', tapWait, true); removeEventListener('keydown', tapWait, true); }
  tapWait = go;
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}

/* ───────── Closed captions ─────────
   A recording carries a WebVTT track (/api/captions/<clip>.vtt) whose cues the server lays over the
   clip's voiced stretches, so text rolls up with playback, pause and seek. Each transmission is one
   paragraph that starts with its source tag; earlier ones stay above, faded, until they scroll off.
   A live stream has no clip yet: the strip shows that channel's transcripts as they arrive. */
const CC_ROWS = 3;
let ccPast = []; // earlier transmissions still on screen: [{ id, words }]
let ccCur = null; // the recording being captioned: { id, words } as of the last sync
let ccOffset = 0; // where that recording starts on the player's clock (inside the scan stream; 0 for a file)
let ccShown = []; // segments last drawn, for redrawing on resize

// Source tags: band icon + code, e.g. ✈ ATC. Icons: Lucide 1.58.0 (ISC licence, lucide.dev).
const CC_BANDS = {
  police: ['LAW', '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'],
  fire: ['FIRE', '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>'],
  air: ['ATC', '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'],
  marine: ['MAR', '<path d="M12 6v16"/><path d="m19 13 2-1a9 9 0 0 1-18 0l2 1"/><path d="M9 11h6"/><circle cx="12" cy="4" r="2"/>'],
  rail: ['RAIL', '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>'],
  weather: ['WX', '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>'],
  ham: ['HAM', '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>'],
};
function ccTag(id) {
  const s = state.byId.get(id);
  const b = s && CC_BANDS[s.band];
  return b ? `<span class="cc-src" data-band="${s.band}"><svg viewBox="0 0 24 24" aria-hidden="true">${b[1]}</svg>${b[0]}</span>` : '';
}
// Paragraph prefix: source tag + station; tapping it opens that transmission's story.
function ccWho(id, thread) {
  if (!state.byId.has(id)) return '&gt;&gt; ';
  const who = `${ccTag(id)} ${shortOf(id)}:`;
  return `${thread ? `<a href="#" class="cc-who" data-thread="${thread}">${who}</a>` : who} `;
}
const callByAudio = (name) => state.calls.find((c) => c.audio === name);
// A transmission's story, looked up when needed: a scanned one goes on air before its story is assigned.
const ccThread = (seg) => (seg.audio && callByAudio(seg.audio)?.thread_id) || seg.thread;
const ccSet = (html) => { $('cc-text').innerHTML = html; };
const ccOff = () => !state.viewer?.transcripts;
const ccWords = (text) => String(text || '').split(/\s+/).filter(Boolean);

function ccIdle() {
  ccPast = [];
  ccCur = null;
  ccShown = [];
  ccSet(`<p class="cc-line cc-note">${ccOff() ? 'Captions are off — transcripts are private on this receiver.' : 'Captions appear here when traffic plays.'}</p>`);
}

// Rows a paragraph takes: the text is monospace, so the browser's line breaks can be predicted.
function ccRows(words, cols, indent) {
  let rows = 1, x = indent;
  words.forEach((w, i) => {
    const add = (i ? 1 : 0) + w.length;
    if (x + add > cols && x > 0) { rows++; x = w.length; } else x += add;
  });
  return rows;
}

// segs, oldest first: { id, words, now? (index of the first word of the cue being spoken), old? }.
// Fills the strip from the newest back; a paragraph that doesn't fit loses words from its front ("…"),
// so every visible transmission keeps its source tag.
function ccRender(segs) {
  ccShown = segs;
  const box = $('cc-text');
  const probe = document.createElement('span');
  probe.className = 'cc-probe';
  box.append(probe);
  probe.textContent = 'M'.repeat(20);
  const cw = probe.getBoundingClientRect().width / 20;
  const cols = Math.floor(box.clientWidth / cw);
  const out = [];
  let left = CC_ROWS;
  for (const [i, seg] of [...segs.entries()].reverse()) {
    if (left < 1 || !seg.words.length) continue;
    const thread = ccThread(seg);
    const cue = i === segs.length - 1 && thread ? ' <span class="cc-story">Story&nbsp;›</span>' : ''; // the whole strip opens the story
    probe.innerHTML = ccWho(seg.id, thread);
    const indent = Math.ceil(probe.getBoundingClientRect().width / cw);
    let from = 0;
    const words = () => [...(from ? ['…', ...seg.words.slice(from)] : seg.words), ...(cue ? ['Story ›··'] : [])];
    while (from < seg.words.length - 1 && ccRows(words(), cols, indent) > left) from++;
    left -= ccRows(words(), cols, indent);
    const now = seg.now ?? seg.words.length;
    const text = (a, b) => esc(seg.words.slice(Math.max(a, from), b).join(' '));
    out.unshift(`<p class="cc-line${seg.old ? ' cc-old' : ''}" data-seg="${i}">${ccWho(seg.id, thread)}${from ? '… ' : ''}${text(0, now)}${now < seg.words.length ? `${now > from ? ' ' : ''}<span class="cc-now">${text(now, seg.words.length)}</span>` : ''}${cue}</p>`);
  }
  probe.remove();
  ccSet(out.join(''));
}
addEventListener('resize', () => { if (ccShown.length) ccRender(ccShown); });
$('cc').addEventListener('click', (e) => {
  if (e.target.closest('[data-thread]')) return; // the source tag is a link already
  const seg = ccShown[e.target.closest('[data-seg]')?.dataset.seg ?? ccShown.length - 1];
  const thread = seg && ccThread(seg);
  if (thread) openStory(thread);
});

function ccLoad(src, offset = 0) {
  ccOffset = offset;
  if (ccCur?.words.length) ccPast = [...ccPast, ccCur].slice(-2);
  const name = decodeURIComponent(src).replace(/^\/audio\//, '');
  ccCur = { id: /^(.+)-\d+\.mp3$/.exec(name)?.[1] ?? null, audio: name, thread: callByAudio(name)?.thread_id, words: [] };
  radio.querySelectorAll('track').forEach((t) => t.remove());
  if (ccOff()) return ccIdle();
  if (!src.startsWith('/audio/')) return ccRender(ccPast.map((x) => ({ ...x, old: true })));
  const track = Object.assign(document.createElement('track'), { kind: 'captions', srclang: 'en', label: 'Transcript', src: `/api/captions/${src.slice(7)}.vtt`, default: true });
  track.addEventListener('load', ccSync);
  radio.append(track);
  track.track.mode = 'hidden'; // cues drive our strip, not the browser's overlay
}

function ccSync() {
  const kind = radio.dataset.kind;
  if (ccOff() || !ccCur || (kind !== 'clip' && kind !== 'scan')) return;
  const t = radio.currentTime - ccOffset;
  const cues = [...(radio.textTracks[0]?.cues || [])].filter((c) => c.startTime <= t);
  const spoken = cues.at(-1);
  const before = cues.slice(0, -1).flatMap((c) => ccWords(c.text));
  ccCur.words = [...before, ...ccWords(spoken?.text)];
  ccRender([...ccPast.map((x) => ({ ...x, old: true })), { ...ccCur, now: spoken && t < spoken.endTime ? before.length : undefined }]);
}
for (const ev of ['timeupdate', 'seeked']) radio.addEventListener(ev, ccSync);

// Live: the tuned channel's latest transcripts, newest last (they land about a minute behind the audio).
function ccLive() {
  const s = state.tuned;
  if (!s || radio.dataset.kind !== 'live') return;
  if (ccOff()) return ccIdle();
  const recent = state.calls.filter((c) => c.source_id === s.id && c.transcript).slice(0, 3).reverse();
  if (!recent.length) return ccSet(`<p class="cc-line cc-note">Captions for ${esc(s.short)} appear about a minute behind the audio.</p>`);
  ccRender(recent.map((c, i) => ({ id: s.id, audio: c.audio, thread: c.thread_id, words: ccWords(c.transcript), old: i < recent.length - 1 })));
}

radio.addEventListener('playing', () => {
  if (radio.dataset.kind === 'scan') { // the stream plays silence between transmissions
    scan.idle = false; // redraw: replaces "tap anywhere to listen"
    if (!scan.live) { scan.live = true; scanSync(); } // settings changed while connecting
    return scanShow();
  }
  setLit(true);
  if (radio.dataset.kind === 'clip') {
    const c = state.calls.find((x) => x.audio && radio.getAttribute('src') === `/audio/${encodeURIComponent(x.audio)}`);
    $('now-playing').innerHTML = c ? `${titleOf(c)}&nbsp;·&nbsp;${hhmm(c.at)}` : `Playing recording — <strong>${esc(radio.dataset.label)}</strong>`;
  } else if (state.tuned) {
    const s = state.tuned;
    $('now-playing').innerHTML = `Receiving <strong>${esc(s.short)}</strong> · ${esc(s.name)} · via <a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">Broadcastify ${ICON_ARROW}</a>`;
  }
});
radio.addEventListener('pause', () => setLit(false));
radio.addEventListener('ended', () => {
  setLit(false);
  if (radio.dataset.kind === 'scan') return scanReconnect(); // the server ended the stream (restarted)
  if (radio.dataset.kind !== 'clip') return;
  if (playlist.length) return playNext();
  const c = callByAudio(decodeURIComponent(radio.getAttribute('src') || '').replace(/^\/audio\//, ''));
  $('now-playing').innerHTML = `Finished — ${c ? titleOf(c) : `<strong>${esc(radio.dataset.label)}</strong>`}`;
});

/* ───────── Scan: play each new transmission from the chosen channels, back to back ─────────
   Channels = what the Location knob and band keys show, minus locked-out stations. While scanning,
   tapping a station cycles it normal → PRI (priority) → L/O (locked out) → normal.
   Like a real scanner: after each transmission the scan waits a moment on that channel (DELAY) so a
   reply follows and there's time to press HOLD; PREV walks back through channels it stopped on.
   Uses the recorded, squelched clips, so it only ever plays actual traffic — about a minute behind live. */
const DELAY_MS = 2500;
const loadSet = (key) => new Set((() => { try { return JSON.parse(store.get(key) || '[]'); } catch { return []; } })());
const scan = {
  on: false,
  sid: null,          // this page's scan on the server (src/scan.mjs)
  epoch: null,        // when the server started that scan's stream: a new one means the stream restarted under us
  plays: [],          // the server's announcements: where each transmission starts in the stream
  shown: null,        // the announcement on air now
  retry: null,
  stepper: null,
  live: false,        // the stream has played: the server has this scan, so it can be told of changes
  step: 0,
  current: null,      // channel of the transmission playing or just played
  idle: true,         // nothing playing and no delay running
  hold: null,         // channel id the scan is held on, or null
  history: [],        // channels the scan stopped on, oldest first
  back: 0,            // how many steps PREV has walked back
  last: new Map(),    // channel id → its most recent transmission (for PREV replay)
  catchup: null,      // thread id of the story Catch up is playing, or null
  asked: null,        // the same, from the tap until its first transmission is on air
  lockouts: loadSet('pcm.lockouts'),
  priority: loadSet('pcm.priority'),
};
const scanChannels = () => visibleSources().filter((s) => s.kind === 'stream'
  && bandOn(s.band) && !scan.lockouts.has(s.id)
  && (!scan.hold || s.id === scan.hold));
const shortOf = (id) => esc(state.byId.get(id)?.short || id);

function startScan() {
  if (state.tuned || radio.getAttribute('src')) powerOff();
  Object.assign(scan, { on: true, hold: null, history: [], back: 0, current: null, idle: true, shown: null, lastCall: null, catchup: null });
  $('dial').classList.add('scanning');
  syncScanKeys();
  scanIdle();
  scanConnect();
}

function stopScan() {
  if (!scan.on) return;
  clearTimeout(scan.retry);
  clearInterval(scan.stepper);
  Object.assign(scan, { on: false, stepper: null, hold: null, idle: true, sid: null, plays: [], shown: null });
  $('dial').classList.remove('scanning');
  syncScanKeys();
}

function syncScanKeys() {
  $('btn-scan').setAttribute('aria-pressed', scan.on);
  $('btn-hold').disabled = !scan.on || !scan.lastCall; // nothing to hold on until something has played
  $('btn-hold').setAttribute('aria-pressed', Boolean(scan.hold));
  $('btn-hold').textContent = scan.hold ? 'Resume' : 'Hold';
  $('btn-prev').disabled = !scan.on || scan.history.length < 1;
  $('btn-skip').disabled = !scan.on || !scan.shown;
  const k = $('btn-catchup'), story = catchupStory();
  k.disabled = !scan.on || !story;
  k.setAttribute('aria-pressed', Boolean(scan.catchup));
  k.innerHTML = scan.catchup ? '<span>Stop</span><span>catch-up</span>'
    : `<span>Catch up</span>${story && !k.disabled ? `<small>${shortOf(story.source)}</small>` : ''}`;
  k.title = scan.catchup ? 'Stop the catch-up and carry on scanning' : story ? `Hear the story so far: ${state.byId.get(story.source)?.short || story.source}: ${story.subject}` : 'Catch up: hear the story so far of the channel just heard';
  k.setAttribute('aria-label', k.title);
  renderBar();
}
// The story Catch up plays: the one running, else the story of the channel heard last.
function catchupStory() {
  const id = scan.catchup || scan.lastCall?.thread_id;
  if (!id) return null;
  const c = scan.lastCall?.thread_id === id ? scan.lastCall : null;
  const t = state.stories.get(id);
  return { id, source: t?.source_id || c?.source_id, subject: t?.subject || (c ? subjectOf(c) : '') };
}

// The scan's audio is one stream from the server (src/scan.mjs), so it keeps playing with a phone locked.
// The server picks each transmission and says where in the stream it starts ('scan' events); the page
// shows whatever the playback position has reached.
const pageId = Math.random().toString(36).slice(2, 10); // the server sends this page's scan announcements only here
const scanSettings = () => ({ channels: scanChannels().map((s) => s.id).join(','), pri: [...scan.priority].join(','), hold: scan.hold || '' });
function scanConnect() {
  clearTimeout(scan.retry);
  scan.sid = Math.random().toString(36).slice(2, 10);
  scan.epoch = null;
  scan.live = false;
  scan.plays = [];
  scan.shown = null;
  scan.skipped = false;
  playlist = [];
  radio.querySelectorAll('track').forEach((t) => t.remove());
  radio.src = `/scan/stream?${new URLSearchParams({ sid: scan.sid, page: pageId, ...scanSettings() })}`;
  radio.dataset.kind = 'scan';
  radio.play().then(() => { if (scan.on) scanIdle(); }).catch((e) => { // replaces "tap anywhere to listen"
    if (e.name !== 'NotAllowedError') return;
    radio.removeAttribute('src'); // don't let audio pile up behind the tap: connect fresh when it comes
    radio.load();
    awaitTap(scanConnect);
  });
}
function scanReconnect() {
  if (!scan.on) return;
  clearTimeout(scan.retry);
  scan.retry = setTimeout(scanConnect, 3000);
}
// Channels, priority or hold changed (or PREV wants a replay, or Catch up a story): tell the server's scan.
function scanSync(extra = {}) {
  if (scan.on && scan.sid && scan.live) {
    postJson(`/api/scan/${scan.sid}`, { ...scanSettings(), ...extra }).then((r) => {
      for (const q of extra.skip && r?.plays || []) { const x = scan.plays.find((y) => y.offset === q.offset); if (x) x.duration = q.duration; } // the skipped play now ends where the server cut it
    }).catch(() => {});
  }
}
// The browser re-requested the scan's stream by itself and the server started it over, so the stream's
// positions no longer match the page's: connect afresh.
function newEpoch(epoch) {
  if (!scan.epoch || scan.epoch === epoch) { scan.epoch = epoch; return false; }
  scanConnect();
  return true;
}
const resume = () => (scan.on && radio.dataset.kind === 'scan' ? scanConnect() : radio.play().catch(() => {}));

// As playback moves: what's on air at this point in the stream. A transmission, then DELAY_MS lingering
// on its channel (a reply plays straight away), then the idle search.
function scanShow() {
  if (!scan.on || radio.dataset.kind !== 'scan') return;
  const t = radio.currentTime;
  const p = scan.plays.findLast((x) => x.offset <= t + 0.05);
  const end = p ? p.offset + p.duration : 0;
  if (p && t < end) {
    if (scan.shown !== p) scanPlaying(p);
    return;
  }
  if (scan.shown) {
    scan.shown = null;
    syncScanKeys();
    setLit(false);
    onAirCall = null;
    showOnAir();
  }
  if (scan.asked || scan.skipped) return; // "Catching up · …" stays until the catch-up starts
  if (p && !scan.hold && t < end + DELAY_MS / 1000) {
    scan.idle = false;
    $('now-playing').innerHTML = `Next in ${Math.max(1, Math.ceil(end + DELAY_MS / 1000 - t))} s · ${titleOf(scan.lastCall || p.call)}`; // countdown first: a long title is cut off at two lines
  } else if (!scan.idle) scanIdle();
}
radio.addEventListener('timeupdate', scanShow);

function scanPlaying(p) {
  const c = state.calls.find((x) => x.id === p.call.id) ?? p.call; // the page's copy has the latest subject
  scan.shown = p;
  scan.asked = null;
  scan.skipped = false;
  clearInterval(scan.stepper);
  scan.stepper = null;
  scan.idle = false;
  scan.current = c.source_id;
  scan.last.set(c.source_id, c);
  // Catch up stays on from its key until its last transmission, through priority traffic and replays that
  // cut in. (Catch-up audio already in the stream's lead still plays after it's stopped, without relighting it.)
  const part = p.tag.match(/^CATCH UP (\d+)\/(\d+)$/);
  if (part && part[1] === part[2]) scan.catchup = null;
  if (p.tag !== 'REPLAY' && !part) {
    if (scan.history[scan.history.length - 1] !== c.source_id) scan.history.push(c.source_id);
    if (scan.history.length > 30) scan.history.shift();
    scan.back = 0;
  }
  scan.lastCall = c;
  syncScanKeys();
  moveNeedle(state.byId.get(c.source_id));
  setLit(true);
  scanTitle(p, c);
  ccLoad(`/audio/${encodeURIComponent(c.audio)}`, p.offset);
  showOnAir();
}
// Title line and lock screen for the transmission on air; again when its story arrives after it went on air.
function scanTitle(p, c) {
  $('now-playing').innerHTML = `${p.tag ? `${p.tag === 'PRI' ? 'FIRST' : p.tag} · ` : ''}${titleOf(c)}&nbsp;·&nbsp;${hhmm(c.at)}`;
  onAirCall = c;
  mediaMeta(c);
}

// Lock screen: what's on air, and a Play that reconnects a scan instead of resuming stale audio.
function mediaMeta(c) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: subjectOf(c), artist: state.byId.get(c.source_id)?.short || c.source_id, album: state.station?.script || 'Squelch' });
}
try {
  navigator.mediaSession?.setActionHandler('play', resume);
  navigator.mediaSession?.setActionHandler('pause', () => radio.pause());
  navigator.mediaSession?.setActionHandler('nexttrack', () => scanSkip());
} catch { /* this browser lacks one of them */ }

// Back from the lock screen or another app: the page missed the server's announcements while its
// timers were stopped, so fetch them.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !scan.on || !scan.sid || radio.paused) return;
  const r = await getJson(`/api/scan/${scan.sid}`).catch(() => null);
  if (!r?.plays) return scanReconnect();
  if (newEpoch(r.epoch)) return;
  scan.plays = r.plays;
  scanShow();
});

// Title line: what the conversation on this channel is about. The channel subject kept by the server
// (src/ai/subject.mjs), else the incident's headline, else the channel's last subject in the past 10 minutes.
function subjectOf(c) {
  const of = (x) => x.subject || state.incidents.get(x.incident_id)?.headline;
  if (of(c)) return of(c);
  const at = new Date(c.at);
  const prev = state.calls.find((p) => p.source_id === c.source_id && p.id !== c.id && new Date(p.at) < at && at - new Date(p.at) < 10 * 60e3 && of(p));
  return prev ? of(prev) : 'routine traffic';
}
function titleOf(c) {
  const t = `<strong>${shortOf(c.source_id)}</strong>: ${esc(subjectOf(c))}`;
  // A link, not a button: iOS lays buttons out as blocks, which breaks the line around it.
  return c.thread_id ? `<a href="#" class="story-link" data-thread="${c.thread_id}" title="This channel's story so far">${t}&nbsp;›</a>` : t;
}

// Nothing queued: step the needle across the scanned stations, like a real scanner searching.
function scanIdle() {
  scan.idle = true;
  setLit(false);
  const n = scanChannels().length;
  $('now-playing').innerHTML = scan.hold
    ? `<strong>HOLD</strong> · ${scan.last.has(scan.hold) ? titleOf(scan.last.get(scan.hold)) : shortOf(scan.hold)} · new traffic plays as it arrives · <strong>Resume</strong> to scan`
    : n
      ? `<strong>SCANNING</strong> ${n} channel${n === 1 ? '' : 's'} · ${scan.lastCall ? `last ${titleOf(scan.lastCall)}` : '<span class="scan-hint">tap a station once to put it first, again to skip it, again to reset</span>'}`
      : '<strong>SCAN</strong> — every channel here is skipped. Tap a station to bring it back.';
  if (scan.stepper || !n || scan.hold || matchMedia('(prefers-reduced-motion: reduce)').matches) return; // no sweeping needle
  scan.stepper = setInterval(() => {
    const list = scanChannels();
    if (list.length) moveNeedle(list[scan.step++ % list.length], { scroll: false });
  }, 320);
}

// Tap while scanning: normal → PRI → L/O → normal (remembered on this device).
function cycleStation(id) {
  if (scan.lockouts.has(id)) scan.lockouts.delete(id);
  else if (scan.priority.has(id)) { scan.priority.delete(id); scan.lockouts.add(id); }
  else scan.priority.add(id);
  store.set('pcm.lockouts', JSON.stringify([...scan.lockouts]));
  store.set('pcm.priority', JSON.stringify([...scan.priority]));
  const el = $('dial-stations').querySelector(`[data-id="${id}"]`);
  el?.classList.toggle('locked', scan.lockouts.has(id));
  el?.classList.toggle('pri', scan.priority.has(id));
  renderBar();
  scanSync();
  if (scan.idle) scanIdle();
}

function toggleHold() {
  if (!scan.on) return;
  scan.hold = scan.hold ? null : scan.current || scanChannels()[0]?.id || null;
  scan.back = 0;
  clearInterval(scan.stepper); // the idle search sweep would drag the needle off the held channel
  scan.stepper = null;
  syncScanKeys();
  scanSync();
  if (scan.hold) moveNeedle(state.byId.get(scan.hold));
  if (!scan.shown) scanIdle();
}

// PREV: each press goes one channel further back in the scan's history, holds there and replays
// that channel's most recent transmission.
function scanPrev() {
  if (!scan.on || !scan.history.length) return;
  scan.back = Math.min(scan.back + 1, scan.history.length - 1);
  const id = scan.history[scan.history.length - 1 - scan.back] ?? scan.history[0];
  scan.hold = id;
  clearInterval(scan.stepper);
  scan.stepper = null;
  syncScanKeys();
  const c = scan.last.get(id);
  scanSync(c ? { replay: c.id } : {});
  moveNeedle(state.byId.get(id));
  if (!c) scanIdle();
}

$('btn-scan').addEventListener('click', () => (scan.on ? powerOff() : startScan()));
$('btn-hold').addEventListener('click', toggleHold);
$('btn-skip').addEventListener('click', () => scanSkip());
$('btn-prev').addEventListener('click', scanPrev);

// Skip: drop the transmission on air and move on to the next (inside a catch-up, the next item of it).
function scanSkip() {
  if (!scan.on || !scan.shown) return;
  scan.skipped = true;
  $('now-playing').textContent = 'Skipped';
  scanSync({ skip: true });
}

// Catch up: the story of the transmission on air (or just played), its transmissions that added something
// played inside the scan stream, so it works with the phone locked; the story card opens to read along.
function scanCatchup() {
  if (!scan.on) return;
  const id = scan.catchup ? 0 : scan.lastCall?.thread_id;
  if (id === undefined || id === null) return;
  const story = id && catchupStory();
  scan.catchup = id || null;
  scan.asked = id || null; // until its first announcement
  syncScanKeys();
  if (story) $('now-playing').innerHTML = `Catching up · <strong>${shortOf(story.source)}</strong>: ${esc(story.subject)}…`;
  scanSync({ catchup: id });
  if (id) openStory(id);
}
$('btn-catchup').addEventListener('click', scanCatchup);

/* ───────── Transport: stop, pause/resume, seek ───────── */
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function syncTransport() {
  const loaded = Boolean(radio.getAttribute('src'));
  const seekable = loaded && Number.isFinite(radio.duration) && radio.duration > 0;
  $('btn-stop').disabled = !loaded;
  $('btn-pause').disabled = !loaded;
  $('btn-pause').setAttribute('aria-pressed', String(loaded && radio.paused && !radio.ended)); // latches down while paused, like a tape-deck pause key
  const resumes = loaded && radio.paused;
  $('btn-pause').setAttribute('aria-label', resumes ? 'Resume' : 'Pause');
  $('btn-pause').title = resumes ? 'Resume' : 'Pause';
  $('progress').hidden = !seekable;
  if (seekable) $('progress-bar').style.width = `${(radio.currentTime / radio.duration) * 100}%`;
  const live = loaded && !seekable && radio.dataset.kind === 'live';
  $('elapsed').classList.toggle('live', live);
  $('elapsed').textContent = seekable ? `${clock(radio.currentTime)} / ${clock(radio.duration)}` : live ? 'LIVE' : '';
}
for (const ev of ['play', 'pause', 'ended', 'emptied', 'timeupdate', 'durationchange', 'loadedmetadata']) radio.addEventListener(ev, syncTransport);
$('btn-stop').addEventListener('click', powerOff);
$('btn-pause').addEventListener('click', () => (radio.paused ? resume() : radio.pause()));
$('progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  if (Number.isFinite(radio.duration)) radio.currentTime = ((e.clientX - r.left) / r.width) * radio.duration;
});
addEventListener('keydown', (e) => {
  // Escape in an open card only closes the card.
  if (e.key === 'Escape' && radio.getAttribute('src') && !document.querySelector('dialog[open]')) powerOff();
});
syncTransport();
radio.addEventListener('error', () => {
  if (!radio.getAttribute('src')) return;
  if (radio.dataset.kind === 'scan') return scanReconnect(); // the stream dropped
  if (radio.dataset.kind === 'clip' && playlist.length) return playNext();
  clearTimeout(tuneTimer);
  noSignal(radio.dataset.kind === 'clip' ? null : state.tuned);
});

// Volume: a 0–11 scale (this one goes to eleven). 11 is full volume; the knob sweeps 270°.
const knob = $('knob');
const SWEEP = 270;
const angleFor = (v) => -SWEEP / 2 + (v / 11) * SWEEP;
$('knob-scale').innerHTML = Array.from({ length: 12 }, (_, i) =>
  `<span class="${i === 11 ? 'eleven' : ''}" style="--a:${angleFor(i)}deg">${i}</span>`).join('');
function setVolume(v) {
  radio.volume = Math.min(1, v / 11);
  knob.style.setProperty('--turn', `${angleFor(v)}deg`);
  knob.parentElement.style.setProperty('--v', v); // the LCD skin's segment bar
  $('volume').setAttribute('aria-valuetext', v >= 11 ? 'eleven — one louder' : `${v} of 11`);
}
$('volume').addEventListener('input', (e) => setVolume(Number(e.target.value)));
setVolume(Number($('volume').value));

/* Magic eye: shadow wedge narrows when there's signal. */
function setEye(deg) {
  const r = 16, a = (deg / 2) * Math.PI / 180;
  const x1 = 20 - r * Math.sin(a), y1 = 20 - r * Math.cos(a);
  const x2 = 20 + r * Math.sin(a), y2 = 20 - r * Math.cos(a);
  $('eye-shadow').setAttribute('d', `M20 20 L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`);
}
let eyeTimer = null;
function setLit(on) {
  $('dial').classList.toggle('on', on);
  $('eye').classList.toggle('on', on);
  clearInterval(eyeTimer);
  setEye(on ? 24 : 100);
  if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    eyeTimer = setInterval(() => setEye(10 + Math.random() * 30), 140);
  }
}
function flickEye() {
  if ($('eye').classList.contains('on')) return;
  setEye(14);
  setTimeout(() => setEye(100), 500);
}
setEye(100);

/* ───────── Clock ───────── */
function tick() {
  const t = new Date().toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  $('clock').innerHTML = [...t].map((c) => c === ':' ? '<span class="sep">:</span>' : `<span>${c}</span>`).join('');
}
tick();
setInterval(() => { tick(); renderBar(); }, 10e3); // the bar's lamps go out as traffic ages

/* ───────── Map ───────── */
const map = L.map('map', { zoomControl: true, attributionControl: true, zoomSnap: 0.25 }).setView([20, 0], 2); // fitted to the regions at boot
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 18,
  attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, USGS, NGA, EPA, NPS · &copy; OpenStreetMap contributors',
}).addTo(map);

const layers = {
  incidents: L.layerGroup().addTo(map),
  aircraft: L.layerGroup().addTo(map),
  trains: L.layerGroup().addTo(map),
  ships: L.layerGroup().addTo(map),
  alerts: L.layerGroup().addTo(map),
  tide: L.layerGroup().addTo(map),
  emergencyAir: L.layerGroup().addTo(map), // emergency squawks: shown even with Aircraft off
};
const TOGGLES = [
  ['incidents', 'Incidents'], ['aircraft', 'Aircraft'], ['trains', 'Trains'], ['ships', 'Ships'], ['alerts', 'Wx alerts'],
];
// Layers that are off, remembered per browser. Aircraft start off: 40 planes bury the incidents.
const layersOff = loadSet('pcm.layersOff');
if (store.get('pcm.layersOff') == null) layersOff.add('aircraft');
for (const k of layersOff) layers[k]?.remove();
$('toggles').innerHTML = '<button class="toggle layers-key" aria-expanded="false">Layers</button>' + TOGGLES.map(([k, label]) =>
  `<button class="toggle" data-layer="${k}" aria-pressed="${!layersOff.has(k)}"><span class="bat"></span>${label}<span class="count" id="n-${k}"></span></button>`).join('');
$('toggles').addEventListener('click', (e) => {
  if (e.target.closest('.layers-key')) {
    const open = $('toggles').classList.toggle('open');
    return e.target.closest('.layers-key').setAttribute('aria-expanded', String(open));
  }
  const t = e.target.closest('[data-layer]');
  if (!t) return;
  const on = t.getAttribute('aria-pressed') !== 'true';
  t.setAttribute('aria-pressed', on);
  on ? layers[t.dataset.layer].addTo(map) : layers[t.dataset.layer].remove();
  on ? layersOff.delete(t.dataset.layer) : layersOff.add(t.dataset.layer);
  store.set('pcm.layersOff', JSON.stringify([...layersOff]));
  if (t.dataset.layer === 'aircraft' && !on) layers.emergencyAir.clearLayers(); // no longer refreshed
  if (on) ({ aircraft: refreshAircraft, trains: refreshTrains, ships: refreshShips, alerts: refreshAlerts })[t.dataset.layer]?.();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refreshAircraft(); refreshTrains(); refreshShips(); refreshAlerts(); refreshTide(); }
});
const setCount = (k, n) => { const el = $(`n-${k}`); if (el) el.textContent = n; };

/* ───────── The map folds away to give the printout room; while open it follows what's playing ───────── */
const folded = () => $('chart').classList.contains('folded');
function setFolded(on) {
  $('chart').classList.toggle('folded', on);
  document.querySelector('.desk').classList.toggle('map-folded', on);
  $('btn-fold').setAttribute('aria-expanded', String(!on));
  $('btn-fold').textContent = on ? 'Show map ▾' : 'Fold ▴';
  store.set('pcm.mapFolded', on ? '1' : '');
  if (!on) requestAnimationFrame(() => { map.invalidateSize(); showOnAir(); });
}
$('btn-fold').addEventListener('click', () => setFolded(!folded()));

// "On air": a pulsing ring where the transmission being played is — its incident's marker, or,
// with no incident, its feed's home position (approx.).
let onAirCall = null;
let onAirAt = null; // last place shown, so the map only flies when the location changes
const onAirLayer = L.layerGroup().addTo(map);
function showOnAir() {
  onAirLayer.clearLayers();
  const c = onAirCall;
  renderBar();
  renderIncidentMarkers();
  map.getContainer().classList.toggle('on-air-mode', Boolean(c));
  if (!c || folded()) return;
  const inc = state.incidents.get(c.incident_id);
  const s = state.byId.get(c.source_id);
  const at = inc?.lat != null ? [inc.lat, inc.lng] : s?.lat != null ? [s.lat, s.lng] : null;
  if (!at) return;
  const approx = !inc || inc.precision === 'source';
  L.marker(at, { icon: L.divIcon({ className: 'on-air-icon', html: '<div class="on-air"></div>', iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false, zIndexOffset: 2000 })
    .bindTooltip(`${esc(s?.short || c.source_id)}: ${esc(subjectOf(c))}${approx ? ' · approx.' : ''}`, { permanent: true, direction: 'top', offset: [0, -22], className: 'on-air-tip' })
    .addTo(onAirLayer);
  const moved = String(at) !== String(onAirAt);
  onAirAt = at;
  if (moved) map.flyTo(at, Math.max(map.getZoom(), 11), { duration: 0.8 });
  else if (!map.getBounds().pad(-0.1).contains(at)) map.panTo(at);
}
radio.addEventListener('playing', () => {
  const kind = radio.dataset.kind;
  if (kind === 'scan') return; // scanPlaying() sets it as each transmission comes up in the stream
  onAirCall = kind === 'clip' ? callByAudio(decodeURIComponent(radio.getAttribute('src') || '').replace(/^\/audio\//, '')) ?? null : null;
  showOnAir();
});
radio.addEventListener('emptied', () => { onAirCall = null; showOnAir(); });
setFolded(store.get('pcm.mapFolded') === '1');

const markers = new Map();
const threadOf = (inc) => inc.updates?.findLast((u) => u.thread_id)?.thread_id;
// A stamp with a story opens its story card; one without shows the incident.
function onStamp(m, inc) {
  const thread = threadOf(inc);
  if (!thread) m.bindPopup(incidentPopup(inc));
  m.on('click', () => { select(inc.id, false); if (thread) openStory(thread); });
}
function incidentPopup(inc) {
  const s = state.byId.get(inc.source_id);
  return `<div class="pop-head">${esc(inc.headline)}</div>
    <div class="pop-meta">${hhmm(inc.opened_at)} · ${esc(s?.short)} · ${esc(inc.location_text || 'location not stated')}${inc.precision === 'source' ? ' (approx.)' : ''}</div>
    <p style="margin:6px 0 0">${esc(inc.summary)}</p>`;
}
// Decluttered: incidents show while recent (2 h; breaking 12 h), plus whatever is selected or on
// air. Incidents with no address all sit at their feed's home, so they share one stamp per feed.
const RECENT_MS = 2 * 3600e3;
const BREAKING_MS = 12 * 3600e3;
const onMap = (inc) => inc.id === state.selected || inc.id === onAirCall?.incident_id
  || Date.now() - Date.parse(inc.updated_at) < (inc.category === 'breaking' ? BREAKING_MS : RECENT_MS);

function renderIncidentMarkers() {
  layers.incidents.clearLayers();
  markers.clear();
  const list = [...state.incidents.values()].filter((inc) => inc.lat != null && inView(inc.source_id) && onMap(inc));
  const stamp = (cls, html, at, onAir, title) => L.marker(at, {
    icon: L.divIcon({ className: onAir ? 'is-on-air' : '', html: `<div class="${cls}">${html}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    zIndexOffset: cls.includes('breaking') ? 1000 : 0,
    title,
  }).addTo(layers.incidents);
  const approx = new Map(); // feed → its address-less incidents
  for (const inc of list) {
    if (inc.precision === 'source') { approx.set(inc.source_id, [...(approx.get(inc.source_id) || []), inc]); continue; }
    const cls = ['stamp', inc.category === 'breaking' && 'breaking', state.fresh.has(inc.id) && 'fresh'].filter(Boolean).join(' ');
    const m = stamp(cls, GLYPH[inc.type] || '•', [inc.lat, inc.lng], inc.id === onAirCall?.incident_id, inc.headline);
    onStamp(m, inc);
    markers.set(inc.id, m);
  }
  for (const [sourceId, incs] of approx) {
    const s = state.byId.get(sourceId);
    const one = incs.length === 1 ? incs[0] : null;
    const cls = ['stamp approx', incs.some((i) => i.category === 'breaking') && 'breaking'].filter(Boolean).join(' ');
    const m = stamp(cls, one ? GLYPH[one.type] || '•' : incs.length, [incs[0].lat, incs[0].lng], incs.some((i) => i.id === onAirCall?.incident_id));
    const line = (i) => `${hhmm(i.updated_at)} · ${threadOf(i) ? `<a href="#" data-thread="${threadOf(i)}">${esc(i.headline)}&nbsp;›</a>` : esc(i.headline)}`;
    if (one) onStamp(m, one);
    else m.bindPopup(`<div class="pop-head">${esc(s?.short)} · ${incs.length} incidents, no address</div>
        ${incs.slice(0, 8).map((i) => `<div class="pop-meta">${line(i)}</div>`).join('')}${incs.length > 8 ? `<div class="pop-meta">+ ${incs.length - 8} more in the printout</div>` : ''}`);
    for (const inc of incs) markers.set(inc.id, m);
  }
  setCount('incidents', list.length);
}
setInterval(renderIncidentMarkers, 5 * 60e3); // let incidents age off the map

const PLANE = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2c.6 0 1 .5 1 1.2V9l8 4.5v2l-8-2.3V19l2.2 1.6V22L12 21.2 8.8 22v-1.4L11 19v-5.8L3 15.5v-2L11 9V3.2C11 2.5 11.4 2 12 2z"/></svg>';
const SHIP = '<svg viewBox="0 0 20 20" width="16" height="16"><path fill="currentColor" d="M10 1l5 15-5-3-5 3z"/></svg>';

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status });
  return body;
}
// Overlays are fetched only while their layer is on and the page is in view.
const polling = (k) => !layersOff.has(k) && document.visibilityState === 'visible';
const overlay = (name) => getJson(`/api/overlays/${name}?region=${state.region}`);

async function refreshAircraft() {
  if (!polling('aircraft')) return;
  try {
    const list = await overlay('aircraft');
    layers.aircraft.clearLayers();
    layers.emergencyAir.clearLayers();
    for (const a of list) {
      L.marker([a.lat, a.lng], {
        icon: L.divIcon({ className: '', html: `<div class="plane ${a.emergency ? 'emergency' : ''}" style="transform:rotate(${a.track}deg)">${PLANE}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
        keyboard: false,
      }).bindTooltip(`<span class="plane-tag">${esc(a.flight)} ${esc(a.type)} · ${a.alt === 'ground' ? 'GND' : a.alt ? `${Math.round(a.alt / 100)}00 ft` : ''}${a.emergency ? ` · ${esc(a.emergency).toUpperCase()}` : ''}</span>`, { direction: 'right', offset: [10, 0] })
        .addTo(a.emergency ? layers.emergencyAir : layers.aircraft);
    }
    setCount('aircraft', list.length);
  } catch { setCount('aircraft', '—'); }
}

async function refreshTrains() {
  if (!polling('trains')) return;
  try {
    const list = await overlay('trains');
    layers.trains.clearLayers();
    for (const t of list) {
      L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', html: `<div class="train-mark">${esc(t.number)}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
        .bindPopup(`<div class="pop-head">Amtrak ${esc(t.number)} · ${esc(t.name)}</div><div class="pop-meta">Heading ${esc(t.heading)} · ${esc(t.state)} ${esc(t.timely)}</div>`)
        .addTo(layers.trains);
    }
    setCount('trains', list.length);
  } catch { setCount('trains', '—'); }
}

async function refreshShips() {
  if (!polling('ships')) return;
  try {
    const list = await overlay('ships');
    layers.ships.clearLayers();
    for (const s of list) {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="ship" style="transform:rotate(${s.course || 0}deg)">${SHIP}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip(`${esc(s.name || s.id)} · ${s.speed ?? '?'} kn`)
        .addTo(layers.ships);
    }
    setCount('ships', list.length || 'off'); // none yet, or no AIS key
  } catch { setCount('ships', '—'); }
}

async function refreshAlerts() {
  if (!polling('alerts')) return;
  try {
    const list = await overlay('alerts');
    layers.alerts.clearLayers();
    for (const a of list) {
      if (!a.geometry) continue;
      L.geoJSON(a.geometry, { style: { color: 'oklch(0.5 0.18 27)', weight: 2, dashArray: '6 4', fillOpacity: 0.08 } })
        .bindPopup(`<div class="pop-head">${esc(a.event)}</div><div class="pop-meta">${esc(a.area)}</div><p>${esc(a.headline)}</p>`)
        .addTo(layers.alerts);
    }
    setCount('alerts', list.length);
    const wx = $('wx');
    wx.classList.toggle('alert', list.length > 0);
    wx.innerHTML = list.length
      ? `NWS <strong>${esc([...new Set(list.map((a) => a.event))].join(' · '))}</strong>`
      : 'NWS <strong>no active alerts</strong>';
  } catch { setCount('alerts', '—'); }
}

async function refreshTide() {
  if (!polling('tide')) return;
  try {
    const t = await overlay('tide');
    layers.tide.clearLayers();
    if (!t) { $('tide').textContent = ''; return; }
    L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', html: `<div class="tide-mark">≈ ${t.ft.toFixed(1)} ft</div>`, iconSize: null, iconAnchor: [0, 0] }), keyboard: false })
      .bindTooltip(`${esc(t.station)} water level, ft above MLLW · ${hhmm(t.at)}`)
      .addTo(layers.tide);
    $('tide').innerHTML = `Tide <strong>${t.ft.toFixed(1)} ft</strong> MLLW`;
  } catch { /* gauge stays blank */ }
}

function refreshOverlays() {
  refreshAircraft(); refreshTrains(); refreshShips(); refreshAlerts(); refreshTide();
}

/* ───────── Log ───────── */
const typeLabel = (t) => ({ medical: 'Medical', crash: 'Crash', fire: 'Fire', rescue: 'Rescue', hazmat: 'Hazmat', police: 'Police', aviation: 'Aviation', marine: 'Marine', rail: 'Rail', weather: 'Weather' }[t] || 'Other');
const playButton = (audio, label, text = 'play') => (audio ? `<button class="play" data-src="/audio/${encodeURIComponent(audio)}" data-label="${esc(label)}">${ICON_PLAY} ${text}</button>` : '');
// To the channel's story card (its facts, chronology, Play all and Wider catch-up).
const storyButton = (thread) => (thread ? `<a href="#" class="story-key" data-thread="${thread}" title="This channel's story so far, to read or catch up on">Story&nbsp;›</a>` : '');

// The printout shows a page at a time; on a phone the whole day would be an endless scroll.
let logPage = 0;
let logView = '';
function paginate(items, keepVisible) {
  const size = matchMedia('(max-width: 720px)').matches ? 8 : 30;
  const view = `${state.tab}|${[...state.bands]}|${state.region}`;
  if (view !== logView) { logView = view; logPage = 0; } // new list: back to the newest
  const at = keepVisible ? items.indexOf(keepVisible) : -1;
  if (at >= 0) logPage = Math.floor(at / size);
  const pages = Math.max(1, Math.ceil(items.length / size));
  logPage = Math.min(logPage, pages - 1);
  const pager = pages < 2 ? '' : `<li class="pager">
    <button type="button" class="key" data-page="-1"${logPage === 0 ? ' disabled' : ''}>‹ Newer</button>
    <span>Page ${logPage + 1} of ${pages}</span>
    <button type="button" class="key" data-page="1"${logPage === pages - 1 ? ' disabled' : ''}>Older ›</button></li>`;
  return { items: items.slice(logPage * size, (logPage + 1) * size), pager };
}

function renderLog() {
  const log = $('log');
  const list = [...state.incidents.values()].filter((i) => inView(i.source_id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  $('count-incidents').textContent = list.length ? `(${list.length})` : '';

  if (state.tab === 'digest') return renderDigest();

  if (state.tab === 'stories') {
    const since = new Date(Date.now() - STORY_HOURS * 3600e3).toISOString();
    const { items, pager } = paginate([...state.stories.values()].filter((t) => t.updated_at >= since && inView(t.source_id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    log.innerHTML = items.length ? items.map(storyRow).join('') + pager
      : `<li class="notice"><h2>Quiet on the air</h2>No conversation on ${state.bands.size > 1 ? 'these bands' : state.bands.size ? 'this band' : 'any channel'} in the last ${STORY_HOURS} hours.</li>`;
    return;
  }

  if (state.tab === 'traffic') {
    const { items: calls, pager } = paginate(state.calls.filter((c) => inView(c.source_id)));
    log.innerHTML = calls.length ? calls.map((c) => {
      const short = state.byId.get(c.source_id)?.short;
      return `
      <li class="traffic ${c.category === 'routine' || !c.category ? 'routine' : ''}">
        <div class="entry-meta"><span>${hhmm(c.at)}</span><span>${esc(short)}</span><span>${Math.round(c.duration || 0)}s</span>
          ${playButton(c.audio, `${hhmm(c.at)} ${short}`)}${storyButton(c.thread_id)}</div>
        ${esc(c.transcript)}
      </li>`;
    }).join('') + pager : notice();
    return;
  }

  const page = paginate(list, list.find((i) => i.id === state.selected && i.id !== state.shownSelected));
  state.shownSelected = state.selected; // jump to a newly selected incident's page once, then page freely
  log.innerHTML = list.length ? page.items.map((inc) => {
    const s = state.byId.get(inc.source_id);
    const updates = inc.updates || [];
    return `
    <li class="entry ${inc.category} ${state.selected === inc.id ? 'selected' : ''} ${state.fresh.has(inc.id) ? 'typing' : ''}" data-id="${inc.id}">
      <div class="entry-meta">
        <span>${hhmm(inc.opened_at)}</span><span>${esc(s?.short)}</span><span>${typeLabel(inc.type)}</span>
        ${inc.category === 'breaking' ? '<span class="flag">** Breaking **</span>' : ''}
        ${updates.length > 1 ? `<span>${updates.length} transmissions</span>` : ''}
      </div>
      <div class="entry-head">${esc(inc.headline)}</div>
      <div class="entry-where">${esc(inc.location_text || 'Location not stated')}${inc.precision === 'source' ? ' · approx.' : ''}${inc.units?.length ? ` · ${esc(inc.units.join(', '))}` : ''}</div>
      <p class="entry-sum">${esc(inc.summary)}</p>
      ${storyButton(updates.findLast((u) => u.thread_id)?.thread_id)}
      <div class="entry-more">
        ${updates.map((u) => `<div class="update"><time>${hhmm(u.at)}</time> ${esc(u.summary)}
          ${u.transcript ? `<p class="transcript">“${esc(u.transcript)}”</p>` : ''}
          ${playButton(u.audio, `${hhmm(u.at)} ${s?.short}`, 'play transmission')}</div>`).join('')}
        <div class="entry-meta" style="margin-top:6px"><span>Updated ${ago(inc.updated_at)}</span><span>Confidence ${Math.round((inc.confidence || 0) * 100)}%</span></div>
      </div>
    </li>`;
  }).join('') + page.pager : notice();
  state.fresh.clear();
}

/* ───────── Stories: each channel conversation of the last few hours, latest first ───────── */
const STORY_HOURS = 3;
// A tap on a transmission's line shows all of it (again folds it); it stays open through live re-renders.
const unclamped = new Set();
const openCls = (key) => (unclamped.has(key) ? ' open' : '');
document.addEventListener('click', (e) => {
  const p = e.target.closest('.follow-log p, .story-line');
  if (!p?.dataset.key) return;
  e.stopPropagation(); // not the row's story card
  if (!unclamped.delete(p.dataset.key)) unclamped.add(p.dataset.key);
  p.classList.toggle('open');
}, true);
const isLive = (iso) => Date.now() - new Date(iso) < 5 * 60e3;
const storyOf = ({ events, ...t }) => ({ ...t, count: events.length, last: events.at(-1) || null }); // a story card's thread as a Stories row
function storyRow(t) {
  const line = ccOff() || !t.last?.transcript ? esc(t.last?.note) : `“${esc(t.last.transcript)}”`;
  return `<li class="entry story-row${t.alert >= 0.6 ? ' breaking' : ''}" data-thread="${t.id}">
    <div class="entry-meta"><span>${hhmm(t.last?.at || t.updated_at)}</span><span>${t.count} transmission${t.count === 1 ? '' : 's'}</span>
      ${isLive(t.updated_at) ? '<span class="live">● live</span>' : ''}${t.alert >= 0.9 ? '<span class="flag">** Breaking **</span>' : ''}${followKey(t.id)}</div>
    <div class="entry-head">${ccTag(t.source_id)} ${shortOf(t.source_id)}: ${esc(t.subject)}</div>
    ${line ? `<p class="story-line${openCls(`s${t.last?.id}`)}" data-key="s${t.last?.id}">${line}</p>` : ''}
  </li>`;
}
// A transmission on a story bumps it to the top. A story new to this page is fetched, and so is one whose
// newest note is wanted (the live event carries no note).
function storyCall(c) {
  const t = state.stories.get(c.thread_id);
  if (t && !ccOff()) Object.assign(t, { subject: c.subject || t.subject, updated_at: c.at, count: t.count + 1, last: { id: c.id, at: c.at, transcript: c.transcript } });
  else getJson(`/api/threads/${c.thread_id}`).then((full) => { state.stories.set(full.id, storyOf(full)); if (state.tab === 'stories') renderLog(); }).catch(() => {});
  if (state.tab === 'stories') renderLog();
}

/* ───────── Follow: one story's newest transmissions kept in view under the radio ───────── */
const follow = { id: Number(store.get('pcm.follow')) || null, t: null, fresh: new Map() }; // fresh: call id → when it arrived live
const followKey = (id) => `<button type="button" class="follow-key" data-follow="${id}" aria-pressed="${follow.id === id}">${follow.id === id ? 'Following' : 'Follow'}</button>`;
function setFollow(id) {
  follow.id = follow.id === id ? null : id; // following another story replaces this one
  follow.fresh.clear();
  store.set('pcm.follow', follow.id || '');
  loadFollow();
  if (state.tab === 'stories') renderLog();
  if (storyId) $('story-follow').innerHTML = followKey(storyId);
}
async function loadFollow() {
  const id = follow.id;
  const t = id && await getJson(`/api/threads/${id}`).catch((e) => (e.status === 404 ? null : follow.t));
  if (id !== follow.id) return;
  if (id && !t) { follow.id = null; store.set('pcm.follow', ''); } // pruned
  follow.t = t || null;
  renderFollow();
}
function renderFollow() {
  const t = follow.t;
  $('follow').hidden = !t;
  if (!t) return;
  const last = t.events.at(-1)?.at || t.updated_at;
  const shown = (ccOff() ? t.events.filter((e) => e.note) : t.events).slice(-2).reverse();
  $('follow').innerHTML = `<div class="follow-head"><span class="follow-label">Following ·</span>
      <span>${ccTag(t.source_id)} ${shortOf(t.source_id)}: ${esc(t.subject)}</span>
      ${isLive(last) ? '<span class="live">● live</span>' : Date.now() - new Date(last) > 2 * 3600e3 ? `<span class="quiet">quiet since ${hhmm(last)}</span>` : ''}</div>
    <ol class="follow-log">${shown.map((e) => {
      const fresh = Date.now() - (follow.fresh.get(e.id) || 0) < 20e3;
      return `<li${fresh ? ' class="fresh"' : ''}><time>${hhmm(e.at)}</time><p class="${openCls(`e${e.id}`)}" data-key="e${e.id}">${fresh ? '<span class="new">New</span> ' : ''}${ccOff() || !e.transcript ? esc(e.note) : `“${esc(e.transcript)}”`}</p></li>`;
    }).join('')}</ol>
    <div class="follow-keys"><button type="button" class="follow-key" data-thread="${t.id}">Open</button><button type="button" class="follow-key" data-follow="${t.id}">Unfollow</button></div>`;
}
function followCall(c) {
  follow.fresh.set(c.id, Date.now());
  loadFollow();
  setTimeout(renderFollow, 20.5e3); // drops the NEW mark
}

function notice() {
  const standby = visibleSources().some((s) => s.status?.state === 'standby');
  if (standby) {
    return `<li class="notice"><h2>Receiver in standby</h2>
      Transcription is off because no API key is set. Put <code>OPENROUTER_API_KEY</code> in <code>.env</code> and restart with <code>npm start</code>.
      The map is still live: aircraft, Amtrak, NWS alerts and the tide gauge need no key, and you can tune any station on the dial to listen.</li>`;
  }
  return `<li class="notice"><h2>Quiet on the air</h2>
    Nothing newsworthy in the last 12 hours${state.bands.size ? (state.bands.size > 1 ? ' on these bands' : ' on this band') : ''}. Every transmission is still transcribed; switch to <em>Raw traffic</em> to read it.
    Green lamps below mean a feed is being received.</li>`;
}

/* ───────── Daily log (digests) ───────── */
const digestRegions = () => (state.region === 'all' ? state.regions.map((r) => r.id) : [state.region]);

async function loadDigest(date) {
  const regions = digestRegions();
  const available = state.digests.filter((d) => regions.includes(d.region));
  date ??= state.digest?.date && available.some((d) => d.date === state.digest.date) ? state.digest.date : available[0]?.date;
  if (!date) { state.digest = null; return renderLog(); }
  const parts = await Promise.all(regions.map((r) => getJson(`/api/digests/${date}/${r}`).catch(() => null)));
  state.digest = { date, parts: parts.filter(Boolean) };
  renderLog();
}

async function buildToday() {
  state.digestBusy = true;
  renderLog();
  const date = today();
  try {
    const parts = await Promise.all(digestRegions().map((r) => getJson(`/api/digests/${date}/${r}/build`, { method: 'POST' }).catch((e) => ({ error: e.message, region: r }))));
    state.digests = await getJson('/api/digests');
    const errors = parts.filter((p) => p.error);
    state.digestError = errors.length === parts.length ? errors[0].error : null;
    if (!state.digestError) return loadDigest(date);
  } finally {
    state.digestBusy = false;
    renderLog();
  }
}

function renderDigest() {
  const regions = digestRegions();
  const dates = [...new Set(state.digests.filter((d) => regions.includes(d.region)).map((d) => d.date))].slice(0, 10);
  const actions = `<div class="digest-actions">
      <button id="build-today" ${state.digestBusy ? 'disabled' : ''}>${state.digestBusy ? 'Printing…' : 'Print today so far'}</button>
      ${dates.map((d) => `<button data-date="${d}" aria-current="${state.digest?.date === d}">${d.slice(5)}</button>`).join('')}
      ${state.digestError ? `<span class="busy">${esc(state.digestError)}</span>` : ''}
    </div>`;
  const parts = state.digest?.parts || [];
  if (!parts.length) {
    $('log').innerHTML = `${actions}<li class="notice"><h2>No daily log yet</h2>
      Every transmission is recorded. Shortly after midnight the receiver reads back the whole day and prints the storylines worth hearing,
      with a highlight reel of the actual audio. Press <em>Print today so far</em> to run it now.</li>`;
    return;
  }
  $('log').innerHTML = actions + parts.map((d) => {
    const region = state.regions.find((r) => r.id === d.region);
    const b = d.body;
    return `<li class="bulletin">
      <div class="bulletin-dateline"><span>${longDate(d.date)}</span><span>${esc(region?.name)}</span><span>${d.calls} transmissions read</span></div>
      <h2>${esc(b.headline)}</h2>
      <p class="bulletin-overview">${esc(b.overview)}</p>
      ${d.reel ? `<button class="reel play" data-src="/reels/${encodeURIComponent(d.reel)}" data-label="${esc(region?.short)} highlight reel, ${d.date}">${ICON_PLAY} Play highlight reel</button>` : ''}
      ${b.highlights.map((h) => `<div class="highlight">
        <div class="highlight-kind ${h.kind}">${esc(h.kind)} · ${h.calls?.[0] ? hhmm(h.calls[0].at) : ''}</div>
        <h3>${esc(h.title)}</h3>
        <div class="entry-sum">${esc(h.summary)}</div>
        <div class="why">${esc(h.why)}</div>
        <div class="calls">${(h.calls || []).map((c) => `<div class="update"><time>${hhmm(c.at)}</time> ${esc(state.byId.get(c.source_id)?.short)}
          <p class="transcript">“${esc(c.transcript)}”</p>${playButton(c.audio, `${hhmm(c.at)} ${state.byId.get(c.source_id)?.short}`)}</div>`).join('')}</div>
      </div>`).join('')}
    </li>`;
  }).join('');
}

// Incidents from the list come without transcripts; opening one fetches them (live ones arrive whole).
const withTranscripts = new Map(); // incident id → updated_at it was loaded at
async function loadTranscripts(id) {
  const inc = state.incidents.get(id);
  if (!inc || !state.viewer?.transcripts || withTranscripts.get(id) === inc.updated_at) return;
  withTranscripts.set(id, inc.updated_at);
  try {
    const full = await getJson(`/api/incidents/${id}`);
    if (state.incidents.get(id)?.updated_at === inc.updated_at) state.incidents.set(id, full);
    renderLog();
  } catch { withTranscripts.delete(id); }
}

function select(id, fly = true) {
  state.selected = state.selected === id && fly ? null : id;
  if (state.selected) loadTranscripts(id);
  renderLog();
  renderIncidentMarkers();
  const el = $('log').querySelector(`[data-id="${id}"]`);
  if (el && !fly) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const m = markers.get(id);
  if (fly && m && state.selected === id) {
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.8 });
    m.openPopup();
  }
}

$('log').addEventListener('click', (e) => {
  const play = e.target.closest('.play');
  if (play) { e.stopPropagation(); return playRecording(play.dataset.src, play.dataset.label); }
  if (e.target.closest('#build-today')) return buildToday();
  if (e.target.closest('[data-thread]')) return; // opens the story card (below), without selecting the entry
  const turn = e.target.closest('[data-page]');
  if (turn) {
    logPage += Number(turn.dataset.page);
    renderLog();
    return $('log').closest('.printer').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  const day = e.target.closest('[data-date]');
  if (day) return loadDigest(day.dataset.date);
  const entry = e.target.closest('.entry');
  if (entry) select(Number(entry.dataset.id));
});

const TABS = ['stories', 'incidents', 'traffic', 'digest'];
for (const t of TABS) {
  $(`tab-${t}`).addEventListener('click', () => {
    state.tab = t;
    for (const x of TABS) $(`tab-${x}`).setAttribute('aria-selected', x === t);
    t === 'digest' ? loadDigest() : renderLog();
  });
}

/* ───────── Lamps ───────── */
function renderLamps() {
  $('lamps').innerHTML = visibleSources().map((s) => {
    const st = s.status?.state || 'standby';
    const title = `${s.name}: ${st}${s.status?.error ? ` — ${s.status.error}` : ''}${s.status?.lastCall ? ` · last call ${ago(s.status.lastCall)}` : ''}`;
    return `<li title="${esc(title)}"><span class="lamp" id="lamp-${s.id}" data-state="${st}"></span>${esc(s.short)}</li>`;
  }).join('');
}

/* ───────── Live updates ───────── */
function connect() {
  const es = new EventSource(`/api/events?page=${pageId}`);
  es.addEventListener('incident', (e) => {
    const inc = JSON.parse(e.data);
    state.incidents.set(inc.id, inc);
    withTranscripts.set(inc.id, inc.updated_at);
    state.fresh.add(inc.id);
    renderIncidentMarkers();
    renderLog();
  });
  es.addEventListener('call', (e) => {
    const c = JSON.parse(e.data);
    state.calls.unshift(c); // first: playback looks the call up by its clip
    state.calls.length = Math.min(state.calls.length, 200);
    if (c.source_id === state.tuned?.id) ccLive();
    if (ccShown.some((s) => s.audio === c.audio)) ccRender(ccShown); // its story is known now
    if (scan.lastCall?.id === c.id) { scan.lastCall = c; scan.last.set(c.source_id, c); syncScanKeys(); } // scanned before its story was assigned
    if (scan.shown?.call.id === c.id) scanTitle(scan.shown, c);
    if (storyId && c.thread_id === storyId) renderStory();
    if (c.thread_id) storyCall(c);
    if (c.thread_id && c.thread_id === follow.id) followCall(c);
    renderBar();
    for (const lamp of [$(`lamp-${c.source_id}`), $('chbar-lamps').querySelector(`[data-id="${c.source_id}"]`)]) {
      if (lamp) { lamp.classList.remove('blink'); void lamp.offsetWidth; lamp.classList.add('blink'); }
    }
    if (inRegion(c.source_id)) flickEye();
    if (state.tab === 'traffic') renderLog();
  });
  es.addEventListener('scan', (e) => {
    const p = JSON.parse(e.data);
    if (p.sid !== scan.sid || newEpoch(p.epoch)) return;
    scan.plays.push(p);
    if (scan.plays.length > 30) scan.plays.shift();
  });
  es.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    const s = state.byId.get(st.id);
    if (!s) return;
    const changed = s.status?.state !== st.state;
    s.status = st;
    if (changed) renderLamps();
  });
  // A remote viewer reloads when the switch flips, so transcripts appear or vanish everywhere at once.
  es.addEventListener('settings', (e) => {
    if (state.viewer?.remote && JSON.parse(e.data).sharing !== state.viewer.transcripts) location.reload();
  });
  es.addEventListener('digest', async () => {
    state.digests = await getJson('/api/digests');
    if (state.tab === 'digest') loadDigest();
  });
}

/* ───────── Channel story: tap a title line for the conversation's key facts and chronology ───────── */
let storyId = null;
let storyClips = []; // every transmission in the story with audio, oldest first
let widerClips = []; // the wider catch-up's transmissions, in the order they went out
const storySeen = new Map(); // story id → its newest transmission this page has shown on the card
let storyBase = null; // on the open card, transmissions after this id are NEW
const quietOpen = new Set(); // quiet runs opened on the card, by their oldest transmission's id
async function openStory(id, { play = false } = {}) {
  if (Number(id) !== storyId) { $('story-wider-out').hidden = true; storyBase = storySeen.get(Number(id)) ?? null; }
  storyId = Number(id);
  await renderStory();
  if (storyId && !$('story').open) $('story').showModal();
  if (play) playStory();
}
// The whole story, or (ids) a wider catch-up's transmissions.
function playStory(ids) {
  if (scan.on && storyId && radio.dataset.kind === 'scan' && !radio.paused) { // inside the scan stream, so it keeps playing with the phone locked
    scan.catchup = storyId;
    syncScanKeys();
    return scanSync({ catchup: ids ?? storyId, all: true });
  }
  const [first, ...rest] = ids ? widerClips : storyClips;
  if (first) playRecording(first.src, first.label, 'clip', rest);
}
function playNext() {
  const [next, ...rest] = playlist;
  playRecording(next.src, next.label, 'clip', rest);
}
async function renderStory() {
  const t = await fetch(`/api/threads/${storyId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!t || t.id !== storyId) return;
  const short = state.byId.get(t.source_id)?.short || '';
  const card = $('story'), top = card.scrollTop, height = card.scrollHeight;
  storyClips = t.events.filter((e) => e.audio).map((e, i, all) => ({ src: `/audio/${encodeURIComponent(e.audio)}`, label: `${i + 1} of ${all.length} · ${hhmm(e.at)} ${short}` }));
  $('story-play').hidden = !storyClips.length;
  $('story-play').innerHTML = `${ICON_PLAY} Play all · ${storyClips.length} transmission${storyClips.length > 1 ? 's' : ''}`;
  $('story-wider').hidden = !state.viewer?.transcripts; // built from transcripts (src/ai/wider.mjs)
  $('story-feedback').hidden = notify.opened?.story !== t.id;
  $('story-title').innerHTML = `${ccTag(t.source_id)} ${shortOf(t.source_id)}: ${esc(t.subject)}`;
  $('story-follow').innerHTML = followKey(t.id);
  $('story-facts').innerHTML = t.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('');
  const newest = Math.max(0, ...t.events.map((e) => e.id));
  storyBase ??= newest; // first opening in this page: nothing is NEW yet
  storySeen.set(t.id, newest);
  const isNew = (e) => e.id > storyBase;
  const row = (e) => `<li${isNew(e) ? ' class="fresh"' : ''}><time>${hhmm(e.at)}</time><div>${isNew(e) ? '<span class="new">New</span> ' : ''}${esc(e.note)}`
    + `${e.transcript ? `<p class="transcript">“${esc(e.transcript)}”</p>` : ''}</div>${e.audio
    ? `<button class="play" data-src="/audio/${encodeURIComponent(e.audio)}" data-label="${esc(`${hhmm(e.at)} ${short}`)}" aria-label="Play">${ICON_PLAY}</button>` : ''}</li>`;
  // Newest first; each run of transmissions with no note folds into one "+ N quiet" line.
  const runs = [];
  for (const e of t.events.toReversed()) {
    if (!e.note && Array.isArray(runs.at(-1))) runs.at(-1).push(e);
    else runs.push(e.note ? e : [e]);
  }
  $('story-log').innerHTML = runs.map((r) => {
    if (!Array.isArray(r)) return row(r);
    const key = String(r.at(-1).id);
    return `<li class="story-quiet"><details data-run="${key}"${quietOpen.has(key) ? ' open' : ''}><summary>+ ${r.length} quiet${r.some(isNew) ? ' <span class="new">New</span>' : ''}</summary>`
      + `<ol class="story-log">${r.map(row).join('')}</ol></details></li>`;
  }).join('');
  if (top) card.scrollTop = top + card.scrollHeight - height; // what was in view stays put as transmissions land above it
}
$('story').addEventListener('toggle', (e) => { // doesn't bubble
  const key = e.target.dataset?.run;
  if (key) e.target.open ? quietOpen.add(key) : quietOpen.delete(key);
}, true);
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-follow]');
  if (f) return setFollow(Number(f.dataset.follow));
  const link = e.target.closest('[data-thread]');
  if (!link) return;
  e.preventDefault();
  openStory(link.dataset.thread);
});
$('story-close').addEventListener('click', () => $('story').close());
$('story-play').addEventListener('click', () => playStory());

// Wider catch-up (src/ai/wider.mjs): this story's traffic on other channels too, picked by the model, with
// a summary and why each transmission is included; then it plays like Play all.
async function widerCatchup() {
  const id = storyId, b = $('story-wider'), out = $('story-wider-out');
  b.disabled = true;
  b.textContent = 'Looking across channels…';
  const r = await postJson(`/api/threads/${id}/wider`, {}).catch((e) => ({ error: e.status && /\D/.test(e.message) ? e.message : '' })); // the server's reason, e.g. no model key
  b.disabled = false;
  b.textContent = 'Wider catch-up';
  if (storyId !== id) return;
  out.hidden = false;
  if (!r?.clips) return void (out.innerHTML = `<p class="story-summary">Couldn’t look across channels${r?.error ? `: ${esc(r.error)}` : ' just now. Try again in a minute.'}</p>`);
  if (!r.related) return void (out.innerHTML = '<p class="story-summary">Nothing on other channels ties in to this story yet.</p>');
  widerClips = r.clips.map((c, i, all) => ({ src: `/audio/${encodeURIComponent(c.audio)}`, label: `${i + 1} of ${all.length} · ${hhmm(c.at)} ${state.byId.get(c.source_id)?.short || ''}` }));
  out.innerHTML = `<p class="story-summary">${esc(r.summary)}</p><ol class="story-log">${r.clips.map((c, i) => `<li><time>${hhmm(c.at)}</time>`
    + `<span><strong>${shortOf(c.source_id)}</strong> ${esc(c.why)}</span><button class="play" data-src="${widerClips[i].src}" data-label="${esc(widerClips[i].label)}" aria-label="Play">${ICON_PLAY}</button></li>`).join('')}</ol>`;
  playStory(r.clips.map((c) => c.id));
}
$('story-wider').addEventListener('click', widerCatchup);
$('story').addEventListener('click', (e) => {
  if (e.target === $('story')) return $('story').close(); // tap on the backdrop
  const play = e.target.closest('.play');
  if (play) playRecording(play.dataset.src, play.dataset.label);
});
$('story').addEventListener('close', () => { storyId = null; });

/* ───────── Notifications (Web Push — setup in docs/NOTIFICATIONS.md) ─────────
   One subscription per browser, with its own sensitivity and favourite channels. iPhones only allow
   push for sites added to the Home Screen and opened from there. */
const notify = { reg: null, sub: null, status: null, opened: null }; // opened: { n, story } when the page came from a notification
const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const needsHomeScreen = /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone;
const vapidKey = (b64) => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function notifyInit() {
  if (canPush) {
    notify.reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    notify.sub = await notify.reg?.pushManager.getSubscription().catch(() => null);
  }
  notify.status = await postJson('/api/notify/status', { endpoint: notify.sub?.endpoint }).catch(() => null);
  const st = notify.status;
  $('btn-notify').hidden = !st || !(st.allowed || st.owner); // the owner sees it even before setup, to find the instructions
  $('btn-notify').setAttribute('aria-pressed', String(Boolean(st?.sub)));
  notifyCta();
}

// A banner pointing at the set-up steps, until this browser has notifications on (or "Not now" hides it for a week).
function notifyCta() {
  const st = notify.status;
  let snoozed = false;
  try { snoozed = Date.now() < Number(localStorage.getItem('pcm.notifyCtaUntil') || 0); } catch {}
  $('notify-cta').hidden = snoozed || !st?.ready || !(st.allowed || st.owner) || Boolean(st.sub);
  $('notify-cta-link').textContent = needsHomeScreen
    ? 'Get alerts on your iPhone: add Squelch to your Home Screen, then turn on notifications'
    : 'Get alerts on this device: how to turn on notifications';
}
$('notify-cta-close').addEventListener('click', () => {
  try { localStorage.setItem('pcm.notifyCtaUntil', String(Date.now() + 7 * 864e5)); } catch {}
  $('notify-cta').hidden = true;
});

function renderNotify() {
  const st = notify.status;
  const sub = st?.sub;
  const usable = st?.ready && st.allowed && canPush && notify.reg;
  $('notify-msg').innerHTML = !st ? 'Couldn’t reach the receiver.'
    : !st.ready ? 'Not set up on this receiver yet: add VAPID keys to <code>.env</code> and restart — see <a href="https://github.com/iamneilroberts/squelch/blob/main/docs/NOTIFICATIONS.md" target="_blank" rel="noopener">docs/NOTIFICATIONS.md</a>.'
      : !st.allowed ? 'Notifications here are for the receiver’s owner.'
        : !canPush && needsHomeScreen ? 'On iPhone: tap <strong>Share → Add to Home Screen</strong>, open the receiver from the Home Screen, then turn notifications on here.'
          : !usable ? 'This browser can’t receive push notifications.'
            : sub ? 'On for this browser. You’ll get one notification per story, and another only if it escalates.'
              : 'Get a notification when something notable happens — a working fire, a pursuit, an aircraft in trouble.';
  $('notify-toggle').hidden = !usable;
  $('notify-toggle').textContent = sub ? 'Turn off' : 'Turn on';
  $('notify-test').hidden = !usable || !sub;
  $('notify-prefs').hidden = !usable || !sub;
  if (sub) {
    for (const r of document.querySelectorAll('[name="notify-level"]')) r.checked = r.value === sub.level;
    $('notify-favs').innerHTML = [...state.byId.values()].filter((s) => s.kind !== 'link')
      .map((s) => `<li><label><input type="checkbox" value="${esc(s.id)}"${sub.favorites.includes(s.id) ? ' checked' : ''}> ${ccTag(s.id)} <strong>${esc(s.short)}</strong> <span>${esc(s.name)}</span></label></li>`).join('');
  }
  $('notify-guests-row').hidden = !st?.owner || !st.ready;
  $('notify-guests').checked = Boolean(st?.guests);
}

async function notifyToggle() {
  const st = notify.status;
  try {
    if (st.sub) {
      await notify.sub?.unsubscribe().catch(() => {});
      await postJson('/api/notify/unsubscribe', { endpoint: notify.sub?.endpoint });
      notify.sub = null;
      st.sub = null;
    } else {
      if (await Notification.requestPermission() !== 'granted') {
        $('notify-msg').textContent = 'Notifications are blocked for this site in the browser’s settings.';
        return;
      }
      notify.sub = await notify.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(st.publicKey) });
      st.sub = await postJson('/api/notify/subscribe', { subscription: notify.sub.toJSON(), level: 'normal', favorites: [] });
    }
  } catch (e) {
    $('notify-msg').textContent = `Couldn’t change notifications: ${e.message}`;
    return;
  }
  $('btn-notify').setAttribute('aria-pressed', String(Boolean(st.sub)));
  renderNotify();
  notifyCta();
}

async function notifySavePrefs() {
  const level = document.querySelector('[name="notify-level"]:checked')?.value;
  const favorites = [...$('notify-favs').querySelectorAll('input:checked')].map((i) => i.value);
  notify.status.sub = await postJson('/api/notify/prefs', { endpoint: notify.sub.endpoint, level, favorites }).catch(() => notify.status.sub);
}

// Opened from a notification: record it, time how long the page stays in view, and ask for feedback
// on its story card. Evidence for src/notify.mjs's learning.
function trackNotification(n, story) {
  const endpoint = notify.sub?.endpoint;
  if (!endpoint) return;
  notify.opened = { n, story };
  postJson('/api/notify/opened', { n, endpoint }).catch(() => {});
  if (storyId === story) renderStory();
  let seen = 0;
  let since = document.visibilityState === 'visible' ? Date.now() : null;
  const report = () => {
    const seconds = Math.round(seen + (since ? (Date.now() - since) / 1000 : 0));
    navigator.sendBeacon('/api/notify/dwell', new Blob([JSON.stringify({ n, endpoint, seconds })], { type: 'application/json' }));
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') since = Date.now();
    else { if (since) seen += (Date.now() - since) / 1000; since = null; report(); }
  });
  const timer = setInterval(report, 20e3);
  setTimeout(() => clearInterval(timer), 10 * 60e3); // ten minutes is plenty of evidence
}

async function renderLearned() {
  const rows = notify.sub ? await postJson('/api/notify/learned', { endpoint: notify.sub.endpoint }).catch(() => []) : [];
  $('notify-learned').innerHTML = rows.length
    ? rows.map((r) => `<li><strong>×${r.weight}</strong> ${esc(r.label)} <span>${r.sent} sent · ${r.opened} opened${r.more ? ` · ${r.more} more` : ''}${r.fewer ? ` · ${r.fewer} fewer` : ''}</span></li>`).join('')
    : '<li><span>Nothing yet — every notification starts neutral.</span></li>';
}

$('btn-notify').addEventListener('click', () => { renderNotify(); renderLearned(); $('notify').showModal(); });
$('notify-reset').addEventListener('click', async () => {
  await postJson('/api/notify/reset', { endpoint: notify.sub?.endpoint }).catch(() => {});
  renderLearned();
});
$('story-feedback').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-feedback]');
  if (!b || !notify.opened) return;
  const feedback = Number(b.dataset.feedback);
  await postJson('/api/notify/feedback', { n: notify.opened.n, endpoint: notify.sub?.endpoint, feedback }).catch(() => {});
  $('story-feedback').innerHTML = `<span>Thanks — you’ll get ${feedback > 0 ? 'more' : 'fewer'} like this.</span>`;
});
$('notify-close').addEventListener('click', () => $('notify').close());
$('notify').addEventListener('click', (e) => { if (e.target === $('notify')) $('notify').close(); });
$('notify-toggle').addEventListener('click', notifyToggle);
$('notify-test').addEventListener('click', async () => {
  const r = await postJson('/api/notify/test', { endpoint: notify.sub?.endpoint }).catch(() => ({}));
  $('notify-msg').textContent = r.sent ? 'Test sent — it should arrive in a few seconds.' : 'The test didn’t go through. Try turning notifications off and on again.';
});
$('notify-prefs').addEventListener('change', notifySavePrefs);
$('notify-guests').addEventListener('change', async (e) => {
  const s = await postJson('/api/settings', { guestNotifications: e.target.checked }).catch(() => null);
  if (s) notify.status.guests = s.guestNotifications;
  e.target.checked = Boolean(notify.status.guests);
});

/* ───────── Updates: a Home Screen app has no reload button, so offer one when a new version is installed ───────── */
async function checkVersion() {
  const r = await getJson('/api/version').catch(() => null);
  if (r?.version && state.version && r.version !== state.version) $('btn-update').hidden = false;
}
$('btn-update').addEventListener('click', () => location.reload());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
setInterval(checkVersion, 5 * 60e3);

/* ───────── Your own Broadcastify Premium login (for visitors who aren't the owner) ───────── */
document.addEventListener('click', (e) => {
  if (e.target.id === 'bcfy-open') { $('bcfy-form').hidden = false; $('bcfy-form').elements.username.focus(); }
});
$('bcfy-cancel').addEventListener('click', () => { $('bcfy-form').hidden = true; });
$('bcfy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const msg = $('bcfy-msg');
  msg.textContent = 'Checking with Broadcastify…';
  try {
    const r = await fetch('/api/broadcastify/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.elements.username.value, password: f.elements.password.value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg.textContent = j.error || `Sign-in failed (${r.status})`; return; }
    f.elements.password.value = '';
    f.hidden = true;
    msg.textContent = '';
    Object.assign(state.viewer, { canListen: true, broadcastifyUser: j.user });
    renderBcfyStatus();
    buildDial();
    if (state.tuned) { const s = state.tuned; state.tuned = null; tune(s); }
  } catch {
    msg.textContent = 'Couldn’t reach the receiver.';
  }
});
function renderBcfyStatus() {
  const el = $('bcfy-status');
  const u = state.viewer?.broadcastifyUser;
  el.hidden = !u;
  if (u) el.innerHTML = `Broadcastify <strong>${esc(u)}</strong> · <button type="button" id="bcfy-logout">sign out</button>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'bcfy-logout') return;
  await fetch('/api/broadcastify/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ───────── Remote-transcripts switch (LAN only; the server enforces it) ───────── */
function setupShareToggle(on) {
  const btn = $('share-toggle');
  const show = (v) => {
    btn.setAttribute('aria-pressed', v);
    $('share-label').textContent = `Remote transcripts: ${v ? 'on' : 'off'}`;
  };
  btn.hidden = false;
  show(on);
  btn.addEventListener('click', async () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    try {
      const s = await getJson('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tunnelTranscripts: next }) });
      show(s.tunnelTranscripts);
      if (state.viewer.remote) location.reload(); // an owner viewing remotely gets their own view updated too
    } catch { show(!next); }
  });
}

// A tapped notification (?n=&story=): show its story and play it from the first transmission.
function fromNotification(q) {
  const n = Number(q.get('n'));
  const story = Number(q.get('story'));
  if (!story) return;
  if (n) notify.ready.then(() => trackNotification(n, story));
  openStory(story, { play: true });
}

/* ───────── Boot ───────── */
async function boot() {
  const opened = new URLSearchParams(location.search); // ?story= from a notification; read before setRegion rewrites the URL
  const [config, incidents, calls, digests, stories] = await Promise.all([getJson('/api/config'), getJson('/api/incidents'), getJson('/api/calls'), getJson('/api/digests'), getJson(`/api/threads?hours=${STORY_HOURS}`)]);
  state.regions = config.regions;
  state.sources = config.sources;
  state.station = config.station;
  applyLook();
  TZ = config.station.timezone || TZ;
  tick();
  document.querySelector('.badge-script').textContent = config.station.script;
  document.title = `${config.station.script} ${config.station.caps}`;
  $('tab-traffic').hidden = !config.viewer?.transcripts; // the server sends no raw traffic to tunnel visitors
  state.viewer = config.viewer || {};
  if (state.viewer.canShare) setupShareToggle(state.viewer.sharing);
  renderBcfyStatus();
  for (const s of config.sources) state.byId.set(s.id, s);
  for (const i of incidents) state.incidents.set(i.id, i);
  for (const t of stories) state.stories.set(t.id, t);
  state.calls = calls;
  state.digests = digests;
  state.version = config.version;
  ccIdle();
  buildSelector();
  setRegion(location.hash.slice(1) || store.get('pcm.region') || 'all', { fly: false });
  requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(regionBounds(), { padding: [20, 20] }); });
  addEventListener('hashchange', () => setRegion(location.hash.slice(1) || 'all'));
  connect();
  loadFollow();
  setInterval(renderFollow, 60e3); // "● live", "quiet since"
  startScan(); // open scanning; awaitTap() covers the browser's no-sound-before-a-tap rule
  notify.ready = notifyInit();
  refreshReports();
  fromNotification(opened);
  navigator.serviceWorker?.addEventListener('message', (e) => { // tapped while the app was already open (sw.js)
    const q = e.data?.open && new URL(e.data.open, location.href).searchParams;
    if (q?.has('report')) openReport(q.get('report') === 'mine');
    else if (q) fromNotification(q);
  });
  setInterval(refreshAircraft, 15e3);
  setInterval(refreshTrains, 60e3);
  setInterval(refreshShips, 30e3);
  setInterval(refreshAlerts, 5 * 60e3);
  setInterval(refreshTide, 6 * 60e3);
  setInterval(() => { if ((state.tab === 'incidents' && state.selected) || state.tab === 'stories') renderLog(); }, 60e3); // "updated … ago", "● live"
}
boot();
