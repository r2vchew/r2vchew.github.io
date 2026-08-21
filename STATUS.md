# Status

Last updated: 2026-08-10

GitHub Pages is enabled and serving from `main`. The site is at
https://r2vchew.github.io/ — **anything on `main` is public.**

## What is live

| Folder | What it is | Status |
| --- | --- | --- |
| `car-finder/` | Used-car shortlist for Calgary — scored, commented, with a drive-away cost estimate, a daily email digest and a plain-English feedback loop. | **Archived 2026-08-11** — the car was found. Schedule off, page still served. Full detail in `car-finder/STATUS.md`. |
| `digest/` | Subscription-email digest — news merged across outlets, then loyalty and marketing, with the feedback loop that teaches it. | **Live**, fed by a 7:30am ingest. Full detail in `Documents\Projects\life-hub\digest\STATUS.md`. |

`email-overview/` was removed on 2026-08-11 and replaced by `digest/`. It worked
by committing a generated `daily-brief.json`, which is what made publishing it a
privacy question. Its real failure was different: Save / Done / Flag lived in
`localStorage` behind a `localhost:8765` sync that was usually not running, so
corrections never accumulated and every rebuild restarted from blank assumptions.

## If you are picking this up cold

`car-finder/` is finished — read its `STATUS.md` for how it ended and how to
switch it back on. It is still worth reading for the defects found against live
data and the regression tests protecting them; the scraping and scoring code is
reusable.

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

For `car-finder/`, nothing — it is archived. Two loose ends are Vince's to
close: revoke the Gmail app password that the digest used, and delete the five
`CARFINDER_MAIL_*` secrets if the search is not coming back.
