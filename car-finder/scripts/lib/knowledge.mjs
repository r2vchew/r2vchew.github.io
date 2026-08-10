// What the finder actually knows about cars, as opposed to what it can read
// off a listing page. This is the difference between "here are 40 cars" and
// "here are 6 cars, and here is why the other 34 are not worth her Saturday".
//
// Scope is deliberately narrow: the sub-$20k, 2015-and-newer Calgary market,
// judged as a first car for a new driver. Notes are keyed by make + model
// substring, with optional year ranges for generation-specific problems.

export const AB_AVERAGE_KM_PER_YEAR = 20000;

/**
 * verdict values:
 *   'strong'  - actively recommend
 *   'good'    - solid, no reservations worth raising
 *   'caution' - buyable, but there is something she must check
 *   'avoid'   - the known failure mode is expensive and common enough to skip
 */
const MODEL_NOTES = [
  // ---- The safe picks -----------------------------------------------------
  {
    match: { make: 'Toyota', model: /corolla/i },
    verdict: 'strong',
    summary: 'About as close to a no-surprises first car as exists.',
    detail: 'Toyota\'s CVT is one of the few that has proven genuinely durable. Cheap parts, every shop in Calgary knows them, and resale stays strong if she moves on in a few years.',
  },
  {
    match: { make: 'Toyota', model: /(yaris|prius c|echo)/i },
    verdict: 'strong',
    summary: 'Tiny, thrifty and very hard to break.',
    detail: 'Fuel and insurance costs are near the bottom of the market. Small enough to be easy to park, which matters more than it sounds for a new driver.',
  },
  {
    // `si` is deliberately word-bounded: an unanchored match hits "Mitsubishi".
    match: { make: 'Honda', model: /civic/i, yearMin: 2016, yearMax: 2018, engine: /1\.5|turbo|\bex-?t\b|\bsi\b/i },
    verdict: 'caution',
    summary: 'Check which engine it has — the 1.5 turbo had a cold-climate oil problem.',
    detail: 'On 2016-2018 1.5T Civics, unburned fuel could wash into the oil during short winter trips. Honda extended the warranty and reflashed them, but Calgary is exactly the climate that triggered it. The 2.0L naturally aspirated version has none of this. Ask for proof the service bulletin was done, or pick the 2.0.',
  },
  {
    match: { make: 'Honda', model: /civic/i },
    verdict: 'strong',
    summary: 'Deservedly the default answer for a first car.',
    detail: 'Reliable, efficient, holds value, and parts are everywhere. Only real downside is that they are stolen more than average, so check what insurance quotes look like.',
  },
  {
    match: { make: 'Honda', model: /(fit|jazz)/i },
    verdict: 'strong',
    summary: 'Astonishingly practical for its size.',
    detail: 'The folding rear seats swallow more than most small SUVs. Cheap to run and very reliable.',
  },
  {
    match: { make: 'Mazda', model: /(mazda ?3|3 )/i },
    verdict: 'strong',
    summary: 'A conventional automatic, not a CVT — one less thing to worry about.',
    detail: 'Mazda stuck with a traditional 6-speed automatic, which ages more predictably than most CVTs. Nicer to drive than a Corolla. Watch for rust on the rear wheel arches on higher-km Alberta cars.',
  },
  {
    match: { make: 'Mazda', model: /cx-?(3|30|5)/i },
    verdict: 'good',
    summary: 'Small SUV with a real automatic and available AWD.',
    detail: 'A good winter car with AWD, and the same conventional-automatic advantage as the Mazda3. Slightly thirstier than a sedan.',
  },
  {
    match: { make: 'Toyota', model: /(rav ?4|matrix)/i },
    verdict: 'good',
    summary: 'Holds value almost too well — expect to pay a premium.',
    detail: 'Excellent reliability and great in snow with AWD. The catch is price: RAV4s rarely fall into the bargain end of the market.',
  },
  {
    match: { make: 'Honda', model: /cr-?v/i },
    verdict: 'good',
    summary: 'Roomy, reliable, and priced accordingly.',
    detail: 'A safe choice if the budget stretches. 2017-2019 1.5T models share a milder version of the Civic oil-dilution issue — worth asking about.',
  },

  // ---- Good value, with a caveat -----------------------------------------
  {
    match: { make: 'Hyundai', model: /elantra/i },
    verdict: 'good',
    summary: 'Good value; the engine trouble that hit Hyundai mostly missed this one.',
    detail: 'The well-publicised Theta II engine failures affected the larger 2.4L cars (Sonata, Santa Fe), not the Elantra\'s 2.0L Nu engine. Often thousands cheaper than an equivalent Civic. Remaining factory powertrain warranty may still apply.',
  },
  {
    match: { make: 'Kia', model: /(forte|rio|soul)/i },
    verdict: 'good',
    summary: 'Undervalued, and the long factory warranty may still have time left.',
    detail: 'Kia\'s 5-year/100,000 km powertrain coverage carries over to a second owner. Mechanically these are close cousins of the Hyundai equivalents at a slightly lower price.',
  },
  {
    match: { make: 'Hyundai', model: /(accent|venue)/i },
    verdict: 'good',
    summary: 'Cheap to buy, cheap to insure, cheap to fix.',
    detail: 'Nothing exciting, which is the point. A sensible way to spend the least money for a car that still has a warranty history.',
  },
  {
    match: { make: 'Subaru', model: /(impreza|crosstrek)/i },
    verdict: 'good',
    summary: 'Standard AWD — the best winter answer at this price.',
    detail: 'Genuinely better in Calgary snow than anything front-wheel drive. Trade-offs: worse fuel economy, more expensive maintenance, and the CVT is fine but not cheap if it does fail. Check for oil consumption history.',
  },
  {
    match: { make: 'Hyundai', model: /tucson/i },
    verdict: 'good',
    summary: 'Reasonable small SUV, but avoid the 2.4L in older ones.',
    detail: 'The 2.0L and 1.6T are the ones to have. Check the VIN against Hyundai\'s engine recall list before committing.',
  },
  {
    match: { make: 'Volkswagen', model: /(jetta|golf)/i },
    verdict: 'caution',
    summary: 'Lovely to drive, more expensive to keep running.',
    detail: 'Better built and better on the highway than most of this list, but parts and labour cost noticeably more, and the turbo engines need disciplined oil changes to avoid carbon buildup. Fine if she has a trusted independent VW shop; otherwise the repair bills bite.',
  },
  {
    match: { make: 'Ford', model: /(escape|fusion)/i },
    verdict: 'caution',
    summary: 'Decent value, but check transmission and coolant history.',
    detail: 'Cheap for the size. The 1.5L and 1.6L EcoBoost engines had coolant-intrusion problems in some years. A pre-purchase inspection matters more here than on a Corolla.',
  },

  // ---- The ones to walk away from ----------------------------------------
  {
    match: { make: 'Nissan', model: /(sentra|versa|altima|rogue|juke|micra)/i },
    verdict: 'avoid',
    summary: 'The CVT is the problem, and replacing it costs more than the car.',
    detail: 'Nissan\'s continuously variable transmissions from this era fail often, frequently between 120,000 and 180,000 km. A replacement runs $4,000-$6,000 installed. The cars are cheap on the used market for exactly this reason. If one is irresistible, insist on documented CVT replacement or fluid-service history.',
  },
  {
    match: { make: 'Ford', model: /(focus|fiesta)/i, yearMax: 2018 },
    verdict: 'avoid',
    summary: 'The "automatic" is a dual-clutch that Ford was sued over.',
    detail: 'The DPS6 PowerShift shudders, hesitates and eats clutch packs. It was the subject of a class action and a lot of unhappy owners. Technically an automatic, so it will slip past a "no standard" filter — which is exactly why it is called out here.',
  },
  {
    match: { make: 'Chevrolet', model: /cruze/i },
    verdict: 'caution',
    summary: 'Cheap to buy for a reason.',
    detail: 'The 1.4L turbo has a well-known appetite for coolant leaks, water pumps, PCV diaphragms and thermostat housings. None of it is catastrophic, but it adds up to steady small bills.',
  },
  {
    match: { make: 'Jeep', model: /(compass|patriot|renegade)/i },
    verdict: 'avoid',
    summary: 'Poor reliability and a weak CVT, despite looking like a winter car.',
    detail: 'Sits high and looks rugged, but the older Compass/Patriot CVT is fragile and interior and electrical complaints are common. A Crosstrek does the winter job far better.',
  },
  {
    match: { make: 'Dodge', model: /(journey|caliber|avenger)/i },
    verdict: 'avoid',
    summary: 'Consistently near the bottom of reliability rankings.',
    detail: 'Cheap and roomy, but electrical gremlins, brake wear and transmission complaints are the norm rather than the exception.',
  },
  {
    match: { make: 'Fiat' },
    verdict: 'avoid',
    summary: 'Poor reliability and thin parts and service support in Calgary.',
    detail: 'Getting parts and a willing shop is harder than it should be, and the reliability record does not justify the hassle.',
  },
  {
    match: { make: 'Mini' },
    verdict: 'caution',
    summary: 'Fun, but priced like a BMW when it breaks.',
    detail: 'Timing chain, cooling and turbo repairs are all expensive. Not a good match for a first-time owner on a budget.',
  },
  {
    match: { make: /(bmw|mercedes-benz|audi|jaguar|land rover|volvo|porsche)/i },
    verdict: 'caution',
    summary: 'A cheap German or British luxury car is an expensive car with a low sticker.',
    detail: 'Anything in this budget is a former $50,000 car near the end of its cheap years. One suspension or electronics repair can exceed what she paid. Great cars, wrong context.',
  },
  {
    match: { make: 'Chevrolet', model: /(trax|spark|sonic)/i },
    verdict: 'caution',
    summary: 'Acceptable, but outclassed by the Korean and Japanese equivalents.',
    detail: 'Nothing disastrous, just noisier, slower and less reliable than a Rio or Accent for similar money.',
  },
  {
    match: { make: 'Mitsubishi', model: /(mirage|rvr|outlander|lancer)/i },
    verdict: 'caution',
    summary: 'Long warranty is the main draw; the driving experience is not.',
    detail: 'Mitsubishi\'s 10-year powertrain warranty drops to 5 years/100,000 km for a second owner, so check the in-service date. The Mirage in particular is very slow, which is a genuine safety consideration merging onto Deerfoot.',
  },
];

