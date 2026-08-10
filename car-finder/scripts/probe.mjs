#!/usr/bin/env node
// Diagnostic for the scrapers. Fetches one page per source and reports what
// actually came back, so a broken adapter can be fixed from a CI log without
// guessing.
//
//   node scripts/probe.mjs [--source kijiji] [--dump]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import autotrader from './sources/autotrader.mjs';
import kijiji from './sources/kijiji.mjs';
import cargurus from './sources/cargurus.mjs';
import carpages from './sources/carpages.mjs';

import { request } from './lib/http.mjs';
import { extractPage, fromJsonLd, fromState } from './lib/pipeline.mjs';
import { jsonLdBlocks, embeddedState } from './lib/extract.mjs';
import { cardScan } from './lib/cards.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = { autotrader, kijiji, cargurus, carpages };

// Patterns live on the source modules so the probe can never drift from what
// the scraper actually uses — an earlier duplicated copy did exactly that and
// made a working fix look broken.
const patternFor = (id) => SOURCES[id].linkPattern;

const args = process.argv.slice(2);
const only = args[args.indexOf('--source') + 1];
const dump = args.includes('--dump');
const variants = args.includes('--variants');

// Candidate search URLs to try when a source is returning the wrong region or
// refusing outright. Testing them in one CI run beats guessing one at a time.
const VARIANTS = {
  // Confirming the canonical path form keeps the location, and finding how
  // AutoTrader paginates — a single page is only 20 cars.
  autotrader: [
    'https://www.autotrader.ca/cars/reg_ab/cit_calgary/pr_16000?modelyearfrom=2016&kmto=180000',
    'https://www.autotrader.ca/cars/reg_ab/cit_calgary/pr_16000?modelyearfrom=2016&kmto=180000&page=2',
    'https://www.autotrader.ca/cars/reg_ab/cit_calgary/pr_16000?modelyearfrom=2016&kmto=180000&rcs=20&rcp=100',
    'https://www.autotrader.ca/cars/reg_ab/cit_calgary/pr_16000/page_2?modelyearfrom=2016',
  ],
  // Carpages ignores ?p=2 and serves page one again — finding the parameter
  // it actually honours.
  carpages: [
    'https://www.carpages.ca/alberta/calgary/used-cars/?price_to=16000&year_from=2016',
    'https://www.carpages.ca/alberta/calgary/used-cars/?price_to=16000&year_from=2016&page=2',
    'https://www.carpages.ca/alberta/calgary/used-cars/page-2/?price_to=16000&year_from=2016',
    'https://www.carpages.ca/alberta/calgary/used-cars/?price_to=16000&year_from=2016&offset=20',
  ],
};

// Dealer names and slugs rarely contain a city, so an automated in-province
// check gives false negatives. Print the evidence and judge it by eye instead.
function regionSample(rows) {
  const places = rows
    .map((r) => [r.location, r.sellerName, r.title, r.url].filter(Boolean).join(' · '))
    .slice(0, 6);
  return { samples: places.map((p) => p.slice(0, 110)) };
}

async function probeVariants() {
  const chosen = only && VARIANTS[only] ? { [only]: VARIANTS[only] } : VARIANTS;
  for (const [id, urls] of Object.entries(chosen)) {
    const source = SOURCES[id];
    console.log(`\n${'#'.repeat(72)}\n# ${source.label} — ${urls.length} candidate URLs\n${'#'.repeat(72)}`);
    for (const url of urls) {
      const res = await request(url, { label: id, attempts: 1, timeoutMs: 20000 });
      if (!res.ok) {
        console.log(`\n✗ ${res.status}  ${url}\n    ${res.error}`);
        continue;
      }
      const blocked = BLOCK_SIGNS.test(res.body.slice(0, 6000));
      const out = extractPage(res.body, { baseUrl: source.homepage, linkPattern: patternFor(id) });
      const region = regionSample(out.rows);
      console.log(`\n${out.rows.length ? '✓' : '·'} ${res.status}  ${url}`);
      console.log(`    final:    ${res.url}`);
      console.log(`    rows:     ${out.rows.length} via ${out.strategy}  ${JSON.stringify(out.breakdown)}${blocked ? '  [BOT CHECK]' : ''}`);
      for (const s of region.samples.slice(0, 3)) console.log(`      ${s}`);
    }
  }
}

