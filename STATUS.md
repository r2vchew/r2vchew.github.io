# Status

Last updated: 2026-08-10

GitHub Pages is enabled and serving from `main`. The site is at
https://r2vchew.github.io/ — **anything on `main` is public.**

## What is live

| Folder | What it is | Status |
| --- | --- | --- |
| `car-finder/` | Used-car shortlist for Calgary — scored, commented, with a drive-away cost estimate, a daily email digest and a plain-English feedback loop. | **Running daily and emailing.** Full detail in `car-finder/STATUS.md`. |
| `digest/` | Subscription-email digest — news merged across outlets, then loyalty and marketing, with the feedback loop that teaches it. | **Live**, fed by a 7:30am ingest. Full detail in `Documents\Projects\life-hub\digest\STATUS.md`. |

`email-overview/` was removed on 2026-08-11 and replaced by `digest/`. It worked
by committing a generated `daily-brief.json`, which is what made publishing it a
privacy question. Its real failure was different: Save / Done / Flag lived in
`localStorage` behind a `localhost:8765` sync that was usually not running, so
corrections never accumulated and every rebuild restarted from blank assumptions.

## If you are picking this up cold

Read `car-finder/STATUS.md`. It has the current scope, what each listing source
is doing, what is still outstanding, and the list of defects found against live
data that have regression tests protecting them.

## Conventions worth knowing

- **Secrets are namespaced per project** (`CARFINDER_MAIL_*`), because this
  repository holds several. A new project that needs email should add its own
  `SOMETHING_MAIL_*` set and map them onto the generic `MAIL_*` env vars that
  `car-finder/scripts/send-mail.mjs` reads — that script is reusable as-is.
- **Nothing personal goes in the repository.** Recipient addresses live in
  secrets only. `digest/` holds to this by being an authenticated app: the page
  is markup and JavaScript, and every story, note and rule is fetched only after
  a real sign-in. The Supabase publishable key committed there grants nothing on
  its own — `anon` is denied on every digest object, verified over HTTP rather
  than only in the database.
- Each project keeps its own `README.md` (how it works) and `STATUS.md`
  (operational state).

## Next useful action

Watch for the first scheduled scan (11:40 UTC daily) to land a digest, then
watch for feedback. Nothing has come through the feedback loop yet — see the
outstanding list in `car-finder/STATUS.md` for the two candidate reasons.
