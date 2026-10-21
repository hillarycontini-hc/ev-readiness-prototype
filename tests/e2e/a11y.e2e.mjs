// Accessibility: axe-core (WCAG 2.0/2.1 A and AA rules) on every view,
// in light and dark mode, at desktop and 320px width, plus a keyboard-only run.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { RENTER_TRIPS, completeFlow, startServer, tripRouteBody } from './helpers.mjs';

let server;
let browser;
before(async () => {
  server = await startServer(8191);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.stop();
});

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scan(page, label) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const problems = results.violations.map((v) => `${label}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`);
  return problems;
}

const VIEWS = {
  landing: async () => {},
  'zip error': async (page) => {
    await page.fill('#zip', '12');
    await page.click('#zip-form button[type=submit]');
    await page.waitForSelector('#zip-error:not([hidden])');
  },
  question: async (page) => {
    await page.fill('#zip', '80302');
    await page.click('#zip-form button[type=submit]');
    await page.waitForSelector('#view-question:not([hidden])');
  },
  'question error': async (page) => {
    await page.fill('#zip', '80302');
    await page.click('#zip-form button[type=submit]');
    await page.waitForSelector('#view-question:not([hidden])');
    await page.click('#question-next');
    await page.waitForSelector('#question-error:not([hidden])');
  },
  'results (all answered)': async (page) => completeFlow(page, '80302'),
  'results with EV plan open': async (page) => {
    await completeFlow(page, '80302');
    await page.click('#plan-cta');
    await page.waitForSelector('#plan-result:not([hidden])');
  },
  'plan tools open': async (page) => {
    await completeFlow(page, '80302');
    await page.click('#plan-cta');
    await page.click('.tool-btn:has-text("Find chargers near work")');
    await page.click('#tool-plan-work .tool-note .btn-link');
    await page.fill('#zip-work', '80302');
    await page.click('#tool-plan-work button:has-text("Use this ZIP")');
    await page.waitForSelector('#tool-plan-work .station-item');
    await page.locator('#tool-plan-work .btn-save').first().click();
    await page.click('.tool-btn:has-text("Compare cars that fit")');
    await page.waitForSelector('.car-item');
    await page.locator('.car-item .btn-save').first().click();
    await page.click('.tool-btn:has-text("Book a test drive")');
    await page.waitForSelector('#tool-plan-test-drive .drive-list, #tool-plan-test-drive .tool-note');
  },
  'trip planner open, stepped, and saved': async (page) => {
    await page.route('**/api/route*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(tripRouteBody()) }));
    await completeFlow(page, '80302', RENTER_TRIPS);
    await page.click('#plan-cta');
    await page.click('.tool-btn:has-text("Plan the trip")');
    await page.click('#tool-plan-park .trip-plan-btn');
    await page.waitForSelector('#tool-plan-park .trip-legs');
    await page.click('#tool-plan-park button:has-text("Next leg")');
    await page.locator('#tool-plan-park .trip-leg-btn').first().click();
    await page.click('#tool-plan-park .trip-save');
    await page.click('#tool-plan-park .trip-leg[aria-current="step"] .leg-more summary').catch(() => {});
    await page.click('#tool-plan-park .trip-help summary');
    await page.click('#tool-plan-park .trip-from button:has-text("Change start")');
    await page.click('.tool-btn:has-text("Plan a trip")');
    await page.waitForSelector('#tool-plan-route .trip-saved-list');
  },
  'trip planner, a trip that does not work yet': async (page) => {
    await page.route('**/api/route*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(tripRouteBody()) }));
    await completeFlow(page, '80302', RENTER_TRIPS);
    await page.click('#plan-cta');
    await page.click('.tool-btn:has-text("Plan the trip")');
    await page.fill('#trip-plan-park-leg', '60');
    await page.locator('#trip-plan-park-leg').dispatchEvent('change');
    await page.selectOption('#trip-plan-park-plug', 'ccs');
    await page.click('#tool-plan-park .trip-plan-btn');
    await page.waitForSelector('#tool-plan-park .trip-gap');
    await page.click('#tool-plan-park .trip-partial summary');
  },
  'results (ZIP only)': async (page) => {
    await page.fill('#zip', '10001');
    await page.click('#zip-form button[type=submit]');
    await page.click('#question-skip-all');
    await page.waitForSelector('#view-results:not([hidden])');
    await page.click('.method summary'); // open "How we calculated this"
  },
};

for (const colorScheme of ['light', 'dark']) {
  for (const width of [1280, 320]) {
    test(`axe: no WCAG A/AA violations (${colorScheme}, ${width}px)`, async () => {
      const problems = [];
      for (const [name, go] of Object.entries(VIEWS)) {
        const context = await browser.newContext({ colorScheme, viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.goto(server.url);
        await go(page);
        problems.push(...(await scan(page, name)));
        if (width === 320) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 0) problems.push(`${name}: horizontal scroll of ${overflow}px at 320px (WCAG 1.4.10 reflow)`);
        }
        await context.close();
      }
      assert.deepEqual(problems, []);
    });
  }
}

test('keyboard only: ZIP to results without a mouse, focus always visible and moved to each new view', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.url);

  // Skip link is the first tab stop.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');

  await page.focus('#zip');
  await page.keyboard.type('80302');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-question:not([hidden])');

  for (let i = 0; !(await page.isVisible('#view-results')); i++) {
    assert.ok(i < 6, 'reaches results within the question count');
    const focused = await page.evaluate(() => document.activeElement.id);
    assert.equal(focused, 'question-legend', `focus moves to question ${i + 1}`);
    await page.keyboard.press('Tab'); // into the radio group
    assert.equal(await page.evaluate(() => document.activeElement.type), 'radio');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#view-question:not([hidden]) #question-legend:focus, #view-results:not([hidden])');
  }
  assert.equal(await page.evaluate(() => document.activeElement.id), 'results-title', 'focus moves to the verdict');

  // Every interactive element on the results page can be reached by Tab, with a visible focus outline.
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      const label = el.closest('.option') ? getComputedStyle(el.closest('.option')) : null;
      return {
        key: `${el.tagName}#${el.id}.${el.textContent.trim().slice(0, 30)}`,
        outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
        labelOutline: label ? label.outlineStyle !== 'none' : false,
      };
    });
    if (info.key.startsWith('BODY')) break;
    assert.ok(info.outline || info.labelOutline, `visible focus on ${info.key}`);
    seen.add(info.key);
  }
  assert.ok([...seen].some((k) => k.startsWith('A#')), 'links reachable');
  assert.ok([...seen].some((k) => k.includes('start-over')), 'start over reachable');
  await context.close();
});

test('route stops open and close by keyboard, and report their state', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.url);
  await completeFlow(page, '80302');
  const btn = page.locator('.stop-btn').nth(1);
  const panelId = await btn.getAttribute('aria-controls');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.isVisible(`#${panelId}`), false);
  await btn.focus();
  await page.keyboard.press('Enter');
  assert.equal(await btn.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.isVisible(`#${panelId}`), true);
  await page.keyboard.press('Space');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.stop').count() >= 4, true, 'home, charger, range, fuel (and parks when nearby)');
  await context.close();
});
