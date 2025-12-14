import {
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile,
    createStyleFromJSON,
    Style
} from './helper.js';

import { VoiceMixer } from './mixer.js';

// Lazy-load ONNX Runtime to avoid "document is not defined" errors in workers
let ortModule = null;
async function getOrt() {
    if (!ortModule) {
        ortModule = await import('onnxruntime-web');
        // Configure to avoid worker issues
        ortModule.env.wasm.numThreads = 1;
        ortModule.env.wasm.proxy = false;
    }
    return ortModule;
}

// Configuration
const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';

// Global state
let textToSpeech = null;
let cfgs = null;
let currentStyle = null; // The Style object used for inference
let currentStylePath = DEFAULT_VOICE_STYLE_PATH;
const mixer = new VoiceMixer();

// UI Variables (Initialized later to prevent 'document is not defined' errors)
let textInput, voiceStyleSelect, voiceStyleInfo, totalStepInput, speedInput;
let generateBtn, statusBox, statusText, backendBadge, resultsContainer, errorBox;
let toggleMixerBtn, mixerPanel, mixerCanvas;
let btnReset, btnMirrorX, btnMirrorY, btnInvert, btnRandShift, btnSharpen;
let btnQuantize, btnEcho, btnTremolo, btnJitter, btnAdd, btnMul;
let valAdd, valMul, btnSinging;
let voiceStyleUpload, customStyleContainer;

// --- Helper Functions ---

function getFilenameFromPath(path) {
    return path.split('/').pop();
}

function showStatus(message, type = 'info') {
    if (!statusText || !statusBox) return;
    statusText.innerHTML = message;
    statusBox.className = 'status-box';
    if (type === 'success') {
        statusBox.classList.add('success');
    } else if (type === 'error') {
        statusBox.classList.add('error');
    }
}

function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('active');
}

function hideError() {
    if (errorBox) errorBox.classList.remove('active');
}

function showBackendBadge() {
    if (backendBadge) backendBadge.classList.add('visible');
}

// Helper: Convert raw data from mixer back to ONNX Style object
async function getStyleFromMixer() {
    const ort = await getOrt();
    const data = mixer.getStyle();
    if (!data.ttlData) return null;

    // Create ONNX tensors
    const ttlTensor = new ort.Tensor('float32', data.ttlData, data.ttlDims);
    const dpTensor = new ort.Tensor('float32', data.dpData, data.dpDims);

    return new Style(ttlTensor, dpTensor);
}

async function updateStyleFromMixer() {
    currentStyle = await getStyleFromMixer();
}

// Operations wrapper for Mixer
async function applyMixerOp(opName, arg = null) {
    if (mixer[opName]) {
        if (arg !== null) mixer[opName](arg);
        else mixer[opName]();

        await updateStyleFromMixer();
    }
}

// Load voice style from JSON
async function loadStyleFromJSON(stylePath) {
    try {
        const style = await loadVoiceStyle([stylePath], true);
        return style;
    } catch (error) {
        console.error('Error loading voice style:', error);
        throw error;
    }
}

// --- Initialization Logic ---

