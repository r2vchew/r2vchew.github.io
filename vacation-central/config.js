/* ============================================================
   Vacation Central — configuration
   This is the ONLY file you need to edit to go live.
   ============================================================ */
window.CONFIG = {

  // Google Maps Platform API key (Maps JavaScript + Places (New) + Routes).
  // Project: vacation-central, restricted to this app's GitHub Pages URL and
  // http://localhost:8732 for local dev. See ../route-optimizer/OPERATIONS.md
  // for why route-optimizer's key was left unrestricted and this one isn't:
  // this app is meant to be publicly hosted.
  GOOGLE_MAPS_API_KEY: 'AIzaSyBes9UV3TwkPY38Wc-mPL861BnUfgP5hVM',

  // Supabase project (Life Hub — shared with Cartwise/Finance/Career Central,
  // this app's data lives in its own trip_planner schema, RLS-gated to
  // household members only). The publishable key is safe to ship client-side
  // by design — it grants nothing on its own, same reasoning as the Maps
  // key: the real gate is server-side (RLS + household_members), not secrecy.
  SUPABASE_URL: 'https://kejchvwswjpdrvyccufi.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0sg-HAeFVVj4vnYAMMNQng_pSX-lvLs',

  searchRadiusMeters: 9000,
  maxCandidates: 6,
  routingPreference: 'TRAFFIC_AWARE',
};