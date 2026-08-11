# Status — Car finder

Last updated: 2026-08-11

**It is live, scanning daily, and emailing.** Everything below is the state of a
working system, not a plan.

- Dashboard: https://r2vchew.github.io/car-finder/
- Scans at **11:40 UTC daily** (05:40 Calgary MDT), plus immediately whenever
  feedback arrives, plus **Actions → Car finder → Run workflow** on demand.
- Emails a digest **only when something new clears the bar**. Silence is the
  system working, not failing.

## Who it is for

Vince's friend Nicole (nicole.kashuba@gmail.com) is buying a first car for her
daughter in Calgary. Her stated criteria: relatively inexpensive, **no manual
transmission**, nothing too old.

Her address is **only in the `CARFINDER_MAIL_TO` secret**. This repository is
public — do not commit it anywhere.

## Current scope

`car-finder/data/criteria.json` is the source of truth:

$3,000–$13,000 **asking price**, 2010 or newer, under 220,000 km, automatic
only, within 150 km of Calgary. The realistic drive-away cost is estimated on
top of the sticker and shown per car. **Insurance is deliberately excluded.**

## Last verified scan (2026-08-11 13:22 UTC)

90 candidates on the dashboard, with the digest sent successfully. Verified
against that data: no cargo vans survive the commercial filter, and no two rows
share a make, price and odometer, so the cross-site duplicates are gone.

| Source | State | Notes |
| --- | --- | --- |
| Kijiji | **Working** (92) | ~46 cars/page via JSON-LD, with VIN, price, km, transmission, colour. The only strong source for private sellers. Paginates via `page-N/`. |
| AutoTrader.ca | **Working** (40) | 20 cars/page via JSON-LD. Must use the canonical `/cars/reg_ab/cit_calgary/…` path — the query-string form redirects and silently drops the location, returning Quebec dealers. Paginates via `&page=N`. |
| Carpages.ca | **Degraded** (1) | Read by the positional card scanner, which on the real page rarely finds a mileage. Since an uncorroborated price is probably a misread, those rows are dropped. Needs its real markup inspected. |
| CarGurus.ca | **Skipped** (0) | Refuses GitHub's runners on every entry point tried (403/406/404). Sits out unless `SCRAPINGBEE_API_KEY` or `SCRAPERAPI_KEY` is set. **Researched: no coverage gap** — CarGurus Canada is dealer-only, and those dealers advertise on AutoTrader too. Its unique value is its own deal rating, not inventory. |

**Facebook Marketplace is the real coverage gap** — it blocks automation, and
has private sellers who post nowhere else. Nicole has been told to browse it
manually.

## Configured and working

- All five `CARFINDER_MAIL_*` secrets are set, and a send to the real recipient
  list was confirmed on 2026-08-11 (`Digest sent to ***`, run `31495824474`).
  `CARFINDER_MAIL_TO` carries Nicole and Vince; `CARFINDER_MAIL_USERNAME` is the
  single sending mailbox — see "The mail settings that bite" below.
- GitHub Pages serves `main` at the repository root.
- 95 regression checks run in CI before every scan (`node scripts/test.mjs`).

## The mail settings that bite

Two failures on 2026-08-11 came from the same confusion, and cost a morning:

| Run | Error | Cause |
| --- | --- | --- |
| `31491301151` | `535-5.7.8 Username and Password not accepted` | `MAIL_USERNAME` was not a single address |
| `31494460172` | `501-5.5.4 HELO/EHLO argument "gmail.com, vchew67" invalid` | same value, now breaking EHLO |

`MAIL_USERNAME` is **one mailbox — the sender**. The recipient list goes in
`MAIL_TO`. Putting a list in `MAIL_USERNAME` breaks it in a way that reads like
a password problem, because `"a@b.com, c@d.com".split('@')[1]` is `"b.com, c"`.
`send-mail.mjs` now refuses a multi-address sender before opening a socket and
says which setting is wrong.

## Outstanding

1. **No feedback has arrived yet** — the repository has zero issues. The first
   digest only reached Nicole on 2026-08-11, so there has been nothing to react
   to. If it stays silent from here, suspect item 2.
