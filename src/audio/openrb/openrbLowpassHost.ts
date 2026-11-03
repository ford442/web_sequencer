/**
 * Main-thread host for the patch bay's openrb low-pass mode.
 *
 * openrb338.wasm is GPL-3.0-only and opt-in: no published build bundles it
 * (docs/audio-engine/openrb338-voice.md, licence decision). So this host loads
 * it only when the build names a URL for it (`VITE_OPENRB338_WASM_URL`), e.g. a
 * private build that serves `openrb338/pkg/openrb338.wasm`. Without one — the
 * default — `createOpenrbLowpassProvider` resolves to `null`, the compiler
 * keeps every low-pass node on its RBJ biquad, and the patch bay says why.
 *
 * With the module, each modal low-pass node gets an `openrb-lowpass-processor`
 * worklet node; the compiled `WebAssembly.Module` is posted to it (compiled
 * once per page, instantiated per node).
 */

import processorUrl from '../../audio-worklets/openrb-lowpass-processor.ts?worker&url';
import {
    OPENRB_LP_MAX_CHANNELS,
    OPENRB_LP_REQUIRED_EXPORTS,
    OPENRB_LOWPASS_PROCESSOR,
    type OpenrbLowpassInMessage,
    type OpenrbLowpassOutMessage,
    type OpenrbLowpassProcessorOptions,
} from '../../audio-worklets/openrbLowpass';
import type { OpenrbLowpassBranch, OpenrbLowpassProvider } from '../graph/lowpassMode';

/** The opt-in module URL, or `null` (the default) when the build names none. */
export function openrbModuleUrl(): string | null {
    const url = import.meta.env.VITE_OPENRB338_WASM_URL;
    return typeof url === 'string' && url.trim().length > 0 ? url.trim() : null;
}

let cached: { url: string; module: Promise<WebAssembly.Module | null> } | null = null;

/**
 * Fetch and compile openrb338.wasm once, checking that it exports the low-pass
 * group. `null` when no URL is configured or anything fails (logged once).
 */
export function loadOpenrbModule(
    url: string | null = openrbModuleUrl(),
    fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<WebAssembly.Module | null> {
    if (!url) return Promise.resolve(null);
    if (cached?.url === url) return cached.module;
    const module = (async () => {
        try {
            const response = await fetchImpl(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const compiled = await WebAssembly.compile(await response.arrayBuffer());
            const names = new Set(WebAssembly.Module.exports(compiled).map((e) => e.name));
            const missing = OPENRB_LP_REQUIRED_EXPORTS.filter((name) => !names.has(name));
            if (missing.length > 0) throw new Error(`missing exports: ${missing.join(', ')}`);
            return compiled;
        } catch (error) {
            console.warn(`[openrbLowpass] ${url} unavailable; openrb low-pass plays RBJ:`, error);
            return null;
        }
    })();
    cached = { url, module };
    return module;
}

/** Test hook: forget the compiled module. */
export function resetOpenrbModuleCache(): void {
    cached = null;
}

/** One worklet branch, steered by messages. */
function createBranch(
    context: BaseAudioContext,
    module: WebAssembly.Module,
    init: OpenrbLowpassProcessorOptions,
): OpenrbLowpassBranch {
    const node = new AudioWorkletNode(context, OPENRB_LOWPASS_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [OPENRB_LP_MAX_CHANNELS],
        channelCount: OPENRB_LP_MAX_CHANNELS,
        channelCountMode: 'explicit',
        processorOptions: init,
    });
    let bitExact: boolean | null = null;
    let unavailable: ((reason: string) => void) | null = null;
    let failure: string | null = null;
    node.port.onmessage = (event: MessageEvent<OpenrbLowpassOutMessage>) => {
        const message = event.data;
        if (message?.type === 'ready') {
            bitExact = message.bitExact;
        } else if (message?.type === 'unavailable') {
            failure = message.reason;
            unavailable?.(message.reason);
        }
    };
    const send = (message: OpenrbLowpassInMessage) => node.port.postMessage(message);
    send({ type: 'module', module });
    return {
        node,
        set: (params) => send({ type: 'set', cutoffHz: params.cutoffHz, q: params.q }),
        onUnavailable: (listener) => {
            unavailable = listener;
            if (failure !== null) listener(failure);
        },
        bitExact: () => bitExact,
        dispose: () => {
            node.port.onmessage = null;
            node.disconnect();
        },
    };
}

/**
 * Register the processor on `context` and return the compiler's
 * `createOpenrbLowpass` provider, or `null` when openrb is not available (no
 * module URL, a failed fetch, or no AudioWorklet).
 */
export async function createOpenrbLowpassProvider(
    context: BaseAudioContext,
    options: { module?: WebAssembly.Module | null } = {},
): Promise<OpenrbLowpassProvider | null> {
    const module = options.module !== undefined ? options.module : await loadOpenrbModule();
    if (!module || !context.audioWorklet) return null;
    try {
        await context.audioWorklet.addModule(processorUrl);
    } catch (error) {
        console.warn('[openrbLowpass] worklet failed to load; openrb low-pass plays RBJ:', error);
        return null;
    }
    return (ctx, request) => {
        try {
            return createBranch(ctx, module, { cutoffHz: request.frequency, q: request.Q });
        } catch (error) {
            console.warn(`[openrbLowpass] ${request.nodeId}: branch failed; plays RBJ:`, error);
            return null;
        }
    };
}
