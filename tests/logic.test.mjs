import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeZip, countAtOrAbove, priorsFor, resolveInputs, rangeNeed, recommend, chargingMix, annualCosts, TIERS,
  questionsFor, planFor, FLEET_KEY,
} from '../site/js/logic.js';

const meta = JSON.parse(readFileSync(new URL('../site/data/meta.json', import.meta.url)));
const parks = JSON.parse(readFileSync(new URL('../site/data/parks.json', import.meta.url)));
const zipRec = (zip) => JSON.parse(readFileSync(new URL(`../site/data/zip/${zip.slice(0, 3)}.json`, import.meta.url)))[zip];

// Synthetic ZIPs so the rules are tested independent of the data refresh.
const city = { s: 'WA', sf: 20, own: 30, cm: 30, l2_5: 400, l2_10: 900, dc_10: 60, dc_25: 150, ndc: 0.5, nl2: 0.1, pk: [], dcp: 97, l2p: 99 };
const remote = { s: 'MT', sf: 80, own: 80, cm: 20, l2_5: 0, l2_10: 0, dc_10: 0, dc_25: 0, ndc: 80, nl2: 40, pk: [], dcp: 0, l2p: 0 };

test('normalizeZip accepts exactly five digits and nothing else', () => {
  assert.equal(normalizeZip('98101'), '98101');
  assert.equal(normalizeZip(' 98101 '), '98101');
  for (const bad of ['9810', '981011', '98101-1234', 'abcde', '<b>1</b>', '', null, undefined, 98101]) {
    assert.equal(normalizeZip(bad), null, String(bad));
  }
});

test('countAtOrAbove counts ranges that meet the need', () => {
  const r = [100, 200, 250, 300, 300, 400];
  assert.equal(countAtOrAbove(r, 0), 6);
  assert.equal(countAtOrAbove(r, 300), 3);
  assert.equal(countAtOrAbove(r, 301), 1);
  assert.equal(countAtOrAbove(r, 999), 0);
});

test('cold start: a ZIP alone produces a full answer with low confidence', () => {
  const rec = recommend({ zipRec: city, answers: {}, meta, parks });
  assert.equal(rec.confidence, 'low');
  assert.deepEqual(rec.inputs.assumed, ['dailyMiles', 'homeCharging', 'workCharging', 'longTrips', 'outdoor']);
  assert.ok(TIERS.some((t) => t.id === rec.tier));
  assert.ok(Number.isFinite(rec.score));
});

test('cold start never claims "Strong fit" without knowing about home charging', () => {
  const suburb = { ...city, sf: 95 };
  const rec = recommend({ zipRec: suburb, answers: { dailyMiles: '20to40', longTrips: 'rarely', outdoor: 'rarely' }, meta, parks });
  assert.equal(rec.inputs.homeCharging, 'unknown');
  assert.notEqual(rec.tier, 'strong');
  const answered = recommend({ zipRec: suburb, answers: { dailyMiles: '20to40', homeCharging: 'yes', longTrips: 'rarely', outdoor: 'rarely' }, meta, parks });
  assert.equal(answered.tier, 'strong');
});

test('priors scale daily miles by local commute and home charging by single-family share', () => {
  const longCommute = priorsFor({ ...city, cm: meta.nationalCommuteMinutes * 1.5, sf: 90 }, meta);
  const shortCommute = priorsFor({ ...city, cm: meta.nationalCommuteMinutes * 0.5, sf: 10 }, meta);
  assert.ok(longCommute.dailyMiles > shortCommute.dailyMiles);
  assert.ok(longCommute.homeChargeOdds > shortCommute.homeChargeOdds);
  // Missing ACS values fall back to national/neutral priors rather than failing.
  const missing = priorsFor({ ...city, cm: null, sf: null }, meta);
  assert.equal(missing.dailyMiles, 37);
  assert.equal(missing.homeChargeOdds, 0.5);
});

