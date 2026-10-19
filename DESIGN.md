---
name: EV Readiness Check
description: A personal EV verdict drawn as a transit route, one straight answer per stop.
colors:
  navy: "#101a2b"
  navy-2: "#1a2740"
  teal: "#0b7f8a"
  poppy: "#ff5a36"
  poppy-hover: "#ff7a5c"
  citron: "#d7f75b"
  aqua: "#2fd0dc"
  uv: "#5b3df5"
  uv-light: "#a99bff"
  rail: "#2c3a55"
  ground: "#eef2f5"
  surface: "#ffffff"
  ink: "#101a2b"
  muted: "#4a5568"
  border: "#77828c"
  chip: "#dde3ea"
  chip-ink: "#3a4558"
  row-sub: "#c7d0dd"
  panel-ink: "#e6ebf1"
  ground-dark: "#0a111d"
  surface-dark: "#131f33"
  ink-dark: "#eef2f5"
  muted-dark: "#c7d0dd"
  border-dark: "#8593a8"
  chip-dark: "#1f2c44"
  chip-ink-dark: "#dde3ea"
  row-edge-dark: "#33456a"
typography:
  display:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(3rem, 8vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "0"
  headline:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.25rem)"
    fontWeight: 900
    lineHeight: 0.95
  figure:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)"
    fontWeight: 900
    lineHeight: 1
    fontFeature: "tnum"
  title:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.375rem, 2.6vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.15
  row-label:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  lede:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  small:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "0.04em"
  wordmark:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  chip: "3px"
  control: "4px"
  bar: "6px"
  round: "50%"
spacing:
  row-gap: "0.6rem"
  sm: "0.75rem"
  md: "1.25rem"
  lg: "1.75rem"
  xl: "2.5rem"
  gutter: "1.25rem"
  gutter-wide: "3rem"
components:
  button-go:
    backgroundColor: "{colors.poppy}"
    textColor: "{colors.navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.9rem 1.4rem"
    height: "3rem"
  button-go-hover:
    backgroundColor: "{colors.poppy-hover}"
    textColor: "{colors.navy}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.9rem 1.4rem"
    height: "3rem"
  button-quiet-hover:
    backgroundColor: "{colors.chip}"
  option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "1rem 1.1rem"
    height: "3.5rem"
  option-selected:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
  zip-input:
    backgroundColor: "{colors.navy-2}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.8rem"
    width: "9.5rem"
    height: "3rem"
  stop-row:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.bar}"
    height: "5.75rem"
  tone-chip-helps:
    backgroundColor: "{colors.aqua}"
    textColor: "{colors.navy}"
    rounded: "{rounded.chip}"
    padding: "0.05rem 0.45rem"
  tone-chip-check:
    backgroundColor: "transparent"
    textColor: "{colors.surface}"
    rounded: "{rounded.chip}"
    padding: "0.05rem 0.45rem"
  tone-chip-hurts:
    backgroundColor: "transparent"
    textColor: "{colors.surface}"
    rounded: "{rounded.chip}"
    padding: "0 0.4rem"
  tone-chip-assumed:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.surface}"
    rounded: "{rounded.chip}"
    padding: "0.05rem 0.45rem"
  tier-chip:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.chip-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0.35rem 0.6rem"
  tier-chip-current:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.citron}"
  verdict-band:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
  topbar:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.citron}"
    height: "3.5rem"
  plan-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bar}"
    padding: "1.25rem 1.5rem 1.5rem"
---

# Design System: EV Readiness Check

## Overview

**Creative North Star: "The Family Transit Map"**

The page reads like a transit line run through a gear catalog. A deep navy shell carries saturated stop colors (aqua, citron, ultraviolet-light, poppy), and one 14px line runs through white-ringed stations from home to the park. Every decision about the visitor's EV is a stop on that line: a navy bar with a label, a short sentence, and one oversized condensed figure in the stop's own color. The verdict sits above the line in a full-width teal band, in condensed capitals at display scale.

Density is moderate and declarative. Each row gives one straight answer, and detail stays folded inside the row until it is opened. Color is loud but never carries meaning alone: every tone, tier, and state also has a shape or a word. The world is flat. Depth comes from navy-on-fog contrast and hard rings, never from blur.

The same line does two jobs. On results it draws down stop by stop, once. In the questions it fills stations as progress. The landing illustration puts the loaded family car on that line too, so the line is the one recurring signature.

