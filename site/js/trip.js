// The trip planner's math: checking a route from our proxy, finding the map cells along it,
// and choosing fast-charging stops so no leg is longer than the miles the visitor plans per leg.
// Pure functions only (no DOM, no network), so every rule here is unit tested.

import { ASSUMPTIONS } from './logic.js';

export const MAX_ROUTE_POINTS = 600;
export const MAX_TRIP_STOPS = 12;
export const CORRIDOR_MILES = 3; // how far off the road a fast charger may be
export const LEG_MIN = 40;
export const LEG_MAX = 500;

const R_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;
export function milesBetween(lat1, lon1, lat2, lon2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

export const inUS = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 18 && lat <= 72 && lon >= -180 && lon <= -60;

/** Validate a /api/route response. Returns { miles, minutes, points } or null. */
export function cleanRoute(body) {
  if (!body || typeof body !== 'object') return null;
  const { miles, minutes, points } = body;
  if (!Number.isFinite(miles) || miles <= 0 || miles > 3000) return null;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 6000) return null;
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_ROUTE_POINTS) return null;
  const clean = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !inUS(p[0], p[1])) return null;
    clean.push([p[0], p[1]]);
  }
  return { miles, minutes, points: clean };
}

/**
 * Miles to plan per leg from a car's lowest EPA range: the same 1.5x buffer the site uses for
 * the range you need (winter loss, a reserve so you never arrive at 0%, battery aging).
 */
export function legMilesFromRange(epaMiles) {
  if (!Number.isFinite(epaMiles) || epaMiles <= 0) return null;
  return Math.max(LEG_MIN, Math.min(LEG_MAX, Math.round(epaMiles / ASSUMPTIONS.rangeBuffer)));
}

/** Station map cells (the static data/stations/{i}_{j}.json files) within `corridor` miles of the route. */
export function corridorCells(points, corridor = CORRIDOR_MILES, cell = 0.5) {
  const keys = new Set();
  const dLat = corridor / 69;
  for (const [lat, lon] of points) {
    const dLon = corridor / (69 * Math.max(0.1, Math.cos(toRad(Math.abs(lat)))));
    for (let i = Math.floor((lat - dLat) / cell); i <= Math.floor((lat + dLat) / cell); i++) {
      for (let j = Math.floor((lon - dLon) / cell); j <= Math.floor((lon + dLon) / cell); j++) keys.add(`${i}_${j}`);
    }
  }
  return [...keys];
}

// Which fast chargers a car can use. Stations with only CHAdeMO are never used: no electric SUV,
// minivan, or pickup on sale in the U.S. charges with it.
export const PLUGS = {
  any: { label: 'Either (CCS or NACS)', ok: (c) => /[CN]/.test(c) },
  ccs: { label: 'CCS only', ok: (c) => c.includes('C') },
  nacs: { label: 'NACS (Tesla plug)', ok: (c) => c.includes('N') },
};

/**
 * Choose fast-charging stops along a route.
 * - route: { miles, points } (points from cleanRoute; road miles scale the line's own length)
 * - stations: [{ id, lat, lon, fast, connectors, ... }] from the station cells
 * - legMiles: the most the visitor will drive between charges
 * Each leg counts road miles along the route plus the detour off the road and back (straight
 * line x the site's 1.25 road factor). Greedy: from each stop, go to the farthest reachable charger,
 * preferring more fast ports among those within the last 10% of the reach.
 * Returns { ok: true, stops, finalLegMiles, arriveWithMiles } or { ok: false, reason, stops, stuckAtMile }.
 */
export function planStops({ route, stations, legMiles, plug = 'any', corridor = CORRIDOR_MILES, maxStops = MAX_TRIP_STOPS }) {
  const pts = route.points;
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + milesBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const lineMiles = along[along.length - 1] || 1;
  const scale = Math.min(3, Math.max(0.5, route.miles / lineMiles));
  const total = route.miles;
  const usable = PLUGS[plug] || PLUGS.any;

  const dLat = corridor / 69;
  const seen = new Set();
  const candidates = [];
  for (const s of stations) {
    if (!s || !(s.fast > 0) || !usable.ok(s.connectors || '') || seen.has(s.id) || !inUS(s.lat, s.lon)) continue;
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - s.lat) > dLat) continue;
      const d = milesBetween(s.lat, s.lon, pts[i][0], pts[i][1]);
      if (d < best) { best = d; at = i; }
    }
    if (best > corridor) continue;
    seen.add(s.id);
    candidates.push({ station: s, atMile: along[at] * scale, detour: best * ASSUMPTIONS.roadFactor });
  }
  candidates.sort((a, b) => a.atMile - b.atMile);

  const stops = [];
  let pos = { atMile: 0, detour: 0 };
  for (;;) {
    const remaining = total - pos.atMile + pos.detour;
    if (remaining <= legMiles) {
      return { ok: true, stops, finalLegMiles: Math.round(remaining), arriveWithMiles: Math.max(0, Math.round(legMiles - remaining)) };
    }
    if (stops.length >= maxStops) return { ok: false, reason: 'too_many_stops', stops, stuckAtMile: Math.round(pos.atMile) };
    const reach = candidates.filter((c) => c.atMile > pos.atMile + 1 && c.atMile - pos.atMile + pos.detour + c.detour <= legMiles);
    if (!reach.length) return { ok: false, reason: 'gap', stops, stuckAtMile: Math.round(pos.atMile) };
    const farthest = reach[reach.length - 1].atMile;
    const window = reach.filter((c) => c.atMile >= farthest - legMiles * 0.1);
    window.sort((a, b) => (b.station.fast - a.station.fast) || (a.detour - b.detour) || (b.atMile - a.atMile));
    const pick = window[0];
    stops.push({
      ...pick.station,
      atMile: Math.round(pick.atMile),
      legMiles: Math.round(pick.atMile - pos.atMile + pos.detour + pick.detour),
      detourMiles: Math.round(pick.detour * 10) / 10,
    });
    pos = pick;
  }
}

/** "6 h 50 min" style drive time. */
export function durationText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Coarse stop count for analytics: never the exact route. */
export function stopsBucket(n) {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}
