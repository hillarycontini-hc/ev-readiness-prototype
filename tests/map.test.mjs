// The charger map: projection, grid views, which chargers get pins, and the /api/map proxy.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanView } from '../worker/index.js';
import {
  MAP_H, MAP_W, MAX_MARKERS, MAX_ZOOM, MIN_ZOOM,
  chooseView, fromWorld, groupSites, placeMarkers, project, snapView, toWorld, validView, viewBounds,
} from '../site/js/map-view.js';

const BOULDER = { lat: 40.0274, lon: -105.2519 };

test('world pixels round-trip to the same place', () => {
  for (const z of [MIN_ZOOM, 13, MAX_ZOOM]) {
    const [x, y] = toWorld(BOULDER.lat, BOULDER.lon, z);
    const back = fromWorld(x, y, z);
    assert.ok(Math.abs(back.lat - BOULDER.lat) < 1e-9 && Math.abs(back.lon - BOULDER.lon) < 1e-9);
  }
});

test('a snapped view keeps the point in the middle half of the image', () => {
  for (let i = 0; i < 200; i++) {
    const lat = 25 + Math.random() * 23;
    const lon = -124 + Math.random() * 54;
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
      const v = snapView(lat, lon, z);
      const [x, y] = project(v, lat, lon);
      assert.ok(x >= MAP_W / 4 - 1e-6 && x <= (3 * MAP_W) / 4 + 1e-6 && y >= MAP_H / 4 - 1e-6 && y <= (3 * MAP_H) / 4 + 1e-6, `z${z} ${x},${y}`);
      assert.ok(validView(v));
    }
  }
});

test('the view box and the marker math agree at the corners', () => {
  const v = snapView(BOULDER.lat, BOULDER.lon, 14);
  const b = viewBounds(v);
  const [x0, y0] = project(v, b.north, b.west);
  const [x1, y1] = project(v, b.south, b.east);
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6);
  assert.ok(Math.abs(x1 - MAP_W) < 1e-6 && Math.abs(y1 - MAP_H) < 1e-6);
});

test('only whole-number views at allowed zooms, inside the world', () => {
  assert.equal(validView({ z: 14, x: 5447.5, y: 15872 }), false);
  assert.equal(validView({ z: 10, x: 1359, y: 3969 }), false);
  assert.equal(validView({ z: 16, x: 1359, y: 3969 }), false);
  assert.equal(validView({ z: 12, x: 0, y: 0 }), false);
  assert.equal(validView(snapView(BOULDER.lat, BOULDER.lon, 12)), true);
});

const near = (dLat, dLon, extra = {}) => ({ lat: BOULDER.lat + dLat, lon: BOULDER.lon + dLon, miles: Math.hypot(dLat * 69, dLon * 53), ...extra });

test('the closest zoom that shows six chargers wins, and pins stay inside the map, nearest first', () => {
  const close = Array.from({ length: 10 }, (_, i) => near(0.0004 * (i + 1), 0.0003 * (i % 3)));
  assert.equal(chooseView(BOULDER.lat, BOULDER.lon, close).view.z, MAX_ZOOM);
  const spread = Array.from({ length: 10 }, (_, i) => near(0.04 * (i + 1), 0.02)).sort((a, b) => a.miles - b.miles);
  const { view, markers } = chooseView(BOULDER.lat, BOULDER.lon, spread);
  assert.ok(view.z < MAX_ZOOM);
  assert.ok(markers.length <= MAX_MARKERS);
  for (const m of markers) {
    const [x, y] = project(view, m.lat, m.lon);
    assert.ok(x >= 0 && x <= MAP_W && y >= 0 && y <= MAP_H);
  }
  assert.deepEqual(markers, spread.filter((s) => markers.includes(s)), 'order kept');
  assert.deepEqual(chooseView(BOULDER.lat, BOULDER.lon, []).markers, []);
});

test('chargers at the same spot share one pin', () => {
  const sites = groupSites([near(0.01, 0, { id: 'a' }), near(0.0101, 0.0001, { id: 'b' }), near(0.02, 0, { id: 'c' })]);
  assert.equal(sites.length, 2);
  assert.deepEqual(sites[0].stations.map((s) => s.id), ['a', 'b']);
});

test('crowded pins are pushed apart and remember where they belong', () => {
  const v = snapView(BOULDER.lat, BOULDER.lon, 13);
  const pile = Array.from({ length: 6 }, () => near(0.003, 0.003));
  const at = placeMarkers(v, pile, 26);
  for (let i = 0; i < at.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) >= 25.9);
  assert.equal(at[0].moved, false);
  assert.ok(at.slice(1).every((p) => p.moved));
});

// ---------- /api/map ----------

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
afterEach(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });

