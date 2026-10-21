import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRoute, corridorCells, durationText, legMilesFromRange, milesBetween, planStops, sameTrip, stopsBucket, suggestFixes, tripCost } from '../site/js/trip.js';

// A straight east-west road along latitude 40 starting near Denver: one point every ~1.06 miles.
const MI_PER_DEG_LON = milesBetween(40, -105, 40, -104);
function straightRoute(miles) {
  const n = Math.ceil(miles) + 1;
  const points = Array.from({ length: n }, (_, i) => [40, Math.round((-105 + (miles * i) / (n - 1) / MI_PER_DEG_LON) * 1e4) / 1e4]);
  return { miles, minutes: Math.round(miles), points };
}
// A fast charger `atMile` along that road, `off` miles north of it.
let nextId = 1;
const station = (atMile, { off = 0, fast = 4, connectors = 'CN' } = {}) => ({
  id: nextId++, name: `Station at ${atMile}`, lat: 40 + off / 69, lon: -105 + atMile / MI_PER_DEG_LON, fast, connectors, network: 'Test',
});

test('cleanRoute accepts a well-formed route and rejects anything else', () => {
  const r = straightRoute(100);
  assert.deepEqual(cleanRoute(r).points.length, r.points.length);
  assert.equal(cleanRoute(null), null);
  assert.equal(cleanRoute({ ...r, miles: -1 }), null);
  assert.equal(cleanRoute({ ...r, miles: '100' }), null);
  assert.equal(cleanRoute({ ...r, minutes: Infinity }), null);
  assert.equal(cleanRoute({ ...r, points: [[40, -105]] }), null, 'needs two points');
  assert.equal(cleanRoute({ ...r, points: [[40, -105], [51.5, -0.1]] }), null, 'every point in the U.S.');
  assert.equal(cleanRoute({ ...r, points: [[40, -105], [40, '-104']] }), null);
  assert.equal(cleanRoute({ ...r, points: Array(601).fill([40, -105]) }), null, 'at most 600 points');
});

test('leg miles are about 70% of the lowest EPA range, to the nearest 5, within limits', () => {
  assert.equal(legMilesFromRange(300), 210);
  assert.equal(legMilesFromRange(221), 155);
  assert.equal(legMilesFromRange(251), 175);
  assert.equal(legMilesFromRange(30), 40, 'never below 40');
  assert.equal(legMilesFromRange(900), 500, 'never above 500');
  assert.equal(legMilesFromRange(undefined), null);
});

