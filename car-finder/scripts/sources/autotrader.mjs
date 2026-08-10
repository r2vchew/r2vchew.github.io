import { harvest } from '../lib/pipeline.mjs';

const BASE = 'https://www.autotrader.ca';

export default {
  id: 'autotrader',
  label: 'AutoTrader.ca',
  homepage: BASE,
  note: 'Largest Canadian inventory. Mostly dealers, some private sellers.',

  buildUrl(criteria, page = 0) {
    const perPage = 100;
    const params = new URLSearchParams({
      rcp: String(perPage),
      rcs: String(page * perPage),
      srt: '35', // newest first
      prx: String(criteria.radiusKm ?? 150),
      loc: criteria.postalCode || 'T2P 1J9',
      hprc: 'True',
      wcp: 'True',
      sts: 'Used',
      inMarket: 'advancedSearch',
      pRng: `${criteria.minPrice ?? ''},${criteria.maxPrice ?? 20000}`,
      yRng: `${criteria.minYear ?? 2014},`,
    });
    if (criteria.maxOdometerKm) params.set('oRng', `,${criteria.maxOdometerKm}`);
    return `${BASE}/cars/ab/calgary/?${params.toString()}`;
  },

  fetchListings(criteria, opts = {}) {
    return harvest({
      sourceId: 'autotrader',
      baseUrl: BASE,
      linkPattern: /^\/a\/[^"'?#]+/i,
      buildUrl: this.buildUrl,
      criteria,
      ...opts,
    });
  },
};
