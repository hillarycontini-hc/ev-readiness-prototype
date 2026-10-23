// Car explorer sorting and labels: neutral ties, missing data last, honest wording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableSorts, compareBy, hasIihs, recentAwards, safetyText } from '../site/js/car-sort.js';

const car = (make, model, over = {}) => ({ make, model, modelYear: 2026, msrp: 50000, rangeMax: 300, seats: 5, thirdRow: false, nhtsa: null, cargo: null, iihs: null, awards: [], ...over });
const byPrice = (a, b) => a.msrp - b.msrp;
const names = (list) => list.map((v) => v.model);

test('price is the default order, with ties broken by name, never by brand', () => {
  const list = [car('Zed', 'B', { msrp: 40000 }), car('Acme', 'A', { msrp: 40000 }), car('Mid', 'C', { msrp: 30000 })];
  assert.deepEqual(names([...list].sort(compareBy('price', byPrice))), ['C', 'A', 'B']);
});

test('range and seats sort high to low, and ties fall back to price', () => {
  const list = [car('A', 'cheap300', { msrp: 40000 }), car('B', 'pricey300', { msrp: 60000 }), car('C', 'far', { rangeMax: 400, msrp: 90000 })];
  assert.deepEqual(names([...list].sort(compareBy('range', byPrice))), ['far', 'cheap300', 'pricey300']);
  const seats = [car('A', 'five'), car('B', 'seven', { seats: 7, thirdRow: true }), car('C', 'six', { seats: 6, thirdRow: true })];
  assert.deepEqual(names([...seats].sort(compareBy('seats', byPrice))), ['seven', 'six', 'five']);
});

test('unrated cars sort after rated ones and are never treated as zero', () => {
  const list = [
    car('A', 'unrated', { msrp: 30000 }),
    car('B', 'four', { nhtsa: { stars: 4, starsMax: 4, ratedVersions: 1, versions: 1 } }),
    car('C', 'five', { msrp: 70000, nhtsa: { stars: 5, starsMax: 5, year: 2026, ratedVersions: 2, versions: 2 } }),
    car('D', 'found-unrated', { msrp: 20000, nhtsa: { stars: null, starsMax: null, ratedVersions: 0, versions: 1 } }),
  ];
  assert.deepEqual(names([...list].sort(compareBy('safety', byPrice))), ['five', 'four', 'found-unrated', 'unrated']);
  assert.equal(safetyText(list[0]), 'NHTSA: Not yet rated');
  assert.equal(safetyText(list[3]), 'NHTSA: Not yet rated');
  assert.equal(safetyText(list[2]), 'NHTSA: 5-star overall');
  assert.equal(safetyText(car('E', 'mixed', { nhtsa: { stars: 4, starsMax: 5, year: 2026, ratedVersions: 2, versions: 3 } })), 'NHTSA: 4 to 5 stars overall, by version (2 of 3 versions rated)');
});

test('cargo and awards sorts appear only once some car has that data, and missing values go last', () => {
  const plain = [car('A', 'a'), car('B', 'b')];
  assert.deepEqual(availableSorts(plain), ['price', 'range', 'seats', 'safety']);
  assert.equal(hasIihs(plain), false);
  const award = { name: 'EV of the Year', publisher: 'Example', year: 2026, url: 'https://example.com/a' };
  const rich = [car('A', 'no-cargo', { msrp: 10000 }), car('B', 'cargo', { cargo: { value: 30 } }), car('C', 'old-award', { awards: [{ ...award, year: 2022 }] }), car('D', 'award', { awards: [award] })];
  assert.deepEqual(availableSorts(rich), ['price', 'range', 'seats', 'cargo', 'safety', 'awards']);
  assert.deepEqual(names([...rich].sort(compareBy('cargo', byPrice))).slice(0, 1), ['cargo']);
  assert.equal(recentAwards(rich[2]).length, 0, 'awards older than three model years are not counted');
  assert.deepEqual(names([...rich].sort(compareBy('awards', byPrice)))[0], 'award');
});

test('a rating carried over from the previous model year says which year it is', () => {
  const v = car('A', 'carry', { modelYear: 2027, nhtsa: { stars: 5, starsMax: 5, year: 2026, ratedVersions: 1, versions: 2 } });
  assert.equal(safetyText(v), 'NHTSA: 5-star overall (2026 model; 1 of 2 versions rated)');
});
