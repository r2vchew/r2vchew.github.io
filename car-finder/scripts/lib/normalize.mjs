import { createHash } from 'node:crypto';
import { decodeEntities, parseTransmission, parseYear } from './extract.mjs';

/**
 * A car classified-ads category is not only cars. Kijiji's Cars & Trucks
 * section happily carries hoists, trailers, rims and "we buy your car" ads,
 * and a $5,969 four-post car lift with 0 km scores extremely well against
 * criteria written for cars.
 */
const NOT_A_CAR = new RegExp([
  '\\b(car ?lift|hoist|4 ?post|two ?post|post lift)\\b',
  '\\b(trailer|camper|rv\\b|motorhome|skidoo|snowmobile|atv|quad|dirt ?bike|boat)\\b',
  '\\b(rims?|tires?|wheels?|winter package|tire package)\\b(?!.*\\b(included|with)\\b)',
  '\\b(engine|transmission|motor|parts?|bumper|hood|door|seat|canopy|tonneau) (only|for sale)\\b',
  '\\b(we buy|cash for|wanted|looking for|financing available|bad credit|loan|approved)\\b',
  '\\b(detailing|repair|service|towing|storage|rental|rent a|insurance)\\b',
].join('|'), 'i');

/**
 * True when a record plausibly describes a car. Requires either a model year
 * or a recognised make — a listing with neither is almost never a vehicle.
 */
export function looksLikeVehicle(listing) {
  const text = `${listing.title || ''} ${listing.model || ''} ${listing.trim || ''}`;
  if (NOT_A_CAR.test(text)) return false;
  if (listing.vin) return true;
  return Boolean(listing.year) || Boolean(listing.make);
}

/**
 * Recover a model year from a URL slug, but only when it stands alone as its
 * own hyphenated word. Scanning the whole URL for four digits happily reads
 * "2019" out of a listing id like 20194837, and a wrong year on the card is
 * worse than a blank one.
 */
function yearFromSlug(url) {
  if (!url) return null;
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url);
  }
  const ceiling = new Date().getFullYear() + 1;
  const words = path.split(/[^0-9a-z]+/i);
  for (const word of words) {
    if (!/^(19|20)\d{2}$/.test(word)) continue;
    const year = Number.parseInt(word, 10);
    if (year >= 1990 && year <= ceiling) return year;
  }
  return null;
}

/**
 * Kijiji's structured data reports models in lower case ("forte"), so titles
 * come out as "Kia forte". Capitalise words, but leave anything already
 * containing a capital or a digit alone so CX-5, RAV4 and F-150 survive.
 */
