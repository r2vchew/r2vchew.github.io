import { harvest } from '../lib/pipeline.mjs';

const BASE = 'https://www.carpages.ca';

export default {
  id: 'carpages',
  label: 'Carpages.ca',
  homepage: BASE,
  note: 'Smaller Canadian aggregator; picks up independent Calgary lots the big sites miss.',

  // Detail pages: /used-cars/alberta/calgary/2010-acura-mdx-14578881/
  linkPattern: /^\/used-cars\/[a-z-]+\/[a-z-]+\/[^"'?#]+-\d{5,}\/?$/i,

  buildUrl(criteria, page = 0) {
    const params = new URLSearchParams({
      price_to: String(criteria.maxPrice ?? 20000),
      year_from: String(criteria.minYear ?? 2014),
      sort: 'newest',
    });
    if (criteria.minPrice) params.set('price_from', String(criteria.minPrice));
    if (criteria.maxOdometerKm) params.set('kms_to', String(criteria.maxOdometerKm));
    if (page > 0) params.set('p', String(page + 1));
    return `${BASE}/alberta/calgary/used-cars/?${params.toString()}`;
  },

  fetchListings(criteria, opts = {}) {
    return harvest({
      sourceId: this.id,
      baseUrl: BASE,
      linkPattern: this.linkPattern,
      buildUrl: this.buildUrl,
      criteria,
      ...opts,
    });
  },
};
