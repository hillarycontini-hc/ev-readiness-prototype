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

// How people road-trip: fast-charge to about 80% and arrive with about 10%, so each leg uses
// about 70% of the battery. Cold weather and highway speeds use more; the visitor can lower it.
export const ROAD_TRIP_SHARE = 0.7;

/** Miles to plan per leg from a car's lowest EPA range, to the nearest 5 (the field's step). */
export function legMilesFromRange(epaMiles) {
  if (!Number.isFinite(epaMiles) || epaMiles <= 0) return null;
  return Math.max(LEG_MIN, Math.min(LEG_MAX, Math.round((epaMiles * ROAD_TRIP_SHARE) / 5) * 5));
}

// Typical published 10%-to-80% fast-charge times for current electric SUVs and pickups run about
// 20 to 45 minutes. A stated assumption, shown as a range; it depends on the car and the charger.
export const CHARGE_MINUTES = [20, 45];

// Cold weather and highway speeds can use 20-30% more energy than the EPA rating.
export const EXTRA_USE = 0.3;
const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);

/**
 * Two trips are the same plan when they start and end at the same points (to about 10 m) with the
 * same miles between charges and plug. The car's name doesn't count: the miles already say it.
 */
export function sameTrip(a, b) {
  const at = (p, q) => Boolean(p && q) && Math.abs(p.lat - q.lat) < 1e-4 && Math.abs(p.lon - q.lon) < 1e-4;
  return Boolean(a && b) && at(a.from, b.from) && at(a.to, b.to) && a.legMiles === b.legMiles && a.plug === b.plug;
}

/**
 * Rough energy cost of a one-way trip, as a range. The first leg runs on a charge from home at
 * the home state's rate; every mile after the first stop is charged at fast chargers. The low end
 * uses the EPA efficiency; the high end adds EXTRA_USE. Gas is the same miles in a `mpg` car.
 */
export function tripCost({ miles, firstLegMiles, kwh100, homeCentsPerKwh, dcPerKwh, gasPrice, mpg }) {
  const homeMiles = Math.min(miles, Math.max(0, firstLegMiles));
  const fastMiles = miles - homeMiles;
  const dollars = (factor) => ((homeMiles * homeCentsPerKwh) / 100 + fastMiles * dcPerKwh) * (kwh100 / 100) * factor;
  const low = round5(dollars(1));
  const high = Math.max(low, round5(dollars(1 + EXTRA_USE)));
  return { low, high, homeMiles: Math.round(homeMiles), fastMiles: Math.round(fastMiles), gas: gasPrice ? round5((miles / mpg) * gasPrice) : null };
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
  any: { label: 'Either plug', ok: (c) => /[CN]/.test(c) },
  ccs: { label: 'CCS only', ok: (c) => c.includes('C') },
  nacs: { label: 'NACS only', ok: (c) => c.includes('N') },
};

/**
 * Every usable fast charger within `corridor` miles of the route, with its road mile and the
 * detour off the road and back (straight line x the site's 1.25 road factor), sorted by road mile.
 * The slow part of planning, so it runs once per route and plug.
 */
export function routeCandidates({ route, stations, plug = 'any', corridor = CORRIDOR_MILES }) {
  const pts = route.points;
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + milesBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const lineMiles = along[along.length - 1] || 1;
  const scale = Math.min(3, Math.max(0.5, route.miles / lineMiles));
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
  return candidates.sort((a, b) => a.atMile - b.atMile);
}

/**
 * Choose stops from route candidates so no leg is longer than `legMiles`. Greedy: from each stop,
 * go to the farthest reachable charger, preferring, among those within the last 10% of the reach,
 * one that can reach the destination, then (with preferCcs) one with a CCS plug, then more fast
 * ports. preferCcs is for "Either plug": a visitor who isn't sure should land where most cars can
 * charge without an adapter, whenever that costs no extra stop.
 * Returns { ok: true, stops, finalLegMiles, arriveWithMiles, returnMiles, returnTo }, or
 * { ok: false, reason, stops, stuckAtMile, nextAtMile } where nextAtMile is the next charger past
 * the gap (null: none before the destination). returnMiles is how far the drive home goes before
 * its first fast charger (returnTo 'charger'), or the whole way home when the route has none
 * (returnTo 'home').
 */
