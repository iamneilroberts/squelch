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
const PURPOSE = { transcribe: 'Speech-to-text', 'transcribe-ab': 'Speech-to-text A/B', triage: 'Incident triage', gate: 'Jev gate', digest: 'Daily digest', geocode: 'Geocoder', vad: 'Speech detector (local)', thread: 'Channel story', push: 'Push notification', 'listener-surge': 'Listener-surge look', 'studio:humor': 'Studio · humor scores', 'studio:script': 'Studio · script', 'studio:image': 'Studio · comic panels', 'studio:cartoon': 'Studio · cartoon' };
const label = (p) => PURPOSE[p] || (p.startsWith('overlay:') ? `Map layer · ${p.slice(8)}` : p);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let hours = Number(store.get('ledger.hours')) || 24;
// Behind the scenes: sort and filters, remembered per viewer.
const view = { sort: store.get('ledger.tsort') || 'new', source: store.get('ledger.tsource') || '', flagged: store.get('ledger.tflagged') === '1' };

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const basis = (c) => (c.coveredHours < c.hours - 0.05 ? ` <span class="na">(from ${c.coveredHours < 1 ? `${Math.round(c.coveredHours * 60)} min` : `${c.coveredHours.toFixed(1)} h`} of data)</span>` : '');
const spentOf = (c) => c.rows.reduce((a, r) => a + (r.kind !== 'http' && r.cost || 0), 0);

