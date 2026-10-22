// The charger map: a street map of the area around the ZIP, with the ZIP center and the nearest
// public chargers drawn on top and numbered to match the list below it. The list is the accessible
// version; the picture is decoration for orientation.
//
// The street map comes from our own /api/map (see map-view.js for what that request reveals). If
// it can't load, the same markers are drawn on a plain plot with a one-mile ring, so the feature
// never breaks. Rendering uses textContent and SVG attributes only.

import { el, externalLink } from './dom.js';
import { MAP_H, MAP_W, chooseView, groupSites, metersPerPixel, placeMarkers, project } from './map-view.js';
import { chargersNear, connectorNames } from './places.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  for (const c of children) if (c) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

const METERS_PER_MILE = 1609.344;
const scaleOf = (frame) => Math.min(2.4, Math.max(1, MAP_W / (frame.clientWidth || MAP_W)));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Pins keep about the same size on screen however wide the map is drawn: k is how many image
// pixels one screen pixel covers (1 on a wide screen, about 2 on a phone).
function overlay(view, center, markers, { fallback, k = 1 }) {
  const at = placeMarkers(view, markers, 26 * k);
  const [cx, cy] = project(view, center.lat, center.lon);
  const place = (x, y) => `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(2)})`;
  const layer = svg('svg', { class: 'map-overlay', viewBox: `0 0 ${MAP_W} ${MAP_H}`, 'aria-hidden': 'true', focusable: 'false' });
  if (fallback) {
    const ring = METERS_PER_MILE / metersPerPixel(view);
    layer.append(
      svg('rect', { class: 'map-ground', x: 0, y: 0, width: MAP_W, height: MAP_H }),
      svg('circle', { class: 'map-ring', cx, cy, r: ring.toFixed(1) }),
      svg('text', { class: 'map-ring-label', transform: place(cx + ring * 0.71 + 4 * k, cy - ring * 0.71 - 4 * k) }, '1 mi'),
      svg('text', { class: 'map-north', transform: place(MAP_W - 30 * k, 26 * k) }, 'N ↑'));
  }
  layer.append(svg('g', { transform: place(cx, cy) },
    svg('circle', { class: 'map-home-halo', r: 13 }),
    svg('circle', { class: 'map-home', r: 7 })));
  // Leader lines first, so pins sit on top of them.
  at.forEach((p) => {
    if (!p.moved) return;
    layer.append(
      svg('line', { class: 'map-leader', x1: p.x0.toFixed(1), y1: p.y0.toFixed(1), x2: p.x.toFixed(1), y2: p.y.toFixed(1), 'stroke-width': (1.5 * k).toFixed(2) }),
      svg('circle', { class: 'map-spot', cx: p.x0.toFixed(1), cy: p.y0.toFixed(1), r: (2.5 * k).toFixed(2) }));
  });
  markers.forEach((site, i) => {
    const fast = site.stations.some((st) => st.fast > 0);
    layer.append(svg('g', { class: `map-pin${fast ? ' is-fast' : ''}`, transform: place(at[i].x, at[i].y) },
      fast ? svg('rect', { x: -12, y: -12, width: 24, height: 24, rx: 4 }) : svg('circle', { r: 12 }),
      svg('text', { y: 4.5 }, String(i + 1))));
  });
  return layer;
}

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

/** One line for a site: ports, plugs, and networks across every charger there. */
function siteLine(site) {
  const sum = (k) => site.stations.reduce((n, st) => n + (st[k] || 0), 0);
  const l2 = sum('level2');
  const fast = sum('fast');
  const ports = [fast ? `${fast} fast` : null, l2 ? `${l2} Level 2` : null].filter(Boolean).join(' · ');
  const plugs = uniq(site.stations.flatMap((st) => connectorNames(st.connectors))).join(', ');
  return [ports, plugs, uniq(site.stations.map((st) => st.network)).join(', ')].filter(Boolean).join(' · ');
}

