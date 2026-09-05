---
title: Fake Health News Detector (PubMedBERT + BioBERT)
emoji: 🏥
colorFrom: blue
colorTo: green
sdk: gradio
sdk_version: 6.26.0
app_file: app.py
pinned: false
---

# Fake Health News Detector — PubMedBERT + BioBERT (API)

A small Gradio app that loads the PubMedBERT **and** BioBERT models
fine-tuned in this project's Colab notebooks directly with `transformers`,
and serves predictions — from either model, or both at once for direct
comparison — through a small web UI and a REST API endpoint.

FYP1 compared PubMedBERT, BioBERT and DistilBERT and selected PubMedBERT as
the deployed model on the strength of its fake-class F1-score. FYP2 exposes
that comparison to the website's own visitors directly, rather than only
reporting it in the report: the front end's "Model" picker lets a Reader
ask for either model's prediction, or "Compare both" side by side. See
`app.py`'s module docstring for why DistilBERT wasn't carried forward here
(it was the weakest of the three, and two loaded models is already double
the memory/latency of one).

**This exists because Hugging Face's free serverless Inference API only
serves a curated "warm" allow-list of models** — custom fine-tuned
checkpoints like this one return `"Model not supported by provider
hf-inference"` there. Running it yourself in a Space sidesteps that
limitation entirely.

**Why Gradio and not Docker:** Hugging Face changed its pricing in 2026 so
that creating a *new* Docker SDK Space on free hardware now requires a paid
plan. Gradio SDK Spaces are still free to create, so this folder only
contains what a Gradio Space needs (`app.py`, `requirements.txt`, this
`README.md`) — no `Dockerfile` required. If you still have the old
`Dockerfile` from an earlier version of this project in this folder, you
can ignore or delete it; the Gradio SDK doesn't use it.

**A note on hardware:** this project started on free **ZeroGPU** hardware
(Gradio Spaces get assigned this instead of plain CPU basic, shown as a
"Building on ZERO" badge). ZeroGPU works, but it can never fully disable
sleep (free-hardware sleep policy can't be turned off) and every call
queues briefly for a shared GPU. This Space now runs on the paid **CPU
Upgrade** hardware tier instead (~$0.03/hour, billed only while it's
`Running` — see https://huggingface.co/docs/hub/en/spaces-gpus for current
pricing) specifically because paid hardware **never sleeps by default**,
per Hugging Face's own docs, with no GPU queueing at all - a BERT-base
model like this one doesn't need a GPU to run inference quickly. If you
ever move this Space back to ZeroGPU or CPU basic, you'd need to add back
an `import spaces` / `@spaces.GPU`-decorated function (ZeroGPU requires
one at startup) - see this project's git history for that version of
`app.py`.

If ZeroGPU also happened to force a specific Gradio version into the
container when you built this (mentioned in earlier commits of this file),
that's specific to ZeroGPU's build pipeline - plain CPU Upgrade hardware
installs directly from `requirements.txt` without that override.

## Setup

1. If you already have this Space running on ZeroGPU/free hardware, go to
   its **Settings** tab → **Hardware** → choose **CPU Upgrade** → confirm
   (this requires a payment method on your Hugging Face account). Once
   upgraded, a **Sleep time** setting appears - set it to **Never** to lock
   in always-on behavior (this is the default after upgrading, but worth
   confirming). Skip to step 4 below.

   Otherwise, create a new Space at https://huggingface.co/new-space with:
   - **SDK**: Gradio
   - **Hardware**: **CPU Upgrade** (paid) if you want guaranteed no-sleep
     from the start, or whatever's offered for free otherwise
2. Upload `app.py`, `requirements.txt`, and this `README.md` from this
   folder to the Space's file list — either via the "Files" tab's upload
   button, or by cloning the Space's own git repo and pushing them. Do
   **not** upload the `Dockerfile` — the Gradio SDK ignores it, and its
   presence can confuse the build.
3. In the Space's **Settings → Variables and secrets**, add:
   - `MODEL_REPO_PUBMEDBERT` = `YY80813/pubmedbert-fake-health-news` (the
     model repo already pushed from Colab — change this only if you push to
     a different repo later). The old name `MODEL_REPO` still works as a
     fallback if you already had that set and haven't renamed it.
   - `MODEL_REPO_BIOBERT` = the Hugging Face model repo you pushed the
     fine-tuned BioBERT checkpoint to from `FYP_biobert_finetuned.ipynb`
     (`model.push_to_hub(...)` / `tokenizer.push_to_hub(...)`, the same way
     you did for PubMedBERT — see `DEPLOYMENT.md` for that Colab snippet).
     **If this variable is left unset, the Space still starts up and
     PubMedBERT still works fine** — requests for BioBERT (or "both") will
     just come back with a clear "isn't configured on this Space yet" error
     for BioBERT's half of the result, rather than crashing anything.
4. Wait for the build to finish (the "Logs" tab shows progress — the first
   build downloads and installs PyTorch, so it can take several minutes).
   Once it says "Running", note the Space's URL — it follows the pattern
   `https://<your-username>-<space-name>.hf.space` (visible on the Space's
   page). PubMedBERT loads eagerly at startup; BioBERT loads lazily on its
   first request (so the very first "BioBERT" or "Compare both" call after
   a fresh build/restart is a little slower than the ones after it).
5. Test it two ways:
   - Open the Space's own page (**App** tab) — it shows a live text box and
     a Model picker (PubMedBERT / BioBERT / Compare both); paste an article,
     pick a model, and click Submit to see the prediction(s) directly.
   - Test the API the website will actually call. Gradio 4+ (including the
     6.x this Space runs) uses a two-step call: first `POST` to
     `<that-url>/gradio_api/call/predict` with JSON body `{"data": ["some
     health article text of at least 30 characters...", "pubmedbert"]}`
     (second element is `"pubmedbert"`, `"biobert"`, or `"both"`), which
     returns `{"event_id": "..."}`; then `GET`
     `<that-url>/gradio_api/call/predict/<event_id>` to read the result as
     a server-sent-events stream. `api/predict.js` already implements both
     steps — the Space's own "Use via API" link (bottom of its page) also
     shows working curl examples if you want to test by hand.
6. Set `HF_SPACE_URL` = that URL as an environment variable on your
   website's deployment platform (see the main `DEPLOYMENT.md` in the repo
   root). Nothing else needs to change there — `api/predict.js` now forwards
   a `model` field from the front end's request automatically.

