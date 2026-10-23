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
  assert.match(await page.locator('#tool-plan-range, #tool-plan-range-any').first().innerText(), /not that it’s unsafe/);
  const link = page.locator('.car-item a:has-text("rating source")').first();
  assert.match(await link.getAttribute('href'), /^https:\/\/www\.nhtsa\.gov\/ratings/);
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

test('reviewed research adds cargo and awards sorts, the IIHS filter, and linked awards', async () => {
  const context = await browser.newContext();
  await context.route('**/data/vehicles.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    const [a, b] = data.vehicles.filter((v) => v.class === 'suv');
    a.cargo = { value: 30, source: 'https://www.example-maker.com/specs', modelYear: a.modelYear };
    b.cargo = { value: 40, source: 'https://www.example-maker.com/specs', modelYear: b.modelYear };
    b.iihs = { award: 'TSP+', year: 2026, source: 'https://www.iihs.org/ratings', qualifier: 'built after March 2026' };
    b.awards = [{ name: 'World Car of the Year', publisher: 'World Car Awards', year: b.modelYear, url: 'https://www.worldcarawards.com/x' }];
    data.researchReviewedAt = '2026-10-23';
    await route.fulfill({ response: res, json: data });
  });
  const page = await openExplorer(context);
  const options = await page.$$eval('#car-sort option', (os) => os.map((o) => o.value));
  assert.ok(options.includes('cargo') && options.includes('awards'));
  await page.selectOption('#car-sort', 'cargo');
  const first = await page.locator('.car-item').first().innerText();
  assert.match(first, /40 cu ft behind the 2nd row/);
  assert.match(first, /IIHS Top Safety Pick\+ 2026 \(built after March 2026\)/);
  assert.equal(await page.locator('.car-item').first().locator('.car-awards a').getAttribute('href'), 'https://www.worldcarawards.com/x');
  await page.check('#car-tsp');
  assert.equal(await page.locator('.car-item').count(), 1);
  assert.match(await page.locator('#tool-plan-range, #tool-plan-range-any').first().innerText(), /AI-assisted research, checked source by source by a person/);
  await context.close();
});
