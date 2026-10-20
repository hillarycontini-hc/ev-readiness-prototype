// UI controller: one question per screen, then the results route.
// Rendering uses createElement + textContent only. Nothing typed by the visitor
// is ever inserted as HTML, and the ZIP is validated before it is used in a path.

import { ASSUMPTIONS, FLEET_KEY, QUESTIONS, TIERS, normalizeZip, planFor, questionsFor, recommend } from './logic.js';
import {
  ASSUMED_COPY, CHARGING_AT_PARK, FOCUS_COPY, HOME_STOP, LEARN_MORE, PLAN_CATEGORY, PLAN_CTA, PLAN_STEPS,
  QUESTION_COPY, REASON_COPY, TIER_COPY, TONE_COPY, VARIANTS,
} from './copy.js';
import * as analytics from './analytics.js';
import { chevron, el, externalLink as linkTo, num, srOnly, usd, usd10 as money } from './dom.js';
import { createPlanTools } from './plan-tools.js';
import { clearSaved, decodeShare, emptyPlan, encodeShare, loadSaved, savePlan, sharePayload } from './plan-store.js';
import { durationText } from './trip.js';
import { chargeTimeShort, homeText, stopFacts, stopsText, tripCostFor } from './trip-tool.js';

const $ = (id) => document.getElementById(id);
// Questions that apply to this visitor (work charging only when home charging is uncertain).
const applicable = () => questionsFor(state.answers);
const answeredCount = () => applicable().filter((k) => state.answers[k]).length;

const state = {
  zip: null,
  zipRec: null,
  answers: {},
  step: 0,
  queue: [], // questions in this pass; recomputed as answers change
  refineSet: null, // when refining: only the questions skipped the first time
  nextStepSent: false, // north star: one next_step_taken per visit
  lastRec: null,
  plan: null, // the visitor's EV plan (saved on this device once they act)
  meta: null,
  parks: null,
  variant: 'control',
};

// Outbound "learn more" links: https only, new tab, counted as a next step.
function externalLink(text, url, linkId, extra = {}) {
  return linkTo(text, url, () => {
    analytics.track('learn_more_clicked', { link_id: linkId, ...extra });
    markNextStep('learn_more');
  });
}

// ---------- views ----------

function show(viewId, focusId) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== viewId;
  const ctx = $('topbar-context');
  ctx.hidden = !state.zipRec || viewId === 'view-landing';
  if (state.zipRec) ctx.textContent = `ZIP ${state.zip} · ${state.zipRec.s}`;
  window.scrollTo(0, 0);
  if (focusId) $(focusId).focus();
}

// ---------- data ----------

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let staticData;
function loadStatic() {
  staticData ??= Promise.all([fetchJson('data/meta.json'), fetchJson('data/parks.json')]).then(([meta, parks]) => {
    if (!meta || !parks) throw new Error('static data missing');
    state.meta = meta;
    state.parks = parks;
  }).catch((err) => { staticData = null; throw err; });
  return staticData;
}

// ---------- landing ----------

function applyVariant() {
  const copy = VARIANTS[state.variant];
  for (const node of document.querySelectorAll('[data-variant-text]')) {
    node.textContent = copy[node.dataset.variantText];
  }
}

function setZipError(message) {
  const input = $('zip');
  const err = $('zip-error');
  if (message) {
    err.textContent = message;
    err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  } else {
    err.textContent = '';
    err.hidden = true;
    input.removeAttribute('aria-invalid');
  }
}

async function loadZip(zip) {
  const [, shard] = await Promise.all([loadStatic(), fetchJson(`data/zip/${zip.slice(0, 3)}.json`)]);
  return shard && Object.hasOwn(shard, zip) ? shard[zip] : null;
}

/** Open a plan (from this device or a share link): its ZIP, its answers, its results, and the plan itself. */
async function openPlan(saved, { shared }) {
  show('view-loading');
  try {
    const rec = await loadZip(saved.zip);
    if (!rec) { show('view-landing', 'zip'); return; }
    state.zip = saved.zip;
    state.zipRec = rec;
    state.answers = { ...saved.answers };
    state.refineSet = null;
    state.plan = saved;
    renderResults();
    if (shared) {
      $('shared-banner').textContent = loadSaved()
        ? 'You’re viewing a shared EV plan. If you change anything, it replaces the plan saved on this device.'
        : 'You’re viewing a shared EV plan. Anything you change is saved on this device only.';
    }
    $('shared-banner').hidden = !shared;
    onPlanCta({ resumed: true });
  } catch {
    show('view-error', 'error-title');
  }
}

async function onZipSubmit(event) {
  event.preventDefault();
  const zip = normalizeZip($('zip').value);
  if (!zip) {
    analytics.track('zip_error', { reason: 'format' });
    setZipError('Enter a 5-digit ZIP code, like 80302.');
    return;
  }
  setZipError(null);
  show('view-loading');
  try {
    const rec = await loadZip(zip);
    if (!rec) {
      analytics.track('zip_error', { reason: 'not_found' });
      show('view-landing');
      setZipError('We don’t have data for that ZIP. It may be a PO box or business-only ZIP. Try the ZIP where you live.');
      return;
    }
    state.zip = zip;
    state.zipRec = rec;
    state.answers = {};
    state.refineSet = null;
    state.plan = null;
    analytics.track('zip_submitted', { state: rec.s });
    renderQuestion(0);
  } catch {
    analytics.track('data_load_error', { stage: 'zip' });
    show('view-error', 'error-title');
  }
}

