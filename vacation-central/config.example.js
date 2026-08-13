/* Template — copy this to config.js and fill in your real values.
   Unlike most apps, config.js here is deliberately NOT gitignored — this app
   is publicly hosted, so config.js has to ship with the deployed site or the
   live app has no key at all. Safety comes from the Maps key's HTTP-referrer
   restriction and Supabase's RLS, not from secrecy. See config.js's own
   comments and STATUS.md before copying the gitignore-the-key habit here. */
window.CONFIG = {
  GOOGLE_MAPS_API_KEY: 'PASTE_YOUR_KEY_HERE',
  SUPABASE_URL: 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE',
  SUPABASE_PUBLISHABLE_KEY: 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE',
  searchRadiusMeters: 9000,
  maxCandidates: 6,
  routingPreference: 'TRAFFIC_AWARE',
  NTFY_TOPIC: 'PASTE_YOUR_NTFY_TOPIC_HERE',
};
