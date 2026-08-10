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

    // Look backwards a little (image alt, title) and forwards a lot (specs).
    const start = Math.max(0, index - Math.floor(windowSize / 4));
    const nextIndex = anchors[i + 1]?.index ?? html.length;
    const end = Math.min(html.length, Math.max(index + windowSize, nextIndex));
    const chunk = html.slice(start, end);
    const text = textOf(chunk);

    const card = {
      url,
      title: pickTitle(chunk, text),
      price: pickPrice(text),
      odometerKm: pickOdometer(text),
      year: parseYear(text.slice(0, 220)),
      imageUrl: pickImage(chunk, baseUrl),
      location: pickLocation(text),
      snippet: text.slice(0, 400),
    };

    // A card with neither a price nor a mileage is almost certainly navigation
    // chrome that happened to match the link pattern.
    if (card.price == null && card.odometerKm == null) continue;
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

function pickPrice(text) {
  const candidates = [];
  const re = /\$\s?([\d][\d,\s]{2,10})(?:\.\d{2})?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = parseMoney(m[1]);
    if (value == null || value < 1000 || value > 200000) continue;
    // "$149 bi-weekly" is a financing figure, not what the car costs.
    const context = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    candidates.push({ value, isPayment: PAYMENT_CONTEXT.test(context) });
  }

  const real = candidates.filter((c) => !c.isPayment);
  const pool = real.length ? real : candidates;
  if (!pool.length) return null;

  // Cards commonly show a struck-through "was" price beside the asking price.
  // The lower of the two is what the seller actually wants today.
  const values = pool.map((c) => c.value).sort((a, b) => a - b);
  return values[0];
}

function pickOdometer(text) {
  const patterns = [
    /([\d][\d,\s]{2,9})\s*(?:km|kms|kilometres|kilometers)\b/i,
    /(?:mileage|odometer)\s*:?\s*([\d][\d,\s]{2,9})/i,
    /([\d][\d,\s]{2,9})\s*(?:mi|miles)\b/i,
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
