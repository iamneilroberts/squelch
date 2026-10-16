// Squelch — client.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  band: 'all',
  tab: 'incidents',
  tuned: null,
  selected: null,
  fresh: new Set(),
};

const regionOf = (sourceId) => state.byId.get(sourceId)?.region;
const inRegion = (sourceId) => state.region === 'all' || regionOf(sourceId) === state.region;
const inView = (sourceId) => inRegion(sourceId) && (state.band === 'all' || state.byId.get(sourceId)?.band === state.band);
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
  if (state.band !== 'all' && !visibleSources().some((s) => s.band === state.band)) state.band = 'all';
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
  const GAP = 0.7, PAD = 0.6;
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
  $('dial').style.minWidth = `${Math.max(640, Math.round(total * 90))}px`;
  requestAnimationFrame(() => {
    const sc = $('dial').parentElement;
    sc.classList.toggle('scrolls', sc.scrollWidth > sc.clientWidth + 4);
  });

  $('dial-bands').innerHTML = present.map((b) => {
    const xs = order.filter((s) => s.band === b.id).map((s) => s.x);
    const left = Math.min(...xs) - half * 0.9, right = Math.max(...xs) + half * 0.9;
    return `<span class="dial-band" data-band="${b.id}" style="left:${left}%;width:${right - left}%">${b.label}</span>`;
  }).join('');

  $('dial-stations').innerHTML = order.map((s) => `
    <button class="station ${playable(s) ? '' : 'link'} ${state.band !== 'all' && s.band !== state.band ? 'dimmed' : ''} ${scan.lockouts.has(s.id) ? 'locked' : ''} ${scan.priority.has(s.id) ? 'pri' : ''}" data-id="${s.id}" style="left:${s.x}%"
      aria-pressed="${state.tuned?.id === s.id}" title="${esc(s.name)} — ${esc(s.coverage)}">
      <span class="station-freq">${esc(s.dial || '')}</span>
      <span class="station-name">${esc(s.short)}</span>
    </button>`).join('');

  $('keys').innerHTML = [{ id: 'all', key: 'All' }, ...present].map((b) =>
    `<button class="key" data-band="${b.id}" aria-pressed="${b.id === state.band}">${b.key}</button>`).join('');
  moveNeedle(state.tuned && order.includes(state.tuned) ? state.tuned : order[0]);
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
  state.band = k.dataset.band;
  for (const el of $('keys').children) el.setAttribute('aria-pressed', el === k);
  for (const el of $('dial-stations').children) {
    el.classList.toggle('dimmed', state.band !== 'all' && state.byId.get(el.dataset.id).band !== state.band);
  }
  renderLog();
  renderIncidentMarkers();
});

function moveNeedle(s, { scroll = true } = {}) {
  if (!s || s.x == null) return;
  const dial = $('dial');
  const px = (s.x / 100) * dial.clientWidth;
  dial.style.setProperty('--needle-px', `${px}px`);
  dial.style.setProperty('--needle-x', `${s.x}%`);
  // On a scrolling (phone-width) dial, keep the tuned station in view.
  const scroller = dial.parentElement;
  if (scroll && scroller.scrollWidth > scroller.clientWidth + 4) {
    scroller.scrollTo({ left: Math.max(0, px - scroller.clientWidth / 2), behavior: 'smooth' });
  }
}
addEventListener('resize', () => moveNeedle(state.tuned || visibleSources().find((s) => s.x != null)));

/* ───────── Audio ───────── */
const radio = $('radio');
radio.volume = 0.7;
let tuneTimer = null;

// Live audio comes through the scanner server (/listen/…), which adds a Broadcastify login — so no
// browser sign-in prompt. The owner/LAN use the receiver's account; anyone else signs in with their own.
const playable = (s) => Boolean(s.streamUrl && state.viewer?.canListen);

function tune(s) {
  const buttons = [...$('dial-stations').children];
  if (state.tuned === s && !radio.paused) return powerOff();
  state.tuned = s;
  moveNeedle(s);
  buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === s.id));
  if (!playable(s)) {
    radio.pause();
    radio.removeAttribute('src');
    radio.load();
    setLit(false);
    const page = `<a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">listen on ${s.listenUrl.includes('broadcastify') ? 'Broadcastify' : 'the feed’s page'} ↗</a>`;
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
    ? `No signal from <strong>${esc(s.short)}</strong>. The direct stream didn't answer — <a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">listen on the feed's page ↗</a>`
    : 'That recording has expired.';
}

