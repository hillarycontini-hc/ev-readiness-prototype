// Copies the pinned posthog-js browser build into site/vendor/ so the page loads
// analytics from its own origin (no third-party script host, strict CSP).
// Uses the "no-external" build: it cannot download extra scripts at runtime.
// Re-run after upgrading posthog-js: `npm run vendor`.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'node_modules', 'posthog-js');
const OUT = path.join(ROOT, 'site', 'vendor');
mkdirSync(OUT, { recursive: true });

const { version } = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));
const src = path.join(PKG, 'dist', 'array.no-external.js');
const dest = path.join(OUT, 'posthog.no-external.js');
copyFileSync(src, dest);
copyFileSync(path.join(PKG, 'LICENSE'), path.join(OUT, 'posthog-LICENSE.txt'));

const sha = createHash('sha384').update(readFileSync(dest)).digest('base64');
writeFileSync(path.join(OUT, 'README.txt'), [
  `posthog-js ${version}, dist/array.no-external.js`,
  `sha384-${sha}`,
  'Copied by scripts/vendor.mjs. Do not edit by hand.',
  '',
].join('\n'));
console.log(`vendored posthog-js ${version} (sha384-${sha.slice(0, 16)}...)`);
