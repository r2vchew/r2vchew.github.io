import { expectedKm } from './knowledge.mjs';

const money = (n) => (n == null ? 'an unlisted price' : `$${n.toLocaleString('en-CA')}`);
const km = (n) => (n == null ? 'unstated kilometres' : `${n.toLocaleString('en-CA')} km`);

/**
 * Write the human-readable note that appears on the card. Rule-based by
 * default so the system costs nothing to run and never fabricates a fact it
 * cannot see in the listing.
 */
export function writeCommentary(listing, scored, criteria, market) {
  const opening = openingLine(listing, scored, criteria);
  const price = priceLine(listing, market);
  const wear = wearLine(listing);
  const risk = scored.modelNote ? scored.modelNote.detail : null;
  const body = scored.bodyNote;
  const closing = closingLine(listing, scored);

  const paragraphs = [opening, [price, wear].filter(Boolean).join(' '), risk, body, closing]
    .filter((p) => p && p.trim());

  return {
    headline: headlineFor(listing, scored),
    body: paragraphs,
    pros: prosFor(listing, scored),
    cons: consFor(listing, scored),
    checks: checksFor(listing, scored),
  };
}

/**
 * Lead with whatever actually distinguishes this car. A page where every
 * headline is identical trains her to skip the headlines.
 */
function headlineFor(listing, scored) {
  const v = scored.modelNote?.verdict;
  if (v === 'avoid') return 'Cheap for a reason — I would keep looking.';

  const has = (re) => scored.parts.some((p) => p.delta > 0 && re.test(p.label));
  const lacks = (re) => scored.parts.some((p) => p.delta < 0 && re.test(p.label));

  if (scored.score >= 78) {
    if (has(/well below similar/)) return 'Priced under the going rate for one of these.';
    if (has(/low kilometres/) && has(/recent model year/)) return 'Young and barely driven — the pick of this batch.';
    if (has(/low kilometres/)) return 'Unusually low kilometres for the money.';
    if (v === 'strong') return 'A safe, boring, genuinely good first car.';
    return 'One of the stronger options on the list right now.';
  }

  if (scored.score >= 62) {
    if (has(/below similar/)) return 'Decently priced — worth a call.';
    if (lacks(/high kilometres/)) return 'Good buy if the kilometres do not put you off.';
    if (v === 'caution') return 'Worth a look, but read the caveat below first.';
    return 'Worth a look if the inspection comes back clean.';
  }

  if (scored.score >= 48) {
    if (lacks(/above similar|above market/)) return 'Fine car, but you would be paying over the odds.';
    return 'Fine, but there are better uses of a Saturday.';
  }

  return 'Included for completeness rather than because I like it.';
}

