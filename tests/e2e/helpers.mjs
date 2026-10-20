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

// Default answers: the primary persona, a renter who could ask the landlord and can charge at work.
export const RENTER = { dailyMiles: 1, homeCharging: 2, workCharging: 0, longTrips: 1, outdoor: 2 };

/** Walk the flow: ZIP, then each question shown (answer by option index, or skip if absent), then results. */
export async function completeFlow(page, zip = '80302', answers = RENTER) {
  await page.fill('#zip', zip);
  await page.click('#zip-form button[type=submit]');
  for (let i = 0; i < 10; i++) {
    await page.waitForSelector('#view-question:not([hidden]), #view-results:not([hidden])');
    if (await page.isVisible('#view-results')) return;
    const radios = page.locator('#question-options input[type=radio]');
    const name = await radios.first().getAttribute('name');
    if (answers[name] == null) await page.click('#question-skip');
    else {
      await radios.nth(answers[name]).check();
      await page.click('#question-next');
    }
  }
  throw new Error('flow did not reach results');
}

// Renter in Boulder, long drives monthly, outdoors monthly: the plan has both trip steps.
export const RENTER_TRIPS = { dailyMiles: 1, homeCharging: 2, workCharging: 0, longTrips: 2, outdoor: 2 };

// Boulder down I-25 to Great Sand Dunes, as /api/route would return it: about 260 road miles.
const TRIP_WAYPOINTS = [[40.0150, -105.2700], [39.7400, -104.9900], [38.8300, -104.8200], [38.2500, -104.6100], [37.6200, -104.7800], [37.7300, -105.5100]];
export function tripRouteBody() {
  const points = [];
  for (let w = 0; w < TRIP_WAYPOINTS.length - 1; w++) {
    const [a, b] = [TRIP_WAYPOINTS[w], TRIP_WAYPOINTS[w + 1]];
    for (let i = 0; i < 60; i++) points.push([+(a[0] + ((b[0] - a[0]) * i) / 60).toFixed(4), +(a[1] + ((b[1] - a[1]) * i) / 60).toFixed(4)]);
  }
  points.push(TRIP_WAYPOINTS.at(-1));
  return { miles: 262.4, minutes: 245, points, attribution: 'Geoapify, © OpenStreetMap contributors' };
}
