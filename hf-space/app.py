"""
Gradio app that loads the fine-tuned PubMedBERT model directly with
transformers and serves predictions over Gradio's built-in REST API. Runs
inside a Hugging Face Space (SDK: Gradio) - see README.md in this folder
for the full setup walkthrough.

Why Gradio and not the earlier Docker/FastAPI version: Hugging Face now
requires a paid plan to create new Docker SDK Spaces on free hardware, but
Gradio SDK Spaces are still free to create. Gradio automatically exposes
any function passed to gr.Interface as an API endpoint when api_name is
set, so api/predict.js can call this the same way it called the old
FastAPI endpoint - just with a different request/response shape (see that
file).

Why @spaces.GPU below: free accounts are currently being assigned
"ZeroGPU" hardware for new Gradio Spaces (shown as a "Building on ZERO"
badge on the Space page) instead of plain CPU basic. ZeroGPU's runtime
refuses to start at all unless at least one function is decorated with
@spaces.GPU ("No @spaces.GPU function detected during startup"), even
though a BERT-base model like this one doesn't strictly need a GPU to run
inference. predict() below is decorated to satisfy that requirement and
moves the model/inputs to the GPU when one is actually granted, falling
back to plain CPU inference otherwise (e.g. if this ever runs on real CPU
basic hardware instead of ZeroGPU).
"""

import os

import gradio as gr
import spaces
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Set this in the Space's Settings -> Variables and secrets, or edit the
# default below directly. Must match the repo you pushed from Colab with
# model.push_to_hub(...).
MODEL_REPO = os.environ.get("MODEL_REPO", "YY80813/pubmedbert-fake-health-news")

# Matches max_length=128 used when the model was fine-tuned in the notebooks.
MAX_LENGTH = 128

print(f"Loading model from {MODEL_REPO} ...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_REPO)
model.eval()
print("Model loaded.")


@spaces.GPU
def predict(text: str):
    text = (text or "").strip()
    if len(text) < 30:
        return {"error": "Provide at least 30 characters of article text."}

    # ZeroGPU only attaches a real GPU for the duration of a call to a
    # function decorated with @spaces.GPU, so the model/inputs are moved to
    # it here rather than once at load time. torch.cuda.is_available() is
    # checked defensively in case this ever runs on plain CPU hardware
    # instead, where it should just fall back to CPU inference.
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


# The Textbox/JSON components also give the Space a usable web UI for demo
# purposes (handy for your FYP presentation) on top of the REST API.
demo = gr.Interface(
    fn=predict,
    inputs=gr.Textbox(label="Article text", lines=6, placeholder="Paste a health news article..."),
    outputs=gr.JSON(label="Prediction"),
    title="PubMedBERT Fake Health News Detector",
    description=(
        "Fine-tuned PubMedBERT classifier from a Final Year Project on fake "
        "health news detection. This is the model's own opinion on the text "
        "alone, independent of the website's Official Source Check."
    ),
    api_name="predict",  # this is what exposes POST /run/predict
)

if __name__ == "__main__":
    demo.launch()
