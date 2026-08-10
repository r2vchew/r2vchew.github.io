import { cardScan } from './cards.mjs';
import {
  absoluteUrl, embeddedState, listingLikeObjects, parseMoney, parseOdometer,
  parseTransmission, parseYear, vehicleNodes,
} from './extract.mjs';
import { courtesyDelay, request } from './http.mjs';

/** Map schema.org Vehicle/Car/Product nodes onto our raw shape. */
export function fromJsonLd(html, baseUrl) {
  return vehicleNodes(html).map((node) => {
    const offer = node.offers && (Array.isArray(node.offers) ? node.offers[0] : node.offers);
    const odo = node.mileageFromOdometer || {};
    const seller = offer?.seller || node.seller || {};
    return {
      sourceId: node.sku || node.vehicleIdentificationNumber || null,
      url: absoluteUrl(node.url || offer?.url, baseUrl),
      title: node.name || null,
      year: parseYear(node.modelDate || node.productionDate || node.vehicleModelDate || node.name),
      make: typeof node.brand === 'object' ? node.brand?.name : node.brand,
      model: typeof node.model === 'object' ? node.model?.name : node.model,
      trim: node.vehicleConfiguration || null,
      price: parseMoney(offer?.price ?? node.price),
      odometerKm: parseOdometer(
        odo.value ?? odo,
        odo.unitCode || odo.unitText || 'KMT',
      ),
      transmission: parseTransmission(node.vehicleTransmission),
      drivetrain: node.driveWheelConfiguration?.name || node.driveWheelConfiguration || null,
      fuel: node.fuelType || null,
      bodyType: typeof node.bodyType === 'object' ? node.bodyType?.name : node.bodyType,
      exteriorColour: node.color || null,
      vin: node.vehicleIdentificationNumber || null,
      imageUrl: Array.isArray(node.image) ? node.image[0] : node.image || null,
      sellerName: typeof seller === 'object' ? seller.name : seller,
      location: offer?.availableAtOrFrom?.address?.addressLocality
        || node.address?.addressLocality || null,
      description: typeof node.description === 'string' ? node.description.slice(0, 600) : null,
    };
  });
}

/** Map listing-shaped objects found inside an embedded state blob. */
export function fromState(html, baseUrl) {
  const out = [];
  for (const blob of embeddedState(html)) {
    for (const node of listingLikeObjects(blob)) {
      out.push({
        sourceId: node.id ?? node.adId ?? node.listingId ?? node.vehicleId ?? null,
        url: absoluteUrl(
          node.url || node.link || node.detailUrl || node.vdpUrl || node.seoUrl || node.href,
          baseUrl,
        ),
        title: node.title || node.name || node.heading || node.displayName || null,
        year: parseYear(node.year ?? node.modelYear),
        make: node.make ?? node.makeName ?? node.brand ?? null,
        model: node.model ?? node.modelName ?? null,
        trim: node.trim ?? node.trimName ?? null,
        price: parseMoney(
          node.price ?? node.askingPrice ?? node.listPrice ?? node.priceAmount ?? node.amount,
        ),
        odometerKm: parseOdometer(
          node.odometer ?? node.mileage ?? node.kilometres ?? node.kilometers ?? node.km,
          node.odometerUnit || node.mileageUnit || 'km',
        ),
        transmission: parseTransmission(node.transmission ?? node.transmissionType),
        drivetrain: node.drivetrain ?? node.driveTrain ?? node.driveType ?? null,
        fuel: node.fuelType ?? node.fuel ?? null,
        bodyType: node.bodyType ?? node.bodyStyle ?? node.style ?? null,
        exteriorColour: node.exteriorColour ?? node.exteriorColor ?? node.color ?? null,
        vin: node.vin ?? null,
        location: node.location ?? node.city ?? node.address?.city ?? null,
        sellerName: node.dealerName ?? node.sellerName ?? node.dealer?.name ?? null,
        imageUrl: node.imageUrl ?? node.thumbnail ?? node.photoUrl ?? node.image
          ?? (Array.isArray(node.images) ? node.images[0]?.url ?? node.images[0] : null),
      });
    }
  }
  return out;
}

const BLOCK_SIGNS = /captcha|are you a human|access denied|request unsuccessful|unusual traffic|pardon our interruption|cf-browser-verification/i;

/**
 * Run every extraction strategy over one page and keep whichever produced the
 * most rows. Returns the winning strategy name so CI logs show what is actually
 * carrying each source.
 */
export function extractPage(html, { baseUrl, linkPattern }) {
  const attempts = [
    ['jsonld', fromJsonLd(html, baseUrl)],
    ['state', fromState(html, baseUrl)],
    ['cards', linkPattern ? cardScan(html, { linkPattern, baseUrl }) : []],
  ];
  const usable = (rows) => rows.filter((r) => r && (r.price != null || r.odometerKm != null)).length;
  const winner = attempts.reduce((a, b) => (usable(b[1]) > usable(a[1]) ? b : a));
  return { strategy: winner[0], rows: winner[1], breakdown: Object.fromEntries(attempts.map(([n, r]) => [n, usable(r)])) };
}

/**
 * Shared paging loop. Every adapter supplies a URL builder and a link pattern;
 * this handles retries, bot-challenge detection, pagination and diagnostics.
 */
export async function harvest({
  sourceId, baseUrl, linkPattern, buildUrl, criteria, pages = 2, requestOptions = {},
}) {
  const diagnostics = { pagesFetched: 0, strategies: {}, breakdown: {}, errors: [], blocked: false };
  const collected = [];
  let previousPageKey = null;

  for (let page = 0; page < pages; page += 1) {
    const url = buildUrl(criteria, page);
    const res = await request(url, { label: `${sourceId} p${page}`, ...requestOptions });

    if (!res.ok) {
      diagnostics.errors.push(`page ${page}: ${res.error}`);
      break;
    }

    diagnostics.pagesFetched += 1;
    diagnostics.lastBytes = res.body.length;

    if (BLOCK_SIGNS.test(res.body.slice(0, 6000))) {
      diagnostics.blocked = true;
      diagnostics.errors.push(`page ${page}: bot challenge served`);
      break;
    }

    const { strategy, rows, breakdown } = extractPage(res.body, { baseUrl, linkPattern });
    diagnostics.strategies[strategy] = (diagnostics.strategies[strategy] || 0) + rows.length;
    for (const [k, v] of Object.entries(breakdown)) {
      diagnostics.breakdown[k] = Math.max(diagnostics.breakdown[k] || 0, v);
    }

    if (!rows.length) break;

    // Not every site paginates the way its URLs suggest — Carpages ignores its
    // page parameter and serves page one again. Without this check we would
    // refetch the same cars on every extra page.
    const pageKey = rows.map((r) => r.url || r.sourceId || r.title).join('|');
    if (pageKey === previousPageKey) {
      diagnostics.errors.push(`page ${page}: identical to the previous page, pagination ignored`);
      break;
    }
    previousPageKey = pageKey;

    collected.push(...rows.map((r) => ({ ...r, source: sourceId })));
    if (rows.length < 15) break; // looks like the final page
    await courtesyDelay();
  }

  return { listings: collected, diagnostics };
}
