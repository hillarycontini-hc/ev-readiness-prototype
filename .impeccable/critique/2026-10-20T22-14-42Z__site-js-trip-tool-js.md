---
target: the trip planner
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\dev\\ev-readiness-prototype\\.claude\\worktrees\\nice-yalow-2dc611\\site\\js\\trip-tool.js"
target_fingerprint: "sha256:844f91e1b41af913e2ce8970e58c86531d2834f85cd212bb7404c9ed71d845d0"
target_path: "C:\\dev\\ev-readiness-prototype\\.claude\\worktrees\\nice-yalow-2dc611\\site\\js\\trip-tool.js"
timestamp: 2026-10-20T22-14-42Z
slug: site-js-trip-tool-js
---
Method: dual-agent (A: isolated design-review subagent · B: isolated detector and browser subagent)

# Critique: the trip planner (site/js/trip-tool.js)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Status, focus to title, and "Leg 1 of 2" are good; after a one-tap fix the miles field changes off-screen and the result never shows its settings |
| 2 | Match system / real world | 3 | Plain words, good CCS/NACS explainer; "Either plug" reads as "not sure" but is treated as "takes both" |
| 3 | User control and freedom | 2 | Legs can't be selected directly; no drive home; an unsaved trip is lost on reload |
| 4 | Consistency and standards | 2 | Two buttons named "Plan the trip"; summary "Range you need: 45 miles" next to "210 miles between charges"; "20–45 min" vs "20 min to 45 min" |
| 5 | Error prevention | 2 | "Either plug" default routes to NACS-only stops with the plug hidden; duplicate trips can be saved; invalid miles silently reverted |
| 6 | Recognition over recall | 3 | Saved trips to the same park look identical; car, miles, plug never shown back |
| 7 | Flexibility and efficiency | 2 | No jump to a leg, no return trip, long phone form; one-tap fixes are the bright spot |
| 8 | Aesthetic and minimalist design | 3 | Five equal 36px poppy figures; electricity repeated in the line below |
| 9 | Error recovery | 3 | No-charger-in-reach state excellent; silent revert and unopenable partial legs |
| 10 | Help and documentation | 3 | Explainer and "How we estimated this" in place; 70% note long and mid-form |
| **Total** | | **26/40** | **Acceptable (top of band)** |

## Design Specificity Verdict

LLM: result view authored (route line and stations, stop-colored figures, gap copy in product units); the form and the summary list are category-interchangeable; the leg line has no home station.

Deterministic scan: site/index.html 3 findings (2 low-contrast false positives from static dark-mode pairing; 1 landing illustration outside scope). trip-tool.js scanned by regex only (no element rules). Browser: line-length on 4 trip notes at 1280 (~94-117 chars); nested-cards on the tool panel (established pattern). Measured: 0 text or edge contrast failures (tightest: poppy gap lead-in 4.81:1); no overflow at 320/375/1280; "Plan for" select clipped at 320 ("A typical electric S"); saved-trip View link 40.8px wide. No user-visible overlay (detector ran in a test browser).

## What's Working
1. The no-charger-in-reach state: exact gap, one primary fix with implied EPA range, honest "little to spare", partial list folded.
2. Legs in the route's own language with sound accessibility (fill on pass, aria-current, live status, focus kept on the used control, ordered leg detail, one plug disclosure).
3. Shows its work: labeled time range, "How we estimated this", honest electricity vs gas.

## Priority Issues
1. [P1] Default "Either plug" sends CCS cars to NACS-only stations (sample trip's only stop is a Tesla Supercharger; at 110 mi both stops are), the plug is hidden behind a tap, and the planner's port tie-break favors big NACS sites. Fix: keep the default, show an outlined "NACS only" tag at a glance, prefer stations with both plugs or CCS within the 10% window when plug is "any", and add a one-line warning above the legs when any stop is NACS-only. Command: /impeccable harden
2. [P1] Park trip ends at the park with no word on getting home, though the step's premise is limited charging near the park. Fix: keep one way; on the arrival leg name the distance back to the last fast charger and whether arrival miles cover it; optional "Plan the drive home". Command: /impeccable harden
3. [P2] Result hierarchy buries the answer under five equal figures (~220px on phones) with electricity repeated. Fix: lead with "1 fast-charging stop: Pueblo, road mile 157"; keep miles and driving; merge time and cost into one line; two columns on phones. Command: /impeccable distill
4. [P2] Settings vanish after planning; two "Plan the trip" buttons; summary "Range you need" collides with "miles between charges". Fix: settings line with Change link under the title, reused in saved list and summary; rename submit "Find charging stops"; "Daily range you need"; block duplicate saves. Command: /impeccable clarify
5. [P2] Phone stepper splits Previous/Next across rows; legs not tappable; "Plan for" clipped at 320; View link 40.8px wide. Fix: leg titles as buttons; Previous/Next on one row; shorter narrow label; 44px targets. Command: /impeccable adapt

## Persona Red Flags
- Jordan: routed to a Tesla Supercharger with no visible plug warning after "keep Either plug"; one-option "Plan for"; duplicate "Plan the trip"; "road mile" and "planned miles" unexplained.
- Casey: ~1,530px form at 375 with submit ~1,390px down; ~220px of totals; split stepper; fixed miles field off-screen; unsaved trip lost on reload.
- Sam: mostly well served; silent revert of invalid miles; duplicate button names; partial legs unopenable in the gap state.
- Renter parent planning a park trip: no return answer; indistinguishable saved trips; summary drops plug and "one way"; raw station strings; electricity about equal to gas unframed next to "$740 a year saved".

## Minor Observations
- Notes over ~100 characters per line at 1280; cap near 70ch.
- Poppy gap lead-in at 4.81:1 is a thin margin.
- "Rehearse your longest drive" defaults to the park list.
- "Mile 157" (summary) vs "Road mile 157" (tool).
- The gap list still shows the 6-mile hop unexplained.
- Nothing says tapping "Saved to your plan" removes the trip.
- White summary card in dark mode glares (intended paper).

## Questions to Consider
- For a step premised on limited charging at the park, is one way the right unit?
- Should "Not sure" mean the safe plan (CCS only) rather than the plan with the most stops?
- For 2-3 leg trips, does the stepper earn its place?
