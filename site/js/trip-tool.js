// The trip planner inside the EV plan ("Plan a charging stop for <park>", "Rehearse your longest
// drive"): one destination from home, a real road route through our proxy, fast-charging stops
// from the static station cells, stepped through leg by leg, and saved into the plan.
// Rendering uses textContent only.

import { el, num, srOnly } from './dom.js';
import { SearchUnavailable, connectorNames, fastStationsAlong, fetchRoute } from './places.js';
import { FLEET_KEY } from './logic.js';
import { MAX_SAVED_TRIPS } from './plan-store.js';
import { LEG_MAX, LEG_MIN, PLUGS, durationText, legMilesFromRange, planStops, stopsBucket } from './trip.js';

const tripId = () => `trip-${Math.random().toString(36).slice(2, 10)}`;
const fastPlugs = (codes) => connectorNames((codes || '').replace(/[^CND]/g, ''));
const plural = (n, word) => `${num.format(n)} ${word}${n === 1 ? '' : 's'}`;

/** One line describing a fast-charging stop: plugs, ports, network. */
export function stopFacts(s) {
  return [fastPlugs(s.connectors).join(', '), plural(s.fast, 'fast port'), s.network].filter(Boolean).join(' · ');
}

// A NACS-only station may not be open to every car, even with an adapter.
const nacsOnly = (s) => /N/.test(s.connectors || '') && !/C/.test(s.connectors || '');

/** "1 fast-charging stop" / "No charging stop needed". */
export function stopsText(n) {
  return n ? `${plural(n, 'fast-charging stop')}` : 'No charging stop needed';
}

/**
 * deps: { ctx, searchForm(slot, labels, onPick), loadVehicles() }
 * ctx adds parks (the static park list) and meta (data dates and the fleet) to the plan tools' ctx.
 */
