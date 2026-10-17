// /s/<id>: one story, playable without the app. The server embeds the story (src/share.mjs); transcripts and
// caption links are only in it when this visitor may see them.
const s = JSON.parse(document.getElementById('story-data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: s.station.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
const words = (text) => String(text || '').split(/\s+/).filter(Boolean);
const PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
const STOP = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8"/></svg>';

$('why').textContent = s.why || '';
$('facts').innerHTML = s.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('');
$('open-app').href = `/?story=${s.id}`;
$('fine').textContent = [`Times are ${s.station.timezone.replace(/_/g, ' ')} time.`, s.events.some((e) => !e.audio) && 'Recordings are kept for 7 days; the notes stay for 30.'].filter(Boolean).join(' ');

// Where it happened.
if (s.place && window.L) {
  $('where').hidden = false;
  const map = L.map('map', { scrollWheelZoom: false, attributionControl: true }).setView([s.place.lat, s.place.lng], s.place.approx ? 11 : 15);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, EPA, NPS · © OpenStreetMap contributors',
  }).addTo(map);
  if (s.place.approx) L.circle([s.place.lat, s.place.lng], { radius: 2500, color: '#a3271b', weight: 2, fillOpacity: 0.08 }).addTo(map);
  else L.marker([s.place.lat, s.place.lng], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [18, 18] }), keyboard: false }).addTo(map);
  $('place').textContent = s.place.approx ? `Roughly here: ${s.place.label || 'the channel’s area'} (the exact spot wasn’t given).` : s.place.label || '';
}

// The transmissions, oldest first: the story's timeline of notes, each playable.
const clips = s.events.map((e, i) => ({ ...e, i }));
const playable = clips.filter((c) => c.audio);
$('play-all').hidden = !playable.length;
$('play-all').textContent = `Play all · ${playable.length}`;
$('log').innerHTML = clips.map((c) => `<li id="t${c.i}">
  <time datetime="${esc(c.at)}">${hhmm(c.at)}</time>
  <div><p class="note">${esc(c.note || 'Radio traffic')}</p>${c.transcript ? `<details class="said"><summary>Transcript</summary><p>“${esc(c.transcript)}”</p></details>` : ''}${c.audio ? '' : '<p class="gone">Recording expired</p>'}</div>
  ${c.audio ? `<button type="button" data-i="${c.i}" aria-pressed="false" aria-label="Play the ${hhmm(c.at)} transmission">${PLAY}</button>` : '<span></span>'}
</li>`).join('');

const idle = () => {
  $('caption').innerHTML = `<span class="note">${s.transcripts ? 'Captions follow the radio, word by word, when a transmission plays.' : 'Transcripts are private on this receiver: you’ll hear the radio and read its notes.'}</span>`;
};
idle();

// Captions: WebVTT line cues, revealed a word at a time across each cue's span.
async function cuesFor(c) {
  if (!c.captions) return null;
  c.cues ??= fetch(c.captions).then((r) => (r.ok ? r.text() : '')).then((vtt) => [...vtt.matchAll(/([\d:.]+) --> ([\d:.]+)[^\n]*\n([\s\S]*?)(?:\n\n|$)/g)]
    .map((m) => ({ start: secs(m[1]), end: secs(m[2]), words: words(m[3]) }))).catch(() => { c.cues = undefined; return null; }); // retried next time
  return c.cues;
}
const secs = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);

const player = $('player');
let queue = [], current = null, cues = null, frame = 0;

function drawCaption() {
  if (!current) return;
  const label = `<span class="label">${current.i + 1} of ${clips.length} · ${hhmm(current.at)} · ${esc(s.channel.short)}</span>`;
  if (cues?.length) {
    const t = player.currentTime;
    $('caption').innerHTML = label + cues.flatMap((q) => q.words.map((w, k) => {
      const on = t >= q.start + (k / q.words.length) * (q.end - q.start);
      return `<span class="w${on ? ' on' : ''}">${esc(w)}</span>`;
    })).join(' ');
    const last = [...$('caption').querySelectorAll('.w.on')].at(-1); // keep the word being said in view
    if (last) $('caption').scrollTop = Math.max(0, last.offsetTop - $('caption').clientHeight / 2);
  } else {
    $('caption').innerHTML = label + (current.transcript ? esc(current.transcript) : `<span class="note">${esc(current.note || 'Radio traffic')}</span>`);
  }
}
function tick() { drawCaption(); frame = player.paused ? 0 : requestAnimationFrame(tick); }

async function play(c) {
  current = c;
  cues = null;
  document.querySelectorAll('.log li').forEach((li) => li.classList.toggle('now', li.id === `t${c.i}`));
  document.querySelectorAll('.log button').forEach((b) => { const on = Number(b.dataset.i) === c.i; b.setAttribute('aria-pressed', String(on)); b.innerHTML = on ? STOP : PLAY; });
  $(`t${c.i}`).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  player.src = c.audio;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: `${hhmm(c.at)} · ${c.note || 'Radio traffic'}`, artist: `${s.channel.short}: ${s.subject}`, album: s.station.script });
  drawCaption();
  // A failed load moves on to the next transmission; an AbortError only means another clip took over.
  player.play().catch((e) => { if (current === c && e.name !== 'AbortError') next(); });
  const q = await cuesFor(c);
  if (current === c) { cues = q; drawCaption(); }
}
const next = () => { const n = queue.shift(); if (n) play(n); else stop(); };
function stop() {
  player.pause();
  queue = [];
  current = null;
  document.querySelectorAll('.log li').forEach((li) => li.classList.remove('now'));
  document.querySelectorAll('.log button').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.innerHTML = PLAY; });
  $('play-all').textContent = `Play all · ${playable.length}`;
  idle();
}
// The key shows what a tap does, also after a pause or play from the lock screen.
const keyFor = (on) => { const b = current && document.querySelector(`.log button[data-i="${current.i}"]`); if (b) b.innerHTML = on ? STOP : PLAY; };
player.addEventListener('play', () => { cancelAnimationFrame(frame); tick(); keyFor(true); });
player.addEventListener('pause', () => keyFor(false));
player.addEventListener('ended', next);
if ('mediaSession' in navigator) navigator.mediaSession.setActionHandler('nexttrack', () => { if (queue.length) next(); });

$('play-all').addEventListener('click', () => {
  if (queue.length || current) return stop();
  queue = playable.slice(1);
  $('play-all').textContent = 'Stop';
  play(playable[0]);
});
$('log').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const c = clips[Number(b.dataset.i)];
  if (current === c && player.paused) return void player.play().catch(() => {}); // paused from the lock screen: resume
  if (current === c) return stop();
  queue = [];
  $('play-all').textContent = 'Stop';
  play(c);
});

// Share: the phone's share sheet, else copy the link.
$('share').addEventListener('click', async () => {
  const url = s.url;
  const title = `${s.channel.short}: ${s.subject}`;
  if (navigator.share) return navigator.share({ title, url }).catch(() => {});
  try { await navigator.clipboard.writeText(url); } catch { return void prompt('Copy this link', url); }
  $('share').textContent = 'Link copied';
  setTimeout(() => { $('share').textContent = 'Share this story'; }, 2500);
});
