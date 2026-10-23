// Rules for data/vehicle-research.json, shared by the build (build-vehicles.mjs) and the reviewer's
// check (check-research.mjs), so the two can never disagree.
//
// The research is AI-assisted and human-verified: a research agent drafts it from the briefs in
// docs/vehicle-research.md, every entry carries a source on an allowed site and a short quote, and a
// person checks it in a pull request. Only a file whose status is "reviewed" is published.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCES = JSON.parse(readFileSync(path.join(ROOT, 'data', 'research-sources.json'), 'utf8'));

const IIHS_AWARDS = new Set(['TSP', 'TSP+']);
const MAX_QUOTE_WORDS = 15;

/** Is `url` an https link on `host` or one of its subdomains, for any host in `roots`? */
export function onAllowedHost(url, roots) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return roots.some((r) => h === r || h.endsWith(`.${r}`));
}

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const isYear = (y) => Number.isInteger(y) && y >= 2015 && y <= 2035;

/**
 * Check one car's research entry. Returns a list of problems (empty when it's fine).
 * `make` picks the manufacturer sites allowed for its cargo source.
 */
export function checkEntry(id, make, x) {
  const problems = [];
  const where = (field) => `${id} ${field}`;
  if (x.cargoCuFt) {
    const c = x.cargoCuFt;
    if (!(Number.isFinite(c.value) && c.value > 0 && c.value < 200)) problems.push(`${where('cargo')}: value must be cubic feet between 0 and 200`);
    if (!onAllowedHost(c.source, SOURCES.manufacturers[make] || [])) problems.push(`${where('cargo')}: source must be ${make}'s own site (${(SOURCES.manufacturers[make] || ['none listed']).join(', ')})`);
    if (c.modelYear != null && !isYear(c.modelYear)) problems.push(`${where('cargo')}: bad model year`);
    if (words(c.evidence) > MAX_QUOTE_WORDS) problems.push(`${where('cargo')}: quote over ${MAX_QUOTE_WORDS} words`);
  }
  if (x.iihs) {
    const i = x.iihs;
    if (!IIHS_AWARDS.has(i.award)) problems.push(`${where('IIHS')}: award must be TSP or TSP+`);
    if (!isYear(i.year)) problems.push(`${where('IIHS')}: bad award year`);
    if (!onAllowedHost(i.source, SOURCES.iihs)) problems.push(`${where('IIHS')}: source must be on iihs.org`);
    if (words(i.evidence) > MAX_QUOTE_WORDS) problems.push(`${where('IIHS')}: quote over ${MAX_QUOTE_WORDS} words`);
  }
  for (const [n, w] of (x.awards || []).entries()) {
    const roots = SOURCES.awards[w?.publisher];
    if (!roots) { problems.push(`${where(`award ${n + 1}`)}: unknown publisher "${w?.publisher}"`); continue; }
    if (typeof w.name !== 'string' || !w.name.trim() || w.name.length > 120) problems.push(`${where(`award ${n + 1}`)}: missing name`);
    if (!isYear(w.year)) problems.push(`${where(`award ${n + 1}`)}: bad year`);
    if (!onAllowedHost(w.url, roots)) problems.push(`${where(`award ${n + 1}`)}: source must be on ${roots.join(', ')}`);
    if (words(w.evidence) > MAX_QUOTE_WORDS) problems.push(`${where(`award ${n + 1}`)}: quote over ${MAX_QUOTE_WORDS} words`);
  }
  return problems;
}

/** Check the whole file against the curated car list. Returns { problems, publishable }. */
export function checkResearch(research, curatedVehicles) {
  const problems = [];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const makes = new Map(curatedVehicles.map((v) => [slug(`${v.make} ${v.model}`), v.make]));
  if (!research || typeof research !== 'object') return { problems: ['research file is not an object'], publishable: false };
  if (!['draft', 'reviewed'].includes(research.status)) problems.push('status must be "draft" or "reviewed"');
  if (research.status === 'reviewed' && !(research.reviewedBy && /^\d{4}-\d{2}-\d{2}$/.test(research.reviewedAt || ''))) {
    problems.push('a reviewed file needs reviewedBy and reviewedAt (YYYY-MM-DD)');
  }
  for (const [id, x] of Object.entries(research.vehicles || {})) {
    if (!makes.has(id)) { problems.push(`${id}: not a car in vehicles-curated.json`); continue; }
    problems.push(...checkEntry(id, makes.get(id), x || {}));
  }
  return { problems, publishable: research.status === 'reviewed' && !problems.length };
}
