import * as ort from 'onnxruntime-web';

// Ensure WASM runs on main thread or correctly configured worker
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

// Vite serves public/ directory from root, so paths should be absolute
const MODELS_PATH = '/assets/onnx';

interface StyleData {
    style_ttl: { data: number[], dims: number[] };
    style_dp: { data: number[], dims: number[] };
}

export class Style {
    ttl: ort.Tensor;
    dp: ort.Tensor;

    constructor(ttlTensor: ort.Tensor, dpTensor: ort.Tensor) {
        this.ttl = ttlTensor;
        this.dp = dpTensor;
    }
}

class UnicodeProcessor {
    indexer: number[];

    constructor(indexer: number[]) {
        this.indexer = indexer;
    }

    call(textList: string[]) {
        const processedTexts = textList.map(text => this.preprocessText(text));
        const textIdsLengths = processedTexts.map(text => text.length);
        const maxLen = Math.max(...textIdsLengths);

        const textIds = processedTexts.map(text => {
            const row = new Array(maxLen).fill(0);
            for (let j = 0; j < text.length; j++) {
                const codePoint = text.codePointAt(j);
                row[j] = (codePoint !== undefined && codePoint < this.indexer.length) ? this.indexer[codePoint] : -1;
            }
            return row;
        });

        const textMask = this.getTextMask(textIdsLengths);
        return { textIds, textMask };
    }

    preprocessText(text: string) {
        return text.normalize('NFKD').trim() + '.'; // Simple normalization
    }

    getTextMask(textIdsLengths: number[]) {
        const maxLen = Math.max(...textIdsLengths);
        return textIdsLengths.map(len => {
            const row = new Array(maxLen).fill(0.0);
            for (let j = 0; j < Math.min(len, maxLen); j++) {
                row[j] = 1.0;
            }
            return [row];
        });
    }
}

interface Models {
    dp?: ort.InferenceSession;
    textEnc?: ort.InferenceSession;
    vecEst?: ort.InferenceSession;
    vocoder?: ort.InferenceSession;
}

interface TTSConfig {
    ae: {
        sample_rate: number;
        base_chunk_size: number;
    };
    ttl: {
        latent_dim: number;
        chunk_compress_factor: number;
    };
}

export class SupertonicService {
    private static instance: SupertonicService;
    private isReady = false;
    private models: Models = {};
    private textProcessor: UnicodeProcessor | null = null;
    private cfgs: TTSConfig | null = null;
    private currentStyle: Style | null = null;

    private constructor() { }

    public static getInstance(): SupertonicService {
        if (!SupertonicService.instance) {
            SupertonicService.instance = new SupertonicService();
        }
        return SupertonicService.instance;
    }

