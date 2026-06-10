'use strict';

/* ============================================================
   Recipe Box — a small offline-first recipe app.
   Storage: IndexedDB, with all recipes mirrored in memory
   so search and rendering are instant.
   ============================================================ */

/* ---------- Constants ---------- */

const TAGS = [
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'side', 'sauce/condiment',
  'beef', 'chicken', 'pork', 'fish/seafood', 'vegetarian', 'beans/legumes',
  'one-pot', 'grill/BBQ', 'slow-cook', 'no-cook', 'baking', 'soup/stew',
  'weeknight', 'weekend/project', 'crowd/entertaining', 'kid-approved'
];

const COMMON_UNITS = [
  'tsp', 'tbsp', 'cup', 'mL', 'L', 'g', 'kg', 'oz', 'lb',
  'clove', 'can', 'bunch', 'slice', 'piece', 'pinch', 'sprig', 'stalk'
];

const SOURCE_TYPES = ['link', 'screenshot', 'manual'];

/* ---------- IndexedDB ---------- */

const DB_NAME = 'recipe-box';
const DB_VERSION = 1;
const STORE = 'recipes';
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutMany(list) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const r of list) tx.objectStore(STORE).put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- State ---------- */

const state = {
  recipes: [],
  query: '',
  activeTags: new Set(),
  detailServings: null,   // current servings shown on the detail view
  detailId: null
};

const searchIndex = new Map(); // recipe id -> normalized searchable text

/* ---------- Helpers ---------- */

const $app = document.getElementById('app');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function norm(s) {
  // Lowercase and strip accents so "creme" finds "crème".
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Only allow link protocols that are safe to put in an href, so a
// scraped "javascript:" URL can't become a clickable script.
function safeUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const parsed = new URL(u, location.href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? u : null;
  } catch {
    return null;
  }
}

function indexRecipe(r) {
  const parts = [
    r.name,
    r.source && r.source.note,
    ...r.ingredients.map(i => [i.item, i.prep, i.unit].filter(Boolean).join(' ')),
    r.notes,
    r.tags.join(' ')
  ];
  searchIndex.set(r.id, norm(parts.filter(Boolean).join(' \n ')));
}

function getRecipe(id) {
  return state.recipes.find(r => r.id === id) || null;
}

let toastTimer = null;
function toast(msg, kind, ms) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, ms || 2500);
}

/* ---------- Amount formatting (readable fractions) ---------- */

const FRACTION_GLYPHS = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']
];

function formatAmount(value) {
  if (typeof value !== 'number' || !isFinite(value)) return '';
  if (value < 0) return String(value);

  const whole = Math.floor(value);
  const frac = value - whole;

  let best = FRACTION_GLYPHS[0];
  let bestDiff = Infinity;
  for (const entry of FRACTION_GLYPHS) {
    const d = Math.abs(frac - entry[0]);
    if (d < bestDiff) { bestDiff = d; best = entry; }
  }

  // Snap to a kitchen-friendly fraction when we're close enough,
  // but keep deliberate decimals (1.1, 0.4) honest.
  if (bestDiff <= 0.02) {
    const wholePart = whole + (best[0] === 1 ? 1 : 0);
    const glyph = best[0] === 1 ? '' : best[1];
    if (!glyph) return String(wholePart);
    return wholePart > 0 ? `${wholePart}${glyph}` : glyph;
  }

  // Otherwise show a trimmed decimal.
  return String(parseFloat(value.toFixed(2)));
}

