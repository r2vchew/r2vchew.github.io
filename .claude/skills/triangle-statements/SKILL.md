---
name: triangle-statements
description: Ingest Triangle Mastercard (Canadian Tire) PDF statements into the family spend data. Use whenever the user wants to process, ingest, categorize, or reconcile Triangle/Canadian Tire credit card statements, update spend with a new statement month, or apply the Team CT employee discount to purchase amounts. Statements live in the Google Drive folder Claude/finance-review/triangle.
---

# Triangle Mastercard statement ingestion

Read `TRIANGLE-STATEMENTS.md` (repo root) and follow it exactly — it is the source
of truth for the statement layout, the Team CT 17.5% employee discount logic, and
the reconciliation checks. Do not work from memory.

Quick orientation (details in the reference doc):

- Statements are PDFs in Google Drive at `Claude/finance-review/triangle`, named
  `YYMM` for the statement month (e.g. `2512` = Dec 2025, covering Nov 26–Dec 25).
- The card's payments already appear in the bank-side data as in-store payments or
  Interac e-transfers. Those are **transfers, never spend**. Real spend comes from
  the statement's Purchases section, itemized by the per-store detail sections at
  the bottom of each PDF.
- A `TEAM CT STORE DISCOUNT` credit posts on the last day of each period — the
  17.5% employee discount on eligible Canadian Tire family purchases. Spend must
  be recorded at the **discounted effective cost**, allocated per transaction per
  the rules in the reference doc.
- Every ingested statement must pass the reconciliation checklist at the end of
  the reference doc before its numbers go into the dashboard.

Merge the resulting transactions into the existing spend data using this
project's normal finance-data update process; do not invent a new storage format.
