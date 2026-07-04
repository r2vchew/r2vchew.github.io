#!/usr/bin/env python3
"""Build groceries.html from the per-week JSON files in data/groceries/.

Usage:
    python3 scripts/grocery/build_page.py [data_dir] [out_file]

Takes the two most recent weeks (by YYYY-MM-DD filename). With one week it
builds a simple single-week page. With two, both weeks are embedded and the
page decides client-side which one is live: until the newer week's
valid_from date (always a Thursday), the older week shows with a
"preview next week" toggle; from that date on, the newer week shows
automatically with no toggle. No Thursday-morning swap job is needed.
"""
import json, html, sys, pathlib, re
from datetime import date

REPO = pathlib.Path(__file__).resolve().parents[2]
DATA = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'groceries'
OUT  = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else REPO / 'groceries.html'

SECTIONS = [
    ('beef',    'Beef',                '&#129385;'),
    ('pork',    'Pork',                '&#128022;'),
    ('chicken', 'Chicken &amp; Turkey','&#127831;'),
    ('seafood', 'Seafood',             '&#128031;'),
    ('veggie',  'Veggies',             '&#129382;'),
    ('fruit',   'Fruit',               '&#127827;'),
    ('frozen',  'Frozen &amp; Prepared','&#129482;'),
    ('dairy',   'Dairy &amp; Eggs',    '&#129371;'),
    ('bakery',  'Bakery',              '&#127838;'),
    ('snacks',  'Snacks',              '&#127871;'),
    ('canned',  'Canned &amp; Packaged','&#129387;'),
    ('drinks',  'Beverages',           '&#129380;'),
    ('other',   'Everything Else',     '&#128722;'),
]
STORE_ORDER = ['Calgary Co-op', 'No Frills', 'Real Canadian Superstore', 'Safeway', 'Save-On-Foods', 'Walmart']

def nice_date(iso):
    d = date.fromisoformat(iso)
    return d.strftime('%b ') + str(d.day)

def make_key(store, price, name):
    return re.sub(r'[^a-z0-9]+', '-', f"{store}-{price:.2f}-{name}".lower()).strip('-')

def card(it):
    name   = html.escape(it['name'])
    store  = html.escape(it['store'])
    unit   = f'<span class="u">/{it["unit"]}</span>' if it['unit'] else ''
    bonus  = any(b['bonus'] for b in it['badges'])
    badges = ''.join(
        f'<span class="badge{"" if b["bonus"] else " sv"}">{html.escape(b["text"])}</span>'
        for b in it['badges'])
    search_text = html.escape(' '.join(
        [it['name'], it['store']] + [b['text'] for b in it['badges']]).lower())
    key = html.escape(make_key(it['store'], it['price'], it['name']))
    return (f'  <div class="item" data-store="{store}" data-badge="{int(bonus)}" '
            f'data-search="{search_text}" data-key="{key}" '
            f'data-price="{it["price"]:.2f}" data-unit="{html.escape(it["unit"])}">\n'
            f'    <div class="price">${it["price"]:.2f}{unit}</div>\n'
            f'    <div class="info">\n'
            f'      <div class="name">{name}</div>\n'
            f'      <div class="meta"><span class="store">{store}</span>{badges}</div>\n'
            f'    </div>\n'
            f'  </div>')

