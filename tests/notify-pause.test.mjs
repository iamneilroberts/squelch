// Issue #5: snoozing notifications and quiet hours. web-push is stubbed at its send call, so nothing leaves this
// machine; the notify code and the database are the real ones.
// Run: node --no-warnings=ExperimentalWarning --test tests/notify-pause.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'notify-pause-')), 'test.db');
process.env.SOURCES_FILE = new URL('../sources.example.json', import.meta.url).pathname;
process.chdir(mkdtempSync(join(tmpdir(), 'notify-pause-cwd-')));

// A browser that subscribed before quiet hours existed: the old push_subs table, one row.
const old = new DatabaseSync(process.env.DB_PATH);
old.exec(`CREATE TABLE push_subs (id INTEGER PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, keys TEXT NOT NULL, owner INTEGER NOT NULL DEFAULT 0,
  label TEXT, favorites TEXT NOT NULL DEFAULT '[]', level TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL)`);
old.prepare('INSERT INTO push_subs (endpoint, keys, owner, created_at) VALUES (?,?,1,?)').run('https://push.example/before', '{"p256dh":"p","auth":"a"}', new Date().toISOString());
old.close();

const sent = [];
webpush.sendNotification = async (sub) => { sent.push(sub.endpoint.split('/').pop()); return { statusCode: 201 }; };

const { inQuiet, endOfDay, heldBack, subscribe, subscription, setPrefs, snooze, considerThread, pushTo, subId, configureNotify } = await import('../src/notify.mjs');
const { db, newThread } = await import('../src/db.mjs');
configureNotify({ allowGuests: () => true });

const CHI = 'America/Chicago';
const at = (iso) => new Date(iso);
const sub = (name, owner = false) => { const endpoint = `https://push.example/${name}`; subscribe({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }, { owner, label: name }); return endpoint; };
const row = (endpoint) => db.prepare('SELECT * FROM push_subs WHERE endpoint = ?').get(endpoint);
const hhmmAt = (ms, tz) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

test('a browser subscribed before quiet hours existed gets 22:00–07:00 with majors let through', () => {
  assert.deepEqual(subscription('https://push.example/before').quiet, { start: '22:00', end: '07:00', major: true });
  assert.deepEqual(subscription(sub('fresh')).quiet, { start: '22:00', end: '07:00', major: true });
});

test('a window crossing midnight', () => {
  // October in Chicago is CDT, UTC−5.
  assert.equal(inQuiet('22:00', '07:00', at('2026-10-20T03:00Z'), CHI), true); // 22:00
  assert.equal(inQuiet('22:00', '07:00', at('2026-10-20T02:59Z'), CHI), false); // 21:59
  assert.equal(inQuiet('22:00', '07:00', at('2026-10-20T05:30Z'), CHI), true); // 00:30
  assert.equal(inQuiet('22:00', '07:00', at('2026-10-20T11:59Z'), CHI), true); // 06:59
  assert.equal(inQuiet('22:00', '07:00', at('2026-10-20T12:00Z'), CHI), false); // 07:00
  assert.equal(inQuiet('09:00', '17:00', at('2026-10-20T17:00Z'), CHI), true); // 12:00, a same-day window
  assert.equal(inQuiet('09:00', '17:00', at('2026-10-20T03:00Z'), CHI), false);
  assert.equal(inQuiet('22:00', '22:00', at('2026-10-20T03:00Z'), CHI), false); // empty window = off
  assert.equal(inQuiet(null, null, at('2026-10-20T03:00Z'), CHI), false);
});

test('DST: the window follows the wall clock on both change days', () => {
  // Fall back, Sun 1 Nov 2026 (07:00Z): 07:00 CST is 13:00Z, not 12:00Z.
  assert.equal(inQuiet('22:00', '07:00', at('2026-11-01T12:30Z'), CHI), true); // 06:30 CST
  assert.equal(inQuiet('22:00', '07:00', at('2026-11-01T13:00Z'), CHI), false); // 07:00 CST
  // Spring forward, Sun 8 Mar 2026 (08:00Z): 07:00 CDT is 12:00Z.
  assert.equal(inQuiet('22:00', '07:00', at('2026-03-08T11:59Z'), CHI), true);
  assert.equal(inQuiet('22:00', '07:00', at('2026-03-08T12:00Z'), CHI), false);
});

test('"Rest of today" ends at local midnight, also across a DST change', () => {
  assert.equal(endOfDay(at('2026-10-20T17:00:00Z'), CHI).toISOString(), '2026-10-21T05:00:00.000Z'); // noon CDT → 00:00 CDT
  assert.equal(endOfDay(at('2026-11-01T05:30:00Z'), CHI).toISOString(), '2026-11-02T06:00:00.000Z'); // 00:30 CDT → 00:00 CST (25 h day)
  assert.equal(endOfDay(at('2026-03-08T06:30:00Z'), CHI).toISOString(), '2026-03-09T05:00:00.000Z'); // 00:30 CST → 00:00 CDT (23 h day)
  assert.equal(endOfDay(at('2026-10-21T04:59:59Z'), CHI).toISOString(), '2026-10-21T05:00:00.000Z'); // 23:59:59 → a second later
});

