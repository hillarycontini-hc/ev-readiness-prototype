# Decision logic

The recommendation is rules-based and fully explainable. All of it lives in
[`site/js/logic.js`](../site/js/logic.js), a pure module with no DOM, network, or
analytics code, covered by unit tests in [`tests/logic.test.mjs`](../tests/logic.test.mjs).

## Inputs

| Input | Where it comes from | Used for |
|---|---|---|
| ZIP code | Visitor (required) | Looks up one precomputed record: charging nearby, housing mix, commute, state prices, nearby outdoor destinations |
| Daily driving | Visitor, 5 buckets (under 20 mi to over 100 mi) | Range needed, annual miles |
| Home charging | Visitor: yes / could install / no | Strongest factor; charging cost mix |
| Long trips (200+ mi round trip) | Visitor: rarely / a few a year / monthly / weekly | Fast-charging dependence; annual miles |
| Outdoor trips | Visitor: rarely / a few a year / monthly+ | Whether destination charging counts toward the score |

Every question has a "Skip" option. A skipped question falls back to a prior (below)
and is listed as "assumed" on the results page.

## Cold start: a first-time visitor with only a ZIP

A visitor who enters a ZIP and skips everything still gets a full answer, built from
what is typical where they live:

| Unknown | Prior |
|---|---|
| Daily miles | National average (37 mi/day, FHWA ~13,500 mi/yr) scaled by the ZIP's mean commute relative to the national mean (ACS), clamped to 15-80 mi |
| Home charging | Probability = share of homes in the ZIP that are single-family (ACS B25024). A ZIP that is 80% single-family homes starts at an 80% chance of home charging |
| Long trips | "A few a year" |
| Outdoor trips | "A few a year" |

The result is labeled with a confidence level: **high** (all four answered),
**medium** (one or two assumed), **low** (three or four assumed). The results page
names each assumption and the data it came from, so the visitor sees exactly what
answering would change. This is the same pattern a production personalization system
would use: start from a segment-level prior, update toward the individual as signals
arrive, and be transparent about which is which.

## Scoring

Five factors, each scored 0-100, combined with weights:

| Factor | Weight | How it is scored |
|---|---|---|
| Home charging | 40% | Yes = 100, could install = 85, no = 10-55 depending on how much public charging could substitute. Unknown = probability-weighted blend |
| Range fit | 20% | Range needed = daily miles x 1.5 buffer (winter loss, reserve, battery aging), x 2.5 days if relying on public charging. Score = share of current EV configurations (fueleconomy.gov, two newest model years) rated at or above that need |
| Local public charging | 15% | 60% fast-charger percentile + 40% Level 2 percentile, both within 10 mi, ranked against every US ZIP. Capped at 20 if the nearest fast charger is over 30 mi away |
| Road trips | 15% | Driven by distance from home to the nearest fast charger, and by trip frequency. "Rarely" = 100 |
| Outdoor destinations | 0-15% | Only counts if the visitor takes outdoor trips (0% rarely, 10% a few a year, 15% monthly). For the two nearest destinations: 95 if the round trip fits in 80% of a median EV's range, otherwise scored by fast charging near the park |

Weights are renormalized when the outdoor weight is 0.

### Caps and blockers

- **No home charging caps the verdict.** The maximum score slides from 74 (certainly
  no home charging) to 99 (certainly yes). Without home charging, an EV can work but
  it takes a plan, so it never reads as "Strong fit".
- **No charging access at all** (no home charging, no Level 2 within 5 mi, no fast
  charger within 15 mi) caps the score at 40: "Not yet".
- **Range need beyond every EV on sale** caps the score at 40.

### Verdict tiers

| Score | Verdict |
|---|---|
| 80+ | Strong fit |
| 65-79 | Good fit with a plan |
| 45-64 | Possible, with tradeoffs |
| Under 45 | Not yet |

## Cost estimate

- **Annual miles** = daily miles x 365 + long trips per year x 300 extra miles.
- **Gas** = miles / 27 mpg x the state's (or region's) average regular gasoline price
  over the last six weeks of EIA data.
- **Electric** = miles x median EV efficiency (kWh per 100 mi, EPA, measured at the wall
  so charging losses are included) x a blended price per kWh:
  - Home: state average residential price, EIA, year to date.
  - Public Level 2: $0.27/kWh (approximate; pricing varies widely).
  - DC fast: $0.53/kWh (Paren Q1 2026 U.S. average, excluding free stations).
  - The mix depends on the answers. With home charging, 3% public Level 2 and 5-25% fast
    charging (more with more road trips), the rest at home. Without home charging, 50-70%
    fast charging depending on Level 2 density nearby.

Savings are shown rounded and as "about", because the inputs are averages.

## Outdoor destinations

"Outdoor destinations" are National Park Service units whose designation is a national
park, preserve, recreation area, seashore, lakeshore, or river (116 units). Monuments,
historic sites, memorials, and battlefields are excluded because most are not
trailhead-style destinations. Each ZIP lists up to three destinations within 250 miles
plus the nearest national park if it is not already listed (up to 1,000 miles).

Distances are straight-line x 1.25 to estimate road miles. Charging "near the park" is
measured from the single coordinate the NPS publishes for each unit (often a central
point, not the entrance), so large parks like Yellowstone can look emptier than the
gateway towns really are. The results page says this.

## What it does not do

- It does not recommend a vehicle, brand, or dealer.
- It does not model incentives or tax credits, which change often and vary by buyer.
- It does not route trips. Road-trip readiness is a proxy based on fast chargers near
  home, not a corridor analysis.
- It ignores charger connector type (NACS vs. CCS) and reliability, both of which matter.
