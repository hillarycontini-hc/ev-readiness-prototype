# Decisions

Default decisions made while building, with the reason for each. Anything marked
**Hillary to confirm** is a reasonable default that she may want to change.

## Project setup

| # | Decision | Why |
|---|---|---|
| 1 | Separate repo at `C:\dev\ev-readiness-prototype`, not inside the job-search repo | The job-search repo holds private context. This one is meant to be public. |
| 2 | MIT license | Standard for a public portfolio prototype. All data sources are U.S. federal data (public domain). **Hillary to confirm.** |
| 3 | Plain HTML, CSS, and JavaScript. No framework, no bundler | Small, auditable, fast, and nothing to keep patched. A reviewer can read the whole client in one sitting. Node is used only for build-time data scripts and tests. |
| 4 | Product name: "EV Readiness Check" | Descriptive and neutral. No automaker names, logos, colors, or styling anywhere on the site. **Hillary to confirm or rename.** |

## Data

| # | Decision | Why |
|---|---|---|
| 5 | Precompute everything at build time into static JSON (`site/data/`) | The live site needs no API keys, no server, and no third-party calls for data. Nothing to rate-limit or leak. |
| 6 | Shard per-ZIP data by 3-digit ZIP prefix (891 files, about 4-16 KB each) | The browser downloads one small file for the ZIP typed, not a 7 MB national file. |
| 7 | NREL and NPS fetched with the public `DEMO_KEY` | One call each is well inside the demo limits. `NREL_API_KEY` / `NPS_API_KEY` environment variables override it; keys are never written to disk. Hillary does not need to create these accounts unless she wants scheduled refreshes. |
| 8 | NREL's API host is now `developer.nlr.gov` | NREL moved the developer API in 2026; the old host no longer answers. |
| 9 | Census data from the ACS 2024 5-year bulk summary files, not the Census API | The Census API now requires a key. The bulk files do not, and one download covers every ZIP. |
| 10 | ZIP = Census ZCTA. State = the county with the most land in the ZCTA | ZCTAs are what ACS and the Gazetteer publish. A few ZIPs (PO boxes, single buildings) have no ZCTA; the site says it does not have data for them. |
| 11 | Home-charging prior = share of single-family homes (detached + attached) | The best public proxy for "has a driveway or garage". Owner-occupancy is stored too but not used in scoring; renters in single-family homes often can charge. |
| 12 | Gas prices: EIA weekly regular gasoline, six-week average, by state where EIA publishes one (9 states), otherwise by PADD region | Free, official, no key. AK and HI use the West Coast (less California) average, which understates both; noted in the UI's sources. |
| 13 | Electricity: EIA Electric Power Monthly Table 5.6.B, residential, year to date | Year to date smooths out summer peaks in single-month data. |
| 14 | Public charging prices are fixed assumptions: DC fast $0.53/kWh (Paren Q1 2026 U.S. average excluding free stations), public Level 2 $0.27/kWh (approximate) | No free official national series exists. Both are shown on the results page as assumptions. |
| 15 | Gas comparison car = 27 mpg | Recent new-vehicle real-world average (EPA Automotive Trends). |
| 16 | "Current EVs" = fueleconomy.gov EV rows for the two newest model years (2026-2027), one per make/model/year/range/efficiency | Reflects what is on sale now; trims with identical specs are counted once. |
| 17 | Outdoor destinations = 116 NPS units (national parks, preserves, recreation areas, seashores, lakeshores, rivers). Trailheads are not included | Trailhead data is fragmented across USFS, BLM, state agencies, and OpenStreetMap, with uneven quality. NPS units are consistent, nationally recognizable, and free. Trailheads are a "next" item in the README. |
| 18 | Distances are straight-line x 1.25 for road miles | Good enough for a readiness signal; a routing API would need a key at runtime. |

## Decision logic

| # | Decision | Why |
|---|---|---|
| 19 | Rules-based scoring first; no Claude chat mode in v1 | A rules engine is explainable, testable, free to run, and has no prompt-injection or spend risk on a public page. The chat mode is a stretch goal that needs a serverless proxy with rate limits and a spending cap; see README "What I would do next". |
| 20 | Home charging weighted 40% and caps the verdict when absent | It is the single biggest predictor of EV satisfaction and cost. A visitor without it should hear "possible with a plan", never "strong fit". |
| 21 | Every question has "Skip", and skipped answers fall back to ZIP-level priors with a visible confidence level | Handles cold start honestly and shows the personalization mechanism instead of hiding it. |

## Analytics and the A/B test

