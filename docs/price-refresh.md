# Vehicle price and link refresh

The car explorer lists starting prices for every fully electric SUV, minivan, and pickup on sale in
the U.S. Prices change, so they are re-checked on a schedule. The data lives in one hand-curated
file, [`data/vehicles-curated.json`](../data/vehicles-curated.json). EPA range and efficiency come
from fueleconomy.gov and are joined in at build time.

## When

| When | What | Why |
|---|---|---|
| **First week of every month** | Full price check (below) | List prices and destination fees usually change at most a few times a year per brand. A monthly check keeps every price within a few weeks of current. |
| **Mid-month** | Tesla and any brand in the news for a price change | Tesla changes U.S. prices without notice, sometimes several times a quarter. Rivian, Lucid, and Polestar have also moved prices between model-year launches. |
| **August through October** | Every model, every month, including trims and model years | Model-year changeover. Most brands launch the new year in this window, often with new starting prices, renamed trims, or a model paused for a year. The build prints a reminder during these months. |
| **Any time a federal or state incentive changes** | Re-read the notes on the explorer | The explorer shows prices before incentives. If incentives come back, the copy should say so. |

The build warns when prices are more than 35 days old:

```
WARN vehicle prices were checked 41 days ago (2026-10-19); re-check them (docs/price-refresh.md).
```

## The monthly check (about 45 minutes)

1. For each vehicle in `data/vehicles-curated.json`, open its `source` (the brand's own U.S. site
   where possible) and confirm the **least expensive trim orderable today**, its starting MSRP,
   destination fee, seats, and third row. Keep the rule in the file's `rule` field. A trim that
   can't be ordered, or only exists as old stock, doesn't count.
2. Update `msrp`, `destination`, `modelYear`, `source`, and `confidence` (`high` for the
   brand's own configurator, `medium` for a dated trade report). Put anything unusual in `notes`.
3. Check the `notOnSale` list: has anything returned? Has anything listed stopped being sold?
   Move entries between `vehicles` and `notOnSale` with a dated `reason`.
4. Check `minivans`: is a fully electric minivan on sale in the U.S. yet?
5. Check the finance `assumptions`: the average new-car loan APR (Experian's quarterly *State of
   the Automotive Finance Market*) and whether a published average lease residual or money
   factor now exists. Update the period and source.
6. Spot-check the `brands` links (below).
7. Set `checkedAt` to today, then run:

   ```bash
   npm run data:vehicles
   ```

   It joins EPA data, fails a vehicle with no EPA rating out of the explorer (and says so), and
   checks every brand link. Fix any `WARN` line it prints.
8. Run `npm test` and `npm run test:e2e`, then open a pull request titled
   `Vehicle prices: <month year>`. The diff of `site/data/vehicles.json` is the review.

## Brand links (every quarter, or when a link breaks)

Test-drive links go only to each brand's own U.S. site. For each make:

- `bookUrl`: the brand's test-drive or demo-drive booking page, or `null` if it has none.
- `dealerUrl`: its dealer or retailer locator (`null` for brands that only sell direct).
- `bookZipUrl` / `dealerZipUrl`: the same pages with `{zip}` where the ZIP goes. Only add one
  after loading it with a ZIP you haven't used on that site before and seeing the results
  change to that area. Many sites remember the last ZIP, and many ignore URL parameters.

The build rejects any link that isn't `https://` and any ZIP template without exactly one `{zip}`.
Last full check: 2026-10-19 (`brandsCheckedAt`).

## What not to do

- Don't use dealer-group, lead-generation, or affiliate sites for prices or links.
- Don't feature, reorder, or badge any brand. The explorer sorts only by the visitor's own
  filters.
- Don't estimate a missing price. Leave the vehicle out and say why in `notOnSale`.
