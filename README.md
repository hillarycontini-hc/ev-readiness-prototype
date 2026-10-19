# EV Readiness Check

**Is an EV right for me?** Enter a ZIP code, answer up to four quick questions, and get a
personal, explained answer: public charging near you, the range you actually need compared
with EVs on sale today, what you would spend on charging versus gas, and whether you can
charge on the way to the national parks near you.

A working prototype built on free public data. No sign-up, no API keys at runtime, and
nothing personal is stored.

> Live demo: _not deployed yet_ · Run it locally in two commands (below).

---

## The problem

Most people who are curious about an EV stall on the same few questions, and none of them
are about the car:

- *Can I charge where I live?*
- *Is the range enough for how I actually drive, including winter?*
- *Will it really save me money here, at my electricity and gas prices?*
- *What about the trips that matter to me: the long drive, the weekend at the park?*

The answers depend on where you live and how you live. Generic content ("most people drive
less than 40 miles a day") does not move an individual. A short, personal answer with the
reasoning shown might.

## Who it is for

EV-curious drivers early in the funnel: not yet comparing models, still deciding whether an
EV fits their life. Especially people who drive to the outdoors, where charging anxiety is
sharpest and generic answers are least convincing.

## How it works

1. **ZIP first.** One field. The browser loads a small (5-15 KB) precomputed file for that ZIP prefix.
2. **Four optional questions,** one per screen: daily driving, home charging, long drives,
   outdoor trips. Every question can be skipped.
3. **A verdict with reasons:** Strong fit, Good fit with a plan, Possible with tradeoffs, or
   Not yet. Each reason says whether it works for or against you, then four cards
   (charging, range, cost, outdoor trips) and "Learn more" next steps.

## How personalization works

The recommendation is a transparent, unit-tested rules engine
([`site/js/logic.js`](site/js/logic.js), write-up in
[`docs/decision-logic.md`](docs/decision-logic.md)).

**Cold start.** A first-time visitor with only a ZIP still gets a full answer, built from
what is typical where they live:

| If we don't know... | we assume... | from |
|---|---|---|
| Daily driving | National average scaled by the ZIP's mean commute | Census ACS commute times |
| Home charging | A probability equal to the ZIP's share of single-family homes | Census ACS housing type |
| Long drives, outdoor trips | A few times a year | Default |

**Then it updates.** Each answer replaces a prior. The results page lists exactly what was
assumed, labels the result high, medium, or low confidence, and offers "Answer these to
sharpen your result". A ZIP-only visitor never sees "Strong fit": that verdict requires
knowing about home charging, the factor that matters most.

**Scoring.** Five factors with stated weights: home charging (40%), range fit (20%), public
charging nearby (15%), road-trip charging (15%), and charging near outdoor destinations (up
to 15%, only if you take those trips). Caps keep it honest: without home charging the
verdict tops out at "Good fit with a plan", and with no charging access at all it is
"Not yet".

**Explainable by design.** Every number on the results page traces to a source or a stated
assumption, shown under "How we calculated this".

## Measurement framework

Full detail: [`docs/analytics.md`](docs/analytics.md).

**Outcome metric:** personalized answers delivered, meaning a recommendation viewed by a
visitor who answered at least two of the four questions. It counts useful answers, not
page views.

**Funnel** (PostHog, free tier):

```
landing_viewed -> zip_submitted -> inputs_completed -> recommendation_viewed -> learn_more_clicked
```

Plus quality metrics (answer depth, refinement rate) and health metrics (ZIP error rate,
data load errors). Every event is listed in an event dictionary with its properties.

**A/B test: which promise brings people in?** Savings messaging ("Could an EV save you
money?") versus adventure messaging ("Can an EV keep up with your adventures?"), which also
changes which results card comes first. One-page plan with hypothesis, primary metric,
guardrails, and a decision rule written before launch:
[`docs/test-plan.md`](docs/test-plan.md).

It includes an honest power analysis: at a few hundred visitors, only a very large effect
is detectable, so "inconclusive" is the most likely result. The point is the complete loop,
set up the way it would run at real traffic.

## Privacy approach

Privacy is a product requirement here, not a footnote:

- **Collect the minimum.** A ZIP and four multiple-choice answers. No name, email, or account.
- **The ZIP never leaves the browser.** The browser only requests the public data file
  named for the ZIP's first three digits from the same site. The ZIP is never sent to
  analytics, and PostHog's IP-based location lookup is switched off. Events carry the
  state (for example, CO) instead.
- **No cookies, no local storage, no consent banner needed.** Analytics identity lives in
  memory for one page view.
- **No session replay, no autocapture.** Only 13 named events are sent, and an allowlist
  filter strips everything else, including URL query strings, ad click ids, full user agent,
  and timezone.
- **Global Privacy Control and Do Not Track are respected:** analytics does not load at all.
- **No secrets in the client.** All data is precomputed at build time into static JSON, so
  the live site calls no data APIs and holds no keys.
- **Verified, not just configured.** A browser test intercepts the real analytics traffic
  and asserts that the ZIP never appears, nothing is stored, and only allowlisted fields
  are sent ([`tests/e2e/privacy.e2e.mjs`](tests/e2e/privacy.e2e.mjs)).

Security posture and the launch checklist: [`docs/security.md`](docs/security.md).

## Accessibility

Built to WCAG 2.1 AA: one labeled question per screen, full keyboard support, focus moved to
each new view, errors announced and tied to their field, color never the only signal, and
contrast checked in light and dark mode. axe-core runs on every view in both themes and at
320 px wide with zero violations. A real screen-reader pass is the remaining step. Details:
[`docs/accessibility.md`](docs/accessibility.md).

## Data

All free and public, downloaded and precomputed by `npm run data`:

| Source | Used for |
|---|---|
| NREL Alternative Fuels Data Center (82,600 public EV stations) | Charging counts and distances per ZIP and per park |
| fueleconomy.gov / EPA (492 current EV configurations) | Range distribution and efficiency |
| U.S. Census Bureau ACS 2024 5-year, ZCTA Gazetteer | Housing type, commute time, ZIP locations |
| EIA | State residential electricity prices, regional gasoline prices |
| National Park Service API (116 outdoor park units) | Outdoor destinations |

Every assumption that is not from these sources (gas car mpg, public charging prices, range
buffer) is listed in [`DECISIONS.md`](DECISIONS.md) and on the results page.

## What I would do next with real data

1. **Learn the weights instead of setting them.** The factor weights are reasoned, not
   fitted. With outcome data (test drives, orders, or a follow-up "did you buy?" survey),
   fit them to what actually predicts a confident purchase, and check calibration by segment.
2. **Measure the value of personalization itself.** Hold out a group that sees a generic
   results page and compare downstream conversion. That is the number that justifies the
   personalization investment.
3. **Personalize the flow, not just the answer.** Skip or reframe questions the ZIP already
   answers well (a 95% single-family ZIP needs a different home-charging question than a
   dense downtown one), and test question order (ZIP-first vs. lifestyle-first).
4. **Route real trips.** Replace the fast-charger-near-home proxy with corridor analysis to
   the visitor's own destinations, using charger reliability and connector type (NACS/CCS).
5. **Add trailheads.** USFS, BLM, and OpenStreetMap trailheads, with data-quality filtering.
6. **Connect discovery to configuration and lead capture.** Map answers to vehicle class,
   range, and charging equipment needs, hand off to configuration with those choices
   pre-filled, and capture a lead only with explicit consent.
7. **Agentic discovery, safely.** An optional chat mode that explains this visitor's result
   in conversation, grounded only in the computed result and the sources, behind a
   serverless proxy with rate limits and a hard spending cap, with evaluations for
   accuracy and refusals before launch.
8. **Keep the data fresh.** A scheduled monthly rebuild (GitHub Actions) with checks that
   fail the build if station counts or prices move suspiciously.

## Run it locally

Requires Node 20+.

```bash
npm install
npm run serve
```

Then open http://localhost:8080. Analytics stays off until a PostHog project key is added to
[`site/js/config.js`](site/js/config.js).

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the decision logic and analytics sanitizer |
| `npm run test:e2e` | Browser tests: accessibility (axe, keyboard, reflow) and privacy (real analytics payloads). First run: `npx playwright install chromium` |
| `npm run data` | Re-download all public data and rebuild `site/data/` (a few minutes, about 200 MB of downloads) |
| `npm run vendor` | Refresh the vendored PostHog library after upgrading it |

## Repository map

```
site/                 the whole website (deploy this folder)
  index.html          markup, Content-Security-Policy
  js/logic.js         decision engine (pure, unit tested)
  js/app.js           UI flow and rendering
  js/analytics.js     privacy-first PostHog wrapper and A/B assignment
  js/copy.js          all visitor-facing text, including both A/B variants
  data/               precomputed JSON (one shard per 3-digit ZIP prefix)
  vendor/             pinned PostHog browser build
scripts/data/         download and precompute public data
tests/                unit tests and browser tests
docs/                 decision logic, analytics, test plan, accessibility, security
DECISIONS.md          every default decision and why
```

## Limitations

Estimates only, not financial advice. Distances are straight-line (road miles estimated at
1.25x). Park charging is measured from one point per park, which can understate gateway-town
charging for large parks. Incentives, purchase price, insurance, and maintenance are not
modeled. ZIPs without a Census ZCTA (some PO-box and single-business ZIPs) are not covered.

---

An independent prototype by Hillary Contini. Not affiliated with any automaker or dealer.
Code under the [MIT License](LICENSE); data from U.S. federal sources.
