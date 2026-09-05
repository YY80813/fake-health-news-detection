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
- `api/predict.js` — the "Your Model" tab, calling a Hugging Face Space
  (which you deploy yourself - see `hf-space/README.md`) that runs your
  fine-tuned PubMedBERT model directly. Needs that Space's URL (see the
  dedicated section below).

## Fastest path: Vercel (free tier is enough for a FYP demo)

1. Push this whole repo (including the `api/` folder) to GitHub.
2. Go to https://vercel.com, sign in, "Add New Project", import the repo.
   Vercel auto-detects both `api/verify.js` and `api/news.js` as serverless
   functions — no config needed.
3. In the Vercel project's **Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = your key from https://platform.openai.com/api-keys
   - `HF_SPACE_URL` — see "Connecting your trained PubMedBERT model" below.
     The site still works without it (the "Your Model" tab just shows
     "Model unavailable"), so you can add it later.
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
callable API before this website can use it.

**Why not Hugging Face's free Inference API directly?** That was the first
approach tried here, but it only serves a curated allow-list of "warm"
models — a custom fine-tuned checkpoint like this one gets rejected with
`"Model not supported by provider hf-inference"`. The fix: run the model
yourself in a **Hugging Face Space**, using the small Gradio app already
set up for you in this repo's `hf-space/` folder.

**Why Gradio and not Docker?** Hugging Face's earlier free Docker SDK path
was tried next, but HF changed its pricing in 2026 so that creating a *new*
Docker SDK Space on free CPU basic hardware now requires a paid plan.
Gradio SDK Spaces on free CPU basic hardware are still free to create, and
Gradio automatically exposes the model as a callable REST endpoint the same
way the Docker/FastAPI version did — just with a slightly different
request/response shape, which `api/predict.js` already handles.

**1. Push the model(s) to Hugging Face Hub** — **already done for
PubMedBERT**, at `YY80813/pubmedbert-fake-health-news`. (For reference,
this was done from the end of `FYP_pubmedbert_finetuned.ipynb`, right after
`trainer.train()`, so the `model` and `tokenizer` variables still held the
best checkpoint — `load_best_model_at_end=True` in that notebook's
`TrainingArguments` already ensures `model` is the best epoch, not just the
last one:

```python
!pip install huggingface_hub --quiet

from huggingface_hub import notebook_login
notebook_login()  # paste a HF *write* token: https://huggingface.co/settings/tokens

# Make the labels human-readable instead of the transformers default
# "LABEL_0"/"LABEL_1" (0 = Fake, 1 = Real, per how labels were encoded
# when the datasets were built in this notebook).
model.config.id2label = {0: "Fake", 1: "Real"}
model.config.label2id = {"Fake": 0, "Real": 1}

REPO_ID = "YY80813/pubmedbert-fake-health-news"
model.push_to_hub(REPO_ID)
tokenizer.push_to_hub(REPO_ID)
```

If you ever retrain and want to push a new version, just rerun this cell —
no other setup below needs to change.)

**BioBERT still needs to be pushed** (added for FYP2's model-comparison
feature — see `hf-space/app.py` and `hf-space/README.md`). The identical
recipe applies to `FYP_biobert_finetuned.ipynb`, which uses the same
`model`/`tokenizer` variable names and already sets
`load_best_model_at_end=True`, so the same cell works with only `REPO_ID`
changed:

```python
!pip install huggingface_hub --quiet

from huggingface_hub import notebook_login
notebook_login()  # paste a HF *write* token: https://huggingface.co/settings/tokens

model.config.id2label = {0: "Fake", 1: "Real"}
model.config.label2id = {"Fake": 0, "Real": 1}

REPO_ID = "YY80813/biobert-fake-health-news"  # pick any repo name you like
model.push_to_hub(REPO_ID)
tokenizer.push_to_hub(REPO_ID)
```

Then set `MODEL_REPO_BIOBERT` to whatever `REPO_ID` you used, as an
environment variable on the Hugging Face Space (Settings → Variables and
secrets) — see `hf-space/README.md`'s Setup section, step 3.

**2. Create a Hugging Face Space**: go to https://huggingface.co/new-space →
give it a name → **SDK: Gradio** → **Hardware**: **CPU Upgrade** (paid,
~$0.03/hour) if you want it to never sleep — see "About the Space's
hardware and cost" below — or whatever's offered for free otherwise
(currently "ZeroGPU" rather than plain CPU basic) → Create Space. Already
have a Space running on free/ZeroGPU hardware? Go to its **Settings** tab →
**Hardware** → **CPU Upgrade** to switch it instead of creating a new one,
then skip to step 5.

