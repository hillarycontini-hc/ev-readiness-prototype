// The trip planner inside the EV plan ("Plan a charging stop for <park>", "Rehearse your longest
// drive"): one destination from home, a real road route through our proxy, fast-charging stops
// from the static station cells, stepped through leg by leg, and saved into the plan.
// Rendering uses textContent only.

import { el, num, srOnly } from './dom.js';
import { SearchUnavailable, connectorNames, fastStationsAlong, fetchRoute } from './places.js';
import { ASSUMPTIONS, FLEET_KEY } from './logic.js';
import { MAX_SAVED_TRIPS } from './plan-store.js';
import { CHARGE_MINUTES, EXTRA_USE, LEG_MAX, LEG_MIN, PLUGS, durationText, legMilesFromRange, planStops, stopsBucket, tripCost } from './trip.js';

const tripId = () => `trip-${Math.random().toString(36).slice(2, 10)}`;
const fastPlugs = (codes) => connectorNames((codes || '').replace(/[^CND]/g, ''));
const plural = (n, word) => `${num.format(n)} ${word}${n === 1 ? '' : 's'}`;

/** One line describing a fast-charging stop: plugs, ports, network. */
export function stopFacts(s) {
  return [fastPlugs(s.connectors).join(', '), plural(s.fast, 'fast port'), s.network].filter(Boolean).join(' · ');
}

/** At a glance: how many fast ports, and whose network. */
const glance = (s) => [plural(s.fast, 'fast port'), s.network].filter(Boolean).join(' · ');

/** Everything about a stop's plug in one place, in plain words. */
function plugNote(s) {
  const c = s.connectors || '';
  const ccs = c.includes('C');
  const nacs = c.includes('N');
  if (ccs && nacs) return 'Has both fast-charging plugs, CCS and NACS, so most electric cars can charge here.';
  if (ccs) return 'CCS plug only. Cars with a NACS port need a CCS adapter here.';
  return 'NACS plug only. Cars with a CCS port need an adapter, and not every NACS-only site is open to them, so check the network’s app first.';
}

/** "20–45 min" or "1–2.5 h": the charging time for a trip's stops, short enough for a figure. */
function chargeTimeShort(stops) {
  const [lo, hi] = CHARGE_MINUTES.map((m) => m * stops);
  if (hi < 120) return `${lo}–${hi} min`;
  const h = (m) => String(Math.round((m / 60) * 2) / 2);
  return `${h(lo)}–${h(hi)} h`;
}

/**
 * The trip's rough electricity cost and a gas comparison, with the assumptions in words.
 * rec: the recommendation (home electricity and gas prices for the ZIP's state); meta: the fleet.
 */
export function tripCostFor(trip, { rec, meta, stateName }) {
  const c = rec?.costs;
  const kwh100 = trip.kwh100 || meta?.fleet?.[FLEET_KEY]?.kwhPer100Median;
  if (!c || !kwh100 || !Number.isFinite(c.electricityCents)) return null;
  const est = tripCost({
    miles: trip.miles, firstLegMiles: trip.stops.length ? trip.stops[0].legMiles : trip.miles, kwh100,
    homeCentsPerKwh: c.electricityCents, dcPerKwh: ASSUMPTIONS.dcFastPricePerKwh, gasPrice: c.gasPrice, mpg: ASSUMPTIONS.gasMpg,
  });
  const where = stateName ? ` at ${stateName} rates` : '';
  const figure = est.low === est.high ? `~$${est.low}` : `$${est.low}–${est.high}`;
  const parts = est.fastMiles
    ? `the first ${num.format(est.homeMiles)} miles on a charge from home${where} (${c.electricityCents.toFixed(1)}¢/kWh) and the other ${num.format(est.fastMiles)} at fast chargers at about $${ASSUMPTIONS.dcFastPricePerKwh.toFixed(2)}/kWh`
    : `the whole drive on a charge from home${where} (${c.electricityCents.toFixed(1)}¢/kWh)`;
  const text = `Electricity for this drive: about ${figure}, with ${parts}. The range runs from the car’s EPA efficiency to ${Math.round(EXTRA_USE * 100)}% more for cold weather and highway speeds.${est.gas ? ` The same drive in a ${ASSUMPTIONS.gasMpg}-mpg gas car: about $${est.gas} at ${stateName || 'local'} gas prices.` : ''}`;
  const line = `About ${figure} of electricity${est.gas ? `, vs about $${est.gas} of gas for the same drive` : ''}.`;
  return { figure, text, line, gas: est.gas };
}

