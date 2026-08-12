# Vacation Central

A mobile-first PWA for planning and running a multi-stop trip: which day, which
stops, what order, on a real map — plus what the place you're staying already
gives you, so "should we bring beach gear" has an actual answer.

Forked from [Route Optimizer](../route-optimizer/README.md), which answers a
narrower question ("best single detour on a live commute"). This app answers a
broader one ("what does day 3 of the trip look like"), across more than one
home base.

## Current trip

Two legs, a mid-August 2026 stay in each:

| Leg | Home base |
|---|---|
| Harrison Hot Springs | Harrison Hot Springs, BC |
| Vancouver | Vancouver, BC |

Exact dates and street addresses live only in the private, household-gated
Supabase database — deliberately not in this public repo. Pulled from Airbnb
reservations on 2026-08-11.

## What's different from Route Optimizer

- **Real embedded map** (Google Maps JavaScript API), not the canvas-drawn
  route line — route-optimizer skipped this to keep the API surface to two
  billable APIs; a multi-day trip is worth the third.
- **Multi-day, multi-leg itinerary**, not one live "best detour right now"
  lookup.
- **Shared state via Supabase** (`trip_planner` schema, same Life Hub project
  as Cartwise/Finance/Career Central) — Claude Chat can add an activity or
  amenity note from a normal conversation, the app picks it up on refresh. See
  `../life-hub/shared-backend/README.md` for the shared-backend conventions
  this follows.
- **Amenities**, pulled once from each Airbnb listing page (not a live sync)
  so day-planning can check "does the place already have this" before
  suggesting a rental or purchase.

## Structure

Same PWA shell pattern as route-optimizer — see `STATUS.md` for current build
state and what's still in progress.
