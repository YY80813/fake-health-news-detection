// api/verify.js
//
// Serverless backend for the "Official Source Check" feature.
// This is the ONLY place the LLM API key lives — never put it in script.js,
// because anything in script.js is downloaded and readable by every visitor.
//
// Deploy target: Vercel (auto-detects any file under /api as a serverless
// function, zero extra config needed). Other platforms work too (Netlify
// Functions, Cloudflare Workers, a small Express server) but may need the
// handler wrapped differently — the logic below is platform-agnostic.
//
// Setup:
//   1. Get a Gemini API key: https://aistudio.google.com/apikey
//   2. In your deployment platform, set an environment variable:
//        GEMINI_API_KEY = AQ....
//      (On Vercel: Project Settings -> Environment Variables)
//   3. Deploy. The front end calls POST /api/verify with { text }.
//
// What it does:
//   Sends the submitted article to Gemini with Google Search grounding
//   turned on, so it can search the live web for related coverage. Gemini's
//   grounding tool does NOT support a domain allowlist the way some other
//   providers' search tools do, so instead of trusting that restriction to
//   happen upstream, this function enforces it itself: after the model
//   responds, every cited source is checked against ALLOWED_DOMAINS
//   (BBC Health, Malaysia's Ministry of Health / KKM, WHO, CDC) and anything
//   outside that list is dropped. If NOTHING it found was on an official
//   domain, the verdict is forced to "unverified" — the model's opinion is
//   never trusted blind on which sources count as official.
//
// NOTE: This was written and syntax-checked, but could not be live-tested
// against the real Gemini API from the environment that built it (no network
// route to generativelanguage.googleapis.com there). Test it once deployed —
// see DEPLOYMENT.md — and if Google has changed the request/response shape
// since this was written, the two most likely breakage points are the model
// name (GEMINI_MODEL below) and the grounding tool key ("google_search").

const GEMINI_MODEL = 'gemini-flash-latest'; // Google-maintained alias for their current stable Flash model
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Add or remove domains here to change what counts as an "official source".
// Matching is by hostname suffix (e.g. "bbc.com" also matches "www.bbc.com").
const ALLOWED_DOMAINS = [
  'bbc.com',
  'bbc.co.uk',
  'kkm.gov.my',
  'moh.gov.my',
  'who.int',
  'cdc.gov'
];

const SYSTEM_PROMPT = `You are a fact-checking assistant working alongside a health-news
classifier. You will be given a submitted health news article.

Use Google Search to check whether the article's central health claims are
supported, contradicted, or simply not addressed by OFFICIAL sources —
specifically BBC Health, Malaysia's Ministry of Health (KKM), WHO, or CDC.
When you search, prefer queries scoped to those sites (for example
"site:kkm.gov.my <topic>" or "site:who.int <topic>" or "site:bbc.com/news/health <topic>"
or "site:cdc.gov <topic>"). Ignore blogs, forums, social media, and outlets
that are not one of these four official sources, even if they appear in
search results.

Respond with ONLY a single JSON object — no markdown fences, no extra
commentary — in exactly this shape:
{
  "verdict": "supported" | "contradicted" | "unverified",
  "confidence": 0.0 to 1.0,
  "summary": "2-3 sentence plain-language explanation of what you found"
}

Rules:
- "supported": the official sources you found back up the article's central claim(s).
- "contradicted": the official sources you found directly conflict with the article's claim(s).
- "unverified": search found nothing relevant on an official source either way.
- "confidence" reflects how directly the evidence addresses THIS article's
  specific claims (1.0 = an official source discusses this exact claim; lower
  = related but more indirect; for "unverified", confidence should usually be
  low, e.g. 0.2-0.4).
Do not list sources yourself — the calling system reads those separately
from the actual search results.`;

function hostnameMatchesAllowed(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return ALLOWED_DOMAINS.some((domain) => h === domain || h.endsWith('.' + domain));
}

module.exports = async function handler(req, res) {
  // Allow the static front end to call this even if it's hosted on a
  // different origin (e.g. GitHub Pages calling a Vercel function).
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. Set it as an environment variable in your deployment.'
    });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }

  const text = (body && body.text) || '';
  if (typeof text !== 'string' || text.trim().length < 30) {
    res.status(400).json({ error: 'Provide at least 30 characters of article text.' });
    return;
  }

  try {
    const upstream = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: 'user', parts: [{ text: `Submitted article:\n\n"""${text}"""` }] }
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(502).json({ error: `Gemini API error (${upstream.status})`, detail: errText });
      return;
    }

    const data = await upstream.json();
    const candidate = (data.candidates && data.candidates[0]) || null;

    const finalText = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((p) => p.text || '').join('\n').trim()
      : '';

    let parsed;
    try {
      const cleaned = finalText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(200).json({
        verdict: 'unverified',
        confidence: 0.2,
        summary: 'Could not parse a structured verdict from the model response.',
        sources: [],
        raw: finalText
      });
      return;
    }

    // Pull the REAL search results Gemini's grounding tool actually used,
    // rather than trusting anything the model claims in prose. Then filter
    // to official domains only.
    const groundingChunks = (candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
    const seen = new Set();
    const officialSources = [];
    for (const chunk of groundingChunks) {
      const web = chunk.web;
      if (!web || !web.uri) continue;
      let hostname = '';
      try {
        hostname = new URL(web.uri).hostname;
      } catch {
        continue;
      }
      if (!hostnameMatchesAllowed(hostname)) continue;
      if (seen.has(web.uri)) continue;
      seen.add(web.uri);
      officialSources.push({
        title: web.title || web.uri,
        url: web.uri,
        publisher: hostname.replace(/^www\./, '')
      });
    }

    // Safety net: if grounding didn't turn up anything on an official
    // domain, don't let a "supported"/"contradicted" verdict stand — we
    // can't back it with an official citation, so it's unverified.
    if (officialSources.length === 0 && parsed.verdict !== 'unverified') {
      parsed.verdict = 'unverified';
      parsed.confidence = Math.min(parsed.confidence ?? 0.3, 0.3);
      parsed.summary = (parsed.summary ? parsed.summary + ' ' : '') +
        '(No citation from an official source — BBC, KKM, WHO, or CDC — was found, so this could not be verified.)';
    }

    res.status(200).json({
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      summary: parsed.summary,
      sources: officialSources
    });
  } catch (err) {
    res.status(500).json({ error: 'Request to Gemini API failed', detail: String(err) });
  }
};