function initializeUI() {
    // 1. Safe Element Selection (Only runs in browser)
    textInput = document.getElementById('text');
    voiceStyleSelect = document.getElementById('voiceStyleSelect');
    voiceStyleInfo = document.getElementById('voiceStyleInfo');
    totalStepInput = document.getElementById('totalStep');
    speedInput = document.getElementById('speed');
    generateBtn = document.getElementById('generateBtn');
    statusBox = document.getElementById('statusBox');
    statusText = document.getElementById('statusText');
    backendBadge = document.getElementById('backendBadge');
    resultsContainer = document.getElementById('results');
    errorBox = document.getElementById('error');

    // Mixer UI
    toggleMixerBtn = document.getElementById('toggleMixerBtn');
    mixerPanel = document.getElementById('mixerPanel');
    mixerCanvas = document.getElementById('mixerCanvas');

    // Mixer Buttons
    btnReset = document.getElementById('resetMixerBtn');
    btnMirrorX = document.getElementById('btnMirrorX');
    btnMirrorY = document.getElementById('btnMirrorY');
    btnInvert = document.getElementById('btnInvert');
    btnRandShift = document.getElementById('btnRandShift');
    btnSharpen = document.getElementById('btnSharpen');
    btnQuantize = document.getElementById('btnQuantize');
    btnEcho = document.getElementById('btnEcho');
    btnTremolo = document.getElementById('btnTremolo');
    btnJitter = document.getElementById('btnJitter');
    btnAdd = document.getElementById('btnAdd');
    btnMul = document.getElementById('btnMul');
    valAdd = document.getElementById('valAdd');
    valMul = document.getElementById('valMul');
    btnSinging = document.getElementById('btnSinging');

    voiceStyleUpload = document.getElementById('voiceStyleUpload');
    customStyleContainer = document.getElementById('customStyleContainer');

    // 2. Attach Event Listeners
    voiceStyleSelect.addEventListener('change', async (e) => {
        const selectedValue = e.target.value;

        if (selectedValue === 'custom') {
            customStyleContainer.classList.remove('hidden');
            voiceStyleInfo.textContent = "Waiting for file...";
            return;
        }

        customStyleContainer.classList.add('hidden');

        try {
            generateBtn.disabled = true;
            showStatus(`ℹ️ <strong>Loading voice style...</strong>`, 'info');

            currentStylePath = selectedValue;
            currentStyle = await loadStyleFromJSON(currentStylePath);
            mixer.loadStyle(currentStyle);

            voiceStyleInfo.textContent = getFilenameFromPath(currentStylePath);
            showStatus(`✅ <strong>Voice style loaded:</strong> ${getFilenameFromPath(currentStylePath)}`, 'success');
            generateBtn.disabled = false;
        } catch (error) {
            showError(`Error loading voice style: ${error.message}`);
            generateBtn.disabled = false;
        }
    });

    voiceStyleUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                showStatus(`ℹ️ <strong>Parsing custom style...</strong>`, 'info');
                const jsonContent = JSON.parse(e.target.result);
                if (!jsonContent.style_ttl || !jsonContent.style_dp) {
                    throw new Error("Invalid style JSON format.");
                }

                currentStyle = await createStyleFromJSON(jsonContent);
                mixer.loadStyle(currentStyle);

                voiceStyleInfo.textContent = `Custom: ${file.name}`;
                showStatus(`✅ <strong>Custom style loaded:</strong> ${file.name}`, 'success');
                generateBtn.disabled = false;
            } catch (error) {
                console.error(error);
                showError(`Failed to load custom style: ${error.message}`);
            }
        };
        reader.readAsText(file);
    });

    // Mixer Listeners
    toggleMixerBtn.addEventListener('click', () => {
        if (mixerPanel.classList.contains('hidden')) {
            mixerPanel.classList.remove('hidden');
            toggleMixerBtn.textContent = "Hide Mixer & Editor";
            mixer.renderHeatmap();
        } else {
            mixerPanel.classList.add('hidden');
            toggleMixerBtn.textContent = "Show Mixer & Editor";
        }
    });

    btnReset.addEventListener('click', () => applyMixerOp('reset'));
    btnMirrorX.addEventListener('click', () => applyMixerOp('mirrorX'));
    btnMirrorY.addEventListener('click', () => applyMixerOp('mirrorY'));
    btnInvert.addEventListener('click', () => applyMixerOp('invertSign'));
    btnRandShift.addEventListener('click', () => applyMixerOp('randomShift'));
    btnSharpen.addEventListener('click', () => applyMixerOp('dspSharpen'));
    btnQuantize.addEventListener('click', () => applyMixerOp('dspQuantize'));
    btnEcho.addEventListener('click', () => applyMixerOp('dspEcho'));
    btnTremolo.addEventListener('click', () => applyMixerOp('dspTremolo'));
    btnJitter.addEventListener('click', () => applyMixerOp('dspJitter'));

    btnAdd.addEventListener('click', () => {
        const val = parseFloat(valAdd.value);
        applyMixerOp('addScalar', val);
    });
    btnMul.addEventListener('click', () => {
        const val = parseFloat(valMul.value);
        applyMixerOp('multiplyScalar', val);
    });

    btnSinging.addEventListener('click', async () => {
        mixer.applySingingPreset();
        await updateStyleFromMixer();
        showStatus('✅ <strong>Applied Singing Preset!</strong> Try generating speech.', 'success');
    });

    // Attach Generate Event
    generateBtn.addEventListener('click', generateSpeech);
}

