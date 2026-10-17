// Squelch Studio cartoon library: hand-drawn flat-vector characters, vehicles, sets and props for the two-pass
// cartoon. Every component is an SVG string drawn at its feet (0, 0), facing right, with named pivot parts
// (<g data-p>) that animate() poses from the clock alone, so any moment can be drawn and the MP4 can be stepped.
// The catalogue at the end is read by the server (in a vm) to tell the director what exists.
const CL = (() => {
'use strict';
const OL = '#1a1433';
const sw = (w) => `stroke="${OL}" stroke-width="${w}"`;
const sj = (w) => `${sw(w)} stroke-linejoin="round"`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function rng(s) { return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const c01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const ease = (x) => { x = c01(x); return x * x * (3 - 2 * x); };
const mix = (a, b, k) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
const dk = (c, k = .25) => mix(c, '#1a1433', k);
const lt = (c, k = .35) => mix(c, '#ffffff', k);
// A pivot part: animate() rotates, shifts or fades it about (x, y).
const part = (k, x, y, inner) => `<g data-p="${k}" data-x="${x}" data-y="${y}">${inner}</g>`;
// A thick outlined stroke (tails, hoses, manes).
const tube = (d, w, c, cap = 'round') => `<path d="${d}" fill="none" stroke="${OL}" stroke-width="${w + 5.5}" stroke-linecap="${cap}" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"/>`;
const eye = (x, y, r = 3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${OL}"/><circle cx="${x + r * .35}" cy="${y - r * .35}" r="${r * .38}" fill="#fff"/>`;
const star = (cx, cy, r, fill = '#ffcf4a') => { let p = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); } return `<path d="${p}Z" fill="${fill}" ${sj(2)}/>`; };
const burstPath = (r1, r2, n = 14) => { let p = ''; for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n, r = i % 2 ? r2 : r1; p += (i ? 'L' : 'M') + (r * Math.cos(a) * 1.3).toFixed(1) + ' ' + (r * Math.sin(a)).toFixed(1); } return p + 'Z'; };
const blob = (shapes, fill, w = 8) => `<g fill="${OL}" stroke="${OL}" stroke-width="${w}">${shapes}</g><g fill="${fill}">${shapes}</g>`;
const txt = (x, y, s, size, fill = OL, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" class="big" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;

// Named colours for the colour parameter (the director picks a name, never a raw value).
const PAL = { red: '#e63946', orange: '#f4843d', yellow: '#ffcf4a', green: '#3a9155', teal: '#2a9d8f', blue: '#3a86ff', navy: '#2f3f6e', purple: '#7b5ea7', pink: '#ff8fab', brown: '#8b5a3c', tan: '#d9b27a', cream: '#f6efe0', white: '#f4f1ea', grey: '#8a8f9c', black: '#3a3442' };
const colour = (name) => PAL[name] || null;

const C = {}; // component name → { kind, rig, desc, w, h, variants, motions, hats, carries, label, draw(o) }
const def = (name, d) => { C[name] = { hats: ['none'], carries: ['none'], label: '', ...d }; };

// ---------- hats and things held (shared by animals and people) ----------
// Each is drawn at the top of a head (hat) or at a hand/mouth (carry), in that head's frame.
function hat(kind, c) {
  switch (kind) {
    case 'party': return `<g transform="rotate(-12)"><path d="M-9 0 L1 -28 L10 0Z" fill="${c || '#4cc9f0'}" ${sj(2.5)}/><path d="M-5 -8 L6 -12 M-2 -18 L4 -20" stroke="#fff" stroke-width="2.5"/><circle cx="1" cy="-29" r="4" fill="#ffd166" ${sw(2)}/></g>`;
    case 'cap': return `<path d="M-13 0 Q0 -17 13 0Z" fill="${c || '#3a86ff'}" ${sw(2.5)}/><rect x="5" y="-3" width="15" height="4.5" rx="2" fill="${OL}"/>`;
    case 'shako': return `<g transform="translate(-1 0)"><rect x="-10" y="-28" width="20" height="28" rx="2" fill="${c || '#e63946'}" ${sw(3)}/><rect x="-10" y="-8" width="20" height="5" fill="#ffd166"/><path d="M3 -28 q-7 -12 6 -21" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>`;
    case 'cowboy': return `<g><ellipse cx="0" cy="-2" rx="22" ry="5" fill="${c || '#a8743c'}" ${sw(2.5)}/><path d="M-11 -3 Q-12 -22 -4 -20 Q0 -16 4 -20 Q12 -22 11 -3Z" fill="${c || '#a8743c'}" ${sj(2.5)}/><rect x="-11" y="-8" width="22" height="4" fill="${OL}" opacity=".6"/></g>`;
    case 'bow': return `<g transform="translate(6 -2)"><path d="M0 0 L-12 -8 L-12 8Z M0 0 L12 -8 L12 8Z" fill="${c || '#ff8fab'}" ${sj(2.5)}/><circle r="4" fill="${c || '#ff8fab'}" ${sw(2)}/></g>`;
    case 'helmet': return `<g><path d="M-16 0 Q-15 -22 2 -22 Q17 -21 17 -4 L26 2 Q12 4 -16 2Z" fill="${c || '#e63946'}" ${sj(2.5)}/><path d="M-2 -21 Q-1 -10 -2 0" fill="none" stroke="${dk(c || '#e63946', .3)}" stroke-width="3"/><path d="M8 -16 h9 v9 h-9z" fill="#f6efe0" ${sw(2)}/></g>`;
    default: return '';
  }
}
// Things held at a hand (people) or at the mouth (animals); (0, 0) is the grip, pointing forward (+x).
function carry(kind, c) {
  switch (kind) {
    case 'trumpet': return `<rect x="0" y="-2.5" width="20" height="5" fill="#ffc83d" ${sw(2)}/><path d="M18 0 L34 -10 L34 10Z" fill="#ffc83d" ${sj(2.5)}/>`;
    case 'flag': return `<line x1="0" y1="10" x2="4" y2="-70" ${sw(3.5)}/><path d="M4 -70 l30 8 l-30 9z" fill="${c || '#ff5a5f'}" ${sj(2.5)}/>`;
    case 'baton': return part('twirl', 18, 0, `<line x1="-2" y1="0" x2="38" y2="0" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="38" cy="0" r="5" fill="#ffd166" ${sw(2)}/><circle cx="-2" cy="0" r="4" fill="#ffd166" ${sw(2)}/>`);
    case 'bone': return `<g transform="translate(6 2)"><rect x="-10" y="-3" width="20" height="6" fill="#fff6e3" ${sw(2)}/><circle cx="-11" cy="-3" r="4" fill="#fff6e3" ${sw(2)}/><circle cx="-11" cy="3" r="4" fill="#fff6e3" ${sw(2)}/><circle cx="11" cy="-3" r="4" fill="#fff6e3" ${sw(2)}/><circle cx="11" cy="3" r="4" fill="#fff6e3" ${sw(2)}/><rect x="-10" y="-2" width="20" height="4" fill="#fff6e3"/></g>`;
    case 'flashlight': return `${part('beam', 0, 0, `<path d="M20 -3 L300 -70 L300 70 L20 3Z" fill="url(#cl-beam)"/>`)}<rect x="-4" y="-5" width="24" height="10" rx="3" fill="#3a3f63" ${sw(2.5)}/><rect x="17" y="-7" width="7" height="14" rx="2" fill="#ffe08a" ${sw(2)}/>`;
    case 'battery': return `<rect x="-2" y="-9" width="26" height="18" rx="3" fill="#3a9155" ${sw(2.5)}/><rect x="24" y="-4" width="4" height="8" fill="#c9ccd6" ${sw(1.5)}/><path d="M6 0 h8 M10 -4 v8" stroke="#fff" stroke-width="2.5"/>`;
    case 'clipboard': return `<rect x="-2" y="-22" width="22" height="28" rx="2" fill="#a8743c" ${sw(2.5)}/><rect x="2" y="-17" width="14" height="19" fill="#fff" ${sw(1.5)}/><path d="M5 -12 h8 M5 -7 h8 M5 -2 h6" stroke="#8a8f9c" stroke-width="1.5"/><rect x="5" y="-25" width="8" height="5" rx="1" fill="#c9ccd6" ${sw(1.5)}/>`;
    case 'coffee': return `<path d="M0 -14 h14 l-2 16 h-10z" fill="${c || '#fff6e3'}" ${sj(2.5)}/><path d="M14 -10 q7 0 6 6 q-1 4 -7 4" fill="none" ${sw(2.5)}/><path d="M4 -19 q-3 -5 1 -9 M9 -19 q-3 -5 1 -9" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/>`;
    case 'kit': return `<rect x="-14" y="0" width="30" height="22" rx="5" fill="#f4843d" ${sw(2.5)}/><path d="M-6 0 q7 -9 14 0" fill="none" ${sw(3)}/><path d="M1 6 v11 M-4.5 11.5 h11" stroke="#fff" stroke-width="3.5"/>`;
    case 'meter': return `<rect x="-2" y="-12" width="20" height="26" rx="4" fill="#ffcf4a" ${sw(2.5)}/><rect x="2" y="-8" width="12" height="9" rx="1.5" fill="#9df5c2" ${sw(1.5)}/><line x1="18" y1="0" x2="34" y2="-22" ${sw(3)}/><circle cx="35" cy="-24" r="3.5" fill="#e63946" ${sw(2)}/>`;
    case 'hose': return `${tube('M-30 30 Q-10 10 0 0', 7, '#c9a24a')}<path d="M0 -4 L20 -3 L20 3 L0 4Z" fill="#c9ccd6" ${sj(2.5)}/>`;
    case 'drum': case 'tuba': case 'band': return ''; // worn on the body; see dog()
    default: return '';
  }
}

// ---------- animals ----------
const DOG = {
  retriever: { c: '#e8a15a', e: '#a8743c' },
  lab: { c: '#8b5a3c', e: '#4a2c18' },
  dachshund: { c: '#b5653a', e: '#5a2f18', long: 1 },
  poodle: { c: '#ffffff', e: '#c9c9d6', pood: 1 },
  terrier: { c: '#f0c987', e: '#a8743c', perk: 1, s: .85 },
  dalmatian: { c: '#ffffff', e: '#2e2733', spots: 1 },
  beagle: { c: '#f6ead6', e: '#8b5a3c', saddle: '#5a3a26' },
  pug: { c: '#e8c39e', e: '#3a2f2a', s: .78, pug: 1 },
  husky: { c: '#9aa0b2', e: '#3d3d4a', perk: 1, mask: 1, s: 1.1 },
  mutt: { c: '#d9d2c3', e: '#6b6b7a', spot: 1 },
};
function dog(o) {
  const B = DOG[o.variant] || DOG.retriever, c = o.color || B.c, e = B.e;
  const long = B.long, pood = B.pood, perk = B.perk;
  const bx = long ? 44 : 30, legH = long ? 10 : 20, by = -(legH + 10);
  const xs = long ? [-32, -22, 24, 34] : [-19, -9, 13, 23];
  const leg = (i) => { const x = xs[i]; return part(i === 0 || i === 3 ? 'la' : 'lb', x, by + 6, `<rect x="${x - 4.5}" y="${by + 2}" width="9" height="${-by - 2}" rx="4.5" fill="${i === 1 || i === 3 ? e : c}" ${sw(2.5)}/>${pood ? `<circle cx="${x}" cy="-4" r="6" fill="${c}" ${sw(2.5)}/>` : ''}`); };
  let s = leg(1) + leg(3);
  const tp = B.pug ? `M${-bx + 4} ${by - 6} q-12 -4 -10 -14 q4 -8 10 -2` : `M${-bx + 4} ${by - 3} q-15 -5 -13 -24`;
  s += part('tail', -bx + 4, by - 3, tube(tp, 5.5, c) + (pood ? `<circle cx="${-bx - 9}" cy="${by - 27}" r="7" fill="${c}" ${sw(2.5)}/>` : ''));
  if (o.carry === 'tuba') s += `<path d="M-8 ${by - 8} L-22 ${by - 60} L16 ${by - 60} L6 ${by - 8}Z" fill="#ffc83d" ${sj(3)}/>`;
  s += `<ellipse cx="0" cy="${by}" rx="${bx}" ry="15" fill="${c}" ${sw(3)}/>`;
  if (B.spot) s += `<ellipse cx="-6" cy="${by - 4}" rx="11" ry="7" fill="${e}"/>`;
  if (B.saddle) s += `<path d="M${-bx + 8} ${by - 9} Q-4 ${by - 17} ${bx - 14} ${by - 10} Q${bx - 16} ${by + 2} -4 ${by + 1} Q${-bx + 10} ${by + 1} ${-bx + 8} ${by - 9}Z" fill="${B.saddle}"/>`;
  if (B.spots) s += [[-14, -6, 5], [4, -10, 4], [14, 2, 4.5], [-4, 5, 3.5], [-22, 3, 3]].map(([x, y, r]) => `<circle cx="${x}" cy="${by + y}" r="${r}" fill="${e}"/>`).join('');
  if (o.carry === 'tuba') s += `<circle cx="2" cy="${by}" r="12" fill="none" stroke="${OL}" stroke-width="10"/><circle cx="2" cy="${by}" r="12" fill="none" stroke="#ffc83d" stroke-width="6"/>`;
  s += leg(0) + leg(2);
  if (o.carry === 'drum') s += `<g transform="translate(${bx - 14} ${by + 6})"><rect x="-13" y="-10" width="26" height="24" rx="5" fill="#e63946" ${sw(3)}/><path d="M-13 -1 l6.5 8 l6.5 -8 l6.5 8 l6.5 -8" fill="none" stroke="#ffd166" stroke-width="2.5"/><rect x="-15" y="-13" width="30" height="6" rx="3" fill="#fff" ${sw(2)}/></g>`;
  if (o.carry === 'flag') s += `<g transform="translate(${bx - 8} ${by + 4})">${carry('flag', o.color2)}</g>`;
  let h = '';
  if (perk) h += `<path d="M-10 -8 L-7 -31 L4 -12Z" fill="${e}" ${sj(2.5)}/>`;
  h += `<ellipse cx="15" cy="5" rx="${B.pug ? 8 : 11}" ry="8" fill="${B.pug || B.mask ? (B.mask ? '#fff' : e) : c}" ${sw(3)}/><circle r="15" fill="${c}" ${sw(3)}/>`;
  if (B.mask) h += `<path d="M-2 4 Q8 14 16 2 Q6 -2 -2 4Z" fill="#fff"/>`;
  if (B.spots) h += `<circle cx="-4" cy="-6" r="3.5" fill="${e}"/>`;
  h += `<circle cx="${B.pug ? 22 : 25}" cy="2" r="4.2" fill="${OL}"/>${eye(6, -4, 3)}`;
  if (!perk) h += `<path d="M-5 -13 C-20 -11 -19 7 -11 12 C-7 5 -2 -4 -5 -13Z" fill="${e}" ${sw(2.5)}/>`;
  if (pood) h += `<circle cx="-1" cy="-15" r="9" fill="${c}" ${sw(2.5)}/>`;
  h += o.carry === 'bone' ? `<g transform="translate(14 12)">${carry('bone')}</g>` : `<path d="M15 11 q2 9 8 1" fill="#ff7b9c" ${sw(2)}/>`;
  if (o.carry === 'trumpet') h += `<g transform="translate(24 4.5)">${carry('trumpet')}</g>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(-1 -12)">${hat(o.hat, o.color2)}</g>`;
  if (o.carry === 'baton') h += `<g transform="translate(10 -28)">${carry('baton')}</g>`;
  s += `<g transform="translate(${bx - 3} ${by - 17})">${part('hd', -6, 10, h)}</g>`;
  return B.s ? `<g transform="scale(${B.s})">${s}</g>` : s;
}
def('dog', { kind: 'animal', rig: 'quad', w: 85, h: 62, draw: dog, variants: Object.keys(DOG),
  hats: ['none', 'party', 'cap', 'shako', 'cowboy', 'bow', 'helmet'], carries: ['none', 'trumpet', 'drum', 'tuba', 'flag', 'baton', 'bone'],
  desc: 'friendly cartoon dog; pug and terrier are small, husky big, dachshund long and low' });

const CAT = { tabby: ['#f4a259', '#c8682a'], black: ['#3d3747', '#26222e'], grey: ['#a3a9ba', '#6b7184'], calico: ['#fbf3e4', '#e0893a'] };
function cat(o) {
  const [c0, e] = CAT[o.variant] || CAT.tabby, c = o.color || c0, black = o.variant === 'black' && !o.color;
  const leg = (x, k, f) => part(k, x, -20, `<rect x="${x - 3.5}" y="-22" width="7" height="22" rx="3.5" fill="${f}" ${sw(2.5)}/>`);
  let s = leg(-9, 'lb', dk(c, .18)) + leg(20, 'la', dk(c, .18));
  s += part('tail', -22, -26, tube('M-22 -26 C-38 -28 -42 -50 -32 -62 Q-26 -68 -22 -62', 4.5, c));
  s += `<ellipse cx="2" cy="-26" rx="25" ry="11.5" fill="${c}" ${sw(3)}/>`;
  if (o.variant === 'tabby') s += `<path d="M-12 -36 q3 5 0 9 M-3 -37 q3 5 0 9 M6 -37 q3 5 0 9" fill="none" stroke="${e}" stroke-width="3" stroke-linecap="round"/>`;
  if (o.variant === 'calico') s += `<ellipse cx="-8" cy="-29" rx="8" ry="5" fill="${e}"/><ellipse cx="9" cy="-27" rx="6" ry="4" fill="#3d3747"/>`;
  s += leg(-17, 'la', c) + leg(12, 'lb', c);
  let h = `<path d="M17 -46 L18 -61 L28 -50Z" fill="${c}" ${sj(2.5)}/><path d="M29 -50 L38 -61 L39 -45Z" fill="${c}" ${sj(2.5)}/><path d="M20 -50 L20 -57 L25 -51Z M32 -50 L37 -56 L37 -48Z" fill="#ff9fb5"/>`;
  h += `<circle cx="28" cy="-38" r="13" fill="${c}" ${sw(3)}/>`;
  if (o.variant === 'calico') h += `<path d="M18 -45 Q24 -50 28 -46 Q24 -40 18 -40Z" fill="${e}"/>`;
  h += black ? `<ellipse cx="32" cy="-41" rx="3.4" ry="3.8" fill="#ffd166"/><ellipse cx="32.6" cy="-41" rx="1.2" ry="3" fill="${OL}"/>` : eye(32, -41, 2.8);
  h += `<path d="M39 -36 l3 2 l-3 2z" fill="#ff7b9c" ${sw(1.2)}/><path d="M36 -33 L51 -36 M36 -31 L51 -29" stroke="${black ? '#c9ccd6' : OL}" stroke-width="1.4"/>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(27 -50) scale(.8)">${hat(o.hat, o.color2)}</g>`;
  s += part('hd', 20, -32, h);
  return s;
}
def('cat', { kind: 'animal', rig: 'quad', w: 80, h: 62, draw: cat, variants: Object.keys(CAT), hats: ['none', 'party', 'bow', 'cowboy'], desc: 'small cat, tail up' });

const COW = { holstein: { c: '#fbf7ef', p: '#2e2733', m: '#ffb3c1' }, jersey: { c: '#b9773e', p: null, m: '#f2dcc0' }, black: { c: '#3d3747', p: null, m: '#d9c3c9' } };
function cow(o) {
  const V = COW[o.variant] || COW.holstein, c = o.color || V.c;
  const leg = (x, k, f) => part(k, x, -46, `<rect x="${x - 6.5}" y="-50" width="13" height="50" rx="5" fill="${f}" ${sw(3)}/><rect x="${x - 6.5}" y="-9" width="13" height="9" rx="2" fill="${OL}"/>`);
  let s = leg(-30, 'lb', dk(c, .15)) + leg(38, 'la', dk(c, .15));
  s += part('tail', -56, -90, tube('M-56 -90 q-14 10 -12 40', 3.5, c) + `<ellipse cx="-68" cy="-48" rx="6" ry="9" fill="${V.p || dk(c, .4)}" ${sw(2.5)}/>`);
  s += `<ellipse cx="-24" cy="-44" rx="11" ry="8" fill="#ffb3c1" ${sw(2.5)}/><path d="M-30 -38 v6 M-24 -37 v7 M-18 -38 v6" ${sw(3)} stroke-linecap="round"/>`;
  s += `<rect x="-60" y="-100" width="116" height="58" rx="27" fill="${c}" ${sw(3.5)}/>`;
  if (V.p && !o.color) s += `<path d="M-38 -96 Q-20 -98 -16 -84 Q-18 -70 -34 -72 Q-46 -80 -38 -96Z" fill="${V.p}"/><path d="M6 -78 Q20 -84 28 -70 Q24 -54 10 -56 Q0 -64 6 -78Z" fill="${V.p}"/><ellipse cx="-44" cy="-58" rx="7" ry="5" fill="${V.p}"/>`;
  s += leg(-42, 'la', c) + leg(26, 'lb', c);
  let h = `<ellipse cx="46" cy="-106" rx="11" ry="5" transform="rotate(-25 46 -106)" fill="${c}" ${sw(2.5)}/>`;
  h += `<path d="M52 -116 q-6 -10 0 -14 M72 -116 q6 -10 0 -14" fill="none" stroke="${OL}" stroke-width="7" stroke-linecap="round"/><path d="M52 -116 q-6 -10 0 -14 M72 -116 q6 -10 0 -14" fill="none" stroke="#f6efe0" stroke-width="3.5" stroke-linecap="round"/>`;
  h += `<rect x="46" y="-118" width="34" height="38" rx="15" fill="${c}" ${sw(3)}/>`;
  if (V.p && !o.color) h += `<path d="M48 -110 Q56 -116 62 -108 Q58 -98 50 -100Z" fill="${V.p}"/>`;
  h += `<ellipse cx="72" cy="-82" rx="16" ry="12" fill="${V.m}" ${sw(3)}/><ellipse cx="68" cy="-82" rx="2.4" ry="3.2" fill="${OL}"/><ellipse cx="78" cy="-82" rx="2.4" ry="3.2" fill="${OL}"/>${eye(68, -102, 3.2)}`;
  h += `<path d="M48 -78 Q60 -68 74 -70" fill="none" stroke="#e63946" stroke-width="4"/><path d="M58 -73 l-5 10 h10z" fill="#ffcf4a" ${sj(2)}/>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(62 -118)">${hat(o.hat, o.color2)}</g>`;
  s += part('hd', 50, -92, h);
  return s;
}
def('cow', { kind: 'animal', rig: 'quad', w: 150, h: 130, draw: cow, variants: Object.keys(COW), hats: ['none', 'party', 'cowboy', 'bow'], desc: 'big friendly cow with a bell' });

const HORSE = { bay: ['#8b5a3c', '#2e1f18'], chestnut: ['#c06a36', '#7a3a1a'], grey: ['#c9ccd6', '#6b6b7a'], palomino: ['#e8c07a', '#fff6e3'] };
function horse(o) {
  const [c0, m] = HORSE[o.variant] || HORSE.bay, c = o.color || c0;
  const leg = (x, k, f) => part(k, x, -70, `<rect x="${x - 6}" y="-74" width="12" height="74" rx="5" fill="${f}" ${sw(3)}/><rect x="${x - 7}" y="-10" width="14" height="10" rx="2" fill="${OL}"/>`);
  let s = leg(-34, 'lb', dk(c, .18)) + leg(40, 'la', dk(c, .18));
  s += part('tail', -58, -100, `<path d="M-58 -102 Q-86 -96 -84 -52 Q-74 -70 -70 -60 Q-68 -84 -56 -90Z" fill="${m}" ${sj(3)}/>`);
  s += `<ellipse cx="0" cy="-92" rx="60" ry="27" fill="${c}" ${sw(3.5)}/>`;
  s += leg(-46, 'la', c) + leg(28, 'lb', c);
  let h = `<path d="M32 -108 Q52 -128 58 -160 L78 -150 Q72 -112 56 -78 Z" fill="${c}" ${sj(3.5)}/>`;
  h += `<path d="M54 -164 Q40 -150 44 -132 Q34 -120 36 -104 Q46 -112 50 -124 Q56 -140 62 -156Z" fill="${m}" ${sj(2.5)}/>`;
  h += `<path d="M58 -168 L62 -184 L70 -168Z" fill="${c}" ${sj(2.5)}/>`;
  h += `<path d="M56 -166 Q76 -176 102 -146 Q108 -134 96 -130 Q84 -128 64 -140 Q54 -152 56 -166Z" fill="${c}" ${sj(3.5)}/>`;
  h += `<ellipse cx="97" cy="-138" rx="3" ry="2" fill="${OL}"/>${eye(72, -156, 3.2)}<path d="M84 -133 q6 3 12 1" fill="none" ${sw(2)}/>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(66 -168) rotate(12)">${hat(o.hat, o.color2)}</g>`;
  s += part('hd', 44, -110, h);
  return s;
}
def('horse', { kind: 'animal', rig: 'quad', w: 175, h: 185, draw: horse, variants: Object.keys(HORSE), hats: ['none', 'party', 'cowboy', 'bow'], desc: 'tall horse with a mane' });

const GATOR = { green: ['#5a9a4a', '#c9d98a'], olive: ['#7a8a3a', '#e0d9a0'] };
function gator(o) {
  const [c0, b] = GATOR[o.variant] || GATOR.green, c = o.color || c0, d = dk(c, .25);
  const leg = (x, k, f) => part(k, x, -14, `<path d="M${x - 6} -16 L${x - 7} -2 Q${x - 7} 0 ${x - 4} 0 L${x + 10} 0 Q${x + 12} -2 ${x + 7} -6 L${x + 6} -16Z" fill="${f}" ${sj(2.5)}/>`);
  let s = leg(-30, 'lb', d) + leg(34, 'la', d);
  s += part('tail', -44, -18, `<path d="M-40 -32 Q-100 -30 -150 -6 Q-100 -8 -40 -8Z" fill="${c}" ${sj(3)}/>${[-60, -80, -100, -120].map((x, i) => `<path d="M${x} ${-29 + i * 5} l7 -9 l7 ${8 - i}" fill="${d}" ${sj(2)}/>`).join('')}`);
  s += `<path d="M-50 -14 Q-50 -40 0 -40 Q40 -40 54 -28 L54 -10 Q30 -6 -50 -14Z" fill="${c}" ${sj(3)}/><path d="M-44 -14 Q0 -8 52 -12 Q30 -2 -44 -14Z" fill="${b}"/>`;
  s += [-30, -14, 2, 18].map((x) => `<path d="M${x} -39 l7 -9 l7 9" fill="${d}" ${sj(2)}/>`).join('');
  s += leg(-40, 'la', c) + leg(22, 'lb', c);
  let h = part('jaw', 50, -18, `<path d="M48 -20 L116 -14 Q120 -10 114 -8 L50 -8Z" fill="${c}" ${sj(3)}/><path d="M60 -14 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5" fill="#fff" ${sw(1.5)}/>`);
  h += `<path d="M44 -36 Q60 -46 72 -38 L118 -26 Q126 -20 118 -16 L50 -18Z" fill="${c}" ${sj(3)}/><path d="M60 -20 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5" fill="#fff" ${sw(1.5)}/>`;
  h += `<circle cx="110" cy="-27" r="2" fill="${OL}"/><circle cx="62" cy="-42" r="9" fill="${c}" ${sw(3)}/><circle cx="64" cy="-44" r="6" fill="#fff6c9" ${sw(1.5)}/><ellipse cx="65.5" cy="-44" rx="2" ry="4" fill="${OL}"/>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(64 -50) scale(.85)">${hat(o.hat, o.color2)}</g>`;
  s += part('hd', 48, -24, h);
  return s;
}
def('alligator', { kind: 'animal', rig: 'quad', w: 270, h: 55, draw: gator, variants: Object.keys(GATOR), hats: ['none', 'party', 'cowboy', 'bow'], desc: 'long, low, toothy-but-friendly alligator; its jaw snaps in idle' });

const COON = { grey: '#8a8f9c', brown: '#9a8070' };
function raccoon(o) {
  const c = o.color || COON[o.variant] || COON.grey, d = dk(c, .3);
  const leg = (x, k, f) => part(k, x, -16, `<rect x="${x - 4}" y="-18" width="8" height="18" rx="4" fill="${f}" ${sw(2.5)}/>`);
  let s = leg(-8, 'lb', '#3a3442') + leg(18, 'la', '#3a3442');
  let tail = `<path d="M-24 -26 Q-44 -30 -52 -48 Q-46 -58 -36 -50 Q-32 -38 -18 -36Z" fill="${c}" ${sj(3)}/>`;
  tail += `<path d="M-32 -30 L-38 -40 M-41 -38 L-48 -46 M-45 -50 L-38 -52" stroke="#2e2733" stroke-width="5" stroke-linecap="round"/>`;
  s += part('tail', -22, -28, tail);
  s += `<ellipse cx="0" cy="-27" rx="25" ry="15" fill="${c}" ${sw(3)}/><path d="M-12 -18 Q2 -12 16 -18" fill="none" stroke="${lt(c, .4)}" stroke-width="5" stroke-linecap="round"/>`;
  s += leg(-16, 'la', d) + leg(10, 'lb', d);
  let h = `<circle cx="16" cy="-56" r="6" fill="${c}" ${sw(2.5)}/><circle cx="32" cy="-56" r="6" fill="${c}" ${sw(2.5)}/>`;
  h += `<path d="M10 -44 Q24 -60 38 -44 L48 -38 Q44 -32 38 -32 Q24 -28 12 -36Z" fill="${c}" ${sj(3)}/>`;
  h += `<path d="M14 -46 Q28 -54 42 -42 Q34 -38 30 -42 Q24 -38 14 -40Z" fill="#2e2733"/><path d="M38 -36 Q44 -36 48 -38 Q44 -32 36 -32Z" fill="#fff6e3"/>`;
  h += `<circle cx="49" cy="-37" r="2.6" fill="${OL}"/><circle cx="34" cy="-45" r="2.6" fill="#fff"/><circle cx="34.6" cy="-45" r="1.4" fill="${OL}"/>`;
  if (o.carry === 'bone') h += `<g transform="translate(46 -30) scale(.8)">${carry('bone')}</g>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(24 -58) scale(.8)">${hat(o.hat, o.color2)}</g>`;
  s += part('hd', 18, -38, h);
  return s;
}
def('raccoon', { kind: 'animal', rig: 'quad', w: 100, h: 62, draw: raccoon, variants: Object.keys(COON), hats: ['none', 'party', 'cowboy', 'bow'], carries: ['none', 'bone'], desc: 'masked raccoon with a ringed tail' });

// ---------- people: generic figures, no faces (a nose nub in profile, nothing from behind) ----------
const SKIN = ['#f2c9a0', '#e0a878', '#b97f52', '#8a5a3a'];
const HAIR = ['#3a2a22', '#6b4a2c', '#c9a24a', '#8a3a22', '#2e2733', '#d9d2c3'];
// spec: { skin, hair, shirt, pants, shoes, top(view) → hat/hair over the head, body → extra torso art, back → back-of-body art, sleeve, scale }
function person(o, sp) {
  const back = o.variant === 'back' || /_back$/.test(o.variant || ''), seed = o.seed || 0;
  const skin = sp.skin || SKIN[seed % SKIN.length], hair = sp.hair || HAIR[(seed >> 2) % HAIR.length];
  const shirt = sp.shirt, pants = sp.pants, shoes = sp.shoes || '#2e2733';
  const leg = (k, x, f) => part(k, x, -62, `<rect x="${x - 6.5}" y="-66" width="13" height="58" rx="6" fill="${f}" ${sw(3)}/>${back ? `<rect x="${x - 8}" y="-12" width="16" height="12" rx="5" fill="${shoes}" ${sw(2.5)}/>` : `<path d="M${x - 8} -10 h16 q9 0 9 8 v2 h-25z" fill="${shoes}" ${sj(2.5)}/>`}`);
  const handAt = (x, y) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${skin}" ${sw(2.5)}/>`;
  const arm = (k, x, f, held) => part(k, x, -108, `<rect x="${x - 5.5}" y="-112" width="11" height="46" rx="5.5" fill="${f}" ${sw(3)}/>${sp.sleeve ? sp.sleeve(x) : ''}${handAt(x, -64)}${held ? `<g transform="translate(${x + 2} -62)">${held}</g>` : ''}`);
  const held = !o.carry || o.carry === 'none' ? '' : /^(flashlight|hose)$/.test(o.carry) ? `<g transform="rotate(90)">${carry(o.carry, o.color2)}</g>` : carry(o.carry, o.color2);
  let s = '';
  if (back) {
    s += leg('la', -8, pants) + leg('lb', 8, pants);
    s += sp.back ? sp.back() : '';
    s += arm('aa', -21, shirt, '') + arm('ab', 21, shirt, held);
    s += `<rect x="-19" y="-122" width="38" height="66" rx="15" fill="${shirt}" ${sw(3)}/>` + (sp.body ? sp.body(true) : '');
    let h = `<circle cx="-16" cy="-138" r="4.5" fill="${skin}" ${sw(2)}/><circle cx="16" cy="-138" r="4.5" fill="${skin}" ${sw(2)}/><circle cx="0" cy="-140" r="17" fill="${skin}" ${sw(3)}/>`;
    h += sp.top ? sp.top(true, hair) : `<path d="M-17 -140 Q-18 -160 0 -158 Q18 -160 17 -140 Q16 -128 0 -126 Q-16 -128 -17 -140Z" fill="${hair}" ${sw(2.5)}/>`;
    if (o.hat && o.hat !== 'none' && !sp.top) h += `<g transform="translate(0 -154)">${hat(o.hat, o.color2)}</g>`;
    s += part('hd', 0, -122, h);
  } else {
    s += leg('lb', -2, dk(pants, .2)) + arm('aa', 2, dk(shirt, .2), '');
    s += leg('la', 4, pants);
    s += sp.back ? sp.back() : '';
    s += `<rect x="-18" y="-122" width="36" height="66" rx="15" fill="${shirt}" ${sw(3)}/>` + (sp.body ? sp.body(false) : '');
    let h = `<circle cx="3" cy="-140" r="17" fill="${skin}" ${sw(3)}/><circle cx="20" cy="-138" r="4.5" fill="${skin}" ${sw(2.5)}/><rect x="13" y="-141" width="8" height="7" fill="${skin}"/>`;
    h += sp.top ? sp.top(false, hair) : `<path d="M-14 -138 Q-16 -160 4 -158 Q18 -158 19 -146 Q8 -150 2 -144 Q-2 -134 -8 -128 Q-14 -130 -14 -138Z" fill="${hair}" ${sw(2.5)}/>`;
    h += `<circle cx="-4" cy="-138" r="3.5" fill="${dk(skin, .15)}"/>`;
    if (o.hat && o.hat !== 'none' && !sp.top) h += `<g transform="translate(3 -155)">${hat(o.hat, o.color2)}</g>`;
    s += part('hd', 2, -122, h);
    s += arm('ab', 2, shirt, held);
  }
  return sp.scale ? `<g transform="scale(${sp.scale})">${s}</g>` : s;
}
const stripe = (y, c = '#e8eef5') => (back) => `<rect x="${back ? -19 : -18}" y="${y}" width="${back ? 38 : 36}" height="7" fill="${c}" stroke="#ffcf4a" stroke-width="2"/>`;
const VIEWS = ['profile', 'back'];
const campaign = (back) => `<g transform="translate(${back ? 0 : 3} -154)"><ellipse cx="0" cy="0" rx="27" ry="5.5" fill="#8a6a3c" ${sw(2.5)}/><path d="M-12 -1 L-10 -18 Q-5 -14 0 -19 Q5 -14 10 -18 L12 -1Z" fill="#8a6a3c" ${sj(2.5)}/><rect x="-12" y="-6" width="24" height="4" fill="${OL}" opacity=".55"/></g>`;
def('deputy', { kind: 'person', rig: 'biped', w: 60, h: 165, variants: VIEWS, carries: ['none', 'flashlight', 'clipboard', 'coffee'],
  desc: 'sheriff deputy in tan shirt and campaign hat; competent and kind, never the butt of a joke', draw: (o) => person(o, {
    shirt: '#c8a96a', pants: '#3d4a3a', top: (back) => campaign(back) + (back ? '' : '<path d="M-14 -146 Q-12 -136 -6 -132" fill="none" stroke="#3a2a22" stroke-width="5"/>'),
    body: (back) => `<rect x="${back ? -19 : -18}" y="-68" width="${back ? 38 : 36}" height="8" fill="${OL}"/>${back ? '' : `<rect x="8" y="-114" width="8" height="13" rx="2" fill="#2e2733" ${sw(1.5)}/><line x1="13" y1="-114" x2="13" y2="-126" ${sw(2)}/><path d="M-6 -118 v16" stroke="${dk('#c8a96a', .2)}" stroke-width="2"/>`}`,
  }) });
def('firefighter', { kind: 'person', rig: 'biped', w: 60, h: 168, variants: VIEWS, carries: ['none', 'hose', 'meter', 'flashlight', 'battery'],
  desc: 'firefighter in turnout coat with reflective stripes, helmet and air tank', draw: (o) => person(o, {
    shirt: '#d9a441', pants: '#d9a441', shoes: '#2e2733',
    top: (back, hair) => `<g transform="translate(${back ? 0 : 3} -150)">${back ? `<path d="M-20 4 Q-20 -22 0 -22 Q20 -22 20 4 Q0 10 -20 4Z" fill="${o.color || '#e63946'}" ${sj(2.5)}/>` : hat('helmet', o.color || '#e63946')}</g>`,
    body: (back) => stripe(-100)(back) + stripe(-76)(back) + (back ? '' : `<path d="M0 -122 v62" stroke="${dk('#d9a441', .3)}" stroke-width="2"/>`),
    back: () => `<rect x="-30" y="-120" width="16" height="44" rx="8" fill="#ffcf4a" ${sw(3)}/><rect x="-27" y="-126" width="10" height="8" rx="2" fill="#c9ccd6" ${sw(2)}/>`,
    sleeve: (x) => `<rect x="${x - 5.5}" y="-80" width="11" height="6" fill="#e8eef5" stroke="#ffcf4a" stroke-width="1.5"/>`,
  }) });
def('emt', { kind: 'person', rig: 'biped', w: 60, h: 165, variants: VIEWS, carries: ['none', 'kit', 'clipboard', 'flashlight'],
  desc: 'EMT in navy with a reflective stripe and cap', draw: (o) => person(o, {
    shirt: '#2f3f6e', pants: '#26304f',
    top: (back, hair) => `<g transform="translate(${back ? 0 : 3} -154)">${back ? `<path d="M-17 4 Q-17 -16 0 -16 Q17 -16 17 4Z" fill="#2f3f6e" ${sw(2.5)}/>` : hat('cap', '#2f3f6e')}</g>` + (back ? '' : `<path d="M-14 -146 Q-12 -136 -6 -132" fill="none" stroke="${hair}" stroke-width="5"/>`),
    body: stripe(-96, '#9fd8ff'),
  }) });
const FOLK = {
  robe: { shirt: '#ff8fab', pants: '#ffd1dc', shoes: '#fff6e3', body: (b) => `<path d="M-18 -84 h36" stroke="#fff" stroke-width="5"/>${b ? '' : '<path d="M2 -122 L12 -98" stroke="#fff" stroke-width="4"/>'}`, top: (b, h) => `<path d="M-15 -140 Q-17 -160 2 -159 Q19 -158 18 -142 Q8 -150 -2 -146 Q-10 -142 -15 -140Z" fill="${h}" ${sw(2.5)}/>${[[-8, -156], [4, -160], [14, -154]].map(([x, y]) => `<rect x="${x - 4}" y="${y - 3}" width="8" height="6" rx="3" fill="#ff8fab" ${sw(1.5)}/>`).join('')}` },
  farmer: { shirt: '#c0392b', pants: '#3a6ea5', body: (b) => `<rect x="-14" y="-104" width="28" height="44" rx="4" fill="#3a6ea5" ${sw(2.5)}/><path d="M-10 -104 l-4 -14 M10 -104 l4 -14" stroke="#3a6ea5" stroke-width="5"/><path d="M-18 -112 h36 M-18 -100" stroke="${dk('#c0392b', .3)}" stroke-width="2"/>`, top: (b) => `<g transform="translate(${b ? 0 : 3} -154)"><ellipse cx="0" cy="0" rx="28" ry="6" fill="#f0d27a" ${sw(2.5)}/><path d="M-13 -1 Q-13 -18 0 -18 Q13 -18 13 -1Z" fill="#f0d27a" ${sw(2.5)}/><rect x="-13" y="-6" width="26" height="4" fill="#c0392b"/></g>` },
  jogger: { shirt: '#2a9d8f', pants: '#2a9d8f', shoes: '#fff', body: (b) => `<path d="M${b ? -19 : -18} -100 h${b ? 38 : 36}" stroke="#fff" stroke-width="4"/>`, top: (b, h) => `<path d="M-15 -140 Q-17 -160 2 -159 Q19 -158 18 -142 Q8 -150 -2 -146 Q-10 -142 -15 -140Z" fill="${h}" ${sw(2.5)}/><path d="M-16 -146 Q2 -152 19 -146" fill="none" stroke="#ff5a5f" stroke-width="5"/>` },
  shopkeeper: { shirt: '#f4f1ea', pants: '#4a4a5a', body: (b) => b ? `<path d="M-19 -100 h38" stroke="#3a9155" stroke-width="4"/>` : `<path d="M-6 -110 h20 v52 h-20z" fill="#3a9155" ${sj(2.5)}/>` },
  elder: { shirt: '#7b5ea7', pants: '#5a5a6a', hair: '#e8e8f0', body: (b) => `<path d="M-6 -120 v58" stroke="${dk('#7b5ea7', .3)}" stroke-width="2"/>${[-110, -96, -82].map((y) => `<circle cx="${b ? 0 : 6}" cy="${y}" r="2" fill="#ffcf4a"/>`).join('')}` },
  kid: { shirt: '#ffcf4a', pants: '#3a86ff', scale: .7, body: () => `<path d="M-18 -104 h36 M-18 -88 h36" stroke="#e63946" stroke-width="5"/>` },
};
def('townsfolk', { kind: 'person', rig: 'biped', w: 60, h: 165, variants: [...Object.keys(FOLK), ...Object.keys(FOLK).map((k) => `${k}_back`)],
  hats: ['none', 'party', 'cap', 'cowboy', 'bow'], carries: ['none', 'coffee', 'flashlight', 'clipboard', 'battery', 'flag'],
  desc: 'generic resident (robe = bathrobe and curlers, farmer, jogger, shopkeeper, elder, kid); add _back to see them from behind', draw: (o) => {
    const f = FOLK[(o.variant || 'robe').replace(/_back$/, '')] || FOLK.robe;
    return person(o, { ...f, shirt: o.color || f.shirt });
  } });

// The dispatcher sits at a console (monitors, mic, radio stack), seen in profile.
function dispatcher(o) {
  const skin = SKIN[(o.seed || 1) % SKIN.length], hair = HAIR[((o.seed || 1) >> 2) % HAIR.length], shirt = o.color || '#5b6fb0';
  let s = `<rect x="34" y="-92" width="190" height="14" rx="3" fill="#8a6a4c" ${sw(3)}/><rect x="190" y="-78" width="26" height="78" fill="#6b5240" ${sw(3)}/><rect x="40" y="-78" width="12" height="78" fill="#6b5240" ${sw(3)}/>`;
  s += `<rect x="120" y="-172" width="100" height="72" rx="6" fill="#2e3352" ${sw(3)}/><rect x="128" y="-164" width="84" height="56" rx="3" fill="#163a4a"/>`;
  s += part('scr', 170, -136, `<path d="M134 -150 h50 M134 -140 h70 M134 -130 h40 M134 -120 h60" stroke="#6ff0c0" stroke-width="3" stroke-linecap="round"/>`);
  s += `<rect x="164" y="-100" width="12" height="8" fill="#2e3352"/>`;
  s += `<rect x="62" y="-128" width="56" height="36" rx="4" fill="#3a3f63" ${sw(3)}/>${[0, 1, 2].map((i) => part('led', 72 + i * 14, -114, `<circle cx="${72 + i * 14}" cy="-114" r="4" fill="${['#3dff8a', '#ffcf4a', '#ff5a5f'][i]}"/>`)).join('')}<rect x="68" y="-104" width="44" height="6" rx="3" fill="#23263d"/>`;
  s += `<path d="M100 -92 q0 -20 -22 -30" fill="none" ${sw(3)}/><ellipse cx="76" cy="-123" rx="6" ry="4" fill="#3a3f63" ${sw(2)}/>`;
  s += `<path d="M196 -100 h16 l-2 -16 h-12z" fill="#fff6e3" ${sj(2)}/>`;
  // swivel group: chair + person
  let p = `<rect x="-36" y="-6" width="56" height="6" rx="3" fill="#2e2733"/><circle cx="-30" cy="0" r="4" fill="#2e2733"/><circle cx="14" cy="0" r="4" fill="#2e2733"/><rect x="-6" y="-44" width="8" height="40" fill="#4a4a5a" ${sw(2)}/>`;
  p += `<rect x="-34" y="-60" width="50" height="16" rx="6" fill="#3a3f63" ${sw(3)}/><rect x="-42" y="-130" width="14" height="80" rx="7" fill="#3a3f63" ${sw(3)}/>`;
  p += `<path d="M-10 -56 h44 l2 50 h-12 l-2 -36 h-32z" fill="#4a4a5a" ${sj(3)}/><path d="M26 -8 h16 q6 0 6 6 v2 h-22z" fill="#2e2733"/>`;
  p += `<rect x="-24" y="-124" width="36" height="70" rx="15" fill="${shirt}" ${sw(3)}/>`;
  let h = `<circle cx="-3" cy="-142" r="17" fill="${skin}" ${sw(3)}/><circle cx="14" cy="-140" r="4.5" fill="${skin}" ${sw(2.5)}/><rect x="7" y="-143" width="8" height="7" fill="${skin}"/>`;
  h += `<path d="M-20 -140 Q-22 -162 -2 -160 Q12 -160 13 -148 Q2 -152 -4 -146 Q-8 -136 -14 -130 Q-20 -132 -20 -140Z" fill="${hair}" ${sw(2.5)}/>`;
  h += `<path d="M-18 -148 Q-4 -166 12 -150" fill="none" ${sw(4)}/><rect x="-14" y="-146" width="9" height="13" rx="4" fill="#3a3f63" ${sw(2)}/><path d="M-8 -134 Q2 -126 14 -130" fill="none" ${sw(2.5)}/><circle cx="15" cy="-130" r="2.5" fill="#3a3f63"/>`;
  if (o.hat && o.hat !== 'none') h += `<g transform="translate(-3 -158)">${hat(o.hat, o.color2)}</g>`;
  p += part('hd', -4, -124, h);
  p += part('ab', -4, -110, `<rect x="-9.5" y="-114" width="11" height="46" rx="5.5" fill="${shirt}" ${sw(3)}/><circle cx="-4" cy="-66" r="6.5" fill="${skin}" ${sw(2.5)}/>`);
  s += part('sp', -10, -60, p);
  return s;
}
def('dispatcher', { kind: 'person', rig: 'seated', w: 270, h: 175, variants: ['console'], hats: ['none', 'party'], desc: 'dispatcher on a swivel chair at a radio console (monitors, mic, radio stack); the desk is to their right', draw: dispatcher });

// ---------- vehicles: (0, 0) is the ground under the middle, facing right ----------
const wheel = (x, r = 20) => part('wh', x, -r, `<circle cx="${x}" cy="${-r}" r="${r}" fill="#1b1b28" ${sw(3)}/><circle cx="${x}" cy="${-r}" r="${r * .45}" fill="#a7adc6" ${sw(2)}/><path d="M${x - r * .45} ${-r} h${r * .9} M${x} ${-r - r * .45} v${r * .9}" stroke="${OL}" stroke-width="2"/>`);
// A light bar: red/blue (or red/white) blocks that flash, with glows.
const lightbar = (x, y, a = '#ff4d5a', b = '#4d7cff') => `${part('ga', x - 11, y, `<circle cx="${x - 11}" cy="${y}" r="34" fill="${a}" opacity=".35"/>`)}${part('gb', x + 11, y, `<circle cx="${x + 11}" cy="${y}" r="34" fill="${b}" opacity=".35"/>`)}<rect x="${x - 24}" y="${y - 6}" width="48" height="12" rx="4" fill="#2e2733" ${sw(2.5)}/>${part('lr', x - 11, y, `<rect x="${x - 22}" y="${y - 5}" width="21" height="10" rx="3" fill="${a}"/>`)}${part('lbl', x + 11, y, `<rect x="${x + 1}" y="${y - 5}" width="21" height="10" rx="3" fill="${b}"/>`)}`;
const LIGHTS = ['lights', 'dark'];
function patrolCar(o) {
  const c = o.color || '#f4f1ea';
  let s = part('spot', 50, -104, `<path d="M50 -104 L520 -190 L520 -10Z" fill="url(#cl-beam)"/>`);
  s += part('head', 128, -58, `<path d="M128 -58 L560 -120 L560 30Z" fill="url(#cl-beam)"/>`);
  s += `<path d="M-122 -26 L-122 -60 Q-122 -72 -106 -74 L-62 -76 L-40 -108 Q-34 -116 -20 -116 L40 -116 Q54 -116 62 -106 L86 -76 L116 -70 Q130 -66 130 -52 L130 -26 Q130 -20 122 -20 L-114 -20 Q-122 -20 -122 -26Z" fill="${c}" ${sj(4)}/>`;
  s += `<path d="M-120 -48 L128 -48 L128 -26 Q128 -22 122 -22 L-114 -22 Q-120 -22 -120 -26Z" fill="#23263d"/><path d="M-120 -52 h248" stroke="#ffcf4a" stroke-width="4"/>`;
  s += `<path d="M-32 -106 L-50 -78 L6 -78 L6 -106Z" fill="#8ecae6" ${sj(3)}/><path d="M14 -106 L14 -78 L76 -78 L58 -102 Q55 -106 48 -106Z" fill="#8ecae6" ${sj(3)}/><path d="M-26 -100 l-8 14 M24 -100 l-6 14" stroke="#fff" stroke-width="3" opacity=".7"/>`;
  s += star(-22, -62, 10);
  s += o.variant === 'dark' ? `<rect x="-20" y="-127" width="44" height="11" rx="3" fill="#3a3f63" ${sw(2.5)}/>` : lightbar(2, -121);
  s += `<ellipse cx="125" cy="-60" rx="5" ry="7" fill="#ffe08a" ${sw(2)}/><rect x="-122" y="-66" width="7" height="11" fill="#ff4d5a"/><rect x="56" y="-114" width="13" height="9" rx="2" fill="#c9c9d6" ${sw(2)}/>`;
  s += wheel(-72) + wheel(82);
  return s;
}
def('patrol_car', { kind: 'vehicle', rig: 'vehicle', w: 260, h: 128, roof: -118, variants: [...LIGHTS, 'spotlight'], desc: 'black-and-white patrol car with a flashing light bar; spotlight variant sweeps a side spotlight (motion sweep); roof is 118 above its y', draw: patrolCar });

function fireEngine(o) {
  const c = o.color || '#e63946', d = dk(c, .25);
  let s = `<rect x="-200" y="-128" width="290" height="98" rx="8" fill="${c}" ${sw(4)}/>`;
  s += [-188, -128, -68, -8].map((x) => `<rect x="${x}" y="-112" width="52" height="56" rx="4" fill="${d}" ${sw(2.5)}/><rect x="${x + 20}" y="-86" width="12" height="4" rx="2" fill="#c9ccd6"/>`).join('');
  s += `<rect x="-200" y="-52" width="290" height="10" fill="#f4f1ea" ${sw(2.5)}/>`;
  s += `<path d="M90 -30 L90 -150 Q90 -158 100 -158 L160 -158 Q172 -158 178 -146 L196 -96 Q200 -88 200 -78 L200 -30Z" fill="${c}" ${sj(4)}/><path d="M104 -148 L156 -148 Q164 -148 168 -140 L184 -100 L104 -100Z" fill="#8ecae6" ${sj(3)}/><path d="M118 -140 l-8 22" stroke="#fff" stroke-width="3" opacity=".7"/>`;
  s += `<rect x="96" y="-90" width="44" height="50" rx="3" fill="none" ${sw(2.5)}/><rect x="126" y="-72" width="10" height="4" rx="2" fill="#c9ccd6"/><rect x="186" y="-44" width="20" height="16" rx="3" fill="#c9ccd6" ${sw(2.5)}/><ellipse cx="196" cy="-74" rx="5" ry="7" fill="#ffe08a" ${sw(2)}/>`;
  s += `<rect x="-196" y="-150" width="300" height="8" rx="3" fill="#c9ccd6" ${sw(2.5)}/><rect x="-196" y="-138" width="300" height="8" rx="3" fill="#c9ccd6" ${sw(2.5)}/>${[...Array(12)].map((_, i) => `<rect x="${-186 + i * 25}" y="-146" width="5" height="12" fill="#c9ccd6" ${sw(1.5)}/>`).join('')}`;
  s += `<rect x="-60" y="-138" width="10" height="10" fill="#8a8f9c" ${sw(2)}/><circle cx="-170" cy="-78" r="18" fill="#ffcf4a" ${sw(3)}/><circle cx="-170" cy="-78" r="7" fill="${d}"/>`;
  if (o.label) s += `<rect x="-120" y="-125" width="${o.label.length * 13 + 24}" height="22" rx="4" fill="#f6efe0" ${sw(2)}/>${txt(-108 + o.label.length * 6.5, -108, o.label, 15, c)}`;
  s += o.variant === 'dark' ? '' : lightbar(140, -164, '#ff4d5a', '#ffffff');
  s += wheel(-150, 22) + wheel(-100, 22) + wheel(140, 22);
  return s;
}
def('fire_engine', { kind: 'vehicle', rig: 'vehicle', w: 410, h: 172, roof: -158, variants: LIGHTS, label: 'short word on the side, e.g. ENGINE', desc: 'long red fire engine with ladder and hose reel', draw: fireEngine });

function ambulance(o) {
  const c = o.color || '#f4f1ea';
  let s = `<rect x="-150" y="-166" width="210" height="140" rx="10" fill="${c}" ${sw(4)}/><rect x="-150" y="-80" width="210" height="16" fill="#e63946"/><rect x="-150" y="-64" width="210" height="6" fill="#f4843d"/>`;
  s += `<rect x="-140" y="-150" width="52" height="40" rx="4" fill="#8ecae6" ${sw(2.5)}/><rect x="-60" y="-150" width="40" height="60" rx="3" fill="none" ${sw(2.5)}/>`;
  s += `<path d="M60 -26 L60 -120 Q60 -126 68 -126 L108 -126 Q118 -126 124 -116 L146 -78 Q150 -70 150 -62 L150 -26Z" fill="${c}" ${sj(4)}/><path d="M72 -116 L104 -116 Q110 -116 114 -110 L132 -80 L72 -80Z" fill="#8ecae6" ${sj(3)}/><rect x="60" y="-64" width="90" height="6" fill="#e63946"/>`;
  s += `<path d="M-30 -136 h16 v-10 h12 v10 h16 v12 h-16 v10 h-12 v-10 h-16z" fill="#3a86ff" ${sj(2)}/>`;
  s += `<ellipse cx="146" cy="-56" rx="4" ry="6" fill="#ffe08a" ${sw(2)}/><rect x="-152" y="-30" width="304" height="8" rx="3" fill="#c9ccd6" ${sw(2)}/>`;
  if (o.label) s += txt(-45, -92, o.label, 18, '#e63946');
  s += o.variant === 'dark' ? '' : lightbar(-30, -172, '#ff4d5a', '#ffffff');
  s += wheel(-95, 21) + wheel(100, 21);
  return s;
}
def('ambulance', { kind: 'vehicle', rig: 'vehicle', w: 305, h: 180, roof: -166, variants: LIGHTS, label: 'side word, e.g. AMBULANCE', desc: 'boxy white ambulance with red stripe', draw: ambulance });

function pickup(o) {
  const c = o.color || '#2a9d8f', d = dk(c, .25);
  let s = '';
  if (o.variant === 'hay') s += [-110, -70, -30].map((x, i) => `<rect x="${x}" y="${-96 - (i === 1 ? 26 : 0)}" width="38" height="28" rx="4" fill="#f0d27a" ${sw(2.5)}/><path d="M${x + 4} ${-86 - (i === 1 ? 26 : 0)} h30 M${x + 4} ${-78 - (i === 1 ? 26 : 0)} h30" stroke="#c9a24a" stroke-width="2"/>`).join('');
  s += `<path d="M-130 -30 L-130 -72 L-10 -72 L-10 -112 Q-10 -118 -2 -118 L48 -118 Q58 -118 64 -108 L80 -78 L120 -74 Q132 -72 132 -60 L132 -30Z" fill="${c}" ${sj(4)}/>`;
  s += `<path d="M2 -108 L44 -108 Q50 -108 54 -102 L68 -80 L2 -80Z" fill="#8ecae6" ${sj(3)}/><path d="M-130 -72 h120" stroke="${d}" stroke-width="4"/><rect x="-128" y="-62" width="114" height="4" fill="${d}"/><rect x="-6" y="-70" width="36" height="34" rx="3" fill="none" stroke="${d}" stroke-width="2.5"/>`;
  s += `<ellipse cx="128" cy="-62" rx="4" ry="6" fill="#ffe08a" ${sw(2)}/><rect x="-134" y="-36" width="268" height="8" rx="3" fill="#c9ccd6" ${sw(2)}/>`;
  if (o.variant === 'muddy') s += `<path d="M-130 -30 q20 -20 40 -6 q14 -18 34 -4 q20 -16 40 0 q20 -18 40 -2 q20 -14 40 0 q20 -16 40 -2 q16 -10 28 -4 L132 -30Z" fill="#7a5a3c" opacity=".9"/>${[[-90, -50], [40, -56], [100, -46], [-40, -44]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#7a5a3c"/>`).join('')}`;
  if (o.label) s += txt(-70, -44, o.label, 15, '#fff');
  s += wheel(-82) + wheel(88);
  return s;
}
def('pickup', { kind: 'vehicle', rig: 'vehicle', w: 270, h: 120, roof: -118, variants: ['plain', 'hay', 'muddy'], label: 'optional side word', desc: 'pickup truck (hay bales in the bed, or muddy)', draw: pickup });

function suv(o) {
  const c = o.color || '#3a86ff', d = dk(c, .25);
  let s = o.variant === 'roofrack' ? `<rect x="-90" y="-136" width="150" height="8" rx="3" fill="#3a3f63" ${sw(2)}/><rect x="-80" y="-158" width="70" height="24" rx="6" fill="#ffcf4a" ${sw(2.5)}/>` : '';
  s += `<path d="M-125 -30 L-125 -112 Q-125 -126 -110 -126 L50 -126 Q62 -126 70 -116 L94 -82 L118 -76 Q128 -72 128 -60 L128 -30Z" fill="${c}" ${sj(4)}/>`;
  s += `<path d="M-112 -114 L-62 -114 L-62 -84 L-112 -84Z M-52 -114 L4 -114 L4 -84 L-52 -84Z M14 -114 L48 -114 Q54 -114 58 -108 L76 -84 L14 -84Z" fill="#8ecae6" ${sj(3)}/>`;
  s += `<path d="M-125 -60 h253" stroke="${d}" stroke-width="3"/><ellipse cx="124" cy="-64" rx="4" ry="6" fill="#ffe08a" ${sw(2)}/><rect x="-128" y="-38" width="256" height="9" rx="3" fill="#3a3f63" ${sw(2)}/>`;
  if (o.label) s += txt(-30, -48, o.label, 15, '#fff');
  s += wheel(-78, 21) + wheel(82, 21);
  return s;
}
def('suv', { kind: 'vehicle', rig: 'vehicle', w: 260, h: 130, roof: -126, variants: ['plain', 'roofrack'], label: 'optional side word', desc: 'tall boxy SUV', draw: suv });

function boat(o) {
  const c = o.color || (o.variant === 'patrol' ? '#f4f1ea' : '#e63946');
  let s = part('wake', -110, -6, `<path d="M-110 -8 q-30 -16 -60 -2 q-20 8 -50 0 q26 16 60 8 q30 -4 50 -6Z" fill="#fff" opacity=".85"/>`);
  if (o.variant === 'sail') s += `<line x1="0" y1="-30" x2="0" y2="-200" ${sw(4)}/><path d="M4 -196 Q70 -120 80 -36 L4 -36Z" fill="#fff6e3" ${sj(3)}/><path d="M-4 -180 Q-50 -110 -70 -40 L-4 -40Z" fill="#ffcf4a" ${sj(3)}/>`;
  else s += `<path d="M-60 -38 L-60 -76 Q-60 -82 -54 -82 L10 -82 Q20 -82 26 -74 L40 -38Z" fill="#f4f1ea" ${sj(3)}/><path d="M-50 -74 L8 -74 Q14 -74 18 -68 L26 -52 L-50 -52Z" fill="#8ecae6" ${sj(2.5)}/>`;
  if (o.variant === 'patrol') s += lightbar(-20, -88);
  s += `<path d="M-112 -40 L112 -40 Q100 -14 70 0 L-100 0 Q-112 -16 -112 -40Z" fill="${c}" ${sj(4)}/><path d="M-108 -26 L104 -26" stroke="${dk(c, .3)}" stroke-width="4"/>`;
  if (o.variant !== 'sail') s += `<rect x="-130" y="-56" width="20" height="34" rx="5" fill="#3a3f63" ${sw(3)}/><rect x="-124" y="-22" width="8" height="18" fill="#3a3f63" ${sw(2)}/>`;
  if (o.label) s += txt(0, -12, o.label, 14, '#fff');
  s += `<path d="M-120 0 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0" fill="none" stroke="#bfe6ff" stroke-width="4"/>`;
  return s;
}
def('boat', { kind: 'vehicle', rig: 'boat', w: 250, h: 95, roof: -82, variants: ['motorboat', 'patrol', 'sail'], label: 'optional hull word', desc: 'small boat; put its y on the water line', draw: boat });

function plane(o) {
  const c = o.color || '#f4f1ea', a = o.variant === 'red' ? '#e63946' : o.variant === 'blue' ? '#3a86ff' : '#ffcf4a';
  let s = '';
  if (o.label) { const w = o.label.length * 16 + 30; s += `<path d="M-120 -60 L-160 -60" ${sw(2)}/><rect x="${-160 - w}" y="-76" width="${w}" height="32" rx="3" fill="#fff6e3" ${sw(3)}/>${txt(-160 - w / 2, -53, o.label, 18, '#e63946')}`; }
  s += `<path d="M-120 -66 L-104 -110 L-84 -110 L-80 -66Z" fill="${a}" ${sj(3)}/>`;
  s += `<path d="M-120 -66 Q-60 -78 40 -80 Q80 -80 96 -66 Q100 -52 84 -46 Q20 -40 -70 -54 Q-110 -58 -120 -66Z" fill="${c}" ${sj(3.5)}/>`;
  s += `<path d="M-110 -60 Q-20 -60 90 -56" stroke="${a}" stroke-width="5" fill="none"/><path d="M14 -76 L52 -78 Q62 -76 66 -68 L20 -66Z" fill="#8ecae6" ${sj(2.5)}/>`;
  s += `<rect x="-30" y="-92" width="110" height="10" rx="5" fill="${c}" ${sw(3)}/><line x1="20" y1="-84" x2="0" y2="-56" ${sw(3)}/>`;
  s += `<line x1="0" y1="-48" x2="-6" y2="-14" ${sw(3)}/><line x1="60" y1="-46" x2="64" y2="-14" ${sw(3)}/><circle cx="-6" cy="-10" r="9" fill="#1b1b28" ${sw(2.5)}/><circle cx="64" cy="-10" r="9" fill="#1b1b28" ${sw(2.5)}/>`;
  s += `<path d="M96 -70 q10 4 0 8z" fill="#c9ccd6" ${sw(2)}/>` + part('prop', 104, -66, `<ellipse cx="104" cy="-66" rx="4" ry="30" fill="#3a3f63" ${sw(2)}/>`) + part('disc', 104, -66, `<ellipse cx="104" cy="-66" rx="3" ry="30" fill="#c9ccd6"/>`);
  return s;
}
def('plane', { kind: 'vehicle', rig: 'plane', w: 240, h: 112, roof: -92, variants: ['yellow', 'red', 'blue'], label: 'optional: a banner it tows, 1–3 words', desc: 'small high-wing propeller plane; motion fly in the air, drive to taxi', draw: plane });

function train(o) {
  const c = o.color || '#2a9d8f';
  let s = part('puff', 70, -200, [0, 1, 2].map((i) => `<circle data-i="${i}" cx="70" cy="-200" r="${14 + i * 4}" fill="#d9dbe6" ${sw(2.5)}/>`).join(''));
  s += `<rect x="60" y="-190" width="20" height="26" fill="#3a3f63" ${sw(3)}/>`;
  s += `<path d="M-150 -40 L-150 -150 L-60 -150 L-60 -170 L40 -170 L40 -150 L130 -150 Q150 -150 150 -130 L150 -40Z" fill="${c}" ${sj(4)}/>`;
  s += `<rect x="-40" y="-160" width="60" height="44" rx="4" fill="#8ecae6" ${sj(3)}/><rect x="-150" y="-80" width="300" height="12" fill="#ffcf4a" ${sw(2.5)}/><circle cx="146" cy="-110" r="9" fill="#ffe08a" ${sw(2.5)}/>`;
  s += `<path d="M150 -40 L176 -12 L150 -12Z" fill="#8a8f9c" ${sj(3)}/><rect x="-156" y="-40" width="312" height="14" rx="3" fill="#3a3f63" ${sw(2.5)}/>`;
  if (o.label) s += txt(60, -110, o.label, 18, '#fff');
  if (o.variant === 'freight') s += [0, 1].map((i) => { const x = -480 - i * 320; return `<rect x="${x}" y="-150" width="300" height="114" rx="4" fill="${['#c0392b', '#7b5ea7'][i]}" ${sw(4)}/>${[0, 1, 2, 3, 4].map((k) => `<path d="M${x + 30 + k * 60} -140 v94" stroke="${OL}" stroke-width="2" opacity=".5"/>`).join('')}<rect x="${x + 12}" y="-40" width="276" height="14" rx="3" fill="#3a3f63" ${sw(2.5)}/>${wheel(x + 50, 14)}${wheel(x + 90, 14)}${wheel(x + 210, 14)}${wheel(x + 250, 14)}<rect x="${x + 300}" y="-34" width="20" height="6" fill="#3a3f63"/>`; }).join('');
  s += wheel(-110, 16) + wheel(-60, 16) + wheel(60, 16) + wheel(110, 16);
  return s;
}
def('train', { kind: 'vehicle', rig: 'vehicle', w: 330, h: 230, roof: -170, variants: ['loco', 'freight'], label: 'optional side word', desc: 'locomotive (freight adds two boxcars trailing 800 px behind)', draw: train });

// ---------- skies and sets: drawn wide (x −1500…2500) so camera pans never show an edge ----------
const DEFS = `<linearGradient id="cl-sky-night" gradientUnits="userSpaceOnUse" x1="0" y1="-200" x2="0" y2="560"><stop offset="0" stop-color="#070b2b"/><stop offset=".7" stop-color="#26316f"/><stop offset="1" stop-color="#4b4d92"/></linearGradient>
<linearGradient id="cl-sky-day" gradientUnits="userSpaceOnUse" x1="0" y1="-200" x2="0" y2="560"><stop offset="0" stop-color="#3f9be6"/><stop offset=".65" stop-color="#8fd0f5"/><stop offset="1" stop-color="#dff4fb"/></linearGradient>
<linearGradient id="cl-sky-dawn" gradientUnits="userSpaceOnUse" x1="0" y1="-200" x2="0" y2="560"><stop offset="0" stop-color="#2e2f6e"/><stop offset=".55" stop-color="#c76a8a"/><stop offset=".85" stop-color="#ffb070"/><stop offset="1" stop-color="#ffe0a0"/></linearGradient>
<radialGradient id="cl-glow"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>
<linearGradient id="cl-beam" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff3b0" stop-opacity=".75"/><stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></linearGradient>
<linearGradient id="cl-water" gradientUnits="userSpaceOnUse" x1="0" y1="400" x2="0" y2="700"><stop offset="0" stop-color="#2a6f97"/><stop offset="1" stop-color="#1b4965"/></linearGradient>`;
const SKIES = ['night', 'day', 'dawn'];
const PALS = {
  night: { dark: 1, bld: ['#3d4a8c', '#5b3f7e', '#2e6a73', '#7b4a5c', '#46603d', '#6c5a91', '#8a5a3c'], win: '#1c2148', lit: '#ffd166', walk: '#6e7398', road: '#2a2d46', grass: '#1c3a2c', grass2: '#2a5a3c', tree: '#2f6b45', wall: '#cdb994' },
  day: { bld: ['#5b8fd9', '#e07a5f', '#81b29a', '#e9b872', '#9d84c9', '#e0a458', '#6cb4b8'], win: '#bfe6ff', lit: '#bfe6ff', walk: '#c3c6d6', road: '#5a5f78', grass: '#5fae5a', grass2: '#7cc36a', tree: '#4a9a4a', wall: '#f2e2c4' },
  dawn: { bld: ['#6a6aa8', '#b06a7a', '#4f8a8f', '#c0875a', '#7a8a5a', '#8a72b0', '#b07a5a'], win: '#3a3f63', lit: '#ffd9a0', walk: '#9a98b8', road: '#3f4260', grass: '#3f6a4a', grass2: '#5a8a5a', tree: '#3f7a52', wall: '#e8d0b4' },
};
const STARS = (() => { const r = rng(3); let s = ''; for (let i = 0; i < 90; i++) { const st = `<circle cx="${(r() * 3000 - 1000) | 0}" cy="${(r() * 600 - 240) | 0}" r="${(r() * 1.8 + .6).toFixed(1)}" fill="#fff" opacity="${(r() * .6 + .3).toFixed(2)}"/>`; s += i % 9 ? st : part('tw', i, 0, st); } return s; })();
const FEW_STARS = (() => { const r = rng(5); let s = ''; for (let i = 0; i < 18; i++) s += `<circle cx="${(r() * 3000 - 1000) | 0}" cy="${(r() * 260 - 240) | 0}" r="${(r() * 1.4 + .6).toFixed(1)}" fill="#fff" opacity="${(r() * .5 + .3).toFixed(2)}"/>`; return s; })();
const cloud = (x, y, s, c = '#fff') => part('cloud', x, y, `<g transform="translate(${x} ${y}) scale(${s})">${blob('<circle cx="-40" cy="0" r="26"/><circle cx="-8" cy="-14" r="34"/><circle cx="30" cy="-4" r="28"/><rect x="-66" y="0" width="122" height="24" rx="12"/>', c, 7)}</g>`);
function sky(name) {
  let s = `<rect x="-3000" y="-3000" width="8000" height="3600" fill="url(#cl-sky-${SKIES.includes(name) ? name : 'night'})"/>`;
  if (name === 'day') s += `<g transform="translate(820 110)"><circle r="62" fill="#fff3a0" opacity=".5"/><circle r="44" fill="#ffe066" ${sw(3)}/></g>${cloud(160, 120, 1)}${cloud(560, 70, .8)}${cloud(1100, 150, 1.1)}${cloud(-300, 90, .9)}`;
  else if (name === 'dawn') s += `<g transform="translate(260 470)"><circle r="120" fill="#ffd27a" opacity=".35"/><circle r="70" fill="#ffb347" ${sw(3)}/></g>${cloud(620, 140, .9, '#ffc4c4')}${cloud(-100, 200, .8, '#ffc4c4')}${FEW_STARS}`;
  else s += `${STARS}<g transform="translate(700 100)"><circle r="60" fill="#fff0b8" opacity=".15"/><circle r="42" fill="#fff0b8"/><circle cx="-13" cy="-9" r="8" fill="#f1d98c"/><circle cx="14" cy="12" r="6" fill="#f1d98c"/></g>`;
  return s;
}
const ground = (y, c) => `<rect x="-3000" y="${y}" width="8000" height="3000" fill="${c}"/>`;
const night = (p, o = .18) => p.dark ? `<rect x="-3000" y="-3000" width="8000" height="8000" fill="#0d1230" opacity="${o}"/>` : '';
const lamp = (x, p) => `${p.dark ? `<circle cx="${x + 30}" cy="372" r="95" fill="url(#cl-glow)"/>` : ''}<rect x="${x - 5}" y="368" width="10" height="177" fill="#232a55" ${sw(2.5)}/><path d="M${x} 372 q0 -14 30 -14" fill="none" stroke="#232a55" stroke-width="7"/><path d="M${x + 18} 360 h26 l-5 14 h-16z" fill="${p.dark ? '#ffe08a' : '#f4f1ea'}" ${sj(2.5)}/>`;
const streetSign = (x, label, col = '#1f8a4c') => { if (!label) return ''; const w = label.length * 16 + 34; return `<rect x="${x - 4}" y="380" width="8" height="165" fill="#9aa0b8" ${sw(2)}/><rect x="${x - w / 2}" y="358" width="${w}" height="36" rx="5" fill="${col}" ${sw(3)}/>${txt(x, 384, label, 20, '#fff')}`; };
function road(p, top = 540) {
  let d = ''; for (let x = -3000; x < 5000; x += 90) d += `<rect x="${x}" y="630" width="48" height="7" rx="3" fill="#ffcf4a"/>`;
  return `<rect x="-3000" y="${top}" width="8000" height="${566 - top}" fill="${p.walk}" ${sw(2)}/><rect x="-3000" y="566" width="8000" height="134" fill="${p.road}"/>${d}<rect x="-3000" y="700" width="8000" height="22" fill="${p.walk}" ${sw(2)}/>${ground(722, p.grass)}`;
}
function shops(x0, x1, seed, names, p) {
  const r = rng(seed); let s = '', x = x0, i = 0;
  while (x < x1) {
    const w = 150 + (r() * 70 | 0), h = 170 + (r() * 120 | 0), c = p.bld[r() * p.bld.length | 0], top = 545 - h;
    s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${c}" ${sw(3)}/><rect x="${x - 5}" y="${top - 12}" width="${w + 10}" height="14" fill="${dk(c, .45)}" ${sw(3)}/>`;
    for (let wy = top + 22; wy < 545 - 130; wy += 44) for (let wx = x + 18; wx < x + w - 34; wx += 40) s += `<rect x="${wx}" y="${wy}" width="22" height="26" rx="2" fill="${r() < .35 ? p.lit : p.win}" ${sw(2)}/>`;
    const nm = names.length ? names[i % names.length] : '';
    if (nm) s += `<rect x="${x + 12}" y="${545 - 122}" width="${w - 24}" height="26" rx="5" fill="#f6efe0" ${sw(3)}/>${txt(x + w / 2, 545 - 103, nm, Math.min(14, (w - 30) / nm.length * 1.5).toFixed(1))}`;
    s += `<path d="M${x + 8} ${545 - 90} h${w - 16} l-8 18 h${-(w - 32)} z" fill="${['#ff5a5f', '#ffcf4a', '#4cc9f0', '#7bd389'][i % 4]}" ${sj(3)}/>`;
    s += `<rect x="${x + 16}" y="${545 - 66}" width="${w * .5 | 0}" height="44" fill="${p.dark ? '#ffe7a3' : '#bfe6ff'}" ${sw(3)}/><rect x="${x + w - 50}" y="${545 - 70}" width="30" height="70" fill="#2a1f3d" ${sw(3)}/>`;
    x += w + 8; i++;
  }
  return s;
}
const tree = (x, y, s, c, kind = 'oak') => {
  if (kind === 'pine') return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-7" y="-30" width="14" height="30" fill="#6b4a2c" ${sw(3)}/><path d="M0 -150 L-34 -90 L-20 -90 L-46 -46 L-28 -46 L-56 -24 L56 -24 L28 -46 L46 -46 L20 -90 L34 -90Z" fill="${c}" ${sj(3)}/></g>`;
  if (kind === 'palm') return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-6 0 Q-2 -70 14 -150 L24 -148 Q8 -70 8 0Z" fill="#a8743c" ${sj(3)}/>${[-150, -110, -60, -20, 30].map((a) => `<path d="M19 -150 q${40 * Math.cos(a * Math.PI / 180)} ${-20 + 40 * Math.sin(a * Math.PI / 180)} ${80 * Math.cos(a * Math.PI / 180)} ${30 + 60 * Math.sin(a * Math.PI / 180)}" fill="none" stroke="${OL}" stroke-width="16" stroke-linecap="round"/><path d="M19 -150 q${40 * Math.cos(a * Math.PI / 180)} ${-20 + 40 * Math.sin(a * Math.PI / 180)} ${80 * Math.cos(a * Math.PI / 180)} ${30 + 60 * Math.sin(a * Math.PI / 180)}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`).join('')}</g>`;
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-9 0 L-7 -70 L7 -70 L9 0Z" fill="#6b4a2c" ${sj(3)}/>${blob('<circle cx="-34" cy="-86" r="32"/><circle cx="0" cy="-118" r="40"/><circle cx="34" cy="-88" r="32"/><circle cx="0" cy="-76" r="30"/>', c)}<circle cx="-14" cy="-120" r="10" fill="${lt(c, .2)}"/></g>`;
};
const SETS = {};
const setDef = (name, d) => { SETS[name] = d; };
setDef('main_street', { desc: 'small-town Main Street: shops (labels are shop names), lamps, a two-lane street', ground: { walk: 556, far: 612, near: 668 },
  draw: (p, L) => `${shops(-1400, 2500, 11, L.length ? L : ['DINER', 'HARDWARE', 'BAKERY', 'FEED & SEED', 'BARBER', 'CAFE'], p)}${[-900, -450, 0, 450, 900, 1350, 1800].map((x) => lamp(x + 120, p)).join('')}${road(p)}` });
