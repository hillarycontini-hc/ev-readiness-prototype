# Accessibility

Target: **WCAG 2.1 AA**. What was checked, how, and what still needs a human.

## Automated (runs with `npm run test:e2e`)

| Check | Tool | Coverage | Result |
|---|---|---|---|
| WCAG 2.0/2.1 A and AA rules + best practices | axe-core via Playwright | Landing, ZIP error, question, question error, results (all answered), results with the EV plan open, results (ZIP only, method section open) | 0 violations |
| Same, dark mode | axe-core | All of the above with `prefers-color-scheme: dark` | 0 violations |
| Reflow (1.4.10) | Playwright | All views at 320 px wide, both themes | No horizontal scrolling |
| Keyboard only (2.1.1, 2.4.3, 2.4.7) | Playwright | Skip link first; ZIP to results with Tab, arrows, Enter; every results control reachable; visible focus outline on each | Pass |

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
