/* ============================================================
   Vacation Central — app logic (plain JS, no framework)

   Data flow: one Supabase RPC (trip_planner_document) returns the whole
   trip as JSON on load; everything renders from that in-memory copy.
   Writes call a narrow RPC, then patch the in-memory copy directly rather
   than re-fetching the whole document — keeps the UI snappy on a phone
   connection. Weather is fetched client-side from Open-Meteo (no key),
   throttled against the logged history so opening the app repeatedly in a
   day doesn't spam the database.
   ============================================================ */
'use strict';

const SB = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
const WEATHER_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours — see docs/DESIGN_BRIEF.md

/* The Maps key is referrer-restricted to https://r2vchew.github.io/vacation-central/*.
   Browsers default to a `strict-origin-when-cross-origin` referrer policy, so a
   plain cross-origin fetch sends only `https://r2vchew.github.io/` — no path —
   and Google rejects it with 403 "Requests from referer ... are blocked".
   `unsafe-url` sends the full URL so the path matches the restriction. Applied
   per-request (not page-wide) so only the Google API calls leak the path.
   Verified live 2026-08-13: without it, Places and Routes both 403. */
const GOOGLE_REFERRER_POLICY = 'unsafe-url';

/* Zoom levels. HOME is what you see on a day with nothing planned yet: wide
   enough to place the lodging in its surroundings (Harrison plus the lake and
   Agassiz; Vancouver plus the North Shore) rather than a street corner.
   MAX caps fitBounds, which otherwise zooms to 22 on a single point or two
   stops next door to each other. */
const MAP_HOME_ZOOM = 11;
const MAP_MAX_FIT_ZOOM = 14;

const State = {
  trip: null,
  weatherHistory: {},
  currentLegSlug: null,
  currentDayId: null,
  map: null,
  mapMarkers: [],
  mapPolyline: null,
  exploreDayId: null,
  exploreFilter: 'all',
};

/* ---------- view routing + toast ---------- */
const App = {
  show(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('view--active', v.dataset.view === view));
    // Keep the nav highlight with the view rather than with the last tap —
    // adding from the Ideas list jumps to Day, and the nav used to stay on Ideas.
    document.querySelectorAll('.nav-btn').forEach((n) => n.classList.toggle('nav-btn--active', n.dataset.nav === view));
  },
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('toast--show');
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => t.classList.remove('toast--show'), 2600);
  },
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ============================================================
   Auth — passwordless email link. Both household members sign in this
   way; who can actually read/write is enforced by RLS + household_members,
   not by anything in this file.
   ============================================================ */
// Supabase reports a bad/expired/already-used link by redirecting back with the
// failure in the URL fragment. Nothing read it, so a dead link looked identical
// to never having clicked one — you just landed on the login screen again.
function consumeAuthErrorFromUrl() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw.includes('error')) return null;
  const p = new URLSearchParams(raw);
  const code = p.get('error_code');
  const desc = p.get('error_description');
  if (!p.get('error') && !code) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return code === 'otp_expired'
    ? 'That sign-in link has expired or was already used. Send yourself a fresh one.'
    : (desc || 'Sign-in failed. Try sending a new link.');
}

async function initAuth() {
  const authError = consumeAuthErrorFromUrl();
  const { data: { session } } = await SB.auth.getSession();
  if (session) {
    await bootTrip();
  } else {
    if (authError) document.getElementById('loginError').textContent = authError;
    App.show('login');
  }
  SB.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) bootTrip();
  });
}

document.getElementById('loginSend').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const errEl = document.getElementById('loginError');
  const noteEl = document.getElementById('loginNote');
  errEl.textContent = '';
  noteEl.textContent = '';
  if (!email) { errEl.textContent = 'Enter your email.'; return; }
  const { error } = await SB.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) { errEl.textContent = error.message; return; }
  noteEl.textContent = `Check ${email} for a sign-in link, then come back to this tab.`;
});

function showNotHouseholdMember() {
  App.show('pending');
}

document.getElementById('pendingRetry').addEventListener('click', bootTrip);

/* ============================================================
   Data load
   ============================================================ */
async function bootTrip() {
  const { data, error } = await SB.rpc('trip_planner_document');
  if (error) {
    if (error.code === '42501') {
      showNotHouseholdMember();
    } else {
      App.toast('Could not load trip: ' + error.message);
    }
    return;
  }
  State.trip = data;

  const { data: wx } = await SB.rpc('trip_planner_weather_history');
  State.weatherHistory = wx || {};

  if (!State.currentLegSlug && data.legs.length) State.currentLegSlug = data.legs[0].slug;
  pickTodayOrFirstDay();

  App.show('day');
  renderLegTabs();
  renderDayStrip();
  renderDay();
  loadGoogleMaps();
}

