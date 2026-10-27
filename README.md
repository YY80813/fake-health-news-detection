# Fake Health News Detection and Verification System

> **Fake News Detection using Machine Learning and NLP in Healthcare Domain**
> Final Year Project, Bachelor of Computer Science (Honours), Universiti Tunku Abdul Rahman (UTAR), 2026

A web-based system that classifies health news as **fake or real** and then **checks the claim against official sources**. It combines two independent opinions:

1. **A fine-tuned biomedical Transformer model**: PubMedBERT (default) or BioBERT, trained on the HealthStory subset of the FakeHealth dataset.
2. **An Official Source Check**: an LLM with live web search, whose citations are only accepted if they come from trusted health and news sources (WHO, CDC, NIH, Malaysia's Ministry of Health / KKM, BBC, Reuters, AP).

The two results are merged into one **Final Conclusion**, together with a short "How This Was Reached" explanation.

---

## Key results

PubMedBERT gave the best result for this project's main goal, which is catching fake health news (the minority class):

| Metric (HealthStory test set) | PubMedBERT |
|---|---|
| Test accuracy | **71.43%** |
| Fake-class recall | **0.81** |
| Fake-class F1-score | **0.61** |

So PubMedBERT is the default model, and BioBERT is kept as an alternative that users can compare against.

---

## Objectives

1. Investigate NLP and machine learning approaches for detecting fake health news from text.
2. Compare and evaluate these approaches using appropriate metrics (accuracy, precision, recall, F1-score, confusion matrix).
3. Develop a web-based fake health news detection system based on the best approach.
4. Integrate source verification and supporting evidence retrieval to complement the classification result.

---

## Features

| Feature | Description |
|---|---|
| 🤖 **Model prediction** | Classifies the article with **PubMedBERT** (default) or **BioBERT**, or **Compare both** side by side, with a confidence score. |
| 🌐 **Official Source Check** | Searches the live web and keeps only citations from allow-listed official domains. If no official source is found, the verdict is forced to *Unverified* instead of trusting the LLM's own opinion. |
| ⚖️ **Combined analysis (decision fusion)** | Merges the model and the official check into one Final Conclusion, with a "How This Was Reached" explanation panel. |
| 🔬 **Text analysis** | Word, character and sentence counts, plus common sensational / misleading keywords in the text. |
| 🌏 **Translation** | Translate a non-English article into English before analysis, and translate the result into Bahasa Malaysia, Chinese, Tamil and other languages. |
| 📰 **Live health news** | Latest headlines from BBC Health, WHO and CDC RSS feeds. |
| 📜 **History** | Past checks saved in the browser (`localStorage`). |
| 📊 **System statistics** | Per-browser stats, plus optional site-wide stats across all visitors. |
| 📤 **Export & share** | Download the result as a PDF report or an image, share it with a permanent `/result/<id>` link, or copy a text summary. |

### How the Final Conclusion is decided

1. If the official check finds a **citation** (supported or contradicted), that citation overrides the model when the two disagree. A checkable source is stronger evidence than a pattern-based prediction.
2. If the model and the official source **agree**, the verdict is marked as **Confirmed**.
3. If official sources say nothing either way (*Unverified*), the model's verdict is used but labelled **Unconfirmed**. Under uncertainty the system leans towards *fake*, because missing real misinformation is costlier than a false alarm.
4. If one side is unavailable, the other side's verdict is shown and labelled as single-source.

In **Compare both** mode, if PubMedBERT and BioBERT agree, their confidence is averaged. If they disagree, the more confident model's call is used.

---

## Dataset

| Item | Detail |
|---|---|
| Source | **HealthStory** subset of the **FakeHealth** dataset |
| Size | 1,690 articles, giving **1,679** after removing empty, duplicate and corrupted records |
| Labels | Credibility rating 0–2 → **Fake**, 3–5 → **Real** |
| Class distribution | **470 fake / 1,209 real** (imbalanced) |
| Split (train / val / test) | 68 : 12 : 20, which is **1,141 / 202 / 336** articles |

The project followed the **CRISP-DM** methodology.

---

## Experiments and results

### 1. Feature representation (SVC classifier)

| Feature representation | Test accuracy | Fake recall | Fake F1 |
|---|---|---|---|
| TF-IDF (1–3 gram) | 76.72% | 0.28 | 0.40 |
| Word2Vec | 65.07% | 0.29 | 0.32 |
| GloVe | 60.30% | **0.62** | **0.47** |

TF-IDF had the highest accuracy but missed most fake articles. GloVe detected fake news best, so it was carried forward as the traditional baseline.

### 2. GloVe + SVC baseline

| Configuration | Train acc. | Test acc. | Fake P | Fake R | Fake F1 | Real P | Real R | Real F1 |
|---|---|---|---|---|---|---|---|---|
| Baseline SVC | 0.7590 | 0.7701 | 0.74 | 0.28 | 0.40 | 0.77 | 0.96 | 0.86 |
| Class-weighted SVC | 0.7082 | 0.6000 | 0.37 | 0.62 | 0.46 | 0.80 | 0.59 | 0.68 |
| GridSearch-tuned SVC | 0.8216 | 0.6597 | 0.43 | 0.62 | **0.50** | 0.82 | 0.68 | 0.74 |

Class weighting raised fake recall from 0.28 to 0.62, but it cost a lot of overall accuracy. This shows the trade-off between accuracy and catching the minority class.

### 3. Fine-tuned Transformer models

| Model | Train acc. | Test acc. | Gap | Fake P | Fake R | Fake F1 | Real P | Real R | Real F1 |
|---|---|---|---|---|---|---|---|---|---|
| **PubMedBERT** | 0.8142 | **0.7143** | 0.0999 | 0.49 | **0.81** | **0.61** | 0.90 | 0.68 | 0.77 |
| BioBERT | 0.8054 | 0.6696 | 0.1358 | 0.45 | 0.80 | 0.57 | 0.89 | 0.62 | 0.73 |
| DistilBERT | 0.7029 | 0.6607 | 0.0422 | 0.42 | 0.55 | 0.48 | 0.80 | 0.70 | 0.75 |

- **PubMedBERT**: best fake-class recall and F1, so it was selected as the default model.
- **BioBERT**: almost the same fake recall (0.80), but lower precision and a larger train–test gap. It is kept as the alternative model.
- **DistilBERT**: smallest gap but weakest fake recall. In this setup its Transformer layers were effectively frozen, which limited how much it could adapt, so it was not deployed.

### Transformer training configuration

| Parameter | Value |
|---|---|
| Epochs | 4 |
| Batch size (train / eval) | 16 / 32 |
| Learning rate | 2 × 10⁻⁵ |
| Weight decay | 0.01 |
| Max sequence length | 128 |
| Loss function | Class-weighted cross-entropy (custom `WeightedLossTrainer`) |
| Layer freezing | Lower 8 Transformer layers frozen (BioBERT, PubMedBERT) |
| Early stopping patience | 2 |
| Model selection metric | Fake-class F1-score |

Fake-class F1 and recall were used as the main metrics because missing a fake article is the more harmful error.

---

## Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  index.html + script.js + styles.css (static, no build step)    │
└───────────────┬─────────────────────────────────────────────────┘
                │ fetch /api/*
┌───────────────▼───────────── Vercel serverless functions ───────┐
│  /api/predict   → Hugging Face Space (Gradio) → PubMedBERT/BioBERT│
│  /api/verify    → OpenAI Responses API + web search → allow-list │
│  /api/translate → OpenAI (text only)                            │
│  /api/news      → BBC / WHO / CDC RSS feeds                     │
│  /api/share, /api/result, /api/stats → Upstash Redis (optional) │
└─────────────────────────────────────────────────────────────────┘
```

API keys are only stored in Vercel environment variables, never in `script.js`.

### API endpoints

| Endpoint | Method | Function | Input | Output |
|---|---|---|---|---|
| `/api/predict` | POST | Health-news classification | Text and model | Prediction and confidence |
| `/api/verify` | POST | Official Source Check | Text | Verdict, confidence, summary, sources |
| `/api/news` | GET | Health-news retrieval | None | List of health-news items |
| `/api/translate` | POST | Text translation | Text and target language | Translated text |
| `/api/stats` | GET / POST | Read / record statistics | None / verdict and confidence | Aggregated stats / status |
| `/api/share` | POST | Create shareable result | Analysis result | Result ID and share URL |
| `/api/result` | GET | Retrieve shared result | Result ID | Shared analysis result |

### Project structure

```
├── index.html, script.js, styles.css   # Front end
├── api/                                # Vercel serverless functions (see table above)
├── lib/upstash.js                      # Minimal Upstash Redis REST client
├── hf-space/                           # Gradio app that serves the fine-tuned models
├── vercel.json                         # Rewrite for /result/<id>
└── DEPLOYMENT.md                       # Full deployment guide
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Front end | HTML5, CSS3, JavaScript (ES6+), jsPDF |
| Hosting & backend | Vercel, Node.js serverless functions |
| Model serving | Hugging Face Spaces, Gradio |
| Machine learning | PyTorch, Hugging Face Transformers, scikit-learn |
| Classification models | PubMedBERT, BioBERT |
| Verification & translation | OpenAI Responses API with web search (`gpt-4.1-mini`) |
| News retrieval | Public RSS feeds (BBC Health, WHO, CDC) |
| Storage | Browser `localStorage`; Upstash Redis (optional, for sharing and global stats) |
| Development | Python, Google Colab, Jupyter Notebook, Git and GitHub |

---

## Getting started

### Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Vercel | Yes, for the official check and translation | OpenAI API key |
| `HF_SPACE_URL` | Vercel | Yes, for model prediction | e.g. `https://<user>-<space>.hf.space` |
| `UPSTASH_REDIS_REST_URL` | Vercel | Optional | Share links and site-wide stats |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | Optional | Share links and site-wide stats |
| `MODEL_REPO_PUBMEDBERT` | HF Space | Optional | Defaults to `YY80813/pubmedbert-fake-health-news` |
| `MODEL_REPO_BIOBERT` | HF Space | Optional | Enables BioBERT and *Compare both* |

Features whose variables are missing degrade gracefully. For example, the model tab shows "Model unavailable" instead of crashing.

### Run locally

```bash
npm install -g vercel
vercel dev
```

### Deploy

1. Push this repository to GitHub and import it into [Vercel](https://vercel.com).
2. Create a Hugging Face Space (SDK: Gradio) and upload the files in `hf-space/`.
3. Set the environment variables above, then redeploy.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`hf-space/README.md`](hf-space/README.md) for step-by-step instructions.

---

## Limitations & future work

- **Dataset:** trained only on HealthStory, so performance may drop on other sources or writing styles. Adding datasets such as **CoAID** would improve diversity and allow testing of generalisation.
- **Fine-tuning:** further tuning of learning rate, sequence length, trainable layers and decision threshold could balance fake-class precision and recall better. DistilBERT and other biomedical models could also be revisited.
- **Official Source Check:** add more trusted sources, and verify **individual claims** within an article instead of treating the whole article as one claim. Some publishers (e.g. BBC) block AI crawlers, so true claims can still come back *Unverified*.
- **Explainability:** highlight the words or phrases that influenced the prediction.
- **Multilingual:** analyse Malay or Chinese text directly instead of translating it first.
- **Live news:** expand the sources and automatically analyse new articles as they are published.
- **Deployment:** caching and more scalable infrastructure to reduce cold starts. Share links currently have no rate limiting. Larger-scale user testing and feedback from health experts would also help.

## Disclaimer

This is an academic project. Its results are for reference only and are not medical advice. Always check health information with official sources or a healthcare professional.

## Author

**Law Ying Yee**, Bachelor of Computer Science (Honours), Faculty of Information and Communication Technology, UTAR (Kampar Campus)
Supervisor: **Cik Nurul Syafidah Binti Jamil**