// ---------- questions ----------

function currentQueue() {
  const q = applicable();
  return state.refineSet ? q.filter((k) => state.refineSet.has(k)) : q;
}

// Progress drawn as the route: one station per question, colored as it is passed.
const ROUTE_COLORS = ['var(--stop-charger)', 'var(--stop-range)', 'var(--stop-fuel)', 'var(--stop-parks)', 'var(--stop-charger)'];
function renderQuestionRoute(step, total) {
  const stations = Array.from({ length: total }, (_, i) => {
    const li = el('li', { class: [i < step ? 'done' : '', i === step ? 'current' : '', i === total - 1 ? 'end' : ''].join(' ').trim() });
    li.style.setProperty('--seg', ROUTE_COLORS[i % ROUTE_COLORS.length]);
    return li;
  });
  $('question-route').replaceChildren(...stations);
}

function renderQuestion(step) {
  state.queue = currentQueue();
  state.step = step;
  const key = state.queue[step];
  const copy = QUESTION_COPY[key];
  const total = state.queue.length;

  $('question-progress').textContent = `Question ${step + 1} of ${total}`;
  $('question-step-sr').textContent = `Question ${step + 1} of ${total}: `;
  renderQuestionRoute(step, total);
  $('question-text').textContent = copy.legend;
  $('question-hint').textContent = copy.hint;
  $('question-error').hidden = true;
  $('question-error').textContent = '';
  $('question-back').textContent = step === 0 && !state.refineSet ? 'Change ZIP' : 'Back';
  $('question-next').textContent = step === total - 1 ? 'See my results' : 'Next';
  $('question-skip-all').parentElement.hidden = step === total - 1;

  const options = $('question-options');
  options.replaceChildren(...QUESTIONS[key].options.map((opt) => {
    const id = `q-${key}-${opt.value}`;
    return el('label', { class: 'option', for: id },
      el('input', { type: 'radio', name: key, id, value: opt.value, checked: state.answers[key] === opt.value }),
      el('span', { text: copy.options[opt.value] }));
  }));

  show('view-question', 'question-legend');
  analytics.track('question_viewed', { question: key, step: step + 1 });
}

// Answers can add or remove a later question, so find our place by key, not index.
function nextQuestion(fromKey) {
  const queue = currentQueue();
  const next = queue.indexOf(fromKey) + 1;
  if (next > 0 && next < queue.length) renderQuestion(next);
  else finish();
}

function onQuestionSubmit(event) {
  event.preventDefault();
  const key = state.queue[state.step];
  const picked = document.querySelector(`input[name="${key}"]:checked`);
  if (!picked) {
    const err = $('question-error');
    err.textContent = 'Choose an answer, or skip this question.';
    err.hidden = false;
    document.querySelector(`input[name="${key}"]`).focus();
    return;
  }
  // Only accept values defined in logic.js, whatever the DOM says.
  if (!QUESTIONS[key].options.some((o) => o.value === picked.value)) return;
  state.answers[key] = picked.value;
  // An answer to a question that no longer applies is dropped.
  for (const k of Object.keys(state.answers)) if (!applicable().includes(k)) delete state.answers[k];
  analytics.track('question_answered', { question: key, answer: picked.value });
  nextQuestion(key);
}

function onSkip() {
  const key = state.queue[state.step];
  delete state.answers[key];
  analytics.track('question_skipped', { question: key });
  nextQuestion(key);
}

function onSkipAll() {
  analytics.track('questions_skipped_rest', { from_question: state.queue[state.step] });
  finish();
}

function onBack() {
  if (state.step > 0) renderQuestion(state.step - 1);
  else if (!state.refineSet) show('view-landing', 'zip');
  else renderResults();
}

function finish() {
  analytics.track('inputs_completed', {
    answered: answeredCount(),
    skipped: applicable().length - answeredCount(),
    state: state.zipRec.s,
  });
  renderResults();
}

// ---------- results: verdict ----------

const TIER_SHAPE = { strong: 's-strong', good: 's-good', maybe: 's-maybe', notyet: 's-notyet' };

function tierScale(currentId) {
  const ordered = [...TIERS].reverse(); // Not yet ... Strong fit, left to right
  return ordered.map((t) => el('li', { 'aria-current': t.id === currentId ? 'true' : null },
    el('span', { class: `shape ${TIER_SHAPE[t.id]}`, 'aria-hidden': 'true' }),
    t.label, t.id === currentId ? srOnly(' (your result)') : null));
}

/** The one line under the verdict: the answer or step that would change the result most. */
function focusLine(rec) {
  if (rec.blockers.length) return FOCUS_COPY[`blocker-${rec.blockers[0]}`];
  const inp = rec.inputs;
  if (inp.homeCharging === 'yes') return FOCUS_COPY.yes;
  if (inp.homeCharging === 'install' || inp.homeCharging === 'ask' || inp.homeCharging === 'unknown') return FOCUS_COPY[inp.homeCharging];
  return inp.workCharging === 'yes' ? FOCUS_COPY.work : FOCUS_COPY.public;
}