function house(x, r, p) {
  const c = p.bld[r() * p.bld.length | 0], roof = ['#6b3f3f', '#3d4a6c', '#5a4a3a', '#7a3a3a'][r() * 4 | 0], w = 210 + (r() * 40 | 0);
  let s = `<rect x="${x + w - 60}" y="330" width="26" height="60" fill="#8a5a3c" ${sw(3)}/>`;
  s += `<path d="M${x - 16} 410 L${x + w / 2} 318 L${x + w + 16} 410Z" fill="${roof}" ${sj(4)}/><rect x="${x}" y="405" width="${w}" height="120" fill="${c}" ${sw(4)}/>`;
  s += `<rect x="${x + w / 2 - 22}" y="455" width="44" height="70" rx="3" fill="${dk(c, .45)}" ${sw(3)}/><circle cx="${x + w / 2 + 12}" cy="492" r="3" fill="#ffcf4a"/>`;
  s += [x + 22, x + w - 72].map((wx) => `<rect x="${wx}" y="440" width="50" height="44" rx="3" fill="${r() < .5 ? p.lit : p.win}" ${sw(3)}/><path d="M${wx + 25} 440 v44 M${wx} 462 h50" stroke="${OL}" stroke-width="2.5"/>`).join('');
  s += `<rect x="${x + w / 2 - 34}" y="520" width="68" height="10" fill="#c9ccd6" ${sw(2.5)}/>`;
  return { s, w };
}
setDef('residential', { desc: 'quiet residential street: houses, lawns, picket fences, mailboxes, trees (label 1 = street sign)', ground: { walk: 560, far: 612, near: 668 },
  draw: (p, L) => {
    const r = rng(21); let s = ground(400, p.grass2), x = -1400;
    while (x < 2500) { const h = house(x, r, p); s += h.s; s += tree(x + h.w + 45, 530, .9 + r() * .3, p.tree); x += h.w + 110; }
    let f = ''; for (let fx = -1400; fx < 2500; fx += 22) f += `<path d="M${fx} 552 v-30 l6 -7 l6 7 v30z" fill="#f6efe0" ${sj(2)}/>`;
    s += `<rect x="-3000" y="525" width="8000" height="27" fill="${p.grass}"/>${f}<rect x="-1400" y="530" width="3900" height="6" fill="#f6efe0" ${sw(1.5)}/>`;
    s += road(p, 552);
    s += [-700, 0, 700, 1400].map((mx) => `<rect x="${mx - 3}" y="510" width="6" height="40" fill="#6b4a2c" ${sw(2)}/><path d="M${mx - 14} 512 v-14 q0 -10 14 -10 q14 0 14 10 v14z" fill="#3a3f63" ${sw(2.5)}/>`).join('');
    return s + streetSign(700, L[0]);
  } });