function formatMinutes(min) {
  if (typeof min !== 'number' || !isFinite(min) || min <= 0) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ---------- Search ---------- */

function visibleRecipes() {
  const words = norm(state.query).split(/\s+/).filter(Boolean);
  const scored = [];

  for (const r of state.recipes) {
    let ok = true;
    for (const t of state.activeTags) {
      if (!r.tags.includes(t)) { ok = false; break; }
    }
    if (!ok) continue;

    let score = 0;
    if (words.length) {
      const hay = searchIndex.get(r.id) || '';
      if (!words.every(w => hay.includes(w))) continue;
      const name = norm(r.name);
      if (words.every(w => name.includes(w))) score = 2;
      if (name.startsWith(words[0])) score += 1;
    }
    scored.push([score, r]);
  }

  scored.sort((a, b) => (b[0] - a[0]) || a[1].name.localeCompare(b[1].name));
  return scored.map(e => e[1]);
}

/* ---------- List view ---------- */

function renderListView() {
  $app.innerHTML = `
    <header class="app-header">
      <h1>Recipe Box</h1>
      <button class="icon-btn" data-action="import" title="Import recipes from a JSON file">Import</button>
      <button class="icon-btn" data-action="export" title="Export all recipes to a JSON file">Export</button>
      <a class="icon-btn primary" href="#/new">+ Add</a>
    </header>
    <div class="search-bar">
      <div class="search-wrap">
        <input id="search" type="search" placeholder="Search recipes, ingredients, notes…"
               autocomplete="off" value="${esc(state.query)}">
        <button class="search-clear" data-action="clear-search" aria-label="Clear search"
                style="${state.query ? '' : 'display:none'}">✕</button>
      </div>
      <div class="tag-row" id="tag-row"></div>
    </div>
    <div id="results"></div>
  `;
  renderTagRow();
  renderResults();

  const input = document.getElementById('search');
  input.addEventListener('input', () => {
    state.query = input.value;
    document.querySelector('.search-clear').style.display = state.query ? '' : 'none';
    renderResults();
  });
}

function renderTagRow() {
  const row = document.getElementById('tag-row');
  if (!row) return;
  // Active tags first so they stay visible without scrolling.
  const ordered = [...TAGS].sort((a, b) =>
    (state.activeTags.has(b) ? 1 : 0) - (state.activeTags.has(a) ? 1 : 0));
  row.innerHTML = ordered.map(t => `
    <button class="chip ${state.activeTags.has(t) ? 'on' : ''}"
            data-action="toggle-tag" data-tag="${esc(t)}">${esc(t)}</button>
  `).join('');
}

function renderResults() {
  const results = document.getElementById('results');
  if (!results) return;
  const list = visibleRecipes();

  if (!state.recipes.length) {
    results.innerHTML = `
      <div class="empty-state">
        <p><strong>Your recipe box is empty.</strong></p>
        <p>Add a recipe with the <strong>+ Add</strong> button, or use
        <strong>Import</strong> to load a JSON file of recipes.</p>
      </div>`;
    return;
  }

  if (!list.length) {
    results.innerHTML = `
      <div class="empty-state">
        <p>No recipes match${state.query ? ` “${esc(state.query)}”` : ''}${state.activeTags.size ? ' with those tags' : ''}.</p>
      </div>`;
    return;
  }

  const filtered = state.query || state.activeTags.size;
  results.innerHTML = `
    <p class="result-count">${list.length} ${filtered ? 'matching ' : ''}recipe${list.length === 1 ? '' : 's'}</p>
    ${list.map(recipeCard).join('')}
  `;
}

function recipeCard(r) {
  const meta = [];
  const total = (r.time.prep_minutes || 0) + (r.time.cook_minutes || 0);
  if (total) meta.push(formatMinutes(total));
  if (typeof r.servings === 'number') meta.push(`serves ${r.servings}`);
  return `
    <a class="recipe-card" href="#/recipe/${encodeURIComponent(r.id)}">
      <h2>${esc(r.name)}</h2>
      ${meta.length ? `<div class="meta">${esc(meta.join(' · '))}</div>` : ''}
      ${r.tags.length ? `<div class="tags">${r.tags.map(t => `<span class="chip tag-label">${esc(t)}</span>`).join('')}</div>` : ''}
    </a>`;
}

/* ---------- Detail view ---------- */

function renderDetail(id) {
  const r = getRecipe(id);
  if (!r) { location.hash = '#/'; return; }

  if (state.detailId !== id || typeof state.detailServings !== 'number') {
    state.detailId = id;
    state.detailServings = typeof r.servings === 'number' ? r.servings : null;
  }

  const canScale = typeof r.servings === 'number' && r.servings > 0;
  const factor = canScale ? state.detailServings / r.servings : 1;
  const scaled = canScale && state.detailServings !== r.servings;

  const prep = formatMinutes(r.time.prep_minutes);
  const cook = formatMinutes(r.time.cook_minutes);
  const timeBits = [];
  if (prep) timeBits.push(`${prep} prep`);
  if (cook) timeBits.push(`${cook} cook`);

  let sourceLine = '';
  const linkUrl = r.source.type === 'link' ? safeUrl(r.source.url) : null;
  if (linkUrl) {
    sourceLine = `Source: <a href="${esc(linkUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.source.note || r.source.url)}</a>`;
  } else if (r.source.note) {
    sourceLine = `Source: ${esc(r.source.note)}${r.source.type === 'screenshot' ? ' (screenshot)' : ''}`;
  } else if (r.source.type === 'screenshot') {
    sourceLine = 'Source: screenshot';
  }
  if (r.date_added) {
    sourceLine += `${sourceLine ? ' · ' : ''}Added ${esc(r.date_added)}`;
  }

  $app.innerHTML = `
    <header class="app-header">
      <a class="back-link" href="#/">‹ Back</a>
      <span class="spacer"></span>
      <a class="icon-btn" href="#/edit/${encodeURIComponent(r.id)}">Edit</a>
    </header>
    <article class="detail">
      <h1>${esc(r.name)}</h1>
      ${sourceLine ? `<p class="source-line">${sourceLine}</p>` : ''}
      ${r.tags.length ? `<div class="tags tag-row" style="overflow:visible;flex-wrap:wrap">${r.tags.map(t => `<span class="chip tag-label">${esc(t)}</span>`).join('')}</div>` : ''}

      <div class="meta-card">
        ${canScale ? `
          <div class="servings-control">
            <span class="label">Servings</span>
            <button data-action="serv-minus" aria-label="Fewer servings">−</button>
            <span class="serv-value">${state.detailServings}</span>
            <button data-action="serv-plus" aria-label="More servings">+</button>
          </div>` : ''}
        ${timeBits.length ? `<div class="time-info">${esc(timeBits.join(' · '))}</div>` : ''}
        ${scaled ? `
          <div class="scaled-note">Ingredient amounts scaled from ${r.servings} servings.
            <button data-action="serv-reset">Reset</button>
          </div>` : ''}
      </div>

      ${r.ingredients.length ? `
        <section>
          <h2>Ingredients</h2>
          <ul class="ingredient-list">
            ${r.ingredients.map(i => `<li>${ingredientLine(i, factor)}</li>`).join('')}
          </ul>
        </section>` : ''}

      ${r.steps.length ? `
        <section>
          <h2>Steps</h2>
          <ol class="step-list">
            ${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}
          </ol>
        </section>` : ''}

      ${r.notes ? `
        <section>
          <h2>Notes</h2>
          <div class="notes-block">${esc(r.notes)}</div>
        </section>` : ''}
    </article>
  `;
}

function ingredientLine(ing, factor) {
  const bits = [];
  if (typeof ing.amount === 'number') {
    const amt = formatAmount(ing.amount * factor);
    bits.push(`<span class="amt">${esc(amt)}${ing.unit ? ' ' + esc(ing.unit) : ''}</span>`);
  } else if (ing.unit) {
    bits.push(`<span class="amt">${esc(ing.unit)}</span>`);
  }
  bits.push(esc(ing.item));
  let line = bits.join(' ');
  if (ing.prep) line += `<span class="prep">, ${esc(ing.prep)}</span>`;
  return line;
}

function changeServings(delta) {
  const r = getRecipe(state.detailId);
  if (!r || typeof state.detailServings !== 'number') return;
  const next = delta === 0 ? r.servings : state.detailServings + delta;
  if (next < 1) return;
  state.detailServings = next;
  renderDetail(state.detailId);
}

/* ---------- Editor ---------- */

function renderEdit(id) {
  const r = id ? getRecipe(id) : null;
  if (id && !r) { location.hash = '#/'; return; }

  const blank = {
    id: null, name: '',
    source: { type: 'manual', url: null, note: null },
    servings: 4,
    time: { prep_minutes: null, cook_minutes: null },
    ingredients: [], steps: [], tags: [], notes: '', date_added: null
  };
  const rec = r || blank;

  // Controlled tags plus any extra tags this recipe already carries.
  const allTags = [...TAGS, ...rec.tags.filter(t => !TAGS.includes(t))];

  $app.innerHTML = `
    <header class="app-header">
      <h1>${r ? 'Edit recipe' : 'New recipe'}</h1>
    </header>
    <form class="editor" id="editor-form" data-id="${esc(rec.id || '')}" data-date="${esc(rec.date_added || '')}">
      <fieldset>
        <label class="field-label" for="f-name">Name</label>
        <input type="text" id="f-name" value="${esc(rec.name)}" required autocomplete="off">
      </fieldset>

      <fieldset>
        <div class="row">
          <div>
            <label class="field-label" for="f-servings">Servings</label>
            <input type="number" id="f-servings" min="1" step="1" inputmode="numeric"
                   value="${typeof rec.servings === 'number' ? rec.servings : ''}">
          </div>
          <div>
            <label class="field-label" for="f-prep">Prep (min)</label>
            <input type="number" id="f-prep" min="0" step="1" inputmode="numeric"
                   value="${typeof rec.time.prep_minutes === 'number' ? rec.time.prep_minutes : ''}">
          </div>
          <div>
            <label class="field-label" for="f-cook">Cook (min)</label>
            <input type="number" id="f-cook" min="0" step="1" inputmode="numeric"
                   value="${typeof rec.time.cook_minutes === 'number' ? rec.time.cook_minutes : ''}">
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Source</legend>
        <div class="row">
          <select id="f-source-type">
            ${SOURCE_TYPES.map(t => `<option value="${t}" ${rec.source.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <input type="url" id="f-source-url" placeholder="URL (for links)" value="${esc(rec.source.url || '')}">
        </div>
        <input type="text" id="f-source-note" placeholder="Source note (e.g. Grandma, NYT Cooking)"
               value="${esc(rec.source.note || '')}" style="margin-top:8px" autocomplete="off">
      </fieldset>

      <fieldset>
        <legend>Ingredients</legend>
        <div class="field-hint" style="margin:0 0 8px">
          Leave the amount blank for fuzzy quantities (e.g. “a good glug”) — put that wording
          in the prep field instead. Blank amounts don’t scale.
        </div>
        <div id="ing-rows">
          ${rec.ingredients.map(ingredientRow).join('')}
        </div>
        <button type="button" class="add-row-btn" data-action="add-ing">+ Add ingredient</button>
        <datalist id="unit-list">
          ${COMMON_UNITS.map(u => `<option value="${u}">`).join('')}
        </datalist>
      </fieldset>

      <fieldset>
        <legend>Steps</legend>
        <div id="step-rows">
          ${rec.steps.map(stepRow).join('')}
        </div>
        <button type="button" class="add-row-btn" data-action="add-step">+ Add step</button>
      </fieldset>

      <fieldset>
        <legend>Tags</legend>
        <div class="tag-grid">
          ${allTags.map(t => `
            <label><input type="checkbox" name="tags" value="${esc(t)}"
                   ${rec.tags.includes(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}
        </div>
      </fieldset>

      <fieldset>
        <label class="field-label" for="f-notes">Notes</label>
        <textarea id="f-notes" placeholder="Tweaks, substitutions, how it went…">${esc(rec.notes)}</textarea>
      </fieldset>

      <div class="editor-actions">
        <button type="button" class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button type="submit" class="save-btn">Save recipe</button>
      </div>

      ${r ? `
        <div class="danger-zone">
          <button type="button" data-action="delete-recipe">Delete this recipe</button>
        </div>` : ''}
    </form>
  `;

  if (!rec.ingredients.length) addIngredientRow();
  if (!rec.steps.length) addStepRow();

  document.getElementById('editor-form').addEventListener('submit', e => {
    e.preventDefault();
    saveFromForm();
  });

  if (!r) document.getElementById('f-name').focus();
}

function ingredientRow(ing) {
  ing = ing || { amount: null, unit: null, item: '', prep: null };
  return `
    <div class="ing-row">
      <input type="number" class="ing-amount" step="any" min="0" placeholder="Amt"
             value="${typeof ing.amount === 'number' ? ing.amount : ''}">
      <input type="text" class="ing-unit" list="unit-list" placeholder="Unit"
             value="${esc(ing.unit || '')}" autocomplete="off">
      <input type="text" class="ing-item" placeholder="Ingredient"
             value="${esc(ing.item || '')}" autocomplete="off">
      <input type="text" class="ing-prep" placeholder="Prep / fuzzy amount"
             value="${esc(ing.prep || '')}" autocomplete="off">
      <button type="button" class="del-row-btn" data-action="del-row" aria-label="Remove ingredient">✕</button>
    </div>`;
}

function stepRow(text) {
  return `
    <div class="step-row">
      <textarea class="step-text" placeholder="Describe this step…">${esc(text || '')}</textarea>
      <button type="button" class="del-row-btn" data-action="del-row" aria-label="Remove step">✕</button>
    </div>`;
}

function addIngredientRow() {
  document.getElementById('ing-rows').insertAdjacentHTML('beforeend', ingredientRow());
}

function addStepRow() {
  document.getElementById('step-rows').insertAdjacentHTML('beforeend', stepRow());
}

function saveFromForm() {
  const form = document.getElementById('editor-form');
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    toast('Every recipe needs a name.', 'error');
    document.getElementById('f-name').focus();
    return;
  }

  const numVal = el => {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : null;
  };
  const strVal = el => el.value.trim() || null;

  const ingredients = [...form.querySelectorAll('.ing-row')].map(row => ({
    amount: numVal(row.querySelector('.ing-amount')),
    unit: strVal(row.querySelector('.ing-unit')),
    item: row.querySelector('.ing-item').value.trim(),
    prep: strVal(row.querySelector('.ing-prep'))
  })).filter(i => i.item);

  const steps = [...form.querySelectorAll('.step-text')]
    .map(t => t.value.trim()).filter(Boolean);

  const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map(c => c.value);

  const recipe = {
    id: form.dataset.id || crypto.randomUUID(),
    name,
    source: {
      type: document.getElementById('f-source-type').value,
      url: strVal(document.getElementById('f-source-url')),
      note: strVal(document.getElementById('f-source-note'))
    },
    servings: numVal(document.getElementById('f-servings')),
    time: {
      prep_minutes: numVal(document.getElementById('f-prep')),
      cook_minutes: numVal(document.getElementById('f-cook'))
    },
    ingredients,
    steps,
    tags,
    notes: document.getElementById('f-notes').value.trim(),
    date_added: form.dataset.date || today()
  };

  dbPutMany([recipe]).then(() => {
    const idx = state.recipes.findIndex(r => r.id === recipe.id);
    if (idx >= 0) state.recipes[idx] = recipe; else state.recipes.push(recipe);
    indexRecipe(recipe);
    state.detailId = null; // force servings reset on next detail render
    toast('Recipe saved.');
    location.hash = '#/recipe/' + encodeURIComponent(recipe.id);
  }).catch(err => {
    toast('Could not save: ' + err.message, 'error');
  });
}

function deleteCurrentRecipe() {
  const form = document.getElementById('editor-form');
  const id = form.dataset.id;
  const r = getRecipe(id);
  if (!r) return;
  if (!confirm(`Delete “${r.name}”? This cannot be undone.`)) return;
  dbDelete(id).then(() => {
    state.recipes = state.recipes.filter(x => x.id !== id);
    searchIndex.delete(id);
    toast('Recipe deleted.');
    location.hash = '#/';
  }).catch(err => toast('Could not delete: ' + err.message, 'error'));
}

/* ---------- Import / export ---------- */

function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) {
    return null;
  }
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const str = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;

  return {
    id: (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim() : crypto.randomUUID(),
    name: raw.name.trim(),
    source: {
      type: SOURCE_TYPES.includes(raw.source?.type) ? raw.source.type : 'manual',
      url: str(raw.source?.url),
      note: str(raw.source?.note)
    },
    servings: num(raw.servings),
    time: {
      prep_minutes: num(raw.time?.prep_minutes),
      cook_minutes: num(raw.time?.cook_minutes)
    },
    ingredients: Array.isArray(raw.ingredients)
      ? raw.ingredients
          .filter(i => i && typeof i === 'object' && str(i.item))
          .map(i => ({ amount: num(i.amount), unit: str(i.unit), item: str(i.item), prep: str(i.prep) }))
      : [],
    steps: Array.isArray(raw.steps)
      ? raw.steps.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
      : [],
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    date_added: /^\d{4}-\d{2}-\d{2}$/.test(raw.date_added || '') ? raw.date_added : today()
  };
}

// Shared by file import and paste import. Returns true on success.
async function importFromText(text, sourceLabel) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    toast(`Import failed: that ${sourceLabel} is not valid JSON.`, 'error', 4000);
    return false;
  }

  const rawList = Array.isArray(data) ? data
    : Array.isArray(data?.recipes) ? data.recipes
    : [data];

  const existing = new Set(state.recipes.map(r => r.id));
  const incoming = [];
  let added = 0, updated = 0, skipped = 0;

  for (const raw of rawList) {
    const rec = normalizeRecipe(raw);
    if (!rec) { skipped++; continue; }
    if (existing.has(rec.id)) updated++; else added++;
    existing.add(rec.id);
    incoming.push(rec);
  }

  if (!incoming.length) {
    toast(`Import failed: no valid recipes found in that ${sourceLabel}.`, 'error', 4000);
    return false;
  }

  try {
    await dbPutMany(incoming);
  } catch (err) {
    toast('Import failed: ' + err.message, 'error', 4000);
    return false;
  }

  for (const rec of incoming) {
    const idx = state.recipes.findIndex(r => r.id === rec.id);
    if (idx >= 0) state.recipes[idx] = rec; else state.recipes.push(rec);
    indexRecipe(rec);
  }

  const bits = [];
  if (added) bits.push(`${added} new`);
  if (updated) bits.push(`${updated} updated`);
  if (skipped) bits.push(`${skipped} skipped (invalid)`);
  toast(`Imported: ${bits.join(', ')}.`, null, 4000);
  route();
  return true;
}

