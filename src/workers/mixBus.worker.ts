/// <reference lib="webworker" />
/**
 * Offline mix bus worker (#1341). Hosts public/mix_bus.wasm off the main
 * thread for stem export. The module is fixed-size and has no imports, so
 * nothing here can touch a SharedArrayBuffer or the live voice heap.
 *
 * Loaded via `?worker&url` from src/audio/offline/mixBus/mixBus.ts, which
 * also resolves the wasm URL against the deploy base before sending `init` —
 * a relative URL resolved here would land under assets/.
 */
import { createNativeMixKernel } from '@/audio/offline/mixBus/mixBusKernel';
import {
    createMixBusSessionHandler,
    type MixBusRequest,
    type MixBusResponse,
    type SessionRequest,
} from '@/audio/offline/mixBus/mixBusProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: MixBusResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer);
}

let handle: ((message: SessionRequest) => void) | null = null;

async function init(wasmUrl: string): Promise<void> {
    try {
        const response = await fetch(wasmUrl);
        if (!response.ok) throw new Error(`fetch ${wasmUrl} → HTTP ${response.status}`);
        const kernel = await createNativeMixKernel(await response.arrayBuffer());
        handle = createMixBusSessionHandler(kernel, post);
        post({ type: 'ready', kernel: kernel.kind });
    } catch (error) {
        post({ type: 'init-failed', message: error instanceof Error ? error.message : String(error) });
    }
}

scope.onmessage = (event: MessageEvent<MixBusRequest>) => {
    const message = event.data;
    if (message.type === 'init') {
        void init(message.wasmUrl);
        return;
    }
    if (!handle) {
        post({ type: 'error', session: message.session, message: 'mix bus worker is not initialised' });
        return;
    }
    handle(message);
};
