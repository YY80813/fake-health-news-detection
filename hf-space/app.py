"""
Small FastAPI app that loads the fine-tuned PubMedBERT model directly with
transformers and serves predictions over a plain JSON endpoint. Runs inside
a Hugging Face Space (Docker SDK) - see README.md in this folder for the
full setup walkthrough and why this exists instead of using HF's serverless
Inference API.
"""

import os
from typing import List, Union

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Set this in the Space's Settings -> Variables and secrets, or edit the
# default below directly. Must match the repo you pushed from Colab with
# model.push_to_hub(...).
MODEL_REPO = os.environ.get("MODEL_REPO", "your-hf-username/pubmedbert-fake-health-news")

# Matches max_length=128 used when the model was fine-tuned in the notebooks.
MAX_LENGTH = 128

app = FastAPI(title="PubMedBERT Fake Health News Detector")

# Allow the static front end (hosted on Vercel, a different origin) to call
# this directly if needed - api/predict.js is the normal caller, but this
# keeps the door open for direct browser testing too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"Loading model from {MODEL_REPO} ...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_REPO)
model.eval()
print("Model loaded.")


class PredictRequest(BaseModel):
    text: str


@app.get("/")
def health():
    return {"status": "ok", "model": MODEL_REPO}


@app.post("/predict")
def predict(req: PredictRequest) -> Union[List[dict], dict]:
    text = (req.text or "").strip()
    if len(text) < 30:
        return {"error": "Provide at least 30 characters of article text."}

    inputs = tokenizer(
        text, truncation=True, padding=True, max_length=MAX_LENGTH, return_tensors="pt"
    )
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = torch.softmax(logits, dim=-1)[0]

    id2label = model.config.id2label
    scores = [
        {"label": id2label.get(i, f"LABEL_{i}"), "score": float(probs[i])}
        for i in range(len(probs))
    ]
    return scores
