// Where the charger map looks, shared by the page and the Worker so both draw the same box.
//
// Privacy: the page never sends the visitor's ZIP or its center. It asks for a map "view": a zoom
// level and a position on a fixed grid (a quarter of the image apart). Everyone in that part of
// town gets the same image, so the server learns which map was shown (at street level, an area
// about 1.5 miles across), not the ZIP, and the image can be shared and cached. The page then
// draws the ZIP center and the numbered chargers on top.
//
// The math is plain Web Mercator in 256-pixel tiles. The Worker asks the map provider for the exact
// box (`area=rect:`) rather than a center and zoom, so the picture lines up with the markers whatever
// tile size the provider's renderer uses internally.

export const MAP_W = 640;
export const MAP_H = 400;
export const STEP_X = MAP_W / 4;
export const STEP_Y = MAP_H / 4;
export const MIN_ZOOM = 11;
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
 * six of them (or all of them, if fewer) fit, from street level (15) out to about 20 miles across
 * (11). `stations` must be nearest first. Returns the view and up to eight markers, numbered in
 * that same order so the list and the map always agree.
 */
export function chooseView(lat, lon, stations) {
  const want = Math.min(6, stations.length);
  let view = snapView(lat, lon, MIN_ZOOM);
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const v = snapView(lat, lon, z);
    if (stations.filter((s) => inside(v, s)).length >= want) { view = v; break; }
  }
  const markers = stations.filter((s) => inside(view, s)).slice(0, MAX_MARKERS);
  return { view, markers };
}

/**
 * Marker positions on the image, nudged apart so numbers never sit on top of each other.
 * Returns [{ x, y }] in the same order as `markers`.
 */
export function placeMarkers(v, markers, minGap = 26) {
  const placed = [];
  for (const m of markers) {
    const [x0, y0] = project(v, m.lat, m.lon);
    let x = x0;
    let y = y0;
    // Walk out on a golden-angle spiral until the pin is clear of the ones already placed.
    for (let k = 1; k <= 40 && placed.some((p) => Math.hypot(p.x - x, p.y - y) < minGap); k++) {
      const r = minGap * (0.6 + 0.25 * k);
      x = x0 + Math.cos(k * 2.4) * r;
      y = y0 + Math.sin(k * 2.4) * r;
    }
    placed.push({ x: Math.min(MAP_W - 13, Math.max(13, x)), y: Math.min(MAP_H - 13, Math.max(13, y)), moved: x !== x0 || y !== y0, x0, y0 });
  }
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