async function initializeModels() {
    try {
        showStatus('ℹ️ <strong>Loading configuration...</strong>');
        const basePath = 'assets/onnx';

        let executionProvider = 'wasm';
        try {
            const result = await loadTextToSpeech(basePath, {
                executionProviders: ['webgpu'],
                graphOptimizationLevel: 'all'
            }, (modelName, current, total) => {
                showStatus(`ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`);
            });
            textToSpeech = result.textToSpeech;
            cfgs = result.cfgs;
            executionProvider = 'webgpu';
            backendBadge.textContent = 'WebGPU';
            backendBadge.style.background = '#4caf50';
        } catch (webgpuError) {
            console.log('WebGPU not available, falling back to WebAssembly');
            const result = await loadTextToSpeech(basePath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            }, (modelName, current, total) => {
                showStatus(`ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`);
            });
            textToSpeech = result.textToSpeech;
            cfgs = result.cfgs;
        }

        showStatus('ℹ️ <strong>Loading default voice style...</strong>');
        mixer.setCanvas(mixerCanvas);
        currentStyle = await loadStyleFromJSON(currentStylePath);
        mixer.loadStyle(currentStyle);
        voiceStyleInfo.textContent = `${getFilenameFromPath(currentStylePath)} (default)`;
        showStatus(`✅ <strong>Models loaded!</strong> Using ${executionProvider.toUpperCase()}.`, 'success');
        showBackendBadge();
        generateBtn.disabled = false;

    } catch (error) {
        console.error('Error loading models:', error);
        showStatus(`❌ <strong>Error loading models:</strong> ${error.message}`, 'error');
    }
}

// --- Main Synthesis Function ---

async function generateSpeech() {
    const text = textInput.value.trim();
    if (!text) {
        showError('Please enter some text to synthesize.');
        return;
    }
    if (!textToSpeech || !cfgs || !currentStyle) {
        showError('Models are not ready. Please wait.');
        return;
    }

    const startTime = Date.now();
    try {
        generateBtn.disabled = true;
        hideError();
        resultsContainer.innerHTML = `
            <div class="results-placeholder generating">
                <div class="results-placeholder-icon">⏳</div>
                <p>Generating speech...</p>
            </div>
        `;

        const totalStep = parseInt(totalStepInput.value);
        const speed = parseFloat(speedInput.value);

        showStatus('ℹ️ <strong>Generating speech...</strong>');
        const tic = Date.now();
        const { wav, duration } = await textToSpeech.call(text, currentStyle, totalStep, speed, 0.3, (step, total) => {
            showStatus(`ℹ️ <strong>Denoising (${step}/${total})...</strong>`);
        });
        const toc = Date.now();

        const wavLen = Math.floor(textToSpeech.sampleRate * duration[0]);
        const wavOut = wav.slice(0, wavLen);
        const wavBuffer = writeWavFile(wavOut, textToSpeech.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(2);
        const audioDurationSec = duration[0].toFixed(2);

        resultsContainer.innerHTML = `
            <div class="result-item">
                <div class="result-text-container">
                    <div class="result-text-label">Input Text</div>
                    <div class="result-text">${text}</div>
                </div>
                <div class="result-info">
                    <div class="info-item"><span>📊 Length</span><strong>${audioDurationSec}s</strong></div>
                    <div class="info-item"><span>⏱️ Time</span><strong>${totalTimeSec}s</strong></div>
                </div>
                <div class="result-player"><audio controls><source src="${url}" type="audio/wav"></audio></div>
                <div class="result-actions">
                    <button onclick="downloadAudio('${url}', 'synthesized_speech.wav')">
                        <span>⬇️</span><span>Download WAV</span>
                    </button>
                </div>
            </div>
        `;
        showStatus('✅ <strong>Synthesis completed!</strong>', 'success');

    } catch (error) {
        console.error('Error:', error);
        showStatus(`❌ <strong>Error:</strong> ${error.message}`, 'error');
        showError(error.message);
        resultsContainer.innerHTML = `<div class="results-placeholder"><div class="results-placeholder-icon">🎤</div><p>Generated speech will appear here</p></div>`;
    } finally {
        generateBtn.disabled = false;
    }
}

window.downloadAudio = function (url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
};

// --- Entry Point ---
// Only access document when window is loaded
window.addEventListener('load', async () => {
    initializeUI();
    if (generateBtn) generateBtn.disabled = true;
    await initializeModels();
});
