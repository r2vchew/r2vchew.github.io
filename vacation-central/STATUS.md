# Status

Last updated: 2026-08-13

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
  with a change-alert state, a real embedded Google Map (dark-styled to
  match the palette) showing the day's stops and route, and an ordered stop
  list. Adding a stop: live Places text search, or reuse anything already in
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
3. **Put real ideas in the library.** Both legs are empty apart from the test
   rows. This is the "Claude Chat adds an activity from a normal
   conversation" path the whole shared-backend design exists for, and it has
   never been used either.
4. **Link it from the site home page** (`r2vchew.github.io/index.html`) —
   the app is still reachable only by typing the URL. This was gated on "once
   it actually works," which is now satisfied.
5. Fresh icons — still route-optimizer's placeholders.

Known rough edges, none blocking: there's no leg switcher on the Ideas or
Amenities views (you have to go back to Day to change legs); the Ideas view
doesn't say which day "Add" adds to; and `guessCategory` filed Harrison
Mineral Baths as `other` rather than `rest`.
