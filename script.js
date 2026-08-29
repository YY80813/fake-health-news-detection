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

// Where the "Latest from Official Health Sources" panel gets its data (see
// api/news.js). Same same-origin-by-default convention as VERIFY_API_URL.
const NEWS_API_URL = '/api/news';

// Where "Your Model" tab gets its prediction from (see api/predict.js) - the
// PubMedBERT model fine-tuned in this project's notebooks, hosted on
// Hugging Face Hub and called through HF's serverless Inference API.
const MODEL_API_URL = '/api/predict';

// Initialize tabs
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initStats();
    loadHistory();
    loadOfficialNews();
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

// Main verdict banner at the top of the results card
function renderBanner(result) {
    const banner = document.getElementById('resultBanner');
    const meta = verdictMeta(result.verdict);
    const confidencePct = typeof result.confidence === 'number'
        ? Math.round(result.confidence * 100)
        : null;

    banner.innerHTML = `
        <div style="text-align: center;">
            <div class="prediction-badge" style="background:${meta.bg};color:${meta.fg};font-size:1.8rem;padding:0.75rem 2rem;margin-bottom:1rem;">
                ${meta.label}
            </div>
            ${confidencePct !== null ? `<div style="font-size:1.2rem;font-weight:600;">Confidence: ${confidencePct}%</div>` : ''}
            ${confidencePct !== null ? `
                <div style="margin-top:1rem;">
                    <div style="background:#e2e8f0;border-radius:10px;height:12px;width:80%;margin:0 auto;">
                        <div style="background:${meta.bg};width:${confidencePct}%;height:12px;border-radius:10px;"></div>
                    </div>
                </div>
            ` : ''}
            <p style="max-width:600px;margin:1rem auto 0;color:#4a5568;">${escapeHtml(result.summary || '')}</p>
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
            <p class="official-summary">${result.summary ? escapeHtml(result.summary) : 'No summary returned.'}</p>
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
// Your Trained Model (PubMedBERT, fine-tuned in this project's notebooks,
// served from Hugging Face Hub via api/predict.js)
// ============================================================================

async function getModelPrediction(text) {
    try {
        const response = await fetch(MODEL_API_URL, {
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
        // Most likely cause during development: api/predict.js isn't deployed
        // yet, or HF_API_TOKEN / HF_MODEL_REPO aren't set on the backend.
        return {
            verdict: 'unavailable',
            confidence: null,
            summary: 'Could not reach your trained model. Make sure api/predict.js is deployed ' +
                     'and HF_API_TOKEN / HF_MODEL_REPO are set on the backend. Details: ' + err.message
        };
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

function renderModelPrediction(result) {
    const container = document.getElementById('modelContent');
    if (!result) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:#718096;">No model prediction available.</div>';
        return;
    }

    const meta = MODEL_VERDICT_META[result.verdict] || MODEL_VERDICT_META.unavailable;
    const confidencePct = typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : null;

    container.innerHTML = `
        <div class="official-check">
            <div class="verdict-badge ${result.verdict}">${meta.label}</div>
            <p class="official-summary">${result.summary ? escapeHtml(result.summary) : 'No summary returned.'}</p>
            ${confidencePct !== null ? `
                <div class="model-confidence-bar">
                    <div class="model-confidence-fill" style="width:${confidencePct}%;background:${meta.bg};"></div>
                </div>
                <div class="model-confidence-label">Model confidence: ${confidencePct}%</div>
            ` : ''}
            <p style="margin-top:1.5rem;font-size:0.8rem;color:#a0aec0;">This is your fine-tuned PubMedBERT model's own prediction — independent of, and not filtered by, the Official Source Check above.</p>
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
// History
// ============================================================================

function saveToHistory(text, result, modelResult) {
    const historyItem = {
        id: Date.now(),
        text: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
        fullText: text,
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        modelVerdict: modelResult ? modelResult.verdict : null,
        modelConfidence: modelResult ? modelResult.confidence : null,
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
                                <span class="prediction-badge" style="background:${modelMeta.bg};color:${modelMeta.fg};font-size:0.8rem;padding:0.35rem 1rem;">
                                    ${modelMeta.label}
                                </span>
                                ${modelConfidencePct !== null ? `<div style="font-size: 0.7rem; margin-top: 0.2rem;">${modelConfidencePct}% confidence</div>` : ''}
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

function displayResults(text, officialResult, modelResult) {
    saveToHistory(text, officialResult, modelResult);

    const resultsCard = document.getElementById('resultsCard');
    resultsCard.style.display = 'block';

    renderBanner(officialResult);
    renderOfficialCheck(officialResult);
    renderModelPrediction(modelResult);
    renderTextAnalysis(text);
    updateStats(officialResult);

    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = 'flex';
    const predictBtn = document.getElementById('predictBtn');
    predictBtn.disabled = true;

    try {
        // Run the official-source check and your trained model in parallel -
        // they're independent, so no reason to wait on one before starting
        // the other.
        const [officialResult, modelResult] = await Promise.all([
            verifyOfficialSources(text),
            getModelPrediction(text)
        ]);
        loadingOverlay.style.display = 'none';
        predictBtn.disabled = false;
        displayResults(text, officialResult, modelResult);
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
