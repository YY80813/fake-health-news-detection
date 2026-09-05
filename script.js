// ============================================================================
// Config
// ============================================================================

// Where the "Official Source Check" backend lives (see api/verify.js).
// - If this front end and the backend are deployed together (e.g. this whole
//   repo pushed to Vercel), leave this as '/api/verify' — same-origin call.
// - If the backend is hosted elsewhere, put its full URL here, e.g.
//   'https://your-project.vercel.app/api/verify'.
const VERIFY_API_URL = '/api/verify';

// Simple heuristic word lists used only for the supplementary "Text Analysis"
// tab (word/sentence counts, obvious red-flag phrasing). This is NOT a
// machine-learning model and isn't presented as one — the real verdict comes
// from the official-source check.
const FAKE_KEYWORDS = [
    'miracle', 'cure', 'secret', 'government hiding', 'suppressed',
    'big pharma', 'natural remedy', 'detox', 'covid cure', 'vaccine dangerous',
    'they don\'t want you to know', 'truth about', 'conspiracy', 'cover-up',
    'instant', 'guaranteed', 'limited time', 'doctors hate', 'shocking'
];

let predictionHistory = [];

// Translation UI state (see api/translate.js and the "Translation" section
// further down). `resultTranslationState` is reset every time a fresh
// verdict banner is rendered (new analysis, or a loaded /result/<id> page),
// since the DOM nodes it points at get rebuilt from scratch each time.
let resultTranslationState = { originals: null, activeLanguage: null };
let claimTranslationState = { original: null };

// Where the "Latest from Official Health Sources" panel gets its data (see
// api/news.js). Same same-origin-by-default convention as VERIFY_API_URL.
const NEWS_API_URL = '/api/news';

// Where "Your Model" tab gets its prediction from (see api/predict.js) - the
// PubMedBERT model fine-tuned in this project's notebooks, hosted on
// Hugging Face Hub and called through HF's serverless Inference API.
const MODEL_API_URL = '/api/predict';

// Backs the "Share" feature's real persistent link (see api/share.js /
// api/result.js) and the site-wide numbers in the Stats Dashboard (see
// api/stats.js). Both are backed by a small Upstash Redis database - if
// that isn't configured on this deployment, these calls fail soft and the
// corresponding UI (the global-stats line, real permalinks) just doesn't
// appear, rather than breaking anything else on the page.
const SHARE_API_URL = '/api/share';
const RESULT_API_URL = '/api/result';
const STATS_API_URL = '/api/stats';

// Powers both the Input Card's "Translate to English" button and the
// Results Card's "Translate result" control (see api/translate.js). Same
// same-origin-by-default convention as the other *_API_URL constants, and
// the same OPENAI_API_KEY as VERIFY_API_URL - nothing extra to configure.
const TRANSLATE_API_URL = '/api/translate';

// Initialize tabs
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initStats();
    loadHistory();
    loadOfficialNews();
    loadGlobalStats();

    // If this page was opened via a shared /result/<id> link (see
    // vercel.json's rewrite to /index.html), render that stored result
    // instead of waiting for the visitor to run their own check.
    const sharedId = getSharedResultIdFromUrl();
    if (sharedId) loadSharedResult(sharedId);
});

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            if (tabId === 'official') {
                document.getElementById('officialTab').classList.add('active');
            } else if (tabId === 'model') {
                document.getElementById('modelTab').classList.add('active');
            } else if (tabId === 'analysis') {
                document.getElementById('analysisTab').classList.add('active');
            } else if (tabId === 'history') {
                document.getElementById('historyTab').classList.add('active');
                renderHistory();
            }
        });
    });
}

// ============================================================================
// Official Source Check (BBC / KKM / WHO / CDC via LLM + web search)
// This is now the ONLY verdict source in the app.
// ============================================================================

// Calls the backend in api/verify.js, which asks an LLM (with a web-search
// tool restricted to official domains) whether this article's claims line up
// with what BBC Health, Malaysia's KKM, WHO, or CDC have actually published.
async function verifyOfficialSources(text) {
    try {
        const response = await fetch(VERIFY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `Request failed (${response.status})`);
        }

        return await response.json();
    } catch (err) {
        // Most likely cause during development: api/verify.js isn't deployed
        // yet, or the API key isn't set. Fail soft so the page still renders.
        return {
            verdict: 'unavailable',
            summary: 'Could not reach the official-source verification service. ' +
                     'Make sure api/verify.js is deployed and its API key is set on the backend. ' +
                     'Details: ' + err.message,
            sources: []
        };
    }
}

const VERDICT_META = {
    supported: {
        label: '✅ REAL NEWS — Verified by Official Sources',
        badgeText: '✅ Supported by official sources',
        bg: '#68d391',
        fg: '#22543d'
    },
    contradicted: {
        label: '⚠️ FAKE NEWS — Contradicted by Official Sources',
        badgeText: '⚠️ Contradicted by official sources',
        bg: '#fc8181',
        fg: '#742a2a'
    },
    unverified: {
        label: '❓ UNVERIFIED — No Matching Official Coverage',
        badgeText: '❓ Not addressed by official sources',
        bg: '#f6ad55',
        fg: '#7b341e'
    },
    unavailable: {
        label: '⚙️ Verification Unavailable',
        badgeText: '⚙️ Verification service unavailable',
        bg: '#cbd5e0',
        fg: '#4a5568'
    }
};

function verdictMeta(verdict) {
    return VERDICT_META[verdict] || { label: verdict, badgeText: verdict, bg: '#cbd5e0', fg: '#4a5568' };
}

// Resolves the model's own prediction and the LLM's official-source recheck
// into a single final conclusion, rather than just showing two badges and
// leaving the visitor to guess which one to believe. The decision policy:
//
//   1. If official sources return an actual citation (supported/contradicted),
//      that citation outweighs the model's prediction whenever the two
//      disagree - a cited, checkable source is stronger evidence than a
//      classifier's pattern-based guess, however confident that guess is.
//   2. If both agree, that's the strongest possible combined signal.
//   3. If official sources come back "unverified" (no matching official
//      coverage either way), fall back to the model's own call, but labelled
//      as unconfirmed rather than a flat, confident verdict - leaning fake
//      under uncertainty matches this project's own training philosophy
//      (failing to flag misleading health content is costlier than an
//      occasional false alarm), while leaning real under uncertainty is
//      intentionally still hedged as "unconfirmed" rather than a clean
//      "real", so silence from official sources never reads as a guarantee.
//   4. If one side genuinely couldn't be reached, fall back to whichever
//      side did respond, flagged as single-source rather than combined.
function computeFinalConclusion(modelResult, officialResult) {
    const modelVerdict = modelResult ? modelResult.verdict : 'unavailable';
    const officialVerdict = officialResult ? officialResult.verdict : 'unavailable';

    const modelSaysFake = modelVerdict === 'fake';
    const modelSaysReal = modelVerdict === 'real';
    const modelResponded = modelSaysFake || modelSaysReal;

    const officialSaysReal = officialVerdict === 'supported';
    const officialSaysFake = officialVerdict === 'contradicted';
    const officialHasCitation = officialSaysReal || officialSaysFake;

    // Neither system produced a usable verdict.
    if (!modelResponded && !officialHasCitation) {
        return {
            label: '⚙️ Unable to Assess',
            explanation: 'Both your trained model and the official-source check were unavailable for this article, so no conclusion could be reached.',
            bg: '#e2e8f0', fg: '#4a5568'
        };
    }

    // Official sources found a direct citation - that wins on disagreement,
    // and reinforces agreement.
    if (officialHasCitation && modelResponded) {
        if (modelSaysFake && officialSaysFake) {
            return {
                label: '⚠️ Fake News — Confirmed',
                explanation: "Your model and an independently cited official source both indicate this article is fake.",
                bg: '#fc8181', fg: '#742a2a'
            };
        }
        if (modelSaysReal && officialSaysReal) {
            return {
                label: '✅ Real News — Confirmed',
                explanation: 'Your model and an independently cited official source both confirm this article is real.',
                bg: '#68d391', fg: '#22543d'
            };
        }
        if (modelSaysFake && officialSaysReal) {
            return {
                label: '✅ Real News — Official Sources Override the Model',
                explanation: "Your model flagged this as fake, but a cited official source confirms it. A direct, checkable citation outweighs the model's own pattern-based prediction, so this is concluded as real.",
                bg: '#68d391', fg: '#22543d'
            };
        }
        // modelSaysReal && officialSaysFake
        return {
            label: '⚠️ Fake News — Official Sources Override the Model',
            explanation: "Your model found no red flags, but a cited official source contradicts this claim. A direct, checkable citation outweighs the model's own pattern-based prediction, so this is concluded as fake.",
            bg: '#fc8181', fg: '#742a2a'
        };
    }

    // Official sources responded but found nothing either way - fall back to
    // the model, but hedge the label since nothing official backs it up.
    if (!officialHasCitation && modelResponded) {
        if (officialVerdict === 'unavailable') {
            return modelSaysFake
                ? { label: '⚠️ Likely Fake (Model Only)', explanation: 'The official-source check was unavailable for this article, so this call rests on your trained model alone.', bg: '#fbd38d', fg: '#7b341e' }
                : { label: '✅ Likely Real (Model Only)', explanation: 'The official-source check was unavailable for this article, so this call rests on your trained model alone.', bg: '#c6f6d5', fg: '#22543d' };
        }
        return modelSaysFake
            ? { label: '⚠️ Likely Fake (Unconfirmed)', explanation: 'Your model flagged this as fake, and no official source addressed the claim either way. Treated as likely fake out of caution, since missing real misinformation is costlier than a false alarm.', bg: '#fbd38d', fg: '#7b341e' }
            : { label: '✅ Likely Real (Unconfirmed)', explanation: "Your model found no red flags, and no official source contradicted the claim - but none confirmed it either, so this is unconfirmed rather than fully verified.", bg: '#e9d8fd', fg: '#553c9a' };
    }

    // Model was unavailable but official sources returned a citation.
    return officialSaysReal
        ? { label: '✅ Real News (Official Sources Only)', explanation: 'Your trained model was unavailable for this article, so this verdict comes directly from a cited official source.', bg: '#68d391', fg: '#22543d' }
        : { label: '⚠️ Fake News (Official Sources Only)', explanation: 'Your trained model was unavailable for this article, so this verdict comes directly from a cited official source that contradicts the claim.', bg: '#fc8181', fg: '#742a2a' };
}

