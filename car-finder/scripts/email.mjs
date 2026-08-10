#!/usr/bin/env node
// Build the email digest from the latest scan.
//
// Writes build/digest.html and build/subject.txt, and sets `send=true|false`
// on the GitHub Actions output so the workflow only emails when there is
// something genuinely worth an interruption.
//
//   node scripts/email.mjs [--force] [--min-score 62]

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BUILD = join(ROOT, 'build');

const args = process.argv.slice(2);
const force = args.includes('--force');
const minScore = Number(args[args.indexOf('--min-score') + 1]) || 62;

const SITE = process.env.SITE_URL || 'https://r2vchew.github.io/car-finder/';
const fmt = new Intl.NumberFormat('en-CA');
const money = (n) => (n == null ? '—' : `$${fmt.format(n)}`);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function carBlock(car) {
  const name = [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ') || car.title;
  const line = car.commentary?.aiNote || car.commentary?.body?.[0] || '';
  const headline = car.commentary?.headline || '';

  return `
  <tr><td style="padding:0 0 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e0ded8;border-radius:12px;overflow:hidden;background:#ffffff;">
      ${car.imageUrl ? `<tr><td><img src="${esc(car.imageUrl)}" width="100%" alt=""
             style="display:block;width:100%;max-height:220px;object-fit:cover;"></td></tr>` : ''}
      <tr><td style="padding:16px 18px 6px;">
        <p style="margin:0 0 2px;font:600 17px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b1a17;">
          <a href="${esc(car.url)}" style="color:#1b1a17;text-decoration:none;">${esc(name)}</a>
        </p>
        <p style="margin:0 0 8px;font:400 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#56534c;">
          <strong style="color:#1b1a17;">${money(car.price)}</strong> ·
          ${car.odometerKm != null ? `${fmt.format(car.odometerKm)} km` : 'km not stated'}
          ${car.location ? ` · ${esc(car.location)}` : ''}
          ${car.sellerType ? ` · ${esc(car.sellerType)}` : ''}
        </p>
        ${headline ? `<p style="margin:0 0 6px;font:600 14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f5d4c;">${esc(headline)}</p>` : ''}
        <p style="margin:0 0 12px;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#56534c;">${esc(line)}</p>
        <a href="${esc(car.url)}"
           style="display:inline-block;background:#1f5d4c;color:#ffffff;text-decoration:none;
                  padding:9px 16px;border-radius:8px;font:600 14px -apple-system,Segoe UI,Roboto,Arial,sans-serif;">
          See the listing
        </a>
      </td></tr>
    </table>
  </td></tr>`;
}

async function main() {
  const data = JSON.parse(await readFile(join(ROOT, 'data', 'listings.json'), 'utf8'));

  const fresh = data.cars.filter((c) => c.isNew && c.score >= minScore);
  const best = data.cars.filter((c) => c.score >= minScore);
  const featured = (fresh.length ? fresh : best).slice(0, 6);

  const shouldSend = force || fresh.length > 0;
  const subject = fresh.length
    ? `${fresh.length} new car${fresh.length === 1 ? '' : 's'} since yesterday — from ${money(Math.min(...fresh.map((c) => c.price ?? Infinity)))}`
    : `Car shortlist update — ${best.length} still worth a look`;

  const intro = fresh.length
    ? `${fresh.length} new listing${fresh.length === 1 ? '' : 's'} came up since yesterday. I read ${fmt.format(data.stats.rawRecords)} listings this morning and set aside ${fmt.format(data.stats.filteredOut)} that were not worth your time.`
    : 'Nothing new cleared the bar since yesterday, but here is where the shortlist stands.';

  const html = `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f6f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

    <tr><td style="padding-bottom:18px;">
      <p style="margin:0 0 4px;font:600 11px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;
                letter-spacing:.08em;text-transform:uppercase;color:#86827a;">Calgary &amp; area</p>
      <h1 style="margin:0 0 8px;font:700 24px/1.2 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b1a17;">
        The car shortlist</h1>
      <p style="margin:0;font:400 15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#56534c;">
        ${esc(intro)}</p>
    </td></tr>

    ${featured.map(carBlock).join('')}

    <tr><td style="padding:6px 0 20px;">
      <a href="${esc(SITE)}"
         style="display:inline-block;background:#1b1a17;color:#ffffff;text-decoration:none;
                padding:12px 20px;border-radius:9px;font:600 15px -apple-system,Segoe UI,Roboto,Arial,sans-serif;">
        Open the full dashboard
      </a>
      <p style="margin:10px 0 0;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#86827a;">
        There you can save the ones you like, dismiss the ones you do not, and tell me in plain
        English what to change — the next scan picks it up.
      </p>
    </td></tr>

    <tr><td style="border-top:1px solid #e0ded8;padding-top:14px;">
      <p style="margin:0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#86827a;">
        Asking prices, which change without notice. Always get an independent inspection and a
        history report before buying. Scanned ${esc(new Date(data.generatedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }))}.
      </p>
    </td></tr>

  </table>
</td></tr></table></body></html>`;

  await mkdir(BUILD, { recursive: true });
  await writeFile(join(BUILD, 'digest.html'), html);
  await writeFile(join(BUILD, 'subject.txt'), subject);

  console.log(`${fresh.length} new / ${best.length} worth a look; featuring ${featured.length}`);
  console.log(`subject: ${subject}`);
  console.log(`send: ${shouldSend}`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `send=${shouldSend}\nsubject=${subject.replace(/\n/g, ' ')}\nnew_count=${fresh.length}\n`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
