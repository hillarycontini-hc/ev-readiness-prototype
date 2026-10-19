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

## Visual design: "Route" (decided with Hillary, 2026-10-19)

Direction contract: `.impeccable/surfaces/site-index-html.md`. Design system: `DESIGN.md`.

| # | Decision | Why |
|---|---|---|
| 49 | **Replace the plain teal look with "Route"**: saturated gear-catalog color (navy, teal, poppy, citron, aqua, ultraviolet), a big condensed verdict band, one row per factor with the figure on the right, and one colored line running through every row | Hillary wanted vibrant and exciting for a tech-forward, eco-minded millennial family, and chose to combine Gear Spec's color, Terminal Yellow's straight-answer rows, and the Transit Map's line. Each fact now appears once. |
| 50 | Each factor is a "stop" that expands in place; the old reasons list and cards are folded into the stops | The first Gear Spec sketch said everything twice (callouts and cards); one row per fact is easier to follow. |
| 51 | Fonts self-hosted: Big Shoulders Display (verdict, figures) and Schibsted Grotesk (text), both OFL, 82 KB total | The CSP allows fonts only from the site itself; no third-party font host. |
| 52 | Teal band `#0b7f8a`; citron on teal only for bold 19px+ text | Keeps the vibrant teal while meeting AA (white 4.75:1; citron 3.93:1 as large text). |
| 53 | Poppy is a button fill with navy text, never text on the light ground | Poppy on fog is 2.76:1; navy on poppy is 5.62:1. |
| 54 | Helps / Check / Hurts chips differ by form (filled / outlined / dashed), not color | Stop colors already carry identity; valence must not collide with them, and color is never the only signal. |
| 55 | Tier marks are shapes plus words: circle, square, diamond, ringed diamond | Readable without color; mirrors the verdict scale chips. |
| 56 | One motion moment: the line draws down stop by stop when results load; none under reduced motion | The skill's craft floor: one authored moment, not scattered effects. |
| 57 | Landing illustration is authored inline SVG (no image generation available): a loaded family EV climbing the route to a park | Brandless, no photos, consistent with the route language; the strict CSP allows SVG attributes but not inline styles. |
| 58 | A/B variants now reorder the route: savings puts Fuel second, adventure puts Parks second | The old "first card" became "first stop after Home". |
| 59 | Impeccable design skill installed locally (`.claude/`, gitignored) with its edit hooks; its anonymous usage ping is disabled with `IMPECCABLE_NO_TELEMETRY=1` | Hillary asked for the full install; sending usage data to a third party was not something she had agreed to. |

## Plan v2, phase A (October 2026)

Full plan: [`docs/plan-v2.md`](docs/plan-v2.md).

| # | Decision | Why |
|---|---|---|
| 60 | The plan's steps get working tools: chargers near work and lunch, near home and the gym, a car explorer, and test-drive links, plus a partner summary to print or share | Hillary's call: the plan helped with only the first step. "Confident next steps" is the north star, so the steps should be doable on the page. |
| 61 | Address search goes through one Cloudflare Worker (`/api/geocode`) to Geoapify; the key is a Worker secret | No keys in client code. The provider never sees the visitor's IP. The Worker stores and logs nothing (observability off). |
| 62 | The proxy only answers same-origin GET requests, limits each visitor (hashed IP) to 30 searches a minute, filters to the U.S., and times out after 5 seconds | Keeps the key from being used as a free geocoder by other sites. The spend cap is Geoapify's free plan with no card on file: past the free quota it refuses requests rather than billing. |
| 63 | If search is down or limited, the tool offers a ZIP instead | Every tool works with no third-party service, the same rule as the rest of the site. |
| 64 | Station details ship as static half-degree map cells (`data/stations/{i}_{j}.json`) | Chargers near any point load from the same site with no API call. A cell is small and cacheable. |
| 65 | The plan is saved on the device (`localStorage`, key `evrc-plan-v1`) only after the visitor saves something or checks a step | Nothing is stored for a visitor who only reads. "Clear" on the landing page deletes it; "Start over" keeps it so the visitor can resume. |
| 66 | Share links carry the plan after `#` (compressed, then base64url), and are checked field by field when opened | Browsers never send the fragment to a server, so nothing is stored anywhere. A tampered link can't inject content: every value is validated and rendered as text. |
| 67 | Saved places are left out of share links unless the visitor ticks "Include my saved places" | Where someone works or works out is personal. The default is the private choice. |
| 68 | The car explorer lists every fully electric SUV, minivan, and pickup on sale in the U.S., neutrally, sorted only by the visitor's budget | Hillary asked for all options, with Rivian included but not favored. No brand is featured or badged. |
| 69 | Price rule: the least expensive trim orderable today, from the brand's own U.S. site where possible | One comparable number per model. Old stock and discontinued trims would understate prices. |
| 70 | A vehicle with no EPA range rating is left out of the explorer (now: Cadillac Escalade IQ and IQL) | Range is the reason the explorer exists. A guessed range would break the "real data only" rule. |
| 71 | Models not on sale (for example Ford F-150 Lightning, Hyundai Kona Electric) are listed separately with a dated reason, and minivans show "none on sale" | Visitors searching for them get an answer instead of a silent gap. |
| 72 | Loan and lease figures are estimates from editable inputs. Loan APR starts at Experian's average new-car rate (6.35%, Q2 2026); lease residual 50% and money factor 0.0025 are labeled as typical values, not averages | No published average exists for lease terms. The page says to use the dealer's real numbers. |
| 73 | Lease math: (capitalized cost − residual) ÷ months, plus (capitalized cost + residual) × money factor; taxes and fees excluded | The standard formula, shown as "est." and unit tested. |
| 74 | Prices are refreshed monthly, Tesla mid-month, and every model monthly from August to October; the build warns after 35 days | Most brands change prices a few times a year, but Tesla changes without notice and model-year changeover lands in late summer. See [`docs/price-refresh.md`](docs/price-refresh.md). |
| 75 | Test-drive links go only to each brand's own U.S. site: its booking page and its dealer locator, checked in a browser | Hillary chose official links only. No dealer groups or lead sites, so no one is paid for the referral. |
| 76 | A brand link includes the visitor's ZIP only where the brand's page was shown to use it, and the link says "near 80302" | It saves the visitor typing their ZIP again. Saying so in the link and the note keeps the "we only collect your ZIP" promise honest: the visitor chooses to send it, to a brand they picked. |
| 77 | VinFast links to its dealer page only; its test-drive form is on a Salesforce domain | A link to an unfamiliar domain looks like phishing even when it is official. |
| 78 | Analytics for the tools sends only event names and coarse values (slot, method, class, make, counts) | The blocked-name filter (`zip`, `address`, `lat`, `lon`, `name`...) still applies; the privacy test now runs search, save, and share and checks that no address, coordinate, ZIP, or station name is sent. |

