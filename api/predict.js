// api/predict.js
//
// Serverless backend for the "Your Model" tab - runs the PubMedBERT model
// that was fine-tuned in this project's notebooks (FYP_pubmedbert_finetuned)
// against the submitted article, using Hugging Face's serverless Inference
// API. This is completely independent of api/verify.js: it's your own
// trained classifier's opinion, not an LLM + web search.
//
// Setup:
//   1. Push the fine-tuned model + tokenizer to a Hugging Face model repo.
//      In the Colab notebook, right after training (so `model` still holds
//      the best checkpoint - TrainingArguments used load_best_model_at_end):
//
//        !pip install huggingface_hub --quiet
//        from huggingface_hub import notebook_login
//        notebook_login()  # paste a HF *write* token: huggingface.co/settings/tokens
//
//        # Make the labels human-readable instead of the transformers
//        # default "LABEL_0"/"LABEL_1" (0 = Fake, 1 = Real in this project).
//        model.config.id2label = {0: "Fake", 1: "Real"}
//        model.config.label2id = {"Fake": 0, "Real": 1}
//
//        REPO_ID = "your-hf-username/pubmedbert-fake-health-news"  # <-- change this
//        model.push_to_hub(REPO_ID)
//        tokenizer.push_to_hub(REPO_ID)
//
//   2. Create a Hugging Face access token (a "Read" token is enough once the
//      model is pushed): https://huggingface.co/settings/tokens
//   3. In your deployment platform, set:
//        HF_API_TOKEN  = hf_...
//        HF_MODEL_REPO = your-hf-username/pubmedbert-fake-health-news
//   4. Deploy. The front end calls POST /api/predict with { text }.
//
// NOTE: Like api/verify.js and api/news.js, this could not be live-tested
// from the environment that built it (no network route to huggingface.co
// there). The two most likely things to double check once deployed:
//   - The response shape: HF's router usually returns either
//     [{label, score}, ...] or [[{label, score}, ...]] (batched) - this
//     code normalizes both, but if HF changes the shape again, log
//     `raw` from the response (see interpretScores) to see what came back.
//   - Cold starts: a model that hasn't been called recently can return a
//     503 while HF spins up a CPU worker for it. This code retries with a
//     short wait when that happens, so the first request after a while may
//     take 10-30 seconds - that's expected, not a bug.

const HF_ROUTER_URL = 'https://router.huggingface.co/hf-inference/models/';
const MAX_COLD_START_ATTEMPTS = 3;

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

  const apiToken = process.env.HF_API_TOKEN;
  const modelRepo = process.env.HF_MODEL_REPO;
  if (!apiToken || !modelRepo) {
    res.status(500).json({
      error: 'Server is missing HF_API_TOKEN or HF_MODEL_REPO. Set both as environment variables in your deployment.'
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

  // HF model IDs are "namespace/name" - the router expects that path as-is
  // (not URL-encoded), so build the URL by hand rather than encodeURIComponent.
  const endpoint = HF_ROUTER_URL + modelRepo;

  try {
    const scores = await callWithColdStartRetry(endpoint, apiToken, text);
    const result = interpretScores(scores);
    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({
      verdict: 'unavailable',
      confidence: null,
      summary: 'Could not reach your trained model: ' + err.message
    });
  }
};

async function callWithColdStartRetry(endpoint, apiToken, text, attempt = 1) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiToken}`
    },
    // truncation/max_length here mirrors the max_length=128 tokens the
    // model was fine-tuned with in the notebooks.
    body: JSON.stringify({
      inputs: text,
      parameters: { truncation: true, max_length: 128 },
      options: { wait_for_model: true }
    })
  });

  if (response.status === 503 && attempt < MAX_COLD_START_ATTEMPTS) {
    // Model is "cold" - HF is spinning up a worker for it. Wait roughly as
    // long as HF says to, then retry.
    const errBody = await response.json().catch(() => ({}));
    const waitMs = Math.min((errBody.estimated_time || 5) * 1000, 15000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return callWithColdStartRetry(endpoint, apiToken, text, attempt + 1);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HF Inference API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  // Normalize both response shapes the router has been observed to return
  // for text-classification: a flat array of {label, score}, or that same
  // array nested one level for a batch of size 1.
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
  if (Array.isArray(data)) return data;
  throw new Error('Unexpected response shape from HF Inference API.');
}

function interpretScores(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return { verdict: 'unavailable', confidence: null, summary: 'Model returned no scores.', raw: scores };
  }

  const top = [...scores].sort((a, b) => b.score - a.score)[0];

  // Works whether the model's config.json has id2label set to "Fake"/"Real"
  // (recommended - see the setup steps at the top of this file) or was left
  // as the transformers default "LABEL_0"/"LABEL_1" (0 = Fake, 1 = Real, per
  // how labels were encoded in the training notebooks).
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