**Key Characteristics:**
- Navy bars on a cool fog ground; teal is reserved for the verdict field.
- One 14px route line with white-ringed stations, colored per stop.
- Condensed 900-weight capitals for verdicts and questions; condensed figures in stop colors.
- Shape plus word for every tier and tone; color is decoration on top of meaning.
- Flat surfaces with hard rings and edges; no blurred shadows.
- Poppy is the action color and appears as a fill, almost never as text.

## Colors

A saturated gear-catalog palette set on navy, with a quiet cool-gray page around it.

### Primary
- **Transit Navy** (navy): the shell. Top bar, landing hero, every stop row, the question-progress strip, the selected answer option, the current tier chip. Also the ink color on light surfaces.
- **Verdict Teal** (teal): only the verdict band on results (plus the ring of link-list bullets and one hero-art mountain). White text on it measures 4.75:1.

### Secondary
- **Poppy Signal** (poppy): the primary action fill ("Check my ZIP", "Next", "Get my EV plan") with navy text (5.62:1). Also the Parks stop color, link underlines, the disclosure chevron, the error diamond, the dashed Hurts chip edge, the invalid-ZIP border, and the caret. Hover lightens to Poppy Hover (poppy-hover).

### Tertiary (stop colors, on navy only)
- **Citron Spark** (citron): Range stop, the wordmark, the verdict tier mark, the "answer that matters most" line in the verdict band, the current question station, the ZIP field border, text selection, and the focus ring on navy and teal.
- **Charger Aqua** (aqua): Charger stop.
- **Ultraviolet Light** (uv-light): Fuel stop and the range band in the mile scale.
- **Ultraviolet** (uv): illustration only (the hero mountain). Not used in UI.
- **Home White** (surface): the Home stop color and station centers.

### Neutral
- **Fog** (ground): page ground in light mode.
- **Paper White** (surface): option cards, the plan card, the method disclosure, the footer.
- **Slate Muted** (muted): hints, confidence line, sources, footnotes on light surfaces.
- **Steel Border** (border): option and container borders on fog, 3.48:1 (passes the 3:1 non-text minimum).
- **Mist Chip** (chip) with **Chip Ink** (chip-ink): tier-scale chips and inline error boxes; also the quiet-button hover.
- **Row Sub** (row-sub): secondary text on navy (row details, top-bar context, landing lede, ticks).
- **Panel Ink** (panel-ink): body text inside an opened stop.
- **Rail** (rail): the unlit route line in question progress, the chevron divider, park-list rules, the mile-scale track, and the Assumed chip fill.

### Dark mode
The ground drops to Night Ground (ground-dark) and surfaces to Night Surface (surface-dark); ink, muted, border, chip, and chip-ink swap to their `-dark` tokens and the focus ring becomes citron everywhere. Rows, the top bar, and the verdict band keep their colors. Each stop row gains a 1px Row Edge (row-edge-dark) ring so the navy bars still read as bars on the darker ground.

### Named Rules
**The Stops-On-Navy Rule.** Citron, aqua, ultraviolet-light, and poppy figures and text sit only on navy (5.6 to 14.4:1). On the fog ground poppy measures 2.76:1, so it never appears there as text; it appears only as a button fill under navy text, or as decoration beside text that already carries the meaning.

