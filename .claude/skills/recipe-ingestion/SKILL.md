---
name: recipe-ingestion
description: Convert recipes into Recipe Box import JSON. Use whenever the user wants to ingest, convert, extract, or digitize recipes — from screenshots (often in a Google Drive folder), from a recipe URL, or from pasted/freeform text — into a JSON file for the Recipe Box app.
---

# Recipe ingestion

Read these two files and follow them exactly — they are the source of truth, do not
work from memory:

1. `RECIPE-INGESTION.md` (repo root) — the full process: output format, the three
   ingestion paths (screenshot / link / manual), field rules, and the pre-delivery
   checklist.
2. `recipes/README.md` — the recipe schema, field semantics, and the controlled tag
   list.

`recipes/sample-recipes.json` is a known-good example of the expected output.

The deliverable is a JSON file containing an array of recipe objects, handed to the
user to import into the app via its Import button. Do not edit the app or commit
the recipe JSON to the repo unless the user asks.
