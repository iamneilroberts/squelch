// Studio's text steps (the script, the cartoon's director) run on one of two providers: OpenRouter (metered,
// counted against STUDIO_DAILY_USD) or the local Claude Code CLI on the owner's subscription login ($0 here;
// its notional cost is kept for comparison). STUDIO_LLM picks the default; a job can override it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chatJson } from '../ai/llm.mjs';
import { span, priceOf } from '../meter.mjs';

export const PROVIDERS = { openrouter: 'OpenRouter', claude: 'Claude subscription' };
export const defaultProvider = () => (PROVIDERS[process.env.STUDIO_LLM] ? process.env.STUDIO_LLM : 'openrouter');
export const pickProvider = (p) => (PROVIDERS[p] ? p : defaultProvider());

const claudeBin = () => process.env.STUDIO_CLAUDE_BIN || [join(homedir(), '.local', 'bin', 'claude')].find((f) => existsSync(f)) || 'claude';
const alias = (model) => (/opus/.test(model) ? 'opus' : /haiku/.test(model) ? 'haiku' : 'sonnet');
export const subscriptionModel = (model) => `claude-${alias(model)} (subscription)`;

// The JSON-schema subset the Studio's schemas use: types, enums, required, additionalProperties: false, items.
export function schemaErrors(x, s, path = '$') {
  const type = Array.isArray(x) ? 'array' : x === null ? 'null' : Number.isInteger(x) ? 'integer' : typeof x;
  if (s.type && !(s.type === type || (s.type === 'number' && type === 'integer'))) return [`${path}: expected ${s.type}, got ${type}`];
  if (s.enum && !s.enum.includes(x)) return [`${path}: ${JSON.stringify(x)} is not one of the allowed values`];
  const errs = [];
  if (type === 'array' && s.items) x.forEach((v, i) => errs.push(...schemaErrors(v, s.items, `${path}[${i}]`)));
  if (type === 'object') {
    for (const k of s.required || []) if (!(k in x)) errs.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(x)) {
      if (s.properties?.[k]) errs.push(...schemaErrors(v, s.properties[k], `${path}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  }
  return errs;
}

// One headless CLI run: no tools, no settings, no MCP, no session file, and a clean environment, so it can only
// use the subscription login in ~/.claude (never an API key from this process's environment).
function runClaude({ model, system, user, schema, timeoutMs }) {
  const args = ['-p', '--model', alias(model), '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--disable-slash-commands', '--tools', '', '--max-turns', '4', '--system-prompt', system];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const env = { HOME: homedir(), PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', USER: process.env.USER || 'neil' };
  return new Promise((resolve, reject) => {
    const p = spawn(claudeBin(), args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`claude CLI timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude CLI: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      let r;
      try { r = JSON.parse(out); } catch { return reject(new Error(`claude CLI exited ${code}: ${(err || out).trim().slice(-300)}`)); }
      if (r.is_error || r.subtype !== 'success') return reject(new Error(`claude CLI: ${String(r.result || r.subtype || 'error').slice(0, 300)}`));
      resolve(r);
    });
    p.stdin.end(user);
  });
}
const parseJson = (t) => JSON.parse(String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));

// Asks for JSON matching `schema`. Returns { data, provider, ms }. OpenRouter calls go through job.call (cap
// check, metered); subscription calls through job.free ($0, with the CLI's notional cost and timing).
export async function studioJson(job, { provider, purpose, model, system, user, schema, name, maxTokens = 8000, outTok = 2500, timeoutMs = 300e3 }) {
  const t0 = Date.now();
  if (provider !== 'claude') {
    const r = await job.call(purpose, model, { inTok: (system.length + user.length) / 3.5, outTok },
      () => chatJson({ model, system, user, schema, name, maxTokens, purpose }),
      (x) => x.costUsd ?? priceOf(model.split('/')[1].replaceAll('.', '-'), x.inTok, x.outTok)); // direct Anthropic calls report no cost
    return { data: r.data, provider: 'openrouter', ms: Date.now() - t0 };
  }
  let ask = user;
  for (let attempt = 0; ; attempt++) {
    const r = await job.free(purpose, subscriptionModel(model), () => span({ kind: 'llm', purpose, provider: 'claude-subscription', model: subscriptionModel(model) },
      () => runClaude({ model, system, user: ask, schema, timeoutMs }),
      (x) => ({ in_tok: (x.usage?.input_tokens || 0) + (x.usage?.cache_read_input_tokens || 0) + (x.usage?.cache_creation_input_tokens || 0), out_tok: x.usage?.output_tokens ?? null, cost: 0 })),
    (x) => ({ notional_usd: x.total_cost_usd ?? null, ms: x.duration_ms ?? null }));
    let data = r.structured_output, errs;
    try { data ??= parseJson(r.result); errs = schemaErrors(data, schema); } catch (e) { errs = [`not JSON: ${e.message}`]; }
    if (!errs.length) return { data, provider: 'claude', ms: Date.now() - t0 };
    if (attempt) throw new Error(`The ${name} didn't match its schema: ${errs.slice(0, 3).join('; ')}`);
    ask = `${user}\n\nYour previous reply didn't match the required JSON schema:\n- ${errs.slice(0, 12).join('\n- ')}\nReply again with the whole JSON, fixed.`;
  }
}
