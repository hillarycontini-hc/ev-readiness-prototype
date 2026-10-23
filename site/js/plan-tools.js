// Interactive tools inside the EV plan: chargers near the places in your week (steps 2 and 3),
// a car explorer with price, loan, and lease estimates (step 4), a trip planner with
// fast-charging stops (steps 5 and 6, in trip-tool.js), and test-drive links (step 7). Rendering uses textContent only.

import { SORTS, availableSorts, cargoText, compareBy, hasIihs, iihsText, recentAwards, safetyText } from './car-sort.js';
import { el, externalLink, num, srOnly, usd } from './dom.js';
import { SearchUnavailable, chargersNear, connectorNames, searchPlaces, zipCenter } from './places.js';
import { leasePayment, loanPayment, moneyFactorToApr } from './finance.js';
import { createTripTool } from './trip-tool.js';
import { displayName } from './names.js';

const SLOT_LABEL = {
  home: { title: 'Home', search: 'Your home address' },
  work: { title: 'Work', search: 'Your work address or workplace name' },
  lunch: { title: 'A lunch spot near work', search: 'A restaurant or address near work' },
  gym: { title: 'The gym', search: 'Your gym or its address' },
  other: { title: 'Another place', search: 'An address or place name' },
};

const TOOLS = {
  'plan-work': { kind: 'places', slots: ['work', 'lunch'], label: 'Find chargers near work' },
  'plan-public': { kind: 'places', slots: ['home', 'gym'], label: 'Find chargers near home and the gym' },
  'plan-range': { kind: 'cars', label: 'Compare cars that fit' },
  'plan-range-any': { kind: 'cars', label: 'Compare cars that fit' },
  'plan-park': { kind: 'trip', label: 'Plan the trip' },
  'plan-route': { kind: 'trip', label: 'Plan a trip' },
  'plan-test-drive': { kind: 'testdrive', label: 'Book a test drive' },
};

let vehicleData = null;
async function loadVehicles() {
  vehicleData ??= fetch('data/vehicles.json', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e) => { vehicleData = null; throw e; });
  return vehicleData;
}

