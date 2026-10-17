// Speech-to-text. Default: an audio-capable chat model on OpenRouter (TRANSCRIBE_MODEL).
// Alternative: any Whisper-style /audio/transcriptions endpoint (Groq, OpenAI, local whisper.cpp)
// by setting TRANSCRIBE_BASE_URL.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { openRouter } from './llm.mjs';
import { span } from '../meter.mjs';

// Bench 2026-10-17, low reasoning: 6% WER / 93% key terms at $0.16 per audio hour (default reasoning: 3% / 97%, but
// ~10x the cost on live clips and close to max_tokens). mimo-v2.6-flash (4% WER on 10-16) went deaf on OpenRouter on
// 10-17: 100% WER, "no audio was provided" on real traffic.
export const DEFAULT_TRANSCRIBE_MODEL = 'google/gemini-3.8-flash';

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

// Returns { text, costUsd }. `purpose` names the metered span ('transcribe-ab' for the A/B second opinion).
export async function transcribe(file, model = process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL, vocab = DEFAULT_VOCAB, purpose = 'transcribe') {
  const r = process.env.TRANSCRIBE_BASE_URL ? await viaWhisper(file, vocab, purpose) : await viaOpenRouter(file, model, vocab, purpose);
  const text = r.text.replace(/\s+/g, ' ').trim();
  return { ...r, text: HALLUCINATIONS.test(text) || PLACEHOLDER.test(text) || META.test(text) || echoesPrompt(text, vocab) ? '' : text };
}

// Reasoning models sometimes think until max_tokens and reply with nothing; that clip is retried once, not dropped.
async function viaOpenRouter(file, model, vocab, purpose) {
  const format = extname(file).slice(1) || 'mp3';
  const data = (await readFile(file)).toString('base64');
  for (let attempt = 0; ; attempt++) {
    const j = await openRouter({
      model,
      max_tokens: 2000,
      reasoning: { effort: 'low' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt(vocab) },
        { type: 'input_audio', input_audio: { data, format } },
      ] }],
    }, { purpose });
    const choice = j.choices?.[0];
    if (choice?.finish_reason !== 'length') return { text: choice?.message?.content ?? '', costUsd: j.usage?.cost ?? null };
    if (attempt) throw new Error('transcript cut off (max_tokens) twice');
  }
}

async function viaWhisper(file, vocab, purpose) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: extname(file) === '.wav' ? 'audio/wav' : 'audio/mpeg' }), basename(file));
  form.append('model', process.env.TRANSCRIBE_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('prompt', [UNITS, vocab].filter(Boolean).join(', '));
  const key = process.env.TRANSCRIBE_API_KEY;
  const model = process.env.TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
  return span({ kind: 'stt', purpose, provider: new URL(process.env.TRANSCRIBE_BASE_URL).host, model }, async () => {
    const res = await fetch(`${process.env.TRANSCRIBE_BASE_URL}/audio/transcriptions`, {
      method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form,
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { text: (await res.json()).text || '', costUsd: null };
  });
}