const BLOCK_SIGNS = /captcha|are you a human|access denied|request unsuccessful|unusual traffic|pardon our interruption|cf-browser-verification/i;

async function main() {
  if (variants) return probeVariants();

  const criteria = JSON.parse(await readFile(join(HERE, '..', 'data', 'criteria.json'), 'utf8'));
  const params = { ...criteria.hard, ...criteria.location };

  const chosen = only && SOURCES[only] ? { [only]: SOURCES[only] } : SOURCES;

  for (const [id, source] of Object.entries(chosen)) {
    const url = source.buildUrl(params, 0);
    console.log(`\n${'='.repeat(72)}\n${source.label}\n${url}\n${'='.repeat(72)}`);

    const res = await request(url, { label: id, attempts: 2 });
    console.log(`status      ${res.status}  ${res.ok ? 'OK' : `FAILED: ${res.error}`}`);
    if (!res.ok) continue;

    const html = res.body;
    console.log(`size        ${Math.round(html.length / 1024)} KB`);
    console.log(`final url   ${res.url}`);
    console.log(`bot check   ${BLOCK_SIGNS.test(html.slice(0, 6000)) ? 'YES — challenge page' : 'no'}`);
    console.log(`title       ${(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 110)}`);

    // What raw material is present?
    const ld = jsonLdBlocks(html);
    const state = embeddedState(html);
    console.log(`json-ld     ${ld.length} block(s); @types: ${[...new Set(ld.flatMap((b) => collectTypes(b)))].slice(0, 10).join(', ') || 'none'}`);
    console.log(`state blobs ${state.length}`);
    console.log(`__NEXT_DATA__ present: ${/__NEXT_DATA__/.test(html)}`);

    // How many listings does each strategy find?
    const pattern = patternFor(id);
    const anchors = countAnchors(html, pattern);
    console.log(`links matching ${pattern}: ${anchors.total} (${anchors.unique} unique)`);
    if (anchors.samples.length) {
      console.log('  samples:');
      for (const s of anchors.samples) console.log(`    ${s}`);
    }

    const result = extractPage(html, { baseUrl: source.homepage, linkPattern: pattern });
    console.log(`strategy counts: ${JSON.stringify(result.breakdown)}  -> winner: ${result.strategy} (${result.rows.length} rows)`);

    const sample = result.rows.find((r) => r.price != null) || result.rows[0];
    if (sample) {
      console.log('  first usable row:');
      console.log(`    ${JSON.stringify(trim(sample), null, 2).split('\n').join('\n    ')}`);
    } else {
      console.log('  NO ROWS. Anchor candidates in the raw HTML:');
      for (const href of firstHrefs(html, 12)) console.log(`    ${href}`);
    }

    if (dump) {
      const marker = html.search(/\$\s?\d{1,3},\d{3}/);
      if (marker > 0) {
        console.log('\n  --- HTML around the first price ---');
        console.log(html.slice(Math.max(0, marker - 900), marker + 900).replace(/\s+/g, ' '));
      }
    }
  }
}

function collectTypes(node, out = [], depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) { for (const n of node) collectTypes(n, out, depth + 1); return out; }
  if (typeof node === 'object') {
    if (node['@type']) out.push(...[].concat(node['@type']));
    for (const v of Object.values(node)) collectTypes(v, out, depth + 1);
  }
  return out;
}

function countAnchors(html, pattern) {
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
  const hits = [];
  let m;
  while ((m = re.exec(html)) !== null) if (pattern.test(m[1])) hits.push(m[1]);
  return {
    total: hits.length,
    unique: new Set(hits.map((h) => h.split('?')[0])).size,
    samples: [...new Set(hits)].slice(0, 5),
  };
}

function firstHrefs(html, n) {
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null && out.size < n * 4) {
    if (/^\/|^https?:\/\//.test(m[1]) && !/\.(css|js|png|jpg|svg)/.test(m[1])) out.add(m[1]);
  }
  return [...out].slice(0, n);
}

function trim(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' && v.length > 90 ? `${v.slice(0, 90)}…` : v;
  }
  return out;
}

main().catch((err) => { console.error(err); process.exit(1); });
