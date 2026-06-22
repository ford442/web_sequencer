import { Style } from './Supertonic';
import { WebGpuBackend } from './WebGpuBackend';

export class VoiceDesigner {
    private currentTtl: Float32Array | null = null;
    private currentDp: Float32Array | null = null;
    private ttlDims = [1, 50, 256];
    private dpDims = [1, 8, 16];
    private originalTtl: Float32Array | null = null;

    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private gpu: WebGpuBackend;

    constructor() {
        this.gpu = new WebGpuBackend();
        this.gpu.init(); // Fire and forget
    }

    setCanvas(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    loadFromStyle(style: Style) {
        this.currentTtl = new Float32Array(style.ttl.data as Float32Array);
        this.currentDp = new Float32Array(style.dp.data as Float32Array);
        this.originalTtl = new Float32Array(this.currentTtl);
        if (this.canvas) this.renderHeatmap();
    }

    getRawData() {
        return {
            ttl: this.currentTtl,
            dp: this.currentDp,
            ttlDims: this.ttlDims,
            dpDims: this.dpDims
        };
    }

    reset() {
        if (this.originalTtl) {
            this.currentTtl = new Float32Array(this.originalTtl);
            this.renderHeatmap();
        }
    }

    renderHeatmap() {
        if (!this.canvas || !this.ctx || !this.currentTtl) return;

        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const data = this.currentTtl;

        this.canvas.width = cols;
        this.canvas.height = rows;

        const imageData = this.ctx.createImageData(cols, rows);
        const buf = imageData.data;

        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const val = (data[idx] - min) / range;

                let red = 0, green = 0, blue = 0;
                if (val < 0.5) {
                    const t = val * 2;
                    green = Math.floor(128 * t);
                    blue = Math.floor(128 + 127 * t);
                } else {
                    const t = (val - 0.5) * 2;
                    red = Math.floor(255 * t);
                    green = Math.floor(128 + 127 * t);
                    blue = Math.floor(255 * (1 - t) * 0.2);
                }

                const pixelIdx = (r * cols + c) * 4;
                buf[pixelIdx] = red;
                buf[pixelIdx + 1] = green;
                buf[pixelIdx + 2] = blue;
                buf[pixelIdx + 3] = 255;
            }
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    // --- Helper for GPU Execution ---
    async _runGpuOp(opName: string, params: Record<string, number> = {}) {
        if (this.gpu.ready && this.currentTtl) {
            console.time(`GPU ${opName}`);
            const result = await this.gpu.runOp(opName, this.currentTtl, this.ttlDims, params);
            if (result) {
                this.currentTtl = result;
            }
            console.timeEnd(`GPU ${opName}`);
        } else {
            console.warn(`WebGPU not ready, running ${opName} on CPU fallback.`);
            // Fallback map
            const map: Record<string, (params?: Record<string, number>) => void> = {
                'sharpen': () => this._cpu_sharpen(params),
                'quantize': () => this._cpu_quantize(params),
                'echo': () => this._cpu_echo(),
                'tremolo': () => this._cpu_tremolo(),
                'jitter': () => this._cpu_jitter(),
                'multiply': () => this._cpu_multiply(params),
                'add': () => this._cpu_add(params)
            };
            if (map[opName]) map[opName]();
        }
        this.renderHeatmap();
    }

    // Run a sequence of GPU ops as a single GPU-resident chain (one readback).
    // Falls back to applying each op via the per-op CPU path if WebGPU is down.
    async _runGpuChain(ops: { name: string; params?: Record<string, number> }[]) {
        if (ops.length === 0) return;
        if (this.gpu.ready && this.currentTtl) {
            console.time(`GPU chain [${ops.map(o => o.name).join('>')}]`);
            const result = await this.gpu.runChain(
                ops.map(o => o.name),
                this.currentTtl,
                this.ttlDims,
                ops.map(o => o.params ?? {}),
            );
            if (result) this.currentTtl = result;
            console.timeEnd(`GPU chain [${ops.map(o => o.name).join('>')}]`);
            if (result) {
                this.renderHeatmap();
                return;
            }
            // result === null → fall through to per-op CPU fallback below.
        }
        for (const op of ops) {
            await this._runGpuOp(op.name, op.params ?? {});
        }
    }

    // --- Operations ---

    async mirrorX() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const newData = new Float32Array(this.currentTtl.length);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                newData[r * cols + c] = this.currentTtl[r * cols + (cols - 1 - c)];
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    async mirrorY() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const newData = new Float32Array(this.currentTtl.length);
        for (let r = 0; r < rows; r++) {
            const startSrc = (rows - 1 - r) * cols;
            const startDst = r * cols;
            for (let c = 0; c < cols; c++) {
                newData[startDst + c] = this.currentTtl[startSrc + c];
            }
        }
        this.currentTtl = newData;
        this.renderHeatmap();
    }

