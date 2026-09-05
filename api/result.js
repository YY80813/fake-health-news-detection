// api/result.js
//
// Looks up one shared result created by api/share.js, by ID. Called as
// GET /api/result?id=<id> (a query string, not a /api/result/<id> path -
// deliberately kept simple/flat rather than relying on Vercel's bracket
// dynamic-route file naming, which this project doesn't use anywhere else).
// The pretty, shareable URL a Reader actually sees - /result/<id> - is
// served by the rewrite in vercel.json, which maps it to /index.html;
// script.js's loadSharedResult() then reads the ID from the page's own URL
// and calls this endpoint to fetch the data to render.

const { isConfigured, redisGet } = require('../lib/upstash');

// Same alphabet/length as api/share.js's generateId() - anything else can't
// possibly be a real ID, so it's rejected before ever touching Redis.
const ID_PATTERN = /^[A-Za-z0-9]{6,32}$/;

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

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({ error: 'Missing or invalid `id` query parameter.' });
    return;
  }

  if (!isConfigured()) {
    res.status(501).json({
      error: "Shareable links aren't set up on this deployment " +
             '(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set). See DEPLOYMENT.md.'
    });
    return;
  }

  try {
    const stored = await redisGet(`result:${id}`);
    if (!stored) {
      res.status(404).json({ error: 'This shared result was not found - the link may be wrong, or it may have expired.' });
      return;
    }
    const payload = JSON.parse(stored);
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load this shared result', detail: String(err) });
  }
};
