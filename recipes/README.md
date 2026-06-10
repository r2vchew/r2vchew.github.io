# Recipe Box

A personal, offline-first recipe box PWA. Lives at `https://r2vchew.github.io/recipes/`.

- All data is stored locally in the browser (IndexedDB) — no server, works offline.
- Install it from Chrome on Android via "Add to Home screen" to get a standalone app.
- **Export regularly** — the JSON backup is the only copy of your data outside the
  browser. Clearing site data wipes the recipe box.

## Importing recipes

The **Import** button accepts a JSON file containing either a single recipe object,
an array of recipes, or `{ "recipes": [...] }`. Recipes are merged by `id`: unknown
ids are added, matching ids are overwritten. A missing `id` gets a new UUID.
`sample-recipes.json` in this folder is a working example.

## Recipe schema

```json
{
  "id": "uuid",
  "name": "string (required)",
  "source": { "type": "link|screenshot|manual", "url": "string or null", "note": "string or null" },
  "servings": 4,
  "time": { "prep_minutes": 15, "cook_minutes": 45 },
  "ingredients": [
    { "amount": 2, "unit": "lb", "item": "ground beef", "prep": "optional string or null" }
  ],
  "steps": ["string"],
  "tags": ["string"],
  "notes": "string",
  "date_added": "YYYY-MM-DD"
}
```

Schema rules:

- `amount` may be `null` for fuzzy quantities ("a good glug") — put the fuzzy wording
  in `prep`. Null amounts are displayed as-is and never scale with servings.
- Numeric amounts scale proportionally when servings change, displayed as readable
  fractions (1½, ⅔, ¼) where possible.
- Tags (controlled list): breakfast, lunch, dinner, snack, dessert, side,
  sauce/condiment, beef, chicken, pork, fish/seafood, vegetarian, beans/legumes,
  one-pot, grill/BBQ, slow-cook, no-cook, baking, soup/stew, weeknight,
  weekend/project, crowd/entertaining, kid-approved.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `app.js` | All app logic (storage, search, scaling, editing, import/export) |
| `styles.css` | Styling |
| `sw.js` | Service worker — bump `CACHE` version when app files change |
| `manifest.webmanifest` | PWA manifest |
| `sample-recipes.json` | Example import file |
