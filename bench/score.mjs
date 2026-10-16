// Scoring helpers shared by the bench suites.

const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Lowercase, strip punctuation, spoken numbers → digits, then glue digit-by-digit readouts
// ("three three" / "3 3" → "33") so "runway 33" and "runway three three" compare equal.
export function normalize(text) {
  const words = String(text).toLowerCase().replace(/[-–]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      let n = TENS[w];
      if (ONES[words[i + 1]] > 0 && ONES[words[i + 1]] < 10) n += ONES[words[++i]];
      if (words[i + 1] === 'hundred') { n *= 100; i++; }
      out.push(String(n));
    } else if (w in ONES) {
      let n = ONES[w];
      if (words[i + 1] === 'hundred') { n *= 100; i++; }
      out.push(String(n));
    } else out.push(w);
  }
  const glued = [];
  for (const w of out) {
    const prev = glued[glued.length - 1];
    if (/^\d$/.test(w) && prev && /^\d+$/.test(prev) && (prev.length === 1 || glued.digitRun)) {
      glued[glued.length - 1] = prev + w;
      glued.digitRun = true;
    } else { glued.push(w); glued.digitRun = /^\d$/.test(w); }
  }
  return glued;
}

export function wer(ref, hyp) {
  const r = normalize(ref), h = normalize(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  return r.length ? d[r.length][h.length] / r.length : 0;
}

// Words that matter most on scanner traffic: place names and numbers (addresses, units, runways).
const STOP = new Set('a an the to at on in of for and is are we you your it report respond responding copy with from by be have has this that there their our reports caller'.split(' '));
export function keyTerms(ref) {
  return [...new Set(normalize(ref).filter((w) => !STOP.has(w) && (/^\d+$/.test(w) || w.length >= 5)))];
}
export function keyRecall(ref, hyp) {
  const terms = keyTerms(ref);
  const h = new Set(normalize(hyp));
  return terms.length ? terms.filter((t) => h.has(t)).length / terms.length : 1;
}

// Location tokens may legitimately come back as an equivalent name.
const ALIASES = {
  brookley: ['brookley', 'downtown airport', 'mobile downtown', 'bfm', 'aeroplex'],
  'mobile regional': ['mobile regional', 'kmob', 'mob airport', 'mobile international'],
};
export function hasLocation(query, token) {
  const q = query.toLowerCase();
  return (ALIASES[token] || [token]).some((t) => q.includes(t));
}

export function median(xs) {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
