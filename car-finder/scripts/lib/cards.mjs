import { absoluteUrl, parseMoney, parseOdometer, parseYear, textOf } from './extract.mjs';

/**
 * Last-resort extraction: find the anchors that point at vehicle detail pages,
 * then read the surrounding markup for the numbers that matter.
 *
 * This is deliberately dumb. It survives redesigns that break every CSS
 * selector, because a listing card is always "a link to the car, near a price,
 * near a mileage".
 */
export function cardScan(html, { linkPattern, baseUrl, windowSize = 2600 }) {
  const anchors = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (linkPattern.test(m[1])) {
      anchors.push({ href: m[1], index: m.index });
    }
  }

  const seen = new Set();
  const cards = [];

  for (let i = 0; i < anchors.length; i += 1) {
    const { href, index } = anchors[i];
    const url = absoluteUrl(href, baseUrl);
    if (!url) continue;

    // One card per detail page, keeping the first (usually the image/title link).
    const dedupeKey = url.split('?')[0];
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // A card owns the markup from its own link up to the next card's link.
    // Reaching backwards for an image alt seems helpful but pulls in the
    // previous card's title and price — the alt lives inside this anchor
    // anyway. A card usually links to the same car twice (image, then
    // heading), so the boundary is the next *different* listing.
    const start = index;
    const nextCard = anchors.slice(i + 1).find((a) => {
      const key = absoluteUrl(a.href, baseUrl)?.split('?')[0];
      return key && key !== dedupeKey;
    });
    const end = Math.min(html.length, nextCard?.index ?? index + windowSize);
    const chunk = html.slice(start, end);
    const text = textOf(chunk);
    // Where the listing link sits inside the flattened text. The asking price
    // is the money figure nearest it; other figures in the window usually
    // belong to neighbouring cards or to financing blurb.
    const anchorAt = 0; // the link opens the card, so the price is measured from its start

    const card = {
      url,
      title: pickTitle(chunk, text),
      price: pickPrice(text, anchorAt),
      odometerKm: pickOdometer(text),
      year: parseYear(text.slice(0, 220)),
      imageUrl: pickImage(chunk, baseUrl),
      location: pickLocation(text),
      snippet: text.slice(0, 400),
    };

    // This scanner infers fields from position rather than structure, so it
    // needs corroboration: a real card shows an asking price *and* a mileage
    // close together. A price on its own is usually a misread — a neighbouring
    // card's figure, or a payment — and a confidently wrong price on a car
    // someone is about to go and look at is worse than no listing at all.
    if (card.price == null || card.odometerKm == null) continue;
    cards.push(card);
  }

  return cards;
}

function pickTitle(chunk, text) {
  const alt = chunk.match(/alt=["']([^"']{8,120})["']/i);
  if (alt && /(19|20)\d{2}/.test(alt[1])) return alt[1].trim();

  const heading = chunk.match(/<h[1-6][^>]*>([\s\S]{4,160}?)<\/h[1-6]>/i);
  if (heading) {
    const t = textOf(heading[1]);
    if (t.length > 4) return t;
  }

  const titled = chunk.match(/title=["']([^"']{8,120})["']/i);
  if (titled && /(19|20)\d{2}/.test(titled[1])) return titled[1].trim();

  const inline = text.match(/((19|20)\d{2}\s+[A-Za-z][\w-]*(?:\s+[\w-]+){0,4})/);
  return inline ? inline[1].trim() : null;
}

const PAYMENT_CONTEXT = /(bi-?weekly|weekly|monthly|per month|\/mo\b|\/wk\b|payment|finance|financing|o\.?a\.?c|apr|down)/i;

// One number, and only one.
//
// The thousands separator must not include an ordinary space. If it does,
// "$8,100 162,000 km" chains into a single match ("8,100 162,000"), fails the
// sanity check, and the card silently loses both its price and its mileage.
// A non-breaking space is a genuine separator in some markup; a plain space is
// the gap between two different numbers.
const NUMBER = String.raw`\d{1,3}(?:[,\u00a0]\d{3})+|\d+`;

function pickPrice(text, anchorAt = 0) {
  const candidates = [];
  const re = new RegExp(String.raw`\$\s?(${NUMBER})(?:\.\d{2})?`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = parseMoney(m[1]);
    if (value == null || value < 1000 || value > 200000) continue;
    // "$149 bi-weekly" is a financing figure, not what the car costs.
    const context = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    candidates.push({ value, at: m.index, isPayment: PAYMENT_CONTEXT.test(context) });
  }

  const real = candidates.filter((c) => !c.isPayment);
  const pool = real.length ? real : candidates;
  if (!pool.length) return null;

  // Nearest to the listing link wins. Taking the largest misreads financing
  // blurb; taking the smallest picks up a cheaper neighbouring card.
  const nearest = pool.reduce((best, c) =>
    (Math.abs(c.at - anchorAt) < Math.abs(best.at - anchorAt) ? c : best));

  // A struck-through "was" price sits immediately beside the real one. When
  // two are that close together, the seller wants the lower.
  const twin = pool.find((c) => c !== nearest && Math.abs(c.at - nearest.at) < 25);
  return twin ? Math.min(nearest.value, twin.value) : nearest.value;
}

function pickOdometer(text) {
  const patterns = [
    new RegExp(String.raw`(${NUMBER})\s*(?:km|kms|kilometres|kilometers)\b`, 'i'),
    new RegExp(String.raw`(?:mileage|odometer)\s*:?\s*(${NUMBER})`, 'i'),
    new RegExp(String.raw`(${NUMBER})\s*(?:mi|miles)\b`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const isMiles = /mi|miles/i.test(m[0]) && !/km/i.test(m[0]);
    const value = parseOdometer(m[1], isMiles ? 'mi' : 'km');
    if (value != null && value >= 100) return value;
  }
  return null;
}

function pickImage(chunk, baseUrl) {
  const patterns = [
    /<img[^>]+(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i,
    /<source[^>]+srcset=["']([^"'\s]+)/i,
  ];
  for (const re of patterns) {
    const m = chunk.match(re);
    if (!m) continue;
    if (/\.svg($|\?)|data:image|sprite|placeholder|logo/i.test(m[1])) continue;
    const url = absoluteUrl(m[1], baseUrl);
    if (url) return url;
  }
  return null;
}

function pickLocation(text) {
  const m = text.match(
    /\b(Calgary|Airdrie|Cochrane|Okotoks|Chestermere|Strathmore|Canmore|Banff|High River|Olds|Red Deer|Lethbridge|Edmonton|Didsbury|Carstairs|Crossfield|Black Diamond|Turner Valley|Langdon|Balzac)\b(?:\s*,?\s*(?:AB|Alberta))?/i,
  );
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}
