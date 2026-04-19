// Model configurations with weights for ensemble
const MODEL_CONFIG = {
    'Random Forest': { weight: 0.25, color: '#4299e1' },
    'SVC': { weight: 0.20, color: '#ed8936' },
    'KNN': { weight: 0.15, color: '#48bb78' },
    'CNN': { weight: 0.20, color: '#9f7aea' },
    'XGBoost': { weight: 0.20, color: '#f687b3' }
};

// Keywords for simulation (in production, replace with actual model API)
const FAKE_KEYWORDS = [
    'miracle', 'cure', 'secret', 'government hiding', 'suppressed', 
    'big pharma', 'natural remedy', 'detox', 'covid cure', 'vaccine dangerous',
    'they don\'t want you to know', 'truth about', 'conspiracy', 'cover-up',
    'instant', 'guaranteed', 'limited time', 'doctors hate', 'shocking'
];

const REAL_KEYWORDS = [
    'study', 'research', 'clinical trial', 'according to', 'fda approved',
    'scientists', 'evidence', 'peer-reviewed', 'who recommends', 'cdc',
    'vaccine effective', 'treatment guidelines', 'medical journal',
    'systematic review', 'meta-analysis', 'randomized', 'controlled'
];

let predictionHistory = [];

// Initialize tabs
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initStats();
    loadHistory();
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
            
            if (tabId === 'all') {
                document.getElementById('allTab').classList.add('active');
            } else if (tabId === 'comparison') {
                document.getElementById('comparisonTab').classList.add('active');
            } else if (tabId === 'analysis') {
                document.getElementById('analysisTab').classList.add('active');
            } else if (tabId === 'history') {
                document.getElementById('historyTab').classList.add('active');
                renderHistory();
            }
        });
    });
}

// Simulate model predictions (replace with actual API calls)
function simulateModelPredictions(text) {
    const textLower = text.toLowerCase();
    
    // Calculate base fake score
    let fakeScore = 0.3; // Base probability
    
    FAKE_KEYWORDS.forEach(keyword => {
        if (textLower.includes(keyword)) fakeScore += 0.08;
    });
    
    REAL_KEYWORDS.forEach(keyword => {
        if (textLower.includes(keyword)) fakeScore -= 0.06;
    });
    
    // Length factor
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 50) fakeScore += 0.1;
    if (wordCount > 300) fakeScore -= 0.05;
    
    // Punctuation factor
    const exclamationCount = (text.match(/!/g) || []).length;
    const questionCount = (text.match(/\?/g) || []).length;
    fakeScore += Math.min(0.15, exclamationCount * 0.03);
    fakeScore += Math.min(0.1, questionCount * 0.02);
    
    // Caps factor
    const capsRatio = (text.replace(/[^A-Z]/g, '').length) / Math.max(text.length, 1);
    if (capsRatio > 0.15) fakeScore += 0.12;
    
    // Clamp base score
    fakeScore = Math.max(0.05, Math.min(0.95, fakeScore));
    
    // Generate model-specific predictions with slight variations
    const predictions = {};
    
    for (const [modelName, config] of Object.entries(MODEL_CONFIG)) {
        // Add model-specific variation
        let variation = 0;
        if (modelName === 'CNN') variation = (Math.random() - 0.5) * 0.06;
        else if (modelName === 'XGBoost') variation = (Math.random() - 0.5) * 0.04;
        else variation = (Math.random() - 0.5) * 0.08;
        
        let modelFakeScore = fakeScore + variation;
        modelFakeScore = Math.max(0.03, Math.min(0.97, modelFakeScore));
        
        predictions[modelName] = {
            fakeProb: modelFakeScore,
            realProb: 1 - modelFakeScore,
            confidence: modelFakeScore > 0.5 ? modelFakeScore : 1 - modelFakeScore,
            prediction: modelFakeScore > 0.5 ? 'FAKE' : 'REAL'
        };
    }
    
    return predictions;
}

// Calculate ensemble prediction
function calculateEnsemble(predictions) {
    let weightedFakeProb = 0;
    let totalWeight = 0;
    
    for (const [modelName, data] of Object.entries(predictions)) {
        weightedFakeProb += data.fakeProb * MODEL_CONFIG[modelName].weight;
        totalWeight += MODEL_CONFIG[modelName].weight;
    }
    
    const ensembleFakeProb = weightedFakeProb / totalWeight;
    return {
        fakeProb: ensembleFakeProb,
        realProb: 1 - ensembleFakeProb,
        prediction: ensembleFakeProb > 0.5 ? 'FAKE' : 'REAL',
        confidence: ensembleFakeProb > 0.5 ? ensembleFakeProb : 1 - ensembleFakeProb
    };
}

