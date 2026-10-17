// Squelch Studio cartoon engine (pass 2): turns the director's beat sheet into shots in the player shell, drawing
// everything from the library (CL) as a pure function of time t. Uses the shell's shot(), defs() and TL.
function studioPlay(BEAT) {
  'use strict';
  const ease = CL.ease, c01 = CL.c01;
  const pop = (x) => { x = c01(x); return x >= 1 ? 1 : x < .7 ? (x / .7) * 1.15 : 1.15 - .15 * ((x - .7) / .3); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const num = (v, d, lo = -1e4, hi = 1e4) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const HUD_GAGS = new Set(['burst', 'badge', 'confetti', 'flash']);
  const MIX_HATS = ['party', 'cap', 'none', 'shako', 'party', 'bow'];
  const BAND = ['trumpet', 'drum', 'none', 'tuba', 'flag', 'trumpet', 'none'];
  defs(CL.DEFS);

  // One cast entry → its members, each with its own look and offset from the leader.
  function castMembers(c, si, j) {
    const d = CL.C[c.kind];
    if (!d) return [];
    const n = Math.round(num(c.count, 1, 1, 16)), r = CL.rng(si * 977 + j * 131 + 7), list = [];
    for (let m = 0; m < n; m++) {
      const variant = c.variant === 'mixed' ? d.variants[Math.floor(r() * d.variants.length)] : c.variant;
      const hat = c.hat === 'mixed' ? MIX_HATS[(m + j) % MIX_HATS.length] : c.hat;
      const carry = c.carry === 'band' ? BAND[m % BAND.length] : c.carry;
      const okHat = d.hats.includes(hat) ? hat : 'none', okCarry = d.carries.includes(carry) || (c.carry === 'band' && d.kind === 'animal') ? carry : 'none';
      list.push({ m, far: c.formation === 'line' && m % 2 === 1, jx: r() - .5, jy: r() - .5,
        svg: CL.draw(c.kind, { variant, color: m === 0 || c.color !== 'auto' ? c.color : 'auto', hat: okHat, carry: okCarry, label: c.label, seed: si * 31 + j * 7 + m }) });
    }
    return list;
  }

  // Where a cast entry's leader is at time t, and how it moves.
  function track(c, t, sc) {
    const x0 = num(c.x, 500), y0 = num(c.y, 668), x1 = num(c.to_x, x0), y1 = num(c.to_y, y0);
    const mf = num(c.move_from, sc.start), mt = Math.max(mf + .05, num(c.move_to, sc.end));
    const k = c01((t - mf) / (mt - mf)), moving = t >= mf && t < mt && (Math.abs(x1 - x0) + Math.abs(y1 - y0)) > 1;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), moving, dist: dist * k, speed: moving ? dist / (mt - mf) : 0, mt: dist < 1 || t < mf ? t - sc.start : moving ? t - mf : t - mt, dir: x1 < x0 - 1 ? -1 : 1 };
  }

  const gagsFor = (sc, id, t) => (sc.gags || []).filter((g) => g.target === id && t >= g.at && t < gagEnd(g));
  const gagEnd = (g) => (num(g.until, 0) > num(g.at, 0) ? g.until : g.at + 2.5);

  function buildScene(sc, si) {
    const set = CL.SETS[sc.set] ? sc.set : 'main_street', G = CL.SETS[set].ground, dark = sc.sky === 'night';
    const cast = (sc.cast || []).filter((c) => CL.C[c.kind]);
    const members = cast.map((c, j) => castMembers(c, si, j));
    let actors = '';
    cast.forEach((c, j) => {
      const ms = members[j], order = [...ms.filter((m) => m.far), ...ms.filter((m) => !m.far)];
      actors += `<g data-k="c${j}">${order.map((m) => `<g data-k="a${j}_${m.m}">${m.svg}</g>`).join('')}</g>`;
    });
    const gags = (sc.gags || []).filter((g) => CL.GAGS[g.type]);
    const fxSvg = (g) => g.type === 'bubble' || g.type === 'burst' || g.type === 'badge' || g.type === 'sign' ? CL.FX[g.type](g.text) : CL.FX[g.type] ? CL.FX[g.type]() : g.type === 'confetti' ? CL.draw('confetti', {}) : '';
    const world = gags.map((g, i) => HUD_GAGS.has(g.type) ? '' : `<g data-k="g${i}">${fxSvg(g)}</g>`).join('');
    const hud = gags.map((g, i) => !HUD_GAGS.has(g.type) ? '' : g.type === 'flash' ? `<rect data-k="g${i}" x="-3000" y="-3000" width="8000" height="8000" fill="#fff" opacity="0"/>` : `<g data-k="g${i}">${fxSvg(g)}</g>`).join('');
    const title = si === 0 ? `<g data-k="title" text-anchor="middle">${titleCard()}</g>` : '';
    shot(sc.start, sc.end, `<g data-k="sky">${CL.sky(sc.sky)}</g><g data-k="cam"><g data-k="set">${CL.drawSet(set, sc.sky, sc.labels || [])}</g>${actors}${world}</g><g data-k="hud">${hud}${title}</g>`, (g) => {
      const cam = q(g, 'cam'), skyEl = q(g, 'sky'), setEl = q(g, 'set'), ttl = q(g, 'title');
      const els = cast.map((c, j) => members[j].map((m) => q(g, `a${j}_${m.m}`)));
      const gEls = gags.map((_, i) => q(g, `g${i}`));
      const camC = sc.camera || {};
      return (lt, T) => {
        const t = sc.start + lt;
        CL.ambient(CL.partsOf(skyEl), T); CL.ambient(CL.partsOf(setEl), T);
        const where = {}; // id → { x, y (feet), top (head y), dir, s, w }
        cast.forEach((c, j) => {
          const d = CL.C[c.kind], tr = track(c, t, sc), S = num(c.scale, 1, .15, 4), my = gagsFor(sc, c.id, t);
          const on = t >= num(c.enter, sc.start) - .001 && t < (num(c.exit, sc.end) > num(c.enter, sc.start) ? c.exit : sc.end + 1);
          const freeze = my.some((x) => x.type === 'freeze'), hide = my.find((x) => x.type === 'hide'), stack = my.find((x) => x.type === 'stack');
          let motion = tr.moving ? c.motion : c.then;
          if (!d.motions.includes(motion)) motion = d.motions.includes('idle') ? 'idle' : d.motions[0];
          let mt = tr.mt;
          if (freeze) motion = 'still';
          if (hide) { motion = d.motions.includes('hide') ? 'hide' : 'still'; mt = t - hide.at; }
          const faceL = (tr.dir < 0) !== Boolean(c.flip), sp = num(c.spacing, d.w * .9, 10, 600);
          const grow = num(c.enter, sc.start) > sc.start + .05 ? pop((t - c.enter) / .3) : 1;
          const stK = stack ? ease((t - stack.at) / .4) : 0;
          let stackY = 0;
          els[j].forEach((el, i) => {
            const mb = members[j][i];
            el.setAttribute('visibility', on ? 'visible' : 'hidden');
            if (!on) return;
            const pose = CL.animate(el, c.kind, motion, { T, mt, dist: tr.dist, speed: tr.speed, seed: si * 31 + j * 7 + i, dark });
            let ox = 0, oy = 0, s = S, flip = faceL;
            if (c.formation === 'line') { ox = -i * sp * tr.dir; if (mb.far) { oy = -42; s *= .86; } }
            else if (c.formation === 'cluster') { ox = mb.jx * sp * 2; oy = mb.jy * 26; }
            if (c.formation === 'stack' || stK > 0) {
              const k = c.formation === 'stack' ? 1 : stK, sy = stackY;
              stackY -= d.h * .62 * S;
              ox = lerp(ox, i % 2 ? 8 : -8, k); oy = lerp(oy, sy, k); s = lerp(s, S * .92, k);
              if (k > .5) flip = i % 2 === 1 ? !faceL : faceL;
            }
            if (pose.flip) flip = !flip;
            const f = flip ? -1 : 1, x = tr.x + ox + pose.dx * f, y = tr.y + oy + pose.dy * s;
            const sway = (c.formation === 'stack' || stK > .5) ? Math.sin(T * 1.7) * 2.6 * (i ? 1 : 0) : 0;
            el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(pose.r * f + sway).toFixed(2)}) scale(${(f * pose.sx * s * grow).toFixed(3)} ${(pose.sy * s * grow).toFixed(3)})`);
          });
          where[c.id] = { x: tr.x, y: tr.y, top: tr.y + Math.min(0, stackY + d.h * .62 * S) - d.h * S - 8, dir: faceL ? -1 : 1, s: S, w: d.w * S, on };
        });
        // camera: from → to (or following a cast member), with punch-ins and shakes from gags
        let cx = lerp(num(camC.x, 500), num(camC.to_x, num(camC.x, 500)), ease(lt / Math.max(.1, sc.end - sc.start)));
        let cy = lerp(num(camC.y, 350), num(camC.to_y, num(camC.y, 350)), ease(lt / Math.max(.1, sc.end - sc.start)));
        let z = lerp(num(camC.zoom, 1, .5, 3), num(camC.to_zoom, num(camC.zoom, 1, .5, 3), .5, 3), ease(lt / Math.max(.1, sc.end - sc.start)));
        if (camC.follow && where[camC.follow]) cx = where[camC.follow].x;
        gags.forEach((gg, i) => {
          const el = gEls[i], a = num(gg.at, sc.start), e = gagEnd(gg), live = t >= a && t < e, k = t - a, tg = where[gg.target];
          if (gg.type === 'zoom' && live && tg) { const env = Math.min(ease(k / .35), ease((e - t) / .35)); z *= 1 + .7 * env; cx = lerp(cx, tg.x, env); cy = lerp(cy, (tg.y + tg.top) / 2, env); }
          if (gg.type === 'shake' && live) { cx += Math.sin(T * 61) * 9; cy += Math.cos(T * 53) * 7; }
          if (!el) return;
          if (gg.type === 'flash') { el.setAttribute('opacity', live ? Math.max(0, .9 * (1 - k / .35)).toFixed(2) : 0); return; }
          el.setAttribute('visibility', live ? 'visible' : 'hidden');
          if (!live) return;
          if (gg.type === 'confetti') { CL.ambient(CL.partsOf(el), T); return; }
          if (HUD_GAGS.has(gg.type)) { el.setAttribute('transform', `translate(${num(gg.x, 500)} ${num(gg.y, gg.type === 'badge' ? 100 : 200)}) scale(${(pop(k / .35) * (1 + .03 * Math.sin(T * 9))).toFixed(3)})`); return; }
          CL.ambient(CL.partsOf(el), T - a);
          let x = num(gg.x, 500), y = num(gg.y, 400);
          if (tg) {
            x = tg.x; y = gg.type === 'dust' || gg.type === 'smoke' ? tg.y : tg.top;
            if (gg.type === 'spray') { x = tg.x + tg.dir * tg.w * .35; y = tg.y - tg.w * .6; }
            if (gg.type === 'bubble') x = tg.x + tg.dir * 10;
          }
          const s = gg.type === 'notes' || gg.type === 'hearts' || gg.type === 'zzz' || gg.type === 'smoke' || gg.type === 'dust' || gg.type === 'spray' ? 1 : pop(k / .3);
          el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(gg.type === 'spray' && tg && tg.dir < 0 ? -s : s).toFixed(3)} ${s.toFixed(3)})`);
        });
        cam.setAttribute('transform', `translate(500 350) scale(${z.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`);
        if (ttl) { const k = lt, out = (C[0] ? C[0].start : 1.5) + 1.2; ttl.setAttribute('visibility', k < out ? 'visible' : 'hidden'); ttl.setAttribute('transform', `translate(500 0) scale(${pop(k / .4).toFixed(3)}) translate(-500 0)`); ttl.setAttribute('opacity', c01((out - k) / .4).toFixed(2)); }
      };
    });
  }

  function titleCard() {
    const words = String(TL.title || '').toUpperCase().split(/\s+/), mid = Math.ceil(words.length / 2);
    const a = words.slice(0, mid).join(' '), b = words.slice(mid).join(' '), fs = Math.min(64, 900 / Math.max(a.length, b.length, 6) * 1.4);
    return `<text x="500" y="150" class="big ol" font-size="${fs.toFixed(0)}" fill="#fff" stroke-width="12">${CL.esc(a)}</text>${b ? `<text x="500" y="${(150 + fs * 1.05).toFixed(0)}" class="big ol" font-size="${fs.toFixed(0)}" fill="#ffcf4a" stroke-width="12">${CL.esc(b)}</text>` : ''}<text x="500" y="${(b ? 185 + fs * 1.05 : 190).toFixed(0)}" class="ol" font-size="22" font-weight="800" fill="#fff" stroke-width="7">${CL.esc(TL.channel || '')}</text>`;
  }

  // The closing cards: three punchlines pop in over a spotlit stage, the stars of the story underneath.
  function finale() {
    const stars = (BEAT.finale || []).filter((c) => CL.C[c.kind]).slice(0, 3);
    const cards = (TL.punch || []).slice(0, 3);
    const xs = stars.length === 1 ? [500] : stars.length === 2 ? [380, 620] : [330, 500, 670];
    const cardSvg = (t, i) => i < 2 ? `<text text-anchor="middle" class="big ol" font-size="${Math.min(60, 1100 / Math.max(t.length, 8)).toFixed(0)}" fill="${i ? '#ffcf4a' : '#fff'}" stroke-width="12">${CL.esc(t)}</text>` : `<text text-anchor="middle" font-size="30" font-weight="800" font-style="italic" fill="#c9d0f5">${CL.esc(t)}</text>`;
    shot(END, TOTAL + 5, `<g data-k="sky">${CL.sky('night')}</g><rect x="-3000" y="-3000" width="8000" height="8000" fill="#0d1230" opacity=".55"/><path d="M440 -200 L300 610 L700 610 L560 -200Z" fill="#fff3b0" opacity=".08"/><ellipse cx="500" cy="606" rx="290" ry="38" fill="#26306a"/>
      ${cards.map((t, i) => `<g data-k="e${i}">${cardSvg(t, i)}</g>`).join('')}${stars.map((c, i) => `<g data-k="s${i}">${CL.draw(c.kind, { variant: c.variant, color: c.color, hat: CL.C[c.kind].hats.includes(c.hat) ? c.hat : 'none', carry: CL.C[c.kind].carries.includes(c.carry) ? c.carry : 'none', seed: 90 + i })}</g>`).join('')}
      <text x="500" y="676" text-anchor="middle" font-size="17" fill="#8d96c4">made with <tspan class="big" fill="#ffcf4a">Squelch</tspan> · real scanner audio</text>`, (g) => {
      const e = cards.map((_, i) => q(g, `e${i}`)), s = stars.map((_, i) => q(g, `s${i}`)), sk = q(g, 'sky');
      return (lt, T) => {
        CL.ambient(CL.partsOf(sk), T);
        [[.2, 150], [1.2, 238], [2.2, 300]].forEach(([t0, y], i) => { if (!e[i]) return; e[i].setAttribute('visibility', lt > t0 ? 'visible' : 'hidden'); e[i].setAttribute('transform', `translate(500 ${y}) scale(${pop((lt - t0) / .35).toFixed(3)})`); });
        stars.forEach((c, i) => {
          const d = CL.C[c.kind], big = Math.min(1.6, 150 / Math.max(d.h, d.w * .55)), mid = i === Math.floor(stars.length / 2);
          const m = mid && lt > 2.9 ? (d.motions.includes('hop') ? 'hop' : 'idle') : (d.motions.includes('wag') ? 'wag' : 'idle');
          const o = CL.animate(s[i], c.kind, m, { T, mt: lt, seed: 90 + i });
          const f = xs[i] > 500 ? -1 : 1;
          s[i].setAttribute('transform', `translate(${xs[i]} ${(606 + o.dy * big).toFixed(1)}) rotate(${(o.r * f).toFixed(2)}) scale(${(f * o.sx * big).toFixed(3)} ${(o.sy * big).toFixed(3)})`);
        });
      };
    });
  }

  (BEAT.scenes || []).forEach(buildScene);
  finale();
}