// ---------- results: the route ----------

const reasonOf = (rec, prefix) => rec.reasons.find((r) => r.id.startsWith(prefix));
const assumedAny = (rec, ...keys) => keys.some((k) => rec.inputs.assumed.includes(k));

function homeStop(rec) {
  const inp = rec.inputs;
  const z = state.zipRec;
  const r = reasonOf(rec, 'home-');
  let key = inp.homeCharging;
  if (key === 'no' && inp.workCharging === 'yes') key = 'no-work';
  const pct = Math.round(inp.homeChargeOdds * 100);
  const copy = HOME_STOP[key];
  const tone = inp.workCharging === 'yes' && r.tone === 'minus' ? 'check' : r.tone;
  const panel = [
    el('p', { text: REASON_COPY[r.id](r.value) }),
    inp.workCharging === 'yes' ? el('p', { text: REASON_COPY['work-yes']() }) : null,
    el('dl', {},
      el('dt', { text: 'Single-family homes in your ZIP' }), el('dd', { text: z.sf == null ? 'Not available' : `${z.sf}%` }),
      el('dt', { text: 'Owner-occupied homes in your ZIP' }), el('dd', { text: z.own == null ? 'Not available' : `${z.own}%` })),
    el('p', { class: 'src', text: 'Source: U.S. Census Bureau, American Community Survey 2024 5-year estimates.' }),
  ];
  return {
    key: 'home', label: `Home, ${state.zip}`, tone,
    figure: typeof copy.figure === 'function' ? copy.figure(pct) : copy.figure,
    detail: typeof copy.detail === 'function' ? copy.detail(pct) : copy.detail,
    assumed: assumedAny(rec, 'homeCharging', 'workCharging'), panel,
  };
}

function chargerStop(rec) {
  const c = rec.charging;
  const local = reasonOf(rec, 'local-');
  const trips = reasonOf(rec, 'trips-');
  const tone = trips && trips.tone === 'minus' ? 'minus' : local.tone;
  const nearest = c.nearestDc == null ? 'None within 100 miles' : `${c.nearestDc} miles (straight line)`;
  return {
    key: 'charger', label: 'Nearest fast charger', tone,
    figure: c.nearestDc == null ? 'None' : `${c.nearestDc} mi`,
    detail: `${c.dcWithin10 ? `${num.format(c.dcWithin10)} fast-charging stations` : 'No fast-charging stations'} within 10 mi · ${c.dcPercentile >= 10 ? `more than ${c.dcPercentile}% of U.S. ZIP codes` : 'fewer than most U.S. ZIP codes'}`,
    assumed: assumedAny(rec, 'longTrips'),
    panel: [
      el('p', { text: REASON_COPY[local.id](local.value) }),
      trips ? el('p', { text: REASON_COPY[trips.id](trips.value) }) : null,
      el('dl', {},
        el('dt', { text: 'Nearest fast charger' }), el('dd', { text: nearest }),
        el('dt', { text: 'Fast-charging stations within 25 miles' }), el('dd', { text: num.format(c.dcWithin25) }),
        el('dt', { text: 'Level 2 stations within 5 miles' }), el('dd', { text: num.format(c.l2Within5) }),
        el('dt', { text: 'Level 2 stations within 10 miles' }), el('dd', { text: num.format(c.l2Within10) })),
      el('p', { text: `${c.l2Percentile >= 10 ? `More Level 2 charging than ${c.l2Percentile}% of U.S. ZIP codes.` : 'Less Level 2 charging than most U.S. ZIP codes.'} Level 2 adds about 20 to 30 miles of range per hour; fast chargers can add 150+ miles in about 30 minutes, depending on the car.` }),
      el('p', { class: 'src', text: 'Source: NREL Alternative Fuels Data Center, public stations open today.' }),
    ],
  };
}

function milesScale(need, f) {
  const max = Math.max(f.rangeMax, need) * 1.05;
  const at = (x) => `${Math.min(100, (100 * x) / max).toFixed(1)}%`;
  const scale = el('div', { class: 'miles', 'aria-hidden': 'true' },
    el('div', { class: 'track' }), el('div', { class: 'band' }), el('div', { class: 'need' }),
    el('div', { class: 'need-label', text: `You: ${need} mi` }),
    el('div', { class: 'tick', text: '0' }), el('div', { class: 'tick', text: `${f.rangeMax} mi` }));
  const band = scale.querySelector('.band');
  band.style.left = at(f.rangeP25);
  band.style.width = `calc(${at(f.rangeP75)} - ${at(f.rangeP25)})`;
  scale.querySelector('.need').style.left = at(need);
  const label = scale.querySelector('.need-label');
  label.style.left = at(need);
  const pos = need / max;
  label.style.transform = pos < 0.15 ? 'none' : pos > 0.85 ? 'translateX(-100%)' : 'translateX(-50%)';
  const ticks = scale.querySelectorAll('.tick');
  ticks[0].style.left = '0';
  ticks[1].style.left = at(f.rangeMax);
  ticks[1].style.transform = 'translateX(-100%)';
  return scale;
}

