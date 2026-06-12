# Grocery deals page pipeline

Builds `groceries.html` from the weekly deals doc that the grocery routine
writes to the Drive folder `Claude/grocery-deals`.

## Weekly update (run every Wednesday, after the new flyer doc lands in Drive)

1. Read the newest "Grocery Deals - Cochrane - YYYY-MM-DD" Google Doc from
   the Drive folder `Claude/grocery-deals` and save its text verbatim as
   `data/groceries/raw/<week-of-date>.md` (the date from the doc's
   `# Grocery deals - week of YYYY-MM-DD` header). Escaped markdown
   (`\#`, `\-`, ...) from the Docs export is fine; the parser unescapes it.

2. Parse it:

       python3 scripts/grocery/parse_deals.py data/groceries/raw/<date>.md

   This writes `data/groceries/<date>.json` and prints per-category counts
   and the store list. Sanity-check the counts (≈300+ items, 5 stores) and
   spot-check a few items per category. If something is miscategorized, add
   a rule to the override dicts / pattern lists in `parse_deals.py` and
   re-run.

3. Rebuild the page:

       python3 scripts/grocery/build_page.py

   It uses the two most recent week JSONs. On Wednesday that means the
   still-current week plus the new one: the page shows the current flyer
   with a "Preview next week's flyer" button, then switches itself to the
   new flyer automatically on Thursday (the new week's `valid_from` date).
   **No Thursday job is needed** — the swap is date logic in the page.

4. Commit and push `data/groceries/` and `groceries.html`.

## Notes

- Old week JSONs/raws can stay; the build only reads the two newest.
- The doc's section headers sometimes claim a couple more deals than the
  doc body actually lists; the parsed item count is taken from the body.
- "Bonus offers only" on the page filters to loyalty/points badges (green).
  Plain `SAVE n%` notes render as amber badges and don't count as bonus.
