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
import json, html, sys, pathlib
from datetime import date

REPO = pathlib.Path(__file__).resolve().parents[2]
DATA = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'data' / 'groceries'
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else REPO / 'groceries.html'

SECTIONS = [
    ('beef', 'Beef', '&#129385;'),
    ('pork', 'Pork', '&#128022;'),
    ('chicken', 'Chicken &amp; Turkey', '&#127831;'),
    ('seafood', 'Seafood', '&#128031;'),
    ('veggie', 'Veggies', '&#129382;'),
    ('fruit', 'Fruit', '&#127827;'),
    ('frozen', 'Frozen &amp; Prepared', '&#129482;'),
    ('dairy', 'Dairy &amp; Eggs', '&#129371;'),
    ('bakery', 'Bakery', '&#127838;'),
    ('snacks', 'Snacks', '&#127871;'),
    ('canned', 'Canned &amp; Packaged', '&#129387;'),
    ('other', 'Everything Else', '&#128722;'),
]
STORE_ORDER = ['Calgary Co-op', 'No Frills', 'Real Canadian Superstore', 'Safeway', 'Save-On-Foods']

def nice_date(iso):
    d = date.fromisoformat(iso)
    return d.strftime('%b %-d')

def card(it):
    name = html.escape(it['name'])
    store = html.escape(it['store'])
    unit = f'<span class="u">/{it["unit"]}</span>' if it['unit'] else ''
    bonus = any(b['bonus'] for b in it['badges'])
    badges = ''.join(
        f'<span class="badge{"" if b["bonus"] else " sv"}">{html.escape(b["text"])}</span>'
        for b in it['badges'])
    search_text = html.escape(' '.join(
        [it['name'], it['store']] + [b['text'] for b in it['badges']]).lower())
    return (f'  <div class="item" data-store="{store}" data-badge="{int(bonus)}" data-search="{search_text}">\n'
            f'    <div class="price">${it["price"]:.2f}{unit}</div>\n'
            f'    <div class="info">\n'
            f'      <div class="name">{name}</div>\n'
            f'      <div class="meta"><span class="store">{store}</span>{badges}</div>\n'
            f'    </div>\n'
            f'  </div>')

def week_block(week, hidden):
    by_cat = {key: [] for key, _, _ in SECTIONS}
    for it in week['items']:
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
    names = sorted({i['name'] for i in week['items']})
    datalist = '\n'.join(f'    <option value="{html.escape(n)}">' for n in names)
    return (f'<div class="week{" hide" if hidden else ""}" data-week="{week["week_of"]}" '
            f'data-from="{week["valid_from"]}" data-sub="{sub}" data-list="sugg-{week["week_of"]}">\n'
            + '\n\n'.join(secs) +
            f'\n<datalist id="sugg-{week["week_of"]}">\n{datalist}\n</datalist>\n</div>')

week_files = sorted(DATA.glob('????-??-??.json'))[-2:]
weeks = [json.loads(p.read_text()) for p in week_files]
dual = len(weeks) == 2

all_stores = sorted({i['store'] for w in weeks for i in w['items']})
STORES = [s for s in STORE_ORDER if s in all_stores] + [s for s in all_stores if s not in STORE_ORDER]
store_checks = '\n'.join(
    f'      <label><input type="checkbox" value="{html.escape(s)}" checked> {html.escape(s)}</label>'
    for s in STORES)

body = '\n\n'.join(week_block(w, hidden=(i > 0)) for i, w in enumerate(weeks))

w0 = weeks[0]
stores0 = sorted({i['store'] for i in w0['items']})
default_sub = (f"Week of {w0['week_of']} &middot; deals valid {nice_date(w0['valid_from'])}"
               f" &ndash; {nice_date(w0['valid_to'])} &middot; {len(w0['items'])} deals across "
               f"{len(stores0)} stores &middot; via Flipp")

preview_btn = ('\n    <button class="pill" id="weekToggle" type="button" hidden></button>'
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

  h2{{font-size:17px;margin:28px 0 10px;font-weight:680;display:flex;align-items:center;gap:8px;
     cursor:pointer;user-select:none}}
  h2 .ic{{font-size:20px}}
  h2 .count{{color:var(--mut);font-weight:500;font-size:13px}}
  h2 .chev{{margin-left:auto;color:var(--mut);font-size:13px;transition:transform .15s}}
  h2.collapsed .chev{{transform:rotate(-90deg)}}
  .items{{display:flex;flex-direction:column;gap:8px}}
  h2.collapsed + .items{{display:none}}
  .item{{display:flex;gap:12px;align-items:flex-start;background:var(--card);
        border:1px solid var(--line);border-radius:12px;padding:11px 13px}}
  .item.hide{{display:none}}
  .week.hide{{display:none}}
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

  .foot{{color:#6f7890;font-size:12px;margin-top:32px;text-align:center}}
</style></head>
<body>
  <header>
    <a class="back" href="index.html">&lsaquo; Home</a>
    <h1 style="margin-top:6px">Grocery Deals &mdash; Cochrane</h1>
    <div class="sub" id="sub">{default_sub}</div>{preview_btn}
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
      <button class="mini" id="expandAll" type="button">Expand all</button>
      <button class="mini" id="collapseAll" type="button">Collapse all</button>
    </div>
  </header>
  <div class="wrap">

{body}

  <div class="foot">Compiled weekly by a Claude routine &middot; Cochrane, AB</div>
  </div>

<script>
(function(){{
  var storeBtn = document.getElementById('storeBtn');
  var storePanel = document.getElementById('storePanel');
  storeBtn.addEventListener('click', function(e){{
    e.stopPropagation();
    storePanel.classList.toggle('open');
  }});
  document.addEventListener('click', function(e){{
    if (!storePanel.contains(e.target) && e.target !== storeBtn) {{
      storePanel.classList.remove('open');
    }}
  }});

  var storeChecks = storePanel.querySelectorAll('input[type=checkbox]');
  var bonusOnly = document.getElementById('bonusOnly');
  var searchInput = document.getElementById('searchInput');
  var sub = document.getElementById('sub');
  var weeks = Array.prototype.slice.call(document.querySelectorAll('.week'));
  var weekToggle = document.getElementById('weekToggle');
  var activeWeek = weeks[0];

  function applyFilters(){{
    var selected = {{}};
    storeChecks.forEach(function(c){{ if (c.checked) selected[c.value] = true; }});
    var bonus = bonusOnly.checked;
    var query = searchInput.value.trim().toLowerCase();
    var searching = query.length > 0;
    document.body.classList.toggle('searching', searching);
    activeWeek.querySelectorAll('section').forEach(function(sec){{
      var visible = 0;
      sec.querySelectorAll('.item').forEach(function(it){{
        var ok = selected[it.dataset.store] && (!bonus || it.dataset.badge === '1');
        if (ok && searching) {{
          ok = it.dataset.search.indexOf(query) !== -1;
        }}
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
      // the newer flyer took effect (Thursday): it IS the current week now
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
    h.addEventListener('click', function(){{
      h.classList.toggle('collapsed');
    }});
  }});
}})();
</script>
</body></html>
'''

OUT.write_text(html_out)
print(f"wrote {len(html_out)} bytes to {OUT}")
print("weeks:", [w['week_of'] for w in weeks], "dual:", dual)
print("stores:", STORES)