function renderBalance(c) {
  const rows = c.rows;
  const ai = rows.filter((r) => r.kind !== 'http');
  const api = rows.filter((r) => r.kind === 'http');
  const spent = ai.reduce((a, r) => a + (r.cost || 0), 0);
  const unpriced = ai.reduce((a, r) => a + (r.unpriced || 0), 0);
  const calls = (rs) => rs.reduce((a, r) => a + r.n, 0);
  const perDay = c.coveredHours ? spent / (c.coveredHours / 24) : 0;
  $('balance').innerHTML = `
    <div class="total"><dt>Spent, last ${c.hours >= 48 ? `${c.hours / 24} days` : `${c.hours} h`}</dt><dd>${usd(spent)}</dd></div>
    <div><dt>Radio clips processed</dt><dd>${num(c.clips)}</dd></div>
    <div><dt>Cost per clip</dt><dd>${c.clips ? usd(spent / c.clips) : '—'}</dd></div>
    <div><dt>AI calls</dt><dd>${num(calls(ai))}</dd></div>
    <div><dt>API calls (free)</dt><dd>${num(calls(api))}</dd></div>
    <div><dt>At this rate, per 30 days${basis(c)}</dt><dd>${usd(perDay * 30)}</dd></div>
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

// Where the money goes. Purposes fold into the pipeline's stages; free map layers and the local
// speech detector are left out of "other".
const STAGES = [['transcribe', 'STT', 'Speech-to-text'], ['gate', 'gate', 'Jev gate'], ['thread', 'story', 'Channel story'],
  ['triage', 'triage', 'Incident triage'], ['geocode', 'geocode', 'Geocoder'], ['digest', 'digest', 'Daily digest'], ['other', 'other', 'Other AI']];
const stageOf = (p) => (STAGES.some(([k]) => k === p) ? p : 'other');
const perDay = (x, c) => (c.coveredHours ? x / (c.coveredHours / 24) : 0);
let insight = null;

function stages(c) {
  const total = spentOf(c) || 1;
  return STAGES.map(([k, , name]) => {
    const rs = c.rows.filter((r) => stageOf(r.purpose) === k && (k !== 'other' || (r.kind !== 'http' && r.kind !== 'local')));
    const cost = rs.reduce((a, r) => a + (r.cost || 0), 0);
    const models = [...new Set(rs.filter((r) => r.cost).map((r) => r.model || r.provider))];
    return { k, name, cost, share: cost / total, n: rs.reduce((a, r) => a + r.n, 0), free: rs.every((r) => r.kind === 'http' || r.kind === 'local'), models };
  }).filter((x) => x.n);
}

function renderMoney(c, ins) {
  const spent = spentOf(c);
  const total = ins.total || 1;
  const chan = (x) => {
    const split = STAGES.map(([k, short]) => [k, short, Object.entries(x.stages).filter(([p]) => stageOf(p) === k).reduce((a, [, v]) => a + v, 0)]).filter(([, , v]) => v);
    const bar = `<span class="c-bar" title="${split.map(([, short, v]) => `${short} ${usd(v)}`).join(' · ')}">${split.map(([k, , v]) => `<span class="st-${k}" style="width:${(v / total) * 100}%"></span>`).join('')}</span>`;
    const meta = [
      x.clips && `${num(x.clips)} clips · ${num(x.kept)} kept`,
      x.kept && `${usd(x.cost / x.kept)}/kept`,
      x.transcribed && `${pct(x.empty / x.transcribed)} no speech`,
      split.sort((a, b) => b[2] - a[2]).map(([, short, v]) => `${short} ${pct(v / (x.cost || 1))}`).join(' · '),
    ].filter(Boolean).join(' · ');
    const inner = `<span class="c-name">${esc(x.label || (x.source_id ? x.source_id : 'Daily logs & catch-ups'))}</span>${bar}
      <span class="c-usd">${usd(x.cost)} <small>${pct(x.cost / total)}</small></span><span class="c-meta">${meta}</span>`;
    return x.source_id ? `<li><button type="button" class="chan" data-source="${esc(x.source_id)}">${inner}</button></li>` : `<li><div class="chan">${inner}</div></li>`;
  };
  $('money').innerHTML = `
    <p class="money-head"><b>${usd(spent)}</b> spent in the last ${c.hours >= 48 ? `${c.hours / 24} days` : `${c.hours} h`}${basis(c)}</p>
    <p class="money-rate"><span>≈ <b>${usd(perDay(spent, c))}</b> a day at this rate</span> · <span>≈ <b>${usd(perDay(spent, c) * 30)}</b> per 30 days</span></p>
    <h3 class="money-h">By channel</h3>
    <p class="hint">Costliest first. Tap a channel to list its clips under Behind the scenes.
      ${[...STAGES.slice(0, 4), ['other', 'other']].map(([k, short]) => `<span class="key-item"><span class="swatch st-${k}"></span>${short}</span>`).join(' ')}</p>
    ${ins.channels.length ? `<ol class="chans">${ins.channels.filter((x) => x.cost || x.clips).map(chan).join('')}</ol>` : '<p class="empty">No spend in this period.</p>'}
    <h3 class="money-h">By stage</h3>
    <div class="table-scroll"><table class="accounts stages">
      <thead><tr><th>Stage</th><th class="num">Cost</th><th>Share</th><th class="num">Calls</th><th>Model</th></tr></thead>
      <tbody>${stages(c).sort((a, b) => b.cost - a.cost).map((x) => `<tr>
        <td>${esc(x.name)}</td><td class="num">${x.free ? 'free' : usd(x.cost)}</td><td class="share">${x.cost ? `<span style="width:${x.share * 100}%"></span>` : ''}</td>
        <td class="num">${num(x.n)}</td><td>${esc(x.models.join(', ') || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

// Ways to spend less: savings first (largest first), then plain facts; nothing under a cent a day.
function renderTips(c, ins) {
  const name = (x) => `<b>${esc(x.label || x.source_id)}</b>`;
  const save = [], facts = [];
  ins.channels.filter((x) => x.source_id && x.transcribed >= 20 && x.empty / x.transcribed >= 0.3)
    .sort((a, b) => b.emptyCost - a.emptyCost).slice(0, 3)
    .forEach((x) => save.push({ usd: perDay(x.emptyCost, c), text: `Raise ${name(x)}'s squelch. ${pct(x.empty / x.transcribed)} of its clips had no speech once transcribed, and that speech-to-text is wasted.`, hint: '<code>squelchDb</code> for this feed in sources.json, toward −35' }));
  const t = ins.triage;
  const raise = t.raise.filter((r) => !r.missed && r.n >= 20).pop();
  if (raise) save.push({ usd: perDay(raise.cost, c), text: `Skip triage on more routine traffic. ${num(raise.n)} transmissions Jev rated under ${raise.t} newsworthy went to triage, and none became an incident.`, hint: `<code>JEV_SKIP_BELOW=${raise.t}</code> in .env (now ${t.skipBelow})` });
  if (t.audit.n >= 20 && !t.audit.missed) save.push({ usd: perDay(t.audit.cost, c) / 2, text: `Audit fewer skipped transmissions. Triage re-checked ${num(t.audit.n)} the gate skipped and found no incidents. The audit is the gate's safety check, so halve it rather than drop it.`, hint: `<code>JEV_AUDIT_RATE</code> in .env (now ${c.gate.auditRate})` });
  const skipped = new Set((() => { try { return JSON.parse(store.get('pcm.lockouts') || '[]'); } catch { return []; } })());
  ins.channels.filter((x) => skipped.has(x.source_id))
    .forEach((x) => facts.push({ usd: perDay(x.cost, c), text: `You skip ${name(x)} in Scan, but it still costs this much to process. Its traffic still feeds alerts and the daily log.`, hint: 'To stop paying for it, remove the feed from sources.json.' }));
  const top = stages(c).sort((a, b) => b.cost - a.cost)[0];
  if (top && top.share > 0.5) facts.push({ usd: perDay(top.cost, c), text: `${esc(top.name)} is ${pct(top.share)} of the spend${top.models.length ? `, on ${esc(top.models.join(' and '))}` : ''}.` });
  const shown = [...save.sort((a, b) => b.usd - a.usd).map((x) => ({ ...x, saving: true })), ...facts.sort((a, b) => b.usd - a.usd)]
    .filter((x) => x.usd >= 0.01).slice(0, 5);
  $('tips').innerHTML = shown.length ? shown.map((x) => `<li class="tip">
      <span class="tip-text">${x.text}${x.hint ? `<span class="tip-hint">${x.hint}</span>` : ''}</span>
      <span class="tip-usd">${x.saving ? 'save ≈ ' : ''}${usd(x.usd)}<small>/day</small></span>
    </li>`).join('') : '<li class="empty">Nothing stands out: no change here would save a cent a day.</li>';
}

function renderSources(ins) {
  const sel = $('t-source');
  const list = ins.channels.filter((x) => x.source_id);
  if (view.source && !list.some((x) => x.source_id === view.source)) list.push({ source_id: view.source, label: view.source, cost: 0 });
  sel.innerHTML = `<option value="">All channels</option>${list.map((x) => `<option value="${esc(x.source_id)}">${esc(x.label || x.source_id)} · ${usd(x.cost)}</option>`).join('')}`;
  sel.value = view.source;
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
// Triage's verdict on the clip: a red flag, outlined for notable, filled for breaking.
const FLAG_PATH = 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528';
const flag = (category) => (category === 'notable' || category === 'breaking'
  ? `<svg class="flag ${category}" viewBox="0 0 24 24" role="img" aria-label="${category}"><title>${category}</title><path d="${FLAG_PATH}"/></svg>` : '');

const dur = (sec) => (sec == null ? '' : sec < 60 ? `${Math.round(sec)} s` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);

// Two lines per clip: who, how much audio (the whole story's, when there is one) and cost; then what it was about.
function renderTraces(list) {
  traces = list;
  const filtered = view.source || view.flagged;
  if (!list.length) { $('traces').innerHTML = `<li class="empty">${filtered ? 'No clips match in this period.' : 'No traces yet. They appear as soon as a clip is transcribed.'}</li>`; return; }
  let group;
  $('traces').innerHTML = list.map((t) => {
    const head = view.sort === 'channel' && !view.source && t.source_id !== group;
    group = t.source_id;
    const ch = head && insight?.channels.find((x) => x.source_id === t.source_id);
    const digest = t.kind === 'digest' || t.kind === 'studio';
    const meta = digest ? (t.kind === 'studio' ? 'studio' : 'daily log')
      : t.thread_id ? `${t.story_clips} clip${t.story_clips === 1 ? '' : 's'} · ${dur(t.story_seconds)}`
        : t.call_id ? `${dur(t.duration)} clip` : 'discarded';
    const desc = digest ? esc(t.label)
      : t.subject || t.headline ? esc(t.subject || t.headline)
        : t.transcript ? `<q>${esc(t.transcript)}</q>` : '<i>no speech kept</i>';
    const notable = t.category && t.category !== 'routine';
    return `${head ? `<li class="t-group">${esc(t.source_id ? t.label : 'Daily logs')}${ch ? ` · ${usd(ch.cost)} this period` : ''}</li>` : ''}<li><button type="button" class="trace${notable ? ' notable' : ''}" data-id="${t.id}">
      <span class="t-time">${hhmm(t.at)}</span>
      <span class="t-who">${flag(t.category)}<b>${esc(digest ? (t.kind === 'studio' ? 'Studio' : 'Digest') : t.label)}</b> <span class="t-meta">${meta}</span></span>
      <span class="t-usd">${usd(t.cost)}</span>
      <span class="t-desc">${desc}</span>
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
    t.thread_id && ['Story', `${t.story_clips} clip${t.story_clips === 1 ? '' : 's'} · ${dur(t.story_seconds)} of audio`],
    t.headline && ['Incident', esc(t.headline)],
    t.category && ['Triage', `${flag(t.category)} ${esc(t.category)}`],
    t.jev_news != null && ['Jev gate', `speech ${t.jev_speech?.toFixed(2)} · newsworthy ${t.jev_news.toFixed(2)}`],
  ].filter(Boolean);
  // A clip with no saved call was discarded on the way; say where, so the missing player makes sense.
  const did = (p) => t.spans.some((s) => s.purpose === p);
  const discarded = t.kind === 'clip' && !t.call_id && (did('gate')
    ? 'Discarded: the Jev gate judged it not to be real speech, so no recording or story was kept.'
    : did('transcribe')
      ? 'Discarded: the transcriber heard no usable speech (static, tones or silence), so no recording or story was kept.'
      : 'Discarded before transcription by the speech detector, so no recording or story was kept.');
  $('trace-body').innerHTML = `
    ${discarded ? `<p class="na trace-why">${discarded}</p>` : ''}
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

const showView = () => {
  for (const b of $('t-sort').children) b.setAttribute('aria-pressed', b.dataset.sort === view.sort);
  $('t-flagged').setAttribute('aria-pressed', view.flagged);
  $('t-source').value = view.source;
};
showView();
const setView = (patch) => {
  Object.assign(view, patch);
  store.set('ledger.tsort', view.sort);
  store.set('ledger.tsource', view.source);
  store.set('ledger.tflagged', view.flagged ? '1' : '0');
  showView();
  loadTraces().catch(() => {});
};
$('t-sort').addEventListener('click', (e) => { const k = e.target.closest('.key'); if (k) setView({ sort: k.dataset.sort }); });
$('t-source').addEventListener('change', (e) => setView({ source: e.target.value }));
$('t-flagged').addEventListener('click', () => setView({ flagged: !view.flagged }));
$('money').addEventListener('click', (e) => {
  const row = e.target.closest('.chan[data-source]');
  if (!row) return;
  setView({ source: row.dataset.source });
  $('h-traces').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// The newest request wins, so a quick change of filters never shows a stale list.
let traceSeq = 0;
async function loadTraces() {
  const seq = ++traceSeq;
  const q = new URLSearchParams({ limit: view.sort === 'channel' && !view.source ? 80 : 40, hours, sort: view.sort });
  if (view.source) q.set('source', view.source);
  if (view.flagged) q.set('flagged', '1');
  const list = await getJson(`/api/traces?${q}`);
  if (seq === traceSeq) renderTraces(list);
}

async function refresh() {
  try {
    const [c, ins] = await Promise.all([getJson(`/api/costs?hours=${hours}`), getJson(`/api/costs/insight?hours=${hours}`)]);
    insight = ins;
    renderMoney(c, ins);
    renderTips(c, ins);
    renderSources(ins);
    renderBalance(c);
    renderAccounts(c);
    renderGate(c.gate, c);
    renderVad(c.vad);
    await loadTraces();
  } catch (e) {
    $('balance').innerHTML = `<div class="note"><dt>Couldn't reach the receiver (${esc(e.message)}). Is <code>npm start</code> running?</dt></div>`;
  }
}
refresh();
// Every 15 s while the Ledger is on screen; at once when it comes back.
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
