# Status — Car finder

Last updated: 2026-08-10

## Where it stands

The pipeline runs end to end in CI against the live sites and commits real
results. A scan on 2026-08-10 read **151 listings** and produced a scored,
commented shortlist.

### Sources, as measured in CI

| Source | State | Notes |
| --- | --- | --- |
| Kijiji | Working | ~46 cars/page via JSON-LD, with VIN, price, km, transmission, colour. Best source, and the only strong one for private sellers. Paginates via `page-N/`. |
| AutoTrader.ca | Working | 20 cars/page via JSON-LD. Must use the canonical `/cars/reg_ab/cit_calgary/…` path — the query-string form redirects and silently drops the location, returning Quebec dealers. Paginates via `&page=N`. |
| Carpages.ca | Working | 19 cars/page via the HTML card scanner. Ignores its page parameter, so effectively one page. |
| CarGurus.ca | Blocked | Refuses GitHub's runners on every entry point tried (403/406/404). Skipped unless a scraping proxy is configured, so it does not sit permanently red. |

### Verified

- Filtering, scoring, dedupe, and the local price model.
- Commentary, including the model-specific warnings.
- Dashboard rendering on desktop and mobile.
- Email digest rendering, and the SMTP client end to end against a local TLS
  server — auth, multiple recipients, and UTF-8 through subject and body.
- Plain-English feedback parsing and application to `criteria.json`.
- Non-car filtering, added after the first live scan ranked a $5,969 four-post
  car lift as the best match in Kijiji's Cars & Trucks category.

## Next actions

1. **Enable GitHub Pages** — Settings → Pages → deploy from `main`, root. The
   dashboard is not reachable until this is done.
2. **Add the `MAIL_*` secrets** to turn the digest on (see the README). Without
   them everything still runs; it just does not email.
3. Confirm the default scope: $3,500–$16,000, 2016+, under 180,000 km,
   automatic only, within 150 km of Calgary.

## Open questions for Vince

- Her email address for the digest.
- Whether $16,000 is the right ceiling — the research put a Calgary first car
  at roughly $15,000–$20,000, so this sits deliberately at the low end.
- Whether she will use a free GitHub account for feedback, or whether the
  button should post to a form endpoint instead.

## Known limits

- Carpages contributes a single page per scan until its pagination parameter is
  identified.
- Some AutoTrader records carry no model year in their structured data; the
  year is recovered from the URL slug where possible, and left null otherwise.
- Everything is asking prices from public search pages, and goes stale.
