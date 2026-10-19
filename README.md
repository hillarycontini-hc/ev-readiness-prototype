# EV Readiness Check

**Is an EV right for me, even if I rent?** Enter a ZIP code, answer up to five quick
questions, and get a personal, explained answer: where you could charge, the range you
actually need compared with electric SUVs, minivans, and pickups on sale today, what you
would spend on charging versus gas, and whether you can charge on the way to the national
parks near you. Then get a printable plan for what to sort out before you buy.

A working prototype built on free public data. No sign-up, no API keys at runtime, and
nothing personal is stored.

> **Live demo: https://ev-readiness-prototype.hillarycontini.workers.dev** · Or run it locally in two commands (below).
> One-page product brief (user, problem, solution, north star, platform decisions):
> [`docs/product-brief.md`](docs/product-brief.md)

---

## Who it is for

**The EV-curious renter with a full life to haul.** They rent, so home charging is possible
(with a landlord's help) or not available. They plan to buy their next car in the next
12-18 months, take trips to parks and trailheads, and need room for car seats, a dog, and
gear.

It is the hardest common case, and the one generic EV content serves worst: "just charge
at home overnight" doesn't apply. If the tool earns this person's trust, it works for
easier cases too.

## The problem

> *"I can't tell whether an EV fits my life where I live, so I stall."*

Four doubts block this person, in this order:

- *Can I charge reliably if I rent?*
- *Is the range enough for how I drive, in winter, with a loaded car?*
- *Will it save me money here, if I sometimes pay public charging prices?*
- *Can I get to the parks I go to, and charge when I'm there?*

The answers depend on where you live and how you live. Generic content ("most people drive
less than 40 miles a day") does not move an individual. A short, personal answer with the
reasoning shown might.

## How it works

1. **ZIP first.** One field. The browser loads a small (5-15 KB) precomputed file for that
   ZIP prefix.
2. **Up to five optional questions,** one per screen: daily driving, home charging (including
   "I rent and could ask my landlord"), long drives, and outdoor trips. A question about
   charging at work or another daytime spot appears only when home charging is uncertain.
   Every question can be skipped.
3. **A verdict with reasons:** Strong fit, Good fit with a plan, Possible with tradeoffs, or
   Not yet. Each reason says whether it works for or against you. Four cards follow:
   charging, range, cost, and outdoor trips.
4. **"Get my EV plan."** A checklist built from the answers: who to ask about charging, what
   to shop for, which park trips need a charging stop, and what to bring to a test drive.
   This is a fake-door test for lead capture. It measures interest and says plainly that
   nothing was collected.

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
| Daytime charging | Not available (conservative) | Default |
| Long drives, outdoor trips | A few times a year | Default |

**Then it updates.** Each answer replaces a default, and some answers change which questions
come next. The results page lists exactly what was assumed, labels the result high,
medium, or low confidence, and offers "Answer these to sharpen your result". A ZIP-only
visitor never sees "Strong fit": that verdict requires knowing about home charging, the
factor that matters most.

**Scoring.** Five factors with stated weights: regular charging at home or during the day
(40%), range fit (20%), public charging nearby (15%), road-trip charging (15%), and charging
near outdoor destinations (up to 15%, only if you take those trips). Caps keep it honest:
without a regular place to charge, the verdict tops out at "Good fit with a plan", and
with no charging access at all it is "Not yet".

**Explainable by design.** Every number on the results page traces to a source or a stated
assumption, shown under "How we calculated this".

## North star and measurement

Full detail: [`docs/analytics.md`](docs/analytics.md).

**North star: confident next steps.** These are visits in which someone answered at least
two questions, got a recommendation, and took a next step ("Get my EV plan" or a "Learn
more" link). It requires both halves of the value: a personal answer for the visitor and
movement down the funnel. Page views and bounces don't count. It is sent as a single
`next_step_taken` event per visit, so it is one PostHog insight.

**Funnel** (PostHog, free tier):

```
landing_viewed -> zip_submitted -> inputs_completed -> recommendation_viewed -> next_step_taken
```

Plus quality metrics (answer depth, refinement rate), fake-door interest
(`plan_cta_clicked`), and health metrics (ZIP error rate, data load errors). Every event is
listed in an event dictionary with its properties.

**A/B test: which promise brings people in?** Savings messaging ("Could an EV save you
money?") versus adventure messaging ("Can an EV keep up with your adventures?"), which also
changes which results card comes first. One-page plan with hypothesis, primary metric,
guardrails, and a decision rule written before launch:
[`docs/test-plan.md`](docs/test-plan.md).

It includes an honest power analysis: at a few hundred visitors, only a very large effect
is detectable, so "inconclusive" is the most likely result. The point is the complete loop,
set up the way it would run at real traffic.

## Design

The look is called **Route**: saturated outdoor-gear color, one straight answer per row, and one
colored line running through every row like a subway line diagram, from home to the park. It was
chosen with Hillary from a structured design round (three directions, then a combination of the
parts she liked), built to WCAG 2.1 AA in light and dark mode, and reviewed by an independent
finish reviewer before shipping. The system is documented in [`DESIGN.md`](DESIGN.md).

## Platform decisions

| Area | Decision |
|---|---|
| Backend | **None for v1.** Static site; the "database" is precomputed public data in versioned JSON. Nothing to secure, pay for, or breach. |
| Database (when needed) | Cloudflare D1 (SQLite) with Workers, for example to rate-limit a future chat mode. Supabase only if accounts or saved results become a goal. |
| Authentication | **None for visitors.** That keeps the privacy promise and the funnel friction-free. Admin access is through GitHub, Cloudflare, and PostHog accounts with 2FA. |
| Testing | Unit tests, browser tests (privacy payloads, axe accessibility, keyboard), and build-time data checks, all running in GitHub Actions on every push and pull request. |
| Version control | Git and GitHub, with CI on every change, Dependabot, and data refreshes as reviewable diffs. |

## Privacy approach

Privacy is a product requirement here, not a footnote:

- **Collect the minimum.** A ZIP and up to five multiple-choice answers. No name, email, or account. The "Get my EV plan" step asks for nothing.
- **The ZIP never leaves the browser.** The browser only requests the public data file
  named for the ZIP's first three digits from the same site. The ZIP is never sent to
  analytics, and PostHog's IP-based location lookup is switched off. Events carry the
  state (for example, CO) instead.
- **No cookies, no local storage, no consent banner needed.** Analytics identity lives in
  memory for one page view.
- **No session replay, no autocapture.** Only 16 named events are sent, and an allowlist
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
3. **Personalize the flow further.** The daytime-charging question already appears only
   when home charging is uncertain. Next: reframe questions the ZIP already answers well (a
   95% single-family ZIP needs a different home-charging question than a dense downtown one),
   and test question order (ZIP-first vs. lifestyle-first).
4. **Route real trips.** Replace the fast-charger-near-home proxy with corridor analysis to
   the visitor's own destinations, using charger reliability and connector type (NACS/CCS).
5. **Add trailheads.** USFS, BLM, and OpenStreetMap trailheads, with data-quality filtering.
6. **Turn the fake door into real lead capture, if the interest is there.** If the
   "Get my EV plan" click rate justifies it, offer to email the plan with explicit consent,
   stored in Cloudflare D1 with a retention limit and one-click deletion. Map answers to
   vehicle class, range, and charging equipment needs, and hand off to configuration with
   those choices pre-filled.
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
| `npm test` | Unit tests for the decision logic, analytics filter, and vendored library |
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