def week_block(week, hidden):
    by_cat = {key: [] for key, _, _ in SECTIONS}
    for it in week['items']:
        if it.get('cat') == 'nonfood':
            continue
        by_cat.get(it['cat'], by_cat['other']).append(it)
    secs = []
    for key, label, icon in SECTIONS:
        items = sorted(by_cat[key], key=lambda x: x['price'])
        if not items:
            continue
        cards = '\n'.join(card(it) for it in items)
        secs.append(
            f'<section>\n'
            f'  <h2 class="sec-head collapsed"><span class="ic">{icon}</span>{label} '
            f'<span class="count">({len(items)})</span><span class="chev">&#9662;</span></h2>\n'
            f'  <div class="items">\n{cards}\n  </div>\n</section>')
    stores = sorted({i['store'] for i in week['items']})
    sub = (f"Week of {week['week_of']} &middot; deals valid {nice_date(week['valid_from'])}"
           f" &ndash; {nice_date(week['valid_to'])} &middot; {len(week['items'])} deals across "
           f"{len(stores)} stores &middot; via Flipp")
    names    = sorted({i['name'] for i in week['items']})
    datalist = '\n'.join(f'    <option value="{html.escape(n)}">' for n in names)
    return (f'<div class="week{" hide" if hidden else ""}" data-week="{week["week_of"]}" '
            f'data-from="{week["valid_from"]}" data-sub="{sub}" data-list="sugg-{week["week_of"]}">\n'
            + '\n\n'.join(secs) +
            f'\n<datalist id="sugg-{week["week_of"]}">\n{datalist}\n</datalist>\n</div>')

week_files = sorted(DATA.glob('????-??-??.json'))[-2:]
weeks      = [json.loads(p.read_text(encoding='utf-8')) for p in week_files]
dual       = len(weeks) == 2

all_stores   = sorted({i['store'] for w in weeks for i in w['items']})
STORES       = [s for s in STORE_ORDER if s in all_stores] + [s for s in all_stores if s not in STORE_ORDER]
store_checks = '\n'.join(
    f'      <label><input type="checkbox" value="{html.escape(s)}" checked> {html.escape(s)}</label>'
    for s in STORES)

body = '\n\n'.join(week_block(w, hidden=(i > 0)) for i, w in enumerate(weeks))

w0       = weeks[0]
stores0  = sorted({i['store'] for i in w0['items']})
default_sub = (f"Week of {w0['week_of']} &middot; deals valid {nice_date(w0['valid_from'])}"
               f" &ndash; {nice_date(w0['valid_to'])} &middot; {len(w0['items'])} deals across "
               f"{len(stores0)} stores &middot; via Flipp")

preview_btn = ('\n      <button class="pill" id="weekToggle" type="button" hidden></button>'
               if dual else '')

