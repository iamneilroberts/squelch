// "Your animation is ready": who is told when a Studio job finishes. web-push is stubbed at its send call, so
// nothing leaves this machine; the notify code, the job runner and the library are the real ones.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'studio-notify-')), 'test.db');
process.env.SOURCES_FILE = new URL('../sources.example.json', import.meta.url).pathname;
process.chdir(mkdtempSync(join(tmpdir(), 'studio-notify-cwd-')));

const sent = []; // { endpoint, payload }
webpush.sendNotification = async (sub, body) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); return { statusCode: 201 }; };

const { subscribe, unsubscribe, configureNotify, subInfo } = await import('../src/notify.mjs');
const { createAnimation, updateAnimation, getAnimation } = await import('../src/studio/library.mjs');
const { pump, notifyFinished } = await import('../src/studio/jobs.mjs');
const { guestSub } = await import('../src/studio/routes.mjs');

const sub = (name, owner, label) => { const endpoint = `https://push.example/${name}`; subscribe({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }, { owner, label }); return endpoint; };
const OWNER1 = sub('owner-phone', true, 'LAN'), OWNER2 = sub('owner-laptop', true, 'LAN');
const GUEST1 = sub('guest-1', false, 'ann@example.com'), GUEST2 = sub('guest-2', false, 'bob@example.com');
let guestsAllowed = true;
configureNotify({ allowGuests: () => guestsAllowed });
const who = () => sent.splice(0).map((s) => `${s.endpoint.split('/').pop()}: ${JSON.stringify(s.payload)}`);
const queued = (extra) => createAnimation({ title: 'Loose dogs', style: 'sunday', format: 'web', status: 'queued', thread_id: 987654, ...extra });

test('owner job done: every owner browser, none of the guests', async () => {
  const id = queued({ requested_by: 'owner' });
  updateAnimation(id, { status: 'done' });
  const r = await notifyFinished(id);
  const got = who();
  console.log('owner done ->', got);
  assert.equal(r.sent, 2);
  assert.deepEqual(got.map((g) => g.split(':')[0]).sort(), ['owner-laptop', 'owner-phone']);
  assert.deepEqual(r.payload, { title: 'Your animation is ready: Loose dogs', body: 'Tap to watch it.', tag: `studio-${id}`, url: `/manual.html#studio-${id}` });
});

test('owner job failed (the real runner, failing before any model call): owner browsers, with the reason', async () => {
  const id = queued({ requested_by: 'owner' });
  await pump(); // the story doesn't exist, so run() fails at its first step, then notifies
  assert.equal(getAnimation(id).status, 'failed');
  const got = who();
  console.log('owner failed ->', got);
  assert.equal(got.length, 2);
  assert.ok(got.every((g) => /owner-/.test(g)));
  const p = JSON.parse(got[0].slice(got[0].indexOf('{')));
  assert.equal(p.title, "Couldn't make Loose dogs: The content guard keeps this story out (no such story)");
  assert.equal(p.url, `/manual.html#studio-${id}`);
});

test('guest job done: only the browser it was queued from', async () => {
  const id = queued({ requested_by: 'guest ann@example.com', notify_endpoint: GUEST1 });
  updateAnimation(id, { status: 'done' });
  await notifyFinished(id);
  const got = who();
  console.log('guest done ->', got);
  assert.equal(got.length, 1);
  assert.match(got[0], /^guest-1: .*Your animation is ready: Loose dogs/);
});

test('guest job failed: a plain reason, never the engine\'s error text', async () => {
  const id = queued({ requested_by: 'guest bob@example.com', notify_endpoint: GUEST2 });
  await pump();
  const got = who();
  console.log('guest failed ->', got);
  assert.equal(got.length, 1);
  assert.match(got[0], /^guest-2: .*Couldn't make Loose dogs: it didn't work out/);
  assert.doesNotMatch(got[0], /content guard|no such story/);
});

test('guest with no subscription: nobody is told, owners included', async () => {
  const id = queued({ requested_by: 'guest 203.0.113.9', notify_endpoint: null });
  updateAnimation(id, { status: 'done' });
  const r = await notifyFinished(id);
  console.log('guest, no subscription ->', r.to, who());
  assert.deepEqual(r.to, []);
  assert.equal(r.sent, 0);
  assert.deepEqual(sent, []);
});

test('guest notifications switched off: a guest\'s subscription is skipped', async () => {
  guestsAllowed = false;
  const id = queued({ requested_by: 'guest ann@example.com', notify_endpoint: GUEST1 });
  updateAnimation(id, { status: 'done' });
  assert.equal((await notifyFinished(id)).sent, 0);
  guestsAllowed = true;
  assert.deepEqual(sent, []);
});

test('a job that is still queued or running sends nothing', async () => {
  assert.deepEqual(await notifyFinished(queued({ requested_by: 'owner', status: 'running' })), { to: [], sent: 0 });
});

test('which subscription a guest\'s job may use: theirs only', () => {
  assert.equal(guestSub(false, 'ann@example.com', GUEST1), GUEST1);
  assert.equal(guestSub(false, 'ann@example.com', GUEST2), null, 'another guest\'s browser, under a different email');
  assert.equal(guestSub(false, 'ann@example.com', OWNER1), null, 'an owner browser');
  assert.equal(guestSub(false, '203.0.113.9', OWNER1), null, 'an owner browser, guest known by address only');
  assert.equal(guestSub(false, 'ann@example.com', 'https://push.example/unknown'), null);
  assert.equal(guestSub(false, 'ann@example.com', undefined), null);
  assert.equal(guestSub(true, 'owner', OWNER1), null, 'owner jobs use all owner browsers instead');
});

test('a deleted subscription whose id is reused by someone else is not notified', async () => {
  const mine = sub('guest-3', false, 'cy@example.com'); // the newest row, so its id is the one SQLite hands out next
  const id = queued({ requested_by: 'guest cy@example.com', notify_endpoint: mine });
  updateAnimation(id, { status: 'done' });
  const oldId = subInfo(mine).id;
  unsubscribe(mine);
  const stranger = sub('guest-4', false, 'dan@example.com');
  assert.equal(subInfo(stranger).id, oldId, 'the id really was reused');
  const r = await notifyFinished(id);
  assert.deepEqual(r.to, []);
  assert.deepEqual(sent, []);
});

test('a job whose stored endpoint now belongs to a different person, or an owner, sends nothing', async () => {
  const a = queued({ requested_by: 'guest ann@example.com', notify_endpoint: GUEST2 }); // bob's browser on ann's job
  const b = queued({ requested_by: 'guest 203.0.113.9', notify_endpoint: OWNER1 });
  for (const id of [a, b]) { updateAnimation(id, { status: 'done' }); assert.deepEqual((await notifyFinished(id)).to, []); }
  assert.deepEqual(sent, []);
});
