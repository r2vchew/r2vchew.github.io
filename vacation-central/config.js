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

  // ntfy.sh push notification topic for "the forecast changed enough to
  // matter" alerts. ntfy is a free, keyless push service: anyone who knows
  // the topic name can read what's posted to it, so this is a made-up,
  // non-guessable string rather than something memorable — treat it as
  // semi-private, the way you would a calendar link.
  //
  // One-time setup (Vince's phone, not something this app can do for you):
  //   1. Install the "ntfy" app (iOS App Store / Google Play).
  //   2. In the app, subscribe to the exact topic below.
  //   3. Done — no account, no login. You'll get a push whenever a day's
  //      forecast changes enough to be worth reconsidering plans for.
  NTFY_TOPIC: 'vince-vacation-central-h9k2p',
};