test('a trip shorter than one leg needs no stop', () => {
  const plan = planStops({ route: straightRoute(150), stations: [station(75)], legMiles: 200 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.stops, []);
  assert.equal(plan.finalLegMiles, 150);
  assert.equal(plan.arriveWithMiles, 50);
});

test('every leg stays under the miles per leg, and the farthest reachable charger is chosen', () => {
  const stations = [20, 90, 150, 190, 260, 330, 380].map((m) => station(m));
  const plan = planStops({ route: straightRoute(420), stations, legMiles: 200 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.stops.map((s) => s.atMile), [190, 380]);
  for (const s of plan.stops) assert.ok(s.legMiles <= 200, `leg ${s.legMiles}`);
  assert.ok(plan.finalLegMiles <= 200);
  assert.equal(plan.stops[0].legMiles, 190);
  assert.equal(plan.stops[1].legMiles, 190);
  assert.equal(plan.finalLegMiles, 40);
});

test('the detour off the road and back counts against the leg', () => {
  // Off by 2 miles: 2.5 road miles to get there, 2.5 to get back.
  const plan = planStops({ route: straightRoute(300), stations: [station(198, { off: 2 }), station(150)], legMiles: 200 });
  assert.deepEqual(plan.stops.map((s) => s.atMile), [150], '198 + 2.5 is over 200, so the stop at 150 is used');
  const ok = planStops({ route: straightRoute(300), stations: [station(190, { off: 2 })], legMiles: 200 });
  assert.equal(ok.stops[0].legMiles, 193);
  assert.equal(ok.stops[0].detourMiles, 2.5);
  assert.equal(ok.finalLegMiles, 113, '110 more miles plus the 2.5 back to the road');
});

test('chargers more than 3 miles off the road are ignored', () => {
  const plan = planStops({ route: straightRoute(300), stations: [station(150, { off: 5 })], legMiles: 200 });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'gap');
  assert.equal(plan.stuckAtMile, 0);
});

test('only fast chargers with a usable plug count', () => {
  const route = straightRoute(300);
  const slow = station(150, { fast: 0 });
  const chademo = station(151, { connectors: 'D' });
  const nacs = station(152, { connectors: 'N' });
  assert.equal(planStops({ route, stations: [slow, chademo], legMiles: 200 }).ok, false, 'Level 2 and CHAdeMO-only are never stops');
  assert.equal(planStops({ route, stations: [nacs], legMiles: 200, plug: 'ccs' }).ok, false, 'a CCS car cannot use a NACS-only station');
  assert.equal(planStops({ route, stations: [nacs], legMiles: 200, plug: 'nacs' }).stops[0].id, nacs.id);
  assert.equal(planStops({ route, stations: [nacs], legMiles: 200, plug: 'any' }).stops[0].id, nacs.id);
});

test('near the edge of reach, more fast ports win over a few extra miles', () => {
  const small = station(199, { fast: 1 });
  const big = station(185, { fast: 12 });
  const far = station(170, { fast: 20 });
  const plan = planStops({ route: straightRoute(300), stations: [small, big, far], legMiles: 200 });
  assert.equal(plan.stops[0].id, big.id, '185 is within the last 10% (20 mi) of reach; 170 is not');
});

test('a gap with no reachable charger says where the planner got stuck', () => {
  const plan = planStops({ route: straightRoute(600), stations: [station(150), station(450)], legMiles: 200 });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'gap');
  assert.equal(plan.stuckAtMile, 150);
  assert.equal(plan.stops.length, 1);
});

test('the number of stops is capped', () => {
  const stations = Array.from({ length: 40 }, (_, i) => station(45 * (i + 1)));
  const plan = planStops({ route: straightRoute(1000), stations, legMiles: 50, maxStops: 12 });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'too_many_stops');
  assert.equal(plan.stops.length, 12);
});

test('road miles longer than the simplified line stretch every position', () => {
  const route = { ...straightRoute(200), miles: 250 }; // the road winds: 1.25x the drawn line
  const plan = planStops({ route, stations: [station(100)], legMiles: 200 });
  assert.equal(plan.stops[0].atMile, 125);
  assert.equal(plan.finalLegMiles, 125);
});

test('a duplicate station id is used once', () => {
  const s = station(150);
  const plan = planStops({ route: straightRoute(300), stations: [s, { ...s }], legMiles: 200 });
  assert.equal(plan.stops.length, 1);
});

test('corridor cells cover the line and its sides', () => {
  const cells = corridorCells([[40.01, -105.01], [40.01, -104.2]], 3);
  assert.ok(cells.includes('80_-211') && cells.includes('80_-210'), cells.join(' '));
  assert.ok(cells.includes('79_-211'), 'a point 0.01 deg above a cell edge also loads the cell below');
  assert.ok(!cells.includes('81_-211'));
});

test('drive time and stop buckets', () => {
  assert.equal(durationText(45), '45 min');
  assert.equal(durationText(120), '2 h');
  assert.equal(durationText(410), '6 h 50 min');
  assert.deepEqual([0, 1, 2, 3, 4, 12].map(stopsBucket), ['0', '1', '2-3', '2-3', '4+', '4+']);
});

