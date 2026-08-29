# Deploying this project

The front end (`index.html`, `styles.css`, `script.js`) is unchanged in how it's
hosted — it's still plain static files. Two small backend functions do the
real work and **must** run server-side (they can't run in the browser,
because any key placed in `script.js` would be visible to anyone who views
the page source):

- `api/verify.js` — the "Official Source Check" on submitted articles. Needs
  an OpenAI API key.
- `api/news.js` — the small "Latest from Official Health Sources" panel.
  Needs **no key at all** — it just fetches public RSS feeds server-side.
- `api/predict.js` — the "Your Model" tab, running your fine-tuned
  PubMedBERT model via Hugging Face's Inference API. Needs a Hugging Face
  access token and your model's repo ID (see the dedicated section below).

## Fastest path: Vercel (free tier is enough for a FYP demo)

1. Push this whole repo (including the `api/` folder) to GitHub.
2. Go to https://vercel.com, sign in, "Add New Project", import the repo.
   Vercel auto-detects both `api/verify.js` and `api/news.js` as serverless
   functions — no config needed.
3. In the Vercel project's **Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = your key from https://platform.openai.com/api-keys
   - `HF_API_TOKEN` and `HF_MODEL_REPO` — see "Connecting your trained
     PubMedBERT model" below. The site still works without these two (the
     "Your Model" tab just shows "Model unavailable"), so you can add them
     later.
4. Deploy (or Redeploy, if you already deployed before adding the key —
   env vars only apply to deployments made *after* they're set).

## Testing locally

```bash
npm install -g vercel   # one-time
cp .env.example .env    # then fill in your real key
vercel dev
```

## ⚠️ Please test both live once deployed

Neither `api/verify.js` nor `api/news.js` could be live-tested from the
environment that built them — it has no network route to `api.openai.com`
or to the BBC/WHO/CDC RSS hosts (only to Anthropic's API and package
registries). Both were unit-tested with mocked responses instead (JSON
parsing, source filtering, graceful failure). Once deployed, check:

- **Official Check tab**: click the "⚠️ Fake News" example → Analyze &
  Detect. If it errors, the two likely culprits in `api/verify.js` are the
  model name (`OPENAI_MODEL`, currently `'gpt-4.1-mini'`) or the web-search
  tool's type string (currently `'web_search'` — older OpenAI docs called
  this `'web_search_preview'`).
- **News panel** (top of the Detector section): should show a handful of
  real headlines within a second or two of the page loading. If it says
  "Couldn't load official headlines," the likely culprit is a stale RSS URL
  in `FEEDS` at the top of `api/news.js` — each of the three feeds (BBC,
  WHO, CDC) fails independently, so even one broken feed still leaves the
  others showing.

