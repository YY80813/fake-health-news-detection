// api/news.js
//
// Backend for the small "Latest from Official Health Sources" panel on the
// homepage. Unlike api/verify.js, this does NOT call an LLM at all — it's
// just server-side RSS fetching + light parsing. No API key needed, no
// rate limits to fight, nothing to configure. Runs entirely on Vercel's
// free tier for free.
//
// Why server-side and not straight from the browser: RSS feeds generally
// don't send CORS headers, so a fetch() from script.js directly would be
// blocked by the browser. Fetching here and handing back plain JSON avoids
// that entirely.
//
// NOTE: These feed URLs are the well-established, long-stable ones for each
// outlet as of when this was written, but this function could not be
// live-tested from the environment that built it (no network route to
// these hosts there — same limitation noted in api/verify.js). If a feed
// stops returning items, it's most likely because the outlet changed its
// RSS URL; each entry below is independent and safe to replace.
//
// Malaysia's Ministry of Health (KKM) doesn't have a confirmed stable RSS
// feed, so it isn't included here — the front end links out to KKM's site
// directly instead of pulling live headlines from it. If you find KKM's
// actual feed URL, add it to FEEDS below in the same shape.

const FEEDS = [
  { publisher: 'BBC Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  { publisher: 'WHO', url: 'https://www.who.int/rss-feeds/news-english.xml' },
  { publisher: 'CDC', url: 'https://tools.cdc.gov/api/v2/resources/media/403372.rss' }
];

const MAX_ITEMS_PER_FEED = 5;
const MAX_TOTAL_ITEMS = 8;

// Only show headlines published within this many days ("1 month" threshold).
// Anything older — or with a date we can't parse, so we can't confirm it's
// recent — is dropped rather than shown.
const MAX_AGE_DAYS = 30;

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  let value = match[1];
  // Strip CDATA wrapper if present
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) value = cdata[1];
  return value.trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function parseRssItems(xmlText, publisher) {
  const items = [];
  const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = decodeEntities(extractTag(block, 'title'));
    const link = decodeEntities(extractTag(block, 'link'));
    const pubDate = extractTag(block, 'pubDate');
    if (!title || !link) continue;
    items.push({ title, url: link, publisher, pubDate: pubDate || null });
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const response = await fetch(feed.url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HealthNewsDetector/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const xmlText = await response.text();
    return parseRssItems(xmlText, feed.publisher);
  } catch {
    // A single feed failing (host down, URL changed, timeout) should never
    // take down the whole panel — just contribute nothing.
    return [];
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    let items = results.flat();

    // Recency threshold: drop anything older than MAX_AGE_DAYS (or with no
    // parseable date, since we can't confirm it's within the window).
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    items = items.filter((item) => {
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN;
      return !isNaN(t) && t >= cutoff;
    });

    // Sort newest-first when pubDate parses cleanly; items without a valid
    // date sink to the end rather than breaking the sort.
    items.sort((a, b) => {
      const da = a.pubDate ? Date.parse(a.pubDate) : NaN;
      const db = b.pubDate ? Date.parse(b.pubDate) : NaN;
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    items = items.slice(0, MAX_TOTAL_ITEMS);

    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load official news feeds', detail: String(err) });
  }
};
