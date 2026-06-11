# Triangle Mastercard statements — ingestion reference

This document describes how to read Triangle Mastercard (Canadian Tire Bank) PDF
statements and fold their spend into the family finance data. It is the source of
truth for the `triangle-statements` skill.

## 1. Where the statements live

- Google Drive folder: `Claude/finance-review/triangle`
- One PDF per statement month, named `YYMM` (e.g. `2510` = October 2025 statement).
- Each statement covers the **26th of the previous month through the 25th of the
  statement month** (e.g. `2512` covers Nov 26 – Dec 25, 2025).
- Account: Triangle Mastercard ending **5625**. Two physical cards appear:
  - `5446 12XX XXXX 5625` — Vincent (primary)
  - `5446 12XX XXXX 6044` — second cardholder
  Both belong to the same account and the same household spend. Keep a
  `card` field on each transaction in case per-person views are wanted later.

When asked to "process new statements", list the folder, compare `YYMM` names
against statement months already present in the spend data, and ingest only the
missing months (oldest first).

**Already processed:** statements `2510`–`2605` have been fully extracted,
categorized, and discount-allocated into `triangle-spend-2510-2605.json` in the
`Claude/finance-review` Drive folder (next to the `triangle` statements folder).
Start from that file rather than re-reading those PDFs; new ingestion begins at
`2606`. (`2509` is the known gap — see §4 on the October discount residual.)

## 2. Anatomy of a statement

Process the sections in this order. PDF text extraction is messy — descriptions
wrap across lines (e.g. `CDN TIRE STORE #00493 COCHRANE` / `AB` / `1,317.98`),
negative amounts may render as `\-350.00`, and amounts use thousands separators.
Always anchor on the section headings and the printed section totals.

### 2.1 Rewards box (top of page 1) — IGNORE for spend

The first table (`Previous balance / New this period / Adjustments / Redeemed
this period / Bonus / Total`) is the **CT Money rewards balance**, not dollars
owed or spent. Never mix these numbers into spend. (Optionally track the CT
Money total as a separate "rewards balance" metric.)

### 2.2 "Your account summary"

Balance from last statement, total payments, total credits, total purchases,
fees, interest, new balance. Used only for the reconciliation checks in §6.

### 2.3 "Payments received" — transfers, never spend

Payments TO the card. Two shapes seen:

| Description | Meaning |
|---|---|
| `CDN TIRE STORE #00493 COCHRANE AB` (negative) | Payment made at the store register |
| `CTFS.COM/PAYMENTS OAKVILLE ON` (negative) | Online payment (funded by Interac e-transfer / bank bill payment) |

**Critical:** in-store payments use the *same description* as in-store purchases.
The section heading is the only reliable way to tell a payment from a purchase —
never classify by description alone.

These payments are the transactions the bank-side data already sees (in-store
payments and email Interac e-transfers). In the merged spend data they must be
classified as **credit-card payments / internal transfers**, excluded from every
spend category and total. The statement's itemized purchases replace them as the
real spend. If a bank-side outflow matching a payment here was previously
categorized as spend, recategorize it to a transfer when ingesting.

### 2.4 "Returns and other credits"

Two kinds of lines:

1. **Merchandise returns** — negative amounts at a store (e.g.
   `#5123 SPORT CHEK COCHRANE AB -193.66`). Record them as negative spend in the
   same category as the original purchase so category totals are net of returns.
   The matching original purchase is usually on the same or the prior statement;
   the store detail sections (§2.6) show exactly which item came back.
2. **`TEAM CT STORE DISCOUNT`** — posts on the **last day of the statement
   period**. This is the 17.5% employee discount reimbursement. It is *not* a
   return and *not* generic income: it reduces the cost of specific purchases.
   Handle per §4.

### 2.5 "Purchases"

One block per card (`Purchases - Card #...5625`, then `...6044`), each line:
transaction date, posting date, merchant description, tax-included amount.
The block ends with `Total purchases for <card>` and the section with
`Total purchases` — verify your extracted lines sum to these.

Use **transaction date** (not posting date) as the spend date.

### 2.6 Store detail sections (bottom pages) — the categorization gold

For purchases at Canadian Tire family banners, the statement ends with
item-level sections:

- `Details of your Canadian Tire store purchases`
- `Details of your Sport Chek store purchases`
- `Details of your Mark's/L'Équipeur store purchases`
- `Details of your Party City store purchases`
  (other banners — Atmosphere, PartSource, Pro Hockey Life — get sections too
  if shopped at)