// Main verdict banner at the top of the results card - tells the two-step
// story: Step 1 is your trained model's own call on the text, Step 2 is the
// LLM independently rechecking the article against official sources. The
// agreement badge compares the two rather than just listing them side by side.
function renderBanner(officialResult, modelResult) {
    // A fresh banner means brand-new DOM nodes for the label/explanation/
    // summary text below, so any translation applied to the previous
    // result's nodes is now stale - drop it rather than leaving a "Show
    // English" button pointing at elements that no longer reflect it.
    resetResultTranslationUI();

    const banner = document.getElementById('resultBanner');
    const officialMeta = verdictMeta(officialResult.verdict);
    const officialConfidencePct = typeof officialResult.confidence === 'number'
        ? Math.round(officialResult.confidence * 100)
        : null;

    const modelMeta = MODEL_VERDICT_META[modelResult ? modelResult.verdict : 'unavailable'] || MODEL_VERDICT_META.unavailable;
    const modelConfidencePct = modelResult && typeof modelResult.confidence === 'number'
        ? Math.round(modelResult.confidence * 100)
        : null;

    const conclusion = computeFinalConclusion(modelResult, officialResult);

    banner.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size:0.8rem;color:#a0aec0;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Final Conclusion</div>
            <div class="prediction-badge" style="background:${conclusion.bg};color:${conclusion.fg};font-size:1.5rem;padding:0.75rem 1.5rem;">
                <span id="conclusionLabel">${conclusion.label}</span>
            </div>
            <p id="conclusionExplanation" style="max-width:600px;margin:0.75rem auto 0;color:#4a5568;font-size:0.95rem;">${escapeHtml(conclusion.explanation)}</p>

            <details style="max-width:600px;margin:1.5rem auto 0;text-align:left;">
                <summary style="cursor:pointer;text-align:center;color:#718096;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;">How this was reached</summary>

                <div style="margin-top:1rem;text-align:center;">
                    <div style="font-size:0.8rem;color:#a0aec0;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Step 1 &middot; Your Trained Model</div>
                    <div class="prediction-badge" style="background:${modelMeta.bg};color:${modelMeta.fg};font-size:1.3rem;">
                        ${modelMeta.label}
                    </div>
                    ${modelConfidencePct !== null ? `<div style="font-size:0.9rem;color:#4a5568;margin-top:0.25rem;">${modelConfidencePct}% confidence</div>` : ''}

                    <div style="margin:1rem 0;color:#cbd5e0;font-size:1.4rem;">&darr;</div>

                    <div style="font-size:0.8rem;color:#a0aec0;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Step 2 &middot; LLM Recheck Against Official Sources</div>
                    <div class="prediction-badge" style="background:${officialMeta.bg};color:${officialMeta.fg};font-size:1.3rem;">
                        ${officialMeta.label}
                    </div>
                    ${officialConfidencePct !== null ? `<div style="font-size:0.9rem;color:#4a5568;margin-top:0.25rem;">${officialConfidencePct}% confidence</div>` : ''}

                    <p id="officialSummaryBanner" style="max-width:600px;margin:1rem auto 0;color:#4a5568;">${escapeHtml(officialResult.summary || '')}</p>
                </div>
            </details>
        </div>
    `;
}

// Detail tab: full explanation + cited source links
function renderOfficialCheck(result) {
    const container = document.getElementById('officialContent');
    if (!result) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:#718096;">No official-source check available.</div>';
        return;
    }

    const meta = verdictMeta(result.verdict);
    const sources = Array.isArray(result.sources) ? result.sources : [];

    container.innerHTML = `
        <div class="official-check">
            <div class="verdict-badge ${result.verdict}">${meta.badgeText}</div>
            <p id="officialSummaryTab" class="official-summary">${result.summary ? escapeHtml(result.summary) : 'No summary returned.'}</p>
            ${sources.length > 0 ? `
                <h4 style="margin-top:1.5rem;">📎 Sources checked</h4>
                <div class="source-list">
                    ${sources.map(src => `
                        <a class="source-card" href="${escapeHtml(src.url || '#')}" target="_blank" rel="noopener noreferrer">
                            <div class="source-title">${escapeHtml(src.title || src.url || 'Untitled source')}</div>
                            <div class="source-publisher">${escapeHtml(src.publisher || safeHostname(src.url))}</div>
                        </a>
                    `).join('')}
                </div>
            ` : '<p style="color:#718096;font-size:0.9rem;margin-top:1rem;">No matching pages were found on BBC, KKM, WHO or CDC.</p>'}
            ${result.raw ? `<details style="margin-top:1rem;"><summary style="cursor:pointer;color:#718096;font-size:0.85rem;">Raw model output</summary><pre style="white-space:pre-wrap;font-size:0.8rem;color:#4a5568;">${escapeHtml(result.raw)}</pre></details>` : ''}
        </div>
    `;
}

// ============================================================================
// Translation (api/translate.js) - lets a visitor read the verdict back in
// another language, and lets a claim submitted in another language still be
// analyzed. Both directions go through the same small endpoint; only the
// direction (which text(s), which target language) differs.
// ============================================================================

// Called every time renderBanner() rebuilds the results DOM, since the
// nodes any previous translation touched no longer exist.
function resetResultTranslationUI() {
    resultTranslationState = { originals: null, activeLanguage: null };
    const select = document.getElementById('resultLanguage');
    const revertBtn = document.getElementById('revertResultBtn');
    const status = document.getElementById('translateResultStatus');
    if (select) select.value = '';
    if (revertBtn) revertBtn.hidden = true;
    if (status) status.textContent = '';
}

function handleTranslateResultClick() {
    const select = document.getElementById('resultLanguage');
    const targetLanguage = select ? select.value : '';
    if (!targetLanguage) {
        alert('Pick a language from the dropdown first.');
        return;
    }
    translateResultTo(targetLanguage);
}

// Translates the verdict label, its plain-language explanation, and the
// official-source summary (both places it appears - the collapsed "How
// this was reached" panel and the Official Check tab) in one request, then
// swaps them into the existing DOM nodes in place. The underlying claim
// text and sources are left untouched - only this human-readable narration
// is translated.
async function translateResultTo(targetLanguage) {
    if (!lastAnalysis) return;

    const label = document.getElementById('conclusionLabel');
    const explanation = document.getElementById('conclusionExplanation');
    const bannerSummary = document.getElementById('officialSummaryBanner');
    const tabSummary = document.getElementById('officialSummaryTab');
    if (!label || !explanation) return;

    // Cache the English originals once, the first time this result is
    // translated, so switching between languages (or reverting) never
    // translates an already-translated string.
    if (!resultTranslationState.originals) {
        resultTranslationState.originals = {
            label: label.textContent,
            explanation: explanation.textContent,
            bannerSummary: bannerSummary ? bannerSummary.textContent : '',
            tabSummary: tabSummary ? tabSummary.textContent : ''
        };
    }

    if (targetLanguage === 'English') {
        revertResultTranslation();
        return;
    }

    const status = document.getElementById('translateResultStatus');
    const button = document.getElementById('translateResultBtn');
    if (status) status.textContent = '🌐 Translating…';
    if (button) button.disabled = true;

    const o = resultTranslationState.originals;
    try {
        const response = await fetch(TRANSLATE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texts: [o.label, o.explanation, o.bannerSummary, o.tabSummary],
                targetLanguage
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

        const [tLabel, tExplanation, tBannerSummary, tTabSummary] = data.translations || [];
        if (tLabel) label.textContent = tLabel;
        if (tExplanation) explanation.textContent = tExplanation;
        if (bannerSummary && tBannerSummary) bannerSummary.textContent = tBannerSummary;
        if (tabSummary && tTabSummary) tabSummary.textContent = tTabSummary;

        resultTranslationState.activeLanguage = targetLanguage;
        if (status) status.textContent = `Showing in ${targetLanguage}`;
        const revertBtn = document.getElementById('revertResultBtn');
        if (revertBtn) revertBtn.hidden = false;
    } catch (err) {
        if (status) status.textContent = `Translation failed: ${err.message || err}`;
    } finally {
        if (button) button.disabled = false;
    }
}

function revertResultTranslation() {
    if (!resultTranslationState.originals) return;
    const o = resultTranslationState.originals;
    const label = document.getElementById('conclusionLabel');
    const explanation = document.getElementById('conclusionExplanation');
    const bannerSummary = document.getElementById('officialSummaryBanner');
    const tabSummary = document.getElementById('officialSummaryTab');

    if (label) label.textContent = o.label;
    if (explanation) explanation.textContent = o.explanation;
    if (bannerSummary) bannerSummary.textContent = o.bannerSummary;
    if (tabSummary) tabSummary.textContent = o.tabSummary;

    resultTranslationState.activeLanguage = null;
    const select = document.getElementById('resultLanguage');
    const revertBtn = document.getElementById('revertResultBtn');
    const status = document.getElementById('translateResultStatus');
    if (select) select.value = '';
    if (revertBtn) revertBtn.hidden = true;
    if (status) status.textContent = '';
}

// Translates whatever's currently in the claim textarea to English in
// place, so the trained model and official-source checker (both English-
// only) can still analyze a claim that was pasted in another language.
// Auto-detects the source language - the visitor doesn't need to say what
// it's in.
async function translateClaimInput() {
    const textarea = document.getElementById('newsText');
    if (!textarea || !textarea.value.trim()) {
        alert('Paste or type a claim first.');
        return;
    }

    const status = document.getElementById('translateInputStatus');
    const button = document.getElementById('translateInputBtn');
    if (status) status.textContent = '🌐 Translating…';
    if (button) button.disabled = true;

    const original = textarea.value;
    try {
        const response = await fetch(TRANSLATE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: original, targetLanguage: 'English' })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

        const translated = (data.translations && data.translations[0]) || '';
        if (!translated.trim()) throw new Error('Empty translation returned.');

        claimTranslationState.original = original;
        textarea.value = translated;
        if (status) status.textContent = 'Translated to English.';
        const revertBtn = document.getElementById('revertInputBtn');
        if (revertBtn) revertBtn.hidden = false;
    } catch (err) {
        if (status) status.textContent = `Translation failed: ${err.message || err}`;
    } finally {
        if (button) button.disabled = false;
    }
}

function revertClaimInput() {
    if (claimTranslationState.original === null) return;
    const textarea = document.getElementById('newsText');
    if (textarea) textarea.value = claimTranslationState.original;
    claimTranslationState.original = null;
    const revertBtn = document.getElementById('revertInputBtn');
    const status = document.getElementById('translateInputStatus');
    if (revertBtn) revertBtn.hidden = true;
    if (status) status.textContent = '';
}

// ============================================================================
// Your Trained Model (PubMedBERT, fine-tuned in this project's notebooks,
// served from Hugging Face Hub via api/predict.js)
// ============================================================================

// modelChoice is 'pubmedbert' (default), 'biobert', or 'both' - see the
// "Model" picker in the input card. The backend (api/predict.js) always
// responds with { model, primary, results }, where `results` has one entry
// per model actually run and `primary` names which of those is the one the
// rest of the site (the Final Conclusion banner) treats as "the" model
// verdict - see api/predict.js for why PubMedBERT is primary for 'both'.
async function getModelPrediction(text, modelChoice) {
    const requested = modelChoice === 'biobert' ? ['biobert']
        : modelChoice === 'both' ? ['pubmedbert', 'biobert']
        : ['pubmedbert'];
    const primary = modelChoice === 'biobert' ? 'biobert' : 'pubmedbert';

    try {
        const response = await fetch(MODEL_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model: modelChoice })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `Request failed (${response.status})`);
        }

        return await response.json();
    } catch (err) {
        // Most likely cause during development: api/predict.js isn't deployed
        // yet, or HF_SPACE_URL isn't set on the backend (see hf-space/README.md).
        const unavailable = {
            verdict: 'unavailable',
            confidence: null,
            summary: 'Could not reach your trained model. Make sure api/predict.js is deployed ' +
                     'and HF_SPACE_URL is set on the backend. Details: ' + err.message
        };
        const results = {};
        requested.forEach(key => { results[key] = unavailable; });
        return { model: modelChoice, primary, results };
    }
}

const MODEL_VERDICT_META = {
    fake: {
        label: '⚠️ Your model says: FAKE',
        bg: '#fc8181',
        fg: '#742a2a'
    },
    real: {
        label: '✅ Your model says: REAL',
        bg: '#68d391',
        fg: '#22543d'
    },
    unavailable: {
        label: '⚙️ Model unavailable',
        bg: '#cbd5e0',
        fg: '#4a5568'
    }
};

const MODEL_DISPLAY_NAMES = { pubmedbert: 'PubMedBERT', biobert: 'BioBERT' };

// One model's badge + confidence bar, used both for the single-model view
// and as one column of the side-by-side comparison view.
function renderOneModelCard(modelKey, result) {
    const meta = MODEL_VERDICT_META[result.verdict] || MODEL_VERDICT_META.unavailable;
    const confidencePct = typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : null;
    const name = MODEL_DISPLAY_NAMES[modelKey] || modelKey;

    return `
        <div class="model-compare-card">
            <div class="model-compare-name">${escapeHtml(name)}</div>
            <div class="verdict-badge ${result.verdict}">${meta.label}</div>
            <p class="official-summary">${result.summary ? escapeHtml(result.summary) : 'No summary returned.'}</p>
            ${confidencePct !== null ? `
                <div class="model-confidence-bar">
                    <div class="model-confidence-fill" style="width:${confidencePct}%;background:${meta.bg};"></div>
                </div>
                <div class="model-confidence-label">${name} confidence: ${confidencePct}%</div>
            ` : ''}
        </div>
    `;
}

// modelData is the full { model, primary, results } object from
// getModelPrediction - not just one model's result - so this can render
// either a single model's card (the common case) or, when the Reader chose
// "Compare both" in the input card, a side-by-side comparison of
// PubMedBERT and BioBERT with an explicit agree/disagree note. Only the
// `primary` result ever feeds the top Final Conclusion banner (see
// renderBanner) - this tab is where the raw comparison itself lives.
function renderModelPrediction(modelData) {
    const container = document.getElementById('modelContent');
    if (!modelData || !modelData.results) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:#718096;">No model prediction available.</div>';
        return;
    }

    const keys = Object.keys(modelData.results);

    if (keys.length <= 1) {
        const key = keys[0] || 'pubmedbert';
        container.innerHTML = `
            <div class="official-check">
                ${renderOneModelCard(key, modelData.results[key])}
                <p style="margin-top:1.5rem;font-size:0.8rem;color:#a0aec0;">This is your fine-tuned ${escapeHtml(MODEL_DISPLAY_NAMES[key] || key)} model's own prediction — independent of, and not filtered by, the Official Source Check above. Pick "Compare both" above the article box to see it side by side with the other model.</p>
            </div>
        `;
        return;
    }

    // Comparison view (both models ran).
    const pubmed = modelData.results.pubmedbert;
    const bio = modelData.results.biobert;
    const bothResponded = pubmed && bio && pubmed.verdict !== 'unavailable' && bio.verdict !== 'unavailable';
    const agree = bothResponded && pubmed.verdict === bio.verdict;

    container.innerHTML = `
        <div class="official-check" style="max-width:none;">
            ${bothResponded ? `
                <div class="model-agreement-note ${agree ? 'agree' : 'disagree'}">
                    ${agree
                        ? `✅ PubMedBERT and BioBERT agree: both say ${pubmed.verdict.toUpperCase()}.`
                        : `⚠️ PubMedBERT and BioBERT disagree: PubMedBERT says ${pubmed.verdict.toUpperCase()}, BioBERT says ${bio.verdict.toUpperCase()}.`}
                </div>
            ` : ''}
            <div class="model-compare-grid">
                ${renderOneModelCard('pubmedbert', pubmed)}
                ${renderOneModelCard('biobert', bio)}
            </div>
            <p style="margin-top:1.5rem;font-size:0.8rem;color:#a0aec0;">Both are independent, from-scratch fine-tunes on the same HealthStory dataset (FYP1 Chapter 5). The Final Conclusion banner above is fused against <strong>PubMedBERT's</strong> result specifically, since it was the stronger performer in that evaluation - BioBERT's result is shown here for direct comparison, not blended into the final verdict.</p>
        </div>
    `;
}

function safeHostname(url) {
    try {
        return new URL(url, location.href).hostname;
    } catch {
        return '';
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ============================================================================
// "Latest from Official Health Sources" panel — plain RSS headlines from
// BBC Health / WHO / CDC via api/news.js. No LLM involved, so this is
// unaffected by any AI-provider rate limits.
// ============================================================================

function relativeTime(pubDate) {
    if (!pubDate) return '';
    const then = Date.parse(pubDate);
    if (isNaN(then)) return '';
    const diffMs = Date.now() - then;
    if (diffMs < 0) return '';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString();
}

async function loadOfficialNews() {
    const content = document.getElementById('newsPanelContent');
    const refreshBtn = document.querySelector('.news-refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    try {
        const response = await fetch(NEWS_API_URL);
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];

        if (items.length === 0) {
            content.innerHTML = '<div class="news-panel-empty">No headlines available right now. Try refreshing, or visit BBC Health, WHO, or CDC directly.</div>';
            return;
        }

        content.innerHTML = items.map(item => `
            <a class="news-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                <div class="news-item-title">${escapeHtml(item.title)}</div>
                <div class="news-item-meta">
                    <span class="news-item-publisher">${escapeHtml(item.publisher)}</span>
                    ${item.pubDate ? ' · ' + escapeHtml(relativeTime(item.pubDate)) : ''}
                </div>
            </a>
        `).join('');
    } catch (err) {
        content.innerHTML = `<div class="news-panel-empty">Couldn't load official headlines right now (${escapeHtml(err.message)}). Make sure api/news.js is deployed.</div>`;
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('spinning');
    }
}

