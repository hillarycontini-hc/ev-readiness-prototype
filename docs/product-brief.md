# Product brief: EV Readiness Check

One page. Decisions here were made with Hillary on 2026-10-19; reasoning for smaller calls
is in [`DECISIONS.md`](../DECISIONS.md).

## User

**Primary persona: the EV-curious renter with a full life to haul.**

- Rents, so home charging is *possible* (with a landlord's help) or *not available*.
- Plans to buy their next car in the next 12-18 months, and is still deciding whether it
  could be electric. They are not yet comparing models.
- Takes trips to parks, trailheads, and campgrounds.
- Needs room for car seats, a dog, and outdoor gear, so they shop SUVs, minivans, and pickups.

**Why this persona:** it is the hardest common case, and the one generic EV content serves
worst. "Charge at home overnight" is the standard reassurance, and it does not apply to
them. If the tool earns this person's trust, it works for easier cases too.

**Secondary audience (for the repo, not the product):** a hiring manager evaluating how
the work was framed, measured, and built.

## Problem

> *"I can't tell whether an EV fits my life where I live, so I stall."*

It breaks down into four doubts, in the order they block this persona:

1. **Charging without a garage.** Can I charge reliably if I rent?
2. **Range with a loaded car.** Is the range enough for how I drive, including winter and a
   full load?
3. **Cost.** Will it save money at my electricity and gas prices, given I may pay public
   charging rates?
4. **Trips that matter.** Can I get to the parks I go to and charge when I am there?

Generic answers ("most people drive under 40 miles a day") don't settle any of these.

## Solution

A ZIP code and up to five short questions return an explained verdict (Strong fit, Good fit
with a plan, Possible with tradeoffs, Not yet) plus a charging plan.

- **Personalized from the first input.** ZIP-level defaults (housing mix, commute) stand in
  for anything skipped, and each answer replaces a default. The page shows what was
  assumed and how confident the result is.
- **Built for renters:** a landlord option on home charging and a follow-up about charging
  at work, asked only when home charging isn't certain.
- **Built for haulers:** range and efficiency compared against electric SUVs, minivans,
  and pickups.
- **A next step that is useful either way:** "Get my EV plan" turns the answers into a
  checklist (who to ask, what range to shop for, where to charge, which park trips need a
  stop). This is the fake-door lead-capture moment: it measures intent and collects nothing.

## North star

**Confident next steps:** visits in which someone answered at least 2 questions, received a
recommendation, and took a next step ("Get my EV plan" or a "Learn more" link). Reported
weekly as a count, and as a rate per landing visit.

- *Why:* it requires both halves of the value: a personal answer for the visitor, and
  movement down the funnel. Page views, ZIP-only answers, and bounces don't count.
- *Instrumented as:* one `next_step_taken` event per visit, with `answered` attached, so it
  is a single PostHog insight (`next_step_taken` where `answered >= 2`).
- *Guardrails:* ZIP error rate, early bail-out rate, and the share of "Not yet" verdicts that
  still take a next step. An honest "not yet" that leads someone to a useful plan is a
  success, not a failure.

## Success criteria for this prototype

1. A first-time visitor gets a useful answer from a ZIP alone, and a better one with each
   answer.
2. Every claim on the results page traces to a public source or a stated assumption.
3. The ZIP never reaches analytics. No cookies, no stored personal data. Tested in CI.
4. WCAG 2.1 AA: automated checks pass, and a real screen-reader pass is done before
   launch.
5. The north star and A/B test can be read in PostHog from the first visitor.

## Non-goals (v1)

- Recommending a specific vehicle, brand, or dealer.
- Collecting contact details, accounts, or saved results.
- Incentives, purchase price, insurance, and maintenance.
- Turn-by-turn routing or live charger availability.
- A chat mode. It is a v2 candidate, behind a rate-limited, spend-capped proxy.

## Platform decisions

| Area | Decision | Why |
|---|---|---|
| Backend | **None for v1.** The site is static; the "database" is precomputed public data in versioned JSON. | Nothing to secure, pay for, or breach. Keeps the privacy promise simple and true. |
| Database (when needed) | Cloudflare D1 (SQLite) with Workers. Supabase (Postgres + Auth) only if accounts or saved results become a goal. | D1 sits on the recommended host's free tier and covers rate limits and spend caps for a chat proxy. |
| Authentication | **None for visitors.** Admin access is through GitHub, Cloudflare, and PostHog accounts with 2FA. A future internal dashboard goes behind Cloudflare Access, not custom auth. | A login wall contradicts the privacy promise and costs upper-funnel conversion. |
| Testing | Unit tests (`node:test`), browser tests (Playwright: analytics payloads, axe accessibility, keyboard), build-time data checks, run in GitHub Actions on every push and pull request. Manual screen-reader pass before launch. | Privacy and accessibility are tested, not just configured. |
| Version control | Git + GitHub. `main` protected (pull request + passing CI), Dependabot, secret scanning with push protection, release tags, data refreshes as reviewable pull requests. | Every change, including data changes, leaves a reviewable diff. |

## Risks

| Risk | Mitigation |
|---|---|
| Hand-set weights mis-rank some situations | Unit tests pin the key behaviors; weights are stated on the page; learning them from outcomes is the first "next" item |
| Low traffic makes the A/B test inconclusive | Pre-registered decision rule; reported as directional |
| Fake door disappoints visitors | It says so plainly and immediately gives a real, printable plan |
| Public charging prices and availability change | Monthly data refresh; prices labeled as assumptions with dates |

## How the work runs

- **Fundamentals first, then build.** This brief settles user, problem, solution, and north
  star; everything else follows from it.
- **Parallel where independent.** Your deploy and PostHog setup, CI, a chat-mode spike, and
  trailhead data have no shared files and can run at the same time. Logic, UI, and copy
  changes touch the same files, so they run in sequence.
- **Every default decision logged** in `DECISIONS.md`; real questions batched at milestone
  boundaries.
