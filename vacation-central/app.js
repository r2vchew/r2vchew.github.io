/* ============================================================
   Vacation Central — app logic (plain JS, no framework)

   Data flow: one Supabase RPC (trip_planner_document) returns the whole
   trip as JSON on load; everything renders from that in-memory copy.
   Writes call a narrow RPC, then patch the in-memory copy directly rather
   than re-fetching the whole document — keeps the UI snappy on a phone
   connection.

   2026-08-13 redesign: the Day tab is no longer leg-scoped. There is one
   chronological date strip across the whole trip; a date can in principle
   belong to more than one leg's days table (a checkout/check-in day would
   render both, stacked) though in practice the trip is Vancouver-only now.
   Explore and Food render from a static per-leg catalogue file, with a
   shared "discovery card" renderer (icon row: official link / schedule /
   flag / dismiss, all on the same row as the duration-cost-weather chips).
   A Flagged tab replaced Ideas in the bottom nav — Explore/Food items that
   get scheduled OR flagged both leave their catalogue list; flagging is the
   lighter action, meant to be sorted into days later by asking in a normal
   chat, not to a specific date. Flagged cards reuse the same discovery-card
   renderer (via a matched catalogue item lookup) so the full detail carries
   over instead of collapsing to a name-and-notes summary.

   2026-08-17: Harrison Hot Springs leg wrapped (checked out today), so the
   app dropped everything Harrison-facing — its guide catalogue, the
   Explore/Food leg toggle, and the Amenities leg switcher. The trip's past
   Harrison days/stops are untouched in the database and still show in the
   Day tab's history; only the forward-facing browsing surfaces were turfed.
   ============================================================ */
'use strict';

const SB = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
const WEATHER_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours — see docs/DESIGN_BRIEF.md
const UNDO_WINDOW_MS = 6000;
const DISMISSED_STORAGE_KEY = 'vc_dismissed_v1';

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
  currentDate: null,        // 'YYYY-MM-DD' — drives the Day tab
  daysMode: 'detail',       // detail = one date; plan = whole-trip macro view
  exploreLegSlug: null,
  exploreFilter: 'all',
  foodLegSlug: null,
  foodCuisine: 'All',
  map: null,
  mapMarkers: [],
  mapPolylines: [],
  flaggedMap: null,
  flaggedMapMarkers: [],
  proximityCache: new Map(),
  locationCache: new Map(),
  homeBasesHydrated: false,
  dismissed: new Set(),     // localStorage-backed, see loadDismissed()
  addTarget: null,          // { leg, day } — set right before opening the search view
};

/* ---------- view routing + toast (with optional inline Undo) ---------- */
const App = {
  show(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('view--active', v.dataset.view === view));
    document.querySelectorAll('.nav-btn').forEach((n) => n.classList.toggle('nav-btn--active', n.dataset.nav === view));
  },
  toast(msg, undoFn) {
    const t = document.getElementById('toast');
    const undoBtn = document.getElementById('toastUndo');
    document.getElementById('toastMsg').textContent = msg;
    t.classList.add('toast--show');
    clearTimeout(App._toastTimer);
    if (undoFn) {
      undoBtn.style.display = 'block';
      undoBtn.onclick = () => { clearTimeout(App._toastTimer); t.classList.remove('toast--show'); undoFn(); };
      App._toastTimer = setTimeout(() => { t.classList.remove('toast--show'); undoBtn.onclick = null; }, UNDO_WINDOW_MS);
    } else {
      undoBtn.style.display = 'none';
      undoBtn.onclick = null;
      App._toastTimer = setTimeout(() => t.classList.remove('toast--show'), 2600);
    }
  },
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Re-renders whichever tab is currently on screen. Used after a mutation
   (remove, flag, schedule) that could have happened from more than one tab,
   so the caller doesn't have to know who else might be showing the same
   data right now. */
function refreshActiveView() {
  const active = document.querySelector('.view--active');
  const view = active && active.dataset.view;
  if (view === 'day') renderDayTab();
  else if (view === 'explore') renderExplore();
  else if (view === 'food') renderFood();
  else if (view === 'flagged') renderFlagged();
  else if (view === 'amenities') renderAmenities();
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
function loadDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    State.dismissed = new Set(raw ? JSON.parse(raw) : []);
  } catch (e) { State.dismissed = new Set(); }
}
function saveDismissed() {
  try { localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...State.dismissed])); } catch (e) { /* ignore */ }
}
function dismissKey(kind, legSlug, itemId) { return `${kind}:${legSlug}:${itemId}`; }

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
  loadDismissed();

  // The seeded coordinates were intentionally city-level approximations.
  // Resolve the private accommodation addresses only after authentication and
  // keep the accurate coordinates in memory for maps and travel times.
  hydrateAccurateHomeBases();

  const { data: wx } = await SB.rpc('trip_planner_weather_history');
  State.weatherHistory = wx || {};

  if (!State.exploreLegSlug) State.exploreLegSlug = 'vancouver';
  if (!State.foodLegSlug) State.foodLegSlug = 'vancouver';
  if (!State.currentDate) {
    const days = getAllTripDays();
    const todayStr = new Date().toISOString().slice(0, 10);
    const match = days.find((d) => d.dateStr === todayStr);
    State.currentDate = (match || days[0])?.dateStr || null;
  }

  App.show('day');
  renderDateStrip();
  renderDayTab();
  loadGoogleMaps();
}

function findLegBySlug(slug) {
  return State.trip.legs.find((l) => l.slug === slug) || null;
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}
function formatShortWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
function formatFullDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ============================================================
   The whole-trip date model. Most calendar dates map to exactly one
   {leg, day} pair; Aug 17 maps to two (one per leg's own days table row).
   Everything downstream — the date strip, the Day tab's sections, weather,
   the map — is built from this rather than a "current leg" concept.
   ============================================================ */
function getAllTripDays() {
  if (!State.trip) return [];
  const byDate = new Map();
  State.trip.legs.forEach((leg) => {
    leg.days.forEach((day) => {
      if (!byDate.has(day.the_date)) byDate.set(day.the_date, []);
      byDate.get(day.the_date).push({ leg, day });
    });
  });
  return [...byDate.entries()]
    .map(([dateStr, entries]) => ({ dateStr, entries }))
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

function entriesForDate(dateStr) {
  const found = getAllTripDays().find((d) => d.dateStr === dateStr);
  return found ? found.entries : [];
}

async function hydrateAccurateHomeBases() {
  try {
    await Promise.all(State.trip.legs.map(async (leg) => {
      if (!leg.home_base_address) return;
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.location',
        },
        body: JSON.stringify({
          textQuery: leg.home_base_address,
          locationBias: leg.home_base_lat && leg.home_base_lng ? {
            circle: { center: { latitude: leg.home_base_lat, longitude: leg.home_base_lng }, radius: 50000 },
          } : undefined,
        }),
        referrerPolicy: GOOGLE_REFERRER_POLICY,
      });
      const json = await res.json();
      const location = json.places && json.places[0] && json.places[0].location;
      if (res.ok && location) {
        leg.home_base_lat = location.latitude;
        leg.home_base_lng = location.longitude;
      }
    }));
  } catch (e) {
    // The existing coordinates remain a safe fallback if Places is offline.
  } finally {
    State.homeBasesHydrated = true;
    State.proximityCache.clear();
    refreshActiveView();
  }
}

/* ============================================================
   Day tab
   ============================================================ */
function renderDateStrip() {
  const el = document.getElementById('dateStrip');
  el.innerHTML = '';
  getAllTripDays().forEach(({ dateStr, entries }) => {
    const pill = document.createElement('button');
    pill.className = 'day-pill' + (dateStr === State.currentDate ? ' day-pill--active' : '') + (entries.length > 1 ? ' day-pill--dual' : '');
    pill.textContent = formatShortWeekday(dateStr);
    pill.setAttribute('aria-pressed', dateStr === State.currentDate ? 'true' : 'false');
    pill.addEventListener('click', () => { State.currentDate = dateStr; renderDateStrip(); renderDayTab(); });
    el.appendChild(pill);
  });
}