setDef('woods_edge', { desc: 'edge of the woods: pine trees, a dirt road, bushes (label 1 = a wooden trail sign)', ground: { walk: 580, far: 612, near: 668 },
  draw: (p, L) => {
    const r = rng(31); let s = '';
    for (let x = -1500; x < 2600; x += 70) s += `<path d="M${x} 540 l40 -${120 + (r() * 90 | 0)} l40 ${130 + (r() * 60 | 0)}z" fill="${dk(p.tree, .45)}"/>`;
    s += ground(520, p.grass);
    for (let x = -1500; x < 2600; x += 95 + (r() * 60 | 0)) s += tree(x, 560, .9 + r() * .7, p.tree, 'pine');
    s += `<rect x="-3000" y="596" width="8000" height="110" fill="#a8845a"/><path d="M-3000 596 h8000" stroke="${OL}" stroke-width="3"/><path d="M-3000 630 h8000 M-3000 676 h8000" stroke="#8a6a44" stroke-width="5" stroke-dasharray="60 30"/>${ground(706, p.grass)}`;
    for (let x = -1400; x < 2500; x += 260) s += `<g transform="translate(${x + (r() * 80 | 0)} 598)">${blob('<circle cx="-24" cy="-20" r="20"/><circle cx="2" cy="-30" r="24"/><circle cx="26" cy="-18" r="18"/><rect x="-44" y="-20" width="88" height="20" rx="8"/>', lt(p.tree, .1), 6)}</g>`;
    if (p.dark) for (let i = 0; i < 14; i++) s += part('blink', i, 0, `<circle cx="${(r() * 1600 - 300) | 0}" cy="${400 + (r() * 180 | 0)}" r="3.5" fill="#f4ff8a"/>`);
    if (L[0]) s += `<rect x="636" y="470" width="10" height="110" fill="#6b4a2c" ${sw(2.5)}/><path d="M${640 - L[0].length * 9 - 20} 460 h${L[0].length * 18 + 30} l14 18 l-14 18 h${-(L[0].length * 18 + 30)}z" fill="#a8743c" ${sj(3)}/>${txt(642, 486, L[0], 18, '#fff6e3')}`;
    return s;
  } });