Each transaction lists quantity + abbreviated item descriptions at **pre-tax**
prices, then `GST/HST`, `PST`, and `Total for transaction` (which matches the
amount in the Purchases section — use the date + total to join them).

Quirks:

- Returns appear here too, with negative totals. Extraction sometimes flips the
  sign on the tax line of a return (GST shown positive while the total is
  negative). Trust `Total for transaction`; reconcile item lines + tax to it and
  fix signs accordingly.
- Generic `MERCHANDISE` lines carry no item info — categorize by merchant.
- Non-merchandise lines occur at Canadian Tire: `SHOP LABOUR`,
  `ENVIRONMENTAL FEE`, `ADS` — keep them as part of the transaction.
- An `OTHER TENDER` line means part of the receipt was paid by gift card; the
  amount in the Purchases section (items + tax − other tender) is what hit the
  card, and is the base for the discount (§4).
- Merchants outside the CT family (Petro-Canada, Shell, McDonald's, Car Wash
  Corral, Ski Louise, etc.) have **no** detail section — categorize from the
  merchant name alone.

### 2.7 Equal Payments Plan section (sometimes present)

If a "Details of your Equal Payments Plan(s)" section appears, the monthly
installments are part of `Balance Due` but are **not new spend** — the original
purchase was already counted in full when it posted. Ignore installments for
spend; at most note the remaining plan balance.

## 3. Categorization rules

Categorize at the **item level** when a detail section exists; split one card
transaction across categories if its items clearly belong to different ones
(e.g. tires + a kitchen scale). Use the existing dashboard categories — do not
invent new ones without asking. Merchant defaults:

| Merchant pattern | Default category |
|---|---|
| `PETRO-CANADA`, `SHELL`, `Gas+` | Gas / fuel |
| `Car Wash` | Auto |
| CDN Tire items: tires, `SHOP LABOUR`, wheel/auto parts | Auto |
| CDN Tire items: housewares, tools, seasonal, toys | Household (or closer existing category) |
| `SPORT CHEK`, `WWW.SPORTCHEK.CA`, `ATMOSPHERE` | Sporting goods / clothing |
| `MARK'S` | Clothing |
| `PARTY CITY` | Gifts / celebrations |
| `McDonalds`, restaurants | Dining out |
| `SKILOUISE`, lift tickets | Recreation |

When an item code is cryptic (e.g. `MC MOD KAYAK HOOKS`, `NM OD C6 LED 70 WW`),
expand it with judgement — the prefix letters are house brands (MC = Mastercraft,
NM = Noma, HBC, SF, MM, etc.) and the rest abbreviates the product.

## 4. Team CT employee discount (17.5%, occasionally 35%)

Vincent works for Canadian Tire. Purchases at Canadian Tire family banners are
reimbursed via one `TEAM CT STORE DISCOUNT` credit per cycle. Spend must be
recorded at the **effective (discounted) cost**, not the sticker amount, or
every month overstates spend and then shows a mystery credit.

### The verified formula

The credit was reverse-engineered from the Oct 2025 – May 2026 statements and
reconciles to within $0.02 on every fully-observable window:

> **credit = 17.5% × net amount charged to the card (tax INCLUDED) at CT-family
> merchants, for all such transactions POSTED since the previous credit.**

Rules that follow, each verified against a real statement:

- **The base is the card-charged total, taxes and everything in it.** No
  pre-tax math, no item exclusions: shop labour, environmental fees, GST/HST
  (incl. 13% HST at Ontario stores), groceries, online sportchek.ca orders,
  Mark's, Party City, even a Lake Louise ski card sold at Sport Chek — all
  reconciled at 17.5% of the posted amount.
- **Gift-card portions earn nothing.** When a receipt shows `OTHER TENDER`,
  the credit is 17.5% of the amount actually charged to the card (verified:
  Oct 24/Feb 3/Mar 7/Apr 17 transactions with $10–$20 OTHER TENDER).
- **Returns claw back 17.5% of the refunded card amount** (verified: Blue Jays
  jersey bought Oct 21, returned Oct 28, clawed back in the December credit).
- **Window = posting dates between credit postings**, not the statement
  period. A credit includes transactions posted up to and including its own
  posting day (verified: Dec 23 purchase posted Dec 24 made the Dec 24 credit).
