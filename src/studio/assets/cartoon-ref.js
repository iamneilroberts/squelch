// Style reference for the Studio's cartoon prompt: the art and first shots of a hand-made cartoon ("The Great Main Street Dog Parade", 2026-10-17).
// Not loaded by any page; it shows the model the drawing style and how shots are built.
function rng(s){return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const ease = x => { x = c01(x); return x * x * (3 - 2 * x); };
const pop = x => { x = c01(x); return x >= 1 ? 1 : x < .7 ? (x / .7) * 1.15 : 1.15 - .15 * ((x - .7) / .3); };
const lerp = (a, b, k) => a + (b - a) * k;
const P = (el, x, y, s = 1, fl = false, r = 0, sy = s) => el && el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r.toFixed(2)}) scale(${(fl ? -s : s).toFixed(3)} ${sy.toFixed(3)})`);
const vis = (el, on) => el && el.setAttribute('visibility', on ? 'visible' : 'hidden');
// ---------- art ----------
function dog(o = {}) {
  const c = o.c || '#d9964a', e = o.e || '#7a4a24', ty = o.type || 'std';
  const long = ty === 'long', pood = ty === 'poodle', perk = ty === 'perk';
  const bx = long ? 44 : 30, legH = long ? 10 : 20, by = -(legH + 10);
  const xs = long ? [-32, -22, 24, 34] : [-19, -9, 13, 23];
  const leg = i => { const x = xs[i]; return `<g class="leg ${i == 0 || i == 3 ? 'la' : 'lb'}" style="transform-origin:${x}px ${by + 6}px"><rect x="${x - 4.5}" y="${by + 2}" width="9" height="${-by - 2}" rx="4.5" fill="${i == 1 || i == 3 ? e : c}" ${sw(2.5)}/>${pood ? `<circle cx="${x}" cy="-4" r="6" fill="${c}" ${sw(2.5)}/>` : ''}</g>`; };
  let s = leg(1) + leg(3);
  const tp = `M${-bx + 4} ${by - 3} q-15 -5 -13 -24`;
  s += `<g class="tail" style="transform-origin:${-bx + 4}px ${by - 3}px"><path d="${tp}" fill="none" stroke="${OL}" stroke-width="11" stroke-linecap="round"/><path d="${tp}" fill="none" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/>${pood ? `<circle cx="${-bx - 9}" cy="${by - 27}" r="7" fill="${c}" ${sw(2.5)}/>` : ''}</g>`;
  if (o.tuba) s += `<path d="M-8 ${by - 8} L-22 ${by - 60} L16 ${by - 60} L6 ${by - 8}Z" fill="#ffc83d" ${sw(3)} stroke-linejoin="round"/>`;
  s += `<ellipse cx="0" cy="${by}" rx="${bx}" ry="15" fill="${c}" ${sw(3)}/>`;
  if (o.spot) s += `<ellipse cx="-6" cy="${by - 4}" rx="11" ry="7" fill="${e}"/>`;
  if (o.tuba) s += `<circle cx="2" cy="${by}" r="12" fill="none" stroke="${OL}" stroke-width="10"/><circle cx="2" cy="${by}" r="12" fill="none" stroke="#ffc83d" stroke-width="6"/>`;
  s += leg(0) + leg(2);
  if (o.drum) s += `<g transform="translate(${bx - 14} ${by + 6})"><rect x="-13" y="-10" width="26" height="24" rx="5" fill="#e63946" ${sw(3)}/><path d="M-13 -1 l6.5 8 l6.5 -8 l6.5 8 l6.5 -8" fill="none" stroke="#ffd166" stroke-width="2.5"/><rect x="-15" y="-13" width="30" height="6" rx="3" fill="#fff" ${sw(2)}/></g>`;
  if (o.flag) s += `<line x1="${bx - 8}" y1="${by + 4}" x2="${bx - 4}" y2="${by - 82}" ${sw(3.5)}/><path d="M${bx - 4} ${by - 82} l30 8 l-30 9z" fill="#ff5a5f" ${sw(2.5)} stroke-linejoin="round"/>`;
  let h = '';
  if (perk) h += `<path d="M-10 -8 L-7 -31 L4 -12Z" fill="${e}" ${sw(2.5)} stroke-linejoin="round"/>`;
  h += `<ellipse cx="15" cy="5" rx="11" ry="8" fill="${c}" ${sw(3)}/><circle r="15" fill="${c}" ${sw(3)}/>`;
  h += `<circle cx="25" cy="2" r="4.2" fill="${OL}"/><circle cx="6" cy="-4" r="3" fill="${OL}"/><circle cx="7" cy="-5" r="1.1" fill="#fff"/>`;
  if (!perk) h += `<path d="M-5 -13 C-20 -11 -19 7 -11 12 C-7 5 -2 -4 -5 -13Z" fill="${e}" ${sw(2.5)}/>`;
  if (pood) h += `<circle cx="-1" cy="-15" r="9" fill="${c}" ${sw(2.5)}/>`;
  h += `<path d="M15 11 q2 9 8 1" fill="#ff7b9c" ${sw(2)}/>`;
  if (o.trumpet) h += `<rect x="24" y="2" width="20" height="5" fill="#ffc83d" ${sw(2)}/><path d="M42 4.5 L58 -6 L58 15Z" fill="#ffc83d" ${sw(2.5)} stroke-linejoin="round"/>`;
  if (o.hat === 'shako') h += `<g transform="translate(-1 -13)"><rect x="-10" y="-28" width="20" height="28" rx="2" fill="#e63946" ${sw(3)}/><rect x="-10" y="-8" width="20" height="5" fill="#ffd166"/><path d="M3 -28 q-7 -12 6 -21" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>`;
  if (o.hat === 'party') h += `<g transform="translate(-1 -12) rotate(-12)"><path d="M-9 0 L1 -28 L10 0Z" fill="#4cc9f0" ${sw(2.5)} stroke-linejoin="round"/><circle cx="1" cy="-29" r="4" fill="#ffd166" ${sw(2)}/></g>`;
  if (o.hat === 'cap') h += `<g transform="translate(0 -12)"><path d="M-13 0 Q0 -16 13 0Z" fill="#3a86ff" ${sw(2.5)}/><rect x="5" y="-3" width="14" height="4" rx="2" fill="${OL}"/></g>`;
  if (o.baton) h += `<g class="twirl" style="transform-origin:30px -28px"><line x1="10" y1="-28" x2="50" y2="-28" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="-28" r="5" fill="#ffd166" ${sw(2)}/><circle cx="10" cy="-28" r="4" fill="#ffd166" ${sw(2)}/></g>`;
  s += `<g transform="translate(${bx - 3} ${by - 17})">${h}</g>`;
  return `<g class="dog${o.still ? ' still' : ''}">${s}</g>`;
}
// The band: [dx from leader, lane (0 near, 1 far), look]
const BAND = [
  [0, 0, { c: '#f2d5a0', e: '#b07a4a', hat: 'shako', baton: 1, s: 1.1 }],
  [-40, 1, { c: '#c47a3c', e: '#6b3d1f', trumpet: 1 }],
  [-100, 0, { c: '#e8a15a', e: '#7a4a24', type: 'perk', hat: 'cap' }],
  [-150, 1, { c: '#ffffff', e: '#c9c9d6', type: 'poodle', trumpet: 1 }],
  [-250, 1, { c: '#8b5a3c', e: '#4a2c18', drum: 1 }],
  [-300, 0, { c: '#d9d2c3', e: '#6b6b7a', spot: 1, hat: 'cap' }],
  [-360, 1, { c: '#a3683a', e: '#5a3416', tuba: 1, s: 1.15 }],
  [-410, 0, { c: '#e8a15a', e: '#7a4a24', drum: 1, hat: 'cap' }],
  [-470, 1, { c: '#f0c987', e: '#a8743c', type: 'perk', hat: 'party' }],
  [-520, 0, { c: '#6b4a3a', e: '#2e1f18', trumpet: 1, type: 'perk' }],
  [-575, 1, { c: '#f7e0c4', e: '#c49a6c', type: 'poodle', hat: 'party', s: .8 }],
  [-640, 0, { c: '#b5653a', e: '#5a2f18', type: 'long', flag: 1 }],
  [-690, 1, { c: '#ffffff', e: '#3a3a48', spot: 1, s: .75, hat: 'party' }],
  [-745, 0, { c: '#d9964a', e: '#7a4a24', type: 'perk', s: .7, hat: 'party' }],
  [-800, 1, { c: '#8a8a9c', e: '#3d3d4a', s: 1.2 }],
  [-850, 0, { c: '#e8c39e', e: '#9a6b45', s: .65, hat: 'party' }],
];
const L = i => Object.assign({}, BAND[i][2]);

const STARS = (() => { const r = rng(3); let s = ''; for (let i = 0; i < 80; i++) s += `<circle cx="${(r() * 2600 - 800) | 0}" cy="${(r() * 560 - 220) | 0}" r="${(r() * 1.8 + .6).toFixed(1)}" fill="#fff" opacity="${(r() * .6 + .3).toFixed(2)}"/>`; return s; })();
const sky = (moon = true) => `<rect x="-2000" y="-2000" width="6000" height="2560" fill="url(#skyg)"/>${STARS}${moon ? `<g transform="translate(700 100)"><circle r="42" fill="#fff0b8"/><circle cx="-13" cy="-9" r="8" fill="#f1d98c"/><circle cx="14" cy="12" r="6" fill="#f1d98c"/></g>` : ''}`;
function shops(x0, x1, seed, names = []) {
  const r = rng(seed), cols = ['#3d4a8c', '#5b3f7e', '#2e6a73', '#7b4a5c', '#46603d', '#6c5a91', '#8a5a3c'];
  let s = '', x = x0, i = 0;
  while (x < x1) {
    const w = 150 + (r() * 70 | 0), h = 170 + (r() * 120 | 0), c = cols[r() * cols.length | 0], top = 545 - h;
    s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${c}" ${sw(3)}/><rect x="${x - 5}" y="${top - 12}" width="${w + 10}" height="14" fill="#232a55" ${sw(3)}/>`;
    for (let wy = top + 22; wy < 545 - 130; wy += 44) for (let wx = x + 18; wx < x + w - 34; wx += 40) s += `<rect x="${wx}" y="${wy}" width="22" height="26" rx="2" fill="${r() < .35 ? '#ffd166' : '#1c2148'}" ${sw(2)}/>`;
    const nm = names.length ? names[i % names.length] : '';
    if (nm) s += `<rect x="${x + 12}" y="${545 - 122}" width="${w - 24}" height="26" rx="5" fill="#f6efe0" ${sw(3)}/><text x="${x + w / 2}" y="${545 - 103}" text-anchor="middle" class="big" font-size="14" fill="${OL}">${nm}</text>`;
    s += `<path d="M${x + 8} ${545 - 90} h${w - 16} l-8 18 h${-(w - 32)} z" fill="${['#ff5a5f', '#ffcf4a', '#4cc9f0', '#7bd389'][i % 4]}" ${sw(3)} stroke-linejoin="round"/>`;
    s += `<rect x="${x + 16}" y="${545 - 66}" width="${w * .5 | 0}" height="44" fill="#ffe7a3" ${sw(3)}/><rect x="${x + w - 50}" y="${545 - 70}" width="30" height="70" fill="#2a1f3d" ${sw(3)}/>`;
    x += w + 8; i++;
  }
  return s;
}
const lamp = x => `<circle cx="${x + 30}" cy="372" r="95" fill="url(#glow)"/><rect x="${x - 5}" y="368" width="10" height="177" fill="#232a55" ${sw(2.5)}/><path d="M${x} 372 q0 -14 30 -14" fill="none" stroke="#232a55" stroke-width="7"/><path d="M${x + 18} 360 h26 l-5 14 h-16z" fill="#ffe08a" ${sw(2.5)}/>`;
function street() {
  let d = ''; for (let x = -2000; x < 4400; x += 90) d += `<rect x="${x}" y="630" width="48" height="7" rx="3" fill="#ffcf4a"/>`;
  return `<rect x="-2000" y="540" width="6400" height="26" fill="#6e7398" ${sw(2)}/><rect x="-2000" y="566" width="6400" height="134" fill="#2a2d46"/>${d}<rect x="-2000" y="700" width="6400" height="22" fill="#6e7398" ${sw(2)}/><rect x="-2000" y="722" width="6400" height="3000" fill="#1c3a2c"/>`;
}
const sign = (x, txt, col = '#1f8a4c') => { const w = txt.length * 16 + 34; return `<rect x="${x - 4}" y="380" width="8" height="165" fill="#9aa0b8" ${sw(2)}/><rect x="${x - w / 2}" y="358" width="${w}" height="36" rx="5" fill="${col}" ${sw(3)}/><text x="${x}" y="384" text-anchor="middle" class="big" font-size="20" fill="#fff">${txt}</text>`; };
const blob = (shapes, fill) => `<g fill="${OL}" stroke="${OL}" stroke-width="8">${shapes}</g><g fill="${fill}">${shapes}</g>`;
const hedge = (w, h, fill = '#3a9155') => { let sh = ''; let k = 0; for (let x = -w / 2 + 28; x <= w / 2 - 28; x += 44) sh += `<circle cx="${x}" cy="${-h + 32 + (k++ % 2) * 10}" r="32"/>`; sh += `<rect x="${-w / 2}" y="${-h + 30}" width="${w}" height="${h - 30}" rx="18"/>`; return blob(sh, fill); };
const tailEl = (c = '#d9964a') => `<g class="tail" style="transform-origin:0px 0px"><path d="M0 0 q-8 -20 6 -42" fill="none" stroke="${OL}" stroke-width="12" stroke-linecap="round"/><path d="M0 0 q-8 -20 6 -42" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/></g>`;
const star = (cx, cy, r) => { let p = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); } return `<path d="${p}Z" fill="#ffcf4a" ${sw(2)} stroke-linejoin="round"/>`; };
const wheel = x => `<circle cx="${x}" cy="-20" r="20" fill="#1b1b28" ${sw(3)}/><circle cx="${x}" cy="-20" r="8" fill="#a7adc6"/>`;
function car(o = {}) {
  return `<g>${o.beam ? `<g data-k="beam" transform="translate(62 -106) rotate(10)"><path d="M0 0 L470 -80 L470 120Z" fill="url(#beamg)"/></g>` : ''}${o.head ? `<path d="M128 -58 L560 -120 L560 30Z" fill="url(#beamg)" opacity=".75"/>` : ''}
  <path d="M-122 -26 L-122 -60 Q-122 -72 -106 -74 L-62 -76 L-40 -108 Q-34 -116 -20 -116 L40 -116 Q54 -116 62 -106 L86 -76 L116 -70 Q130 -66 130 -52 L130 -26 Q130 -20 122 -20 L-114 -20 Q-122 -20 -122 -26Z" fill="#f4f1ea" ${sw(4)} stroke-linejoin="round"/>
  <path d="M-120 -48 L128 -48 L128 -26 Q128 -22 122 -22 L-114 -22 Q-120 -22 -120 -26Z" fill="#23263d"/>
  <path d="M-32 -106 L-50 -78 L6 -78 L6 -106Z" fill="#8ecae6" ${sw(3)} stroke-linejoin="round"/>
  <path d="M14 -106 L14 -78 L76 -78 L58 -102 Q55 -106 48 -106Z" fill="#8ecae6" ${sw(3)} stroke-linejoin="round"/>
  ${star(-22, -62, 11)}
  <rect x="-20" y="-127" width="22" height="11" rx="3" fill="#ff4d5a" ${sw(2.5)} class="lbR"/><rect x="2" y="-127" width="22" height="11" rx="3" fill="#4d7cff" ${sw(2.5)} class="lbB"/>
  <ellipse cx="125" cy="-60" rx="5" ry="7" fill="#ffe08a" ${sw(2)}/><rect x="-122" y="-66" width="7" height="11" fill="#ff4d5a"/>
  <rect x="56" y="-114" width="13" height="9" rx="2" fill="#c9c9d6" ${sw(2)}/>
  ${wheel(-72)}${wheel(82)}</g>`;
}
const bubble = (txt, w, fs = 26) => `<g><path d="M-4 -24 L0 0 L20 -24Z" fill="#fff" ${sw(4)} stroke-linejoin="round"/><rect x="-24" y="-74" width="${w}" height="52" rx="24" fill="#fff" ${sw(4)}/><rect x="-2" y="-27" width="20" height="8" fill="#fff"/><text x="${-24 + w / 2}" y="${-48 + fs * .36}" text-anchor="middle" class="big" font-size="${fs}" fill="${OL}">${txt}</text></g>`;
const burstPath = (r1, r2, n = 14) => { let p = ''; for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n, r = i % 2 ? r2 : r1; p += (i ? 'L' : 'M') + (r * Math.cos(a) * 1.3).toFixed(1) + ' ' + (r * Math.sin(a)).toFixed(1); } return p + 'Z'; };
const note = () => `<g><path d="M8 -26 q12 4 9 15" fill="none" stroke="#fff" stroke-width="3.5"/><rect x="5" y="-27" width="3.5" height="27" fill="#fff"/><ellipse cx="0" cy="0" rx="7.5" ry="5.5" transform="rotate(-20)" fill="#fff"/></g>`;
function radio() {
  let g = ''; for (let i = 0; i < 7; i++) g += `<rect x="-60" y="${-40 + i * 20}" width="120" height="9" rx="4.5" fill="#23263d"/>`;
  return `<rect x="30" y="-250" width="18" height="130" rx="9" fill="#2a2d46" ${sw(4)}/><rect x="-90" y="-150" width="180" height="290" rx="30" fill="#3a3f63" ${sw(5)}/><circle cx="-50" cy="-158" r="13" fill="#2a2d46" ${sw(4)}/>
  <rect x="-68" y="-126" width="136" height="64" rx="10" fill="#9df5c2" ${sw(4)}/><text x="0" y="-100" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="16" fill="${OL}">CH1 SHERIFF</text><text x="0" y="-73" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="20" fill="${OL}">3:08 AM</text>${g}<circle data-k="led" cx="62" cy="-136" r="6" fill="#3dff8a"/>`;
}
const beaver = () => `<g><ellipse cx="-28" cy="-8" rx="24" ry="9" fill="#5a3a22" ${sw(3)} transform="rotate(-12 -28 -8)"/><ellipse cx="0" cy="-26" rx="21" ry="26" fill="#8a5a32" ${sw(3)}/><g class="wave" style="transform-origin:14px -36px"><rect x="10" y="-64" width="8" height="28" rx="4" fill="#8a5a32" ${sw(2.5)}/></g><circle cx="4" cy="-56" r="15" fill="#8a5a32" ${sw(3)}/><rect x="9" y="-50" width="8" height="8" fill="#fff" ${sw(1.5)}/><circle cx="10" cy="-60" r="2.6" fill="${OL}"/><path d="M-9 -64 q12 -18 26 0z" fill="#ffcf4a" ${sw(2.5)}/></g>`;

