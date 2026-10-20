// The trip planner inside the EV plan ("Plan a charging stop for <park>", "Rehearse your longest
// drive"): one destination from home, a real road route through our proxy, fast-charging stops
// from the static station cells, stepped through leg by leg, and saved into the plan.
// Rendering uses textContent only.

import { el, num, srOnly } from './dom.js';
import { SearchUnavailable, connectorNames, fastStationsAlong, fetchRoute } from './places.js';
import { ASSUMPTIONS, FLEET_KEY } from './logic.js';
import { MAX_SAVED_TRIPS } from './plan-store.js';
import { CHARGE_MINUTES, EXTRA_USE, LEG_MAX, LEG_MIN, MAX_TRIP_STOPS, PLUGS, durationText, legMilesFromRange, nacsOnly, planStops, stopsBucket, suggestFixes, tripCost } from './trip.js';

const tripId = () => `trip-${Math.random().toString(36).slice(2, 10)}`;
const fastPlugs = (codes) => connectorNames((codes || '').replace(/[^CND]/g, ''));
const plural = (n, word) => `${num.format(n)} ${word}${n === 1 ? '' : 's'}`;

/** One line describing a fast-charging stop: plugs, ports, network. */
export function stopFacts(s) {
  return [nacsOnly(s) ? 'NACS only' : fastPlugs(s.connectors).join(', '), plural(s.fast, 'fast port'), s.network].filter(Boolean).join(' · ');
}

