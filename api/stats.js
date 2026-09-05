// api/stats.js
//
// Site-wide aggregate stats, backing the "Site-wide (all visitors)" line in
// the Stats Dashboard (see script.js's loadGlobalStats/recordGlobalStat).
// This is the database-backed counterpart to the per-browser numbers
// updateStats() already keeps in localStorage - those only ever reflect one
// browser; these five Redis counters are shared across every visitor.
//
// Deliberately minimal: only a verdict and a confidence number are ever
// recorded here, never the article text or any per-person identity - so
// this can never turn into a log of what anyone submitted, only a running
// total of how many checks came back which way.
//
//   GET  /api/stats  -> { total, fake, real, avgConfidence, unavailable? }
//   POST /api/stats  -> { verdict, confidence } increments the counters
//                        (called once per completed check, right after the
//                        official-source verdict comes back)
//
// If Upstash isn't configured, GET returns { unavailable: true } with all
// counts at 0 rather than an error, and POST silently no-ops - the Stats
// Dashboard just hides the global-stats line in that case (see script.js).

const { isConfigured, redisMget, redisIncr, redisIncrByFloat } = require('../lib/upstash');

const KEYS = {
  total: 'stats:total',
  fake: 'stats:fake',
  real: 'stats:real',
  confidenceSum: 'stats:confidenceSum',
  confidenceSamples: 'stats:confidenceSamples'
};

async function handleGet(res) {
  if (!isConfigured()) {
    res.status(200).json({ unavailable: true, total: 0, fake: 0, real: 0, avgConfidence: null });
    return;
  }

  try {
    const [total, fake, real, confidenceSum, confidenceSamples] = await redisMget([
      KEYS.total, KEYS.fake, KEYS.real, KEYS.confidenceSum, KEYS.confidenceSamples
    ]);

    const totalNum = parseInt(total, 10) || 0;
    const fakeNum = parseInt(fake, 10) || 0;
    const realNum = parseInt(real, 10) || 0;
    const sumNum = parseFloat(confidenceSum) || 0;
    const samplesNum = parseInt(confidenceSamples, 10) || 0;

    res.status(200).json({
      total: totalNum,
      fake: fakeNum,
      real: realNum,
      avgConfidence: samplesNum > 0 ? sumNum / samplesNum : null
    });
  } catch (err) {
    // Soft-fail: a stats hiccup should never look like the whole site is
    // broken, so this comes back as "unavailable" (200) rather than a 500.
    res.status(200).json({ unavailable: true, total: 0, fake: 0, real: 0, avgConfidence: null, detail: String(err) });
  }
}

async function handlePost(req, res) {
  if (!isConfigured()) {
    // No error - the caller (recordGlobalStat in script.js) doesn't wait on
    // or surface this response either way.
    res.status(200).json({ recorded: false });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const verdict = typeof body.verdict === 'string' ? body.verdict : 'unavailable';
    const confidence = isFiniteNumber(body.confidence) ? body.confidence : null;

    const ops = [redisIncr(KEYS.total)];
    if (verdict === 'contradicted') ops.push(redisIncr(KEYS.fake));
    if (verdict === 'supported') ops.push(redisIncr(KEYS.real));
    if (confidence !== null) {
      ops.push(redisIncrByFloat(KEYS.confidenceSum, confidence));
      ops.push(redisIncr(KEYS.confidenceSamples));
    }
    await Promise.all(ops);

    res.status(200).json({ recorded: true });
  } catch (err) {
    // Same soft-fail philosophy as the GET handler - a missed increment
    // should never surface as a user-facing error.
    res.status(200).json({ recorded: false, detail: String(err) });
  }
}

function isFiniteNumber(n) {
  return typeof n === 'number' && isFinite(n);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    await handleGet(res);
    return;
  }

  if (req.method === 'POST') {
    await handlePost(req, res);
    return;
  }

  res.status(405).json({ error: 'Use GET or POST' });
};
