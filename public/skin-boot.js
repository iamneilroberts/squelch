/* The Look choices (Skin, Backlight, wide layout) go on <html> before the first paint, on every page, so the LCD skin
   never flashes the Classic one. Loaded synchronously in <head>. Auto backlight follows the sun at the station: by day
   it is blue (Classic draws its day look), from sunset to sunrise it is red in the LCD skin and Night Bakelite in
   Classic. app.js calls apply() too, so both agree. The station's coordinates are kept in pcm.where (app.js saves them
   from /api/config; a page that has none yet fetches the config once), so every page works out the sun the same way
   as the receiver. */
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
  function apply() {
    var pick = get('pcm.backlight') || 'auto', w = where(), hr = new Date().getHours(), last = get('pcm.autoLight');
    var up = w ? sunIsUp(w[0], w[1]) : last ? last === 'blue' : hr >= 7 && hr < 19; // no station position yet: last time's answer, else the clock
    d.dataset.skin = get('pcm.skin') === 'lcd' ? 'lcd' : 'classic';
    d.dataset.wide = get('pcm.wideLayout') === 'base' ? 'base' : 'lcd';
    d.dataset.backlight = pick === 'blue' || pick === 'night' || pick === 'red' || pick === 'daylight' ? pick
      : up ? 'blue' : d.dataset.skin === 'lcd' ? 'red' : 'night';
  }
  apply();
  window.pcmSkin = { sunIsUp: sunIsUp, stationLatLng: stationLatLng, apply: apply, setWhere: function (w) { if (w) set('pcm.where', JSON.stringify(w)); } };
  // Auto with no station position kept yet: ask the server once, then re-apply.
  if ((get('pcm.backlight') || 'auto') === 'auto' && !where() && window.fetch) {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      var w = stationLatLng(c.regions); if (w) { window.pcmSkin.setWhere(w); apply(); }
    }).catch(function () {});
  }
  setInterval(apply, 60e3);
})();