function rangeStop(rec) {
  const f = state.meta.fleet[FLEET_KEY];
  const [y1, y2] = state.meta.fleet.modelYears;
  const r = reasonOf(rec, 'range-');
  const why = rec.range.daysPerCharge > 1
    ? `Your daily miles × ${ASSUMPTIONS.rangeBuffer} (winter, a reserve, battery aging) × ${ASSUMPTIONS.daysBetweenPublicCharges} days, since public charging usually means charging less often.`
    : `Your daily miles × ${ASSUMPTIONS.rangeBuffer}, a buffer for winter range loss, a reserve so you never run to empty, and battery aging.`;
  return {
    key: 'range', label: 'Range you need', tone: r.tone,
    figure: `${num.format(rec.range.need)} mi`,
    detail: `${num.format(rec.range.covered)} of ${num.format(rec.range.total)} electric SUVs, minivans, and pickups cover it`,
    assumed: assumedAny(rec, 'dailyMiles'),
    panel: [
      el('p', { text: REASON_COPY[r.id](r.value) }),
      milesScale(rec.range.need, f),
      el('p', { text: `The shaded band is the middle half of electric SUVs, minivans, and pickups on sale (model years ${y1}–${y2}): ${f.rangeP25} to ${f.rangeP75} miles. They range from ${f.rangeMin} to ${f.rangeMax} miles; the median is ${f.rangeMedian}.` }),
      el('p', { text: why }),
      el('p', { class: 'src', text: 'Source: fueleconomy.gov (EPA) rated range.' }),
    ],
  };
}

function fuelStop(rec) {
  const c = rec.costs;
  const r = reasonOf(rec, 'savings-');
  const pct = (x) => `${Math.round(x * 100)}%`;
  let figure = '—';
  let label = 'Fuel saved each year';
  if (c.savings != null && c.savings >= 0) figure = `~${money(c.savings)}`;
  else if (c.savings != null) { figure = `+${money(c.savings)}`; label = 'Fuel cost vs. gas, each year'; }
  return {
    key: 'fuel', label, tone: r ? r.tone : 'check', figure,
    detail: c.gasCost == null ? 'Gas prices are not available for your state' : `${money(c.evCost)} electric vs ${money(c.gasCost)} gas, at ${state.zipRec.s} prices`,
    assumed: assumedAny(rec, 'dailyMiles', 'homeCharging', 'longTrips'),
    panel: [
      r ? el('p', { text: REASON_COPY[r.id](r.value) }) : null,
      el('dl', {},
        el('dt', { text: `Gas car (${ASSUMPTIONS.gasMpg} mpg)` }), el('dd', { text: c.gasCost == null ? 'Not available' : `${money(c.gasCost)} a year` }),
        el('dt', { text: 'EV' }), el('dd', { text: `${money(c.evCost)} a year` }),
        el('dt', { text: 'Miles a year' }), el('dd', { text: num.format(c.miles) }),
        el('dt', { text: 'Gas price' }), el('dd', { text: c.gasPrice ? `$${c.gasPrice.toFixed(2)}/gal (${c.gasArea})` : 'Not available' }),
        el('dt', { text: 'Home electricity' }), el('dd', { text: `${c.electricityCents.toFixed(1)}¢/kWh (${state.zipRec.s})` }),
        el('dt', { text: 'Where you would charge' }), el('dd', { text: `${pct(c.mix.home)} home, ${pct(c.mix.l2)} Level 2 away from home, ${pct(c.mix.dc)} fast charging` })),
      el('p', { class: 'src', text: 'Fuel only: purchase price, insurance, maintenance, and incentives are not included. Sources: EIA prices; public charging prices are national averages and vary by network.' }),
    ],
  };
}

function parksStop(rec) {
  const dests = rec.destinations;
  if (!dests.length) return null;
  const d = dests[0];
  let tone = 'minus';
  if (d.noStopNeeded || d.chargingAtPark === 'good') tone = 'plus';
  else if (d.chargingAtPark === 'some') tone = 'check';
  const more = dests.length - 1;
  return {
    key: 'parks', label: d.name, tone,
    figure: `${num.format(d.oneWayMiles)} mi`,
    detail: `${d.noStopNeeded ? 'Round trip on one charge' : 'Plan a fast-charging stop'}${more ? ` · ${more} more park${more > 1 ? 's' : ''} nearby` : ''}`,
    assumed: assumedAny(rec, 'outdoor'),
    panel: [
      el('ul', { class: 'park-list' }, dests.map((p) => el('li', {},
        el('p', {}, externalLink(p.name, p.url, 'park', { park: p.code })),
        el('p', { text: `About ${num.format(p.oneWayMiles)} miles away by road (${num.format(p.roundTripMiles)} round trip, estimated). ${p.noStopNeeded ? 'A typical EV can make the round trip on one charge.' : 'Plan at least one fast-charging stop for the round trip.'}` }),
        el('p', { text: `${CHARGING_AT_PARK[p.chargingAtPark]}: ${num.format(p.fastChargersNearPark)} fast-charging stations within 25 miles${p.nearestFastToPark != null ? `, nearest ${p.nearestFastToPark} miles` : ''}.` })))),
      el('p', { class: 'src', text: 'National Park Service parks, preserves, recreation areas, seashores, lakeshores, and rivers. Charging is measured from the single point the Park Service publishes for each park, which for big parks may be far from the entrance. Road miles are estimated as straight-line distance × 1.25.' }),
    ],
  };
}

