// Headless Chrome for the cartoon: checking that a generated page plays, and stepping it frame by frame
// for the MP4. Optional: needs puppeteer-core (an optional dependency) and a Chrome or Chromium binary,
// from CHROME_PATH or the usual places. Without them the cartoon is web-only.
import { existsSync } from 'node:fs';

const CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
export const chromePath = () => process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p)) || null;

// Runs fn(browser), or returns null when there's no browser to run.
export async function withBrowser(fn) {
  const path = chromePath();
  if (!path) return null;
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return null; }
  const browser = await puppeteer.launch({ executablePath: path, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  try { return await fn(browser); } finally { await browser.close(); }
}