function currentLeg() {
  return State.trip.legs.find((l) => l.slug === State.currentLegSlug);
}
function currentDay() {
  const leg = currentLeg();
  if (!leg || !leg.days.length) return null;
  return leg.days.find((d) => d.id === State.currentDayId) || leg.days[0];
}

function pickTodayOrFirstDay() {
  const leg = currentLeg();
  if (!leg || !leg.days.length) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  const match = leg.days.find((d) => d.the_date === todayStr);
  State.currentDayId = (match || leg.days[0]).id;
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/* ============================================================
   Rendering — day view
   ============================================================ */
function renderLegTabs() {
  const el = document.getElementById('legTabs');
  el.innerHTML = '';
  State.trip.legs.forEach((leg) => {
    const btn = document.createElement('button');
    btn.className = 'leg-tab' + (leg.slug === State.currentLegSlug ? ' leg-tab--active' : '');
    btn.textContent = leg.name;
    btn.addEventListener('click', () => {
      State.currentLegSlug = leg.slug;
      pickTodayOrFirstDay();
      renderLegTabs();
      renderDayStrip();
      renderDay();
    });
    el.appendChild(btn);
  });
}

function renderDayStrip() {
  const leg = currentLeg();
  const el = document.getElementById('dayStrip');
  el.innerHTML = '';
  document.getElementById('dayLegName').textContent = leg.name;
  document.getElementById('dayHomeBase').textContent = leg.home_base_label;
  leg.days.forEach((day) => {
    const pill = document.createElement('button');
    pill.className = 'day-pill' + (day.id === State.currentDayId ? ' day-pill--active' : '');
    pill.textContent = formatDayLabel(day.the_date);
    pill.addEventListener('click', () => {
      State.currentDayId = day.id;
      renderDayStrip();
      renderDay();
    });
    el.appendChild(pill);
  });
}

function renderDay() {
  const day = currentDay();
  if (!day) return;
  renderStops(day);
  renderWeather(day);
  renderMap(day);
  maybeFetchWeather(day);
}

function renderStops(day) {
  const el = document.getElementById('stopList');
  el.innerHTML = '';
  // Optimizing needs two routable stops; showing the button before then just
  // buys you a toast explaining why it didn't work.
  const routable = day.stops.filter((s) => s.lat && s.lng).length;
  document.getElementById('btnOptimize').style.display = routable >= 2 ? 'block' : 'none';
  if (!day.stops.length) {
    el.innerHTML = '<div class="empty-note">No stops yet — tap + to search, or pull one from Ideas.</div>';
    return;
  }
  const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  sorted.forEach((stop, i) => {
    const card = document.createElement('div');
    card.className = 'stop-card';
    card.innerHTML = `
      <div class="stop-order">${i + 1}</div>
      <div class="stop-info">
        <div class="stop-name${stop.status === 'done' ? ' stop-name--done' : ''}"></div>
        <div class="stop-meta"></div>
      </div>
      <div class="stop-reorder">
        <button class="stop-reorder-btn" data-dir="up">▲</button>
        <button class="stop-reorder-btn" data-dir="down">▼</button>
      </div>
      <button class="stop-status-btn${stop.status === 'done' ? ' stop-status-btn--done' : ''}${stop.status === 'skipped' ? ' stop-status-btn--skipped' : ''}"></button>
    `;
    card.querySelector('.stop-name').textContent = stop.name;
    card.querySelector('.stop-meta').textContent = stop.category + (stop.planned_time ? ' · ' + stop.planned_time : '');
    const statusBtn = card.querySelector('.stop-status-btn');
    statusBtn.textContent = stop.status === 'done' ? '✓' : stop.status === 'skipped' ? '×' : '○';
    statusBtn.addEventListener('click', () => cycleStopStatus(stop));

    const upBtn = card.querySelector('[data-dir="up"]');
    const downBtn = card.querySelector('[data-dir="down"]');
    upBtn.disabled = i === 0;
    downBtn.disabled = i === sorted.length - 1;
    upBtn.addEventListener('click', () => moveStop(day, stop.id, -1));
    downBtn.addEventListener('click', () => moveStop(day, stop.id, 1));

    card.appendChild(makeRemoveButton('✕', () => removeStop(day, stop)));

    el.appendChild(card);
  });
}

/* Removing is destructive and there's no undo, but this gets used one-handed
   on a sidewalk — so it's two taps, not a modal: the button arms itself, says
   "Sure?", and disarms on its own if you don't follow through. */
function makeRemoveButton(idleLabel, onConfirm) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'remove-btn';
  btn.textContent = idleLabel;
  btn.setAttribute('aria-label', 'Remove');
  const disarm = () => {
    clearTimeout(btn._armTimer);
    btn.dataset.armed = '0';
    btn.classList.remove('remove-btn--armed');
    btn.textContent = idleLabel;
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.dataset.armed === '1') { disarm(); onConfirm(); return; }
    btn.dataset.armed = '1';
    btn.classList.add('remove-btn--armed');
    btn.textContent = 'Sure?';
    btn._armTimer = setTimeout(disarm, 3500);
  });
  return btn;
}