// Update statistics
function updateStats(prediction, confidence) {
    let total = parseInt(localStorage.getItem('totalPredictions') || '0');
    let fakeCount = parseInt(localStorage.getItem('fakeDetected') || '0');
    let realCount = parseInt(localStorage.getItem('realDetected') || '0');
    let totalConfidence = parseFloat(localStorage.getItem('totalConfidence') || '0');
    
    total++;
    if (prediction === 'FAKE') {
        fakeCount++;
    } else {
        realCount++;
    }
    totalConfidence += confidence;
    
    localStorage.setItem('totalPredictions', total);
    localStorage.setItem('fakeDetected', fakeCount);
    localStorage.setItem('realDetected', realCount);
    localStorage.setItem('totalConfidence', totalConfidence);
    
    document.getElementById('totalPredictions').innerText = total;
    document.getElementById('fakeDetected').innerText = fakeCount;
    document.getElementById('realDetected').innerText = realCount;
    const avgConf = total > 0 ? Math.round((totalConfidence / total) * 100) : 0;
    document.getElementById('avgConfidence').innerText = avgConf + '%';
}

// Initialize stats
function initStats() {
    const total = localStorage.getItem('totalPredictions') || '0';
    const fakeCount = localStorage.getItem('fakeDetected') || '0';
    const realCount = localStorage.getItem('realDetected') || '0';
    const totalConfidence = parseFloat(localStorage.getItem('totalConfidence') || '0');
    
    document.getElementById('totalPredictions').innerText = total;
    document.getElementById('fakeDetected').innerText = fakeCount;
    document.getElementById('realDetected').innerText = realCount;
    const avgConf = parseInt(total) > 0 ? Math.round((totalConfidence / parseInt(total)) * 100) : 0;
    document.getElementById('avgConfidence').innerText = avgConf + '%';
}

// Reset stats
function resetStats() {
    if (confirm('Reset all prediction statistics?')) {
        localStorage.removeItem('totalPredictions');
        localStorage.removeItem('fakeDetected');
        localStorage.removeItem('realDetected');
        localStorage.removeItem('totalConfidence');
        initStats();
    }
}

// Save prediction to history
function saveToHistory(text, ensemble, predictions) {
    const historyItem = {
        id: Date.now(),
        text: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
        fullText: text,
        prediction: ensemble.prediction,
        confidence: ensemble.confidence,
        timestamp: new Date().toLocaleString(),
        predictions: predictions
    };
    
    predictionHistory.unshift(historyItem);
    if (predictionHistory.length > 20) predictionHistory.pop();
    
    localStorage.setItem('predictionHistory', JSON.stringify(predictionHistory));
}

// Load history from localStorage
function loadHistory() {
    const saved = localStorage.getItem('predictionHistory');
    if (saved) {
        predictionHistory = JSON.parse(saved);
    }
}