function stopOrder() {
  const promoted = VARIANTS[state.variant].firstStop;
  return ['home', promoted, ...['charger', 'range', 'fuel', 'parks'].filter((k) => k !== promoted)];
}

function renderStop(stop, i, nextKey) {
  const panelId = `stop-panel-${stop.key}`;
  const tone = TONE_COPY[stop.tone];
  const panel = el('div', { class: 'stop-panel', id: panelId, hidden: true }, stop.panel);
  const btn = el('button', {
    type: 'button', class: 'stop-btn', 'aria-expanded': 'false', 'aria-controls': panelId,
    onclick: () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    },
  },
  el('span', { class: 'station', 'aria-hidden': 'true' }),
  el('span', { class: 'stop-main' },
    el('span', { class: 'stop-label', text: stop.label }),
    el('span', { class: 'stop-detail' },
      el('span', { class: `chip t-${stop.tone}`, 'aria-hidden': 'true', text: tone.chip }),
      stop.assumed ? el('span', { class: 'chip assumed-chip', text: 'Assumed' }) : null,
      srOnly(`${tone.sr} `), stop.detail)),
  el('span', { class: 'stop-figure', text: stop.figure }),
  el('span', { class: 'stop-chev' }, chevron()));
  const li = el('li', { class: `stop s-${stop.key}` }, btn, panel);
  li.style.setProperty('--i', String(i));
  if (nextKey) li.style.setProperty('--seg', `var(--stop-${nextKey})`);
  return li;
}

function renderRoute(rec) {
  const builders = { home: homeStop, charger: chargerStop, range: rangeStop, fuel: fuelStop, parks: parksStop };
  const stops = stopOrder().map((k) => builders[k](rec)).filter(Boolean);
  const route = $('route');
  route.classList.remove('drawing');
  route.replaceChildren(...stops.map((s, i) => renderStop(s, i, stops[i + 1]?.key)));
  void route.offsetWidth; // restart the draw animation on re-render
  route.classList.add('drawing');
}

function methodBody() {
  const m = state.meta;
  const fetched = new Date(m.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    el('p', { text: 'Your verdict combines five factors: a regular place to charge, at home or during the day (40%), range fit (20%), public charging nearby (15%), road-trip charging (15%), and charging near outdoor destinations (up to 15%, only if you take those trips). Without a known place to charge, the verdict cannot be “Strong fit”. Skipped questions use typical values for your ZIP.' }),
    el('h3', { text: 'Assumptions' }),
    el('ul', {},
      el('li', { text: `Gas car: ${ASSUMPTIONS.gasMpg} mpg, the recent new-vehicle average (EPA).` }),
      el('li', { text: `EV efficiency: ${m.fleet[FLEET_KEY].kwhPer100Median} kWh per 100 miles, the median of current electric SUVs, minivans, and pickups (EPA, measured at the wall).` }),
      el('li', { text: `Public fast charging: $${ASSUMPTIONS.dcFastPricePerKwh.toFixed(2)}/kWh (Paren U.S. average, Q1 2026). Public Level 2 and daytime charging: about $${ASSUMPTIONS.publicL2PricePerKwh.toFixed(2)}/kWh.` }),
      el('li', { text: `Each long drive adds about ${ASSUMPTIONS.extraMilesPerLongTrip} miles to your year.` }),
      el('li', { text: 'Distances are straight-line; road miles are estimated at 1.25 times that.' })),
    el('h3', { text: 'Sources' }),
    el('ul', {}, m.sources.map((s) => el('li', {}, externalLink(s.name, s.url, `source-${s.id}`)))),
    el('p', { class: 'small', text: `Data downloaded ${fetched}. Electricity prices: ${m.electricityPeriod}. Gas prices: average of weeks ${m.gasolineWeeks[0]} to ${m.gasolineWeeks[m.gasolineWeeks.length - 1]}.` }),
  ];
}

function renderResults() {
  const rec = recommend({ zipRec: state.zipRec, answers: state.answers, meta: state.meta, parks: state.parks });
  const answered = answeredCount();
  const total = applicable().length;

  $('results-title').textContent = rec.tierLabel;
  $('tier-mark').className = `tier-mark t-${rec.tier}`;
  $('results-summary').textContent = TIER_COPY[rec.tier];
  $('results-focus').textContent = focusLine(rec);
  $('tier-scale').replaceChildren(...tierScale(rec.tier));
  $('tier-scale').setAttribute('aria-label', 'Verdict scale, from Not yet to Strong fit');
  $('results-confidence').textContent = answered === total
    ? 'Based on your ZIP and all of your answers.'
    : `Based on your ZIP and ${answered} of ${total} answers, so this is a ${rec.confidence}-confidence result.`;

  const assumed = rec.inputs.assumed;
  $('assumed').hidden = assumed.length === 0;
  $('assumed-list').replaceChildren(...assumed.map((k) => el('li', { text: ASSUMED_COPY[k](rec.inputs) })));

  renderRoute(rec);

  $('learn-more').replaceChildren(...LEARN_MORE.map((l) => el('li', {}, externalLink(l.label, l.url, l.id), el('span', { class: 'src', text: ` (${l.source})` }))));
  $('method-body').replaceChildren(...methodBody());
  state.lastRec = rec;
  resetPlan();

  show('view-results', 'results-title');
  analytics.track('recommendation_viewed', {
    tier: rec.tier,
    score_band: `${Math.floor(rec.score / 10) * 10}s`,
    confidence: rec.confidence,
    answered,
    state: state.zipRec.s,
    blockers: rec.blockers.join(',') || 'none',
  });
}

