
// Voice Mixer Logic
// Handles matrix operations, mixing, and visualization for Supertonic Voice Styles

export class VoiceMixer {
    constructor() {
        this.currentTtl = null; // Float32Array (flattened)
        this.currentDp = null;  // Float32Array (flattened)
        this.ttlDims = [1, 50, 256];
        this.dpDims = [1, 8, 16];
        this.originalTtl = null; // To support Reset

        // Heatmap config
        this.canvas = null;
        this.ctx = null;
    }

    setCanvas(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
    }

    loadStyle(styleObj) {
        // styleObj is expected to be { ttl: Tensor, dp: Tensor } from helper.js
        // We need to extract the raw Float32Array data.

        // Helper to copy tensor data
        const copyTensorData = (tensor) => {
            return new Float32Array(tensor.data);
        };

        this.currentTtl = copyTensorData(styleObj.ttl);
        this.currentDp = copyTensorData(styleObj.dp);

        // Save original for reset
        this.originalTtl = new Float32Array(this.currentTtl);

        // Render if canvas is set
        if (this.canvas) this.renderHeatmap();
    }

    reset() {
        if (this.originalTtl) {
            this.currentTtl = new Float32Array(this.originalTtl);
            this.renderHeatmap();
        }
    }

    getStyle() {
        // Returns an object compatible with the helper.js Style class structure expected by TextToSpeech
        // We need to reconstruct the ONNX tensors.

        // We rely on the global 'ort' object being available or passed in.
        // Since helper.js constructs Tensors, we might need to do the same here.
        // However, helper.js does: new ort.Tensor(...)
        // We'll return the raw data and let the caller wrap it or we can import ort if needed.
        // For simplicity, let's assume the main app will wrap it or we just return the raw arrays
        // and the main app uses helper.createStyleFromArrays (which we might need to add) or similar.

        // Actually, let's just return the raw data and dimensions, and let main.js handle the Tensor creation
        // using the libraries it has access to.
        return {
            ttlData: this.currentTtl,
            dpData: this.currentDp,
            ttlDims: this.ttlDims,
            dpDims: this.dpDims
        };
    }

    // --- Visualization ---

    renderHeatmap() {
        if (!this.canvas || !this.currentTtl) return;

        const rows = this.ttlDims[1]; // 50 (Time/Tokens)
        const cols = this.ttlDims[2]; // 256 (Features)
        const data = this.currentTtl;

        // Resize canvas to match data dimensions (or a multiple)
        // We'll use CSS to scale it up for display, but keep internal resolution matching data
        this.canvas.width = cols;
        this.canvas.height = rows;

        const imageData = this.ctx.createImageData(cols, rows);
        const buf = imageData.data;

        // Find min/max for normalization
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;

        // Simple Viridis-like colormap (approximate)
        // Blue -> Green -> Yellow
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const val = (data[idx] - min) / range; // 0..1

                // Map val to RGB
                // This is a very rough approximation of Viridis
                let red, green, blue;

                // Color mapping logic
                if (val < 0.5) {
                    // Blue to Teal
                    // 0.0: (0, 0, 128)
                    // 0.5: (0, 128, 128)
                    const t = val * 2;
                    red = 0;
                    green = Math.floor(128 * t);
                    blue = Math.floor(128 + 127 * t);
                } else {
                    // Teal to Yellow
                    // 0.5: (0, 128, 128)
                    // 1.0: (255, 255, 0)
                    const t = (val - 0.5) * 2;
                    red = Math.floor(255 * t);
                    green = Math.floor(128 + 127 * t);
                    blue = Math.floor(255 * (1-t) * 0.2); // Fade blue out
                }

                const pixelIdx = (r * cols + c) * 4;
                buf[pixelIdx] = red;
                buf[pixelIdx + 1] = green;
                buf[pixelIdx + 2] = blue;
                buf[pixelIdx + 3] = 255; // Alpha
            }
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    // --- Helper for Matrix Logic (simulating 2D Numpy) ---
    _getVal(r, c) {
        const cols = this.ttlDims[2];
        if (r < 0 || r >= this.ttlDims[1] || c < 0 || c >= cols) return 0;
        return this.currentTtl[r * cols + c];
    }

    _setVal(r, c, val) {
         const cols = this.ttlDims[2];
         this.currentTtl[r * cols + c] = val;
    }

    // --- Operations ---

