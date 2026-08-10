import { harvest } from '../lib/pipeline.mjs';

const BASE = 'https://www.autotrader.ca';

export default {
  id: 'autotrader',
  label: 'AutoTrader.ca',
  homepage: BASE,
  note: 'Largest Canadian inventory. Mostly dealers, some private sellers.',

  // Detail pages are served from /offers/<slug>.
  linkPattern: /^\/offers\/[^"'?#]+/i,

  // AutoTrader normalises search URLs into a path form: a query-string search
  // 302s to /cars/reg_<province>/cit_<city>/pr_<maxPrice>. Requesting that form
  // directly avoids the redirect, and — importantly — avoids the redirect
  // silently dropping the location, which sends back Quebec dealers.
  buildUrl(criteria, page = 0) {
    const segments = ['cars', 'reg_ab', 'cit_calgary'];
    if (criteria.maxPrice) segments.push(`pr_${criteria.maxPrice}`);

    const params = new URLSearchParams();
    if (criteria.minYear) params.set('modelyearfrom', String(criteria.minYear));
    if (criteria.maxOdometerKm) params.set('kmto', String(criteria.maxOdometerKm));
    if (criteria.minPrice) params.set('pricefrom', String(criteria.minPrice));
    if (criteria.radiusKm) params.set('prx', String(criteria.radiusKm));
    if (page > 0) params.set('page', String(page + 1));

    return `${BASE}/${segments.join('/')}?${params.toString()}`;
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
