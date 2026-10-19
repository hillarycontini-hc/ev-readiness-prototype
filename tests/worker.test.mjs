import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanQuery, cleanNear } from '../worker/index.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const req = (path, headers = { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.7' }, method = 'GET') =>
  new Request(`https://ev.example${path}`, { method, headers });
const env = (over = {}) => ({
  GEOAPIFY_KEY: 'test-key',
  SEARCH_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => new Response('asset') },
  ...over,
});

test('cleanQuery accepts 3 to 120 printable characters only', () => {
  assert.equal(cleanQuery('  1600   Pennsylvania Ave  '), '1600 Pennsylvania Ave');
  assert.equal(cleanQuery('ab'), null);
  assert.equal(cleanQuery('x'.repeat(121)), null);
  assert.equal(cleanQuery('gym\u0000\u0007 near work'), 'gym near work');
  assert.equal(cleanQuery(42), null);
});

test('cleanNear accepts only U.S. coordinates', () => {
  assert.deepEqual(cleanNear('40.01499,-105.27051'), { lat: 40.015, lon: -105.2705 });
  assert.equal(cleanNear('51.5,-0.12'), null);
  assert.equal(cleanNear('abc'), null);
});

test('non-API paths fall through to static assets', async () => {
  const res = await worker.fetch(req('/index.html'), env());
  assert.equal(await res.text(), 'asset');
});

test('cross-site and non-GET requests are refused', async () => {
  assert.equal((await worker.fetch(req('/api/geocode?q=gym', { 'Sec-Fetch-Site': 'cross-site' }), env())).status, 403);
  assert.equal((await worker.fetch(req('/api/geocode?q=gym', {}), env())).status, 403);
  assert.equal((await worker.fetch(req('/api/geocode?q=gym', { 'Sec-Fetch-Site': 'same-origin' }, 'POST'), env())).status, 405);
});

test('rate-limited visitors get 429, and a missing key gives a clean 503', async () => {
  const limited = env({ SEARCH_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal((await worker.fetch(req('/api/geocode?q=boulder'), limited)).status, 429);
  const nokey = await worker.fetch(req('/api/geocode?q=boulder'), env({ GEOAPIFY_KEY: '' }));
  assert.equal(nokey.status, 503);
  assert.deepEqual(await nokey.json(), { error: 'search_unavailable' });
});

test('a search returns only trimmed fields, and the key and visitor IP never reach the response', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ results: [
      { name: 'Climbing Gym', address_line1: 'Climbing Gym', address_line2: '123 Pearl St, Boulder, CO 80302', lat: 40.0176543, lon: -105.2797654, result_type: 'amenity', place_id: 'secret-ish', datasource: {} },
      { formatted: 'no coords' },
    ] }), { status: 200 });
  };
  const res = await worker.fetch(req('/api/geocode?q=climbing%20gym&near=40.015,-105.27'), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body.results, [{ name: 'Climbing Gym', detail: '123 Pearl St, Boulder, CO 80302', lat: 40.0177, lon: -105.2798, type: 'amenity' }]);
  assert.ok(seen.url.includes('apiKey=test-key'), 'key goes upstream');
  assert.ok(seen.url.includes('bias=proximity%3A-105.27%2C40.015'), 'proximity bias is lon,lat');
  assert.ok(seen.url.includes('filter=countrycode%3Aus'));
  assert.ok(!JSON.stringify(body).includes('test-key'), 'key never returned');
  assert.ok(!JSON.stringify(seen.init.headers || {}).includes('203.0.113.7'), 'visitor IP not forwarded');
});

test('upstream failures become search_unavailable, never a crash', async () => {
  globalThis.fetch = async () => { throw new Error('network'); };
  const res = await worker.fetch(req('/api/geocode?q=boulder'), env());
  assert.equal(res.status, 502);
});
