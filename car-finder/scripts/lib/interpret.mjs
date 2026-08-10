// Turn a plain-English note into concrete changes to the search scope.
//
// Rule-based, so it costs nothing and behaves predictably. Every rule returns
// a change plus a sentence describing it, and those sentences get replied back
// so she can see exactly how her words were read — and correct them if the
// reading was wrong.

const MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat',
  'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia', 'Lexus',
  'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Subaru',
  'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
];

const BODY_WORDS = [
  ['truck', 'Pickup'], ['pickup', 'Pickup'], ['pick-up', 'Pickup'],
  ['suv', 'SUV'], ['sedan', 'Sedan'], ['hatchback', 'Hatchback'], ['hatch', 'Hatchback'],
  ['coupe', 'Coupe'], ['convertible', 'Convertible'], ['van', 'Van'], ['minivan', 'Van'],
  ['wagon', 'Wagon'],
];

/** Read "18k", "18,000", "$18000", "eighteen thousand" as 18000. */
function readAmount(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/[$,\s]/g, '');
  const kMatch = text.match(/^(\d+(?:\.\d+)?)k$/);
  if (kMatch) return Math.round(Number.parseFloat(kMatch[1]) * 1000);
  const n = Number.parseFloat(text.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const AMOUNT = '\\$?\\d[\\d,\\.]*\\s*k?';

// Verb fragments, inflected. People write "she wants a hatchback" and
// "doesn't want trucks" far more often than the bare infinitive.
const NEGATIVE = "(?:no|not|nothing|never|stop showing(?: me)?|don'?t|doesn'?t|didn'?t|won'?t|avoids?|hates?|dislikes?|sick of|tired of)";
const POSITIVE = '(?:prefers?|prefer(?:red|ring)?|likes?|loves?|wants?|wanted|looking for|keen on|more)';

/**
 * @returns {{changes: object[], unmatched: boolean}}
 * Each change: { path, value, describe }
 */
export function interpret(note, criteria) {
  const text = String(note || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return { changes: [], unmatched: false };

  const changes = [];
  const push = (path, value, describe) => changes.push({ path, value, describe });

  // A rule can match and still produce no change, because the scope already
  // says what she asked for. That is understood, not ignored, and the reply
  // needs to tell those two cases apart.
  let understood = false;
  const noted = (already) => { understood = true; return already; };

  // ---- Budget --------------------------------------------------------------
  const budgetUp = text.match(
    new RegExp(`(?:go (?:up )?to|stretch to|up to|as high as|max(?:imum)?(?: of)?|budget(?: is| of)?|under|below|less than|no more than)\\s*(${AMOUNT})`, 'i'),
  );
  if (budgetUp) {
    const amount = readAmount(budgetUp[1]);
    // Only treat it as a budget if it looks like a car price, not a mileage.
    if (amount && amount >= 2000 && amount <= 120000 && !/\s*(km|kms|kilometre|kilometer|mile)/.test(text.slice(budgetUp.index))) {
      push('hard.maxPrice', amount, `raised the price ceiling to $${amount.toLocaleString('en-CA')}`);
      if ((criteria.soft.idealPriceMax ?? 0) > amount * 0.95) {
        push('soft.idealPriceMax', Math.round(amount * 0.85), `moved the sweet spot to about $${Math.round(amount * 0.85).toLocaleString('en-CA')}`);
      }
    }
  }

  if (/\b(cheaper|too expensive|lower the (?:price|budget)|spend less|bring the price down)\b/.test(text) && !budgetUp) {
    const next = Math.round((criteria.hard.maxPrice ?? 16000) * 0.85);
    push('hard.maxPrice', next, `lowered the price ceiling to $${next.toLocaleString('en-CA')}`);
  }
  if (/\b(spend more|too cheap|nothing decent|these are all junk|higher budget)\b/.test(text) && !budgetUp) {
    const next = Math.round((criteria.hard.maxPrice ?? 16000) * 1.2);
    push('hard.maxPrice', next, `raised the price ceiling to $${next.toLocaleString('en-CA')}`);
  }

  // ---- Kilometres ----------------------------------------------------------
  const kmMatch = text.match(
    new RegExp(`(?:under|below|less than|no more than|max(?:imum)?(?: of)?|nothing (?:over|above|with more than))\\s*(${AMOUNT})\\s*(?:km|kms|kilometre|kilometer)`, 'i'),
  );
  if (kmMatch) {
    const amount = readAmount(kmMatch[1]);
    if (amount && amount >= 10000 && amount <= 500000) {
      push('hard.maxOdometerKm', amount, `capped kilometres at ${amount.toLocaleString('en-CA')} km`);
      push('soft.idealOdometerKm', Math.round(amount * 0.75), `set the preferred mileage around ${Math.round(amount * 0.75).toLocaleString('en-CA')} km`);
    }
  } else if (/\b(too many k(?:m|ilometre)s?|high mileage|lower (?:the )?(?:km|kilometres|mileage)|less km)\b/.test(text)) {
    const next = Math.round((criteria.hard.maxOdometerKm ?? 180000) * 0.8);
    push('hard.maxOdometerKm', next, `tightened the mileage limit to ${next.toLocaleString('en-CA')} km`);
  }

  // ---- Model year ----------------------------------------------------------
  const yearNewer = text.match(/\b((?:19|20)\d{2})\s*(?:or|and)?\s*(?:newer|later|up|\+)/);
  const nothingOlder = text.match(/\bnothing older than\s*((?:19|20)\d{2})/);
  const year = yearNewer?.[1] || nothingOlder?.[1];
  if (year) {
    push('hard.minYear', Number.parseInt(year, 10), `only showing ${year} and newer`);
  } else if (/\b(too old|newer cars?|something newer|these are ancient)\b/.test(text)) {
    const next = (criteria.hard.minYear ?? 2016) + 2;
    push('hard.minYear', next, `raised the oldest model year to ${next}`);
  } else if (/\b(older is fine|don'?t mind older|go older|open to older)\b/.test(text)) {
    const next = (criteria.hard.minYear ?? 2016) - 2;
    push('hard.minYear', next, `allowed cars back to ${next}`);
  }

  // ---- Makes ---------------------------------------------------------------
  const excluded = new Set(criteria.hard.excludeMakes || []);
  const preferred = new Set(criteria.soft.preferMakes || []);

  for (const make of MAKES) {
    const m = make.toLowerCase();
    const variants = m === 'mercedes-benz' ? '(?:mercedes(?:-benz)?|benz)' : m.replace(/[-\s]/g, '[-\\s]?');
    const nameRe = `${variants}s?`;

    if (new RegExp(`\\b${NEGATIVE}\\b[^.,;]{0,24}\\b${nameRe}\\b`, 'i').test(text)) {
      noted(excluded.add(make));
      preferred.delete(make);
    } else if (new RegExp(`\\b${POSITIVE}\\b[^.,;]{0,24}\\b${nameRe}\\b`, 'i').test(text)) {
      noted(preferred.add(make));
      excluded.delete(make);
    }
  }
  if (JSON.stringify([...excluded]) !== JSON.stringify(criteria.hard.excludeMakes || [])) {
    push('hard.excludeMakes', [...excluded], `no longer showing ${[...excluded].join(', ') || 'any excluded makes'}`);
  }
  if (JSON.stringify([...preferred]) !== JSON.stringify(criteria.soft.preferMakes || [])) {
    push('soft.preferMakes', [...preferred], `favouring ${[...preferred].join(', ')}`);
  }

  // ---- Body styles ---------------------------------------------------------
  const avoidBodies = new Set(criteria.soft.avoidBodyTypes || []);
  const preferBodies = new Set(criteria.soft.preferBodyTypes || []);
  for (const [word, canonical] of BODY_WORDS) {
    if (new RegExp(`\\b${NEGATIVE}\\b[^.,;]{0,20}\\b${word}s?\\b`, 'i').test(text)) {
      noted(avoidBodies.add(canonical));
      preferBodies.delete(canonical);
    } else if (new RegExp(`\\b${POSITIVE}\\b[^.,;]{0,20}\\b${word}s?\\b`, 'i').test(text)) {
      noted(preferBodies.add(canonical));
      avoidBodies.delete(canonical);
    }
  }
  if (JSON.stringify([...avoidBodies]) !== JSON.stringify(criteria.soft.avoidBodyTypes || [])) {
    push('soft.avoidBodyTypes', [...avoidBodies], `steering away from ${[...avoidBodies].join(', ')}`);
  }
  if (JSON.stringify([...preferBodies]) !== JSON.stringify(criteria.soft.preferBodyTypes || [])) {
    push('soft.preferBodyTypes', [...preferBodies], `leaning towards ${[...preferBodies].join(', ')}`);
  }

  // ---- Drivetrain ----------------------------------------------------------
  if (/\b(awd|all[- ]wheel|4wd|four[- ]wheel|winter traction|snow)\b/.test(text)
      && !/\bno (?:awd|all[- ]wheel|4wd)\b/.test(text)) {
    push('soft.wantAwd', true, 'prioritising all-wheel drive');
  }
  if (/\bno (?:awd|all[- ]wheel|4wd)\b|don'?t need awd/.test(text)) {
    push('soft.wantAwd', false, 'no longer prioritising all-wheel drive');
  }

  // ---- Distance ------------------------------------------------------------
  const distance = text.match(new RegExp(`within\\s*(${AMOUNT})\\s*(?:km|kilometre|kilometer)`, 'i'));
  if (distance) {
    const amount = readAmount(distance[1]);
    if (amount && amount >= 10 && amount <= 800) {
      push('location.radiusKm', amount, `limited the search to ${amount} km from Calgary`);
    }
  } else if (/\b(too far|closer to (?:home|calgary)|calgary only|in the city|nothing out of town)\b/.test(text)) {
    push('location.radiusKm', 50, 'limited the search to roughly Calgary and the immediate area');
  }

  // If nothing was understood at all, the note is still recorded for a human —
  // or for Claude — rather than being silently dropped.
  return {
    changes,
    understood: understood || changes.length > 0,
    unmatched: !understood && changes.length === 0,
    alreadySatisfied: understood && changes.length === 0,
  };
}

/** Apply a change list to a criteria object, returning a new object. */
export function applyChanges(criteria, changes) {
  const next = structuredClone(criteria);
  for (const { path, value } of changes) {
    const parts = path.split('.');
    let node = next;
    for (const key of parts.slice(0, -1)) {
      node[key] = node[key] ?? {};
      node = node[key];
    }
    node[parts.at(-1)] = value;
  }
  return next;
}

/**
 * Optional: hand anything the rules could not read to Claude, which returns
 * the same change shape. Only runs when an API key is configured.
 */
export async function interpretWithClaude(note, criteria) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const prompt = [
    'A person is refining an automated used-car search. Translate their note into changes to the search config.',
    `Current config:\n${JSON.stringify({ hard: criteria.hard, soft: criteria.soft, location: criteria.location }, null, 2)}`,
    `Their note:\n"""${note}"""`,
    'Return strict JSON: an array of {"path": "hard.maxPrice", "value": 18000, "describe": "raised the ceiling to $18,000"}.',
    'Valid paths are dotted keys that already exist in the config. Return [] if the note asks for nothing actionable.',
    'No markdown fence, JSON only.',
  ].join('\n\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.content?.map((c) => c.text).join('') ?? '';
    const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim());
    return Array.isArray(parsed) ? parsed.filter((c) => c.path && 'value' in c) : [];
  } catch {
    return [];
  }
}
