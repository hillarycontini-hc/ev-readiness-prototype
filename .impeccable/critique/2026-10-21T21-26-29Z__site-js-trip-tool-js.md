---
target: the trip planner
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\dev\\ev-readiness-prototype\\.claude\\worktrees\\nice-yalow-2dc611\\site\\js\\trip-tool.js"
target_fingerprint: "sha256:ebc5a7a4fb15ff8bb2c8dd109ffc11c2691596df2ae087a72eb0e3020b0da115"
target_path: "C:\\dev\\ev-readiness-prototype\\.claude\\worktrees\\nice-yalow-2dc611\\site\\js\\trip-tool.js"
timestamp: 2026-10-21T21-26-29Z
slug: site-js-trip-tool-js
---
Method: dual-agent (A: isolated design-review subagent · B: isolated detector and browser subagent)

# Critique: the trip planner, second run (main 0667003, before PR #12)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Saving a trip doesn't tick the step; summary "Steps done 0 of 7" with two trips saved |
| 2 | Match system / real world | 3 | All-caps data city names in the answer; "Check your car's plug" before owning a car |
| 3 | User control and freedom | 3 | Tappable legs, Skip, cached replans good; a one-tap fix silently overrides the car's miles |
| 4 | Consistency and standards | 3 | Poppy-filled "Saved" toggle removes on second press; warnings lack the system warning shape |
| 5 | Error prevention | 2 | Primary fix can ask for miles the car can't drive; out-of-range miles silently revert |
| 6 | Recognition over recall | 3 | Answer names cities, legs name stations; "road mile 152" next to "154 mi" |
| 7 | Flexibility and efficiency | 3 | Good accelerators; every trip still starts with the full form |
| 8 | Aesthetic and minimalist design | 2 | ~12 controls and three notes before any answer; plan button ~1,300px down at 375 |
| 9 | Error recovery | 3 | Gap state excellent except fix ranking |
| 10 | Help and documentation | 3 | Contextual explainers in place |
| **Total** | | **28/40** | **Good (low end)** |

## Design Specificity Verdict
LLM: result authored (route line, stations, step color, condensed figures); form and result head category-generic; the signature arrives only after a form.
Deterministic: index.html 3 findings (2 low-contrast false positives from static dark-mode pairing, 1 landing illustration outside scope); trip-tool.js regex-only. Browser: 14 detector runs, 42 measured runs (320/375/1280, light/dark): no contrast failures (lowest 4.81:1), no overflow, no truncation (last run's 320px "Plan for" clipping fixed), all controls >= 44px except native radios/checkboxes with large labels (last run's 40.8px View link now 44px). Remaining: line-length >90 chars on four trip notes at 1280; nested-cards on the tool panel (established pattern).

## What's Working
1. Legs drawn as the route with strong accessibility semantics.
2. The doesn't-work-yet state: why, where, one-tap fix from the cached route.
3. Honest working shown: cost vs gas, data date, plug caveats, return check.

## Priority Issues
1. [P1] Primary fix can recommend miles the chosen car can't drive ("Plan with 265 miles" needs ~380 mi EPA, while "either plug" is the real fix; from 60 the fix jumps to the bare minimum 110 though the car's 210 works); settings line keeps the car name. Fix: offer the car's own default first when it works; make above-car minimums quiet and conditional ("Needs about 380 mi of EPA range"); show "Custom" in the settings line. Command: /impeccable harden
2. [P1] "Getting home" hidden until the arrival leg is opened. Fix: when arrival miles don't reach the first charger back, add a one-line flag under the answer; name the nearest fast charger to the park. Command: /impeccable clarify
3. [P2] Warnings have no form; plug check and Getting home read like body text. Fix: one warning treatment (rail box led by the poppy diamond) for both and the summary. Command: /impeccable polish
4. [P2] Form too heavy before the first answer (panel 3,640px at 375, form ~1,300px). Fix: destinations + "Find charging stops" first; car, miles, plug folded into the settings line with Change; or auto-plan the step's park. Command: /impeccable distill
5. [P2] Result head hierarchy and naming: poppy figures outrank the answer; ALL-CAPS data; answer city vs leg station name; "road mile 152" vs "154 mi". Fix: title-case data, name the stop in the answer, drop figures to row-figure size, "154 mi, incl. 1.5 mi detour". Command: /impeccable typeset

## Persona Red Flags
- Jordan: miles and plug asked before any result; "Check your car's plug" with no car; 194 estimated vs 262 road miles; "Non-Networked"; legs vs stops counting.
- Casey: plan button ~1,300px down; leg miles fall under open details on phones; Getting home needs taps; unsaved trip lost on reload.
- Sam: strong focus and status handling; Save toggle removes without saying Remove; silent revert of invalid miles.
- Renter parent: the "back" half hidden with nothing to act on; long-drive step offers a 36-mile park.

## Minor Observations
- copy.js:158 long-drive step still points to "a charging route planner".
- One-option "Change start" with no saved home; duplicate trips differing only by plug both kept.
- Summary: "ZIP 80302 to…" robotic; 5-6 muted lines per trip; share checkbox label 26px tall at 1280.
- Trip notes over 90 chars per line at 1280.
- 6-mile hop still in "See how far it gets".

## Questions to Consider
- Why open with a form when the step already knows park, start, and car?
- Should a park trip's line end at the park or continue home?
- Should a pre-buyer type "miles between charges", or pick car + Summer/Winter?
