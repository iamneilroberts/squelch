// Speech-to-text. Default: an audio-capable chat model on OpenRouter (TRANSCRIBE_MODEL).
// Alternative: any Whisper-style /audio/transcriptions endpoint (Groq, OpenAI, local whisper.cpp)
// by setting TRANSCRIBE_BASE_URL.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { openRouter } from './llm.mjs';
import { span } from '../meter.mjs';

// Bench 2026-10-16: 4% WER / 95% key terms at $0.02 per audio hour. gemini-3.8-flash is the accuracy pick (2% WER, $0.52/h).
export const DEFAULT_TRANSCRIBE_MODEL = 'xiaomi/mimo-v2.6-flash';

// Local vocabulary (per region, from sources.json) nudges the model toward street names and callsigns.
const UNITS = 'Engine, Ladder, Rescue, Medic, Battalion, Squad, Station, Sheriff, Deputy, Trooper';
export const DEFAULT_VOCAB = ''; // each region supplies its own place names (sources.json → regions[].vocab)

// No sample sentences here: on hiss-only clips, models repeat any example they're shown as if it were heard.
const prompt = (vocab) => `Transcribe this scanner radio audio verbatim. Output only the words actually spoken, as plain text on one line, with numbers as digits.
Spelling reference for names that may occur (do not output this list): ${[UNITS, vocab].filter(Boolean).join(', ')}.
If there is no intelligible speech, output nothing at all.`;

// A transcript that is mostly words from the prompt itself is an echo, not radio traffic.
function echoesPrompt(text, vocab) {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length < 3) return false;
  const promptWords = new Set(prompt(vocab).toLowerCase().match(/[a-z0-9]+/g));
  return words.filter((w) => promptWords.has(w)).length / words.length > 0.8;
}

// Models invent these on hiss and dead air.
const HALLUCINATIONS = /^(thank you|thanks for watching|you|bye|\.|subtitles by.*|please subscribe.*|((there is|there's|this (audio|clip) (has|contains)) )?no (intelligible |discernible |audible |clear )?(speech|words|audio|voice).*|\[?(silence|inaudible|static|no audio)\]?)[.!]?$/i;

// Placeholders some models print instead of an empty reply: "<empty>", "(No output)", "[output nothing]".
const PLACEHOLDER = /^[(<[{"']*\s*(empty|blank|nothing|no output|output nothing|no transcript(ion)?|none|n\/a)\s*[)>\]}"']*\.?$/i;

// Short sentences about the clip rather than from it ("The audio contains no intelligible speech.").
const META = /^(?=.{0,220}$).*\b(no (intelligible|discernible|audible|clear|recognizable) (speech|words|dialogue)|unable to transcribe|cannot be transcribed|the (audio|clip|recording) (appears|contains|is|consists|seems))\b/i;

export const transcriberReady = () => Boolean(process.env.TRANSCRIBE_BASE_URL || process.env.OPENROUTER_API_KEY);

// Returns { text, costUsd }.
export async function transcribe(file, model = process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL, vocab = DEFAULT_VOCAB) {
  const r = process.env.TRANSCRIBE_BASE_URL ? await viaWhisper(file, vocab) : await viaOpenRouter(file, model, vocab);
  const text = r.text.replace(/\s+/g, ' ').trim();
  return { ...r, text: HALLUCINATIONS.test(text) || PLACEHOLDER.test(text) || META.test(text) || echoesPrompt(text, vocab) ? '' : text };
}

async function viaOpenRouter(file, model, vocab) {
  const format = extname(file).slice(1) || 'mp3';
  const j = await openRouter({
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt(vocab) },
      { type: 'input_audio', input_audio: { data: (await readFile(file)).toString('base64'), format } },
    ] }],
  }, { purpose: 'transcribe' });
  return { text: j.choices?.[0]?.message?.content ?? '', costUsd: j.usage?.cost ?? null };
}

async function viaWhisper(file, vocab) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: 'audio/mpeg' }), basename(file));
  form.append('model', process.env.TRANSCRIBE_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('prompt', [UNITS, vocab].filter(Boolean).join(', '));
  const key = process.env.TRANSCRIBE_API_KEY;
  const model = process.env.TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
  return span({ kind: 'stt', purpose: 'transcribe', provider: new URL(process.env.TRANSCRIBE_BASE_URL).host, model }, async () => {
    const res = await fetch(`${process.env.TRANSCRIBE_BASE_URL}/audio/transcriptions`, {
      method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form,
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { text: (await res.json()).text || '', costUsd: null };
  });
}