// ============================================================================
// Text Analysis tab (word/sentence stats + simple keyword flags — heuristic
// only, not a prediction)
// ============================================================================

function renderTextAnalysis(text) {
    const analysisDiv = document.getElementById('analysisContent');
    const wordCount = text.split(/\s+/).length;
    const charCount = text.length;
    const sentenceCount = (text.match(/[.!?]+/g) || []).length;
    const avgWordLen = (charCount / Math.max(wordCount, 1)).toFixed(1);

    analysisDiv.innerHTML = `
        <div>
            <h4>📐 Text Statistics</h4>
            <table style="width: 100%; margin: 1rem 0; border-collapse: collapse;">
                <tbody>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.75rem;"><strong>Word Count</strong></td>
                        <td>${wordCount}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.75rem;"><strong>Character Count</strong></td>
                        <td>${charCount}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.75rem;"><strong>Sentence Count</strong></td>
                        <td>${sentenceCount}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.75rem;"><strong>Average Word Length</strong></td>
                        <td>${avgWordLen} characters</td>
                    </tr>
                    <tr>
                        <td style="padding: 0.75rem;"><strong>Readability</strong></td>
                        <td>${wordCount < 100 ? 'Easy' : wordCount < 300 ? 'Moderate' : 'Complex'}</td>
                    </tr>
                </tbody>
            </table>

            <h4 style="margin-top: 1.5rem;">🔍 Key Indicators</h4>
            <div style="margin: 1rem 0;">
                ${FAKE_KEYWORDS.some(kw => text.toLowerCase().includes(kw)) ?
                    '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Contains phrasing commonly found in fake news (e.g. "miracle", "secret", "big pharma")</div>' :
                    '<div style="color: #38a169; margin: 0.25rem 0;">✅ No obvious fake-news phrasing detected</div>'}
                ${text.match(/!+/g) ? '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Excessive exclamation marks detected</div>' : ''}
                ${text.toUpperCase() !== text && text.length > 50 ?
                    '<div style="color: #38a169; margin: 0.25rem 0;">✅ Normal capitalization pattern</div>' :
                    '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Unusual capitalization detected</div>'}
            </div>
            <p style="margin-top:1rem;font-size:0.8rem;color:#a0aec0;">These are simple text-pattern flags for context only — the verdict above comes from the Official Source Check, not from this heuristic.</p>
        </div>
    `;
}

