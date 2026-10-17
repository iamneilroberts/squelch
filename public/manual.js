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
  if (ledger && !ledgerLoaded) { ledgerLoaded = true; import('./costs.js'); }
  const target = !ledger && location.hash && document.querySelector(location.hash);
  if (target) target.scrollIntoView();
}

$('tab-how').addEventListener('click', () => { history.replaceState(null, '', location.pathname); show(); scrollTo(0, 0); });
$('tab-ledger').addEventListener('click', () => { location.hash = 'ledger'; });
addEventListener('hashchange', show);
show();
