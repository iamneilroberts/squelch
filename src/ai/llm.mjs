// One entry point for every LLM call in the app (triage, digest, bench).
// Models use OpenRouter ids ("openai/gpt-6-luna", "anthropic/claude-opus-5.5", ...).
// Anthropic models go direct through the Anthropic SDK when ANTHROPIC_API_KEY is set,
// otherwise everything routes through OpenRouter.
import Anthropic from '@anthropic-ai/sdk';
import { span, priceOf } from '../meter.mjs';

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
let anthropic = null;

export const llmReady = () => Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);

const direct = (model) => model.startsWith('anthropic/') && process.env.ANTHROPIC_API_KEY;

// Returns { data, costUsd, inTok, outTok, ms }. Throws on transport errors or unparseable output.
export async function chatJson({ model, system, user, schema, name = 'result', maxTokens = 8000, purpose = name }) {
  const t0 = Date.now();
  const r = direct(model)
    ? await viaAnthropic({ model, system, user, schema, maxTokens, purpose })
    : await viaOpenRouter({ model, system, user, schema, name, maxTokens, purpose });
  return { ...r, data: parseJson(r.text), ms: Date.now() - t0 };
}

async function viaAnthropic({ model, system, user, schema, maxTokens, purpose }) {
  anthropic ??= new Anthropic();
  const id = model.slice('anthropic/'.length).replaceAll('.', '-');
  const res = await span({ kind: 'llm', purpose, provider: 'anthropic', model: id }, () => anthropic.beta.messages.create({
    model: id,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  }), (r) => ({ model: r.model, in_tok: r.usage.input_tokens, out_tok: r.usage.output_tokens, cost: priceOf(r.model, r.usage.input_tokens, r.usage.output_tokens) }));
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  return {
    text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    inTok: res.usage.input_tokens, outTok: res.usage.output_tokens, costUsd: null,
  };
}

// Every OpenRouter request is one metered span; audio input counts as speech-to-text.
export function openRouter(body, { retries = 2, purpose = 'llm' } = {}) {
  const kind = JSON.stringify(body.messages ?? []).includes('"input_audio"') ? 'stt' : 'llm';
  return span({ kind, purpose, provider: 'openrouter', model: body.model }, () => postOpenRouter(OR_URL, body, retries),
    (j) => ({ model: j.model || body.model, in_tok: j.usage?.prompt_tokens ?? j.usage?.input_tokens, out_tok: j.usage?.completion_tokens ?? j.usage?.output_tokens, cost: j.usage?.cost ?? null }));
}

export async function postOpenRouter(url, body, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost/port-city-monitor',
        'X-Title': 'Squelch',
      },
      body: JSON.stringify({ usage: { include: true }, ...body }),
      signal: AbortSignal.timeout(180e3),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && !j.error) return j;
    const retryable = res.status === 429 || res.status >= 500 || j.error?.code >= 500;
    if (!retryable || attempt >= retries) throw new Error(`openrouter ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

async function viaOpenRouter({ model, system, user, schema, name, maxTokens, purpose }) {
  const j = await openRouter({
    model,
    max_tokens: maxTokens,
    reasoning: { effort: 'low' },
    provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }, { purpose });
  const choice = j.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('truncated (max_tokens)');
  return { text: choice?.message?.content ?? '', inTok: j.usage?.prompt_tokens, outTok: j.usage?.completion_tokens, costUsd: j.usage?.cost ?? null };
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(t);
}
