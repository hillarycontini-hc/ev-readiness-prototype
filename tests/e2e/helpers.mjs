// Shared helpers for browser tests: start the static server and drive the flow.

import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer(port) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('Serving')) resolve(); });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  return { url: `http://localhost:${port}`, stop: () => proc.kill() };
}

// posthog-js drops events from headless browsers as bots, so analytics tests
// present the test browser as ordinary desktop Chrome.
export async function newVisitorContext(browser, options = {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    ...options,
  });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  });
  return context;
}

// Serve a config with a fake PostHog key so analytics loads during tests.
export const TEST_CONFIG = `
export const POSTHOG_KEY = 'phc_local_test_key_not_real';
export const POSTHOG_HOST = 'https://us.i.posthog.com';
export const EXPERIMENT_KEY = 'landing-messaging';
export const APP_VERSION = 'test';
`;

/** Decode a PostHog ingestion request body into an array of events. */
export function decodePosthogBody(request) {
  const buf = request.postDataBuffer();
  if (!buf) return [];
  let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b) text = gunzipSync(buf).toString('utf8'); // gzip magic bytes
  else text = buf.toString('utf8');
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8');
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.batch)) return parsed.batch;
  return [parsed];
}

/** Walk the full flow: ZIP, four answers, results. */
export async function completeFlow(page, zip = '80302', answers = [1, 0, 1, 2]) {
  await page.fill('#zip', zip);
  await page.click('#zip-form button[type=submit]');
  for (const idx of answers) {
    await page.waitForSelector('#view-question:not([hidden])');
    const radios = page.locator('#question-options input[type=radio]');
    if (idx == null) await page.click('#question-skip');
    else {
      await radios.nth(idx).check();
      await page.click('#question-next');
    }
  }
  await page.waitForSelector('#view-results:not([hidden])');
}
