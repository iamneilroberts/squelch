// /s/<id>: what a story's own page shows, and to whom. The route and database are the real ones; requests are stubs.
// Run: node --no-warnings=ExperimentalWarning --test tests/share.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'share-')), 'test.db');
process.env.SOURCES_FILE = join(repo, 'sources.example.json');
process.chdir(repo); // the route reads its templates from public/

const { shareRoute, previewRoute, sharePath, shareTitle, streetOnly, WITHHELD } = await import('../src/share.mjs');
const { db, newThread, createIncident } = await import('../src/db.mjs');

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

  // The preview path is the one Access may let through unsigned: a crafted path under it can't reach the app,
  // even claiming to be a signed-in guest. (fetch would tidy the path, so this is a raw request.)
  for (const raw of [`/p/../api/threads/${id}`, `/p/%2e%2e/api/threads/${id}`, '/p/../s/' + id, `/P/../api/threads/${id}`, `//p/../api/threads/${id}`,
    `/p\\..\\api\\threads\\${id}`, `/./p/../api/threads/${id}`, `http://h/p/../api/threads/${id}`, '//[', `/P/x`]) {
    const r = await new Promise((ok) => request({ host: '127.0.0.1', port, path: raw, headers: { 'cf-connecting-ip': '203.0.113.9', 'cf-access-authenticated-user-email': 'ann@example.com' } },
      (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, b })); }).end());
    assert.ok([400, 404].includes(r.status), `${raw} → ${r.status}`);
    assert.ok(!r.b.includes('John Q Example'), raw);
  }
  // Access matches p/* in any case, so /P/ must land in the preview handler too.
  const upper = await new Promise((ok) => request({ host: '127.0.0.1', port, path: `/P/${sharePath(id).slice(3)}`, headers: { 'cf-connecting-ip': '203.0.113.9' } },
    (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); }).end());
  assert.equal(upper, 200);
  // The app learns each story's shared-link path.
  assert.equal(JSON.parse(await (await tunnel(`/api/threads/${id}`, 'ann@example.com')).text()).share, sharePath(id));
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

async function preview(path) {
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h); }, end(b) { this.body = String(b ?? ''); } };
  await previewRoute({ url: path, headers: { host: 'scanner.example' } }, res, { port: 0, serveFile: () => {} });
  return res;
}

test('a shared link previews the story: title, place, summary and card, no notes or transcripts', async () => {
  const path = sharePath(id);
  assert.match(path, new RegExp(`^/p/${id}\\.[\\w-]{16}$`));
  const r = await preview(path);
  assert.equal(r.code, 200);
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://scanner.example${path}/card.jpg\\?v=\\d+">`));
  assert.match(r.body, new RegExp(`<meta http-equiv="refresh" content="0; url=/s/${id}">`));
  assert.ok(r.body.includes('Two dogs on Main Street'));
  assert.ok(!r.body.includes('John Q Example'));
  assert.ok(!r.body.includes('Dogs reported loose'));
  assert.equal(r.headers['X-Robots-Tag'], 'noindex');
  // The page links to the shared link, not the story number.
  assert.equal(data((await get(`/s/${id}`)).body).url, `http://scanner.example${path}`);
});

test('a shared health, police or injury-crash story shows its type only, with the withheld note', async () => {
  const story = (type, subject, why) => newThread('county-fire', { subject, facts: [{ label: 'Incident', value: why }], type, alert: 0.5, why });
  const medical = story('medical', 'Overdose at 12 Elm', 'Teen unresponsive');
  const at = new Date().toISOString();
  const inc = createIncident({ source_id: 'county-fire', at, headline: 'x', summary: 'x', category: 'notable', type: 'medical', location_text: 'near 4410 Elm St, Apt B', lat: 30.6, lng: -88.1, precision: 'geocoded', confidence: 1 }).id;
  db.prepare('INSERT INTO calls (source_id, at, thread_id, incident_id) VALUES (?,?,?,?)').run('county-fire', at, medical, inc);
  for (const [sid, label] of [[medical, 'Medical call'], [story('police', 'Arrest on Main', 'Suspect detained'), 'Police call'],
    [story('crash', 'Rollover on I-10', 'One transported to USA Medical'), 'Crash']]) {
    const t = { ...db.prepare('SELECT * FROM threads WHERE id = ?').get(sid) };
    for (const r of [await preview(sharePath(sid)), await get(`/s/${sid}/card`)]) {
      assert.ok(r.body.includes(label) && r.body.includes(WITHHELD), label);
      assert.ok(!/Overdose|Teen|Arrest|Suspect|Rollover|transported|4410|Apt/.test(r.body), label);
    }
    assert.equal(data((await get(`/s/${sid}`)).body).shareTitle, shareTitle({ ...t, facts: JSON.parse(t.facts) })); // the /s page's share sheet
    assert.match(shareTitle({ ...t, facts: JSON.parse(t.facts) }), new RegExp(`: ${label}$`)); // the share sheet's title
  }
  // A crash that mentions no one hurt keeps its headline and summary.
  const minor = story('crash', 'Fender bender on Airport Blvd', 'Cars moved to the shoulder');
  const r = await preview(sharePath(minor));
  assert.ok(r.body.includes('Fender bender on Airport Blvd') && r.body.includes('Cars moved to the shoulder') && !r.body.includes(WITHHELD));
});

test('a withheld story shows the street, not the home', () => {
  for (const [place, street] of [['7525 Three Notch Road, between Travis Road and Lakeland Drive', 'Three Notch Road, between Travis Road and Lakeland Drive'],
    ['Memorial Boulevard, Apartment 135 (address unclear)', 'Memorial Boulevard'], ['Magnolia Apartments, 3624 28th Drive, apartment G-17', 'Magnolia Apartments, 28th Drive'],
    ['800 Conti Street, Unit 218, between Bayou Street', 'Conti Street, between Bayou Street'], ['Hotel at 64 South Water Street', 'Hotel at South Water Street'],
    ['8160 County Road 64', 'County Road 64'], ['3491 Dolphin Drive, room 223', 'Dolphin Drive'], ['Super 8', 'Super 8'],
    ['near 1234 Dauphin St', 'near Dauphin St'], ['12A Elm St', 'Elm St'], ['12-14 Elm St Apt B', 'Elm St'], ['Lot 7, Trailer 14, Pine Road', 'Pine Road'],
    ['State Highway 181 and Sherwood Road', 'State Highway 181 and Sherwood Road'], ['900 West I-65 Service Road', 'West I-65 Service Road']]) assert.equal(streetOnly(place), street);
});

test('a shared link only works with its own signature', async () => {
  const other = newThread('county-fire', { subject: 'Not shared', facts: [], type: 'other', alert: 0.1, why: null });
  const sig = sharePath(id).split('.')[1];
  const flip = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  for (const bad of [`/p/${other}.${sig}`, `/p/${id}.${flip}`, `/p/${id}`, `/p/${id}.${sig}/other`, `/p/${id}.${sig.slice(0, 15)}`, '/p/999999999.' + sig]) {
    assert.equal((await preview(bad)).code, 404, bad);
  }
  assert.equal((await preview(sharePath(other))).code, 200);
});

test('unknown stories are a 404 and other paths are not handled', async () => {
  assert.equal((await get('/s/999999')).code, 404);
  assert.equal((await get('/s/abc')).handled, false);
  assert.equal((await get('/s/1/other')).handled, false);
});
