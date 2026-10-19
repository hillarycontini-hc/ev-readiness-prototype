import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanQuery, cleanNear, simplifyLine } from '../worker/index.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const req = (path, headers = { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.7' }, method = 'GET') =>
  new Request(`https://ev.example${path}`, { method, headers });
const env = (over = {}) => ({
  GEOAPIFY_KEY: 'test-key',
  SEARCH_LIMITER: { limit: async () => ({ success: true }) },
  ROUTE_LIMITER: { limit: async () => ({ success: true }) },
  ROUTE_GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
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

// ---------- /api/route ----------

const BOULDER = '40.015,-105.27';
const ESTES = '40.3772,-105.5217';

test('route points must be two U.S. points, not too close, not too far apart', async () => {
  const status = async (q) => (await worker.fetch(req(`/api/route?${q}`), env())).status;
  assert.equal(await status(`from=${BOULDER}`), 400, 'missing destination');
  assert.equal(await status(`from=${BOULDER}&to=51.5,-0.12`), 400, 'London is not in the U.S.');
  assert.equal(await status(`from=${BOULDER}&to=40.015,-105.2701`), 400, 'too close');
  assert.equal(await status(`from=${BOULDER}&to=40.7128,-74.006`), 400, 'Boulder to New York is past the trip cap');
  assert.equal(await status(`from=1e1,-105&to=${ESTES}`), 400, 'only plain decimals');
  assert.equal(await status(`from=${BOULDER},3&to=${ESTES}`), 400, 'exactly two numbers');
});

test('route: cross-site, non-GET, rate limit, and missing key', async () => {
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`, { 'Sec-Fetch-Site': 'cross-site' }), env())).status, 403);
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`, { 'Sec-Fetch-Site': 'same-origin' }, 'POST'), env())).status, 405);
  let used = null;
  const limited = env({ ROUTE_LIMITER: { limit: async ({ key }) => { used = key; return { success: false }; } } });
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), limited)).status, 429);
  assert.match(used, /^[0-9a-f]{24}$/, 'limited by a hashed key, never the raw IP');
  const nokey = await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env({ GEOAPIFY_KEY: '' }));
  assert.equal(nokey.status, 503);
  // Fail closed: no limiter binding means no routing, and the site-wide budget is enforced too.
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env({ ROUTE_LIMITER: undefined }))).status, 503);
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env({ ROUTE_GLOBAL_LIMITER: undefined }))).status, 503);
  let siteKey = null;
  const busy = env({ ROUTE_GLOBAL_LIMITER: { limit: async ({ key }) => { siteKey = key; return { success: false }; } } });
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), busy)).status, 503);
  assert.equal(siteKey, 'all-visitors', 'one key for everyone');
  assert.equal((await worker.fetch(req('/api/geocode?q=boulder'), env({ SEARCH_LIMITER: undefined }))).status, 503, 'search fails closed too');
  assert.equal(called, false, 'nothing reaches Geoapify without a limiter');
});

test('a route returns only a simplified line, miles, and minutes', async () => {
  let seen;
  // 2,000 points from Boulder toward Estes Park, as Geoapify's json format sends them.
  const leg = Array.from({ length: 2000 }, (_, i) => ({ lat: 40.015 + (0.3622 * i) / 1999, lon: -105.27 - (0.2517 * i) / 1999 }));
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ properties: { waypoints: [] }, results: [{ distance: 55000, time: 3600, legs: [{ steps: [{ instruction: { text: 'Turn left on Pearl St' } }] }], geometry: [leg] }] }), { status: 200 });
  };
  const res = await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['attribution', 'miles', 'minutes', 'points']);
  assert.equal(body.miles, 34.2);
  assert.equal(body.minutes, 60);
  assert.ok(body.points.length <= 600 && body.points.length > 100, `points: ${body.points.length}`);
  assert.deepEqual(body.points[0], [40.015, -105.27]);
  assert.deepEqual(body.points.at(-1), [40.3772, -105.5217]);
  assert.ok(seen.url.includes('waypoints=40.015%2C-105.27%7C40.3772%2C-105.5217'), seen.url);
  await worker.fetch(req('/api/route?from=40.01234,-105.27891&to=40.3772,-105.5217'), env());
  assert.ok(seen.url.includes('waypoints=40.012%2C-105.279%7C40.3772%2C-105.5217'), `the start goes upstream at about 100 m: ${seen.url}`);
  assert.ok(seen.url.includes('mode=drive') && seen.url.includes('apiKey=test-key'));
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('test-key') && !raw.includes('Pearl'), 'no key, no turn-by-turn text');
  assert.ok(!JSON.stringify(seen.init.headers || {}).includes('203.0.113.7'), 'visitor IP not forwarded');
});

test('route upstream failures: no road is no_route, anything else is route_unavailable', async () => {
  globalThis.fetch = async () => new Response('{"statusCode":400,"message":"Unable to find route"}', { status: 400 });
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env())).status, 422);
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env())).status, 502);
  globalThis.fetch = async () => { throw new Error('timeout'); };
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env())).status, 502);
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ distance: 'far', geometry: [] }] }), { status: 200 });
  assert.equal((await worker.fetch(req(`/api/route?from=${BOULDER}&to=${ESTES}`), env())).status, 422);
});

test('simplifyLine accepts GeoJSON [lon, lat] pairs and drops points outside the U.S.', () => {
  const line = simplifyLine([[[-105.27, 40.015], [-0.1, 51.5], [-105.3, 40.1], [-105.5217, 40.3772]]], 600);
  assert.deepEqual(line, [[40.015, -105.27], [40.1, -105.3], [40.3772, -105.5217]]);
  assert.deepEqual(simplifyLine(null), []);
  assert.deepEqual(simplifyLine([[{ lat: 'x', lon: 1 }]]), []);
});
