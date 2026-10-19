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

- **Non-text contrast (1.4.11):** axe does not test borders. Input and answer-card borders
  were 2.5:1 in light mode and were darkened to 3.9:1 on white and 3.6:1 on cards. Focus
  ring: 5.7:1 (light), 10.3:1 (dark). Dark-mode borders: 3.9:1.
- **Accessible names and structure (screen-reader proxy):** reviewed the browser
  accessibility tree. Each question is announced once as "Question 2 of 4: Could you charge
  where you park overnight?" (the question is the page's `h1` inside the fieldset legend),
  answers are a radio group, the verdict is the results `h1`, reasons say "Works in your
  favor / Works against you / Worth checking" in words, not only with color or symbols.
  Fixed: questions were announced three times (region, group, heading).
- **Color is never the only signal:** verdict scale marks the current tier with text
  "(your result)" and `aria-current`; reasons have a text prefix.
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
