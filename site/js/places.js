// Places and chargers for the EV plan.
// - searchPlaces(): address or place-name search through our own proxy (/api/geocode),
//   so the provider never sees the visitor and our key never reaches the browser.
// - zipCenter(): a ZIP's center from our static data (works with no search service at all).
// - chargersNear(): public stations around a point, from static per-cell files built from NREL data.
// - fetchRoute(): a driving route through our proxy (/api/route); fastStationsAlong(): the fast
//   chargers in the station cells along it.

import { normalizeZip } from './logic.js';
import { cleanRoute, corridorCells } from './trip.js';

const R_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;
export function milesBetween(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

export class SearchUnavailable extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Search an address or place name, optionally biased toward a point. Resolves to [{name, detail, lat, lon}]. */
export async function searchPlaces(query, near) {
  const params = new URLSearchParams({ q: query });
  if (near) params.set('near', `${near.lat},${near.lon}`);
  let res;
  try {
    res = await fetch(`/api/geocode?${params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new SearchUnavailable('network');
  }
  if (res.status === 429) throw new SearchUnavailable('rate_limited');
  if (res.status === 400) throw new SearchUnavailable('bad_query');
  if (!res.ok) throw new SearchUnavailable('unavailable');
  const body = await res.json().catch(() => null);
  const results = Array.isArray(body?.results) ? body.results : [];
  return results
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map((r) => ({ name: String(r.name || '').slice(0, 120), detail: String(r.detail || '').slice(0, 160), lat: r.lat, lon: r.lon }));
}

const shardCache = new Map();
async function fetchJson(url) {
  if (shardCache.has(url)) return shardCache.get(url);
  const p = fetch(url, { credentials: 'same-origin' }).then((r) => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  shardCache.set(url, p);
  p.catch(() => shardCache.delete(url));
  return p;
}

/** The center of a ZIP code from the static ZIP files, or null if we have no data for it. */
export async function zipCenter(zipInput) {
  const zip = normalizeZip(zipInput);
  if (!zip) return null;
  const shard = await fetchJson(`data/zip/${zip.slice(0, 3)}.json`);
  const rec = shard && Object.hasOwn(shard, zip) ? shard[zip] : null;
  if (!rec || !Number.isFinite(rec.la)) return null;
  return { name: `ZIP ${zip}`, detail: rec.s, lat: rec.la, lon: rec.lo };
}

/**
 * Public chargers within `radius` miles of a point, nearest first.
 * Station rows: [id, name, street, city, lat, lon, level2 ports, fast ports, network, connectors, hours, pricing]
 */
export async function chargersNear(lat, lon, { radius = 5, fastOnly = false, limit = 12, cell = 0.5 } = {}) {
  const dLat = radius / 69;
  const dLon = radius / (69 * Math.max(0.1, Math.cos(toRad(Math.abs(lat)))));
  const keys = [];
  for (let i = Math.floor((lat - dLat) / cell); i <= Math.floor((lat + dLat) / cell); i++) {
    for (let j = Math.floor((lon - dLon) / cell); j <= Math.floor((lon + dLon) / cell); j++) keys.push(`${i}_${j}`);
  }
  const shards = await Promise.all(keys.map((k) => fetchJson(`data/stations/${k}.json`).catch(() => null)));
  const found = [];
  for (const rows of shards) {
    for (const r of rows || []) {
      if (fastOnly && !(r[7] > 0)) continue;
      const d = milesBetween(lat, lon, r[4], r[5]);
      if (d <= radius) found.push(stationFromRow(r, d));
    }
  }
  return found.sort((a, b) => a.miles - b.miles).slice(0, limit);
}

export function stationFromRow(r, miles) {
  return {
    id: r[0], name: r[1], street: r[2], city: r[3], lat: r[4], lon: r[5],
    level2: r[6], fast: r[7], network: r[8], connectors: r[9], hours: r[10], price: r[11],
    miles: Math.round(miles * 10) / 10,
  };
}

/** A driving route between two points: { miles, minutes, points } or a SearchUnavailable error. */
export async function fetchRoute(from, to) {
  const params = new URLSearchParams({ from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}` });
  let res;
  try {
    res = await fetch(`/api/route?${params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new SearchUnavailable('network');
  }
  if (res.status === 429) throw new SearchUnavailable('rate_limited');
  if (res.status === 422) throw new SearchUnavailable('no_route');
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    throw new SearchUnavailable(body?.error === 'too_far' || body?.error === 'too_close' ? body.error : 'bad_query');
  }
  if (!res.ok) throw new SearchUnavailable('unavailable');
  const route = cleanRoute(await res.json().catch(() => null));
  if (!route) throw new SearchUnavailable('unavailable');
  return route;
}

/** Every fast-charging station in the map cells within a few miles of a route. */
export async function fastStationsAlong(points) {
  const shards = await Promise.all(corridorCells(points).map((k) => fetchJson(`data/stations/${k}.json`).catch(() => null)));
  const found = [];
  for (const rows of shards) for (const r of rows || []) if (r[7] > 0) found.push(stationFromRow(r, 0));
  return found;
}

const CONNECTOR_NAMES = { J: 'J1772', C: 'CCS', N: 'NACS', D: 'CHAdeMO' };
export const connectorNames = (codes) => [...(codes || '')].map((c) => CONNECTOR_NAMES[c]).filter(Boolean);