// ---------- shots ----------
const shots = [];
const q = (g, k) => g.querySelector(`[data-k="${k}"]`);
const qa = (g, k) => [...g.querySelectorAll(`[data-k="${k}"]`)];
function shot(t0, t1, keys, html, init) { const g = document.createElementNS(NS, 'g'); g.innerHTML = html; g.setAttribute('display', 'none'); world.appendChild(g); shots.push({ t0, t1, keys, g, update: init(g) }); }
const at = (k, html) => `<g data-k="${k}">${html}</g>`;
const look = (lt, a, b) => Math.min(ease((lt - a) / .3), ease((b - lt) / .3));

const S_RADIO = C[0].start, S_SHELTER = wt(0, /^got$/) - 0.6, S_PARADE = wt(0, /^show/) + .4;
const S_PLAN = wt(0, /^up\.$/) - .2, A_PARADE = wt(0, /^parade$/), A_15 = wt(0, /^15$/), A_PLAN = wt(0, /^plan\.$/);

// 0. Title
shot(0, S_RADIO, [0], `${sky()}${shops(-900, 2000, 11, ['DINER', 'HARDWARE', 'BAKERY', 'FEED &amp; SEED', 'BARBER', 'CAFE'])}${lamp(250)}${lamp(760)}${street()}
  ${at('d0', dog(Object.assign(L(2), { still: 1 })))}${at('d1', dog(Object.assign(L(0), { still: 1 })))}${at('d2', dog(Object.assign(L(11), { still: 1 })))}
  <g text-anchor="middle"><text x="500" y="140" class="big ol" font-size="40" fill="#ffcf4a" stroke-width="9">THE GREAT</text><text x="500" y="220" class="big ol" font-size="66" fill="#fff" stroke-width="13">MAIN STREET</text><text x="500" y="296" class="big ol" font-size="66" fill="#ffcf4a" stroke-width="13">DOG PARADE</text><text x="500" y="342" class="ol" font-size="22" font-weight="800" fill="#fff" stroke-width="7">George County, MS · 3:08 AM</text></g>`,
  g => { const d = [0, 1, 2].map(i => q(g, 'd' + i)); return () => { P(d[0], 380, 668, 1.2); P(d[1], 500, 668, 1.4); P(d[2], 630, 668, 1.15, true); }; });

