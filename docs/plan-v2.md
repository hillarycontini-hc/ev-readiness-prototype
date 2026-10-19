# Plan v2: from "Is an EV right for me?" to a plan you can act on

Status: **proposed, not started.** Decisions below were made with Hillary on 2026-10-19.

## Why

Today the EV plan helps with step 1 and leaves the rest as advice. v2 carries the visitor through
all seven steps, ending with a printable summary a partner can read: how an EV fits their week,
what it would cost, and how doable it is. It extends the funnel from discovery into consideration,
configuration, and a test-drive lead.

North star stays **confident next steps**. New supporting metric: **plan steps completed** per
visit (a step counts when the visitor saves, shortlists, plans, or opens a test-drive link in it).

## Decisions

| Area | Decision |
|---|---|
| Places (work, gym, lunch) | **Address and place search** through a geocoding service, called only from our own server-side proxy (the visitor's IP and our key never reach the provider; we keep no logs of queries) |
| Car costs | **Starting MSRP + monthly loan** (down payment, APR, term) **+ lease estimate** with stated, editable assumptions (residual %, money factor, term, due at signing), labeled as a rough estimate |
| Trip planner | **Real routing with charging stops**, saved and step-through, in **phase B** |
| Saving | **On this device** (browser storage) **+ print/PDF + a share link** that carries the plan inside the link itself (never sent to our server) |
| Vehicles | Every **fully electric** SUV, minivan, and pickup on sale, listed **neutrally** (no brand featured, sorted only by the visitor's filters). No hybrids |
| Test drives | **Official brand links only** (each brand's own test-drive or dealer finder, ZIP filled in where supported); no third-party dealer listings |
| Build order | **A0, then A, then B**. While the Geoapify key and Worker approval are pending, build the parts that need neither first: car explorer, station shards, device storage, share link, summary |
| Provider | **Geoapify** (geocoding, places, routing under one key; free tier about 3,000 credits/day). Confirm limits and terms on its official pricing page before building |
| Backend | One small **Cloudflare Worker** proxy (`/api/geocode`, `/api/places`, `/api/route`): hides the key, rate-limits per visitor, caps daily spend, logs nothing personal. Everything else stays static |

## Step by step

| Step | v2 experience | Data and mechanism | Phase |
|---|---|---|---|
| 1. Ask your landlord | Unchanged; optional printable request note | Static | A |
| 2. Charging at work | Search the work address; also search a lunch spot near work. See public chargers near each, sorted by distance, with level, ports, and network. Save the ones that fit | Proxy geocode/places, then chargers from precomputed NREL station shards (static, no live NREL key) | A |
| 3. Chargers near home and the gym | Same tool for home, gym, school, any place; one saved list per place | Same | A |
| 4. Choose a car | Browse all electric SUVs, minivans, pickups. Filter by max price, max monthly loan payment, or max lease payment; set down payment, APR, term. Range, efficiency, and seating shown. Shortlist up to 3 | fueleconomy.gov for range and efficiency; a **curated price table** (starting MSRP, source URL, date) built from automaker sites and refreshed monthly; payment and lease math in the browser | A |
| 5. Charging stop for a far park | Pick the park and a shortlisted car (or a typical range); see the route with every charging stop; save the trip | Proxy routing, then a stop-planning algorithm over NREL fast chargers near the route using the car's range and a buffer | B |
| 6. Rehearse your longest drive | Same planner for any trip; step through legs with Next and Back; save | Same | B |
| 7. Test drive | For each shortlisted car, the brand's official test-drive or dealer finder, ZIP filled in where the brand supports it | Curated brand link table | A |
| Finish | One-page summary to print, save as PDF, or share by link: verdict, saved chargers, shortlisted cars with monthly cost, trips, remaining steps | In the browser | A, extended in B |

## Privacy (updated promise)

- Searched addresses go to the geocoding provider **through our proxy**, so the provider never sees
  the visitor's IP and we store nothing. The page says this in plain words at the search box.
- Saved places, chargers, cars, and trips live **only in the visitor's browser** until they share.
- The share link carries the plan in the part of the URL after `#`, which browsers never send to a
  server. Before copying, the visitor chooses whether to **include saved places** (off by default),
  with a plain warning that anyone with the link can see them.
- Analytics never receives addresses, coordinates, station IDs near a place, or vehicle prices the
  visitor typed; only event names and coarse properties (step, counts, vehicle class). The privacy
  test is extended to search, save, and share flows.
- PRODUCT.md and the footer copy are updated before launch.

## Phases

**Phase A0, foundation.**
- The Worker proxy with rate limiting and a spend cap.
- Station shards with per-station detail.
- Device storage and the share-link format.
- Privacy copy and tests.

**Phase A, the static-plus-proxy steps.**
- Steps 2, 3, 4, and 7, plus the summary, print, and share link.
- New analytics events and the plan-steps-completed metric.
- An Impeccable finish review on the new surfaces.

**Phase B, the trip planner.**
- Routing, the charging-stop algorithm, step-through, and saved trips.
- Trips in the summary.

Each phase ships as its own pull request with unit tests (payment, lease, and stop-planning math),
browser tests (accessibility, privacy payloads), and a design review.

## What Hillary will need to do

- Create a free **Geoapify** account and keep the API key ready (it goes into the Worker as a
  secret, never into the repo).
- Approve deploying the **Worker** on the existing Cloudflare account.
- ~~Decide who refreshes vehicle prices monthly~~ Decided: monthly, Tesla mid-month, every model
  August to October. Checklist: [`price-refresh.md`](price-refresh.md).

## Risks

| Risk | Mitigation |
|---|---|
| Prices and lease deals change monthly | Show "starting MSRP as of <date>" with source links; lease shown as an editable estimate, never a quote |
| Free-tier limits or a traffic spike | 30 searches a minute per visitor in the Worker; Geoapify's free plan with no card refuses requests past its quota instead of billing; graceful "search unavailable, try a ZIP" fallback |
| Station data goes stale | Monthly data rebuild already planned; show "stations as of <date>" |
| Scope creep into a full trip app | Phase B is limited to one destination per trip with fast-charging stops |
| Appearing to favor a brand | Neutral list, no featured placement, sorting by visitor filters only |
