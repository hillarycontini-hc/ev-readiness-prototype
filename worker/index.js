// The site's one piece of server code: a privacy-preserving proxy for place search and routing.
// Everything else is static files served by Cloudflare. This Worker runs only for /api/*.
//
// Why a proxy: the Geoapify key stays secret, the provider never sees the visitor's IP,
// requests are rate-limited, and nothing is logged or cached. Queries are passed through
// and forgotten.

const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const ROUTING_URL = 'https://api.geoapify.com/v1/routing';
const UPSTREAM_TIMEOUT_MS = 5000;
const ROUTE_TIMEOUT_MS = 8000;
// One destination per trip, up to about 1,000 road miles. Geoapify adds a credit per 500 km,
// so this also bounds what one request can cost.
export const MAX_ROUTE_STRAIGHT_MILES = 750;
export const MAX_ROUTE_POINTS = 600;

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const round3 = (x) => Math.round(x * 1e3) / 1e3;
const inUS = (lat, lon) => lat >= 18 && lat <= 72 && lon >= -180 && lon <= -60;

/** Clean the search text: 3 to 120 printable characters, whitespace collapsed. */
export function cleanQuery(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 3 && q.length <= 120 ? q : null;
}

/** A "lat,lon" point inside the U.S. (incl. Alaska and Hawaii), rounded to about 10 m. */
export function cleanNear(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 64) return null;
  const parts = raw.split(',').map((s) => (/^\s*-?\d{1,3}(\.\d{1,15})?\s*$/.test(s) ? Number(s) : NaN));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lon] = parts;
  if (!inUS(lat, lon)) return null;
  return { lat: round4(lat), lon: round4(lon) };
}

const R_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;
export function milesBetween(lat1, lon1, lat2, lon2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

/**
 * Flatten Geoapify's route geometry (per-leg lists of {lat, lon}, or GeoJSON [lon, lat] pairs) into
 * at most `max` [lat, lon] points, evenly spaced along the road and rounded to about 10 m.
 * The browser needs only enough shape to find fast chargers within a few miles of the road.
 */
export function simplifyLine(geometry, max = MAX_ROUTE_POINTS) {
  const flat = [];
  const visit = (g, depth) => {
    if (!Array.isArray(g) || depth > 4) return;
    for (const p of g) {
      if (Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number') flat.push([p[1], p[0]]);
      else if (p && typeof p === 'object' && !Array.isArray(p)) flat.push([p.lat, p.lon]);
      else visit(p, depth + 1);
    }
  };
  visit(geometry, 0);
  const pts = flat.filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && inUS(la, lo));
  if (pts.length < 2) return [];
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + milesBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const spacing = along[along.length - 1] / (max - 1);
  const out = [pts[0]];
  let next = spacing;
  for (let i = 1; i < pts.length - 1; i++) {
    if (along[i] >= next && out.length < max - 1) { out.push(pts[i]); next = along[i] + spacing; }
  }
  out.push(pts[pts.length - 1]);
  return out.map(([la, lo]) => [round4(la), round4(lo)]);
}

async function visitorKey(request) {
  // Hash the connecting IP so the limiter never holds a raw address. Nothing is stored.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ev-readiness:${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every endpoint answers GET from this site's own pages only. Returns a refusal, or null. */
function refuse(request) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  // Browsers send this header and pages can't forge it.
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return json({ error: 'forbidden' }, 403);
  return null;
}

async function geocode(request, url, env) {
  const refused = refuse(request);
  if (refused) return refused;

  const q = cleanQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'bad_query' }, 400);
  const near = cleanNear(url.searchParams.get('near'));

  if (!env.GEOAPIFY_KEY) return json({ error: 'search_unavailable' }, 503);
  // Fail closed: with the key set, a missing limiter (a preview, a renamed binding) refuses.
  if (!env.SEARCH_LIMITER) return json({ error: 'search_unavailable' }, 503);
  const { success } = await env.SEARCH_LIMITER.limit({ key: await visitorKey(request) });
  if (!success) return json({ error: 'rate_limited' }, 429);

  const upstream = new URL(GEOCODE_URL);
  upstream.searchParams.set('text', q);
  upstream.searchParams.set('filter', 'countrycode:us');
  if (near) upstream.searchParams.set('bias', `proximity:${near.lon},${near.lat}`);
  upstream.searchParams.set('limit', '5');
  upstream.searchParams.set('format', 'json');
  upstream.searchParams.set('apiKey', env.GEOAPIFY_KEY);

  let data;
  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) return json({ error: 'search_unavailable' }, 502);
    data = await res.json();
  } catch {
    return json({ error: 'search_unavailable' }, 502);
  }

  const results = (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .slice(0, 5)
    .map((r) => ({
      name: String(r.name || r.address_line1 || '').slice(0, 120),
      detail: String(r.address_line2 || r.formatted || '').slice(0, 160),
      lat: round4(r.lat),
      lon: round4(r.lon),
      type: String(r.result_type || '').slice(0, 30),
    }));
  return json({ results, attribution: 'Geoapify, © OpenStreetMap contributors' });
}

