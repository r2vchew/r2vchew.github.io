# Vacation Central — Design Brief

For whoever/whatever is designing the interface. Everything here reflects
decisions already made and built (database schema is live, Google Maps
Platform is enabled) — this isn't a blank-slate concept, it's a UI for a
system that already exists.

## Product summary

A mobile-first PWA for running a live, multi-day trip. Not a "browse and
plan months ahead" trip-builder — a day-of companion. Two people (a couple,
one with a young child along) use it heavily throughout each day: checking
what's next, adding a place they just heard about, checking whether today's
outdoor plan is still a good idea given the forecast. "In and out of the app
a lot throughout the day" is a direct quote from the person who'll use it —
design for quick glances and one-handed use, not deep sessions.

Forked conceptually from a prior single-purpose app ("Route Optimizer" —
answers "which stop is the best live-traffic detour right now") but broader:
this one plans and displays a whole day, across multiple days, across more
than one home base (the trip has two legs, at two different lodgings).

## Who's using it

- Two adults, sharing one account each (both need to log in and both need
  write access — this isn't a single-owner app).
- One young child along — hence amenities like a travel crib matter enough
  to be first-class data, not a footnote.
- Both on phones, both using Safari/Chrome via the mobile browser (not an
  app-store app) — a PWA added to the home screen.
- Occasionally, one of them asks their AI assistant (in a normal chat, not
  this interface) to add an idea or note — that idea lands in the same
  database this UI reads. The UI should feel coherent with "someone/something
  else might have just added something," not assume it's the only writer.

## Data model (already live in Supabase — this is the real shape, not a proposal)

**legs** — one row per stay (this trip has two: Harrison Hot Springs, then
Vancouver). Each has `start_date`, `end_date`, and a `home_base_label` +
`home_base_address` (the lodging — where each day's routing starts/ends).

**days** — one row per calendar date within a leg. Pre-generated from the
leg's date range.

**activities** — the idea library. A place worth doing, scoped to a leg, not
yet scheduled to a specific day. Fields: `name`, `category` (food / outdoor /
attraction / shopping / rest / other), `address`, `lat`/`lng`, `source`
(`claude_curated` / `airbnb_amenity` / `user_added` — worth distinguishing
visually: a Claude-researched suggestion reads differently than something
you typed in yourself), `notes`.

**day_stops** — schedules one activity onto one day. Fields: `sort_order`
(the visit order within the day — gets overwritten whenever the map
re-optimizes the route), `planned_time` (optional), `status` (`idea` /
`planned` / `done` / `skipped`).

**amenities** — what the current lodging already provides (pool, kitchen,
travel crib, parking...), pulled once from the Airbnb listing, not live-
synced. Each has a `category`, `label`, `notes`. Purpose: let the UI answer
"do we already have this" before someone suggests renting or buying
something. Notably: Harrison has beach access but *no* beach gear listed;
Vancouver has a pool/hot tub/sauna/gym and full baby gear. This kind of
gap/bonus framing is worth surfacing directly, not just listing amenities
flatly.

**weather_forecasts** *(designed, not yet built)* — append-only log, one row
per fetch, never overwritten. Fetched client-side on app-open, throttled
(skip the fetch if the last logged row for that day is under ~4 hours old).
Comparing a day's latest row against its first-ever row is how "the forecast
changed since we planned this" gets detected — this needs a visible alert
state on that day's page, e.g. "was sunny 22°C when planned, now shows rain,
14°C."

## Core flows

1. **Open the app → land on today** (or the nearest relevant day if before/
   after the trip). Leg switcher for Harrison vs. Vancouver.
2. **Day view**: date, home base, weather (with the change-alert state above
   when relevant), a real embedded map (Google Maps JavaScript API — not a
   static image) showing that day's stops and the route between them, and an
   ordered list of stops below/beside it.
3. **Add a stop**: either search a new place (Google Places API text search,
   reused from the prior app) or pick from the leg's existing idea library.
   Needs to work without opening a chat session — this is the in-the-moment,
   no-Claude-needed path.
4. **Reorder a day**: manual drag, or trigger the Routes API's waypoint
   optimization and accept the suggested order.
5. **Mark a stop's status** (done / skipped) as the day progresses.
6. **Browse the idea library** for a leg — everything suggested or saved,
   not yet on a specific day.
7. **Check amenities** for the current leg's lodging.
8. **Log in** (Supabase Auth) — both people need their own login; the app is
   useless to a third party without household membership, by design (this
   is enforced at the database level, not just hidden in the UI).

## Constraints that shape the interface, not just the data

- **PWA on iOS Safari and Android Chrome**, added to the home screen — no
  app-store chrome to lean on for navigation conventions.
- **Real Google Map**, not a custom canvas — the interface needs to
  accommodate Google's native map controls (zoom, attribution) rather than
  fully owning that visual space.
- **Outdoor, one-handed, glanceable** — this is used standing on a sidewalk
  deciding where to go next, not at a desk. Legible in bright light, large
  touch targets, minimal typing required for the common paths.
- **Shared, live state** — no single "owner." Design should tolerate (and
  ideally surface) that content can appear from another person or from an
  AI-assisted add, not just from this session.

## Visual precedent

The prior app used a dark, warm palette with exactly one accent color
reserved for "the winner" (the best-ranked result) — deliberately
restrained, not colorful for its own sake. Carry that discipline forward:
flat surfaces, no gradients, one accent used meaningfully rather than
decoratively, consistent behavior in light and dark. Icons/branding for this
app haven't been designed yet — currently using placeholder assets copied
from the prior app.

## Content/copy inventory the designer will need labels for

- Activity categories: food, outdoor, attraction, shopping, rest, other
- Stop status: idea, planned, done, skipped
- Activity source (if shown): Claude-suggested / from the listing / added
  by you
- Amenity categories as they occur in data: location, outdoor, kitchen,
  family, parking, laundry, entertainment, facility, office, climate,
  services, gap (the "what's missing" ones, like Harrison's no-beach-gear
  note)
- Empty states: a day with no stops yet; a leg's idea library with nothing
  saved yet

## Open decisions for the designer

- Day navigation: one day at a time (swipe/tap between) vs. a scrollable
  multi-day list — not yet decided.
- How prominent the map is relative to the stop list on a day view (map-
  first vs. list-first, given phone screen real estate).
- How to visually distinguish "added by Claude" vs. "added by you" without
  it feeling like clutter.
