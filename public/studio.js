// Squelch Studio — client. The owner has it all; guests get what the owner's Guests setting allows (the server enforces it).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (x) => (x == null ? '<span class="na">not metered</span>' : x === 0 ? '$0' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(x < 1 ? 3 : 2)}`);
const secs = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STYLE = { sunday: 'Sunday comic', ink: 'Newspaper ink', pixel: 'Pixel art', vector: 'Flat vector' };
const FORMAT = { 'mp4+web': 'MP4 + web', web: 'Web' };
const PURPOSE = { 'studio:humor': 'humor score', 'studio:script': 'script', 'studio:image': 'panels', 'studio:cartoon': 'cartoon', 'studio:director': 'director', 'studio:render': 'render' };
let ACCESS = 'owner'; // owner | make | watch, from /api/config
const canMake = () => ACCESS === 'owner' || ACCESS === 'make';
let LLM = { llm: 'openrouter', providers: { openrouter: 'OpenRouter', claude: 'Claude subscription' } }; // who writes the script and plan; the server sends its default

async function api(path, opts) {
  const r = await fetch(`/api/studio/${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/* ───────── Suggestions ───────── */
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60e3); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : when(iso); };

function suggestion(s) {
  return `<li class="suggest" data-thread="${s.thread_id}">
    <div class="humor" title="Humor ${Math.round(s.humor * 100)} of 100"><span style="height:${Math.round(s.humor * 100)}%"></span><b>${Math.round(s.humor * 100)}</b></div>
    <div class="suggest-body">
      <p class="pitch">${esc(s.pitch)}</p>
      <p class="anim-sub"><a href="/?story=${s.thread_id}">${esc(s.subject)}</a> · ${esc(s.source_id)} · ${s.clips} clip${s.clips === 1 ? '' : 's'} · ${ago(s.updated_at)}${s.stale ? ' · <i>changed since scored</i>' : ''}</p>
      <p class="why">${esc(s.why)}</p>
      <div class="make"${canMake() ? '' : ' hidden'}>
        <div class="keys" role="group" aria-label="Style">${Object.entries(STYLE).map(([k, n]) => `<button type="button" class="key" data-style="${k}" aria-pressed="${k === 'sunday'}">${n}${k === 'vector' ? ' cartoon' : ''}</button>`).join('')}</div>
        ${ACCESS === 'owner' ? `<div class="keys" role="group" aria-label="Plan with" title="Who writes the script and the cartoon's plan">${Object.entries(LLM.providers).map(([k, n]) => `<button type="button" class="key" data-llm="${k}" aria-pressed="${k === LLM.llm}">${esc(n)}</button>`).join('')}</div>` : ''}
        <label class="notes"><span>Your notes for the artist <i class="na">(optional)</i></span>
          <textarea maxlength="400" rows="2" placeholder="Make the dogs wear tiny hats; keep it gentle" data-notes></textarea>
          <span class="notes-foot"><span class="na">Colour and detail ideas only; it can’t change the facts or the rules.</span><span class="na" data-count>0 / 400</span></span></label>
        <div class="keys"><button type="button" class="key" data-make>Make it</button></div>
      </div>
      <div class="quote" hidden></div>
    </div>
  </li>`;
}

function renderSuggestions(j) {
  const r = j.refresh;
  if (j.providers) LLM = { llm: j.llm, providers: j.providers };
  $('suggest-note').innerHTML = `${j.scored} of ${j.candidates} light stories from the last 48 h scored${j.unscored && ACCESS === 'owner' ? `, ${j.unscored} new or changed (Refresh scores them)` : ''}.
    ${r ? `<b>This refresh: ${r.scored} scored for ${usd(r.cost)}.</b>` : ''} Studio spend today ${usd(j.today)} of ${usd(j.cap)}.`;
  $('suggests').innerHTML = j.top.length ? j.top.map(suggestion).join('') : '<li class="empty">Nothing scored yet. Refresh scores the last 48 hours (a cent or two).</li>';
  const out = $('kept-out');
  out.hidden = !j.excluded.length; // the owner's: guests are sent none
  out.querySelector('summary').textContent = `Kept out by the content guard (${j.excluded.length})`;
  out.querySelector('ul').innerHTML = j.excluded.map((e) => `<li><a href="/?story=${e.id}">${esc(e.subject)}</a> <span class="na">· ${esc(e.reason)}</span></li>`).join('');
}

async function loadSuggestions(refresh) {
  const key = $('suggest-refresh');
  key.disabled = true;
  if (refresh) key.textContent = 'Scoring…';
  try { renderSuggestions(await api(refresh ? 'suggestions/refresh' : 'suggestions', refresh ? { method: 'POST' } : undefined)); }
  catch (e) { $('suggest-note').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  finally { key.disabled = false; key.textContent = 'Refresh'; }
}
$('suggest-refresh').addEventListener('click', () => loadSuggestions(true));

// Make it: pick a style, see the estimate, then queue.
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
$('suggests').addEventListener('input', (e) => {
  const t = e.target.closest('[data-notes]');
  if (t) t.closest('.notes').querySelector('[data-count]').textContent = `${t.value.length} / 400`;
});
$('suggests').addEventListener('click', async (e) => {
  const li = e.target.closest('.suggest');
  if (!li) return;
  const quote = li.querySelector('.quote');
  const style = e.target.closest('[data-style]');
  if (style) { for (const b of li.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', String(b === style)); quote.hidden = true; return; }
  const llm = e.target.closest('[data-llm]');
  if (llm) { for (const b of li.querySelectorAll('[data-llm]')) b.setAttribute('aria-pressed', String(b === llm)); quote.hidden = true; return; }
  const body = { thread_id: Number(li.dataset.thread), style: li.querySelector('[data-style][aria-pressed="true"]').dataset.style, llm: li.querySelector('[data-llm][aria-pressed="true"]')?.dataset.llm, notes: li.querySelector('[data-notes]').value };
  if (e.target.closest('[data-make]')) {
    quote.hidden = false;
    quote.innerHTML = '<span class="na">Pricing it…</span>';
    try {
      const q = await post('estimate', body);
      quote.innerHTML = `<p><b>${q.kind === "comic" ? "Comic" : "Cartoon"}, ${esc(STYLE[q.style].toLowerCase())}</b> · ${esc(FORMAT[q.format])} · planned with ${esc(q.llmName)} · about <b>${usd(q.usd)}</b>
        <span class="na">(${q.lines.map((l) => `${PURPOSE[l.purpose]}${l.calls ? ` ×${l.calls}` : ''} ${usd(l.usd)}`).join(' · ')})</span></p>
        <p class="na">${esc(q.note)} Studio spend today ${usd(q.today)} of ${usd(q.cap)}.</p>
        ${q.fits ? '<div class="keys"><button type="button" class="key" data-queue>Queue it</button></div>' : `<p class="err">That would pass today’s cap (STUDIO_DAILY_USD).</p>`}`;
    } catch (err) { quote.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  }
  if (e.target.closest('[data-queue]')) {
    try { mine.add((await post('jobs', { ...body, endpoint: await pushEndpoint() })).id); quote.hidden = true; loadJobs(); } catch (err) { quote.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  }
});

/* ───────── Jobs ───────── */
// This browser's push endpoint, if it has notifications on: sent with a job so the server can tell this browser when it finishes.
const pushEndpoint = async () => { try { return (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.endpoint; } catch { return undefined; } };
const mine = new Set(); // ids of the jobs queued from this tab
let polling = 0, seenJobs = new Map();
let toastTimer = 0;
function toast(a) {
  const t = $('studio-toast');
  t.textContent = a.status === 'done' ? `Your animation is ready: ${a.title}` : `Couldn’t make ${a.title}`;
  t.dataset.id = a.id;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 12e3);
}
$('studio-toast').addEventListener('click', (e) => { e.currentTarget.hidden = true; showCard(e.currentTarget.dataset.id); });
async function loadJobs() {
  clearTimeout(polling);
  if (!canMake()) return;
  const { jobs } = await api('jobs').catch(() => ({ jobs: [] }));
  $('jobs-page').hidden = !jobs.length;
  $('jobs').innerHTML = jobs.map((j) => `<li class="job">
    <b>${esc(j.title)}</b> <span class="na">· ${esc(STYLE[j.style])}</span>
    <span class="job-step">${j.status === 'queued' ? 'Waiting its turn' : esc(j.progress?.step || 'Starting')}${j.progress?.frac != null ? ` · ${Math.round(j.progress.frac * 100)}%` : ''}</span>
    <span class="job-bar"><span style="width:${j.progress?.frac != null ? Math.round(j.progress.frac * 100) : 0}%"></span></span>
  </li>`).join('');
  const gone = [...seenJobs.keys()].filter((id) => !jobs.some((j) => j.id === id));
  seenJobs = new Map(jobs.map((j) => [j.id, j]));
  if (gone.length) {
    const list = await loadLibrary();
    // Mine only: the owner's own jobs, or what a guest queued from this tab. (Another guest's job is none of theirs.)
    for (const a of list) if (gone.includes(a.id) && (a.status === 'done' || a.status === 'failed') && (ACCESS === 'owner' ? a.requested_by === 'owner' : mine.has(a.id))) toast(a);
  }
  if (jobs.length) polling = setTimeout(loadJobs, 2000);
}

/* ───────── Library ───────── */
// An installed phone app has no back button, and a plain download there strands it on a blank or file page.
// So there the key fetches the file first, then a second tap hands it to the share sheet (Save Video, Save to Files…).
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const dlKey = (a, f) => standalone
  ? `<button type="button" class="key" data-save="${fileUrl(a, f)}" data-name="squelch-${a.id}-${esc(f.name)}">${f.kind === 'mp4' ? 'MP4' : 'HTML'} <span class="na">${mb(f.bytes)}</span></button>`
  : `<a class="key" href="${fileUrl(a, f, true)}" download>${f.kind === 'mp4' ? 'MP4' : 'HTML'} <span class="na">${mb(f.bytes)}</span></a>`;
const fileUrl = (a, f, dl) => `/api/studio/animations/${a.id}/files/${encodeURIComponent(f.name)}${dl ? '?download' : ''}`;
const blobUrl = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return URL.createObjectURL(await r.blob());
};
const playable = (a) =>({ mp4: a.files.find((f) => f.kind === 'mp4'), web: a.files.find((f) => f.kind === 'web') });

function player(a) {
  const { mp4, web } = playable(a);
  // An installed iPhone app's video player loads without the site's login, so there the page fetches the file and plays it from memory.
  const still = `/api/studio/animations/${a.id}/poster.jpg`;
  if (mp4 && standalone) return `<button type="button" class="anim-poster" data-blob="${fileUrl(a, mp4)}"><img src="${still}" alt="" loading="lazy"><span class="key">Play <span class="na">${mb(mp4.bytes)}</span></span></button>`;
  if (mp4) return `<video class="anim-video" controls playsinline preload="metadata" poster="${still}" src="${fileUrl(a, mp4)}"></video>`;
  // Web pages carry their audio and art inline (often a megabyte or more), so they load on demand.
  if (web) return `<button type="button" class="anim-poster" data-web="${fileUrl(a, web)}"><span class="key">Play</span></button>`;
  return `<div class="anim-poster"><span class="na">${a.status === 'failed' ? 'Failed' : 'Nothing to play yet'}</span></div>`;
}

const stars = (a) => `<div class="stars" role="group" aria-label="${ACCESS === 'owner' ? 'Rating' : 'Your rating'}">${[1, 2, 3, 4, 5].map((n) =>
  `<button type="button" data-rate="${n}" aria-label="${n} of 5" aria-pressed="${a.rating >= n}">${a.rating >= n ? '★' : '☆'}</button>`).join('')}</div>`;

function card(a) {
  const { mp4, web } = playable(a);
  const models = a.models.length ? a.models.map((m) => `<li>${esc(m.model)} <span class="na">· ${esc(PURPOSE[m.purpose] || m.purpose)} · ${m.calls} call${m.calls === 1 ? '' : 's'}</span> ${usd(m.cost)}${m.notional_usd != null ? ` <span class="na">(notional ${usd(m.notional_usd)}${m.ms ? `, ${Math.round(m.ms / 1000)} s` : ''})</span>` : ''}</li>`).join('') : '<li class="na">none recorded</li>';
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
        ${a.instructions ? `<dt>Artist notes</dt><dd>${esc(a.instructions)}</dd>` : a.has_instructions ? '<dt>Artist notes</dt><dd class="na">custom notes: yes</dd>' : ''}
        <dt>${ACCESS === 'owner' ? 'Rating' : 'Your rating'}</dt><dd>${stars(a)}${a.guest_ratings ? ` <span class="na">· guests ${a.guest_ratings.avg} of 5 (${a.guest_ratings.n})</span>` : ''}</dd>
        <dt>Asked by</dt><dd>${esc(a.requested_by || 'owner')}</dd>
      </dl>
      <div class="anim-actions">
        ${a.files.filter((f) => f.kind === 'mp4' || f.kind === 'web').map((f) => dlKey(a, f)).join('')}
        ${ACCESS === 'owner' ? '<button type="button" class="key danger" data-delete>Delete</button>' : ''}
      </div>
    </div>
  </li>`;
}

async function loadLibrary() {
  const list = await api('animations');
  $('library').innerHTML = list.length ? list.map(card).join('') : `<li class="empty">Nothing yet.${canMake() ? ' Make one from a suggestion above.' : ''}</li>`;
  return list;
}

// A notification (or the toast) opens /manual.html#studio-<id>: scroll to that card and flash it.
function showCard(id) {
  const li = $('library').querySelector(`.anim[data-id="${CSS.escape(String(id))}"]`);
  if (!li) return false;
  li.scrollIntoView({ block: 'start' });
  li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
  return true;
}
const linked = () => /^#studio-(\d+)$/.exec(location.hash)?.[1];
addEventListener('hashchange', () => { const id = linked(); if (id && !showCard(id)) loadLibrary().then(() => showCard(id)); });

$('library').addEventListener('click', async (e) => {
  const li = e.target.closest('.anim');
  if (!li) return;
  const id = li.dataset.id;
  const blob = e.target.closest('[data-blob]');
  if (blob) {
    const label = blob.innerHTML;
    blob.disabled = true;
    blob.querySelector('.key').textContent = 'Loading…';
    try {
      blob.outerHTML = `<video class="anim-video" controls playsinline autoplay src="${await blobUrl(blob.dataset.blob)}"></video>`;
    } catch { blob.innerHTML = label; blob.disabled = false; }
    return;
  }
  const web = e.target.closest('[data-web]');
  if (web) {
    const src = standalone ? await blobUrl(web.dataset.web).catch(() => web.dataset.web) : web.dataset.web;
    // Sandboxed: a generated page gets scripts but no access to this origin.
    li.querySelector('.anim-play').innerHTML = `<iframe class="anim-frame" sandbox="allow-scripts" allow="autoplay" src="${src}" title="Animation"></iframe>`;
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
  const save = e.target.closest('[data-save]');
  if (save) {
    if (save.file) { navigator.share({ files: [save.file] }).catch(() => {}); return; }
    const label = save.innerHTML;
    save.disabled = true;
    save.textContent = 'Getting it…';
    try {
      const r = await fetch(save.dataset.save);
      if (!r.ok) throw new Error(r.status);
      const blob = await r.blob();
      const file = new File([blob], save.dataset.name, { type: blob.type });
      if (!navigator.canShare?.({ files: [file] })) { location.href = save.dataset.save; return; }
      save.file = file;
      save.textContent = 'Tap to save';
    } catch { save.innerHTML = label; } finally { save.disabled = false; }
    return;
  }
  if (e.target.closest('[data-delete]')) {
    if (!confirm(`Delete “${li.querySelector('h3').textContent}” and its files? This can’t be undone.`)) return;
    try { await api(`animations/${id}`, { method: 'DELETE' }); li.remove(); } catch (err) { alert(err.message); }
  }
});

// The owner's three-way control for what guests may do here.
const GUESTS = {
  off: 'Guests don’t see the Studio.',
  watch: 'Guests can play and rate what’s in the library, and see the suggestions. They can’t make anything.',
  make: 'Guests can also make animations: 2 each per day, always planned with OpenRouter, counted against the daily Studio cap. Each costs you roughly $0.10–0.20.',
};
function guestControl(cur) {
  $('guest-control').hidden = false;
  const draw = (v) => {
    $('guest-keys').innerHTML = Object.keys(GUESTS).map((k) => `<button type="button" class="key" data-guests="${k}" aria-pressed="${k === v}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
    $('guest-note').textContent = GUESTS[v];
  };
  draw(cur);
  $('guest-keys').addEventListener('click', async (e) => {
    const k = e.target.closest('[data-guests]')?.dataset.guests;
    if (!k) return;
    try { const s = await post('../settings', { guestStudio: k }); draw(s.guestStudio); } catch (err) { $('guest-note').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  });
}

fetch('/api/config').then((r) => r.json()).then((c) => {
  TZ = c.station?.timezone || TZ;
  ACCESS = c.viewer?.studio || 'owner';
  if (ACCESS === 'owner') guestControl(c.viewer.guestStudio || 'off'); else $('suggest-refresh').parentElement.style.display = 'none';
  if (!c.viewer?.transcripts) $('h-suggest').closest('section').hidden = true; // suggestions are built from transcripts
}).catch(() => {}).finally(() => { if (!$('h-suggest').closest('section').hidden) loadSuggestions(false); loadLibrary().then(() => { const id = linked(); if (id) showCard(id); }); loadJobs(); });