function onAnswerMore() {
  const skipped = applicable().filter((k) => !state.answers[k]);
  if (!skipped.length) return;
  analytics.track('refine_clicked', { skipped: skipped.length });
  // Include work charging too, in case answering home charging makes it apply.
  state.refineSet = new Set([...skipped, 'workCharging']);
  renderQuestion(0);
}

// ---------- next steps: north star and the "Get my EV plan" fake door ----------

function markNextStep(type) {
  if (state.nextStepSent || !state.lastRec) return;
  state.nextStepSent = true;
  analytics.track('next_step_taken', { type, answered: answeredCount(), confidence: state.lastRec.confidence, tier: state.lastRec.tier });
}

function resetPlan() {
  $('plan-result').hidden = true;
  $('plan-steps').replaceChildren();
}

// The plan is the route's last leg: one station per step, colored by what the step is about,
// a short action to scan, the detail under it, and a "Done" box (nothing is saved).
// ---------- the plan: saved on this device once the visitor acts ----------

function plan() {
  if (!state.plan) state.plan = emptyPlan();
  return state.plan;
}

/** Change the plan, then save it on this device and refresh the summary. */
function updatePlan(fn) {
  const p = plan();
  fn(p);
  p.zip = state.zip;
  p.answers = { ...state.answers };
  savePlan(p);
  renderSummary();
}

let tools = null;
function planTools() {
  tools ??= createPlanTools({
    plan,
    update: updatePlan,
    track: analytics.track,
    get rec() { return state.lastRec; },
    get zip() { return state.zip; },
    get zipRec() { return state.zipRec; },
    get parks() { return state.parks; },
    get meta() { return state.meta; },
  });
  return tools;
}

function renderPlan(rec) {
  const steps = planFor(rec);
  $('plan-thanks').textContent = PLAN_CTA.thanksBody(steps.length);
  $('plan-steps').replaceChildren(...steps.map((step, i) => {
    const def = PLAN_STEPS[step.id];
    const title = def.title(step.value);
    const next = steps[i + 1] ? PLAN_STEPS[steps[i + 1].id].stop : null;
    const id = `plan-done-${i}`;
    const tool = planTools().toolFor(step.id);
    let toolNodes = [];
    if (tool) {
      const panelId = `tool-${step.id}`;
      const panel = el('div', { class: 'tool-panel', id: panelId, hidden: true });
      let loaded = false;
      const btn = el('button', {
        type: 'button', class: 'tool-btn', 'aria-expanded': 'false', 'aria-controls': panelId,
        onclick: async () => {
          const open = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', String(!open));
          panel.hidden = open;
          if (!open && !loaded) { loaded = true; await planTools().renderTool(step.id, panel, step.value); }
        },
      }, tool.label, chevron());
      toolNodes = [btn, panel];
    }
    const li = el('li', { class: `plan-step p-${def.stop}` },
      el('span', { class: 'plan-station', 'aria-hidden': 'true', text: String(i + 1) }),
      el('div', { class: 'plan-main' },
        el('h3', { class: 'plan-title', text: title }),
        el('p', { class: 'plan-detail' }, el('span', { class: 'chip', text: PLAN_CATEGORY[def.stop] }), def.detail(step.value)),
        toolNodes),
      el('label', { class: 'plan-done', for: id },
        el('input', {
          type: 'checkbox', id, checked: plan().done.includes(step.id),
          onchange: (e) => {
            updatePlan((p) => { p.done = p.done.filter((s) => s !== step.id); if (e.target.checked) p.done.push(step.id); });
            if (e.target.checked) analytics.track('plan_step_done', { step: step.id.replace('plan-', '') });
          },
        }),
        PLAN_CTA.done, srOnly(`: ${title}`)));
    if (next) li.style.setProperty('--seg', next === 'finish' ? 'var(--poppy)' : `var(--stop-${next})`);
    return li;
  }));
  renderSummary();
}

// ---------- partner summary: print, save as PDF, or share by link ----------

