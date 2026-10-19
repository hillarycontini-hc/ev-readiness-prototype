# Measurement framework and analytics setup

## What success looks like

The tool's job is to give an EV-curious person a trustworthy, personal answer and a
useful next step. The metrics follow that job, top to bottom:

| Level | Metric | Definition |
|---|---|---|
| **North star** | **Confident next steps** | `next_step_taken` where `answered >= 2`: the visitor answered at least two questions, got a recommendation, and took a next step ("Get my EV plan" or a "Learn more" link). Weekly count, and rate per `landing_viewed` |
| Outcome | Personalized answers delivered | `recommendation_viewed` with `confidence` = high or medium |
| Intent | Fake-door interest | `plan_cta_clicked` / `recommendation_viewed`: would people want a plan follow-up? |
| Funnel | Start rate | `zip_submitted` / `landing_viewed` |
| Funnel | Completion rate | `inputs_completed` / `zip_submitted` |
| Funnel | Recommendation rate | `recommendation_viewed` / `landing_viewed` (A/B primary metric) |
| Funnel | Next-step rate | `next_step_taken` / `recommendation_viewed` |
| Quality | Answer depth | Mean `answered` on `inputs_completed` (4 or 5 questions apply, depending on home charging) |
| Quality | Refinement rate | `refine_clicked` / `recommendation_viewed` where confidence is not high |
| Health | ZIP error rate, data error rate | `zip_error` / `landing_viewed`, `data_load_error` / `zip_submitted` |

The north star counts quality, not volume: a ZIP-only answer is useful, but the product
is working when people tell it enough to get a real answer *and* act on it. Guardrails:
ZIP error rate, early bail-out rate, and the share of "Not yet" verdicts that still take a
next step (an honest "not yet" that leads to a useful plan is a success).

## The funnel

```
landing_viewed -> zip_submitted -> inputs_completed -> recommendation_viewed -> next_step_taken
```

The north star itself: **Product analytics > New insight > Trends**, event `next_step_taken`,
filter `answered >= 2`, weekly.

In PostHog: **Product analytics > New insight > Funnel**, add those five events in order,
conversion window 1 hour, and break down by `messaging_variant` (A/B) or `utm_source`
(channel). Each page load is one anonymous visitor, so "unique users" = visits.

## Event dictionary

The site sends only these events (`site/js/analytics.js` drops anything else).
Every event also carries `messaging_variant`, `$feature/landing-messaging`, and `app_version`.

| Event | When | Properties |
|---|---|---|
| `landing_viewed` | Page loads (A/B exposure event) | none |
| `zip_submitted` | A valid ZIP with data is entered | `state` (2-letter) |
| `zip_error` | ZIP rejected | `reason`: `format` or `not_found` |
| `question_viewed` | A question is shown | `question`, `step` |
| `question_answered` | An answer is submitted | `question`, `answer` (option id) |
| `question_skipped` | "Skip this question" | `question` |
| `questions_skipped_rest` | "Skip the rest and see my results" | `from_question` |
| `inputs_completed` | Questions finished (answered or skipped) | `answered`, `skipped`, `state` |
| `recommendation_viewed` | Results rendered | `tier`, `score_band` (e.g. `70s`), `confidence`, `answered`, `state`, `blockers` |
| `learn_more_clicked` | Any outbound link on the results page | `link_id`, `park` (NPS park code, for park links) |
| `plan_cta_clicked` | "Get my EV plan" (fake door) | `tier` |
| `plan_printed` | "Print or save as PDF" on the plan | none |
| `next_step_taken` | **North star.** First plan click or "Learn more" click in a visit (once per visit) | `type` (`plan` or `learn_more`), `answered`, `confidence`, `tier` |
| `refine_clicked` | "Answer these to sharpen your result" | `skipped` |
| `start_over_clicked` | "Start over with a new ZIP" | none |
| `data_load_error` | A data file failed to load | `stage` |
| `plan_tool_opened` | A plan tool is opened (chargers, cars, test drives) | `tool`: `places`, `cars`, or `testdrive` |
| `place_set` | A place is chosen for a charger search | `slot` (`work`, `lunch`, `home`, `gym`), `method` (`search`, `zip`) |
| `charger_saved` | A charger is saved to the plan | `slot`, `count` (saved for that place) |
| `car_shortlisted` | A car is added to the shortlist | `class` (`suv`, `pickup`), `make`, `count` |
| `finance_mode` | Budget switched between price, loan, and lease | `mode` |
| `test_drive_clicked` | A brand booking or dealer link is opened | `make` |
| `plan_step_done` | A plan step is checked off | `step` (step id, for example `work`) |
| `share_link_copied` | "Copy a share link" | `places` (whether saved places were included) |
| `shared_plan_opened` | Someone opens a share link | none |
| `plan_resumed` | A plan saved on this device is reopened | none |

