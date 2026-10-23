// Where the charger map looks, shared by the page and the Worker so both draw the same box.
//
// Privacy: the page never sends the visitor's ZIP or its center. It asks for a map "view": a zoom
// level and a position on a fixed grid (a quarter of the image apart). Everyone in that part of
// town gets the same image, and it can be shared and cached. The server learns which map was
// shown, not the ZIP; but at street level that places the ZIP center within about 600 x 370 m,
// which in a city usually identifies it, and the privacy notice says so. The page then draws the
// ZIP center and the numbered chargers on top.
//
// The math is plain Web Mercator in 256-pixel tiles. The Worker asks the map provider for the exact
// box (`area=rect:`) rather than a center and zoom, so the picture lines up with the markers whatever
// tile size the provider's renderer uses internally.

export const MAP_W = 640;
export const MAP_H = 400;
export const STEP_X = MAP_W / 4;
export const STEP_Y = MAP_H / 4;
// Charger maps run from street level (15) out to about 20 miles across (11). Route overviews can
// zoom out to a few states across (4). The Worker draws any view in MIN_ZOOM..MAX_ZOOM.
export const MIN_ZOOM = 4;
export const ZIP_MIN_ZOOM = 11;
export const ROUTE_MAX_ZOOM = 13;
export const MAX_ZOOM = 15;
export const MAX_MARKERS = 8;
const MARGIN = 18; // keep numbered markers clear of the image edge

const TILE = 256;
const worldSize = (z) => TILE * 2 ** z;
const clampLat = (lat) => Math.max(-85.05112878, Math.min(85.05112878, lat));

/** Longitude and latitude to world pixels at zoom z. */
export function toWorld(lat, lon, z) {
  const s = worldSize(z);
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

/** World pixels at zoom z back to { lat, lon }. */
export function fromWorld(px, py, z) {
  const s = worldSize(z);
  const lon = (px / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * py) / s;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lon };
}

/** The grid view whose middle half contains this point. */
export function snapView(lat, lon, z) {
  const [px, py] = toWorld(lat, lon, z);
  return { z, x: Math.round(px / STEP_X), y: Math.round(py / STEP_Y) };
}

/** Is this a view the Worker will draw: whole numbers, allowed zoom, inside the world? */
export function validView(v) {
  if (!v || ![v.z, v.x, v.y].every(Number.isInteger)) return false;
  if (v.z < MIN_ZOOM || v.z > MAX_ZOOM) return false;
  const s = worldSize(v.z);
  return v.x * STEP_X - MAP_W / 2 >= 0 && v.x * STEP_X + MAP_W / 2 <= s && v.y * STEP_Y - MAP_H / 2 >= 0 && v.y * STEP_Y + MAP_H / 2 <= s;
}

/** The view's corners, for the provider's `area=rect:west,north,east,south`. */
export function viewBounds(v) {
  const cx = v.x * STEP_X;
  const cy = v.y * STEP_Y;
  const nw = fromWorld(cx - MAP_W / 2, cy - MAP_H / 2, v.z);
  const se = fromWorld(cx + MAP_W / 2, cy + MAP_H / 2, v.z);
  return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat };
}

/** A point's position on the image, in image pixels (0..MAP_W, 0..MAP_H). */
export function project(v, lat, lon) {
  const [px, py] = toWorld(lat, lon, v.z);
  return [px - (v.x * STEP_X - MAP_W / 2), py - (v.y * STEP_Y - MAP_H / 2)];
}

/** Meters covered by one image pixel at this view's center (for the fallback's 1-mile ring). */
export function metersPerPixel(v) {
  const { lat } = fromWorld(v.x * STEP_X, v.y * STEP_Y, v.z);
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** v.z;
}

const inside = (v, s) => {
  const [x, y] = project(v, s.lat, s.lon);
  return x >= MARGIN && x <= MAP_W - MARGIN && y >= MARGIN && y <= MAP_H - MARGIN;
};

/**
 * Pick the closest view that still shows the nearest chargers: the highest zoom where at least
 * six of them (or all, if fewer) fit, and every site in `must` (the nearest fast charger) fits,
 * from street level (15) out to about 20 miles across (11). `sites` must be nearest first.
 * Returns the view and up to eight markers, nearest first, so the list and the map agree:
 * every `must` site that fits, then the nearest others.
 */
export function chooseView(lat, lon, sites, { must = [] } = {}) {
  const want = Math.min(6, sites.length);
  let view = snapView(lat, lon, ZIP_MIN_ZOOM);
  for (let z = MAX_ZOOM; z >= ZIP_MIN_ZOOM; z--) {
    const v = snapView(lat, lon, z);
    if (must.every((m) => inside(v, m)) && sites.filter((s) => inside(v, s)).length >= want) { view = v; break; }
  }
  const visible = sites.filter((s) => inside(view, s));
  const kept = must.filter((m) => inside(view, m)).slice(0, MAX_MARKERS);
  const markers = [...kept, ...visible.filter((s) => !kept.includes(s)).slice(0, MAX_MARKERS - kept.length)]
    .sort((a, b) => a.miles - b.miles);
  return { view, markers };
}

