// Vehicle research rules: only allowed sites, short quotes, known cars, and only reviewed files publish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEntry, checkResearch, onAllowedHost } from '../scripts/data/research-rules.mjs';

const cars = [{ make: 'Kia', model: 'EV9' }, { make: 'Rivian', model: 'R1T' }];
const award = { name: 'World Car of the Year', publisher: 'World Car Awards', year: 2024, url: 'https://www.worldcarawards.com/winners', evidence: 'Kia EV9 named World Car of the Year' };
const reviewed = (vehicles) => ({ status: 'reviewed', reviewedBy: 'Hillary Contini', reviewedAt: '2026-10-23', vehicles });

test('hosts must be https and on an allowed site or its subdomain', () => {
  assert.ok(onAllowedHost('https://www.iihs.org/ratings', ['iihs.org']));
  assert.ok(onAllowedHost('https://iihs.org/x', ['iihs.org']));
  assert.equal(onAllowedHost('http://www.iihs.org/x', ['iihs.org']), false);
  assert.equal(onAllowedHost('https://iihs.org.evil.example/x', ['iihs.org']), false);
  assert.equal(onAllowedHost('https://notiihs.org/x', ['iihs.org']), false);
  assert.equal(onAllowedHost('https://user@www.iihs.org/x', ['iihs.org']), false);
  assert.equal(onAllowedHost('javascript:alert(1)', ['iihs.org']), false);
});

test('each kind of fact must come from its own kind of site', () => {
  assert.deepEqual(checkEntry('kia-ev9', 'Kia', { awards: [award] }), []);
  assert.match(checkEntry('kia-ev9', 'Kia', { awards: [{ ...award, url: 'https://www.kia.com/award' }] })[0], /worldcarawards\.com/);
  assert.match(checkEntry('kia-ev9', 'Kia', { iihs: { award: 'TSP+', year: 2026, source: 'https://www.kia.com/safety', evidence: 'x' } })[0], /iihs\.org/);
  assert.match(checkEntry('kia-ev9', 'Kia', { cargoCuFt: { value: 20.2, source: 'https://www.cars.com/kia', evidence: 'x' } })[0], /Kia's own site/);
  assert.deepEqual(checkEntry('kia-ev9', 'Kia', { cargoCuFt: { value: 20.2, source: 'https://www.kia.com/us/en/ev9/specs', evidence: '20.2 cu ft behind 2nd row' } }), []);
  assert.match(checkEntry('kia-ev9', 'Kia', { awards: [{ ...award, publisher: 'Some Blog' }] })[0], /unknown publisher/);
});

test('values, years, and quotes are bounded', () => {
  assert.ok(checkEntry('kia-ev9', 'Kia', { cargoCuFt: { value: 0, source: 'https://www.kia.com/x' } }).length);
  assert.ok(checkEntry('kia-ev9', 'Kia', { iihs: { award: 'Best', year: 2026, source: 'https://www.iihs.org/x' } }).length);
  assert.ok(checkEntry('kia-ev9', 'Kia', { awards: [{ ...award, year: 1999 }] }).length);
  const long = Array.from({ length: 16 }, () => 'word').join(' ');
  assert.match(checkEntry('kia-ev9', 'Kia', { awards: [{ ...award, evidence: long }] })[0], /15 words/);
});

test('only a reviewed, clean file publishes; drafts and unknown cars do not', () => {
  assert.equal(checkResearch({ status: 'draft', vehicles: { 'kia-ev9': { awards: [award] } } }, cars).publishable, false);
  assert.equal(checkResearch(reviewed({ 'kia-ev9': { awards: [award] } }), cars).publishable, true);
  assert.equal(checkResearch({ ...reviewed({}), reviewedBy: null }, cars).publishable, false);
  const unknown = checkResearch(reviewed({ 'kia-ev99': { awards: [award] } }), cars);
  assert.equal(unknown.publishable, false);
  assert.match(unknown.problems[0], /not a car/);
});