// Render history tab
function renderHistory() {
    const historyContainer = document.getElementById('historyContent');
    if (predictionHistory.length === 0) {
        historyContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #718096;">No predictions yet. Try analyzing some news!</div>';
        return;
    }
    
    historyContainer.innerHTML = `
        <div class="history-list">
            ${predictionHistory.map(item => `
                <div class="history-item">
                    <div class="history-text">
                        <strong>${item.timestamp}</strong><br>
                        "${item.text}"
                    </div>
                    <div class="history-prediction">
                        <span class="prediction-badge ${item.prediction === 'FAKE' ? 'fake' : 'real'}">
                            ${item.prediction === 'FAKE' ? '⚠️ FAKE' : '✅ REAL'}
                        </span>
                        <div style="font-size: 0.75rem; margin-top: 0.25rem;">
                            ${(item.confidence * 100).toFixed(1)}% confidence
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Display results
function displayResults(predictions, text) {
    const ensemble = calculateEnsemble(predictions);
    
    // Save to history
    saveToHistory(text, ensemble, predictions);
    
    // Show results card
    const resultsCard = document.getElementById('resultsCard');
    resultsCard.style.display = 'block';
    
    // Update ensemble banner
    const banner = document.getElementById('ensembleBanner');
    banner.innerHTML = `
        <div style="text-align: center;">
            <div class="prediction-badge ${ensemble.prediction === 'FAKE' ? 'fake' : 'real'}" 
                 style="font-size: 1.8rem; padding: 0.75rem 2rem; margin-bottom: 1rem;">
                ${ensemble.prediction === 'FAKE' ? '⚠️ FAKE NEWS DETECTED' : '✅ REAL NEWS VERIFIED'}
            </div>
            <div style="font-size: 1.2rem; font-weight: 600;">Ensemble Confidence: ${(ensemble.confidence * 100).toFixed(1)}%</div>
            <div style="margin-top: 1rem;">
                <div style="background: #e2e8f0; border-radius: 10px; height: 12px; width: 80%; margin: 0 auto;">
                    <div style="background: ${ensemble.prediction === 'FAKE' ? '#fc8181' : '#68d391'}; 
                                width: ${ensemble.confidence * 100}%; height: 12px; border-radius: 10px;"></div>
                </div>
            </div>
            <div style="margin-top: 1rem; display: flex; justify-content: center; gap: 2rem;">
                <div>Fake: ${(ensemble.fakeProb * 100).toFixed(1)}%</div>
                <div>Real: ${(ensemble.realProb * 100).toFixed(1)}%</div>
            </div>
        </div>
    `;
    
    // Update all models tab
    const allResultsDiv = document.getElementById('allResults');
    allResultsDiv.innerHTML = Object.entries(predictions).map(([modelName, data]) => `
        <div class="model-result-card">
            <div class="model-name">🤖 ${modelName}</div>
            <div class="prediction-badge ${data.prediction === 'FAKE' ? 'fake' : 'real'}">
                ${data.prediction === 'FAKE' ? '⚠️ FAKE' : '✅ REAL'}
            </div>
            <div class="confidence-score">${(data.confidence * 100).toFixed(1)}%</div>
            <div class="probability-bar">
                <div class="probability-fill ${data.prediction === 'FAKE' ? 'fake' : 'real'}" 
                     style="width: ${data.confidence * 100}%"></div>
            </div>
            <div style="margin-top: 0.5rem; font-size: 0.8rem; color: #718096;">
                Fake: ${(data.fakeProb * 100).toFixed(0)}% | Real: ${(data.realProb * 100).toFixed(0)}%
            </div>
        </div>
    `).join('');
    
    // Update comparison tab
    const comparisonDiv = document.getElementById('comparisonContent');
    const sortedModels = Object.entries(predictions).sort((a, b) => {
        const aConf = a[1].prediction === 'FAKE' ? a[1].fakeProb : a[1].realProb;
        const bConf = b[1].prediction === 'FAKE' ? b[1].fakeProb : b[1].realProb;
        return bConf - aConf;
    });
    
    comparisonDiv.innerHTML = `
        <div class="comparison-chart">
            <h4 style="margin-bottom: 1rem;">Model Confidence Comparison</h4>
            ${sortedModels.map(([modelName, data]) => `
                <div class="chart-bar-container">
                    <div class="chart-label">
                        <span>${modelName}</span>
                        <span>${(data.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div class="chart-bar-bg">
                        <div class="chart-bar" style="width: ${data.confidence * 100}%; background: ${MODEL_CONFIG[modelName].color}">
                            ${data.prediction}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div style="margin-top: 2rem;">
            <h4>Voting Distribution</h4>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                <div style="flex: 1; text-align: center; padding: 1rem; background: #fed7d7; border-radius: 12px;">
                    <div style="font-size: 2rem; font-weight: 800;">${Object.values(predictions).filter(p => p.prediction === 'FAKE').length}</div>
                    <div>Models voted FAKE</div>
                </div>
                <div style="flex: 1; text-align: center; padding: 1rem; background: #c6f6d5; border-radius: 12px;">
                    <div style="font-size: 2rem; font-weight: 800;">${Object.values(predictions).filter(p => p.prediction === 'REAL').length}</div>
                    <div>Models voted REAL</div>
                </div>
            </div>
        </div>
    `;
    
    // Update analysis tab
    const wordCount = text.split(/\s+/).length;
    const charCount = text.length;
    const sentenceCount = (text.match(/[.!?]+/g) || []).length;
    const avgWordLen = (charCount / Math.max(wordCount, 1)).toFixed(1);
    
    analysisDiv.innerHTML = `
        <div>
            <h4>📐 Text Statistics</h4>
            <table style="width: 100%; margin: 1rem 0; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 0.75rem;"><strong>Word Count</strong></td>
                    <td>${wordCount}</td>
                </table>
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
            </table>
            
            <h4 style="margin-top: 1.5rem;">🔍 Key Indicators</h4>
            <div style="margin: 1rem 0;">
                ${FAKE_KEYWORDS.some(kw => text.toLowerCase().includes(kw)) ? 
                    '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Contains suspicious keywords commonly found in fake news</div>' : 
                    '<div style="color: #38a169; margin: 0.25rem 0;">✅ No obvious fake news patterns detected</div>'}
                ${text.match(/!+/g) ? '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Excessive exclamation marks detected</div>' : ''}
                ${text.toUpperCase() !== text && text.length > 50 ? 
                    '<div style="color: #38a169; margin: 0.25rem 0;">✅ Normal capitalization pattern</div>' : 
                    '<div style="color: #e53e3e; margin: 0.25rem 0;">⚠️ Unusual capitalization detected</div>'}
            </div>
        </div>
    `;
    
    // Update stats
    updateStats(ensemble.prediction, ensemble.confidence);
    
    // Scroll to results
    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Main prediction function
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
    
    // Show loading
    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = 'flex';
    const predictBtn = document.getElementById('predictBtn');
    predictBtn.disabled = true;
    
    // Simulate processing delay (in production, this would be API call)
    setTimeout(() => {
        const predictions = simulateModelPredictions(text);
        loadingOverlay.style.display = 'none';
        predictBtn.disabled = false;
        displayResults(predictions, text);
    }, 2000);
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
