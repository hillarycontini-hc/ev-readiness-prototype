// Turns data/raw/* into the static JSON the site reads:
//   site/data/meta.json        prices, EV model stats, assumptions, sources, build date
//   site/data/parks.json       outdoor NPS destinations with charging nearby
//   site/data/zip/{123}.json   one shard per 3-digit ZIP prefix (~5 KB each)
//
// The browser fetches one shard for the ZIP the visitor types. No API calls,
// no keys, and the ZIP never leaves the visitor's browser except as that
// static file request to the same host serving the page.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { FIPS_TO_STATE, STATE_NAME_TO_ABBR, STATE_TO_GAS_AREA } from './states.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'site', 'data');
const raw = (f) => readFileSync(path.join(RAW, f));
const fetchedAt = JSON.parse(raw('fetched-at.json'));

// ---------- helpers ----------

// RFC 4180 CSV parser (quoted fields may contain commas, quotes, newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function readDelimited(file, sep) {
  const lines = raw(file).toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(sep).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(sep);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const R_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;
function miles(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

const round = (x, d = 0) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// Spatial grid so radius queries touch a few hundred stations, not 80k.
const CELL = 0.25;
class Grid {
  constructor(points) {
    this.cells = new Map();
    for (const p of points) {
      const k = `${Math.floor(p.lat / CELL)},${Math.floor(p.lon / CELL)}`;
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(p);
    }
  }
  // Every point within radiusMi, with its distance.
  within(lat, lon, radiusMi) {
    const dLat = radiusMi / 69;
    const dLon = radiusMi / (69 * Math.max(0.1, Math.cos(toRad(Math.abs(lat) + dLat))));
    const out = [];
    for (let i = Math.floor((lat - dLat) / CELL); i <= Math.floor((lat + dLat) / CELL); i++) {
      for (let j = Math.floor((lon - dLon) / CELL); j <= Math.floor((lon + dLon) / CELL); j++) {
        for (const p of this.cells.get(`${i},${j}`) || []) {
          const d = miles(lat, lon, p.lat, p.lon);
          if (d <= radiusMi) out.push({ p, d });
        }
      }
    }
    return out;
  }
  // Nearest point within maxMi (null if none).
  nearest(lat, lon, maxMi) {
    for (const r of [5, 15, 40, maxMi]) {
      if (r > maxMi) break;
      const hits = this.within(lat, lon, r);
      if (hits.length) return hits.reduce((a, b) => (b.d < a.d ? b : a)).d;
    }
    return null;
  }
}

// ---------- charging stations (NREL / AFDC) ----------

const stationRows = toObjects(parseCsv(raw('nrel_elec_stations.csv').toString('utf8')));
// Connector types, one letter each: J = J1772 (Level 2), C = CCS, N = NACS (Tesla), D = CHAdeMO.
const CONNECTOR_CODES = { J1772: 'J', J1772COMBO: 'C', TESLA: 'N', CHADEMO: 'D', NEMA1450: '', NEMA515: '', NEMA520: '' };
const stations = stationRows
  .map((s) => ({
    lat: Number(s.Latitude),
    lon: Number(s.Longitude),
    l2: Number(s['EV Level2 EVSE Num']) || 0,
    dc: Number(s['EV DC Fast Count']) || 0,
    // Detail for the plan's "chargers near this place" lists (rendered as text only).
    id: Number(s.ID) || 0,
    name: (s['Station Name'] || '').trim().slice(0, 80),
    street: (s['Street Address'] || '').trim().slice(0, 80),
    city: (s.City || '').trim().slice(0, 40),
    network: (s['EV Network'] || '').trim().slice(0, 40),
    connectors: (s['EV Connector Types'] || '').trim().split(/s+/).filter(Boolean).map((c) => CONNECTOR_CODES[c] || '').filter(Boolean).join(''),
    hours: (s['Access Days Time'] || '').trim().slice(0, 60),
    price: (s['EV Pricing'] || '').trim().slice(0, 60),
  }))
  .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && (s.l2 > 0 || s.dc > 0));