setDef('shoreline', { desc: 'a bay: water from y 420 to 625 with boats floating at y about 560, a dock (deck y 560, x 520–1200), a beach in front (label 1 = dock sign)', ground: { walk: 560, far: 640, near: 668 },
  draw: (p, L) => {
    let s = `<path d="M-3000 420 Q-500 380 0 410 Q300 380 600 405 Q1200 370 5000 410 L5000 430 L-3000 430Z" fill="${dk(p.tree, .35)}"/><g transform="translate(150 410)"><rect x="-8" y="-60" width="16" height="60" fill="#f4f1ea" ${sw(2)}/><rect x="-8" y="-44" width="16" height="10" fill="#e63946"/><path d="M-10 -60 h20 l-10 -12z" fill="#e63946" ${sw(2)}/>${p.dark ? '<circle cy="-56" r="30" fill="url(#cl-glow)"/>' : ''}</g>`;
    s += `<rect x="-3000" y="425" width="8000" height="215" fill="url(#cl-water)"/>`;
    for (let i = 0; i < 18; i++) s += part('wave', i, 0, `<path d="M${-1400 + (i * 263) % 3900} ${450 + (i * 37) % 160} q12 -8 24 0 t24 0" fill="none" stroke="#bfe6ff" stroke-width="3" opacity=".7"/>`);
    s += `<rect x="520" y="550" width="680" height="16" fill="#a8743c" ${sw(3)}/>${[540, 680, 820, 960, 1100, 1180].map((x) => `<rect x="${x}" y="566" width="12" height="80" fill="#6b4a2c" ${sw(2.5)}/>`).join('')}`;
    s += `<path d="M-3000 640 Q0 620 600 636 Q1400 650 5000 630 L5000 3000 L-3000 3000Z" fill="#f0d9a0" ${sw(3)}/>`;
    s += tree(-200, 650, 1.1, p.tree, 'palm') + tree(1300, 652, 1, p.tree, 'palm');
    s += [0, 1, 2].map((i) => part('gull', i, 0, `<path d="M${200 + i * 260} ${200 + i * 40} q10 -10 20 0 q10 -10 20 0" fill="none" ${sw(3)}/>`)).join('');
    if (L[0]) s += `<rect x="520" y="480" width="8" height="70" fill="#6b4a2c" ${sw(2)}/><rect x="${524 - L[0].length * 8 - 14}" y="460" width="${L[0].length * 16 + 28}" height="30" rx="4" fill="#f6efe0" ${sw(3)}/>${txt(524, 482, L[0], 17)}`;
    return s;
  } });
