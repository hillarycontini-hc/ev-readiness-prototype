// Builds site/data/vehicles.json for the plan's car explorer:
// curated starting prices (data/vehicles-curated.json, sourced and dated) joined with
// EPA range and efficiency (fueleconomy.gov vehicles.csv, already downloaded by data:fetch).
//
// Price freshness rule: prices are re-checked monthly; this build warns when the curated file
// is older than 35 days, and on model-year changeover (August to October) every model should
// be re-checked. See docs/price-refresh.md.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const curated = JSON.parse(readFileSync(path.join(ROOT, 'data', 'vehicles-curated.json'), 'utf8'));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = parseCsv(strFromU8(unzipSync(readFileSync(path.join(ROOT, 'data', 'raw', 'fueleconomy_vehicles.csv.zip')))['vehicles.csv']));
const header = csv[0];
const col = (name) => header.indexOf(name);
const evRows = csv.slice(1).filter((r) => r[col('atvType')] === 'EV' && Number(r[col('range')]) > 0);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function epaStats(make, epaModel, modelYear) {
  const matches = evRows.filter((r) => norm(r[col('make')]) === norm(make)
    && (norm(r[col('baseModel')]) === norm(epaModel) || norm(r[col('model')]).startsWith(norm(epaModel))));
  if (!matches.length) return null;
  // Use the curated model year when EPA has it; otherwise the newest year EPA has.
  const years = [...new Set(matches.map((r) => Number(r[col('year')])))].sort((a, b) => b - a);
  const year = years.includes(modelYear) ? modelYear : years[0];
  const rows = matches.filter((r) => Number(r[col('year')]) === year);
  const ranges = rows.map((r) => Number(r[col('range')]));
  const effs = rows.map((r) => Number(r[col('combE')])).filter((x) => x > 0);
  return { epaYear: year, rangeMin: Math.min(...ranges), rangeMax: Math.max(...ranges), kwh100: effs.length ? Math.min(...effs) : null };
}

const problems = [];
const vehicles = curated.vehicles.map((v) => {
  const epa = epaStats(v.make, v.epa, v.modelYear);
  if (!epa) problems.push(`no EPA range for ${v.make} ${v.model}`);
  return {
    id: slug(`${v.make} ${v.model}`),
    make: v.make, model: v.model, class: v.class, modelYear: v.modelYear,
    msrp: v.msrp, destination: v.destination, seats: v.seats, thirdRow: v.thirdRow,
    rangeMin: epa?.rangeMin ?? null, rangeMax: epa?.rangeMax ?? null, kwh100: epa?.kwh100 ?? null, epaYear: epa?.epaYear ?? null,
    priceSource: v.source, confidence: v.confidence, notes: v.notes,
  };
}).filter((v) => v.rangeMax != null);

const ids = new Set();
for (const v of vehicles) { if (ids.has(v.id)) problems.push(`duplicate id ${v.id}`); ids.add(v.id); }
for (const v of vehicles) if (!(v.msrp > 10000 && v.msrp < 400000)) problems.push(`${v.id} price ${v.msrp} out of range`);

// Brand links: official https pages only; ZIP templates must carry exactly one {zip}.
for (const make of new Set(vehicles.map((v) => v.make))) {
  const brand = curated.brands[make];
  if (!brand) { problems.push(`no brand links for ${make}`); continue; }
  if (!brand.bookUrl && !brand.dealerUrl) problems.push(`${make} has neither a booking nor a dealer link`);
  for (const [k, url] of Object.entries(brand)) {
    if (k === 'salesModel' || url == null) continue;
    if (!/^https:\/\/[a-z0-9.-]+\//i.test(url)) problems.push(`${make} ${k} is not an https URL`);
    if (k.endsWith('ZipUrl') !== (url.split('{zip}').length === 2)) problems.push(`${make} ${k} {zip} placeholder mismatch`);
  }
}

const ageDays = Math.round((Date.now() - new Date(`${curated.checkedAt}T12:00:00Z`)) / 86400000);
if (ageDays > 35) console.warn(`WARN vehicle prices were checked ${ageDays} days ago (${curated.checkedAt}); re-check them (docs/price-refresh.md).`);
const month = new Date().getUTCMonth() + 1;
if (month >= 8 && month <= 10) console.warn('NOTE model-year changeover season (Aug-Oct): re-check every model, not just the frequent changers.');

if (problems.length) console.warn(`WARN ${problems.join('; ')}`);

writeFileSync(path.join(ROOT, 'site', 'data', 'vehicles.json'), JSON.stringify({
  checkedAt: curated.checkedAt,
  rule: curated.rule,
  vehicles,
  minivans: curated.minivans,
  assumptions: curated.assumptions,
  brands: curated.brands,
  notOnSale: curated.notOnSale.map(({ make, model, reason }) => ({ make, model, reason })),
}));
console.log(`vehicles: ${vehicles.length} with prices and EPA range (${vehicles.filter((v) => v.class === 'pickup').length} pickups), prices checked ${curated.checkedAt}`);
