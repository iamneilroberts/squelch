// Studio money: model choices, per-unit prices, today's spend and the STUDIO_DAILY_USD cap.
import { db } from '../db.mjs';
import { dayBounds, localDate } from '../digest.mjs';
import { DEFAULT_TRIAGE_MODEL } from '../ai/triage.mjs';

export const MODELS = {
  humor: () => process.env.STUDIO_HUMOR_MODEL || process.env.TRIAGE_MODEL || DEFAULT_TRIAGE_MODEL,
  script: () => process.env.STUDIO_SCRIPT_MODEL || 'anthropic/claude-sonnet-5.5',
  image: () => process.env.STUDIO_IMAGE_MODEL || 'google/gemini-2.5-flash-image',
  cartoon: () => process.env.STUDIO_CARTOON_MODEL || 'anthropic/claude-sonnet-5.5',
};
export const dailyCap = () => Number(process.env.STUDIO_DAILY_USD || 2);

// $ per token from OpenRouter's model list, read once a day. These are its prices on 2026-10-17,
// used when the list can't be reached or doesn't have the model.
const FALLBACK = {
  'anthropic/claude-sonnet-5.5': { prompt: 2e-6, completion: 1e-5 },
  'google/gemini-2.5-flash-image': { prompt: 3e-7, completion: 2.5e-6, image_output: 3e-5 },
  'openai/gpt-6-luna': { prompt: 1e-7, completion: 5e-7 },
};
let list = null; // { at, prices: Map }
async function prices() {
  if (list && Date.now() - list.at < 864e5) return list.prices;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10e3) });
    const j = await r.json();
    const map = new Map(j.data.map((m) => [m.id, Object.fromEntries(Object.entries(m.pricing || {}).map(([k, v]) => [k, Number(v)]))]));
    list = { at: Date.now(), prices: map };
  } catch { list = { at: Date.now() - 864e5 + 600e3, prices: new Map() }; } // retry in 10 min
  return list.prices;
}

// Estimated $ for one call: tokens in and out, and generated-image tokens (1,290 per Gemini image).
export async function estimate(model, { inTok = 0, outTok = 0, imageTok = 0 }) {
  const p = (await prices()).get(model) || FALLBACK[model] || FALLBACK['anthropic/claude-sonnet-5.5'];
  return inTok * (p.prompt || 0) + outTok * (p.completion || 0) + imageTok * (p.image_output || p.completion || 0);
}

// Everything the Studio spent today (station time), from the metered spans.
export const spentToday = () => db.prepare(`SELECT COALESCE(SUM(cost), 0) AS c FROM spans WHERE purpose LIKE 'studio:%' AND at >= ?`)
  .get(dayBounds(localDate())[0]).c;

export class CapError extends Error {}
// Throws before a paid call that could take today's Studio spend past the cap.
export function checkCap(next) {
  const spent = spentToday();
  if (spent + next > dailyCap()) throw new CapError(`Daily Studio cap: $${spent.toFixed(3)} spent today, this needs about $${next.toFixed(3)}, and STUDIO_DAILY_USD is $${dailyCap().toFixed(2)}`);
}
