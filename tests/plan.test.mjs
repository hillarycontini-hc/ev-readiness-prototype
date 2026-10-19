import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loanPayment, leasePayment, moneyFactorToApr } from '../site/js/finance.js';
import { sanitizePlan, sharePayload, encodeShare, decodeShare, emptyPlan, FINANCE_DEFAULTS } from '../site/js/plan-store.js';
import { milesBetween, connectorNames } from '../site/js/places.js';

test('loan payment matches the standard amortization formula', () => {
  // $50,000 at 7% for 60 months is about $990.06.
  assert.equal(Math.round(loanPayment({ price: 50000, down: 0, aprPct: 7, months: 60 }) * 100) / 100, 990.06);
  assert.equal(loanPayment({ price: 30000, down: 0, aprPct: 0, months: 60 }), 500);
  assert.equal(loanPayment({ price: 10000, down: 12000, aprPct: 7, months: 60 }), 0, 'down payment above price means no loan');
});

test('lease payment is depreciation plus finance charge', () => {
  // msrp 50k, residual 55% = 27.5k, cap 50k: (22.5k / 36) + (77.5k x 0.0025) = 625 + 193.75
  assert.equal(Math.round(leasePayment({ msrp: 50000, price: 50000, residualPct: 55, moneyFactor: 0.0025, months: 36 }) * 100) / 100, 818.75);
  assert.ok(leasePayment({ msrp: 50000, price: 50000, dueAtSigning: 3000, residualPct: 55, moneyFactor: 0.0025, months: 36 }) < 818.75);
  assert.equal(moneyFactorToApr(0.0025), 6);
});

test('a share link round-trips, and places are left out unless the visitor opts in', async () => {
  const plan = emptyPlan();
  plan.zip = '80302';
  plan.answers = { dailyMiles: '20to40', homeCharging: 'ask' };
  plan.places = [{ id: 'work-1', slot: 'work', name: 'Office', detail: '1 Main St, Boulder, CO', lat: 40.01, lon: -105.27 }];
  plan.saved = { 'work-1': [{ id: 52642, name: 'Civic Center', street: '500 E 3rd St', city: 'Loveland', lat: 40.39, lon: -105.07, level2: 2, fast: 0, network: 'Non-Networked', connectors: 'J', hours: '24 hours daily', price: '', miles: 1.2 }] };
  plan.shortlist = ['rivian-r1s', 'kia-ev9'];

  const without = await decodeShare(await encodeShare(sharePayload(plan, { includePlaces: false })));
  assert.equal(without.zip, '80302');
  assert.deepEqual(without.shortlist, ['rivian-r1s', 'kia-ev9']);
  assert.deepEqual(without.places, []);
  assert.deepEqual(without.saved, {});

  const withPlaces = await decodeShare(await encodeShare(sharePayload(plan, { includePlaces: true })));
  assert.equal(withPlaces.places[0].name, 'Office');
  assert.equal(withPlaces.saved['work-1'][0].id, 52642);
});

test('a tampered share link is sanitized, never trusted', async () => {
  const evil = {
    v: 1, zip: '<script>', answers: { homeCharging: 'pwned', dailyMiles: '20to40', __proto__: { x: 1 } },
    places: [{ id: '../../x', slot: 'work', name: 'a', lat: 40, lon: -105 }, { id: 'ok-1', slot: 'mars', lat: 40, lon: -105 }, { id: 'ok-2', slot: 'gym', name: 'Gym', lat: 51.5, lon: -0.1 }],
    shortlist: ['<img src=x>', 'tesla-model-y', 'a', 'b', 'c'],
    finance: { aprPct: 999, months: 13, mode: 'steal' },
    done: ['plan-work', 'javascript:alert(1)'],
  };
  const p = await decodeShare(await encodeShare(evil));
  assert.equal(p.zip, null);
  assert.deepEqual(p.answers, { dailyMiles: '20to40' });
  assert.deepEqual(p.places, [], 'bad ids, unknown slots, and non-U.S. points are dropped');
  assert.deepEqual(p.shortlist, ['tesla-model-y', 'a', 'b'], 'only safe ids, at most three');
  assert.equal(p.finance.aprPct, FINANCE_DEFAULTS.aprPct);
  assert.equal(p.finance.months, FINANCE_DEFAULTS.months);
  assert.equal(p.finance.mode, FINANCE_DEFAULTS.mode);
  assert.deepEqual(p.done, ['plan-work']);
  assert.equal(await decodeShare('not base64!'), null);
  assert.equal(await decodeShare('A'.repeat(20000)), null);
  assert.deepEqual(sanitizePlan(null), emptyPlan());
});

test('distance and connector helpers', () => {
  assert.ok(Math.abs(milesBetween(40.015, -105.2705, 39.7392, -104.9903) - 24.5) < 1, 'Boulder to Denver is about 24.5 miles');
  assert.deepEqual(connectorNames('JCN'), ['J1772', 'CCS', 'NACS (Tesla)']);
});
