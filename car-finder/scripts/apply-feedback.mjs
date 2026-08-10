#!/usr/bin/env node
// Read feedback issues, apply them to the search scope and her verdict list,
// then reply on the issue explaining exactly what changed and close it.
//
// Runs inside GitHub Actions with GITHUB_TOKEN and GITHUB_REPOSITORY set.
// Locally: node scripts/apply-feedback.mjs --file some-feedback.json

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyChanges, interpret, interpretWithClaude } from './lib/interpret.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

const LABEL = process.env.FEEDBACK_LABEL || 'car-feedback';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const dry = args.includes('--dry');

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

/** Pull the machine-readable payload out of an issue body, or fall back to prose. */
function parseIssue(body = '') {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  // Someone typed a plain message instead of using the dashboard button.
  return { note: body.replace(/<!--[\s\S]*?-->/g, '').trim(), saved: [], rejected: [] };
}

async function main() {
  const criteriaPath = join(DATA, 'criteria.json');
  let criteria = await readJson(criteriaPath, null);
  if (!criteria) throw new Error('data/criteria.json is missing');
  const verdicts = await readJson(join(DATA, 'verdicts.json'), { rejected: {}, shortlisted: {} });

  // ---- Collect feedback ---------------------------------------------------
  let items = [];
  const localFile = value('file');
  if (localFile) {
    items = [{ number: null, payload: JSON.parse(await readFile(localFile, 'utf8')) }];
  } else if (REPO && TOKEN) {
    const issues = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=30`);
    items = issues
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, author: i.user?.login, payload: parseIssue(i.body || '') }));
    console.log(`Found ${items.length} open feedback issue(s) labelled "${LABEL}"`);
  } else {
    console.log('No GITHUB_TOKEN/GITHUB_REPOSITORY and no --file; nothing to do.');
    return;
  }

  if (!items.length) { console.log('No feedback to apply.'); return; }

  const historyEntries = [];

  for (const item of items) {
    const { payload } = item;
    const replies = [];

    // ---- Per-car verdicts --------------------------------------------------
    for (const car of payload.rejected || []) {
      if (!car.id) continue;
      verdicts.rejected[car.id] = {
        label: car.label || null,
        reason: car.reason || null,
        at: new Date().toISOString(),
      };
    }
    for (const car of payload.saved || []) {
      if (!car.id) continue;
      verdicts.shortlisted[car.id] = {
        label: car.label || null,
        note: car.note || null,
        at: new Date().toISOString(),
      };
    }
    if (payload.rejected?.length) replies.push(`Removed ${payload.rejected.length} car(s) — they will not come back.`);
    if (payload.saved?.length) replies.push(`Kept ${payload.saved.length} car(s) on the saved list.`);

    // ---- Plain-English scope changes ---------------------------------------
    const note = (payload.note || '').trim();
    if (note) {
      const result = interpret(note, criteria);
      let changes = result.changes;

      if (result.unmatched) {
        const fromClaude = await interpretWithClaude(note, criteria);
        if (fromClaude.length) {
          changes = fromClaude;
          console.log(`  Claude interpreted a note the rules could not read`);
        }
      }

      if (changes.length) {
        criteria = applyChanges(criteria, changes);
        replies.push(`I read that as:\n${changes.map((c) => `- ${c.describe}`).join('\n')}`);
        historyEntries.push({
          at: new Date().toISOString(),
          note,
          issue: item.number,
          changes: changes.map((c) => ({ path: c.path, value: c.value })),
        });
      } else if (result.alreadySatisfied) {
        replies.push('That is already how the search is set up, so nothing changed — but the note is on file.');
      } else {
        replies.push('I could not turn that into a filter change automatically, so it is saved for a human to read. If it was about a specific car, marking it "Not for me" on the dashboard is the fastest way to act on it.');
        criteria.freeText = [...(criteria.freeText || []), { at: new Date().toISOString(), note }].slice(-25);
      }
    }

    if (!replies.length) replies.push('Nothing actionable in this one, but thanks — it is logged.');

    const body = [
      'Thanks — here is what I did with this:',
      '',
      ...replies,
      '',
      'The next scan will reflect it. If I read something wrong, reopen this and say so.',
      '',
      '---',
      '_Generated by [Claude Code](https://claude.ai/code)_',
    ].join('\n');

    console.log(`\n── issue #${item.number ?? '(local)'}\n${body}\n`);

    if (item.number && !dry && REPO && TOKEN) {
      await gh(`/repos/${REPO}/issues/${item.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      await gh(`/repos/${REPO}/issues/${item.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
    }
  }

  // ---- Persist ------------------------------------------------------------
  if (historyEntries.length) {
    criteria.history = [...(criteria.history || []), ...historyEntries].slice(-40);
    criteria.updatedAt = new Date().toISOString().slice(0, 10);
    criteria.updatedBy = 'feedback from the dashboard';
  }

  if (dry) { console.log('--dry: nothing written'); return; }

  await writeFile(criteriaPath, `${JSON.stringify(criteria, null, 2)}\n`);
  await writeFile(join(DATA, 'verdicts.json'), `${JSON.stringify(verdicts, null, 2)}\n`);
  console.log('Updated data/criteria.json and data/verdicts.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
