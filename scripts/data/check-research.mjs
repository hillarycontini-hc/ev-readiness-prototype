// The reviewer's tool for data/vehicle-research.json (AI-assisted research, human-verified).
//
//   npm run data:research:check                      check rules only
//   npm run data:research:check -- --links           also open every source link
//   npm run data:research:check -- --links --md review.md   write a review table for the PR
//
// Rules live in research-rules.mjs (allowed sites, value ranges, quotes of 15 words or fewer).
// The review table lists every claim with its source and quote and a box for the reviewer to tick.
// Some publishers block scripted requests (HTTP 403); those links are marked "open by hand".

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkResearch } from './research-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--md') || path.join(ROOT, 'data', 'vehicle-research.json');
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;
const checkLinks = args.includes('--links');

const research = JSON.parse(readFileSync(file, 'utf8'));
const curated = JSON.parse(readFileSync(path.join(ROOT, 'data', 'vehicles-curated.json'), 'utf8'));
const { problems } = checkResearch(research, curated.vehicles);

const claims = [];
for (const [id, x] of Object.entries(research.vehicles || {})) {
  if (x.cargoCuFt) claims.push({ id, what: `Cargo ${x.cargoCuFt.value} cu ft${x.cargoCuFt.modelYear ? ` (MY${x.cargoCuFt.modelYear})` : ''}`, url: x.cargoCuFt.source, quote: x.cargoCuFt.evidence });
  if (x.iihs) claims.push({ id, what: `IIHS ${x.iihs.award} ${x.iihs.year}${x.iihs.qualifier ? ` (${x.iihs.qualifier})` : ''}`, url: x.iihs.source, quote: x.iihs.evidence });
  for (const w of x.awards || []) claims.push({ id, what: `${w.publisher}: ${w.name} ${w.year}`, url: w.url, quote: w.evidence });
}

async function linkStatus(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'EV-Readiness-Check research link check' } });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403 || res.status === 429) return 'open by hand (site blocks scripts)';
    return `HTTP ${res.status}`;
  } catch {
    return 'no response';
  }
}

if (checkLinks) {
  const seen = new Map();
  for (const c of claims) {
    if (!seen.has(c.url)) seen.set(c.url, await linkStatus(c.url));
    c.link = seen.get(c.url);
  }
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
if (mdOut) {
  const lines = [
    `## Vehicle research review (${research.checkedAt || 'undated'}, status: ${research.status})`,
    '',
    'AI-assisted research, human-verified. Tick each row after opening the source and finding the quote.',
    '',
    '| ✓ | Car | Claim | Quote from the source | Source | Link |',
    '|---|---|---|---|---|---|',
    ...claims.map((c) => `| [ ] | ${cell(c.id)} | ${cell(c.what)} | ${cell(c.quote)} | ${cell(c.url)} | ${cell(c.link || 'not checked')} |`),
    '',
    problems.length ? `**Problems:**\n${problems.map((p) => `- ${p}`).join('\n')}` : '**Rules:** all entries pass.',
  ];
  writeFileSync(mdOut, `${lines.join('\n')}\n`);
}

console.log(`${claims.length} claims for ${Object.keys(research.vehicles || {}).length} cars; status ${research.status}.`);
if (checkLinks) {
  const bad = claims.filter((c) => c.link !== 'ok');
  console.log(`Links: ${claims.length - bad.length} ok, ${bad.length} to open by hand or fix.`);
  for (const c of bad) console.log(`  ${c.id}: ${c.link}  ${c.url}`);
}
if (problems.length) {
  console.error(`Problems (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Rules: all entries pass.');
