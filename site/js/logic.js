// Decision logic for "Is an EV right for me?"
//
// Pure functions only: no DOM, no network, no analytics. The same module runs in
// the browser and under `node --test`, so every rule here is unit tested.
// Full write-up: docs/decision-logic.md.

// ---------- inputs ----------

// Each question's answers, with the representative number the math uses.
// 'skip' is always allowed and means "use the prior for my ZIP".
export const QUESTIONS = {
  dailyMiles: {
    options: [
      { value: 'under20', miles: 15 },
      { value: '20to40', miles: 30 },
      { value: '40to70', miles: 55 },
      { value: '70to100', miles: 85 },
      { value: 'over100', miles: 120 },
    ],
  },
  homeCharging: {
    // 'install' = owns and could add a charger; 'ask' = rents and could ask the landlord;
    // 'no' = street or shared parking with no charging.
    options: [{ value: 'yes' }, { value: 'install' }, { value: 'ask' }, { value: 'no' }],
  },
  workCharging: {
    // Asked only when home charging is not certain: somewhere the car sits for hours with charging.
    options: [{ value: 'yes' }, { value: 'no' }],
  },
  longTrips: {
    // Round trips over about 200 miles, per year.
    options: [
      { value: 'rarely', perYear: 1 },
      { value: 'few', perYear: 4 },
      { value: 'monthly', perYear: 12 },
      { value: 'weekly', perYear: 40 },
    ],
  },
  outdoor: {
    // Trips to trailheads, parks, lakes, campgrounds, per year.
    options: [
      { value: 'rarely', perYear: 1 },
      { value: 'few', perYear: 5 },
      { value: 'monthly', perYear: 15 },
    ],
  },
};

export const QUESTION_ORDER = ['dailyMiles', 'homeCharging', 'workCharging', 'longTrips', 'outdoor'];

/** Questions that apply given the answers so far. Work charging only matters without certain home charging. */
export function questionsFor(answers = {}) {
  const homeSettled = answers.homeCharging === 'yes' || answers.homeCharging === 'install';
  return QUESTION_ORDER.filter((q) => q !== 'workCharging' || !homeSettled);
}

// Which EVs the visitor is compared against. The primary persona needs room for car seats,
// a dog, and gear, so the default is SUVs, minivans, and pickups (fleet.suvTruck).
export const FLEET_KEY = 'suvTruck';

// Every number the model leans on, in one place, so the UI can show its work.
export const ASSUMPTIONS = {
  nationalDailyMiles: 37, // FHWA: ~13,500 miles per driver per year / 365
  rangeBuffer: 1.5, // winter range loss (20-30%), a reserve so you never arrive at 0%, battery aging
  daysBetweenPublicCharges: 2.5, // without home charging, one public session has to cover a few days
  roadFactor: 1.25, // straight-line distance to road miles
  extraMilesPerLongTrip: 300,
  gasMpg: 27, // recent new-vehicle real-world average (EPA Automotive Trends)
  landlordYesOdds: 0.5, // renters who ask: assume even odds of getting home charging
  workChargingReliability: 0.8, // daytime charging covers most, not all, days
  publicL2PricePerKwh: 0.27, // approximate; public Level 2 pricing varies widely
  dcFastPricePerKwh: 0.53, // Paren Q1 2026 U.S. average, excluding free chargers
};

// ---------- small helpers ----------

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const optionOf = (q, value) => QUESTIONS[q].options.find((o) => o.value === value);
const isAnswered = (q, value) => Boolean(optionOf(q, value));

/** Valid 5-digit US ZIP. Returns the cleaned ZIP or null. */
export function normalizeZip(input) {
  if (typeof input !== 'string') return null;
  const z = input.trim();
  return /^\d{5}$/.test(z) ? z : null;
}

/** Count of sorted ranges at or above `need` (binary search). */
export function countAtOrAbove(sortedRanges, need) {
  let lo = 0;
  let hi = sortedRanges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedRanges[mid] < need) lo = mid + 1;
    else hi = mid;
  }
  return sortedRanges.length - lo;
}

// ---------- cold start: priors from the ZIP alone ----------