const uid = (slot) => `${slot}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * ctx: {
 *   plan(): the current plan object,
 *   update(fn): mutate the plan, then save it to this device,
 *   track(event, props), rec: the recommendation, zip, zipRec,
 *   parks: the static park list, meta: data dates and the fleet summary
 * }
 */
export function createPlanTools(ctx) {
  // ---------- places and chargers ----------

  function placeFor(slot) { return ctx.plan().places.find((p) => p.slot === slot) || null; }

  function setPlace(slot, place, method) {
    ctx.update((plan) => {
      const old = plan.places.find((p) => p.slot === slot);
      if (old) { delete plan.saved[old.id]; plan.places = plan.places.filter((p) => p !== old); }
      plan.places.push({ id: uid(slot), slot, name: place.name, detail: place.detail, lat: place.lat, lon: place.lon });
    });
    ctx.track('place_set', { slot, method });
  }

  function clearPlace(slot) {
    ctx.update((plan) => {
      const old = plan.places.find((p) => p.slot === slot);
      if (old) { delete plan.saved[old.id]; plan.places = plan.places.filter((p) => p !== old); }
    });
  }

  function isSaved(place, station) { return (ctx.plan().saved[place.id] || []).some((s) => s.id === station.id); }

  function toggleSaved(place, station) {
    let nowSaved = false;
    ctx.update((plan) => {
      const list = plan.saved[place.id] || [];
      const i = list.findIndex((s) => s.id === station.id);
      if (i >= 0) list.splice(i, 1);
      else if (list.length < 10) { list.push(station); nowSaved = true; }
      if (list.length) plan.saved[place.id] = list; else delete plan.saved[place.id];
    });
    if (nowSaved) ctx.track('charger_saved', { slot: place.slot, count: (ctx.plan().saved[place.id] || []).length });
  }

  // The route's white-ringed station, filled with the stop color once saved.
  const savedMark = () => el('span', { class: 'saved-mark', 'aria-hidden': 'true' });
  const milesText = (miles) => (miles < 0.1 ? '<0.1' : String(miles));

  function stationItem(place, s, rerender) {
    const ports = [s.level2 ? `${s.level2} Level 2` : null, s.fast ? `${s.fast} fast` : null].filter(Boolean).join(' · ');
    const saved = isSaved(place, s);
    const plugs = connectorNames(s.connectors).join(', ');
    return el('li', { class: `station-item${saved ? ' is-saved' : ''}` },
      el('div', { class: 'station-main' },
        el('p', { class: 'station-name' }, savedMark(), el('span', { text: displayName(s.name) })),
        el('p', { class: 'station-meta', text: [[s.street, s.city].filter(Boolean).join(', '), s.hours, s.price].filter(Boolean).join(' · ') }),
        el('p', { class: 'station-meta', text: [ports, plugs, s.network].filter(Boolean).join(' · ') })),
      el('p', { class: 'row-figure' }, milesText(s.miles), el('span', { class: 'car-unit', text: ' mi' })),
      el('button', {
        type: 'button', class: 'btn-save', 'aria-pressed': String(saved),
        onclick: () => { toggleSaved(place, s); rerender(); },
      }, saved ? 'Saved' : 'Save', srOnly(`: ${displayName(s.name)}`)));
  }

  function renderChargers(box, place) {
    const state = { radius: place.slot === 'home' ? 5 : 2, fastOnly: false };
    const status = el('p', { class: 'tool-status', role: 'status' });
    const list = el('ol', { class: 'station-list' });
    const more = el('button', { type: 'button', class: 'btn-link', hidden: true });
    const radiusId = `radius-${place.id}`;
    const fastId = `fast-${place.id}`;
    const controls = el('div', { class: 'tool-row' },
      el('label', { for: radiusId, text: 'Within' }),
      el('select', { id: radiusId, onchange: (e) => { state.radius = Number(e.target.value); load(); } },
        [1, 2, 5, 10].map((m) => el('option', { value: m, selected: m === state.radius, text: `${m} mile${m > 1 ? 's' : ''}` }))),
      el('label', { class: 'check', for: fastId },
        el('input', { type: 'checkbox', id: fastId, onchange: (e) => { state.fastOnly = e.target.checked; load(); } }), 'Fast chargers only'));
    async function load() {
      status.textContent = 'Finding chargers…';
      try {
        const found = await chargersNear(place.lat, place.lon, { radius: state.radius, fastOnly: state.fastOnly });
        const saved = (ctx.plan().saved[place.id] || []).filter((s) => !found.some((f) => f.id === s.id));
        const all = [...found, ...saved];
        let shown = Math.max(6, saved.length);
        const rerender = () => {
          list.replaceChildren(...all.slice(0, shown).map((s) => stationItem(place, s, rerender)));
          more.hidden = shown >= all.length;
          more.textContent = `Show ${all.length - shown} more`;
        };
        more.onclick = () => { const first = shown; shown = all.length; rerender(); list.querySelectorAll('.btn-save')[first]?.focus(); };
        rerender();
        status.textContent = found.length
          ? `${found.length} public charger${found.length > 1 ? 's' : ''} within ${state.radius} mile${state.radius > 1 ? 's' : ''}, nearest first.`
          : `No public ${state.fastOnly ? 'fast ' : ''}chargers within ${state.radius} mile${state.radius > 1 ? 's' : ''}. Try a wider distance.`;
      } catch {
        status.textContent = 'We couldn’t load charger data. Please try again.';
      }
    }
    box.append(controls, status, list, more);
    load();
  }

  function renderSlot(slot) {
    const labels = SLOT_LABEL[slot];
    const section = el('section', { class: 'place-slot', 'aria-label': labels.title });
    const draw = () => {
      const place = placeFor(slot);
      section.replaceChildren(el('h4', { class: 'slot-title', text: labels.title }));
      if (place) {
        section.append(
          el('div', { class: 'place-chosen' },
            el('p', {}, el('strong', { text: place.name }), place.detail ? el('span', { class: 'station-meta', text: ` ${place.detail}` }) : null),
            el('button', { type: 'button', class: 'btn-link', onclick: () => { clearPlace(slot); draw(); } }, 'Change', srOnly(` ${labels.title.toLowerCase()}`))));
        renderChargers(section, place);
        return;
      }
      section.append(searchForm(slot, labels, (p, method) => { setPlace(slot, p, method); draw(); }));
    };
    draw();
    return section;
  }

  function searchForm(slot, labels, onPick) {
    const inputId = `search-${slot}`;
    const zipId = `zip-${slot}`;
    const status = el('p', { class: 'tool-status', role: 'status' });
    const results = el('ul', { class: 'search-results' });
    const zipBox = el('form', { class: 'tool-row', hidden: true, novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const c = await zipCenter(e.target.elements[zipId].value);
      if (c) onPick(c, 'zip'); else status.textContent = 'Enter a 5-digit ZIP code we have data for.';
    } },
    el('label', { for: zipId, text: 'ZIP code' }),
    el('input', { id: zipId, name: zipId, type: 'text', inputmode: 'numeric', maxlength: '5', pattern: '[0-9]{5}', autocomplete: 'off' }),
    el('button', { type: 'submit', class: 'btn btn-quiet btn-small' }, 'Use this ZIP'));

    const near = slot === 'lunch' ? placeFor('work') : null;
    const homeZipCenter = slot === 'home' && ctx.zipRec?.la ? { name: `Center of ZIP ${ctx.zip}`, detail: ctx.zipRec.s, lat: ctx.zipRec.la, lon: ctx.zipRec.lo } : null;
    const form = el('form', { class: 'tool-row', role: 'search', 'aria-label': `Search: ${labels.title}`, novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const q = e.target.elements[inputId].value.trim();
      if (q.length < 3) { status.textContent = 'Type at least 3 characters.'; return; }
      status.textContent = 'Searching…';
      results.replaceChildren();
      try {
        const found = await searchPlaces(q, near || (ctx.zipRec?.la ? { lat: ctx.zipRec.la, lon: ctx.zipRec.lo } : null));
        if (!found.length) { status.textContent = 'No matches. Try a fuller address, or use a ZIP code.'; return; }
        status.textContent = `${found.length} match${found.length > 1 ? 'es' : ''}. Choose one.`;
        results.replaceChildren(...found.map((p) => el('li', {},
          el('button', { type: 'button', class: 'result-btn', onclick: () => onPick(p, 'search') },
            el('strong', { text: p.name || p.detail }), p.name ? el('span', { text: p.detail }) : null))));
      } catch (err) {
        status.textContent = err instanceof SearchUnavailable && err.code === 'rate_limited'
          ? 'Too many searches at once. Wait a minute, or use a ZIP code.'
          : 'Address search isn’t available right now. Use a ZIP code instead.';
        zipBox.hidden = false;
      }
    } },
    el('label', { for: inputId, text: labels.search }),
    el('input', { id: inputId, name: inputId, type: 'search', autocomplete: 'off', maxlength: '120' }),
    el('button', { type: 'submit', class: 'btn btn-quiet btn-small' }, 'Search'));

    return el('div', { class: 'place-search' },
      homeZipCenter ? el('p', {}, el('button', { type: 'button', class: 'btn-link', onclick: () => onPick(homeZipCenter, 'zip') }, `Use the center of ZIP ${ctx.zip}`)) : null,
      form,
      el('p', { class: 'tool-note' },
        'Your search goes to our address service and is not stored. ',
        el('button', { type: 'button', class: 'btn-link', onclick: () => { zipBox.hidden = !zipBox.hidden; } }, 'Use a ZIP code instead')),
      zipBox, status, results);
  }

  function renderPlaces(box, slots) {
    box.append(...slots.map(renderSlot));
  }

  // ---------- cars ----------

  const CLASS_LABEL = { suv: 'SUV', minivan: 'Minivan', pickup: 'Pickup' };
  // The one number shown for a car, here and in the partner summary.
  const figureFor = (v, f) => { const m = monthlyFor(v, f); return m == null ? usd(v.msrp) : `~${usd(m)}`; };
  const rangeText = (v) => (v.rangeMin === v.rangeMax ? `${v.rangeMax} mi` : `${v.rangeMin}–${v.rangeMax} mi`);

  function monthlyFor(v, f) {
    const price = v.msrp + (v.destination || 0);
    if (f.mode === 'lease') return leasePayment({ msrp: v.msrp, price, dueAtSigning: f.dueAtSigning, residualPct: f.residualPct, moneyFactor: f.moneyFactor, months: f.leaseMonths });
    if (f.mode === 'loan') return loanPayment({ price, down: f.down, aprPct: f.aprPct, months: f.months });
    return null;
  }

  // NHTSA's public ratings search. Each car's exact API record stays in data/nhtsa-ratings.json for
  // the audit trail; a visitor gets the readable page instead of raw JSON.
  const NHTSA_RATINGS_PAGE = 'https://www.nhtsa.gov/ratings';
  // "· source" kept on one line, so a separator never starts or ends a wrapped line.
  const sourceLink = (text, url) => el('span', { class: 'nowrap' }, '· ', externalLink(text, url));
  const SORT_PHRASE = {
    range: 'longest range first',
    seats: 'most seats first',
    cargo: 'most cargo space first; cars without a published figure last',
    safety: 'highest NHTSA rating first; cars NHTSA hasn’t rated yet follow in budget order',
    awards: 'most awards first; cars without one follow in budget order',
  };

  function carRow(v, f, rerender, data) {
    const shortlisted = ctx.plan().shortlist.includes(v.id);
    const full = ctx.plan().shortlist.length >= 3 && !shortlisted;
    const monthly = monthlyFor(v, f);
    return el('li', { class: `car-item${shortlisted ? ' is-saved' : ''}` },
      el('div', { class: 'car-main' },
        el('p', { class: 'car-name' }, savedMark(), el('span', { text: `${v.make} ${v.model}` })),
        el('p', { class: 'station-meta', text: [`${v.modelYear}`, CLASS_LABEL[v.class] || v.class, `${v.seats} seats`, v.thirdRow ? 'third row available' : null, cargoText(v), `${rangeText(v)} EPA range`, v.kwh100 ? `${v.kwh100} kWh/100 mi` : null].filter(Boolean).join(' · ') }),
        el('p', { class: 'station-meta' },
          `From ${usd(v.msrp)} + ${v.destination ? `${usd(v.destination)} destination` : 'destination not published'} · checked ${data.checkedAtLabel} `,
          sourceLink('price source', v.priceSource)),
        el('p', { class: 'station-meta' },
          `${safetyText(v)} `, sourceLink('rating source', NHTSA_RATINGS_PAGE),
          iihsText(v) ? ` · ${iihsText(v)} ` : null, iihsText(v) ? sourceLink('rating source', v.iihs.source) : null),
        recentAwards(v).length ? el('ul', { class: 'car-awards', 'aria-label': `Awards for the ${v.make} ${v.model}` },
          recentAwards(v).map((w) => el('li', {}, externalLink(`${w.name} ${w.year}`, w.url), ` (${w.publisher})`))) : null),
      el('p', { class: 'row-figure' }, figureFor(v, f), el('span', { class: 'car-unit', text: monthly == null ? ' starting' : ' /mo est.' })),
      el('button', {
        type: 'button', class: 'btn-save', 'aria-pressed': String(shortlisted), disabled: full,
        onclick: () => {
          ctx.update((plan) => {
            if (plan.shortlist.includes(v.id)) plan.shortlist = plan.shortlist.filter((id) => id !== v.id);
            else if (plan.shortlist.length < 3) plan.shortlist.push(v.id);
          });
          if (!shortlisted) ctx.track('car_shortlisted', { class: v.class, make: v.make, count: ctx.plan().shortlist.length });
          rerender();
        },
      }, shortlisted ? 'Shortlisted' : full ? 'Shortlist full' : 'Shortlist', srOnly(`: ${v.make} ${v.model}`)));
  }

  async function renderCars(box) {
    const status = el('p', { class: 'tool-status', role: 'status', text: 'Loading cars…' });
    box.append(status);
    let data;
    try { data = await loadVehicles(); } catch { status.textContent = 'We couldn’t load the car list. Please try again.'; return; }
    data.checkedAtLabel = new Date(`${data.checkedAt}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const need = ctx.rec.range.need;
    const ui = { klass: 'suv', coverNeed: true, sort: 'price', tspOnly: false };
    const sorts = availableSorts(data.vehicles);
    const priceOption = el('option', { value: 'price', selected: true, text: 'Lowest price' });
    const UNRATED_NOTE = '“Not yet rated” means NHTSA hasn’t crash-tested that model year, not that it’s unsafe.';
    const nhtsaDate = data.nhtsaCheckedAt ? new Date(`${data.nhtsaCheckedAt}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;
    const f = () => ctx.plan().finance;
    const setF = (k, v) => { ctx.update((plan) => { plan.finance[k] = v; }); };

    const list = el('ol', { class: 'car-list' });
    const count = el('p', { class: 'tool-status', role: 'status' });
    const note = el('p', { class: 'tool-note' });
    const modeFields = el('div', { class: 'finance-fields' });
    const a = data.assumptions;

    const numField = (key, label, { min, max, step, prefix, suffix }) => {
      const id = `fin-${key}`;
      return el('div', { class: 'field' },
        el('label', { for: id, text: label }),
        el('span', { class: 'input-affix' },
          prefix ? el('span', { 'aria-hidden': 'true', text: prefix }) : null,
          el('input', { id, type: 'number', inputmode: 'decimal', min, max, step, value: f()[key], onchange: (e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= min && n <= max) { setF(key, n); draw(); } else e.target.value = f()[key];
          } }),
          suffix ? el('span', { 'aria-hidden': 'true', text: suffix }) : null));
    };
    const selField = (key, label, options) => {
      const id = `fin-${key}`;
      return el('div', { class: 'field' }, el('label', { for: id, text: label }),
        el('select', { id, onchange: (e) => { setF(key, Number(e.target.value)); draw(); } },
          options.map((m) => el('option', { value: m, selected: f()[key] === m, text: `${m} months` }))));
    };

    function drawModeFields() {
      const m = f().mode;
      if (m === 'price') modeFields.replaceChildren(numField('maxPrice', 'Highest starting price', { min: 10000, max: 300000, step: 1000, prefix: '$' }));
      else if (m === 'loan') {
        modeFields.replaceChildren(
          numField('maxMonthly', 'Highest monthly payment', { min: 100, max: 5000, step: 25, prefix: '$' }),
          numField('down', 'Down payment', { min: 0, max: 200000, step: 500, prefix: '$' }),
          numField('aprPct', 'Loan rate (APR)', { min: 0, max: 30, step: 0.05, suffix: '%' }),
          selField('months', 'Loan length', [36, 48, 60, 72, 84]),
          el('p', { class: 'tool-note field-wide', text: `The rate starts at the average new-car loan APR, ${a.loanAprPct}% (Experian, ${a.loanAprPeriod}). Use the rate you’re offered.` }));
      } else {
        modeFields.replaceChildren(
          numField('maxMonthly', 'Highest monthly payment', { min: 100, max: 5000, step: 25, prefix: '$' }),
          numField('dueAtSigning', 'Due at signing', { min: 0, max: 50000, step: 250, prefix: '$' }),
          selField('leaseMonths', 'Lease length', [24, 36, 39, 48]),
          numField('residualPct', 'Residual value', { min: 20, max: 80, step: 1, suffix: '%' }),
          numField('moneyFactor', `Money factor (about ${moneyFactorToApr(f().moneyFactor).toFixed(1)}% APR)`, { min: 0, max: 0.01, step: 0.0001 }),
          el('p', { class: 'tool-note field-wide', text: `Residual (${a.leaseResidualPct}%) and money factor (${a.leaseMoneyFactor}) start at typical values, not published averages. Ask the dealer for the real ones.` }));
      }
    }

    function draw() {
      const fin = f();
      drawModeFields();
      if (ui.klass === 'minivan') {
        list.replaceChildren();
        count.textContent = '';
        note.textContent = data.minivans?.note || 'No fully electric minivans are on sale in the U.S. right now. Three-row SUVs are the closest fit.';
        return;
      }
      const matches = data.vehicles
        .filter((v) => v.class === ui.klass)
        .filter((v) => !fin.thirdRow || v.thirdRow)
        .filter((v) => !ui.coverNeed || v.rangeMax >= need)
        .filter((v) => !ui.tspOnly || v.iihs)
        .filter((v) => {
          if (fin.mode === 'price') return v.msrp <= fin.maxPrice;
          return monthlyFor(v, fin) <= fin.maxMonthly;
        })
        .sort(compareBy(ui.sort, (a, b) => (fin.mode === 'price' ? a.msrp - b.msrp : monthlyFor(a, fin) - monthlyFor(b, fin))));
      const rerender = () => draw();
      list.replaceChildren(...matches.map((v) => carRow(v, fin, rerender, data)));
      count.textContent = matches.length
        ? `${matches.length} ${ui.klass === 'pickup' ? 'pickup' : 'SUV'}${matches.length > 1 ? 's' : ''} match, ${ui.sort === 'price' ? (fin.mode === 'price' ? 'lowest price first' : 'lowest monthly estimate first') : SORT_PHRASE[ui.sort]}.`
        : 'Nothing matches yet. Try a higher budget or fewer filters.';
      priceOption.textContent = fin.mode === 'price' ? 'Lowest price' : 'Lowest monthly estimate';
      note.textContent = ui.sort === 'safety' && data.nhtsaCheckedAt ? `${UNRATED_NOTE} ` : '';
      note.textContent += fin.mode === 'lease'
        ? 'Lease estimates are rough: real offers change monthly and depend on credit, incentives, and negotiation. Taxes and fees are not included.'
        : fin.mode === 'loan'
          ? 'Loan estimates use the starting price plus destination, before taxes, fees, incentives, and negotiation.'
          : 'Starting price of the least expensive trim you can order today, before destination, taxes, and fees.';
    }

    const radio = (name, value, label, checked, onChange) => {
      const id = `${name}-${value}`;
      return el('label', { class: 'seg-option', for: id },
        el('input', { type: 'radio', id, name, value, checked, onchange: onChange }), el('span', { text: label }));
    };
    const controls = el('div', { class: 'car-controls' },
      el('fieldset', { class: 'seg' }, el('legend', { text: 'Body style' }),
        radio('car-class', 'suv', 'SUVs', true, () => { ui.klass = 'suv'; draw(); }),
        radio('car-class', 'minivan', 'Minivans', false, () => { ui.klass = 'minivan'; draw(); }),
        radio('car-class', 'pickup', 'Pickups', false, () => { ui.klass = 'pickup'; draw(); })),
      el('fieldset', { class: 'seg' }, el('legend', { text: 'Budget by' }),
        radio('fin-mode', 'price', 'Price', f().mode === 'price', () => { setF('mode', 'price'); ctx.track('finance_mode', { mode: 'price' }); draw(); }),
        radio('fin-mode', 'loan', 'Monthly loan', f().mode === 'loan', () => { setF('mode', 'loan'); ctx.track('finance_mode', { mode: 'loan' }); draw(); }),
        radio('fin-mode', 'lease', 'Monthly lease', f().mode === 'lease', () => { setF('mode', 'lease'); ctx.track('finance_mode', { mode: 'lease' }); draw(); })),
      modeFields,
      el('div', { class: 'tool-row' },
        el('label', { class: 'check', for: 'car-third-row' },
          el('input', { type: 'checkbox', id: 'car-third-row', checked: f().thirdRow, onchange: (e) => { setF('thirdRow', e.target.checked); draw(); } }), 'Needs a third row'),
        el('label', { class: 'check', for: 'car-cover-need' },
          el('input', { type: 'checkbox', id: 'car-cover-need', checked: true, onchange: (e) => { ui.coverNeed = e.target.checked; draw(); } }), `Covers my ${num.format(need)} miles between charges`),
        hasIihs(data.vehicles) ? el('label', { class: 'check', for: 'car-tsp' },
          el('input', { type: 'checkbox', id: 'car-tsp', onchange: (e) => { ui.tspOnly = e.target.checked; draw(); } }), 'IIHS Top Safety Pick or Pick+ only') : null),
      // Budget, then filters, then order, then the result count that echoes the order.
      el('div', { class: 'field sort-field' },
        el('label', { for: 'car-sort', text: 'Sort by' }),
        el('select', { id: 'car-sort', onchange: (e) => { ui.sort = e.target.value; ctx.track('car_sorted', { mode: ui.sort }); draw(); } },
          sorts.map((k) => (k === 'price' ? priceOption : el('option', { value: k, text: SORTS[k] }))))));
    status.remove();
    box.append(controls, count, note, list,
      el('p', { class: 'tool-note', text: `Fully electric models only, listed neutrally: sorted by your budget unless you choose another order, with ties broken by price. Prices checked ${data.checkedAtLabel}; they change, so confirm with the brand before you buy.` }),
      nhtsaDate ? el('p', { class: 'tool-note', text: `Safety ratings from NHTSA, checked ${nhtsaDate}. ${UNRATED_NOTE}` }) : null,
      data.researchReviewedAt ? el('p', { class: 'tool-note', text: `Cargo space, IIHS awards, and other awards: AI-assisted research, checked source by source by a person (${new Date(`${data.researchReviewedAt}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}).` }) : null);
    draw();
  }

  // ---------- test drives ----------

  async function renderTestDrive(box) {
    let data;
    try { data = await loadVehicles(); } catch { box.append(el('p', { class: 'tool-status', text: 'We couldn’t load the car list.' })); return; }
    const picks = ctx.plan().shortlist.map((id) => data.vehicles.find((v) => v.id === id)).filter(Boolean);
    if (!picks.length) {
      box.append(el('p', { class: 'tool-note', text: 'Shortlist up to three cars in the "Compare cars that fit" step, and booking links for each will appear here.' }));
      return;
    }
    const zip = /^\d{5}$/.test(ctx.zip || '') ? ctx.zip : null;
    const withZip = (template, plain) => (template && zip ? { url: template.replace('{zip}', zip), zip: true } : plain ? { url: plain, zip: false } : null);
    const linkFor = (text, target, make) => externalLink(target.zip ? `${text} near ${zip}` : text, target.url, () => ctx.track('test_drive_clicked', { make }));
    box.append(el('ul', { class: 'drive-list' }, picks.map((v) => {
      const brand = data.brands[v.make] || {};
      const direct = brand.salesModel === 'direct';
      const book = withZip(brand.bookZipUrl, brand.bookUrl);
      const dealer = direct ? null : withZip(brand.dealerZipUrl, brand.dealerUrl);
      const links = [
        book && linkFor(direct ? `Book a ${v.make} demo drive` : `Request a ${v.make} test drive`, book, v.make),
        dealer && linkFor(`Find a ${v.make} dealer`, dealer, v.make),
      ].filter(Boolean);
      return el('li', {},
        el('p', { class: 'car-name', text: `${v.make} ${v.model}` }),
        el('p', { class: 'station-meta', text: direct
          ? `${v.make} sells direct; demo drives are booked on its site.`
          : book ? `Request a drive on ${v.make}’s site, or find a dealer to call.` : `Find a dealer, then call or book on their site to set up a drive.` }),
        links.length ? el('div', { class: 'drive-links' }, links) : el('p', { class: 'station-meta', text: 'No official link on file yet.' }));
    })), el('p', { class: 'tool-note', text: zip
      ? `Links open each brand’s own site. A link that says “near ${zip}” passes that ZIP to the brand so it can show nearby dealers; nothing else is sent.`
      : 'Links open each brand’s own site. We don’t send anything to brands or dealers.' }));
  }

  // ---------- trips ----------

  let trips = null;
  const tripTool = () => (trips ??= createTripTool({ ctx, searchForm, loadVehicles }));

  // ---------- public API ----------

  return {
    rangeText,
    figureFor,
    milesText,
    toolFor(stepId) { return TOOLS[stepId] || null; },
    async renderTool(stepId, box, value) {
      const t = TOOLS[stepId];
      if (!t) return;
      ctx.track('plan_tool_opened', { tool: t.kind });
      if (t.kind === 'places') renderPlaces(box, t.slots);
      else if (t.kind === 'cars') await renderCars(box);
      else if (t.kind === 'testdrive') await renderTestDrive(box);
      else if (t.kind === 'trip') await tripTool().render(box, stepId, value);
    },
    loadVehicles,
    monthlyFor,
  };
}