function openingLine(listing, scored, criteria) {
  const name = [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'This car';
  const v = scored.modelNote?.verdict;

  if (v === 'avoid') {
    return `${name} at ${money(listing.price)}. The price looks tempting, but this is a model I would steer her away from.`;
  }
  if (v === 'strong') {
    return `${name} at ${money(listing.price)}. This is the kind of car I would put at the top of the list for a first-time driver.`;
  }
  const budget = criteria.hard.maxPrice;
  const underBudget = listing.price != null && budget != null && listing.price <= budget * 0.8;
  if (underBudget) {
    return `${name} at ${money(listing.price)}, which leaves a useful cushion under the ${money(budget)} ceiling for insurance, tires and the first round of maintenance.`;
  }
  return `${name} at ${money(listing.price)}.`;
}

function priceLine(listing, market) {
  const comparable = market?.medianFor(listing);
  if (!comparable || listing.price == null) return null;
  const diff = listing.price - comparable;
  const pct = Math.round((Math.abs(diff) / comparable) * 100);
  if (pct < 6) return `That is right about what similar ones are asking (${money(comparable)} typical).`;
  if (diff < 0) return `That is roughly ${pct}% below the ${money(comparable)} that comparable ones are asking, which is worth a phone call on its own.`;
  return `That is about ${pct}% above the ${money(comparable)} that comparable ones are asking, so there should be room to negotiate.`;
}

function wearLine(listing) {
  if (listing.odometerKm == null) {
    return 'The listing does not state the kilometres, which is the first thing to ask.';
  }
  const expected = expectedKm(listing.year);
  const base = `It shows ${km(listing.odometerKm)}`;
  if (!expected) return `${base}.`;
  const ratio = listing.odometerKm / expected;
  if (ratio < 0.7) return `${base}, well under the ${km(Math.round(expected))} an average Alberta car of that age would have.`;
  if (ratio > 1.35) return `${base}, noticeably more than the ${km(Math.round(expected))} typical for its age — likely highway commuting, so service records matter.`;
  return `${base}, about normal for its age here.`;
}

function closingLine(listing, scored) {
  const bits = [];
  if (listing.sellerType === 'private') {
    bits.push('It is a private sale, so there is usually more negotiating room, but no dealer warranty and she should meet somewhere public.');
  } else if (listing.sellerType === 'dealer') {
    bits.push('Dealer listing, so expect documentation fees on top of the advertised price — ask for the all-in number before going in.');
  }
  if (scored.score >= 62 && scored.modelNote?.verdict !== 'avoid') {
    bits.push('Worth booking an out-of-province-style inspection at an independent shop before any money changes hands.');
  }
  return bits.join(' ');
}

function prosFor(listing, scored) {
  return scored.parts.filter((p) => p.delta > 0).map((p) => p.label).slice(0, 4);
}

function consFor(listing, scored) {
  return scored.parts.filter((p) => p.delta < 0).map((p) => p.label).slice(0, 4);
}

/** Concrete things to verify, tailored to what we know about the car. */
function checksFor(listing, scored) {
  const checks = ['Carfax or equivalent history report', 'Independent pre-purchase inspection'];
  const model = `${listing.make} ${listing.model} ${listing.title}`.toLowerCase();

  if (/nissan|jeep|mitsubishi|subaru|corolla|civic|rogue|sentra|versa/.test(model)) {
    checks.push('CVT fluid service history');
  }
  if (/civic|cr-?v/.test(model) && listing.year >= 2016 && listing.year <= 2019) {
    checks.push('Oil-dilution service bulletin completed (1.5L turbo only)');
  }
  if (/hyundai|kia/.test(model)) {
    checks.push('Engine recall status against the VIN, and whether factory powertrain warranty remains');
  }
  if (/ford/.test(model) && /focus|fiesta/.test(model)) {
    checks.push('Transmission clutch replacement history');
  }
  if (/cruze|chevrolet/.test(model)) checks.push('Coolant system and water pump history');
  if (/volkswagen|audi|bmw|mercedes/.test(model)) checks.push('Service records from a specialist, not just oil changes');
  if (listing.odometerKm != null && listing.odometerKm > 150000) checks.push('Timing belt or chain service, if due');

  checks.push('Winter tires — budget $800-$1,200 if they are not included');
  return [...new Set(checks)].slice(0, 6);
}

/**
 * Optional upgrade: if an Anthropic API key is present, have Claude write a
 * short note per shortlisted car. Falls back silently to the rule-based text,
 * so the system never depends on it.
 */
export async function enhanceWithClaude(cars, criteria) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !cars.length) return cars;

  const subjects = cars.slice(0, 12);
  const payload = subjects.map((c) => ({
    id: c.id,
    car: [c.year, c.make, c.model, c.trim].filter(Boolean).join(' '),
    price: c.price,
    km: c.odometerKm,
    seller: c.sellerType,
    location: c.location,
    score: c.score,
    knownIssue: c.commentary?.cons ?? [],
  }));

  const prompt = [
    'You are helping a parent in Calgary choose a first car for their daughter.',
    `Her scope: ${JSON.stringify(criteria.hard)} and preferences ${JSON.stringify(criteria.soft)}.`,
    'For each car below write ONE sentence of candid, specific advice — the thing a knowledgeable friend would say. No filler, no restating the specs.',
    'Return strict JSON: [{"id": "...", "note": "..."}]. No markdown fence.',
    JSON.stringify(payload),
  ].join('\n\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.log(`  Claude commentary skipped: HTTP ${res.status}`);
      return cars;
    }
    const data = await res.json();
    const text = data.content?.map((c) => c.text).join('') ?? '';
    const notes = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim());
    const byId = new Map(notes.map((n) => [n.id, n.note]));
    for (const car of cars) {
      const note = byId.get(car.id);
      if (note) car.commentary.aiNote = note;
    }
    console.log(`  Claude added notes to ${byId.size} cars`);
  } catch (err) {
    console.log(`  Claude commentary skipped: ${err.message}`);
  }
  return cars;
}
