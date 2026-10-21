# Accessibility

Target: **WCAG 2.1 AA**. What was checked, how, and what still needs a human.

## Automated (runs with `npm run test:e2e`)

| Check | Tool | Coverage | Result |
|---|---|---|---|
| WCAG 2.0/2.1 A and AA rules + best practices | axe-core via Playwright | Landing, ZIP error, question, question error, results (all answered), results with the EV plan open, plan tools open (chargers near work found by ZIP with one saved, car explorer with one shortlisted, test-drive links, partner summary), trip planner open (a trip planned with `/api/route` mocked, stepped to leg 2, saved, and the second trip tool open showing the saved list), results (ZIP only, method section open) | 0 violations |
| Same, dark mode | axe-core | All of the above with `prefers-color-scheme: dark` | 0 violations |
| Reflow (1.4.10) | Playwright | All views at 320 px wide, both themes | No horizontal scrolling |
| Keyboard only (2.1.1, 2.4.3, 2.4.7) | Playwright | Skip link first; ZIP to results with Tab, arrows, Enter; every results control reachable; visible focus outline on each | Pass |
| Trip step-through by keyboard (2.1.1, 2.4.3) | Playwright | Enter on "Next leg" to the last leg; focus stays on the control used and moves to "Previous leg" when "Next leg" becomes disabled; `aria-current="step"` follows the leg; removing a saved trip moves focus to the saved list | Pass |

axe was confirmed to be working by planting a missing `alt` and a low-contrast paragraph;
it flagged both.

## Checked by hand

- **Contrast in the Route design (measured):** white on the teal verdict band 4.75:1; citron on
  teal 3.93:1, used only for bold 19px+ (large) text; navy on poppy buttons 5.62:1 (poppy is
  never text on the light ground); stop figures on navy 5.6 to 14.4:1; secondary text on navy
  rows 11.2:1; muted text on the fog ground 6.7:1.
- **Non-text contrast (1.4.11):** answer-row and input borders 3.5:1 on the fog ground; focus
  ring navy (15:1) on light surfaces and citron (14:1) on navy and teal; dark-mode rows carry a
  1px edge so they read as bars.
- **Accessible names and structure (screen-reader proxy):** reviewed the browser
  accessibility tree. Each question is announced once as "Question 2 of 4: Could you charge
  where you park overnight?" (the question is the page's `h1` inside the fieldset legend),
  answers are a radio group, the verdict is the results `h1`, reasons say "Works in your
  favor / Works against you / Worth checking" in words, not only with color or symbols.
  Fixed: questions were announced three times (region, group, heading).
- **Color is never the only signal:** tier marks are shapes plus words (circle, square,
  diamond, ringed diamond); each stop carries a Helps / Check / Hurts word chip that also differs
  by form (filled, outlined, dashed) plus screen-reader text; the verdict scale marks the current
  tier with "(your result)" and `aria-current`.
- **Route stops** are real buttons with `aria-expanded` and `aria-controls`; a browser test
  opens and closes one by keyboard.
- **Plan tools:** each tool opens from a button with `aria-expanded`; search is a labelled
  `role="search"` form; results, loading, and "search unavailable" messages are in
  `role="status"` regions; Save buttons report their state with `aria-pressed` and are
  disabled (dashed, not only dimmed) at the limit; body style and budget choices are native
  radio groups in fieldsets; every number field has a visible label, and its $ or % is
  outside the input as text. Links to brand sites say "(opens in a new tab)" to screen readers.
  The shortlist table in the partner summary scrolls sideways on phones inside a labelled
  region that takes keyboard focus. Fixed: axe flagged that region as not reachable by
  keyboard at 320 px.
