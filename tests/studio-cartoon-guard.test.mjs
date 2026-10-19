// The one-shot cartoon is checked on what it shows, not its code: canvas code says "stroke" and "shots" all the time.
// The page is a stand-in for a model-written cartoon; playCheck and the guard are the real ones. Needs Chrome (skips without).
// Run: node --no-warnings=ExperimentalWarning --test tests/studio-cartoon-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cartoon-guard-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.SOURCES_FILE = new URL('../sources.example.json', import.meta.url).pathname;
const { playCheck } = await import('../src/studio/cartoon.mjs');
const { withBrowser } = await import('../src/studio/browser.mjs');
const { guardOutput } = await import('../src/studio/notes.mjs');

const page = (sign) => {
  const file = join(dir, `${sign.replace(/\W/g, '')}.html`);
  writeFileSync(file, `<!doctype html><svg><g id="world"><g><rect/><circle/><text>${sign}</text></g></g></svg><script>
    const shots = [[0, 10]]; const stroke = () => 'stroke'; // code words the guard must not see
    window.__studio = { shots: () => shots, frame: () => stroke() };
  </script>`);
  return file;
};
const shown = (b, file) => { const seen = []; return playCheck(b, file, 10, seen).then((error) => ({ error, hit: guardOutput(seen.join('\n')) })); };

test('a cartoon is guarded on the words it shows, and its code words are not', async (t) => {
  const ran = await withBrowser(async (b) => {
    assert.deepEqual(await shown(b, page('FRESH BATTERIES')), { error: null, hit: null });
    assert.deepEqual(await shown(b, page('SHOTS FIRED')), { error: null, hit: 'SHOTS' });
    return true;
  });
  if (!ran) t.skip('no Chrome here');
});
