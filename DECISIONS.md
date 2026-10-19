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