2. **The GitHub-issue feedback route needs a free GitHub account.** That is real
   friction for a non-technical recipient, and the button used to dead-end at a
   sign-in wall with no explanation. There are now three routes: the issue form,
   a **Copy it instead** button, and replying to the digest email (which lands
   in Vince's mailbox — he pastes it in). If feedback stays silent once digests
   are actually arriving, this is the first thing to suspect.
3. **Conflicting feedback is not resolved — and the wrong side wins.**
   `applyChanges` in `lib/interpret.mjs` blindly overwrites, so two notes
   touching the same setting in one batch resolve as last-write-wins. Issues
   come back from the API newest-first and are applied in that order, so the
   **older** request is applied last and survives. Both authors still get a
   reply saying their change was made, so both believe they won.

   **Deliberately left alone** (Vince, 2026-08-11): with only Nicole submitting
   feedback there is nothing to conflict. Fix it before adding a second person
   who submits. The agreed fix is **newest wins, with a comment telling the
   loser their change was overridden** — not "most cautious wins", which
   surprises anyone deliberately widening the search. Rejections are additive
   and never conflict; this affects `hard`/`soft` criteria only.
4. **Listing photos may not load** in the email or dashboard — sites often
   block hotlinking, and this was never testable from the build environment.
   Both degrade to a placeholder rather than breaking.

`CARFINDER_MAIL_TO` now points at Nicole, and the intro email was sent by hand
on 2026-08-11.

## Adding more recipients

`CARFINDER_MAIL_TO` is comma-separated — edit the one secret, add no others.
`send-mail.mjs` splits it, issues one `RCPT TO` per address, and lists them all
in the `To:` header. There is **no CC or BCC**, so every recipient sees the
others' addresses.

Saves and rejections are per-browser `localStorage`, not shared: two people
reading the same digest keep separate marks, and only whoever actually submits
feedback changes the search. See outstanding item 3 before adding a second
person who will submit.

## Why the daily run is not on anyone's computer

It is a GitHub Actions cron, so it runs in GitHub's cloud, free on a public
repository, whether or not any machine is awake. **Do not add a second scheduler
on a desktop.** Two schedulers scanning the same repository produce divergent
commits to `data/` — that exact failure already happened once when a branch push
trigger and a dispatched `main` scan overlapped, and it is why the push trigger
was removed from the scan workflow.

## Why the kilometre cap is 220,000

It was 180,000, which contradicted the 2010 year floor. Alberta cars run about
20,000 km/year, so a 2012 at typical use has ~280,000 km — the flat cap quietly
excluded almost every 2010–2014 car, making the year range mostly theoretical.

220,000 is roughly eleven years of average use, and sits below the ~250,000
point where transmissions and timing components start becoming likely money on
any car. Discrimination is left to the scorer, which compares each car against
the expected kilometres **for its age** (`expectedKm` in `knowledge.mjs`) rather
than a flat line. The evidence that this works: in the 2026-08-11 scan the
160–180k band held 18 cars averaging a score of 30, and only one cleared the
bar — high-kilometre cars already fail on their merits. The one that cleared was
a $3,000 Elantra Touring at 180,000 km scoring 77, which is exactly the kind of
cheap, sound, high-kilometre car the old cap was throwing away.

## Things learned the hard way

Each of these was a real defect found against live data, and each has a
regression test. Do not undo them casually.

- **Kijiji's Cars & Trucks category is not only cars.** The first live scan
  ranked a $5,969 four-post car lift as the best match. Records now need a
  model year or a recognised make (`looksLikeVehicle`).
- **Kijiji sends `othrmdl`** when a seller skips the model dropdown. It rendered
  as "2018 Kia Othrmdl LX+" while the title said "Rio" all along.
- **A card's price and mileage merged into one number** because the thousands
  separator allowed a plain space: `"$8,100 162,000 km"` parsed as one
  15-million-dollar figure, failed the sanity check, and left the card with
  neither value. That is what produced a "2016 CX-5 for $4,800".
- **Cards link to the same car twice** (image, then heading). Ending the scan
  window at the next anchor cut each card in half and shifted prices onto the
  wrong listings.
- **Cross-generation price comparisons mislead.** A 2012 Elantra at $3,500 was
  reported as "64% below market" against a field of 2018s. Comparisons are now
  bounded to ±2 model years.
- **Seller type moves the real cost by four figures**, so it gets three
  detection routes. It was unknown on 55 of 71 cars before that work.
- **Work vehicles pass every numeric filter.** A windowless 2013 Ram Cargo Van
  is cheap, automatic and low-kilometre, and reached the digest at "worth a
  look". `COMMERCIAL_RE` in `score.mjs` is deliberately narrow: a cargo van is a
  Grand Caravan with the windows deleted, so the passenger minivan has to
  survive it. Match cargo wording and commercial-only nameplates, never "van".
- **Most listings carry no VIN, so cross-site duplicates survived.** The same
  Elantra appeared from AutoTrader and Kijiji at $9,811 and 73,980 km, and only
  escaped the year check because AutoTrader omitted the year. `dedupe` now has a
  second pass keyed on make + exact price + exact odometer, with year left out
  on purpose — a missing year is the case it exists to catch.
- **Score bands must track the scoring weights.** Adding the age and cost
  penalties moved the distribution down ~15 points, and the dashboard announced
  "nothing cleared the bar" while listing 71 cars. `BANDS` in `score.mjs` is
  calibrated against a real scan; a test asserts the shortlist stays reachable.

## Where to look

`car-finder/README.md` has the architecture, the file-by-file map, the cost
model, and the runbook for when a source stops returning cars.

Development happens on `claude/used-car-finder-dashboard-00b6md`, which is kept
identical to `main`.
