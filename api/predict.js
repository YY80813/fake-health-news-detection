// api/predict.js
//
// Serverless backend for the "Your Model" tab - runs the PubMedBERT model
// that was fine-tuned in this project's notebooks (FYP_pubmedbert_finetuned)
// against the submitted article. This is completely independent of
// api/verify.js: it's your own trained classifier's opinion, not an LLM +
// web search.
//
// This calls a Hugging Face SPACE (see the hf-space/ folder in this repo),
// not HF's serverless Inference API - the Inference API only serves a
// curated "warm" allow-list of models and returns "Model not supported by
// provider hf-inference" for custom fine-tuned checkpoints like this one.
// Running the model yourself in a Space's own container (free CPU tier:
// 16GB RAM) sidesteps that limitation.
//
// The Space runs Gradio (not Docker/FastAPI - Hugging Face now requires a
// paid plan to create new Docker SDK Spaces on free hardware, but Gradio
// SDK Spaces are still free to create). Free accounts are currently being
// assigned "ZeroGPU" hardware for new Gradio Spaces, whose build pipeline
// forces a specific newer Gradio version (6.x as of writing) - see
// hf-space/requirements.txt and hf-space/README.md for why that matters.
//
// Gradio 4+ (including that 6.x) exposes API-enabled functions through a
// two-step, queue-based protocol rather than a single synchronous request:
//   1. POST {space_url}/gradio_api/call/predict  with { data: [...] }
//      -> returns { event_id: "..." } almost immediately.
//   2. GET  {space_url}/gradio_api/call/predict/<event_id>
//      -> a server-sent-events stream that ends with the actual result
//         once the function finishes running.
// callSpace() below does both steps and parses the SSE stream.
//
// Setup:
//   1. Push the fine-tuned model + tokenizer to a Hugging Face model repo
//      (see hf-space/README.md and the main DEPLOYMENT.md for the Colab
//      snippet - this step doesn't change from before).
//   2. Create a Hugging Face Space (Gradio SDK) and upload the files in
//      hf-space/ to it - full walkthrough in hf-space/README.md.
//   3. In your deployment platform, set:
//        HF_SPACE_URL = https://<your-username>-<space-name>.hf.space
//   4. Deploy. The front end calls POST /api/predict with { text }, which
//      drives the two-step call above against <HF_SPACE_URL>.
//
// NOTE: Like the other api/*.js files, this could not be live-tested from
// the environment that built it (no network route to huggingface.co
// there). If it errors after deploying, check the Space's own "Logs" tab
// first - a build failure or crash there means the request never reaches
// this function's error handling at all.

const SPACE_TIMEOUT_MS = 60000; // Spaces can take a while to wake from sleep

module.exports = async function handler(req, res) {
  // Allow the static front end to call this even if it's hosted on a
  // different origin.
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

  const spaceUrl = process.env.HF_SPACE_URL;
  if (!spaceUrl) {
    res.status(500).json({
      error: 'Server is missing HF_SPACE_URL. Set it to your Hugging Face Space URL as an environment variable in your deployment (see hf-space/README.md).'
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

  const base = spaceUrl.replace(/\/+$/, '');

  try {
    const scores = await callSpace(base, text);
    const result = interpretScores(scores);
    res.status(200).json(result);
  } catch (err) {
    // NOTE: the front end's getModelPrediction() reads `error` from a
    // non-ok response (same convention as api/verify.js) - use that key
    // here, or the real reason gets swallowed on the front end.
    res.status(502).json({
      error: 'Could not reach your trained model: ' + err.message
    });
  }
};

async function callSpace(base, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPACE_TIMEOUT_MS);

  try {
    // Step 1: kick off the call. Gradio's REST API takes positional inputs
    // as a "data" array matching the Interface's inputs list -
    // hf-space/app.py has one input (the Textbox), so a single-element
    // array here.
    const postRes = await fetch(base + '/gradio_api/call/predict', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [text] }),
      signal: controller.signal
    });
    if (!postRes.ok) {
      const errText = await postRes.text();
      throw new Error(`Space returned an error (${postRes.status}) starting the call: ${errText.slice(0, 300)}`);
    }
    const { event_id: eventId } = await postRes.json();
    if (!eventId) throw new Error('Space did not return an event_id to poll for the result.');

    // Step 2: read the result. This request stays open (as a
    // server-sent-events stream) until the Space's predict() function
    // finishes running, which is also where a cold-started Space's wake-up
    // delay shows up - the same AbortController/timeout above covers both
    // steps combined.
    const getRes = await fetch(`${base}/gradio_api/call/predict/${eventId}`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      signal: controller.signal
    });
    if (!getRes.ok) {
      const errText = await getRes.text();
      throw new Error(`Space returned an error (${getRes.status}) fetching the result: ${errText.slice(0, 300)}`);
    }

    const raw = await getRes.text();
    return parseSseResult(raw);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The model Space took too long to respond (it may be waking up from sleep - try again in a moment).');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Parses Gradio's server-sent-events response into the actual value
