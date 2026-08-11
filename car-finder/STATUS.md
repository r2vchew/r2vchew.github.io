# Status — Car finder

Last updated: 2026-08-10

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

$3,000–$13,000 **asking price**, 2010 or newer, under 180,000 km, automatic
only, within 150 km of Calgary. The realistic drive-away cost is estimated on
top of the sticker and shown per car. **Insurance is deliberately excluded.**

## Last verified scan (2026-08-10 18:28 UTC)

133 listings read → 67 candidates. Bands: 1 shortlist, 8 worth a look, 20
maybe, 38 probably not. Seller type resolved on 48 of 67.

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

- All five `CARFINDER_MAIL_*` secrets are set. A send was confirmed in the log
  on 2026-08-10 (`Digest sent to ***`).
- GitHub Pages serves `main` at the repository root.
- 70 regression checks run in CI before every scan (`node scripts/test.mjs`).

## Outstanding

1. **`CARFINDER_MAIL_TO` may still point at Vince**, not Nicole — it was set to
   his own address to test first. Confirm and switch it.
2. **An intro email to Nicole is drafted in Vince's Gmail** ("A car-hunting
   helper I set up for you"), not sent. The Gmail tools available can create
   drafts but cannot send.
3. **Listing photos may not load** in the email or dashboard — sites often
   block hotlinking, and this was never testable from the build environment.
   Both degrade to a placeholder rather than breaking.

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
- **Score bands must track the scoring weights.** Adding the age and cost
  penalties moved the distribution down ~15 points, and the dashboard announced
  "nothing cleared the bar" while listing 71 cars. `BANDS` in `score.mjs` is
  calibrated against a real scan; a test asserts the shortlist stays reachable.

## Where to look

`car-finder/README.md` has the architecture, the file-by-file map, the cost
model, and the runbook for when a source stops returning cars.

Development happens on `claude/used-car-finder-dashboard-00b6md`, which is kept
identical to `main`.
