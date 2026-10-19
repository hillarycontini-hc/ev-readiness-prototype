# A/B test plan: landing message

**Test key:** `landing-messaging` · **Owner:** Hillary Contini · **Status:** ready, not started

## What changes

| | Control: savings | Test: adventure |
|---|---|---|
| Headline | Could an EV save you money? | Can an EV keep up with your adventures? |
| Subhead | ...what you would spend on charging versus gas, and whether charging near you fits your life. | ...charging near the parks you would drive to, and whether an EV fits your everyday driving. |
| First card on results | Fuel cost: gas vs. electric | Charging on the way to the outdoors |

Everything else is identical: questions, order, scoring, and the "Learn more" links.
Visitors are split 50/50 in the browser on each visit (see "Known limits").

## Hypothesis

Cost is the most common reason people look at EVs, so the savings message is the
default. But "will it fit my life" is a bigger barrier than "will it save money" for many
EV-curious people, and range anxiety is sharpest on trips away from home.

**If** the landing page leads with the outdoor-trip promise instead of savings, **then**
more visitors will reach a personalized recommendation, **because** it speaks to the
barrier (trips away from home) rather than a benefit people already assume.

Pre-registered expectation: adventure beats savings on the primary metric by at least
5 percentage points. Pre-registered so the result cannot be rationalized after the fact.

## Metrics

**Primary:** recommendation rate = visitors with `recommendation_viewed` / visitors with
`landing_viewed` (the exposure event), same visit.

**Secondary (reported, not used to decide):**
- **North star rate** = visits with `next_step_taken` (answered >= 2) / `landing_viewed`.
  Not the primary metric only because its lower base rate makes it even harder to detect at
  this traffic; if the two disagree, that disagreement is the finding to report.
- Fake-door rate = `plan_cta_clicked` / `recommendation_viewed`
- Learn-more rate = `learn_more_clicked` / `recommendation_viewed`
- Answer depth = mean `answered` on `inputs_completed`
- Audience mix = share answering `outdoor = monthly`. Not a success metric: a check on
  whether the adventure message attracts a different audience, which would change how to
  read the primary metric.

**Guardrails (the test variant must not be worse by more than):**

| Guardrail | Event math | Threshold |
|---|---|---|
| ZIP error rate | `zip_error` / `landing_viewed` | +3 points |
| Early bail-out | `questions_skipped_rest` / `zip_submitted` | +5 points |
| Data errors | `data_load_error` / `zip_submitted` | Any increase investigated before calling the test |
| Sample ratio | Exposures per arm | PostHog's sample-ratio check must pass |

## Decision rule

Run until **4 weeks after the first public share** or **400 exposures per arm**,
whichever comes first. No early stopping on a good day.

1. If PostHog reports at least a **95% chance the adventure arm is better** on the primary
   metric **and** no guardrail is breached, ship adventure as the default message.
2. If a guardrail is breached, keep savings regardless of the primary metric.
3. Otherwise the result is **inconclusive**: keep savings (simpler, and the conventional
   default), and report the observed difference and its interval as directional only.

## Honest note on traffic

This is a portfolio prototype shared with an AI cohort and possibly on LinkedIn, so
traffic will be small: likely a few hundred visitors in total. With a baseline
recommendation rate around 40% (two-sided, alpha 0.05, 80% power):

| Visitors per arm | Smallest difference the test can reliably detect |
|---|---|
| 100 | about 19 points |
| 250 | about 12 points |
| 500 | about 9 points |
| 1,500 | about 5 points |

So at realistic traffic, **only a very large effect will be detectable**, and an
"inconclusive" result is the most likely outcome. That is fine. The point of this test
is to show the full loop: a pre-registered hypothesis, a primary metric, guardrails, a
decision rule written before launch, and instrumentation that would hold up at real
traffic. With real volume, the same setup would detect a 5-point lift in about 1,500
visitors per arm.

## Known limits

- **Assignment is per visit, not per person.** The site stores nothing in the browser (no
  cookies, no local storage), so a visitor who reloads may see the other message.
  Funnel steps happen within one page load, so each visit is a clean unit; PostHog
  counts each visit as a separate anonymous user. This trades a little statistical
  purity for a cookieless, consent-free experience.
- **Visitors with Global Privacy Control or Do Not Track are excluded** from analytics,
  and ad blockers will block some events. Both arms are affected equally.
- **Channel mix can swamp message effects.** Cohort members and LinkedIn readers may
  behave very differently. UTM tags on shared links (`?utm_source=linkedin`,
  `?utm_source=cohort`) make it possible to break results down by channel.
- **Hillary's own testing** should use `?utm_source=internal` so it can be filtered out.