test('the answer names the stops, and the drive home is judged against the miles left', async () => {
  const { answerText, homeText } = await import('../site/js/trip-tool.js');
  const stop = (city, atMile) => ({ name: `Site in ${city}`, city, atMile });
  const base = { to: { name: 'The Park' }, legMiles: 210, arriveWithMiles: 98 };
  assert.equal(answerText({ ...base, stops: [] }), 'No charging stop needed: you’d arrive with about 98 of your 210 planned miles to spare.');
  assert.equal(answerText({ ...base, stops: [stop('Pueblo', 152)] }), '1 fast-charging stop: Pueblo (road mile 152).');
  assert.equal(answerText({ ...base, stops: [stop('Denver', 40), stop('Pueblo', 152)] }), '2 fast-charging stops: Denver (road mile 40) and Pueblo (road mile 152).');
  assert.equal(answerText({ ...base, stops: [1, 2, 3, 4].map((i) => stop(`Town ${i}`, i * 100)) }), '4 fast-charging stops, the first at Town 1 (road mile 100).');
  assert.match(homeText({ ...base, stops: [], returnMiles: 107, returnTo: 'charger' }, 25), /about 107 miles away, more than the 98 planned miles you’d have left\. Charge near The Park before heading back\. The nearest fast charger to the park is about 25 miles/);
  assert.match(homeText({ ...base, stops: [], returnMiles: 60, returnTo: 'charger' }), /about 60 miles from The Park, and the 98 planned miles you’d have left reach it\.$/);
  assert.match(homeText({ ...base, stops: [], returnMiles: 90, returnTo: 'home' }), /no fast charger on this route, but the 98 planned miles you’d have left cover the 90 miles home/);
  assert.equal(homeText({ ...base, stops: [], returnMiles: null }), null, 'an older saved trip without it says nothing');
});

test('trip cost: first leg at the home rate, the rest at fast chargers, EPA to +30%', () => {
  // 262 miles, 157 on the home charge, 105 fast-charged; 30 kWh/100 mi; 15 cents at home; $0.53 fast.
  const c = tripCost({ miles: 262, firstLegMiles: 157, kwh100: 30, homeCentsPerKwh: 15, dcPerKwh: 0.53, gasPrice: 3.2, mpg: 27 });
  // (157 x 0.15 + 105 x 0.53) x 0.30 = 23.76 -> $25; x 1.3 = 30.89 -> $30. Gas: 262 / 27 x 3.2 = 31.05 -> $30.
  assert.deepEqual(c, { low: 25, high: 30, homeMiles: 157, fastMiles: 105, gas: 30 });
  const noStop = tripCost({ miles: 100, firstLegMiles: 100, kwh100: 30, homeCentsPerKwh: 15, dcPerKwh: 0.53, gasPrice: null, mpg: 27 });
  assert.equal(noStop.fastMiles, 0, 'with no stop, the whole drive is on the home charge');
  assert.equal(noStop.gas, null, 'no gas price, no comparison');
  assert.equal(noStop.low, 5, 'never shown as $0');
});