- **Negative or no-credit months carry forward.** Nov 2025 had purchases but
  no credit — its window netted negative (big return), so everything rolled
  into the Dec 24 credit, which then reconciled exactly. Never assume one
  credit ↔ one statement.
- **Not eligible at all:** non-CT merchants, and gas at Petro-Canada/Gas+
  (fuel earns CT Money instead, not the Team discount).
- Rounding is per-transaction or aggregate (statements show both within 1¢);
  treat **±$0.02** as reconciled.

### Double-discount events (35%)

A few times a year CT runs employee double-discount events where the rate is
**35%** instead of 17.5%, applying to purchases made on those specific dates.
Exact dates are not recorded anywhere in our data — they must be inferred from
reconciliation. Verified so far:

- Every window from Dec 2025 through May 2026 reconciles exactly at a flat
  17.5% — **no double-discount purchases in Nov 25 – May 25**.
- The Oct 24, 2025 credit ($481.76) exceeds 17.5% of its visible window by
  **$198.31**. No combination of Oct-window transactions at 35% produces the
  actual credit (every combination overshoots), so the excess comes from
  September-period purchases whose statement (`2509`) is not in the folder:
  either ≈ $1,133.19 of September net purchases at 17.5% (a carried-forward
  September credit, like November), or ≈ $566.60 at 35% (a September
  double-discount event), or a mix. If the September statement is ever added
  to the folder, re-run the reconciliation and pin this down; until then the
  October allocation stays flagged as estimated.

### Procedure per credit window

1. Build the window: all CT-family card transactions (purchases positive,
   returns negative, at posted card amounts) posted after the previous
   `TEAM CT STORE DISCOUNT` posting date through this credit's posting date.
   Include carryover from any preceding no-credit months.
2. Compute `0.175 × net` and compare to the credit (±$0.02 tolerance).
3. **Matches:** allocate each transaction `discount = 0.175 × card_amount`.
4. **Credit is larger:** solve for which transactions were at 35%:
   `excess = credit − 0.175 × net`, so the 35%-rate subset must sum to
   `excess / 0.175`. Prefer subsets sharing a single transaction date
   (double-discount events are date-based) and confirm the solution is exact.
   Apply `discount = 0.35 × card_amount` to those.
5. **Still unreconciled:** check adjacent statements for window-boundary
   transactions and no-credit carryovers; as a last resort allocate the actual
   credit pro-rata across the window's card amounts and **flag the month** in
   the output notes — never silently force it.
6. Record each transaction's effective cost:
   `effective = card_amount − allocated_discount` (i.e. ×0.825 normally,
   ×0.65 on double-discount dates). Keep `gross_amount` and `discount` fields
   so the statement still reconciles to the penny. Returns get the same
   treatment with negative amounts.
7. The `TEAM CT STORE DISCOUNT` credit line itself must then be **excluded**
   from spend (it has been distributed into the transactions). Double-counting
   it as both a per-transaction discount and a credit is the main failure
   mode — check for this explicitly.

## 5. Merging into the existing spend data

- Real spend = itemized purchases at effective cost (§4) + returns as negative
  spend. Payments (§2.3) and the discount credit (§4.6) are excluded.
- Reclassify the matching bank-side outflows (in-store payments, Interac
  e-transfers to the card) as transfers so nothing is double-counted. Amounts
  match exactly; dates may differ by a few days.
- Use the project's existing finance-data update workflow and category set for
  the dashboard. Ask before adding categories or changing the storage format.

## 6. Reconciliation checklist (must pass before merging)

1. Extracted purchase lines sum to each card's printed total and to
   `Total purchases`.
2. Extracted payments sum to `Total payments received`; returns + discount sum
   to `Total returns and credits`.
3. `previous balance − payments − credits + purchases + fees + interest =
   Your New Balance` (from §2.2), to the penny.
4. Every CT-family purchase in the Purchases section has a matching
   `Total for transaction` in a detail section, and its item lines + taxes sum
   to that total.
5. Discount allocation: sum of per-transaction discounts = `TEAM CT STORE
   DISCOUNT` credit ±$0.02, with the discount window and any no-credit
   carryover handled per §4 (or the month is explicitly flagged).
6. The discount credit and all payments are absent from spend totals.

Report the checklist results to the user with each ingested month, along with
anything flagged (unreconciled discount, unmatched return, unknown merchant).
