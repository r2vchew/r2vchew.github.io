// What the car actually costs before she can drive it.
//
// A sticker price is not the number that leaves her bank account. In Alberta
// the gap is unusually wide and unusually lopsided:
//
//   * A private sale attracts no GST and no PST. A dealer sale attracts 5% GST
//     plus a documentation fee. On a $13,000 car that is roughly $1,250 of
//     difference for the same vehicle.
//   * Calgary needs winter tires. If a listing does not mention them, that is
//     a real four-figure cost in her first month.
//   * A high-kilometre car with no service history is very likely due for
//     brakes and a catch-up service.
//
// Insurance is deliberately excluded — it varies far too much by driver to
// estimate honestly, and she knows to budget for it.

const GST_RATE = 0.05;

// Calgary prices, 2026. Deliberately mid-range rather than best-case: an
// estimate that is usually a little high is far kinder than one that is
// usually a little low.
const PRICES = {
  winterTires: 1100, // four winter tires on steel rims, mounted
  replaceTires: 800, // the current all-seasons are done
  brakes: 550, // front pads and rotors
  catchUpService: 350, // oil, filters, fluids, the things nobody did
  inspection: 150, // independent pre-purchase inspection
  dealerDocFee: 599, // typical Alberta dealer documentation fee
  registration: 95, // plates and registration
};

const SAYS_TIRES_INCLUDED = /(winter|snow)\s*tires?[^.]{0,30}(incl|come|with|on rims|extra set)|2\s*sets?\s*of\s*(tires|wheels|rims)|two\s*sets?\s*of\s*(tires|wheels)|includes?[^.]{0,20}(winter|snow)\s*tires?|new\s*tires?|tires?\s*(are\s*)?(new|excellent|90%|100%)/i;

const SAYS_TIRES_NEEDED = /needs?\s*(new\s*)?tires?|tires?\s*(are\s*)?(bald|worn|need|low|done|at\s*[1-4]\d%)|will\s*need\s*tires?/i;

const SAYS_WORK_NEEDED = /needs?\s*(brakes|rotors|struts|shocks|exhaust|muffler|windshield|battery|work|tlc|repair)|requires?\s*(work|repair)|check\s*engine|warning\s*light|as\s*is\b/i;

const SAYS_RECENTLY_SERVICED = /(recently|just|fully)\s*(serviced|maintained|inspected)|new\s*(brakes|rotors|battery|timing\s*belt)|brakes?\s*(just\s*)?(done|replaced|new)|service\s*records?|maintenance\s*records?|fresh\s*oil|oil\s*(just\s*)?changed|safetied|serviced\s*at/i;

/**
 * Estimate what she will actually spend to get this car on the road.
 *
 * Every line says why it is there and whether it came from the listing or from
 * an assumption, so she can argue with any of it.
 */
export function estimateInitialCost(listing) {
  const text = `${listing.title || ''} ${listing.description || ''}`;
  const items = [];
  const price = listing.price;

  if (price == null) return null;

  // ---- Taxes and fees --------------------------------------------------
  const isDealer = listing.sellerType === 'dealer';
  if (isDealer) {
    items.push({
      label: 'GST (5%)',
      amount: Math.round(price * GST_RATE),
      why: 'dealer sales are taxed; private sales in Alberta are not',
      certain: true,
      kind: 'always',
    });
    items.push({
      label: 'Dealer documentation fee',
      amount: PRICES.dealerDocFee,
      why: 'typical Alberta doc fee — ask for the all-in price, it is negotiable',
      certain: false,
      kind: 'always',
    });
  } else if (listing.sellerType === 'private') {
    items.push({
      label: 'No GST',
      amount: 0,
      why: 'private used-car sales in Alberta are exempt — worth roughly '
        + `$${Math.round(price * GST_RATE).toLocaleString('en-CA')} against a dealer`,
      certain: true,
      kind: 'always',
    });
  } else {
    // We could not tell who is selling. Rather than quietly assume the
    // cheaper answer, budget for the tax and say the assumption out loud.
    items.push({
      label: 'GST, if this is a dealer',
      amount: Math.round(price * GST_RATE),
      why: 'could not tell dealer from private seller — a private sale in Alberta pays no GST, '
        + 'so ask, and take this line off if it is a private sale',
      certain: false,
      kind: 'assumed',
    });
  }

  items.push({
    label: 'Registration and plates',
    amount: PRICES.registration,
    why: 'Alberta registration',
    certain: true,
    kind: 'always',
  });

  // ---- Inspection ------------------------------------------------------
  items.push({
    label: 'Pre-purchase inspection',
    amount: PRICES.inspection,
    why: 'an independent shop looking it over before she commits',
    certain: false,
    kind: 'assumed',
  });

  // ---- Tires -----------------------------------------------------------
  if (SAYS_TIRES_NEEDED.test(text)) {
    items.push({
      label: 'Replacement tires',
      amount: PRICES.replaceTires,
      why: 'the listing says the tires need doing',
      certain: true,
      kind: 'listing',
    });
    items.push({
      label: 'Winter tires',
      amount: PRICES.winterTires,
      why: 'and there is no mention of a winter set',
      certain: false,
      kind: 'assumed',
    });
  } else if (!SAYS_TIRES_INCLUDED.test(text)) {
    items.push({
      label: 'Winter tires',
      amount: PRICES.winterTires,
      why: 'no winter set mentioned, and Calgary needs one',
      certain: false,
      kind: 'assumed',
    });
  }

  // ---- Immediate maintenance ------------------------------------------
  const km = listing.odometerKm;
  const serviced = SAYS_RECENTLY_SERVICED.test(text);

  if (SAYS_WORK_NEEDED.test(text)) {
    items.push({
      label: 'Repairs the listing mentions',
      amount: PRICES.brakes,
      why: 'the seller has flagged work needed — get a quote before offering',
      certain: true,
      kind: 'listing',
    });
  } else if (km != null && km >= 120000 && !serviced) {
    items.push({
      label: 'Brake work',
      amount: PRICES.brakes,
      why: `${Math.round(km / 1000)}k km with no service history mentioned`,
      certain: false,
      kind: 'assumed',
    });
  }

  if (!serviced && ((km != null && km >= 100000) || ageOf(listing) >= 8)) {
    items.push({
      label: 'Catch-up service',
      amount: PRICES.catchUpService,
      why: 'fluids and filters, since nothing recent is mentioned',
      certain: false,
      kind: 'assumed',
    });
  }

  const extras = items.reduce((sum, i) => sum + i.amount, 0);
  const total = price + extras;

  // Confirmed costs are the floor; the uncertain ones may not all land.
  const certainExtras = items.filter((i) => i.certain).reduce((s, i) => s + i.amount, 0);

  return {
    price,
    extras,
    total,
    low: price + certainExtras,
    high: total,
    items,
    // Extras as a share of the sticker — the number that says "this cheap car
    // is not actually cheap".
    uplift: price > 0 ? extras / price : 0,
    sellerTypeKnown: listing.sellerType === 'dealer' || listing.sellerType === 'private',
    tiresIncluded: SAYS_TIRES_INCLUDED.test(text) && !SAYS_TIRES_NEEDED.test(text),
    needsWork: SAYS_WORK_NEEDED.test(text) || SAYS_TIRES_NEEDED.test(text),
    recentlyServiced: serviced,
  };
}

function ageOf(listing) {
  if (!listing.year) return 0;
  return Math.max(0, new Date().getFullYear() - listing.year);
}

export const COST_ASSUMPTIONS = PRICES;
