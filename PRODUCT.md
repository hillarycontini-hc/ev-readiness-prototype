# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the EV-curious renter with a full life to haul.** They rent, so charging where
they park overnight is possible (with a landlord's help) or not available. They plan to buy
their next car in the next 12-18 months and are still deciding whether it could be electric;
they are not yet comparing models. They take trips to parks, trailheads, and campgrounds, and
need room for car seats, a dog, and outdoor gear, so they shop SUVs, minivans, and pickups.

Their job: find out, in a minute or two, whether an EV fits their life where they live, and
what they would need to sort out first.

**Secondary (the repository, not the product):** a hiring manager reading the code and docs to
judge how the work was framed, measured, and built.

## Product Purpose

People stall on EVs over questions that are not about the car: *Can I charge if I rent? Is the
range enough with a loaded car in winter? Will it save money at my prices? Can I get to the
parks I go to?* Generic answers don't settle them.

EV Readiness Check takes a ZIP code and up to five optional questions and returns an explained
verdict (Strong fit, Good fit with a plan, Possible with tradeoffs, Not yet), four supporting
cards (charging, range, cost, outdoor trips), and a printable plan of next steps.

**Success (north star): confident next steps.** Visits in which someone answered at least two
questions, received a recommendation, and took a next step ("Get my EV plan" or a "Learn more"
link). An honest "Not yet" that leads to a useful plan counts as success.

## Positioning

A personal, explained answer built from public data, with nothing collected. Every number traces
to a named public source or a stated assumption, the page shows what it assumed and how
confident it is, and it is built around the renter case that generic "charge at home overnight"
advice ignores. It recommends no vehicle, brand, or dealer.

## Operating Context

- One page, one question per screen, ZIP first. Every question can be skipped; skipped answers
  use ZIP-level defaults and lower the stated confidence.
- A daytime-charging question appears only when home charging is uncertain.
- Results are read on phones as often as desktops, often right after a social post or a shared
  link.
- The "Get my EV plan" step is a fake-door test: it counts interest, says plainly that nothing was
  collected, and shows a checklist that can be printed or saved as PDF.
- Shared publicly (an AI cohort, LinkedIn); traffic is small, so the A/B test (savings vs.
  adventure landing message) is directional.

## Capabilities and Constraints

- Static site: plain HTML, CSS, and JavaScript, no framework, no backend, no visitor accounts.
  Hosted on Cloudflare Workers static assets from `site/`.
- All data is precomputed at build time into static JSON; the live site calls no data APIs and
  holds no keys.
- Strict Content-Security-Policy: scripts, styles, fonts, and images from the site itself only;
  the one outside connection is the analytics endpoint. Any new external asset (for example a
  web font) needs a deliberate CSP change.
- Privacy: the ZIP never leaves the browser except as a request for a same-site data file named
  for its first three digits; analytics is anonymous, cookieless, and never includes the ZIP.
  Nothing on the page may ask for contact details.
- All rendering uses `textContent`; nothing typed by a visitor is inserted as HTML.
- Terminology: "Strong fit / Good fit with a plan / Possible, with tradeoffs / Not yet"; "Level 2"
  and "fast charging" (DC fast); "daytime charging" for work or other places the car sits for hours.
- Open: whether the "Get my EV plan" fake door becomes real, consented lead capture depends on
  its click rate. A chat mode is a v2 candidate, not committed.

## Brand Commitments

- Name: **EV Readiness Check** (confirmed).
- Voice: **a knowledgeable friend.** Plain-spoken and honest; says "not yet" when that is true,
  shows its work, no hype or sales tone.
- Independent prototype by Hillary Contini. It must not use any automaker's name, logo, or visual
  identity, and states that it is not affiliated with any automaker or dealer.

## Evidence on Hand

- Public data, precomputed in `site/data/`: 82,623 public EV charging stations (NREL Alternative
  Fuels Data Center), 492 current EV configurations including 343 SUVs, minivans, and pickups
  (fueleconomy.gov / EPA), Census ACS 2024 housing and commute data for 33,642 ZIP areas, EIA
  state electricity and regional gasoline prices, and 116 outdoor National Park Service units.
- Method and assumptions: `docs/decision-logic.md`, `DECISIONS.md`.
- Absent, and not to be fabricated: testimonials, user counts, traffic or conversion results,
  press, partner logos, and claims about outcomes for real visitors.

## Product Principles

1. **Honest over persuasive.** The tool's value is a trustworthy answer; it never oversells an EV,
   and it caps verdicts it cannot support.
2. **Show the work.** Every number traces to a source or a stated assumption, and the page says
   what it assumed.
3. **Personal from the first input.** A ZIP alone gives a useful answer; each answer makes it
   sharper.
4. **Private by design.** Collect the minimum, store nothing personal, and keep every privacy
   claim on the page literally true.
5. **Built for the hard case.** Design for the renter who hauls a family and gear; easier cases
   follow.

## Accessibility & Inclusion

WCAG 2.1 AA is a requirement, not a goal. Automated axe-core, keyboard, and 320 px reflow tests run
in CI on every change and must keep passing. Color is never the only signal; every new view moves
focus to its heading; decorative graphics have text equivalents. A real screen-reader pass (NVDA,
VoiceOver) is pending before wide sharing.
