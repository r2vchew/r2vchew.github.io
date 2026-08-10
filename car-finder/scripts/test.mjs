#!/usr/bin/env node
// Regression tests for the parsing that live scans proved fragile.
// No framework: `node scripts/test.mjs`, non-zero exit on failure.

import { cardScan } from './lib/cards.mjs';
import { decodeEntities, parseMoney, parseOdometer, parseTransmission } from './lib/extract.mjs';
import { looksLikeVehicle, normalize } from './lib/normalize.mjs';
import { BANDS, bandFor, buildMarket, rejectReason } from './lib/score.mjs';
import { interpret } from './lib/interpret.mjs';
import { estimateInitialCost } from './lib/costs.mjs';
import carpages from './sources/carpages.mjs';

let failures = 0;
let checks = 0;

function check(name, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}

function group(title, fn) {
  console.log(`\n${title}`);
  fn();
}

const criteria = {
  hard: {
    minPrice: 3000, maxPrice: 13000, minYear: 2010, maxOdometerKm: 180000,
    transmission: 'automatic', excludeMakes: [], excludeModels: [],
  },
  soft: {
    idealPriceMax: 10000, idealOdometerKm: 140000,
    preferMakes: ['Toyota', 'Honda'], preferBodyTypes: ['Sedan'],
    avoidBodyTypes: ['Pickup'], wantAwd: false,
  },
  location: { radiusKm: 150 },
};

group('card scanning', () => {
  const card = (slug, title, price, km) => `
    <div class="listing-card">
      <a href="/used-cars/alberta/calgary/${slug}-1234567/"><img src="/i/${slug}.jpg" alt="${title}"></a>
      <a href="/used-cars/alberta/calgary/${slug}-1234567/"><h2>${title}</h2></a>
      <span class="price">$${price}</span><span class="km">${km} km</span>
      <span class="loc">Calgary, AB</span>
    </div>`;

  const html = [
    card('2016-mazda-cx-5', 'Used 2016 Mazda CX-5 GS for sale in Calgary, AB', '15,995', '98,000'),
    card('2016-ford-escape', 'Used 2016 Ford Escape SE for sale in Calgary, AB', '8,100', '162,000'),
    card('2019-honda-civic', 'Used 2019 Honda Civic LX for sale in Calgary, AB', '17,900', '61,000'),
  ].join('\n');

  const rows = cardScan(html, { linkPattern: carpages.linkPattern, baseUrl: 'https://www.carpages.ca' });

  // Two links per card must yield one card, not half a card.
  check('one row per card', rows.length, 3);
  // Each card keeps its own numbers rather than a neighbour's.
  check('prices stay with their card', rows.map((r) => r.price), [15995, 8100, 17900]);
  check('mileage stays with its card', rows.map((r) => r.odometerKm), [98000, 162000, 61000]);

  // A price followed by a mileage must not merge into one giant number.
  const merged = cardScan(
    `<a href="/used-cars/alberta/calgary/a-b-1234567/">x</a><span>$8,100 162,000 km</span>`,
    { linkPattern: carpages.linkPattern, baseUrl: 'https://www.carpages.ca' },
  );
  check('adjacent numbers do not merge', merged[0]?.price, 8100);
  check('and the mileage survives too', merged[0]?.odometerKm, 162000);

  // A price with no mileage beside it is treated as a misread, not a bargain.
  const uncorroborated = cardScan(
    `<a href="/used-cars/alberta/calgary/e-f-1234567/">x</a><span>$4,800</span>`,
    { linkPattern: carpages.linkPattern, baseUrl: 'https://www.carpages.ca' },
  );
  check('price without mileage is dropped', uncorroborated.length, 0);

  // Financing figures are not the asking price.
  const financed = cardScan(
    `<a href="/used-cars/alberta/calgary/c-d-1234567/">x</a><span>$14,995</span><span>$149 bi-weekly</span><span>90,000 km</span>`,
    { linkPattern: carpages.linkPattern, baseUrl: 'https://www.carpages.ca' },
  );
  check('ignores bi-weekly payments', financed[0]?.price, 14995);
});

group('value parsing', () => {
  check('money with comma', parseMoney('$12,995'), 12995);
  check('money rejects phone-like', parseMoney('4035551234'), null);
  check('odometer km', parseOdometer('143,000', 'km'), 143000);
  check('odometer miles converts', parseOdometer('50,000', 'mi'), 80467);
  check('transmission manual', parseTransmission('6-speed manual'), 'manual');
  check('transmission cvt is automatic', parseTransmission('CVT'), 'automatic');
  check('entities decoded', decodeEntities('Mechanic&apos;s W&amp;S'), "Mechanic's W&S");
});

