import { harvest } from '../lib/pipeline.mjs';

const BASE = 'https://www.cargurus.ca';

export default {
  id: 'cargurus',
  label: 'CarGurus.ca',
  homepage: BASE,
  note: 'Publishes a deal rating per car, which is a useful second opinion on price.',

  buildUrl(criteria, page = 0) {
    const params = new URLSearchParams({
      sourceContext: 'carGurusHomePageModel',
      zip: criteria.postalCode || 'T2P 1J9',
      distance: String(criteria.radiusKm ?? 150),
      maxPrice: String(criteria.maxPrice ?? 20000),
      startYear: String(criteria.minYear ?? 2014),
      showNegotiable: 'true',
      sortDir: 'ASC',
      sortType: 'DEAL_SCORE',
      inventorySearchWidgetType: 'AUTO',
      isDeliveryEnabled: 'false',
    });
    if (criteria.minPrice) params.set('minPrice', String(criteria.minPrice));
    if (criteria.maxOdometerKm) params.set('maxMileage', String(criteria.maxOdometerKm));
    if (page > 0) params.set('offset', String(page * 15));
    return `${BASE}/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?${params.toString()}`;
  },

  fetchListings(criteria, opts = {}) {
    return harvest({
      sourceId: 'cargurus',
      baseUrl: BASE,
      linkPattern: /vdp\.action\?[^"']*listingId=/i,
      buildUrl: this.buildUrl,
      criteria,
      ...opts,
    });
  },
};
