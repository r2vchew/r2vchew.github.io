import { expectedKm, lookupBodyNote, lookupModelNote } from './knowledge.mjs';

const SALVAGE_RE = /\b(salvage|rebuilt|reconstructed|write[- ]?off|damaged|flood|as[- ]is|parts only|not running|no motor|mechanic special)\b/i;

/**
 * Hard filter. Returns null when the car is acceptable, or a reason string
 * explaining why it was dropped. Reasons are kept so the dashboard can show
 * how much work the finder did on her behalf.
 */
export function rejectReason(listing, criteria) {
  const h = criteria.hard;
  const haystack = `${listing.title || ''} ${listing.description || ''}`;

  // Ordered so the tally reports the most decision-relevant reason first: the
  // categorical dealbreakers, then budget, then the softer numeric limits.
  if (SALVAGE_RE.test(haystack)) return 'salvage, rebuilt or as-is title';
  if (h.transmission === 'automatic' && listing.transmission === 'manual') return 'manual transmission';
  if (listing.price == null) return 'no price listed';
  if (h.minPrice != null && listing.price < h.minPrice) return `under $${h.minPrice} (likely a parts car or a typo)`;
  if (h.maxPrice != null && listing.price > h.maxPrice) return `over budget at $${listing.price.toLocaleString()}`;
  if (h.minYear != null && listing.year != null && listing.year < h.minYear) return `too old (${listing.year})`;
  if (h.maxOdometerKm != null && listing.odometerKm != null && listing.odometerKm > h.maxOdometerKm) {
    return `too many kilometres (${listing.odometerKm.toLocaleString()} km)`;
  }

  const make = (listing.make || '').toLowerCase();
  if ((h.excludeMakes || []).some((m) => m.toLowerCase() === make)) return `${listing.make} excluded by her preferences`;
  const model = `${listing.model || ''} ${listing.title || ''}`.toLowerCase();
  if ((h.excludeModels || []).some((m) => model.includes(m.toLowerCase()))) return 'model excluded by her preferences';

  return null;
}

/**
 * Score a surviving listing from 0-100. The weighting reflects the stated
 * priorities: price first, then the mechanical risk of the specific model,
 * then wear, then fit.
 */