export function chooseStops({ candidates, totalMiles, legMiles, maxStops = MAX_TRIP_STOPS, preferCcs = false }) {
  const total = totalMiles;
  const stops = [];
  let pos = { atMile: 0, detour: 0 };
  for (;;) {
    const remaining = total - pos.atMile + pos.detour;
    if (remaining <= legMiles) {
      const last = candidates[candidates.length - 1];
      return {
        ok: true, stops, finalLegMiles: Math.round(remaining), arriveWithMiles: Math.max(0, Math.round(legMiles - remaining)),
        ...(last ? { returnMiles: Math.round(total - last.atMile + last.detour), returnTo: 'charger' } : { returnMiles: Math.round(total), returnTo: 'home' }),
      };
    }
    if (stops.length >= maxStops) return { ok: false, reason: 'too_many_stops', stops, stuckAtMile: Math.round(pos.atMile), nextAtMile: null };
    const ahead = candidates.filter((c) => c.atMile > pos.atMile + 1);
    const reach = ahead.filter((c) => c.atMile - pos.atMile + pos.detour + c.detour <= legMiles);
    if (!reach.length) {
      return { ok: false, reason: 'gap', stops, stuckAtMile: Math.round(pos.atMile), nextAtMile: ahead.length ? Math.round(ahead[0].atMile) : null };
    }
    const farthest = reach[reach.length - 1].atMile;
    const window = reach.filter((c) => c.atMile >= farthest - legMiles * 0.1);
    // A stop that reaches the destination beats one with more ports that would need another stop.
    const finishes = (c) => (total - c.atMile + c.detour <= legMiles ? 1 : 0);
    const ccs = (c) => (preferCcs && (c.station.connectors || '').includes('C') ? 1 : 0);
    window.sort((a, b) => (finishes(b) - finishes(a)) || (ccs(b) - ccs(a)) || (b.station.fast - a.station.fast) || (a.detour - b.detour) || (b.atMile - a.atMile));
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

/**
 * Choose fast-charging stops along a route.
 * - route: { miles, points } (points from cleanRoute; road miles scale the line's own length)
 * - stations: [{ id, lat, lon, fast, connectors, ... }] from the station cells
 * - legMiles: the most the visitor will drive between charges
 */
export function planStops({ route, stations, legMiles, plug = 'any', corridor = CORRIDOR_MILES, maxStops = MAX_TRIP_STOPS }) {
  const candidates = routeCandidates({ route, stations, plug, corridor });
  return chooseStops({ candidates, totalMiles: route.miles, legMiles, maxStops, preferCcs: plug === 'any' });
}

/**
 * When a trip doesn't work, what would: the fewest miles between charges (in steps of 5, up to
 * LEG_MAX) that works with the same plug, and whether "Either plug" works at the same miles.
 * epaNeeded is the EPA range that gives those miles under the road-trip rule.
 */
export function suggestFixes({ route, stations, legMiles, plug = 'any', carMiles = null }) {
  const candidates = routeCandidates({ route, stations, plug });
  let minLegMiles = null;
  for (let m = Math.floor(legMiles / 5) * 5 + 5; m <= LEG_MAX; m += 5) {
    if (chooseStops({ candidates, totalMiles: route.miles, legMiles: m, preferCcs: plug === 'any' }).ok) { minLegMiles = m; break; }
  }
  const plugHelps = plug !== 'any' && chooseStops({ candidates: routeCandidates({ route, stations, plug: 'any' }), totalMiles: route.miles, legMiles, preferCcs: true }).ok;
  // The chosen car's own miles between charges (the 70% rule), when the visitor had set fewer.
  const carWorks = Number.isFinite(carMiles) && carMiles > legMiles
    && chooseStops({ candidates, totalMiles: route.miles, legMiles: carMiles, preferCcs: plug === 'any' }).ok;
  return { minLegMiles, plugHelps, epaNeeded: minLegMiles ? Math.ceil(minLegMiles / ROAD_TRIP_SHARE / 5) * 5 : null, carMiles, carWorks };
}

/**
 * The one-tap fixes for a trip that doesn't work, honest first. A change that works with the car
 * the visitor chose leads: its own miles between charges, then either plug. More miles than that
 * car's rule allows comes last, is never the main button, and carries the EPA range it would take.
 * Returns [{ kind: 'miles' | 'plug', value, fitsCar, primary, epaNeeded? }].
 */
export function fixActions({ minLegMiles, epaNeeded, plugHelps, carMiles, carWorks }) {
  const out = [];
  if (carWorks) out.push({ kind: 'miles', value: carMiles, fitsCar: true });
  if (plugHelps) out.push({ kind: 'plug', value: 'any', fitsCar: true });
  if (minLegMiles && !carWorks) {
    out.push({ kind: 'miles', value: minLegMiles, fitsCar: Number.isFinite(carMiles) && minLegMiles <= carMiles, epaNeeded });
  }
  out.sort((a, b) => Number(b.fitsCar) - Number(a.fitsCar));
  return out.map((a, i) => ({ ...a, primary: i === 0 && a.fitsCar }));
}

/** A NACS-only station: cars with a CCS port need an adapter, and not every such site is open to them. */
export const nacsOnly = (s) => (s.connectors || '').includes('N') && !(s.connectors || '').includes('C');

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

/**
 * For each chosen stop, up to one usable fast charger a little earlier and one a little later on
 * the route (within `window` road miles), picked only when swapping it in keeps the legs on both
 * sides within `legMiles`. Nearest to the chosen stop wins.
 * - candidates: routeCandidates() for the same route and plug
 * - stops: the plan's stops ({ id, atMile, detourMiles })
 * Returns [{ earlier, later }] in stop order; each is { station, atMile, detourMiles, deltaMiles } or null.
 */
// Would candidate c, swapped in for stop i, keep the legs on both sides within legMiles?
function swapFits(stops, i, c, totalMiles, legMiles) {
  const prev = i ? { atMile: stops[i - 1].atMile, detour: stops[i - 1].detourMiles } : { atMile: 0, detour: 0 };
  const next = stops[i + 1] ? { atMile: stops[i + 1].atMile, detour: stops[i + 1].detourMiles } : { atMile: totalMiles, detour: 0 };
  return c.atMile - prev.atMile + prev.detour + c.detour <= legMiles
    && next.atMile - c.atMile + c.detour + next.detour <= legMiles;
}

/**
 * Fast chargers on the route that could stand in for one of the chosen stops without making any
 * leg too long: the "other stops in range" the route overview draws. Chosen stops are excluded.
 */
export function swapStations({ candidates, stops, totalMiles, legMiles }) {
  const chosen = new Set(stops.map((s) => s.id));
  return candidates
    .filter((c) => !chosen.has(c.station.id) && stops.some((_, i) => swapFits(stops, i, c, totalMiles, legMiles)))
    .map((c) => c.station);
}

export function stopAlternatives({ candidates, stops, totalMiles, legMiles, window = 60, plug = 'any' }) {
  const chosen = new Set(stops.map((s) => s.id));
  return stops.map((stop, i) => {
    const near = candidates.filter((c) => !chosen.has(c.station.id) && Math.abs(c.atMile - stop.atMile) <= window && swapFits(stops, i, c, totalMiles, legMiles));
    // With "Either plug", like the planner, a charger most cars can use without an adapter comes
    // first; a NACS-only one is offered only when nothing else fits on that side.
    const nacsLast = (c) => (plug === 'any' && nacsOnly(c.station) ? 1 : 0);
    const pick = (list) => {
      const c = list.sort((a, b) => (nacsLast(a) - nacsLast(b)) || (Math.abs(a.atMile - stop.atMile) - Math.abs(b.atMile - stop.atMile)))[0];
      return c ? { station: c.station, atMile: Math.round(c.atMile), detourMiles: Math.round(c.detour * 10) / 10, deltaMiles: Math.round(Math.abs(c.atMile - stop.atMile)) } : null;
    };
    return {
      earlier: pick(near.filter((c) => c.atMile < stop.atMile - 0.5)),
      later: pick(near.filter((c) => c.atMile > stop.atMile + 0.5)),
    };
  });
}