// 1. Dispatch: "a parade of dogs"
shot(S_RADIO, S_SHELTER, [0.5, A_PARADE - S_RADIO + .3], `${sky()}${shops(-900, 2000, 12)}${street()}<rect x="-2000" y="-2000" width="6400" height="6000" fill="#0d1230" opacity=".5"/>
  <g transform="translate(500 330)">${[1, 2, 3].map(i => `<path data-k="arc" d="M${110 + i * 34} ${-60 - i * 30} a${60 + i * 40} ${60 + i * 40} 0 0 1 0 ${120 + i * 60}" fill="none" stroke="#9df5c2" stroke-width="9" stroke-linecap="round"/><path data-k="arc" d="M${-110 - i * 34} ${-60 - i * 30} a${60 + i * 40} ${60 + i * 40} 0 0 0 0 ${120 + i * 60}" fill="none" stroke="#9df5c2" stroke-width="9" stroke-linecap="round"/>`).join('')}</g>
  ${at('radio', radio())}${at('w0', dog(L(13)))}${at('w1', dog(L(10)))}
  ${at('burst', `<path d="${burstPath(150, 112)}" fill="#ffcf4a" ${sw(6)} stroke-linejoin="round"/><text y="-8" text-anchor="middle" class="big" font-size="42" fill="${OL}">A PARADE</text><text y="44" text-anchor="middle" class="big" font-size="42" fill="${OL}">OF DOGS?!</text>`)}`,
  g => {
    const radioEl = q(g, 'radio'), arcs = qa(g, 'arc'), burst = q(g, 'burst'), led = q(g, 'led'), w = [q(g, 'w0'), q(g, 'w1')];
    return (lt, T) => {
      P(radioEl, 500, 440, 1.15, false, reduce ? 0 : Math.sin(T * 26) * 1.6);
      arcs.forEach((a, i) => a.setAttribute('opacity', reduce ? .8 : (.25 + .75 * (.5 + .5 * Math.sin(T * 7 - (i >> 1) * 1.1))).toFixed(2)));
      led.setAttribute('opacity', reduce || Math.floor(T * 5) % 2 ? 1 : .35);
      const k = lt - (A_PARADE - S_RADIO - .2);
      vis(burst, k > 0); P(burst, 500, 165, pop(k / .35) * (reduce ? 1 : 1 + .03 * Math.sin(T * 9)));
      const wk = ease((lt - 4.4) / 1.8);
      P(w[0], lerp(1350, 735, wk), 700 + bob(T), 1.3, true); P(w[1], lerp(1460, 840, wk), 700 + bob(T, .1), 1.2, true);
    };
  });