setDef('airport', { desc: 'small airport: control tower, hangar (label 1 = hangar sign), windsock, runway in front', ground: { walk: 570, far: 612, near: 668 },
  draw: (p, L) => {
    let s = `<path d="M-3000 500 Q-800 460 0 490 Q800 450 5000 490 L5000 520 L-3000 520Z" fill="${dk(p.tree, .3)}"/>${ground(500, p.grass)}`;
    s += `<rect x="150" y="250" width="44" height="270" fill="#c9ccd6" ${sw(3.5)}/><path d="M120 250 L224 250 L210 190 L134 190Z" fill="#3a3f63" ${sj(3.5)}/><rect x="140" y="200" width="64" height="40" fill="${p.dark ? '#9df5c2' : '#8ecae6'}" ${sw(2.5)}/><rect x="114" y="176" width="116" height="16" rx="4" fill="#c9ccd6" ${sw(3)}/>`;
    s += `<path d="M620 520 L620 380 Q810 280 1000 380 L1000 520Z" fill="#8a8f9c" ${sj(4)}/><rect x="680" y="420" width="260" height="100" fill="#3a3f63" ${sw(3)}/>${[700, 760, 820, 880].map((x) => `<path d="M${x} 420 v100" stroke="#5a5f78" stroke-width="3"/>`).join('')}`;
    if (L[0]) s += `<rect x="${810 - L[0].length * 9 - 14}" y="378" width="${L[0].length * 18 + 28}" height="32" rx="4" fill="#f6efe0" ${sw(3)}/>${txt(810, 401, L[0], 19)}`;
    s += `<rect x="440" y="420" width="6" height="110" fill="#c9ccd6" ${sw(2)}/>` + part('sock', 446, 426, `<path d="M446 420 L506 428 L504 440 L446 438Z" fill="#f4843d" ${sj(2.5)}/><path d="M466 422 v16 M486 425 v13" stroke="#fff" stroke-width="5"/>`);
    s += `<rect x="-3000" y="540" width="8000" height="40" fill="#b8bccc" ${sw(2)}/><rect x="-3000" y="580" width="8000" height="130" fill="#3a3d52"/>`;
    let d = ''; for (let x = -3000; x < 5000; x += 120) d += `<rect x="${x}" y="642" width="70" height="8" fill="#f4f1ea"/>`;
    s += d + ground(710, p.grass);
    for (let x = -1400; x < 2500; x += 160) s += part('blink', x, 0, `<circle cx="${x}" cy="586" r="5" fill="#ffcf4a" ${sw(1.5)}/>`) + `<circle cx="${x + 80}" cy="704" r="4" fill="#4cc9f0"/>`;
    return s;
  } });