function renderDayTab() {
  updateDaysModeUI();
  if (State.daysMode === 'plan') { renderPlanOverview(); return; }

  const entries = entriesForDate(State.currentDate);
  const sections = document.getElementById('daySections');
  sections.innerHTML = '';
  document.querySelectorAll('.fab').forEach((f) => f.remove());

  if (!entries.length) {
    document.getElementById('dayLegName').textContent = '—';
    document.getElementById('dayHomeBase').textContent = '—';
    sections.innerHTML = '<div class="empty-note">No day loaded for this date.</div>';
    return;
  }

  const dual = entries.length > 1;
  if (dual) {
    document.getElementById('dayLegName').textContent = formatFullDay(State.currentDate);
    document.getElementById('dayHomeBase').textContent = entries.map((e) => e.leg.home_base_label).join(' → ');
  } else {
    document.getElementById('dayLegName').textContent = entries[0].leg.name;
    document.getElementById('dayHomeBase').textContent = entries[0].leg.home_base_label;
  }

  entries.forEach(({ leg, day }) => {
    const section = buildDaySection(leg, day, dual);
    sections.appendChild(section);
  });

  // Single-leg days get the floating FAB; dual days use each section's own
  // "+" instead, since one FAB can't say which leg it's adding to.
  if (!dual) {
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.setAttribute('aria-label', 'Add a stop');
    fab.textContent = '+';
    fab.addEventListener('click', () => openSearchFor(entries[0].leg, entries[0].day));
    document.querySelector('[data-view="day"] .screen').appendChild(fab);
  }

  renderCombinedMap(entries);
  entries.forEach(({ leg, day }) => maybeFetchWeather(leg, day));
}