**Never sent:** the ZIP code (the browser only requests the public data file named for its first three digits, from this same site), searched addresses or place names, latitude/longitude, saved station names or ids, prices or payments the visitor typed, IP address, full user agent, timezone,
URL query strings or fragments, ad click ids (fbclid, gclid, and similar). This is enforced
twice: `track()` only accepts simple values under allowlisted names, and `before_send`
strips everything not on the allowlist from each event. `tests/e2e/privacy.e2e.mjs` checks
the real network payloads.

## Privacy configuration (client side, already done)

| Setting | Value | Effect |
|---|---|---|
| `persistence` | `memory` | No cookies, no localStorage. Nothing to consent to. |
| `autocapture`, `capture_pageview`, `capture_pageleave`, heatmaps, dead clicks, exceptions, performance | off | Only the named events above are sent |
| `disable_session_recording` | `true` | No session replay, so no inputs can be recorded |
| `advanced_disable_flags` | `true` | No feature-flag or remote-config calls |
| `disable_external_dependency_loading` + the vendored `no-external` build | | PostHog cannot load any further scripts |
| `before_send` | `sanitizeEvent` | Allowlist filter on every event |
| `$geoip_disable: true` on every event | | PostHog does not look up city, postal code, or coordinates from the IP |
| Global Privacy Control / Do Not Track | | Analytics never loads |

## Setting up PostHog (Hillary, about 15 minutes)

1. Create a free PostHog Cloud account, **US region** (the CSP allows `us.i.posthog.com`;
   for EU, change `POSTHOG_HOST` in `site/js/config.js` and `connect-src` in `index.html`).
2. Copy the **project API key** (starts with `phc_`) into `POSTHOG_KEY` in
   `site/js/config.js`. This key is designed to be public: it can send events but cannot
   read anything.
3. In **Project settings**, turn on **Discard client IP data**. The client never sends an
   IP property, but PostHog's server sees the request's IP; this setting tells it not to
   keep it. This is required before sharing publicly.
4. Also in project settings, turn off session replay, autocapture, heatmaps, and web
   vitals, and under **Data pipelines** turn off the **GeoIP** transformation. The client
   already disables all of these (GeoIP via `$geoip_disable`); this is belt and braces.
5. **Billing safety:** stay on the free plan without a card, or set a billing limit. The
   project key is public by design, so anyone could send junk events; a limit caps the cost.
6. Create the funnel insight above and save it to a dashboard.
7. Create the experiment: **Experiments > New experiment**, feature flag key
   `landing-messaging`, variants `control` and `adventure` at 50/50. In the experiment's
   exposure settings choose a **custom exposure event: `landing_viewed`**. Primary metric:
   funnel `landing_viewed` -> `recommendation_viewed`. Secondary: funnel
   `recommendation_viewed` -> `learn_more_clicked`. The site assigns variants itself and
   sends `$feature/landing-messaging` on every event, so the flag is never called.
8. Add an internal-traffic filter for `utm_source = internal`, and use that tag when
   testing the live site yourself. Also filter insights to `$host` = your production
   domain so events sent from anywhere else are ignored.
9. **Verify before sharing:** run the check once on the live site, open the event in
   PostHog's activity view, and confirm there is no `$ip` value and no `$geoip_*` properties.