async function handleImportFile(file) {
  await importFromText(await file.text(), 'file');
}

function openImportDialog() {
  const dlg = document.getElementById('import-dialog');
  document.getElementById('paste-json').value = '';
  dlg.showModal();
}

async function importFromPaste() {
  const text = document.getElementById('paste-json').value.trim();
  if (!text) {
    toast('Paste some recipe JSON first.', 'error');
    return;
  }
  // Keep the dialog open on failure so the paste can be fixed.
  if (await importFromText(text, 'pasted text')) {
    document.getElementById('import-dialog').close();
  }
}

function exportRecipes() {
  if (!state.recipes.length) {
    toast('Nothing to export yet.', 'error');
    return;
  }
  const sorted = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name));
  const blob = new Blob([JSON.stringify(sorted, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `recipe-box-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${sorted.length} recipe${sorted.length === 1 ? '' : 's'}.`);
}

/* ---------- Routing ---------- */

// Remember how far down the list was scrolled so returning from a recipe
// doesn't dump you back at the top of a long list.
let lastListScroll = 0;
const onList = () => location.hash === '' || location.hash === '#/';

function route() {
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/recipe\/(.+)$/))) {
    renderDetail(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
  } else if ((m = h.match(/^#\/edit\/(.+)$/))) {
    renderEdit(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
  } else if (h === '#/new') {
    renderEdit(null);
    window.scrollTo(0, 0);
  } else {
    renderListView();
    window.scrollTo(0, lastListScroll);
  }
}

window.addEventListener('scroll', () => {
  if (onList()) lastListScroll = window.scrollY;
}, { passive: true });

/* ---------- Global event handling ---------- */

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'toggle-tag': {
      const t = btn.dataset.tag;
      if (state.activeTags.has(t)) state.activeTags.delete(t);
      else state.activeTags.add(t);
      renderTagRow();
      renderResults();
      break;
    }
    case 'clear-search': {
      state.query = '';
      const input = document.getElementById('search');
      input.value = '';
      btn.style.display = 'none';
      renderResults();
      input.focus();
      break;
    }
    case 'serv-minus': changeServings(-1); break;
    case 'serv-plus': changeServings(1); break;
    case 'serv-reset': changeServings(0); break;
    case 'add-ing': addIngredientRow(); break;
    case 'add-step': addStepRow(); break;
    case 'del-row': btn.closest('.ing-row, .step-row').remove(); break;
    case 'cancel-edit': {
      const id = document.getElementById('editor-form').dataset.id;
      location.hash = id ? '#/recipe/' + encodeURIComponent(id) : '#/';
      break;
    }
    case 'delete-recipe': deleteCurrentRecipe(); break;
    case 'import': openImportDialog(); break;
    case 'import-file':
      document.getElementById('import-dialog').close();
      document.getElementById('import-file').click();
      break;
    case 'import-paste': importFromPaste(); break;
    case 'close-import': document.getElementById('import-dialog').close(); break;
    case 'export': exportRecipes(); break;
  }
});

// Tapping the dialog backdrop closes it.
document.getElementById('import-dialog').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
  e.target.value = '';
});

window.addEventListener('hashchange', route);

/* ---------- Init ---------- */

// Ask the browser not to evict our IndexedDB data under storage pressure.
// Installed PWAs on Android Chrome are typically granted this without a prompt;
// it's the main defence against silently losing the recipe box. Export remains
// the off-device backup.
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist &&
        !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* best-effort */ }
}

(async function init() {
  try {
    state.recipes = await dbGetAll();
    state.recipes.forEach(indexRecipe);
  } catch (err) {
    toast('Could not open the recipe database: ' + err.message, 'error', 6000);
  }
  route();
  requestPersistence();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
  }
})();
