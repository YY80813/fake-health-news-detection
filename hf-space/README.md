---
title: PubMedBERT Fake Health News Detector
emoji: 🏥
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# PubMedBERT Fake Health News Detector (API)

A small FastAPI app that loads the PubMedBERT model fine-tuned in this
project's Colab notebooks directly with `transformers`, and serves
predictions over a plain JSON endpoint.

**This exists because Hugging Face's free serverless Inference API only
serves a curated "warm" allow-list of models** — custom fine-tuned
checkpoints like this one return `"Model not supported by provider
hf-inference"` there. Running it yourself in a Space (free CPU tier: 16GB
RAM, 2 CPU cores) sidesteps that limitation entirely.

## Setup

1. Create a new Space at https://huggingface.co/new-space with:
   - **SDK**: Docker
   - **Hardware**: CPU basic (free)
2. Upload the three files from this folder (`Dockerfile`, `app.py`,
   `requirements.txt`, and this `README.md`) to the Space's file list — either
   via the "Files" tab's upload button, or by cloning the Space's own git
   repo and pushing them.
3. In the Space's **Settings → Variables and secrets**, add a variable:
   - `MODEL_REPO` = `your-hf-username/pubmedbert-fake-health-news` (the
     model repo you pushed from Colab)
4. Wait for the build to finish (the "Logs" tab shows progress — the first
   build downloads and installs PyTorch, so it can take several minutes).
   Once it says "Running", note the Space's URL — it follows the pattern
   `https://<your-username>-<space-name>.hf.space` (visible in the Space's
   page, or under the embed/API button).
5. Test it directly: `POST` to `<that-url>/predict` with JSON body
   `{"text": "some health article text of at least 30 characters..."}` —
   using curl, Postman, or the Space's own "/docs" page (FastAPI's built-in
   Swagger UI, e.g. `<that-url>/docs`).
6. Set `HF_SPACE_URL` = that URL as an environment variable on your website's
   deployment platform (see the main `DEPLOYMENT.md` in the repo root).

## Notes

- Free Spaces "sleep" after a period of inactivity, same idea as Vercel/HF
  Inference cold starts. The first request after a while can take 20-60
  seconds while it wakes up and reloads the model into memory - that's
  expected, not a bug.
- This app is intentionally minimal (one `/predict` endpoint, one `/`
  health check) - it doesn't need a UI since `api/predict.js` calls it
  directly as a backend.
