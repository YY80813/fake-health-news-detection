---
title: PubMedBERT Fake Health News Detector
emoji: 🏥
colorFrom: blue
colorTo: green
sdk: gradio
sdk_version: 6.26.0
app_file: app.py
pinned: false
---

# PubMedBERT Fake Health News Detector (API)

A small Gradio app that loads the PubMedBERT model fine-tuned in this
project's Colab notebooks directly with `transformers`, and serves
predictions both through a small web UI and a REST API endpoint.

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

**A note on hardware:** free accounts are currently being assigned
**ZeroGPU** hardware for new Gradio Spaces instead of plain CPU basic (the
Space page shows a "Building on ZERO" badge). That's fine here — `app.py`
never asks for a GPU, so it just runs on the CPU side of that allocation —
but it does mean the platform force-installs its own Gradio version
(`6.26.0` at the time of writing) into the container. **Don't pin a
different Gradio version in `requirements.txt`** — an earlier version of
this file pinned `gradio==3.50.2` for its simpler API, which caused a hard
pip conflict during the build (`ResolutionImpossible`) against the version
ZeroGPU injects.

## Setup

1. Create a new Space at https://huggingface.co/new-space with:
   - **SDK**: Gradio
   - **Hardware**: whatever's offered for free (CPU basic or ZeroGPU — both
     work with this app)
2. Upload `app.py`, `requirements.txt`, and this `README.md` from this
   folder to the Space's file list — either via the "Files" tab's upload
   button, or by cloning the Space's own git repo and pushing them. Do
   **not** upload the `Dockerfile` — the Gradio SDK ignores it, and its
   presence can confuse the build.
3. In the Space's **Settings → Variables and secrets**, add a variable:
   - `MODEL_REPO` = `YY80813/pubmedbert-fake-health-news` (the model repo
     already pushed from Colab — change this only if you push to a
     different repo later)
4. Wait for the build to finish (the "Logs" tab shows progress — the first
   build downloads and installs PyTorch, so it can take several minutes).
   Once it says "Running", note the Space's URL — it follows the pattern
   `https://<your-username>-<space-name>.hf.space` (visible on the Space's
   page).
5. Test it two ways:
   - Open the Space's own page (**App** tab) — it shows a live text box;
     paste an article and click Submit to see the model's prediction
     directly.
   - Test the API the website will actually call. Gradio 4+ (including the
     6.x this Space runs) uses a two-step call: first `POST` to
     `<that-url>/gradio_api/call/predict` with JSON body `{"data": ["some
     health article text of at least 30 characters..."]}`, which returns
     `{"event_id": "..."}`; then `GET`
     `<that-url>/gradio_api/call/predict/<event_id>` to read the result as
     a server-sent-events stream. `api/predict.js` already implements both
     steps — the Space's own "Use via API" link (bottom of its page) also
     shows working curl examples if you want to test by hand.
6. Set `HF_SPACE_URL` = that URL as an environment variable on your
   website's deployment platform (see the main `DEPLOYMENT.md` in the repo
   root).

## Notes

- Free Spaces "sleep" after a period of inactivity, same idea as Vercel/HF
  Inference cold starts. The first request after a while can take 20-60
  seconds while it wakes up and reloads the model into memory - that's
  expected, not a bug.
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
