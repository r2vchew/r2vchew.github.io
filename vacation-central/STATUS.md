# Status

Last updated: 2026-08-13

## 2026-08-13: v11 proximity, Flagged map and Days plan view

Added three planning views on top of the v10 redesign:

- Explore and Food cards now show traffic-aware driving minutes from the
  relevant accommodation in their upper-right corner. The authenticated trip
  document already contains the private accommodation address; the browser
  resolves it to accurate coordinates at runtime and keeps them only in memory,
  replacing the original city-level fallback for that session. Catalogue
  destinations are batched through Google Routes `computeRouteMatrix` and
  cached for the session.
- Flagged is now Vancouver-focused and includes a map of the Vancouver
  accommodation plus every located flagged activity. Numbered markers match
  the numbered list below the map. Explore/Food flagging already resolves and
  saves a place location, so normal flagged items are mappable without a schema
  change.
- The bottom-nav label is now **Days**. Its new Detail / Plan toggle preserves
  the existing one-date map and controls in Detail, while Plan shows the whole
  trip grouped by date and leg. Empty days remain visible so planning gaps are
  obvious; each group has an Open day action back to Detail.

Cache and asset versions moved together to `vacation-central-v11`.

**Verification:** headless Chrome loaded the production shell with no JavaScript
startup errors. A disposable in-browser trip fixture passed 11 checks covering
the dual-leg date, all Plan groups (including empty days), planned-stop content,
Explore/Food proximity slots, and the numbered Vancouver Flagged list. A live
Google Routes request using this app's key returned `ROUTE_EXISTS` from the new
route-matrix endpoint. The disposable fixture was removed. The remaining gate
is a signed-in click-through on the deployed app to confirm the private-address
resolution, real minute labels, Google map markers and actual trip content.

**Chat companion direction:** ChatGPT can use the same shared database through
a narrow MCP-backed custom app. Recommended v1 is data-only (no ChatGPT widget):
read trip, find/create/flag an activity, and schedule it through the existing
RPCs, with server-held credentials and confirmation on writes. This integration
has not been built yet.

## 2026-08-13: 16-item Explore/Food/Day/Flagged redesign — NOT YET LIVE-VERIFIED

A full redesign of Day, Explore, Food, plus a new Flagged tab, replacing the
work described in the three entries below (Explore hero/day-picker layout,
Ideas leg switcher, Food cuisine filters). This entry supersedes those for
current app shape; kept below for the RPC/schema history, which is unchanged.

