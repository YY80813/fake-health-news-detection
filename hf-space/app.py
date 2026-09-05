"""
Gradio app that loads the fine-tuned PubMedBERT AND BioBERT models directly
with transformers and serves predictions over Gradio's built-in REST API.
Runs inside a Hugging Face Space (SDK: Gradio) - see README.md in this
folder for the full setup walkthrough.

Why Gradio and not the earlier Docker/FastAPI version: Hugging Face now
requires a paid plan to create new Docker SDK Spaces on free hardware, but
Gradio SDK Spaces are still free to create. Gradio automatically exposes
any function passed to gr.Interface as an API endpoint when api_name is
set, so api/predict.js can call this the same way it called the old
FastAPI endpoint - just with a different request/response shape (see that
file).

This Space runs on a paid "CPU Upgrade" hardware tier rather than the free
ZeroGPU tier this project started on. That's a deliberate choice: ZeroGPU
Spaces (a) require a function decorated with @spaces.GPU just to satisfy
its startup check, even though a BERT-base model this size doesn't need a
GPU, and (b) still queue for a shared GPU allocation on every call, and (c)
are still subject to Hugging Face's free-hardware sleep policy, which
cannot be disabled. A paid CPU Upgrade Space is a dedicated (not shared)
machine that, per Hugging Face's own docs, never sleeps by default once
upgraded - no GPU queueing, no cold starts, plain synchronous CPU
inference. Loading two BERT-base models instead of one roughly doubles
memory use and per-request latency for a "both" comparison call, but both
are still small enough (~440MB each) to run comfortably on this tier.

There is no `spaces` import or `@spaces.GPU` decorator here because that
package/API is ZeroGPU-specific and isn't provided on this hardware tier -
if you ever switch this Space back to a free/ZeroGPU tier, that decorator
would need to be added back (see this project's git history for the
ZeroGPU version of this file).

--- Comparing two models (added for FYP2) ---
FYP1 compared PubMedBERT, BioBERT and DistilBERT and selected PubMedBERT as
the deployed model on the strength of its fake-class F1-score. FYP2 exposes
that comparison directly to the end user instead of hiding it: a Radio
input lets the caller ask for PubMedBERT's prediction, BioBERT's
prediction, or both side by side. DistilBERT was the weakest performer in
that comparison (see FYP1 Chapter 5) and was not carried forward here to
keep the Space's memory footprint and latency down.
"""

import os

import gradio as gr
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Matches max_length=128 used when the models were fine-tuned in the notebooks.
MAX_LENGTH = 128

# Set these in the Space's Settings -> Variables and secrets, or edit the
# defaults below directly. Each must match a repo you pushed from Colab
# with model.push_to_hub(...)/tokenizer.push_to_hub(...).
#
# MODEL_REPO (old name) is still read as a fallback for MODEL_REPO_PUBMEDBERT
# so a Space that only ever set MODEL_REPO keeps working unchanged.
MODEL_REPOS = {
    "pubmedbert": os.environ.get(
        "MODEL_REPO_PUBMEDBERT",
        os.environ.get("MODEL_REPO", "YY80813/pubmedbert-fake-health-news"),
    ),
    "biobert": os.environ.get("MODEL_REPO_BIOBERT", ""),
}

MODEL_DISPLAY_NAMES = {"pubmedbert": "PubMedBERT", "biobert": "BioBERT"}

# Loaded lazily into this dict as {"pubmedbert": (tokenizer, model), ...}.
# BioBERT is only loaded if MODEL_REPO_BIOBERT was actually set, so a Space
# that hasn't been given a BioBERT repo yet still starts up fine and simply
# reports BioBERT as unavailable rather than crashing.
_loaded = {}


def _load(model_key):
    if model_key in _loaded:
        return _loaded[model_key]

    repo = MODEL_REPOS.get(model_key)
    if not repo:
        _loaded[model_key] = None
        return None

    print(f"Loading {MODEL_DISPLAY_NAMES.get(model_key, model_key)} from {repo} ...")
    tokenizer = AutoTokenizer.from_pretrained(repo)
    model = AutoModelForSequenceClassification.from_pretrained(repo)
    model.eval()
    print(f"{MODEL_DISPLAY_NAMES.get(model_key, model_key)} loaded.")
    _loaded[model_key] = (tokenizer, model)
    return _loaded[model_key]


# Eagerly load PubMedBERT at startup (it's always available) so the first
# real request isn't slowed down by a cold model load. BioBERT loads lazily
# on its first request instead, since a Space that never uses the "both" /
# "BioBERT" option shouldn't pay that memory/startup cost.
_load("pubmedbert")


def _run_one(model_key, text):
    loaded = _load(model_key)
    if loaded is None:
        return {
            "error": (
                f"{MODEL_DISPLAY_NAMES.get(model_key, model_key)} isn't configured on this "
                f"Space yet - set MODEL_REPO_{model_key.upper()} in the Space's "
                "Settings -> Variables and secrets."
            )
        }

    tokenizer, model = loaded
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)

    inputs = tokenizer(
        text, truncation=True, padding=True, max_length=MAX_LENGTH, return_tensors="pt"
    ).to(device)
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = torch.softmax(logits, dim=-1)[0]

    id2label = model.config.id2label
    scores = [
        {"label": id2label.get(i, f"LABEL_{i}"), "score": float(probs[i])}
        for i in range(len(probs))
    ]
    return {"scores": scores}


def predict(text: str, model_choice: str):
    text = (text or "").strip()
    if len(text) < 30:
        return {"error": "Provide at least 30 characters of article text."}

    model_choice = (model_choice or "pubmedbert").lower()
    keys = ["pubmedbert", "biobert"] if model_choice == "both" else [model_choice]

    return {key: _run_one(key, text) for key in keys}


# The Textbox/Radio/JSON components also give the Space a usable web UI for
# demo purposes (handy for your FYP presentation) on top of the REST API.
demo = gr.Interface(
    fn=predict,
    inputs=[
        gr.Textbox(label="Article text", lines=6, placeholder="Paste a health news article..."),
        gr.Radio(
            choices=[("PubMedBERT", "pubmedbert"), ("BioBERT", "biobert"), ("Compare both", "both")],
            value="pubmedbert",
            label="Model",
        ),
    ],
    outputs=gr.JSON(label="Prediction"),
    title="Fake Health News Detector - Model Comparison",
    description=(
        "Fine-tuned PubMedBERT and BioBERT classifiers from a Final Year Project on "
        "fake health news detection. This is the model(s)' own opinion on the text "
        "alone, independent of the website's Official Source Check."
    ),
    api_name="predict",  # this is what exposes POST /gradio_api/call/predict
)

if __name__ == "__main__":
    demo.launch()
