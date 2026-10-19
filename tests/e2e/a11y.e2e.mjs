// Accessibility: axe-core (WCAG 2.0/2.1 A and AA rules) on every view,
// in light and dark mode, at desktop and 320px width, plus a keyboard-only run.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { completeFlow, startServer } from './helpers.mjs';

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
  'results (all answered)': async (page) => completeFlow(page, '80302', [1, 0, 1, 2]),
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

  for (let i = 0; i < 4; i++) {
    const focused = await page.evaluate(() => document.activeElement.id);
    assert.equal(focused, 'question-legend', `focus moves to question ${i + 1}`);
    await page.keyboard.press('Tab'); // into the radio group
    assert.equal(await page.evaluate(() => document.activeElement.type), 'radio');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('#view-results:not([hidden])');
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
