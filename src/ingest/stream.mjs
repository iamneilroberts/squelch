// Pulls a continuous scanner stream with ffmpeg, cuts it into fixed-length WAV segments,
// then squeezes out the silence so only actual radio traffic gets transcribed.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, renameSync } from 'node:fs';
import { speechRegions } from './vad.mjs';
import { noteSquelchDrop } from '../meter.mjs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 45);
const MIN_SPEECH_SECONDS = 1.5;
const MIN_ADAPTIVE_SPEECH = Number(process.env.ADAPTIVE_SQUELCH_MIN_S || 1.0);

export function startStream(source, { onClip, onStatus }) {
  const dir = join('data', 'segments', source.id);
  mkdirSync(dir, { recursive: true });
  let child = null;
  let stopped = false;
  let busy = false;
  let backoff = 5;

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

  // A segment is finished once a newer one exists. Process them oldest-first.
  const poll = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
      if (files.length) { backoff = 5; onStatus({ state: 'receiving', lastSegment: new Date().toISOString() }); }
      for (const f of files.slice(0, -1)) {
        const wav = join(dir, f);
        try {
          const clip = await squelch(wav, source);
          if (clip) await onClip({ ...clip, at: stampToIso(f) });
        } catch (e) {
          onStatus({ state: 'receiving', error: e.message });
        } finally {
          rmSync(wav, { force: true });
        }
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

// Strip silence gaps; skip the segment if less than MIN_SPEECH_SECONDS of audio is left.
async function squelch(wav, source) {
  if (statSync(wav).size < 2000) return null;
  const threshold = source.squelchDb ?? -42;
  const name = `${source.id}-${Date.now()}.mp3`;
  const out = join('data', 'audio', name);
  mkdirSync(join('data', 'audio'), { recursive: true });
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', wav,
    '-af', `silenceremove=start_periods=1:start_threshold=${threshold}dB:stop_periods=-1:stop_duration=0.7:stop_threshold=${threshold}dB`,
    ...CLIP_MP3, out]);
  // An all-silent segment leaves an empty file that ffprobe can't read — that's just "no speech".
  const duration = statSync(out, { throwIfNoEntry: false })?.size > 1000 ? await probeDuration(out).catch(() => 0) : 0;
  if (duration < MIN_SPEECH_SECONDS) { rmSync(out, { force: true }); return null; }
  if (process.env.ADAPTIVE_SQUELCH === '0') return { file: out, audio: name, duration };

  // Adaptive squelch: on feeds with a constant hum or open carrier, silenceremove keeps everything.
  // Keep only what rises above this clip's own noise floor; drop the clip if that's under 1 s.
  const { regions, speech } = await speechRegions(out);
  if (speech < MIN_ADAPTIVE_SPEECH) {
    rmSync(out, { force: true });
    noteSquelchDrop(source.id, duration);
    return null;
  }
  if (speech < duration * 0.85 && regions.length <= 60) {
    const trimmed = out.replace(/\.mp3$/, '.t.mp3');
    const keep = regions.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+');
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', out, '-af', `aselect='${keep}',asetpts=N/SR/TB`, ...CLIP_MP3, trimmed]);
    rmSync(out, { force: true });
    renameSync(trimmed, out);
    return { file: out, audio: name, duration: speech };
  }
  return { file: out, audio: name, duration };
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
