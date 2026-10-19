// Browser tests for the EV plan tools: place search (proxy mocked), saved chargers, the car
// explorer, share links, resuming a saved plan, and what reaches analytics.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, startServer } from './helpers.mjs';

let server;
let browser;
before(async () => {
  server = await startServer(8211);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.stop();
});

const RENTER_WORK = { dailyMiles: 1, homeCharging: 2, workCharging: 0, longTrips: 2, outdoor: 2 };
const SEARCH = { results: [{ name: 'Pearl Street Office', detail: '1050 Walnut St, Boulder, CO 80302', lat: 40.0168, lon: -105.2797, type: 'building' }] };

async function openPlan(context, { geocode = SEARCH, status = 200 } = {}) {
  await context.route('**/api/geocode*', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? geocode : { error: 'search_unavailable' }) }));
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302', RENTER_WORK);
  await page.click('#plan-cta');
  return page;
}

test('find chargers near work by address, save one, and see it in the summary', async () => {
  const context = await browser.newContext();
  const page = await openPlan(context);
  await page.click('.tool-btn:has-text("Find chargers near work")');
  await page.fill('#search-work', 'Pearl Street Office');
  await page.click('#tool-plan-work form[role=search] button[type=submit]');
  await page.click('.result-btn >> nth=0');
  await page.waitForSelector('#tool-plan-work .station-item');
  assert.ok(await page.locator('#tool-plan-work .station-item').count() <= 6, 'shows six at first');
  const save = page.locator('#tool-plan-work .btn-save').first();
  await save.click();
  assert.equal(await save.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('#plan-summary').innerText().then((t) => t.includes('Pearl Street Office')));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('evrc-plan-v1')));
  assert.equal(stored.zip, '80302');
  assert.equal(stored.places[0].slot, 'work');
  assert.equal(Object.values(stored.saved)[0].length, 1);
  await context.close();
});

test('when address search is unavailable, a ZIP still works', async () => {
  const context = await browser.newContext();
  const page = await openPlan(context, { status: 503 });
  await page.click('.tool-btn:has-text("Find chargers near work")');
  await page.fill('#search-work', 'anything');
  await page.click('#tool-plan-work form[role=search] button[type=submit]');
  await page.waitForSelector('#zip-work:visible');
  assert.match(await page.locator('#tool-plan-work .tool-status').first().innerText(), /ZIP code instead/);
  await page.fill('#zip-work', '80301');
  await page.click('#tool-plan-work button:has-text("Use this ZIP")');
  await page.waitForSelector('#tool-plan-work .station-item');
  await context.close();
});

test('car explorer filters by monthly budget and shortlists at most three', async () => {
  const context = await browser.newContext();
  const page = await openPlan(context);
  await page.click('.tool-btn:has-text("Compare cars that fit")');
  await page.waitForSelector('.car-item');
  const before = await page.locator('.car-item').count();
  await page.fill('#fin-maxMonthly', '400');
  await page.locator('#fin-maxMonthly').dispatchEvent('change');
  assert.ok(await page.locator('.car-item').count() < before, 'a lower budget shows fewer cars');
  await page.fill('#fin-maxMonthly', '3000');
  await page.locator('#fin-maxMonthly').dispatchEvent('change');
  for (let i = 0; i < 3; i++) await page.locator('.car-item .btn-save:not([aria-pressed="true"])').first().click();
  assert.equal(await page.locator('.car-item .btn-save[aria-pressed="true"]').count(), 3);
  assert.ok(await page.locator('.car-item .btn-save:disabled').count() > 0, 'the rest are disabled at three');
  await page.check('#car-class-minivan');
  assert.match(await page.locator('#tool-plan-range-any .tool-note:has-text("minivan")').first().innerText(), /No fully electric minivan/);
  await context.close();
});

