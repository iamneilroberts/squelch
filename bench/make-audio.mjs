// Builds bench/fixtures/audio/*.mp3 from speech.json: TTS (gpt-audio-mini via OpenRouter),
// then a radio-channel chain — 300–3000 Hz bandpass, compression, 8 kHz resample, pink noise, bit crush.
// Run once; the clips are committed so bench runs are reproducible.  node --env-file=.env bench/make-audio.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { wer } from './score.mjs';

const DIR = 'bench/fixtures/audio';
mkdirSync(DIR, { recursive: true });
const scripts = JSON.parse(readFileSync('bench/fixtures/speech.json', 'utf8'));
const VOICES = { dispatcher: 'onyx', 'field unit': 'echo', ATC: 'alloy', 'coast guard': 'ash', rail: 'ballad' };

async function tts(text, voice) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-audio-mini', stream: true, modalities: ['text', 'audio'],
      audio: { voice, format: 'pcm16' },
      messages: [
        { role: 'system', content: 'You are a text-to-speech engine. Read the user text aloud exactly, word for word, briskly, like radio traffic. Say nothing else.' },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`tts ${res.status} ${await res.text()}`);
  const chunks = []; let buf = ''; let spoken = '';
  for await (const part of res.body) {
    buf += Buffer.from(part).toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const a = JSON.parse(line.slice(5)).choices?.[0]?.delta?.audio;
        if (a?.data) chunks.push(Buffer.from(a.data, 'base64'));
        if (a?.transcript) spoken += a.transcript;
      } catch { /* keep-alive comments */ }
    }
  }
  return { pcm: Buffer.concat(chunks), spoken };
}

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// The reference transcript is what the TTS model reports it actually said (it sometimes paraphrases).
const REFS = join(DIR, 'refs.json');
const refs = existsSync(REFS) ? JSON.parse(readFileSync(REFS, 'utf8')) : {};

for (const s of scripts) {
  const out = join(DIR, `${s.id}.mp3`);
  if (existsSync(out) && refs[s.id]) continue;
  let clip;
  for (let attempt = 0; attempt < 3; attempt++) {
    clip = await tts(s.text, VOICES[s.style] || 'onyx');
    if (wer(s.text, clip.spoken) <= 0.1) break; // prefer a take that follows the script
    console.warn(`${s.id}: TTS deviated (attempt ${attempt + 1}): ${clip.spoken}`);
  }
  refs[s.id] = clip.spoken;
  writeFileSync(REFS, JSON.stringify(refs, null, 2) + '\n');
  const raw = join(DIR, `${s.id}.raw.wav`);
  writeFileSync(raw, wav(clip.pcm));
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', raw,
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.035:sample_rate=24000',
    '-filter_complex',
    '[0:a]highpass=f=300,lowpass=f=3000,acompressor=threshold=-20dB:ratio=6:attack=5:release=80,aresample=8000,aresample=16000[v];' +
    '[1:a]aresample=16000,highpass=f=300,lowpass=f=3400[n];' +
    '[v][n]amix=inputs=2:duration=first:weights=1 0.7:normalize=0,acrusher=bits=9:mode=log:mix=0.25',
    '-ac', '1', '-b:a', '32k', out]);
  rmSync(raw);
  console.log(s.id, 'ok', `tts-wer=${wer(s.text, clip.spoken).toFixed(2)}`);
}