// ============================================================================
// Stats dashboard
// ============================================================================

function updateStats(result) {
    let total = parseInt(localStorage.getItem('totalPredictions') || '0');
    let fakeCount = parseInt(localStorage.getItem('fakeDetected') || '0');
    let realCount = parseInt(localStorage.getItem('realDetected') || '0');
    let totalConfidence = parseFloat(localStorage.getItem('totalConfidence') || '0');
    let confidenceSamples = parseInt(localStorage.getItem('confidenceSamples') || '0');

    total++;
    if (result.verdict === 'contradicted') {
        fakeCount++;
    } else if (result.verdict === 'supported') {
        realCount++;
    }

    if (typeof result.confidence === 'number') {
        totalConfidence += result.confidence;
        confidenceSamples++;
    }

    localStorage.setItem('totalPredictions', total);
    localStorage.setItem('fakeDetected', fakeCount);
    localStorage.setItem('realDetected', realCount);
    localStorage.setItem('totalConfidence', totalConfidence);
    localStorage.setItem('confidenceSamples', confidenceSamples);

    document.getElementById('totalPredictions').innerText = total;
    document.getElementById('fakeDetected').innerText = fakeCount;
    document.getElementById('realDetected').innerText = realCount;
    const avgConf = confidenceSamples > 0 ? Math.round((totalConfidence / confidenceSamples) * 100) : 0;
    document.getElementById('avgConfidence').innerText = avgConf + '%';
}

function initStats() {
    const total = localStorage.getItem('totalPredictions') || '0';
    const fakeCount = localStorage.getItem('fakeDetected') || '0';
    const realCount = localStorage.getItem('realDetected') || '0';
    const totalConfidence = parseFloat(localStorage.getItem('totalConfidence') || '0');
    const confidenceSamples = parseInt(localStorage.getItem('confidenceSamples') || '0');

    document.getElementById('totalPredictions').innerText = total;
    document.getElementById('fakeDetected').innerText = fakeCount;
    document.getElementById('realDetected').innerText = realCount;
    const avgConf = confidenceSamples > 0 ? Math.round((totalConfidence / confidenceSamples) * 100) : 0;
    document.getElementById('avgConfidence').innerText = avgConf + '%';
}