test('answering a question removes it from the assumed list', () => {
  const inp = resolveInputs({ dailyMiles: '20to40', homeCharging: 'yes' }, city, meta);
  assert.deepEqual(inp.assumed, ['longTrips', 'outdoor']);
  assert.equal(inp.dailyMiles, 30);
  assert.equal(inp.homeChargeOdds, 1);
});

test('unknown answer values are treated as skipped, not trusted', () => {
  const inp = resolveInputs({ dailyMiles: '<img src=x>', homeCharging: 'maybe', workCharging: 'sometimes', longTrips: 7 }, city, meta);
  assert.deepEqual(inp.assumed, ['dailyMiles', 'homeCharging', 'workCharging', 'longTrips', 'outdoor']);
});

test('home charging is the strongest single lever', () => {
  const base = { dailyMiles: '20to40', longTrips: 'few', outdoor: 'rarely' };
  const yes = recommend({ zipRec: city, answers: { ...base, homeCharging: 'yes' }, meta, parks });
  const no = recommend({ zipRec: city, answers: { ...base, homeCharging: 'no' }, meta, parks });
  assert.ok(yes.score > no.score);
  assert.equal(yes.tier, 'strong');
});

test('no home charging never reads as "Strong fit", even with dense public charging', () => {
  const rec = recommend({ zipRec: city, answers: { dailyMiles: 'under20', homeCharging: 'no', longTrips: 'rarely', outdoor: 'rarely' }, meta, parks });
  assert.equal(rec.tier, 'good');
});

test('no home charging in a charging desert is capped at "Not yet"', () => {
  const rec = recommend({ zipRec: remote, answers: { dailyMiles: '40to70', homeCharging: 'no', longTrips: 'monthly', outdoor: 'rarely' }, meta, parks });
  assert.ok(rec.blockers.includes('no-charging-access'));
  assert.equal(rec.tier, 'notyet');
});

test('a rural visitor with home charging can still be a good fit', () => {
  const rec = recommend({ zipRec: remote, answers: { dailyMiles: '20to40', homeCharging: 'yes', longTrips: 'rarely', outdoor: 'rarely' }, meta, parks });
  assert.ok(['strong', 'good'].includes(rec.tier), rec.tier);
});

test('range need grows when there is no home charging', () => {
  const home = rangeNeed(resolveInputs({ dailyMiles: '40to70', homeCharging: 'yes' }, city, meta), meta.fleet.all);
  const none = rangeNeed(resolveInputs({ dailyMiles: '40to70', homeCharging: 'no' }, city, meta), meta.fleet.all);
  assert.ok(none.need > home.need);
  assert.ok(none.covered <= home.covered);
});

test('charging mix always sums to 1', () => {
  for (const homeCharging of ['yes', 'install', 'ask', 'no', undefined]) {
    for (const longTrips of ['rarely', 'few', 'monthly', 'weekly']) {
      for (const workCharging of ['yes', 'no', undefined]) {
        const m = chargingMix(resolveInputs({ homeCharging, workCharging, longTrips }, city, meta), city);
        assert.ok(Math.abs(m.home + m.l2 + m.dc - 1) < 1e-9, `${homeCharging}/${workCharging}/${longTrips}`);
      }
    }
  }
});

test('home charging is cheaper per mile than relying on public fast charging', () => {
  const yes = annualCosts(resolveInputs({ dailyMiles: '20to40', homeCharging: 'yes', longTrips: 'rarely' }, city, meta), city, meta);
  const no = annualCosts(resolveInputs({ dailyMiles: '20to40', homeCharging: 'no', longTrips: 'rarely' }, city, meta), city, meta);
  assert.equal(yes.miles, no.miles);
  assert.ok(yes.evCost < no.evCost);
});

test('real data: every state has electricity and gasoline prices', () => {
  for (const st of Object.keys(meta.gasolineByState)) {
    assert.ok(meta.gasolineByState[st]?.price > 0, `gas ${st}`);
    assert.ok(meta.electricityCentsPerKwh[st] > 0, `electricity ${st}`);
  }
});