async function renderSummary() {
  const box = $('plan-summary');
  const rec = state.lastRec;
  if (!box || !rec) return;
  const p = plan();
  const steps = planFor(rec);
  const doneCount = steps.filter((s) => p.done.includes(s.id)).length;
  const c = rec.costs;
  const nodes = [
    el('h3', { id: 'summary-title', text: 'Your plan at a glance' }),
    el('p', { class: 'summary-verdict' },
      el('strong', { text: `${rec.tierLabel} for ZIP ${state.zip}. ` }), focusLine(rec)),
    el('dl', { class: 'summary-facts' },
      el('dt', { text: 'Fuel vs. gas' }), el('dd', { text: c.savings == null ? 'Not available' : c.savings >= 0 ? `About ${money(c.savings)} a year saved` : `About ${money(c.savings)} a year more` }),
      el('dt', { text: 'Charging, per month' }), el('dd', { text: `About ${money(c.evCost / 12)} (vs. about ${c.gasCost == null ? 'n/a' : money(c.gasCost / 12)} on gas)` }),
      el('dt', { text: 'Range you need' }), el('dd', { text: `${num.format(rec.range.need)} miles between charges` }),
      el('dt', { text: 'Steps done' }), el('dd', { text: `${doneCount} of ${steps.length}` })),
  ];

  if (p.shortlist.length) {
    const data = await planTools().loadVehicles().catch(() => null);
    const f = p.finance;
    const tools = planTools();
    const cars = (data?.vehicles || []).filter((v) => p.shortlist.includes(v.id));
    if (cars.length) {
      // Same figures as the car explorer, so the partner sees exactly what the planner saw.
      const cols = [
        ['Starting price', (v) => usd(v.msrp), true],
        ['Destination', (v) => (v.destination ? usd(v.destination) : 'Not published'), true],
        f.mode === 'price' ? null : [f.mode === 'lease' ? 'Lease est. /mo' : 'Loan est. /mo', (v) => tools.figureFor(v, f), true],
        ['EPA range', (v) => tools.rangeText(v), true],
        ['kWh/100 mi', (v) => (v.kwh100 ? String(v.kwh100) : '—'), true],
        ['Seats', (v) => String(v.seats), true],
      ].filter(Boolean);
      nodes.push(el('h4', { text: 'Cars on your shortlist' }),
        el('div', { class: 'table-scroll', role: 'region', 'aria-label': 'Shortlisted cars', tabindex: '0' }, el('table', { class: 'summary-table' },
          el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Car' }), cols.map(([h, , n]) => el('th', { scope: 'col', class: n ? 'num' : null, text: h })))),
          el('tbody', {}, cars.map((v) => el('tr', {},
            el('th', { scope: 'row', text: `${v.make} ${v.model}` }),
            cols.map(([h, get, n]) => { const td = el('td', { class: n ? 'num' : null, text: get(v) }); td.setAttribute('data-label', h); return td; })))))),
        el('p', { class: 'small', text: `${f.mode === 'price' ? 'Starting prices' : 'Estimates'} before taxes, fees, and incentives${f.mode === 'loan' ? `, with $${num.format(f.down)} down at ${f.aprPct}% for ${f.months} months` : f.mode === 'lease' ? `, with $${num.format(f.dueAtSigning)} due at signing for ${f.leaseMonths} months` : ''}. Where a brand doesn't publish its destination fee, the estimate leaves it out. Add charging (about ${money(c.evCost / 12)} a month) for the full monthly picture.` }));
    }
  }

  const placesWithSaves = p.places.filter((pl) => (p.saved[pl.id] || []).length);
  if (placesWithSaves.length) {
    const asOf = state.meta?.fetchedAt ? new Date(state.meta.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : null;
    nodes.push(el('h4', { text: 'Chargers you saved' }),
      el('ul', { class: 'summary-places' }, placesWithSaves.map((pl) => el('li', {},
        el('strong', { text: pl.name }),
        el('ul', { class: 'summary-chargers' }, p.saved[pl.id].map((st) => el('li', {},
          el('span', { class: 'summary-charger-name', text: `${st.name}, ${planTools().milesText(st.miles)} mi` }),
          el('span', { class: 'small', text: [[st.street, st.city].filter(Boolean).join(', '), st.hours, st.price].filter(Boolean).join(' · ') }),
          el('span', { class: 'small', text: [st.level2 ? `${st.level2} Level 2` : null, st.fast ? `${st.fast} fast` : null, st.network].filter(Boolean).join(' · ') }))))))),
      asOf ? el('p', { class: 'small', text: `Stations as of ${asOf}, from the U.S. Department of Energy. Check hours and prices before you go.` }) : null);
  }

  if (p.trips.length) {
    nodes.push(el('h4', { text: 'Trips you planned' }),
      el('ul', { class: 'summary-places summary-trips' }, p.trips.map((t) => el('li', {},
        el('strong', { text: `${t.from.name} to ${t.to.name}` }),
        el('span', { class: 'small summary-trip-facts', text: `${num.format(Math.round(t.miles))} road miles one way, about ${durationText(t.minutes)} of driving${t.stops.length ? ` plus about ${chargeTimeShort(t.stops.length)} of charging` : ''}. ${stopsText(t.stops.length)}, planning up to ${t.legMiles} miles between charges.` }),
        ((cost) => (cost ? el('span', { class: 'small summary-trip-facts', text: `Electricity, est.: ${cost.figure}${cost.gas ? `; the same drive on gas: about $${cost.gas}` : ''}.` }) : null))(tripCostFor(t, { rec, meta: state.meta, stateName: state.zipRec?.s })),
        ((home) => (home ? el('span', { class: 'small summary-trip-facts', text: `Getting home: ${home}` }) : null))(homeText(t, t.to.park ? rec.destinations.find((d) => d.code === t.to.park)?.nearestFastToPark ?? null : null)),
        t.stops.length ? el('ol', { class: 'summary-chargers' }, t.stops.map((s) => el('li', {},
          el('span', { class: 'summary-charger-name', text: `Road mile ${num.format(s.atMile)}: ${s.name}` }),
          el('span', { class: 'small', text: [[s.street, s.city].filter(Boolean).join(', '), stopFacts(s)].filter(Boolean).join(' · ') })))) : null))),
      el('p', { class: 'small', text: 'Fast chargers from the U.S. Department of Energy station list. Check that each one is working on its network’s app before you go.' }));
  }

  nodes.push(el('p', { class: 'small print-only', text: `Made ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} with EV Readiness Check · ${location.origin}` }));

  const shareStatus = el('p', { class: 'tool-status', role: 'status' });
  const linkOut = el('input', { type: 'text', class: 'share-link', readonly: true, 'aria-label': 'Share link', hidden: true });
  const includeId = 'share-include-places';
  nodes.push(
    el('div', { class: 'summary-actions' },
      el('button', { type: 'button', class: 'btn btn-go', onclick: () => { analytics.track('plan_printed'); window.print(); } }, PLAN_CTA.print),
      el('label', { class: 'check', for: includeId }, el('input', { type: 'checkbox', id: includeId }), 'Include my saved places, the chargers near them, and my trips'),
      el('button', {
        type: 'button', class: 'btn btn-quiet',
        onclick: async () => {
          const includePlaces = $(includeId).checked;
          const url = `${location.origin}${location.pathname}#plan=${await encodeShare(sharePayload({ ...plan(), zip: state.zip, answers: state.answers }, { includePlaces }))}`;
          linkOut.value = url;
          linkOut.hidden = false;
          try { await navigator.clipboard.writeText(url); shareStatus.textContent = 'Link copied. Anyone with it can see this plan.'; } catch { linkOut.select(); shareStatus.textContent = 'Copy the link below. Anyone with it can see this plan.'; }
          analytics.track('share_link_copied', { places: includePlaces });
        },
      }, 'Copy a share link')),
    linkOut, shareStatus,
    el('p', { class: 'small screen-only', text: 'Your plan is saved on this device only. A share link carries the plan inside the link itself; nothing is stored on our servers. Saved places and trips are left out unless you include them.' }));
  box.replaceChildren(...nodes);
}

function onPlanCta(opts = {}) {
  if (!opts.resumed) {
    analytics.track('plan_cta_clicked', { tier: state.lastRec.tier });
    markNextStep('plan');
  }
  renderPlan(state.lastRec);
  $('plan-result').hidden = false;
  $('plan-result').scrollIntoView({ block: 'start' });
  $('plan-result').focus({ preventScroll: true });
}

function onStartOver() {
  analytics.track('start_over_clicked');
  state.zip = null;
  state.zipRec = null;
  state.answers = {};
  state.refineSet = null;
  state.lastRec = null;
  state.plan = null;
  $('shared-banner').hidden = true;
  $('zip').value = '';
  show('view-landing', 'zip');
}

// ---------- footer ----------

function renderAnalyticsToggle() {
  const btn = $('analytics-toggle');
  const status = analytics.status();
  btn.hidden = status !== 'on' && status !== 'off';
  btn.textContent = status === 'on' ? 'Turn off anonymous analytics for this visit' : 'Analytics are off for this visit';
  btn.disabled = status === 'off';
}

// ---------- boot ----------

function boot() {
  state.variant = analytics.init();
  applyVariant();
  renderAnalyticsToggle();

  $('zip-form').addEventListener('submit', onZipSubmit);
  $('zip').addEventListener('input', () => { if (!$('zip-error').hidden) setZipError(null); });
  $('question-form').addEventListener('submit', onQuestionSubmit);
  $('question-back').addEventListener('click', onBack);
  $('question-skip').addEventListener('click', onSkip);
  $('question-skip-all').addEventListener('click', onSkipAll);
  $('answer-more').addEventListener('click', onAnswerMore);
  $('start-over').addEventListener('click', onStartOver);
  $('error-retry').addEventListener('click', () => show('view-landing', 'zip'));
  $('plan-cta').textContent = PLAN_CTA.button;
  $('plan-result-title').textContent = PLAN_CTA.thanksTitle;
  $('plan-cta').addEventListener('click', () => onPlanCta());
  $('analytics-toggle').addEventListener('click', () => { analytics.optOut(); renderAnalyticsToggle(); });

  loadStatic().then(() => {
    const d = new Date(state.meta.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    $('data-date').textContent = `Data as of ${d}.`;
  }).catch(() => {});

  analytics.track('landing_viewed');

  // A share link opens straight into that plan; the fragment is cleared so it is not re-shared by accident.
  const m = /^#plan=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    decodeShare(m[1]).then((shared) => {
      if (shared?.zip) { analytics.track('shared_plan_opened'); openPlan(shared, { shared: true }); }
    });
    return;
  }
  // A plan saved on this device can be picked up again from the landing page.
  const saved = loadSaved();
  if (saved?.zip) {
    $('resume-text').textContent = `You have a saved EV plan for ZIP ${saved.zip}.`;
    $('resume').hidden = false;
    $('resume-btn').addEventListener('click', () => { analytics.track('plan_resumed'); openPlan(saved, { shared: false }); });
    $('resume-clear').addEventListener('click', () => { clearSaved(); $('resume').hidden = true; $('zip').focus(); });
  }
}

boot();