test('quiet hours: major events through when allowed, everything else held', () => {
  const s = { quiet_start: '22:00', quiet_end: '07:00', quiet_major: 1, muted_threads: '[]' };
  const night = at('2026-10-20T04:00Z');
  // inQuiet defaults to the station's zone; give the check the same instant the window is in.
  const tz = subscription('https://push.example/before').timezone;
  const nightLocal = at(`2026-10-20T${'23:00'}:00${offset(tz, night)}`);
  assert.equal(heldBack(s, 0.95, null, nightLocal), null);
  assert.equal(heldBack(s, 0.7, null, nightLocal), 'quiet');
  assert.equal(heldBack({ ...s, quiet_major: 0 }, 0.95, null, nightLocal), 'quiet');
  assert.equal(heldBack({ ...s, quiet_start: null }, 0.7, null, nightLocal), null);
});

test('snooze holds everything until it expires', () => {
  const now = Date.now();
  const s = { snooze_until: new Date(now + 3600e3).toISOString(), quiet_start: null, muted_threads: '[]' };
  assert.equal(heldBack(s, 0.99, null, new Date(now)), 'snoozed'); // even a major: the person asked for silence
  assert.equal(heldBack(s, 0.99, null, new Date(now + 3601e3)), null); // an hour later it has lapsed
});

test('snooze only touches the browser whose endpoint is given', () => {
  const A = sub('a'), B = sub('b');
  assert.equal(snooze('https://push.example/nobody', { for: '1h' }), null); // not a subscription
  assert.equal(snooze(undefined, { for: '1h' }), null);
  assert.equal(snooze(A, { for: 'forever' }), null); // not an option
  assert.ok(snooze(A, { for: '1h' }).snoozeUntil);
  assert.equal(subscription(B).snoozeUntil, null);
  snooze(A, { for: 'story', story: 42 });
  assert.equal(heldBack({ ...row(A), snooze_until: null, quiet_start: null }, 0.95, 42), 'muted');
  assert.equal(heldBack({ ...row(B), quiet_start: null }, 0.95, 42), null);
  const today = snooze(A, { for: 'today' }).snoozeUntil;
  assert.ok(Date.parse(snooze(A, { for: '1h' }).snoozeUntil) >= Date.parse(today)); // 1 h never shortens a longer pause
  assert.equal(snooze(A, { for: 'resume' }).snoozeUntil, null);
});

test('quiet hours are set, turned off, and bad times ignored', () => {
  const C = sub('c');
  assert.deepEqual(setPrefs(C, { quiet: { start: '23:30', end: '06:15', major: false } }).quiet, { start: '23:30', end: '06:15', major: false });
  for (const start of ['', '24:00', '7:00', 'x']) assert.equal(setPrefs(C, { quiet: { start, end: '06:00' } }).quiet.start, '23:30');
  assert.equal(setPrefs(C, { quiet: null }).quiet, null);
});

test('end to end: a story notifies the awake browser, not the snoozed, muted or quiet ones', async () => {
  for (const r of db.prepare('SELECT endpoint FROM push_subs').all()) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(r.endpoint);
  const tz = subscription(sub('awake')).timezone;
  setPrefs(`https://push.example/awake`, { quiet: null });
  const snoozed = sub('snoozed'); setPrefs(snoozed, { quiet: null }); snooze(snoozed, { for: '1h' });
  const muted = sub('muted'); setPrefs(muted, { quiet: null });
  // A quiet window around the current station time.
  const quiet = sub('quiet'); setPrefs(quiet, { quiet: { start: hhmmAt(Date.now() - 3600e3, tz), end: hhmmAt(Date.now() + 3600e3, tz), major: true } });
  const id = newThread('county-fire', { subject: 'Structure fire', facts: [], type: 'fire', alert: 0.8, why: 'Working fire' });
  snooze(muted, { for: 'story', story: id });
  sent.length = 0;
  await considerThread(id);
  assert.deepEqual(sent.sort(), ['awake']);

  // A major (≥ 0.9) gets through quiet hours, but still not a snooze or a muted story.
  const major = newThread('county-fire', { subject: 'Mayday', facts: [], type: 'fire', alert: 0.95, why: 'Mayday' });
  snooze(muted, { for: 'story', story: major });
  sent.length = 0;
  await considerThread(major);
  assert.deepEqual(sent.sort(), ['awake', 'quiet']);

  // Direct pushes (report status, Studio done) are held in quiet hours too.
  sent.length = 0;
  assert.equal(await pushTo(subId(quiet), { title: 'x' }), false);
  assert.equal(await pushTo(subId('https://push.example/awake'), { title: 'x' }), true);
});

// "+HH:MM"/"-HH:MM" offset of `tz` at `when`, so a local wall time can be written as an instant.
function offset(tz, when) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(when).find((x) => x.type === 'timeZoneName').value;
  return p === 'GMT' ? 'Z' : p.slice(3);
}