// returned by hf-space/app.py's predict(). A typical stream looks like:
//   event: complete
//   data: [{"scores": [...]}]
//
// (possibly preceded by "event: heartbeat" keep-alive lines with no data,
// which are ignored here - only the *last* "data:" line is used, since
// that's the one carrying the final result.)
function parseSseResult(raw) {
  let lastData = null;
  let sawError = false;

  for (const line of raw.split('\n')) {
    if (line.startsWith('event: error')) sawError = true;
    if (line.startsWith('data:')) lastData = line.slice(5).trim();
  }

  if (!lastData) throw new Error('No result received from the model Space (empty event stream).');

  let parsed;
  try {
    parsed = JSON.parse(lastData);
  } catch {
    throw new Error('Could not parse the model Space\'s response.');
  }

  if (sawError) {
    throw new Error(Array.isArray(parsed) ? String(parsed[0]) : 'Space returned an error.');
  }

  // Gradio wraps the function's return value as the first element of the
  // final "data" array. hf-space/app.py's predict() returns either
  // { scores: [...] } or { error: "..." } (its JSON output component).
  const output = Array.isArray(parsed) ? parsed[0] : null;
  if (!output) throw new Error('Unexpected response shape from the model Space.');
  if (output.error) throw new Error(output.error);
  if (!Array.isArray(output.scores)) throw new Error('Unexpected response shape from the model Space.');
  return output.scores;
}

function interpretScores(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return { verdict: 'unavailable', confidence: null, summary: 'Model returned no scores.', raw: scores };
  }

  const top = [...scores].sort((a, b) => b.score - a.score)[0];

  // Works whether the model's config.json has id2label set to "Fake"/"Real"
  // (recommended - see hf-space/README.md and the Colab push_to_hub step)
  // or was left as the transformers default "LABEL_0"/"LABEL_1" (0 = Fake,
  // 1 = Real, per how labels were encoded in the training notebooks).
  const labelText = String(top.label || '').toLowerCase();
  const isFake = labelText.includes('fake') || labelText === 'label_0';
  const isReal = labelText.includes('real') || labelText === 'label_1';
  const verdict = isFake ? 'fake' : isReal ? 'real' : 'unavailable';
  const confidencePct = Math.round((top.score || 0) * 100);

  const summaries = {
    fake: `Your fine-tuned PubMedBERT model classified this article as likely FAKE health news (${confidencePct}% confidence).`,
    real: `Your fine-tuned PubMedBERT model classified this article as likely REAL health news (${confidencePct}% confidence).`,
    unavailable: `Could not interpret the model's output label ("${top.label}").`
  };

  return {
    verdict,
    confidence: top.score,
    summary: summaries[verdict],
    raw: scores
  };
}
