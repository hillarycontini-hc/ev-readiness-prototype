// Browser tests for the trip planner (plan steps "Plan a charging stop for <park>" and
// "Rehearse your longest drive"): routing through the proxy (mocked here), fast-charging stops
// from the real station cells, step-through by keyboard, saving, the summary, share links,
// and what reaches analytics.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { RENTER_TRIPS, TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, startServer, tripRouteBody as routeBody } from './helpers.mjs';

let server;
let browser;
before(async () => {
  server = await startServer(8221);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.stop();
});


async function openPlan(context, { route = routeBody(), status = 200 } = {}) {
  const calls = [];
  await context.route('**/api/route*', (r) => {
    calls.push(r.request().url());
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? route : { error: status === 429 ? 'rate_limited' : 'route_unavailable' }) });
  });
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302', RENTER_TRIPS);
  await page.click('#plan-cta');
  return { page, calls };
}

async function planParkTrip(page) {
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');
}

test('plan a trip to the park, step through it by keyboard, and save it', async () => {
  const context = await browser.newContext();
  const { page, calls } = await openPlan(context);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  const checked = await page.locator('#tool-plan-park .trip-dest:has(input:checked)').innerText();
  assert.match(checked, /Great Sand Dunes/, 'the step’s park is chosen for you');
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '200', 'typical EPA range 300 / 1.5');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');

  assert.equal(calls.length, 1);
  const q = new URL(calls[0]).searchParams;
  assert.match(q.get('from'), /^40\.\d+,-105\.\d+$/, 'from the center of the ZIP');
  assert.match(q.get('to'), /^37\.\d+,-105\.\d+$/);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'trip-title', 'focus moves to the trip');

  const legs = page.locator('#tool-plan-park .trip-leg');
  const n = await legs.count();
  assert.ok(n >= 2, `at least one stop and the arrival (${n} legs)`);
  const figures = await page.$$eval('#tool-plan-park .trip-leg .row-figure', (els) => els.map((e) => parseInt(e.textContent.replace(/,/g, ''), 10)));
  for (const f of figures) assert.ok(f <= 200, `every leg is within 200 miles: ${figures}`);
  assert.match(await legs.first().innerText(), /Stop 1: [\s\S]*fast port/);
  assert.match(await legs.last().innerText(), /Arrive: Great Sand Dunes/);
  assert.equal(await legs.first().getAttribute('aria-current'), 'step');

  // Next by keyboard, to the end: focus stays on Next until it is disabled, then moves to Previous.
  const next = page.locator('#tool-plan-park .trip-stepper button:has-text("Next leg")');
  await next.focus();
  for (let i = 1; i < n; i++) await page.keyboard.press('Enter');
  assert.equal(await legs.last().getAttribute('aria-current'), 'step');
  assert.equal(await next.isDisabled(), true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Previous leg');
  assert.match(await page.locator('#tool-plan-park .trip-step-status').innerText(), new RegExp(`Leg ${n} of ${n}`));
  assert.equal(await page.locator('#tool-plan-park .trip-leg.is-passed').count(), n - 1);
  await page.keyboard.press('Enter');
  assert.equal(await legs.nth(n - 2).getAttribute('aria-current'), 'step');

  // Skip ahead.
  const prev = page.locator('#tool-plan-park .trip-stepper button:has-text("Previous leg")');
  while (!(await prev.isDisabled())) await prev.click();
  assert.equal(await legs.first().getAttribute('aria-current'), 'step');
  await page.click('#tool-plan-park button:has-text("Skip to arrival")');
  assert.equal(await legs.last().getAttribute('aria-current'), 'step');

  await page.click('#tool-plan-park .trip-save');
  assert.equal(await page.getAttribute('#tool-plan-park .trip-save', 'aria-pressed'), 'true');
  assert.match(await page.locator('#tool-plan-park .trip-saved').innerText(), /Saved trips \(1 of 3\)/);
  const summary = await page.locator('#plan-summary').innerText();
  assert.match(summary, /Trips you planned/);
  assert.match(summary, /ZIP 80302 to Great Sand Dunes/);
  assert.match(summary, /Mile \d+: /);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('evrc-plan-v1')));
  assert.equal(stored.trips.length, 1);
  assert.equal(stored.trips[0].step, 'plan-park');
  await context.close();
});

test('a saved trip is left out of share links unless places are included', async () => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const { page } = await openPlan(context);
  await planParkTrip(page);
  await page.click('#tool-plan-park .trip-save');
  await page.click('#plan-summary button:has-text("Copy a share link")');
  await page.waitForFunction(() => document.querySelector('.share-link')?.value.includes('#plan='));
  const without = await page.inputValue('.share-link');
  await page.check('#share-include-places');
  await page.click('#plan-summary button:has-text("Copy a share link")');
  await page.waitForFunction((prev) => document.querySelector('.share-link')?.value !== prev, without);
  const withTrips = await page.inputValue('.share-link');

  const other = await browser.newContext();
  const viewer = await other.newPage();
  await viewer.goto(without.replace(/^https?:\/\/[^/]+/, server.url));
  await viewer.waitForSelector('#plan-result:not([hidden])');
  assert.ok(!(await viewer.locator('#plan-summary').innerText()).includes('Trips you planned'), 'no trip in the default link');
  // A new page: changing only the fragment would not reload this one.
  const viewer2 = await other.newPage();
  await viewer2.goto(withTrips.replace(/^https?:\/\/[^/]+/, server.url));
  await viewer2.waitForSelector('#plan-result:not([hidden])');
  await viewer2.waitForFunction(() => document.querySelector('#plan-summary')?.innerText.includes('Great Sand Dunes'));
  await other.close();
  await context.close();
});

