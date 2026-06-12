# Grocery deals page pipeline

Builds `groceries.html` from the weekly deals doc that the grocery routine
writes to the Drive folder `Claude/grocery-deals`.

## Weekly update (run every Wednesday, after the new flyer doc lands in Drive)

One-shot: read the newest "Grocery Deals - Cochrane - YYYY-MM-DD" Google Doc
from the Drive folder `Claude/grocery-deals`, then feed its text verbatim
(escaped markdown like `\#`, `\-` from the Docs export is fine — the parser
unescapes it) to:

    python3 scripts/grocery/update_week.py -   # reads doc text from stdin
    # or: python3 scripts/grocery/update_week.py path/to/doc.md

This writes `data/groceries/raw/<week-of-date>.md` (date from the doc's
`# Grocery deals - week of YYYY-MM-DD` header), runs `parse_deals.py` and
`build_page.py`, and commits + pushes `data/groceries/` and `groceries.html`
in one go. It aborts without writing anything if the doc is missing its
header or parses out fewer than 200 items (likely a bad/incomplete fetch).

`build_page.py` uses the two most recent week JSONs. On Wednesday that means
the still-current week plus the new one: the page shows the current flyer
with a "Preview next week's flyer" button, then switches itself to the new
flyer automatically on Thursday (the new week's `valid_from` date).
**No Thursday job is needed** — the swap is date logic in the page.

### If something looks miscategorized

Run the steps individually instead:

       python3 scripts/grocery/parse_deals.py data/groceries/raw/<date>.md

This writes `data/groceries/<date>.json` and prints per-category counts and
the store list. Sanity-check the counts (≈300+ items, 5 stores) and
spot-check a few items per category. If something is miscategorized, add a
rule to the override dicts / pattern lists in `parse_deals.py`, re-run, then

       python3 scripts/grocery/build_page.py

and commit/push `data/groceries/` and `groceries.html` as usual.

## Notes

- Old week JSONs/raws can stay; the build only reads the two newest.
- The doc's section headers sometimes claim a couple more deals than the
  doc body actually lists; the parsed item count is taken from the body.
- "Bonus offers only" on the page filters to loyalty/points badges (green).
  Plain `SAVE n%` notes render as amber badges and don't count as bonus.
