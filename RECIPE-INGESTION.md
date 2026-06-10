# Recipe Ingestion Guide

Instructions for any Claude session converting recipes into JSON for the Recipe Box
app (`recipes/` in this repo, live at https://r2vchew.github.io/recipes/). This
process runs **outside** the app: Claude produces a JSON file, and the user imports
it with the app's **Import** button.

## Output target

A single JSON file containing **an array of recipe objects** (even for one recipe),
each matching the app's schema. The schema, field rules, and controlled tag list are
defined in [`recipes/README.md`](recipes/README.md) — **read that file first; it is
the single source of truth.** A correct, working example lives at
[`recipes/sample-recipes.json`](recipes/sample-recipes.json).

Name the file descriptively, e.g. `recipes-2026-06-14.json` or `chili-recipes.json`.

## The three ingestion paths

### 1. Screenshots (`source.type: "screenshot"`)

The user keeps recipe screenshots in a Google Drive folder and will either point you
at that folder or attach the images directly.

1. Read every image provided (use the Google Drive integration if given a folder).
2. Extract each distinct recipe — one screenshot set may hold several recipes, and
   one recipe may span several screenshots; use recipe titles and step numbering to
   group images correctly.
3. Transcribe faithfully. If text is cut off or illegible, leave the affected field
   null/empty and flag it to the user — do not reconstruct from general knowledge.
4. Set `source.type` to `"screenshot"`, `source.url` to `null`, and put any visible
   provenance (account name, magazine, app watermark) in `source.note`.

### 2. Web links (`source.type: "link"`)

The user provides a recipe URL.

1. **Fetch the page directly first.** Look for structured recipe data before reading
   the prose: a `<script type="application/ld+json">` block whose `@type` is
   `Recipe` (possibly nested in `@graph` or an array). This is the cleanest source —
   it has canonical ingredients, times, and yields. Microdata
   (`itemtype="https://schema.org/Recipe"`) is the next-best structured source.
2. If there is no structured data, extract from the rendered page text.
3. **Only if the direct fetch fails or the site blocks it**, fall back to: a web
   search for a cached/syndicated copy, or asking the user to paste the page text or
   provide a screenshot (then follow the screenshot path but keep
   `source.type: "link"` since the origin is a link).
4. Set `source.type` to `"link"` and store the URL in `source.url`. Use
   `source.note` for the site/author name (e.g. `"Serious Eats — Kenji"`).
5. Ignore the page's story/preamble; recipe card content only. Convert ISO-8601
   durations from JSON-LD (`PT1H30M` → `prep_minutes`/`cook_minutes` as plain
   integer minutes).

### 3. Freeform / manual (`source.type: "manual"`)

The user pastes messy recipe text, types it roughly, or describes it.

1. Structure what was given into the schema. Tidy wording into clear imperative
   steps, but do not add ingredients, steps, or techniques the user didn't state.
2. If something essential is ambiguous (e.g. an ingredient with no amount that
   clearly needs one), ask rather than invent.
3. Set `source.type` to `"manual"`, `source.url` to `null`, and `source.note` to
   whatever provenance the user mentions ("Grandma's", "from memory"), else `null`.

## Field rules (these are the ones that go wrong)

- **Fuzzy amounts**: when an amount is vague or a range — "a splash", "a good glug",
  "2–3 cloves", "salt to taste" — set `amount: null` and put the fuzzy wording in
  `prep` (e.g. `{"amount": null, "unit": null, "item": "garlic", "prep": "2–3
  cloves"}`). This matters because the app coerces any non-numeric `amount` to null
  on import and the range text would be **silently lost** — and null amounts
  correctly don't scale with servings.
- **Numeric amounts**: must be JSON numbers, not strings. Convert text fractions
  (`1/2` → `0.5`, `1 1/3` → `1.333`).
- **Tags**: assign only from the controlled list in `recipes/README.md`. The app
  does **not** validate tags on import, so an invented tag would pollute the tag
  set. Apply every tag that clearly fits; don't stretch.
- **Don't fabricate**: if the source states no prep/cook time, leave
  `time.prep_minutes`/`time.cook_minutes` as `null` — never estimate. Same for
  `servings`: only a stated yield. Missing `notes` is an empty string `""`.
- **`id`**: generate a fresh UUIDv4 for each recipe. (The app would generate one for
  a missing `id`, but a stable id in the file means a corrected re-import
  **overwrites** the recipe instead of duplicating it — so include it, and reuse the
  same id when revising a previously delivered recipe.)
- **`date_added`**: omit it. The app stamps the import date automatically; only set
  it if the user asks for a specific date (format `YYYY-MM-DD`).

## Before delivering, verify

1. The file parses as JSON and the top level is an array.
2. Every `amount` is a number or `null` — no strings, no ranges.
3. Every tag appears in the controlled list.
4. No guessed times, servings, or ingredients anywhere.
5. Each recipe has a unique `id` and **no** `date_added` (unless requested).
6. `source` matches the ingestion path used.

Then deliver the JSON. Two delivery options — pick whichever suits the session:

- **Copyable JSON block** (best on a phone): the app's Import dialog accepts pasted
  JSON directly, so the user can copy your output and paste it straight in.
- **Downloadable file**: for bigger batches or desktop sessions.

Either way, remind the user to import it via the app's **Import** button, and
mention anything that was illegible, ambiguous, or left null so the user can fix it
in the app's editor.