// 2. The shelter gate opens
shot(S_SHELTER, S_PARADE, [0.3, 3.2, 5.8], `${sky()}${shops(-900, 160, 13)}${shops(880, 2000, 14)}${lamp(840)}${street()}
  <path d="M170 385 L355 296 L540 385Z" fill="#6b3f3f" ${sw(4)} stroke-linejoin="round"/><rect x="190" y="380" width="330" height="165" fill="#a0715a" ${sw(4)}/>
  <rect x="212" y="396" width="286" height="40" rx="6" fill="#fff6e3" ${sw(3)}/><text x="355" y="424" text-anchor="middle" class="big" font-size="21" fill="${OL}">ANIMAL SHELTER</text>
  <circle cx="355" cy="350" r="9" fill="#fff6e3"/><circle cx="341" cy="336" r="5" fill="#fff6e3"/><circle cx="355" cy="331" r="5" fill="#fff6e3"/><circle cx="369" cy="336" r="5" fill="#fff6e3"/>
  <rect x="215" y="455" width="60" height="44" fill="#ffe7a3" ${sw(3)}/><rect x="435" y="455" width="60" height="44" fill="#ffe7a3" ${sw(3)}/><rect x="330" y="465" width="50" height="80" fill="#4a2c3d" ${sw(3)}/>
  ${(() => { let f = ''; for (let x = 625; x < 880; x += 22) f += `<rect x="${x}" y="482" width="14" height="63" rx="3" fill="#e8dcc4" ${sw(2.5)}/>`; f += `<rect x="620" y="500" width="260" height="10" fill="#e8dcc4" ${sw(2.5)}/>`; return f; })()}
  ${at('gate', (() => { let f = ''; for (let x = 524; x < 615; x += 22) f += `<rect x="${x}" y="478" width="14" height="67" rx="3" fill="#f6efe0" ${sw(2.5)}/>`; return f + `<rect x="520" y="498" width="100" height="10" fill="#f6efe0" ${sw(2.5)}/><rect x="520" y="525" width="100" height="10" fill="#f6efe0" ${sw(2.5)}/>`; })())}
  ${[12, 9, 3, 4, 6, 0].map((b, i) => at('sd' + i, dog(L(b)))).join('')}
  ${at('gone', `<rect x="-78" y="-30" width="156" height="60" rx="8" fill="#fff6e3" ${sw(4)}/><text y="-4" text-anchor="middle" class="big" font-size="19" fill="${OL}">GONE TO</text><text y="21" text-anchor="middle" class="big" font-size="19" fill="#e63946">PARADE!</text>`)}`,
  g => {
    const gate = q(g, 'gate'), gone = q(g, 'gone'), d = [0, 1, 2, 3, 4, 5].map(i => q(g, 'sd' + i));
    return (lt, T) => {
      const k = ease((lt - .3) / .5); gate.setAttribute('transform', `translate(520 0) scale(${(1 - .82 * k).toFixed(3)} 1) translate(-520 0)`);
      d.forEach((el, i) => { const ti = .9 + i * .62, a = lt - ti; vis(el, a > 0); P(el, 580 + Math.max(0, a) * 150, 640 + bob(T, i * .05), (BAND[[12, 9, 3, 4, 6, 0][i]][2].s || 1) * pop(a / .3)); });
      const gk = c01((lt - 5.2) / .35); vis(gone, gk > 0); gone.setAttribute('transform', `translate(700 440) rotate(-4) scale(${Math.max(.01, pop(gk)).toFixed(3)} 1)`);
    };
  });