**3. Upload the Space's files**: from this repo's `hf-space/` folder, upload
`app.py`, `requirements.txt`, and `README.md` to the new Space — either via
its "Files" tab's upload button, or by cloning the Space's own git repo
(Hugging Face gives every Space a git remote, shown on its page) and
pushing them there. Don't upload `Dockerfile` if it's still in that folder
from an earlier version of this project — the Gradio SDK ignores it, but
its presence can confuse the build.

**4. Set the model repo on the Space**: in the Space's **Settings →
Variables and secrets**, add a variable `MODEL_REPO` =
`YY80813/pubmedbert-fake-health-news`. This matches the default already
baked into `app.py`, so this step is optional unless you push to a
different model repo later.

**5. Wait for the build**, watching the Space's "Logs" tab — the first
build downloads and installs PyTorch, so it can take several minutes. Once
it says "Running", the Space's URL follows the pattern
`https://<your-username>-<space-name>.hf.space` (shown on the Space's page).
Test it two ways: open the Space's own page (**App** tab — it shows a live
text box you can paste an article into), and test the API the website will
actually call — Gradio 4+ (which is what gets installed here) answers API
calls in two steps: `POST` to `<that-url>/gradio_api/call/predict` with
JSON body `{"data": ["some health article text of at least 30
characters..."]}` returns an `event_id`, then `GET`
`<that-url>/gradio_api/call/predict/<event_id>` streams back the result.
`api/predict.js` already does both steps for you — the Space's own "Use via
API" link (bottom of its page) shows working curl examples if you want to
test by hand.

**6. Set the environment variable** on your website's deployment platform
(Vercel: Settings → Environment Variables), same as `OPENAI_API_KEY`:
   - `HF_SPACE_URL` = the Space URL from step 5

**7. Deploy (or redeploy)**. The "Your Model" tab calls `POST /api/predict`,
which drives the two-step call above against `<HF_SPACE_URL>` and returns a
fake/real verdict with a confidence score.

**Notes:**
- **About the Space's hardware and cost:** free Spaces (CPU basic or
  ZeroGPU) "sleep" after a period of inactivity and cannot have that
  disabled — the first request after a while can take 20–90 seconds while
  the container wakes up and reloads the model into memory (`api/predict.js`
  already waits up to 90 seconds for this). Per Hugging Face's own docs,
  once a Space is switched to *any* paid hardware tier (like CPU Upgrade),
  it **never sleeps by default** — no cold starts, no GPU queueing, since
  it's a dedicated machine instead of shared. CPU Upgrade is ~$0.03/hour,
  billed only while the Space is `Running` (not while `stopped`/paused) —
  see https://huggingface.co/docs/hub/en/spaces-gpus for current pricing.
  A BERT-base model like this one runs fine on CPU, so no GPU tier is
  needed. If cost is a concern, you can leave the Space on free hardware
  day-to-day and only switch it to CPU Upgrade for the days around your
  demo/submission, then switch back afterward.
- **This tab is independent of the Official Source Check.** It's your own
  classifier's opinion on the text itself, not filtered through official
  sources — the two can (and sometimes will) disagree, which is expected
  and worth pointing out in your FYP write-up/demo (the top verdict banner
  now says explicitly whether they agree or not).
- If a request to `/api/predict` fails after deploying, check the Space's
  own **Logs** tab first — a crash or build failure there (e.g. a typo in
  `MODEL_REPO`) means the request never reaches `api/predict.js`'s own error
  handling at all.
- If you'd rather try DistilBERT, BioBERT, or the GloVe+SVC baseline
  instead, the same Space recipe works for the transformer notebooks (push
  a different model repo in step 1, point `MODEL_REPO` at it in step 4) —
  the GloVe+SVC baseline would need `app.py` adjusted since it isn't a
  Hugging Face transformers model.
- **`hf-space/requirements.txt` deliberately does not pin a Gradio
  version.** Spaces on ZeroGPU hardware force-install their own Gradio into
  the container regardless of what's requested — pinning a different
  version there caused a hard pip conflict (`ResolutionImpossible`) during
  the build. `api/predict.js` is written for Gradio 4+'s queue/event-stream
  API, which has been stable since Gradio 4.
- **`hf-space/requirements.txt` also installs `transformers` from GitHub
  instead of PyPI**, as a temporary workaround for a separate conflict:
  `huggingface_hub` just had a `1.0` major release, Gradio 6.26.0 needs
  `huggingface-hub>=1.16.0,<2.0`, and every `transformers` release on PyPI
  as of writing still caps `huggingface-hub<1.0` — an unsatisfiable
  combination that also showed up as `ResolutionImpossible`. The fix is
  already merged into `transformers`' unreleased code, just not published
  yet, so `hf-space/requirements.txt` installs straight from its GitHub
  `main` branch until a fixed PyPI release ships.