/**
 * What we assume about a household in this ZIP before they answer anything.
 * Daily miles scale the national average by the ZIP's mean commute;
 * home-charging odds come from the share of single-family homes.
 */
export function priorsFor(zipRec, meta) {
  const natl = meta.nationalCommuteMinutes || 26.4;
  const commuteRatio = zipRec.cm ? zipRec.cm / natl : 1;
  const dailyMiles = Math.round(clamp(ASSUMPTIONS.nationalDailyMiles * commuteRatio, 15, 80));
  const homeChargeOdds = zipRec.sf == null ? 0.5 : clamp(zipRec.sf / 100, 0.05, 0.95);
  return { dailyMiles, homeChargeOdds };
}

/** Merge answers with priors. Anything skipped falls back to the ZIP prior and is listed in `assumed`. */
export function resolveInputs(answers, zipRec, meta) {
  const priors = priorsFor(zipRec, meta);
  const assumed = [];
  const a = answers || {};

  let dailyMiles;
  if (isAnswered('dailyMiles', a.dailyMiles)) dailyMiles = optionOf('dailyMiles', a.dailyMiles).miles;
  else { dailyMiles = priors.dailyMiles; assumed.push('dailyMiles'); }

  let homeChargeOdds;
  let homeCharging = a.homeCharging;
  if (homeCharging === 'yes') homeChargeOdds = 1;
  else if (homeCharging === 'install') homeChargeOdds = 0.9; // most who can install, do; permits and panels sometimes block it
  else if (homeCharging === 'ask') homeChargeOdds = ASSUMPTIONS.landlordYesOdds;
  else if (homeCharging === 'no') homeChargeOdds = 0;
  else { homeCharging = 'unknown'; homeChargeOdds = priors.homeChargeOdds; assumed.push('homeCharging'); }

  // Work (or other daytime) charging, only asked when home charging is not certain.
  let workCharging = a.workCharging;
  let workChargeOdds = 0;
  const workApplies = homeCharging !== 'yes' && homeCharging !== 'install';
  if (!workApplies) workCharging = 'not-asked';
  else if (workCharging === 'yes') workChargeOdds = ASSUMPTIONS.workChargingReliability;
  else if (workCharging !== 'no') { workCharging = 'unknown'; assumed.push('workCharging'); }
  // Chance the car can charge somewhere it already sits for hours, at home or during the day.
  const regularChargeOdds = homeChargeOdds + (1 - homeChargeOdds) * workChargeOdds;

  let longTrips = a.longTrips;
  if (!isAnswered('longTrips', longTrips)) { longTrips = 'few'; assumed.push('longTrips'); }

  let outdoor = a.outdoor;
  if (!isAnswered('outdoor', outdoor)) { outdoor = 'few'; assumed.push('outdoor'); }

  return { dailyMiles, homeCharging, homeChargeOdds, workCharging, workChargeOdds, regularChargeOdds, longTrips, outdoor, assumed, priors };
}

// ---------- factor scores (each 0-100) ----------

/** How well public charging could stand in for home charging. */
function publicSubstituteScore(z) {
  if (z.l2_5 >= 10 || z.dc_10 >= 5) return 55;
  if (z.l2_10 >= 5 || z.dc_10 >= 1) return 35;
  return 10;
}

/** Regular charging: home first; charging at work, or dense public charging, can stand in. */
function homeChargingScore(inp, z) {
  if (inp.homeCharging === 'yes') return 100;
  if (inp.homeCharging === 'install') return 85;
  const sub = Math.max(publicSubstituteScore(z), inp.workChargeOdds > 0 ? 70 : 0);
  // 'no' (odds 0), 'ask' (landlord odds), and unknown (ZIP prior) all blend the same way.
  return Math.round(inp.homeChargeOdds * 90 + (1 - inp.homeChargeOdds) * sub);
}

/** Range the visitor needs between charges, and how much of the current EV lineup covers it. */
export function rangeNeed(inp, fleet) {
  const daysPerCharge = inp.regularChargeOdds >= 0.5 ? 1 : ASSUMPTIONS.daysBetweenPublicCharges;
  const need = Math.round(inp.dailyMiles * ASSUMPTIONS.rangeBuffer * daysPerCharge);
  const covered = countAtOrAbove(fleet.ranges, need);
  return { need, covered, total: fleet.ranges.length, share: fleet.ranges.length ? covered / fleet.ranges.length : 0, daysPerCharge };
}