function tidyModel(model) {
  return model
    .split(/\s+/)
    .map((word) => (/[A-Z0-9]/.test(word) ? word : word.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join(' ');
}

/** Trim the boilerplate aggregators wrap around a title. */
function tidyTitle(title) {
  if (!title) return null;
  return decodeEntities(title)
    .replace(/^\s*(used|new|pre-?owned)\s+/i, '')
    .replace(/\s+for sale\b.*$/i, '')
    .replace(/\s*\|\s*$/, '')
    .trim() || null;
}

const KNOWN_MAKES = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Fiat', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar',
  'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini',
  'Mitsubishi', 'Nissan', 'Polestar', 'Pontiac', 'Porsche', 'Ram', 'Saturn', 'Scion',
  'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
];

/**
 * Sites use filler values when a seller did not pick from the dropdown.
 * Kijiji's is "othrmdl", which rendered as "2018 Kia Othrmdl LX+" — while the
 * listing title said "2018 Kia Rio 5-door LX+" all along. Treating these as
 * absent lets the title parser supply the real model.
 */
const PLACEHOLDER = /^(othrmdl|othr|other|others|unknown|unspecified|n\/?a|none|misc|various|model|make)$/i;

export function isPlaceholder(value) {
  return value == null || PLACEHOLDER.test(String(value).trim());
}

const MAKE_ALIASES = new Map([
  ['vw', 'Volkswagen'],
  // Misspellings common enough in seller-typed titles to be worth catching;
  // otherwise "Volkwagen" becomes a make of its own alongside Volkswagen.
  ['volkwagen', 'Volkswagen'],
  ['volkswagon', 'Volkswagen'],
  ['hundai', 'Hyundai'],
  ['hyndai', 'Hyundai'],
  ['toyata', 'Toyota'],
  ['mistubishi', 'Mitsubishi'],
  ['chevorlet', 'Chevrolet'],
  ['chevy', 'Chevrolet'],
  ['mercedes', 'Mercedes-Benz'],
  ['mercedes benz', 'Mercedes-Benz'],
  ['benz', 'Mercedes-Benz'],
  ['landrover', 'Land Rover'],
  ['alfa', 'Alfa Romeo'],
  ['mini cooper', 'Mini'],
]);

/** Recover make/model/trim from a free-text listing title. */
export function parseTitle(title, seed = {}) {
  const out = {
    year: seed.year ?? null,
    make: seed.make ?? null,
    model: seed.model ?? null,
    trim: seed.trim ?? null,
  };
  if (!title) return out;

  const clean = String(title).replace(/\s+/g, ' ').trim();
  out.year = out.year ?? parseYear(clean);

  if (!out.make) {
    const lower = clean.toLowerCase();
    for (const [alias, canonical] of MAKE_ALIASES) {
      if (lower.includes(alias)) { out.make = canonical; break; }
    }
    if (!out.make) {
      const hit = KNOWN_MAKES.find((mk) => lower.includes(mk.toLowerCase()));
      if (hit) out.make = hit;
    }
  }

  if (out.make && !out.model) {
    const idx = clean.toLowerCase().indexOf(out.make.toLowerCase());
    if (idx >= 0) {
      const rest = clean.slice(idx + out.make.length).trim();
      const words = rest.split(/[\s,|]+/).filter(Boolean);
      if (words.length) {
        out.model = words[0];
        if (words.length > 1) out.trim = out.trim ?? words.slice(1, 3).join(' ');
      }
    }
  }

  return out;
}

export function canonicalMake(value) {
  if (!value) return null;
  const lower = String(value).trim().toLowerCase();
  if (MAKE_ALIASES.has(lower)) return MAKE_ALIASES.get(lower);
  const hit = KNOWN_MAKES.find((mk) => mk.toLowerCase() === lower);
  return hit || String(value).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Dealers give themselves away in the ad copy long before they say "dealer":
// AMVIC licensing text, financing offers, stock numbers, and the giveaway
// "thanks for viewing our inventory".
const DEALER_SIGNALS = /\b(amvic|dealer|dealership|our (inventory|dealership|lot|showroom)|financ(e|ing)|lease|trade[- ]?in|warranty available|extended warranty|(no|bad|good) credit|stock\s*#|doc(umentation)?\s*fee|admin\s*fee|certified pre-?owned|book (a|your) test drive|view(ing)? our)\b/i;

// Private sellers write like people, and often advertise the tax saving.
const PRIVATE_SIGNALS = /\b(private sale|private seller|selling my|my (car|vehicle|daughter'?s|son'?s|wife'?s|husband'?s)|no dealers|first owner|one owner since new|no gst|no tax|for sale by owner|fsbo)\b/i;

// A business name, as opposed to a person's name.
const BUSINESS_NAME = /\b(inc\.?|ltd\.?|llc|corp|motors?|auto|autos|automotive|dealership|group|sales|centre|center|imports?|cars?|garage|superstore|nissan|toyota|honda|ford|hyundai|kia|mazda|subaru|volkswagen|chevrolet|gmc|dodge|chrysler|jeep|bmw|audi|mercedes|lexus|acura|infiniti|volvo|mitsubishi)\b/i;

/**
 * Work out whether a car is being sold by a dealer or by its owner.
 *
 * This matters more than it looks: in Alberta a dealer sale carries 5% GST and
 * a documentation fee that a private sale does not, so getting it wrong moves
 * the real cost by four figures. Where the evidence is genuinely ambiguous this
 * returns null rather than guessing, and the cost estimate says so.
 */
export function inferSellerType(listing = {}) {
  const name = listing.sellerName || '';
  const text = `${listing.title || ''} ${listing.description || ''}`;

  // What the seller says about themselves beats anything inferred.
  if (PRIVATE_SIGNALS.test(text)) return 'private';
  if (DEALER_SIGNALS.test(text) || DEALER_SIGNALS.test(name)) return 'dealer';

  // A named seller on a dealer-inventory site is a dealer. AutoTrader and
  // Carpages are overwhelmingly dealer stock; Kijiji is genuinely mixed, so
  // a name alone is not enough there.
  if (name && BUSINESS_NAME.test(name)) return 'dealer';
  if (name && ['autotrader', 'carpages', 'cargurus'].includes(listing.source)) return 'dealer';

  return null;
}

/**
 * A listing's identity has to survive the site re-issuing its internal ids and
 * re-listing the same car, otherwise a car she already rejected keeps coming
 * back. We key on the details of the car itself, with the source id only as a
 * tiebreaker when those details are thin.
 */
export function listingId(listing) {
  const strong = [listing.year, listing.make, listing.model, listing.price, listing.odometerKm]
    .filter((v) => v != null);
  const basis = strong.length >= 4
    ? strong.join('|').toLowerCase()
    : `${listing.source}|${listing.sourceId || listing.url || ''}`.toLowerCase();
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

const EMPTY = {
  source: null,
  sourceId: null,
  url: null,
  title: null,
  year: null,
  make: null,
  model: null,
  trim: null,
  price: null,
  odometerKm: null,
  transmission: null,
  drivetrain: null,
  fuel: null,
  bodyType: null,
  exteriorColour: null,
  location: null,
  sellerType: null,
  sellerName: null,
  imageUrl: null,
  vin: null,
  description: null,
};

/** Fold a raw source record into the canonical shape used everywhere else. */
export function normalize(raw) {
  const listing = { ...EMPTY, ...raw };

  listing.title = tidyTitle(listing.title);
  listing.description = listing.description ? decodeEntities(listing.description) : null;
  listing.sellerName = listing.sellerName ? decodeEntities(listing.sellerName) : null;
  listing.location = listing.location ? decodeEntities(listing.location) : null;

  // Drop filler values before seeding the title parser, or it treats
  // "othrmdl" as a real model and never looks at the title.
  for (const field of ['make', 'model', 'trim']) {
    if (isPlaceholder(listing[field])) listing[field] = null;
  }

  const fromTitle = parseTitle(listing.title, {
    year: listing.year,
    make: listing.make,
    model: listing.model,
    trim: listing.trim,
  });
  listing.year = fromTitle.year
    // AutoTrader's structured data often omits the year from the name, so fall
    // back to the description and the URL slug before giving up on it.
    ?? parseYear(listing.description)
    ?? yearFromSlug(listing.url);
  listing.make = canonicalMake(fromTitle.make);
  listing.model = fromTitle.model ? tidyModel(decodeEntities(fromTitle.model)) : null;
  listing.trim = fromTitle.trim ? decodeEntities(fromTitle.trim) : null;

  listing.transmission = parseTransmission(listing.transmission)
    ?? parseTransmission(listing.title)
    ?? parseTransmission(listing.description);

  listing.sellerType = listing.sellerType ?? inferSellerType(listing);

  if (!listing.title && listing.year && listing.make) {
    listing.title = [listing.year, listing.make, listing.model, listing.trim]
      .filter(Boolean).join(' ');
  }

  listing.id = listingId(listing);
  return listing;
}

/**
 * Collapse the same car appearing on more than one site. Keeps the record with
 * the most complete data and remembers everywhere it was seen, so she gets one
 * row per car rather than four.
 */
export function dedupe(listings) {
  const completeness = (l) =>
    [l.price, l.odometerKm, l.year, l.make, l.model, l.imageUrl, l.transmission, l.vin]
      .filter((v) => v != null).length;

  const byKey = new Map();
  for (const listing of listings) {
    const vinKey = listing.vin ? `vin:${String(listing.vin).toUpperCase()}` : null;
    const key = vinKey || `id:${listing.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...listing, alsoOn: [] });
      continue;
    }
    const winner = completeness(listing) > completeness(existing) ? { ...listing } : existing;
    const loser = winner === existing ? listing : existing;
    winner.alsoOn = [...new Set([
      ...(existing.alsoOn || []),
      ...(listing.alsoOn || []),
      loser.source,
    ])].filter((s) => s && s !== winner.source);
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}
