// api/translate.js
//
// Serverless backend for the "Translate" feature:
//   - Input Card: "Translate to English" button, so a claim pasted in
//     another language (e.g. a Malay or Chinese WhatsApp forward) can still
//     be analyzed by the trained model and the official-source checker,
//     both of which expect English text.
//   - Results Card: "Translate result" control, so the verdict, its
//     explanation, and the official-source summary can be read back in a
//     language the visitor picks.
//
// Reuses the same OPENAI_API_KEY as api/verify.js — no separate translation
// API/key to set up. Unlike api/verify.js this never turns on web_search:
// translation doesn't need live web results, so this is a plain, cheap,
// fast text-in/text-out call to the same model.
//
// Deploy target: Vercel (see api/verify.js's header comment for the general
// setup notes — the one OPENAI_API_KEY environment variable covers both
// endpoints, nothing extra to configure).
//
// Request:  POST { texts: string[], targetLanguage: string }
//           (or the single-string shorthand { text: string, targetLanguage })
// Response: 200 { translations: string[], targetLanguage }
//           4xx/5xx { error }

const OPENAI_MODEL = 'gpt-4.1-mini';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

// Keeps a single request small and cheap — callers batch the handful of
// text fields they need (e.g. verdict label + explanation + summary) into
// one call rather than firing one request per field.
const MAX_SEGMENTS = 8;
const MAX_SEGMENT_LENGTH = 4000;

const SYSTEM_PROMPT = `You are a professional translator working inside a health-news
fact-checking tool. You will be given a target language and a JSON array of
text segments. Translate EACH segment into the target language, staying as
literal and neutral as possible — this is health information, so do not
summarize, embellish, soften, add, remove, or fact-check anything, and add
no commentary of your own. Preserve emoji, numbers, and punctuation as-is.
If a segment is empty, return it as an empty string. If a segment is
already in the target language, return it unchanged.

Respond with ONLY a single JSON object — no markdown fences, no extra
commentary — in exactly this shape:
{ "translations": ["translated segment 1", "translated segment 2", ...] }
The "translations" array must have exactly as many entries, in the same
order, as the segments you were given.`;

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

  const targetLanguage = typeof (body && body.targetLanguage) === 'string' ? body.targetLanguage.trim() : '';
  if (!targetLanguage) {
    res.status(400).json({ error: 'Provide a targetLanguage, e.g. "Malay" or "English".' });
    return;
  }

  let texts = Array.isArray(body && body.texts)
    ? body.texts
    : (typeof (body && body.text) === 'string' ? [body.text] : null);

  if (!texts) {
    res.status(400).json({ error: 'Provide "texts" (an array of strings) or "text" (a single string).' });
    return;
  }
  if (texts.length === 0 || texts.length > MAX_SEGMENTS) {
    res.status(400).json({ error: `Provide between 1 and ${MAX_SEGMENTS} text segments.` });
    return;
  }

  texts = texts.map((t) => (typeof t === 'string' ? t.slice(0, MAX_SEGMENT_LENGTH) : ''));

  // Nothing worth sending to the model — hand back the (empty) segments
  // as-is rather than spending an API call on blanks.
  if (texts.every((t) => t.trim().length === 0)) {
    res.status(200).json({ translations: texts, targetLanguage });
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
        input: `Target language: ${targetLanguage}\n\nSegments (JSON array):\n${JSON.stringify(texts)}`,
        temperature: 0.1
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(502).json({ error: `OpenAI API error (${upstream.status})`, detail: errText });
      return;
    }

    const data = await upstream.json();

    // Same Responses API shape as api/verify.js — the "output" array mixes
    // item types, so pick out the assistant "message" item's text.
    const messageItem = (data.output || []).find((item) => item.type === 'message');
    const contentItem = messageItem && Array.isArray(messageItem.content)
      ? messageItem.content.find((c) => c.type === 'output_text')
      : null;
    const finalText = contentItem ? (contentItem.text || '').trim() : '';

    let parsed;
    try {
      const cleaned = finalText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(502).json({ error: 'Could not parse a translation from the model response.', raw: finalText });
      return;
    }

    let translations = Array.isArray(parsed.translations) ? parsed.translations : null;
    if (!translations || translations.length !== texts.length) {
      res.status(502).json({ error: 'Model returned an unexpected number of translated segments.', raw: finalText });
      return;
    }
    translations = translations.map((t) => (typeof t === 'string' ? t : String(t == null ? '' : t)));

    res.status(200).json({ translations, targetLanguage });
  } catch (err) {
    res.status(500).json({ error: 'Translation request failed.', detail: String((err && err.message) || err) });
  }
};
