// A reporter's browser hears about its own report, and no other browser does, even one that took over a deleted
// browser's row number. gh is a stub on PATH and web-push is stubbed at its send call; the report code and database are real.
// Run: node --no-warnings=ExperimentalWarning --test tests/report-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'report-push-')), 'test.db');
process.env.SOURCES_FILE = new URL('../sources.example.json', import.meta.url).pathname;
process.env.REPORT_POLL_MS = '2000000000'; // the test runs the poll itself
process.env.REPORT_CACHE_MS = '0';

// gh: signed in, files issue #7, and reports #7 as planned with no replies.
const bin = mkdtempSync(join(tmpdir(), 'report-push-bin-'));
writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (a.startsWith('issue create')) console.log('https://github.com/iamneilroberts/squelch/issues/7');
else if (a.startsWith('issue list')) console.log('[]');
else if (/^api \\S+\\/comments/.test(a)) console.log('[]');
else if (a.startsWith('api ')) console.log(JSON.stringify({ number: 7, title: '[Problem] Map is blank', state: 'open', labels: [{ name: 'from-app' }, { name: 'status:planned' }], user: { login: 'iamneilroberts' }, html_url: 'https://github.com/x', updated_at: 'now' }));
`);
chmodSync(join(bin, 'gh'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const sent = [];
webpush.sendNotification = async (sub) => { sent.push(sub.endpoint.split('/').pop()); return { statusCode: 201 }; };

const { subscribe, setPrefs, unsubscribe } = await import('../src/notify.mjs');
const { reportRoute, pollReports } = await import('../src/report.mjs');

const browser = (name) => {
  const endpoint = `https://push.example/${name}`;
  subscribe({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }, { owner: true });
  setPrefs(endpoint, { quiet: null }); // no quiet hours, whatever time the test runs
  return endpoint;
};
async function report(endpoint) {
  let out;
  await reportRoute({ method: 'POST', headers: {}, socket: { remoteAddress: endpoint } }, {}, {
    json: (res, body, code = 200) => { out = { code, body }; }, readJson: async () => ({ text: 'The map is blank on my phone', endpoint }),
    canEdit: () => false, version: () => 'test',
  });
  return out;
}

test('a report update goes to the browser that filed it, not to one that later took its row number', async () => {
  const d = browser('D');
  const b = browser('B');
  assert.equal((await report(d)).body.number, 7);
  assert.equal((await report(b)).body.number, 7);
  unsubscribe(b); // B was the newest row, so SQLite gives its number to the next browser
  browser('C');
  await pollReports();
  assert.deepEqual(sent, ['D']);
});
