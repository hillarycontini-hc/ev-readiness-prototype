import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRoute, corridorCells, durationText, legMilesFromRange, milesBetween, planStops, stopsBucket } from '../site/js/trip.js';

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

test('leg miles from EPA range use the site-wide 1.5x buffer, within limits', () => {
  assert.equal(legMilesFromRange(300), 200);
  assert.equal(legMilesFromRange(251), 167);
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
