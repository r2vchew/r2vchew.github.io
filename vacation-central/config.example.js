/* Template — copy this to config.js and fill in your real values.
   Note: unlike route-optimizer, config.js here is NOT gitignored — this app is
   publicly hosted on GitHub Pages and needs its keys to ship with the site.
   Both keys are safe to publish by design: the Maps key is HTTP-referrer
   restricted and the Supabase key is a publishable one gated by RLS. Never put
   a service_role or secret key in this file. See .gitignore and STATUS.md. */
window.CONFIG = {
  GOOGLE_MAPS_API_KEY: 'PASTE_YOUR_KEY_HERE',
  SUPABASE_URL: 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE',
  SUPABASE_PUBLISHABLE_KEY: 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE',
  searchRadiusMeters: 9000,
  maxCandidates: 6,
  routingPreference: 'TRAFFIC_AWARE',
};