function powerOff() {
  stopScan();
  clearTimeout(tuneTimer);
  radio.pause();
  radio.removeAttribute('src');
  radio.load(); // drop the connection to a live stream instead of buffering it in the background
  state.tuned = null;
  for (const b of $('dial-stations').children) b.setAttribute('aria-pressed', 'false');
  setLit(false);
  $('now-playing').textContent = 'Off the air. Tune a station on the dial to listen live.';
  ccIdle();
  syncTransport();
}

function playRecording(src, label, kind = 'clip') {
  if (kind === 'clip') stopScan(); // playing one recording by hand ends a scan
  state.tuned = null;
  clearTimeout(tuneTimer);
  ccLoad(src);
  radio.src = src;
  radio.dataset.kind = kind;
  radio.dataset.label = label;
  radio.play().catch(() => {});
}

/* ───────── Closed captions ─────────
   A recording carries a WebVTT track (/api/captions/<clip>.vtt) whose cues the server lays over the
   clip's voiced stretches, so lines roll up with playback, pause and seek. The strip is bottom-aligned
   and clips at the top, so older lines (including the previous transmission's) scroll off like CC.
   A live stream has no clip yet: the strip shows that channel's transcripts as they arrive. */
let ccPrev = []; // lines still on screen from the previous recording
let ccSource = null; // station of the recording being captioned (from its clip filename)

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
const ccWho = (id) => (state.byId.has(id) ? `${ccTag(id)} ${shortOf(id)}: ` : '&gt;&gt; ');
const ccLine = (text, cls = '') => `<p class="cc-line ${cls}">${text}</p>`;
const ccSet = (html) => { $('cc-text').innerHTML = html; };
const ccOff = () => !state.viewer?.transcripts;

function ccIdle() {
  ccPrev = [];
  ccSet(ccLine(ccOff() ? 'Captions are off — transcripts are private on this receiver.' : 'Captions appear here when traffic plays.', 'cc-note'));
}

function ccLoad(src) {
  ccPrev = [...$('cc-text').querySelectorAll('.cc-line:not(.cc-note)')].slice(-3).map((p) => p.innerHTML);
  ccSource = /^\/audio\/(.+)-\d+\.mp3$/.exec(decodeURIComponent(src))?.[1] ?? null;
  radio.querySelectorAll('track').forEach((t) => t.remove());
  if (ccOff() || !src.startsWith('/audio/')) return ccOff() ? ccIdle() : ccSet(ccPrev.map((l) => ccLine(l, 'cc-old')).join(''));
  const track = Object.assign(document.createElement('track'), { kind: 'captions', srclang: 'en', label: 'Transcript', src: `/api/captions/${src.slice(7)}.vtt`, default: true });
  track.addEventListener('load', ccSync);
  radio.append(track);
  track.track.mode = 'hidden'; // cues drive our strip, not the browser's overlay
}

function ccSync() {
  const kind = radio.dataset.kind;
  if (ccOff() || (kind !== 'clip' && kind !== 'scan')) return;
  const cues = [...(radio.textTracks[0]?.cues || [])].filter((c) => c.startTime <= radio.currentTime);
  const now = cues.at(-1);
  const lines = cues.map((c, i) => ccLine(`${i === 0 ? ccWho(ccSource) : ''}${esc(c.text)}`, c === now && radio.currentTime < c.endTime ? 'cc-now' : ''));
  ccSet([...ccPrev.map((l) => ccLine(l, 'cc-old')), ...lines].join(''));
}
for (const ev of ['timeupdate', 'seeked']) radio.addEventListener(ev, ccSync);