/** The answer in one sentence: how many stops, and where. */
export function answerText(trip) {
  const n = trip.stops.length;
  const where = (x) => `${x.city || x.name} (road mile ${num.format(x.atMile)})`;
  if (!n) return `No charging stop needed: you’d arrive with about ${num.format(trip.arriveWithMiles)} of your ${num.format(trip.legMiles)} planned miles to spare.`;
  if (n === 1) return `1 fast-charging stop: ${where(trip.stops[0])}.`;
  if (n <= 3) {
    const names = trip.stops.map(where);
    return `${n} fast-charging stops: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
  }
  return `${n} fast-charging stops, the first at ${where(trip.stops[0])}.`;
}

/**
 * Getting home from the destination: whether the planned miles left on arrival reach the first
 * fast charger on the way back (or home, when the route has none). parkFast is the straight-line
 * distance from a park to its nearest fast charger, when we know it.
 */
export function homeText(trip, parkFast = null) {
  if (!Number.isFinite(trip.returnMiles)) return null;
  const back = num.format(trip.returnMiles);
  const left = num.format(trip.arriveWithMiles);
  const enough = trip.arriveWithMiles >= trip.returnMiles;
  const nearPark = Number.isFinite(parkFast) ? ` The nearest fast charger to the park is about ${num.format(Math.round(parkFast))} miles from it (straight line).` : '';
  if (trip.returnTo === 'home') {
    return enough
      ? `There’s no fast charger on this route, but the ${left} planned miles you’d have left cover the ${back} miles home.`
      : `There’s no fast charger on this route, and the ${back} miles home is more than the ${left} planned miles you’d have left. Charge near ${trip.to.name} before heading back.${nearPark}`;
  }
  return enough
    ? `The first fast charger on the way back is about ${back} miles from ${trip.to.name}, and the ${left} planned miles you’d have left reach it.`
    : `The first fast charger on the way back is about ${back} miles away, more than the ${left} planned miles you’d have left. Charge near ${trip.to.name} before heading back.${nearPark}`;
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

/** What's left of the planned miles on arrival, in words that don't alarm when it's close to none. */
function spareText(left, planned) {
  if (left < 5) return `This leg uses nearly all of your ${num.format(planned)} planned miles, so there’s little to spare.`;
  return `You’d arrive with about ${num.format(left)} of your ${num.format(planned)} planned miles left.`;
}

/** "20–45 min" or "1–2.5 h": the charging time for a trip's stops, short enough for a figure. */
export function chargeTimeShort(stops) {
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

  // ---------- a trip that doesn't work yet: why, and the one-tap fixes ----------

  function gapView(trip, { plan, fixes, onFix }) {
    const plugWord = trip.plug === 'ccs' ? 'CCS ' : trip.plug === 'nacs' ? 'NACS ' : '';
    const last = trip.stops[trip.stops.length - 1];
    const near = last?.city ? ` near ${last.city}` : '';
    const total = Math.round(trip.miles);
    const at = plan.stuckAtMile;
    let why;
    if (plan.reason === 'too_many_stops') why = `It would need more than ${MAX_TRIP_STOPS} charging stops at ${num.format(trip.legMiles)} miles between charges.`;
    else if (plan.nextAtMile == null && !at) why = `There’s no ${plugWord}fast charger along the ${num.format(total)}-mile route, and it’s longer than your ${num.format(trip.legMiles)} miles between charges.`;
    else if (plan.nextAtMile == null) why = `There’s no ${plugWord}fast charger for the last ${num.format(total - at)} miles, from road mile ${num.format(at)}${near} to ${trip.to.name}.`;
    else why = `After road mile ${num.format(at)}${near}, the next ${plugWord}fast charger is ${num.format(plan.nextAtMile - at)} miles on, more than your ${num.format(trip.legMiles)} miles between charges.`;

    const actions = [];
    if (fixes.minLegMiles) actions.push(el('button', { type: 'button', class: 'btn btn-go btn-small trip-fix', onclick: () => onFix('miles', fixes.minLegMiles) }, `Plan with ${fixes.minLegMiles} miles between charges`));
    if (fixes.plugHelps) actions.push(el('button', { type: 'button', class: `btn ${actions.length ? 'btn-quiet' : 'btn-go'} btn-small trip-fix`, onclick: () => onFix('plug', 'any') }, 'Plan with either plug'));
    return el('div', { class: 'trip-gap' },
      el('p', { class: 'leg-key trip-gap-why' }, el('strong', { text: 'This trip doesn’t work yet. ' }), why, ' It can be saved once every leg fits.'),
      actions.length ? el('div', { class: 'tool-row trip-fixes' }, actions) : null,
      fixes.minLegMiles
        ? el('p', { class: 'tool-note', text: `${fixes.minLegMiles} miles between charges suits a car with about ${num.format(fixes.epaNeeded)} miles of EPA range or more. It’s the least that works, so the longest leg has little to spare; more range is more comfortable.${fixes.plugHelps ? ' Either plug works at your current miles, if your car can use both (most can with an adapter).' : ''}` })
        : fixes.plugHelps ? null : el('p', { class: 'tool-note', text: 'No setting fixes this route. Try a closer destination, or a town along the way.' }));
  }

  function renderTrip(box, trip, { gap = null, onSaveToggle, onPlug = null } = {}) {
    const stuck = gap ? gap.plan.stuckAtMile : null;
    const legs = [
      ...trip.stops.map((s, i) => ({ kind: 'stop', s, title: `Stop ${i + 1}: ${s.name}`, miles: s.legMiles })),
      ...(stuck == null ? [{ kind: 'arrive', title: `Arrive: ${trip.to.name}`, miles: trip.finalLegMiles }] : []),
    ];
    const heading = el('h4', { class: 'trip-title', tabindex: '-1', text: `${trip.from.name} to ${trip.to.name}` });
    const cost = stuck == null ? tripCostFor(trip, { rec: ctx.rec, meta: ctx.meta, stateName: ctx.zipRec?.s }) : null;
    // The answer leads; the two figures that frame it follow; time and money share one line.
    const answer = stuck == null ? el('p', { class: 'trip-answer', text: answerText(trip) }) : null;
    const total = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
    const totals = el('dl', { class: 'trip-totals' },
      total('Road miles', num.format(Math.round(trip.miles))),
      total('Driving', durationText(trip.minutes)));
    const timeLine = stuck == null && trip.stops.length ? `Plus about ${chargeTimeShort(trip.stops.length)} of charging. ` : '';
    const costNote = cost ? el('div', { class: 'trip-cost' },
      el('p', { class: 'leg-key trip-cost-line', text: `${timeLine}${cost.line}` }),
      el('details', { class: 'trip-help trip-cost-note' },
        el('summary', { text: 'How we estimated this' }),
        el('p', { text: cost.text }),
        trip.stops.length ? el('p', { text: `Charging time assumes ${CHARGE_MINUTES[0]} to ${CHARGE_MINUTES[1]} minutes a stop, a typical fast charge from about 10% to 80%. It depends on the car and the charger.` }) : null)) : null;

    // With "Either plug", say plainly when a stop has only a NACS plug, and offer the CCS-only plan.
    const nacsStops = trip.plug === 'nacs' ? 0 : trip.stops.filter(nacsOnly).length;
    const plugCheck = stuck == null && nacsStops ? el('div', { class: 'trip-warn' },
      el('p', { class: 'leg-key' }, el('strong', { text: 'Check your car’s plug. ' }),
        `${nacsStops === 1 ? '1 stop has' : `${nacsStops} stops have`} only a NACS plug. A car with a CCS port needs an adapter there, and not every NACS-only site is open to other cars.`),
      onPlug ? el('div', { class: 'tool-row' }, el('button', { type: 'button', class: 'btn btn-quiet btn-small trip-fix', onclick: onPlug }, 'Plan with CCS only')) : null) : null;
    const parkFast = trip.to.park ? ctx.rec?.destinations?.find((d) => d.code === trip.to.park)?.nearestFastToPark ?? null : null;
    const home = stuck == null ? homeText(trip, parkFast) : null;

    let current = stuck == null ? 0 : -1;
    const rows = legs.map((leg, i) => {
      const s = leg.s;
      // Read first: where the stop is on the route and what's left. Then the address. The plug,
      // hours, and price sit together behind one disclosure.
      const detail = el('div', { class: 'trip-leg-detail', hidden: true },
        s ? el('p', { class: 'leg-key', text: `Road mile ${num.format(s.atMile)}${s.detourMiles >= 0.5 ? `, about ${s.detourMiles} mi off the route` : ', on the route'}.` }) : null,
        el('p', { class: 'leg-key', text: spareText(s ? trip.legMiles - s.legMiles : trip.arriveWithMiles, trip.legMiles) }),
        !s && home ? el('p', { class: 'leg-key trip-home' }, el('strong', { text: 'Getting home: ' }), home) : null,
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
          el('p', { class: 'station-meta' }, s && nacsOnly(s) ? el('span', { class: 'plug-chip', text: 'NACS only' }) : null, s ? glance(s) : trip.to.detail || 'Your destination'),
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

    // When the trip doesn't work, the partial list is folded away under the explanation and fixes.
    const legsBlock = stuck == null
      ? [list, stepper, live]
      : [legs.length ? el('details', { class: 'trip-help trip-partial' }, el('summary', { text: `See how far it gets (${plural(legs.length, 'stop')})` }), list) : null];
    box.replaceChildren(...[heading, answer, totals, costNote,
      gap ? gapView(trip, gap) : null, plugCheck,
      ...legsBlock,
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
    const plugSelect = el('select', { id: plugId, onchange: (e) => { ui.plug = Object.hasOwn(PLUGS, e.target.value) ? e.target.value : 'any'; } },
      Object.entries(PLUGS).map(([k, pl]) => el('option', { value: k, text: pl.label })));
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
        plugSelect),
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
    // The last route and its chargers, so replanning the same trip (a fix, new miles, another
    // plug) needs no new routing call.
    let cache = null;
    let busy = false;
    async function onPlan(fix = null) {
      if (busy) return;
      if (!ui.to) { status.className = 'tool-status'; status.textContent = 'Choose where you’re going first.'; toList.querySelector('input')?.focus(); return; }
      busy = true;
      const planBtn = box.querySelector('.trip-plan-btn');
      if (planBtn) planBtn.disabled = true;
      try { await planTrip(fix); } finally { busy = false; if (planBtn) planBtn.disabled = false; }
    }

    async function planTrip(fix) {
      status.className = 'tool-status';
      status.textContent = 'Finding the route and fast chargers along it…';
      result.replaceChildren();
      const key = `${ui.from.lat},${ui.from.lon}|${ui.to.lat},${ui.to.lon}`;
      let route;
      let stations;
      if (cache?.key === key) ({ route, stations } = cache);
      else try {
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
      if (!stations) {
        try { stations = await fastStationsAlong(route.points); } catch { status.textContent = 'We couldn’t load charger data. Please try again.'; return; }
        cache = { key, route, stations };
      }
      const plan = planStops({ route, stations, legMiles: ui.legMiles, plug: ui.plug });
      lastTrip = {
        id: tripId(), step: stepId,
        from: { name: ui.from.name, lat: ui.from.lat, lon: ui.from.lon },
        to: { name: ui.to.name, detail: ui.to.where ?? ui.to.detail ?? '', lat: ui.to.lat, lon: ui.to.lon, park: ui.to.park || null },
        miles: route.miles, minutes: route.minutes, legMiles: ui.legMiles, plug: ui.plug,
        kwh100: Number.isFinite(ui.basis?.kwh100) ? ui.basis.kwh100 : null,
        finalLegMiles: plan.finalLegMiles || 0, arriveWithMiles: plan.arriveWithMiles || 0,
        returnMiles: plan.ok ? plan.returnMiles : null, returnTo: plan.ok ? plan.returnTo : null,
        stops: plan.stops.map((s) => ({
          id: s.id, name: s.name, street: s.street, city: s.city, lat: s.lat, lon: s.lon, level2: s.level2, fast: s.fast,
          network: s.network, connectors: s.connectors, hours: s.hours, price: s.price, atMile: s.atMile, legMiles: s.legMiles, detourMiles: s.detourMiles,
        })),
      };
      ctx.track('trip_planned', { stops: stopsBucket(plan.stops.length), dest: ui.to.park ? 'park' : 'place', result: plan.ok ? 'ok' : plan.reason, ...(fix ? { fix } : {}) });
      status.textContent = plan.ok
        ? `${num.format(Math.round(route.miles))} miles, about ${durationText(route.minutes)} of driving. ${stopsText(plan.stops.length)}.`
        : 'This trip doesn’t work yet with these settings.';
      const gap = plan.ok ? null : { plan, fixes: suggestFixes({ route, stations, legMiles: ui.legMiles, plug: ui.plug }), onFix };
      const heading = renderTrip(result, lastTrip, { gap, onSaveToggle: plan.ok ? toggleSave : null, onPlug: () => onFix('plug', 'ccs') });
      // The trip itself now shows what the status said; keep the line for screen readers only.
      status.className = 'tool-status sr-only';
      heading.focus();
    }

    // A one-tap fix sets the field the visitor would have changed, then plans again.
    function onFix(kind, value) {
      if (kind === 'miles') { ui.legMiles = value; legInput.value = value; }
      else { ui.plug = Object.hasOwn(PLUGS, value) ? value : 'any'; plugSelect.value = ui.plug; }
      onPlan(kind);
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
      el('div', { class: 'tool-row' }, el('button', { type: 'button', class: 'btn btn-go btn-small trip-plan-btn', onclick: () => onPlan() }, 'Plan the trip')),
      el('p', { class: 'tool-note', text: 'The start and end points go to our routing service to find the road, and are not stored.' }),
      status, result, savedBox);
    drawSaved();
  }

  return { render };
}
