// Fetches NHTSA 5-Star Safety Ratings for every car in the explorer and writes
// data/nhtsa-ratings.json (committed, dated, reviewed in the pull request like prices).
//
// Source: the free public NHTSA SafetyRatings API (https://api.nhtsa.gov/SafetyRatings), no key.
// For each car: find NHTSA's model name for the curated model year (or the year before, since
// ratings often carry over), then read the overall rating of every rated version (drivetrain).
// A car with no rated version is "Not yet rated", never zero. Versions rated differently are
// kept as a range. Override a model name in data/vehicles-curated.json with `nhtsaModel`.
//
// Run: npm run data:nhtsa   (then npm run data:vehicles)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.nhtsa.gov/SafetyRatings';
const curated = JSON.parse(readFileSync(path.join(ROOT, 'data', 'vehicles-curated.json'), 'utf8'));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// NHTSA writes "EV9 BEV", "NIRO ELECTRIC BEV", "MODEL Y": drop powertrain words before comparing.
const POWERTRAIN = new Set(['bev', 'electric', 'ev', 'ice', 'hev', 'phev', 'hybrid']);
export const normModel = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !POWERTRAIN.has(w)).join('');
const keepEv = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const cache = new Map();
async function get(url) {
  if (cache.has(url)) return cache.get(url);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.ok) { const body = await res.json(); cache.set(url, body); return body; }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  throw new Error(`NHTSA request failed: ${url}`);
}
const enc = encodeURIComponent;

/** NHTSA's model names for this car in this year (usually one), or []. */
async function findModels(make, model, year, override) {
  const list = (await get(`${API}/modelyear/${year}/make/${enc(make)}?format=json`)).Results || [];
  const names = list.map((r) => r.Model);
  if (override) {
    const wanted = (Array.isArray(override) ? override : [override]).map((o) => o.toLowerCase());
    return names.filter((n) => wanted.includes(n.toLowerCase()));
  }
  // Prefer a name that is the same with "EV" kept (e.g. "SILVERADO EV"), then one equal after
  // dropping powertrain words, and never a gas or hybrid version.
  const ok = names.filter((n) => !/\b(ICE|HEV|PHEV|HYBRID)\b/i.test(n));
  const one = ok.find((n) => keepEv(n) === keepEv(model)) || ok.find((n) => normModel(n) === normModel(model));
  return one ? [one] : [];
}

const STARS = new Set(['1', '2', '3', '4', '5']);

async function ratingFor(v) {
  for (const year of [v.modelYear, v.modelYear - 1]) {
    const names = await findModels(v.make, v.model, year, v.nhtsaModel);
    if (!names.length) continue;
    const modelUrls = names.map((name) => `${API}/modelyear/${year}/make/${enc(v.make)}/model/${enc(name)}`);
    let versions = [];
    for (const u of modelUrls) versions.push(...((await get(`${u}?format=json`)).Results || []));
    // One NHTSA model can cover two of ours (the Hummer EV SUV and Pickup): keep matching versions.
    if (v.nhtsaVersion) versions = versions.filter((ver) => ver.VehicleDescription.toLowerCase().includes(v.nhtsaVersion.toLowerCase()));
    const name = names.join(' / ');
    const modelUrl = modelUrls[0];
    const rated = [];
    for (const ver of versions) {
      const r = ((await get(`${API}/VehicleId/${ver.VehicleId}?format=json`)).Results || [])[0];
      if (r && STARS.has(String(r.OverallRating))) rated.push({ version: ver.VehicleDescription, overall: Number(r.OverallRating) });
    }
    return {
      year, nhtsaModel: name, source: modelUrl,
      versions: versions.length,
      rated,
      overallMin: rated.length ? Math.min(...rated.map((x) => x.overall)) : null,
      overallMax: rated.length ? Math.max(...rated.map((x) => x.overall)) : null,
    };
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fetch-nhtsa.mjs')) {
  const out = { checkedAt: new Date().toISOString().slice(0, 10), source: API, vehicles: {} };
  const unmatched = [];
  for (const v of curated.vehicles) {
    const r = await ratingFor(v);
    out.vehicles[slug(`${v.make} ${v.model}`)] = r;
    if (!r) unmatched.push(`${v.make} ${v.model} (${v.modelYear})`);
    process.stdout.write(r ? (r.overallMin ? '*' : '.') : 'x');
  }
  writeFileSync(path.join(ROOT, 'data', 'nhtsa-ratings.json'), `${JSON.stringify(out, null, 2)}\n`);
  const rated = Object.values(out.vehicles).filter((r) => r?.overallMin).length;
  console.log(`\nNHTSA: ${rated} rated, ${Object.keys(out.vehicles).length - rated - unmatched.length} found but not yet rated, ${unmatched.length} not found in NHTSA's list.`);
  if (unmatched.length) console.log(`Not found (add \`nhtsaModel\` in vehicles-curated.json if NHTSA uses another name):\n  ${unmatched.join('\n  ')}`);
}
