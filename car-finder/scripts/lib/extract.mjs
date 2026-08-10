// Generic strategies for pulling structured data out of a listings page.
//
// Car sites change their markup often, so no adapter relies on a single
// selector. Each one tries several extraction strategies in order and uses
// whichever produces the most usable records. When they all come up empty the
// adapter reports that honestly instead of pretending it found nothing to buy.

/** Pull every <script type="application/ld+json"> payload out of a document. */
export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit several concatenated objects, or trailing commas.
      const repaired = raw.replace(/,\s*([}\]])/g, '$1');
      try {
        out.push(JSON.parse(repaired));
      } catch {
        /* genuinely unparseable, skip */
      }
    }
  }
  return out;
}

/** Depth-first walk that yields every object in a nested structure. */
export function* walk(node, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* walk(value, depth + 1);
  }
}

/** Find JSON-LD nodes that look like a vehicle. */
export function vehicleNodes(html) {
  const found = [];
  for (const block of jsonLdBlocks(html)) {
    for (const node of walk(block)) {
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => typeof t === 'string' && /^(Car|Vehicle|Motorcycle|Product)$/i.test(t))) {
        found.push(node);
      }
    }
  }
  return found;
}

/**
 * Extract an embedded state blob. Covers Next.js (`__NEXT_DATA__`), Nuxt, and
 * the various `window.__X__ = {...}` conventions.
 */
export function embeddedState(html) {
  const blobs = [];

  const nextData = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextData) {
    try {
      blobs.push(JSON.parse(nextData[1]));
    } catch { /* ignore */ }
  }

  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__data\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const parsed = tolerantParse(m[1]);
    if (parsed) blobs.push(parsed);
  }

  return blobs;
}

/**
 * Parse JSON that may be followed by trailing script content, by walking
 * forward to the matching closing brace.
 */
export function tolerantParse(text) {
  try {
    return JSON.parse(text);
  } catch { /* fall through to brace matching */ }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Heuristic: find objects anywhere in a state blob that look like a vehicle
 * listing. Works across sites because listing objects nearly always carry a
 * price plus one of year/make/model/mileage.
 */
export function listingLikeObjects(blob) {
  const results = [];
  for (const node of walk(blob)) {
    const keys = Object.keys(node).map((k) => k.toLowerCase());
    const hasPrice = keys.some((k) => /(^|_)price($|_)|askingprice|listprice|amount/.test(k));
    const vehicleSignals = keys.filter((k) =>
      /^(year|modelyear)$/.test(k)
      || /^(make|makename|manufacturer|brand)$/.test(k)
      || /^(model|modelname)$/.test(k)
      || /(mileage|odometer|kilometres|kilometers|^km$)/.test(k)
      || /^vin$/.test(k),
    );
    if (hasPrice && vehicleSignals.length >= 2) results.push(node);
  }
  return results;
}

/**
 * Decode HTML entities. Listing titles arrive entity-encoded even inside
 * JSON-LD, so "Mechanic&apos;s Special" has to be unescaped before display.
 */
export function decodeEntities(value) {
  if (value == null) return value;
  return String(value)
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
        ndash: '–', mdash: '—', hellip: '…', middot: '·',
        eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
      };
      return named[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tags and decode the entities that actually show up in listing text. */
export function textOf(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a money string such as "$12,995" or "12995.00 CAD". */
export function parseMoney(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const cleaned = String(value).replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  // Guard against picking up a phone number or a stock code.
  if (n < 100 || n > 500000) return null;
  return Math.round(n);
}

/** Parse an odometer reading, converting miles to kilometres when flagged. */
export function parseOdometer(value, unitHint = '') {
  if (value == null) return null;
  const asString = String(value);
  const cleaned = asString.replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  let n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const unit = `${unitHint} ${asString}`.toLowerCase();
  if (/\b(mi|mile|miles|smi)\b/.test(unit) && !/\bkm\b/.test(unit)) {
    n *= 1.60934;
  }
  if (n <= 0 || n > 900000) return null;
  return Math.round(n);
}

/** Parse a model year, rejecting nonsense. */
export function parseYear(value) {
  if (value == null) return null;
  const m = String(value).match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = Number.parseInt(m[0], 10);
  const ceiling = new Date().getFullYear() + 2;
  return y >= 1980 && y <= ceiling ? y : null;
}

/** Normalise however a source spells the transmission. */
export function parseTransmission(value) {
  if (!value) return null;
  const t = String(value).toLowerCase();
  if (/\b(manual|standard|stick|[5-7]\s*speed\s*manual|m\/t)\b/.test(t)) return 'manual';
  if (/\b(auto|automatic|cvt|dct|dsg|tiptronic|steptronic|a\/t)\b/.test(t)) return 'automatic';
  return null;
}

/** Absolutise a possibly relative URL. */
export function absoluteUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
