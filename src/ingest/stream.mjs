// Pulls a continuous scanner stream with ffmpeg, cuts it into fixed-length WAV segments,
// then squeezes out the silence so only actual radio traffic gets transcribed.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, renameSync } from 'node:fs';
import { speechRegions } from './vad.mjs';
import { noteSquelchDrop, noteStitch } from '../meter.mjs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 45);
const MIN_SPEECH_SECONDS = 1.5;
const MIN_ADAPTIVE_SPEECH = Number(process.env.ADAPTIVE_SQUELCH_MIN_S || 1.0);
// STITCH=1: a segment that ends mid-transmission waits for the next one and the two become one clip.
const STITCH = process.env.STITCH === '1';

export function startStream(source, { onClip, onStatus }) {
  const dir = join('data', 'segments', source.id);
  mkdirSync(dir, { recursive: true });
  let child = null;
  let stopped = false;
  let busy = false;
  let backoff = 5;
  let newest = null; // the latest segment seen: only a new one means audio is arriving (a leftover file doesn't)
  let held = null; // STITCH: { f, since } — a finished segment still talking at its end, waiting for its successor

  // audio.broadcastify.com requires an account; send it as HTTP Basic auth when configured.
  const { BROADCASTIFY_LOGIN: user, BROADCASTIFY_PASSWORD: pass } = process.env;
  const auth = user && pass && new URL(source.streamUrl).host === 'audio.broadcastify.com'
    ? ['-headers', `Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}\r\n`]
    : [];

  const launch = () => {
    onStatus({ state: 'tuning' });
    child = spawn('ffmpeg', [
      '-nostdin', '-loglevel', 'error',
      '-user_agent', 'Mozilla/5.0 PortCityMonitor',
      ...auth,
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30',
      '-i', source.streamUrl,
      '-ac', '1', '-ar', '16000',
      '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1', '-strftime', '1',
      join(dir, '%Y%m%dT%H%M%S.wav'),
    ]);
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    child.on('exit', (code) => {
      if (stopped) return;
      onStatus({ state: 'offline', error: err.trim().split('\n').pop() || `ffmpeg exited ${code}` });
      setTimeout(launch, backoff * 1000);
      backoff = Math.min(backoff * 2, 600);
    });
  };

  // One clip from one segment, or from a held segment joined with the next; the segment files are deleted after.
  const handle = async (names) => {
    let clip = null;
    try {
      clip = await squelch(names.map((f) => join(dir, f)), source);
      if (clip) await onClip({ ...clip, at: stampToIso(names[0]) });
    } catch (e) {
      onStatus({ state: 'receiving', error: e.message });
    } finally {
      for (const f of names) rmSync(join(dir, f), { force: true });
      if (clip) rmSync(clip.wav, { force: true });
    }
  };

  // A segment is finished once a newer one exists. Process them oldest-first.
  const poll = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.wav') && f !== held?.f).sort();
      if (files.length && files.at(-1) !== newest) { newest = files.at(-1); backoff = 5; onStatus({ state: 'receiving', lastSegment: new Date().toISOString() }); }
      const threshold = source.squelchDb ?? -42;
      for (const f of files.slice(0, -1)) {
        if (held) {
          // At most one hold: the joined pair goes out even if it is still talking at its end.
          const h = held.f;
          held = null;
          noteStitch(source.id, await activeAtEnd(join(dir, f), threshold) ? 'still-cut' : 'joined');
          await handle([h, f]);
        } else if (STITCH && await activeAtEnd(join(dir, f), threshold)) {
          held = { f, since: Date.now() };
        } else await handle([f]);
      }
      // No successor within two segment lengths (the stream stalled or stopped): the held segment goes out alone.
      if (held && Date.now() - held.since > 2 * SEGMENT_SECONDS * 1000) {
        const h = held.f;
        held = null;
        noteStitch(source.id, 'stalled');
        await handle([h]);
      }
    } finally {
      busy = false;
    }
  }, 5000);

  launch();
  return () => { stopped = true; clearInterval(poll); child?.kill(); };
}

