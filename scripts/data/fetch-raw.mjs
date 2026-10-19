// Downloads every public source into data/raw/ (gitignored).
// Nothing here is needed at runtime: build-data.mjs turns these files into
// the small static JSON the site reads, so the live site holds no keys.
//
// Keys: NREL and NPS both accept the public DEMO_KEY for a handful of calls.
// Set NREL_API_KEY / NPS_API_KEY in your shell to use your own free keys.
// Keys are read from the environment only and never written to disk.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = path.join(ROOT, 'data', 'raw');
mkdirSync(RAW, { recursive: true });

const NREL_KEY = process.env.NREL_API_KEY || 'DEMO_KEY';
const NPS_KEY = process.env.NPS_API_KEY || 'DEMO_KEY';
const FORCE = process.argv.includes('--force');

const ACS_YEAR = 2024;
const ACS_BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData`;
// B25024 units in structure, B25003 tenure, B08013 aggregate travel time to work,
// B08303 travel time to work (E001 = workers who did not work from home).
const ACS_TABLES = ['b25024', 'b25003', 'b08013', 'b08303'];

const SOURCES = [
  {
    file: 'nrel_elec_stations.csv',
    // NREL moved the developer API to developer.nlr.gov in 2026; same API, same keys.
    url: `https://developer.nlr.gov/api/alt-fuel-stations/v1.csv?fuel_type=ELEC&status=E&access=public&country=US&limit=all&api_key=${NREL_KEY}`,
    redact: NREL_KEY,
  },
  { file: 'fueleconomy_vehicles.csv.zip', url: 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip' },
  { file: 'gazetteer_zcta.zip', url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip' },
  { file: 'zcta_county_rel.txt', url: 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt' },
  { file: 'eia_electricity_5_6_b.html', url: 'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_b' },
  { file: 'eia_gasoline_by_area.html', url: 'https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epmr_pte_dpgal_w.htm' },
];

function fresh(file) {
  const p = path.join(RAW, file);
  return !FORCE && existsSync(p) && statSync(p).size > 0;
}

async function download({ file, url, redact }) {
  const shown = redact ? url.replace(redact, '***') : url;
  if (fresh(file)) return console.log(`skip  ${file} (exists; --force to refetch)`);
  console.log(`fetch ${file} <- ${shown}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path.join(RAW, file)));
}

// ACS table files hold every geography in the country (15-65 MB each).
// Stream them and keep only the header plus ZCTA rows (GEO_ID 860Z200US...).
async function downloadAcs(table) {
  const file = `acs_${table}_zcta.psv`;
  if (fresh(file)) return console.log(`skip  ${file} (exists)`);
  const url = `${ACS_BASE}/acsdt5y${ACS_YEAR}-${table}.dat`;
  console.log(`fetch ${file} <- ${url} (filtering to ZCTAs)`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  const out = createWriteStream(path.join(RAW, file));
  const rl = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first || line.startsWith('860Z200US')) out.write(line + '\n');
    first = false;
  }
  await new Promise((r) => out.end(r));
}

// NPS: every park unit with coordinates. One page of 500 covers all ~474 units.
async function downloadNps() {
  const file = 'nps_parks.json';
  if (fresh(file)) return console.log(`skip  ${file} (exists)`);
  const url = `https://developer.nps.gov/api/v1/parks?limit=600&fields=&api_key=${NPS_KEY}`;
  console.log(`fetch ${file} <- ${url.replace(NPS_KEY, '***')}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NPS: HTTP ${res.status}`);
  const json = await res.json();
  // Keep only the fields we use; descriptions and images are large and unused.
  const slim = json.data.map((p) => ({
    parkCode: p.parkCode,
    fullName: p.fullName,
    designation: p.designation,
    states: p.states,
    latitude: p.latitude,
    longitude: p.longitude,
    url: p.url,
  }));
  await writeFile(path.join(RAW, file), JSON.stringify({ total: json.total, data: slim }, null, 1));
}

const started = new Date().toISOString();
for (const s of SOURCES) await download(s);
for (const t of ACS_TABLES) await downloadAcs(t);
await downloadNps();
await writeFile(path.join(RAW, 'fetched-at.json'), JSON.stringify({ fetchedAt: started, acsYear: ACS_YEAR }, null, 2));
console.log('done');