- **Trip planner:** destinations are a native radio group in a fieldset ("Where to"); the
  destination search has its own labelled `role="search"` form (each search form on the page
  now has a distinct name, which axe required); miles between charges and the plug are labelled
  fields. "Plan for" is a native radio group in a fieldset too, one choice per shortlisted car
  plus the typical electric SUV, each with its name and "Lowest EPA range N mi" inside the
  choice's label, so the range is read with it. With no car shortlisted it is plain text, not a
  control with one option. The submit is "Find charging stops", so it isn't confused with the plan step's own
  "Plan the trip" button. After it, focus moves to the trip's heading. Under the heading, a
  plain-text line gives the car, miles between charges, and plug the trip was planned with (also
  in the saved-trips list and the partner summary); its "Change" button (screen readers hear
  "Change the car, miles, or plug") puts the trip back in the form and moves focus to its car's
  choice in "Plan for" (or to the miles when there is no car to choose).
  The legs are an ordered list
  labelled "Legs of this trip"; the current leg carries `aria-current="step"`, its details open
  in place, and a visually hidden `role="status"` line announces "Leg 2 of 3: 95 miles. Stop 1:
  ..." on each step. The visible "Leg 2 of 3" counter is `aria-hidden` so it isn't read twice.
  Previous and Next are real buttons, disabled at the ends; "Skip to arrival" jumps ahead.
  Each leg's title is also a button, like a results row: it has `aria-expanded` and
  `aria-controls` for the leg's details, opens that leg in place, moves `aria-current`, and
  keeps focus on itself (a 44 px target with a visible focus ring). A trip already saved with the
  same settings shows a disabled "Already saved" button with the reason in text beside it.
  Saved-trip View and Remove are 44 px wide and tall.
  Inside an open leg, the plug, hours, and price are a native `<details>` disclosure ("Plug:
  NACS"), as are "What are CCS and NACS?" and "How we estimated this": each opens and closes by
  tap, click, Enter, or Space, with a visible focus ring and a 44 px target. "Change start" is a
  button with `aria-expanded` that opens a labelled "Start from" radio group and its own search
  form. When a trip
  doesn't work, focus still moves to the trip heading, the reason is the first line under the
  totals, the fixes are real buttons, and the partial list is a `<details>` disclosure; axe scans
  this state too. The "NACS only" tag is a word, not a color, and the "Check your car's plug" line
  and "Getting home" sentence are plain text in reading order. On phones the step-through counter
  is above Previous and Next, which share a row.
  Leg figures carry "on leg N" in screen-reader text. The current leg is shown by a ring, the
  open details, and the counter as well as the filled station, so color isn't the only signal.
  On phones an open tool widens toward the plan's line (fixed: at 320 px the trip form was
  about 150 px wide and overflowed by 6 px, which the reflow check caught). Fixed from the
  Impeccable critique: at 320 px the "Plan for" dropdown cut its choice to "A typical electric
  S"; the label is now "Typical electric SUV". A closed dropdown can't wrap, so the longest car
  names (28 characters) were still cut off on phones; "Plan for" is now a radio group whose names
  wrap whole at 320 px. axe scans it at 1280 and 320 px in light and dark with the longest name
  shortlisted, and the reflow check covers it.
- **Field edges in the plan tools (1.4.11):** inputs, selects, and choice rings on the navy
  panel are #8593a8, about 4.8:1 (fixed in the trip planner's design review: they were 2.25:1).
- **Errors (3.3.1, 3.3.3):** ZIP and missing-answer errors are text, announced with
  `role="alert"`, tied to the field with `aria-describedby`, and focus returns to the field.
- **Focus management:** each new view moves focus to its heading so screen-reader and
  keyboard users start in the right place.
- **Links that open new tabs** say so in screen-reader text, with a visible arrow.
- **Motion:** no animation. Smooth scrolling only when `prefers-reduced-motion` allows it.
- **Text size:** rem-based; works at 200% browser zoom.
- **Decorative graphics** (range ruler, progress bar) are `aria-hidden` and their content is
  also in text.

## Not yet done (needs a person)

- [ ] **Real screen-reader pass:** NVDA + Firefox or Chrome on Windows, and VoiceOver +
  Safari on iPhone. Walk ZIP, all four questions, results, "Answer these to sharpen your
  result", and "Start over". About 15 minutes.
- [ ] **Windows High Contrast / forced colors** spot check.
- [ ] **Real phone** check with the on-screen keyboard (numeric keypad should open for ZIP).