export function scoreListing(listing, criteria, market) {
  const s = criteria.soft;
  const h = criteria.hard;
  const parts = [];
  let score = 50;

  // --- Price against budget and against the market ------------------------
  if (listing.price != null) {
    const idealMax = s.idealPriceMax ?? h.maxPrice;
    if (listing.price <= idealMax) {
      const headroom = (idealMax - listing.price) / Math.max(1, idealMax - (h.minPrice ?? 0));
      const gain = Math.round(14 * Math.min(1, headroom) + 6);
      score += gain;
      parts.push({ label: 'comfortably inside budget', delta: gain });
    } else {
      const over = (listing.price - idealMax) / Math.max(1, (h.maxPrice ?? idealMax) - idealMax);
      const loss = Math.round(10 * Math.min(1, over));
      score -= loss;
      parts.push({ label: 'at the top of the budget', delta: -loss });
    }
  }

  const comparable = market?.medianFor(listing);
  if (comparable && listing.price != null) {
    const ratio = listing.price / comparable;
    if (ratio <= 0.85) { score += 12; parts.push({ label: 'priced well below similar cars', delta: 12 }); }
    else if (ratio <= 0.95) { score += 6; parts.push({ label: 'priced below similar cars', delta: 6 }); }
    else if (ratio >= 1.2) { score -= 10; parts.push({ label: 'priced above similar cars', delta: -10 }); }
    else if (ratio >= 1.08) { score -= 4; parts.push({ label: 'slightly above market', delta: -4 }); }
  }

  // --- What we know about this specific model -----------------------------
  const note = lookupModelNote(listing);
  if (note) {
    const weights = { strong: 18, good: 10, caution: -12, avoid: -30 };
    const delta = weights[note.verdict] ?? 0;
    score += delta;
    parts.push({ label: note.summary, delta });
  } else if ((s.preferMakes || []).some((m) => m.toLowerCase() === (listing.make || '').toLowerCase())) {
    score += 6;
    parts.push({ label: 'from a make with a good reliability record', delta: 6 });
  }

  // --- Wear -----------------------------------------------------------------
  if (listing.odometerKm != null) {
    const ideal = s.idealOdometerKm ?? 140000;
    if (listing.odometerKm <= ideal * 0.6) { score += 12; parts.push({ label: 'low kilometres', delta: 12 }); }
    else if (listing.odometerKm <= ideal) { score += 6; parts.push({ label: 'reasonable kilometres', delta: 6 }); }
    else { score -= 6; parts.push({ label: 'high kilometres', delta: -6 }); }

    const expected = expectedKm(listing.year);
    if (expected && listing.odometerKm < expected * 0.75) {
      score += 5;
      parts.push({ label: 'driven less than average for its age', delta: 5 });
    } else if (expected && listing.odometerKm > expected * 1.35) {
      score -= 5;
      parts.push({ label: 'driven harder than average for its age', delta: -5 });
    }
  } else {
    score -= 4;
    parts.push({ label: 'kilometres not stated', delta: -4 });
  }

  // --- Age --------------------------------------------------------------------
  if (listing.year != null) {
    const age = new Date().getFullYear() - listing.year;
    if (age <= 5) { score += 8; parts.push({ label: 'recent model year', delta: 8 }); }
    else if (age >= 9) { score -= 5; parts.push({ label: 'getting on in years', delta: -5 }); }
  }

  // --- Body style fit ---------------------------------------------------------
  const body = String(listing.bodyType || listing.title || '').toLowerCase();
  if ((s.avoidBodyTypes || []).some((b) => body.includes(b.toLowerCase()))) {
    score -= 8;
    parts.push({ label: 'body style she did not ask for', delta: -8 });
  } else if ((s.preferBodyTypes || []).some((b) => body.includes(b.toLowerCase()))) {
    score += 4;
    parts.push({ label: 'practical body style', delta: 4 });
  }

  if (s.wantAwd) {
    // Kijiji reports drivetrain as a schema.org URL ("AllWheelDriveConfiguration"),
    // so the separator between "all" and "wheel" has to be optional.
    const awd = /\b(awd|4wd|4x4|all[-\s]?wheel|four[-\s]?wheel|quattro|4motion|xdrive|s-?awc)/i
      .test(`${listing.title} ${listing.drivetrain} ${listing.description}`);
    if (awd) { score += 8; parts.push({ label: 'all-wheel drive', delta: 8 }); }
  }

  // --- Data quality -----------------------------------------------------------
  if (!listing.imageUrl) { score -= 3; parts.push({ label: 'no photo in the listing', delta: -3 }); }
  if (listing.sellerType === 'private') {
    score += 3;
    parts.push({ label: 'private seller, so usually more room to negotiate', delta: 3 });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    parts: parts.filter((p) => p.delta !== 0),
    modelNote: note,
    bodyNote: lookupBodyNote(listing),
  };
}

export function bandFor(score) {
  if (score >= 78) return 'shortlist';
  if (score >= 62) return 'worth a look';
  if (score >= 48) return 'maybe';
  return 'probably not';
}

/**
 * A crude local market model: median asking price per make+model+year bucket,
 * built from the listings we already have. Good enough to spot a car that is
 * notably cheap or notably overpriced relative to its peers.
 */
export function buildMarket(listings) {
  // A wrecked or as-is car is not evidence of what a sound one costs, so it is
  // kept out of the comparison set even though it is genuinely on the market.
  const sound = listings.filter(
    (l) => l.price != null
      && l.make && l.model
      && !SALVAGE_RE.test(`${l.title || ''} ${l.description || ''}`),
  );

  const tightBuckets = new Map();
  const looseBuckets = new Map();
  for (const l of sound) {
    const tight = `${l.make}|${l.model}|${l.year ?? '?'}`.toLowerCase();
    const loose = `${l.make}|${l.model}`.toLowerCase();
    if (!tightBuckets.has(tight)) tightBuckets.set(tight, []);
    if (!looseBuckets.has(loose)) looseBuckets.set(loose, []);
    tightBuckets.get(tight).push({ id: l.id, price: l.price });
    looseBuckets.get(loose).push({ id: l.id, price: l.price });
  }

  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  // Comparing a car against a median it is itself part of drags the benchmark
  // toward the car, which hides exactly the bargains we are looking for.
  const peersOf = (bucket, listing) =>
    (bucket || []).filter((e) => e.id !== listing.id).map((e) => e.price);

  return {
    medianFor(listing) {
      if (!listing.make || !listing.model) return null;
      const tight = peersOf(
        tightBuckets.get(`${listing.make}|${listing.model}|${listing.year ?? '?'}`.toLowerCase()),
        listing,
      );
      if (tight.length >= 3) return median(tight);
      const loose = peersOf(looseBuckets.get(`${listing.make}|${listing.model}`.toLowerCase()), listing);
      if (loose.length >= 4) return median(loose);
      return null;
    },
  };
}
