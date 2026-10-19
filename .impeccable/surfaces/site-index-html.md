---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: []
---

# Surface brief: EV Readiness Check (whole flow)

## Scope and mode

The whole single-page flow in `site/index.html`: landing, up to five questions, loading and error
states, results, the "Get my EV plan" checklist, and the privacy footer. Mode: Operate (a tool the
visitor uses to get an answer); the landing is the one Persuade moment inside it.

## Audience, task, proof

EV-curious millennial renter family (PRODUCT.md), often arriving on a phone from a shared link.
Task: get an honest, personal answer in a minute or two, then take a next step ("Get my EV plan",
the north star). Proof: every row shows a real public-data figure with its unit; the open row shows
the detail and its source.

## Direction contract

THESIS: Your EV readiness drawn as a route: one colored line runs from your home through every stop
that decides it (charging, range, fuel, the park), each stop a row with one straight answer. It
refuses the category default of a gauge, stat tiles, and a "why" list that repeat each other.

OWN-WORLD: Deep navy shell and rows (#101a2b), a teal verdict field (#0b7f8a), poppy primary action
(#ff5a36), citron, aqua, and ultraviolet-light as stop colors on navy only, fog ground (#eef2f5);
Big Shoulders Display (condensed, 800 to 900) for the verdict and figures, Schibsted Grotesk for text,
tabular figures everywhere; 4px radii; the route line is 14px with white-ringed stations.

STORY: The visitor sees their verdict in words, learns the one answer that would change it most,
scans five stops down the line, opens any stop for detail and source, then takes "Get my EV plan".

FIRST VIEWPORT: Results: navy top bar; full-width teal band with the tier mark and the verdict at
96px condensed caps, one-sentence summary with the answer that matters most in citron, and the
poppy "Get my EV plan" button at right; tier chips and a one-line instruction; then the five stop
rows, each a navy bar with the line passing through its station, label and detail on the left, and
the figure at 52px in the stop's color on the right. Landing: navy hero with the headline (A/B copy),
ZIP field and button, and the loaded family-EV drawing (car seat, dog, roof box) riding the route
line toward a park.

FORM: fused by the user from the round: the assigned direction's world (Gear Spec), the competitive
challenger's structure (Terminal Yellow rows), and the pick's signature (Family Transit Map line);
seed:97010abdc7951ccd. Signature interaction: the line draws down stop by stop when results load,
and question progress fills stations along the same line. Rows expand in place.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions (defaults taken)

- Dark mode supported: ground becomes deep navy; rows and band keep their colors.
- A/B: the adventure variant moves the Parks stop to second; the savings variant moves Fuel to second.
- No new analytics events; row expansion is not tracked.
