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
//   1. Get an OpenAI API key: https://platform.openai.com/api-keys
//   2. In your deployment platform, set an environment variable:
//        OPENAI_API_KEY = sk-...
//      (On Vercel: Project Settings -> Environment Variables)
//   3. Deploy. The front end calls POST /api/verify with { text }.
//
// What it does:
//   Sends the submitted article to OpenAI's Responses API with the built-in
//   web_search tool turned on, so it can search the live web for related
//   coverage. Like most providers' web-search tools, this one doesn't offer
//   a reliable "only search these domains" restriction — so instead of
//   trusting that to happen upstream, this function enforces it itself:
//   after the model responds, every citation it actually used is checked
//   against ALLOWED_DOMAINS (BBC Health, Malaysia's Ministry of Health /
//   KKM, WHO, CDC) and anything outside that list is dropped. If NOTHING it
//   found was on an official domain, the verdict is forced to "unverified"
//   — the model's own opinion on what counts as official is never trusted
//   blind.
//
// NOTE: This was written and syntax-checked, but could not be live-tested
// against the real OpenAI API from the environment that built it (no
// network route to api.openai.com there). Test it once deployed — see
// DEPLOYMENT.md — and if OpenAI has changed the request/response shape
// since this was written, the two most likely breakage points are the
// model name (OPENAI_MODEL below) and the web-search tool's type string
// ("web_search" — older docs called this "web_search_preview").

const OPENAI_MODEL = 'gpt-4.1-mini'; // swap to 'gpt-5-mini' or similar if you want a newer model
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

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

Use web search to check whether the article's central health claims are
supported, contradicted, or simply not addressed by OFFICIAL sources —
specifically BBC Health, Malaysia's Ministry of Health (KKM), WHO, or CDC.
When you search, prefer queries scoped to those sites (for example
"site:kkm.gov.my <topic>" or "site:who.int <topic>" or "site:bbc.com/news/health <topic>"
or "site:cdc.gov <topic>"). Ignore blogs, forums, social media, and outlets
that are not one of these four official sources, even if they appear in
search results.

The submitted article may be in any language (it may also already have been
machine-translated to English by the front end before reaching you - either
way, treat it the same). Regardless of what language the article itself is
in, your "summary" field must always be written in English — the site has
its own separate "Translate result" feature for showing it in another
language afterward, so do not translate or code-switch here.

Respond with ONLY a single JSON object — no markdown fences, no extra
commentary — in exactly this shape:
{
  "verdict": "supported" | "contradicted" | "unverified",
  "confidence": 0.0 to 1.0,
  "summary": "2-3 sentence plain-language explanation of what you found, written in English"
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing OPENAI_API_KEY. Set it as an environment variable in your deployment.'
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
    const upstream = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: SYSTEM_PROMPT,
        input: `Submitted article:\n\n"""${text}"""`,
        tools: [{ type: 'web_search' }],
        // Force the model to actually call web_search rather than silently
        // answering from its own training knowledge. Left as the default
        // "auto", the model can (and did, in testing) skip the tool
        // entirely for claims it already "knows" the answer to - producing
        // no url_citation annotations at all, which the safety-net check
        // below then reports as "unverified" even when the underlying fact
        // is one WHO/CDC/BBC/KKM plainly document. "required" forces at
        // least one tool call per OpenAI's standard tool-calling contract.
        tool_choice: 'required',
        temperature: 0.2
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(502).json({ error: `OpenAI API error (${upstream.status})`, detail: errText });
      return;
    }

    const data = await upstream.json();

    // The Responses API returns an "output" array mixing tool-call items
    // (e.g. web_search_call) with the final assistant "message" item. We
    // want the message's text and its url_citation annotations.
    const messageItem = (data.output || []).find((item) => item.type === 'message');
    const contentItem = messageItem && Array.isArray(messageItem.content)
      ? messageItem.content.find((c) => c.type === 'output_text')
      : null;

    const finalText = contentItem ? (contentItem.text || '').trim() : '';
    const annotations = (contentItem && contentItem.annotations) || [];

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

    // Pull the REAL citations the model's web search actually used, rather
    // than trusting anything it claims in prose. Then filter to official
    // domains only.
    const seen = new Set();
    const officialSources = [];
    for (const annotation of annotations) {
      if (annotation.type !== 'url_citation' || !annotation.url) continue;
      let hostname = '';
      try {
        hostname = new URL(annotation.url).hostname;
      } catch {
        continue;
      }
      if (!hostnameMatchesAllowed(hostname)) continue;
      if (seen.has(annotation.url)) continue;
      seen.add(annotation.url);
      officialSources.push({
        title: annotation.title || annotation.url,
        url: annotation.url,
        publisher: hostname.replace(/^www\./, '')
      });
    }

    // Safety net: if the citations didn't turn up anything on an official
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
    res.status(500).json({ error: 'Request to OpenAI API failed', detail: String(err) });
  }
};