setDef('highway', { desc: 'rural highway: fields and hills, telephone poles, guardrail, a green overhead sign (label 1)', ground: { walk: 560, far: 612, near: 668 },
  draw: (p, L) => {
    let s = `<path d="M-3000 470 Q-700 400 0 450 Q600 390 1300 450 Q2000 410 5000 450 L5000 560 L-3000 560Z" fill="${p.grass2}" ${sw(3)}/><path d="M-3000 500 Q-200 470 600 500 Q1500 480 5000 500 L5000 560 L-3000 560Z" fill="${p.dark ? '#5a5a3a' : '#d9c26a'}"/>`;
    s += [-1200, -900, -600, -300, 0, 300, 600, 900, 1200, 1500, 1800, 2100].map((x) => `<rect x="${x - 4}" y="380" width="8" height="160" fill="#6b4a2c" ${sw(2)}/><rect x="${x - 22}" y="390" width="44" height="6" fill="#6b4a2c" ${sw(1.5)}/>`).join('') + `<path d="M-1400 395 ${[-1200, -900, -600, -300, 0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400].map((x) => `Q${x - 150} 420 ${x} 393`).join(' ')}" fill="none" stroke="${OL}" stroke-width="2"/>`;
    let rail = ''; for (let x = -1500; x < 2600; x += 80) rail += `<rect x="${x}" y="530" width="8" height="24" fill="#8a8f9c" ${sw(1.5)}/>`;
    s += rail + `<rect x="-3000" y="532" width="8000" height="10" fill="#c9ccd6" ${sw(2)}/>`;
    let d = ''; for (let x = -3000; x < 5000; x += 110) d += `<rect x="${x}" y="622" width="60" height="7" fill="#f4f1ea"/>`;
    s += `<rect x="-3000" y="552" width="8000" height="160" fill="${p.road}"/><rect x="-3000" y="560" width="8000" height="5" fill="#f4f1ea"/>${d}<rect x="-3000" y="700" width="8000" height="5" fill="#ffcf4a"/>${ground(712, p.grass)}`;
    if (L[0]) { const w = Math.max(220, L[0].length * 26 + 50); s += `<rect x="${500 - w / 2 - 30}" y="220" width="10" height="330" fill="#8a8f9c" ${sw(2.5)}/><rect x="${500 + w / 2 + 20}" y="220" width="10" height="330" fill="#8a8f9c" ${sw(2.5)}/><rect x="${500 - w / 2 - 30}" y="226" width="${w + 60}" height="10" fill="#8a8f9c" ${sw(2)}/><rect x="${500 - w / 2}" y="240" width="${w}" height="70" rx="8" fill="#1f8a4c" ${sw(4)}/><rect x="${500 - w / 2 + 8}" y="248" width="${w - 16}" height="54" rx="5" fill="none" stroke="#fff" stroke-width="3"/>${txt(500, 288, L[0], 30, '#fff')}`; }
    return s;
  } });
setDef('farm', { desc: 'farm: rolling hills, red barn (label 1 = barn sign), silo, wooden fence, dirt path', ground: { walk: 560, far: 612, near: 668 },
  draw: (p, L) => {
    let s = `<path d="M-3000 450 Q-600 380 200 440 Q900 380 5000 440 L5000 600 L-3000 600Z" fill="${p.grass2}" ${sw(3)}/>${ground(520, p.grass)}`;
    s += `<rect x="960" y="300" width="70" height="230" rx="4" fill="#c9ccd6" ${sw(3.5)}/><path d="M960 300 Q995 250 1030 300Z" fill="#8a8f9c" ${sw(3)}/>`;
    s += `<path d="M640 380 L780 300 L920 380 L920 530 L640 530Z" fill="#c0392b" ${sj(4)}/><rect x="720" y="420" width="120" height="110" fill="#8a2a20" ${sw(3)}/><path d="M720 420 L840 530 M840 420 L720 530" stroke="#f6efe0" stroke-width="6"/><rect x="720" y="420" width="120" height="110" fill="none" stroke="#f6efe0" stroke-width="6"/><rect x="760" y="340" width="40" height="34" fill="#f6efe0" ${sw(3)}/>`;
    if (L[0]) s += `<rect x="${780 - L[0].length * 8 - 12}" y="386" width="${L[0].length * 16 + 24}" height="28" rx="3" fill="#f6efe0" ${sw(2.5)}/>${txt(780, 406, L[0], 16, '#8a2a20')}`;
    s += [[-300, 520], [1200, 524]].map(([x, y]) => `<g transform="translate(${x} ${y})"><rect x="-30" y="-40" width="60" height="40" rx="8" fill="#f0d27a" ${sw(3)}/><path d="M-30 -22 h60" stroke="#c9a24a" stroke-width="3"/></g>`).join('') + tree(-700, 530, 1.1, p.tree) + tree(320, 526, 1, p.tree);
    let f = ''; for (let x = -1500; x < 2600; x += 120) f += `<rect x="${x}" y="510" width="12" height="52" fill="#a8743c" ${sw(2.5)}/>`;
    s += f + `<rect x="-3000" y="518" width="8000" height="9" fill="#c9965a" ${sw(2)}/><rect x="-3000" y="540" width="8000" height="9" fill="#c9965a" ${sw(2)}/>`;
    s += `<rect x="-3000" y="566" width="8000" height="300" fill="${p.grass}"/><path d="M-3000 612 Q0 600 5000 616 L5000 700 Q0 690 -3000 700Z" fill="#b08a5a"/>`;
    return s;
  } });
setDef('living_room', { desc: 'indoors: a living room (ceiling ends at y 110, so a ceiling detector goes at y about 125; couch, window, floor lamp, rug)', ground: { walk: 640, far: 640, near: 668 }, indoor: 1,
  draw: (p, L) => {
    let s = `<rect x="-3000" y="-3000" width="8000" height="8000" fill="${p.wall}"/>`;
    for (let x = -1500; x < 2600; x += 60) s += `<rect x="${x}" y="110" width="22" height="490" fill="${dk(p.wall, .05)}"/>`;
    s += `<rect x="-3000" y="-3000" width="8000" height="3110" fill="${lt(p.wall, .5)}"/><rect x="-3000" y="104" width="8000" height="12" fill="${lt(p.wall, .2)}" ${sw(3)}/>`;
    s += `<rect x="640" y="210" width="210" height="190" fill="url(#cl-sky-${p.sky})" ${sw(4)}/><path d="M745 210 v190 M640 305 h210" stroke="${OL}" stroke-width="4"/><path d="M620 196 h250" ${sw(6)}/><path d="M620 200 q20 120 -4 210 l40 0 q-20 -100 -10 -210z" fill="#e07a5f" ${sj(3)}/><path d="M870 200 q-20 120 4 210 l-40 0 q20 -100 10 -210z" fill="#e07a5f" ${sj(3)}/>`;
    s += `<rect x="220" y="230" width="140" height="100" fill="#f6efe0" ${sw(4)}/><path d="M232 318 L270 260 L300 300 L320 280 L348 318Z" fill="#81b29a" ${sj(2)}/><circle cx="330" cy="256" r="10" fill="#ffcf4a"/>`;
    s += `<rect x="-3000" y="600" width="8000" height="3000" fill="#c08a5a"/><rect x="-3000" y="594" width="8000" height="12" fill="#f6efe0" ${sw(2.5)}/>${[640, 690].map((y) => `<path d="M-3000 ${y} h8000" stroke="#a06e44" stroke-width="2"/>`).join('')}`;
    s += `<ellipse cx="480" cy="660" rx="300" ry="34" fill="#81b29a" ${sw(3)}/><ellipse cx="480" cy="660" rx="250" ry="24" fill="none" stroke="#f6efe0" stroke-width="4"/>`;
    s += `<g transform="translate(110 640)"><rect x="0" y="-100" width="300" height="70" rx="20" fill="#2a9d8f" ${sw(4)}/><rect x="-20" y="-70" width="44" height="66" rx="16" fill="#2a9d8f" ${sw(4)}/><rect x="276" y="-70" width="44" height="66" rx="16" fill="#2a9d8f" ${sw(4)}/><rect x="20" y="-44" width="260" height="40" rx="10" fill="${lt('#2a9d8f', .2)}" ${sw(3)}/><rect x="40" y="-120" width="60" height="40" rx="12" fill="#ffcf4a" ${sw(3)}/></g>`;
    s += `<g transform="translate(560 640)">${p.dark ? '<circle cx="0" cy="-200" r="120" fill="url(#cl-glow)"/>' : ''}<rect x="-3" y="-190" width="6" height="190" fill="#3a3f63"/><ellipse cx="0" cy="-2" rx="24" ry="6" fill="#3a3f63" ${sw(2)}/><path d="M-30 -180 L-20 -230 L20 -230 L30 -180Z" fill="#f6efe0" ${sj(3)}/></g>`;
    return s;
  } });
setDef('dispatch_room', { desc: 'indoors: the dispatch centre (wall map with blinking dots, clock, night window); put the dispatcher about x 330', ground: { walk: 640, far: 640, near: 668 }, indoor: 1,
  draw: (p) => {
    let s = `<rect x="-3000" y="-3000" width="8000" height="8000" fill="#3a4570"/><rect x="-3000" y="-3000" width="8000" height="3100" fill="#2e3760"/>`;
    s += `<rect x="90" y="150" width="440" height="260" rx="6" fill="#203050" ${sw(4)}/>${['M110 250 H510', 'M110 330 H510', 'M200 160 V400', 'M380 160 V400', 'M110 180 L510 390'].map((d) => `<path d="${d}" stroke="#5b7bb0" stroke-width="6"/>`).join('')}`;
    s += [[200, 250], [380, 330], [300, 290], [450, 250]].map(([x, y], i) => part('blink', i, 0, `<circle cx="${x}" cy="${y}" r="8" fill="${['#ff5a5f', '#ffcf4a', '#3dff8a', '#4cc9f0'][i]}" ${sw(2)}/>`)).join('');
    s += `<circle cx="700" cy="170" r="40" fill="#f6efe0" ${sw(4)}/>${part('clk', 700, 170, '<path d="M700 170 v-30" stroke="#1a1433" stroke-width="4" stroke-linecap="round"/>')}<path d="M700 170 h18" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>`;
    s += `<rect x="640" y="250" width="240" height="170" fill="url(#cl-sky-night)" ${sw(4)}/><path d="M760 250 v170" stroke="${OL}" stroke-width="4"/><circle cx="830" cy="300" r="22" fill="#fff0b8"/><circle cx="680" cy="290" r="2" fill="#fff"/><circle cx="720" cy="370" r="1.6" fill="#fff"/><circle cx="800" cy="390" r="2" fill="#fff"/>`;
    s += `<rect x="-3000" y="600" width="8000" height="3000" fill="#262b45"/><rect x="-3000" y="596" width="8000" height="8" fill="#5b6fb0"/>`;
    return s;
  } });

// ---------- props (0, 0) is where it stands; a detector hangs from (0, 0) ----------
function radio(o) {
  let g = ''; for (let i = 0; i < 7; i++) g += `<rect x="-60" y="${-40 + i * 20}" width="120" height="9" rx="4.5" fill="#23263d"/>`;
  const arcs = [1, 2, 3].map((i) => `<path d="M${110 + i * 34} ${-60 - i * 30} a${60 + i * 40} ${60 + i * 40} 0 0 1 0 ${120 + i * 60}" fill="none" stroke="#9df5c2" stroke-width="9" stroke-linecap="round"/><path d="M${-110 - i * 34} ${-60 - i * 30} a${60 + i * 40} ${60 + i * 40} 0 0 0 0 ${120 + i * 60}" fill="none" stroke="#9df5c2" stroke-width="9" stroke-linecap="round"/>`);
  const label = (o.label || 'SCANNER').slice(0, 12);
  return `<g transform="translate(0 -140)">${arcs.map((a, i) => part('arc', i, 0, a)).join('')}<rect x="30" y="-250" width="18" height="130" rx="9" fill="#2a2d46" ${sw(4)}/><rect x="-90" y="-150" width="180" height="290" rx="30" fill="#3a3f63" ${sw(5)}/><circle cx="-50" cy="-158" r="13" fill="#2a2d46" ${sw(4)}/>
  <rect x="-68" y="-126" width="136" height="64" rx="10" fill="#9df5c2" ${sw(4)}/><text x="0" y="-100" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="${Math.min(18, 200 / label.length).toFixed(1)}" fill="${OL}">${esc(label)}</text>${part('scr', 0, -75, `<path d="M-40 -80 h16 M-18 -80 h22 M10 -80 h28" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>`)}${g}${part('led', 62, -136, `<circle cx="62" cy="-136" r="6" fill="#3dff8a"/>`)}</g>`;
}
def('radio', { kind: 'prop', rig: 'prop', w: 200, h: 390, draw: radio, variants: ['handheld'], motions: ['idle', 'talk', 'still'], label: 'screen text, e.g. SHERIFF CH1', desc: 'giant handheld scanner radio for a dispatch close-up (radio waves pulse in talk); scale 0.5–1.2' });
function detector(o) {
  const co = o.variant === 'co';
  return `${part('wv', 0, 30, [1, 2, 3].map((i) => `<path d="M${-40 - i * 16} ${20 + i * 6} q-10 ${16 + i * 4} 0 ${32 + i * 8} M${40 + i * 16} ${20 + i * 6} q10 ${16 + i * 4} 0 ${32 + i * 8}" fill="none" stroke="#ff5a5f" stroke-width="5" stroke-linecap="round"/>`).join(''))}
  <rect x="-20" y="0" width="40" height="8" fill="#c9ccd6" ${sw(2.5)}/><ellipse cx="0" cy="30" rx="44" ry="24" fill="#f6f6fa" ${sw(4)}/><ellipse cx="0" cy="34" rx="30" ry="12" fill="#e4e4ee" ${sw(2)}/>
  ${[-14, -5, 4, 13].map((x) => `<path d="M${x} 28 v10" stroke="#a7adc6" stroke-width="3" stroke-linecap="round"/>`).join('')}${co ? txt(0, 22, 'CO', 13, OL) : ''}
  ${part('led', 26, 22, `<circle cx="26" cy="22" r="5" fill="#ff3344" ${sw(1.5)}/>`)}${part('ledg', 26, 22, `<circle cx="26" cy="22" r="5" fill="#3dff8a" ${sw(1.5)}/>`)}`;
}
def('detector', { kind: 'prop', rig: 'prop', w: 90, h: 60, draw: detector, variants: ['smoke', 'co'], motions: ['chirp', 'idle', 'still'], desc: 'smoke or CO detector hanging from (x, y): put y on a ceiling; chirp = red light and alarm waves, idle = calm green light' });
function sign(o) {
  const L = (o.label || '').slice(0, 22), n = Math.max(L.length, 3);
  switch (o.variant) {
    case 'board': return `<path d="M-50 0 L-36 -110 L36 -110 L50 0" fill="none" ${sw(5)}/><rect x="-46" y="-120" width="92" height="80" rx="4" fill="#2e3a2e" ${sw(4)}/>${txt(0, -74, L, Math.min(22, 150 / n), '#fff')}`;
    case 'banner': { const w = Math.max(200, n * 20 + 40); return `<line x1="${-w / 2}" y1="0" x2="${-w / 2}" y2="-140" ${sw(4)}/><line x1="${w / 2}" y1="0" x2="${w / 2}" y2="-140" ${sw(4)}/><rect x="${-w / 2 - 6}" y="-142" width="${w + 12}" height="40" rx="5" fill="${o.color || '#e63946'}" ${sw(4)}/>${txt(0, -115, L, 18, '#fff')}`; }
    case 'plan': return `<line x1="-120" y1="0" x2="-100" y2="-240" ${sw(6)}/><line x1="120" y1="0" x2="100" y2="-240" ${sw(6)}/><rect x="-165" y="-290" width="330" height="230" rx="8" fill="#fffaf0" ${sw(5)}/>${txt(0, -252, L || 'THE PLAN', 26)}<line x1="-145" y1="-150" x2="145" y2="-150" stroke="#b8bccc" stroke-width="14" stroke-linecap="round"/>${part('route', 0, 0, `<path d="M-135 -130 C-105 -230 -55 -230 -45 -170 S5 -70 35 -130 S-15 -220 65 -220 S135 -90 85 -100 S35 -170 125 -185" pathLength="1" fill="none" stroke="#e63946" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 1" stroke-dashoffset="1"/>`)}<text x="-100" y="-80" class="big" font-size="18" fill="#e63946">X</text><text x="-80" y="-81" font-weight="800" font-size="13" fill="${OL}">= SNACKS</text>`;
    default: { const w = n * 16 + 34; return `<rect x="-4" y="-165" width="8" height="165" fill="#9aa0b8" ${sw(2)}/><rect x="${-w / 2}" y="-187" width="${w}" height="36" rx="5" fill="${o.color || '#1f8a4c'}" ${sw(3)}/>${txt(0, -161, L, 20, '#fff')}`; }
  }
}
def('sign', { kind: 'prop', rig: 'prop', w: 220, h: 190, draw: sign, variants: ['post', 'board', 'banner', 'plan'], motions: ['idle', 'hop', 'still'], label: 'the sign text, at most 3 short words', desc: 'post = green street sign; board = chalk sandwich board; banner = parade banner on two poles; plan = a whiteboard on an easel whose scribbled red route draws itself (label = its title)' });
def('tree', { kind: 'prop', rig: 'prop', w: 140, h: 170, draw: (o) => part('sway', 0, 0, tree(0, 0, 1, o.color || '#3a9155', o.variant)), variants: ['oak', 'pine', 'palm'], motions: ['idle', 'sway', 'still'], desc: 'a tree; sway shakes it (something hiding in it?)' });
function bush(o) {
  const c = o.color || '#3a9155', wide = o.variant === 'hedge';
  const shapes = wide ? (() => { let sh = '', k = 0; for (let x = -122; x <= 122; x += 44) sh += `<circle cx="${x}" cy="${-80 + (k++ % 2) * 10}" r="32"/>`; return sh + '<rect x="-150" y="-82" width="300" height="82" rx="18"/>'; })() : '<circle cx="-34" cy="-34" r="30"/><circle cx="0" cy="-56" r="38"/><circle cx="36" cy="-36" r="30"/><rect x="-62" y="-40" width="124" height="40" rx="14"/>';
  let s = blob(shapes, c) + `<circle cx="-10" cy="-70" r="9" fill="${lt(c, .2)}"/>`;
  if (o.variant === 'eyes' || wide) s += (wide ? [[-80, -60], [5, -48], [85, -62]] : [[-12, -40]]).map(([x, y], i) => part('eye', x, y, `<circle cx="${x}" cy="${y}" r="7" fill="#fff" ${sw(2)}/><circle cx="${x + 14}" cy="${y}" r="7" fill="#fff" ${sw(2)}/><circle cx="${x + 2}" cy="${y + 1}" r="3" fill="${OL}"/><circle cx="${x + 16}" cy="${y + 1}" r="3" fill="${OL}"/>`)).join('');
  return part('sway', 0, 0, s);
}
def('bush', { kind: 'prop', rig: 'prop', w: 130, h: 95, draw: bush, variants: ['plain', 'eyes', 'hedge'], motions: ['idle', 'sway', 'still'], desc: 'round bush (eyes = blinking eyes peek out of it; hedge = 300 wide with three pairs of eyes); great to hide characters behind (list it after them)' });
def('hydrant', { kind: 'prop', rig: 'prop', w: 50, h: 70, variants: ['red', 'yellow'], motions: ['idle', 'still'], desc: 'fire hydrant',
  draw: (o) => { const c = o.variant === 'yellow' ? '#ffcf4a' : '#e63946'; return `<rect x="-22" y="-10" width="44" height="10" rx="3" fill="${c}" ${sw(3)}/><rect x="-16" y="-58" width="32" height="50" rx="6" fill="${c}" ${sw(3)}/><path d="M-18 -58 Q0 -78 18 -58Z" fill="${c}" ${sw(3)}/><rect x="-26" y="-44" width="52" height="12" rx="5" fill="${dk(c, .2)}" ${sw(2.5)}/><circle cy="-36" r="6" fill="#c9ccd6" ${sw(2)}/>`; } });