html_out = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Grocery Deals</title>
<style>
  :root{{--bg:#0f1115;--card:#1a1e27;--line:#2a3040;--ink:#e7ebf3;--mut:#9aa4b8;--accent:#4f8cff;}}
  *{{box-sizing:border-box;-webkit-tap-highlight-color:transparent}}
  body{{margin:0;background:var(--bg);color:var(--ink);
       font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
       padding:env(safe-area-inset-top) 0 48px}}
  .wrap{{max-width:680px;margin:0 auto;padding:0 16px}}
  header{{position:sticky;top:0;z-index:6;background:#11141bf2;backdrop-filter:blur(8px);
         border-bottom:1px solid var(--line);padding:14px 16px}}
  h1{{font-size:20px;margin:0;font-weight:720}}
  .sub{{color:var(--mut);font-size:12.5px;margin-top:4px}}
  a.back{{color:var(--accent);font-size:13px;text-decoration:none}}
  .pill{{margin-top:10px;background:#16243d;border:1px solid #2c4a7c;color:var(--accent);
        border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer}}
  .pill[hidden]{{display:none}}

  /* Tabs */
  .tabs{{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:stretch}}
  .tab-btn{{flex:1 1 80px;padding:8px 0;border:1px solid var(--line);border-radius:9px;
            background:var(--card);color:var(--mut);font:inherit;font-size:13px;
            font-weight:600;cursor:pointer;transition:color .15s,border-color .15s,background .15s}}
  .tab-btn.tab-active{{background:#16243d;border-color:#2c4a7c;color:var(--accent)}}
  .tabs .pill{{margin-top:0;flex:2 1 140px;text-align:center}}

  .search{{margin-top:12px}}
  .search input{{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);
                 border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit}}
  .search input::placeholder{{color:var(--mut)}}
  .search input:focus{{outline:1px solid var(--accent)}}

  .filters{{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
  .dropdown{{position:relative}}
  .dbtn{{background:var(--card);border:1px solid var(--line);color:var(--ink);
        border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;
        display:flex;align-items:center;gap:6px;cursor:pointer}}
  .dbtn .car{{color:var(--mut);font-size:11px}}
  .dpanel{{display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:10;
          background:var(--card);border:1px solid var(--line);border-radius:10px;
          padding:8px;min-width:200px;box-shadow:0 10px 30px #0008}}
  .dpanel.open{{display:block}}
  .dpanel label{{display:flex;align-items:center;gap:8px;padding:6px 6px;
                 font-size:13.5px;border-radius:6px;cursor:pointer}}
  .dpanel label:hover{{background:#11141b}}
  .dpanel .drow{{display:flex;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}}
  .dpanel .drow button{{flex:1;background:#11141b;border:1px solid var(--line);color:var(--mut);
                        border-radius:6px;padding:6px;font-size:12px;cursor:pointer}}
  .toggle{{display:flex;align-items:center;gap:8px;background:var(--card);
          border:1px solid var(--line);border-radius:9px;padding:9px 12px;
          font-size:13px;font-weight:600;cursor:pointer;user-select:none}}
  .toggle input{{accent-color:#37c98a;width:16px;height:16px}}
  .mini{{background:var(--card);border:1px solid var(--line);color:var(--mut);
        border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer}}
  .mini:hover{{color:var(--ink)}}
  .filters-actions{{margin-top:8px}}
  .filters-actions .mini{{flex:1}}

  h2{{font-size:17px;margin:28px 0 10px;font-weight:680;display:flex;align-items:center;gap:8px;
     cursor:pointer;user-select:none}}
  h2 .ic{{font-size:20px}}
  h2 .count{{color:var(--mut);font-weight:500;font-size:13px}}
  h2 .chev{{margin-left:auto;color:var(--mut);font-size:13px;transition:transform .15s}}
  h2.collapsed .chev{{transform:rotate(-90deg)}}
  .items{{display:flex;flex-direction:column;gap:8px}}
  h2.collapsed + .items{{display:none}}
  .item{{display:flex;gap:12px;align-items:flex-start;background:var(--card);
        border:1px solid var(--line);border-radius:12px;padding:11px 13px;
        transition:opacity .15s,transform .15s;user-select:none}}
  .item.hide{{display:none}}
  .item.user-hidden{{display:none}}
  .item.user-hiding{{opacity:0;transform:scale(0.97);pointer-events:none}}
  .week.hide{{display:none}}
  .tab-hidden{{display:none}}
  .price{{flex:0 0 auto;font-weight:720;font-variant-numeric:tabular-nums;
         color:var(--accent);min-width:58px}}
  .price .u{{font-size:11px;font-weight:600;color:var(--mut)}}
  .info{{flex:1;min-width:0}}
  .name{{font-size:14.5px;font-weight:560;line-height:1.35}}
  .meta{{margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}}
  .store{{color:var(--mut);font-size:12px}}
  .badge{{color:#37c98a;font-size:10.5px;border:1px solid #2f6b52;border-radius:5px;
         padding:1px 6px;background:#163326}}
  .badge.sv{{color:#d9a83b;border-color:#6b572f;background:#332a16}}
  section.empty{{display:none}}

  body.searching h2{{display:none}}
  body.searching h2 + .items{{display:flex}}
  body.searching section{{margin-bottom:8px}}

  /* Context menu */
  .ctx-menu{{display:none;position:fixed;z-index:200;background:#1e2330;
             border:1px solid var(--line);border-radius:14px;
             box-shadow:0 8px 32px #000c;min-width:220px;overflow:hidden}}
  .ctx-menu.open{{display:block}}
  .ctx-title{{font-size:11px;color:var(--mut);text-transform:uppercase;
              letter-spacing:.08em;padding:10px 14px 6px;font-weight:600}}
  .ctx-item{{display:block;width:100%;padding:11px 14px;background:none;border:none;
             color:var(--ink);font:inherit;font-size:14px;text-align:left;cursor:pointer}}
  .ctx-item:hover,.ctx-item:active{{background:rgba(255,255,255,.06)}}
  .ctx-cancel{{color:var(--mut);border-top:1px solid var(--line);font-size:13px;margin-top:2px}}

  /* Hidden tab panel */
  .hid-panel{{padding-top:8px}}
  .hid-empty{{color:var(--mut);font-size:14px;text-align:center;padding:40px 0;line-height:1.7}}
  .hid-item{{display:flex;align-items:center;gap:12px;background:var(--card);
             border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:8px}}
  .hid-emoji{{font-size:22px;flex:0 0 auto;line-height:1}}
  .hid-info{{flex:1;min-width:0}}
  .hid-name{{font-size:14px;font-weight:560;line-height:1.3}}
  .hid-meta{{color:var(--mut);font-size:12px;margin-top:3px}}
  .hid-unhide{{flex:0 0 auto;background:none;border:1px solid var(--line);color:var(--mut);
               border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;font:inherit}}
  .hid-unhide:hover{{color:var(--ink);border-color:var(--mut)}}

  .foot{{color:#6f7890;font-size:12px;margin-top:32px;text-align:center}}
</style></head>
<body>
  <header>
    <a class="back" href="index.html">&lsaquo; Home</a>
    <h1 style="margin-top:6px">Grocery Deals &mdash; Cochrane</h1>
    <div class="sub" id="sub">{default_sub}</div>
    <div class="tabs">
      <button class="tab-btn tab-active" id="dealsTabBtn">Deals</button>{preview_btn}
      <button class="tab-btn" id="hiddenTabBtn">Hidden</button>
    </div>
    <div class="search">
      <input type="search" id="searchInput" placeholder="Search items&hellip;" autocomplete="off">
    </div>
    <div class="filters">
      <div class="dropdown" id="storeDropdown">
        <button class="dbtn" id="storeBtn" type="button">Stores <span class="car">&#9662;</span></button>
        <div class="dpanel" id="storePanel">
{store_checks}
          <div class="drow">
            <button type="button" id="storeAll">All</button>
            <button type="button" id="storeNone">None</button>
          </div>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="bonusOnly">
        <span>Bonus offers only</span>
      </label>
    </div>
    <div class="filters filters-actions">
      <button class="mini" id="expandAll" type="button">Expand all</button>
      <button class="mini" id="collapseAll" type="button">Collapse all</button>
    </div>
  </header>
  <div class="wrap">

{body}

  <div id="hiddenPanel" class="hid-panel tab-hidden"></div>

  <div class="foot">Compiled weekly by a Claude routine &middot; Cochrane, AB</div>
  </div>

  <!-- Context menu (long-press / right-click) -->
  <div id="ctxMenu" class="ctx-menu" role="menu">
    <div class="ctx-title">Hide this item</div>
    <button class="ctx-item" data-reason="price">💸&nbsp; Price isn&rsquo;t a deal</button>
    <button class="ctx-item" data-reason="noneed">🚫&nbsp; Don&rsquo;t need it</button>
    <button class="ctx-item" data-reason="notwant">✋&nbsp; Not our thing</button>
    <button class="ctx-item" data-reason="promo">🏷️&nbsp; Promo isn&rsquo;t worth it</button>
    <button class="ctx-item" data-reason="stocked">📦&nbsp; Already stocked</button>
    <button class="ctx-item ctx-cancel" id="ctxCancel">Cancel</button>
  </div>

<script>
(function(){{
  var storeBtn   = document.getElementById('storeBtn');
  var storePanel = document.getElementById('storePanel');
  storeBtn.addEventListener('click', function(e){{
    e.stopPropagation();
    storePanel.classList.toggle('open');
  }});
  document.addEventListener('click', function(e){{
    if (!storePanel.contains(e.target) && e.target !== storeBtn)
      storePanel.classList.remove('open');
  }});

  var storeChecks = storePanel.querySelectorAll('input[type=checkbox]');
  var bonusOnly   = document.getElementById('bonusOnly');
  var searchInput = document.getElementById('searchInput');
  var sub         = document.getElementById('sub');
  var weeks       = Array.prototype.slice.call(document.querySelectorAll('.week'));
  var weekToggle  = document.getElementById('weekToggle');
  var activeWeek  = weeks[0];

  function applyFilters(){{
    var selected = {{}};
    storeChecks.forEach(function(c){{ if (c.checked) selected[c.value] = true; }});
    var bonus    = bonusOnly.checked;
    var query    = searchInput.value.trim().toLowerCase();
    var searching = query.length > 0;
    document.body.classList.toggle('searching', searching);
    activeWeek.querySelectorAll('section').forEach(function(sec){{
      var visible = 0;
      sec.querySelectorAll('.item').forEach(function(it){{
        if (it.classList.contains('user-hidden')) return;
        var ok = selected[it.dataset.store] && (!bonus || it.dataset.badge === '1');
        if (ok && searching) ok = it.dataset.search.indexOf(query) !== -1;
        it.classList.toggle('hide', !ok);
        if (ok) visible++;
      }});
      sec.querySelector('.count').textContent = '(' + visible + ')';
      sec.classList.toggle('empty', visible === 0);
    }});
  }}

  function localDate(iso){{
    var p = iso.split('-');
    return new Date(+p[0], p[1] - 1, +p[2]);
  }}

  function setActiveWeek(w, preview){{
    activeWeek = w;
    weeks.forEach(function(x){{ x.classList.toggle('hide', x !== w); }});
    sub.innerHTML = w.dataset.sub + (preview ? ' &middot; <b>preview</b>' : '');
    searchInput.setAttribute('list', w.dataset.list);
    applyFilters();
  }}

  if (weeks.length === 2 && weekToggle) {{
    var next = weeks[1];
    if (new Date() >= localDate(next.dataset.from)) {{
      setActiveWeek(next, false);
    }} else {{
      setActiveWeek(weeks[0], false);
      weekToggle.hidden = false;
      weekToggle.innerHTML = "Preview next week's flyer &rsaquo;";
      weekToggle.addEventListener('click', function(){{
        var showNext = activeWeek === weeks[0];
        setActiveWeek(showNext ? next : weeks[0], showNext);
        weekToggle.innerHTML = showNext
          ? '&lsaquo; Back to this week'
          : "Preview next week's flyer &rsaquo;";
      }});
    }}
  }} else {{
    setActiveWeek(weeks[0], false);
  }}

  document.getElementById('storeAll').addEventListener('click', function(){{
    storeChecks.forEach(function(c){{ c.checked = true; }});
    applyFilters();
  }});
  document.getElementById('storeNone').addEventListener('click', function(){{
    storeChecks.forEach(function(c){{ c.checked = false; }});
    applyFilters();
  }});
  storeChecks.forEach(function(c){{ c.addEventListener('change', applyFilters); }});
  bonusOnly.addEventListener('change', applyFilters);
  searchInput.addEventListener('input', applyFilters);

  document.getElementById('expandAll').addEventListener('click', function(){{
    activeWeek.querySelectorAll('.sec-head').forEach(function(h){{ h.classList.remove('collapsed'); }});
  }});
  document.getElementById('collapseAll').addEventListener('click', function(){{
    activeWeek.querySelectorAll('.sec-head').forEach(function(h){{ h.classList.add('collapsed'); }});
  }});
  document.querySelectorAll('.sec-head').forEach(function(h){{
    h.addEventListener('click', function(){{ h.classList.toggle('collapsed'); }});
  }});

  // ─── HIDE SYSTEM ────────────────────────────────────────────────────────────

  var REASONS = {{
    price:   {{ emoji: '💸', label: "Price isn’t a deal" }},
    noneed:  {{ emoji: '🚫', label: "Don’t need it" }},
    notwant: {{ emoji: '✋', label: "Not our thing" }},
    promo:   {{ emoji: '🏷️', label: "Promo isn’t worth it" }},
    stocked: {{ emoji: '📦', label: "Already stocked" }}
  }};

  var ctxMenu   = document.getElementById('ctxMenu');
  var ctxTarget = null;
  var lpTimer   = null;

  function openCtx(el, x, y) {{
    ctxTarget = el;
    ctxMenu.style.left = '-9999px';
    ctxMenu.classList.add('open');
    var mw = ctxMenu.offsetWidth  || 230;
    var mh = ctxMenu.offsetHeight || 290;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(x, vw - mw - 8));
    var top  = (y + mh + 8 > vh) ? Math.max(8, y - mh - 8) : y + 8;
    ctxMenu.style.left = left + 'px';
    ctxMenu.style.top  = top  + 'px';
  }}

  function closeCtx() {{
    ctxMenu.classList.remove('open');
    ctxTarget = null;
  }}

  // Long-press (touch)
  document.addEventListener('touchstart', function(e) {{
    var it = e.target.closest('.item');
    if (!it || it.classList.contains('user-hidden')) return;
    var t = e.touches[0];
    var sx = t.clientX, sy = t.clientY;
    lpTimer = setTimeout(function() {{
      openCtx(it, sx, sy);
      if (navigator.vibrate) navigator.vibrate(40);
    }}, 500);
  }}, {{ passive: true }});

  document.addEventListener('touchmove',   function() {{ clearTimeout(lpTimer); }}, {{ passive: true }});
  document.addEventListener('touchend',    function() {{ clearTimeout(lpTimer); }});
  document.addEventListener('touchcancel', function() {{ clearTimeout(lpTimer); }});

  // Right-click (desktop)
  document.addEventListener('contextmenu', function(e) {{
    var it = e.target.closest('.item');
    if (!it || it.classList.contains('user-hidden')) return;
    e.preventDefault();
    openCtx(it, e.clientX, e.clientY);
  }});

  // Dismiss
  document.addEventListener('click', function(e) {{
    if (ctxMenu.classList.contains('open') && !ctxMenu.contains(e.target)) closeCtx();
  }});
  document.addEventListener('keydown', function(e) {{
    if (e.key === 'Escape') closeCtx();
  }});

  // Reason buttons
  ctxMenu.querySelectorAll('[data-reason]').forEach(function(btn) {{
    btn.addEventListener('click', function() {{
      if (!ctxTarget) return;
      var r = REASONS[btn.dataset.reason];
      if (r) doHide(ctxTarget, btn.dataset.reason, r);
      closeCtx();
    }});
  }});
  document.getElementById('ctxCancel').addEventListener('click', closeCtx);

  // Storage helpers
  function getHiddenList(week) {{
    return JSON.parse(localStorage.getItem('gd-hidden-' + week) || '[]');
  }}
  function saveHiddenList(week, list) {{
    localStorage.setItem('gd-hidden-' + week, JSON.stringify(list));
  }}

  function doHide(el, reasonKey, reason) {{
    var weekEl = el.closest('.week');
    var week   = weekEl ? weekEl.dataset.week : '';
    var key    = el.dataset.key;
    var list   = getHiddenList(week);
    if (list.some(function(h) {{ return h.key === key; }})) return;

    var entry = {{
      key: key, week: week,
      store: el.dataset.store,
      name:  el.querySelector('.name').textContent,
      price: el.dataset.price,
      unit:  el.dataset.unit,
      reason: reasonKey,
      emoji:  reason.emoji,
      label:  reason.label
    }};
    list.push(entry);
    saveHiddenList(week, list);

    // Append to curation log (persists across weeks for future engine)
    var log = JSON.parse(localStorage.getItem('gd-hide-log') || '[]');
    log.push(Object.assign({{}}, entry, {{ ts: new Date().toISOString() }}));
    localStorage.setItem('gd-hide-log', JSON.stringify(log));

    el.classList.add('user-hiding');
    setTimeout(function() {{
      el.classList.remove('user-hiding');
      el.classList.add('user-hidden');
      syncHiddenTab();
      applyFilters();
    }}, 150);
  }}

  function doUnhide(key, week) {{
    var list = getHiddenList(week).filter(function(h) {{ return h.key !== key; }});
    saveHiddenList(week, list);
    var el = document.querySelector('.item[data-key="' + key + '"]');
    if (el) {{
      el.classList.remove('user-hidden');
      applyFilters();
    }}
    syncHiddenTab();
  }}

  // Tabs
  var dealsTabBtn  = document.getElementById('dealsTabBtn');
  var hiddenTabBtn = document.getElementById('hiddenTabBtn');
  var hiddenPanel  = document.getElementById('hiddenPanel');

  function getAllHidden() {{
    var all = [];
    weeks.forEach(function(w) {{
      getHiddenList(w.dataset.week).forEach(function(h) {{ all.push(h); }});
    }});
    return all;
  }}

  function escH(s) {{
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }}
  function escA(s) {{
    return String(s).replace(/"/g,'&quot;');
  }}

  function syncHiddenTab() {{
    var all   = getAllHidden();
    var count = all.length;
    hiddenTabBtn.textContent = count ? 'Hidden (' + count + ')' : 'Hidden';
    if (!count) {{
      hiddenPanel.innerHTML =
        '<p class="hid-empty">Nothing hidden yet.<br>'
        + '<span style="font-size:13px">Long-press on mobile &middot; right-click on desktop</span></p>';
      return;
    }}
    hiddenPanel.innerHTML = all.map(function(h) {{
      var priceStr = '$' + parseFloat(h.price).toFixed(2) + (h.unit ? '/' + h.unit : '');
      return '<div class="hid-item">'
        + '<span class="hid-emoji">' + h.emoji + '</span>'
        + '<div class="hid-info">'
        +   '<div class="hid-name">' + escH(h.name) + '</div>'
        +   '<div class="hid-meta">' + escH(h.store) + ' &middot; ' + priceStr + ' &middot; ' + escH(h.label) + '</div>'
        + '</div>'
        + '<button class="hid-unhide" data-key="' + escA(h.key) + '" data-week="' + escA(h.week) + '">Unhide</button>'
        + '</div>';
    }}).join('');
    hiddenPanel.querySelectorAll('.hid-unhide').forEach(function(btn) {{
      btn.addEventListener('click', function() {{
        doUnhide(btn.dataset.key, btn.dataset.week);
      }});
    }});
  }}

  function showDealsTab() {{
    weeks.forEach(function(w) {{ w.classList.remove('tab-hidden'); }});
    hiddenPanel.classList.add('tab-hidden');
    dealsTabBtn.classList.add('tab-active');
    hiddenTabBtn.classList.remove('tab-active');
    applyFilters();
  }}

  function showHiddenTab() {{
    weeks.forEach(function(w) {{ w.classList.add('tab-hidden'); }});
    hiddenPanel.classList.remove('tab-hidden');
    hiddenTabBtn.classList.add('tab-active');
    dealsTabBtn.classList.remove('tab-active');
    syncHiddenTab();
  }}

  dealsTabBtn.addEventListener('click', showDealsTab);
  hiddenTabBtn.addEventListener('click', showHiddenTab);

  // Restore hidden items from localStorage on page load
  weeks.forEach(function(weekEl) {{
    getHiddenList(weekEl.dataset.week).forEach(function(h) {{
      var el = document.querySelector('.item[data-key="' + h.key + '"]');
      if (el) el.classList.add('user-hidden');
    }});
  }});
  syncHiddenTab();

}})();
</script>
</body></html>
'''

OUT.write_text(html_out, encoding='utf-8')
print(f"wrote {len(html_out)} bytes to {OUT}")
print("weeks:", [w['week_of'] for w in weeks], "dual:", dual)
print("stores:", STORES)

# Stable pointer at a fixed filename/URL, mirroring the web page's own
# "which week is live" logic - so any client (e.g. a mobile app) can fetch
# data/groceries/latest.json without knowing today's dated filename.
live = weeks[-1] if (dual and date.today() >= date.fromisoformat(weeks[-1]['valid_from'])) else weeks[0]
(DATA / 'latest.json').write_text(json.dumps(live, indent=1, ensure_ascii=False), encoding='utf-8')
print(f"wrote latest.json (week_of {live['week_of']})")