**The Large-Citron Rule.** Citron on teal measures 3.93:1, so it is used only for bold text at 19px and above (the verdict summary's key line). Smaller citron text belongs on navy.

**The Teal-Is-The-Verdict Rule.** Teal fills exactly one field per page: the verdict band. It is not a second shell color.

## Typography

**Display Font:** Big Shoulders Display (variable 100 to 900, self-hosted, OFL), falling back to Arial Narrow
**Body Font:** Schibsted Grotesk (variable 400 to 900, self-hosted, OFL), falling back to system-ui

**Character:** A condensed, sign-painted display face for verdicts, questions, and figures, set against a sturdy, slightly editorial grotesk for everything a person reads in sentences.

### Hierarchy
- **Display** (900, clamp 3 to 6rem, line-height 0.88 to 0.9, uppercase): the landing headline and the results verdict. One per view.
- **Headline** (900, clamp 2.25 to 3.25rem, 0.95, uppercase): each question. The plan title uses a smaller step of the same treatment (900, clamp 1.75 to 2.25rem, 1, uppercase).
- **Figure** (900, clamp 2.25 to 3.25rem, 1, tabular numerals): the one number or word on each stop row, in the stop's color.
- **Title** (700, clamp 1.375 to 1.75rem, 1.15): section headings in the text face ("Learn more").
- **Row Label** (700, 1.25rem, 1.25): the name of each stop.
- **Lede** (400, 1.1875rem): the landing subhead and the verdict summary sentence, max about 34 to 48rem.
- **Body** (400, 1.0625rem, 1.55): running text, buttons (at 700), options (at 600).
- **Small** (400, 0.9375rem): hints, row details, stop panels, sources, footer.
- **Label** (700, 0.75 to 0.8125rem, 0.04 to 0.06em tracking, uppercase): tier-scale chips and tone chips only.
- **Wordmark** (800, 1.5rem, 0.04em, uppercase, citron): "EV Readiness Check" in the top bar.

### Named Rules
**The Figures-Only Tabular Rule.** Tabular numerals are applied only to stop figures, panel data values, the ZIP field, and the mile scale. Schibsted Grotesk widens punctuation under `tnum`, so running text keeps proportional figures.

**The Condensed-Caps Rule.** Big Shoulders is always 800 to 900 and, at display and headline sizes, always uppercase. It never sets sentences.

## Layout

A single centered column: `72rem` max for results and landing, `44rem` for questions and errors, with a `1.25rem` side gutter that widens to `3rem` at 48rem. Full-bleed color fields (top bar, landing hero, verdict band) span the viewport while their content stays in the column.

At 60rem the landing hero becomes two columns (copy 1fr, art 1.1fr) and the verdict band puts the "Get my EV plan" button to the right of the verdict. Below that, everything stacks. Stop rows are a four-column grid (3.5rem station, label, figure, 2.75rem chevron); under 40rem the figure drops beneath the label and the plan button goes full width.

Rhythm is tight inside the route (rows 0.6rem apart, so the line visibly passes between them) and looser around it (0.75 / 1.25 / 1.75 / 2.5rem steps between groups). Touch targets are at least 2.75rem; buttons and options are 3 to 3.5rem tall.

## Elevation & Depth

The system is flat. There are no blurred or offset shadows anywhere. Depth comes from contrast (navy bars on fog), from layering of the route line over the rows (line under the station, station over the line), and from hard, zero-blur rings drawn with `box-shadow` spread.

### Shadow Vocabulary
- **Station halo** (`box-shadow: 0 0 0 4px #101a2b`; question stations use 3px): separates each white-ringed station from the line passing behind it.
- **Check outline** (`box-shadow: inset 0 0 0 1.5px #ffffff`): the outlined Check tone chip.
- **Dark row edge** (`box-shadow: 0 0 0 1px #33456a`): dark mode only, on every stop row.

### Named Rules
**The Hard-Ring Rule.** If something needs separation, give it a zero-blur ring or a border. Soft shadows do not exist in this world.

## Shapes

Corners are small and squared-off, like signage: 3px on chips, 4px on buttons, inputs, options, error boxes, and the method disclosure, 6px on the large navy bars (stop rows, question-progress strip) and the plan card. Circles are reserved for stations, the Strong-fit tier mark, and link-list bullets.

Borders are structural and 1 to 2px: 2px on options, inputs, quiet buttons, and the plan card; 1px on the assumed box, method disclosure, footer rule, and chevron divider. Chevrons are drawn from two borders rotated 45 degrees, not glyphs.

**The Tier-Shape Rule.** Each verdict tier has its own silhouette, shown with its word: circle for Strong fit, square for Good fit with a plan, diamond for Possible, with tradeoffs, and a ringed diamond (diamond plus an offset citron outline) for Not yet. In the tier scale, Possible and Not yet share the small diamond, and the word separates them.

## Components

### Buttons
Blunt and confident; the action is always the warmest thing on screen.
- **Shape:** squared corners (4px), 3rem minimum height, 2px transparent border reserved for alignment with quiet buttons.
- **Go (primary):** poppy fill, navy text, 700 weight. Hover lightens to poppy-hover; active nudges down 1px. "Get my EV plan" is a larger Go (1.125rem, 1rem by 1.6rem padding) with a drawn chevron after the label.
- **Quiet (secondary):** transparent with a 2px ink border and ink text; hover fills with chip.
- **Link button:** text-only, 600 weight, 2px poppy underline offset 0.2em; hover turns the underline to the text color.
- **Disabled:** 0.7 opacity, default cursor.
- **Focus:** 3px outline offset 3px, navy on light surfaces and citron on navy or teal.

### Chips
- **Tone chips** (inside a stop row, before the detail line, uppercase label at 0.75rem): tone is carried by form, not color. **Helps** is filled in the stop's own color with navy text. **Check** is outlined in white (1.5px inset ring), white text. **Hurts** is transparent with a 1.5px dashed poppy border, white text. **Assumed** is a solid rail fill, white text. Each also has a screen-reader sentence.
- **Tier-scale chips:** mist chip fill with chip-ink text and a small tier shape; the current tier inverts to navy with citron text and `aria-current`.

### Cards / Containers
- **Stop row (signature):** see below.
- **Plan card:** paper white, 2px ink border, 6px corners, 1.25 to 1.5rem padding, condensed uppercase title, numbered steps whose markers are set in the display face.
- **Assumed box and method disclosure:** paper white, 1px steel border, 4px corners. The disclosure uses a poppy drawn chevron that rotates from 45 to 135 degrees when open.
- **Shadow strategy:** none (see Elevation & Depth).

### Inputs / Fields
- **Answer options:** full-width paper-white cards, 2px steel border, 4px corners, 3.5rem tall, 600 weight, native radio tinted poppy. Hover darkens the border to ink. Selected fills navy with white text. Keyboard focus draws the focus ring around the whole card.
- **ZIP field:** on navy only. navy-2 fill, 2px citron border, white condensed figures at 1.75rem with 0.12em tracking and tabular numerals. Invalid swaps the border to poppy.
- **Errors:** an ink-on-chip box (on navy: white on #22314d) led by a small poppy diamond, never color alone.

### Navigation
- **Top bar:** a 3.5rem navy strip with the citron wordmark at left and the ZIP and state in row-sub at right. No menu; the flow is linear.
- **Question progress:** the route itself on a navy strip. Unlit segments and station rings are rail; passed segments and rings take the stop colors in order (aqua, citron, uv-light, poppy); the current station fills citron. A "Question 2 of 5" line above it carries the same information in text.

### Stop Row (signature)
A navy bar, 6px corners, 5.75rem tall, with four columns: station, label block, figure, chevron. The station is a white disc with a 7px ring in the stop color and a 4px navy halo. The route line (14px) leaves each station and runs down into the next, colored for the next stop, so the line changes color at each station. The label is 700 at 1.25rem; beneath it a tone chip and a small row-sub detail; at right the figure in the stop color; at far right a chevron behind a 1px rail divider that rotates 90 degrees when the row is open. The opened panel holds panel-ink text, a definition list with tabular values, and a source line. The Range stop adds a mile scale: rail track, uv-light band, and a citron "need" tick with its label.

**Motion:** when results load the line draws down segment by segment (0.42s, staggered 0.14s per stop) and each station pops from 0.4 scale (0.36s), on `cubic-bezier(0.16, 1, 0.3, 1)`. It runs once, content is visible from the start, and reduced-motion users get the static route.

## Do's and Don'ts

### Do:
- **Do** put stop colors (citron, aqua, uv-light, poppy) on navy only, where they measure 5.6 to 14.4:1.
- **Do** use poppy as a button fill with navy text (5.62:1), and keep it the one action color.
- **Do** pair every tier and tone with a shape or form and a word: circle, square, diamond, ringed diamond; filled, outlined, dashed, rail-filled.
- **Do** switch the focus ring to citron on navy and teal surfaces and keep it navy on light ones (3px, offset 3px).
- **Do** give stop rows a 1px #33456a edge in dark mode so they still read as bars.
- **Do** keep light-mode borders at Steel Border (#77828c, 3.48:1 on fog) or darker.
- **Do** limit tabular numerals to figures and data.
- **Do** separate surfaces with hard, zero-blur rings or 1 to 2px borders.

### Don't:
- **Don't** set poppy, citron, aqua, or uv-light as text on the fog ground or on white.
- **Don't** use citron on teal below bold 19px.
- **Don't** let color alone tell a tier, a tone, or an error.
- **Don't** add blurred or offset drop shadows.
- **Don't** apply `tnum` to running text; it widens Schibsted Grotesk's punctuation.
- **Don't** use teal as a second shell color; it belongs to the verdict.
- **Don't** set sentences in Big Shoulders Display, or use it below weight 800.
- **Don't** use any automaker's name, logo, or visual identity.
