export class WasmOscillator {
    private instance: WebAssembly.Instance | null = null;
    private memory: WebAssembly.Memory | null = null;
    isReady: boolean = false;

    async init() {
        try {
            const response = await fetch('/oscillators.wasm');
            const bytes = await response.arrayBuffer();
            const memory = new WebAssembly.Memory({ initial: 100 });
            const module = await WebAssembly.instantiate(bytes, { env: { memory } });
            this.instance = module.instance;
            this.memory = memory;
            this.isReady = true;
            console.log("Wasm Engine Ready");
        } catch (e) { console.error("Wasm Init Failed", e); }
    }

    generate(freq: number, dur: number, rate: number, type: 'saw'|'sqr'|'tri'|'sin'): Float32Array | null {
        if (!this.isReady || !this.instance) return null;
        const exports = this.instance.exports as any;
        const typeMap = { saw: 0, sqr: 1, tri: 2, sin: 3 };
        const numSamples = exports.generate(0, rate, freq, dur, typeMap[type]);
        return new Float32Array(this.memory!.buffer, 0, numSamples); // Returns view of memory
    }
}