If either errors, check Vercel → your project → Deployments → latest → Logs
→ find the relevant function (`verify` or `news`) → the `detail` field in
its response (or DevTools' Network tab on the live site, as we did before)
will show the underlying error.

## What "official sources" means for the fact-check

OpenAI's web-search tool doesn't support a domain allowlist the way some
other providers' search tools do, so `api/verify.js` enforces it itself, in
code, after the model responds: every citation the model actually used is
checked against `ALLOWED_DOMAINS` at the top of the file (`bbc.com`,
`bbc.co.uk`, `kkm.gov.my`, `moh.gov.my`, `who.int`, `cdc.gov`), and anything
outside that list is dropped before it reaches the front end. If nothing
found was on an official domain, the verdict is forced to `"unverified"` —
the model's own claimed verdict is never trusted blindly. Edit
`ALLOWED_DOMAINS` to add or remove sources.

## About the news panel and KKM

`api/news.js` pulls from BBC Health, WHO, and CDC's public RSS feeds — no
LLM involved, so it's unaffected by any AI provider's rate limits or costs.
Malaysia's Ministry of Health (KKM) doesn't have a confirmed stable RSS
feed, so it isn't included in the live panel; if you find their actual feed
URL, add it to the `FEEDS` array in `api/news.js` in the same shape as the
other three.

## Known limitation carried over from the original repo

The 5 simulated "ML models" (Random Forest, SVC, KNN, CNN, XGBoost) that
used to appear in the results have been removed — the Official Source Check
is now the only *verdict* shown, though the "Your Model" tab below adds a
second, independent opinion from your own fine-tuned model.

## Connecting your trained PubMedBERT model ("Your Model" tab)

Your notebooks compared four models (GloVe+SVC, DistilBERT, BioBERT,
PubMedBERT) and found **PubMedBERT** gave the best trade-off for this task
(fake-class F1 of 0.61, per `FYP1_LawYingYee.docx` Section 5.6) — that's the
one wired up here. It only ever existed as checkpoints inside the Colab
session that trained it, so it needs to be published somewhere with a
callable API before this website can use it. The path below (Hugging Face
Hub + their free serverless Inference API) avoids standing up your own
server, and keeps the model weights (~440MB) out of this git repo entirely.

**1. Push the model to Hugging Face Hub**, from the end of
`FYP_pubmedbert_finetuned.ipynb` (right after `trainer.train()`, so the
`model` and `tokenizer` variables still hold the best checkpoint —
`load_best_model_at_end=True` in that notebook's `TrainingArguments` already
ensures `model` is the best epoch, not just the last one):

```python
!pip install huggingface_hub --quiet

from huggingface_hub import notebook_login
notebook_login()  # paste a HF *write* token: https://huggingface.co/settings/tokens

# Make the labels human-readable instead of the transformers default
# "LABEL_0"/"LABEL_1" (0 = Fake, 1 = Real, per how labels were encoded
# when the datasets were built in this notebook).
model.config.id2label = {0: "Fake", 1: "Real"}
model.config.label2id = {"Fake": 0, "Real": 1}

REPO_ID = "your-hf-username/pubmedbert-fake-health-news"  # <-- change this
model.push_to_hub(REPO_ID)
tokenizer.push_to_hub(REPO_ID)
```

You'll need a (free) Hugging Face account for this. The repo can be public
or private — if private, the `HF_API_TOKEN` used by `api/predict.js` (step 3
below) needs at least read access to it.

**2. Create an inference-capable access token**: 
https://huggingface.co/settings/tokens → "New token" → type "Read" is
enough for a public repo (or a fine-grained token scoped to "Read access to
contents of all public gated repos you can access" + your repo, if private).

**3. Set environment variables** in your deployment platform (Vercel:
Settings → Environment Variables), same as `OPENAI_API_KEY`:
   - `HF_API_TOKEN` = the token from step 2
   - `HF_MODEL_REPO` = the `REPO_ID` you used in step 1 (e.g.
     `yourname/pubmedbert-fake-health-news`)

**4. Deploy (or redeploy)**. The "Your Model" tab calls `POST /api/predict`,
which forwards the text to
`https://router.huggingface.co/hf-inference/models/<HF_MODEL_REPO>` and
returns a fake/real verdict with a confidence score.

**Notes:**
- **Cold starts**: Hugging Face's free Inference API spins down models that
  haven't been called in a while. The first request after some idle time can
  take 10–30 seconds while it spins back up — `api/predict.js` already
  retries through this (up to 3 attempts, honoring HF's `estimated_time`),
  so you don't need to do anything, just expect that first request to be
  slow.
- **This tab is independent of the Official Source Check.** It's your own
  classifier's opinion on the text itself, not filtered through official
  sources — the two can (and sometimes will) disagree, which is expected
  and worth pointing out in your FYP write-up/demo.
- If you'd rather try DistilBERT, BioBERT, or the GloVe+SVC baseline
  instead, the same steps work for the transformer notebooks (just point
  `REPO_ID` at a different repo and swap which notebook you push from) — the
  GloVe+SVC baseline isn't a Hugging Face model though, so it would need a
  different hosting approach (e.g. a small custom inference server) rather
  than this exact recipe.
