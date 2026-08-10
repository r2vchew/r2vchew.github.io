// Minimal HTTP helper. No third-party dependencies on purpose: the workflow
// should never fail because an npm install went sideways.

const UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/127.0.0.0 Safari/537.36',
].join(' ');

const BROWSER_HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-CA,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Some sources sit behind bot protection that rejects datacentre IPs such as
 * GitHub's runners. If a scraping-proxy key is configured we transparently
 * route through it; otherwise we go direct. Everything works without a key,
 * just with a higher chance that a given source returns nothing.
 */
function throughProxy(url) {
  const bee = process.env.SCRAPINGBEE_API_KEY;
  if (bee) {
    const u = new URL('https://app.scrapingbee.com/api/v1/');
    u.searchParams.set('api_key', bee);
    u.searchParams.set('url', url);
    u.searchParams.set('render_js', 'false');
    u.searchParams.set('country_code', 'ca');
    return u.toString();
  }
  const sapi = process.env.SCRAPERAPI_KEY;
  if (sapi) {
    const u = new URL('https://api.scraperapi.com/');
    u.searchParams.set('api_key', sapi);
    u.searchParams.set('url', url);
    u.searchParams.set('country_code', 'ca');
    return u.toString();
  }
  return url;
}

export function proxyEnabled() {
  return Boolean(process.env.SCRAPINGBEE_API_KEY || process.env.SCRAPERAPI_KEY);
}

/**
 * Fetch with retries and exponential backoff. Resolves to
 * `{ ok, status, body, url }` rather than throwing, so one bad source can
 * never take down a whole run.
 */
export async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    attempts = 3,
    timeoutMs = 30000,
    useProxy = true,
    label = url,
  } = options;

  const target = useProxy ? throughProxy(url) : url;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        method,
        headers: { ...BROWSER_HEADERS, ...headers },
        body,
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      clearTimeout(timer);

      if (res.ok) {
        return { ok: true, status: res.status, body: text, url: res.url };
      }

      // 4xx other than 429 will not fix themselves on retry.
      if (res.status < 500 && res.status !== 429) {
        return { ok: false, status: res.status, body: text, url: res.url, error: `HTTP ${res.status}` };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message;
    }

    if (attempt < attempts) {
      const backoff = 1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 750);
      console.log(`  retry ${attempt}/${attempts - 1} for ${label} in ${backoff}ms (${lastError})`);
      await sleep(backoff);
    }
  }

  return { ok: false, status: 0, body: '', url, error: lastError || 'unknown failure' };
}

/** Politeness delay so we never hammer a source. */
export async function courtesyDelay(ms = 1200) {
  await sleep(ms + Math.floor(Math.random() * 600));
}
