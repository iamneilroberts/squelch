// Station Manual: "How it works", the Ledger, and the Studio (the owner's; guests too if the owner lets them). The Ledger's code (costs.js)
// and the Studio's (studio.js) load on first open.
const $ = (id) => document.getElementById(id);
const loaded = new Set();
let owner = false;

// The unseen dot on the What's new tab: the newest change's id is kept in pcm.changesSeen when the tab is opened.
let head = null;
const SEEN = 'pcm.changesSeen';
const seen = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
function markSeen() {
  if (head) { try { localStorage.setItem(SEEN, head); } catch { /* private mode */ } }
  $('tab-changes').classList.remove('has-news');
}

function show() {
  const tab = location.hash === '#ledger' ? 'ledger' : location.hash === '#changes' ? 'changes' : /^#studio(-\d+)?$/.test(location.hash) && owner ? 'studio' : 'how';
  for (const t of ['how', 'ledger', 'studio', 'changes']) {
    $(t).hidden = t !== tab;
    $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
  }
  $('period').hidden = tab !== 'ledger';
  document.title = { how: 'Station Manual', ledger: 'Station Ledger', studio: 'Squelch Studio', changes: 'What’s new' }[tab];
  const code = { ledger: 'costs.js', studio: 'studio.js', changes: 'changes.js' }[tab];
  if (code && !loaded.has(code)) { loaded.add(code); import(document.querySelector(`link[rel="modulepreload"][href^="${code}"]`).href); }
  if (tab === 'changes') markSeen();
  const target = tab === 'how' && location.hash && document.querySelector(location.hash); // #studio-<id> scrolls to its card (studio.js)
  if (target) target.scrollIntoView();
}

$('tab-how').addEventListener('click', () => { history.replaceState(null, '', location.pathname); show(); scrollTo(0, 0); });
$('tab-ledger').addEventListener('click', () => { location.hash = 'ledger'; });
$('tab-changes').addEventListener('click', () => { location.hash = 'changes'; });
$('tab-studio').addEventListener('click', () => { location.hash = 'studio'; });
addEventListener('hashchange', show);
show();
// The Studio tab shows for the owner (LAN, or signed in through Cloudflare Access) and for guests when the owner's Guests setting allows it.
fetch('/api/config').then((r) => r.json()).then((c) => { owner = (c.viewer?.studio || 'off') !== 'off'; $('tab-studio').hidden = !owner; if (owner && /^#studio(-\d+)?$/.test(location.hash)) show(); }).catch(() => {});

fetch('/api/changes?limit=1').then((r) => r.json()).then((j) => {
  head = j.head;
  if (head && $('changes').hidden && seen() !== head) $('tab-changes').classList.add('has-news');
  else if (head && !$('changes').hidden) markSeen();
}).catch(() => {});

// A phone can bring this page back from memory after an update; check, and reload if anything changed.
let version = null;
const latest = () => fetch('/api/version', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.version).catch(() => null);
latest().then((v) => { version = v; });
const recheck = async () => { const v = await latest(); if (v && version && v !== version) location.reload(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
addEventListener('pageshow', (e) => { if (e.persisted) recheck(); });
