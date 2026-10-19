/* The Look choices (Skin, Backlight, wide layout) go on <html> before the first paint, on every page, so the LCD skin
   never flashes the Classic one. Loaded synchronously in <head>. Auto backlight follows the sun at the station: by day
   it is blue (Classic draws its day look), from sunset to sunrise it is red in the LCD skin and Night Bakelite in
   Classic. In the Clear and Console skins Auto follows the phone's light/dark setting instead: night when it is dark. app.js calls
   apply() too, so both agree. The station's coordinates are kept in pcm.where (app.js saves them from /api/config; a
   page that has none yet fetches the config once), so every page works out the sun the same way as the receiver. */
(function () {
  var d = document.documentElement;
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  function sunIsUp(lat, lng, at) { // NOAA's low-precision solar position: is the sun above the horizon (-0.833°)?
    var rad = Math.PI / 180, n = (at || new Date()) / 864e5 + 2440587.5 - 2451545;
    var g = (357.528 + 0.9856003 * n) * rad, lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var ha = ((280.46061837 + 360.98564736629 * n + lng) * rad) - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad > -0.833;
  }
  function stationLatLng(regions) { // the middle of the regions' centres, which is where the station is
    var at = (regions || []).map(function (r) { return r.center || (r.bbox && [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]); }).filter(Boolean);
    if (!at.length) return null;
    var sum = function (i) { return at.reduce(function (a, c) { return a + c[i]; }, 0) / at.length; };
    return [sum(0), sum(1)];
  }
  function where() {
    try { var w = JSON.parse(get('pcm.where')); return Array.isArray(w) && isFinite(w[0]) && isFinite(w[1]) ? w : null; } catch (e) { return null; }
  }
  // Once: Classic had no Backlight choice before Night Bakelite, so a pick kept while on Classic is left over from LCD.
  if (!get('pcm.lookMig1')) {
    if (get('pcm.skin') !== 'lcd' && (get('pcm.backlight') || 'auto') !== 'auto') set('pcm.backlight', 'auto');
    set('pcm.lookMig1', '1');
  }
  var dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  function apply() {
    var pick = get('pcm.backlight') || 'auto', w = where(), hr = new Date().getHours(), skin = get('pcm.skin');
    var up = w ? sunIsUp(w[0], w[1]) : hr >= 7 && hr < 19; // no station position yet: the clock
    d.dataset.skin = skin === 'lcd' || skin === 'clear' || skin === 'console' ? skin : 'classic';
    d.dataset.wide = get('pcm.wideLayout') === 'base' ? 'base' : 'lcd';
    d.dataset.backlight = pick === 'blue' || pick === 'night' || pick === 'red' || pick === 'daylight' || pick === 'vfd' ? pick
      : d.dataset.skin === 'clear' || d.dataset.skin === 'console' ? (dark.matches ? 'night' : 'blue')
      : up ? 'blue' : d.dataset.skin === 'lcd' ? 'red' : 'night';
    // The phone's status bar matches the look from the first paint (a page without the meta has nothing to set).
    var meta = document.querySelector('meta[name="theme-color"]'), skin2 = d.dataset.skin, bl = d.dataset.backlight;
    if (meta) meta.content = skin2 === 'lcd' ? '#141518'
      : skin2 === 'clear' || skin2 === 'console' ? (bl === 'night' || bl === 'red' ? (skin2 === 'clear' ? '#292929' : '#15191d') : '#ffffff')
      : { night: '#1c1511', red: '#1a0606' }[bl] || '#5a3a22';
  }
  apply();
  if (dark.addEventListener) dark.addEventListener('change', apply);
  window.pcmSkin = { sunIsUp: sunIsUp, stationLatLng: stationLatLng, apply: apply, setWhere: function (w) { if (w) set('pcm.where', JSON.stringify(w)); } };
  // Auto with no station position kept yet: ask the server once, then re-apply.
  if ((get('pcm.backlight') || 'auto') === 'auto' && !where() && window.fetch) {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      var w = stationLatLng(c.regions); if (w) { window.pcmSkin.setWhere(w); apply(); }
    }).catch(function () {});
  }
  setInterval(apply, 60e3);
})();