/** Fast-charger access for trips: distance to the nearest DC fast station from home. */
function fastAccessScore(z) {
  if (z.ndc == null) return 15;
  if (z.ndc <= 10) return 90;
  if (z.ndc <= 25) return 70;
  if (z.ndc <= 50) return 45;
  return 20;
}

function localChargingScore(z) {
  let s = Math.round(0.6 * z.dcp + 0.4 * z.l2p);
  if (z.ndc == null || z.ndc > 30) s = Math.min(s, 20);
  return clamp(s, 0, 100);
}

function roadTripScore(inp, z) {
  const base = fastAccessScore(z);
  switch (inp.longTrips) {
    case 'rarely': return 100;
    case 'few': return Math.round(50 + base / 2);
    case 'monthly': return base;
    default: return Math.max(0, base - 10);
  }
}

/** Charging picture for each outdoor destination near this ZIP. */
export function destinations(z, parks, fleet) {
  return (z.pk || []).map(([idx, straightMi]) => {
    const p = parks[idx];
    const oneWay = Math.round(straightMi * ASSUMPTIONS.roadFactor);
    const roundTrip = oneWay * 2;
    // Do the round trip on one charge if it fits in 80% of a median EV's rated range.
    const noStopNeeded = roundTrip <= fleet.rangeMedian * 0.8;
    let chargingAtPark;
    if (p.ndc == null || p.ndc > 50) chargingAtPark = 'none';
    else if (p.ndc <= 10 && p.dc_25 >= 2) chargingAtPark = 'good';
    else if (p.ndc <= 25) chargingAtPark = 'some';
    else chargingAtPark = 'sparse';
    const score = noStopNeeded ? 95 : { good: 90, some: 70, sparse: 45, none: 15 }[chargingAtPark];
    return {
      code: p.code, name: p.name, kind: p.kind, url: p.url,
      oneWayMiles: oneWay, roundTripMiles: roundTrip, noStopNeeded,
      fastChargersNearPark: p.dc_25, nearestFastToPark: p.ndc, chargingAtPark, score,
    };
  });
}

function outdoorScore(dests) {
  const near = dests.filter((d) => d.oneWayMiles <= 320).slice(0, 2);
  if (!near.length) return 50; // nothing close: neither a plus nor a blocker
  return Math.round(near.reduce((a, d) => a + d.score, 0) / near.length);
}

// ---------- cost ----------

/**
 * Share of charging energy from home, Level 2 away from home (work or public), and DC fast.
 * Work charging is priced like public Level 2, which is conservative: some is free.
 */
export function chargingMix(inp, z) {
  const tripsDc = { rarely: 0.05, few: 0.1, monthly: 0.15, weekly: 0.25 }[inp.longTrips];
  const withHome = { home: 1 - tripsDc - 0.03, l2: 0.03, dc: tripsDc };
  const withWork = { home: 0, l2: 1 - tripsDc - 0.05, dc: tripsDc + 0.05 };
  const noHomeDc = z.l2_5 >= 5 ? 0.5 : 0.7;
  const publicOnly = { home: 0, l2: 1 - noHomeDc, dc: noHomeDc };
  const pHome = inp.homeChargeOdds;
  const pWork = (1 - pHome) * inp.workChargeOdds;
  const pPublic = 1 - pHome - pWork;
  const blend = (k) => pHome * withHome[k] + pWork * withWork[k] + pPublic * publicOnly[k];
  return { home: blend('home'), l2: blend('l2'), dc: blend('dc') };
}

