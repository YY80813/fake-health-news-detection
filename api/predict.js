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
// Setup:
//   1. Push the fine-tuned model + tokenizer to a Hugging Face model repo
//      (see hf-space/README.md and the main DEPLOYMENT.md for the Colab
//      snippet - this step doesn't change from before).
//   2. Create a Hugging Face Space (Docker SDK) and upload the files in
//      hf-space/ to it - full walkthrough in hf-space/README.md.
//   3. In your deployment platform, set:
//        HF_SPACE_URL = https://<your-username>-<space-name>.hf.space
//   4. Deploy. The front end calls POST /api/predict with { text }, which
//      forwards to POST <HF_SPACE_URL>/predict.
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

  const endpoint = spaceUrl.replace(/\/+$/, '') + '/predict';

  try {
    const scores = await callSpace(endpoint, text);
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

async function callSpace(endpoint, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPACE_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The model Space took too long to respond (it may be waking up from sleep - try again in a moment).');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Space returned an error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data && !Array.isArray(data) && data.error) throw new Error(data.error);
  if (!Array.isArray(data)) throw new Error('Unexpected response shape from the model Space.');
  return data;
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
