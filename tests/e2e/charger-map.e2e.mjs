// Browser tests for the charger map on the "Nearest fast charger" card: it loads only when the card
// opens, asks our server for a grid view (never the ZIP), numbers pins to match the list, falls back
// to a drawn plot when the street map can't load, and reports only which of the two was shown.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, startServer } from './helpers.mjs';

let server;
let browser;
let png;
before(async () => {
  server = await startServer(8251);
  browser = await chromium.launch();
  const probe = await browser.newPage();
  await probe.setViewportSize({ width: 64, height: 40 });
  await probe.setContent('<body style="margin:0;background:#f4f1ea"></body>');
  png = await probe.screenshot();
  await probe.close();
});
after(async () => {
  await browser?.close();
  server?.stop();
});

async function openCard(context, mode = 'static') {
  const requests = [];
  await context.route('**/api/map*', (r) => {
    requests.push(r.request().url());
    return mode === 'static'
      ? r.fulfill({ status: 200, contentType: 'image/png', body: png })
      : r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"map_unavailable"}' });
  });
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302');
  assert.equal(requests.length, 0, 'no map is requested while the card is closed');
  await page.click('.stop.s-charger .stop-btn');
  await page.waitForSelector(mode === 'static' ? '.charger-map .map-img' : '.charger-map .map-frame.is-fallback');
  await page.waitForSelector('.charger-map .map-list li');
  return { page, requests };
}

test('the map asks for a grid view only, and its pins match the numbered list', async () => {
  const context = await browser.newContext();
  const { page, requests } = await openCard(context);
  await page.waitForFunction(() => document.querySelector('.charger-map .map-img')?.complete);
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['x', 'y', 'z'], 'only the view, never the ZIP or a coordinate');
  assert.ok(!requests[0].includes('80302'));
  const pins = await page.locator('.map-pin').count();
  assert.ok(pins >= 1 && pins <= 8);
  assert.equal(await page.locator('.map-list li').count(), pins);
  assert.match(await page.getAttribute('.map-img', 'alt'), /ZIP 80302.*numbered by distance/);
  const numbers = await page.$$eval('.map-pin text', (ts) => ts.map((t) => t.textContent));
  assert.deepEqual(numbers, Array.from({ length: pins }, (_, i) => String(i + 1)));
  const miles = await page.$$eval('.map-list .map-miles', (ms) => ms.map((m) => parseFloat(m.textContent.replace('<', ''))));
  assert.deepEqual(miles, [...miles].sort((a, b) => a - b), 'nearest first');
  // Closing and reopening the card does not fetch again.
  await page.click('.stop.s-charger .stop-btn');
  await page.click('.stop.s-charger .stop-btn');
  assert.equal(requests.length, 1);
  await context.close();
});

test('when the street map is unavailable, a drawn plot keeps the same pins and says why', async () => {
  const context = await browser.newContext();
  const { page } = await openCard(context, 'fallback');
  const plot = page.locator('.map-frame.is-fallback svg');
  assert.equal(await plot.getAttribute('role'), 'img');
  assert.match(await plot.getAttribute('aria-label'), /street map is unavailable/);
  assert.equal(await page.locator('.map-pin').count(), await page.locator('.map-list li').count());
  assert.match(await page.locator('.map-caption').innerText(), /ring is 1 mile/);
  await context.close();
});

test('analytics hears only which map was shown', async () => {
  const context = await newVisitorContext(browser);
  await context.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  const events = [];
  await context.route('https://us.i.posthog.com/**', (route) => {
    if (route.request().method() === 'POST') events.push(...decodePosthogBody(route.request()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  const { page } = await openCard(context);
  const station = await page.locator('.map-list .map-name span').first().innerText();
  await page.waitForTimeout(4500);
  const map = events.filter((e) => e.event === 'map_rendered');
  assert.equal(map.length, 1);
  assert.equal(map[0].properties.source, 'static');
  const raw = JSON.stringify(events);
  for (const secret of ['80302', station, 'api/map?']) assert.ok(!raw.includes(secret), `analytics leaked ${secret}`);
  await context.close();
});
