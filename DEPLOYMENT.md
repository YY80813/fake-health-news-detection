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

## Fastest path: Vercel (free tier is enough for a FYP demo)

1. Push this whole repo (including the `api/` folder) to GitHub.
2. Go to https://vercel.com, sign in, "Add New Project", import the repo.
   Vercel auto-detects both `api/verify.js` and `api/news.js` as serverless
   functions — no config needed.
3. In the Vercel project's **Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = your key from https://platform.openai.com/api-keys
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
is now the only verdict shown. Your actual trained models (PubMedBERT /
BioBERT / DistilBERT / GloVe, from the notebooks in this project) still
aren't connected to this front end at all — that's a separate piece of work
(exposing those models through an inference API) if you want them involved
too.
