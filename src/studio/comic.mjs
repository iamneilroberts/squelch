// Comic: panels from an image model, then pans and zooms over them with captions and the real radio,
// rendered by ffmpeg alone (MP4) and as a single-file web page.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openRouter } from '../ai/llm.mjs';
import { STYLES, RULES } from './script.mjs';
import { notesBlock } from './notes.mjs';
import { timeCaptions, scrub } from './track.mjs';

const run = promisify(execFile);
const ASSETS = new URL('./assets/', import.meta.url).pathname;
const FONT = join(ASSETS, 'Bangers-Regular.ttf');
const W = 1080, H = 1920, FPS = 30;
const WIN = { x: 48, y: 238, w: 984, h: 1234 }; // the picture inside its 8 px ink border
const UP = 4; // pans and zooms run on a 4× source, so each step moves a quarter pixel: smooth, no shimmer
const FADE = 0.5;
const IMAGE_TOKENS = 1290; // one generated image, as Gemini bills it

export const panelPrompt = (style, cast, scene, k, ref, notes = '') => `STYLE (keep identical across the series): ${STYLES[style].art}, vertical 4:5 portrait composition, a single picture filling the whole frame, no panel border, no margins.
CAST: ${cast}
${RULES}
No readable text, logos or numbers anywhere except the exact words given in quotes below.
${ref ? 'Match the attached reference panel EXACTLY in drawing style, line weight, colour palette and character designs. This is the next panel of the same comic.\n' : ''}${notesBlock(notes) ? `${notesBlock(notes).trim()}\n` : ''}PANEL ${k}: ${scene}`;

