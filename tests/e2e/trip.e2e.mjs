// Browser tests for the trip planner (plan steps "Plan a charging stop for <park>" and
// "Rehearse your longest drive"): routing through the proxy (mocked here), fast-charging stops
// from the real station cells, step-through by keyboard, saving, the summary, share links,
// and what reaches analytics.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LONGEST_CAR, RENTER_TRIPS, TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, shortlistCars, startServer, tripRouteBody as routeBody } from './helpers.mjs';

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
  const checked = await page.locator('#tool-plan-park .trip-to .trip-dest:has(input:checked)').innerText();
  assert.match(checked, /Great Sand Dunes/, 'the step’s park is chosen for you');
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '210', 'typical EPA range 300 x 70%');
  assert.equal(await page.locator('#tool-plan-park .trip-plan-btn').innerText(), 'Find charging stops', 'the submit is named for what it does, unlike the step’s button');
  // Plug help opens and closes in place.
  await page.click('#tool-plan-park .trip-help summary');
  assert.match(await page.locator('#tool-plan-park .trip-help').innerText(), /North American Charging Standard/);
  await page.click('#tool-plan-park .trip-help summary');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');

  assert.equal(calls.length, 1);
  const q = new URL(calls[0]).searchParams;
  assert.match(q.get('from'), /^40\.\d+,-105\.\d+$/, 'from the center of the ZIP');
  assert.match(q.get('to'), /^37\.\d+,-105\.\d+$/);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'trip-title', 'focus moves to the trip');
  // The settings it was planned with stay under the title.
  assert.equal(await page.locator('#tool-plan-park .trip-settings').textContent(), 'Typical electric SUV · 210 mi between charges · Either plug Change the car, miles, or plug');

  const legs = page.locator('#tool-plan-park .trip-leg');
  const n = await legs.count();
  assert.ok(n >= 2, `at least one stop and the arrival (${n} legs)`);
  const figures = await page.$$eval('#tool-plan-park .trip-leg .row-figure', (els) => els.map((e) => parseInt(e.textContent.replace(/,/g, ''), 10)));
  for (const f of figures) assert.ok(f <= 210, `every leg is within 210 miles: ${figures}`);
  assert.match(await legs.first().innerText(), /Stop 1: [\s\S]*fast port/);
  // The open leg reads in order: where it is, what's left, the address, then plug details folded away.
  const open = page.locator('#tool-plan-park .trip-leg[aria-current="step"]');
  assert.match(await open.locator('.leg-key').first().innerText(), /^Road mile \d+/);
  assert.match(await open.locator('.leg-key').nth(1).innerText(), /You’d arrive with about \d+ of your 210 planned miles left/);
  assert.equal(await open.locator('.leg-more').getAttribute('open'), null, 'plug details start closed');
  await open.locator('.leg-more summary').click();
  assert.match(await open.locator('.leg-more').innerText(), /Hours:[\s\S]*Price:/);
  // Time and cost estimates, labeled.
  // The answer leads; two figures frame it; time and money share one line.
  assert.match(await page.locator('#tool-plan-park .trip-answer').innerText(), /^1 fast-charging stop: Pueblo \(road mile \d+\)\.$/);
  assert.equal(await page.locator('#tool-plan-park .trip-totals dd').count(), 2);
  assert.match(await page.locator('#tool-plan-park .trip-cost-line').innerText(), /^Plus about 20–45 min of charging\. About \$\d+[–\d]* of electricity, vs about \$\d+ of gas/);
  // With "Either plug", the planner picks a CCS stop here rather than the NACS-only site nearby.
  assert.equal(await page.locator('#tool-plan-park .plug-chip').count(), 0);
  assert.equal(await page.locator('#tool-plan-park .trip-plug-warn').count(), 0);
  // The drive home doesn't fit (98 planned miles left, 107 to the first charger back): it's said
  // up front, under the answer, with the nearest fast charger to the park named.
  const homeWarn = page.locator('#tool-plan-park .trip-home-warn');
  assert.match(await homeWarn.innerText(), /^Getting home: charge before you head back\. The first fast charger on the way back is about \d+ miles away, and you’d arrive with about \d+ of your planned miles\. The nearest fast charger to the park is .+ \(NACS only\), about \d+ miles from it in a straight line\.$/);
  assert.ok(await page.locator('#tool-plan-park .trip-answer + .trip-home-warn').count(), 'right under the answer');
  await page.click('#tool-plan-park .trip-cost-note summary');
  assert.match(await page.locator('#tool-plan-park .trip-cost-note').innerText(), /Electricity for this drive: about \$\d+[–\d]*[\s\S]*gas car: about \$\d+/);
  assert.match(await legs.last().innerText(), /Arrive: Great Sand Dunes/);
  assert.equal(await legs.first().getAttribute('aria-current'), 'step');

  // Next by keyboard, to the end: focus stays on Next until it is disabled, then moves to Previous.
  const next = page.locator('#tool-plan-park .trip-stepper button:has-text("Next leg")');
  await next.focus();
  for (let i = 1; i < n; i++) await page.keyboard.press('Enter');
  assert.equal(await legs.last().getAttribute('aria-current'), 'step');
  assert.match(await legs.last().locator('.trip-home').innerText(), /^Getting home: The first fast charger on the way back is about \d+ miles away, more than the \d+ planned miles you’d have left\. Charge near Great Sand Dunes/);
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

  // A leg's title opens it in place and moves the step-through there; focus stays on the title.
  const firstTitle = legs.first().locator('.trip-leg-btn');
  assert.equal(await firstTitle.getAttribute('aria-expanded'), 'false');
  await firstTitle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await legs.first().getAttribute('aria-current'), 'step');
  assert.equal(await legs.last().getAttribute('aria-current'), null);
  assert.equal(await firstTitle.getAttribute('aria-expanded'), 'true');
  assert.equal(await legs.last().locator('.trip-leg-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('trip-leg-btn')), true, 'focus stays on the title used');
  assert.match(await page.locator('#tool-plan-park .trip-step-status').innerText(), /^Leg 1 of \d+: \d+ miles\. Stop 1: /);
  assert.equal(await page.isDisabled('#tool-plan-park .trip-stepper button:has-text("Previous leg")'), true);
  await legs.last().locator('.trip-leg-btn').click();
  assert.equal(await legs.last().getAttribute('aria-current'), 'step');

  await page.click('#tool-plan-park .trip-save');
  assert.equal(await page.getAttribute('#tool-plan-park .trip-save', 'aria-pressed'), 'true');
  assert.match(await page.locator('#tool-plan-park .trip-saved').innerText(), /Saved trips \(1 of 3\)/);
  const summary = await page.locator('#plan-summary').innerText();
  assert.match(summary, /Trips you planned/);
  assert.match(summary, /ZIP 80302 to Great Sand Dunes/);
  assert.match(summary, /Typical electric SUV · 210 mi between charges · Either plug/);
  assert.match(summary, /Daily range you need/);
  assert.match(summary, /Road mile \d+: /);
  assert.match(summary, /Getting home: /);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('evrc-plan-v1')));
  assert.equal(stored.trips.length, 1);
  assert.equal(stored.trips[0].step, 'plan-park');
  assert.equal(stored.trips[0].car, 'Typical electric SUV');
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
    if (i) {
      await page.fill('#trip-plan-park-leg', String(210 - i * 10));
      await page.locator('#trip-plan-park-leg').dispatchEvent('change');
      await page.click('#tool-plan-park .trip-plan-btn');
    }
    await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="false"]');
    await page.click('#tool-plan-park .trip-save');
    await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="true"]');
  }
  // Each saved trip shows its settings, so trips to the same park can be told apart.
  assert.deepEqual(await page.locator('#tool-plan-park .trip-saved-list .trip-settings').allInnerTexts(),
    [210, 200, 190].map((m) => `Typical electric SUV · ${m === 210 ? '' : 'Custom: '}${m} mi between charges · Either plug`));
  // View and Remove are at least 44 px wide and tall.
  for (const b of await page.locator('#tool-plan-park .trip-saved-actions .btn-link').all()) {
    const box = await b.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${await b.innerText()} is ${box.width}x${box.height}`);
  }
  // Three saved; a fourth planned trip can't be saved until one is removed.
  await page.fill('#trip-plan-park-leg', '180');
  await page.locator('#trip-plan-park-leg').dispatchEvent('change');
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

test('the same trip with the same settings can only be saved once', async () => {
  const context = await browser.newContext();
  const { page } = await openPlan(context);
  await planParkTrip(page);
  await page.click('#tool-plan-park .trip-save');
  await page.waitForSelector('#tool-plan-park .trip-save[aria-pressed="true"]');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-save:has-text("Already saved")');
  assert.equal(await page.isDisabled('#tool-plan-park .trip-save'), true);
  assert.match(await page.locator('#tool-plan-park .trip-save-note').innerText(), /same settings already\. It’s in Saved trips below/);
  // Another plug makes it a different trip.
  await page.selectOption('#trip-plan-park-plug', 'ccs');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-save:has-text("Save this trip")');
  assert.equal(await page.isDisabled('#tool-plan-park .trip-save'), false);
  await context.close();
});

test('"Change" puts the shown trip back in the form and moves focus to it', async () => {
  const context = await browser.newContext();
  const { page } = await openPlan(context);
  await planParkTrip(page);
  await page.click('#tool-plan-park .trip-save');
  await page.fill('#trip-plan-park-leg', '180');
  await page.locator('#trip-plan-park-leg').dispatchEvent('change');
  await page.selectOption('#trip-plan-park-plug', 'ccs');
  // Viewing the saved trip, then Change: the form shows that trip's settings again.
  await page.click('#tool-plan-park .trip-saved-list button:has-text("View")');
  const change = page.locator('#tool-plan-park .trip-settings button:has-text("Change")');
  assert.equal(await change.textContent(), 'Change the car, miles, or plug', 'screen readers hear what Change is for');
  await change.click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'trip-plan-park-leg', 'with no car to choose, focus moves to the miles');
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '210');
  assert.equal(await page.inputValue('#trip-plan-park-plug'), 'any');
  assert.match(await page.locator('#tool-plan-park .trip-to .trip-dest:has(input:checked)').innerText(), /Great Sand Dunes/);
  await context.close();
});

test('shortlisted cars are radio choices with their EPA range; Change restores the car', async () => {
  const context = await browser.newContext();
  const { page } = await openPlan(context);
  await shortlistCars(page, [LONGEST_CAR, 'chevrolet-silverado-ev']);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  const group = page.locator('#tool-plan-park fieldset.trip-basis');
  assert.equal(await group.locator('legend').innerText(), 'Plan for');
  assert.deepEqual(await group.locator('.trip-dest').allInnerTexts(), [
    'Mercedes-Benz G 580 Electric\nLowest EPA range 249 mi',
    'Chevrolet Silverado EV\nLowest EPA range 283 mi',
    'Typical electric SUV\nLowest EPA range 300 mi (the median)',
  ], 'shortest range first, the typical car last');
  assert.equal(await page.isChecked('#trip-plan-park-basis-0'), true);
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '175', '249 x 70%, to the nearest 5');
  await page.check('#trip-plan-park-basis-2');
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '210');
  await page.check('#trip-plan-park-basis-0');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');
  assert.match(await page.locator('#tool-plan-park .trip-settings').innerText(), /^Mercedes-Benz G 580 Electric · 175 mi between charges/);
  // Another car in the form, then Change: the planned car is chosen again and has focus.
  await page.check('#trip-plan-park-basis-1');
  await page.click('#tool-plan-park .trip-settings button:has-text("Change")');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'trip-plan-park-basis-0', 'focus moves to the planned car');
  assert.equal(await page.isChecked('#trip-plan-park-basis-0'), true);
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '175');
  await context.close();
});

test('with no shortlisted car, "Plan for" is plain text, not a one-option control', async () => {
  const context = await browser.newContext();
  const { page } = await openPlan(context);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  assert.equal(await page.locator('#tool-plan-park .trip-basis, #tool-plan-park select#trip-plan-park-basis').count(), 0);
  assert.equal(await page.locator('#tool-plan-park .trip-basis-one').innerText(), 'Plan for Typical electric SUV\nLowest EPA range 300 mi (the median)');
  await context.close();
});

test('a trip that does not work explains why and offers a one-tap fix', async () => {
  const context = await browser.newContext();
  const { page, calls } = await openPlan(context);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  await page.fill('#trip-plan-park-leg', '60');
  await page.locator('#trip-plan-park-leg').dispatchEvent('change');
  await page.selectOption('#trip-plan-park-plug', 'ccs');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-gap');
  const why = await page.locator('#tool-plan-park .trip-gap-why').innerText();
  assert.match(why, /^This trip doesn’t work yet\. There’s no CCS fast charger for the last \d+ miles, from road mile \d+ near Pueblo to Great Sand Dunes[\s\S]*can be saved once every leg fits/);
  assert.equal(await page.locator('#tool-plan-park .trip-save').count(), 0, 'a trip that does not work cannot be saved');
  assert.equal(await page.locator('#tool-plan-park .trip-partial').getAttribute('open'), null, 'the partial list starts folded');
  const fix = page.locator('#tool-plan-park .trip-fix');
  assert.equal(await fix.count(), 1, 'no plug button when a plug change would not help');
  // The car's own miles work, so that's the fix offered, not the bare minimum.
  assert.equal(await fix.innerText(), 'Plan with your car’s 210 miles between charges');
  assert.match(await fix.getAttribute('class'), /btn-go/);
  assert.match(await page.locator('#tool-plan-park .trip-gap .tool-note').innerText(), /^210 is 70% of this car’s lowest EPA range/);
  const before = calls.length;
  await fix.click();
  await page.waitForSelector('#tool-plan-park .trip-save');
  assert.equal(calls.length, before, 'the fix reuses the route: no new routing call');
  assert.equal(await page.inputValue('#trip-plan-park-leg'), '210', 'the fix sets the field it changed');
  assert.match(await page.locator('#tool-plan-park .trip-settings').innerText(), /^Typical electric SUV · 210 mi between charges/, 'back on the car’s own rule, so not marked custom');
  assert.equal(await page.locator('#tool-plan-park .trip-gap').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'trip-title', 'focus moves to the working trip');
  await context.close();
});

test('a NACS-only stop is tagged and flagged, with a one-tap CCS-only plan', async () => {
  const context = await browser.newContext();
  // The only fast charger on the way: a NACS-only site in Pueblo.
  await context.route('**/data/stations/*.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(r.request().url().endsWith('/76_-210.json') ? [[900001, 'Pueblo NACS Site', '1 Main St', 'Pueblo', 38.26, -104.61, 0, 8, 'Network X', 'N', '24 hours daily', '']] : []) }));
  const { page, calls } = await openPlan(context);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-warn');
  assert.equal((await page.locator('#tool-plan-park .trip-leg .plug-chip').textContent()), 'NACS only');
  assert.match(await page.locator('#tool-plan-park .trip-warn').innerText(), /^Check your car’s plug\. 1 stop has only a NACS plug/);
  const before = calls.length;
  await page.click('#tool-plan-park .trip-warn button:has-text("Plan with CCS only")');
  await page.waitForSelector('#tool-plan-park .trip-gap');
  assert.equal(calls.length, before, 'replanning reuses the route');
  assert.equal(await page.inputValue('#trip-plan-park-plug'), 'ccs', 'the plug field shows what changed');
  assert.match(await page.locator('#tool-plan-park .trip-gap-why').innerText(), /no CCS fast charger along the 262-mile route/);
  // Either plug works with this car, so it leads; more miles than the car can drive is quiet and says why.
  const fixes = page.locator('#tool-plan-park .trip-fix');
  assert.deepEqual(await fixes.allInnerTexts(), ['Plan with either plug', 'Plan with 265 miles between charges']);
  assert.match(await fixes.nth(0).getAttribute('class'), /btn-go/);
  assert.match(await fixes.nth(1).getAttribute('class'), /btn-quiet/);
  assert.match(await page.locator('#tool-plan-park .trip-gap .tool-note').innerText(), /265 miles between charges takes a car with about 380 miles of EPA range; this one has 300\./);
  await context.close();
});

test('a park whose map point has no road is routed to its visitor center', async () => {
  const context = await browser.newContext();
  const routed = [];
  // Like Great Sand Dunes: the Park Service point is in the dunes, so the router finds no road to it.
  await context.route('**/api/route*', (r) => {
    const to = new URL(r.request().url()).searchParams.get('to');
    routed.push(to);
    return to.startsWith('37.793,')
      ? r.fulfill({ status: 422, contentType: 'application/json', body: '{"error":"no_route"}' })
      : r.fulfill({ contentType: 'application/json', body: JSON.stringify(routeBody()) });
  });
  const searched = [];
  await context.route('**/api/geocode*', (r) => {
    searched.push(new URL(r.request().url()).searchParams.get('q'));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Great Sand Dunes National Park Visitor Center', detail: '11999 Mosca Pass Trail, Mosca, CO 81146', lat: 37.733, lon: -105.5123, type: 'amenity' }] }) });
  });
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302', RENTER_TRIPS);
  await page.click('#plan-cta');
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');
  assert.deepEqual(routed, ['37.793,-105.592', '37.733,-105.5123'], 'tried the park point, then the visitor center');
  assert.deepEqual(searched, ['Great Sand Dunes National Park & Preserve visitor center']);
  assert.match(await page.locator('#tool-plan-park .trip-leg:last-child .station-meta').innerText(), /to the visitor center$/);
  await context.close();
});

test('the start can be changed to a searched place', async () => {
  const context = await browser.newContext();
  await context.route('**/api/geocode*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Longmont', detail: 'Longmont, CO, United States', lat: 40.1672, lon: -105.1019, type: 'city' }] }) }));
  const { page, calls } = await openPlan(context);
  await page.click('.tool-btn:has-text("Plan the trip")');
  await page.waitForSelector('#tool-plan-park .trip-plan-btn');
  assert.match(await page.locator('#tool-plan-park .trip-from').innerText(), /From the center of ZIP 80302/);
  await page.click('#tool-plan-park .trip-from button:has-text("Change start")');
  await page.fill('#search-trip-plan-park-from-search', 'Longmont');
  await page.click('#tool-plan-park .trip-from-panel form[role=search] button[type=submit]');
  await page.click('#tool-plan-park .trip-from-panel .result-btn');
  assert.match(await page.locator('#tool-plan-park .trip-from').innerText(), /From Longmont/);
  await page.click('#tool-plan-park .trip-plan-btn');
  await page.waitForSelector('#tool-plan-park .trip-legs');
  assert.equal(new URL(calls.at(-1)).searchParams.get('from'), '40.1672,-105.1019');
  assert.match(await page.locator('#tool-plan-park .trip-title').innerText(), /^Longmont to /i);
  await context.close();
});

test('rehearse a drive to a searched place; routing errors are explained', async () => {
  const context = await browser.newContext();
  await context.route('**/api/geocode*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Alamosa', detail: 'Alamosa, CO, United States', lat: 37.4695, lon: -105.87, type: 'city' }] }) }));
  const { page } = await openPlan(context, { status: 429 });
  await page.click('.tool-btn:has-text("Plan a trip")');
  await page.waitForSelector('#tool-plan-route .trip-plan-btn');
  assert.equal(await page.locator('#tool-plan-route .trip-to .trip-dest input:checked').count(), 0, 'no destination is assumed');
  await page.click('#tool-plan-route .trip-plan-btn');
  assert.match(await page.locator('#tool-plan-route > .tool-status').innerText(), /Choose where you’re going/);
  await page.fill('#search-trip-plan-route-search', 'Alamosa');
  await page.click('#tool-plan-route > .place-search form[role=search] button[type=submit]');
  await page.click('#tool-plan-route .result-btn');
  assert.match(await page.locator('#tool-plan-route .trip-to .trip-dest:has(input:checked)').innerText(), /Alamosa/);
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