    async init() {
        if (this.isReady) return;

        try {
            console.log("Supertonic: Loading Config...");
            // Assuming files are served from /assets/onnx in public folder
            const cfgRes = await fetch(`${MODELS_PATH}/tts.json`);
            if (!cfgRes.ok) {
                throw new Error(`Failed to load tts.json: ${cfgRes.status} ${cfgRes.statusText}. Please ensure assets are in public/assets/onnx/`);
            }
            this.cfgs = await cfgRes.json();

            const idxRes = await fetch(`${MODELS_PATH}/unicode_indexer.json`);
            if (!idxRes.ok) {
                throw new Error(`Failed to load unicode_indexer.json: ${idxRes.status} ${idxRes.statusText}`);
            }
            const indexer = await idxRes.json();
            this.textProcessor = new UnicodeProcessor(indexer);

            console.log("Supertonic: Loading Models...");
            const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };

            this.models.dp = await ort.InferenceSession.create(`${MODELS_PATH}/duration_predictor.onnx`, opts);
            this.models.textEnc = await ort.InferenceSession.create(`${MODELS_PATH}/text_encoder.onnx`, opts);
            this.models.vecEst = await ort.InferenceSession.create(`${MODELS_PATH}/vector_estimator.onnx`, opts);
            this.models.vocoder = await ort.InferenceSession.create(`${MODELS_PATH}/vocoder.onnx`, opts);

            // Load Default Style (M1 default if available, or placeholder)
            // We need to make sure this file exists.
            // For now, let's assume M1.json is there.
            try {
                await this.loadStyle(`${MODELS_PATH}/voice_styles/M1.json`);
            } catch (e) {
                console.warn("Could not load default style M1.json, please load manually.", e);
            }

            this.isReady = true;
            console.log("Supertonic: Ready");
        } catch (e) {
            console.error("Supertonic Init Failed:", e);
            this.isReady = false;
            // Don't throw - let the app continue without TTS
            return;
        }
    }

    async loadStyle(url: string) {
        const res = await fetch(url);
        const json: StyleData = await res.json();

        const ttlFlat = new Float32Array(json.style_ttl.data.flat(Infinity) as number[]);
        const dpFlat = new Float32Array(json.style_dp.data.flat(Infinity) as number[]);

        // Assume batch size 1
        const ttlTensor = new ort.Tensor('float32', ttlFlat, [1, json.style_ttl.dims[1], json.style_ttl.dims[2]]);
        const dpTensor = new ort.Tensor('float32', dpFlat, [1, json.style_dp.dims[1], json.style_dp.dims[2]]);

        this.currentStyle = new Style(ttlTensor, dpTensor);
    }

    isServiceReady(): boolean {
        return this.isReady;
    }

    async generate(text: string, steps: number = 5, speed: number = 1.0): Promise<Float32Array> {
        if (!this.isReady || !this.currentStyle || !this.textProcessor || !this.cfgs) {
            throw new Error("Supertonic service not ready. Models may not be loaded. Please ensure assets exist in public/assets/onnx/");
        }

        if (!this.models.dp || !this.models.textEnc || !this.models.vecEst || !this.models.vocoder) {
            throw new Error("One or more ONNX models not loaded");
        }

        // 1. Process Text
        const { textIds, textMask } = this.textProcessor.call([text]);
        const bsz = 1;

        const textIdsTensor = new ort.Tensor('int64', new BigInt64Array(textIds.flat().map(BigInt)), [bsz, textIds[0].length]);
        const textMaskTensor = new ort.Tensor('float32', new Float32Array(textMask.flat(2)), [bsz, 1, textMask[0][0].length]);

        // 2. Duration Predictor
        const dpOut = await this.models.dp.run({
            text_ids: textIdsTensor,
            style_dp: this.currentStyle.dp,
            text_mask: textMaskTensor
        });
        const duration = Array.from(dpOut.duration.data as Float32Array).map(d => d / speed);

        // 3. Text Encoder
        const encOut = await this.models.textEnc.run({
            text_ids: textIdsTensor,
            style_ttl: this.currentStyle.ttl,
            text_mask: textMaskTensor
        });
        const textEmb = encOut.text_emb;

        // 4. Latent Sampling (Simplified Box-Muller)
        const sampleRate = this.cfgs.ae.sample_rate;
        const wavLenMax = Math.floor(Math.max(...duration) * sampleRate);
        const chunkSize = this.cfgs.ae.base_chunk_size * this.cfgs.ttl.chunk_compress_factor;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDim = this.cfgs.ttl.latent_dim * this.cfgs.ttl.chunk_compress_factor;

        // Random Latent
        const totalSize = bsz * latentDim * latentLen;
        const noise = new Float32Array(totalSize);
        for (let i = 0; i < totalSize; i++) noise[i] = (Math.random() * 2 - 1); // Simple noise

        let xtTensor: ort.Tensor = new ort.Tensor('float32', noise, [bsz, latentDim, latentLen]);

        // Masks
        const latentMaskVals = new Float32Array(bsz * 1 * latentLen).fill(1.0); // Simplified mask
        const latentMaskTensor = new ort.Tensor('float32', latentMaskVals, [bsz, 1, latentLen]);

        // 5. Diffusion Loop
        const totalStepTensor = new ort.Tensor('float32', new Float32Array([steps]), [bsz]);

        for (let s = 0; s < steps; s++) {
            const currentStepTensor = new ort.Tensor('float32', new Float32Array([s]), [bsz]);
            const vecOut = await this.models.vecEst.run({
                noisy_latent: xtTensor,
                text_emb: textEmb,
                style_ttl: this.currentStyle.ttl,
                latent_mask: latentMaskTensor,
                text_mask: textMaskTensor,
                current_step: currentStepTensor,
                total_step: totalStepTensor
            });
            // Update xtTensor with denoised output for next iteration
            xtTensor = vecOut.denoised_latent as ort.Tensor;
        }

        // 6. Vocoder
        const vocOut = await this.models.vocoder.run({ latent: xtTensor });
        return vocOut.wav_tts.data as Float32Array;
    }
    // NEW: Update style from raw arrays (from VoiceDesigner)
    getStyle(): Style | null {
        return this.currentStyle;
    }

    updateStyleFromRaw(ttlData: Float32Array, dpData: Float32Array, ttlDims: number[], dpDims: number[]) {
        if (!this.isReady) return;

        // Wrap in ONNX Tensors
        const ttlTensor = new ort.Tensor('float32', ttlData, ttlDims);
        const dpTensor = new ort.Tensor('float32', dpData, dpDims);

        this.currentStyle = new Style(ttlTensor, dpTensor);
        console.log("Supertonic: Style Updated from Mixer");
    }
}
