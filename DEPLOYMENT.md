# Deploying the Official Source Check feature

The front end (`index.html`, `styles.css`, `script.js`) is unchanged in how it's
hosted — it's still plain static files. What's new is `api/verify.js`, a small
backend function that holds your Gemini API key and does the actual search
against BBC / KKM / WHO / CDC. It **must** run server-side; it cannot run in
the browser, because any key placed in `script.js` would be visible to anyone
who views the page source.

## Fastest path: Vercel (free tier is enough for a FYP demo)

1. Push this whole repo (including the `api/` folder) to GitHub.
2. Go to https://vercel.com, sign in, "Add New Project", import the repo.
   Vercel auto-detects `api/verify.js` as a serverless function — no config
   needed.
3. In the Vercel project's **Settings → Environment Variables**, add:
   - `GEMINI_API_KEY` = your key from https://aistudio.google.com/apikey
4. Deploy. Your site will be live at `https://<project-name>.vercel.app`,
   and `POST /api/verify` will work automatically at the same domain — no
   change needed to `VERIFY_API_URL` in `script.js`.

## If you want to keep using GitHub Pages for the front end

GitHub Pages only serves static files — it cannot run `api/verify.js`. In that
case, deploy just the `api/` folder to Vercel (or Netlify Functions /
Cloudflare Workers) separately, then in `script.js` change:

```js
const VERIFY_API_URL = '/api/verify';
```

to the full URL of that deployment, e.g.:

```js
const VERIFY_API_URL = 'https://your-backend-project.vercel.app/api/verify';
```

`api/verify.js` already sends permissive CORS headers so this cross-origin
setup works.

## Testing locally

```bash
npm install -g vercel   # one-time
cp .env.example .env    # then fill in your real key
vercel dev
```

This runs both the static files and `api/verify.js` on `http://localhost:3000`.

## ⚠️ Please test the key once deployed

`api/verify.js` was written and unit-tested (its JSON-parsing and
source-filtering logic) using mocked responses, because the environment that
built it has no network route to `generativelanguage.googleapis.com` — only
to Anthropic's API and package registries. So the actual live call to
Google's Gemini API has **not** been verified end-to-end. Once you deploy
(or run `vercel dev` locally), try the "⚠️ Fake News" example button and
check the "Official Check" tab. If it errors, the two most likely culprits:

- **Model name**: `GEMINI_MODEL` at the top of `api/verify.js` is set to
  `'gemini-flash-latest'` (Google's alias for their current stable Flash
  model). If Google has retired that alias, swap in a current model id from
  https://ai.google.dev/gemini-api/docs/models.
- **Search tool key**: the request sends `tools: [{ google_search: {} }]`.
  If Google has changed this key name, the API error message in the
  response (visible in your browser's Network tab, or Vercel's function
  logs) will usually say so directly.

## What "official sources" means here

Gemini's Google Search grounding tool doesn't support a domain allowlist the
way some other providers' search tools do, so `api/verify.js` enforces it
itself, in code, after the model responds: every citation returned by
Google's grounding tool is checked against `ALLOWED_DOMAINS` at the top of
the file (`bbc.com`, `bbc.co.uk`, `kkm.gov.my`, `moh.gov.my`, `who.int`,
`cdc.gov`), and anything outside that list is dropped before it ever reaches
the front end. If nothing found was on an official domain, the verdict is
forced to `"unverified"` — the model's own claimed verdict is never trusted
blindly. Edit `ALLOWED_DOMAINS` to add or remove sources.

## Known limitation carried over from the original repo

The 5 simulated "ML models" (Random Forest, SVC, KNN, CNN, XGBoost) that used
to appear in the results have been removed per your request — the Official
Source Check is now the only verdict shown. Your actual trained models
(PubMedBERT / BioBERT / DistilBERT / GloVe, from the notebooks in this
project) still aren't connected to this front end at all — that's a separate
piece of work (exposing those models through an inference API) if you want
them involved too.