test('real data: known ZIPs resolve and produce a recommendation', () => {
  for (const zip of ['10001', '98101', '59001', '87501', '04609']) {
    const z = zipRec(zip);
    assert.ok(z, zip);
    const rec = recommend({ zipRec: z, answers: {}, meta, parks });
    assert.ok(rec.destinations.length >= 1, `${zip} has an outdoor destination`);
  }
});

test('real data: dense city scores higher on local charging than rural Montana', () => {
  const nyc = recommend({ zipRec: zipRec('10001'), answers: {}, meta, parks });
  const mt = recommend({ zipRec: zipRec('59001'), answers: {}, meta, parks });
  assert.ok(nyc.factors.local > mt.factors.local);
});

// ---------- renter persona ----------

test('work charging is asked only when home charging is not certain', () => {
  assert.ok(!questionsFor({ homeCharging: 'yes' }).includes('workCharging'));
  assert.ok(!questionsFor({ homeCharging: 'install' }).includes('workCharging'));
  for (const homeCharging of ['ask', 'no', undefined]) assert.ok(questionsFor({ homeCharging }).includes('workCharging'), String(homeCharging));
  // An answer to a question that no longer applies is ignored, not trusted.
  const inp = resolveInputs({ homeCharging: 'yes', workCharging: 'yes' }, city, meta);
  assert.equal(inp.workChargeOdds, 0);
  assert.equal(inp.workCharging, 'not-asked');
  assert.ok(!inp.assumed.includes('workCharging'));
});

test('a renter with charging at work does better than one without', () => {
  const base = { dailyMiles: '20to40', homeCharging: 'no', longTrips: 'few', outdoor: 'few' };
  const work = recommend({ zipRec: remote, answers: { ...base, workCharging: 'yes' }, meta, parks });
  const none = recommend({ zipRec: remote, answers: { ...base, workCharging: 'no' }, meta, parks });
  assert.ok(work.score > none.score);
  assert.ok(!work.blockers.includes('no-charging-access'), 'work charging removes the no-access blocker');
  assert.ok(work.reasons.some((r) => r.id === 'work-yes'));
});

test('a landlord "maybe" without daytime charging never reads as "Strong fit"', () => {
  const base = { dailyMiles: '20to40', homeCharging: 'ask', longTrips: 'few', outdoor: 'monthly' };
  const maybe = recommend({ zipRec: zipRec('80302'), answers: { ...base, workCharging: 'no' }, meta, parks });
  assert.equal(maybe.tier, 'good');
  // Confirmed daytime charging is a known place to charge, so the cap lifts.
  const withWork = recommend({ zipRec: zipRec('80302'), answers: { ...base, workCharging: 'yes' }, meta, parks });
  assert.ok(withWork.score > maybe.score);
});

test('asking the landlord sits between yes and no', () => {
  const base = { dailyMiles: '20to40', workCharging: 'no', longTrips: 'few', outdoor: 'few' };
  const score = (homeCharging) => recommend({ zipRec: city, answers: { ...base, homeCharging }, meta, parks }).score;
  assert.ok(score('yes') > score('ask'));
  assert.ok(score('ask') > score('no'));
});

test('compared against SUVs, minivans, and pickups (room for car seats, a dog, and gear)', () => {
  assert.equal(FLEET_KEY, 'suvTruck');
  const rec = recommend({ zipRec: city, answers: {}, meta, parks });
  assert.equal(rec.range.total, meta.fleet.suvTruck.count);
});

test('the EV plan always ends with a test drive and reflects the renter situation', () => {
  const rec = recommend({ zipRec: city, answers: { dailyMiles: '20to40', homeCharging: 'ask', workCharging: 'yes', longTrips: 'monthly', outdoor: 'few' }, meta, parks });
  const ids = planFor(rec).map((s) => s.id);
  assert.equal(ids.at(-1), 'plan-test-drive');
  for (const id of ['plan-landlord', 'plan-work', 'plan-public', 'plan-route']) assert.ok(ids.includes(id), id);
  assert.ok(ids.includes('plan-range-any'), 'range advice adapts when every vehicle covers the need');
  assert.ok(!ids.includes('plan-home-l2'));
});
