# Fake Health News Detection and Verification System

**English** | [中文](#中文版)

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

---
---

<a id="中文版"></a>

# 假健康新闻检测与核查系统

[English](#fake-health-news-detection-and-verification-system) | **中文**

> **Fake News Detection using Machine Learning and NLP in Healthcare Domain**
> 毕业设计，计算机科学（荣誉）学士，拉曼大学（UTAR），2026

这是一个网页系统，可以把健康新闻分类为 **真或假**，并进一步 **与官方来源核对**。它结合了两个互相独立的判断：

1. **微调过的生物医学 Transformer 模型**：PubMedBERT（默认）或 BioBERT，在 FakeHealth 数据集的 HealthStory 子集上训练。
2. **官方来源核查**：由大语言模型（LLM）进行实时网络搜索，但只接受来自可信健康与新闻机构的引用（WHO、CDC、NIH、马来西亚卫生部 KKM、BBC、路透社、美联社）。

两者的结果会合并成一个 **最终结论**，并附上简短的“结论如何得出”说明。

---

## 主要结果

本项目的主要目标是识别出假健康新闻（少数类别），在这方面 PubMedBERT 表现最好：

| 指标（HealthStory 测试集） | PubMedBERT |
|---|---|
| 测试准确率 | **71.43%** |
| 假新闻类召回率 | **0.81** |
| 假新闻类 F1 分数 | **0.61** |

因此 PubMedBERT 被选为默认模型，BioBERT 则保留为备选模型，供用户比较。

---

## 项目目标

1. 研究用于从文本中检测假健康新闻的 NLP 与机器学习方法。
2. 使用合适的指标（准确率、精确率、召回率、F1 分数、混淆矩阵）比较和评估这些方法。
3. 基于表现最好的方法，开发一个网页版的假健康新闻检测系统。
4. 加入来源核查与佐证检索，补充分类结果。

---

## 功能

| 功能 | 说明 |
|---|---|
| 🤖 **模型预测** | 使用 **PubMedBERT**（默认）或 **BioBERT** 分类，也可以选择 **同时比较两者**，并显示置信度。 |
| 🌐 **官方来源核查** | 实时搜索网络，只保留白名单内官方域名的引用。若找不到任何官方来源，结果会被强制设为 *无法核实*，不会盲目相信 LLM 自己的判断。 |
| ⚖️ **综合分析（决策融合）** | 将模型与官方核查合并为一个最终结论，并附“结论如何得出”说明面板。 |
| 🔬 **文本分析** | 字数、字符数、句子数，以及文本中常见的夸张或误导性关键词。 |
| 🌏 **翻译** | 分析前可将非英文文章译成英文；结果可翻译成马来文、中文、淡米尔文等语言。 |
| 📰 **实时健康新闻** | 来自 BBC Health、WHO 和 CDC RSS 的最新新闻标题。 |
| 📜 **历史记录** | 过往检测保存在浏览器中（`localStorage`）。 |
| 📊 **系统统计** | 本浏览器的统计，以及可选的全站访客统计。 |
| 📤 **导出与分享** | 可下载 PDF 报告或图片，生成永久的 `/result/<id>` 分享链接，或复制文字摘要。 |

### 最终结论的判定规则

1. 若官方核查找到 **引用**（支持或反驳），当两者意见不一致时，以官方引用为准。可查证的来源比基于模式的预测更有说服力。
2. 若模型与官方来源 **一致**，结果标为 **已确认**。
3. 若官方来源没有相关报道（*无法核实*），则采用模型的判断，但标为 **未确认**。在不确定时系统倾向判为 *假*，因为漏掉真正的假消息代价更大。
4. 若其中一方无法使用，则显示另一方的结果，并注明为单一来源。

在 **同时比较两者** 模式下，若 PubMedBERT 与 BioBERT 结论一致，取两者置信度的平均值；若不一致，采用置信度较高的模型的判断。

---

## 数据集

| 项目 | 内容 |
|---|---|
| 来源 | **FakeHealth** 数据集的 **HealthStory** 子集 |
| 数量 | 原有 1,690 篇，删除空白、重复和损坏的记录后剩 **1,679** 篇 |
| 标签 | 可信度评分 0–2 → **假**，3–5 → **真** |
| 类别分布 | **470 篇假新闻 / 1,209 篇真新闻**（不平衡） |
| 划分（训练 / 验证 / 测试） | 68 : 12 : 20，即 **1,141 / 202 / 336** 篇 |

本项目采用 **CRISP-DM** 开发方法。

---

## 实验与结果

### 1. 特征表示比较（SVC 分类器）

| 特征表示 | 测试准确率 | 假新闻召回率 | 假新闻 F1 |
|---|---|---|---|
| TF-IDF（1–3 gram） | 76.72% | 0.28 | 0.40 |
| Word2Vec | 65.07% | 0.29 | 0.32 |
| GloVe | 60.30% | **0.62** | **0.47** |

TF-IDF 准确率最高，但漏掉了大部分假新闻。GloVe 识别假新闻的能力最好，因此被选为传统方法的基线。

### 2. GloVe + SVC 基线

| 配置 | 训练准确率 | 测试准确率 | 假 P | 假 R | 假 F1 | 真 P | 真 R | 真 F1 |
|---|---|---|---|---|---|---|---|---|
| 基线 SVC | 0.7590 | 0.7701 | 0.74 | 0.28 | 0.40 | 0.77 | 0.96 | 0.86 |
| 类别加权 SVC | 0.7082 | 0.6000 | 0.37 | 0.62 | 0.46 | 0.80 | 0.59 | 0.68 |
| GridSearch 调参 SVC | 0.8216 | 0.6597 | 0.43 | 0.62 | **0.50** | 0.82 | 0.68 | 0.74 |

类别加权把假新闻召回率从 0.28 提高到 0.62，但整体准确率明显下降。这说明整体准确率与识别少数类别之间存在取舍。

### 3. 微调 Transformer 模型

| 模型 | 训练准确率 | 测试准确率 | 差距 | 假 P | 假 R | 假 F1 | 真 P | 真 R | 真 F1 |
|---|---|---|---|---|---|---|---|---|---|
| **PubMedBERT** | 0.8142 | **0.7143** | 0.0999 | 0.49 | **0.81** | **0.61** | 0.90 | 0.68 | 0.77 |
| BioBERT | 0.8054 | 0.6696 | 0.1358 | 0.45 | 0.80 | 0.57 | 0.89 | 0.62 | 0.73 |
| DistilBERT | 0.7029 | 0.6607 | 0.0422 | 0.42 | 0.55 | 0.48 | 0.80 | 0.70 | 0.75 |

- **PubMedBERT**：假新闻召回率和 F1 最高，因此被选为默认模型。
- **BioBERT**：假新闻召回率几乎相同（0.80），但精确率较低，训练与测试的差距较大。它被保留为备选模型。
- **DistilBERT**：差距最小，但假新闻召回率最差。在本项目的设置中，它的 Transformer 层几乎全部被冻结，限制了它的学习能力，因此没有部署。

### Transformer 训练配置

| 参数 | 数值 |
|---|---|
| 训练轮数 | 4 |
| 批次大小（训练 / 评估） | 16 / 32 |
| 学习率 | 2 × 10⁻⁵ |
| 权重衰减 | 0.01 |
| 最大序列长度 | 128 |
| 损失函数 | 类别加权交叉熵（自定义 `WeightedLossTrainer`） |
| 层冻结 | 冻结最底下 8 层 Transformer（BioBERT、PubMedBERT） |
| 早停耐心值 | 2 |
| 模型选择指标 | 假新闻类 F1 分数 |

由于漏掉假新闻的后果更严重，本项目以假新闻类的 F1 和召回率作为主要指标。

---

## 系统架构

- **前端**：`index.html`、`script.js`、`styles.css`（纯静态文件，无需构建）
- **Vercel 无服务器函数**：
  - `/api/predict` → Hugging Face Space（Gradio）→ PubMedBERT / BioBERT
  - `/api/verify` → OpenAI Responses API + 网络搜索 → 官方域名白名单过滤
  - `/api/translate` → OpenAI（纯文本翻译）
  - `/api/news` → BBC / WHO / CDC RSS
  - `/api/share`、`/api/result`、`/api/stats` → Upstash Redis（可选）

所有 API 密钥只存放在 Vercel 环境变量中，不会出现在 `script.js` 里。

### API 接口

| 接口 | 方法 | 功能 | 输入 | 输出 |
|---|---|---|---|---|
| `/api/predict` | POST | 健康新闻分类 | 文本与模型 | 预测结果与置信度 |
| `/api/verify` | POST | 官方来源核查 | 文本 | 结论、置信度、摘要、来源 |
| `/api/news` | GET | 获取健康新闻 | 无 | 健康新闻列表 |
| `/api/translate` | POST | 文本翻译 | 文本与目标语言 | 翻译后的文本 |
| `/api/stats` | GET / POST | 读取 / 记录统计 | 无 / 结论与置信度 | 汇总统计 / 记录状态 |
| `/api/share` | POST | 生成分享结果 | 分析结果 | 结果 ID 与分享链接 |
| `/api/result` | GET | 读取分享结果 | 结果 ID | 分享的分析结果 |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | HTML5、CSS3、JavaScript（ES6+）、jsPDF |
| 托管与后端 | Vercel、Node.js 无服务器函数 |
| 模型部署 | Hugging Face Spaces、Gradio |
| 机器学习 | PyTorch、Hugging Face Transformers、scikit-learn |
| 分类模型 | PubMedBERT、BioBERT |
| 核查与翻译 | OpenAI Responses API（含网络搜索，`gpt-4.1-mini`） |
| 新闻来源 | 公共 RSS（BBC Health、WHO、CDC） |
| 存储 | 浏览器 `localStorage`；Upstash Redis（可选，用于分享与全站统计） |
| 开发工具 | Python、Google Colab、Jupyter Notebook、Git 与 GitHub |

---

## 快速开始

### 环境变量

| 变量 | 设置位置 | 是否必需 | 用途 |
|---|---|---|---|
| `OPENAI_API_KEY` | Vercel | 官方核查与翻译需要 | OpenAI API 密钥 |
| `HF_SPACE_URL` | Vercel | 模型预测需要 | 例如 `https://<user>-<space>.hf.space` |
| `UPSTASH_REDIS_REST_URL` | Vercel | 可选 | 分享链接与全站统计 |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | 可选 | 分享链接与全站统计 |
| `MODEL_REPO_PUBMEDBERT` | HF Space | 可选 | 默认为 `YY80813/pubmedbert-fake-health-news` |
| `MODEL_REPO_BIOBERT` | HF Space | 可选 | 启用 BioBERT 及“同时比较两者” |

缺少某个变量时，相关功能会优雅降级。例如模型功能会显示“模型不可用”，而不会导致系统崩溃。

### 本地运行

```bash
npm install -g vercel
vercel dev
```

### 部署

1. 将本仓库推送到 GitHub，并导入 [Vercel](https://vercel.com)。
2. 创建一个 Hugging Face Space（SDK 选 Gradio），上传 `hf-space/` 中的文件。
3. 设置上述环境变量，然后重新部署。

详细步骤请参阅 [`DEPLOYMENT.md`](DEPLOYMENT.md) 和 [`hf-space/README.md`](hf-space/README.md)。

---

## 局限与未来工作

- **数据集**：只在 HealthStory 上训练，换到其他来源或写作风格时表现可能下降。加入 **CoAID** 等数据集可以增加多样性，并用来检验泛化能力。
- **微调**：可进一步调整学习率、序列长度、可训练层和分类阈值，以更好地平衡假新闻的精确率与召回率，也可以重新尝试 DistilBERT 及其他生物医学模型。
- **官方来源核查**：加入更多可信来源，并对文章中的 **每一项声明** 分别核查，而不是把整篇文章当作一项声明。部分媒体（如 BBC）屏蔽 AI 爬虫，因此真实的内容也可能被标为 *无法核实*。
- **可解释性**：标示出影响预测结果的关键词或句子。
- **多语言**：直接分析马来文或中文内容，而不必先翻译。
- **实时新闻**：扩大新闻来源，并自动分析新发布的文章。
- **部署**：通过缓存和更可扩展的基础设施减少冷启动延迟。分享接口目前没有访问频率限制。也可以进行更大规模的用户测试，并收集健康领域专家的意见。

## 免责声明

本项目为学术用途，结果仅供参考，不构成医疗建议。健康信息请以官方来源或医疗专业人员的意见为准。

## 作者

**Law Ying Yee**，计算机科学（荣誉）学士，资讯与通讯科技学院，拉曼大学（金宝校区）
指导老师：**Cik Nurul Syafidah Binti Jamil**
