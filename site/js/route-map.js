// The route overview for a planned trip: one zoomed-out street map with the route drawn on it, the
// start, the destination, the chosen charging stops (numbered like the legs), and the other fast
// chargers along the way, so a stop a little earlier or later is easy to see. Not a pan-and-zoom map.
//
// Same approach as the charger map (charger-map.js): the page asks our /api/map for a plain map of a
// grid view and draws everything itself, so nothing about the trip goes in the request beyond which
// map was shown. If the street map can't load, the same drawing sits on a plain plot.

import { el, externalLink } from './dom.js';
import { homeKey, homeMark, scaleOf, svg } from './charger-map.js';
import { MAP_H, MAP_W, fitView, project } from './map-view.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function overlay(view, { points, from, to, stops, others }, { fallback, k = 1 }) {
  const at = (lat, lon) => project(view, lat, lon);
  const place = (x, y) => `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(2)})`;
  const layer = svg('svg', { class: 'map-overlay', viewBox: `0 0 ${MAP_W} ${MAP_H}`, 'aria-hidden': 'true', focusable: 'false' });
  if (fallback) {
    layer.append(
      svg('rect', { class: 'map-ground', x: 0, y: 0, width: MAP_W, height: MAP_H }),
      svg('g', { class: 'map-north', transform: place(MAP_W - 24 * k, 30 * k) },
        svg('path', { d: 'M0 -14 L6 0 L-6 0 Z' }),
        svg('text', { x: 0, y: 14 }, 'N')));
  }
  const d = points.map(([lat, lon], i) => { const [x, y] = at(lat, lon); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  layer.append(
    svg('path', { class: 'route-casing', d, 'stroke-width': (7 * k).toFixed(2) }),
    svg('path', { class: 'route-line', d, 'stroke-width': (4 * k).toFixed(2) }));
  // Other fast chargers first, so the route's own stops sit on top.
  for (const s of others) {
    const [x, y] = at(s.lat, s.lon);
    layer.append(svg('rect', { class: 'route-other', x: (x - 3.5 * k).toFixed(1), y: (y - 3.5 * k).toFixed(1), width: (7 * k).toFixed(1), height: (7 * k).toFixed(1), rx: (1.5 * k).toFixed(1) }));
  }
  const [fx, fy] = at(from.lat, from.lon);
  const [tx, ty] = at(to.lat, to.lon);
  layer.append(
    svg('g', { transform: place(fx, fy) }, homeMark()),
    svg('g', { class: 'route-dest', transform: place(tx, ty) }, svg('path', { d: 'M0 -11 L11 0 L0 11 L-11 0 Z' })));
  stops.forEach((s, i) => {
    const [x, y] = at(s.lat, s.lon);
    layer.append(svg('g', { class: 'map-pin is-fast', transform: place(x, y) },
      svg('rect', { x: -12, y: -12, width: 24, height: 24, rx: 4 }),
      svg('text', { y: 4.5 }, String(i + 1))));
  });
  return layer;
}

/**
 * A route overview. `trip` is the planned trip ({ from, to, stops, miles }); `points` the route line;
 * `others` the other usable fast chargers along it. Calls track('map_rendered', { source, type: 'route' }).
 */
export function routeMap({ trip, points, others, track = () => {} }) {
  const data = { points, from: trip.from, to: trip.to, stops: trip.stops, others };
  const view = fitView([...points, [trip.from.lat, trip.from.lon], [trip.to.lat, trip.to.lon]]);
  const figure = el('figure', { class: 'charger-map route-map' });
  const frame = el('div', { class: 'map-frame' });
  const describe = `the route from ${trip.from.name} to ${trip.to.name}, about ${Math.round(trip.miles)} road miles, with ${plural(trip.stops.length, 'charging stop')} numbered like the legs below and ${plural(others.length, 'other fast charger')} along the way`;
  let reported = false;
  const report = (source) => { if (!reported) { reported = true; track('map_rendered', { source, type: 'route' }); } };
  const credit = el('p', { class: 'src' }, 'Street map: ',
    externalLink('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'), ', ',
    externalLink('Geoapify', 'https://www.geoapify.com/'), '.');

  const img = el('img', { class: 'map-img', width: MAP_W, height: MAP_H, decoding: 'async', alt: `Map of ${describe}.` });
  img.addEventListener('load', () => report('static'), { once: true });
  img.addEventListener('error', () => {
    frame.classList.add('is-fallback');
    const plot = overlay(view, data, { fallback: true, k: scaleOf(frame) });
    plot.setAttribute('role', 'img');
    plot.removeAttribute('aria-hidden');
    plot.setAttribute('aria-label', `Plot of ${describe}. The street map is unavailable right now.`);
    frame.replaceChildren(plot);
    credit.remove();
    report('fallback');
  }, { once: true });
  img.src = `/api/map?z=${view.z}&x=${view.x}&y=${view.y}`;
  frame.append(img, overlay(view, data, { fallback: false }));

  let lastK = 0;
  const redraw = () => {
    const k = scaleOf(frame);
    if (Math.abs(k - lastK) < 0.05) return;
    lastK = k;
    const old = frame.querySelector('.map-overlay');
    const fallback = frame.classList.contains('is-fallback');
    const next = overlay(view, data, { fallback, k });
    if (fallback) { for (const a of ['role', 'aria-label']) next.setAttribute(a, old.getAttribute(a)); next.removeAttribute('aria-hidden'); }
    old.replaceWith(next);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(frame);

  const caption = el('figcaption', { class: 'map-caption' });
  caption.append(
    homeKey(), ` Start · `,
    svg('svg', { class: 'map-key-dest', viewBox: '-13 -13 26 26', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: 'M0 -11 L11 0 L0 11 L-11 0 Z' })),
    ` ${trip.to.name}${trip.stops.length ? ' · Squares are your stops, numbered like the legs' : ''}${others.length ? '; small squares are other fast chargers within 3 miles of the route' : ''}.`);
  figure.append(frame, caption, credit);
  return figure;
}