export function annualCosts(inp, z, meta) {
  const miles = Math.round(inp.dailyMiles * 365 + optionOf('longTrips', inp.longTrips).perYear * ASSUMPTIONS.extraMilesPerLongTrip);
  const gas = meta.gasolineByState[z.s] || { price: null, area: null };
  const resCents = meta.electricityCentsPerKwh[z.s] ?? meta.electricityCentsPerKwh.US;
  const mix = chargingMix(inp, z);
  const pricePerKwh = mix.home * (resCents / 100) + mix.l2 * ASSUMPTIONS.publicL2PricePerKwh + mix.dc * ASSUMPTIONS.dcFastPricePerKwh;
  const kwh = (miles * meta.fleet[FLEET_KEY].kwhPer100Median) / 100; // EPA kWh/100 mi is measured at the wall, so it includes charging losses
  const evCost = kwh * pricePerKwh;
  const gasCost = gas.price ? (miles / ASSUMPTIONS.gasMpg) * gas.price : null;
  return {
    miles,
    gasPrice: gas.price,
    gasArea: gas.area,
    electricityCents: resCents,
    blendedPricePerKwh: Math.round(pricePerKwh * 1000) / 1000,
    mix,
    evCost: Math.round(evCost),
    gasCost: gasCost == null ? null : Math.round(gasCost),
    savings: gasCost == null ? null : Math.round(gasCost - evCost),
  };
}

// ---------- the recommendation ----------

export const TIERS = [
  { id: 'strong', min: 80, label: 'Strong fit' },
  { id: 'good', min: 65, label: 'Good fit with a plan' },
  { id: 'maybe', min: 45, label: 'Possible, with tradeoffs' },
  { id: 'notyet', min: 0, label: 'Not yet' },
];

const WEIGHTS = { home: 0.4, range: 0.2, local: 0.15, trips: 0.15, outdoor: 0.1 };

/**
 * Score a ZIP plus answers. Returns everything the results page shows,
 * including which inputs were assumed rather than answered.
 */
export function recommend({ zipRec, answers, meta, parks }) {
  const inp = resolveInputs(answers, zipRec, meta);
  const fleet = meta.fleet[FLEET_KEY];
  const range = rangeNeed(inp, fleet);
  const dests = destinations(zipRec, parks, fleet);

  const factors = {
    home: homeChargingScore(inp, zipRec),
    range: Math.round(100 * range.share),
    local: localChargingScore(zipRec),
    trips: roadTripScore(inp, zipRec),
    outdoor: outdoorScore(dests),
  };

  // Outdoor trips only count if the visitor takes them.
  const weights = { ...WEIGHTS };
  weights.outdoor = { rarely: 0, few: 0.1, monthly: 0.15 }[inp.outdoor];
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = Math.round(Object.keys(factors).reduce((s, k) => s + factors[k] * weights[k], 0) / wSum);

  // Without regular charging (home or work), an EV is a plan, not a no-brainer: dense
  // public charging can make it work, but it should never read as "Strong fit". The cap
  // slides from 74 (certainly no regular charging) to 99 (certainly yes).
  score = Math.min(score, Math.round(74 + 25 * inp.regularChargeOdds));
  // "Strong fit" needs to know about home charging, not guess it from the ZIP.
  if (inp.homeCharging === 'unknown') score = Math.min(score, 79);

  // Hard blockers cap the verdict no matter how good the rest looks.
  const blockers = [];
  if (inp.homeCharging === 'no' && inp.workChargeOdds === 0 && zipRec.l2_5 === 0 && (zipRec.ndc == null || zipRec.ndc > 15)) {
    blockers.push('no-charging-access');
    score = Math.min(score, 40);
  }
  if (range.covered === 0) {
    blockers.push('range-exceeds-lineup');
    score = Math.min(score, 40);
  }

  const tier = TIERS.find((t) => score >= t.min);
  const costs = annualCosts(inp, zipRec, meta);
  const confidence = inp.assumed.length === 0 ? 'high' : inp.assumed.length <= 2 ? 'medium' : 'low';

  return {
    score,
    tier: tier.id,
    tierLabel: tier.label,
    confidence,
    inputs: inp,
    factors,
    weights,
    blockers,
    range,
    costs,
    destinations: dests,
    charging: {
      l2Within5: zipRec.l2_5,
      l2Within10: zipRec.l2_10,
      dcWithin10: zipRec.dc_10,
      dcWithin25: zipRec.dc_25,
      nearestDc: zipRec.ndc,
      nearestL2: zipRec.nl2,
      dcPercentile: zipRec.dcp,
      l2Percentile: zipRec.l2p,
    },
    reasons: reasonsFor({ inp, factors, range, costs, zipRec, blockers }),
  };
}