test('share links leave places out unless included, and open in a fresh browser', async () => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await openPlan(context);
  await page.click('.tool-btn:has-text("Find chargers near work")');
  await page.fill('#search-work', 'Pearl Street Office');
  await page.click('#tool-plan-work form[role=search] button[type=submit]');
  await page.click('.result-btn >> nth=0');
  await page.locator('#tool-plan-work .btn-save').first().click();
  await page.click('.tool-btn:has-text("Compare cars that fit")');
  await page.locator('.car-item .btn-save').first().click();

  await page.click('#plan-summary button:has-text("Copy a share link")');
  await page.waitForFunction(() => document.querySelector('.share-link')?.value.includes('#plan='));
  const withoutPlaces = await page.inputValue('.share-link');
  await page.check('#share-include-places');
  await page.click('#plan-summary button:has-text("Copy a share link")');
  await page.waitForFunction((prev) => document.querySelector('.share-link')?.value !== prev, withoutPlaces);
  const withPlaces = await page.inputValue('.share-link');
  assert.ok(withoutPlaces.includes('#plan='), `link: ${withoutPlaces.slice(0, 80)}`);
  assert.ok(withPlaces.length > withoutPlaces.length, `with ${withPlaces.length} vs without ${withoutPlaces.length}`);

  const other = await browser.newContext();
  const viewer = await other.newPage();
  await viewer.goto(withoutPlaces.replace(/^https?:\/\/[^/]+/, server.url));
  await viewer.waitForSelector('#plan-result:not([hidden])');
  assert.equal(await viewer.isVisible('#shared-banner'), true);
  const summary = await viewer.locator('#plan-summary').innerText();
  assert.ok(!summary.includes('Pearl Street Office'), 'places are not in the default link');
  assert.ok(/Cars on your shortlist/.test(summary), 'shortlist travels with the link');
  assert.ok(!viewer.url().includes('#plan='), 'the fragment is cleared after opening');
  await other.close();
  await context.close();
});

test('a saved plan can be resumed from the landing page and cleared', async () => {
  const context = await browser.newContext();
  const page = await openPlan(context);
  await page.locator('.plan-done input').first().check();
  await page.goto(server.url);
  await page.waitForSelector('#resume:not([hidden])');
  await page.click('#resume-btn');
  await page.waitForSelector('#plan-result:not([hidden])');
  assert.equal(await page.locator('.plan-done input').first().isChecked(), true);
  await page.goto(server.url);
  await page.click('#resume-clear');
  assert.equal(await page.evaluate(() => localStorage.getItem('evrc-plan-v1')), null);
  await context.close();
});

test('analytics never receives searched addresses, coordinates, or station names', async () => {
  const context = await newVisitorContext(browser);
  await context.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  const events = [];
  await context.route('https://us.i.posthog.com/**', (route) => {
    if (route.request().method() === 'POST') events.push(...decodePosthogBody(route.request()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  const page = await openPlan(context);
  await page.click('.tool-btn:has-text("Find chargers near work")');
  await page.fill('#search-work', 'Pearl Street Office');
  await page.click('#tool-plan-work form[role=search] button[type=submit]');
  await page.click('.result-btn >> nth=0');
  await page.locator('#tool-plan-work .btn-save').first().click();
  const stationName = await page.locator('#tool-plan-work .station-name span:not(.saved-mark)').first().innerText();
  await page.click('.tool-btn:has-text("Compare cars that fit")');
  await page.locator('.car-item .btn-save').first().click();
  await page.waitForTimeout(4500);
  const names = events.map((e) => e.event);
  for (const ev of ['plan_tool_opened', 'place_set', 'charger_saved', 'car_shortlisted']) assert.ok(names.includes(ev), ev);
  const raw = JSON.stringify(events);
  for (const secret of ['Pearl Street', 'Walnut', '40.0168', '-105.2797', '80302', stationName]) assert.ok(!raw.includes(secret), `analytics leaked ${secret}`);
  await context.close();
});

test('test-drive links go to official brand sites, with the ZIP only where a brand accepts it', async () => {
  const context = await browser.newContext();
  const page = await openPlan(context);
  await page.click('.tool-btn:has-text("Compare cars that fit")');
  await page.fill('#fin-maxMonthly', '3000');
  await page.locator('#fin-maxMonthly').dispatchEvent('change');
  await page.locator('.car-item:has-text("Kia") .btn-save').first().click();
  await page.locator('.car-item:has-text("Rivian") .btn-save').first().click();
  await page.click('.tool-btn:has-text("Book a test drive")');
  await page.waitForSelector('#tool-plan-test-drive .drive-links a');
  const links = await page.$$eval('#tool-plan-test-drive .drive-links a', (as) => as.map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel })));
  for (const l of links) {
    assert.match(l.href, /^https:\/\/(www\.)?(kia\.com|rivian\.com)\//, l.href);
    assert.equal(l.target, '_blank');
    assert.match(l.rel, /noopener/);
  }
  const kia = links.filter((l) => l.href.includes('kia.com'));
  assert.ok(kia.length === 2 && kia.every((l) => l.href.includes('zipCode=80302') && l.text.includes('near 80302')), JSON.stringify(kia));
  const rivian = links.filter((l) => l.href.includes('rivian.com'));
  assert.ok(rivian.length === 1 && !rivian[0].href.includes('80302'), JSON.stringify(rivian));
  assert.match(await page.locator('#tool-plan-test-drive .tool-note').last().innerText(), /passes that ZIP/);
  await context.close();
});