## Notes

- **"Compare both" runs both models sequentially in one request**, so it
  takes roughly twice as long as a single-model request (still well within
  `api/predict.js`'s 90-second timeout for a BERT-base-sized model on CPU
  Upgrade hardware). Each loaded model uses ~440MB of RAM; running both
  loaded at once is still comfortably within CPU Upgrade's default memory
  allocation.
- On CPU Upgrade (paid) hardware with Sleep time set to Never, there's no
  cold-start wait at all - the container stays running and the model stays
  loaded in memory continuously. If this Space is ever switched back to
  free hardware, it "sleeps" after a period of inactivity instead, and the
  first request after a while can take 20-60 seconds while it wakes up and
  reloads the model - that's expected there, not a bug.
- The `HF_TOKEN` warning in the Logs tab ("You are sending unauthenticated
  requests to the HF Hub") is harmless for a public model repo like this
  one - it only affects rate limits on the one-time model download at
  startup, not anything the website's users experience.
- If Hugging Face changes the forced Gradio version again in the future and
  the build breaks, check the Logs tab for the exact version it's
  installing and let `api/predict.js`'s comments guide what may need to
  change — the queue/SSE call shape has been stable since Gradio 4.
- **`requirements.txt` installs `transformers` from GitHub, not PyPI.**
  This is a temporary workaround for an ecosystem-wide version gap:
  `huggingface_hub` just had a `1.0` major release, Gradio 6.26.0 requires
  `huggingface-hub>=1.16.0,<2.0`, but every `transformers` release on PyPI
  as of writing still caps `huggingface-hub<1.0` — those can never both be
  satisfied together, which is what caused a `ResolutionImpossible` build
  failure here. The fix is already merged into `transformers`' unreleased
  code, just not published yet, so installing straight from its `main`
  branch picks up the fix early. Once a new `transformers` version ships on
  PyPI with the updated constraint, switch this back to a normal
  `transformers>=X,<Y` pin — it'll build faster and won't depend on
  whatever happens to be on `main` at build time.