const dcGrid = new Grid(stations.filter((s) => s.dc > 0));
const l2Grid = new Grid(stations.filter((s) => s.l2 > 0));
console.log(`stations: ${stations.length} public (${stations.filter((s) => s.dc > 0).length} with DC fast)`);

function chargingAround(lat, lon) {
  return {
    l2_5: l2Grid.within(lat, lon, 5).length,
    l2_10: l2Grid.within(lat, lon, 10).length,
    dc_10: dcGrid.within(lat, lon, 10).length,
    dc_25: dcGrid.within(lat, lon, 25).length,
    ndc: round(dcGrid.nearest(lat, lon, 100), 1), // null = none within 100 mi
    nl2: round(l2Grid.nearest(lat, lon, 100), 1),
  };
}

// ---------- ZCTA locations and states (Census Gazetteer + relationship file) ----------

const gazZip = unzipSync(raw('gazetteer_zcta.zip'));
const gazName = Object.keys(gazZip).find((n) => n.endsWith('.txt'));
const gazLines = strFromU8(gazZip[gazName]).split(/\r?\n/).filter(Boolean);
const gazHeader = gazLines[0].split('\t').map((h) => h.trim());
const zctas = new Map();
for (const line of gazLines.slice(1)) {
  const c = line.split('\t').map((x) => x.trim());
  const rec = Object.fromEntries(gazHeader.map((h, i) => [h, c[i]]));
  zctas.set(rec.GEOID, { lat: Number(rec.INTPTLAT), lon: Number(rec.INTPTLONG) });
}

// State = the county holding the largest land share of the ZCTA.
const bestCounty = new Map();
for (const r of readDelimited('zcta_county_rel.txt', '|')) {
  const z = r.GEOID_ZCTA5_20;
  if (!z) continue;
  const land = Number(r.AREALAND_PART) || 0;
  const cur = bestCounty.get(z);
  if (!cur || land > cur.land) bestCounty.set(z, { land, fips: r.GEOID_COUNTY_20.slice(0, 2) });
}

// ---------- ACS 5-year (housing type, tenure, commute) ----------

function acs(table) {
  const rows = readDelimited(`acs_${table}_zcta.psv`, '|');
  return new Map(rows.map((r) => [r.GEO_ID.replace('860Z200US', ''), r]));
}
const units = acs('b25024'); // E001 total, E002 1-unit detached, E003 1-unit attached, E010 mobile home
const tenure = acs('b25003'); // E001 total occupied, E002 owner occupied
const aggTravel = acs('b08013'); // E001 aggregate minutes to work
const commuters = acs('b08303'); // E001 workers who commute (excludes work from home)

const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);

// ---------- NPS outdoor destinations ----------

const OUTDOOR = /\bNational Parks?\b|Preserve|Recreation|Seashore|Lakeshore|River|Reserve/i;
const NOT_OUTDOOR = /Historic|Historical|Memorial|Military|Battlefield|Performing/i;
const parksRaw = JSON.parse(raw('nps_parks.json')).data;
const parks = parksRaw
  .filter((p) => OUTDOOR.test(p.designation || '') && !NOT_OUTDOOR.test(p.designation || ''))
  .map((p) => ({ ...p, lat: Number(p.latitude), lon: Number(p.longitude) }))
  .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat !== 0)
  .sort((a, b) => a.fullName.localeCompare(b.fullName))
  .map((p) => {
    const c = chargingAround(p.lat, p.lon);
    return {
      code: p.parkCode,
      name: p.fullName,
      kind: /\bNational Parks?\b/i.test(p.designation) ? 'national-park' : 'outdoor',
      states: p.states,
      // Only official NPS pages become links on the site.
      url: /^https:\/\/www\.nps\.gov\/[a-z0-9/._-]+$/i.test(p.url) ? p.url : `https://www.nps.gov/${p.parkCode}/index.htm`,
      lat: round(p.lat, 3),
      lon: round(p.lon, 3),
      dc_25: c.dc_25,
      l2_10: c.l2_10,
      ndc: c.ndc,
    };
  });