test('a stop that can finish the trip beats a bigger one that would need another stop', () => {
  // 262 miles, 110 per leg. From mile 108, both 152 (12 ports) and 157 (2 ports) are in reach.
  // Only 157 leaves 105 miles, inside one leg; 152 would leave 110 plus the detour.
  const route = straightRoute(262);
  const stations = [station(108), station(152, { fast: 12, off: 0.5 }), station(157, { fast: 2 })];
  const plan = planStops({ route, stations, legMiles: 110 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.stops.map((s) => s.atMile), [108, 157]);
});

test('a gap says where the next charger is, or that there is none before the destination', () => {
  const some = planStops({ route: straightRoute(600), stations: [station(150), station(450)], legMiles: 200 });
  assert.equal(some.nextAtMile, 450);
  const none = planStops({ route: straightRoute(300), stations: [station(100)], legMiles: 120 });
  assert.equal(none.stuckAtMile, 100);
  assert.equal(none.nextAtMile, null);
});

test('suggested fixes: the fewest miles between charges that work, and whether either plug would', () => {
  const route = straightRoute(400);
  // CCS stations every 90 miles; a NACS-only one at 160.
  const stations = [station(90, { connectors: 'C' }), station(160, { connectors: 'N' }), station(180, { connectors: 'C' }), station(270, { connectors: 'C' }), station(330, { connectors: 'C' })];
  const fixes = suggestFixes({ route, stations, legMiles: 80, plug: 'ccs' });
  // Stops sit about 90 road miles apart (a little over, from the drawn line), so 95 is the fewest that works.
  assert.equal(fixes.minLegMiles, 95);
  assert.ok(planStops({ route, stations, legMiles: 95, plug: 'ccs' }).ok);
  assert.ok(!planStops({ route, stations, legMiles: 90, plug: 'ccs' }).ok, 'and 5 fewer does not');
  assert.equal(fixes.epaNeeded, 140, '95 / 0.7 = 135.7, up to the next 5');
  assert.equal(fixes.plugHelps, false, 'at 80 miles even either plug leaves a gap');
  const plugFix = suggestFixes({ route: straightRoute(240), stations: [station(80, { connectors: 'C' }), station(160, { connectors: 'N' })], legMiles: 90, plug: 'ccs' });
  assert.equal(plugFix.plugHelps, true, 'the NACS stop at 160 bridges the gap');
  assert.equal(suggestFixes({ route: straightRoute(900), stations: [], legMiles: 200 }).minLegMiles, null, 'no setting fixes a route with no chargers beyond 500 miles');
});

test('with "Either plug", a CCS stop wins over a NACS-only one nearby, but never at the cost of a stop', () => {
  const route = straightRoute(300);
  const nacs = station(195, { fast: 20, connectors: 'N' });
  const ccs = station(185, { fast: 4, connectors: 'C' });
  assert.equal(planStops({ route, stations: [nacs, ccs], legMiles: 200 }).stops[0].id, ccs.id, 'both finish the trip; the CCS one is chosen');
  assert.equal(planStops({ route, stations: [nacs, ccs], legMiles: 200, plug: 'nacs' }).stops[0].id, nacs.id, 'a NACS car keeps the bigger site');
  // Only the NACS stop lets the trip finish in one stop: it wins.
  const late = station(110, { fast: 4, connectors: 'C' });
  const finisher = station(120, { fast: 20, connectors: 'N' });
  const plan = planStops({ route: straightRoute(310), stations: [late, finisher], legMiles: 200 });
  assert.deepEqual(plan.stops.map((x) => x.id), [finisher.id]);
});

test('the drive home: how far back to the last fast charger on the route, or all the way home', () => {
  const plan = planStops({ route: straightRoute(300), stations: [station(150), station(260)], legMiles: 200 });
  assert.equal(plan.returnTo, 'charger');
  assert.equal(plan.returnMiles, 40, 'the charger at mile 260 is 40 miles back from the destination');
  const none = planStops({ route: straightRoute(150), stations: [], legMiles: 200 });
  assert.deepEqual([none.returnTo, none.returnMiles], ['home', 150]);
});

test('the same trip: same start and end (to about 10 m), miles between charges, and plug', () => {
  const t = { from: { lat: 40.015, lon: -105.2705 }, to: { lat: 37.733, lon: -105.5123 }, legMiles: 210, plug: 'any', car: 'Typical electric SUV' };
  assert.ok(sameTrip(t, { ...t, id: 'other', car: 'Another car' }), 'the car name alone does not make a different trip');
  assert.ok(sameTrip(t, { ...t, from: { lat: 40.01502, lon: -105.27051 } }), 'rounding noise is the same place');
  assert.ok(!sameTrip(t, { ...t, legMiles: 110 }));
  assert.ok(!sameTrip(t, { ...t, plug: 'ccs' }));
  assert.ok(!sameTrip(t, { ...t, from: { lat: 40.1672, lon: -105.1019 } }));
  assert.ok(!sameTrip(t, { ...t, to: { lat: 37.793, lon: -105.592 } }));
  assert.ok(!sameTrip(t, null));
});