// Live: the tuned channel's latest transcripts, newest last (they land about a minute behind the audio).
function ccLive() {
  const s = state.tuned;
  if (!s || radio.dataset.kind !== 'live') return;
  if (ccOff()) return ccIdle();
  const recent = state.calls.filter((c) => c.source_id === s.id && c.transcript).slice(0, 3).reverse();
  ccSet(ccLine(`${ccTag(s.id)} ${esc(s.short)} · captions run about a minute behind live`, 'cc-note')
    + recent.map((c, i) => ccLine(`&gt;&gt; ${hhmm(c.at)} ${esc(c.transcript)}`, i === recent.length - 1 ? 'cc-now' : 'cc-old')).join(''));
}

radio.addEventListener('playing', () => {
  setLit(true);
  if (radio.dataset.kind === 'clip') {
    $('now-playing').innerHTML = `Playing recording — <strong>${esc(radio.dataset.label)}</strong>`;
  } else if (radio.dataset.kind === 'scan') {
    $('now-playing').innerHTML = `<strong>SCAN</strong> · ${radio.dataset.label}`;
  } else if (state.tuned) {
    const s = state.tuned;
    $('now-playing').innerHTML = `Receiving <strong>${esc(s.short)}</strong> · ${esc(s.name)} · via <a href="${esc(s.listenUrl)}" target="_blank" rel="noopener">Broadcastify ↗</a>`;
  }
});
radio.addEventListener('pause', () => setLit(false));
radio.addEventListener('ended', () => {
  setLit(false);
  if (radio.dataset.kind === 'scan') return scanAfterTransmission();
  if (radio.dataset.kind === 'clip') $('now-playing').innerHTML = `Finished — <strong>${esc(radio.dataset.label)}</strong>`;
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
  queue: [],
  stepper: null,
  step: 0,
  current: null,      // channel of the transmission playing or just played
  idle: true,         // nothing playing and no delay running
  delayTimer: null,
  delayTick: null,
  hold: null,         // channel id the scan is held on, or null
  history: [],        // channels the scan stopped on, oldest first
  back: 0,            // how many steps PREV has walked back
  last: new Map(),    // channel id → its most recent transmission (for PREV replay)
  lockouts: loadSet('pcm.lockouts'),
  priority: loadSet('pcm.priority'),
};
const scanChannels = () => visibleSources().filter((s) => s.kind === 'stream'
  && (state.band === 'all' || s.band === state.band) && !scan.lockouts.has(s.id)
  && (!scan.hold || s.id === scan.hold));
const inScan = (sourceId) => scanChannels().some((s) => s.id === sourceId);
const isPriority = (c) => scan.priority.has(c.source_id);
const shortOf = (id) => esc(state.byId.get(id)?.short || id);

function startScan() {
  if (state.tuned || radio.getAttribute('src')) powerOff();
  Object.assign(scan, { on: true, hold: null, history: [], back: 0, current: null, idle: true });
  $('dial').classList.add('scanning');
  // Prime with the last couple of minutes so there's something to hear straight away.
  const since = Date.now() - 2 * 60e3;
  scan.queue = state.calls.filter((c) => c.audio && inScan(c.source_id) && new Date(c.at) >= since).slice(0, 3).reverse();
  syncScanKeys();
  scanNext();
}

function stopScan() {
  if (!scan.on) return;
  clearDelay();
  clearInterval(scan.stepper);
  Object.assign(scan, { on: false, queue: [], stepper: null, hold: null, idle: true });
  $('dial').classList.remove('scanning');
  syncScanKeys();
}

function syncScanKeys() {
  $('btn-scan').setAttribute('aria-pressed', scan.on);
  $('btn-hold').disabled = !scan.on;
  $('btn-hold').setAttribute('aria-pressed', Boolean(scan.hold));
  $('btn-hold').textContent = scan.hold ? 'Resume' : 'Hold';
  $('btn-prev').disabled = !scan.on || scan.history.length < 1;
}

function clearDelay() {
  clearTimeout(scan.delayTimer);
  clearInterval(scan.delayTick);
  scan.delayTimer = scan.delayTick = null;
}

// Next transmission: priority channels first, then oldest-first.
function scanNext() {
  if (!scan.on) return;
  clearDelay();
  scan.queue = scan.queue.filter((c) => inScan(c.source_id)); // channel changed, held elsewhere or locked out
  const i = scan.queue.findIndex(isPriority);
  const c = scan.queue.splice(i >= 0 ? i : 0, 1)[0];
  return c ? playScan(c) : scanIdle();
}

function playScan(c, { replay = false } = {}) {
  clearDelay();
  clearInterval(scan.stepper);
  scan.stepper = null;
  scan.idle = false;
  scan.current = c.source_id;
  scan.last.set(c.source_id, c);
  if (!replay) {
    if (scan.history[scan.history.length - 1] !== c.source_id) scan.history.push(c.source_id);
    if (scan.history.length > 30) scan.history.shift();
    scan.back = 0;
  }
  syncScanKeys();
  moveNeedle(state.byId.get(c.source_id));
  const words = state.viewer?.transcripts && c.transcript ? ` — “${esc(c.transcript.slice(0, 90))}${c.transcript.length > 90 ? '…' : ''}”` : '';
  const tag = replay ? 'REPLAY' : scan.hold ? 'HOLD' : isPriority(c) ? 'PRI' : '';
  playRecording(`/audio/${encodeURIComponent(c.audio)}`, `${tag ? `${tag} · ` : ''}<strong>${shortOf(c.source_id)}</strong> ${hhmm(c.at)}${words}`, 'scan');
}

// After a transmission: linger on the channel for DELAY_MS (a reply plays straight away), then move on.
function scanAfterTransmission() {
  if (!scan.on) return;
  if (scan.hold) return scanNext(); // held: keep playing this channel's traffic as it arrives
  const ch = scan.current;
  const until = Date.now() + DELAY_MS;
  const show = () => {
    const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    $('now-playing').innerHTML = `<strong>${shortOf(ch)}</strong> · scan resumes in ${s} s — press <strong>Hold</strong> to stay on this channel`;
  };
  show();
  scan.delayTick = setInterval(show, 250);
  scan.delayTimer = setTimeout(scanNext, DELAY_MS);
}

// Nothing queued: step the needle across the scanned stations, like a real scanner searching.
function scanIdle() {
  scan.idle = true;
  setLit(false);
  const n = scanChannels().length;
  $('now-playing').innerHTML = scan.hold
    ? `<strong>HOLD</strong> · ${shortOf(scan.hold)} — new traffic here plays as it arrives · <strong>Resume</strong> to scan again`
    : n
      ? `<strong>SCANNING</strong> ${n} channel${n > 1 ? 's' : ''} · about a minute behind live · tap a station: PRI → L/O → normal`
      : '<strong>SCAN</strong> — every channel here is locked out. Tap a station to bring it back.';
  if (scan.stepper || !n || scan.hold) return;
  scan.stepper = setInterval(() => {
    const list = scanChannels();
    if (list.length) moveNeedle(list[scan.step++ % list.length], { scroll: false });
  }, 320);
}

function scanEnqueue(c) {
  if (!scan.on || !c.audio || !inScan(c.source_id)) return;
  scan.queue.push(c);
  if (scan.queue.length > 20) scan.queue.shift(); // stay close to live
  const delaying = Boolean(scan.delayTimer);
  if (scan.idle && !delaying) return scanNext();
  // During the delay, a reply on the same channel (or any priority traffic) plays at once.
  if (delaying && (c.source_id === scan.current || isPriority(c))) return scanNext();
  // Priority traffic interrupts an ordinary transmission on another channel.
  if (!delaying && isPriority(c) && !scan.priority.has(scan.current) && radio.dataset.kind === 'scan') return scanNext();
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
  if (scan.idle && !scan.delayTimer) scanIdle();
}

function toggleHold() {
  if (!scan.on) return;
  if (scan.hold) {
    scan.hold = null;
    scan.back = 0;
    syncScanKeys();
    if (scan.idle) scanNext();
    return;
  }
  scan.hold = scan.current || scanChannels()[0]?.id || null;
  clearDelay();
  clearInterval(scan.stepper); // the idle search sweep would drag the needle off the held channel
  scan.stepper = null;
  syncScanKeys();
  if (scan.hold) moveNeedle(state.byId.get(scan.hold));
  if (scan.idle || radio.ended || !radio.getAttribute('src')) scanIdle();
}

// PREV: each press goes one channel further back in the scan's history, holds there and replays
// that channel's most recent transmission.
function scanPrev() {
  if (!scan.on || !scan.history.length) return;
  scan.back = Math.min(scan.back + 1, scan.history.length - 1);
  const id = scan.history[scan.history.length - 1 - scan.back] ?? scan.history[0];
  scan.hold = id;
  syncScanKeys();
  const c = scan.last.get(id);
  if (c) playScan(c, { replay: true });
  else { moveNeedle(state.byId.get(id)); scanIdle(); }
}

$('btn-scan').addEventListener('click', () => (scan.on ? powerOff() : startScan()));
$('btn-hold').addEventListener('click', toggleHold);
$('btn-prev').addEventListener('click', scanPrev);

/* ───────── Transport: stop, pause/resume, seek ───────── */
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function syncTransport() {
  const loaded = Boolean(radio.getAttribute('src'));
  const seekable = loaded && Number.isFinite(radio.duration) && radio.duration > 0;
  $('btn-stop').disabled = !loaded;
  $('btn-pause').disabled = !loaded;
  $('btn-pause').textContent = radio.paused ? '▶' : '❚❚';
  $('btn-pause').setAttribute('aria-label', radio.paused ? 'Resume' : 'Pause');
  $('btn-pause').title = radio.paused ? 'Resume' : 'Pause';
  $('progress').hidden = !seekable;
  if (seekable) $('progress-bar').style.width = `${(radio.currentTime / radio.duration) * 100}%`;
  const live = loaded && !seekable && radio.dataset.kind === 'live';
  $('elapsed').classList.toggle('live', live);
  $('elapsed').textContent = seekable ? `${clock(radio.currentTime)} / ${clock(radio.duration)}` : live ? 'LIVE' : '';
}
for (const ev of ['play', 'pause', 'ended', 'emptied', 'timeupdate', 'durationchange', 'loadedmetadata']) radio.addEventListener(ev, syncTransport);
$('btn-stop').addEventListener('click', powerOff);
$('btn-pause').addEventListener('click', () => (radio.paused ? radio.play().catch(() => {}) : radio.pause()));
$('progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  if (Number.isFinite(radio.duration)) radio.currentTime = ((e.clientX - r.left) / r.width) * radio.duration;
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && radio.getAttribute('src')) powerOff();
});
syncTransport();
radio.addEventListener('error', () => {
  if (!radio.getAttribute('src')) return;
  if (radio.dataset.kind === 'scan') return scanNext(); // recording expired — move on
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
setInterval(tick, 10e3);

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
};
const TOGGLES = [
  ['incidents', 'Incidents'], ['aircraft', 'Aircraft'], ['trains', 'Trains'], ['ships', 'Ships'], ['alerts', 'Wx alerts'],
];
$('toggles').innerHTML = TOGGLES.map(([k, label]) =>
  `<button class="toggle" data-layer="${k}" aria-pressed="true"><span class="bat"></span>${label}<span class="count" id="n-${k}"></span></button>`).join('');
$('toggles').addEventListener('click', (e) => {
  const t = e.target.closest('.toggle');
  if (!t) return;
  const on = t.getAttribute('aria-pressed') !== 'true';
  t.setAttribute('aria-pressed', on);
  on ? layers[t.dataset.layer].addTo(map) : layers[t.dataset.layer].remove();
});
const setCount = (k, n) => { const el = $(`n-${k}`); if (el) el.textContent = n; };

const markers = new Map();
function incidentPopup(inc) {
  const s = state.byId.get(inc.source_id);
  return `<div class="pop-head">${esc(inc.headline)}</div>
    <div class="pop-meta">${hhmm(inc.opened_at)} · ${esc(s?.short)} · ${esc(inc.location_text || 'location not stated')}${inc.precision === 'source' ? ' (approx.)' : ''}</div>
    <p style="margin:6px 0 0">${esc(inc.summary)}</p>`;
}
function renderIncidentMarkers() {
  layers.incidents.clearLayers();
  markers.clear();
  let n = 0;
  for (const inc of state.incidents.values()) {
    if (inc.lat == null || !inView(inc.source_id)) continue;
    n++;
    const cls = ['stamp', inc.category === 'breaking' && 'breaking', inc.precision === 'source' && 'approx', state.fresh.has(inc.id) && 'fresh'].filter(Boolean).join(' ');
    const m = L.marker([inc.lat, inc.lng], {
      icon: L.divIcon({ className: '', html: `<div class="${cls}">${GLYPH[inc.type] || '•'}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: inc.headline,
      zIndexOffset: inc.category === 'breaking' ? 1000 : 0,
    }).bindPopup(incidentPopup(inc));
    m.on('click', () => select(inc.id, false));
    m.addTo(layers.incidents);
    markers.set(inc.id, m);
  }
  setCount('incidents', n);
}

const PLANE = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2c.6 0 1 .5 1 1.2V9l8 4.5v2l-8-2.3V19l2.2 1.6V22L12 21.2 8.8 22v-1.4L11 19v-5.8L3 15.5v-2L11 9V3.2C11 2.5 11.4 2 12 2z"/></svg>';
const SHIP = '<svg viewBox="0 0 20 20" width="16" height="16"><path fill="currentColor" d="M10 1l5 15-5-3-5 3z"/></svg>';

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status });
  return body;
}
const overlay = (name) => getJson(`/api/overlays/${name}?region=${state.region}`);

async function refreshAircraft() {
  try {
    const list = await overlay('aircraft');
    layers.aircraft.clearLayers();
    for (const a of list) {
      L.marker([a.lat, a.lng], {
        icon: L.divIcon({ className: '', html: `<div class="plane ${a.emergency ? 'emergency' : ''}" style="transform:rotate(${a.track}deg)">${PLANE}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
        keyboard: false,
      }).bindTooltip(`<span class="plane-tag">${esc(a.flight)} ${esc(a.type)} · ${a.alt === 'ground' ? 'GND' : a.alt ? `${Math.round(a.alt / 100)}00 ft` : ''}${a.emergency ? ` · ${esc(a.emergency).toUpperCase()}` : ''}</span>`, { direction: 'right', offset: [10, 0] })
        .addTo(layers.aircraft);
    }
    setCount('aircraft', list.length);
  } catch { setCount('aircraft', '—'); }
}

async function refreshTrains() {
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
  try {
    const list = await overlay('ships');
    layers.ships.clearLayers();
    for (const s of list) {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="ship" style="transform:rotate(${s.course || 0}deg)">${SHIP}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip(`${esc(s.name || s.id)} · ${s.speed ?? '?'} kn`)
        .addTo(layers.ships);
    }
    setCount('ships', list.length || 'key?');
  } catch { setCount('ships', '—'); }
}

async function refreshAlerts() {
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
const playButton = (audio, label, text = '▶ play') => (audio ? `<button class="play" data-src="/audio/${encodeURIComponent(audio)}" data-label="${esc(label)}">${text}</button>` : '');

function renderLog() {
  const log = $('log');
  const list = [...state.incidents.values()].filter((i) => inView(i.source_id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  $('count-incidents').textContent = list.length ? `(${list.length})` : '';

  if (state.tab === 'digest') return renderDigest();

  if (state.tab === 'traffic') {
    const calls = state.calls.filter((c) => inView(c.source_id));
    log.innerHTML = calls.length ? calls.map((c) => {
      const short = state.byId.get(c.source_id)?.short;
      return `
      <li class="traffic ${c.category === 'routine' || !c.category ? 'routine' : ''}">
        <div class="entry-meta"><span>${hhmm(c.at)}</span><span>${esc(short)}</span><span>${Math.round(c.duration || 0)}s</span>
          ${playButton(c.audio, `${hhmm(c.at)} ${short}`)}</div>
        ${esc(c.transcript)}
      </li>`;
    }).join('') : notice();
    return;
  }

  log.innerHTML = list.length ? list.map((inc) => {
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
      <div class="entry-more">
        ${updates.map((u) => `<div class="update"><time>${hhmm(u.at)}</time> ${esc(u.summary)}
          ${u.transcript ? `<p class="transcript">“${esc(u.transcript)}”</p>` : ''}
          ${playButton(u.audio, `${hhmm(u.at)} ${s?.short}`, '▶ play transmission')}</div>`).join('')}
        <div class="entry-meta" style="margin-top:6px"><span>Updated ${ago(inc.updated_at)}</span><span>Confidence ${Math.round((inc.confidence || 0) * 100)}%</span></div>
      </div>
    </li>`;
  }).join('') : notice();
  state.fresh.clear();
}

function notice() {
  const standby = visibleSources().some((s) => s.status?.state === 'standby');
  if (standby) {
    return `<li class="notice"><h2>Receiver in standby</h2>
      Transcription is off because no API key is set. Put <code>OPENROUTER_API_KEY</code> in <code>.env</code> and restart with <code>npm start</code>.
      The map is still live: aircraft, Amtrak, NWS alerts and the tide gauge need no key, and you can tune any station on the dial to listen.</li>`;
  }
  return `<li class="notice"><h2>Quiet on the air</h2>
    Nothing newsworthy in the last 12 hours${state.band !== 'all' ? ' on this band' : ''}. Every transmission is still transcribed; switch to <em>Raw traffic</em> to read it.
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
      ${d.reel ? `<button class="reel play" data-src="/reels/${encodeURIComponent(d.reel)}" data-label="${esc(region?.short)} highlight reel, ${d.date}">▶ Play highlight reel</button>` : ''}
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

function select(id, fly = true) {
  state.selected = state.selected === id && fly ? null : id;
  renderLog();
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
  const day = e.target.closest('[data-date]');
  if (day) return loadDigest(day.dataset.date);
  const entry = e.target.closest('.entry');
  if (entry) select(Number(entry.dataset.id));
});

const TABS = ['incidents', 'traffic', 'digest'];
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
  const es = new EventSource('/api/events');
  es.addEventListener('incident', (e) => {
    const inc = JSON.parse(e.data);
    state.incidents.set(inc.id, inc);
    state.fresh.add(inc.id);
    renderIncidentMarkers();
    renderLog();
  });
  es.addEventListener('call', (e) => {
    const c = JSON.parse(e.data);
    scanEnqueue(c);
    state.calls.unshift(c);
    state.calls.length = Math.min(state.calls.length, 200);
    if (c.source_id === state.tuned?.id) ccLive();
    const lamp = $(`lamp-${c.source_id}`);
    if (lamp) { lamp.classList.remove('blink'); void lamp.offsetWidth; lamp.classList.add('blink'); }
    if (inRegion(c.source_id)) flickEye();
    if (state.tab === 'traffic') renderLog();
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

/* ───────── Boot ───────── */
async function boot() {
  const [config, incidents, calls, digests] = await Promise.all([getJson('/api/config'), getJson('/api/incidents'), getJson('/api/calls'), getJson('/api/digests')]);
  state.regions = config.regions;
  state.sources = config.sources;
  state.station = config.station;
  TZ = config.station.timezone || TZ;
  tick();
  document.querySelector('.badge-script').textContent = config.station.script;
  document.querySelector('.badge-caps').textContent = config.station.caps;
  document.title = `${config.station.script} ${config.station.caps}`;
  $('tab-traffic').hidden = !config.viewer?.transcripts; // the server sends no raw traffic to tunnel visitors
  state.viewer = config.viewer || {};
  if (state.viewer.canShare) setupShareToggle(state.viewer.sharing);
  renderBcfyStatus();
  for (const s of config.sources) state.byId.set(s.id, s);
  for (const i of incidents) state.incidents.set(i.id, i);
  state.calls = calls;
  state.digests = digests;
  ccIdle();
  buildSelector();
  setRegion(location.hash.slice(1) || store.get('pcm.region') || 'all', { fly: false });
  requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(regionBounds(), { padding: [20, 20] }); });
  addEventListener('hashchange', () => setRegion(location.hash.slice(1) || 'all'));
  connect();
  setInterval(refreshAircraft, 15e3);
  setInterval(refreshTrains, 60e3);
  setInterval(refreshShips, 30e3);
  setInterval(refreshAlerts, 5 * 60e3);
  setInterval(refreshTide, 6 * 60e3);
  setInterval(() => { if (state.tab === 'incidents' && state.selected) renderLog(); }, 60e3);
}
boot();