/** A driving route between two U.S. points: only a simplified line, its road miles, and drive minutes. */
async function route(request, url, env) {
  const refused = refuse(request);
  if (refused) return refused;

  const start = cleanNear(url.searchParams.get('from'));
  const to = cleanNear(url.searchParams.get('to'));
  if (!start || !to) return json({ error: 'bad_query' }, 400);
  // The start is often home: send it to the provider only to about 100 m. The route only feeds a
  // 3-mile search for chargers, so nothing is lost.
  const from = { lat: round3(start.lat), lon: round3(start.lon) };
  const straight = milesBetween(from.lat, from.lon, to.lat, to.lon);
  if (straight < 0.5) return json({ error: 'too_close' }, 400);
  if (straight > MAX_ROUTE_STRAIGHT_MILES) return json({ error: 'too_far' }, 400);

  if (!env.GEOAPIFY_KEY) return json({ error: 'route_unavailable' }, 503);
  // Routing costs more than search, so it has its own, tighter per-visitor limit, plus a
  // site-wide one: the same-origin check stops other sites' pages, not scripts, so a few
  // addresses must not be able to drain the shared quota. Both fail closed if missing.
  if (!env.ROUTE_LIMITER || !env.ROUTE_GLOBAL_LIMITER) return json({ error: 'route_unavailable' }, 503);
  const { success } = await env.ROUTE_LIMITER.limit({ key: await visitorKey(request) });
  if (!success) return json({ error: 'rate_limited' }, 429);
  const site = await env.ROUTE_GLOBAL_LIMITER.limit({ key: 'all-visitors' });
  if (!site.success) return json({ error: 'route_unavailable' }, 503);

  const upstream = new URL(ROUTING_URL);
  upstream.searchParams.set('waypoints', `${from.lat},${from.lon}|${to.lat},${to.lon}`);
  upstream.searchParams.set('mode', 'drive');
  upstream.searchParams.set('format', 'json');
  upstream.searchParams.set('apiKey', env.GEOAPIFY_KEY);

  let data;
  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    // Geoapify answers 400 when no road joins the points (an island, a closed area).
    if (res.status === 400) return json({ error: 'no_route' }, 422);
    if (!res.ok) return json({ error: 'route_unavailable' }, 502);
    data = await res.json();
  } catch {
    return json({ error: 'route_unavailable' }, 502);
  }

  const r = Array.isArray(data?.results) ? data.results[0] : null;
  const meters = r?.distance;
  const seconds = r?.time;
  const points = simplifyLine(r?.geometry);
  if (!Number.isFinite(meters) || !Number.isFinite(seconds) || meters <= 0 || seconds <= 0 || points.length < 2) return json({ error: 'no_route' }, 422);
  return json({
    miles: Math.round((meters / 1609.344) * 10) / 10,
    minutes: Math.round(seconds / 60),
    points,
    attribution: 'Geoapify, © OpenStreetMap contributors',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/geocode') return geocode(request, url, env);
    if (url.pathname === '/api/route') return route(request, url, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