function resetStats() {
    if (confirm('Reset all prediction statistics?')) {
        localStorage.removeItem('totalPredictions');
        localStorage.removeItem('fakeDetected');
        localStorage.removeItem('realDetected');
        localStorage.removeItem('totalConfidence');
        localStorage.removeItem('confidenceSamples');
        initStats();
    }
}

// ============================================================================
// Site-wide stats (api/stats.js) - the database-backed counterpart to the
// per-browser numbers above. Those only ever reflect one browser's own
// localStorage; these come from a small Upstash Redis database shared by
// every visitor. If that isn't configured on this deployment, the line
// simply stays hidden rather than showing zeros or an error.
// ============================================================================

async function loadGlobalStats() {
    const el = document.getElementById('globalStatsLine');
    if (!el) return;
    try {
        const response = await fetch(STATS_API_URL);
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const data = await response.json();
        if (data.unavailable) {
            el.style.display = 'none';
            return;
        }
        const avgPct = typeof data.avgConfidence === 'number' ? Math.round(data.avgConfidence * 100) + '%' : 'n/a';
        el.textContent = `🌍 Site-wide (all visitors): ${data.total} checks · ${data.fake} flagged fake · ${data.real} verified real · ${avgPct} avg confidence`;
        el.style.display = 'block';
    } catch (err) {
        el.style.display = 'none';
    }
}

// Fire-and-forget: a hiccup here should never interrupt or slow down
// showing the Reader their own result, so this isn't awaited by its caller
// and swallows its own errors.
function recordGlobalStat(result) {
    fetch(STATS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: result.verdict, confidence: result.confidence })
    }).then(() => loadGlobalStats()).catch(() => {});
}

// ============================================================================
// History
// ============================================================================

function saveToHistory(text, result, modelResult, modelKey, secondaryResult, secondaryKey) {
    const historyItem = {
        id: Date.now(),
        text: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
        fullText: text,
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        modelVerdict: modelResult ? modelResult.verdict : null,
        modelConfidence: modelResult ? modelResult.confidence : null,
        modelKey: modelKey || 'pubmedbert',
        // Only set when the Reader picked "Compare both" - lets the History
        // tab show BioBERT's call alongside the primary PubMedBERT one.
        secondaryModelVerdict: secondaryResult ? secondaryResult.verdict : null,
        secondaryModelConfidence: secondaryResult ? secondaryResult.confidence : null,
        secondaryModelKey: secondaryKey || null,
        timestamp: new Date().toLocaleString()
    };

    predictionHistory.unshift(historyItem);
    if (predictionHistory.length > 20) predictionHistory.pop();

    localStorage.setItem('predictionHistory', JSON.stringify(predictionHistory));
}

function loadHistory() {
    const saved = localStorage.getItem('predictionHistory');
    if (saved) {
        predictionHistory = JSON.parse(saved);
    }
}