| # | Decision | Why |
|---|---|---|
| 22 | PostHog in memory-only mode (no cookies, no localStorage), no autocapture, no session replay | No consent banner needed, nothing persists on the visitor's device, and only named events are sent. Each page load is one anonymous visitor; the whole funnel happens within one page load, so funnels still work. |
| 23 | Vendor the pinned posthog-js `no-external` build into `site/vendor/` instead of loading PostHog's CDN snippet | The CSP can stay `script-src 'self'`, the exact code is reviewable in the repo, and the library cannot fetch extra scripts at runtime. `npm run vendor` refreshes it. |
| 24 | A/B assignment in the browser (50/50 per visit), reported to PostHog as `$feature/landing-messaging` with `landing_viewed` as a custom exposure event | PostHog feature flags need a stable stored identity to be consistent; we store none. PostHog supports experiments with outside assignment. Tradeoff: a reload can switch the variant (documented in the test plan). |
| 25 | Test messaging (savings vs. adventure), not question order | Messaging maps to a real upper-funnel decision (which promise brings people in), it can change the landing page and the results order without touching the scoring, and question order is already tuned for cold start (ZIP first). |
| 26 | Primary metric = landing to recommendation, not learn-more clicks | Higher base rate, so it is the most detectable metric at small traffic. Learn-more is reported as secondary. |
| 27 | Respect Global Privacy Control and Do Not Track by not loading analytics | Simple, honest, and visible in the privacy note. |
| 28 | Keep UTM tags, drop ad click ids, trim URLs to origin + path, drop full user agent and timezone | UTM tags let Hillary compare LinkedIn vs. cohort traffic. Click ids are cross-site identifiers; query strings and fragments can carry anything. |
| 29 | "Turn off analytics for this visit" button does not call `posthog.opt_out_capturing()` | That call writes the choice to localStorage. Our wrapper simply stops sending. |
| 30 | Analytics tests present the headless test browser as desktop Chrome | posthog-js silently drops events from headless browsers as bots. Real visitors are unaffected. |

## Security, accessibility, and hosting

| # | Decision | Why |
|---|---|---|
| 31 | Recommend Cloudflare Pages; GitHub Pages acceptable | Both free. Cloudflare applies `site/_headers` (real CSP with `frame-ancestors`, `X-Frame-Options`, `Permissions-Policy`); GitHub Pages cannot set headers. **Hillary to choose.** |
| 32 | Strict CSP in a `<meta>` tag as well as `_headers` | Protects the page on any host, including GitHub Pages. |
| 33 | `$geoip_disable: true` on every PostHog event | PostHog's server would otherwise add postal code and coordinates from the IP, which would contradict "never your ZIP". |
| 34 | Security review done by an independent reviewer agent instead of the `security-review` skill | The skill reviews only changes not yet pushed to `origin`, so it cannot cover an initial build. Use it on future changes before pushing. |
| 35 | A ZIP-only (cold start) result is capped at "Good fit with a plan" | Found in the screen-reader review: Boulder with zero answers read "Strong fit" on a 46% guess about home charging. |
| 36 | Each question is the view's `h1` inside the fieldset legend, and gets focus | Screen readers hear "Question 2 of 4: ..." once; previously it was announced three times. |
| 37 | Real screen-reader testing left to a person | Automated checks (axe, keyboard, accessibility tree) cannot replace NVDA/VoiceOver; listed in the go/no-go. |

## Fundamentals (decided with Hillary, 2026-10-19)

Full write-up: [`docs/product-brief.md`](docs/product-brief.md).

| # | Decision | Why |
|---|---|---|
| 38 | **North star: confident next steps.** Visits with 2+ answers, a recommendation, and a next step (EV plan or Learn more), sent as one `next_step_taken` event per visit | Requires both a personal answer and funnel movement; hard to inflate. One event makes it a single PostHog insight. |
| 39 | **Primary persona: EV-curious renter** with possible or no home charging, buying in 12-18 months, takes park trips, needs room for car seats, a dog, and gear | The hardest common case and the one generic EV content serves worst. |
| 40 | Home-charging question adds "I rent and could ask my landlord" (50% odds, an assumption) | Renters' real situation is "maybe", not yes or no. |
| 41 | New daytime-charging question, asked only when home charging is not yes or could install. Counts at 80% reliability; priced like public Level 2 | Workplace and daytime charging is how many renters make EVs work. Asking only when it matters keeps the flow short. |
| 42 | Range and efficiency compared against electric SUVs, minivans, and pickups (343 configurations), not all EVs | The persona needs space for car seats, a dog, and gear. Stated on the results page. |
| 43 | **Lead capture: fake-door "Get my EV plan."** Counts intent, says plainly nothing was collected, then shows a real printable checklist | Shows lead-capture thinking and measures demand with zero personal data. Real capture waits until the click rate justifies it. |
| 44 | **Backend: none for v1.** Future server-side needs go to Cloudflare Workers + D1; Supabase only for accounts or saved results | Nothing to secure or pay for; keeps the privacy promise simple and true. |
| 45 | **Authentication: none for visitors.** Admin via GitHub, Cloudflare, and PostHog accounts with 2FA; Cloudflare Access for any future internal page | A login wall contradicts the privacy promise and costs upper-funnel conversion. |
| 46 | **Testing in CI:** GitHub Actions runs unit and browser tests on every push and pull request; the data build fails on out-of-range values; a test fails if the vendored PostHog file drifts from the pinned package | Privacy and accessibility stay tested as the code changes. |
| 47 | **Version control:** Dependabot (npm weekly, Actions monthly). Branch protection, secret scanning, and push protection are GitHub settings for Hillary to turn on | Settings require the repo owner's account. |

## Hosting

| # | Decision | Why |
|---|---|---|
| 48 | **Hosted on Cloudflare Workers static assets** (supersedes #31's Pages recommendation), deployed by Workers Builds on every push to `main` | Cloudflare's dashboard now creates Workers by default, and Workers static assets also apply `site/_headers`. `wrangler.jsonc` serves only `site/`, so docs, tests, and scripts are never published. No Worker script runs. |
