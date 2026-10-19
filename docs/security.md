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
- [ ] **Host on Cloudflare Pages** (free) rather than GitHub Pages, so `site/_headers` applies
  real security headers, including clickjacking protection (`frame-ancestors`), which a
  `<meta>` CSP cannot do. GitHub Pages is acceptable: the risk is someone framing the page
  in their own site, and the page has no logins or actions to hijack.
- [ ] **15-minute screen-reader pass** (NVDA on Windows, VoiceOver on iPhone). See
  `docs/accessibility.md`.
- [ ] **Read the results page for your own ZIP and two others** and sanity-check the numbers.

### Nice to have
- [ ] Turn on GitHub's Dependabot alerts and secret scanning on the repo.
- [ ] Use UTM tags on shared links (`?utm_source=linkedin`, `?utm_source=cohort`).

## What the site does and does not do

- Static files only. No server code, no database, no logins, no forms that send data.
- No API keys at runtime. All data is precomputed at build time. Build scripts read
  optional `NREL_API_KEY` / `NPS_API_KEY` from the environment only, redact them from logs,
  and never write them to disk.
- The PostHog project key (`phc_...`) is public by design: it can send events, not read them.
- The visitor's ZIP is used only to request `data/zip/{first 3 digits}.json` from the same
  site. A host's access logs would see those three digits, not the full ZIP.

## Review (October 2026)

Independent read-only review of the whole repository (no remote existed yet, so the
diff-based `security-review` skill could not run). Findings and what was done:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | PostHog's server-side GeoIP lookup would add postal code, city, and coordinates to stored events, after the client filter runs | Medium | **Fixed:** `$geoip_disable: true` on every event (tested); GeoIP transformation off in project settings added to setup steps |
| 2 | On-page privacy text overstated ("answers stay in your browser", "nothing is stored"); footer did not list browser type, screen size, referrer | Medium | **Fixed:** wording now matches exactly what is sent |
| 3 | "No IP kept" depends on a PostHog project setting; the client cannot enforce it | Low | **Documented:** must-do item above, plus a live check |
| 4 | Public key means anyone can send fake events (skews results, could use quota) | Low | **Mitigated:** billing limit, filter insights to production `$host`, treat A/B as directional |
| 5 | GitHub Pages ignores `_headers`; no clickjacking header there | Low | **Mitigated:** recommend Cloudflare Pages |
| 6 | Dev server listened on all network interfaces | Low | **Fixed:** binds to 127.0.0.1 |
| - | Build-time map keyed by upstream text could hit `__proto__` | Info | **Fixed:** `Object.create(null)` |

Checked and fine: no `innerHTML`/`eval`/inline handlers anywhere in `site/`; all rendering
via `textContent`; only `https://` links rendered, all with `rel="noopener noreferrer"`;
park links restricted to `www.nps.gov` at build time; ZIP must be exactly 5 digits before it
is used in a path; shard lookup uses `Object.hasOwn`; answers checked against allowed values;
strict CSP with no `unsafe-inline`; vendored PostHog file matches the pinned npm package
(sha384 in `site/vendor/README.txt`); lockfile pins exact versions; no secrets in the files or
git history; `npm audit` reports 0 vulnerabilities; dev server path traversal blocked.

## Automated guards

- `tests/e2e/privacy.e2e.mjs` intercepts real analytics traffic (nothing reaches PostHog) and
  asserts: only named events; ZIP absent from every payload; no ad click ids; URLs without
  query strings; no IP, raw user agent, or timezone; GeoIP disabled; no cookies,
  localStorage, or sessionStorage; no unexpected hosts; nothing at all with Global Privacy
  Control on.
- `tests/analytics.test.mjs` unit-tests the allowlist filter.
- `tests/logic.test.mjs` includes rejection of malformed ZIPs and unknown answer values.