group('what counts as a car', () => {
  const v = (title, extra = {}) => normalize({ source: 'kijiji', url: 'u', title, ...extra });
  check('car lift is not a car', looksLikeVehicle(v('Unique Lifts 9000lbs 4 Post Car Lift')), false);
  check('tires are not a car', looksLikeVehicle(v('4 winter tires and rims')), false);
  check('we-buy ad is not a car', looksLikeVehicle(v('WE BUY CARS cash today')), false);
  check('real car is a car', looksLikeVehicle(v('2018 Toyota Corolla LE')), true);
  check('make without year still counts', looksLikeVehicle(v('Kia Forte EX')), true);
  check('title tidied', v('Used 2016 Mazda CX-5 for sale in Calgary, AB').title, '2016 Mazda CX-5');
  check('year from url slug', v('Kia Forte EX', { url: 'https://www.autotrader.ca/offers/kia-forte-ex-2018-black' }).year, 2018);
  // A listing id that merely starts with 20xx is not a model year.
  check('listing id is not a year', v('Kia Forte EX', { url: 'https://www.autotrader.ca/offers/kia-forte-ex-black-20194837' }).year, null);
  check('lowercase model capitalised', v('Kia forte EX').model, 'Forte');
  check('model with digits left alone', v('Mazda CX-5 GS').model, 'CX-5');
  // Kijiji sends "othrmdl" when the seller skipped the model dropdown; the
  // real model is in the title.
  check('placeholder model falls back to the title',
    normalize({ source: 'kijiji', url: 'u', title: '2018 Kia Rio 5-door LX+', make: 'kia', model: 'othrmdl' }).model, 'Rio');
  check('misspelled make canonicalised', v('2016 Volkwagen Beetle Trendline').make, 'Volkswagen');
  check('query string ids ignored', v('Kia Forte EX', { url: 'https://x.ca/vdp.action?listingId=201948371' }).year, null);
});

group('hard filters', () => {
  const base = { price: 9900, year: 2018, odometerKm: 100000, transmission: 'automatic' };
  check('clean car kept', rejectReason({ ...base, title: '2018 Corolla LE' }, criteria), null);
  check("mechanic's special rejected", rejectReason({ ...base, title: "2018 Kia Sportage Mechanic's Special" }, criteria), 'salvage, rebuilt or as-is title');
  check('manual rejected', rejectReason({ ...base, transmission: 'manual', title: 'x' }, criteria), 'manual transmission');
  check('over budget rejected', rejectReason({ ...base, price: 25000, title: 'x' }, criteria), 'over budget at $25,000');
  check('2011 now in scope', rejectReason({ ...base, year: 2011, title: 'x' }, criteria), null);
  check('too old rejected', rejectReason({ ...base, year: 2008, title: 'x' }, criteria), 'too old (2008)');
});

group('score bands', () => {
  // A real scan topped out at 76. If the shortlist cutoff drifts above what
  // the scoring can actually produce, the page claims nothing qualified while
  // listing dozens of cars.
  check('shortlist is reachable', BANDS.shortlist <= 76, true);
  check('bands descend', BANDS.shortlist > BANDS.worthALook && BANDS.worthALook > BANDS.maybe, true);
  check('top of a real scan makes the shortlist', bandFor(76), 'shortlist');
  check('mid scan is worth a look', bandFor(57), 'worth a look');
  check('median scan is not', bandFor(39), 'probably not');
});

group('market comparison', () => {
  const car = (id, year, price) => ({ id, year, price, make: 'Hyundai', model: 'Elantra', title: `${year} Hyundai Elantra` });
  // Four 2018s and one old cheap one. The old car must not be scored against
  // the newer field — that reported "64% below market" on a real scan.
  const market = buildMarket([
    car('a', 2018, 11000), car('b', 2018, 11500), car('c', 2018, 12000),
    car('d', 2019, 12500), car('e', 2012, 3500),
  ]);
  check('old car gets no cross-generation benchmark', market.medianFor(car('e', 2012, 3500)), null);
  check('same-generation car still compared', market.medianFor(car('a', 2018, 11000)) > 0, true);
  check('unknown year gets no benchmark', market.medianFor({ id: 'z', year: null, price: 9000, make: 'Hyundai', model: 'Elantra' }), null);
});