// One panel image; retried once if the model answers without a picture.
async function panel(job, { style, cast, scene, k, ref, out }) {
  const model = job.models.image;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = [{ type: 'text', text: panelPrompt(style, cast, scene, k, ref, job.notes) }];
    if (ref) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(ref).toString('base64')}` } });
    const j = await job.call('studio:image', model, { inTok: ref ? 2200 : 350, imageTok: IMAGE_TOKENS }, () =>
      openRouter({ model, modalities: ['image', 'text'], image_config: { aspect_ratio: '4:5' }, messages: [{ role: 'user', content }] }, { purpose: 'studio:image' }), (r) => r.usage?.cost);
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (url) { writeFileSync(out, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); return out; }
  }
  throw new Error(`The image model returned no picture for panel ${k}`);
}

// Panel k's picture trimmed to the window's shape (and off any border the model drew) as a JPEG.
async function crop(png, jpg) {
  const [w, h] = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png])).stdout.trim().split(',').map(Number);
  const inset = Math.round(Math.min(w, h) * 0.015), aw = w - 2 * inset, ah = h - 2 * inset, a = WIN.w / WIN.h;
  const [cw, ch] = aw / ah > a ? [Math.round(ah * a), ah] : [aw, Math.round(aw / a)];
  await run('ffmpeg', ['-y', '-v', 'error', '-i', png, '-vf', `crop=${cw}:${ch}:${Math.round((w - cw) / 2)}:${Math.round((h - ch) / 2)}`, '-q:v', '3', jpg]);
}

// Panels in story order become shots: each starts as its clip does, long ones split in two, alternating push-in and pull-out.
function planShots(panels, clips, total) {
  const startOf = (p, i) => (i === 0 ? 0 : Math.max(0, (clips[p.from_clip]?.start ?? 0) - 0.3));
  const starts = panels.map(startOf);
  // Panels that start on the same clip share its time evenly.
  for (let i = 0; i < panels.length;) {
    let j = i; while (j + 1 < panels.length && starts[j + 1] <= starts[i]) j++;
    const end = j + 1 < panels.length ? starts[j + 1] : total;
    for (let k = i; k <= j; k++) starts[k] = starts[i] + ((end - starts[i]) * (k - i)) / (j - i + 1);
    i = j + 1;
  }
  const shots = [];
  panels.forEach((p, i) => {
    const a = starts[i], b = i + 1 < panels.length ? starts[i + 1] : total;
    const f = [Math.min(0.8, Math.max(0.2, p.focus_x)), Math.min(0.8, Math.max(0.2, p.focus_y))];
    const parts = b - a > 14 ? [a, (a + b) / 2] : [a];
    parts.forEach((t) => {
      const push = shots.length % 2 === 0;
      shots.push({ t: +t.toFixed(2), img: i + 1, from: push ? [0.5, 0.5, 1] : [...f, 1.38], to: push ? [...f, 1.3] : [0.5, 0.5, 1.05] });
    });
  });
  return shots;
}

const titleSize = (s) => Math.min(96, Math.floor(1000 / (s.length * 0.46)));
const fitSize = (s, max, width) => Math.min(max, Math.floor(width / (Math.max(1, s.length) * 0.47)));
function wrap(text, max = 24) {
  const lines = [];
  for (const w of text.split(/\s+/)) {
    if (lines.length && (lines.at(-1) + ' ' + w).length <= max) lines[lines.length - 1] += ` ${w}`;
    else lines.push(w);
  }
  return lines;
}

// The MP4: a still background, the shots cross-faded in the window, then captions, the clock tag and the closing cards.
async function renderMp4(job, tl, jpgs, track, out) {
  const work = join(job.dir, 'work');
  const txt = (name, s) => { const f = resolve(work, `${name}.txt`); writeFileSync(f, s); return f; };
  const font = `fontfile='${FONT}':expansion=none`;
  const D = tl.duration;

  // Background: halftone navy, title, subtitle, the window's shadow and border.
  const bg = resolve(work, 'bg.png');
  const dot = (on, off) => `'if(lte(pow(mod(X+14-14*mod(floor((Y+14)/28),2),28)-14,2)+pow(mod(Y+14,28)-14,2),10),${on},${off})'`;
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1b1f40:s=${W}x${H}:d=1`, '-vf', [
    `format=rgb24,geq=r=${dot(36, 27)}:g=${dot(41, 31)}:b=${dot(82, 64)}`,
    `drawtext=${font}:textfile='${txt('title', tl.title)}':fontsize=${tl.titleSize}:fontcolor=0xf2c14e:borderw=5:bordercolor=0x111111:x=(w-text_w)/2:y=${110 - tl.titleSize / 2}`,
    `drawtext=${font}:textfile='${txt('sub', tl.subtitle)}':fontsize=42:fontcolor=0xfaf3e0:x=(w-text_w)/2:y=164`,
    'drawbox=x=54:y=244:w=1000:h=1250:color=0x111111:t=fill', 'drawbox=x=40:y=230:w=1000:h=1250:color=0x111111:t=8',
  ].join(','), '-frames:v', '1', bg]);

  const inputs = ['-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(3), '-i', bg];
  const g = [];
  const S = tl.shots;
  S.forEach((s, k) => {
    inputs.push('-i', jpgs[s.img - 1]);
    const a = Math.max(0, s.t - FADE / 2), b = k + 1 < S.length ? S[k + 1].t + FADE / 2 : D;
    const se = k + 1 < S.length ? S[k + 1].t : D;
    const frames = Math.round((b - a) * FPS);
    // u: eased progress through the shot; z, x, y follow it from `from` to `to`.
    const u = `st(0,clip(((${a.toFixed(3)}+on/${FPS})-${s.t})/${(se - s.t).toFixed(3)},0,1));st(1,ld(0)*ld(0)*(3-2*ld(0)))`;
    const lerp = (j) => `(${s.from[j]}+(${s.to[j] - s.from[j]})*ld(1))`;
    g.push(`[${k + 1}:v]scale=${WIN.w * UP}:${WIN.h * UP}:flags=lanczos,zoompan=z='${u};${lerp(2)}':x='${u};clip(${lerp(0)}*iw-iw/zoom/2,0,iw-iw/zoom)':y='${u};clip(${lerp(1)}*ih-ih/zoom/2,0,ih-ih/zoom)':d=${frames}:s=${WIN.w}x${WIN.h}:fps=${FPS},setsar=1,format=yuv420p[s${k}]`);
  });
  let win = 's0';
  for (let k = 1; k < S.length; k++) { g.push(`[${win}][s${k}]xfade=transition=fade:duration=${FADE}:offset=${(S[k].t - FADE / 2).toFixed(3)}[x${k}]`); win = `x${k}`; }

  const draw = [`[0:v]format=yuv420p[bg]`, `[bg][${win}]overlay=${WIN.x}:${WIN.y}:shortest=1`];
  const on = (a, b) => `:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
  const punchAt = tl.punch[0]?.[0] ?? D;
  // The clock tag shows the time of the clip playing.
  tl.clips.forEach((c, k) => {
    const a = k === 0 ? 0 : c.start - 0.3, b = Math.min(punchAt, k + 1 < tl.clips.length ? tl.clips[k + 1].start - 0.3 : punchAt);
    const label = `RADIO · ${c.clock}`, w = Math.round(label.length * 16 + 40);
    draw.push(`drawbox=x=40:y=1530:w=${w}:h=62:color=0xc84b3c:t=fill${on(a, b)}`, `drawbox=x=40:y=1530:w=${w}:h=62:color=0x111111:t=4${on(a, b)}`,
      `drawtext=${font}:textfile='${txt(`tag${k}`, label)}':fontsize=42:fontcolor=0xfaf3e0:x=62:y=1541${on(a, b)}`);
  });
  tl.captions.forEach(([a, b, text], k) => {
    const lines = wrap(text).slice(0, 3), h = 60 + 84 * lines.length;
    draw.push(`drawbox=x=52:y=1622:w=1000:h=${h}:color=0x111111:t=fill${on(a, b)}`, `drawbox=x=40:y=1610:w=1000:h=${h}:color=0xfaf3e0:t=fill${on(a, b)}`,
      `drawbox=x=40:y=1610:w=1000:h=${h}:color=0x111111:t=6${on(a, b)}`);
    lines.forEach((l, i) => draw.push(`drawtext=${font}:textfile='${txt(`c${k}_${i}`, l)}':fontsize=76:fontcolor=0x111111:x=(w-text_w)/2:y=${1610 + 34 + 84 * i}${on(a, b)}`));
  });
  tl.punch.forEach(([t, text], j) => {
    draw.push(`drawtext=${font}:textfile='${txt(`p${j}`, text)}':fontsize=${fitSize(text, 104, 960)}:fontcolor=${j < 2 ? '0xfaf3e0' : '0xf2c14e'}:borderw=7:bordercolor=0x111111:x=(w-text_w)/2:y='${WIN.y + 70 + j * 130}-40*(1-min(1,(t-${t})/0.35))':alpha='min(1,(t-${t})/0.35)':enable='gte(t,${t})'`);
  });
  draw.push(`drawtext=${font}:textfile='${txt('credit', 'made with Squelch')}':fontsize=64:fontcolor=0xf2c14e:borderw=3:bordercolor=0x111111:x=(w-text_w)/2:y=1655:alpha='min(1,(t-${punchAt})/0.5)':enable='gte(t,${punchAt})'[v]`);
  g.push(draw.join(','));
  const script = resolve(work, 'graph.txt');
  writeFileSync(script, g.join(';\n'));

  const n = S.length + 1;
  const args = ['-y', '-v', 'error', '-progress', 'pipe:1', ...inputs, '-i', track, '-filter_complex_script', script, '-map', '[v]', '-map', `${n}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k', '-t', D.toFixed(3), '-movflags', '+faststart', out];
  await new Promise((done, fail) => {
    const ff = spawn('ffmpeg', args);
    let err = '';
    ff.stdout.on('data', (d) => { const m = /out_time_us=(\d+)/.exec(String(d)); if (m) job.progress('rendering the MP4', Math.min(1, Number(m[1]) / 1e6 / D)); });
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg: ${err.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`))));
  });
}

function buildHtml(tl, jpgs, dims, track) {
  const b64 = (f) => readFileSync(f).toString('base64');
  const imgs = Object.fromEntries(jpgs.map((f, i) => [i + 1, { src: `data:image/jpeg;base64,${b64(f)}`, ...dims[i] }]));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return readFileSync(join(ASSETS, 'comic.html'), 'utf8')
    .replaceAll('__TITLE__', () => esc(tl.title)).replace('__SUB__', () => esc(tl.subtitle))
    .replace('__TL__', () => JSON.stringify(tl).replace(/</g, '\\u003c')).replace('__IMGS__', () => JSON.stringify(imgs))
    .replace('__BANGERS__', () => b64(FONT)).replace('__AUDIO__', () => `data:audio/mpeg;base64,${b64(track)}`);
}

export async function makeComic(job, { script, track, style, subtitle }) {
  const work = join(job.dir, 'work');
  mkdirSync(work, { recursive: true });
  const panels = script.panels.slice(0, 5);
  if (panels.length < 2) throw new Error('The script came back without panels');

  // Panel 1 first; it's the style reference for the rest, which are drawn together.
  job.progress(`drawing panel 1 of ${panels.length}`);
  const pngs = [await panel(job, { style, cast: script.cast, scene: panels[0].scene, k: 1, out: join(job.dir, 'panel1.png') })];
  let drawn = 1;
  pngs.push(...await Promise.all(panels.slice(1).map((p, i) => panel(job, { style, cast: script.cast, scene: p.scene, k: i + 2, ref: pngs[0], out: join(job.dir, `panel${i + 2}.png`) })
    .then((f) => { job.progress(`drawing panels: ${++drawn} of ${panels.length}`); return f; }))));
  const jpgs = pngs.map((_, i) => join(work, `crop${i + 1}.jpg`));
  await Promise.all(pngs.map((p, i) => crop(p, jpgs[i])));
  const dims = await Promise.all(jpgs.map(async (f) => {
    const [w, h] = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f])).stdout.trim().split(',').map(Number);
    return { w, h };
  }));

  const title = scrub(script.title).toUpperCase();
  const punchAt = +(track.end + 0.2).toFixed(2);
  const tl = {
    duration: track.total, title, titleSize: titleSize(title), subtitle, fade: FADE,
    clips: track.clips.map((c) => ({ start: c.start, clock: c.clock })),
    shots: planShots(panels, track.clips, track.total),
    captions: timeCaptions(track.clips, track.clips.map((_, i) => script.captions.find((c) => c.clip === i)?.lines.map(scrub))).map(([a, b, t]) => [a, Math.min(b, punchAt), t]),
    punch: script.punch.slice(0, 3).map((p, j) => [+(punchAt + 0.8 * j).toFixed(2), scrub(p).toUpperCase()]),
  };
  while (tl.punch.length < 3) tl.punch.push([+(punchAt + 0.8 * tl.punch.length).toFixed(2), '']);
  writeFileSync(join(job.dir, 'timeline.json'), JSON.stringify(tl, null, 1));

  job.progress('writing the web page');
  writeFileSync(join(job.dir, 'comic.html'), buildHtml(tl, jpgs, dims, track.file));
  job.progress('rendering the MP4', 0);
  const t0 = Date.now();
  await renderMp4(job, tl, jpgs, track.file, join(job.dir, 'comic.mp4'));
  return { render_s: (Date.now() - t0) / 1000, duration_s: tl.duration };
}