function resequence(stops) {
  [...stops].sort((a, b) => a.sort_order - b.sort_order).forEach((s, i) => { s.sort_order = i; });
}

async function removeStop(day, stop) {
  const { error } = await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stop.id });
  if (error) { App.toast('Could not remove: ' + error.message); return; }
  day.stops = day.stops.filter((s) => s.id !== stop.id);
  resequence(day.stops); // mirrors the gap-closing the RPC just did server-side
  App.toast(`Removed ${stop.name} from this day.`);
  renderStops(day);
  renderMap(day);
}

async function removeActivity(activity) {
  const { error } = await SB.rpc('trip_planner_remove_activity', { p_activity_id: activity.id });
  if (error) { App.toast('Could not remove: ' + error.message); return; }
  const leg = currentLeg();
  leg.activities = leg.activities.filter((a) => a.id !== activity.id);
  // The RPC also unschedules it everywhere, so drop it from every day too.
  leg.days.forEach((d) => {
    const before = d.stops.length;
    d.stops = d.stops.filter((s) => s.activity_id !== activity.id);
    if (d.stops.length !== before) resequence(d.stops);
  });
  App.toast(`Removed ${activity.name}.`);
  renderLibrary();
  const day = currentDay();
  if (day) { renderStops(day); renderMap(day); }
}

async function cycleStopStatus(stop) {
  const next = stop.status === 'planned' ? 'done' : stop.status === 'done' ? 'skipped' : 'planned';
  const { error } = await SB.rpc('trip_planner_update_stop_status', { p_day_stop_id: stop.id, p_status: next });
  if (error) { App.toast('Could not update: ' + error.message); return; }
  stop.status = next;
  renderStops(currentDay());
}