console.log(`outdoor NPS destinations: ${parks.length} (${parks.filter((p) => p.kind === 'national-park').length} national parks)`);

function parksNear(lat, lon) {
  const withD = parks.map((p, i) => ({ i, kind: p.kind, d: miles(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d);
  const picks = withD.filter((x) => x.d <= 250).slice(0, 3);
  const np = withD.find((x) => x.kind === 'national-park');
  if (np && !picks.some((x) => x.i === np.i) && np.d <= 1000) picks.push(np);
  return picks.map((x) => [x.i, round(x.d)]);
}

// ---------- per-ZIP records ----------

const records = [];
for (const [zip, loc] of zctas) {
  const county = bestCounty.get(zip);
  const st = county ? FIPS_TO_STATE[county.fips] : null;
  if (!st) continue; // territories without ACS coverage
  const u = units.get(zip);
  const t = tenure.get(zip);
  const housing = u ? Number(u.B25024_E001) : 0;
  const workers = commuters.get(zip) ? Number(commuters.get(zip).B08303_E001) : 0;
  const minutes = aggTravel.get(zip) ? Number(aggTravel.get(zip).B08013_E001) : 0;
  records.push({
    zip,
    s: st,
    // ZIP center (3 decimals, about 100 m): default "Home" for the plan's charger search.
    la: round(loc.lat, 3),
    lo: round(loc.lon, 3),
    // Share of homes that are single-family (detached or attached): the home-charging prior.
    sf: housing >= 20 ? pct(Number(u.B25024_E002) + Number(u.B25024_E003), housing) : null,
    own: t && Number(t.B25003_E001) >= 20 ? pct(Number(t.B25003_E002), Number(t.B25003_E001)) : null,
    // Mean one-way commute in minutes; null where too few commuters to be meaningful.
    cm: workers >= 50 && minutes > 0 ? round(minutes / workers, 1) : null,
    ...chargingAround(loc.lat, loc.lon),
    pk: parksNear(loc.lat, loc.lon),
  });
}

// Percentile ranks so the UI can say "more fast chargers than 72% of US ZIP codes".
function addPercentile(key, outKey) {
  const sorted = records.map((r) => r[key]).sort((a, b) => a - b);
  for (const r of records) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < r[key]) lo = m + 1; else hi = m; }
    r[outKey] = Math.round((100 * lo) / sorted.length);
  }
}
addPercentile('dc_10', 'dcp');
addPercentile('l2_10', 'l2p');

// ---------- EV models (fueleconomy.gov) ----------