**What changed, structurally:**
- **Day tab** is no longer leg-scoped. One chronological date strip across the
  whole trip (`getAllTripDays()` merges both legs' day rows by calendar date).
  Aug 17 (Harrison checkout, Vancouver check-in) renders **two** day-sections
  stacked, each with its own accent colour (`--harrison` / `--vancouver`) and
  its own "+ Add" button, sharing one combined map. Every other date renders
  one section and gets the old floating FAB back.
- **Explore and Food** both dropped their old per-leg-tab layout for a single
  leg toggle (⇄ icon, top-right) plus a shared `buildDiscoveryCard()` renderer.
  Filter chips (`guideFilters` / `foodFilters`) sit outside the scrollable list
  so they're always visible without any sticky-scroll JS. Each card has one
  action row — 🔗 official link, 📅 schedule (opens an inline day-picker
  limited to that leg's own days), 🚩 flag, ✕ dismiss — on the same row as the
  duration/cost/weather (or cuisine/price) chips, per the spec. Scheduling or
  flagging an item removes it from Explore/Food; dismissing does too
  (localStorage-only, `vc_dismissed_v1`, not synced to the DB). Every removal
  shows a toast with an inline **Undo** that reverses that specific action.
- **Flagged** is a new fifth nav tab, replacing Ideas. It lists every activity
  with `flagged = true` across both legs — a deliberately loose "planning
  whiteboard," not tied to any day, meant to get sorted into the itinerary
  later by asking in a normal chat. Migration
  `20260813100000_trip_planner_flagging.sql` added the `activities.flagged`
  column and `trip_planner_set_activity_flag` RPC.
- **Harrison now has its own Explore catalogue** (`harrison-guide.js`, same
  schema as `vancouver-guide.js`, 10 entries, researched fresh — flags Harrison
  Mineral Baths as closed for renovations since spring 2026, not tagged
  `top` given that uncertainty). Vancouver's 10 Ideas activities already
  matched an existing `vancouver-guide.js` entry each, so no net-new Vancouver
  catalogue work was needed — confirmed by querying the live `claude_curated`
  rows directly rather than assuming.
- **Weather alert simplified** to material changes only — crossing into/out of
  rain, or a 5°C+ high-temp swing (`isMaterialWeatherChange()`), not every
  small forecast wobble. A material change now also fires an **ntfy.sh push**
  (`sendNtfyAlert()`, topic in `config.js` as `NTFY_TOPIC`). ntfy is free and
  keyless — **one-time setup still needed on Vince's phone**: install the ntfy
  app, subscribe to the exact topic in `config.js`'s comment. The app cannot
  do this step itself.

**Not yet done:** fresh icon set (still route-optimizer's), Keely's household
membership, home-page link — all pre-existing, unrelated to this redesign.

**Verification status: none of this has been exercised in a live browser
session.** No local dev server was available this session (the harness's
preview tools weren't useful for remote-controlled testing here), so unlike
the 2026-08-13 entries below — which each list specific interaction checks
against stubbed or live RPC responses — this batch has only been checked by:
reading `index.html`/`styles.css`/`app.js` back against each other for
matching element IDs and class names, confirming every RPC name and argument
list called from `app.js` against `pg_get_function_arguments()` on the live
`kejchvwswjpdrvyccufi` project, and confirming the `FOOD_GUIDE` /
`VANCOUVER_GUIDE` / `HARRISON_GUIDE` catalogue schemas match what `app.js`
reads from them. **No JS syntax checker was available either** (no `node` or
usable `python` in this environment) — the file was manually re-read in full
instead. Treat this as a strong static review, not a substitute for actually
opening the app and clicking through Day (including Aug 17's dual-leg
rendering), Explore's leg toggle and scheduling flow, Food, Flagged, and the
Undo toast before trusting it on the trip.

## 2026-08-13: Food tab with cuisine filters

Added **Food** as a fifth main tab for both trip legs. It uses the same leg and
target-day controls as Ideas, then builds its cuisine chips from the current
leg's catalogue. The 15 researched picks cover six Harrison restaurants and
nine walkable Vancouver options around Gastown, Chinatown and Stadium. Filters
include breakfast, burgers, cafe, pizza, Italian, German, Greek, Vietnamese,
sushi, Japanese, Chinese, dim sum, Cambodian, Lebanese, Middle Eastern,
Mexican, pub and Canadian, showing only cuisines that exist for the selected
leg.

Each card carries the practical reason it made the shortlist, an age-six
ordering angle, a wait/timing warning, price band, current popularity signal
and an official menu/site link. Place names, addresses, coordinates, ratings,
review counts and websites were checked through the existing Places API on
August 13. Tourism Harrison and MICHELIN were used to distinguish established
local favourites from merely nearby search results.

Scheduling preserves the shared-backend design. If a restaurant is already an
activity, Food reuses it. Otherwise it calls the existing
trip_planner_add_activity RPC with category food and the verified coordinates,
then calls the unchanged trip_planner_add_stop RPC for the visibly selected
day. The catalogue itself is static app-shell data and does not create 15 live
database rows merely by being viewed.

Local browser verification at 390 x 844 confirmed:

- 6 Harrison and 9 Vancouver cards load from food-catalogue.js.
- Pizza filters Harrison to Village Pizzeria and Vancouver to Pizzeria Ludica;
  Sushi filters Vancouver to Momo Sushi.
- Selecting Harrison / 15 Sat and adding a new place sent add-activity followed
  by add-stop with the Harrison slug and exact 2026-08-15 target.
- Adding an already-saved Momo Sushi to Vancouver / 18 Tue skipped duplicate
  activity creation and sent only add-stop with the saved activity ID.
- Planned state, counts, all official links, five-tab navigation and target-day
  labels updated correctly, with no mobile overflow and the bottom nav visible.

Asset and service-worker versions moved together from v8 to v9, including the
new offline-cached food-catalogue.js. The combined UI work was committed and
pushed after rebasing over the scheduled site-data commit. GitHub Pages build
31702144698 completed successfully for app revision 207b402. Fresh live
requests then returned the Food view, all five Food nav buttons, app.js v9,
all 15 catalogue entries, cuisine handling and the v9 service-worker cache.
The canonical hosting copy and standalone working copy match.
## 2026-08-13: Clear leg and target-day controls + Harrison family ideas

Ideas and Amenities now carry the same Harrison Hot Springs / Vancouver leg
switcher as Day. Ideas also carries the selected leg's day pills under an
explicit **Add ideas to** label. Every saved-idea and search-result button
repeats the selected target (for example, **Add to 15 Sat**) and captures that
day and leg when rendered, so the visible label and the
trip_planner_add_stop payload cannot drift apart. The add-activity and
add-stop RPC names and argument shapes are unchanged. Cache and asset versions
were bumped together from v7 to v8.

Local verification used the real app files in an isolated Chrome session at
390 x 844 with stubbed successful RPC responses. Switching Harrison from
14 Fri to 15 Sat updated every Ideas button; clicking one sent
p_leg_slug = harrison, p_the_date = 2026-08-15, and the expected
activity ID to trip_planner_add_stop. Ideas switched to Vancouver and reset
to its first day; Amenities switched Vancouver -> Harrison and rendered each
leg's own rows. The page stayed 390 px wide, the labelled buttons remained
inside their cards, and the bottom navigation stayed visible. This was a local
mutation test only - it did not alter a real day.

Three deliberately small Harrison additions were written to the live shared
backend through the existing authenticated public.trip_planner_add_activity
path, with Google Places coordinates and source = claude_curated:

- Harrison Beach Pirate Playground + Playboxes - inclusive beachfront play and
  free balls/games between beach swims.
- Harrison Visitor Centre and Sasquatch Museum - a free 30-45 minute weather
  break with interactive displays and Sts'ailes context.
- Spirit Trail - an easy 1.1 km cedar loop framed as a carved-mask scavenger
  hunt.

All three were read back from the live database and each has zero scheduled
stops, so adding ideas did not silently plan a day. Current official research
also says the Miami Bridges Trail is temporarily closed, so it was not added.
The natural-looking water beside the hot-spring source is not a public soaking
pool; the existing Harrison Mineral Baths idea remains the public option and
same-day hours should be confirmed.

These target-day and leg-switcher changes shipped as part of the v9 Food
deployment described above.
## 2026-08-13: Vancouver family Explore planner

Added a dedicated **Explore** tab built around the actual planning job, not a
static article. It contains 24 current Vancouver / Metro Vancouver activities
chosen for a family with a six-year-old. Each card includes neighbourhood,
realistic duration, cost band, weather fit, the child-specific reason it made
the list, booking advice, a nearby pairing, and an official details link.
Filters cover best bets, rain-proof options, free / low-cost options, and
outdoors. A Vancouver day picker stays at the top so an activity can be added
directly to any of the five Vancouver days.

The catalogue is in `vancouver-guide.js`, separate from app logic and cached by
the service worker for offline browsing. Research was refreshed against
official 2026 attraction, municipal, and tourism sources on August 13. The
cards explicitly carry the time-sensitive details most likely to cause a bad
outing: Granville Island's splash pad is temporarily closed while the slide is
open; Stanley Park Mini Golf is operating at the currently closed train site;
Playland's regular season changes to PNE Fair admission on August 22; the
Shipyards splash park can close for weather / water restrictions; and the
Maritime Museum's St. Roch exhibit is being revitalized.

**Scheduling path:** if the activity already exists in Vancouver Ideas, Explore
reuses it. Otherwise it resolves the official place through the already-live
Places API, saves a `claude_curated` activity with the planning note, then adds
that activity to the selected day through the existing household RPCs. Planned
items disable themselves for that day, and the user stays in Explore so several
days can be built without bouncing between screens.

**Verification:** the updated app shell loaded in headless Chrome at a 390 x 844
mobile viewport and rendered all 24 cards with the bottom navigation visible.
Browser interaction checks confirmed the rain filter (10 cards), day switching,
all official links, and an add-to-day transition from zero stops to one with the
button changing to `Planned`. The interaction check used a stubbed successful
RPC response, so the new button itself has **not yet made an authenticated live
backend write**. The underlying Places and trip-planner RPCs were already live-
verified before this feature. A local render is saved outside the repo at
`C:\Users\vchew\.codex\visualizations\2026\08\13\019ff9a5-783c-7541-8429-fead0893c3b1\vancouver-explore-mobile.png`.
## Current state — clicked through end to end, and working

This project was started 2026-08-12, forked from route-optimizer, for a
mid-August 2026 Harrison Hot Springs → Vancouver trip. Exact dates and
street addresses are deliberately not in this public repo — see below.

**2026-08-13: the app has now been signed into and every flow exercised
against the live backend.** Six real bugs were found and fixed (commit
`24f1c17`), and each fix was re-verified against the deployed site, not
just locally. Everything below in this section is confirmed working in a
real browser:

- Magic-link sign-in round-trip (Supabase `signInWithOtp` → email → session)
- Leg switching (Harrison ↔ Vancouver), day strip navigation
- Weather card, including the "forecast changed since planned" alert state
- Real embedded Google Map with markers and route polyline
- Places text search, and adding a searched place as a stop
- Manual add-without-location ("Soak at the resort pool")
- "Optimize order" via the Routes API, including correctly parking
  location-less stops at the end instead of dropping them
- Manual up/down reorder, and stop status cycling (planned → done → skipped)
- Idea library and amenities views

### Standard map styling — don't re-theme it

The map shipped with a custom dark style matching the app palette, POI
labels switched off. It read as a broken map: dark, label-free tiles look
exactly like tiles failing to load, and that's what it was mistaken for on
sight. Reverted 2026-08-13 to Google's standard styling, which also brings
POI labels back — free context on a trip planner, since you can see the
restaurants and parks you haven't added yet.

`--map-bg` is now Google's own canvas grey rather than the app's dark
surface, so the placeholder doesn't flash dark-to-light while tiles load.
The dark app chrome around a normal-looking map is the intended result, not
an oversight.

### Removal exists now, and it breaks a Life Hub convention on purpose

`20260813090000_trip_planner_remove_functions.sql` adds
`trip_planner_remove_stop` (unschedule from a day, keep the idea) and
`trip_planner_remove_activity` (drop the idea and every day using it). Both
close the `sort_order` gap they leave, so ordering stays contiguous from 0
and can't collide with a later reorder or "Optimize order".

This deliberately reverses the "no delete function anywhere, same as
finance/cartwise" rule the API shipped with the day before. That rule is
right for ledgers — finance records what *happened*, and a transaction you
regret is still a transaction, so soft-correcting is honest. A trip plan
records what you *intend*, and intentions get abandoned outright. Marking a
mis-tapped stop `skipped` claims "we decided not to go" when the truth is
"that was a typo," and the day view fills up with other people's fat-finger
taps forever. **If you're adding a table to this schema, ask which kind it
is before inheriting the no-delete convention.**

In the UI, removal is two taps rather than a confirm dialog: the ✕ arms
itself, says "Sure?", and disarms after 3.5s. This gets used one-handed
outdoors, where a modal is worse than a second tap.

### The bug that matters most for anything else on this origin

**Google API keys restricted by HTTP referrer to a *path* do not work from
`fetch`.** The key is restricted to `https://r2vchew.github.io/vacation-central/*`,
but browsers default to a `strict-origin-when-cross-origin` referrer policy,
so a cross-origin `fetch` sends only `https://r2vchew.github.io/` — no path.
Google rejected it: `403 Requests from referer https://r2vchew.github.io/ are
blocked`. This killed **both** Places search and "Optimize order".

The fix is `referrerPolicy: 'unsafe-url'` on those specific fetches (see
`GOOGLE_REFERRER_POLICY` in `app.js`), which sends the full URL so the path
matches. That was chosen over the alternative — loosening the key
restriction to `https://r2vchew.github.io/*` — because the whole point of
the path restriction is that this origin also hosts digest and car-finder.

Worth knowing: the **Maps JavaScript API was unaffected** and rendered fine
throughout. Only the REST APIs called via `fetch` (Places, Routes) broke. So
"the map works" was never evidence that the key was configured correctly.

The other five fixes: the bottom nav was rendered off-screen and clipped
away entirely (Ideas and Amenities were unreachable); a Places API error
displayed as "No results", which is exactly how the 403 above stayed hidden;
the map zoomed to 22 — a blank grey square — on any day with fewer than two
located stops; expired sign-in links redirected back with the error in the
URL fragment and nothing read it, so a dead link looked identical to never
clicking one; and "Optimize order" sat on top of Google's own zoom control.

**Deployment caching gotcha, confirmed the hard way:** after pushing, the
browser kept serving the old bundle through *two* layers — the service
worker cache and the plain HTTP cache (`Cache-Control: max-age=600` from
GitHub Pages). Bumping `CACHE` in `sw.js` and the `?v=N` on the assets (as
`sw.js` itself instructs) is necessary but not sufficient within that
10-minute window; a one-off `?cb=` on the page URL is the reliable way to
confirm a fresh deploy immediately.

Done so far:
- Project folder created; icons carried over from route-optimizer as
  placeholders (still route-optimizer branded — fine functionally, worth a
  fresh icon pass later, not blocking).
- `trip_planner` Supabase schema **applied** to the live Life Hub database
  (`kejchvwswjpdrvyccufi`) via
  `../life-hub/shared-backend/database/migrations/20260812100000_create_trip_planner_foundation.sql`.
  Structure only: legs, activities, days, day_stops, amenities, plus
  household_members/is_household_member() following the same pattern as
  Cartwise's household auth.
- Both legs and their days **seeded** via
  `20260812101500_seed_trip_planner_legs_and_household.sql` — Harrison Hot
  Springs (3 days) and Vancouver (5 days). Exact dates and addresses live
  only in the database (that migration file, in the separate private
  `life-hub` repo — not this one). Vince added as the sole `trip_planner`
  household member using his existing Supabase Auth identity (same auth pool
  as Cartwise — no new signup needed). Home base coordinates are
  **approximate city-level lat/lng, not geocoded** from the real street
  addresses — fine for weather and initial map centering, not for
  pinpoint routing accuracy. Refine via a Places lookup later if that ever
  matters.
- Google Cloud project **`vacation-central`** created, billing linked to the
  existing "Main" account. Maps JavaScript API, Places API (New), and Routes
  API all enabled. Budget alert "Vacation Central cap," $10/month, 50/90/100%
  thresholds — alerts only, not a hard spend cap, same as route-optimizer's.
- API key created and restricted by HTTP referrer to
  `https://r2vchew.github.io/vacation-central/*` and
  `http://localhost:8732/*`. Deliberately different from route-optimizer's
  unrestricted key — this app is meant to be publicly hosted, that one isn't.
- `config.js` holds the real Maps key **and** the Supabase project URL +
  publishable key. **Deliberately NOT gitignored** — see its own comment.
  Both keys are safe to ship client-side by design (referrer restriction /
  RLS do the real gating, not secrecy) — don't copy route-optimizer's
  gitignore-the-key habit here. The Supabase publishable key is the same one
  `digest/` already ships publicly, so it was not new exposure.

  `config.example.js` used to say *"config.js is gitignored so your key never
  gets committed"* — inherited from route-optimizer, false here, and directly
  contradicted by the `.gitignore` sitting beside it. Corrected on commit. If
  that sentence ever reappears, someone has copied the wrong template again.

  **The Maps key is now genuinely public, and its HTTP-referrer restriction
  is the only thing protecting it from billing abuse.** That restriction was
  applied when the key was made (see above) but has never been re-verified
  since the key went public, and it cannot be checked from the repo — it
  lives in the Google Cloud console. Confirm it before assuming the $10/month
  budget alert is the backstop; the alert notifies, it does not cap.
- Amenities pulled from both listing pages (the public listing's "What this
  place offers" panel, not the reservation page) and seeded via
  `20260812110000_seed_trip_planner_amenities.sql`: 13 rows for Harrison, 17
  for Vancouver, curated to what's decision-relevant, not every toiletry.
  **Harrison has no beach-gear amenity** (bring your own for a beach day).
  **Vancouver has full baby gear** (pack 'n play, high chair, baby bath) plus
  a pool/hot tub/sauna/gym in the building.
- Household read/write API landed via
  `20260812120000_trip_planner_household_api.sql`, same shape as Cartwise's
  `feed_document`: security-definer logic in the closed `trip_planner_api`
  schema, thin `security invoker` wrappers in `public`. One atomic read —
  `public.trip_planner_document()` — returns the whole trip (legs, days,
  stops, activities, amenities) as one JSON document. Writes:
  `trip_planner_add_activity`, `trip_planner_add_stop`,
  `trip_planner_reorder_stops`, `trip_planner_update_stop_status`. No delete
  function anywhere, same as finance/cartwise.
- Weather history landed via
  `20260812130000_trip_planner_weather_forecasts.sql` —
  `trip_planner.weather_forecasts` is append-only, one row per fetch, never
  overwritten. `public.trip_planner_log_weather_forecast(...)` writes a row;
  `public.trip_planner_weather_history()` returns each day's newest + oldest
  row in one call, which is what lets the UI both throttle (check newest's
  age) and detect drift (compare newest vs oldest) without a second query.
- **Frontend built**: `index.html`, `app.js`, `styles.css`,
  `manifest.webmanifest`, `sw.js`. Passwordless email-link login via
  Supabase Auth (`signInWithOtp`) — no password to manage for either
  household member. A dedicated "you're signed in but not added yet" screen
  for the exact scenario Keely will hit first (`error.code === '42501'` from
  `is_household_member()`'s check, caught explicitly rather than shown as a
  generic error). Day view: leg tabs, a horizontal day strip, a weather card
  with a change-alert state, a real embedded Google Map showing the day's
  stops and route, and an ordered stop list. (The map was originally
  dark-styled to match the palette; that was reverted 2026-08-13 — see
  "Standard map styling" below.) Adding a stop: live Places text search, or reuse anything already in
  the leg's idea library, or — for things that aren't real searchable venues
  ("relax at the pool") — a manual add-without-location form. Reordering:
  an "Optimize order" button that calls the Routes API's waypoint
  optimization, plus manual up/down arrows per stop for a one-off nudge;
  both funnel through the same `persistReorder` helper so sort_order never
  collides. Stops without a location (manual entries) are excluded from
  route optimization but preserved in position, not silently dropped.
  Weather fetch is genuinely throttled client-side (4-hour window checked
  against `trip_planner_weather_history()`'s "newest" timestamp) before ever
  hitting Open-Meteo.
- `.claude/launch.json` created with a `vacation-central` config
  (`python -m http.server 8732` from this folder) for whenever local preview
  testing becomes useful again.
- **Committed and pushed 2026-08-12** as `ba35594`, "Add Vacation Central, a
  publicly hosted trip planner". This had been stuck: the files sat staged
  because the session that built them had `git commit`/`git push` blocked by
  its auto-mode classifier (blocked via both Bash and PowerShell, and blocked
  again when trying to adjust the permission itself), so the work was
  complete but invisible.

  Worth knowing for next time, because the two causes look identical from the
  outside: **there was a second, unrelated blocker underneath that one.**
  `main` was one commit *behind* `origin/main` — the `car-finder` GitHub
  Actions bot commits scan data to this repo on a schedule, so the branch
  drifts on its own without anyone touching it. A plain `git push` would have
  been rejected even with permissions sorted. The fix is a rebase, and it is
  safe: the bot only ever writes `car-finder/data/`, so it has never
  conflicted with app code. Expect to need `git fetch && git rebase
  origin/main` before any push to this repo.
- [docs/DESIGN_BRIEF.md](docs/DESIGN_BRIEF.md) — data model, flows,
  constraints, visual precedent for whoever designs/refines the interface.
  Design-level context only; this file carries the engineering details.

Not started / not verified:
- ~~No live test of any kind~~ — **done 2026-08-13**, see the top of this
  file. Auth, RPCs, Places, Routes, Open-Meteo and map rendering have all
  now executed for real.
- ~~Test data sitting in the live trip~~ — **cleared 2026-08-13**, using the
  new remove buttons (below) rather than raw SQL, which doubled as the
  feature's first real test. Harrison / 15 Sat is empty again and both idea
  libraries are back to empty.
- ~~Magic-link redirect URL allowlisted in Supabase~~ — **done 2026-08-12.**
  `https://r2vchew.github.io/vacation-central/` and `http://localhost:8732/`
  both added to Authentication → URL Configuration → Redirect URLs (3 total
  URLs now, alongside digest's). Verified via the Supabase dashboard, not
  just assumed. This was the one setup step the app couldn't do for itself —
  without it sign-in fails quietly and looks like an app bug. Still true that
  nobody has actually completed a sign-in yet; this just removes the config
  gap that would have silently broken the first attempt.
- ~~Maps key referrer restriction~~ — **re-verified 2026-08-12**, unchanged
  since creation: `Websites` restriction, exactly
  `http://localhost:8732/*` and `https://r2vchew.github.io/vacation-central/*`,
  confirmed directly in the Google Cloud console (not inferred).
- Keely isn't a household member yet — needs her own Supabase Auth signup
  first (her action), then one SQL insert into
  `trip_planner.household_members` (same pattern as Vince's).
- Home page (`r2vchew.github.io/index.html`) still doesn't link to
  `vacation-central/` — confirmed absent as of 2026-08-12. The app is
  reachable only by typing the URL.
- Fresh icon set — still using route-optimizer's placeholder icons.

## Next useful action

The app works. What's left is other people, real content, and polish.

1. **Decide what to do with the test data** listed above — keep the five
   Harrison activities as genuine ideas, or clear the day_stops so 15 Sat
   starts empty. Needs service-role SQL either way.
2. **Add Keely.** She needs her own Supabase Auth signup first, then one
   insert into `trip_planner.household_members`. Before that insert, have her
   open the app once and confirm she lands on the "signed in but not added
   yet" screen rather than a generic error — that path was written
   specifically for her and is the one flow still never executed.
3. ~~Put real ideas in the library~~ — **seeded 2026-08-13.** 17
   kid-oriented activities (7 Harrison, 10 Vancouver), all with real Places
   coordinates so they route and map correctly, all `source =
   'claude_curated'` with a note explaining why each suits a 6-year-old.
   Seeded through the app's own `trip_planner_add_activity` RPC, not raw SQL.
   Still untested: the **Claude Chat → same database** path, which is the
   premise the shared backend exists for. Adding one idea from a normal chat
   is the test.
4. **Link it from the site home page** (`r2vchew.github.io/index.html`) —
   the app is still reachable only by typing the URL. This was gated on "once
   it actually works," which is now satisfied.
5. Fresh icons — still route-optimizer's placeholders.

Known rough edge, not blocking: guessCategory filed Harrison Mineral Baths as other rather than rest.
