// Judges the STT A/B pairs (STT_AB_RATE, table stt_ab): for each pair with different transcripts and a kept WAV,
// a stronger model listens to the lossless clip and says which transcript is more accurate. Pairs with identical
// transcripts count as ties without a call. Verdicts are stored, so a re-run only judges new pairs.
//   node --env-file-if-exists=.env scripts/stt-ab-judge.mjs [--limit 150] [--dry-run]   (cwd = the install dir)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/db.mjs';
import { openRouter } from '../src/ai/llm.mjs';

const JUDGE = 'google/gemini-3.5-flash';
const EST_PER_ROW = 0.01; // $ per judged pair until this install has its own average
const arg = (k) => process.argv.indexOf(k);
const limit = arg('--limit') > 0 ? Number(process.argv[arg('--limit') + 1]) : 150;
const dryRun = arg('--dry-run') > 0;

const rows = db.prepare('SELECT * FROM stt_ab WHERE verdict IS NULL ORDER BY id').all();
const same = rows.filter((r) => (r.mp3_text ?? '') === (r.wav_text ?? ''));
const todo = rows.filter((r) => !same.includes(r) && r.wav_file && existsSync(join('data', 'ab', r.wav_file))).slice(0, limit);
const prior = db.prepare(`SELECT AVG(json_extract(judge, '$.cost')) AS c FROM stt_ab WHERE json_extract(judge, '$.cost') > 0`).get().c;
const per = prior || EST_PER_ROW;
console.log(`${rows.length} unjudged pairs: ${same.length} identical (ties, no call), ${todo.length} to judge (--limit ${limit}), `
  + `${rows.length - same.length - todo.length} without a kept WAV or past the limit. Estimated cost $${(todo.length * per).toFixed(2)} `
  + `($${per.toFixed(4)} per pair${prior ? ', this install\'s average' : ', a guess'}).`);

const setVerdict = db.prepare('UPDATE stt_ab SET verdict = ?, judge = ? WHERE id = ?');
if (!dryRun) {
  for (const r of same) setVerdict.run('tie', JSON.stringify({ identical: true }), r.id);
  const schema = {
    type: 'object', additionalProperties: false, required: ['more_accurate', 'reason'],
    properties: { more_accurate: { type: 'string', enum: ['A', 'B', 'tie'] }, reason: { type: 'string' } },
  };
  let done = 0;
  const judge = async (r) => {
    const aIsWav = Math.random() < 0.5; // order randomised per pair, recorded with the verdict
    const [a, b] = aIsWav ? [r.wav_text, r.mp3_text] : [r.mp3_text, r.wav_text];
    try {
      const j = await openRouter({
        model: JUDGE,
        max_tokens: 8000,
        provider: { require_parameters: true },
        response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema } },
        messages: [{ role: 'user', content: [
          { type: 'text', text: `This is scanner radio audio (police/fire dispatch). Two transcripts of it follow. Listen carefully and decide which transcript is more accurate: the words actually spoken, in order, with numbers, unit names and addresses right. Ignore punctuation and capitalisation. Answer "tie" only if they are equally accurate.\n\nTranscript A: ${a || '(empty)'}\n\nTranscript B: ${b || '(empty)'}` },
          { type: 'input_audio', input_audio: { data: readFileSync(join('data', 'ab', r.wav_file)).toString('base64'), format: 'wav' } },
        ] }],
      }, { purpose: 'stt-ab-judge' });
      const v = JSON.parse(j.choices?.[0]?.message?.content ?? '');
      const verdict = v.more_accurate === 'tie' ? 'tie' : (v.more_accurate === 'A') === aIsWav ? 'wav' : 'mp3';
      setVerdict.run(verdict, JSON.stringify({ a: aIsWav ? 'wav' : 'mp3', said: v.more_accurate, reason: v.reason, model: JUDGE, cost: j.usage?.cost ?? null }), r.id);
      console.log(`#${r.id} ${verdict.padEnd(4)} (A was ${aIsWav ? 'wav' : 'mp3'}) ${v.reason}`);
    } catch (e) { console.warn(`#${r.id} not judged: ${e.message}`); }
    done++;
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await judge(queue.shift()); }));
  if (done) console.log('');
}

// Tally over every judged pair, this run and earlier ones.
const t = db.prepare(`SELECT COUNT(*) AS n, SUM(verdict = 'wav') AS wav, SUM(verdict = 'mp3') AS mp3, SUM(verdict = 'tie') AS tie,
  SUM(json_extract(judge, '$.cost')) AS cost FROM stt_ab WHERE verdict IS NOT NULL`).get();
// Two-sided sign test on the decided pairs (ties dropped).
const signP = (w, m) => {
  const n = w + m, k = Math.min(w, m);
  if (!n) return 1;
  let term = 0.5 ** n, sum = 0;
  for (let i = 0; i <= k; i++) { sum += term; term *= (n - i) / (i + 1); }
  return Math.min(1, 2 * sum);
};
// Word-level edit distance between the two transcripts of a pair.
const words = (s) => (s || '').toLowerCase().match(/[a-z0-9']+/g) || [];
const wordDiff = (x, y) => {
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
};
const all = db.prepare('SELECT mp3_text, wav_text FROM stt_ab').all();
const diffs = all.map((r) => [wordDiff(words(r.mp3_text), words(r.wav_text)), Math.max(words(r.mp3_text).length, words(r.wav_text).length)]);
const meanDiff = diffs.reduce((a, [d]) => a + d, 0) / (diffs.length || 1);
const share = diffs.reduce((a, [d]) => a + d, 0) / (diffs.reduce((a, [, n]) => a + n, 0) || 1);
console.log(`Judged ${t.n || 0} pairs: wav won ${t.wav || 0}, mp3 won ${t.mp3 || 0}, tie ${t.tie || 0}. `
  + `Sign test (ties dropped) p = ${signP(t.wav || 0, t.mp3 || 0).toFixed(3)}. Judge spend $${(t.cost || 0).toFixed(3)}.`);
console.log(`Across all ${all.length} A/B pairs the two transcripts differ by ${meanDiff.toFixed(2)} words on average (${(share * 100).toFixed(1)}% of words).`);
if (dryRun) console.log('Dry run: nothing judged or stored.');
