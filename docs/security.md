# Security and privacy review

## Launch go/no-go (for Hillary)

**Verdict: GO for posting publicly once the four open "Must" items are checked.** The code side is
done and tested; the remaining items are account settings only you can change.

### Must, before sharing with the cohort or on LinkedIn
- [ ] **Deploy only the `site/` folder** (set it as the publish/output directory).
- [ ] **If analytics is on:** in PostHog project settings, turn on **Discard client IP
  data** and turn off the **GeoIP** transformation (steps 3-4 in `docs/analytics.md`).
  If you skip PostHog entirely, leave the key empty: the site works with analytics off.
- [ ] **PostHog billing safety:** free plan with no card, or a billing limit set.
- [ ] **Live payload check:** do one run on the deployed site with
  `?utm_source=internal`, open the event in PostHog, and confirm no `$ip` value and no
  `$geoip_*` properties.
- [x] **Security review of all code.** The `security-review` skill reviews changes not yet
  pushed to `origin`, so it could not cover the initial build (first there was no remote,
  then nothing was unpushed). An equivalent independent review of the whole repository
  was done instead (below). Run the skill on future changes before pushing them.

### Should
- [x] **Host on Cloudflare** (Workers static assets, free; configured in `wrangler.jsonc`) rather than GitHub Pages, so `site/_headers` applies
  real security headers, including clickjacking protection (`frame-ancestors`), which a
  `<meta>` CSP cannot do. GitHub Pages is acceptable: the risk is someone framing the page
  in their own site, and the page has no logins or actions to hijack.
- [ ] **15-minute screen-reader pass** (NVDA on Windows, VoiceOver on iPhone). See
  `docs/accessibility.md`.
- [ ] **Read the results page for your own ZIP and two others** and sanity-check the numbers.

### Nice to have
- [ ] In the GitHub repo settings: turn on **secret scanning with push protection** and
  **Dependabot alerts**, and protect `main` (require a pull request and the CI check to pass).
  Dependabot version updates and the CI workflow are already in `.github/`.
- [ ] Use UTM tags on shared links (`?utm_source=linkedin`, `?utm_source=cohort`).

## What the site does and does not do

- Static files plus one small Worker endpoint, `/api/geocode`, for address search in the plan
  tools. No database, no logins, no forms that send data anywhere else.
- **The geocoding proxy** ([`worker/index.js`](../worker/index.js)) holds the only runtime key
  (`GEOAPIFY_KEY`, a Cloudflare secret, never in the repo). It answers only same-origin `GET`
  requests, checks the query (3-120 printable characters) and the bias point (U.S. bounds),
  limits each visitor to 30 searches a minute by a SHA-256 hash of the IP, times out after 5
  seconds, and returns only name, short address, coordinates, and type. Responses are
  `no-store`. Worker logs and observability are off, so searches are not kept. With no key
  set, it returns "search unavailable" and the page falls back to ZIP. Spend cap: Geoapify's
  free plan with no card on file refuses requests past its quota instead of billing.
- Build scripts read optional `NREL_API_KEY` / `NPS_API_KEY` from the environment only, redact
  them from logs, and never write them to disk.
- The PostHog project key (`phc_...`) is public by design: it can send events, not read them.
- The visitor's ZIP is used only to request `data/zip/{first 3 digits}.json` from the same
  site. A host's access logs would see those three digits, not the full ZIP. A brand
  test-drive link includes the ZIP only where it says so ("near 80302"), and only when the
  visitor clicks it.
- **Saved plans** stay in the visitor's browser (`localStorage`, `evrc-plan-v1`), written only
  after they save something. **Share links** carry the plan after `#`, which browsers don't
  send to servers. Saved places are left out unless the visitor includes them. Every field of
  a saved or shared plan is validated on load (ids, slots, U.S. coordinates, counts, number
  ranges) and rendered as text.

## Review (October 2026)