function moveStop(day, stopId, direction) {
  const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  const idx = sorted.findIndex((s) => s.id === stopId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
  [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
  persistReorder(day, sorted.map((s) => s.id));
}

async function persistReorder(day, orderedStopIds) {
  const { error } = await SB.rpc('trip_planner_reorder_stops', { p_day_id: day.id, p_stop_ids: orderedStopIds });
  if (error) { App.toast('Could not reorder: ' + error.message); return; }
  orderedStopIds.forEach((id, i) => { const s = day.stops.find((x) => x.id === id); if (s) s.sort_order = i; });
  renderStops(day);
  renderMap(day);
}

/* ============================================================
   Weather — Open-Meteo, throttled against logged history
   ============================================================ */
function renderWeather(day) {
  const hist = State.weatherHistory[String(day.id)];
  const card = document.getElementById('weatherCard');
  const alertEl = document.getElementById('weatherAlert');
  alertEl.style.display = 'none';
  if (!hist || !hist.newest) { card.style.display = 'none'; return; }

  const n = hist.newest;
  card.style.display = 'flex';
  document.getElementById('weatherIcon').textContent = conditionEmoji(n.condition);
  document.getElementById('weatherTemp').textContent = `${Math.round(n.temp_high_c)}° / ${Math.round(n.temp_low_c)}°C`;
  document.getElementById('weatherCond').textContent = n.condition;

  const o = hist.oldest;
  const changed = o && o.fetched_at !== n.fetched_at &&
    (o.condition !== n.condition || Math.abs((o.temp_high_c ?? 0) - (n.temp_high_c ?? 0)) >= 4);
  if (changed) {
    alertEl.style.display = 'block';
    alertEl.textContent = `Forecast changed since planned — was ${o.condition}, ${Math.round(o.temp_high_c)}°C, now ${n.condition}, ${Math.round(n.temp_high_c)}°C.`;
  }
}

function conditionEmoji(cond) {
  const map = {
    clear: '☀️', sunny: '☀️', 'partly cloudy': '⛅', overcast: '☁️', cloudy: '☁️',
    fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', thunderstorm: '⛈️',
  };
  return map[cond] || '🌡️';
}

// WMO weather codes (Open-Meteo's scheme), collapsed to short labels so the
// UI never has to know the provider's coding.
function openMeteoCondition(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'cloudy';
}

async function maybeFetchWeather(day) {
  const leg = currentLeg();
  if (!leg.home_base_lat || !leg.home_base_lng) return;

  const key = String(day.id);
  const hist = State.weatherHistory[key];
  if (hist && hist.newest) {
    const ageMs = Date.now() - new Date(hist.newest.fetched_at).getTime();
    if (ageMs < WEATHER_THROTTLE_MS) return; // fresh enough — this is the throttle
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${leg.home_base_lat}&longitude=${leg.home_base_lng}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&start_date=${day.the_date}&end_date=${day.the_date}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.daily || !json.daily.time || !json.daily.time.length) return;

    const condition = openMeteoCondition(json.daily.weathercode[0]);
    const tempHigh = json.daily.temperature_2m_max[0];
    const tempLow = json.daily.temperature_2m_min[0];
    const precip = json.daily.precipitation_probability_max ? json.daily.precipitation_probability_max[0] : null;

    const { error } = await SB.rpc('trip_planner_log_weather_forecast', {
      p_day_id: day.id, p_condition: condition, p_temp_high_c: tempHigh, p_temp_low_c: tempLow,
      p_precip_probability_pct: precip, p_raw: json,
    });
    if (error) return;

    const entry = { fetched_at: new Date().toISOString(), condition, temp_high_c: tempHigh, temp_low_c: tempLow, precip_probability_pct: precip };
    if (!State.weatherHistory[key]) State.weatherHistory[key] = { newest: entry, oldest: entry };
    else State.weatherHistory[key].newest = entry;

    if (day.id === State.currentDayId) renderWeather(day);
  } catch (e) {
    // Offline or Open-Meteo hiccup — silently skip. Next app-open retries;
    // there's no user-facing error for a background weather refresh.
  }
}

/* ============================================================
   Map — real Google Map, not a canvas
   ============================================================ */
let mapsReady = false;
window.onGoogleMapsReady = function () {
  mapsReady = true;
  if (State.trip) renderMap(currentDay());
};

function loadGoogleMaps() {
  if (document.getElementById('gmapsScript') || mapsReady) return;
  const s = document.createElement('script');
  s.id = 'gmapsScript';
  s.async = true;
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.GOOGLE_MAPS_API_KEY)}&callback=onGoogleMapsReady&v=weekly`;
  document.head.appendChild(s);
}

/* The map is deliberately NOT restyled to match the app's dark palette.
   It was, and it read as broken: a dark custom style with POI labels turned
   off looks like tiles failing to load, and you lose the thing a map is for
   outdoors — recognising where you are against the Google Maps you already
   know. Standard styling also brings back POI labels, which is free context
   for a trip planner (you can see the restaurants you haven't added yet).
   The one dark-app concession is the map's own background colour while tiles
   load, set in CSS. */

function renderMap(day) {
  if (!mapsReady || !day) return;
  const leg = currentLeg();
  const container = document.getElementById('dayMap');

  if (!State.map) {
    let mapDiv = document.getElementById('dayMapCanvas');
    if (!mapDiv) {
      mapDiv = document.createElement('div');
      mapDiv.id = 'dayMapCanvas';
      mapDiv.style.cssText = 'position:absolute;inset:0;';
      container.insertBefore(mapDiv, container.firstChild);
    }
    State.map = new google.maps.Map(mapDiv, {
      center: { lat: leg.home_base_lat, lng: leg.home_base_lng },
      zoom: MAP_HOME_ZOOM,
      // Google's own controls, not a stripped-down embed — this should feel
      // like the Google Maps you already know how to use. Street View's pegman
      // is the one omission: it eats a corner of a 220px-tall map and there's
      // nowhere useful to drop it. Fullscreen earns its place precisely
      // because the inline map is small.
      mapTypeControl: true,
      mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU },
      fullscreenControl: true,
      zoomControl: true,
      streetViewControl: false,
      // One-finger drag pans, instead of Google's default "use two fingers"
      // overlay. This is used one-handed.
      gestureHandling: 'greedy',
    });
  }

  State.mapMarkers.forEach((m) => m.setMap(null));
  State.mapMarkers = [];
  if (State.mapPolyline) { State.mapPolyline.setMap(null); State.mapPolyline = null; }

  const bounds = new google.maps.LatLngBounds();
  const homePos = { lat: leg.home_base_lat, lng: leg.home_base_lng };
  State.mapMarkers.push(new google.maps.Marker({
    position: homePos, map: State.map, title: leg.home_base_label,
    label: { text: 'H', color: '#fff', fontSize: '11px', fontWeight: '700' },
  }));
  bounds.extend(homePos);

  const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order).filter((s) => s.lat && s.lng);
  const path = [homePos];
  sorted.forEach((stop, i) => {
    const pos = { lat: stop.lat, lng: stop.lng };
    State.mapMarkers.push(new google.maps.Marker({
      position: pos, map: State.map, title: stop.name,
      label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
    }));
    bounds.extend(pos);
    path.push(pos);
  });
  if (sorted.length) path.push(homePos);

  if (path.length > 1) {
    State.mapPolyline = new google.maps.Polyline({ path, strokeColor: '#4f8cff', strokeWeight: 3, strokeOpacity: 0.85, map: State.map });
  }

  // With no located stops the bounds are a single point, and fitBounds zooms to
  // 22 — a featureless grey square. Show the neighbourhood instead. Also cap the
  // zoom for the one-stop-next-door case, which has the same problem.
  if (!sorted.length) {
    State.map.setCenter(homePos);
    State.map.setZoom(MAP_HOME_ZOOM);
  } else if (!bounds.isEmpty()) {
    State.map.fitBounds(bounds, 40);
    google.maps.event.addListenerOnce(State.map, 'idle', () => {
      if (State.map.getZoom() > MAP_MAX_FIT_ZOOM) State.map.setZoom(MAP_MAX_FIT_ZOOM);
    });
  }
}

document.getElementById('btnOptimize').addEventListener('click', optimizeDay);

async function optimizeDay() {
  const day = currentDay();
  const leg = currentLeg();
  const allSorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  const sorted = allSorted.filter((s) => s.lat && s.lng);
  // Stops with no location (manual, no-search-result entries) can't be routed —
  // keep them, just after the routed ones, so they don't lose their sort_order
  // and collide with the newly-optimized indices.
  const unroutable = allSorted.filter((s) => !(s.lat && s.lng));
  if (sorted.length < 2) { App.toast('Need at least 2 stops with a location to optimize.'); return; }
  App.toast('Optimizing…');
  try {
    const body = {
      origin: { location: { latLng: { latitude: leg.home_base_lat, longitude: leg.home_base_lng } } },
      destination: { location: { latLng: { latitude: leg.home_base_lat, longitude: leg.home_base_lng } } },
      intermediates: sorted.map((s) => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } })),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: true,
    };
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex',
      },
      body: JSON.stringify(body),
      referrerPolicy: GOOGLE_REFERRER_POLICY,
    });
    const json = await res.json();
    const order = json.routes && json.routes[0] && json.routes[0].optimizedIntermediateWaypointIndex;
    if (!order) { App.toast('Could not optimize — try again later.'); return; }

    const newOrderStopIds = order.map((i) => sorted[i].id).concat(unroutable.map((s) => s.id));
    await persistReorder(day, newOrderStopIds);
    App.toast('Order updated.');
  } catch (e) {
    App.toast('Optimize failed — check connection.');
  }
}

/* ============================================================
   Add a stop — search live, or pull from the leg's idea library
   ============================================================ */
document.getElementById('fabAdd').addEventListener('click', () => {
  document.getElementById('searchDayLabel').textContent = formatDayLabel(currentDay().the_date);
  document.getElementById('searchInput').value = '';
  document.getElementById('manualForm').style.display = 'none';
  document.getElementById('manualName').value = '';
  renderLibraryAsSearchResults();
  App.show('search');
});

document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runPlaceSearch(e.target.value.trim());
});

document.getElementById('manualToggle').addEventListener('click', () => {
  const form = document.getElementById('manualForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('manualAdd').addEventListener('click', async () => {
  const name = document.getElementById('manualName').value.trim();
  if (!name) { App.toast('Give it a name first.'); return; }
  const category = document.getElementById('manualCategory').value;
  const leg = currentLeg();
  const day = currentDay();
  const { data: activityId, error } = await SB.rpc('trip_planner_add_activity', {
    p_leg_slug: leg.slug, p_name: name, p_category: category, p_source: 'user_added',
  });
  if (error) { App.toast('Could not save: ' + error.message); return; }
  const newActivity = { id: activityId, name, category, address: null, lat: null, lng: null, source: 'user_added', notes: null };
  leg.activities.push(newActivity);
  await addActivityToDay(newActivity, day, leg);
});

function setSearchLabel(text) {
  document.getElementById('searchResultsLabel').textContent = text;
}

function renderLibraryAsSearchResults() {
  const leg = currentLeg();
  const el = document.getElementById('searchResults');
  setSearchLabel('Idea library for this leg');
  el.innerHTML = '';
  leg.activities.forEach((act) => el.appendChild(buildResultCard(act.name, act.category, () => addExistingActivityToDay(act), () => removeActivity(act), act)));
  if (!leg.activities.length) el.innerHTML = '<div class="empty-note" style="margin:0 16px">Nothing saved yet — search above.</div>';
}

// onRemove is only passed for saved ideas — a live Places result isn't ours to
// delete, it's just something the internet knows about.
// `extra` carries a saved idea's note and source; a note is the entire reason a
// curated suggestion beats a bare name, so it can't stay invisible in the data.
function buildResultCard(name, sub, onAdd, onRemove, extra) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.innerHTML = '<div class="result-info"><div class="result-name"></div><div class="result-sub"></div><div class="result-note"></div></div><div class="result-actions"><button class="result-add-btn">Add</button></div>';
  card.querySelector('.result-name').textContent = name;

  const subEl = card.querySelector('.result-sub');
  subEl.textContent = sub || '';
  if (extra && extra.source === 'claude_curated') {
    const tag = document.createElement('span');
    tag.className = 'source-tag';
    tag.textContent = 'suggested';
    subEl.appendChild(tag);
  }

  const noteEl = card.querySelector('.result-note');
  if (extra && extra.notes) noteEl.textContent = extra.notes; else noteEl.remove();

  card.querySelector('.result-add-btn').addEventListener('click', onAdd);
  if (onRemove) card.querySelector('.result-actions').appendChild(makeRemoveButton('✕', onRemove));
  return card;
}

async function runPlaceSearch(query) {
  if (!query) { renderLibraryAsSearchResults(); return; }
  const el = document.getElementById('searchResults');
  setSearchLabel('Search results');
  el.innerHTML = '<div class="empty-note" style="margin:0 16px">Searching…</div>';
  try {
    const leg = currentLeg();
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: { circle: { center: { latitude: leg.home_base_lat, longitude: leg.home_base_lng }, radius: CONFIG.searchRadiusMeters || 9000 } },
      }),
      referrerPolicy: GOOGLE_REFERRER_POLICY,
    });
    const json = await res.json();
    // Don't let an API failure masquerade as "No results" — that's exactly how
    // the referrer 403 stayed invisible until someone read the network tab.
    if (json.error) {
      el.innerHTML = '<div class="empty-note" style="margin:0 16px"></div>';
      el.firstChild.textContent = `Search unavailable (${json.error.status || res.status}). ${json.error.message || ''}`;
      return;
    }
    el.innerHTML = '';
    (json.places || []).slice(0, CONFIG.maxCandidates || 6).forEach((place) => {
      el.appendChild(buildResultCard(place.displayName?.text || query, place.formattedAddress || '', () => addSearchedPlaceToDay(place)));
    });
    if (!json.places || !json.places.length) el.innerHTML = '<div class="empty-note" style="margin:0 16px">No results.</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty-note" style="margin:0 16px">Search failed — check connection.</div>';
  }
}

async function addSearchedPlaceToDay(place) {
  const leg = currentLeg();
  const day = currentDay();
  const category = guessCategory(place.types);
  const { data: activityId, error } = await SB.rpc('trip_planner_add_activity', {
    p_leg_slug: leg.slug,
    p_name: place.displayName?.text || 'Untitled',
    p_category: category,
    p_address: place.formattedAddress || null,
    p_lat: place.location?.latitude ?? null,
    p_lng: place.location?.longitude ?? null,
    p_source: 'user_added',
  });
  if (error) { App.toast('Could not save: ' + error.message); return; }

  const newActivity = {
    id: activityId, name: place.displayName?.text || 'Untitled', category,
    address: place.formattedAddress || null, lat: place.location?.latitude ?? null, lng: place.location?.longitude ?? null,
    source: 'user_added', notes: null,
  };
  leg.activities.push(newActivity);
  await addActivityToDay(newActivity, day, leg);
}

async function addExistingActivityToDay(activity) {
  await addActivityToDay(activity, currentDay(), currentLeg());
}

async function addActivityToDay(activity, day, leg, options = {}) {
  const { data: stopId, error } = await SB.rpc('trip_planner_add_stop', {
    p_leg_slug: leg.slug, p_the_date: day.the_date, p_activity_id: activity.id,
  });
  if (error) { App.toast('Could not add stop: ' + error.message); return false; }

  day.stops.push({
    id: stopId, activity_id: activity.id, sort_order: day.stops.length, planned_time: null, status: 'planned',
    name: activity.name, category: activity.category, address: activity.address, lat: activity.lat, lng: activity.lng, notes: activity.notes,
  });
  App.toast(`Added ${activity.name} to ${formatDayLabel(day.the_date)}.`);
  if (options.navigate !== false) {
    App.show('day');
    renderStops(day);
    renderMap(day);
  }
  return true;
}

function guessCategory(types) {
  const t = (types || []).join(' ');
  if (/restaurant|cafe|bakery|bar|food/.test(t)) return 'food';
  if (/park|hike|trail|beach|natural/.test(t)) return 'outdoor';
  if (/museum|tourist_attraction|amusement|zoo|aquarium/.test(t)) return 'attraction';
  if (/store|mall|shop/.test(t)) return 'shopping';
  if (/spa|lodging/.test(t)) return 'rest';
  return 'other';
}

/* ============================================================
   Vancouver family guide - researched picks that schedule into the live trip
   ============================================================ */
const GUIDE_FILTER_LABELS = {
  all: 'all activities',
  top: 'best bets',
  rain: 'rain-proof activities',
  free: 'free or low-cost activities',
  outdoor: 'outdoor activities',
};

function getVancouverLeg() {
  if (!State.trip) return null;
  return State.trip.legs.find((leg) => /vancouver/i.test(`${leg.slug} ${leg.name}`)) || null;
}

function normalizeGuideName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function guideActivityNames(item) {
  return [item.name, ...(item.aliases || [])].map(normalizeGuideName);
}

function findSavedGuideActivity(leg, item) {
  const names = guideActivityNames(item);
  return leg.activities.find((activity) => names.includes(normalizeGuideName(activity.name))) || null;
}

function isGuideItemPlanned(day, leg, item) {
  const saved = findSavedGuideActivity(leg, item);
  const names = guideActivityNames(item);
  return day.stops.some((stop) => (saved && stop.activity_id === saved.id) || names.includes(normalizeGuideName(stop.name)));
}

function formatExploreDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function selectedExploreDay(leg) {
  return leg.days.find((day) => String(day.id) === String(State.exploreDayId)) || leg.days[0] || null;
}

function renderExplore() {
  const list = document.getElementById('guideList');
  const summary = document.getElementById('guideSummary');
  const picker = document.getElementById('exploreDay');
  const leg = getVancouverLeg();
  const guide = window.VANCOUVER_GUIDE || [];

  if (!leg || !leg.days.length) {
    picker.innerHTML = '';
    summary.textContent = '';
    list.innerHTML = '<div class="empty-note">No Vancouver days are loaded for this trip.</div>';
    return;
  }

  if (!leg.days.some((day) => String(day.id) === String(State.exploreDayId))) {
    const current = State.currentLegSlug === leg.slug ? currentDay() : null;
    State.exploreDayId = (current || leg.days[0]).id;
  }

  picker.innerHTML = '';
  leg.days.forEach((day) => {
    const option = document.createElement('option');
    option.value = day.id;
    option.textContent = formatExploreDay(day.the_date);
    option.selected = String(day.id) === String(State.exploreDayId);
    picker.appendChild(option);
  });

  document.querySelectorAll('[data-guide-filter]').forEach((button) => {
    const active = button.dataset.guideFilter === State.exploreFilter;
    button.classList.toggle('guide-filter--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const day = selectedExploreDay(leg);
  const visible = guide.filter((item) => State.exploreFilter === 'all' || (item.filters || []).includes(State.exploreFilter));
  const plannedCount = guide.filter((item) => isGuideItemPlanned(day, leg, item)).length;
  summary.textContent = `Showing ${visible.length} ${GUIDE_FILTER_LABELS[State.exploreFilter]} \u2022 ${plannedCount} planned for ${formatExploreDay(day.the_date)}`;

  list.innerHTML = '';
  visible.forEach((item) => list.appendChild(buildGuideCard(item, day, leg)));
}

function buildGuideCard(item, day, leg) {
  const planned = isGuideItemPlanned(day, leg, item);
  const card = document.createElement('article');
  card.className = 'guide-card';
  card.innerHTML = `
    <div class="guide-card-head">
      <div class="guide-card-icon" aria-hidden="true"></div>
      <div class="guide-card-title-wrap">
        <div class="guide-card-title"></div>
        <div class="guide-card-area"></div>
      </div>
      <div class="guide-card-rank"></div>
    </div>
    <div class="guide-card-meta"></div>
    <div class="guide-card-why"></div>
    <div class="guide-card-current"></div>
    <div class="guide-card-tip"></div>
    <div class="guide-card-pair"></div>
    <div class="guide-card-actions">
      <a class="guide-source" target="_blank" rel="noopener noreferrer">Official details</a>
      <button class="guide-add-btn"></button>
    </div>`;

  card.querySelector('.guide-card-icon').textContent = item.icon;
  card.querySelector('.guide-card-title').textContent = item.name;
  card.querySelector('.guide-card-area').textContent = item.area;
  const rank = card.querySelector('.guide-card-rank');
  if ((item.filters || []).includes('top')) rank.textContent = 'Best bet'; else rank.remove();

  const meta = card.querySelector('.guide-card-meta');
  const weatherLabels = { indoors: 'Rain-proof', mixed: 'Mixed weather', dry: 'Best dry', sunny: 'Sunny day' };
  [item.duration, item.cost, weatherLabels[item.weather] || item.weather].forEach((text) => {
    const chip = document.createElement('span');
    chip.textContent = text;
    meta.appendChild(chip);
  });

  card.querySelector('.guide-card-why').textContent = item.why;
  const current = card.querySelector('.guide-card-current');
  if (item.current) current.textContent = item.current; else current.remove();
  card.querySelector('.guide-card-tip').textContent = `Plan it: ${item.booking}`;
  card.querySelector('.guide-card-pair').textContent = `Pairs well: ${item.pair}`;

  const source = card.querySelector('.guide-source');
  source.href = item.sourceUrl;
  source.setAttribute('aria-label', `${item.sourceLabel} for ${item.name} (opens in a new tab)`);

  const addButton = card.querySelector('.guide-add-btn');
  addButton.textContent = planned ? 'Planned' : `Add to ${formatDayLabel(day.the_date)}`;
  addButton.disabled = planned;
  addButton.classList.toggle('guide-add-btn--planned', planned);
  if (!planned) addButton.addEventListener('click', () => addGuideActivityToDay(item, day, leg, addButton));
  return card;
}

async function findGuidePlace(item, leg) {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({
        textQuery: item.placeQuery,
        locationBias: { circle: { center: { latitude: leg.home_base_lat, longitude: leg.home_base_lng }, radius: 50000 } },
      }),
      referrerPolicy: GOOGLE_REFERRER_POLICY,
    });
    const json = await res.json();
    if (!res.ok || json.error) return null;
    return (json.places || [])[0] || null;
  } catch (error) {
    return null;
  }
}

async function addGuideActivityToDay(item, day, leg, button) {
  if (isGuideItemPlanned(day, leg, item)) { App.toast('That activity is already on this day.'); return; }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Adding...';

  let activity = findSavedGuideActivity(leg, item);
  if (!activity) {
    const place = await findGuidePlace(item, leg);
    const notes = `${item.why} Plan: ${item.booking} Pairs well: ${item.pair}`;
    const { data: activityId, error } = await SB.rpc('trip_planner_add_activity', {
      p_leg_slug: leg.slug,
      p_name: item.name,
      p_category: item.category,
      p_address: place?.formattedAddress || null,
      p_lat: place?.location?.latitude ?? null,
      p_lng: place?.location?.longitude ?? null,
      p_notes: notes,
      p_source: 'claude_curated',
    });
    if (error) {
      button.disabled = false;
      button.textContent = originalLabel;
      App.toast('Could not save: ' + error.message);
      return;
    }
    activity = {
      id: activityId, name: item.name, category: item.category,
      address: place?.formattedAddress || null,
      lat: place?.location?.latitude ?? null,
      lng: place?.location?.longitude ?? null,
      source: 'claude_curated', notes,
    };
    leg.activities.push(activity);
  }

  const added = await addActivityToDay(activity, day, leg, { navigate: false });
  if (added) renderExplore();
  else {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.getElementById('exploreDay').addEventListener('change', (event) => {
  State.exploreDayId = event.target.value;
  renderExplore();
});

document.getElementById('guideFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-guide-filter]');
  if (!button) return;
  State.exploreFilter = button.dataset.guideFilter;
  renderExplore();
});
/* ============================================================
   Idea library + amenities views
   ============================================================ */
function renderLibrary() {
  const leg = currentLeg();
  document.getElementById('libraryLegName').textContent = leg.name;
  const el = document.getElementById('libraryList');
  el.innerHTML = '';
  if (!leg.activities.length) { el.innerHTML = '<div class="empty-note">No ideas saved yet.</div>'; return; }
  leg.activities.forEach((act) => el.appendChild(buildResultCard(act.name, act.category, () => addExistingActivityToDay(act), () => removeActivity(act), act)));
}

function renderAmenities() {
  const leg = currentLeg();
  document.getElementById('amenitiesLegName').textContent = leg.name;
  const el = document.getElementById('amenitiesList');
  el.innerHTML = '';
  if (!leg.amenities.length) { el.innerHTML = '<div class="empty-note">Nothing recorded yet.</div>'; return; }
  leg.amenities.forEach((am) => {
    const row = document.createElement('div');
    row.className = 'amenity-row' + (am.category === 'gap' ? ' amenity-row--gap' : '');
    row.innerHTML = '<div><div class="amenity-label"></div><div class="amenity-notes"></div></div>';
    row.querySelector('.amenity-label').textContent = am.label;
    row.querySelector('.amenity-notes').textContent = am.notes || '';
    el.appendChild(row);
  });
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.nav;
    if (view === 'explore') renderExplore();
    if (view === 'library') renderLibrary();
    if (view === 'amenities') renderAmenities();
    App.show(view);
  });
});

/* ---------- boot ---------- */
initAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
