// Browser test: what actually leaves the page.
// PostHog is intercepted locally; no request reaches the real service.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, startServer } from './helpers.mjs';

const ZIP = '80302';
let server;
let browser;

before(async () => {
  server = await startServer(8181);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.stop();
});

async function run({ gpc = false } = {}) {
  const context = await newVisitorContext(browser);
  if (gpc) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  const page = await context.newPage();
  const hosts = new Set();
  const events = [];
  const posthogPaths = [];

  await context.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  await context.route('https://us.i.posthog.com/**', (route) => {
    const req = route.request();
    posthogPaths.push(new URL(req.url()).pathname);
    if (req.method() === 'POST') events.push(...decodePosthogBody(req));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  // Outbound "learn more" pages are not loaded during tests.
  await context.route(/^https:\/\/(?!us\.i\.posthog\.com)/, (route) => route.abort());
  context.on('request', (req) => hosts.add(new URL(req.url()).host));

  // Arrive the way a shared link might: campaign tags, an ad click id, a fragment.
  await page.goto(`${server.url}/?utm_source=linkedin&fbclid=CLICKID123#section`);
  await completeFlow(page, ZIP);
  await page.click('#plan-cta'); // fake door: must send an event and collect nothing
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.click('#learn-more a >> nth=0'),
  ]);
  await popup.close();
  // posthog-js batches events; give it time to flush.
  await page.waitForTimeout(4500);

  const storage = await page.evaluate(() => ({
    cookie: document.cookie,
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  const cookies = await context.cookies();
  await context.close();
  return { hosts, events, posthogPaths, storage, cookies };
}

test('analytics on: only named events, no ZIP, no storage, variant on every event', async () => {
  const { hosts, events, posthogPaths, storage, cookies } = await run();

  const names = events.map((e) => e.event);
  for (const step of ['landing_viewed', 'zip_submitted', 'inputs_completed', 'recommendation_viewed', 'plan_cta_clicked', 'learn_more_clicked', 'next_step_taken']) {
    assert.ok(names.includes(step), `funnel step ${step} was sent (got ${names.join(', ')})`);
  }
  assert.ok(names.every((n) => !n.startsWith('$') || n === '$opt_in'), `no automatic $ events: ${names.join(', ')}`);

  const northStar = events.filter((e) => e.event === 'next_step_taken');
  assert.equal(northStar.length, 1, 'north star fires once per visit');
  assert.equal(northStar[0].properties.type, 'plan', 'first next step was the plan');
  assert.ok(northStar[0].properties.answered >= 2, 'answered count is attached');

  const raw = JSON.stringify(events);
  assert.ok(!raw.includes(ZIP), 'ZIP never appears in any analytics payload');
  assert.ok(!raw.includes('CLICKID123'), 'ad click ids are dropped');
  assert.ok(events.some((e) => e.properties.utm_source === 'linkedin'), 'UTM source is kept for channel analysis');
  for (const e of events) {
    const variant = e.properties['$feature/landing-messaging'];
    assert.ok(['control', 'adventure'].includes(variant), `${e.event} carries the experiment variant`);
    assert.equal(e.properties.$ip, undefined, 'no $ip property');
    assert.equal(e.properties.$geoip_disable, true, 'server-side GeoIP lookup is disabled');
    assert.equal(e.properties.$raw_user_agent, undefined, 'no raw user agent');
    assert.equal(e.properties.$timezone, undefined, 'no timezone');
    for (const [k, v] of Object.entries(e.properties)) {
      if (typeof v === 'string' && /^https?:/.test(v)) assert.ok(!/[?#]/.test(v), `${k} has no query or hash: ${v}`);
    }
  }

  assert.deepEqual([...new Set(posthogPaths.map((p) => p.split('/')[1]))].filter((p) => ['flags', 'decide', 'array', 'static'].includes(p)), [], 'no flag, decide, or script requests');
  assert.equal(storage.cookie, '', 'no cookies via document.cookie');
  assert.equal(cookies.length, 0, 'no cookies in the browser context');
  assert.equal(storage.local, 0, 'nothing in localStorage');
  assert.equal(storage.session, 0, 'nothing in sessionStorage');
  for (const h of hosts) assert.ok(h.startsWith('localhost') || h === 'us.i.posthog.com' || h === 'afdc.energy.gov', `unexpected host ${h}`);
});

test('Global Privacy Control: analytics never loads', async () => {
  const { events, posthogPaths, hosts } = await run({ gpc: true });
  assert.equal(events.length, 0);
  assert.equal(posthogPaths.length, 0);
  assert.ok(![...hosts].includes('us.i.posthog.com'));
});
