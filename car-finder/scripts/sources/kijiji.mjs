import { harvest } from '../lib/pipeline.mjs';

const BASE = 'https://www.kijiji.ca';

// Cars & Trucks category (c174) restricted to the Calgary region (l1700199).
const CATEGORY = 'c174l1700199';

export default {
  id: 'kijiji',
  label: 'Kijiji',
  homepage: BASE,
  note: 'Strongest source of private-seller cars, which is where the cheap ones are.',

  buildUrl(criteria, page = 0) {
    const params = new URLSearchParams({ sort: 'dateDesc' });
    const min = criteria.minPrice ?? 0;
    const max = criteria.maxPrice ?? 20000;
    params.set('price', `${min}__${max}`);
    if (criteria.maxOdometerKm) params.set('carmileageinkms', `0__${criteria.maxOdometerKm}`);
    if (criteria.minYear) params.set('caryear', `${criteria.minYear}__${new Date().getFullYear() + 1}`);
    // Kijiji pages via a path segment rather than a query parameter.
    const pageSegment = page > 0 ? `page-${page + 1}/` : '';
    return `${BASE}/b-cars-trucks/calgary/${pageSegment}${CATEGORY}?${params.toString()}`;
  },

  fetchListings(criteria, opts = {}) {
    return harvest({
      sourceId: 'kijiji',
      baseUrl: BASE,
      linkPattern: /^\/v-cars-trucks\/[^"'?#]+/i,
      buildUrl: this.buildUrl,
      criteria,
      ...opts,
    });
  },
};
