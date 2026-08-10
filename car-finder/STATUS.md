# Status — Car finder

Last updated: 2026-08-10

## Where it stands

The full pipeline is built and tested end to end against fixture data: fetch →
normalize → dedupe → filter → score → commentary → dashboard → email digest →
feedback → criteria update.

Verified working:

- Scoring, filtering, dedupe and the local price model.
- Commentary generation, including model-specific warnings.
- Dashboard rendering on desktop and mobile.
- Email digest rendering.
- Plain-English feedback parsing and application to `criteria.json`.

Not yet verified: **the four scrapers against the live sites.** The session
that built this had those domains blocked by network policy, so the adapters
were written defensively (three independent extraction strategies each) but
have never seen a real response. The `Car finder probe` workflow exists to
close that gap from CI.

## Next actions

1. Enable GitHub Pages (`main`, root) so the dashboard is reachable.
2. Run the **Car finder probe** workflow and fix any adapter that returns zero.
3. Add the `MAIL_*` secrets to turn on the email digest.
4. Confirm the default scope is right: $3,500–$16,000, 2016+, under 180,000 km,
   automatic only, within 150 km of Calgary.

## Open questions for Vince

- Her email address for the digest.
- Whether $16,000 is the right ceiling.
- Whether she will use a GitHub account for feedback, or whether the button
  should post to a form endpoint instead.