const req = (path, headers = { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.7' }, method = 'GET') =>
  new Request(`https://ev.example${path}`, { method, headers });
const env = (over = {}) => ({
  GEOAPIFY_KEY: 'test-key',
  MAP_LIMITER: { limit: async () => ({ success: true }) },
  MAP_GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => new Response('asset') },
  ...over,
});
const view = snapView(BOULDER.lat, BOULDER.lon, 13);
const mapPath = `/api/map?z=${view.z}&x=${view.x}&y=${view.y}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('cleanView accepts only small whole numbers for a U.S. view', () => {
  assert.deepEqual(cleanView(new URLSearchParams(`z=${view.z}&x=${view.x}&y=${view.y}`)), view);
  assert.equal(cleanView(new URLSearchParams(`z=13&x=${view.x}.5&y=${view.y}`)), null);
  assert.equal(cleanView(new URLSearchParams(`z=13&x=-1&y=${view.y}`)), null);
  assert.equal(cleanView(new URLSearchParams('z=13')), null);
  const london = snapView(51.5, -0.12, 13);
  assert.equal(cleanView(new URLSearchParams(`z=13&x=${london.x}&y=${london.y}`)), null);
});

test('map: cross-site, non-GET, bad view, limits, and missing key', async () => {
  assert.equal((await worker.fetch(req(mapPath, { 'Sec-Fetch-Site': 'cross-site' }), env())).status, 403);
  assert.equal((await worker.fetch(req(mapPath, { 'Sec-Fetch-Site': 'same-origin' }, 'POST'), env())).status, 405);
  assert.equal((await worker.fetch(req('/api/map?z=13&x=1&y=1'), env())).status, 400);
  assert.equal((await worker.fetch(req(mapPath), env({ GEOAPIFY_KEY: '' }))).status, 503);
  assert.equal((await worker.fetch(req(mapPath), env({ MAP_LIMITER: undefined }))).status, 503);
  assert.equal((await worker.fetch(req(mapPath), env({ MAP_LIMITER: { limit: async () => ({ success: false }) } }))).status, 429);
  let upstream = 0;
  globalThis.fetch = async () => { upstream++; return new Response(PNG, { headers: { 'Content-Type': 'image/png' } }); };
  const busy = await worker.fetch(req(mapPath), env({ MAP_GLOBAL_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(busy.status, 503);
  assert.equal(upstream, 0, 'the site-wide limit stops the request before it costs a credit');
});

test('map: asks for the exact box, returns only the image, and never leaks the key', async () => {
  let seen;
  globalThis.fetch = async (url) => { seen = new URL(String(url)); return new Response(PNG, { headers: { 'Content-Type': 'image/png' } }); };
  const res = await worker.fetch(req(mapPath), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.match(res.headers.get('Cache-Control'), /^public, max-age=\d+$/);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(seen.host, 'maps.geoapify.com');
  const b = viewBounds(view);
  assert.equal(seen.searchParams.get('area'), `rect:${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)},${b.south.toFixed(6)}`);
  assert.equal(seen.searchParams.get('width'), String(MAP_W));
  assert.equal(seen.searchParams.get('height'), String(MAP_H));
  assert.equal(seen.searchParams.has('marker'), false, 'markers are drawn by the page, not paid for');
  assert.ok(!JSON.stringify([...res.headers]).includes('test-key'));
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
});

test('map: a cached view is served without calling the provider', async () => {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  let upstream = 0;
  globalThis.fetch = async () => { upstream++; return new Response(PNG, { headers: { 'Content-Type': 'image/png' } }); };
  assert.equal((await worker.fetch(req(mapPath), env())).status, 200);
  assert.equal((await worker.fetch(req(mapPath), env())).status, 200);
  assert.equal(upstream, 1);
  assert.ok([...store.keys()].every((k) => !k.includes('203.0.113')), 'the cache key holds only the view');
});

test('map: anything but a PNG from the provider becomes map_unavailable', async () => {
  globalThis.fetch = async () => new Response('{"error":"quota"}', { status: 429, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await (await worker.fetch(req(mapPath), env())).json(), { error: 'map_unavailable' });
  globalThis.fetch = async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
  assert.equal((await worker.fetch(req(mapPath), env())).status, 502);
  globalThis.fetch = async () => { throw new Error('timeout'); };
  assert.equal((await worker.fetch(req(mapPath), env())).status, 502);
});

test('the nearest fast charger is always on the map, even when Level 2 sites are closer', () => {
  const level2 = Array.from({ length: 12 }, (_, i) => ({ ...near(0.0004 * (i + 1), 0.0002), stations: [{ fast: 0 }] }));
  const fast = { ...near(0.05, 0.02), stations: [{ fast: 2 }] };
  const sites = [...level2, fast].sort((a, b) => a.miles - b.miles);
  const { view, markers } = chooseView(BOULDER.lat, BOULDER.lon, sites, { must: [fast] });
  assert.ok(markers.includes(fast));
  assert.ok(markers.length <= MAX_MARKERS);
  assert.deepEqual(markers, [...markers].sort((a, b) => a.miles - b.miles), 'still nearest first');
  assert.ok(view.z < MAX_ZOOM, 'zooms out to reach it');
});
