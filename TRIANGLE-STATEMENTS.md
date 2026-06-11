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
  `ENVIRONMENTAL FEE`, `ADS` — keep them; they matter for discount math (§4).
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

## 4. Team CT employee discount (17.5%)

Vincent works for Canadian Tire. Most purchases at Canadian Tire family banners
earn a 17.5% discount, reimbursed as one `TEAM CT STORE DISCOUNT` credit at the
end of each statement period. Spend must be recorded at the **effective
(discounted) cost**, not the sticker amount, or every month overstates spend and
then shows a mystery credit.

### What earns the discount

- **Eligible:** pre-tax *merchandise* at CT family banners — Canadian Tire
  stores, Sport Chek (incl. sportchek.ca), Mark's/L'Équipeur, Party City,
  Atmosphere, PartSource, Pro Hockey Life.
- **Not eligible:** anything at non-CT merchants; gas at Petro-Canada/Gas+;
  taxes (GST/HST/PST). Treat `ENVIRONMENTAL FEE`, `SHOP LABOUR`, and gift cards
  as *probably not eligible* — confirm via the reconciliation below.
- Returns at eligible banners **claw back** their discount: the credit is 17.5%
  of *net* pre-tax eligible merchandise (purchases minus returns) for the
  discount window.

### Verified against real statements

- Dec 2025 (`2512`): net pre-tax CT-family merchandise ≈ $1,414 → 17.5% ≈
  $247.4; actual credit **$247.38** ✓.
- Oct 2025 (`2510`): credit $481.76 exceeds 17.5% of that period's eligible
  spend — the discount window is anchored on the credit's posting date, so it
  can sweep in late-posted purchases from the *previous* cycle. Reconciliation
  may need the adjacent statement.

### Procedure per statement

1. For every eligible transaction, compute `expected_discount = 0.175 ×
   (pre-tax merchandise subtotal)` from its detail section (exclude tax lines,
   and initially exclude environmental fees / labour).
2. Sum expected discounts (purchases positive, returns negative) and compare to
   the `TEAM CT STORE DISCOUNT` credit.
3. **Within ~$1:** allocate each transaction its own expected discount.
4. **Materially off:** first retry including/excluding fee-and-labour lines and
   any ambiguous items; then check the previous statement for eligible
   purchases posted after that statement's discount date. If it still doesn't
   reconcile, allocate the actual credit pro-rata across eligible pre-tax
   amounts and **flag the month** in the output notes — never silently force it.
5. Record each transaction's effective cost:
   `effective = posted_total − allocated_discount`
   (tax stays as charged — the reimbursement covers only the pre-tax 17.5%).
   Keep both `gross_amount` and `discount` fields so the statement still
   reconciles to the penny.
6. The `TEAM CT STORE DISCOUNT` credit line itself must then be **excluded**
   from spend (it has been distributed into the transactions). Double-counting
   it as both a per-item discount and a credit is the main failure mode —
   check for this explicitly.

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
   DISCOUNT` credit (or the month is explicitly flagged per §4.4).
6. The discount credit and all payments are absent from spend totals.

Report the checklist results to the user with each ingested month, along with
anything flagged (unreconciled discount, unmatched return, unknown merchant).
