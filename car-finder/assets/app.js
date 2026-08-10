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
const fmt = new Intl.NumberFormat('en-CA');
const money = (n) => (n == null ? '—' : `$${fmt.format(n)}`);

let data = null;
let marks = loadMarks();
let filter = 'all';
let sort = 'score';

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
  renderSources();
  renderNearMisses();
  renderPending();
  render();
  wire();
}

function renderHeader() {
  const s = data.stats;
  const c = data.criteria.hard;
  const best = data.cars.filter((x) => x.band === 'shortlist').length;

  const siteCount = (data.sourceHealth || []).filter((x) => x.count > 0).length;
  const across = siteCount ? ` across ${siteCount} site${siteCount === 1 ? '' : 's'}` : '';
  const scope = `Everything here is an automatic, ${c.minYear} or newer, under ${money(c.maxPrice)}.`;

  $('#lede').textContent = best
    ? `I read ${fmt.format(s.rawRecords)} listings${across} and threw out ${fmt.format(s.filteredOut)} of them. ${best} ${best === 1 ? 'is' : 'are'} genuinely worth your time. ${scope}`
    : `I read ${fmt.format(s.rawRecords)} listings${across} and nothing really cleared the bar this time. ${scope} Widen the scope below and I will try again.`;

  const prices = data.cars.map((x) => x.price).filter((p) => p != null);
  const stats = [
    ['Worth a look', data.cars.filter((x) => x.score >= 62).length],
    ['New since last scan', s.newSinceLastRun],
    ['Filtered out for you', s.filteredOut],
    ['Cheapest pick', prices.length ? money(Math.min(...prices)) : '—'],
  ];
  $('#stats').innerHTML = stats.map(([k, v]) =>
    `<div><dt>${k}</dt><dd>${typeof v === 'number' ? fmt.format(v) : v}</dd></div>`).join('');

  const when = new Date(data.generatedAt);
  $('#generated').textContent = `Last scan ${when.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}.`;
}

function visibleCars() {
  let cars = data.cars.filter((c) => !marks.rejected[c.id]);
  if (filter === 'shortlist') cars = cars.filter((c) => c.band === 'shortlist');
  if (filter === 'new') cars = cars.filter((c) => c.isNew);
  if (filter === 'saved') cars = cars.filter((c) => marks.saved[c.id]);

  const by = {
    score: (a, b) => b.score - a.score,
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    km: (a, b) => (a.odometerKm ?? Infinity) - (b.odometerKm ?? Infinity),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
  }[sort];
  return [...cars].sort(by);
}

function render() {
  const cars = visibleCars();
  $('#empty').hidden = cars.length > 0;
  $('#cards').innerHTML = cars.map(cardHtml).join('');

  for (const btn of document.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', onAct);
  }

  // Plenty of sites block hotlinked images. Swap in the placeholder rather
  // than leaving a broken frame where the photo should be.
  for (const img of document.querySelectorAll('.photo img')) {
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
    ? `<img src="${esc(car.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="noimg">No photo in the listing</div>';

  const pm = (title, items) => (items?.length
    ? `<div><h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
    : '');

  return `
  <article class="card ${car.band === 'shortlist' ? 'is-top' : ''} ${saved ? 'is-saved' : ''}">
    <div class="photo">${photo}<div class="flags">${flags.join('')}</div></div>

    <div class="card-head">
      <h3><a href="${esc(car.url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></h3>
      <div class="score ${scoreClass(car.score)}"><b>${car.score}</b><span>match</span></div>
    </div>

    <div class="specs">
      <span><b>${money(car.price)}</b></span>
      <span><b>${car.odometerKm != null ? `${fmt.format(car.odometerKm)} km` : '— km'}</b></span>
      ${car.transmission ? `<span>${esc(car.transmission)}</span>` : ''}
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
      ${cm.checks?.length ? `<div class="checks"><h4>Check before buying</h4><ul>${cm.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    </details>

    <div class="card-foot">
      <span class="meta">${esc(car.source)}${car.firstSeen ? ` · first seen ${new Date(car.firstSeen).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}</span>
      <button type="button" class="act" data-act="save" data-id="${car.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>
      <button type="button" class="act" data-act="reject" data-id="${car.id}">Not for me</button>
      <a class="view" href="${esc(car.url)}" target="_blank" rel="noopener noreferrer">View listing</a>
    </div>
  </article>`;
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

function renderPending() {
  const saved = Object.entries(marks.saved);
  const rejected = Object.entries(marks.rejected);
  const has = saved.length || rejected.length;
  $('#pending').hidden = !has;
  if (!has) return;

  const items = [
    ...saved.map(([, l]) => `<li>Saved: ${esc(l)}</li>`),
    ...rejected.map(([id, l]) => `<li>Not for me: ${esc(l)}${marks.notes[id] ? ` — <em>${esc(marks.notes[id])}</em>` : ''}</li>`),
  ];
  $('#pending-list').innerHTML = items.join('');
}

function renderNearMisses() {
  const near = data.nearMisses || [];
  if (!near.length) return;
  $('#near-misses').hidden = false;
  $('#near-list').innerHTML = near.map((n) => `
    <li>
      <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title || 'Listing')}</a>
      <span><b>${money(n.price)}</b></span>
      <span class="why">${esc(n.rejectReason)}</span>
    </li>`).join('');
}

function renderSources() {
  $('#source-list').innerHTML = (data.sourceHealth || []).map((s) => {
    const cls = s.count > 0 ? 'ok' : (s.blocked ? 'bad' : 'warn');
    const detail = s.count > 0
      ? `${fmt.format(s.count)} listings read`
      : (s.blocked ? 'blocked the scan this time' : 'returned nothing');
    return `<li><span class="dot ${cls}"></span><b>${esc(s.label)}</b><span class="muted">${detail}</span></li>`;
  }).join('');

  const down = (data.sourceHealth || []).filter((s) => s.count === 0);
  $('#source-note').textContent = down.length
    ? 'A site returning nothing usually means it served a bot check rather than that it has no cars. The next scan retries automatically.'
    : '';
}

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

function wire() {
  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      for (const c of document.querySelectorAll('.chip')) c.classList.toggle('is-active', c === chip);
      render();
    });
  }
  $('#sort').addEventListener('change', (e) => { sort = e.target.value; render(); });
  $('#send').addEventListener('click', send);
  $('#clear').addEventListener('click', () => {
    if (!confirm('Clear every save and rejection you have marked?')) return;
    marks = { saved: {}, rejected: {}, notes: {} };
    saveMarks();
    show('Cleared.');
  });
}

boot();
