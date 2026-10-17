// Station Manual: "How it works" and the Ledger. The ledger's code (costs.js) loads on first open.
const $ = (id) => document.getElementById(id);
let ledgerLoaded = false;

function show() {
  const ledger = location.hash === '#ledger';
  $('how').hidden = ledger;
  $('ledger').hidden = !ledger;
  $('period').hidden = !ledger;
  $('tab-how').setAttribute('aria-selected', String(!ledger));
  $('tab-ledger').setAttribute('aria-selected', String(ledger));
  document.title = ledger ? 'Station Ledger' : 'Station Manual';
  if (ledger && !ledgerLoaded) { ledgerLoaded = true; import(document.querySelector('link[rel="modulepreload"]').href); }
  const target = !ledger && location.hash && document.querySelector(location.hash);
  if (target) target.scrollIntoView();
}

$('tab-how').addEventListener('click', () => { history.replaceState(null, '', location.pathname); show(); scrollTo(0, 0); });
$('tab-ledger').addEventListener('click', () => { location.hash = 'ledger'; });
addEventListener('hashchange', show);
show();

// A phone can bring this page back from memory after an update; check, and reload if anything changed.
let version = null;
const latest = () => fetch('/api/version', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.version).catch(() => null);
latest().then((v) => { version = v; });
const recheck = async () => { const v = await latest(); if (v && version && v !== version) location.reload(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
addEventListener('pageshow', (e) => { if (e.persisted) recheck(); });
