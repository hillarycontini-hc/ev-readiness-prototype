// Browser tests for the car explorer's sort and safety details: the default stays price, other
// sorts reorder, unrated cars say so and sort last, and analytics hears only the sort chosen.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TEST_CONFIG, completeFlow, decodePosthogBody, newVisitorContext, startServer } from './helpers.mjs';

let server;
let browser;
before(async () => {
  server = await startServer(8261);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.stop();
});

async function openExplorer(context) {
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302');
  await page.click('#plan-cta');
  await page.click('.tool-btn:has-text("Compare cars that fit")');
  await page.waitForSelector('.car-item');
  // Widen the budget so the order, not the budget, decides what shows.
  await page.check('#fin-mode-price');
  await page.fill('#fin-maxPrice', '300000');
  await page.locator('#fin-maxPrice').dispatchEvent('change');
  await page.uncheck('#car-cover-need');
  return page;
}

const rows = (page) => page.$$eval('.car-item', (items) => items.map((li) => ({
  name: li.querySelector('.car-name span:last-child').textContent,
  text: li.textContent,
})));

test('price is the default sort, and only sorts with data are offered', async () => {
  const context = await browser.newContext();
  const page = await openExplorer(context);
  assert.equal(await page.inputValue('#car-sort'), 'price');
  const options = await page.$$eval('#car-sort option', (os) => os.map((o) => o.value));
  assert.ok(['price', 'range', 'seats', 'safety'].every((k) => options.includes(k)));
  const prices = await page.$$eval('.car-item .row-figure', (fs) => fs.map((f) => Number(f.textContent.replace(/[^0-9]/g, ''))));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  await context.close();
});

test('sorting by safety puts rated cars first and says "Not yet rated" for the rest', async () => {
  const context = await browser.newContext();
  const page = await openExplorer(context);
  await page.selectOption('#car-sort', 'safety');
  const list = await rows(page);
  const firstUnrated = list.findIndex((r) => r.text.includes('NHTSA: Not yet rated'));
  assert.ok(firstUnrated > 0, 'some rated cars come first');
  assert.ok(list.slice(firstUnrated).every((r) => r.text.includes('Not yet rated')), 'every unrated car is after every rated one');
  assert.match(await page.locator('#tool-plan-range, #tool-plan-range-any').first().innerText(), /not that it is unsafe/);
  const link = page.locator('.car-item a:has-text("NHTSA record")').first();
  assert.match(await link.getAttribute('href'), /^https:\/\/api\.nhtsa\.gov\/SafetyRatings\//);
  await context.close();
});

test('sorting by range is longest first', async () => {
  const context = await browser.newContext();
  const page = await openExplorer(context);
  await page.selectOption('#car-sort', 'range');
  const ranges = (await rows(page)).map((r) => Number((r.text.match(/(\d+) mi EPA range/) || [])[1]));
  assert.deepEqual(ranges, [...ranges].sort((a, b) => b - a));
  await context.close();
});

test('analytics hears only which sort was chosen', async () => {
  const context = await newVisitorContext(browser);
  await context.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  const events = [];
  await context.route('https://us.i.posthog.com/**', (route) => {
    if (route.request().method() === 'POST') events.push(...decodePosthogBody(route.request()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  const page = await openExplorer(context);
  await page.selectOption('#car-sort', 'safety');
  await page.waitForTimeout(4500);
  const sorted = events.filter((e) => e.event === 'car_sorted');
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].properties.mode, 'safety');
  await context.close();
});
