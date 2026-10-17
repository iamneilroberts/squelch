// Cartoon: a model writes the scene code for a flat vector SVG animation; it goes into a player page that
// carries the real radio as a data URI and drives everything from one clock, render(t). Checked in Chrome,
// then stepped frame by frame into an MP4 (which is what plays in messaging apps and file viewers).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';
import { openRouter } from '../ai/llm.mjs';
import { RULES } from './script.mjs';
import { scrub, timeCaptions } from './track.mjs';
import { withBrowser } from './browser.mjs';

const ASSETS = new URL('./assets/', import.meta.url).pathname;
const REFERENCE = readFileSync(join(ASSETS, 'cartoon-ref.js'), 'utf8');
const FPS = 20;

const SYSTEM = `You write the scene code for a short flat-vector SVG cartoon that plays over real police/fire radio audio. Reply with JavaScript only, in one \`\`\`js block.
Your code runs inside a player that already provides:
- TL: { clips: [{ start, dur, clock }], captions: [[from, to, text]], punch: [3 closing cards], title, end, total }; also C = TL.clips, END = TL.end (radio over), TOTAL = TL.total.
- shot(t0, t1, svgMarkup, init): one scene from t0 to t1 seconds. init(g) gets the scene's <g> and returns update(lt, T), called every frame with lt = seconds into the shot and T = absolute time.
- helpers: rng(seed), c01, ease, pop, lerp, P(el, x, y, scale, flip, rotateDeg, scaleY), vis(el, on), bob(T, phase), sw(width) (outline attrs), OL (outline colour), NS, at(key, markup) (wraps in <g data-k=key>), q(g, key), qa(g, key), look(lt, a, b), defs(markup) (adds gradients etc. once).
- CSS classes: "leg la"/"leg lb" (walking legs; set style="transform-origin:..."), "tail" (wag), "twirl", "wave", "big" (heavy font), "ol" (outlined text, add stroke-width).
Rules:
- The viewBox is 0 0 1000 700. On phones and in the vertical MP4 it narrows to x 180–820, so keep the action between x 200 and 800. Paint skies and ground far past the edges (x -2000 to 4000, y -2000 to 2600) so no edge ever shows.
- Shots must cover 0 to TOTAL with no gaps, in order; sync beats to TL.clips and TL.captions; the last shot runs from END to TOTAL and shows the three TL.punch cards popping in.
- Everything is a pure function of time: no setTimeout, setInterval, requestAnimationFrame, Date, Math.random (use rng), no event listeners, no fetch, no images, fonts or URLs of any kind.
- No speech captions in the picture (the player shows them); short signs or one-word exclamations are fine.
- ${RULES.replace(/\n- /g, ' ')}
- People are simple generic cartoon figures with no facial detail; no badges, plates or numbers.
- 5 to 8 shots, under 700 lines. Lively: characters move in every shot.
The reference below is the art and first shots of a hand-made cartoon in this player (it used a word-timing helper wt() that you don't have; use TL timings instead). Match its drawing style and code shape.`;

