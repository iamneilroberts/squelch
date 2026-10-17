// Squelch Studio — client. Owner-only; the server refuses everyone else.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (x) => (x == null ? '<span class="na">not metered</span>' : x === 0 ? '$0' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(x < 1 ? 3 : 2)}`);
const secs = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STYLE = { sunday: 'Sunday comic', ink: 'Newspaper ink', pixel: 'Pixel art', vector: 'Flat vector' };
const FORMAT = { 'mp4+web': 'MP4 + web', web: 'Web' };
const PURPOSE = { 'studio:humor': 'humor score', 'studio:script': 'script', 'studio:image': 'panels', 'studio:cartoon': 'cartoon' };

async function api(path, opts) {
  const r = await fetch(`/api/studio/${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/* ───────── Library ───────── */
const fileUrl = (a, f, dl) => `/api/studio/animations/${a.id}/files/${encodeURIComponent(f.name)}${dl ? '?download' : ''}`;
const playable = (a) => ({ mp4: a.files.find((f) => f.kind === 'mp4'), web: a.files.find((f) => f.kind === 'web') });

function player(a) {
  const { mp4, web } = playable(a);
  if (mp4) return `<video class="anim-video" controls playsinline preload="metadata" src="${fileUrl(a, mp4)}"></video>`;
  // Web pages carry their audio and art inline (often a megabyte or more), so they load on demand.
  if (web) return `<button type="button" class="anim-poster" data-web="${fileUrl(a, web)}"><span class="key">Play</span></button>`;
  return `<div class="anim-poster"><span class="na">${a.status === 'failed' ? 'Failed' : 'Nothing to play yet'}</span></div>`;
}

const stars = (a) => `<div class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) =>
  `<button type="button" data-rate="${n}" aria-label="${n} of 5" aria-pressed="${a.rating >= n}">${a.rating >= n ? '★' : '☆'}</button>`).join('')}</div>`;

function card(a) {
  const { mp4, web } = playable(a);
  const models = a.models.length ? a.models.map((m) => `<li>${esc(m.model)} <span class="na">· ${esc(PURPOSE[m.purpose] || m.purpose)} · ${m.calls} call${m.calls === 1 ? '' : 's'}</span> ${usd(m.cost)}</li>`).join('') : '<li class="na">none recorded</li>';
  return `<li class="anim" data-id="${a.id}">
    <div class="anim-play">${player(a)}${mp4 && web ? `<button type="button" class="linkish" data-web="${fileUrl(a, web)}">Play the web version</button>` : ''}</div>
    <div class="anim-meta">
      <h3>${esc(a.title)}</h3>
      <p class="anim-sub">${esc(STYLE[a.style] || a.style)} · ${esc(FORMAT[a.format] || a.format)} · ${when(a.created_at)}${a.status !== 'done' ? ` · <b class="st-${a.status}">${a.status}</b>` : ''}</p>
      ${a.error ? `<p class="err">${esc(a.error)}</p>` : ''}
      <dl class="story-facts">
        <dt>Cost</dt><dd>${usd(a.cost_usd)}</dd>
        <dt>Length</dt><dd>${secs(a.duration_s)}${a.render_s != null ? ` <span class="na">· rendered in ${secs(a.render_s)}</span>` : ""}</dd>
        <dt>Models</dt><dd><ul class="anim-models">${models}</ul></dd>
        ${a.prompt_version ? `<dt>Prompt</dt><dd>${esc(a.prompt_version)}</dd>` : ''}
        ${a.thread_id ? `<dt>Story</dt><dd><a href="/?story=${a.thread_id}">#${a.thread_id}${a.source_id ? ` · ${esc(a.source_id)}` : ''}</a></dd>` : ''}
        ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ''}
        <dt>Rating</dt><dd>${stars(a)}</dd>
      </dl>
      <div class="anim-actions">
        ${a.files.filter((f) => f.kind === 'mp4' || f.kind === 'web').map((f) => `<a class="key" href="${fileUrl(a, f, true)}" download>${f.kind === 'mp4' ? 'MP4' : 'HTML'} <span class="na">${mb(f.bytes)}</span></a>`).join('')}
        <button type="button" class="key danger" data-delete>Delete</button>
      </div>
    </div>
  </li>`;
}

async function loadLibrary() {
  const list = await api('animations');
  $('library').innerHTML = list.length ? list.map(card).join('') : '<li class="empty">Nothing yet. Make one from a suggestion above.</li>';
}

$('library').addEventListener('click', async (e) => {
  const li = e.target.closest('.anim');
  if (!li) return;
  const id = li.dataset.id;
  const web = e.target.closest('[data-web]');
  if (web) {
    // Sandboxed: a generated page gets scripts but no access to this origin.
    li.querySelector('.anim-play').innerHTML = `<iframe class="anim-frame" sandbox="allow-scripts" allow="autoplay" src="${web.dataset.web}" title="Animation"></iframe>`;
    return;
  }
  const rate = e.target.closest('[data-rate]');
  if (rate) {
    const n = Number(rate.dataset.rate);
    const cur = li.querySelectorAll('[data-rate][aria-pressed="true"]').length;
    const a = await api(`animations/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating: n === cur ? null : n }) });
    li.querySelector('.stars').outerHTML = stars(a);
    return;
  }
  if (e.target.closest('[data-delete]')) {
    if (!confirm(`Delete “${li.querySelector('h3').textContent}” and its files? This can’t be undone.`)) return;
    try { await api(`animations/${id}`, { method: 'DELETE' }); li.remove(); } catch (err) { alert(err.message); }
  }
});

fetch('/api/config').then((r) => r.json()).then((c) => { TZ = c.station?.timezone || TZ; }).catch(() => {}).finally(loadLibrary);
