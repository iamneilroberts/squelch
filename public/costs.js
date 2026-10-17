// Station Ledger — client.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
fetch('/api/config').then((r) => r.json()).then((c) => { TZ = c.station?.timezone || TZ; }).catch(() => {});
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const usd = (x) => (x == null ? '<span class="na">price n/a</span>' : x === 0 ? '$0' : x < 0.0001 ? '&lt;$0.0001' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const ms = (x) => (x == null ? '—' : x < 1000 ? `${x} ms` : `${(x / 1000).toFixed(1)} s`);
const num = (x) => (x == null ? '—' : x.toLocaleString('en-US'));
const pct = (x) => `${Math.round(x * 100)}%`;
const PURPOSE = { transcribe: 'Speech-to-text', triage: 'Incident triage', gate: 'Jev gate', digest: 'Daily digest', geocode: 'Geocoder', vad: 'Speech detector (local)', thread: 'Channel story', push: 'Push notification', 'listener-surge': 'Listener-surge look' };
const label = (p) => PURPOSE[p] || (p.startsWith('overlay:') ? `Map layer · ${p.slice(8)}` : p);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let hours = Number(store.get('ledger.hours')) || 24;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function renderBalance(c) {
  const rows = c.rows;
  const ai = rows.filter((r) => r.kind !== 'http');
  const api = rows.filter((r) => r.kind === 'http');
  const spent = ai.reduce((a, r) => a + (r.cost || 0), 0);
  const unpriced = ai.reduce((a, r) => a + (r.unpriced || 0), 0);
  const calls = (rs) => rs.reduce((a, r) => a + r.n, 0);
  const perDay = c.coveredHours ? spent / (c.coveredHours / 24) : 0;
  const basis = c.coveredHours < c.hours - 0.05 ? ` <span class="na">(from ${c.coveredHours < 1 ? `${Math.round(c.coveredHours * 60)} min` : `${c.coveredHours.toFixed(1)} h`} of data)</span>` : '';
  $('balance').innerHTML = `
    <div class="total"><dt>Spent, last ${c.hours >= 48 ? `${c.hours / 24} days` : `${c.hours} h`}</dt><dd>${usd(spent)}</dd></div>
    <div><dt>Radio clips processed</dt><dd>${num(c.clips)}</dd></div>
    <div><dt>Cost per clip</dt><dd>${c.clips ? usd(spent / c.clips) : '—'}</dd></div>
    <div><dt>AI calls</dt><dd>${num(calls(ai))}</dd></div>
    <div><dt>API calls (free)</dt><dd>${num(calls(api))}</dd></div>
    <div><dt>At this rate, per 30 days${basis}</dt><dd>${usd(perDay * 30)}</dd></div>
    ${unpriced ? `<div class="note"><dt>${unpriced} AI call${unpriced > 1 ? 's' : ''} came back without a price, so the total is a known subtotal.</dt></div>` : ''}`;
}

function renderAccounts(c) {
  const rows = c.rows;
  const total = rows.reduce((a, r) => a + (r.cost || 0), 0);
  if (!rows.length) { $('accounts').innerHTML = '<tr><td class="empty">No calls in this period.</td></tr>'; return; }
  $('accounts').innerHTML = `
    <thead><tr><th>Kind</th><th>Purpose</th><th>Model / service</th><th class="num">Calls</th><th class="num">p50</th><th class="num">p95</th><th class="num">Tokens in</th><th class="num">out</th><th class="num">Cost</th><th>Share</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><span class="kind ${r.kind}">${r.kind}</span></td>
      <td>${esc(label(r.purpose))}</td>
      <td>${esc(r.model || r.provider || '—')}</td>
      <td class="num">${num(r.n)}${r.errors ? ` <span class="err" title="failed calls">(${r.errors}✕)</span>` : ''}</td>
      <td class="num">${ms(r.p50)}</td><td class="num">${ms(r.p95)}</td>
      <td class="num">${num(r.in_tok)}</td><td class="num">${num(r.out_tok)}</td>
      <td class="num">${r.kind === 'http' || r.kind === 'local' ? 'free' : usd(r.cost)}</td>
      <td class="share">${total && r.cost ? `<span style="width:${(r.cost / total) * 100}%"></span>` : ''}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="8">Total</td><td class="num">${usd(total)}</td><td></td></tr></tfoot>`;
}

function renderGate(g, c) {
  const jev = c.rows.filter((r) => r.purpose === 'gate');
  const jevCost = jev.reduce((a, r) => a + (r.cost || 0), 0);
  const triage = c.rows.filter((r) => r.purpose === 'triage');
  const triageCost = triage.reduce((a, r) => a + (r.cost || 0), 0);
  const triageN = triage.reduce((a, r) => a + r.n, 0);
  document.getElementById('h-gate').textContent = `Jev gate · ${g.mode}`;
  const a = g.active;
  const activeLines = g.mode === 'active' ? `
    <div class="gate-line">Policy: drop clips with speech p &lt; ${g.speechBelow}; skip triage when newsworthy p &lt; ${g.skipBelow}; triage ${pct(g.auditRate)} of skips anyway as an audit.</div>
    <div class="gate-line">Sent to triage <strong>${num(a.pass)}</strong> · skipped <strong>${num(a.skip)}</strong> · dropped as not speech <strong>${num(a.dropped)}</strong></div>
    <div class="gate-line">Audit: ${num(a.audit)} skipped call${a.audit === 1 ? '' : 's'} triaged anyway, ${a.auditMissed ? `<span class="err">${a.auditMissed} turned out to be incidents</span>` : '0 turned out to be incidents'}.</div>` : '';
  if (!g.n && !activeLines) { $('gate').innerHTML = '<p class="empty">No gated transmissions in this period yet.</p>'; return; }
  $('gate').innerHTML = activeLines + (!g.n ? '' : `
    <div class="gate-line">On <strong>${num(g.n)}</strong> triaged transmissions, Jev's newsworthy call (p ≥ 0.5) matched the LLM triage <strong>${pct(g.agree / g.n)}</strong> of the time.</div>
    <div class="gate-line">Jev said newsworthy, LLM said routine: ${g.jevOnly}. LLM said newsworthy, Jev said routine: ${g.llmOnly}.</div>
    <div class="gate-line">Flagged as not real speech (p &lt; 0.3): ${g.lowSpeech}.</div>
    <div class="gate-line">Jev cost ${usd(jevCost)} for these, against ${usd(triageCost)} for LLM triage.</div>
    <table class="gate-table">
      <thead><tr><th>If the gate skipped triage below</th><th>LLM calls saved</th><th>LLM incidents missed</th><th>Triage $ saved</th></tr></thead>
      <tbody>${g.thresholds.map((x) => `<tr><td>p &lt; ${x.t}</td><td>${pct(x.skipped)}</td><td>${x.missed ? `<span class="err">${x.missed}</span>` : 0}</td><td>${triageN ? usd(triageCost * x.skipped) : '—'}</td></tr>`).join('')}</tbody>
    </table>`);
}

function renderVad(v) {
  $('h-vad').textContent = `Speech detector · ${v.mode}`;
  const q = v.squelch;
  const squelch = q && (q.dropped || q.transcribed)
    ? `<div class="gate-line">Adaptive squelch dropped <strong>${num(q.dropped)}</strong> clips before transcription (${pct(q.share)} of clips) — about <strong>${usd(q.saved)}</strong> of speech-to-text not spent${q.byFeed.length ? ` · ${q.byFeed.map((r) => `${esc(r.source_id)} ${r.n}`).join(', ')}` : ''}.</div>`
    : '';
  if (!v.clips) { $('vad').innerHTML = squelch || '<p class="empty">No scored clips in this period yet.</p>'; return; }
  const active = v.mode === 'active'
    ? `<div class="gate-line">Skipping transcription below <strong>${v.minSpread} dB</strong> loudness spread (${pct(v.auditRate)} of quiet clips still transcribed as an audit). Skipped <strong>${num(v.skipped)}</strong> of ${num(v.clips)} clips, saving about <strong>${usd(v.savedActive)}</strong>.</div>`
    : `<div class="gate-line">Scoring every clip, transcribing all of them. ${num(v.transcribed)} clips, transcription spend ${usd(v.sttSpend)} (${usd(v.avgStt)} per clip).</div>`;
  $('vad').innerHTML = `${squelch}${active}
    <table class="gate-table">
      <thead><tr><th>Skip STT below</th><th>Clips skipped</th><th>STT $ saved</th><th>Kept transmissions lost</th><th>Incidents lost</th></tr></thead>
      <tbody>${v.thresholds.map((x) => `<tr${x.t === v.minSpread ? ' style="font-weight:700"' : ''}><td>${x.t} dB</td><td>${pct(x.skipped)}</td><td>${usd(x.saved)}</td><td>${x.lostCalls}</td><td>${x.lostIncidents ? `<span class="err">${x.lostIncidents}</span>` : 0}</td></tr>`).join('')}</tbody>
    </table>
    <p class="hint" style="margin-top:8px">Measured on clips that were transcribed. "Lost" counts clips under the cutoff that still produced a transcript kept after filtering, or an incident.</p>`;
}

// One line per trace, saying what the transmission was about: its story or incident, else the start
// of what was said. Tapping a line opens its card.
let traces = [];
const what = (t) => t.subject || t.headline || t.transcript || null;

function renderTraces(list) {
  traces = list;
  if (!list.length) { $('traces').innerHTML = '<li class="empty">No traces yet. They appear as soon as a clip is transcribed.</li>'; return; }
  $('traces').innerHTML = list.map((t) => {
    const desc = t.kind === 'digest' ? `<b>Daily log</b> ${esc(t.label)}`
      : `<b class="snip-feed">${esc(t.label)}</b> ${what(t) ? esc(what(t)) : '<i>no speech kept</i>'}`;
    const notable = t.category && t.category !== 'routine';
    return `<li><button type="button" class="trace${notable ? ' notable' : ''}" data-id="${t.id}">
      <span>${hhmm(t.at)}</span><span class="feed">${esc(t.kind === 'digest' ? 'digest' : t.label)}</span><span class="snip">${desc}</span><span class="ms">${ms(t.ms)}</span><span class="usd">${usd(t.cost)}</span>
    </button></li>`;
  }).join('');
}

function waterfall(t) {
  const total = Math.max(1, t.ms || 0);
  return `<div class="waterfall">${t.spans.map((s) => `<div class="span-row">
    <span class="span-name"><span class="kind ${s.kind}">${s.kind}</span> ${esc(label(s.purpose))}</span>
    <span class="span-track" title="starts at ${ms(s.offset_ms)}"><span class="span-bar ${s.kind} ${s.ok ? '' : 'failed'}" style="left:${((s.offset_ms || 0) / total) * 100}%;width:${(s.ms / total) * 100}%"></span></span>
    <span class="span-meta" title="${esc(s.error || s.model || '')}">${s.ok ? '' : '<span class="err">failed</span> · '}${esc(s.model || s.provider || '')} · ${ms(s.ms)}${s.in_tok ? ` · ${num(s.in_tok)}→${num(s.out_tok)} tok` : ''} · ${s.kind === 'http' || s.kind === 'local' ? 'free' : usd(s.cost)}</span>
  </div>`).join('')}</div>`;
}

function openTrace(t) {
  $('trace-title').innerHTML = t.kind === 'digest' ? `Daily log · ${esc(t.label)}` : `${esc(t.label)} · ${hhmm(t.at)}${t.subject || t.headline ? `: ${esc(t.subject || t.headline)}` : ''}`;
  const facts = [
    ['When', `${new Date(t.at).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })}${t.duration ? ` · ${Math.round(t.duration)} s of audio` : ''}`],
    ['Cost', `${usd(t.cost)} · ${ms(t.ms)} end to end`],
    t.headline && ['Incident', esc(t.headline)],
    t.category && ['Triage', esc(t.category)],
    t.jev_news != null && ['Jev gate', `speech ${t.jev_speech?.toFixed(2)} · newsworthy ${t.jev_news.toFixed(2)}`],
  ].filter(Boolean);
  $('trace-body').innerHTML = `
    ${t.audio ? `<audio class="trace-audio" controls preload="none" src="/audio/${encodeURIComponent(t.audio)}"></audio>` : ''}
    ${t.thread_id ? `<p class="trace-story"><a class="key" href="/?story=${t.thread_id}">Open story ›</a> ${esc(t.subject || '')}</p>` : ''}
    <dl class="story-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${t.transcript ? `<p class="trace-words">“${esc(t.transcript)}”</p>` : ''}
    <h3 class="trace-h">Behind the scenes</h3>
    ${waterfall(t)}`;
  // Clips are kept for RECORD_DAYS; an expired one says so instead of a dead player.
  $('trace-body').querySelector('.trace-audio')?.addEventListener('error', (e) => { e.target.outerHTML = '<p class="na">The recording has expired.</p>'; });
  $('trace-card').showModal();
}

$('traces').addEventListener('click', (e) => {
  const row = e.target.closest('.trace');
  const t = row && traces.find((x) => String(x.id) === row.dataset.id);
  if (t) openTrace(t);
});
$('trace-close').addEventListener('click', () => $('trace-card').close());
$('trace-card').addEventListener('click', (e) => { if (e.target === $('trace-card')) $('trace-card').close(); });
$('trace-card').addEventListener('close', () => $('trace-card').querySelector('audio')?.pause());

for (const b of $('period').children) b.setAttribute('aria-pressed', Number(b.dataset.h) === hours);
$('period').addEventListener('click', (e) => {
  const k = e.target.closest('.key');
  if (!k) return;
  hours = Number(k.dataset.h);
  store.set('ledger.hours', hours);
  for (const b of $('period').children) b.setAttribute('aria-pressed', b === k);
  refresh();
});

async function refresh() {
  try {
    const [c, traces] = await Promise.all([getJson(`/api/costs?hours=${hours}`), getJson('/api/traces?limit=40')]);
    renderBalance(c);
    renderAccounts(c);
    renderGate(c.gate, c);
    renderVad(c.vad);
    renderTraces(traces);
  } catch (e) {
    $('balance').innerHTML = `<div class="note"><dt>Couldn't reach the receiver (${esc(e.message)}). Is <code>npm start</code> running?</dt></div>`;
  }
}
refresh();
setInterval(refresh, 15e3);