export function createTripTool({ ctx, searchForm, loadVehicles }) {
  const origin = () => {
    const home = ctx.plan().places.find((p) => p.slot === 'home');
    if (home) return { name: 'Home', lat: home.lat, lon: home.lon };
    return ctx.zipRec?.la ? { name: `ZIP ${ctx.zip}`, lat: ctx.zipRec.la, lon: ctx.zipRec.lo } : null;
  };

  // Parks near this ZIP, closest first, with the coordinates the Park Service publishes.
  function parkChoices(named) {
    const parks = ctx.parks || [];
    const dests = ctx.rec?.destinations || [];
    const shown = dests.slice(0, 4);
    const step = dests.find((d) => d.name === named);
    if (step && !shown.includes(step)) shown.push(step);
    return shown.map((d) => {
      const p = parks.find((x) => x.code === d.code);
      return p && Number.isFinite(p.lat) ? { name: d.name, detail: `About ${num.format(d.oneWayMiles)} miles away (estimated)`, where: [p.states, 'National Park Service'].filter(Boolean).join(' · '), lat: p.lat, lon: p.lon, park: d.code } : null;
    }).filter(Boolean);
  }

  const asOf = () => (ctx.meta?.fetchedAt ? new Date(ctx.meta.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : null);

  // ---------- one planned trip: totals, legs, and the step-through ----------

  function renderTrip(box, trip, { stuck = null, onSaveToggle } = {}) {
    const legs = [
      ...trip.stops.map((s, i) => ({ kind: 'stop', s, title: `Stop ${i + 1}: ${s.name}`, miles: s.legMiles })),
      ...(stuck == null ? [{ kind: 'arrive', title: `Arrive: ${trip.to.name}`, miles: trip.finalLegMiles }] : []),
    ];
    const heading = el('h4', { class: 'trip-title', tabindex: '-1', text: `${trip.from.name} to ${trip.to.name}` });
    const totals = el('dl', { class: 'trip-totals' },
      el('div', {}, el('dt', { text: 'Road miles' }), el('dd', { text: num.format(Math.round(trip.miles)) })),
      el('div', {}, el('dt', { text: 'Driving' }), el('dd', { text: durationText(trip.minutes) })),
      el('div', {}, el('dt', { text: 'Fast-charging stops' }), el('dd', { text: stuck == null ? String(trip.stops.length) : '—' })));

    let current = 0;
    const rows = legs.map((leg, i) => {
      const s = leg.s;
      const detail = el('div', { class: 'trip-leg-detail', hidden: true },
        s ? el('p', { class: 'station-meta', text: [[s.street, s.city].filter(Boolean).join(', '), s.hours, s.price].filter(Boolean).join(' · ') || 'No address or hours on file.' }) : null,
        s && nacsOnly(s) ? el('p', { class: 'station-meta', text: 'NACS-only site: other plugs need an adapter, and not every one is open to them. Check the network’s app.' }) : null,
        s ? el('p', { class: 'station-meta', text: `At road mile ${num.format(s.atMile)}${s.detourMiles >= 0.5 ? `, about ${s.detourMiles} mi off the route` : ''}. You’d arrive with about ${num.format(Math.max(0, trip.legMiles - s.legMiles))} of your ${num.format(trip.legMiles)} planned miles left.` }) : null,
        !s ? el('p', { class: 'station-meta', text: `Arrive with about ${num.format(trip.arriveWithMiles)} of your ${num.format(trip.legMiles)} planned miles to spare.` }) : null);
      return el('li', { class: 'trip-leg' },
        el('span', { class: 'trip-mark', 'aria-hidden': 'true' }),
        el('div', { class: 'trip-leg-main' },
          el('p', { class: 'station-name', text: leg.title }),
          s ? el('p', { class: 'station-meta', text: stopFacts(s) }) : el('p', { class: 'station-meta', text: trip.to.detail || 'Your destination' }),
          detail),
        el('p', { class: 'row-figure' }, `${num.format(leg.miles)}`, el('span', { class: 'car-unit', text: ' mi' }), srOnly(` on leg ${i + 1}`)));
    });
    const list = el('ol', { class: `trip-legs${stuck == null ? '' : ' is-stuck'}`, 'aria-label': 'Legs of this trip' }, rows);

    const live = el('p', { class: 'tool-status trip-step-status', role: 'status' });
    const prev = el('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => go(current - 1, 'previous') }, 'Previous leg');
    const next = el('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => go(current + 1, 'next') }, 'Next leg');
    const skip = el('button', { type: 'button', class: 'btn-link', onclick: () => go(legs.length - 1, 'skip') }, stuck == null ? 'Skip to arrival' : 'Skip to the last stop');
    const position = el('p', { class: 'trip-position', 'aria-hidden': 'true' });

    function draw() {
      rows.forEach((r, i) => {
        r.classList.toggle('is-passed', i < current);
        if (i === current) r.setAttribute('aria-current', 'step'); else r.removeAttribute('aria-current');
        r.querySelector('.trip-leg-detail').hidden = i !== current;
      });
      prev.disabled = current === 0;
      next.disabled = current === legs.length - 1;
      skip.hidden = current === legs.length - 1;
      position.textContent = `Leg ${current + 1} of ${legs.length}`;
    }
    function go(i, direction) {
      if (i < 0 || i >= legs.length || i === current) return;
      const from = document.activeElement;
      current = i;
      draw();
      const leg = legs[i];
      live.textContent = `Leg ${i + 1} of ${legs.length}: ${num.format(leg.miles)} miles. ${leg.title}.${leg.s ? ` ${stopFacts(leg.s)}.` : ''}`;
      // Keep focus on the control that was used; if it just became unavailable, move to the one that still works.
      if (from?.disabled || from?.hidden) (next.disabled ? prev : next).focus();
      ctx.track('trip_step', { direction });
    }

    const stepper = legs.length > 1
      ? el('div', { class: 'trip-stepper', role: 'group', 'aria-label': 'Step through the legs' }, prev, position, next, skip)
      : null;

    box.replaceChildren(...[heading, totals,
      stuck != null ? el('p', { class: 'tool-status', text: `No fast charger we know of is within ${num.format(trip.legMiles)} miles after road mile ${num.format(stuck)}. Try more miles between charges, a different plug, or a closer destination.` }) : null,
      list, stepper, live,
      onSaveToggle ? el('div', { class: 'trip-save-slot' }, saveButton(trip, onSaveToggle)) : null,
      el('p', { class: 'tool-note', text: `One way. Fast chargers only, from the U.S. Department of Energy station list${asOf() ? ` as of ${asOf()}` : ''}; whether a charger is working or free right now isn’t known here, so check the network’s app before you go. Route: Geoapify, © OpenStreetMap contributors.` })].filter(Boolean));
    draw();
    return heading;
  }

  function saveButton(trip, onToggle) {
    const saved = ctx.plan().trips.some((t) => t.id === trip.id);
    const full = !saved && ctx.plan().trips.length >= MAX_SAVED_TRIPS;
    return el('div', { class: 'tool-row' },
      el('button', {
        type: 'button', class: `btn-save trip-save${saved ? ' is-on' : ''}`, 'aria-pressed': String(saved), disabled: full,
        onclick: () => onToggle(trip),
      }, saved ? 'Saved to your plan' : full ? `${MAX_SAVED_TRIPS} trips saved (the most)` : 'Save this trip'),
      full ? el('span', { class: 'tool-note', text: 'Remove a saved trip below to save this one.' }) : null);
  }

  // ---------- the tool ----------

  async function render(box, stepId, stepValue) {
    const from = origin();
    if (!from) { box.append(el('p', { class: 'tool-status', text: 'Enter your ZIP first, so the trip can start from home.' })); return; }
    const parks = parkChoices(stepId === 'plan-park' ? stepValue : null);
    const ui = {
      to: stepId === 'plan-park' ? parks.find((p) => p.name === stepValue) || parks[0] || null : null,
      searched: null,
      plug: 'any',
      legMiles: null,
      basis: null,
    };
    const prefix = `trip-${stepId}`;

    // Where to: nearby parks, or any place found by search.
    const toList = el('div', { class: 'seg trip-dests' });
    const toFieldset = el('fieldset', { class: 'seg trip-to' }, el('legend', { text: 'Where to' }), toList);
    function drawDestinations() {
      const options = [...parks, ...(ui.searched ? [ui.searched] : [])];
      toList.replaceChildren(...options.map((d, i) => {
        const id = `${prefix}-to-${i}`;
        return el('label', { class: 'seg-option trip-dest', for: id },
          el('input', { type: 'radio', id, name: `${prefix}-to`, checked: ui.to === d, onchange: () => { ui.to = d; } }),
          el('span', {}, el('strong', { text: d.name }), d.detail ? el('span', { class: 'trip-dest-detail', text: d.detail }) : null));
      }));
      if (!options.length) toList.append(el('p', { class: 'tool-note', text: 'Search for a place below.' }));
    }
    const search = searchForm(`${prefix}-search`, { title: stepId === 'plan-park' ? 'Park trip destination' : 'Long drive destination', search: 'Or search a city, address, or place' }, (p) => {
      ui.searched = { name: p.name || p.detail, detail: p.name ? p.detail : '', lat: p.lat, lon: p.lon, park: null };
      ui.to = ui.searched;
      drawDestinations();
      search.querySelector('.search-results')?.replaceChildren();
      toList.querySelector('input:checked')?.focus();
    });

    // Miles between charges: from a shortlisted car, a typical electric SUV, or typed in.
    const data = await loadVehicles().catch(() => null);
    const cars = (data?.vehicles || []).filter((v) => ctx.plan().shortlist.includes(v.id));
    const typical = ctx.meta?.fleet?.[FLEET_KEY]?.rangeMedian;
    const bases = [
      ...cars.map((v) => ({ id: v.id, label: `${v.make} ${v.model} · ${v.rangeMin} mi EPA`, range: v.rangeMin })),
      typical ? { id: 'typical', label: `Typical SUV · ${typical} mi EPA`, range: typical } : null,
    ].filter(Boolean);
    ui.basis = bases[0] || null;
    ui.legMiles = legMilesFromRange(ui.basis?.range) || 200;
    const legId = `${prefix}-leg`;
    const legInput = el('input', { id: legId, type: 'number', inputmode: 'numeric', min: LEG_MIN, max: LEG_MAX, step: 5, value: ui.legMiles, onchange: (e) => {
      const n = Math.round(Number(e.target.value));
      if (Number.isFinite(n) && n >= LEG_MIN && n <= LEG_MAX) ui.legMiles = n; else e.target.value = ui.legMiles;
    } });
    const basisId = `${prefix}-basis`;
    const plugId = `${prefix}-plug`;
    const rangeFields = el('div', { class: 'finance-fields trip-fields' },
      bases.length ? el('div', { class: 'field field-basis' }, el('label', { for: basisId, text: 'Plan for' }),
        el('select', { id: basisId, onchange: (e) => {
          ui.basis = bases.find((b) => b.id === e.target.value) || ui.basis;
          ui.legMiles = legMilesFromRange(ui.basis.range) || ui.legMiles;
          legInput.value = ui.legMiles;
        } }, bases.map((b) => el('option', { value: b.id, text: b.label })))) : null,
      el('div', { class: 'field' }, el('label', { for: legId, text: 'Miles between charges' }),
        el('span', { class: 'input-affix' }, legInput, el('span', { 'aria-hidden': 'true', text: 'mi' }))),
      el('div', { class: 'field' }, el('label', { for: plugId, text: 'Fast-charging plug' }),
        el('select', { id: plugId, onchange: (e) => { ui.plug = Object.hasOwn(PLUGS, e.target.value) ? e.target.value : 'any'; } },
          Object.entries(PLUGS).map(([k, p]) => el('option', { value: k, text: p.label })))),
      el('p', { class: 'tool-note field-wide', text: `Miles between charges start at two-thirds of the lowest EPA range: the same buffer as your range need, for winter, a reserve so you never arrive empty, and battery aging. Change it if you know your car.${cars.length ? '' : ' Shortlist cars in “Compare cars that fit” to plan with one of them.'}` }));

    const status = el('p', { class: 'tool-status', role: 'status' });
    const result = el('div', { class: 'trip-result' });
    const savedBox = el('div', { class: 'trip-saved' });

    let lastTrip = null;
    async function onPlan() {
      if (!ui.to) { status.textContent = 'Choose where you’re going first.'; toList.querySelector('input')?.focus(); return; }
      status.textContent = 'Finding the route and fast chargers along it…';
      result.replaceChildren();
      let route;
      try {
        route = await fetchRoute(from, ui.to);
      } catch (err) {
        const code = err instanceof SearchUnavailable ? err.code : 'unavailable';
        status.textContent = {
          rate_limited: 'Too many trips planned at once. Wait a minute and try again.',
          no_route: 'We couldn’t find a road route there. Try a nearby town instead.',
          too_far: 'That’s more than about 1,000 miles away. The planner handles one destination within a long day or two of driving.',
          too_close: 'That’s right next to home, so no charging stop is needed.',
        }[code] || 'Route planning isn’t available right now. Please try again later.';
        return;
      }
      let stations;
      try { stations = await fastStationsAlong(route.points); } catch { status.textContent = 'We couldn’t load charger data. Please try again.'; return; }
      const plan = planStops({ route, stations, legMiles: ui.legMiles, plug: ui.plug });
      lastTrip = {
        id: tripId(), step: stepId,
        from: { name: from.name, lat: from.lat, lon: from.lon },
        to: { name: ui.to.name, detail: ui.to.where ?? ui.to.detail ?? '', lat: ui.to.lat, lon: ui.to.lon, park: ui.to.park || null },
        miles: route.miles, minutes: route.minutes, legMiles: ui.legMiles, plug: ui.plug,
        finalLegMiles: plan.finalLegMiles || 0, arriveWithMiles: plan.arriveWithMiles || 0,
        stops: plan.stops.map((s) => ({
          id: s.id, name: s.name, street: s.street, city: s.city, lat: s.lat, lon: s.lon, level2: s.level2, fast: s.fast,
          network: s.network, connectors: s.connectors, hours: s.hours, price: s.price, atMile: s.atMile, legMiles: s.legMiles, detourMiles: s.detourMiles,
        })),
      };
      ctx.track('trip_planned', { stops: stopsBucket(plan.stops.length), dest: ui.to.park ? 'park' : 'place', result: plan.ok ? 'ok' : plan.reason });
      status.textContent = plan.ok
        ? `${num.format(Math.round(route.miles))} miles, about ${durationText(route.minutes)} of driving. ${stopsText(plan.stops.length)}.`
        : plan.reason === 'too_many_stops'
          ? 'This trip needs more than 12 charging stops. Try more miles between charges or a closer destination.'
          : 'Part of this route has no fast charger within your miles between charges.';
      const heading = renderTrip(result, lastTrip, { stuck: plan.ok ? null : plan.stuckAtMile, onSaveToggle: plan.ok ? toggleSave : null });
      heading.focus();
    }

    function toggleSave(trip) {
      let nowSaved = false;
      ctx.update((p) => {
        if (p.trips.some((t) => t.id === trip.id)) p.trips = p.trips.filter((t) => t.id !== trip.id);
        else if (p.trips.length < MAX_SAVED_TRIPS) { p.trips.push(structuredClone(trip)); nowSaved = true; }
      });
      if (nowSaved) ctx.track('trip_saved', { count: ctx.plan().trips.length });
      drawSaved();
      result.querySelector('.trip-save')?.focus();
    }

    // The save button reflects the plan: saved, savable, or the list is full.
    function refreshSave() {
      const slot = result.querySelector('.trip-save-slot');
      if (slot && lastTrip) slot.replaceChildren(saveButton(lastTrip, toggleSave));
    }

    function drawSaved() {
      refreshSave();
      const trips = ctx.plan().trips;
      if (!trips.length) { savedBox.replaceChildren(); return; }
      const title = el('h4', { class: 'trip-saved-title', tabindex: '-1', text: `Saved trips (${trips.length} of ${MAX_SAVED_TRIPS})` });
      savedBox.replaceChildren(title, el('ul', { class: 'trip-saved-list' }, trips.map((t) => el('li', {},
        el('p', {}, el('strong', { text: `${t.from.name} to ${t.to.name}` }),
          el('span', { class: 'station-meta', text: ` ${num.format(Math.round(t.miles))} mi · ${stopsText(t.stops.length).toLowerCase()}` })),
        el('div', { class: 'trip-saved-actions' },
          el('button', { type: 'button', class: 'btn-link', onclick: () => { lastTrip = t; renderTrip(result, t, { onSaveToggle: toggleSave }).focus(); } }, 'View', srOnly(` the trip to ${t.to.name}`)),
          el('button', { type: 'button', class: 'btn-link', onclick: () => {
            ctx.update((p) => { p.trips = p.trips.filter((x) => x.id !== t.id); });
            drawSaved();
            (savedBox.querySelector('.trip-saved-title') || result.querySelector('.trip-title') || box.querySelector('.trip-plan-btn'))?.focus();
          } }, 'Remove', srOnly(` the trip to ${t.to.name}`)))))));
    }

    drawDestinations();
    box.append(
      el('p', { class: 'trip-from' }, el('span', { class: 'trip-from-label', text: 'From ' }), el('strong', { text: from.name === 'Home' ? 'your saved home address' : `the center of ZIP ${ctx.zip}` })),
      toFieldset, search, rangeFields,
      el('div', { class: 'tool-row' }, el('button', { type: 'button', class: 'btn btn-go btn-small trip-plan-btn', onclick: onPlan }, 'Plan the trip')),
      el('p', { class: 'tool-note', text: 'The start and end points go to our routing service to find the road, and are not stored.' }),
      status, result, savedBox);
    drawSaved();
  }

  return { render };
}