def('mailbox', { kind: 'prop', rig: 'prop', w: 50, h: 110, variants: ['rural'], motions: ['idle', 'still'], desc: 'rural mailbox on a post, flag bobbing; no numbers',
  draw: (o) => `<rect x="-5" y="-80" width="10" height="80" fill="#6b4a2c" ${sw(2.5)}/><path d="M-26 -78 v-20 q0 -14 26 -14 q26 0 26 14 v20z" fill="${o.color || '#3a3f63'}" ${sw(3)}/>` + part('flag', 22, -92, `<rect x="20" y="-112" width="5" height="22" fill="#e63946" ${sw(1.5)}/><rect x="20" y="-112" width="14" height="9" fill="#e63946" ${sw(1.5)}/>`) });
function trashCan(o) {
  let s = '';
  if (o.variant === 'tail') s += part('tail', 18, -70, tube('M18 -68 q-8 -20 6 -42', 6, o.color || '#d9964a'));
  s += `<path d="M-30 -72 L-26 0 L26 0 L30 -72Z" fill="#7a8796" ${sj(3)}/>${[-14, 0, 14].map((x) => `<path d="M${x} -64 L${x * .9} -8" stroke="#5d6b7a" stroke-width="4"/>`).join('')}`;
  let lid = `<rect x="-36" y="-82" width="72" height="12" rx="5" fill="#5d6b7a" ${sw(3)}/><rect x="-8" y="-90" width="16" height="9" rx="3" fill="#5d6b7a" ${sw(2.5)}/>`;
  if (o.variant === 'eyes') lid = part('eye', -10, -68, `<rect x="-24" y="-74" width="48" height="10" fill="#1b1b28"/><circle cx="-10" cy="-69" r="4" fill="#fff"/><circle cx="8" cy="-69" r="4" fill="#fff"/><circle cx="-9" cy="-69" r="2" fill="${OL}"/><circle cx="9" cy="-69" r="2" fill="${OL}"/>`) + `<g transform="translate(0 -10)">${lid}</g>`;
  return s + part('lid', 0, -80, lid);
}
def('trash_can', { kind: 'prop', rig: 'prop', w: 72, h: 92, draw: trashCan, variants: ['plain', 'tail', 'eyes'], motions: ['idle', 'hop', 'still'], desc: 'metal trash can (tail = a dog tail wagging out of it; eyes = eyes peek under the lid); hop rattles the lid' });
function cutout(o) {
  const L = (o.label || '').slice(0, 10);
  const legs = [-52, -30, 30, 52].map((x, i) => part(i % 2 ? 'lb' : 'la', x, -24, `<rect x="${x - 4.5}" y="-26" width="9" height="26" rx="4.5" fill="${['#d9964a', '#fff', '#8b5a3c', '#e8c39e'][i]}" ${sw(2.5)}/>`)).join('');
  let body;
  if (o.variant === 'bush') body = `<path d="M-82 -22 Q-96 -60 -60 -76 Q-50 -110 -10 -100 Q20 -124 50 -96 Q90 -90 84 -50 Q96 -30 84 -22Z" fill="#6fa86a" ${sj(3.5)}/>`;
  else if (o.variant === 'cow') body = `<rect x="-82" y="-96" width="166" height="74" rx="24" fill="#f6efe0" ${sw(3.5)}/><path d="M-50 -90 q20 -4 24 14 q-6 16 -26 12z M20 -70 q20 -6 30 10 q-6 14 -24 10z" fill="#3a3442"/>`;
  else body = `<path d="M-82 -22 L-82 -74 L-62 -100 L30 -100 L56 -68 L84 -64 L84 -22Z" fill="#d6b27a" ${sj(3.5)}/><path d="M-58 -92 L-58 -72 L-12 -72 L-12 -92Z M0 -92 L0 -72 L40 -72 L26 -92Z" fill="none" stroke="#3a2a1a" stroke-width="3"/><circle cx="-50" cy="-34" r="12" fill="none" stroke="#3a2a1a" stroke-width="3"/><circle cx="52" cy="-34" r="12" fill="none" stroke="#3a2a1a" stroke-width="3"/>`;
  return `${legs}${part('tail', -82, -46, `<g transform="translate(-82 -46) rotate(70)">${tube('M0 0 q-8 -20 6 -42', 6, '#d9964a')}</g>`)}${body}<circle cx="18" cy="-82" r="9" fill="#e8a15a" ${sw(2)}/><circle cx="21" cy="-84" r="2" fill="${OL}"/><circle cx="27" cy="-80" r="2.4" fill="${OL}"/>${L ? txt(2, -40, L, 20, '#3a2a1a') : ''}`;
}
def('cutout', { kind: 'prop', rig: 'quad', w: 170, h: 100, draw: cutout, variants: ['suv', 'bush', 'cow'], motions: ['idle', 'walk', 'tiptoe', 'still', 'hop'], label: 'word scrawled on it, e.g. SUV', desc: 'a cardboard disguise with dog legs and a tail sticking out and one dog peeking through: animals "in disguise"' });
function building(o) {
  const L = (o.label || '').slice(0, 16), c = o.color;
  switch (o.variant) {
    case 'barn': return `<path d="M-140 -150 L0 -230 L140 -150 L140 0 L-140 0Z" fill="${c || '#c0392b'}" ${sj(4)}/><rect x="-60" y="-110" width="120" height="110" fill="#8a2a20" ${sw(3)}/><path d="M-60 -110 L60 0 M60 -110 L-60 0" stroke="#f6efe0" stroke-width="6"/>${L ? `<rect x="${-L.length * 8 - 12}" y="-178" width="${L.length * 16 + 24}" height="28" rx="3" fill="#f6efe0" ${sw(2.5)}/>${txt(0, -158, L, 16, '#8a2a20')}` : ''}`;
    case 'shelter': case 'firehouse': case 'shop': {
      const fire = o.variant === 'firehouse', col = c || (fire ? '#c0392b' : o.variant === 'shelter' ? '#a0715a' : '#5b8fd9');
      let s = `<path d="M-185 -160 L0 -250 L185 -160Z" fill="${dk(col, .35)}" ${sj(4)}/><rect x="-165" y="-165" width="330" height="165" fill="${col}" ${sw(4)}/>`;
      s += `<rect x="-143" y="-149" width="286" height="40" rx="6" fill="#fff6e3" ${sw(3)}/>${txt(0, -121, L || (fire ? 'FIRE STATION' : o.variant === 'shelter' ? 'ANIMAL SHELTER' : 'SHOP'), 21)}`;
      if (o.variant === 'shelter') s += `<circle cx="0" cy="-195" r="9" fill="#fff6e3"/><circle cx="-14" cy="-209" r="5" fill="#fff6e3"/><circle cx="0" cy="-214" r="5" fill="#fff6e3"/><circle cx="14" cy="-209" r="5" fill="#fff6e3"/>`;
      s += fire ? `<rect x="-120" y="-95" width="110" height="95" fill="#c9ccd6" ${sw(3)}/><rect x="10" y="-95" width="110" height="95" fill="#c9ccd6" ${sw(3)}/>${[-75, -55].map((y) => `<path d="M-120 ${y} h110 M10 ${y} h110" stroke="#8a8f9c" stroke-width="3"/>`).join('')}` : `<rect x="-140" y="-90" width="60" height="44" fill="#ffe7a3" ${sw(3)}/><rect x="80" y="-90" width="60" height="44" fill="#ffe7a3" ${sw(3)}/><rect x="-25" y="-80" width="50" height="80" fill="#4a2c3d" ${sw(3)}/>`;
      return s;
    }
    default: { const col = c || '#81b29a'; return `<path d="M-130 -120 L0 -215 L130 -120Z" fill="#6b3f3f" ${sj(4)}/><rect x="-115" y="-125" width="230" height="125" fill="${col}" ${sw(4)}/><rect x="-22" y="-72" width="44" height="72" rx="3" fill="${dk(col, .45)}" ${sw(3)}/><rect x="-95" y="-95" width="50" height="44" rx="3" fill="#ffe7a3" ${sw(3)}/><rect x="45" y="-95" width="50" height="44" rx="3" fill="#ffe7a3" ${sw(3)}/><rect x="-36" y="-6" width="72" height="8" fill="#c9ccd6" ${sw(2)}/>`; }
  }
}
def('building', { kind: 'prop', rig: 'prop', w: 370, h: 250, draw: building, variants: ['house', 'shop', 'shelter', 'barn', 'firehouse'], motions: ['still'], label: 'name on its sign (no house numbers)', desc: 'a single building to stand in front of a set (shelter = animal shelter with paw print)' });
def('cone', { kind: 'prop', rig: 'prop', w: 40, h: 50, variants: ['cone'], motions: ['still', 'hop'], desc: 'traffic cone',
  draw: () => `<rect x="-22" y="-6" width="44" height="6" rx="2" fill="#f4843d" ${sw(2.5)}/><path d="M-15 -6 L-5 -50 L5 -50 L15 -6Z" fill="#f4843d" ${sj(2.5)}/><path d="M-11 -22 h22 M-8 -36 h16" stroke="#fff" stroke-width="5"/>` });
def('stool', { kind: 'prop', rig: 'prop', w: 70, h: 60, variants: ['step'], motions: ['still', 'idle'], desc: 'step stool; idle wobbles it',
  draw: () => part('sway', 0, 0, `<path d="M-30 0 L-22 -56 L22 -56 L30 0" fill="none" stroke="${OL}" stroke-width="9"/><path d="M-30 0 L-22 -56 L22 -56 L30 0" fill="none" stroke="#e0a458" stroke-width="5"/><rect x="-28" y="-62" width="56" height="10" rx="3" fill="#e0a458" ${sw(2.5)}/><rect x="-26" y="-30" width="52" height="8" rx="3" fill="#e0a458" ${sw(2.5)}/>`) });
def('spotlight', { kind: 'prop', rig: 'prop', w: 60, h: 80, variants: ['stand'], motions: ['sweep', 'idle'], desc: 'a spotlight on a stand; sweep swings a long beam (searchlight)',
  draw: () => `${part('spot', 0, -60, `<path d="M10 -64 L620 -220 L620 40Z" fill="url(#cl-beam)"/>`)}<path d="M-20 0 L0 -50 L20 0" fill="none" ${sw(5)}/><rect x="-18" y="-76" width="34" height="30" rx="6" fill="#3a3f63" ${sw(3)}/><ellipse cx="16" cy="-61" rx="5" ry="13" fill="#ffe08a" ${sw(2)}/>` });
def('question', { kind: 'prop', rig: 'prop', w: 50, h: 70, variants: ['question', 'exclaim'], motions: ['idle', 'hop'], desc: 'a big floating ? or !',
  draw: (o) => `<text x="0" y="0" text-anchor="middle" class="big" font-size="72" fill="#ffcf4a" stroke="${OL}" stroke-width="8" paint-order="stroke" stroke-linejoin="round">${o.variant === 'exclaim' ? '!' : '?'}</text>` });
const puffs = (n, c, r0) => [...Array(n)].map((_, i) => part('pf', i, n, `<circle cx="0" cy="0" r="${r0}" fill="${c}" ${sw(3)}/>`)).join('');
def('smoke', { kind: 'prop', rig: 'prop', w: 120, h: 200, variants: ['grey', 'white', 'steam'], motions: ['idle'], desc: 'puffs of smoke rising from (x, y)',
  draw: (o) => puffs(6, o.variant === 'grey' ? '#9aa0b2' : o.variant === 'steam' ? '#f4f7ff' : '#e4e6ee', 26) });
def('confetti', { kind: 'prop', rig: 'prop', w: 1000, h: 700, variants: ['party'], motions: ['idle'], desc: 'confetti raining over a 1000×700 area whose top-left is (x, y); usually x 0, y 0',
  draw: () => { const r = rng(9); return [...Array(46)].map((_, i) => part('cf', (r() * 1000) | 0, (r() * 760) | 0, `<rect x="-4" y="-7" width="8" height="14" fill="${['#ffcf4a', '#ff5a5f', '#4cc9f0', '#7bd389', '#fff'][i % 5]}"/>`)).join(''); } });
def('hose_spray', { kind: 'prop', rig: 'prop', w: 300, h: 120, variants: ['water'], motions: ['idle'], desc: 'an arc of water spraying forward 300 px from (x, y) (aim it with flip)',
  draw: () => [...Array(16)].map((_, i) => part('dr', i, 16, `<ellipse rx="7" ry="4.5" fill="#8ecae6" ${sw(2)}/>`)).join('') + `<path d="M0 0 Q150 -110 300 0" fill="none" stroke="#bfe6ff" stroke-width="10" opacity=".55"/>` });

// ---------- floating effects for gags (drawn at the point they rise from) ----------
const FX = {
  bubble: (t) => { t = String(t || '…').slice(0, 24); const fs = t.length > 12 ? 20 : 26, w = Math.max(60, t.length * fs * .62 + 36); return `<g><path d="M-4 -24 L0 0 L20 -24Z" fill="#fff" ${sj(4)}/><rect x="-24" y="-74" width="${w}" height="52" rx="24" fill="#fff" ${sw(4)}/><rect x="-2" y="-27" width="20" height="8" fill="#fff"/>${txt(-24 + w / 2, -48 + fs * .36, t, fs)}</g>`; },
  burst: (t) => { const w = String(t || '').split(/\s+/).slice(0, 5), lines = w.length > 2 ? [w.slice(0, Math.ceil(w.length / 2)).join(' '), w.slice(Math.ceil(w.length / 2)).join(' ')] : [w.join(' ')]; const fs = Math.min(44, 300 / Math.max(...lines.map((l) => l.length), 4)); return `<path d="${burstPath(150, 112)}" fill="#ffcf4a" ${sj(6)}/>${lines.map((l, i) => txt(0, (lines.length === 1 ? 14 : i ? 44 : -8), l, fs.toFixed(1))).join('')}`; },
  badge: (t) => { t = String(t || '').slice(0, 18); const w = Math.max(260, t.length * 30 + 60); return `<rect x="${-w / 2}" y="-50" width="${w}" height="90" rx="18" fill="#ffcf4a" ${sw(5)}/>${txt(0, 12, t, 42)}`; },
  sign: (t) => { t = String(t || '').slice(0, 18); const w = Math.max(150, t.length * 17 + 40); return `<rect x="${-w / 2}" y="-34" width="${w}" height="60" rx="8" fill="#fff6e3" ${sw(4)}/>${txt(0, 6, t, 22, '#e63946')}`; },
  question: () => `<text text-anchor="middle" class="big ol" font-size="60" fill="#ffcf4a" stroke-width="8">?</text>`,
  exclaim: () => `<text text-anchor="middle" class="big ol" font-size="60" fill="#ff5a5f" stroke-width="8">!</text>`,
  notes: () => [...Array(5)].map((_, i) => part('fl', i, 5, `<g><path d="M8 -26 q12 4 9 15" fill="none" stroke="#fff" stroke-width="3.5"/><rect x="5" y="-27" width="3.5" height="27" fill="#fff"/><ellipse cx="0" cy="0" rx="7.5" ry="5.5" transform="rotate(-20)" fill="#fff"/></g>`)).join(''),
  hearts: () => [...Array(5)].map((_, i) => part('fl', i, 5, `<path d="M0 0 C-14 -10 -10 -24 0 -16 C10 -24 14 -10 0 0Z" fill="#ff5a7a" ${sw(2.5)}/>`)).join(''),
  zzz: () => [...Array(4)].map((_, i) => part('fl', i, 4, `<text text-anchor="middle" class="big ol" font-size="${26 + i * 4}" fill="#fff" stroke-width="5">Z</text>`)).join(''),
  dust: () => puffs(5, '#d9cbb0', 20),
  smoke: () => puffs(6, '#9aa0b2', 26),
  spray: () => FX_SPRAY,
};
const FX_SPRAY = C.hose_spray.draw({});

