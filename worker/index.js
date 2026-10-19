// The site's one piece of server code: a privacy-preserving proxy for place search.
// Everything else is static files served by Cloudflare. This Worker runs only for /api/*.
//
// Why a proxy: the geocoding key stays secret, the provider never sees the visitor's IP,
// requests are rate-limited, and nothing is logged or cached. Queries are passed through
// and forgotten.

const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const UPSTREAM_TIMEOUT_MS = 5000;

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

/** Clean the search text: 3 to 120 printable characters, whitespace collapsed. */
export function cleanQuery(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 3 && q.length <= 120 ? q : null;
}

/** Optional "near" bias as "lat,lon" inside the U.S. (incl. Alaska and Hawaii). */
export function cleanNear(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lon] = parts;
  if (lat < 18 || lat > 72 || lon < -180 || lon > -60) return null;
  return { lat: round4(lat), lon: round4(lon) };
}

async function visitorKey(request) {
  // Hash the connecting IP so the limiter never holds a raw address. Nothing is stored.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ev-readiness:${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function geocode(request, url, env) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  // Only this site's own pages may call the proxy (browsers send this header and pages can't forge it).
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return json({ error: 'forbidden' }, 403);

  const q = cleanQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'bad_query' }, 400);
  const near = cleanNear(url.searchParams.get('near'));

  if (env.SEARCH_LIMITER) {
    const { success } = await env.SEARCH_LIMITER.limit({ key: await visitorKey(request) });
    if (!success) return json({ error: 'rate_limited' }, 429);
  }
  if (!env.GEOAPIFY_KEY) return json({ error: 'search_unavailable' }, 503);

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/geocode') return geocode(request, url, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
