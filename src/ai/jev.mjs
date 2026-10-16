// TypeSafe Jev (System One) through OpenRouter's passthrough — typed yes/no, choice and score
// judgments in ~0.5 s for ~$0.00002. Same contract as voygent-lite's callSystemOne: a deadline,
// one retry on 429/5xx, and null on any failure so callers keep their existing path.
import { span } from '../meter.mjs';

const URL_ = 'https://openrouter.ai/api/v1/systemone';
export const JEV_MODEL = process.env.JEV_MODEL || '~typesafe/jev-latest';

export async function systemOne(state, questions, { purpose = 'jev', deadlineMs = 2500 } = {}) {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    return await span({ kind: 'jev', purpose, provider: 'openrouter', model: JEV_MODEL }, () => post(state, questions, deadlineMs),
      (j) => ({ model: j.model, in_tok: j.usage?.input_tokens, out_tok: j.usage?.output_tokens, cost: j.usage?.cost ?? null }));
  } catch {
    return null;
  }
}

async function post(state, questions, deadlineMs) {
  const until = Date.now() + deadlineMs;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(Math.max(200, until - Date.now())),
    });
    if (res.ok) return res.json();
    if (!(res.status === 429 || res.status >= 500) || attempt >= 1 || Date.now() > until - 500) {
      throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// The transcript gate: is this real radio speech, and is it worth a map entry?
// Shadow mode only for now — answers are stored next to the LLM's verdict for comparison.
export const GATE_QUESTIONS = {
  speech: {
    type: 'noul',
    instructions: 'Is `transcript` words actually spoken over the radio channel, as opposed to a remark about the recording or a list of names?',
    criteria: {
      true: 'Radio traffic as it was heard, even if fragmentary or garbled: dispatch, unit replies, numbers, addresses, chatter.',
      false: 'A comment describing the audio (silent, static, unintelligible, cannot transcribe), an apology, or a bare comma-separated list of street, town or unit names with no sentence.',
    },
  },
  newsworthy: {
    type: 'noul',
    instructions: 'Does `transcript` report a real incident or hazard that someone living in `area` would want to see on a public incident map?',
    criteria: {
      true: 'A fire, crash, medical call, rescue, police call or crime, hazard such as a downed line or road blockage, hazmat, aircraft or vessel in trouble, or weather damage — even if only partly described.',
      false: 'Routine radio traffic: unit status, en route or on scene with no new detail, radio checks, test tones, normal air traffic clearances, routine weather or marine forecast readouts, idle chatter, or unintelligible fragments.',
    },
  },
};

export async function gate({ transcript, source }) {
  const r = await systemOne(
    { feed: source.name, area: source.area || source.region, band: source.band, transcript: transcript.slice(0, 2000) },
    GATE_QUESTIONS, { purpose: 'gate' });
  const p = (k) => (r?.answers?.[k]?.type === 'noul' && Number.isFinite(r.answers[k].noul) ? r.answers[k].noul : null);
  return r ? { speech: p('speech'), newsworthy: p('newsworthy') } : null;
}
