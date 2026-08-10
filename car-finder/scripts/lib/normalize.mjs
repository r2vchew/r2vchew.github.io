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

const MAKE_ALIASES = new Map([
  ['vw', 'Volkswagen'],
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

export function inferSellerType(value, fallbackText = '') {
  const t = `${value || ''} ${fallbackText}`.toLowerCase();
  if (/\b(private|for sale by owner|owner|fsbo)\b/.test(t)) return 'private';
  if (/\b(dealer|dealership|inc\.?|ltd\.?|motors|auto\s*(group|sales|centre|center)|sales)\b/.test(t)) {
    return 'dealer';
  }
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
    ?? parseYear((listing.url || '').replace(/\D(19|20)(\d{2})\D/, ' $1$2 '));
  listing.make = canonicalMake(fromTitle.make);
  listing.model = fromTitle.model ? decodeEntities(fromTitle.model) : null;
  listing.trim = fromTitle.trim ? decodeEntities(fromTitle.trim) : null;

  listing.transmission = parseTransmission(listing.transmission)
    ?? parseTransmission(listing.title)
    ?? parseTransmission(listing.description);

  listing.sellerType = listing.sellerType
    ?? inferSellerType(listing.sellerName, listing.location);

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