/** "1 fast-charging stop" / "No charging stop needed". */
export function stopsText(n) {
  return n ? `${plural(n, 'fast-charging stop')}` : 'No charging stop needed';
}

/**
 * deps: { ctx, searchForm(slot, labels, onPick), loadVehicles() }
 * ctx adds parks (the static park list) and meta (data dates and the fleet) to the plan tools' ctx.
 */
export function createTripTool({ ctx, searchForm, loadVehicles }) {
  // Where a trip can start without a search: the saved home first, then the ZIP's center.
  const startChoices = () => {
    const home = ctx.plan().places.find((p) => p.slot === 'home');
    return [
      home ? { name: 'Home', label: 'your saved home address', lat: home.lat, lon: home.lon } : null,
      ctx.zipRec?.la ? { name: `ZIP ${ctx.zip}`, label: `the center of ZIP ${ctx.zip}`, lat: ctx.zipRec.la, lon: ctx.zipRec.lo } : null,
    ].filter(Boolean);
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
    const cost = stuck == null ? tripCostFor(trip, { rec: ctx.rec, meta: ctx.meta, stateName: ctx.zipRec?.s }) : null;
    const total = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
    const totals = el('dl', { class: 'trip-totals' },
      total('Road miles', num.format(Math.round(trip.miles))),
      total('Driving', durationText(trip.minutes)),
      total('Fast-charging stops', stuck == null ? String(trip.stops.length) : '—'),
      stuck == null && trip.stops.length ? total('Charging time, est.', chargeTimeShort(trip.stops.length)) : null,
      cost ? total('Electricity, est.', cost.figure) : null);
    const costNote = cost ? el('div', { class: 'trip-cost' },
      el('p', { class: 'leg-key trip-cost-line', text: cost.line }),
      el('details', { class: 'trip-help trip-cost-note' },
        el('summary', { text: 'How we estimated this' }),
        el('p', { text: cost.text }),
        trip.stops.length ? el('p', { text: `Charging time assumes ${CHARGE_MINUTES[0]} to ${CHARGE_MINUTES[1]} minutes a stop, a typical fast charge from about 10% to 80%. It depends on the car and the charger.` }) : null)) : null;

    let current = 0;
    const rows = legs.map((leg, i) => {
      const s = leg.s;
      // Read first: where the stop is on the route and what's left. Then the address. The plug,
      // hours, and price sit together behind one disclosure.
      const detail = el('div', { class: 'trip-leg-detail', hidden: true },
        s ? el('p', { class: 'leg-key', text: `Road mile ${num.format(s.atMile)}${s.detourMiles >= 0.5 ? `, about ${s.detourMiles} mi off the route` : ', on the route'}.` }) : null,
        s ? el('p', { class: 'leg-key', text: `You’d arrive with about ${num.format(Math.max(0, trip.legMiles - s.legMiles))} of your ${num.format(trip.legMiles)} planned miles left.` }) : null,
        !s ? el('p', { class: 'leg-key', text: `You’d arrive with about ${num.format(trip.arriveWithMiles)} of your ${num.format(trip.legMiles)} planned miles to spare.` }) : null,
        s && [s.street, s.city].some(Boolean) ? el('p', { class: 'leg-address', text: [s.street, s.city].filter(Boolean).join(', ') }) : null,
        s ? el('details', { class: 'leg-more' },
          el('summary', {}, `Plug: ${fastPlugs(s.connectors).join(' and ') || 'not listed'}`, el('span', { class: 'leg-more-hint', text: ' · hours and price' })),
          el('p', { text: plugNote(s) }),
          el('p', {}, el('span', { class: 'leg-more-label', text: 'Hours: ' }), s.hours || 'Not listed'),
          el('p', {}, el('span', { class: 'leg-more-label', text: 'Price: ' }), s.price || 'Not listed')) : null);
      return el('li', { class: 'trip-leg' },
        el('span', { class: 'trip-mark', 'aria-hidden': 'true' }),
        el('div', { class: 'trip-leg-main' },
          el('p', { class: 'station-name', text: leg.title }),
          el('p', { class: 'station-meta', text: s ? glance(s) : trip.to.detail || 'Your destination' }),
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
      live.textContent = `Leg ${i + 1} of ${legs.length}: ${num.format(leg.miles)} miles. ${leg.title}.${leg.s ? ` ${glance(leg.s)}.` : ''}`;
      // Keep focus on the control that was used; if it just became unavailable, move to the one that still works.
      if (from?.disabled || from?.hidden) (next.disabled ? prev : next).focus();
      ctx.track('trip_step', { direction });
    }

    const stepper = legs.length > 1
      ? el('div', { class: 'trip-stepper', role: 'group', 'aria-label': 'Step through the legs' }, prev, position, next, skip)
      : null;

    box.replaceChildren(...[heading, totals, costNote,
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
    const starts = startChoices();
    if (!starts.length) { box.append(el('p', { class: 'tool-status', text: 'Enter your ZIP first, so the trip can start from home.' })); return; }
    const parks = parkChoices(stepId === 'plan-park' ? stepValue : null);
    const ui = {
      to: stepId === 'plan-park' ? parks.find((p) => p.name === stepValue) || parks[0] || null : null,
      searched: null,
      from: starts[0],
      fromSearched: null,
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

    // Start: home or the ZIP center by default; any searched place on request.
    const fromName = el('strong');
    const fromPanelId = `${prefix}-from-panel`;
    const fromList = el('div', { class: 'seg trip-dests' });
    function drawStarts() {
      fromName.textContent = ui.from.label;
      const options = [...starts, ...(ui.fromSearched ? [ui.fromSearched] : [])];
      fromList.replaceChildren(...options.map((d, i) => {
        const id = `${prefix}-from-${i}`;
        return el('label', { class: 'seg-option trip-dest', for: id },
          el('input', { type: 'radio', id, name: `${prefix}-from`, checked: ui.from === d, onchange: () => { ui.from = d; fromName.textContent = d.label; } }),
          el('span', {}, el('strong', { text: d.label.replace(/^./, (ch) => ch.toUpperCase()) }), d.detail ? el('span', { class: 'trip-dest-detail', text: d.detail }) : null));
      }));
    }
    const fromSearch = searchForm(`${prefix}-from-search`, { title: stepId === 'plan-park' ? 'Park trip start' : 'Long drive start', search: 'Or search a starting address or place' }, (p) => {
      const name = p.name || p.detail;
      ui.fromSearched = { name, label: name, detail: p.name ? p.detail : '', lat: p.lat, lon: p.lon };
      ui.from = ui.fromSearched;
      drawStarts();
      fromSearch.querySelector('.search-results')?.replaceChildren();
      fromList.querySelector('input:checked')?.focus();
    });
    const fromPanel = el('div', { class: 'trip-from-panel', id: fromPanelId, hidden: true },
      el('fieldset', { class: 'seg trip-start' }, el('legend', { text: 'Start from' }), fromList), fromSearch);
    const fromToggle = el('button', { type: 'button', class: 'btn-link', 'aria-expanded': 'false', 'aria-controls': fromPanelId, onclick: () => {
      const open = fromToggle.getAttribute('aria-expanded') === 'true';
      fromToggle.setAttribute('aria-expanded', String(!open));
      fromPanel.hidden = open;
      if (!open) fromList.querySelector('input:checked')?.focus();
    } }, 'Change start');
    drawStarts();

    // Miles between charges: from a shortlisted car (shortest range first, the safer plan),
    // a typical electric SUV, or typed in.
    const data = await loadVehicles().catch(() => null);
    const cars = (data?.vehicles || []).filter((v) => ctx.plan().shortlist.includes(v.id)).sort((a, b) => a.rangeMin - b.rangeMin);
    const fleet = ctx.meta?.fleet?.[FLEET_KEY];
    const typical = fleet?.rangeMedian;
    const bases = [
      ...cars.map((v) => ({ id: v.id, label: `${v.make} ${v.model}`, range: v.rangeMin, kwh100: v.kwh100 })),
      typical ? { id: 'typical', label: 'A typical electric SUV', range: typical, kwh100: fleet.kwhPer100Median } : null,
    ].filter(Boolean);
    ui.basis = bases[0] || null;
    ui.legMiles = legMilesFromRange(ui.basis?.range) || 200;
    const legId = `${prefix}-leg`;
    const legInput = el('input', { id: legId, type: 'number', inputmode: 'numeric', min: LEG_MIN, max: LEG_MAX, step: 5, value: ui.legMiles, onchange: (e) => {
      const n = Math.round(Number(e.target.value));
      if (Number.isFinite(n) && n >= LEG_MIN && n <= LEG_MAX) ui.legMiles = n; else e.target.value = ui.legMiles;
    } });
    const basisId = `${prefix}-basis`;
    const basisNote = el('p', { class: 'field-note', id: `${basisId}-note` });
    const drawBasisNote = () => { basisNote.textContent = ui.basis ? `Lowest EPA range ${num.format(ui.basis.range)} mi${ui.basis.id === 'typical' ? ' (the median)' : ''}` : ''; };
    const plugId = `${prefix}-plug`;
    const rangeFields = el('div', { class: 'finance-fields trip-fields' },
      bases.length ? el('div', { class: 'field field-basis' }, el('label', { for: basisId, text: 'Plan for' }),
        el('select', { id: basisId, 'aria-describedby': `${basisId}-note`, onchange: (e) => {
          ui.basis = bases.find((b) => b.id === e.target.value) || ui.basis;
          ui.legMiles = legMilesFromRange(ui.basis.range) || ui.legMiles;
          legInput.value = ui.legMiles;
          drawBasisNote();
        } }, bases.map((b) => el('option', { value: b.id, text: b.label }))), basisNote) : null,
      el('div', { class: 'field' }, el('label', { for: legId, text: 'Miles between charges' }),
        el('span', { class: 'input-affix' }, legInput, el('span', { 'aria-hidden': 'true', text: 'mi' }))),
      el('div', { class: 'field' }, el('label', { for: plugId, text: 'Fast-charging plug' }),
        el('select', { id: plugId, onchange: (e) => { ui.plug = Object.hasOwn(PLUGS, e.target.value) ? e.target.value : 'any'; } },
          Object.entries(PLUGS).map(([k, p]) => el('option', { value: k, text: p.label })))),
      el('details', { class: 'trip-help field-wide' },
        el('summary', { text: 'What are CCS and NACS?' }),
        el('p', { text: 'They are the two fast-charging plugs in the U.S., and every stop shows which it has.' }),
        el('ul', {},
          el('li', {}, el('strong', { text: 'NACS' }), ' (North American Charging Standard, also called SAE J3400) is the newer plug. Many 2025 and later models have this port.'),
          el('li', {}, el('strong', { text: 'CCS' }), ' (Combined Charging System) is the plug on most other electric cars from recent years.')),
        el('p', { text: 'Adapters let many cars use the other plug. The brand’s site lists which port a car has. Not sure? Keep “Either plug”: you’ll still see each stop’s plug before you go.' })),
      el('p', { class: 'tool-note field-wide', text: `Miles between charges start at 70% of the car’s lowest EPA range: charging to about 80% at each stop and arriving with about 10% left. Cold weather and highway speeds use more, so lower it for a winter trip.${cars.length ? '' : ' To plan with a specific car, shortlist it in “Compare cars that fit”.'}` }));

    drawBasisNote();
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
        route = await fetchRoute(ui.from, ui.to);
      } catch (err) {
        const code = err instanceof SearchUnavailable ? err.code : 'unavailable';
        status.textContent = {
          rate_limited: 'Too many trips planned at once. Wait a minute and try again.',
          no_route: 'We couldn’t find a road route there. Try a nearby town instead.',
          too_far: 'That’s more than about 1,000 miles away. The planner handles one destination within a long day or two of driving.',
          too_close: 'The start and destination are right next to each other, so no charging stop is needed.',
        }[code] || 'Route planning isn’t available right now. Please try again later.';
        return;
      }
      let stations;
      try { stations = await fastStationsAlong(route.points); } catch { status.textContent = 'We couldn’t load charger data. Please try again.'; return; }
      const plan = planStops({ route, stations, legMiles: ui.legMiles, plug: ui.plug });
      lastTrip = {
        id: tripId(), step: stepId,
        from: { name: ui.from.name, lat: ui.from.lat, lon: ui.from.lon },
        to: { name: ui.to.name, detail: ui.to.where ?? ui.to.detail ?? '', lat: ui.to.lat, lon: ui.to.lon, park: ui.to.park || null },
        miles: route.miles, minutes: route.minutes, legMiles: ui.legMiles, plug: ui.plug,
        kwh100: Number.isFinite(ui.basis?.kwh100) ? ui.basis.kwh100 : null,
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
      el('p', { class: 'trip-from' }, el('span', { class: 'trip-from-label', text: 'From ' }), fromName, ' ', fromToggle),
      fromPanel,
      toFieldset, search, rangeFields,
      el('div', { class: 'tool-row' }, el('button', { type: 'button', class: 'btn btn-go btn-small trip-plan-btn', onclick: onPlan }, 'Plan the trip')),
      el('p', { class: 'tool-note', text: 'The start and end points go to our routing service to find the road, and are not stored.' }),
      status, result, savedBox);
    drawSaved();
  }

  return { render };
}