## Plan v2, phase B: the trip planner (October 2026)

| # | Decision | Why |
|---|---|---|
| 79 | The plan steps "Plan a charging stop for <park>" and "Rehearse your longest drive" get a trip planner: one destination (a nearby park or a searched place) from home, a real road route, fast-charging stops, a step-through, and saved trips | Hillary's call in plan v2: a real planner in phase B. One destination per trip keeps it from growing into a full trip app (plan-v2 risk table). |
| 80 | Routing goes through the same Worker (`/api/route`) and key as search, with the same rules (same-origin GET, U.S. points, hashed-IP limit, no logs, `no-store`) plus a tighter limit of 6 routes a minute per visitor (`ROUTE_LIMITER`), a site-wide 30 a minute (`ROUTE_GLOBAL_LIMITER`), and the start rounded to about 100 m before it leaves the Worker. Search and routing refuse if their limiter is missing | A route costs more than a search and a visitor plans one at a time. The security review found the same-origin check stops other sites' pages but not scripts, so a site-wide budget keeps a few addresses from draining the quota search also uses. The key never reaches the browser and the provider never sees the visitor's IP. |
| 81 | Routes are capped at 750 straight-line miles (about 1,000 road miles) | "Your longest drive" fits; Geoapify adds a credit per 500 km, so the cap also bounds what one request can cost. |
| 82 | The Worker returns only road miles, drive minutes, and the line thinned to at most 600 points rounded to about 10 m | That is enough to find chargers within 3 miles of the road. No turn-by-turn text or provider ids reach the page, and the response stays small. |
| 83 | Stops come from the static station cells along the route (fast chargers within 3 miles of it), not a live API | Same data and date as the rest of the site, no second key. Availability is not live, and the page says to check the network's app; nothing is guessed. |
| 84 | Stop rule: from each stop, the farthest reachable fast charger, preferring more fast ports among those in the last 10% of reach; a leg counts the road miles plus the detour off the road and back (straight line × 1.25) | Fewest stops, bigger sites when it barely matters, and no leg that only works on paper. Unit tested, including gaps and the 12-stop cap. |
| 85 | Miles between charges start at the lowest EPA range of a shortlisted car ÷ 1.5, or a typical electric SUV's (the median) ÷ 1.5 with no shortlist; the visitor can edit it (40-500) | The same 1.5 buffer as "range you need" (winter, a reserve, battery aging), so the site uses one rule. The daily range need is about daily driving, not road trips, so it isn't the default here. |
| 86 | Plug choice: either (default), CCS only, or NACS. CHAdeMO-only stations are never stops, and a NACS-only stop says other brands need an adapter and not every Tesla station is open to them | No electric SUV, minivan, or pickup on sale uses CHAdeMO. The vehicle table has no plug data, so the visitor chooses, and the caveat is stated rather than guessed. |
| 87 | Trips start from the saved home address if there is one, else the ZIP's center; they are one way | The ZIP center keeps "we collect only your ZIP" true for visitors who saved nothing. The return drive is the same planner from the other end. |
| 88 | Up to 3 saved trips, 12 stops each, validated field by field like the rest of the plan; trips are left out of share links unless "Include my saved places" is ticked | Trips start at home, so they follow the saved-places rule (#67). Limits keep share links short and tampered links harmless. |
| 89 | Trip analytics: `trip_planned` (stops bucket `0`/`1`/`2-3`/`4+`, park or place, result), `trip_saved` (count), `trip_step` (direction) | Enough to see whether the planner is used and finished, with no destination, route, or miles. The privacy browser test checks the real payloads. |
| 90 | On phones an open plan tool spans the full width of the plan, over the line beside it | At 320 px the tools were about 150 px wide; the trip form overflowed. |