Independent read-only review of the whole repository (no remote existed yet, so the
diff-based `security-review` skill could not run). Findings and what was done:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | PostHog's server-side GeoIP lookup would add postal code, city, and coordinates to stored events, after the client filter runs | Medium | **Fixed:** `$geoip_disable: true` on every event (tested); GeoIP transformation off in project settings added to setup steps |
| 2 | On-page privacy text overstated ("answers stay in your browser", "nothing is stored"); footer did not list browser type, screen size, referrer | Medium | **Fixed:** wording now matches exactly what is sent |
| 3 | "No IP kept" depends on a PostHog project setting; the client cannot enforce it | Low | **Documented:** must-do item above, plus a live check |
| 4 | Public key means anyone can send fake events (skews results, could use quota) | Low | **Mitigated:** billing limit, filter insights to production `$host`, treat A/B as directional |
| 5 | GitHub Pages ignores `_headers`; no clickjacking header there | Low | **Mitigated:** hosted on Cloudflare, which applies `_headers` |
| 6 | Dev server listened on all network interfaces | Low | **Fixed:** binds to 127.0.0.1 |
| - | Build-time map keyed by upstream text could hit `__proto__` | Info | **Fixed:** `Object.create(null)` |

Checked and fine: no `innerHTML`/`eval`/inline handlers anywhere in `site/`; all rendering
via `textContent`; only `https://` links rendered, all with `rel="noopener noreferrer"`;
park links restricted to `www.nps.gov` at build time; ZIP must be exactly 5 digits before it
is used in a path; shard lookup uses `Object.hasOwn`; answers checked against allowed values;
strict CSP with no `unsafe-inline`; vendored PostHog file matches the pinned npm package
(sha384 in `site/vendor/README.txt`); lockfile pins exact versions; no secrets in the files or
git history; `npm audit` reports 0 vulnerabilities; dev server path traversal blocked.

## Review: plan v2 phase A (October 2026)

A diff-based security review of the search proxy, saved plans, share links, the plan tools, and
the brand links found **no high-confidence vulnerabilities**. What was traced:

- **Proxy to Geoapify:** fixed host and protocol, every parameter set with `URLSearchParams`
  (a query can't add `apiKey` or other parameters), and the key set last from the secret.
  Errors are fixed codes; upstream bodies are never echoed. Responses are rebuilt from a
  whitelist and never cached.
- **Search results, share links, and saved plans to the page:** text only, never `href`,
  `src`, `innerHTML`, or styles. Share fragments are character-checked, size-limited, and
  rebuilt field by field by `sanitizePlan`; localStorage goes through the same path.
- **Links:** `externalLink` allows only `https:` and adds `rel="noopener noreferrer"`. A
  brand ZIP template is filled only with a ZIP re-checked as five digits.
- **Analytics:** no new property carries an address, coordinate, ZIP, or station id, and the
  `#plan=` fragment is cleared before analytics can load.

Lower-confidence notes, and what was done:

| Note | Status |
|---|---|
| Opening a share link and changing anything replaced a plan already saved on the device, without saying so | **Fixed:** the shared-plan banner says so when a saved plan exists |
| The vehicle build only warned on a non-https brand link or a bad `{zip}` template | **Fixed:** it now fails (the page also refuses non-https links) |
| A lunch-spot search sends the chosen work place's rough location as a ranking hint | **Disclosed:** the privacy list now says so; it goes through the proxy and is not stored |
| Share-link size is checked after decompression | Accepted: a crafted link can only slow the visitor's own tab |
| `Sec-Fetch-Site` can be forged outside a browser | Accepted: the per-visitor rate limit and the no-card free plan cap the cost |

## Automated guards

- `tests/e2e/privacy.e2e.mjs` intercepts real analytics traffic (nothing reaches PostHog) and
  asserts: only named events; ZIP absent from every payload; no ad click ids; URLs without
  query strings; no IP, raw user agent, or timezone; GeoIP disabled; no cookies,
  localStorage, or sessionStorage; no unexpected hosts; nothing at all with Global Privacy
  Control on.
- `tests/analytics.test.mjs` unit-tests the allowlist filter.
- `tests/logic.test.mjs` includes rejection of malformed ZIPs and unknown answer values.
- `tests/worker.test.mjs` checks the proxy: cross-site and non-GET requests refused, bad
  queries and out-of-bounds points rejected, rate limit returns 429, missing key returns 503,
  and the key never appears in a response.
- `tests/plan.test.mjs` checks that saved and shared plans are sanitized and that share links
  round-trip with and without places.
- `tests/e2e/plan-tools.e2e.mjs` runs search, save, shortlist, and share in a browser and
  checks that analytics never receives an address, coordinate, ZIP, or station name, and
  that brand links are https, open in a new tab with `noopener`, and include the ZIP only
  where labeled.
- `npm run data:vehicles` fails on any brand link that isn't `https://` or has a bad `{zip}` template.