// Clips are written without the bit reservoir or Xing/ID3 headers, so the scan stream (src/scan.mjs) can splice
// their frames as they are.
const CLIP_MP3 = ['-ac', '1', '-b:a', '32k', '-reservoir', '0', '-write_xing', '0', '-id3v2_version', '0'];

// Strip silence gaps; skip the segment if less than MIN_SPEECH_SECONDS of audio is left. The whole chain stays WAV and
// the stored MP3 is encoded once at the end; the final WAV is returned too (`wav`), for lossless STT, and the caller deletes it.
async function squelch(wavs, source) {
  if (wavs.reduce((n, w) => n + statSync(w).size, 0) < 2000) return null;
  const threshold = source.squelchDb ?? -42;
  const name = `${source.id}-${Date.now()}.mp3`;
  const out = join('data', 'audio', name);
  const raw = out.replace(/\.mp3$/, '.wav');
  const trimmed = out.replace(/\.mp3$/, '.t.wav');
  mkdirSync(join('data', 'audio'), { recursive: true });
  let clip = null;
  try {
    const strip = `silenceremove=start_periods=1:start_threshold=${threshold}dB:stop_periods=-1:stop_duration=0.7:stop_threshold=${threshold}dB`;
    // A held segment and its successor are joined losslessly (PCM concat) before the silence is stripped.
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...wavs.flatMap((w) => ['-i', w]),
      ...(wavs.length > 1 ? ['-filter_complex', `${wavs.map((_, i) => `[${i}:a]`).join('')}concat=n=${wavs.length}:v=0:a=1,${strip}`] : ['-af', strip]), raw]);
    // An all-silent segment leaves a header-only file that ffprobe can't read — that's just "no speech".
    const duration = statSync(raw, { throwIfNoEntry: false })?.size > 1000 ? await probeDuration(raw).catch(() => 0) : 0;
    if (duration < MIN_SPEECH_SECONDS) return null;
    let kept = duration;
    if (process.env.ADAPTIVE_SQUELCH !== '0') {
      // Adaptive squelch: on feeds with a constant hum or open carrier, silenceremove keeps everything.
      // Keep only what rises above this clip's own noise floor; drop the clip if that's under 1 s.
      const { regions, speech } = await speechRegions(raw);
      if (speech < MIN_ADAPTIVE_SPEECH) {
        noteSquelchDrop(source.id, duration);
        return null;
      }
      if (speech < duration * 0.85 && regions.length <= 60) {
        const keep = regions.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+');
        await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', raw, '-af', `aselect='${keep}',asetpts=N/SR/TB`, trimmed]);
        renameSync(trimmed, raw);
        kept = speech;
      }
    }
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', raw, ...CLIP_MP3, out]);
    clip = { file: out, audio: name, duration: kept, wav: raw };
    return clip;
  } finally {
    if (!clip) for (const f of [raw, trimmed, out]) rmSync(f, { force: true });
  }
}

// STITCH: is a transmission still going at the segment's very end? The last 0.4 s must be louder (RMS) than the
// feed's squelch threshold, and the adaptive squelch must hear speech running into the end, so a constant hum or
// open carrier doesn't hold every segment.
async function activeAtEnd(wav, threshold) {
  try {
    const { stderr } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-sseof', '-0.4', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']);
    if (!(Number(stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]) > threshold)) return false;
    if (process.env.ADAPTIVE_SQUELCH === '0') return true;
    const { regions, duration } = await speechRegions(wav);
    return regions.at(-1)?.[1] >= duration - 0.4;
  } catch { return false; }
}

async function probeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim()) || 0;
}

// Segment names carry local wall-clock time from ffmpeg's strftime.
function stampToIso(f) {
  const m = f.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : new Date().toISOString();
}
