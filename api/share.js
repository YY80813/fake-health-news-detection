// api/share.js
//
// Backend for the "Share" feature's real shareable link. Stores one
// analysis result (article text, both verdicts, sources) under a short
// random ID in Upstash Redis (see lib/upstash.js) and hands back a URL like
// https://your-site.vercel.app/result/<id> that anyone can open - not just
// the browser that originally ran the check. That pretty URL is served by
// the /result/:id -> /index.html rewrite in vercel.json; the front end
// (script.js's loadSharedResult) reads the ID out of the URL and calls
// GET /api/result?id=<id> to fetch what's stored here.
//
// This intentionally stores NOTHING beyond what's already shown on the
// results card - no IP address, no cookie, no visitor identity - so a
// shared link only ever reveals the same information the person who shared
// it could already see on screen.
//
// If Upstash isn't configured (see lib/upstash.js), this returns a clear
// 501 rather than a crash - script.js's getOrCreateShareLink() treats that
// the same as "sharable links aren't available yet" and falls back to
// sharing the homepage link instead, so nothing else on the site breaks.

const crypto = require('crypto');
const { isConfigured, redisSet } = require('../lib/upstash');

// Base62, so IDs are short and URL-safe with no encoding needed.
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ID_LENGTH = 10;

// How long a shared link stays retrievable. Generous on purpose (a FYP demo
// or a report screenshot should still work months later), but bounded so a
// long-abandoned deployment doesn't grow Upstash's free-tier storage
// forever. Purely a storage-hygiene choice - raise, lower, or remove
// entirely (pass no TTL to redisSet) as you prefer.
const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

// Basic anti-abuse limits - this endpoint is public, so someone could try
// to use it as a free arbitrary-JSON paste bin. These caps keep a single
// share small and cheap without trying to be exhaustive validation.
const MAX_TEXT_LENGTH = 20000;
const MAX_SUMMARY_LENGTH = 4000;
const MAX_SOURCES = 20;
const MAX_PAYLOAD_BYTES = 60000;

function generateId() {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

function truncate(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// Re-shapes and caps whatever the front end sent into the exact fields
// api/result.js (and script.js's renderSharedResult) expect - never store
// the request body verbatim, since it's attacker-controlled input.
function sanitizePayload(body) {
  const text = truncate(body.text, MAX_TEXT_LENGTH);
  if (!text || text.length < 10) return null;

  const officialResultIn = body.officialResult && typeof body.officialResult === 'object' ? body.officialResult : {};
  const officialResult = {
    verdict: typeof officialResultIn.verdict === 'string' ? officialResultIn.verdict : 'unavailable',
    confidence: typeof officialResultIn.confidence === 'number' ? officialResultIn.confidence : null,
    summary: truncate(officialResultIn.summary, MAX_SUMMARY_LENGTH),
    sources: Array.isArray(officialResultIn.sources)
      ? officialResultIn.sources.slice(0, MAX_SOURCES).map((src) => ({
          title: truncate(src && src.title, 300),
          url: truncate(src && src.url, 1000),
          publisher: truncate(src && src.publisher, 200)
        }))
      : []
  };

  const modelDataIn = body.modelData && typeof body.modelData === 'object' ? body.modelData : {};
  const resultsIn = modelDataIn.results && typeof modelDataIn.results === 'object' ? modelDataIn.results : {};
  const results = {};
  Object.keys(resultsIn).slice(0, 4).forEach((key) => {
    const r = resultsIn[key] || {};
    results[truncate(key, 40)] = {
      verdict: typeof r.verdict === 'string' ? r.verdict : 'unavailable',
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      summary: truncate(r.summary, MAX_SUMMARY_LENGTH)
    };
  });
  if (Object.keys(results).length === 0) return null;

  const primaryKey = typeof body.primaryKey === 'string' && results[body.primaryKey]
    ? body.primaryKey
    : Object.keys(results)[0];

  const timestamp = typeof body.timestamp === 'string' && !isNaN(Date.parse(body.timestamp))
    ? body.timestamp
    : new Date().toISOString();

  return {
    text,
    officialResult,
    modelData: { model: modelDataIn.model || primaryKey, primary: primaryKey, results },
    primaryKey,
    timestamp
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  if (!isConfigured()) {
    res.status(501).json({
      error: "Shareable links aren't set up on this deployment yet " +
             '(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set). See DEPLOYMENT.md.'
    });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = sanitizePayload(body);
    if (!payload) {
      res.status(400).json({ error: 'Missing or invalid result data - expected at least `text` and `modelData.results`.' });
      return;
    }

    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ error: 'This result is too large to share as a link.' });
      return;
    }

    const id = generateId();
    await redisSet(`result:${id}`, serialized, TTL_SECONDS);

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `https://${host}/result/${id}`;
    res.status(200).json({ id, url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create a shareable link', detail: String(err) });
  }
};
