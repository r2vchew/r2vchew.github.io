#!/usr/bin/env node
// Main pipeline: fetch -> normalize -> filter -> score -> comment -> publish.
//
// Usage:
//   node scripts/run.mjs                 full run, writes data/listings.json
//   node scripts/run.mjs --dry           run without writing
//   node scripts/run.mjs --source kijiji only one source
//   node scripts/run.mjs --fixture x.json  score a saved fixture instead of fetching

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import autotrader from './sources/autotrader.mjs';
import kijiji from './sources/kijiji.mjs';
import cargurus from './sources/cargurus.mjs';
import carpages from './sources/carpages.mjs';

import { dedupe, normalize } from './lib/normalize.mjs';
import { bandFor, buildMarket, rejectReason, scoreListing } from './lib/score.mjs';
import { enhanceWithClaude, writeCommentary } from './lib/commentary.mjs';
import { proxyEnabled } from './lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

const SOURCES = [autotrader, kijiji, cargurus, carpages];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.warn(`could not read ${path}: ${err.message}`);
    return fallback;
  }
}

/** Flatten criteria into the shape the source adapters expect. */
function searchParams(criteria) {
  return {
    ...criteria.hard,
    ...criteria.location,
    maxOdometerKm: criteria.hard.maxOdometerKm,
  };
}