## Shareable result links & site-wide stats (optional - needs a database)

Two features need somewhere to store data server-side, which this project
otherwise has no need for (everything else runs off `localStorage` in the
Reader's own browser):

- The **"Share" button's real permalink** — a `/result/<id>` link that
  *anyone* can open and see the same verdict, not just the browser that ran
  the check. Without this, "Share" still works, but falls back to sharing
  this site's homepage link instead of a link to that specific result.
- The **"Site-wide (all visitors)" line** in the Stats Dashboard — total
  checks / fake / real / average confidence across *every* visitor, instead
  of only the numbers already shown below it (which are per-browser). No
  article text or visitor identity is ever stored for this — just five
  running counters.

Both are backed by `api/share.js` + `api/result.js` + `api/stats.js`, which
talk to a small [Upstash](https://upstash.com) Redis database over its REST
API (`lib/upstash.js` — plain `fetch`, no SDK, consistent with every other
`api/*.js` file in this project). **This is entirely optional** — if you
skip this section, the site works exactly as it did before: no error, no
broken feature, the Share menu just won't have a specific link to offer and
the global-stats line stays hidden.

### Setup

1. Create a free Redis database — either:
   - **Via Vercel** (easiest if you're already deploying there): in your
     Vercel project, go to the **Storage** tab → **Create Database** →
     choose the **Upstash** / **Redis** option (branded as "Upstash for
     Redis" in Vercel's Marketplace) → follow the prompts. Vercel wires the
     two env vars below into your project automatically when you connect it
     this way — skip to step 3.
   - **Directly at [console.upstash.com](https://console.upstash.com)**:
     sign up (free, no credit card needed for the free tier) → click the
     **Redis** tab → **+ Create Database** → give it a name → pick
     **Regional** as the type (simplest choice — Global works on the free
     tier too, but only replicates to one extra read region there and adds
     complexity this project doesn't need) → pick a region close to where
     your Vercel deployment runs → **Create**.
2. On the database's own page (skip this if Vercel connected it for you in
   step 1): open the **Connect** section → **REST** tab. You'll see
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` listed directly
   (hover either field for a copy button) — copy both.
3. Set both as environment variables on your deployment platform (same
   place you set `OPENAI_API_KEY` and `HF_SPACE_URL` — see `.env.example`).
   Do this *before* your next deploy if you can — env vars only apply to
   deployments made after they're set, so adding them after you've already
   deployed means triggering one more redeploy afterward.
4. Redeploy. No code changes needed beyond what's already in this repo —
   `api/share.js`, `api/result.js`, and `api/stats.js` pick these up
   automatically once they're set.

### Notes

- **Storage footprint is tiny.** Each shared result is a few KB of JSON;
  the five stats counters are just numbers. Upstash's free tier (256MB,
  500K commands/month at the time of writing) comfortably covers a FYP
  project's traffic with a lot of headroom — check
  [upstash.com/pricing](https://upstash.com/pricing) for current limits.
- **Shared links expire after 1 year** (`TTL_SECONDS` in `api/share.js`) —
  a storage-hygiene choice, not a technical limit. Change or remove it
  there if you want links to last longer (or never expire).
- **This is a public, unauthenticated endpoint** (`api/share.js`) — anyone
  who can reach your deployed site can create a shared link, the same way
  anyone can already run a check on the homepage. `api/share.js` caps the
  size of what it stores and reshapes the request into exactly the fields
  it expects (see `sanitizePayload`) rather than storing whatever's sent
  verbatim, but this is basic anti-abuse, not exhaustive - there's no rate
  limiting. That's a reasonable trade-off for a FYP demo; worth flagging as
  a "future work" item in your report if you want to be thorough about it.
- **Relative asset paths were changed to root-absolute** (`/styles.css`,
  `/script.js` in `index.html`) as part of adding this - a shared result is
  served at `/result/<id>` (via the rewrite in `vercel.json`, which maps it
  back to `index.html`), and a *relative* `styles.css` reference would have
  resolved to the wrong URL (`/result/styles.css`) on that path. If you ever
  add more pages, keep asset references root-absolute for the same reason.
- If `/result/<id>` 404s on the deployed site even though the code is
  pushed, double check `vercel.json` made it into the repo — that rewrite
  is what makes the pretty URL work at all; without it, only
  `/api/result?id=<id>` (the raw JSON endpoint) would respond.