const veh = toObjects(parseCsv(strFromU8(unzipSync(raw('fueleconomy_vehicles.csv.zip'))['vehicles.csv'])));
const evs = veh.filter((v) => v.atvType === 'EV' && Number(v.range) > 0 && Number(v.combE) > 0);
const newestYear = Math.max(...evs.map((v) => Number(v.year)));
// Current lineup = the two newest model years, one row per make/model/year/range/efficiency.
const seen = new Set();
const current = evs
  .filter((v) => Number(v.year) >= newestYear - 1)
  .filter((v) => {
    const k = [v.make, v.model, v.year, v.range, v.combE].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .map((v) => ({
    make: v.make,
    model: v.model,
    year: Number(v.year),
    range: Number(v.range),
    kwh100: Number(v.combE),
    cls: /Pickup/i.test(v.VClass) ? 'truck' : /Sport Utility|Van|Special Purpose/i.test(v.VClass) ? 'suv' : 'car',
  }));

function fleetStats(list) {
  const r = list.map((v) => v.range).sort((a, b) => a - b);
  const e = list.map((v) => v.kwh100).sort((a, b) => a - b);
  return {
    count: list.length,
    rangeMin: r[0],
    rangeP25: round(quantile(r, 0.25)),
    rangeMedian: round(quantile(r, 0.5)),
    rangeP75: round(quantile(r, 0.75)),
    rangeMax: r[r.length - 1],
    kwhPer100Median: round(quantile(e, 0.5), 1),
    // Sorted ranges so the UI can say "N of M models cover your need".
    ranges: r,
  };
}
const fleet = {
  modelYears: [newestYear - 1, newestYear],
  all: fleetStats(current),
  suvTruck: fleetStats(current.filter((v) => v.cls !== 'car')),
};
console.log(`EV configurations MY${newestYear - 1}-${newestYear}: ${fleet.all.count}, median range ${fleet.all.rangeMedian} mi`);

// ---------- energy prices (EIA) ----------

const cellText = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

// Electric Power Monthly table 5.6.B: year-to-date average price, cents/kWh. First number = residential, this year.
const epm = raw('eia_electricity_5_6_b.html').toString('utf8');
const elecPeriod = (epm.match(/scope="col">\s*([A-Za-z]+ \d{4} YTD|[A-Za-z]+ \d{4})/) || [])[1] || null;
const electricity = {};
for (const tr of epm.split(/<tr[^>]*>/i).slice(1)) {
  const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
  const abbr = STATE_NAME_TO_ABBR[cells[0]];
  if (abbr && cells.length > 2 && Number(cells[1]) > 0) electricity[abbr] = Number(cells[1]);
  if (cells[0] === 'U.S. Total' && Number(cells[1]) > 0) electricity.US = Number(cells[1]);
}

// Weekly retail regular gasoline by area: average the weeks shown (about six).
const gasHtml = raw('eia_gasoline_by_area.html').toString('utf8');
const gasWeeks = [...gasHtml.matchAll(/class="Series5">([\d/]+)</g)].map((m) => m[1]);
const gasArea = Object.create(null); // keyed by upstream text, so no prototype
for (const block of gasHtml.split(/class="DataStub1">/).slice(1)) {
  const name = cellText(block.split('</td>')[0]);
  const nums = [...block.split('DataHist')[0].matchAll(/class="(?:DataB|Current2)">([\d.]+)</g)].map((m) => Number(m[1]));
  if (nums.length) gasArea[name] = round(nums.reduce((a, b) => a + b, 0) / nums.length, 2);
}
const gasByState = {};
for (const [st, areas] of Object.entries(STATE_TO_GAS_AREA)) {
  const found = areas.find((a) => gasArea[a] != null);
  gasByState[st] = found ? { price: gasArea[found], area: found } : null;
}

// ---------- sanity checks: fail the build rather than ship bad numbers ----------

const problems = [];
const expect = (ok, msg) => { if (!ok) problems.push(msg); };
expect(stations.length > 50000, `only ${stations.length} public stations (expected 50,000+)`);
expect(records.length > 30000, `only ${records.length} ZIP records (expected 30,000+)`);
expect(parks.length >= 100, `only ${parks.length} outdoor destinations (expected 100+)`);
expect(fleet.all.count >= 100 && fleet.suvTruck.count >= 50, `EV lineup too small (${fleet.all.count} total, ${fleet.suvTruck.count} SUV/van/pickup)`);
expect(fleet.all.rangeMedian >= 150 && fleet.all.rangeMedian <= 500, `median EV range ${fleet.all.rangeMedian} mi looks wrong`);
expect(fleet.suvTruck.kwhPer100Median >= 20 && fleet.suvTruck.kwhPer100Median <= 60, `SUV efficiency ${fleet.suvTruck.kwhPer100Median} kWh/100 mi looks wrong`);
for (const st of Object.keys(STATE_TO_GAS_AREA)) {
  const e = electricity[st];
  const g = gasByState[st]?.price;
  expect(e >= 5 && e <= 60, `${st} electricity ${e} cents/kWh out of range`);
  expect(g >= 2 && g <= 9, `${st} gasoline $${g}/gal out of range`);
}
const withCommute = records.filter((r) => r.cm != null).length / records.length;
expect(withCommute > 0.8, `only ${Math.round(withCommute * 100)}% of ZIPs have commute data`);
if (problems.length) {
  console.error('Data sanity checks failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ---------- write ----------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'zip'), { recursive: true });

// Per-station detail, sharded into half-degree cells (about 35 x 25 miles) so the browser
// loads only the cells around a searched place. Arrays keep the files small:
// [id, name, street, city, lat, lon, level2 ports, fast ports, network, connector codes, hours, pricing]
mkdirSync(path.join(OUT, 'stations'), { recursive: true });
const STATION_CELL = 0.5;
const cells = new Map();
for (const st of stations) {
  const key = `${Math.floor(st.lat / STATION_CELL)}_${Math.floor(st.lon / STATION_CELL)}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push([st.id, st.name, st.street, st.city, round(st.lat, 4), round(st.lon, 4), st.l2, st.dc, st.network, st.connectors, st.hours, st.price]);
}
for (const [key, list] of cells) writeFileSync(path.join(OUT, 'stations', `${key}.json`), JSON.stringify(list));
console.log(`station detail: ${stations.length} stations in ${cells.size} cells`);

const shards = new Map();
for (const r of records) {
  const k = r.zip.slice(0, 3);
  if (!shards.has(k)) shards.set(k, {});
  const { zip, ...rest } = r;
  shards.get(k)[zip] = rest;
}
for (const [k, v] of shards) writeFileSync(path.join(OUT, 'zip', `${k}.json`), JSON.stringify(v));

writeFileSync(path.join(OUT, 'parks.json'), JSON.stringify(parks));

// National mean one-way commute, used to scale the national daily-miles prior to each ZIP.
let totalMinutes = 0;
let totalWorkers = 0;
for (const [zip, r] of aggTravel) {
  const w = commuters.get(zip);
  const m = Number(r.B08013_E001);
  const n = w ? Number(w.B08303_E001) : 0;
  if (!(m > 0 && n > 0)) continue; // ACS uses negative codes for suppressed cells
  totalMinutes += m;
  totalWorkers += n;
}

const meta = {
  builtAt: new Date().toISOString(),
  nationalCommuteMinutes: round(totalMinutes / totalWorkers, 1),
  fetchedAt: fetchedAt.fetchedAt,
  zipCount: records.length,
  stationCellDegrees: STATION_CELL,
  stationCount: stations.length,
  fleet,
  electricityCentsPerKwh: electricity,
  electricityPeriod: elecPeriod,
  gasolineByState: gasByState,
  gasolineWeeks: gasWeeks,
  sources: [
    { id: 'afdc', name: 'NREL Alternative Fuels Data Center, public EV stations', url: 'https://afdc.energy.gov/stations/' },
    { id: 'fe', name: 'fueleconomy.gov (EPA) vehicle data', url: 'https://www.fueleconomy.gov/feg/ws/index.shtml' },
    { id: 'acs', name: `U.S. Census Bureau, ACS ${fetchedAt.acsYear} 5-year estimates (tables B25024, B25003, B08013, B08303)`, url: 'https://www.census.gov/programs-surveys/acs' },
    { id: 'gaz', name: 'U.S. Census Bureau, 2024 ZCTA Gazetteer', url: 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html' },
    { id: 'eia-elec', name: 'EIA Electric Power Monthly, Table 5.6.B (residential, year to date)', url: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_b' },
    { id: 'eia-gas', name: 'EIA weekly retail gasoline prices, regular, by area', url: 'https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epmr_pte_dpgal_w.htm' },
    { id: 'nps', name: 'National Park Service API, park units', url: 'https://www.nps.gov/subjects/developer/api-documentation.htm' },
  ],
};
writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

console.log(`zip records: ${records.length} in ${shards.size} shards`);
console.log(`electricity states: ${Object.keys(electricity).length} (${elecPeriod}), gas areas: ${Object.keys(gasArea).length}`);
const missingGas = Object.entries(gasByState).filter(([, v]) => !v).map(([k]) => k);
if (missingGas.length) console.warn(`WARN no gasoline price for: ${missingGas.join(', ')}`);
const missingElec = Object.keys(STATE_TO_GAS_AREA).filter((s) => electricity[s] == null);
if (missingElec.length) console.warn(`WARN no electricity price for: ${missingElec.join(', ')}`);
