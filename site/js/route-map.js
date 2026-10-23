// The route overview for a planned trip: one street map with the route drawn on it, the start, the
// destination, the chosen charging stops (numbered like the legs), and the other fast chargers that
// could stand in for a stop without making any leg too long. Not a pan-and-zoom map.
//
// Same approach as the charger map (charger-map.js): the page asks our /api/map for a plain map of a
// grid view and draws everything itself, so the request says only which map was shown. The picture
// is cropped to the route (the image is drawn at twice the resolution, so the crop stays sharp). If
// the street map can't load, the same drawing sits on a plain plot.

import { el, externalLink } from './dom.js';
import { homeMark, svg } from './charger-map.js';
import { MAP_H, MAP_W, cropBox, fitView, project } from './map-view.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The destination is the end of the line: a station disc like the start, filled poppy (the parks
// stop color) with a white center, so shape and color both tell it from the start.
const destMark = () => [svg('circle', { class: 'route-dest', r: 9 }), svg('circle', { class: 'route-dest-dot', r: 3 })];
const stopMark = (n) => [svg('rect', { x: -12, y: -12, width: 24, height: 24, rx: 4 }), n == null ? null : svg('text', { y: 4.5 }, String(n))];
const otherMark = () => svg('rect', { class: 'route-other', x: -4.5, y: -4.5, width: 9, height: 9, rx: 1.5 });

// A small inline key for the caption, drawn with the same marks as the map.
function key(cls, ...marks) {
  return svg('svg', { class: `map-key ${cls}`, viewBox: '-13 -13 26 26', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' }, ...marks);
}

function overlay(view, crop, { points, from, to, stops, others }, { fallback, k = 1 }) {
  const at = (lat, lon) => project(view, lat, lon);
  const place = (x, y) => `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(2)})`;
  const layer = svg('svg', { class: 'map-overlay', viewBox: `${crop.x.toFixed(1)} ${crop.y.toFixed(1)} ${crop.w.toFixed(1)} ${crop.h.toFixed(1)}`, 'aria-hidden': 'true', focusable: 'false' });
  if (fallback) {
    layer.append(
      svg('rect', { class: 'map-ground', x: crop.x, y: crop.y, width: crop.w, height: crop.h }),
      svg('g', { class: 'map-north', transform: place(crop.x + crop.w - 22 * k, crop.y + 28 * k) },
        svg('path', { d: 'M0 -14 L6 0 L-6 0 Z' }),
        svg('text', { x: 0, y: 14 }, 'N')));
  }
  // Other stops first, under the route, merged where they would overlap, so the line stays readable.
  const dots = [];
  for (const s of others) {
    const [x, y] = at(s.lat, s.lon);
    if (dots.some((d) => Math.hypot(d[0] - x, d[1] - y) < 9 * k)) continue;
    dots.push([x, y]);
    layer.append(svg('g', { transform: place(x, y) }, otherMark()));
  }
  const d = points.map(([lat, lon], i) => { const [x, y] = at(lat, lon); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  layer.append(
    svg('path', { class: 'route-casing', d, 'stroke-width': (7 * k).toFixed(2) }),
    svg('path', { class: 'route-line', d, 'stroke-width': (4 * k).toFixed(2) }));
  const [fx, fy] = at(from.lat, from.lon);
  const [tx, ty] = at(to.lat, to.lon);
  layer.append(
    svg('g', { transform: place(fx, fy) }, homeMark()),
    svg('g', { transform: place(tx, ty) }, ...destMark()));
  stops.forEach((s, i) => {
    const [x, y] = at(s.lat, s.lon);
    layer.append(svg('g', { class: 'map-pin is-fast', transform: place(x, y) }, ...stopMark(i + 1)));
  });
  return layer;
}

/**
 * A route overview. `trip` is the planned trip ({ from, to, stops, miles }); `points` the route line;
 * `others` the fast chargers that could replace a stop. Calls track('map_rendered', { source, type: 'route' }).
 */
export function routeMap({ trip, points, others, track = () => {} }) {
  const data = { points, from: trip.from, to: trip.to, stops: trip.stops, others };
  const all = [...points, [trip.from.lat, trip.from.lon], [trip.to.lat, trip.to.lon]];
  const view = fitView(all);
  const crop = cropBox(view, all);
  const figure = el('figure', { class: 'charger-map route-map' });
  const frame = el('div', { class: 'map-frame' });
  frame.style.aspectRatio = `${crop.w.toFixed(1)} / ${crop.h.toFixed(1)}`;
  const scale = () => Math.min(2.4, Math.max(1, crop.w / (frame.clientWidth || crop.w)));
  const describe = `the route from ${trip.from.name} to ${trip.to.name}, about ${Math.round(trip.miles)} road miles, with ${plural(trip.stops.length, 'charging stop')} numbered like the legs below and ${plural(others.length, 'other fast charger')} that could replace a stop`;
  let reported = false;
  const report = (source) => { if (!reported) { reported = true; track('map_rendered', { source, type: 'route' }); } };
  const credit = el('p', { class: 'src' }, 'Street map: ',
    externalLink('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'), ', ',
    externalLink('© OpenMapTiles', 'https://openmaptiles.org/'), ', ',
      externalLink('Geoapify', 'https://www.geoapify.com/'), '.');

  // The whole 640 x 400 picture, placed so only the crop shows.
  const img = el('img', { class: 'map-img', width: MAP_W, height: MAP_H, decoding: 'async', alt: `Map of ${describe}.` });
  img.style.width = `${((MAP_W / crop.w) * 100).toFixed(3)}%`;
  img.style.height = `${((MAP_H / crop.h) * 100).toFixed(3)}%`;
  img.style.left = `${((-crop.x / crop.w) * 100).toFixed(3)}%`;
  img.style.top = `${((-crop.y / crop.h) * 100).toFixed(3)}%`;
  img.addEventListener('load', () => report('static'), { once: true });
  img.addEventListener('error', () => {
    frame.classList.add('is-fallback');
    const plot = overlay(view, crop, data, { fallback: true, k: scale() });
    plot.setAttribute('role', 'img');
    plot.removeAttribute('aria-hidden');
    plot.setAttribute('aria-label', `Plot of ${describe}. The street map is unavailable right now.`);
    frame.replaceChildren(plot);
    credit.remove();
    report('fallback');
  }, { once: true });
  img.src = `/api/map?z=${view.z}&x=${view.x}&y=${view.y}`;
  frame.append(img, overlay(view, crop, data, { fallback: false }));

  let lastK = 0;
  const redraw = () => {
    const k = scale();
    if (Math.abs(k - lastK) < 0.05) return;
    lastK = k;
    const old = frame.querySelector('.map-overlay');
    const fallback = frame.classList.contains('is-fallback');
    const next = overlay(view, crop, data, { fallback, k });
    if (fallback) { for (const a of ['role', 'aria-label']) next.setAttribute(a, old.getAttribute(a)); next.removeAttribute('aria-hidden'); }
    old.replaceWith(next);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(frame);

  const item = (mark, text) => el('span', { class: 'map-key-item' }, mark, ` ${text}`);
  const caption = el('figcaption', { class: 'map-caption route-key' },
    item(key('is-start', homeMark()), `Start: ${trip.from.name}`),
    item(key('is-dest', ...destMark()), trip.to.name),
    trip.stops.length ? item(key('is-stop', ...stopMark(1)), 'Your stops') : null,
    others.length ? item(key('', otherMark()), 'Other stops in range') : null);
  figure.append(frame, caption, credit);
  return figure;
}