function updateDaysModeUI() {
  const detail = State.daysMode === 'detail';
  document.getElementById('dateStrip').hidden = !detail;
  document.getElementById('dayBody').hidden = !detail;
  document.getElementById('planOverview').hidden = detail;
  document.querySelectorAll('[data-days-mode]').forEach((button) => {
    const active = button.dataset.daysMode === State.daysMode;
    button.classList.toggle('view-toggle-btn--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderPlanOverview() {
  document.querySelectorAll('.fab').forEach((f) => f.remove());
  const overview = document.getElementById('planOverview');
  overview.innerHTML = '';
  const days = getAllTripDays();
  const totalStops = days.reduce((sum, item) => sum + item.entries.reduce((n, entry) => n + entry.day.stops.length, 0), 0);
  document.getElementById('dayLegName').textContent = 'Trip plan';
  document.getElementById('dayHomeBase').textContent = `${totalStops} planned ${totalStops === 1 ? 'stop' : 'stops'} across ${days.length} dates`;

  days.forEach(({ dateStr, entries }) => {
    const dayStops = entries.reduce((sum, entry) => sum + entry.day.stops.length, 0);
    const card = document.createElement('section');
    card.className = 'plan-day';
    const head = document.createElement('div');
    head.className = 'plan-day-head';
    head.innerHTML = `<div><div class="plan-day-date">${escapeHtml(formatFullDay(dateStr))}</div><div class="plan-day-count">${dayStops} ${dayStops === 1 ? 'stop' : 'stops'}</div></div>`;
    const open = document.createElement('button');
    open.className = 'plan-day-open';
    open.textContent = 'Open day';
    open.addEventListener('click', () => {
      State.currentDate = dateStr;
      State.daysMode = 'detail';
      renderDateStrip();
      renderDayTab();
    });
    head.appendChild(open);
    card.appendChild(head);

    entries.forEach(({ leg, day }) => {
      const legWrap = document.createElement('div');
      legWrap.className = 'plan-leg';
      if (entries.length > 1) {
        const name = document.createElement('div');
        name.className = 'plan-leg-name';
        name.textContent = leg.name;
        legWrap.appendChild(name);
      }
      const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
      if (!sorted.length) {
        const empty = document.createElement('div');
        empty.className = 'plan-empty';
        empty.textContent = 'Nothing planned yet';
        legWrap.appendChild(empty);
      } else {
        sorted.forEach((stop, index) => {
          const row = document.createElement('div');
          row.className = 'plan-stop' + (stop.status === 'done' ? ' plan-stop--done' : '');
          row.innerHTML = `<span class="plan-stop-num">${index + 1}</span><span>${escapeHtml(stop.name)}</span>`;
          legWrap.appendChild(row);
        });
      }
      card.appendChild(legWrap);
    });
    overview.appendChild(card);
  });
}

document.getElementById('daysViewToggle').addEventListener('click', (event) => {
  const button = event.target.closest('[data-days-mode]');
  if (!button || button.dataset.daysMode === State.daysMode) return;
  State.daysMode = button.dataset.daysMode;
  if (State.daysMode === 'detail') renderDateStrip();
  renderDayTab();
});

function buildDaySection(leg, day, dual) {
  const section = document.createElement('div');
  section.className = 'day-section' + (dual ? ' day-section--dual' : '');
  if (dual) section.style.setProperty('--leg-color', LEG_LINE_COLORS[leg.slug] || 'var(--accent)');

  const head = document.createElement('div');
  head.className = 'day-section-head';
  head.innerHTML = dual
    ? `<div class="day-section-title">${escapeHtml(leg.name)}<small>${escapeHtml(leg.home_base_label)}</small></div>`
    : '<div></div>';
  const actions = document.createElement('div');
  actions.className = 'day-section-actions';
  const routable = day.stops.filter((s) => s.lat && s.lng).length;
  if (routable >= 2) {
    const optBtn = document.createElement('button');
    optBtn.className = 'day-section-btn';
    optBtn.textContent = 'Optimize';
    optBtn.addEventListener('click', () => optimizeSection(leg, day, optBtn));
    actions.appendChild(optBtn);
  }
  if (dual) {
    const addBtn = document.createElement('button');
    addBtn.className = 'day-section-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => openSearchFor(leg, day));
    actions.appendChild(addBtn);
  }
  head.appendChild(actions);
  section.appendChild(head);

  const weatherWrap = document.createElement('div');
  weatherWrap.id = `weatherWrap-${day.id}`;
  section.appendChild(weatherWrap);

  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = dual ? 'Stops' : "Today's stops";
  section.appendChild(label);

  const stopList = document.createElement('div');
  stopList.id = `stopList-${day.id}`;
  section.appendChild(stopList);
  renderStopsInto(stopList, leg, day);

  return section;
}

/* The Day tab keeps stop cards condensed (name + category, no chips) on
   purpose — but for anything that came from the Explore/Food catalogue,
   the duration/cost/tip that got collapsed into .notes at save time is
   still one tap away instead of gone. User-added stops have no catalogue
   match, so they just don't get a "Show more" button. */
function buildStopMoreButton(card, stop) {
  const match = findCatalogueItemForActivity(stop);
  if (!match) return;
  const { kind, item } = match;
  const weatherLabels = { indoors: 'Rain-proof', mixed: 'Mixed weather', dry: 'Best dry', sunny: 'Sunny day' };
  const chips = (kind === 'food' ? item.cuisines.concat([item.price]) : [item.duration, item.cost, weatherLabels[item.weather] || item.weather]).filter(Boolean);
  const tip = item.booking || (kind === 'food' ? item.headsUp : null) || null;
  if (!chips.length && !tip) return;

  const extra = card.querySelector('.stop-extra');
  if (chips.length) {
    const chipsRow = document.createElement('div');
    chipsRow.className = 'stop-extra-chips';
    chips.forEach((text) => { const c = document.createElement('span'); c.textContent = text; chipsRow.appendChild(c); });
    extra.appendChild(chipsRow);
  }
  if (tip) {
    const tipEl = document.createElement('div');
    tipEl.className = 'stop-extra-tip';
    tipEl.textContent = tip;
    extra.appendChild(tipEl);
  }

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'stop-more-btn';
  moreBtn.textContent = 'Show more';
  moreBtn.setAttribute('aria-label', `Show more details for ${stop.name}`);
  moreBtn.addEventListener('click', () => {
    const open = extra.style.display !== 'none';
    extra.style.display = open ? 'none' : 'block';
    moreBtn.textContent = open ? 'Show more' : 'Show less';
  });
  card.querySelector('.stop-meta').insertAdjacentElement('afterend', moreBtn);
}

function renderStopsInto(el, leg, day) {
  el.innerHTML = '';
  if (!day.stops.length) {
    el.innerHTML = '<div class="empty-note">No stops yet — Explore, Food or the + button.</div>';
    return;
  }
  const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  const otherDays = leg.days.filter((d) => d.id !== day.id);
  sorted.forEach((stop, i) => {
    const card = document.createElement('div');
    card.className = 'stop-card';
    card.innerHTML = `
      <div class="stop-card-row">
        <div class="stop-order">${i + 1}</div>
        <div class="stop-info">
          <div class="stop-name${stop.status === 'done' ? ' stop-name--done' : ''}"></div>
          <div class="stop-meta"></div>
        </div>
        <div class="stop-reorder">
          <button class="stop-reorder-btn" data-dir="up">▲</button>
          <button class="stop-reorder-btn" data-dir="down">▼</button>
        </div>
        <button class="stop-move-btn" aria-label="Move to another day">⇄</button>
        <button class="stop-status-btn${stop.status === 'done' ? ' stop-status-btn--done' : ''}${stop.status === 'skipped' ? ' stop-status-btn--skipped' : ''}"></button>
      </div>
      <div class="stop-day-picker" style="display:none"></div>
      <div class="stop-extra" style="display:none"></div>
    `;
    card.querySelector('.stop-name').textContent = stop.name;
    card.querySelector('.stop-meta').textContent = stop.category + (stop.planned_time ? ' · ' + stop.planned_time : '');
    buildStopMoreButton(card, stop);
    const statusBtn = card.querySelector('.stop-status-btn');
    statusBtn.textContent = stop.status === 'done' ? '✓' : stop.status === 'skipped' ? '×' : '○';
    statusBtn.addEventListener('click', () => cycleStopStatus(leg, day, stop));

    const upBtn = card.querySelector('[data-dir="up"]');
    const downBtn = card.querySelector('[data-dir="down"]');
    upBtn.disabled = i === 0;
    downBtn.disabled = i === sorted.length - 1;
    upBtn.addEventListener('click', () => moveStop(leg, day, stop.id, -1));
    downBtn.addEventListener('click', () => moveStop(leg, day, stop.id, 1));

    const moveBtn = card.querySelector('.stop-move-btn');
    const picker = card.querySelector('.stop-day-picker');
    if (!otherDays.length) {
      moveBtn.disabled = true;
    } else {
      moveBtn.addEventListener('click', () => {
        const open = picker.style.display !== 'none';
        picker.style.display = open ? 'none' : 'flex';
      });
      otherDays.forEach((targetDay) => {
        const dayBtn = document.createElement('button');
        dayBtn.textContent = formatDayLabel(targetDay.the_date);
        dayBtn.addEventListener('click', () => {
          picker.style.display = 'none';
          moveStopToDay(leg, day, stop, targetDay);
        });
        picker.appendChild(dayBtn);
      });
    }

    card.querySelector('.stop-card-row').appendChild(makeRemoveButton('✕', () => removeStop(leg, day, stop)));

    el.appendChild(card);
  });
}

/* Removing is destructive and there's no undo on the two-tap version — this
   gets used one-handed on a sidewalk, so it's two taps, not a modal: the
   button arms itself, says "Sure?", and disarms on its own if you don't
   follow through. */
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

async function removeStop(leg, day, stop) {
  const { error } = await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stop.id });
  if (error) { App.toast('Could not remove: ' + error.message); return; }
  day.stops = day.stops.filter((s) => s.id !== stop.id);
  resequence(day.stops);
  App.toast(`Removed ${stop.name} from this day.`);
  renderStopsInto(document.getElementById(`stopList-${day.id}`), leg, day);
  renderCombinedMap(entriesForDate(State.currentDate));
}

async function removeActivity(activity) {
  const { error } = await SB.rpc('trip_planner_remove_activity', { p_activity_id: activity.id });
  if (error) { App.toast('Could not remove: ' + error.message); return; }
  State.trip.legs.forEach((leg) => {
    leg.activities = leg.activities.filter((a) => a.id !== activity.id);
    leg.days.forEach((d) => {
      const before = d.stops.length;
      d.stops = d.stops.filter((s) => s.activity_id !== activity.id);
      if (d.stops.length !== before) resequence(d.stops);
    });
  });
  App.toast(`Removed ${activity.name}.`);
  refreshActiveView();
}

async function cycleStopStatus(leg, day, stop) {
  const next = stop.status === 'planned' ? 'done' : stop.status === 'done' ? 'skipped' : 'planned';
  const { error } = await SB.rpc('trip_planner_update_stop_status', { p_day_stop_id: stop.id, p_status: next });
  if (error) { App.toast('Could not update: ' + error.message); return; }
  stop.status = next;
  renderStopsInto(document.getElementById(`stopList-${day.id}`), leg, day);
}

function moveStop(leg, day, stopId, direction) {
  const sorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  const idx = sorted.findIndex((s) => s.id === stopId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
  [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
  persistReorder(leg, day, sorted.map((s) => s.id));
}

async function persistReorder(leg, day, orderedStopIds) {
  const { error } = await SB.rpc('trip_planner_reorder_stops', { p_day_id: day.id, p_stop_ids: orderedStopIds });
  if (error) { App.toast('Could not reorder: ' + error.message); return; }
  orderedStopIds.forEach((id, i) => { const s = day.stops.find((x) => x.id === id); if (s) s.sort_order = i; });
  renderStopsInto(document.getElementById(`stopList-${day.id}`), leg, day);
  renderCombinedMap(entriesForDate(State.currentDate));
}

/* There's no dedicated "move" RPC — a day_stop belongs to one day_id, so
   moving is remove-from-here + re-add-there against the same activity_id,
   same as how Explore/Food already reuse an existing activity. Status and
   planned_time don't carry over (add_stop doesn't take them): a moved stop
   lands back at "planned" on its new day, which matches the redesign's
   overall stance that a plan is intentions, not a log of what happened. */
async function moveStopToDay(leg, day, stop, targetDay) {
  const { error: removeError } = await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stop.id });
  if (removeError) { App.toast('Could not move: ' + removeError.message); return; }
  day.stops = day.stops.filter((s) => s.id !== stop.id);
  resequence(day.stops);

  const { data: newStopId, error: addError } = await SB.rpc('trip_planner_add_stop', {
    p_leg_slug: leg.slug, p_the_date: targetDay.the_date, p_activity_id: stop.activity_id,
  });
  if (addError) {
    App.toast(`Removed from ${formatDayLabel(day.the_date)} but could not add to ${formatDayLabel(targetDay.the_date)}: ` + addError.message);
    refreshActiveView();
    return;
  }
  const movedStop = {
    id: newStopId, activity_id: stop.activity_id, sort_order: targetDay.stops.length, planned_time: null, status: 'planned',
    name: stop.name, category: stop.category, address: stop.address, lat: stop.lat, lng: stop.lng, notes: stop.notes,
  };
  targetDay.stops.push(movedStop);
  // Not renderStopsInto(getElementById(...)) directly: the day the stop
  // landed on (or, on Undo, the day it came from) is often not the one
  // currently on screen, so its stopList element may not exist in the DOM
  // at all. refreshActiveView() re-derives from State.currentDate instead,
  // same as every other mutation that can be triggered from more than one
  // place (see its own comment above).
  refreshActiveView();

  App.toast(`Moved ${stop.name} to ${formatDayLabel(targetDay.the_date)}.`, () => moveStopToDay(leg, targetDay, movedStop, day));
}

/* ============================================================
   Weather — Open-Meteo, throttled against logged history.

   2026-08-13: simplified to flag only MATERIAL changes — the kind that
   would actually change plans or wardrobe (crossing into/out of rain, or a
   big temperature swing), not every 1-2 degree wobble between fetches. A
   material change also fires a push notification (ntfy), because the whole
   point is knowing right away, not only when someone happens to open the
   day. See config.js for the one-time ntfy setup this needs on your phone.
   ============================================================ */
const WET_CONDITIONS = new Set(['drizzle', 'rain', 'thunderstorm', 'snow']);
const MATERIAL_TEMP_SWING_C = 5;

function isMaterialWeatherChange(oldEntry, newEntry) {
  if (!oldEntry || !newEntry) return false;
  const wasWet = WET_CONDITIONS.has(oldEntry.condition);
  const isWet = WET_CONDITIONS.has(newEntry.condition);
  if (wasWet !== isWet) return true; // crossed the dry/wet line either direction
  const swing = Math.abs((oldEntry.temp_high_c ?? 0) - (newEntry.temp_high_c ?? 0));
  return swing >= MATERIAL_TEMP_SWING_C;
}

function renderWeatherWrap(leg, day) {
  const wrap = document.getElementById(`weatherWrap-${day.id}`);
  if (!wrap) return;
  const hist = State.weatherHistory[String(day.id)];
  wrap.innerHTML = '';
  if (!hist || !hist.newest) return;

  const n = hist.newest;
  const chip = document.createElement('div');
  chip.className = 'weather-chip';
  chip.innerHTML = `<span class="weather-chip-icon"></span><span class="weather-chip-temp"></span><span class="weather-chip-cond"></span>`;
  chip.querySelector('.weather-chip-icon').textContent = conditionEmoji(n.condition);
  chip.querySelector('.weather-chip-temp').textContent = `${Math.round(n.temp_high_c)}° / ${Math.round(n.temp_low_c)}°C`;
  chip.querySelector('.weather-chip-cond').textContent = n.condition;
  wrap.appendChild(chip);

  const o = hist.oldest;
  if (o.fetched_at !== n.fetched_at && isMaterialWeatherChange(o, n)) {
    const alertEl = document.createElement('div');
    alertEl.className = 'weather-alert';
    alertEl.textContent = `Forecast changed since planned — was ${o.condition}, ${Math.round(o.temp_high_c)}°C, now ${n.condition}, ${Math.round(n.temp_high_c)}°C. Might be worth reconsidering this day.`;
    wrap.appendChild(alertEl);
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

async function sendNtfyAlert(leg, day, oldEntry, newEntry) {
  if (!CONFIG.NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(CONFIG.NTFY_TOPIC)}`, {
      method: 'POST',
      headers: {
        'Title': `${leg.name} — ${formatDayLabel(day.the_date)} forecast changed`,
        'Tags': WET_CONDITIONS.has(newEntry.condition) ? 'cloud_with_rain' : 'thermometer',
      },
      body: `Was ${oldEntry.condition}, ${Math.round(oldEntry.temp_high_c)}°C. Now ${newEntry.condition}, ${Math.round(newEntry.temp_high_c)}°C. Might be worth reconsidering plans.`,
    });
  } catch (e) { /* best-effort — a missed push isn't worth surfacing an error for */ }
}

async function maybeFetchWeather(leg, day) {
  if (!leg.home_base_lat || !leg.home_base_lng) return;

  const key = String(day.id);
  const hist = State.weatherHistory[key];
  if (hist && hist.newest) {
    const ageMs = Date.now() - new Date(hist.newest.fetched_at).getTime();
    if (ageMs < WEATHER_THROTTLE_MS) { renderWeatherWrap(leg, day); return; } // fresh enough — this is the throttle
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
    const entry = { fetched_at: new Date().toISOString(), condition, temp_high_c: tempHigh, temp_low_c: tempLow, precip_probability_pct: precip };

    const { error } = await SB.rpc('trip_planner_log_weather_forecast', {
      p_day_id: day.id, p_condition: condition, p_temp_high_c: tempHigh, p_temp_low_c: tempLow,
      p_precip_probability_pct: precip, p_raw: json,
    });
    if (error) return;

    const previousNewest = hist && hist.newest;
    if (!State.weatherHistory[key]) State.weatherHistory[key] = { newest: entry, oldest: entry };
    else State.weatherHistory[key].newest = entry;

    if (previousNewest && isMaterialWeatherChange(previousNewest, entry)) sendNtfyAlert(leg, day, previousNewest, entry);

    renderWeatherWrap(leg, day);
  } catch (e) {
    // Offline or Open-Meteo hiccup — silently skip. Next app-open retries;
    // there's no user-facing error for a background weather refresh.
  }
}

/* ============================================================
   Map — real Google Map, not a canvas. One instance, reused across renders
   and (on a dual day) across both legs at once.
   ============================================================ */
let mapsReady = false;
window.onGoogleMapsReady = function () {
  mapsReady = true;
  if (State.trip) renderCombinedMap(entriesForDate(State.currentDate));
  if (State.trip) requestAnimationFrame(renderFlaggedMap);
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
   for a trip planner (you can see the restaurants you haven't added yet). */
const LEG_LINE_COLORS = { vancouver: '#4f8cff' };

function renderCombinedMap(entries) {
  if (!mapsReady || !entries || !entries.length) return;
  const container = document.getElementById('dayMap');
  if (!container) return; // Day tab isn't the active view

  if (!State.map) {
    let mapDiv = document.getElementById('dayMapCanvas');
    if (!mapDiv) {
      mapDiv = document.createElement('div');
      mapDiv.id = 'dayMapCanvas';
      mapDiv.style.cssText = 'position:absolute;inset:0;';
      container.appendChild(mapDiv);
    }
    State.map = new google.maps.Map(mapDiv, {
      center: { lat: entries[0].leg.home_base_lat, lng: entries[0].leg.home_base_lng },
      zoom: MAP_HOME_ZOOM,
      mapTypeControl: true,
      mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU },
      fullscreenControl: true,
      zoomControl: true,
      streetViewControl: false,
      gestureHandling: 'greedy', // one-finger drag pans — this is used one-handed
    });
  }

  State.mapMarkers.forEach((m) => m.setMap(null));
  State.mapMarkers = [];
  State.mapPolylines.forEach((p) => p.setMap(null));
  State.mapPolylines = [];

  const bounds = new google.maps.LatLngBounds();
  let anyRoutable = false;

  entries.forEach(({ leg, day }) => {
    const color = LEG_LINE_COLORS[leg.slug] || '#4f8cff';
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
      anyRoutable = true;
    });
    if (sorted.length) path.push(homePos);
    if (path.length > 1) {
      State.mapPolylines.push(new google.maps.Polyline({ path, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.85, map: State.map }));
    }
  });

  // With no located stops the bounds are a single point, and fitBounds zooms to
  // 22 — a featureless grey square. Show the neighbourhood instead. Also cap the
  // zoom for the one-stop-next-door case, which has the same problem.
  if (!anyRoutable) {
    State.map.setCenter({ lat: entries[0].leg.home_base_lat, lng: entries[0].leg.home_base_lng });
    State.map.setZoom(MAP_HOME_ZOOM);
  } else if (!bounds.isEmpty()) {
    State.map.fitBounds(bounds, 40);
    google.maps.event.addListenerOnce(State.map, 'idle', () => {
      if (State.map.getZoom() > MAP_MAX_FIT_ZOOM) State.map.setZoom(MAP_MAX_FIT_ZOOM);
    });
  }
}

async function optimizeSection(leg, day, button) {
  const allSorted = [...day.stops].sort((a, b) => a.sort_order - b.sort_order);
  const sorted = allSorted.filter((s) => s.lat && s.lng);
  const unroutable = allSorted.filter((s) => !(s.lat && s.lng));
  if (sorted.length < 2) { App.toast('Need at least 2 stops with a location to optimize.'); return; }
  const original = button.textContent;
  button.textContent = 'Optimizing…';
  button.disabled = true;
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
    await persistReorder(leg, day, newOrderStopIds);
    App.toast('Order updated.');
  } catch (e) {
    App.toast('Optimize failed — check connection.');
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

/* ============================================================
   Add a stop — search live, or pull from the leg's idea library.
   State.addTarget carries which {leg, day} this flow is currently adding
   to; set once, right before the search view opens.
   ============================================================ */
function openSearchFor(leg, day) {
  State.addTarget = { leg, day };
  const dayLabel = formatDayLabel(day.the_date);
  document.getElementById('searchDayLabel').textContent = `Adding to ${leg.name} · ${dayLabel}`;
  document.getElementById('manualAdd').textContent = `Add to ${dayLabel}`;
  document.getElementById('searchInput').value = '';
  document.getElementById('manualForm').style.display = 'none';
  document.getElementById('manualName').value = '';
  renderLibraryAsSearchResults();
  App.show('search');
}

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
  if (!State.addTarget) return;
  const category = document.getElementById('manualCategory').value;
  const { leg, day } = State.addTarget;
  const { data: activityId, error } = await SB.rpc('trip_planner_add_activity', {
    p_leg_slug: leg.slug, p_name: name, p_category: category, p_source: 'user_added',
  });
  if (error) { App.toast('Could not save: ' + error.message); return; }
  const newActivity = { id: activityId, name, category, address: null, lat: null, lng: null, source: 'user_added', notes: null, flagged: false };
  leg.activities.push(newActivity);
  await addActivityToDay(newActivity, day, leg);
});

function setSearchLabel(text) {
  document.getElementById('searchResultsLabel').textContent = text;
}

function renderLibraryAsSearchResults() {
  const { leg, day } = State.addTarget;
  const el = document.getElementById('searchResults');
  setSearchLabel('Idea library for this leg');
  el.innerHTML = '';
  leg.activities.forEach((act) => el.appendChild(buildResultCard(
    act.name,
    act.category,
    () => addExistingActivityToDay(act, day, leg),
    () => removeActivity(act),
    act,
    `Add to ${formatDayLabel(day.the_date)}`,
  )));
  if (!leg.activities.length) el.innerHTML = '<div class="empty-note" style="margin:0 16px">Nothing saved yet — search above.</div>';
}

// onRemove is only passed for saved ideas — a live Places result isn't ours to
// delete, it's just something the internet knows about.
function buildResultCard(name, sub, onAdd, onRemove, extra, addLabel = 'Add') {
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

  const addButton = card.querySelector('.result-add-btn');
  addButton.textContent = addLabel;
  addButton.setAttribute('aria-label', `${addLabel}: ${name}`);
  addButton.addEventListener('click', onAdd);
  if (onRemove) card.querySelector('.result-actions').appendChild(makeRemoveButton('✕', onRemove));
  return card;
}

async function runPlaceSearch(query) {
  if (!query) { renderLibraryAsSearchResults(); return; }
  const el = document.getElementById('searchResults');
  setSearchLabel('Search results');
  el.innerHTML = '<div class="empty-note" style="margin:0 16px">Searching…</div>';
  try {
    const { leg, day } = State.addTarget;
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
    // a referrer 403 stayed invisible until someone read the network tab.
    if (json.error) {
      el.innerHTML = '<div class="empty-note" style="margin:0 16px"></div>';
      el.firstChild.textContent = `Search unavailable (${json.error.status || res.status}). ${json.error.message || ''}`;
      return;
    }
    el.innerHTML = '';
    (json.places || []).slice(0, CONFIG.maxCandidates || 6).forEach((place) => {
      el.appendChild(buildResultCard(
        place.displayName?.text || query,
        place.formattedAddress || '',
        () => addSearchedPlaceToDay(place),
        null,
        null,
        `Add to ${formatDayLabel(day.the_date)}`,
      ));
    });
    if (!json.places || !json.places.length) el.innerHTML = '<div class="empty-note" style="margin:0 16px">No results.</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty-note" style="margin:0 16px">Search failed — check connection.</div>';
  }
}

async function addSearchedPlaceToDay(place) {
  const { leg, day } = State.addTarget;
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
    source: 'user_added', notes: null, flagged: false,
  };
  leg.activities.push(newActivity);
  await addActivityToDay(newActivity, day, leg);
}

async function addExistingActivityToDay(activity, day, leg) {
  await addActivityToDay(activity, day, leg);
}

async function addActivityToDay(activity, day, leg, options = {}) {
  const { data: stopId, error } = await SB.rpc('trip_planner_add_stop', {
    p_leg_slug: leg.slug, p_the_date: day.the_date, p_activity_id: activity.id,
  });
  if (error) { App.toast('Could not add stop: ' + error.message); return null; }

  day.stops.push({
    id: stopId, activity_id: activity.id, sort_order: day.stops.length, planned_time: null, status: 'planned',
    name: activity.name, category: activity.category, address: activity.address, lat: activity.lat, lng: activity.lng, notes: activity.notes,
  });
  if (options.silent !== true) App.toast(`Added ${activity.name} to ${leg.name} · ${formatDayLabel(day.the_date)}.`);
  if (options.navigate !== false) {
    State.currentDate = day.the_date;
    renderDateStrip();
    App.show('day');
    renderDayTab();
  }
  return stopId;
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
   Discovery cards — the shared renderer behind Explore, Food, and Flagged.
   A "catalogue item" (from vancouver-guide.js / food-catalogue.js) becomes a
   real `activities` row only once it's scheduled or flagged; find-or-create
   happens in ensureCatalogueActivity. Flagged cards re-derive their catalogue
   item from the saved activity via findCatalogueItemForActivity instead.
   ============================================================ */
function normalizeCatalogueName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findSavedCatalogueActivity(leg, item) {
  const names = [item.name].concat(item.aliases || []).map(normalizeCatalogueName);
  return leg.activities.find((activity) => names.includes(normalizeCatalogueName(activity.name))) || null;
}

/* The reverse lookup: given a saved activity (or a day_stop, which has the
   same .name), find the rich catalogue entry it came from — so Flagged cards
   and the Day tab's "show more" can show duration/cost/tips instead of just
   the flattened .notes blob ensureCatalogueActivity wrote at save time.
   Returns null for user-added stops, which never had a catalogue entry. */
function findCatalogueItemForActivity(activityLike) {
  const name = normalizeCatalogueName(activityLike.name);
  const exploreItem = (window.VANCOUVER_GUIDE || []).find((item) => [item.name].concat(item.aliases || []).map(normalizeCatalogueName).includes(name));
  if (exploreItem) return { kind: 'explore', item: exploreItem };
  const foodItem = (window.FOOD_GUIDE || []).find((item) => item.legSlug === 'vancouver' && [item.name].concat(item.aliases || []).map(normalizeCatalogueName).includes(name));
  if (foodItem) return { kind: 'food', item: foodItem };
  return null;
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

/* kind: 'explore' | 'food'. Returns the saved (or newly-created) activity, or
   null on failure. Food items already carry lat/lng in the catalogue; Explore
   items need a live Places lookup the first time. */
async function ensureCatalogueActivity(kind, item, leg) {
  const existing = findSavedCatalogueActivity(leg, item);
  if (existing) return existing;

  let address = null, lat = null, lng = null, notes = '';
  if (kind === 'food') {
    address = item.address; lat = item.lat; lng = item.lng;
    notes = item.cuisines.join(' / ') + '. ' + item.why + ' Age-six fit: ' + item.kidFit + ' Heads up: ' + item.headsUp;
  } else {
    const place = await findGuidePlace(item, leg);
    address = place?.formattedAddress || null;
    lat = place?.location?.latitude ?? null;
    lng = place?.location?.longitude ?? null;
    notes = `${item.why} Plan: ${item.booking} Pairs well: ${item.pair}`;
  }

  const { data: activityId, error } = await SB.rpc('trip_planner_add_activity', {
    p_leg_slug: leg.slug, p_name: item.name, p_category: kind === 'food' ? 'food' : item.category,
    p_address: address, p_lat: lat, p_lng: lng, p_notes: notes, p_source: 'claude_curated',
  });
  if (error) { App.toast('Could not save: ' + error.message); return null; }

  const activity = { id: activityId, name: item.name, category: kind === 'food' ? 'food' : item.category, address, lat, lng, source: 'claude_curated', notes, flagged: false };
  leg.activities.push(activity);
  return activity;
}

/* Builds one discovery card. `cfg.onGone(undoFn)` is called once the card's
   item has been scheduled, flagged, or dismissed — the caller (renderExplore
   / renderFood) uses it to re-render the list without this card, and passes
   the toast+undo through. */
function buildDiscoveryCard(cfg) {
  const card = document.createElement('article');
  card.className = 'discovery-card';
  card.innerHTML = `
    <div class="discovery-card-head">
      <div class="discovery-card-icon" aria-hidden="true"></div>
      <div class="discovery-card-title-wrap">
        <div class="discovery-card-title"></div>
        <div class="discovery-card-area"></div>
      </div>
      <div class="discovery-card-head-meta">
        <div class="discovery-card-rank"></div>
        <div class="discovery-card-proximity" data-proximity-key=""></div>
      </div>
    </div>
    <div class="discovery-card-row">
      <div class="discovery-chips"></div>
      <div class="discovery-actions"></div>
    </div>
    <div class="discovery-card-proof"></div>
    <div class="discovery-card-why"></div>
    <div class="discovery-card-current"></div>
    <div class="discovery-card-kid"></div>
    <div class="discovery-card-tip"></div>
    <div class="discovery-card-heads-up"></div>
    <div class="discovery-card-pair"></div>
    <div class="discovery-day-picker" style="display:none"></div>
  `;

  card.querySelector('.discovery-card-icon').textContent = cfg.icon;
  card.querySelector('.discovery-card-title').textContent = cfg.title;
  card.querySelector('.discovery-card-area').textContent = cfg.area;
  const rank = card.querySelector('.discovery-card-rank');
  if (cfg.rankLabel) rank.textContent = cfg.rankLabel; else rank.remove();
  const proximity = card.querySelector('.discovery-card-proximity');
  proximity.dataset.proximityKey = cfg.proximityKey;
  proximity.textContent = State.proximityCache.get(cfg.proximityKey) || '… mins';
  proximity.setAttribute('aria-label', `Driving time from ${cfg.homeLabel}`);

  const chips = card.querySelector('.discovery-chips');
  cfg.chips.forEach((text) => {
    const chip = document.createElement('span');
    chip.textContent = text;
    chips.appendChild(chip);
  });

  const setOrRemove = (selector, text) => {
    const el = card.querySelector(selector);
    if (text) el.textContent = text; else el.remove();
  };
  setOrRemove('.discovery-card-proof', cfg.proof);
  setOrRemove('.discovery-card-why', cfg.why);
  setOrRemove('.discovery-card-current', cfg.current);
  setOrRemove('.discovery-card-kid', cfg.kid);
  setOrRemove('.discovery-card-tip', cfg.tip);
  setOrRemove('.discovery-card-heads-up', cfg.headsUp);
  setOrRemove('.discovery-card-pair', cfg.pair);

  const actions = card.querySelector('.discovery-actions');
  const picker = card.querySelector('.discovery-day-picker');

  if (cfg.sourceUrl) {
    const linkBtn = document.createElement('a');
    linkBtn.className = 'discovery-icon-btn discovery-icon-btn--link';
    linkBtn.href = cfg.sourceUrl;
    linkBtn.target = '_blank';
    linkBtn.rel = 'noopener noreferrer';
    linkBtn.textContent = '🔗';
    linkBtn.setAttribute('aria-label', `${cfg.sourceLabel || 'Official details'} for ${cfg.title} (opens in a new tab)`);
    actions.appendChild(linkBtn);
  }

  const calBtn = document.createElement('button');
  calBtn.className = 'discovery-icon-btn';
  calBtn.textContent = '📅';
  calBtn.setAttribute('aria-label', `Schedule ${cfg.title}`);
  calBtn.addEventListener('click', () => {
    const open = picker.style.display !== 'none';
    picker.style.display = open ? 'none' : 'flex';
  });
  actions.appendChild(calBtn);

  cfg.days.forEach((day) => {
    const dayBtn = document.createElement('button');
    dayBtn.textContent = formatDayLabel(day.the_date);
    dayBtn.addEventListener('click', async () => {
      picker.style.display = 'none';
      const result = await cfg.onSchedule(day);
      if (result) cfg.onGone(`Added ${cfg.title} to ${formatDayLabel(day.the_date)}.`, result.undo);
    });
    picker.appendChild(dayBtn);
  });

  if (cfg.flaggedMode) {
    const unflagBtn = document.createElement('button');
    unflagBtn.className = 'discovery-icon-btn discovery-icon-btn--flag';
    unflagBtn.textContent = '🚩';
    unflagBtn.setAttribute('aria-label', `Unflag ${cfg.title}`);
    unflagBtn.addEventListener('click', async () => {
      const result = await cfg.onUnflag();
      if (result) cfg.onGone(`Unflagged ${cfg.title}.`, result.undo);
    });
    actions.appendChild(unflagBtn);
    actions.appendChild(makeRemoveButton('✕', cfg.onRemove));
  } else {
    const flagBtn = document.createElement('button');
    flagBtn.className = 'discovery-icon-btn discovery-icon-btn--flag';
    flagBtn.textContent = '🚩';
    flagBtn.setAttribute('aria-label', `Flag ${cfg.title} for later`);
    flagBtn.addEventListener('click', async () => {
      const result = await cfg.onFlag();
      if (result) cfg.onGone(`Flagged ${cfg.title}.`, result.undo);
    });
    actions.appendChild(flagBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'discovery-icon-btn discovery-icon-btn--dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', `Not interested in ${cfg.title}`);
    dismissBtn.addEventListener('click', () => {
      const undo = cfg.onDismiss();
      cfg.onGone(`Hid ${cfg.title}.`, undo);
    });
    actions.appendChild(dismissBtn);
  }

  return card;
}

function catalogueLocationKey(kind, leg, item) { return `${kind}:${leg.slug}:${item.id}`; }

async function resolveCatalogueLocation(kind, leg, item) {
  const key = catalogueLocationKey(kind, leg, item);
  if (State.locationCache.has(key)) return State.locationCache.get(key);
  const saved = findSavedCatalogueActivity(leg, item);
  let location = saved && saved.lat && saved.lng ? { lat: saved.lat, lng: saved.lng } : null;
  if (!location && item.lat && item.lng) location = { lat: item.lat, lng: item.lng };
  if (!location && kind === 'explore') {
    const place = await findGuidePlace(item, leg);
    if (place && place.location) location = { lat: place.location.latitude, lng: place.location.longitude };
  }
  State.locationCache.set(key, location);
  return location;
}

function updateProximityLabels(key, value) {
  document.querySelectorAll('[data-proximity-key]').forEach((el) => {
    if (el.dataset.proximityKey === key) el.textContent = value;
  });
}

async function loadProximities(kind, leg, items) {
  if (!State.homeBasesHydrated || !leg.home_base_lat || !leg.home_base_lng || !items.length) return;
  const unresolved = items.filter((item) => !State.proximityCache.has(catalogueLocationKey(kind, leg, item)));
  items.forEach((item) => {
    const key = catalogueLocationKey(kind, leg, item);
    if (State.proximityCache.has(key)) updateProximityLabels(key, State.proximityCache.get(key));
  });
  if (!unresolved.length) return;

  const resolved = await Promise.all(unresolved.map(async (item) => ({ item, location: await resolveCatalogueLocation(kind, leg, item) })));
  const routable = resolved.filter((entry) => entry.location);
  resolved.filter((entry) => !entry.location).forEach(({ item }) => {
    const key = catalogueLocationKey(kind, leg, item);
    State.proximityCache.set(key, '—');
    updateProximityLabels(key, '—');
  });
  if (!routable.length) return;

  try {
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'destinationIndex,status,condition,duration',
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: leg.home_base_lat, longitude: leg.home_base_lng } } } }],
        destinations: routable.map(({ location }) => ({ waypoint: { location: { latLng: { latitude: location.lat, longitude: location.lng } } } })),
        travelMode: 'DRIVE',
        routingPreference: CONFIG.routingPreference || 'TRAFFIC_AWARE',
        units: 'METRIC',
      }),
      referrerPolicy: GOOGLE_REFERRER_POLICY,
    });
    const matrix = await res.json();
    if (!res.ok || !Array.isArray(matrix)) throw new Error('Route matrix unavailable');
    matrix.forEach((result) => {
      const entry = routable[result.destinationIndex];
      if (!entry || result.condition !== 'ROUTE_EXISTS' || !result.duration) return;
      const minutes = Math.max(1, Math.round(parseFloat(result.duration) / 60));
      const key = catalogueLocationKey(kind, leg, entry.item);
      const label = `${minutes} mins`;
      State.proximityCache.set(key, label);
      updateProximityLabels(key, label);
    });
  } catch (e) {
    routable.forEach(({ item }) => updateProximityLabels(catalogueLocationKey(kind, leg, item), '—'));
  }
}

/* ============================================================
   Explore — leg-toggled, catalogue-backed discovery.
   ============================================================ */
const GUIDE_FILTER_LABELS = { all: 'activities', top: 'best bets', rain: 'rain-proof activities', free: 'free or low-cost activities', outdoor: 'outdoor activities' };

function getExploreLeg() { return findLegBySlug(State.exploreLegSlug); }
function getExploreCatalogue() { return window.VANCOUVER_GUIDE || []; }

document.getElementById('guideFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-guide-filter]');
  if (!button) return;
  State.exploreFilter = button.dataset.guideFilter;
  renderExplore();
});

function renderExplore() {
  const leg = getExploreLeg();
  const list = document.getElementById('guideList');
  const summary = document.getElementById('guideSummary');
  if (!leg) { list.innerHTML = '<div class="empty-note">No leg loaded.</div>'; return; }

  document.getElementById('exploreLegName').textContent = leg.name;
  document.getElementById('exploreSubtitle').textContent = `${leg.days.length} days · checked Aug 13, 2026`;

  document.querySelectorAll('#guideFilters [data-guide-filter]').forEach((button) => {
    const active = button.dataset.guideFilter === State.exploreFilter;
    button.classList.toggle('guide-filter--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const catalogue = getExploreCatalogue();
  const visible = catalogue.filter((item) => {
    if (State.exploreFilter !== 'all' && !(item.filters || []).includes(State.exploreFilter)) return false;
    if (State.dismissed.has(dismissKey('explore', leg.slug, item.id))) return false;
    const saved = findSavedCatalogueActivity(leg, item);
    if (saved && (saved.flagged || leg.days.some((d) => d.stops.some((s) => s.activity_id === saved.id)))) return false;
    return true;
  });
  summary.textContent = `${visible.length} ${GUIDE_FILTER_LABELS[State.exploreFilter]}`;

  list.innerHTML = '';
  visible.forEach((item) => list.appendChild(buildExploreCard(item, leg)));
  loadProximities('explore', leg, visible);
}

function buildExploreCard(item, leg) {
  const weatherLabels = { indoors: 'Rain-proof', mixed: 'Mixed weather', dry: 'Best dry', sunny: 'Sunny day' };
  return buildDiscoveryCard({
    icon: item.icon, title: item.name, area: item.area,
    rankLabel: (item.filters || []).includes('top') ? 'Best bet' : null,
    proximityKey: catalogueLocationKey('explore', leg, item), homeLabel: leg.home_base_label,
    chips: [item.duration, item.cost, weatherLabels[item.weather] || item.weather],
    why: item.why, current: item.current, tip: item.booking ? `Plan it: ${item.booking}` : null, pair: item.pair ? `Pairs well: ${item.pair}` : null,
    sourceUrl: item.sourceUrl, sourceLabel: item.sourceLabel,
    days: leg.days,
    onSchedule: async (day) => {
      const activity = await ensureCatalogueActivity('explore', item, leg);
      if (!activity) return null;
      const stopId = await addActivityToDay(activity, day, leg, { navigate: false, silent: true });
      if (!stopId) return null;
      if (activity.flagged) await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false }).then(() => { activity.flagged = false; });
      return { undo: async () => { await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stopId }); day.stops = day.stops.filter((s) => s.id !== stopId); resequence(day.stops); refreshActiveView(); } };
    },
    onFlag: async () => {
      const activity = await ensureCatalogueActivity('explore', item, leg);
      if (!activity) return null;
      const { error } = await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: true });
      if (error) { App.toast('Could not flag: ' + error.message); return null; }
      activity.flagged = true;
      return { undo: async () => { await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false }); activity.flagged = false; refreshActiveView(); } };
    },
    onDismiss: () => {
      const key = dismissKey('explore', leg.slug, item.id);
      State.dismissed.add(key); saveDismissed();
      return () => { State.dismissed.delete(key); saveDismissed(); refreshActiveView(); };
    },
    onGone: (message, undo) => { App.toast(message, undo); renderExplore(); },
  });
}

/* ============================================================
   Food — same pattern as Explore, catalogue filtered by legSlug.
   ============================================================ */
function getFoodLeg() { return findLegBySlug(State.foodLegSlug); }
function getFoodCatalogueForLeg(leg) { return (window.FOOD_GUIDE || []).filter((item) => item.legSlug === leg.slug); }

document.getElementById('foodFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-food-cuisine]');
  if (!button) return;
  State.foodCuisine = button.dataset.foodCuisine;
  renderFood();
});

function renderFood() {
  const leg = getFoodLeg();
  const list = document.getElementById('foodList');
  if (!leg) { list.innerHTML = '<div class="empty-note">No leg loaded.</div>'; return; }

  document.getElementById('foodLegName').textContent = leg.name;
  document.getElementById('foodSubtitle').textContent = 'Ratings checked Aug 13, 2026';

  const items = getFoodCatalogueForLeg(leg);
  const cuisines = Array.from(new Set(items.flatMap((item) => item.cuisines)));
  if (State.foodCuisine !== 'All' && !cuisines.includes(State.foodCuisine)) State.foodCuisine = 'All';

  const filters = document.getElementById('foodFilters');
  filters.innerHTML = '';
  ['All'].concat(cuisines).forEach((cuisine) => {
    const button = document.createElement('button');
    button.className = 'food-filter' + (cuisine === State.foodCuisine ? ' food-filter--active' : '');
    button.dataset.foodCuisine = cuisine;
    button.textContent = cuisine;
    button.setAttribute('aria-pressed', cuisine === State.foodCuisine ? 'true' : 'false');
    filters.appendChild(button);
  });

  const visible = items.filter((item) => {
    if (State.foodCuisine !== 'All' && !item.cuisines.includes(State.foodCuisine)) return false;
    if (State.dismissed.has(dismissKey('food', leg.slug, item.id))) return false;
    const saved = findSavedCatalogueActivity(leg, item);
    if (saved && (saved.flagged || leg.days.some((d) => d.stops.some((s) => s.activity_id === saved.id)))) return false;
    return true;
  });
  document.getElementById('foodSummary').textContent = `${visible.length} of ${items.length} places`;

  list.innerHTML = '';
  visible.forEach((item) => list.appendChild(buildFoodCard(item, leg)));
  loadProximities('food', leg, visible);
}

function buildFoodCard(item, leg) {
  return buildDiscoveryCard({
    icon: item.icon, title: item.name, area: item.area,
    proximityKey: catalogueLocationKey('food', leg, item), homeLabel: leg.home_base_label,
    chips: item.cuisines.concat([item.price]),
    proof: item.proof, why: item.why, kid: item.kidFit ? `Age-six fit: ${item.kidFit}` : null, headsUp: item.headsUp ? `Heads up: ${item.headsUp}` : null,
    sourceUrl: item.sourceUrl, sourceLabel: item.sourceLabel,
    days: leg.days,
    onSchedule: async (day) => {
      const activity = await ensureCatalogueActivity('food', item, leg);
      if (!activity) return null;
      const stopId = await addActivityToDay(activity, day, leg, { navigate: false, silent: true });
      if (!stopId) return null;
      if (activity.flagged) await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false }).then(() => { activity.flagged = false; });
      return { undo: async () => { await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stopId }); day.stops = day.stops.filter((s) => s.id !== stopId); resequence(day.stops); refreshActiveView(); } };
    },
    onFlag: async () => {
      const activity = await ensureCatalogueActivity('food', item, leg);
      if (!activity) return null;
      const { error } = await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: true });
      if (error) { App.toast('Could not flag: ' + error.message); return null; }
      activity.flagged = true;
      return { undo: async () => { await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false }); activity.flagged = false; refreshActiveView(); } };
    },
    onDismiss: () => {
      const key = dismissKey('food', leg.slug, item.id);
      State.dismissed.add(key); saveDismissed();
      return () => { State.dismissed.delete(key); saveDismissed(); refreshActiveView(); };
    },
    onGone: (message, undo) => { App.toast(message, undo); renderFood(); },
  });
}

/* ============================================================
   Flagged — the planning whiteboard. Everything with flagged = true,
   across both legs, grouped by leg. Schedule (clears the flag), unflag, or
   remove outright.
   ============================================================ */
function renderFlagged() {
  const el = document.getElementById('flaggedList');
  el.innerHTML = '';
  if (!State.trip) return;
  const leg = findLegBySlug('vancouver');
  const flagged = leg ? leg.activities.filter((a) => a.flagged) : [];

  flagged.forEach((activity, index) => el.appendChild(buildFlaggedCard(activity, leg, index)));

  if (!flagged.length) el.innerHTML = '<div class="empty-note" style="margin-top:16px">Nothing flagged in Vancouver yet — tap 🚩 on an Explore or Food card to start the whiteboard.</div>';
  else loadProximities('flagged', leg, flagged);
  requestAnimationFrame(renderFlaggedMap);
}

/* Same discovery-card renderer as Explore/Food, not the condensed
   result-card — flagging shouldn't cost you the duration/cost/tips you saw
   before flagging it. The rich fields come from re-matching the saved
   activity back to its catalogue entry; user-added flags (no catalogue
   match) fall back to just what's on the activity itself. */
function buildFlaggedCard(activity, leg, index) {
  const match = findCatalogueItemForActivity(activity);
  const kind = match && match.kind;
  const item = match && match.item;
  const weatherLabels = { indoors: 'Rain-proof', mixed: 'Mixed weather', dry: 'Best dry', sunny: 'Sunny day' };
  const chips = item
    ? (kind === 'food' ? item.cuisines.concat([item.price]) : [item.duration, item.cost, weatherLabels[item.weather] || item.weather])
    : [activity.category];

  return buildDiscoveryCard({
    icon: item ? item.icon : '📌',
    title: `${index + 1}. ${activity.name}`,
    area: item ? item.area : (activity.address || ''),
    rankLabel: kind === 'explore' && (item.filters || []).includes('top') ? 'Best bet' : null,
    proximityKey: catalogueLocationKey('flagged', leg, activity), homeLabel: leg.home_base_label,
    chips: chips.filter(Boolean),
    proof: kind === 'food' ? item.proof : null,
    why: item ? item.why : activity.notes,
    current: item ? item.current : null,
    kid: kind === 'food' && item.kidFit ? `Age-six fit: ${item.kidFit}` : null,
    tip: item && item.booking ? `Plan it: ${item.booking}` : null,
    headsUp: kind === 'food' && item.headsUp ? `Heads up: ${item.headsUp}` : null,
    pair: item && item.pair ? `Pairs well: ${item.pair}` : null,
    sourceUrl: item ? item.sourceUrl : null, sourceLabel: item ? item.sourceLabel : null,
    days: leg.days,
    flaggedMode: true,
    onSchedule: async (day) => {
      const stopId = await addActivityToDay(activity, day, leg, { navigate: false, silent: true });
      if (!stopId) return null;
      await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false });
      activity.flagged = false;
      return {
        undo: async () => {
          await SB.rpc('trip_planner_remove_stop', { p_day_stop_id: stopId });
          day.stops = day.stops.filter((s) => s.id !== stopId);
          resequence(day.stops);
          await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: true });
          activity.flagged = true;
          refreshActiveView();
        },
      };
    },
    onUnflag: async () => {
      const { error } = await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: false });
      if (error) { App.toast('Could not unflag: ' + error.message); return null; }
      activity.flagged = false;
      return { undo: async () => { await SB.rpc('trip_planner_set_activity_flag', { p_activity_id: activity.id, p_flagged: true }); activity.flagged = true; refreshActiveView(); } };
    },
    onRemove: () => removeActivity(activity),
    onGone: (message, undo) => { App.toast(message, undo); renderFlagged(); },
  });
}

function renderFlaggedMap() {
  if (!mapsReady || !State.trip) return;
  const container = document.getElementById('flaggedMap');
  const leg = findLegBySlug('vancouver');
  if (!container || !leg || !leg.home_base_lat || !leg.home_base_lng) return;
  const flagged = leg.activities.filter((activity) => activity.flagged);
  const located = flagged.filter((activity) => activity.lat && activity.lng);
  document.getElementById('flaggedMapSummary').textContent = `${flagged.length} flagged · ${located.length} mapped · accommodation marked H`;

  if (!State.flaggedMap) {
    State.flaggedMap = new google.maps.Map(container, {
      center: { lat: leg.home_base_lat, lng: leg.home_base_lng }, zoom: MAP_HOME_ZOOM,
      mapTypeControl: false, fullscreenControl: true, zoomControl: true,
      streetViewControl: false, gestureHandling: 'greedy',
    });
  }
  State.flaggedMapMarkers.forEach((marker) => marker.setMap(null));
  State.flaggedMapMarkers = [];
  const bounds = new google.maps.LatLngBounds();
  const home = { lat: leg.home_base_lat, lng: leg.home_base_lng };
  State.flaggedMapMarkers.push(new google.maps.Marker({
    position: home, map: State.flaggedMap, title: leg.home_base_label,
    label: { text: 'H', color: '#fff', fontSize: '11px', fontWeight: '700' },
  }));
  bounds.extend(home);
  located.forEach((activity) => {
    const index = flagged.indexOf(activity) + 1;
    const position = { lat: activity.lat, lng: activity.lng };
    State.flaggedMapMarkers.push(new google.maps.Marker({
      position, map: State.flaggedMap, title: activity.name,
      label: { text: String(index), color: '#fff', fontSize: '11px', fontWeight: '700' },
    }));
    bounds.extend(position);
  });
  google.maps.event.trigger(State.flaggedMap, 'resize');
  if (!located.length) {
    State.flaggedMap.setCenter(home);
    State.flaggedMap.setZoom(MAP_HOME_ZOOM);
  } else {
    State.flaggedMap.fitBounds(bounds, 40);
    google.maps.event.addListenerOnce(State.flaggedMap, 'idle', () => {
      if (State.flaggedMap.getZoom() > MAP_MAX_FIT_ZOOM) State.flaggedMap.setZoom(MAP_MAX_FIT_ZOOM);
    });
  }
}

/* ============================================================
   Amenities — Vancouver only now; the leg switcher went with Harrison.
   ============================================================ */
function renderAmenities() {
  const leg = findLegBySlug('vancouver') || State.trip.legs[0];
  document.getElementById('amenitiesLegName').textContent = leg.name;
  const list = document.getElementById('amenitiesList');
  list.innerHTML = '';
  if (!leg.amenities.length) { list.innerHTML = '<div class="empty-note">Nothing recorded yet.</div>'; return; }
  leg.amenities.forEach((am) => {
    const row = document.createElement('div');
    row.className = 'amenity-row' + (am.category === 'gap' ? ' amenity-row--gap' : '');
    row.innerHTML = '<div><div class="amenity-label"></div><div class="amenity-notes"></div></div>';
    row.querySelector('.amenity-label').textContent = am.label;
    row.querySelector('.amenity-notes').textContent = am.notes || '';
    list.appendChild(row);
  });
}

/* ---------- nav ---------- */
document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.nav;
    App.show(view);
    if (view === 'day') { renderDateStrip(); renderDayTab(); }
    if (view === 'explore') renderExplore();
    if (view === 'food') renderFood();
    if (view === 'flagged') renderFlagged();
    if (view === 'amenities') renderAmenities();
  });
});

/* ---------- boot ---------- */
initAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
