// /s/<id>: what a story's own page shows, and to whom. The route and database are the real ones; requests are stubs.
// Run: node --no-warnings=ExperimentalWarning --test tests/share.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'share-')), 'test.db');
process.env.SOURCES_FILE = join(repo, 'sources.example.json');
process.chdir(repo); // the route reads its templates from public/

const { shareRoute } = await import('../src/share.mjs');
const { db, newThread } = await import('../src/db.mjs');

const SECRET = 'Unit 4 copies, the caller is John Q Example at 12 Elm';
const id = newThread('county-fire', { subject: 'Loose dogs </script><script>alert(1)</script>', facts: [{ label: 'Incident', value: 'Two dogs on Main Street' }], type: 'animal', alert: 0.2, why: null });
db.prepare('INSERT INTO calls (source_id, at, audio, transcript, note, thread_id) VALUES (?,?,?,?,?,?)').run('county-fire', new Date().toISOString(), 'county-fire-1.mp3', SECRET, 'Dogs reported loose', id);

async function get(path, { hidden = false, remote = false, email } = {}) {
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h); }, end(b) { this.body = String(b ?? ''); } };
  const req = { headers: { host: 'scanner.example', ...(email && { 'cf-access-authenticated-user-email': email }) } };
  const handled = await shareRoute(req, res, { p: path, hidden, remote, port: 0, page: (h) => h, serveFile: () => {} });
  return { handled, ...res };
}
const data = (html) => JSON.parse(/<script type="application\/json" id="story-data">([\s\S]*?)<\/script>/.exec(html)[1]);

test('LAN and signed-in guests the owner shares transcripts with get them, with captions', async () => {
  for (const r of [await get(`/s/${id}`), await get(`/s/${id}`, { remote: true, email: 'ann@example.com' })]) {
    assert.equal(r.code, 200);
    const s = data(r.body);
    assert.equal(s.transcripts, true);
    assert.equal(s.events[0].transcript, SECRET);
    assert.equal(s.events[0].captions, '/api/captions/county-fire-1.mp3.vtt');
  }
});

test('transcripts appear nowhere in the page for a guest they are hidden from', async () => {
  const r = await get(`/s/${id}`, { hidden: true, remote: true, email: 'ann@example.com' });
  assert.equal(data(r.body).transcripts, false);
  assert.ok(!r.body.includes('John Q Example'));
  assert.ok(r.body.includes('Dogs reported loose')); // notes stay, as in the app
});

// The rule lives in src/server.mjs, for every route: run the real server, with the owner sharing transcripts.
test('a visitor Access did not sign in never gets transcripts, even while the owner shares them', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'share-server-'));
  mkdirSync(join(dir, 'data'));
  symlinkSync(join(repo, 'public'), join(dir, 'public'));
  writeFileSync(join(dir, 'data', 'settings.json'), JSON.stringify({ tunnelTranscripts: true }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(repo, 'src', 'server.mjs')],
    { cwd: dir, env: { ...process.env, PORT: String(port), INGEST: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => server.kill());
  await new Promise((ok) => server.stdout.on('data', (d) => String(d).includes(`:${port}`) && ok()));
  const tunnel = (path, email) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'cf-connecting-ip': '203.0.113.9', ...(email && { 'cf-access-authenticated-user-email': email }) } });

  const signedIn = await (await tunnel(`/s/${id}`, 'ann@example.com')).text();
  assert.equal(data(signedIn).transcripts, true); // the owner shares them with signed-in guests
  const anon = await (await tunnel(`/s/${id}`)).text();
  assert.equal(data(anon).transcripts, false);
  assert.ok(!anon.includes('John Q Example'));
  assert.equal((await tunnel('/api/captions/county-fire-1.mp3.vtt')).status, 404);
  assert.ok(!(await (await tunnel(`/api/threads/${id}`)).text()).includes('John Q Example'));
  assert.ok((await (await tunnel(`/api/threads/${id}`, 'ann@example.com')).text()).includes('John Q Example'));
});

test('story text cannot break out of the page', async () => {
  const r = await get(`/s/${id}`);
  assert.equal((r.body.match(/<\/script>/g) || []).length, 3); // the data block, leaflet.js and share.js, no more
  assert.match(r.body, /<title>[^<]*&lt;\/script&gt;/); // escaped in the title and meta tags
  assert.ok(!/<script>alert/.test(r.body));
  assert.equal(data(r.body).subject, 'Loose dogs </script><script>alert(1)</script>');
});

test('link preview tags point at this host', async () => {
  const r = await get(`/s/${id}`, { remote: true, email: 'ann@example.com' });
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://scanner.example/s/${id}/card.jpg\\?v=\\d+">`));
  assert.match(r.body, /<meta name="twitter:card" content="summary_large_image">/);
});

test('the preview card page carries no transcript, and a missing story launches no browser', async () => {
  const r = await get(`/s/${id}/card`);
  assert.equal(r.code, 200);
  assert.ok(!r.body.includes('John Q Example'));
  const t0 = Date.now();
  const img = await get('/s/999999/card.jpg');
  assert.equal(img.code, 302); // straight to the fallback icon
  assert.ok(Date.now() - t0 < 200);
});

test('unknown stories are a 404 and other paths are not handled', async () => {
  assert.equal((await get('/s/999999')).code, 404);
  assert.equal((await get('/s/abc')).handled, false);
  assert.equal((await get('/s/1/other')).handled, false);
});