    mirrorX() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];

        // Create new buffer
        const newData = new Float32Array(this.currentTtl.length);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Flip column index
                const srcIdx = r * cols + (cols - 1 - c);
                const dstIdx = r * cols + c;
                newData[dstIdx] = this.currentTtl[srcIdx];
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    mirrorY() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];

        const newData = new Float32Array(this.currentTtl.length);

        for (let r = 0; r < rows; r++) {
            // Flip row index
            const srcRow = rows - 1 - r;
            // Copy entire row
            const startSrc = srcRow * cols;
            const startDst = r * cols;
            for(let c=0; c<cols; c++) {
                newData[startDst+c] = this.currentTtl[startSrc+c];
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    invertSign() {
        if (!this.currentTtl) return;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] = -this.currentTtl[i];
        }
        this.renderHeatmap();
    }

    addScalar(val) {
        if (!this.currentTtl) return;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] += val;
        }
        this.renderHeatmap();
    }

    multiplyScalar(val) {
        if (!this.currentTtl) return;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] *= val;
        }
        this.renderHeatmap();
    }

    dspSharpen() {
        // Adds derivative across features (axis 1)
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const newData = new Float32Array(this.currentTtl); // copy

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Central difference for gradient: (f(x+1) - f(x-1)) / 2
                // Handle boundaries by duplicating edge values
                const prev = (c > 0) ? this.currentTtl[r*cols + c-1] : this.currentTtl[r*cols + c];
                const next = (c < cols-1) ? this.currentTtl[r*cols + c+1] : this.currentTtl[r*cols + c];

                const grad = (next - prev) / 2.0;
                newData[r*cols + c] += grad * 1.5;
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    dspQuantize() {
        if (!this.currentTtl) return;
        const factor = 5.0;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] = Math.round(this.currentTtl[i] * factor) / factor;
        }
        this.renderHeatmap();
    }

    dspEcho() {
        // Adds shifted copy (roll right by 2) * 0.5
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const newData = new Float32Array(this.currentTtl);

        const shift = 2;
        const decay = 0.5;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Wrapped index
                let srcC = (c - shift);
                if (srcC < 0) srcC += cols;

                const echoVal = this.currentTtl[r * cols + srcC] * decay;
                newData[r * cols + c] += echoVal;
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    dspTremolo() {
        // Sinusoidal amplitude modulation across features
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];

        // Precompute envelope
        const envelope = new Float32Array(cols);
        for(let c=0; c<cols; c++) {
            const t = (c / (cols-1)) * 2 * Math.PI;
            envelope[c] = 1.0 + 0.5 * Math.sin(t);
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.currentTtl[r * cols + c] *= envelope[c];
            }
        }
        this.renderHeatmap();
    }

    dspJitter() {
        if (!this.currentTtl) return;
        for (let i = 0; i < this.currentTtl.length; i++) {
            const factor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
            this.currentTtl[i] *= factor;
        }
        this.renderHeatmap();
    }

    randomShift() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];

        const shiftR = Math.floor(Math.random() * rows);
        const shiftC = Math.floor(Math.random() * cols);

        // Create temp array
        const newData = new Float32Array(this.currentTtl.length);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const srcR = (r - shiftR + rows) % rows;
                const srcC = (c - shiftC + cols) % cols;
                newData[r * cols + c] = this.currentTtl[srcR * cols + srcC];
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    // --- Mixing ---

    mixVoices(voiceStyleObjs, weights) {
        // voiceStyleObjs: array of { ttl: Tensor, dp: Tensor }
        // weights: array of floats summing to 1 (optional, else equal)

        if (!voiceStyleObjs || voiceStyleObjs.length === 0) return;

        const count = voiceStyleObjs.length;
        if (!weights) {
            weights = new Array(count).fill(1.0 / count);
        }

        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const totalSize = rows * cols;

        const mixedTtl = new Float32Array(totalSize).fill(0);

        // We will also mix DP just in case, though usually we might pick one.
        // The python code mixes both.
        const dpSize = this.dpDims[1] * this.dpDims[2];
        const mixedDp = new Float32Array(dpSize).fill(0);

        for (let i = 0; i < count; i++) {
            const w = weights[i];
            const ttl = voiceStyleObjs[i].ttl.data;
            const dp = voiceStyleObjs[i].dp.data;

            for (let j = 0; j < totalSize; j++) {
                mixedTtl[j] += ttl[j] * w;
            }
            for (let j = 0; j < dpSize; j++) {
                mixedDp[j] += dp[j] * w;
            }
        }

        this.currentTtl = mixedTtl;
        this.currentDp = mixedDp;

        // Update original to this new mix so Reset reverts to the mix
        this.originalTtl = new Float32Array(mixedTtl);

        this.renderHeatmap();
    }

    // --- Singing Preset ---

    applySingingPreset() {
        if (!this.currentTtl) return;

        // Idea: Singing often implies more vibrato (Tremolo), brighter tone (Sharpen),
        // and maybe some echo/reverb feel.

        // 1. Sharpen to enhance formants
        this.dspSharpen();

        // 2. Tremolo for spectral richness/vibrato-like effect
        this.dspTremolo();

        // 3. Slight brightness boost
        this.multiplyScalar(1.1);

        this.renderHeatmap();
    }
}
