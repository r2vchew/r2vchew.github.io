# Status

Last updated: 2026-08-10

GitHub Pages is enabled and serving from `main`. The site is at
https://r2vchew.github.io/ — **anything on `main` is public.**

## What is live

| Folder | What it is | Status |
| --- | --- | --- |
| `car-finder/` | Used-car shortlist for Calgary — scored, commented, with a drive-away cost estimate, a daily email digest and a plain-English feedback loop. | **Running daily and emailing.** Full detail in `car-finder/STATUS.md`. |
| `email-overview/` | Privacy-safe Email Overview companion. | Published |

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
  secrets only.
- Each project keeps its own `README.md` (how it works) and `STATUS.md`
  (operational state).

## Next useful action

Confirm `CARFINDER_MAIL_TO` points at the intended recipient rather than the
test address, and send the intro email drafted in Gmail.
