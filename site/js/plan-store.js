// The visitor's EV plan: what they saved (places, chargers, shortlisted cars, finance inputs,
// planned trips, finished steps). Kept on this device only, in browser storage, and only once they save
// something. A share link carries the plan inside the URL fragment (#plan=...), which browsers
// never send to any server; places and trips are left out unless the visitor opts in.

import { QUESTIONS, normalizeZip } from './logic.js';
import { LEG_MAX, LEG_MIN, MAX_TRIP_STOPS, PLUGS } from './trip.js';

const KEY = 'evrc-plan-v1';
const MAX_PLACES = 8;
const MAX_STATIONS_PER_PLACE = 10;
const MAX_SHORTLIST = 3;
const MAX_TRIPS = 3;
const MAX_SHARE_CHARS = 16000;

export const MAX_SAVED_TRIPS = MAX_TRIPS;
export const PLACE_SLOTS = ['home', 'work', 'lunch', 'gym', 'other'];

export const FINANCE_DEFAULTS = {
  mode: 'loan', // 'price' | 'loan' | 'lease'
  maxPrice: 60000,
  maxMonthly: 700,
  down: 5000,
  aprPct: 6.35,
  months: 60,
  leaseMonths: 36,
  residualPct: 50,
  moneyFactor: 0.0025,
  dueAtSigning: 3000,
  thirdRow: false,
};

export function emptyPlan() {
  return { v: 1, zip: null, answers: {}, places: [], saved: {}, shortlist: [], finance: { ...FINANCE_DEFAULTS }, trips: [], done: [] };
}