function renderHistory() {
    const historyContainer = document.getElementById('historyContent');
    if (predictionHistory.length === 0) {
        historyContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #718096;">No checks yet. Try analyzing some news!</div>';
        return;
    }

    historyContainer.innerHTML = `
        <div class="history-list">
            ${predictionHistory.map(item => {
                const meta = verdictMeta(item.verdict);
                const confidencePct = typeof item.confidence === 'number' ? Math.round(item.confidence * 100) : null;
                const modelMeta = item.modelVerdict ? (MODEL_VERDICT_META[item.modelVerdict] || MODEL_VERDICT_META.unavailable) : null;
                const modelConfidencePct = typeof item.modelConfidence === 'number' ? Math.round(item.modelConfidence * 100) : null;
                const modelName = MODEL_DISPLAY_NAMES[item.modelKey] || 'Model';
                const secondaryMeta = item.secondaryModelVerdict ? (MODEL_VERDICT_META[item.secondaryModelVerdict] || MODEL_VERDICT_META.unavailable) : null;
                const secondaryConfidencePct = typeof item.secondaryModelConfidence === 'number' ? Math.round(item.secondaryModelConfidence * 100) : null;
                const secondaryName = MODEL_DISPLAY_NAMES[item.secondaryModelKey] || 'Second model';
                return `
                <div class="history-item">
                    <div class="history-text">
                        <strong>${item.timestamp}</strong><br>
                        "${item.text}"
                    </div>
                    <div class="history-prediction">
                        <span class="prediction-badge" style="background:${meta.bg};color:${meta.fg};">
                            ${meta.badgeText}
                        </span>
                        ${confidencePct !== null ? `<div style="font-size: 0.75rem; margin-top: 0.25rem;">${confidencePct}% confidence</div>` : ''}
                        ${modelMeta ? `
                            <div style="margin-top: 0.5rem;">
                                <span class="prediction-badge" style="background:${modelMeta.bg};color:${modelMeta.fg};font-size:0.8rem;padding:0.35rem 1rem;" title="${escapeHtml(modelName)}">
                                    ${modelMeta.label}
                                </span>
                                ${modelConfidencePct !== null ? `<div style="font-size: 0.7rem; margin-top: 0.2rem;">${modelConfidencePct}% confidence</div>` : ''}
                            </div>
                        ` : ''}
                        ${secondaryMeta ? `
                            <div style="margin-top: 0.4rem;">
                                <span class="prediction-badge" style="background:${secondaryMeta.bg};color:${secondaryMeta.fg};font-size:0.75rem;padding:0.3rem 0.9rem;" title="${escapeHtml(secondaryName)}">
                                    ${escapeHtml(secondaryName)}: ${item.secondaryModelVerdict.toUpperCase()}
                                </span>
                                ${secondaryConfidencePct !== null ? `<div style="font-size: 0.65rem; margin-top: 0.2rem;">${secondaryConfidencePct}% confidence</div>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;}).join('')}
        </div>
    `;
}

// ============================================================================
// Main flow
// ============================================================================

// modelData is the full { model, primary, results } object from
// getModelPrediction. Only the primary result feeds the Final Conclusion
// banner and the history's main model badge; when "Compare both" was
// selected, the non-primary model's result is also recorded to History
// (see saveToHistory) and shown in full in the "Your Model" tab.
function displayResults(text, officialResult, modelData) {
    const primaryKey = modelData.primary;
    const primaryResult = modelData.results[primaryKey];
    const secondaryKey = Object.keys(modelData.results).find(k => k !== primaryKey) || null;
    const secondaryResult = secondaryKey ? modelData.results[secondaryKey] : null;

    saveToHistory(text, officialResult, primaryResult, primaryKey, secondaryResult, secondaryKey);

    const resultsCard = document.getElementById('resultsCard');
    resultsCard.style.display = 'block';

    renderBanner(officialResult, primaryResult);
    renderOfficialCheck(officialResult);
    renderModelPrediction(modelData);
    renderTextAnalysis(text);
    updateStats(officialResult);
    recordGlobalStat(officialResult);

    // Snapshot everything the Download/Share buttons need, so they just
    // format whatever's currently on screen rather than re-running anything.
    // shareUrl starts empty and is filled in (and cached here) the first
    // time a Share action actually needs a real permalink - see
    // getOrCreateShareLink().
    lastAnalysis = {
        text,
        officialResult,
        modelData,
        primaryKey,
        primaryResult,
        secondaryKey,
        secondaryResult,
        conclusion: computeFinalConclusion(primaryResult, officialResult),
        timestamp: new Date(),
        shareUrl: null
    };

    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// Shared results (/result/<id> links created by the Share feature - see
// api/share.js / api/result.js and vercel.json's rewrite). When this page
// is opened that way, it skips straight to rendering the stored result
// instead of showing an empty input card.
// ============================================================================

// /result/<id> is served by vercel.json's rewrite to this same index.html,
// so the ID has to be read from the URL path here rather than relying on a
// server-side route/template.
function getSharedResultIdFromUrl() {
    const match = location.pathname.match(/^\/result\/([A-Za-z0-9]{6,32})\/?$/);
    return match ? match[1] : null;
}

async function loadSharedResult(id) {
    const resultsCard = document.getElementById('resultsCard');
    try {
        const response = await fetch(`${RESULT_API_URL}?id=${encodeURIComponent(id)}`);
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `Request failed (${response.status})`);
        }
        const payload = await response.json();
        renderSharedResult(payload, id);
    } catch (err) {
        resultsCard.style.display = 'block';
        document.getElementById('resultBanner').innerHTML =
            `<div style="padding:2rem;text-align:center;color:#742a2a;">⚠️ ${escapeHtml(err.message)}</div>`;
        resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Renders a result fetched from api/result.js using the exact same
// rendering functions the live "Analyze & Detect" flow uses
// (renderBanner/renderOfficialCheck/renderModelPrediction/renderTextAnalysis)
// so a shared result looks identical to what the person who shared it saw -
// just without re-running the model or the official-source check. Also
// repopulates lastAnalysis, so the Download/Share buttons work on a shared
// result too (and Share reuses this same permalink rather than minting a
// new one).
function renderSharedResult(payload, id) {
    const { text, officialResult, modelData, primaryKey } = payload;
    const primaryResult = modelData.results[primaryKey];
    const secondaryKey = Object.keys(modelData.results).find(k => k !== primaryKey) || null;
    const secondaryResult = secondaryKey ? modelData.results[secondaryKey] : null;

    document.getElementById('newsText').value = text;

    const notice = document.getElementById('sharedResultNotice');
    if (notice) {
        notice.style.display = 'flex';
        notice.innerHTML =
            '<span>📌 You\'re viewing a result someone shared - it isn\'t live-updated. ' +
            'Want to check your own article?</span>' +
            '<button type="button" onclick="location.href=\'/\'">Check a new article →</button>';
    }

    const resultsCard = document.getElementById('resultsCard');
    resultsCard.style.display = 'block';

    renderBanner(officialResult, primaryResult);
    renderOfficialCheck(officialResult);
    renderModelPrediction(modelData);
    renderTextAnalysis(text);

    lastAnalysis = {
        text,
        officialResult,
        modelData,
        primaryKey,
        primaryResult,
        secondaryKey,
        secondaryResult,
        conclusion: computeFinalConclusion(primaryResult, officialResult),
        timestamp: payload.timestamp && !isNaN(Date.parse(payload.timestamp)) ? new Date(payload.timestamp) : new Date(),
        // Already has a permalink - reuse it instead of creating a duplicate
        // database entry the next time a Share action runs on this page.
        shareUrl: `${location.origin}/result/${id}`
    };

    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Reads the "Model" picker in the input card (a radio group; see
// index.html). Defaults to 'pubmedbert' if, for some reason, nothing is
// checked yet.
function getSelectedModelChoice() {
    const checked = document.querySelector('input[name="modelChoice"]:checked');
    return checked ? checked.value : 'pubmedbert';
}

async function predictNews() {
    const text = document.getElementById('newsText').value.trim();

    if (!text) {
        alert('Please enter some health news text to analyze.');
        return;
    }

    if (text.length < 30) {
        alert('Please enter more text (at least 30 characters) for accurate analysis.');
        return;
    }

    const modelChoice = getSelectedModelChoice();

    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    loadingOverlay.style.display = 'flex';
    const predictBtn = document.getElementById('predictBtn');
    predictBtn.disabled = true;

    try {
        // Two-step pipeline, run in sequence rather than in parallel: your
        // trained model(s) make the first call on the text, then the LLM
        // independently rechecks it against official sources. renderBanner
        // compares the two rather than treating them as unrelated tabs.
        if (loadingText) {
            loadingText.textContent = modelChoice === 'both'
                ? 'Step 1/2: Running PubMedBERT and BioBERT...'
                : `Step 1/2: Running your trained model (${MODEL_DISPLAY_NAMES[modelChoice] || modelChoice})...`;
        }
        const modelData = await getModelPrediction(text, modelChoice);

        if (loadingText) loadingText.textContent = 'Step 2/2: Rechecking against BBC Health, KKM, WHO and CDC...';
        const officialResult = await verifyOfficialSources(text);

        loadingOverlay.style.display = 'none';
        predictBtn.disabled = false;
        displayResults(text, officialResult, modelData);
    } catch (err) {
        loadingOverlay.style.display = 'none';
        predictBtn.disabled = false;
        alert('Something went wrong while analyzing this article: ' + err.message);
    }
}

// Set example text
function setExample(type) {
    if (type === 'fake') {
        document.getElementById('newsText').value =
            "🚨 BREAKING: Miracle Cure Discovered! 🚨\n\n" +
            "Doctors HATE this simple trick! A secret blend of essential oils has been scientifically proven to cure cancer in just 3 days. " +
            "Big Pharma is trying to suppress this information because it would destroy their multi-billion dollar profits. " +
            "One simple ingredient you already have at home can eliminate all toxins from your body! " +
            "Share this with everyone you know before they take it down!!!";
    } else {
        document.getElementById('newsText').value =
            "New Study Confirms COVID-19 Vaccine Effectiveness\n\n" +
            "According to a new study published in the New England Journal of Medicine, the COVID-19 vaccine has demonstrated 95% efficacy in preventing severe disease. " +
            "The study, which followed over 40,000 participants across multiple countries, found that vaccinated individuals were significantly less likely to require hospitalization. " +
            "The research was conducted by an independent team of scientists from leading universities and was peer-reviewed before publication. " +
            "The CDC and WHO continue to recommend vaccination as the most effective preventive measure against severe COVID-19 outcomes.";
    }
}

// Clear text
function clearText() {
    document.getElementById('newsText').value = '';
}

// ============================================================================
// Download & Share — lets a Reader keep or pass along one analysis result.
// Everything here reads from `lastAnalysis` (set at the end of
// displayResults) and is purely client-side: a plain-text report via
// Blob + <a download>, a shareable PNG "result card" rendered with
// <canvas>, and social sharing via the Web Share API where the browser
// supports it, falling back to platform share-intent links since this is a
// static/serverless site with no database to mint a persistent per-result
// URL to share instead.
// ============================================================================

let lastAnalysis = null;

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Converts a "#rrggbb" (or "#rgb") hex string into the [r,g,b] triple
// jsPDF's setFillColor/setTextColor expect - lets the PDF reuse the exact
// verdict colors already defined in VERDICT_META/computeFinalConclusion
// instead of a separate PDF-only palette.
function hexToRgb(hex) {
    const clean = String(hex).replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Advances to a new PDF page if the next `needed` points of content
// wouldn't fit above the bottom margin, returning the (possibly reset) y.
function ensurePdfSpace(doc, y, needed, margin, pageHeight) {
    if (y + needed > pageHeight - margin) {
        doc.addPage();
        return margin;
    }
    return y;
}

// Wraps `text` to fit `maxWidth` (using the PDF's current font/size) and
// prints it line by line, adding pages as needed. Returns the y-coordinate
// after the last line.
function addPdfWrappedText(doc, text, x, y, maxWidth, lineHeight, margin, pageHeight) {
    const lines = doc.splitTextToSize(String(text), maxWidth);
    lines.forEach(line => {
        y = ensurePdfSpace(doc, y, lineHeight, margin, pageHeight);
        doc.text(line, x, y);
        y += lineHeight;
    });
    return y;
}

// Builds the full-detail report as a jsPDF document (see the <script> tag
// for jspdf.umd.min.js loaded in index.html). Structure: title, Final
// Conclusion (colored to match the on-site banner), the full article text,
// Step 1 (each trained model run, with an agree/disagree note for "Compare
// both"), and Step 2 (the official-source verdict with clickable source
// links) - mirroring the on-page results card so the PDF is a complete,
// standalone record of what a Reader saw.
function buildReportPDF() {
    if (!lastAnalysis || !window.jspdf) return null;
    const { jsPDF } = window.jspdf;
    const { text, officialResult, modelData, primaryResult, secondaryKey, secondaryResult, conclusion, timestamp } = lastAnalysis;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    let y = margin + 12;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(45, 55, 72);
    y = addPdfWrappedText(doc, 'Fake Health News Detection System — Analysis Report', margin, y, contentWidth, 22, margin, pageHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(160, 174, 192);
    y = ensurePdfSpace(doc, y, 14, margin, pageHeight);
    doc.text('Generated: ' + timestamp.toLocaleString(), margin, y);
    y += 18;

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 22;

    // Final Conclusion
    const cleanLabel = conclusion.label.replace(/[✀-➿☀-⛿️]/g, '').trim();
    const [bgR, bgG, bgB] = hexToRgb(conclusion.bg);
    const [fgR, fgG, fgB] = hexToRgb(conclusion.fg);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(160, 174, 192);
    y = ensurePdfSpace(doc, y, 12, margin, pageHeight);
    doc.text('FINAL CONCLUSION', margin, y);
    y += 12;

    y = ensurePdfSpace(doc, y, 36, margin, pageHeight);
    doc.setFillColor(bgR, bgG, bgB);
    doc.roundedRect(margin, y, contentWidth, 32, 6, 6, 'F');
    doc.setTextColor(fgR, fgG, fgB);
    doc.setFontSize(13);
    doc.text(cleanLabel, margin + 14, y + 21);
    y += 32 + 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(74, 85, 104);
    y = addPdfWrappedText(doc, conclusion.explanation, margin, y, contentWidth, 15, margin, pageHeight);
    y += 18;

    // Article text
    y = ensurePdfSpace(doc, y, 20, margin, pageHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(45, 55, 72);
    doc.text('Article Text', margin, y);
    y += 17;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(74, 85, 104);
    y = addPdfWrappedText(doc, '“' + text + '”', margin, y, contentWidth, 14, margin, pageHeight);
    y += 20;

    // Step 1 — Your Trained Model(s)
    y = ensurePdfSpace(doc, y, 20, margin, pageHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(45, 55, 72);
    doc.text('Step 1 — Your Trained Model(s)', margin, y);
    y += 17;

    Object.keys(modelData.results).forEach(key => {
        const r = modelData.results[key];
        const name = MODEL_DISPLAY_NAMES[key] || key;
        const pct = typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : 'n/a';
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(45, 55, 72);
        y = ensurePdfSpace(doc, y, 14, margin, pageHeight);
        doc.text(`${name}: ${String(r.verdict).toUpperCase()} (confidence: ${pct})`, margin, y);
        y += 14;
        if (r.summary) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.setTextColor(74, 85, 104);
            y = addPdfWrappedText(doc, r.summary, margin + 12, y, contentWidth - 12, 13, margin, pageHeight);
        }
        y += 8;
    });

    if (secondaryKey && primaryResult && secondaryResult) {
        const agree = primaryResult.verdict === secondaryResult.verdict;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9.5);
        doc.setTextColor(113, 128, 150);
        y = addPdfWrappedText(
            doc,
            agree ? 'Both models agree.' : 'Models disagree — see the "Your Model(s)" tab on the site for the full comparison.',
            margin, y, contentWidth, 13, margin, pageHeight
        );
    }
    y += 10;

    // Step 2 — Official Source Check
    y = ensurePdfSpace(doc, y, 20, margin, pageHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(45, 55, 72);
    y = addPdfWrappedText(doc, 'Step 2 — Official Source Check (LLM + BBC Health / KKM / WHO / CDC)', margin, y, contentWidth, 15, margin, pageHeight);
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(74, 85, 104);
    y = ensurePdfSpace(doc, y, 14, margin, pageHeight);
    doc.text('Verdict: ' + String(officialResult.verdict).toUpperCase(), margin, y);
    y += 15;

    if (officialResult.summary) {
        doc.setFontSize(10);
        y = addPdfWrappedText(doc, officialResult.summary, margin, y, contentWidth, 14, margin, pageHeight);
        y += 8;
    }

    const sources = Array.isArray(officialResult.sources) ? officialResult.sources : [];
    if (sources.length > 0) {
        y = ensurePdfSpace(doc, y, 16, margin, pageHeight);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(45, 55, 72);
        doc.text('Sources checked:', margin, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        sources.forEach(src => {
            const label = `• ${src.title || src.url} (${src.publisher || safeHostname(src.url)})`;
            y = ensurePdfSpace(doc, y, 13, margin, pageHeight);
            doc.setTextColor(45, 55, 72);
            doc.textWithLink(label, margin, y, { url: src.url, maxWidth: contentWidth });
            y += 13;
        });
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(113, 128, 150);
        y = ensurePdfSpace(doc, y, 13, margin, pageHeight);
        doc.text('No matching pages were found on BBC, KKM, WHO or CDC.', margin, y);
    }

    // Disclaimer + page numbers on every page
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(160, 174, 192);
        doc.text('For research purposes only. Always consult healthcare professionals for medical advice.', margin, pageHeight - 24);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 55, pageHeight - 24);
    }

    return doc;
}

function downloadResultPDF() {
    if (!lastAnalysis) {
        alert('Run an analysis first, then you can download its report.');
        return;
    }
    if (!window.jspdf) {
        alert("The PDF library didn't load (check your internet connection or an ad-blocker), so the report couldn't be generated as a PDF.");
        return;
    }
    const doc = buildReportPDF();
    if (doc) doc.save(`fake-health-news-report-${Date.now()}.pdf`);
}

// Draws a rounded rectangle path (no built-in ctx.roundRect fallback needed
// this way) so the result card doesn't rely on a very recent Canvas API.
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Wraps text onto multiple canvas lines (fillText doesn't wrap on its own),
// returning the y-coordinate after the last line drawn. If maxLines is hit
// with text still remaining, the last line is truncated with an ellipsis.
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text).split(/\s+/);
    let line = '';
    let lineCount = 0;

    for (let i = 0; i < words.length; i++) {
        const testLine = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(testLine).width > maxWidth && line) {
            lineCount++;
            if (maxLines && lineCount >= maxLines) {
                let truncated = line;
                while (ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 0) {
                    truncated = truncated.slice(0, -1);
                }
                ctx.fillText(truncated + '…', x, y);
                return y + lineHeight;
            }
            ctx.fillText(line, x, y);
            y += lineHeight;
            line = words[i];
        } else {
            line = testLine;
        }
    }
    if (line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
    }
    return y;
}

// Renders the current result onto an off-screen canvas as a shareable,
// social-card-style image and resolves with it as a PNG Blob. Used by both
// "Download Image" and the Web Share API path (so a shared post can carry
// the image itself, not just a text summary).
function generateResultImageBlob() {
    return new Promise((resolve, reject) => {
        if (!lastAnalysis) {
            reject(new Error('No analysis to render yet.'));
            return;
        }
        const { conclusion, officialResult, primaryResult, primaryKey, text, timestamp } = lastAnalysis;

        const width = 1200;
        const height = 675;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error('Canvas is not supported in this browser.'));
            return;
        }

        // Background
        const bgGradient = ctx.createLinearGradient(0, 0, width, height);
        bgGradient.addColorStop(0, '#667eea');
        bgGradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        // Card
        const pad = 48;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 24);
        ctx.fill();

        // Header
        ctx.fillStyle = '#2d3748';
        ctx.font = '700 30px Inter, Arial, sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('🏥 Fake Health News Detection System', pad + 40, pad + 60);
        ctx.fillStyle = '#a0aec0';
        ctx.font = '400 16px Inter, Arial, sans-serif';
        ctx.fillText('LLM-powered official-source verification', pad + 40, pad + 86);

        // Final conclusion badge
        const badgeText = conclusion.label;
        ctx.font = '700 26px Inter, Arial, sans-serif';
        const maxBadgeWidth = width - pad * 2 - 80;
        let badgeTextWidth = ctx.measureText(badgeText).width;
        const badgeX = pad + 40;
        const badgeY = pad + 118;
        const badgeW = Math.min(badgeTextWidth + 60, maxBadgeWidth);
        const badgeH = 64;
        ctx.fillStyle = conclusion.bg;
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 32);
        ctx.fill();
        ctx.fillStyle = conclusion.fg;
        ctx.fillText(badgeText, badgeX + 30, badgeY + 41, badgeW - 60);

        // Explanation (wrapped)
        ctx.fillStyle = '#4a5568';
        ctx.font = '400 18px Inter, Arial, sans-serif';
        let y = badgeY + badgeH + 44;
        y = wrapCanvasText(ctx, conclusion.explanation, pad + 40, y, maxBadgeWidth, 26, 3);

        // Article snippet (wrapped)
        y += 16;
        ctx.fillStyle = '#718096';
        ctx.font = '600 14px Inter, Arial, sans-serif';
        ctx.fillText('ARTICLE (EXCERPT)', pad + 40, y);
        y += 26;
        ctx.fillStyle = '#2d3748';
        ctx.font = 'italic 400 18px Inter, Arial, sans-serif';
        const snippet = '"' + text.slice(0, 320) + (text.length > 320 ? '…"' : '"');
        wrapCanvasText(ctx, snippet, pad + 40, y, maxBadgeWidth, 26, 3);

        // Footer strip: model + official verdict chips
        const footerY = height - pad - 60;
        ctx.fillStyle = '#f7fafc';
        roundRect(ctx, pad + 40, footerY, width - pad * 2 - 80, 44, 10);
        ctx.fill();
        ctx.fillStyle = '#4a5568';
        ctx.font = '600 15px Inter, Arial, sans-serif';
        const modelName = MODEL_DISPLAY_NAMES[primaryKey] || primaryKey;
        const modelPct = primaryResult && typeof primaryResult.confidence === 'number'
            ? Math.round(primaryResult.confidence * 100) + '%' : 'n/a';
        const modelVerdictText = primaryResult ? String(primaryResult.verdict).toUpperCase() : 'N/A';
        const officialLabel = verdictMeta(officialResult.verdict).badgeText;
        ctx.fillText(
            `${modelName}: ${modelVerdictText} (${modelPct})   ·   Official check: ${officialLabel}`,
            pad + 56, footerY + 28, width - pad * 2 - 112
        );

        // Timestamp
        ctx.fillStyle = '#a0aec0';
        ctx.font = '400 13px Inter, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(timestamp.toLocaleString(), width - pad - 40, height - pad - 20);
        ctx.textAlign = 'left';

        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas could not be exported as an image.'));
        }, 'image/png');
    });
}

async function downloadResultImage() {
    if (!lastAnalysis) {
        alert('Run an analysis first, then you can download its result card.');
        return;
    }
    try {
        const blob = await generateResultImageBlob();
        triggerDownload(blob, `fake-health-news-result-${Date.now()}.png`);
    } catch (err) {
        alert('Could not generate the result image: ' + err.message);
    }
}

// Posts the current result to api/share.js the first time it's actually
// needed and caches the resulting URL on lastAnalysis, so repeat clicks
// across Twitter/Facebook/WhatsApp/copy/Web-Share within the same
// result all reuse one link instead of minting a new database entry each
// time. Returns null (rather than throwing) if the backend isn't
// configured or the request fails - every caller already knows to fall
// back to the plain homepage URL in that case.
async function getOrCreateShareLink() {
    if (!lastAnalysis) return null;
    if (lastAnalysis.shareUrl) return lastAnalysis.shareUrl;

    try {
        const response = await fetch(SHARE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: lastAnalysis.text,
                officialResult: lastAnalysis.officialResult,
                modelData: lastAnalysis.modelData,
                primaryKey: lastAnalysis.primaryKey,
                timestamp: lastAnalysis.timestamp.toISOString()
            })
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.url) {
            lastAnalysis.shareUrl = data.url;
            return data.url;
        }
        return null;
    } catch (err) {
        return null;
    }
}

// `url` is embedded directly in the returned text (rather than left as a
// separate field) so it survives being pasted into WhatsApp captions, or
// a clipboard paste - anywhere that doesn't have its own
// dedicated "link" slot the way Web Share's `url` field or Twitter/
// Facebook's `url=` parameter do.
function buildShareText(url) {
    if (!lastAnalysis) return '';
    const { conclusion, text } = lastAnalysis;
    const cleanLabel = conclusion.label.replace(/[✀-➿☀-⛿️]/g, '').trim();
    const snippet = text.length > 120 ? text.slice(0, 120) + '…' : text;
    let out = `Fake Health News Detector says: ${cleanLabel}\n"${snippet}"\n\nChecked against BBC Health, KKM, WHO & CDC.`;
    if (url) out += `\n${url}`;
    return out;
}

// The "Share" button's dropdown: platform share-intent links plus a
// "share via device" option (see shareViaWebShare) and a copy-to-clipboard
// fallback. Each link points at a real, permanent /result/<id> page (see
// api/share.js) when that's available, falling back to this site's
// homepage if it isn't configured on this deployment.
async function toggleShareMenu(event) {
    event.stopPropagation();
    if (!lastAnalysis) {
        alert('Run an analysis first, then you can share its result.');
        return;
    }
    const menu = document.getElementById('shareMenu');
    const wasHidden = menu.hidden;
    closeShareMenu();
    if (!wasHidden) return;

    const shareBtn = event.currentTarget;
    const originalLabel = shareBtn.textContent;
    shareBtn.textContent = '📤 Preparing link…';
    shareBtn.disabled = true;

    const shareUrl = (await getOrCreateShareLink()) || location.href.split('#')[0];
    const shareText = buildShareText(shareUrl);

    document.getElementById('shareTwitter').href =
        'https://twitter.com/intent/tweet?text=' + encodeURIComponent(buildShareText()) + '&url=' + encodeURIComponent(shareUrl);
    document.getElementById('shareFacebook').href =
        'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl) + '&quote=' + encodeURIComponent(buildShareText());
    document.getElementById('shareWhatsapp').href =
        'https://wa.me/?text=' + encodeURIComponent(shareText);

    shareBtn.textContent = originalLabel;
    shareBtn.disabled = false;
    menu.hidden = false;
    document.addEventListener('click', closeShareMenuOnOutsideClick);
}

function closeShareMenu() {
    const menu = document.getElementById('shareMenu');
    if (menu) menu.hidden = true;
    document.removeEventListener('click', closeShareMenuOnOutsideClick);
}

function closeShareMenuOnOutsideClick(e) {
    const wrapper = document.querySelector('.share-menu-wrapper');
    if (wrapper && !wrapper.contains(e.target)) closeShareMenu();
}

// Tries the device's native share sheet first, attaching the result-card
// image itself where the platform supports sharing files (mainly mobile
// Chrome and Apple's browsers). Most desktop browsers - including Windows
// Chrome/Edge - only support sharing text + a link through this API, not
// files, so in that case the image is downloaded automatically alongside
// the text/link share rather than silently left out. Falls back further to
// copying the text summary to the clipboard (plus the image download) if
// Web Share isn't supported at all; the platform link menu (toggleShareMenu)
// covers browsers in between.
async function shareViaWebShare() {
    if (!lastAnalysis) return;
    closeShareMenu();
    const shareUrl = (await getOrCreateShareLink()) || location.href.split('#')[0];
    const shareText = buildShareText(shareUrl);
    let blob = null;

    try {
        blob = await generateResultImageBlob();
        const file = new File([blob], 'fake-health-news-result.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Fake Health News Detection Result', text: shareText, url: shareUrl });
            return;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        // Fall through to text-only share / manual fallback below. `blob`
        // may still be set even though file-sharing itself isn't supported.
    }

    if (navigator.share) {
        try {
            await navigator.share({ title: 'Fake Health News Detection Result', text: shareText, url: shareUrl });
            if (blob) {
                triggerDownload(blob, `fake-health-news-result-${Date.now()}.png`);
                alert("This browser's share sheet can only carry text and a link, not images, so the result-card image was also downloaded — attach it by hand if you'd like to include it.");
            }
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
        }
    }

    if (blob) triggerDownload(blob, `fake-health-news-result-${Date.now()}.png`);
    await copyShareText();
    alert(blob
        ? "Your browser doesn't support direct sharing, so the summary was copied to your clipboard and the result-card image was downloaded — paste the text and attach the image wherever you'd like to share it."
        : "Your browser doesn't support direct sharing, so the summary was copied to your clipboard instead — paste it wherever you'd like to share it, or use one of the platform links in the Share menu."
    );
}

async function copyShareText() {
    if (!lastAnalysis) return;
    const shareUrl = (await getOrCreateShareLink()) || location.href.split('#')[0];
    const shareText = buildShareText(shareUrl);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText).then(() => {
            closeShareMenu();
        }).catch(() => {
            fallbackCopy(shareText);
        });
    } else {
        fallbackCopy(shareText);
    }
}

function fallbackCopy(str) {
    const textarea = document.createElement('textarea');
    textarea.value = str;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable - nothing more we can do */ }
    document.body.removeChild(textarea);
    closeShareMenu();
}