test('saved trips are capped at three and can be viewed offline and removed', async () => {
  const context = await browser.newContext();
  const { page, calls } = await openPlan(context);
  await planParkTrip(page);
  for (let i = 0; i < 3; i++) {
    if (i) await page.click('#tool-plan-park .trip-plan-btn');
    await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="false"]');
    await page.click('#tool-plan-park .trip-save');
    await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="true"]');
  }
  // Three saved; a fourth planned trip can't be saved until one is removed.
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="false"]');
  assert.equal(await page.isDisabled('#tool-plan-park .trip-save'), true);
  assert.match(await page.locator('#tool-plan-park .trip-saved-title').innerText(), /3 of 3/);
  const before = calls.length;
  await page.click('#tool-plan-park .trip-saved-list li:first-child button:has-text("View")');
  assert.equal(calls.length, before, 'viewing a saved trip needs no network');
  assert.equal(await page.getAttribute('#tool-plan-park .trip-save', 'aria-pressed'), 'true');
  await page.click('#tool-plan-park .trip-saved-list li:first-child button:has-text("Remove")');
  assert.match(await page.locator('#tool-plan-park .trip-saved-title').innerText(), /2 of 3/);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'trip-saved-title', 'focus lands on the list after removing');
  await context.close();
});

test('rehearse a drive to a searched place; routing errors are explained', async () => {
  const context = await browser.newContext();
  await context.route('**/api/geocode*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Alamosa', detail: 'Alamosa, CO, United States', lat: 37.4695, lon: -105.87, type: 'city' }] }) }));
  const { page } = await openPlan(context, { status: 429 });
  await page.click('.tool-btn:has-text("Plan a trip")');
  await page.waitForSelector('#tool-plan-route .trip-plan-btn');
  assert.equal(await page.locator('#tool-plan-route .trip-dest input:checked').count(), 0, 'no destination is assumed');
  await page.click('#tool-plan-route .trip-plan-btn');
  assert.match(await page.locator('#tool-plan-route > .tool-status').innerText(), /Choose where you’re going/);
  await page.fill('#search-trip-plan-route-search', 'Alamosa');
  await page.click('#tool-plan-route form[role=search] button[type=submit]');
  await page.click('#tool-plan-route .result-btn');
  assert.match(await page.locator('#tool-plan-route .trip-dest:has(input:checked)').innerText(), /Alamosa/);
  await page.click('#tool-plan-route .trip-plan-btn');
  await page.waitForFunction(() => /Too many trips/.test(document.querySelector('#tool-plan-route > .tool-status')?.textContent || ''));
  await context.close();
});

test('analytics gets trip events with coarse values only', async () => {
  const context = await newVisitorContext(browser);
  await context.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  const events = [];
  await context.route('https://us.i.posthog.com/**', (route) => {
    if (route.request().method() === 'POST') events.push(...decodePosthogBody(route.request()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  const { page } = await openPlan(context);
  await planParkTrip(page);
  const stopName = await page.locator('#tool-plan-park .trip-leg .station-name').first().innerText();
  await page.click('#tool-plan-park .trip-stepper button:has-text("Next leg")');
  await page.click('#tool-plan-park .trip-save');
  await page.waitForTimeout(4500);
  const trip = events.filter((e) => e.event.startsWith('trip_'));
  const names = trip.map((e) => e.event);
  for (const ev of ['trip_planned', 'trip_step', 'trip_saved']) assert.ok(names.includes(ev), `${ev} in ${names}`);
  const planned = trip.find((e) => e.event === 'trip_planned').properties;
  assert.ok(['0', '1', '2-3', '4+'].includes(planned.stops), planned.stops);
  assert.equal(planned.dest, 'park');
  assert.equal(planned.result, 'ok');
  assert.equal(trip.find((e) => e.event === 'trip_step').properties.direction, 'next');
  // Names can be searched for anywhere in the payload. Numbers are checked against what our code
  // sends (non-$ properties): PostHog's own timestamps and random ids can contain any digits.
  const raw = JSON.stringify(events);
  for (const secret of ['Great Sand Dunes', '80302', stopName.replace(/^Stop 1: /, '')]) {
    assert.ok(!raw.includes(secret), `analytics leaked ${secret}`);
  }
  const ours = JSON.stringify(events.map((e) => Object.fromEntries(Object.entries(e.properties || {}).filter(([k]) => !k.startsWith('$')))));
  for (const secret of ['37.73', '-105.51', '40.01', '-105.27', '262', '245']) {
    assert.ok(!ours.includes(secret), `analytics leaked ${secret}`);
  }
  for (const e of trip) {
    for (const [k, v] of Object.entries(e.properties)) if (!k.startsWith('$')) assert.ok(typeof v !== 'number' || v <= 3, `only small counts go out: ${e.event} ${k}=${v}`);
  }
  await context.close();
});
