// Dashboard for the Calgary car finder. No build step, no dependencies.

const CONFIG = {
  repo: 'r2vchew/r2vchew.github.io',
  feedbackLabel: 'car-feedback',
  // Optional: a URL that accepts a POST of the feedback payload (Formspree,
  // a Cloudflare Worker, an Apps Script web app). When null, feedback goes
  // through a prefilled GitHub issue, and failing that, email.
  feedbackEndpoint: null,
  // Optional: fallback address for the mailto path.
  feedbackEmail: null,
};

const STORE_KEY = 'car-finder-marks-v1';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat('en-CA');
const money = (n) => (n == null ? '—' : `$${fmt.format(n)}`);

let data = null;
let marks = loadMarks();
let band = 'all';
let sort = 'score';

// View filters. These narrow what the scan already found; they never change
// what gets searched for — that is what scan feedback is for.
const filters = {
  price: '', km: '', year: '', make: '', body: '', seller: '', awd: '', source: '',
};

function loadMarks() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { saved: {}, rejected: {}, notes: {} };
  } catch {
    return { saved: {}, rejected: {}, notes: {} };
  }
}

function saveMarks() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(marks));
  } catch { /* private browsing, marks just will not persist */ }
  renderPending();
  render();
}

async function boot() {
  try {
    const res = await fetch(`data/listings.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('#lede').textContent = `Could not load the latest scan (${err.message}). If this is a brand new setup, the first scan may not have run yet.`;
    return;
  }
  renderHeader();
  buildFilterOptions();
  renderSources();
  renderNearMisses();
  renderPending();
  render();
  wire();
}

/* ---------------------------------------------------------------- header */

/** Cars in the top two bands. The thresholds live in score.mjs. */
function worthALook() {
  return data.cars.filter((x) => x.band === 'shortlist' || x.band === 'worth a look');
}

function renderHeader() {
  const s = data.stats;
  const c = data.criteria.hard;
  const best = data.cars.filter((x) => x.band === 'shortlist').length;

  const siteCount = (data.sourceHealth || []).filter((x) => x.count > 0).length;
  const across = siteCount ? ` across ${siteCount} site${siteCount === 1 ? '' : 's'}` : '';
  const scope = `Everything here is an automatic, ${c.minYear} or newer, under ${money(c.maxPrice)}.`;

  $('#lede').textContent = best
    ? `I read ${fmt.format(s.rawRecords)} listings${across} and threw out ${fmt.format(s.filteredOut)} of them. ${best} ${best === 1 ? 'stands' : 'stand'} out as ${best === 1 ? 'a best pick' : 'best picks'}. ${scope}`
    : `I read ${fmt.format(s.rawRecords)} listings${across} and nothing really cleared the bar this time. ${scope} Widen the scope in scan feedback and I will try again.`;

  const prices = data.cars.map((x) => x.price).filter((p) => p != null);
  const cells = [
    { label: 'Worth a look', value: fmt.format(worthALook().length) },
    { label: 'New since yesterday', value: fmt.format(s.newSinceLastRun) },
    { label: 'Filtered out for you', value: fmt.format(s.filteredOut) },
    { label: 'Cheapest pick', value: prices.length ? money(Math.min(...prices)) : '—' },
    { label: 'Tell me what to change', value: 'Scan feedback', opens: 'feedback' },
    { label: 'Where these came from', value: 'Sources', opens: 'sources' },
  ];

  $('#board').innerHTML = cells.map((cell) => (cell.opens
    ? `<button type="button" class="tile tile-action" data-open="${cell.opens}">
         <span class="tile-label">${cell.label}</span>
         <span class="tile-value">${cell.value} <span aria-hidden="true">→</span></span>
       </button>`
    : `<div class="tile">
         <span class="tile-label">${cell.label}</span>
         <span class="tile-value">${cell.value}</span>
       </div>`)).join('');

  const when = new Date(data.generatedAt);
  $('#generated').textContent = `Last scan ${when.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}.`;
}

/* --------------------------------------------------------------- filters */

/** Tidy the many spellings sites use for a body style. */
function bodyLabel(car) {
  const raw = `${car.bodyType || ''} ${car.title || ''}`.toLowerCase();
  if (/pick ?up|truck|\bram\b|f-?150|silverado|sierra|tacoma/.test(raw)) return 'Truck';
  if (/suv|crossover|cuv/.test(raw)) return 'SUV';
  if (/minivan|\bvan\b/.test(raw)) return 'Van';
  if (/wagon|estate/.test(raw)) return 'Wagon';
  if (/convertible|cabrio|roadster/.test(raw)) return 'Convertible';
  if (/coupe/.test(raw)) return 'Coupe';
  if (/hatch/.test(raw)) return 'Hatchback';
  if (/sedan|saloon/.test(raw)) return 'Sedan';
  return null;
}

function isAwd(car) {
  return /\b(awd|4wd|4x4|all[-\s]?wheel|four[-\s]?wheel|quattro|4motion|xdrive|s-?awc)/i
    .test(`${car.title} ${car.drivetrain} ${car.trim}`);
}

/** Build the dropdowns from what is actually in this scan, with counts. */
function buildFilterOptions() {
  const cars = data.cars;
  const max = data.criteria.hard.maxPrice ?? 20000;

  const priceSteps = [];
  for (let p = 6000; p < max; p += 2000) priceSteps.push(p);
  fill('#f-price', 'Any price', priceSteps.map((p) => ({
    value: String(p), label: `Under ${money(p)}`,
    count: cars.filter((c) => c.price != null && c.price <= p).length,
  })));

  const kmSteps = [60000, 80000, 100000, 120000, 150000];
  fill('#f-km', 'Any mileage', kmSteps.map((k) => ({
    value: String(k), label: `Under ${fmt.format(k)} km`,
    count: cars.filter((c) => c.odometerKm != null && c.odometerKm <= k).length,
  })));

  const years = [...new Set(cars.map((c) => c.year).filter(Boolean))].sort((a, b) => a - b);
  fill('#f-year', 'Any year', years.map((y) => ({
    value: String(y), label: `${y} or newer`,
    count: cars.filter((c) => c.year != null && c.year >= y).length,
  })));

  const makes = [...new Set(cars.map((c) => c.make).filter(Boolean))].sort();
  fill('#f-make', 'Any make', makes.map((m) => ({
    value: m, label: m, count: cars.filter((c) => c.make === m).length,
  })));

  const bodies = [...new Set(cars.map(bodyLabel).filter(Boolean))].sort();
  fill('#f-body', 'Any body type', bodies.map((b) => ({
    value: b, label: b, count: cars.filter((c) => bodyLabel(c) === b).length,
  })));

  const sources = [...new Set(cars.map((c) => c.source).filter(Boolean))].sort();
  const labelFor = (id) => (data.sourceHealth || []).find((s) => s.id === id)?.label || id;
  fill('#f-source', 'Any site', sources.map((s) => ({
    value: s, label: labelFor(s), count: cars.filter((c) => c.source === s).length,
  })));

  // Seller and drivetrain are fixed lists in the markup; annotate their counts.
  annotate('#f-seller', {
    private: cars.filter((c) => c.sellerType === 'private').length,
    dealer: cars.filter((c) => c.sellerType === 'dealer').length,
  });
  annotate('#f-awd', { awd: cars.filter(isAwd).length });
}

function fill(sel, anyLabel, options) {
  const el = $(sel);
  const usable = options.filter((o) => o.count > 0);
  el.innerHTML = [`<option value="">${anyLabel}</option>`]
    .concat(usable.map((o) => `<option value="${escAttr(o.value)}">${esc(o.label)} (${o.count})</option>`))
    .join('');
  el.disabled = usable.length === 0;
}

function annotate(sel, counts) {
  for (const opt of $(sel).options) {
    if (!opt.value) continue;
    const n = counts[opt.value] ?? 0;
    opt.textContent = `${opt.textContent.replace(/\s*\(\d+\)$/, '')} (${n})`;
    opt.disabled = n === 0;
  }
}

function passesFilters(car) {
  if (filters.price && !(car.price != null && car.price <= Number(filters.price))) return false;
  if (filters.km && !(car.odometerKm != null && car.odometerKm <= Number(filters.km))) return false;
  if (filters.year && !(car.year != null && car.year >= Number(filters.year))) return false;
  if (filters.make && car.make !== filters.make) return false;
  if (filters.body && bodyLabel(car) !== filters.body) return false;
  if (filters.seller && car.sellerType !== filters.seller) return false;
  if (filters.awd === 'awd' && !isAwd(car)) return false;
  if (filters.source && car.source !== filters.source) return false;
  return true;
}

function activeFilterCount() {
  return Object.values(filters).filter(Boolean).length;
}

/* ----------------------------------------------------------------- cards */

function visibleCars() {
  let cars = data.cars.filter((c) => !marks.rejected[c.id]);
  if (band === 'shortlist') cars = cars.filter((c) => c.band === 'shortlist');
  if (band === 'new') cars = cars.filter((c) => c.isNew);
  if (band === 'saved') cars = cars.filter((c) => marks.saved[c.id]);
  cars = cars.filter(passesFilters);

  const by = {
    score: (a, b) => b.score - a.score,
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    allin: (a, b) => (a.costs?.total ?? a.price ?? Infinity) - (b.costs?.total ?? b.price ?? Infinity),
    km: (a, b) => (a.odometerKm ?? Infinity) - (b.odometerKm ?? Infinity),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
  }[sort];
  return [...cars].sort(by);
}

function render() {
  const cars = visibleCars();
  const total = data.cars.filter((c) => !marks.rejected[c.id]).length;

  $('#empty').hidden = cars.length > 0;
  $('#result-count').textContent = cars.length === total
    ? `${cars.length} car${cars.length === 1 ? '' : 's'}`
    : `${cars.length} of ${total} cars`;

  const n = activeFilterCount();
  const badge = $('#filter-count');
  badge.hidden = n === 0;
  badge.textContent = String(n);

  $('#cards').innerHTML = cars.map(cardHtml).join('');

  for (const btn of $$('[data-act]')) btn.addEventListener('click', onAct);

  // Plenty of sites block hotlinked images. Swap in the placeholder rather
  // than leaving a broken frame where the photo should be.
  for (const img of $$('.photo img')) {
    img.addEventListener('error', () => {
      const holder = document.createElement('div');
      holder.className = 'noimg';
      holder.textContent = 'Photo would not load — open the listing';
      img.replaceWith(holder);
    }, { once: true });
  }
}

function scoreClass(score) {
  if (score >= 78) return 'good';
  if (score >= 55) return 'mid';
  return 'low';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = esc;

function cardHtml(car) {
  const name = [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ') || car.title || 'Vehicle';
  const cm = car.commentary || {};
  const saved = Boolean(marks.saved[car.id]);

  const flags = [];
  if (car.isNew) flags.push('<span class="flag new">New</span>');
  if (car.band === 'shortlist') flags.push('<span class="flag">Best pick</span>');
  if (car.alsoOn?.length) flags.push(`<span class="flag">Also on ${esc(car.alsoOn.join(', '))}</span>`);
  const drop = priceDrop(car);
  if (drop) flags.push(`<span class="flag">Price dropped ${money(drop)}</span>`);

  const photo = car.imageUrl
    ? `<img src="${escAttr(car.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="noimg">No photo in the listing</div>';

  const pm = (title, items) => (items?.length
    ? `<div><h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
    : '');

  return `
  <article class="card ${car.band === 'shortlist' ? 'is-top' : ''} ${saved ? 'is-saved' : ''}">
    <div class="photo">${photo}<div class="flags">${flags.join('')}</div></div>

    <div class="card-head">
      <h3><a href="${escAttr(car.url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></h3>
      <div class="score ${scoreClass(car.score)}"><b>${car.score}</b><span>match</span></div>
    </div>

    <div class="specs">
      <span><b>${money(car.price)}</b></span>
      ${car.costs ? `<span class="allin" title="Asking price plus tax, fees, tires and likely first repairs. Insurance not included.">~${money(car.costs.total)} on the road</span>` : ''}
      <span><b>${car.odometerKm != null ? `${fmt.format(car.odometerKm)} km` : '— km'}</b></span>
      ${bodyLabel(car) ? `<span>${esc(bodyLabel(car))}</span>` : ''}
      ${car.location ? `<span>${esc(car.location)}</span>` : ''}
      ${car.sellerType ? `<span>${esc(car.sellerType)}</span>` : ''}
    </div>

    ${cm.headline ? `<p class="headline">${esc(cm.headline)}</p>` : ''}
    <div class="commentary">${(cm.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    ${cm.aiNote ? `<p class="ainote">${esc(cm.aiNote)}</p>` : ''}

    <details class="more">
      <summary>The details</summary>
      <div class="plusminus">
        ${pm('In its favour', cm.pros)}
        ${pm('Against it', cm.cons)}
      </div>
      ${costBreakdown(car)}
      ${cm.checks?.length ? `<div class="checks"><h4>Check before buying</h4><ul>${cm.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    </details>

    <div class="card-foot">
      <span class="meta">${esc(car.source)}${car.firstSeen ? ` · first seen ${new Date(car.firstSeen).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}</span>
      <button type="button" class="act" data-act="save" data-id="${car.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>
      <button type="button" class="act" data-act="reject" data-id="${car.id}">Not for me</button>
      <a class="view" href="${escAttr(car.url)}" target="_blank" rel="noopener noreferrer">View listing</a>
    </div>
  </article>`;
}

/**
 * The itemised drive-away estimate. Every line says why it is there, so she
 * can strike out any assumption she disagrees with rather than having to
 * trust a single number.
 */
function costBreakdown(car) {
  const c = car.costs;
  if (!c || !c.items.length) return '';

  const rows = c.items.map((i) => `
    <tr>
      <td>${esc(i.label)}${i.certain ? '' : ' <span class="guess">est.</span>'}</td>
      <td class="amount">${i.amount ? money(i.amount) : '—'}</td>
      <td class="why">${esc(i.why)}</td>
    </tr>`).join('');

  return `
  <div class="costs">
    <h4>Realistic cost to get it on the road</h4>
    <table class="cost-table">
      <tbody>
        <tr><td>Asking price</td><td class="amount">${money(c.price)}</td><td class="why">what the seller is advertising</td></tr>
        ${rows}
      </tbody>
      <tfoot>
        <tr><td><b>Realistic total</b></td><td class="amount"><b>${money(c.total)}</b></td><td class="why">insurance not included</td></tr>
      </tfoot>
    </table>
  </div>`;
}

function priceDrop(car) {
  const h = car.priceHistory;
  if (!h || h.length < 2) return null;
  const diff = h[0].price - h[h.length - 1].price;
  return diff > 0 ? diff : null;
}

function onAct(event) {
  const { act, id } = event.currentTarget.dataset;
  const car = data.cars.find((c) => c.id === id);
  if (!car) return;

  if (act === 'save') {
    if (marks.saved[id]) delete marks.saved[id];
    else marks.saved[id] = label(car);
  } else if (act === 'reject') {
    const why = prompt(`Why is this one out?\n\n${label(car)}\n\n(Optional — it teaches the filter. Cancel to leave it alone.)`);
    if (why === null) return;
    marks.rejected[id] = label(car);
    if (why.trim()) marks.notes[id] = why.trim();
  }
  saveMarks();
}

function label(car) {
  return `${[car.year, car.make, car.model].filter(Boolean).join(' ')} — ${money(car.price)}`;
}

/* -------------------------------------------------------------- sections */

function renderPending() {
  const saved = Object.entries(marks.saved);
  const rejected = Object.entries(marks.rejected);
  const has = saved.length || rejected.length;
  $('#pending').hidden = !has;
  if (!has) return;

  $('#pending-list').innerHTML = [
    ...saved.map(([, l]) => `<li>Saved: ${esc(l)}</li>`),
    ...rejected.map(([id, l]) => `<li>Not for me: ${esc(l)}${marks.notes[id] ? ` — <em>${esc(marks.notes[id])}</em>` : ''}</li>`),
  ].join('');
}

function renderNearMisses() {
  const near = data.nearMisses || [];
  if (!near.length) return;
  $('#near-misses').hidden = false;
  $('#near-list').innerHTML = near.map((n) => `
    <li>
      <a href="${escAttr(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title || 'Listing')}</a>
      <span><b>${money(n.price)}</b></span>
      <span class="why">${esc(n.rejectReason)}</span>
    </li>`).join('');
}

function renderSources() {
  $('#source-list').innerHTML = (data.sourceHealth || []).map((s) => {
    const cls = s.count > 0 ? 'ok' : (s.skipped ? 'warn' : (s.blocked ? 'bad' : 'warn'));
    let detail;
    if (s.count > 0) detail = `${fmt.format(s.count)} listing${s.count === 1 ? '' : 's'} read`;
    else if (s.skipped) detail = 'not checked — this site blocks automated visits';
    else if (s.blocked) detail = 'blocked the scan this time';
    else detail = 'returned nothing';
    return `<li><span class="dot ${cls}"></span><b>${esc(s.label)}</b><span class="muted">${detail}</span></li>`;
  }).join('');

  const down = (data.sourceHealth || []).filter((s) => s.count === 0 && !s.skipped);
  $('#source-note').textContent = down.length
    ? 'A site returning nothing usually means it served a bot check rather than that it has no cars. The next scan retries automatically.'
    : '';
}

/* -------------------------------------------------------------- feedback */

function buildPayload() {
  const note = $('#note').value.trim();
  return {
    sentAt: new Date().toISOString(),
    scanGeneratedAt: data?.generatedAt ?? null,
    note,
    saved: Object.entries(marks.saved).map(([id, l]) => ({ id, label: l })),
    rejected: Object.entries(marks.rejected).map(([id, l]) => ({
      id, label: l, reason: marks.notes[id] || null,
    })),
  };
}

async function send() {
  const payload = buildPayload();
  if (!payload.note && !payload.saved.length && !payload.rejected.length) {
    show('Nothing to send yet — save or reject a car, or write a note.');
    return;
  }

  if (CONFIG.feedbackEndpoint) {
    try {
      const res = await fetch(CONFIG.feedbackEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      afterSend('Sent. The next scan will take it into account.');
      return;
    } catch (err) {
      show(`Could not send automatically (${err.message}). Opening the backup method…`);
    }
  }

  const title = payload.note
    ? `Car feedback: ${payload.note.slice(0, 60)}`
    : `Car feedback: ${payload.saved.length} saved, ${payload.rejected.length} rejected`;

  const body = [
    payload.note ? `${payload.note}\n` : '',
    payload.saved.length ? `**Saved**\n${payload.saved.map((s) => `- ${s.label}`).join('\n')}\n` : '',
    payload.rejected.length ? `**Not for me**\n${payload.rejected.map((r) => `- ${r.label}${r.reason ? ` — ${r.reason}` : ''}`).join('\n')}\n` : '',
    '<!-- machine-readable, do not edit -->',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].filter(Boolean).join('\n');

  if (CONFIG.repo) {
    const url = `https://github.com/${CONFIG.repo}/issues/new?labels=${encodeURIComponent(CONFIG.feedbackLabel)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener');
    afterSend('Opened a feedback form in a new tab — press the green button there to send it.');
    return;
  }

  if (CONFIG.feedbackEmail) {
    window.location.href = `mailto:${CONFIG.feedbackEmail}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    afterSend('Opening your email app.');
    return;
  }

  try {
    await navigator.clipboard.writeText(body);
    afterSend('Copied to your clipboard — paste it into a message.');
  } catch {
    show('Could not send. Copy your note manually and send it along.');
  }
}

function afterSend(message) {
  show(message);
  $('#note').value = '';
}

function show(message) {
  const el = $('#sent');
  el.hidden = false;
  el.textContent = message;
}

/* ---------------------------------------------------------------- wiring */

function openPanel(name) {
  for (const which of ['feedback', 'sources']) {
    $(`#panel-${which}`).hidden = which !== name;
  }
  const panel = $(`#panel-${name}`);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  panel.querySelector('h2')?.focus?.();
}

function closePanel(name) {
  $(`#panel-${name}`).hidden = true;
}

function wire() {
  for (const chip of $$('.chips .chip')) {
    chip.addEventListener('click', () => {
      band = chip.dataset.filter;
      for (const c of $$('.chips .chip')) c.classList.toggle('is-active', c === chip);
      render();
    });
  }

  $('#sort').addEventListener('change', (e) => { sort = e.target.value; render(); });

  const toggle = $('#filters-toggle');
  toggle.addEventListener('click', () => {
    const open = $('#filters').hidden;
    $('#filters').hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-active', open);
  });

  const fieldMap = {
    '#f-price': 'price', '#f-km': 'km', '#f-year': 'year', '#f-make': 'make',
    '#f-body': 'body', '#f-seller': 'seller', '#f-awd': 'awd', '#f-source': 'source',
  };
  for (const [sel, key] of Object.entries(fieldMap)) {
    $(sel).addEventListener('change', (e) => { filters[key] = e.target.value; render(); });
  }

  $('#filters-reset').addEventListener('click', () => {
    for (const key of Object.keys(filters)) filters[key] = '';
    for (const sel of Object.keys(fieldMap)) $(sel).value = '';
    render();
  });

  for (const btn of $$('[data-open]')) {
    btn.addEventListener('click', () => openPanel(btn.dataset.open));
  }
  for (const btn of $$('[data-close]')) {
    btn.addEventListener('click', () => closePanel(btn.dataset.close));
  }

  $('#send').addEventListener('click', send);
  $('#clear').addEventListener('click', () => {
    if (!confirm('Clear every save and rejection you have marked?')) return;
    marks = { saved: {}, rejected: {}, notes: {} };
    saveMarks();
    show('Cleared.');
  });
}

boot();