function extractCode(text) {
  const m = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

// Problems that rule the code out before it reaches a browser.
function staticCheck(code) {
  try { new Script(`(function(){\n${code}\n})`); } catch (e) { return `syntax error: ${e.message}`; }
  const url = /https?:\/\/(?!www\.w3\.org\/)[^\s'"`)]+/.exec(code);
  if (url) return `external URL ${url[0]}`;
  const banned = /\b(fetch|XMLHttpRequest|importScripts|setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|new Date|addEventListener)\b|import\s*\(/.exec(code);
  if (banned) return `uses ${banned[0]}`;
  return null;
}

function page(code, tl, audio, label) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return readFileSync(join(ASSETS, 'cartoon.html'), 'utf8')
    .replace('__SCENES__', () => code.replace(/<\/script/gi, '<\\/script'))
    .replace('__TITLE__', () => esc(tl.title)).replace('__LABEL__', () => esc(label))
    .replace('__TIMELINE__', () => JSON.stringify(tl).replace(/</g, '\\u003c'))
    .replace('__AUDIO__', () => `data:audio/mpeg;base64,${readFileSync(audio).toString('base64')}`);
}

// Loads the page and draws 24 moments across it. Returns an error message, or null if it plays.
async function playCheck(browser, file, total) {
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    await p.goto(`file://${resolve(file)}`, { waitUntil: 'load', timeout: 30e3 });
    if (errors.length) return `page error: ${errors[0]}`;
    const r = await p.evaluate((total) => {
      const s = window.__studio;
      if (!s) return 'the player did not start';
      const spans = s.shots().sort((a, b) => a[0] - b[0]);
      if (!spans.length) return 'no shots';
      let reach = 0;
      for (const [a, b] of spans) { if (a > reach + 0.05) return `nothing on screen from ${reach.toFixed(1)} s to ${a.toFixed(1)} s`; reach = Math.max(reach, b); }
      if (reach < total - 0.05) return `nothing on screen after ${reach.toFixed(1)} s`;
      for (let i = 0; i < 24; i++) {
        const t = (total * i) / 23.5;
        try { s.frame(t); } catch (e) { return `at ${t.toFixed(1)} s: ${e.message}`; }
        const shown = document.querySelector('#world > g:not([display])');
        if (!shown || shown.querySelectorAll('*').length < 3) return `an empty scene at ${t.toFixed(1)} s`;
      }
      return null;
    }, total);
    return r || (errors.length ? `page error: ${errors[0]}` : null);
  } finally { await p.close(); }
}

// Steps the page through render(t) at 20 fps, 1080×1920, and muxes the frames with the track.
async function captureMp4(browser, job, file, audio, total, out) {
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 693, deviceScaleFactor: 2.77 });
  await p.goto(`file://${resolve(file)}`, { waitUntil: 'load', timeout: 30e3 });
  await p.evaluate(() => window.__studio.capture());
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', audio,
    '-vf', 'scale=1080:1920', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', out]);
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((done) => ff.on('close', done));
  const n = Math.ceil(total * FPS);
  for (let i = 0; i <= n; i++) {
    await p.evaluate((t) => window.__studio.frame(t), i / FPS);
    const jpg = await p.screenshot({ type: 'jpeg', quality: 88 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 20 === 0) job.progress('rendering the MP4', i / n);
  }
  ff.stdin.end();
  const code = await closed;
  await p.close();
  if (code !== 0) throw new Error(`ffmpeg: ${err.trim().slice(-300)}`);
}

export async function makeCartoon(job, { script, track, subtitle }) {
  const tl = {
    title: scrub(script.title), channel: subtitle, end: track.end, total: track.total,
    clips: track.clips.map((c) => ({ start: c.start, dur: +c.dur.toFixed(2), clock: c.clock })),
    captions: timeCaptions(track.clips, track.clips.map((_, i) => script.captions.find((c) => c.clip === i)?.lines.map(scrub))),
    punch: script.punch.slice(0, 3).map(scrub),
  };
  const brief = JSON.stringify({ title: tl.title, cast: script.cast, beats: script.beats, TL: tl }, null, 1);
  const model = job.models.cartoon;
  const file = join(job.dir, 'cartoon.html');
  const label = `Cartoon: ${tl.title}`;
  let code = '', problem = null, played = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    job.progress(attempt ? 'fixing the cartoon (second try)' : 'writing the cartoon');
    const user = attempt
      ? `${brief}\n\nYour previous code failed: ${problem}\nHere it is; reply with the whole corrected code.\n\`\`\`js\n${code}\n\`\`\``
      : `${brief}\n\nReference:\n\`\`\`js\n${REFERENCE}\n\`\`\``;
    const j = await job.call('studio:cartoon', model, { inTok: (SYSTEM.length + user.length) / 3.3, outTok: 14000 }, () => openRouter({
      model, max_tokens: 32000, reasoning: { effort: 'low' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }, { purpose: 'studio:cartoon' }), (r) => r.usage?.cost);
    if (j.choices?.[0]?.finish_reason === 'length') { problem = 'it was cut off (too long); make it shorter'; code = ''; continue; }
    code = extractCode(j.choices?.[0]?.message?.content || '');
    problem = staticCheck(code);
    if (problem) continue;
    writeFileSync(file, page(code, tl, track.file, label));
    job.progress('checking it plays');
    const checked = await withBrowser(async (b) => ({ error: await playCheck(b, file, tl.total) })); // null: no browser here
    played = Boolean(checked);
    problem = checked?.error ?? null;
    if (!problem) break;
  }
  if (problem) throw new Error(`The cartoon didn't work after two tries: ${problem}`);

  job.progress('rendering the MP4', 0);
  const t0 = Date.now();
  const made = await withBrowser(async (b) => { await captureMp4(b, job, file, track.file, tl.total, join(job.dir, 'cartoon.mp4')); return true; });
  return made
    ? { render_s: (Date.now() - t0) / 1000, duration_s: tl.total, notes: null }
    : { render_s: null, duration_s: tl.total, notes: `MP4 unavailable: no headless Chrome here (set CHROME_PATH and install puppeteer-core).${played ? '' : ' Checked for syntax and URLs only, not played.'}` };
}