    async invertSign() { await this.multiplyScalar(-1.0); }
    async addScalar(val: number) { await this._runGpuOp('add', { factor: val }); }
    async multiplyScalar(val: number) { await this._runGpuOp('multiply', { factor: val }); }
    async dspSharpen() { await this._runGpuOp('sharpen', { factor: 1.5 }); }
    async dspQuantize() { await this._runGpuOp('quantize', { factor: 5.0 }); }
    async dspEcho() { await this._runGpuOp('echo'); }
    async dspTremolo() { await this._runGpuOp('tremolo'); }
    async dspJitter() { await this._runGpuOp('jitter'); }

    // Composite "mangle" effect — three ops chained GPU-resident (no intermediate
    // readback between sharpen → quantize → tremolo).
    async dspMangle() {
        await this._runGpuChain([
            { name: 'sharpen', params: { factor: 1.5 } },
            { name: 'quantize', params: { factor: 5.0 } },
            { name: 'tremolo' },
        ]);
    }

    async randomShift() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const shiftR = Math.floor(Math.random() * rows);
        const shiftC = Math.floor(Math.random() * cols);
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

    // --- CPU Fallbacks ---
    _cpu_add(params: Record<string, number>) { if (this.currentTtl) for (let i = 0; i < this.currentTtl.length; i++) this.currentTtl[i] += params.factor; }
    _cpu_multiply(params: Record<string, number>) { if (this.currentTtl) for (let i = 0; i < this.currentTtl.length; i++) this.currentTtl[i] *= params.factor; }

    _cpu_sharpen(params: Record<string, number>) {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const factor = params.factor || 1.5;
        const newData = new Float32Array(this.currentTtl);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const prev = (c > 0) ? this.currentTtl[r * cols + c - 1] : this.currentTtl[r * cols + c];
                const next = (c < cols - 1) ? this.currentTtl[r * cols + c + 1] : this.currentTtl[r * cols + c];
                const grad = (next - prev) / 2.0;
                newData[r * cols + c] += grad * factor;
            }
        }
        this.currentTtl = newData;
    }

    _cpu_quantize(params: Record<string, number>) {
        if (!this.currentTtl) return;
        const factor = params.factor || 5.0;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] = Math.round(this.currentTtl[i] * factor) / factor;
        }
    }

    _cpu_echo() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const newData = new Float32Array(this.currentTtl);
        const shift = 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                let srcC = (c - shift);
                if (srcC < 0) srcC += cols;
                newData[r * cols + c] += this.currentTtl[r * cols + srcC] * 0.5;
            }
        }
        this.currentTtl = newData;
    }

    _cpu_tremolo() {
        if (!this.currentTtl) return;
        const rows = this.ttlDims[1];
        const cols = this.ttlDims[2];
        const envelope = new Float32Array(cols);
        for (let c = 0; c < cols; c++) {
            const t = (c / (cols - 1)) * 2 * Math.PI;
            envelope[c] = 1.0 + 0.5 * Math.sin(t);
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.currentTtl[r * cols + c] *= envelope[c];
            }
        }
    }

    _cpu_jitter() {
        if (!this.currentTtl) return;
        for (let i = 0; i < this.currentTtl.length; i++) {
            this.currentTtl[i] *= (0.8 + Math.random() * 0.4);
        }
    }
}
