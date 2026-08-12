# Status

Last updated: 2026-08-12

## Current state — deployed and publicly reachable, but never actually run

This project was started 2026-08-12, forked from route-optimizer, for a
mid-August 2026 Harrison Hot Springs → Vancouver trip. Exact dates and
street addresses are deliberately not in this public repo — see below.

**Read this before touching anything**: the frontend (`index.html`/`app.js`/
`styles.css`) exists and is internally consistent (every DOM id referenced
in `app.js` exists in `index.html`, every Supabase RPC call matches a real
function signature) but has **not been run in a browser or tested against a
live login**. It was built without a working preview in the 2026-08-12
session that created it (remote-control constraints made local-server
testing impractical). Treat the first real test — including the magic-link
auth round-trip — as unverified work, not a formality.

**Being deployed is not the same as working.** As of 2026-08-12 the app is
committed, pushed, and served at
[r2vchew.github.io/vacation-central/](https://r2vchew.github.io/vacation-central/)
— verified over real HTTP, with `index.html`, `config.js`, `app.js`,
`styles.css`, `manifest.webmanifest`, `sw.js` and the icons all returning
200. That means the *hosting* is proven and nothing more. Not one line of
its logic has executed against the live database, the Maps APIs, or
Open-Meteo. A green 200 on `app.js` says the file downloads, not that the
app functions.

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
- **No live test of any kind.** Auth round-trip, RPC calls, Places/Routes
  API calls, Open-Meteo fetch, map rendering — all written against the
  documented shapes but never executed. First real session with this app
  should treat it as a first draft, not a working app, until proven
  otherwise. Deployment did not change this.
- **One setup step the app cannot do for itself**: the magic-link redirect
  URL has to be allowlisted in Supabase → Authentication → URL Configuration
  → Redirect URLs as `https://r2vchew.github.io/vacation-central/`. Without
  it, sign-in fails quietly, and it will look like an app bug rather than a
  config gap. The digest app hit exactly this and it is recorded in its own
  STATUS.md — check this *before* debugging a failed login.
- Maps key referrer restriction — applied at creation, never re-verified now
  that the key is public. Console-only check.
- Keely isn't a household member yet — needs her own Supabase Auth signup
  first (her action), then one SQL insert into
  `trip_planner.household_members` (same pattern as Vince's).
- Home page (`r2vchew.github.io/index.html`) still doesn't link to
  `vacation-central/` — confirmed absent as of 2026-08-12. The app is
  reachable only by typing the URL.
- Fresh icon set — still using route-optimizer's placeholder icons.

## Next useful action

The commit is no longer the blocker; it landed 2026-08-12. What stands
between this and a usable app is that **nobody has ever opened it**.

1. Allowlist the redirect URL in Supabase (above). Two minutes, and it
   silently breaks login if skipped — do it before step 2 so a failed
   sign-in means something.
2. Open [the live URL](https://r2vchew.github.io/vacation-central/), sign in,
   and exercise every flow once: magic-link round-trip, day/leg navigation,
   weather card, map render, Places search, manual add-without-location,
   "Optimize order", and the manual up/down reorder. Expect real bugs — this
   is the first execution of code written blind.
3. Confirm the Maps key restriction in the Google Cloud console.
4. Add Keely as a household member once she's signed up, and check she lands
   on the "signed in but not added yet" screen before that, not a generic
   error — that path was written specifically for her and has never run.
5. Link it from the site home page once it actually works. Linking a broken
   app is worse than not linking it.
