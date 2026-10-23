# Vehicle research: cargo space, IIHS awards, and other awards

**AI-assisted research, human-verified.** A research agent drafts the facts, every fact carries a
source on an allowed site and a short quote, and a person checks each one in a pull request. Nothing
reaches the site until that review is recorded.

The result is `data/vehicle-research.json`. The car explorer uses it for:

- cargo space behind the second row, shown on each car and sortable
- IIHS Top Safety Pick and Top Safety Pick+, shown on each car with a filter
- award wins from the last three model years, listed on each car and sortable by count

NHTSA crash ratings are not part of this: they come straight from NHTSA's public API
(`npm run data:nhtsa`, see [`price-refresh.md`](price-refresh.md)).

## Why build-time, not a live agent

- **Accuracy you can check.** A wrong award claim on a public site is worse than none. A dated file
  with a source and a quote per fact can be checked by anyone; a live answer can't.
- **Cost and abuse.** A public page that runs an agent per visitor has unbounded cost and can be
  driven by anyone.
- **Privacy.** The site's browser talks only to its own server. A live agent would add a third
  party to every visit.

## When

Monthly, with the price refresh (first week of the month), and every model in August to October.
Awards are announced on fixed calendars, so also re-run the awards brief after each program's
announcement: NACTOY (January), World Car Awards (spring, at the New York auto show), Edmunds
Top Rated (early in the year), MotorTrend (late in the year, before the award year),
Car and Driver 10Best (late in the year) and EV of the Year (spring), IIHS (award year starts in
spring, with updates through the year).

## Steps

1. **Draft.** Run the three briefs below (for example with Claude Code, one agent per brief, two for
   cargo). Merge their output into `data/vehicle-research.json` with `"status": "draft"`.
2. **Check the rules and links.**

   ```bash
   npm run data:research:check -- --links --md review.md
   ```

   It fails on any source outside [`data/research-sources.json`](../data/research-sources.json), a
   value out of range, an unknown car, or a quote over 15 words. Fix or drop those entries.
3. **Open a pull request** with `review.md` as its description. The reviewer opens each source, finds
   the quote, and ticks the row. Sites that block scripts (MotorTrend, Car and Driver, Edmunds) are
   marked "open by hand".
4. **Record the review.** When every row is ticked or removed, set `"status": "reviewed"`,
   `"reviewedBy"`, and `"reviewedAt"` (YYYY-MM-DD) in the same pull request. Then merge.
5. `npm run data:vehicles` publishes it. A draft is ignored; a reviewed file with any rule problem
   fails the build.

## Rules every entry follows

- **Sources:** iihs.org for IIHS, the award publisher's own site for awards, and the carmaker's own
  U.S. site (or its official U.S. press site) for cargo. The allowed hosts are listed in
  `data/research-sources.json`; adding one is a reviewed change.
- **Wins only.** Not finalists, nominees, or "best of" lists. Car and Driver 10Best counts as a win.
- **Same car.** The award must be for the model line on the list (any trim), not a predecessor or a
  gas version. When unsure, leave it out and say why in the pull request.
- **Exact figures.** Cargo as published by the manufacturer for that model year (the base trim's
  figure when trims differ). No estimates, no conversions unless the maker publishes only liters.
- **Short quotes.** At most 15 words from the source, enough to find the claim on the page.
- **Every brand the same.** No commentary, no featured brand. Awards are listed with the award name,
  year, and publisher, and linked.

## The briefs

These are the instructions given to the research agents. Keep them in sync with the rules above.

### IIHS

> For every car in the explorer's list (id, make, model, model year), find whether it holds an IIHS
> Top Safety Pick or Top Safety Pick+ for the current or previous award year, using iihs.org only
> (the award-winner lists and each vehicle's ratings page). Record the award, award year, the model
> years it covers, any qualifier (for example "built after March 2026"), the iihs.org URL, and a
> quote of at most 15 words. Include every car; use `award: null` when there's no award, and note
> "not rated by IIHS" when IIHS hasn't rated it. No commentary; treat every brand the same.

### Awards

> List the award wins from the last three award years for the cars in the explorer's list, working
> program by program: MotorTrend Car, Truck, and SUV of the Year; Car and Driver 10Best and EV of the
> Year; Edmunds Top Rated; North American Car, Utility and Truck of the Year; World Car Awards (World
> Car, World Electric Vehicle, World Luxury Car, World Performance Car). Wins only, from the
> publisher's own page, with the award name as published, the award year, the URL, and a quote of at
> most 15 words. Exclude predecessors, gas versions, and other models, and list them separately with
> the reason. Put anything you can't confirm on the publisher's own page under "uncertain", not as a
> win.

### Cargo space

> For each SUV in the list, find the cargo volume behind the second row in cubic feet (second row up;
> for three-row SUVs, third row folded) from the manufacturer's own U.S. specifications for that
> model year. Use the figure exactly as published; when trims differ, the base trim's. For pickups,
> record null ("bed, not cargo volume"). Give the manufacturer URL and a quote of at most 15 words.
> If no manufacturer figure exists, record null and why. Never use dealer, review, or aggregator
> sites.

## File format

```json
{
  "checkedAt": "2026-10-22",
  "method": "AI-assisted research, human-verified",
  "status": "draft",
  "reviewedBy": null,
  "reviewedAt": null,
  "vehicles": {
    "kia-ev9": {
      "cargoCuFt": { "value": 20.2, "modelYear": 2026, "source": "https://www.kia.com/...", "evidence": "..." },
      "iihs": { "award": "TSP+", "year": 2026, "modelYears": "2026", "qualifier": null, "source": "https://www.iihs.org/...", "evidence": "..." },
      "awards": [ { "name": "World Car of the Year", "publisher": "World Car Awards", "year": 2024, "url": "https://www.worldcarawards.com/...", "evidence": "..." } ]
    }
  }
}
```

Only cars with at least one fact need an entry. Absent facts stay absent: the page shows nothing for
them, sorts them last, and never treats them as zero.