// ---------- validation (shared links are untrusted input) ----------

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const num = (v, lo, hi, dflt) => (Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
const inUS = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 18 && lat <= 72 && lon >= -180 && lon <= -60;
const ID = /^[a-z0-9-]{1,60}$/;

function cleanStation(s) {
  if (!s || !Number.isInteger(s.id) || !inUS(s.lat, s.lon)) return null;
  return {
    id: s.id, name: str(s.name, 80), street: str(s.street, 80), city: str(s.city, 40),
    lat: s.lat, lon: s.lon, level2: num(s.level2, 0, 500, 0), fast: num(s.fast, 0, 500, 0),
    network: str(s.network, 40), connectors: str(s.connectors, 8).replace(/[^JCND]/g, ''),
    hours: str(s.hours, 60), price: str(s.price, 60), miles: num(s.miles, 0, 500, 0),
  };
}

const TRIP_ID = /^trip-[a-z0-9]{1,12}$/;
const TRIP_STEPS = ['plan-park', 'plan-route'];
const PARK_CODE = /^[a-z]{4}$/;

function cleanTripStop(s) {
  const st = cleanStation(s);
  if (!st || !(st.fast > 0)) return null;
  delete st.miles;
  const atMile = num(s.atMile, 0, 3000, NaN);
  const legMiles = num(s.legMiles, 0, LEG_MAX, NaN);
  if (!Number.isFinite(atMile) || !Number.isFinite(legMiles)) return null;
  return { ...st, atMile, legMiles, detourMiles: num(s.detourMiles, 0, 10, 0) };
}

/** A planned trip: one destination, its route totals, and its fast-charging stops in order. */
export function cleanTrip(t) {
  if (!t || typeof t !== 'object' || !TRIP_ID.test(t.id) || !TRIP_STEPS.includes(t.step)) return null;
  const from = t.from || {};
  const to = t.to || {};
  if (!inUS(from.lat, from.lon) || !inUS(to.lat, to.lon)) return null;
  const miles = num(t.miles, 1, 3000, NaN);
  const minutes = num(t.minutes, 1, 6000, NaN);
  const legMiles = num(t.legMiles, LEG_MIN, LEG_MAX, NaN);
  if (![miles, minutes, legMiles].every(Number.isFinite)) return null;
  const stops = (Array.isArray(t.stops) ? t.stops : []).slice(0, MAX_TRIP_STOPS).map(cleanTripStop);
  if (stops.some((s) => !s) || stops.some((s, i) => i && s.atMile < stops[i - 1].atMile)) return null;
  return {
    id: t.id, step: t.step,
    from: { name: str(from.name, 120), lat: from.lat, lon: from.lon },
    to: { name: str(to.name, 120) || 'Destination', detail: str(to.detail, 160), lat: to.lat, lon: to.lon, park: PARK_CODE.test(to.park) ? to.park : null },
    miles, minutes, legMiles,
    plug: Object.hasOwn(PLUGS, t.plug) ? t.plug : 'any',
    finalLegMiles: num(t.finalLegMiles, 0, LEG_MAX, 0),
    arriveWithMiles: num(t.arriveWithMiles, 0, LEG_MAX, 0),
    stops,
  };
}

/** Coerce any object (from storage or a share link) into a safe plan, dropping anything invalid. */
export function sanitizePlan(raw) {
  const p = emptyPlan();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return p;
  p.zip = normalizeZip(raw.zip) || null;
  for (const [q, def] of Object.entries(QUESTIONS)) {
    const v = raw.answers?.[q];
    if (def.options.some((o) => o.value === v)) p.answers[q] = v;
  }
  const places = Array.isArray(raw.places) ? raw.places : [];
  for (const pl of places.slice(0, MAX_PLACES)) {
    if (!pl || !ID.test(pl.id) || !PLACE_SLOTS.includes(pl.slot) || !inUS(pl.lat, pl.lon)) continue;
    p.places.push({ id: pl.id, slot: pl.slot, name: str(pl.name, 120), detail: str(pl.detail, 160), lat: pl.lat, lon: pl.lon });
  }
  for (const pl of p.places) {
    const list = Array.isArray(raw.saved?.[pl.id]) ? raw.saved[pl.id] : [];
    const clean = list.slice(0, MAX_STATIONS_PER_PLACE).map(cleanStation).filter(Boolean);
    if (clean.length) p.saved[pl.id] = clean;
  }
  p.shortlist = (Array.isArray(raw.shortlist) ? raw.shortlist : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(0, MAX_SHORTLIST);
  const f = raw.finance || {};
  const d = FINANCE_DEFAULTS;
  p.finance = {
    mode: ['price', 'loan', 'lease'].includes(f.mode) ? f.mode : d.mode,
    maxPrice: num(f.maxPrice, 10000, 300000, d.maxPrice),
    maxMonthly: num(f.maxMonthly, 100, 5000, d.maxMonthly),
    down: num(f.down, 0, 200000, d.down),
    aprPct: num(f.aprPct, 0, 30, d.aprPct),
    months: [36, 48, 60, 72, 84].includes(f.months) ? f.months : d.months,
    leaseMonths: [24, 36, 39, 48].includes(f.leaseMonths) ? f.leaseMonths : d.leaseMonths,
    residualPct: num(f.residualPct, 20, 80, d.residualPct),
    moneyFactor: num(f.moneyFactor, 0, 0.01, d.moneyFactor),
    dueAtSigning: num(f.dueAtSigning, 0, 50000, d.dueAtSigning),
    thirdRow: f.thirdRow === true,
  };
  const ids = new Set();
  for (const t of (Array.isArray(raw.trips) ? raw.trips : []).slice(0, MAX_TRIPS)) {
    const clean = cleanTrip(t);
    if (clean && !ids.has(clean.id)) { ids.add(clean.id); p.trips.push(clean); }
  }
  p.done = (Array.isArray(raw.done) ? raw.done : []).filter((id) => typeof id === 'string' && /^plan-[a-z-]{1,30}$/.test(id)).slice(0, 20);
  return p;
}

// ---------- this device ----------

export function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizePlan(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePlan(plan) {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false; // private mode or storage blocked: the plan still works for this visit
  }
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

// ---------- share link ----------

const toB64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * Everything a partner needs to see the plan. Places, their chargers, and trips (which start
 * from home) go in only if the visitor chose to include them.
 */
export function sharePayload(plan, { includePlaces }) {
  const out = { v: 1, zip: plan.zip, answers: plan.answers, shortlist: plan.shortlist, finance: plan.finance, done: plan.done, places: [], saved: {}, trips: [] };
  if (includePlaces) { out.places = plan.places; out.saved = plan.saved; out.trips = plan.trips; }
  return out;
}

export async function encodeShare(payload) {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return toB64Url(bytes);
}

/** Decode a #plan= fragment. Returns a sanitized plan, or null if it is missing, too long, or malformed. */
export async function decodeShare(fragment) {
  if (typeof fragment !== 'string' || fragment.length > MAX_SHARE_CHARS || !/^[A-Za-z0-9_-]+$/.test(fragment)) return null;
  try {
    const bytes = await pipe(fromB64Url(fragment), new DecompressionStream('deflate-raw'));
    if (bytes.length > 64000) return null;
    return sanitizePlan(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