group('plain-English feedback', () => {
  const paths = (note) => interpret(note, criteria).changes.map((c) => `${c.path}=${JSON.stringify(c.value)}`);
  check('budget raise', paths("I'd go up to $18,000").includes('hard.maxPrice=18000'), true);
  check('mileage cap', paths('nothing over 150,000 km').includes('hard.maxOdometerKm=150000'), true);
  check('year floor', paths('2018 or newer').includes('hard.minYear=2018'), true);
  check('exclude a make', paths('no nissans').some((p) => p.startsWith('hard.excludeMakes=') && p.includes('Nissan')), true);
  check('inflected verbs understood', interpret('she wants a hatchback', criteria).understood, true);
  check('unrelated note flagged', interpret('I do not like the blue one', criteria).unmatched, true);
});

group('what it really costs', () => {
  const base = { price: 10000, year: 2018, odometerKm: 90000 };

  // Alberta: no GST on a private sale, 5% plus a doc fee at a dealer. Same
  // car, materially different cheque.
  const priv = estimateInitialCost({ ...base, sellerType: 'private', title: '2018 Corolla' });
  const dealer = estimateInitialCost({ ...base, sellerType: 'dealer', title: '2018 Corolla' });
  check('private sale is not taxed', priv.items.some((i) => i.label === 'GST (5%)'), false);
  check('dealer sale is taxed', dealer.items.find((i) => i.label === 'GST (5%)')?.amount, 500);
  check('dealer costs more all-in', dealer.total > priv.total, true);

  // Winter tires are assumed unless the listing says otherwise.
  const noTires = estimateInitialCost({ ...base, sellerType: 'private', title: '2018 Corolla' });
  check('budgets for winter tires', noTires.items.some((i) => i.label === 'Winter tires'), true);
  const withTires = estimateInitialCost({
    ...base, sellerType: 'private', title: '2018 Corolla', description: 'Comes with 2 sets of tires',
  });
  check('winter tires included is recognised', withTires.tiresIncluded, true);
  check('and then not budgeted for', withTires.items.some((i) => i.label === 'Winter tires'), false);

  // Stated problems are treated as certain; inferred ones as estimates.
  const needy = estimateInitialCost({
    ...base, sellerType: 'private', title: '2018 Corolla', description: 'Needs new tires and brakes soon',
  });
  check('reads stated tire need', needy.items.some((i) => i.label === 'Replacement tires'), true);
  check('and flags work needed', needy.needsWork, true);
  check('needy car costs more than a clean one', needy.total > priv.total, true);

  // High kilometres with no service history implies catch-up work.
  const tired = estimateInitialCost({ ...base, odometerKm: 165000, sellerType: 'private', title: '2013 Corolla' });
  check('assumes brakes on a high-km car', tired.items.some((i) => i.label === 'Brake work'), true);
  const serviced = estimateInitialCost({
    ...base, odometerKm: 165000, sellerType: 'private', title: '2013 Corolla',
    description: 'Brakes just done, full service records',
  });
  check('service history removes that assumption', serviced.items.some((i) => i.label === 'Brake work'), false);
  check('recent service recognised', serviced.recentlyServiced, true);

  // The total must equal the sticker plus every line.
  const sum = dealer.items.reduce((s, i) => s + i.amount, 0);
  check('total is sticker plus the itemised extras', dealer.total, dealer.price + sum);
  check('no price means no estimate', estimateInitialCost({ price: null }), null);

  // An unknown seller must not silently get the cheaper answer.
  const unknown = estimateInitialCost({ ...base, title: '2018 Corolla' });
  check('unknown seller still budgets tax', unknown.items.some((i) => i.label === 'GST, if this is a dealer'), true);
  check('and says the seller is unknown', unknown.sellerTypeKnown, false);
});

group('who is selling', () => {
  const seller = (extra) => normalize({ source: 'kijiji', url: 'u', title: '2018 Corolla', ...extra }).sellerType;
  check('dealer name on autotrader', normalize({ source: 'autotrader', url: 'u', title: 'Elantra', sellerName: 'Northland Volkswagen' }).sellerType, 'dealer');
  check('plain dealer name on autotrader', normalize({ source: 'autotrader', url: 'u', title: 'Elantra', sellerName: 'Cardeals4u' }).sellerType, 'dealer');
  check('kijiji dealer copy', seller({ description: 'Thanks for viewing our House Of Cars inventory!' }), 'dealer');
  check('kijiji financing copy', seller({ description: 'Can FINANCE or LEASE this unit today' }), 'dealer');
  check('kijiji private copy', seller({ description: 'Selling my daughters car, runs great' }), 'private');
  check('amvic disclosure is a dealer', seller({ description: 'AMVIC licensed business' }), 'dealer');
  check('bare kijiji ad stays unknown', seller({ description: 'Runs and drives good, needs tie rod ends' }), null);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} failing`);
  process.exit(1);
}