function list(sites) {
  return el('ol', { class: 'map-list' }, sites.map((site, i) => {
    const [first] = site.stations;
    const more = site.stations.length - 1;
    const fast = site.stations.some((st) => st.fast > 0);
    return el('li', {},
      el('span', { class: `map-num${fast ? ' is-fast' : ''}`, 'aria-hidden': 'true', text: String(i + 1) }),
      el('div', {},
        el('p', { class: 'map-name' },
          el('span', { text: first.name }),
          more ? el('span', { class: 'map-more', text: ` and ${plural(more, 'more charger')} here` }) : null,
          el('span', { class: 'map-miles', text: ` ${site.miles < 0.1 ? '<0.1' : site.miles} mi` })),
        el('p', { class: 'map-meta', text: [[first.street, first.city].filter(Boolean).join(', '), siteLine(site)].filter(Boolean).join(' · ') }),
        first.hours || first.price ? el('p', { class: 'map-meta', text: [first.hours, first.price].filter(Boolean).join(' · ') }) : null));
  }));
}

/**
 * A charger map around { lat, lon }. `label` names the point ("ZIP 80302"). Calls
 * track('map_rendered', { source }) once, with 'static' (street map) or 'fallback' (drawn plot).
 */
export function chargerMap({ lat, lon, label, track = () => {} }) {
  const figure = el('figure', { class: 'charger-map' });
  const status = el('p', { class: 'map-status', role: 'status', text: 'Loading the charger map…' });
  figure.append(status);

  (async () => {
    let stations;
    try {
      stations = await chargersNear(lat, lon, { radius: 10, limit: 40 });
    } catch {
      status.textContent = 'We couldn’t load charger data for the map.';
      return;
    }
    const { view, markers } = chooseView(lat, lon, groupSites(stations));
    const center = { lat, lon };
    const frame = el('div', { class: 'map-frame' });
    const caption = el('figcaption', { class: 'map-caption' });
    const describe = markers.length
      ? `the ${plural(markers.length, 'nearest public charging site')}, numbered by distance`
      : 'no public chargers in view';
    let reported = false;
    const report = (source) => { if (!reported) { reported = true; track('map_rendered', { source }); } };

    const showFallback = () => {
      frame.classList.add('is-fallback');
      const plot = overlay(view, center, markers, { fallback: true, k: scaleOf(frame) });
      plot.setAttribute('role', 'img');
      plot.removeAttribute('aria-hidden');
      plot.setAttribute('aria-label', `Plot of the center of ${label} and ${describe}. The street map is unavailable right now.`);
      frame.replaceChildren(plot);
      caption.replaceChildren(
        el('span', { class: 'map-key-home', 'aria-hidden': 'true' }),
        ` Center of ${label}. Street map unavailable right now, so chargers are plotted by direction and distance; the ring is 1 mile.`);
      report('fallback');
    };

    const img = el('img', {
      class: 'map-img', width: MAP_W, height: MAP_H, decoding: 'async',
      alt: `Street map around the center of ${label}, showing ${describe}. The list below describes each one.`,
    });
    img.addEventListener('load', () => report('static'), { once: true });
    img.addEventListener('error', showFallback, { once: true });
    img.src = `/api/map?z=${view.z}&x=${view.x}&y=${view.y}`;
    frame.append(img, overlay(view, center, markers, { fallback: false }));
    // Re-draw the markers at the map's real width (and again if it changes, e.g. on rotate).
    let lastK = 0;
    const redraw = () => {
      const k = scaleOf(frame);
      if (Math.abs(k - lastK) < 0.05) return;
      lastK = k;
      const fallback = frame.classList.contains('is-fallback');
      const old = frame.querySelector('.map-overlay');
      const next = overlay(view, center, markers, { fallback, k });
      if (fallback) for (const at of ['role', 'aria-label']) { next.setAttribute(at, old.getAttribute(at)); next.removeAttribute('aria-hidden'); }
      old.replaceWith(next);
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(frame);
    caption.append(
      el('span', { class: 'map-key-home', 'aria-hidden': 'true' }),
      ` Center of ${label}. `,
      markers.length ? 'Numbers match the list, nearest first. Square pins have fast charging.' : 'No public chargers within about 10 miles of this map.');

    const credit = el('p', { class: 'src' }, 'Street map: ',
      externalLink('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'), ', ',
      externalLink('Geoapify', 'https://www.geoapify.com/'), '. Chargers: NREL Alternative Fuels Data Center.');
    status.remove();
    figure.append(frame, caption, markers.length ? list(markers) : null, credit);
  })();

  return figure;
}