// ---------- posing: every part from the clock ----------
const PARTS = new WeakMap();
function partsOf(el) {
  let p = PARTS.get(el);
  if (!p) { p = {}; for (const n of el.querySelectorAll('[data-p]')) (p[n.dataset.p] ||= []).push({ n, x: +n.dataset.x || 0, y: +n.dataset.y || 0 }); PARTS.set(el, p); }
  return p;
}
const W = (T, f) => Math.sin(T * f * Math.PI * 2);
const each = (l, fn) => l && l.forEach(fn);
const set = (q, k, v) => q.n.setAttribute(k, v);
const rot = (l, a) => each(l, (q) => set(q, 'transform', `rotate(${(+a).toFixed(2)} ${q.x} ${q.y})`));
const op = (l, v) => each(l, (q) => set(q, 'opacity', (+v).toFixed(2)));
const GAIT = { walk: [1.7, 24, 3], trot: [2.6, 30, 6], run: [3.6, 38, 8], tiptoe: [1.1, 16, 2] };
// Parts that move the same way whatever the motion (sky, sets, effects).
function ambient(p, T) {
  each(p.tw, (q) => set(q, 'opacity', (.35 + .65 * Math.abs(Math.sin(T * 1.3 + q.x))).toFixed(2)));
  each(p.cloud, (q) => set(q, 'transform', `translate(${(Math.sin(T * .05 + q.x) * 70).toFixed(1)} 0)`));
  each(p.wave, (q) => set(q, 'transform', `translate(${(Math.sin(T * 1.1 + q.x) * 14).toFixed(1)} ${(Math.sin(T * .8 + q.x) * 3).toFixed(1)})`));
  each(p.blink, (q) => set(q, 'opacity', Math.floor(T * 2 + q.x * .37) % 2 ? 1 : .2));
  each(p.gull, (q) => set(q, 'transform', `translate(${((T * 45 + q.x * 500) % 1800 - 600).toFixed(1)} ${(Math.sin(T * 2 + q.x) * 12).toFixed(1)})`));
  rot(p.sock, W(T, .7) * 8); rot(p.clk, T * 36); rot(p.twirl, T * 420); rot(p.flag, W(T, .6) * 10);
  each(p.scr, (q) => set(q, 'opacity', (.6 + .4 * Math.abs(W(T, .9))).toFixed(2)));
  each(p.led, (q) => set(q, 'opacity', Math.floor(T * 3 + q.x) % 2 ? 1 : .3));
  each(p.eye, (q) => { const k = (T + q.x * .013) % 2.8 < .14 ? .1 : 1; set(q, 'transform', `translate(0 ${q.y}) scale(1 ${k}) translate(0 ${-q.y})`); });
  each(p.pf, (q) => { const ph = (T * .5 + q.x / q.y) % 1; set(q, 'transform', `translate(${(Math.sin(ph * 6 + q.x) * 16).toFixed(1)} ${(-ph * 190).toFixed(1)}) scale(${(.45 + ph).toFixed(2)})`); set(q, 'opacity', ((1 - ph) * Math.min(1, ph * 8)).toFixed(2)); });
  each(p.fl, (q) => { const ph = (T * .45 + q.x / q.y) % 1; set(q, 'transform', `translate(${(Math.sin(ph * 8 + q.x) * 12 + q.x * 9 - 18).toFixed(1)} ${(-ph * 130).toFixed(1)})`); set(q, 'opacity', ((1 - ph) * Math.min(1, ph * 6)).toFixed(2)); });
  each(p.dr, (q) => { const ph = (T * 1.4 + q.x / q.y) % 1; set(q, 'transform', `translate(${(300 * ph).toFixed(1)} ${(-440 * ph * (1 - ph)).toFixed(1)}) rotate(${(-40 + 80 * ph).toFixed(0)})`); });
  each(p.cf, (q, i) => { const v = 70 + (q.x * 7) % 70; set(q, 'transform', `translate(${(q.x + Math.sin(T * 2 + i) * 20).toFixed(1)} ${(((q.y + T * v) % 780) - 60).toFixed(1)}) rotate(${((q.x * 3 + T * 220) % 360).toFixed(0)})`); });
  each(p.puff, (q) => [...q.n.children].forEach((c, i) => { const ph = (T * .7 + i / 3) % 1; c.setAttribute('transform', `translate(${(-ph * 70).toFixed(1)} ${(-ph * 90).toFixed(1)}) scale(${(.5 + ph).toFixed(2)})`); c.setAttribute('opacity', (1 - ph).toFixed(2)); c.setAttribute('transform-origin', `${q.x} ${q.y}`); }));
}
// Poses one component at clock T for a motion. s = { T, mt (seconds into this motion), dist (px travelled), speed (px/s), seed, dark }.
// Returns the whole-body offsets the caller folds into its transform: { dx (forward), dy, r (forward lean), sx, sy, flip }.
function animate(el, name, motion, s) {
  const d = C[name], p = partsOf(el), T = s.T + ((s.seed || 0) % 11) * .137, m = motion, mt = s.mt || 0;
  const o = { dx: 0, dy: 0, r: 0, sx: 1, sy: 1, flip: false };
  ambient(p, T);
  if (!d) return o;
  const still = m === 'still';
  if (d.rig === 'quad' || d.rig === 'biped') {
    const g = GAIT[m];
    let legs = 0, aa = 0, ab = 0, head = 0, tail = still ? 0 : W(T, 2) * 12;
    if (g) { legs = W(T, g[0]) * g[1]; aa = legs * .8; ab = -legs * .8; o.dy = -Math.abs(W(T, g[0])) * g[2]; tail = W(T, 3.4) * 18; }
    if (m === 'run') o.r = 7;
    if (m === 'tiptoe') { o.dy -= 5; o.r = -5; aa = -40; ab = -55 + legs * .5; head = -6; }
    if (m === 'idle') { o.sy = 1 + W(T, .4) * .015; head = W(T, .3) * 3; aa = W(T, .4) * 3; ab = -aa; }
    if (m === 'wag') { tail = W(T, 5) * 26; o.r = W(T, 2.5) * 3; head = W(T, 1.2) * 6; }
    if (m === 'hop') { o.dy = -Math.abs(W(T, .9)) * d.h * .45; legs = 20; aa = -30; ab = -40; }
    if (m === 'spin') { o.sx = Math.cos(mt * Math.PI * 2.4); o.dy = -Math.abs(W(mt, 1.2)) * 6; }
    if (m === 'look') { o.flip = Math.floor(mt / .7) % 2 === 1; head = -10 + W(T, 1.4) * 4; }
    if (m === 'peek') { const c = mt % 2.6, k = c < .3 ? ease(c / .3) : c < 1.7 ? 1 : c < 2 ? 1 - ease((c - 1.7) / .3) : 0; o.dx = k * d.w * .5; o.r = k * 5; }
    if (m === 'hide') { const k = ease(mt / .25); o.sy = 1 - .55 * k; legs = 0; }
    if (m === 'shrug') { const k = Math.abs(Math.sin(Math.PI * T * .8)); head = (d.rig === 'quad' ? W(T, .5) * 14 : 10 * k); aa = -50 * k - 8; ab = -60 * k - 8; o.dy = -3 * k; }
    if (m === 'wave') ab = -150 + W(T, 3) * 25;
    if (m === 'talk') { ab = -45 + W(T, 2) * 25; head = W(T, 3) * 4; }
    if (m === 'sweep') ab = -88 + W(T, .45) * 26;
    rot(p.la, legs); rot(p.lb, -legs); rot(p.aa, aa); rot(p.ab, ab); rot(p.hd, head); rot(p.tail, tail);
    op(p.beam, m === 'sweep' ? 1 : 0);
    rot(p.jaw, still ? 0 : Math.max(0, W(T, .45)) * 16);
  } else if (d.rig === 'seated') {
    let ab = W(T, .4) * 4, head = W(T, .3) * 3;
    if (m === 'talk') { ab = -40 + W(T, 2) * 25; head = W(T, 3) * 5; }
    if (m === 'wave') ab = -150 + W(T, 3) * 25;
    if (m === 'shrug') { const k = Math.abs(Math.sin(Math.PI * T * .8)); ab = -60 * k; head = 10 * k; }
    if (m === 'look') { o.flip = Math.floor(mt / .7) % 2 === 1; head = -8; }
    rot(p.ab, ab); rot(p.hd, head);
    each(p.sp, (q) => set(q, 'transform', m === 'spin' ? `translate(${q.x} 0) scale(${Math.cos(mt * Math.PI * 2.4).toFixed(3)} 1) translate(${-q.x} 0)` : ''));
  } else if (d.rig === 'vehicle' || d.rig === 'boat' || d.rig === 'plane') {
    each(p.wh, (q) => set(q, 'transform', `rotate(${((s.dist || 0) / -q.y * 57.3).toFixed(1)} ${q.x} ${q.y})`));
    const on = Math.floor(T * 6) % 2;
    op(p.lr, on ? 1 : .25); op(p.lbl, on ? .25 : 1); op(p.ga, on ? .55 : 0); op(p.gb, on ? 0 : .55);
    op(p.head, s.dark ? .8 : 0);
    if (m === 'sweep') { op(p.spot, 1); rot(p.spot, W(T, .22) * 26 - 6); } else op(p.spot, 0);
    if (d.rig === 'vehicle') {
      if (m === 'drive' && (s.speed || 0) > 2) { o.dy = W(T, 5) * 1.4; o.r = W(T, 1.3) * .6; }
      if (m === 'hop') o.dy = -Math.abs(W(T, 1.1)) * 24;
    } else if (d.rig === 'boat') {
      if (!still) { o.dy = W(T, .5) * 4; o.r = W(T, .37) * 2.5 + (m === 'drive' ? -2 : 0); }
      op(p.wake, m === 'drive' ? .9 : 0);
    } else {
      const run = m === 'fly' || m === 'drive';
      each(p.prop, (q) => set(q, 'transform', run ? `translate(0 ${q.y}) scale(1 ${Math.cos(T * 70).toFixed(3)}) translate(0 ${-q.y})` : ''));
      op(p.disc, run ? .45 : 0);
      if (m === 'fly') { o.r = -3 + W(T, .25) * 3; o.dy = W(T, .4) * 6; }
      if (m === 'drive') o.dy = W(T, 4) * 1;
    }
  } else { // props
    if (name === 'radio') { const talk = m === 'talk'; each(p.arc, (q) => set(q, 'opacity', talk ? (.25 + .75 * (.5 + .5 * Math.sin(T * 7 - q.x * 1.1))).toFixed(2) : .2)); if (talk) o.r = W(T, 4.1) * 1.6; else op(p.led, 1); }
    if (name === 'detector') {
      const chirp = m === 'chirp', ph = (T * 1.6) % 1, on = chirp && ph < .35;
      op(p.led, on ? 1 : chirp ? .25 : 0); op(p.ledg, chirp ? 0 : 1); op(p.wv, on ? 1 - ph * 2 : 0);
      each(p.wv, (q) => set(q, 'transform', `translate(0 ${q.y}) scale(${(1 + ph * .5).toFixed(2)}) translate(0 ${-q.y})`));
      if (on) o.r = W(T, 14) * 4;
    }
    rot(p.sway, still ? 0 : m === 'sway' ? W(T, 3) * 6 : W(T, .35) * 1.2);
    rot(p.tail, W(T, 4) * 22);
    rot(p.la, GAIT[m] ? W(T, GAIT[m][0]) * GAIT[m][1] : 0); rot(p.lb, GAIT[m] ? -W(T, GAIT[m][0]) * GAIT[m][1] : 0);
    if (GAIT[m]) o.dy = -Math.abs(W(T, GAIT[m][0])) * GAIT[m][2];
    each(p.lid, (q) => set(q, 'transform', m === 'hop' ? `translate(0 ${(-Math.abs(W(T, 2.2)) * 16).toFixed(1)}) rotate(${(W(T, 2.2) * 8).toFixed(1)} 0 ${q.y})` : ''));
    each(p.route, (q) => q.n.firstChild && q.n.firstChild.setAttribute('stroke-dashoffset', (1 - c01(mt / 3.2)).toFixed(3)));
    if (name === 'spotlight') rot(p.spot, m === 'sweep' ? W(T, .22) * 30 - 10 : -10);
    if (name === 'question') o.dy = m === 'hop' ? -Math.abs(W(T, 1)) * 24 : W(T, .8) * 6;
    if (m === 'hop' && !p.lid && name !== 'question') o.dy = -Math.abs(W(T, 1.1)) * 18;
  }
  return o;
}

// ---------- catalogue (read by the server to brief the director and build its schema) ----------
const RIG_MOTIONS = {
  quad: ['idle', 'still', 'walk', 'trot', 'run', 'tiptoe', 'wag', 'hop', 'spin', 'look', 'peek', 'hide', 'shrug'],
  biped: ['idle', 'still', 'walk', 'run', 'tiptoe', 'hop', 'spin', 'look', 'peek', 'hide', 'shrug', 'wave', 'talk', 'sweep'],
  seated: ['idle', 'still', 'talk', 'shrug', 'spin', 'look', 'wave'],
  vehicle: ['drive', 'idle', 'still', 'hop'], boat: ['drive', 'idle', 'still'], plane: ['fly', 'drive', 'idle', 'still'],
};
for (const d of Object.values(C)) d.motions ||= RIG_MOTIONS[d.rig];
C.patrol_car.motions = [...RIG_MOTIONS.vehicle, 'sweep'];
const MOTIONS = {
  idle: 'breathing, small fidgets', still: 'frozen like a statue', walk: 'walk cycle', trot: 'bouncy trot', run: 'fast run, leaning in', tiptoe: 'sneaky high-stepping tiptoe',
  wag: 'tail wags hard, whole body wiggles', hop: 'bouncing up and down', spin: 'spins in place', look: 'looks around, turning back and forth', peek: 'leans out from behind something and back, again and again',
  hide: 'crouches down out of sight (behind whatever is listed after it)', shrug: 'shrugs / tilts head, puzzled', wave: 'waves an arm', talk: 'talks with gestures (radio waves pulse on a radio)',
  sweep: 'sweeps a flashlight or spotlight beam', drive: 'drives: wheels turn, body bounces (boats leave a wake)', fly: 'flies (planes)', chirp: 'detector chirps: red light and alarm waves', sway: 'shakes (a tree or bush with something in it)',
};
const GAGS = {
  bubble: 'speech bubble with text (≤4 words) over the target', burst: 'big comic starburst with 1–4 words, centre of the view', badge: 'big yellow headline card (a number or fact, ≤3 words), top of the view',
  sign: 'a hand-lettered sign pops up at x, y with text (≤3 words)', question: '? pops over the target', exclaim: '! pops over the target', notes: 'music notes float up from the target',
  hearts: 'hearts float up from the target', zzz: 'Z Z Z float up from the target', confetti: 'confetti rains over the view', smoke: 'smoke puffs from the target or x, y', dust: 'dust cloud at the target’s feet',
  spray: 'a hose sprays water forward from the target', shake: 'camera shake', flash: 'white flash', zoom: 'the camera punches in on the target',
  stack: 'the target group piles into a wobbly tower', freeze: 'the target freezes like a statue (pretending to be scenery)', hide: 'the target crouches out of sight',
};
const FORMATIONS = { line: 'single file behind the leader, alternating near and far', cluster: 'a loose bunch', stack: 'a tower, each on the one below' };
function catalog() {
  return {
    components: Object.entries(C).map(([name, d]) => ({ name, kind: d.kind, w: d.w, h: d.h, roof: d.roof, variants: d.variants, motions: d.motions, hats: d.hats, carries: d.carries, label: d.label, desc: d.desc })),
    sets: Object.entries(SETS).map(([name, d]) => ({ name, desc: d.desc, ground: d.ground, indoor: Boolean(d.indoor) })),
    skies: SKIES, colours: ['auto', ...Object.keys(PAL)], motions: MOTIONS, gags: GAGS, formations: FORMATIONS,
  };
}
// Draws a component: o = { variant, color (a PAL name), hat, carry, label, seed }.
function draw(name, o = {}) {
  const d = C[name]; if (!d) return '';
  return d.draw({ ...o, variant: d.variants.includes(o.variant) ? o.variant : d.variants[0], color: colour(o.color), label: o.label ? String(o.label) : '' });
}
const drawSet = (name, skyName, labels = []) => { const d = SETS[name] || SETS.main_street, p = { ...(PALS[skyName] || PALS.night), sky: SKIES.includes(skyName) ? skyName : 'night' }; return d.draw(p, labels.map((l) => String(l).slice(0, 14))) + night(p, d.indoor ? .08 : .12); };
return { OL, DEFS, PAL, C, SETS, SKIES, FX, MOTIONS, GAGS, FORMATIONS, esc, rng, c01, ease, sky, draw, drawSet, animate, ambient, partsOf, catalog };
})();
