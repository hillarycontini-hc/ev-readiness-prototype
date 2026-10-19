// UI controller: one question per screen, then a personalized result.
// Rendering uses createElement + textContent only. Nothing typed by the visitor
// is ever inserted as HTML, and the ZIP is validated before it is used in a path.

import { ASSUMPTIONS, FLEET_KEY, QUESTIONS, TIERS, normalizeZip, planFor, questionsFor, recommend } from './logic.js';
import { ASSUMED_COPY, CHARGING_AT_PARK, LEARN_MORE, PLAN_COPY, PLAN_CTA, QUESTION_COPY, REASON_COPY, TIER_COPY, VARIANTS } from './copy.js';
import * as analytics from './analytics.js';

const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('en-US');
const money = (n) => `$${num.format(Math.abs(Math.round(n / 10) * 10))}`;
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
  meta: null,
  parks: null,
  variant: 'control',
};

// ---------- tiny DOM helper ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function srOnly(text) {
  return el('span', { class: 'sr-only', text });
}

function externalLink(text, url, linkId, extra = {}) {
  // URLs come from our own data files, but only https links are ever rendered.
  if (!/^https:\/\//i.test(String(url))) return el('span', { text });
  return el('a', {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onclick: () => {
      analytics.track('learn_more_clicked', { link_id: linkId, ...extra });
      markNextStep('learn_more');
    },
  }, text, el('span', { 'aria-hidden': 'true', text: ' ↗' }), srOnly(' (opens in a new tab)'));
}

// ---------- views ----------

function show(viewId, focusId) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== viewId;
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
    const [, shard] = await Promise.all([loadStatic(), fetchJson(`data/zip/${zip.slice(0, 3)}.json`)]);
    const rec = shard && Object.hasOwn(shard, zip) ? shard[zip] : null;
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

function renderQuestion(step) {
  state.queue = currentQueue();
  state.step = step;
  const key = state.queue[step];
  const copy = QUESTION_COPY[key];
  const total = state.queue.length;

  $('question-progress').textContent = `Question ${step + 1} of ${total}`;
  $('question-step-sr').textContent = `Question ${step + 1} of ${total}: `;
  $('progress-fill').style.width = `${Math.round((100 * step) / total)}%`;
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

// ---------- results ----------

function tierScale(currentId) {
  const ordered = [...TIERS].reverse(); // Not yet ... Strong fit
  return el('ol', { class: 'tier-scale', 'aria-label': 'Verdict scale, from Not yet to Strong fit' },
    ordered.map((t) => el('li', {
      class: `seg${t.id === currentId ? ' current' : ''}`,
      'aria-current': t.id === currentId ? 'true' : null,
    }, t.label, t.id === currentId ? srOnly(' (your result)') : null)));
}

const TONE = {
  plus: { symbol: '+', label: 'Works in your favor: ' },
  minus: { symbol: '−', label: 'Works against you: ' },
  check: { symbol: '!', label: 'Worth checking: ' },
};

function reasonItem(r) {
  const tone = TONE[r.tone];
  return el('li', {},
    el('span', { class: `tone tone-${r.tone}`, 'aria-hidden': 'true', text: tone.symbol }),
    el('span', {}, srOnly(tone.label), REASON_COPY[r.id](r.value)));
}

function chargingCard(rec) {
  const c = rec.charging;
  const nearest = c.nearestDc == null ? 'None within 100 miles' : `${c.nearestDc} miles (straight line)`;
  return el('section', { class: 'card', 'aria-labelledby': 'card-charging' },
    el('h2', { id: 'card-charging', text: 'Public charging near you' }),
    el('p', { class: 'big', text: c.dcWithin10 ? `${num.format(c.dcWithin10)} fast-charging stations within 10 miles` : 'No fast-charging stations within 10 miles' }),
    el('dl', {},
      el('dt', { text: 'Level 2 stations within 5 miles' }), el('dd', { text: num.format(c.l2Within5) }),
      el('dt', { text: 'Level 2 stations within 10 miles' }), el('dd', { text: num.format(c.l2Within10) }),
      el('dt', { text: 'Fast-charging stations within 25 miles' }), el('dd', { text: num.format(c.dcWithin25) }),
      el('dt', { text: 'Nearest fast charger' }), el('dd', { text: nearest })),
    el('p', { text: `That is more fast charging nearby than ${c.dcPercentile}% of U.S. ZIP codes, and more Level 2 charging than ${c.l2Percentile}%.` }),
    el('p', { class: 'small', text: 'Public stations open today, from the NREL Alternative Fuels Data Center. Level 2 adds about 20 to 30 miles of range per hour; fast chargers can add 150+ miles in about 30 minutes, depending on the car.' }));
}

function rangeCard(rec) {
  const f = state.meta.fleet[FLEET_KEY];
  const [y1, y2] = state.meta.fleet.modelYears;
  const need = rec.range.need;
  const max = Math.max(f.rangeMax, need) * 1.05;
  const pctOf = (x) => `${Math.min(100, (100 * x) / max).toFixed(1)}%`;
  const ruler = el('div', { class: 'ruler', 'aria-hidden': 'true' },
    el('div', { class: 'track' }),
    el('div', { class: 'band' }),
    el('div', { class: 'need' }),
    el('div', { class: 'need-label', text: `You: ${need} mi` }));
  const band = ruler.querySelector('.band');
  band.style.left = pctOf(f.rangeP25);
  band.style.width = `calc(${pctOf(f.rangeP75)} - ${pctOf(f.rangeP25)})`;
  ruler.querySelector('.need').style.left = pctOf(need);
  const label = ruler.querySelector('.need-label');
  label.style.left = pctOf(need);
  // Keep the label inside the ruler near either end.
  const pos = need / max;
  label.style.transform = pos < 0.15 ? 'none' : pos > 0.85 ? 'translateX(-100%)' : 'translateX(-50%)';

  const why = rec.range.daysPerCharge > 1
    ? `Your daily miles × ${ASSUMPTIONS.rangeBuffer} (winter, a reserve, battery aging) × ${ASSUMPTIONS.daysBetweenPublicCharges} days, since public charging usually means charging less often.`
    : `Your daily miles × ${ASSUMPTIONS.rangeBuffer}, a buffer for winter range loss, a reserve so you never run to empty, and battery aging.`;

  return el('section', { class: 'card', 'aria-labelledby': 'card-range' },
    el('h2', { id: 'card-range', text: 'Range you need vs. what EVs offer' }),
    el('p', { class: 'big', text: `About ${num.format(need)} miles between charges` }),
    el('p', { text: `${num.format(rec.range.covered)} of ${num.format(rec.range.total)} electric SUV, minivan, and pickup configurations (model years ${y1}–${y2}) are rated for at least that. Those are the classes with room for car seats, a dog, and gear. Their rated ranges run from ${f.rangeMin} to ${f.rangeMax} miles; the median is ${f.rangeMedian}.` }),
    ruler,
    el('p', { class: 'small', text: `The shaded band shows the middle half of those vehicles (${f.rangeP25} to ${f.rangeP75} miles). ${why}` }));
}

function costsCard(rec) {
  const c = rec.costs;
  const st = state.zipRec.s;
  let headline;
  if (c.savings == null) headline = 'Cost comparison unavailable for your state';
  else if (c.savings >= 0) headline = `About ${money(c.savings)} a year saved`;
  else headline = `About ${money(c.savings)} a year more than gas`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  return el('section', { class: 'card', 'aria-labelledby': 'card-costs' },
    el('h2', { id: 'card-costs', text: 'Fuel cost: gas vs. electric' }),
    el('p', { class: 'big', text: headline }),
    c.savings != null && c.savings >= 0 ? el('p', { text: `That is roughly ${money(c.savings / 12)} a month.` }) : null,
    el('dl', {},
      el('dt', { text: `Gas car (${ASSUMPTIONS.gasMpg} mpg)` }), el('dd', { text: c.gasCost == null ? 'n/a' : `${money(c.gasCost)} a year` }),
      el('dt', { text: 'EV' }), el('dd', { text: `${money(c.evCost)} a year` }),
      el('dt', { text: 'Miles a year' }), el('dd', { text: num.format(c.miles) }),
      el('dt', { text: 'Gas price' }), el('dd', { text: c.gasPrice ? `$${c.gasPrice.toFixed(2)}/gal (${c.gasArea})` : 'n/a' }),
      el('dt', { text: 'Home electricity' }), el('dd', { text: `${c.electricityCents.toFixed(1)}¢/kWh (${st})` }),
      el('dt', { text: 'Where you would charge' }), el('dd', { text: `${pct(c.mix.home)} home, ${pct(c.mix.l2)} public Level 2, ${pct(c.mix.dc)} fast charging` })),
    el('p', { class: 'small', text: 'Fuel only. Purchase price, insurance, maintenance, and incentives are not included. Public charging prices are national averages and vary by network.' }));
}

function outdoorCard(rec) {
  if (!rec.destinations.length) return null;
  return el('section', { class: 'card', 'aria-labelledby': 'card-outdoor' },
    el('h2', { id: 'card-outdoor', text: 'Charging on the way to the outdoors' }),
    el('ul', { class: 'dest' }, rec.destinations.map((d) => el('li', {},
      el('p', { class: 'name' }, externalLink(d.name, d.url, 'park', { park: d.code })),
      el('p', { text: `About ${num.format(d.oneWayMiles)} miles away by road (${num.format(d.roundTripMiles)} round trip, estimated).` }),
      el('p', { text: d.noStopNeeded ? 'A typical EV can make the round trip on one charge.' : 'Plan at least one fast-charging stop for the round trip.' }),
      el('p', { text: `${CHARGING_AT_PARK[d.chargingAtPark]}: ${num.format(d.fastChargersNearPark)} fast-charging stations within 25 miles${d.nearestFastToPark != null ? `, nearest ${d.nearestFastToPark} miles` : ''}.` })))),
    el('p', { class: 'small', text: 'Destinations are National Park Service parks, preserves, recreation areas, seashores, lakeshores, and rivers. Charging is measured from the single point the Park Service publishes for each park, which for big parks may be far from the entrance. Road miles are estimated as straight-line distance × 1.25.' }));
}

function methodBody() {
  const m = state.meta;
  const fetched = new Date(m.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    el('p', { text: 'Your verdict combines five factors: home charging (40%), range fit (20%), public charging nearby (15%), road-trip charging (15%), and charging near outdoor destinations (up to 15%, only if you take those trips). Without home charging the verdict cannot be “Strong fit”. Skipped questions use typical values for your ZIP.' }),
    el('h3', { text: 'Assumptions' }),
    el('ul', {},
      el('li', { text: `Gas car: ${ASSUMPTIONS.gasMpg} mpg, the recent new-vehicle average (EPA).` }),
      el('li', { text: `EV efficiency: ${m.fleet[FLEET_KEY].kwhPer100Median} kWh per 100 miles, the median of current electric SUVs, minivans, and pickups (EPA, measured at the wall).` }),
      el('li', { text: `Public fast charging: $${ASSUMPTIONS.dcFastPricePerKwh.toFixed(2)}/kWh (Paren U.S. average, Q1 2026). Public Level 2: about $${ASSUMPTIONS.publicL2PricePerKwh.toFixed(2)}/kWh.` }),
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

  $('results-where').textContent = `Results for ZIP ${state.zip} (${state.zipRec.s})`;
  $('results-title').textContent = rec.tierLabel;
  $('results-summary').textContent = TIER_COPY[rec.tier];
  $('tier-scale').replaceWith(Object.assign(tierScale(rec.tier), { id: 'tier-scale' }));
  const total = applicable().length;
  $('results-confidence').textContent = answered === total
    ? 'Based on your ZIP and all of your answers.'
    : `Based on your ZIP and ${answered} of ${total} answers. We filled in the rest with typical values for your area, so this is a ${rec.confidence}-confidence result.`;

  $('results-reasons').replaceChildren(...rec.reasons.map(reasonItem));

  const assumed = rec.inputs.assumed;
  $('assumed').hidden = assumed.length === 0;
  $('assumed-list').replaceChildren(...assumed.map((k) => el('li', { text: ASSUMED_COPY[k](rec.inputs) })));

  const cards = { charging: chargingCard(rec), range: rangeCard(rec), costs: costsCard(rec), outdoor: outdoorCard(rec) };
  const first = VARIANTS[state.variant].firstCard;
  const order = [first, ...['charging', 'range', 'costs', 'outdoor'].filter((k) => k !== first)];
  $('cards').replaceChildren(...order.map((k) => cards[k]).filter(Boolean));

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
  $('plan-cta').hidden = false;
  $('plan-result').hidden = true;
  $('plan-steps').replaceChildren();
}

function onPlanCta() {
  analytics.track('plan_cta_clicked', { tier: state.lastRec.tier });
  markNextStep('plan');
  $('plan-steps').replaceChildren(...planFor(state.lastRec).map((step) => el('li', { text: PLAN_COPY[step.id](step.value) })));
  $('plan-cta').hidden = true;
  $('plan-result').hidden = false;
  $('plan-result').focus();
}

function onStartOver() {
  analytics.track('start_over_clicked');
  state.zip = null;
  state.zipRec = null;
  state.answers = {};
  state.refineSet = null;
  state.lastRec = null;
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
  $('plan-title').textContent = PLAN_CTA.title;
  $('plan-body').textContent = PLAN_CTA.body;
  $('plan-cta').textContent = PLAN_CTA.button;
  $('plan-result-title').textContent = PLAN_CTA.thanksTitle;
  $('plan-thanks').textContent = PLAN_CTA.thanksBody;
  $('plan-print').textContent = PLAN_CTA.print;
  $('plan-cta').addEventListener('click', onPlanCta);
  $('plan-print').addEventListener('click', () => { analytics.track('plan_printed'); window.print(); });
  $('analytics-toggle').addEventListener('click', () => { analytics.optOut(); renderAnalyticsToggle(); });

  loadStatic().then(() => {
    const d = new Date(state.meta.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    $('data-date').textContent = `Data as of ${d}.`;
  }).catch(() => {});

  analytics.track('landing_viewed');
}

boot();