/**
 * Plain-language reasons, strongest first. Each has a tone (plus / minus / check)
 * and an id the UI maps to copy, so the logic never produces HTML.
 */
export function reasonsFor({ inp, factors, range, costs, zipRec, blockers }) {
  const r = [];
  if (inp.homeCharging === 'yes') r.push({ id: 'home-yes', tone: 'plus', weight: 40 });
  else if (inp.homeCharging === 'install') r.push({ id: 'home-install', tone: 'check', weight: 30 });
  else if (inp.homeCharging === 'ask') r.push({ id: 'home-ask', tone: 'check', weight: 38 });
  else if (inp.homeCharging === 'no') {
    const dense = publicSubstituteScore(zipRec) >= 50;
    r.push({ id: dense ? 'home-no-dense' : 'home-no-sparse', tone: dense || inp.workCharging === 'yes' ? 'check' : 'minus', weight: 40 });
  } else r.push({ id: 'home-unknown', tone: 'check', weight: 35, value: Math.round(inp.homeChargeOdds * 100) });
  if (inp.workCharging === 'yes') r.push({ id: 'work-yes', tone: 'plus', weight: 36 });

  if (range.share >= 0.9) r.push({ id: 'range-easy', tone: 'plus', weight: 20, value: range.need });
  else if (range.share >= 0.4) r.push({ id: 'range-some', tone: 'check', weight: 20, value: range.need });
  else r.push({ id: 'range-hard', tone: 'minus', weight: 25, value: range.need });

  if (factors.local >= 60) r.push({ id: 'local-strong', tone: 'plus', weight: 15, value: zipRec.dcp });
  else if (factors.local >= 30) r.push({ id: 'local-ok', tone: 'check', weight: 12 });
  else r.push({ id: 'local-weak', tone: 'minus', weight: 15 });

  if (inp.longTrips === 'monthly' || inp.longTrips === 'weekly') {
    r.push(factors.trips >= 65 ? { id: 'trips-ok', tone: 'plus', weight: 12 } : { id: 'trips-hard', tone: 'minus', weight: 15 });
  }

  if (costs.savings != null) {
    if (costs.savings >= 300) r.push({ id: 'savings-yes', tone: 'plus', weight: 14, value: costs.savings });
    else if (costs.savings >= 0) r.push({ id: 'savings-small', tone: 'check', weight: 8, value: costs.savings });
    else r.push({ id: 'savings-none', tone: 'minus', weight: 10, value: costs.savings });
  }

  for (const b of blockers) r.push({ id: `blocker-${b}`, tone: 'minus', weight: 100 });
  return r.sort((a, b) => b.weight - a.weight);
}

// ---------- the "Get my EV plan" checklist ----------

/**
 * Concrete next steps from a recommendation, most important first.
 * Returns ids and values only; the UI maps them to text (copy.js PLAN_COPY).
 */
export function planFor(rec) {
  const inp = rec.inputs;
  const steps = [];
  if (inp.homeCharging === 'install') steps.push({ id: 'plan-install' });
  else if (inp.homeCharging === 'ask') steps.push({ id: 'plan-landlord' });
  else if (inp.homeCharging === 'unknown') steps.push({ id: 'plan-find-home' });
  if (inp.workCharging === 'yes') steps.push({ id: 'plan-work' });
  if (inp.homeCharging !== 'yes' && inp.homeCharging !== 'install') steps.push({ id: 'plan-public', value: rec.charging.nearestDc });
  if (inp.homeCharging === 'yes') steps.push({ id: 'plan-home-l2' });
  // When every vehicle in the class covers the need, range is not the thing to shop on.
  steps.push({ id: rec.range.covered === rec.range.total ? 'plan-range-any' : 'plan-range', value: rec.range.need });
  const tricky = rec.destinations.find((d) => !d.noStopNeeded && d.chargingAtPark !== 'good' && d.oneWayMiles <= 400);
  if (inp.outdoor !== 'rarely' && tricky) steps.push({ id: 'plan-park', value: tricky.name });
  if (inp.longTrips === 'monthly' || inp.longTrips === 'weekly') steps.push({ id: 'plan-route' });
  steps.push({ id: 'plan-test-drive' });
  return steps;
}
