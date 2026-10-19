import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The browser loads site/vendor/posthog.no-external.js. It must be byte-identical to the
// pinned posthog-js in package-lock.json, so a dependency update cannot silently diverge.
test('vendored PostHog build matches the installed, pinned package', () => {
  const vendored = readFileSync(new URL('../site/vendor/posthog.no-external.js', import.meta.url));
  const installed = readFileSync(new URL('../node_modules/posthog-js/dist/array.no-external.js', import.meta.url));
  assert.ok(vendored.equals(installed), 'run `npm run vendor` after upgrading posthog-js');
});
