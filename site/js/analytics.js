// Privacy-first PostHog wrapper. See docs/analytics.md for the event dictionary.
//
// - Loads only if a project key is configured and the browser sends no
//   Global Privacy Control or Do Not Track signal.
// - No cookies, no localStorage: identity lives in memory for one page view.
// - No autocapture, no session replay, no surveys, no heatmaps, no remote
//   config, no extra scripts. Only the named events below are sent.
// - Events never contain the ZIP. URLs are trimmed to origin + path.
//
// A/B assignment happens here, in the page, 50/50 per visit, so the test works
// without cookies or a PostHog feature-flag call.

import { APP_VERSION, EXPERIMENT_KEY, POSTHOG_HOST, POSTHOG_KEY } from './config.js';

export const VARIANT_IDS = ['control', 'adventure'];

// The only events this site sends. Anything else is dropped.
const EVENTS = new Set([
  'landing_viewed', 'zip_submitted', 'zip_error', 'question_viewed', 'question_answered',
  'question_skipped', 'questions_skipped_rest', 'inputs_completed', 'recommendation_viewed',
  'learn_more_clicked', 'refine_clicked', 'start_over_clicked', 'data_load_error',
  'plan_cta_clicked', 'plan_printed', 'next_step_taken',
  // Plan v2 tools. Never addresses, coordinates, station ids, or typed prices.
  'plan_tool_opened', 'place_set', 'charger_saved', 'car_shortlisted', 'finance_mode', 'test_drive_clicked',
  'plan_step_done', 'share_link_copied', 'shared_plan_opened', 'plan_resumed',
  // Trip planner (phase B). Never coordinates, place or station names, or exact miles.
  'trip_planned', 'trip_saved', 'trip_step',
  // Charger map: whether the street map or the drawn fallback was shown. Never a place.
  'map_rendered',
  // Car explorer: which order the visitor chose (price, range, seats, cargo, safety, awards).
  'car_sorted',
]);

// Property names that must never leave the browser, even by mistake.
const BLOCKED_PROPS = /zip|postal|email|name|phone|address|lat|lon/i;

let mode = 'not-configured'; // 'not-configured' | 'blocked-by-signal' | 'on' | 'off'
let variant = 'control';
let queue = [];
let ph = null;

function privacySignal() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || (typeof window !== 'undefined' && window.doNotTrack === '1');
}

function pickVariant() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return VARIANT_IDS[buf[0] % VARIANT_IDS.length];
}

function trimUrl(u) {
  try {
    const url = new URL(u);
    return url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

// Non-$ properties allowed out: ours, PostHog's required ids, and UTM tags
// (so traffic from a LinkedIn post can be told apart from a cohort share).
// Everything else, including ad click ids like fbclid and gclid, is dropped.
const ALLOWED_CUSTOM = new Set([
  'token', 'distinct_id', 'app_version', 'messaging_variant',
  'state', 'question', 'step', 'answer', 'from_question', 'answered', 'skipped',
  'tier', 'score_band', 'confidence', 'blockers', 'link_id', 'park', 'reason', 'stage', 'type',
  'tool', 'slot', 'method', 'class', 'mode', 'make', 'places', 'count',
  'stops', 'dest', 'result', 'direction', 'fix', 'source',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
]);
// PostHog defaults we do not need: full user agent string and timezone (fingerprinting, coarse location).
const DROPPED_SYSTEM = new Set(['$ip', '$raw_user_agent', '$timezone', '$timezone_offset']);
// Ad-platform click ids, wherever posthog-js copies them (e.g. $session_entry_fbclid).
const CLICK_IDS = /(fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|twclid|igshid|ttclid|li_fat_id|rdt_cid|epik|qclid|sccid|oppref|bfcid|irclid|_kx|mc_cid|gad_source)$/i;

/** Last line of defense, run by posthog-js on every event before it is sent. */
export function sanitizeEvent(event) {
  if (!event || !event.properties) return event;
  const p = event.properties;
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('$')) {
      if (DROPPED_SYSTEM.has(k) || CLICK_IDS.test(k)) delete p[k];
      else if (typeof v === 'string' && /^https?:\/\//i.test(v)) p[k] = trimUrl(v);
    } else if (!ALLOWED_CUSTOM.has(k) || BLOCKED_PROPS.test(k)) {
      delete p[k];
    }
  }
  return event;
}

function load() {
  const script = document.createElement('script');
  script.src = 'vendor/posthog.no-external.js';
  script.async = true;
  script.onload = () => {
    ph = window.posthog;
    if (!ph || typeof ph.init !== 'function') { mode = 'not-configured'; queue = []; return; }
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: 'memory',
      person_profiles: 'identified_only', // never identified, so events stay anonymous
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      enable_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      save_referrer: false,
      before_send: sanitizeEvent,
    });
    ph.register({
      // PostHog looks up each request's IP on its servers and would add city,
      // postal code, and coordinates to stored events. This turns that off.
      $geoip_disable: true,
      app_version: APP_VERSION,
      messaging_variant: variant,
      [`$feature/${EXPERIMENT_KEY}`]: variant,
    });
    for (const [e, p] of queue) ph.capture(e, p);
    queue = [];
  };
  script.onerror = () => { mode = 'not-configured'; queue = []; };
  document.head.append(script);
}

/** Assigns the A/B variant and starts analytics if allowed. Returns the variant id. */
export function init() {
  variant = pickVariant();
  if (!POSTHOG_KEY) mode = 'not-configured';
  else if (privacySignal()) mode = 'blocked-by-signal';
  else { mode = 'on'; load(); }
  return variant;
}

export function track(event, props = {}) {
  if (mode !== 'on' || !EVENTS.has(event)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props)) {
    if (!BLOCKED_PROPS.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = v;
  }
  if (ph) ph.capture(event, clean);
  else queue.push([event, clean]);
}

export function status() {
  return mode;
}

/** Stops analytics for the rest of this visit. Nothing is stored, so it resets on reload. */
export function optOut() {
  if (mode !== 'on') return;
  // Not posthog.opt_out_capturing(): that persists the choice in localStorage.
  // Every event goes through track(), so dropping them here is enough.
  mode = 'off';
  queue = [];
}