const BODY_NOTES = {
  pickup: 'A pickup is thirsty, harder to park, and light in the back end on ice unless it is loaded or 4WD.',
  convertible: 'A convertible in Calgary is a three-season car with a roof that costs a fortune to fix.',
  coupe: 'Two-door coupes usually carry a noticeably higher insurance premium for a young driver.',
  performance: 'This is a performance trim. In Alberta that means a materially higher premium for a newly licensed driver, and a car that has often been driven hard.',
};

/** Find the first knowledge entry matching this listing. */
export function lookupModelNote(listing) {
  const make = listing.make || '';
  const model = `${listing.model || ''} ${listing.trim || ''} ${listing.title || ''}`;
  const year = listing.year;

  for (const note of MODEL_NOTES) {
    const m = note.match;
    if (m.make) {
      const makeOk = m.make instanceof RegExp
        ? m.make.test(make)
        : String(m.make).toLowerCase() === make.toLowerCase();
      if (!makeOk) continue;
    }
    if (m.model && !m.model.test(model)) continue;
    if (m.engine && !m.engine.test(model)) continue;
    if (m.yearMin && (year == null || year < m.yearMin)) continue;
    if (m.yearMax && (year == null || year > m.yearMax)) continue;
    return note;
  }
  return null;
}

export function lookupBodyNote(listing) {
  const body = String(listing.bodyType || '').toLowerCase();
  const full = `${listing.bodyType || ''} ${listing.title || ''} ${listing.trim || ''}`.toLowerCase();
  if (/pick ?up|truck|\bf-?150\b|silverado|sierra|tacoma|ranger|\bram\b/.test(full)) return BODY_NOTES.pickup;
  if (/convertible|cabrio|roadster/.test(full)) return BODY_NOTES.convertible;
  // Only the actual body style counts as a coupe; a "Sport" trim badge on a
  // four-door hatchback should not trigger the insurance warning.
  if (/coupe/.test(body)) return BODY_NOTES.coupe;
  if (/\bsi\b|\bgti\b|\bsrt\b|\btype ?r\b/.test(full)) return BODY_NOTES.performance;
  return null;
}

/** Expected odometer for a car of this age in Alberta. */
export function expectedKm(year) {
  if (!year) return null;
  const age = Math.max(0, new Date().getFullYear() - year);
  return age * AB_AVERAGE_KM_PER_YEAR;
}