async function main() {
  const startedAt = new Date();
  const criteria = await readJson(join(DATA, 'criteria.json'), null);
  if (!criteria) throw new Error('data/criteria.json is missing');

  const state = await readJson(join(DATA, 'state.json'), { seen: {}, lastRunAt: null });
  const verdicts = await readJson(join(DATA, 'verdicts.json'), { rejected: {}, shortlisted: {} });

  console.log(`Calgary car finder — run at ${startedAt.toISOString()}`);
  console.log(`Budget ${criteria.hard.minPrice}-${criteria.hard.maxPrice}, ${criteria.hard.minYear}+, max ${criteria.hard.maxOdometerKm} km, ${criteria.hard.transmission} only`);
  console.log(`Scraping proxy: ${proxyEnabled() ? 'enabled' : 'direct (no key configured)'}`);

  // ---- Fetch --------------------------------------------------------------
  let raw = [];
  const sourceHealth = [];

  const fixture = value('fixture');
  if (fixture) {
    raw = JSON.parse(await readFile(fixture, 'utf8'));
    console.log(`\nLoaded ${raw.length} records from fixture ${fixture}`);
  } else {
    const only = value('source');
    const active = only ? SOURCES.filter((s) => s.id === only) : SOURCES;
    const params = searchParams(criteria);

    for (const source of active) {
      console.log(`\n── ${source.label}`);
      console.log(`   ${source.buildUrl(params, 0)}`);
      const started = Date.now();
      let result;
      try {
        result = await source.fetchListings(params, { pages: Number(value('pages') || 2) });
      } catch (err) {
        result = { listings: [], diagnostics: { errors: [err.message], blocked: false } };
      }
      const elapsed = Math.round((Date.now() - started) / 100) / 10;
      const d = result.diagnostics;
      console.log(`   ${result.listings.length} raw records in ${elapsed}s`);
      console.log(`   strategies: ${JSON.stringify(d.strategies || {})} | best-effort per strategy: ${JSON.stringify(d.breakdown || {})}`);
      if (d.lastBytes) console.log(`   last page was ${Math.round(d.lastBytes / 1024)} KB`);
      if (d.errors?.length) console.log(`   issues: ${d.errors.join('; ')}`);

      sourceHealth.push({
        id: source.id,
        label: source.label,
        count: result.listings.length,
        blocked: Boolean(d.blocked),
        errors: d.errors || [],
        strategy: Object.keys(d.strategies || {})[0] || null,
        elapsedSeconds: elapsed,
      });
      raw.push(...result.listings);
    }
  }

  // ---- Normalize and dedupe ----------------------------------------------
  const normalized = raw
    .map((r) => {
      try { return normalize(r); } catch { return null; }
    })
    .filter(Boolean)
    .filter((l) => l.url);

  const unique = dedupe(normalized);
  console.log(`\n${raw.length} raw -> ${normalized.length} normalized -> ${unique.length} unique cars`);

  // ---- Filter -------------------------------------------------------------
  const kept = [];
  const rejected = [];
  for (const listing of unique) {
    const reason = rejectReason(listing, criteria);
    if (reason) rejected.push({ ...listing, rejectReason: reason });
    else kept.push(listing);
  }

  const reasonTally = rejected.reduce((acc, r) => {
    const key = r.rejectReason.replace(/\$[\d,]+|\d[\d,]*/g, 'N');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(`${kept.length} passed her filters, ${rejected.length} filtered out`);
  for (const [reason, n] of Object.entries(reasonTally).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${n.toString().padStart(4)}  ${reason}`);
  }

  // ---- Score and comment --------------------------------------------------
  const market = buildMarket(unique);
  const nowIso = startedAt.toISOString();

  let cars = kept.map((listing) => {
    const scored = scoreListing(listing, criteria, market);
    const previous = state.seen[listing.id];
    return {
      ...listing,
      score: scored.score,
      band: bandFor(scored.score),
      scoreParts: scored.parts,
      commentary: writeCommentary(listing, scored, criteria, market),
      firstSeen: previous?.firstSeen || nowIso,
      lastSeen: nowIso,
      isNew: !previous,
      priceHistory: buildPriceHistory(previous, listing.price, nowIso),
    };
  });

  // Her own decisions always win over the score.
  cars = cars.filter((c) => !verdicts.rejected[c.id]);
  for (const car of cars) {
    if (verdicts.shortlisted[car.id]) {
      car.shortlisted = true;
      car.shortlistNote = verdicts.shortlisted[car.id].note || null;
    }
  }

  cars.sort((a, b) => b.score - a.score || (a.price ?? 1e9) - (b.price ?? 1e9));

  await enhanceWithClaude(cars.filter((c) => c.score >= 62), criteria);

  const topBand = cars.filter((c) => c.band === 'shortlist').length;
  console.log(`\n${cars.length} candidates after her past decisions; ${topBand} in the shortlist band; ${cars.filter((c) => c.isNew).length} new since last run`);
  for (const car of cars.slice(0, 10)) {
    console.log(`   ${String(car.score).padStart(3)}  ${[car.year, car.make, car.model].filter(Boolean).join(' ').padEnd(30)} $${(car.price ?? 0).toLocaleString().padStart(7)}  ${car.odometerKm ? `${Math.round(car.odometerKm / 1000)}k km` : '?'}  ${car.source}`);
  }

  // ---- Publish ------------------------------------------------------------
  const output = {
    generatedAt: nowIso,
    criteria,
    sourceHealth,
    stats: {
      rawRecords: raw.length,
      uniqueCars: unique.length,
      passedFilters: kept.length,
      filteredOut: rejected.length,
      filterReasons: reasonTally,
      candidates: cars.length,
      newSinceLastRun: cars.filter((c) => c.isNew).length,
      previousRunAt: state.lastRunAt,
    },
    cars,
    nearMisses: rejected
      .filter((r) => /over budget|too many kilometres|too old/.test(r.rejectReason))
      .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))
      .slice(0, 12)
      .map((r) => ({
        id: r.id, url: r.url, title: r.title, price: r.price,
        odometerKm: r.odometerKm, year: r.year, source: r.source, rejectReason: r.rejectReason,
      })),
  };

  if (flag('dry')) {
    console.log('\n--dry: nothing written');
    return;
  }

  const nextState = { lastRunAt: nowIso, seen: {} };
  for (const car of cars) {
    nextState.seen[car.id] = {
      firstSeen: car.firstSeen,
      lastSeen: nowIso,
      price: car.price,
      priceHistory: car.priceHistory,
    };
  }

  await writeFile(join(DATA, 'listings.json'), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(join(DATA, 'state.json'), `${JSON.stringify(nextState, null, 2)}\n`);
  console.log(`\nWrote data/listings.json (${cars.length} cars) and data/state.json`);

  if (sourceHealth.length && sourceHealth.every((s) => s.count === 0)) {
    console.error('\nEvery source returned zero records. Not failing the run so the site keeps its last good data, but this needs attention.');
    process.exitCode = flag('strict') ? 1 : 0;
  }
}

function buildPriceHistory(previous, price, nowIso) {
  const history = previous?.priceHistory ? [...previous.priceHistory] : [];
  const last = history[history.length - 1];
  if (price != null && (!last || last.price !== price)) {
    history.push({ at: nowIso, price });
  }
  return history.slice(-8);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