const crosses = (a, b, c, d) => {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

/**
 * Marker positions on the image, in the order of `markers`. A pin that would cover another
 * moves outward, away from `from` (the ZIP center), to the first spot that is clear of the
 * other pins, isn't on another site's true spot, and whose leader line crosses no other leader.
 * Returns [{ x, y, x0, y0, moved }].
 */
export function placeMarkers(v, markers, minGap = 26, from = null) {
  const spots = markers.map((m) => { const [x, y] = project(v, m.lat, m.lon); return { x, y }; });
  const center = from || { x: MAP_W / 2, y: MAP_H / 2 };
  const placed = [];
  const edge = minGap / 2; // a pin's half-width, so none is cut off at the image edge
  const clamp = (p) => ({ x: Math.min(MAP_W - edge, Math.max(edge, p.x)), y: Math.min(MAP_H - edge, Math.max(edge, p.y)) });
  spots.forEach((spot, idx) => {
    const ok = (p) => placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minGap)
      && spots.every((t, k) => k === idx || Math.hypot(t.x - p.x, t.y - p.y) >= minGap / 2)
      && placed.every((q) => !q.moved || !crosses(spot, p, { x: q.x0, y: q.y0 }, q));
    let best = clamp(spot);
    if (!placed.every((q) => Math.hypot(q.x - best.x, q.y - best.y) >= minGap)) {
      const out = Math.atan2(spot.y - center.y, spot.x - center.x) || 0;
      search: for (const r of [1, 1.5, 2, 2.6, 3.3, 4.2].map((t) => t * minGap)) {
        for (const d of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
          const p = clamp({ x: spot.x + Math.cos(out + d) * r, y: spot.y + Math.sin(out + d) * r });
          if (ok(p)) { best = p; break search; }
        }
      }
    }
    placed.push({ ...best, x0: spot.x, y0: spot.y, moved: Math.hypot(best.x - spot.x, best.y - spot.y) > 0.5 });
  });
  return placed;
}

/**
 * Chargers at the same spot (within about 50 m: one garage, one lot) become one site, so a
 * pin never hides another. `stations` nearest first; sites keep that order.
 */
export function groupSites(stations, sameMiles = 0.03) {
  const sites = [];
  for (const s of stations) {
    const site = sites.find((t) => Math.hypot((t.lat - s.lat) * 69, (t.lon - s.lon) * 69 * Math.cos((s.lat * Math.PI) / 180)) <= sameMiles);
    if (site) site.stations.push(s);
    else sites.push({ lat: s.lat, lon: s.lon, miles: s.miles, stations: [s] });
  }
  return sites;
}

/**
 * The closest view that shows every point (a route's line, its start and end) with a margin, for
 * the route overview. At each zoom it tries the four grid positions around the points' middle, so
 * staying on the grid costs as little zoom as possible.
 */
const ROUTE_MARGIN = 12; // a stop pin's half-width, so none is cut off

export function fitView(points) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const mid = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  const fits = (v) => validView(v) && points.every(([lat, lon]) => {
    const [x, y] = project(v, lat, lon);
    return x >= ROUTE_MARGIN && x <= MAP_W - ROUTE_MARGIN && y >= ROUTE_MARGIN && y <= MAP_H - ROUTE_MARGIN;
  });
  for (let z = ROUTE_MAX_ZOOM; z > MIN_ZOOM; z--) {
    const [px, py] = toWorld(mid.lat, mid.lon, z);
    // Of the grid positions that fit, the one that puts the route most nearly in the middle.
    const options = [];
    for (const x of [Math.floor(px / STEP_X), Math.ceil(px / STEP_X)]) {
      for (const y of [Math.floor(py / STEP_Y), Math.ceil(py / STEP_Y)]) {
        const v = { z, x, y };
        if (fits(v)) options.push({ v, off: Math.hypot(x * STEP_X - px, y * STEP_Y - py) });
      }
    }
    if (options.length) return options.sort((a, b) => a.off - b.off)[0].v;
  }
  return snapView(mid.lat, mid.lon, MIN_ZOOM);
}

/**
 * The part of the image worth showing for a route: the points' box plus a margin, widened to an
 * aspect between 4:5 and 16:10, inside the image. In image pixels: { x, y, w, h }.
 */
export function cropBox(v, points, margin = 28) {
  const xy = points.map(([lat, lon]) => project(v, lat, lon));
  let x0 = Math.min(...xy.map((p) => p[0])) - margin;
  let x1 = Math.max(...xy.map((p) => p[0])) + margin;
  let y0 = Math.min(...xy.map((p) => p[1])) - margin;
  let y1 = Math.max(...xy.map((p) => p[1])) + margin;
  const grow = (lo, hi, want, max) => {
    const add = Math.max(0, want - (hi - lo)) / 2;
    let a = lo - add;
    let b = hi + add;
    if (a < 0) { b -= a; a = 0; }
    if (b > max) { a -= b - max; b = max; }
    return [Math.max(0, a), Math.min(max, b)];
  };
  // Not too tall (at least 4:5 wide) and not too wide (at most 16:10).
  [x0, x1] = grow(x0, x1, (y1 - y0) * 0.8, MAP_W);
  [y0, y1] = grow(y0, y1, (x1 - x0) / 1.6, MAP_H);
  [x0, x1] = grow(Math.max(0, x0), Math.min(MAP_W, x1), (y1 - y0) * 0.8, MAP_W);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
