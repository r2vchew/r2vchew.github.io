# Car finder — Calgary

Scans the main Canadian used-car sites twice a day, throws out everything that
does not fit, and publishes a short, commented shortlist to a web page plus an
email digest. Feedback from the page — including plain-English notes — feeds
back into the search scope automatically.

Built for one specific job: finding a first car for a new driver in Calgary
without anyone having to read hundreds of listings.

**Dashboard:** https://r2vchew.github.io/car-finder/

## How it works

```
                  ┌──────────────────────────────────────────┐
  twice a day ───▶│ .github/workflows/car-finder.yml         │
  or on feedback  └──────────────────────────────────────────┘
                        │
                        ├─ 1. apply-feedback.mjs ── reads feedback issues,
                        │                           rewrites data/criteria.json
                        │                           and data/verdicts.json
                        │
                        ├─ 2. run.mjs ── fetch → normalize → dedupe → filter
                        │                → score → write commentary
                        │                → data/listings.json
                        │
                        ├─ 3. email.mjs ── build/digest.html (only sends when
                        │                  something new cleared the bar)
                        │
                        └─ 4. commit data/ back to the branch
                                    │
                                    ▼
                        GitHub Pages serves index.html,
                        which reads data/listings.json
```

### The pieces

| Path | What it does |
| --- | --- |
| `scripts/run.mjs` | The pipeline. Start here. |
| `scripts/sources/*.mjs` | One adapter per site. Each supplies a URL builder and a link pattern. |
| `scripts/lib/pipeline.mjs` | Shared paging, bot-check detection, and the three extraction strategies. |
| `scripts/lib/extract.mjs` | JSON-LD, embedded state, and value parsing (money, odometer, year). |
| `scripts/lib/cards.mjs` | Last-resort HTML card scanner for when markup changes. |
| `scripts/lib/knowledge.mjs` | What the finder knows about specific models. The commentary's substance. |
| `scripts/lib/score.mjs` | Hard filters, 0–100 scoring, and the local price model. |
| `scripts/lib/commentary.mjs` | Writes the human-readable note per car. |
| `scripts/lib/interpret.mjs` | Turns plain English into changes to `criteria.json`. |
| `scripts/apply-feedback.mjs` | Reads feedback issues, applies them, replies, closes them. |
| `scripts/email.mjs` | Builds the digest and decides whether it is worth sending. |
| `scripts/probe.mjs` | Diagnostic for when a source stops returning cars. |
| `data/criteria.json` | The search scope. Safe to edit by hand. |
| `data/verdicts.json` | Her saves and rejections. Rejected cars never come back. |
| `data/listings.json` | Generated output the dashboard reads. |

No npm dependencies. Node 22+ only.

## Running it locally

```bash
cd car-finder

node scripts/run.mjs --dry              # scan without writing
node scripts/run.mjs --source kijiji    # one source
node scripts/probe.mjs --source kijiji  # diagnose a source that returns nothing
node scripts/email.mjs --force          # build build/digest.html
```

To work on scoring and commentary without hitting any site:

```bash
node scripts/run.mjs --fixture path/to/fixture.json --dry
```

## Setup

### 1. GitHub Pages

Settings → Pages → build from the `main` branch, root. The dashboard then lives
at `/car-finder/`.

### 2. Email digest (optional)

Without these the system still works — it just does not email. Add repository
secrets:

| Secret | Value |
| --- | --- |
| `MAIL_SERVER` | e.g. `smtp.gmail.com` |
| `MAIL_PORT` | `465` |
| `MAIL_USERNAME` | the sending address |
| `MAIL_PASSWORD` | an **app password**, never the account password |
| `MAIL_TO` | her address; comma-separate for more than one |

For Gmail this means turning on 2FA and creating an app password. The digest
only sends when something new cleared the bar, so it will not become noise.

### 3. Feedback (works out of the box)

The **Send feedback** button opens a prefilled GitHub issue labelled
`car-feedback`. That triggers the workflow, which applies the feedback, replies
explaining what it changed, and closes the issue.

This needs her to have a free GitHub account. If that is friction, set
`feedbackEndpoint` in `assets/app.js` to any URL that accepts a JSON POST — a
Formspree form, a Cloudflare Worker, an Apps Script web app — and the button
posts there instead. Setting `feedbackEmail` gives a `mailto:` fallback.

### 4. Anthropic API key (optional)

Set `ANTHROPIC_API_KEY` to add a one-line Claude-written note per shortlisted
car, and to interpret plain-English feedback the rule-based parser cannot read.
Everything works without it.

### 5. Scraping proxy (optional)

If a source starts reporting *"blocked the scan"*, it is refusing GitHub's
datacentre IPs rather than running out of cars. Setting `SCRAPINGBEE_API_KEY` or
`SCRAPERAPI_KEY` routes requests through a residential proxy. Both have free
tiers that comfortably cover two scans a day.

## Tuning the search

Edit `data/criteria.json`:

- `hard` — the dealbreakers. Anything failing these is dropped and counted.
- `soft` — preferences that move the score but never exclude.
- `history` — an audit trail of every change the feedback loop has made.

Or just say what you want on the dashboard. `"I'd go to $18k for something
2018 or newer, and no Nissans"` is understood and applied.

## When a source stops working

1. Run the **Car finder probe** workflow for that source.
2. The log shows the HTTP status, whether a bot challenge came back, how many
   listing links matched, and what each extraction strategy found.
3. Usually the fix is the link pattern or the URL builder in
   `scripts/sources/<name>.mjs`.

A source returning zero does not fail the run: the site keeps its last good
data and the dashboard says which sources came up empty.

## Notes and limits

- Prices are asking prices, scraped from public search pages. They go stale.
- Scraping is best-effort. Sites change and occasionally block; the design
  degrades to "fewer sources" rather than breaking.
- The commentary is a starting point for conversations with a mechanic, not a
  substitute for an inspection.
