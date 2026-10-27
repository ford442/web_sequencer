// ONNX Runtime is loaded through the shared `ortRuntime` helper, which owns the
// dynamic import (so ORT never lands in the entry chunk) and is the single
// writer of `ort.env` — see src/services/ortRuntime.ts.
import type * as ort from 'onnxruntime-web';
import { loadOrt, type Ort } from './ortRuntime';
import { fetchPublicArrayBuffer, fetchPublicJson, isMissingPublicAsset } from '../utils/publicAsset';
import { resolvePublicAsset } from '../utils/engineTelemetry';

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
    private ortMod: Ort | null = null;
    private models: Models = {};
    private textProcessor: UnicodeProcessor | null = null;
    private cfgs: TTSConfig | null = null;
    private currentStyle: Style | null = null;
    private preloadManifest: boolean[] = new Array(8).fill(false);
    private isPreloading = false;
    private lastTokenDurations: number[] | null = null;
    private unavailableReason: string | null = null;

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
            const ort = await loadOrt();
            this.ortMod = ort;

            console.log("Supertonic: Loading Config...");

            // The model files are downloaded separately (download_models.sh) and
            // gitignored. fetchPublicJson / fetchPublicArrayBuffer turn a missing
            // file — including the SPA answering with index.html — into a
            // MissingPublicAssetError, so a clean checkout is "TTS off", not a
            // JSON parse error.
            this.cfgs = await fetchPublicJson<TTSConfig>('assets/onnx/tts.json');
            const indexer = await fetchPublicJson<number[]>('assets/onnx/unicode_indexer.json');
            this.textProcessor = new UnicodeProcessor(indexer);

            console.log("Supertonic: Loading Models with WebGPU...");

            // OPTIMIZATION 2: WebGPU Execution Provider
            // We attempt 'webgpu' first. If the browser doesn't support it,
            // ORT falls back to 'wasm' automatically.
            // annotations are removed because the type is not exported by ort
            const sessionOptions: any = {
                executionProviders: [{ name: 'webgpu' }, { name: 'wasm' }],
                graphOptimizationLevel: 'all'
            };

            // Fetch the bytes ourselves so a missing model is detected before
            // ORT tries to parse an HTML page as protobuf. Parallel is faster.
            // ORT accepts the model bytes; the bundled type defs only declare the URL overload.
            const createFromBytes = ort.InferenceSession.create as unknown as
                (model: Uint8Array, options: unknown) => Promise<ort.InferenceSession>;
            const load = async (file: string) => createFromBytes(
                new Uint8Array(await fetchPublicArrayBuffer(`assets/onnx/${file}`)),
                sessionOptions,
            );
            const [dp, textEnc, vecEst, vocoder] = await Promise.all([
                load('duration_predictor.onnx'),
                load('text_encoder.onnx'),
                load('vector_estimator.onnx'),
                load('vocoder.onnx'),
            ]);

            this.models.dp = dp;
            this.models.textEnc = textEnc;
            this.models.vecEst = vecEst;
            this.models.vocoder = vocoder;

            // Load Default Style
            try {
                await this.loadStyle(resolvePublicAsset('assets/voice_styles/F1.json'));
                console.log('✓ Loaded default voice style: F1');
            } catch (e) {
                console.warn('Could not load default style F1.json', e);
            }

            this.isReady = true;
            this.unavailableReason = null;
            console.log("Supertonic: Ready (WebGPU Enabled)");
        } catch (e) {
            this.isReady = false;
            if (isMissingPublicAsset(e)) {
                this.unavailableReason = `${e.message}; run download_models.sh`;
                console.info(`Supertonic: TTS off — ${this.unavailableReason}`);
            } else {
                this.unavailableReason = e instanceof Error ? e.message : String(e);
                console.error("❌ Supertonic Init Failed:", e);
            }
        }
    }

    /** Why TTS is off after `init()`, or null while it is ready (or not tried yet). */
    getUnavailableReason(): string | null {
        return this.isReady ? null : this.unavailableReason;
    }

    async loadStyle(url: string) {
        const ort = this.ortMod ?? await loadOrt();
        this.ortMod = ort;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load style ${url}: HTTP ${res.status}`);
        const text = await res.text();
        if (text.trimStart().startsWith('<')) throw new Error(`Style ${url} not found (HTML page)`);
        const json = JSON.parse(text) as StyleData;

        const ttlFlat = new Float32Array(json.style_ttl.data.flat(Infinity) as number[]);
        const dpFlat = new Float32Array(json.style_dp.data.flat(Infinity) as number[]);

        const ttlTensor = new ort.Tensor('float32', ttlFlat, [1, json.style_ttl.dims[1], json.style_ttl.dims[2]]);
        const dpTensor = new ort.Tensor('float32', dpFlat, [1, json.style_dp.dims[1], json.style_dp.dims[2]]);

        this.currentStyle = new Style(ttlTensor, dpTensor);
    }

    isServiceReady(): boolean {
        return this.isReady;
    }

    /**
     * Warms up the ONNX session with a dummy inference to avoid cold-start lag during initial playback.
     */
    async preload(): Promise<void> {
        if (!this.isReady || this.isPreloading) return;
        this.isPreloading = true;
        try {
            if (import.meta.env.DEV) { console.log("Supertonic: Warming ONNX session with dummy inference..."); }
            // Minimal dummy inference to warm GPU kernels for all banks
            await this.generate("a", 1, 1.0);
            this.preloadManifest.fill(true);
            if (import.meta.env.DEV) { console.log("Supertonic: ONNX session warmed."); }
        } catch (e) {
            if (import.meta.env.DEV) { console.warn("Supertonic: Preload dummy inference failed (non-critical):", e); }
        } finally {
            this.isPreloading = false;
        }
    }

    /**
     * Devtool helper: Releases all InferenceSessions and resets service readiness to test cache misses.
     * @example
     * // Dev mode only
     * window.__devtools.purgeTTSCache()
     */
    purgeCache(): void {
        if (import.meta.env.DEV) { console.log("Supertonic: Purging ONNX session cache..."); }
        (Object.keys(this.models) as (keyof Models)[]).forEach((key) => {
            const session = this.models[key];
            if (session && typeof session.release === 'function') {
                try {
                    session.release();
                } catch (e) {
                    console.warn(`Supertonic: Failed to release ${key}:`, e);
                }
            }
        });
        this.models = {};
        this.isReady = false;
        this.preloadManifest.fill(false);
        if (import.meta.env.DEV) { console.log("Supertonic: ONNX cache purged. isReady=false"); }
    }

    /**
     * Returns an array mapping which TTS banks are currently warmed up in the ONNX cache.
     */
    getPreloadManifest(): boolean[] {
        return [...this.preloadManifest];
    }

    async generate(text: string, steps: number = 5, speed: number = 1.0): Promise<Float32Array> {
        if (!this.isReady || !this.currentStyle || !this.textProcessor || !this.cfgs) {
            throw new Error("Supertonic service not ready.");
        }

        if (!this.models.dp || !this.models.textEnc || !this.models.vecEst || !this.models.vocoder) {
            throw new Error("Models not loaded");
        }

        const ort = this.ortMod;
        if (!ort) {
            throw new Error("Supertonic service not ready.");
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
        this.lastTokenDurations = duration;

        // OPTIMIZATION 3: Dispose Tensors
        // Running on GPU consumes VRAM. We must explicitly dispose intermediate tensors.
        // However, JS GC usually handles Tensor objects, but in tight loops with WebGPU backends,
        // it's safer to let them go if they hold large GPU buffers.
        // Note: ORT-Web handles most cleanup, but keep an eye on memory if looping heavily.

        // 3. Text Encoder
        const encOut = await this.models.textEnc.run({
            text_ids: textIdsTensor,
            style_ttl: this.currentStyle.ttl,
            text_mask: textMaskTensor
        });
        const textEmb = encOut.text_emb;

        // 4. Latent Sampling
        const sampleRate = this.cfgs.ae.sample_rate;
        const wavLenMax = Math.floor(Math.max(...duration) * sampleRate);
        const chunkSize = this.cfgs.ae.base_chunk_size * this.cfgs.ttl.chunk_compress_factor;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDim = this.cfgs.ttl.latent_dim * this.cfgs.ttl.chunk_compress_factor;

        const totalSize = bsz * latentDim * latentLen;
        const noise = new Float32Array(totalSize);
        for (let i = 0; i < totalSize; i++) noise[i] = (Math.random() * 2 - 1);

        let xtTensor: ort.Tensor = new ort.Tensor('float32', noise, [bsz, latentDim, latentLen]);

        const latentMaskVals = new Float32Array(bsz * 1 * latentLen).fill(1.0);
        const latentMaskTensor = new ort.Tensor('float32', latentMaskVals, [bsz, 1, latentLen]);

        // 5. Diffusion Loop
        // This is the heavy part. WebGPU shines here.
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

            // Swap and Cleanup
            // If we are strictly checking memory, we might want to verify if dispose() is needed
            // depending on exact ORT version, but JS GC is usually enough for object references.
            xtTensor = vecOut.denoised_latent as ort.Tensor;
        }

        // 6. Vocoder
        const vocOut = await this.models.vocoder.run({ latent: xtTensor });

        // Return raw data
        return vocOut.wav_tts.data as Float32Array;
    }

    getLastTokenDurations(): number[] | null {
        return this.lastTokenDurations ? [...this.lastTokenDurations] : null;
    }

    getOutputSampleRate(): number {
        return this.cfgs?.ae.sample_rate ?? 44100;
    }

    getStyle(): Style | null {
        return this.currentStyle;
    }

    updateStyleFromRaw(ttlData: Float32Array, dpData: Float32Array, ttlDims: number[], dpDims: number[]) {
        if (!this.isReady || !this.ortMod) return;
        const ort = this.ortMod;

        const ttlTensor = new ort.Tensor('float32', ttlData, ttlDims);
        const dpTensor = new ort.Tensor('float32', dpData, dpDims);

        this.currentStyle = new Style(ttlTensor, dpTensor);
        console.log("Supertonic: Style Updated from Mixer");
    }
}
