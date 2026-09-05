// lib/upstash.js
//
// Minimal helper for calling Upstash Redis's REST API directly via fetch -
// no SDK, no new dependency, consistent with the rest of this project's
// api/*.js files (which all call OpenAI/Hugging Face/RSS feeds the same
// way: plain `fetch`, no client libraries).
//
// Used by:
//   - api/share.js  - stores each "Share" result under a short random ID
//     so a permalink like /result/<id> can be opened by anyone, not just
//     the browser that ran the check.
//   - api/stats.js  - site-wide aggregate counters (total checks / fake /
//     real / confidence), so the Stats Dashboard can show numbers across
//     every visitor, not just the one browser's own localStorage.
//
// This file is NOT under /api, so Vercel won't treat it as a route of its
// own - it's just a plain module the two files above `require(...)`.
//
// Setup: create a free Upstash Redis database (either directly at
// upstash.com, or via Vercel's Marketplace "Upstash for Redis" integration,
// which wires the env vars below into your project automatically) and set:
//   UPSTASH_REDIS_REST_URL   = https://<your-db>.upstash.io
//   UPSTASH_REDIS_REST_TOKEN = <the REST token from that database's page>
// See DEPLOYMENT.md for the full walkthrough. If these aren't set, every
// function below throws a clear error, and api/share.js / api/stats.js both
// catch that and degrade gracefully (shareable links and global stats just
// aren't available - everything else on the site keeps working).

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const REQUEST_TIMEOUT_MS = 8000;

function isConfigured() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(
      'Upstash Redis is not configured on this deployment (UPSTASH_REDIS_REST_URL / ' +
      'UPSTASH_REDIS_REST_TOKEN are missing). See DEPLOYMENT.md for setup steps.'
    );
  }
}

// Runs a read-style command with no body, e.g. redisRaw('get/myKey') or
// redisRaw('mget/key1/key2/key3'). Path segments must already be
// URL-encoded by the caller.
async function redisRaw(commandPath) {
  assertConfigured();
  const response = await fetch(`${UPSTASH_URL}/${commandPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Upstash request failed (${response.status})`);
  }
  return data.result;
}

async function redisGet(key) {
  return redisRaw(`get/${encodeURIComponent(key)}`);
}

// Reads several keys in one round trip. Returns an array of values (or null
// for keys that don't exist), in the same order as `keys`.
async function redisMget(keys) {
  if (keys.length === 0) return [];
  return redisRaw(`mget/${keys.map(encodeURIComponent).join('/')}`);
}

// Stores `value` (a string - JSON.stringify it yourself if needed) under
// `key`, with an optional TTL in seconds. Sends the value in the request
// body rather than the URL, since Upstash appends a body to the command
// path itself (see their REST API docs) - this avoids URL-encoding/length
// limits for larger JSON blobs like a full shared result.
async function redisSet(key, value, exSeconds) {
  assertConfigured();
  const url = new URL(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`);
  if (exSeconds) url.searchParams.set('EX', String(exSeconds));
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: value,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Upstash SET failed (${response.status})`);
  }
  return data.result;
}

// Atomically increments an integer counter by 1 (creating it at 0 first if
// it doesn't exist yet) and returns the new value.
async function redisIncr(key) {
  return redisRaw(`incr/${encodeURIComponent(key)}`);
}

// Atomically increments a float counter (used for summing confidence
// scores, which aren't whole numbers) and returns the new value as a string.
async function redisIncrByFloat(key, amount) {
  return redisRaw(`incrbyfloat/${encodeURIComponent(key)}/${encodeURIComponent(amount)}`);
}

module.exports = {
  isConfigured,
  redisGet,
  redisMget,
  redisSet,
  redisIncr,
  redisIncrByFloat
};
