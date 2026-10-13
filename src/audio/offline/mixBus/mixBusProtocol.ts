/**
 * Message protocol between the main-thread mix bus client (mixBus.ts) and
 * src/workers/mixBus.worker.ts, plus the worker's session logic as a pure
 * function so it can be exercised without a Worker.
 */
import type { MixKernel } from './mixBusKernel';

export type MixBusRequest =
    | { type: 'init'; wasmUrl: string }
    | { type: 'begin'; session: number; frames: number; channelCount: number }
    /** `channels` are copies transferred to the worker; mono is widened there. */
    | { type: 'add'; session: number; channels: Float32Array[]; gain: number }
    | { type: 'finish'; session: number }
    | { type: 'discard'; session: number };

export type MixBusResponse =
    | { type: 'ready'; kernel: MixKernel['kind'] }
    | { type: 'init-failed'; message: string }
    | { type: 'done'; session: number; channels: Float32Array[]; peaks: number[] }
    | { type: 'error'; session: number | null; message: string };

export type SessionRequest = Exclude<MixBusRequest, { type: 'init' }>;

type Post = (message: MixBusResponse, transfer: Transferable[]) => void;

/**
 * The worker's session table. One accumulator per open session, in the
 * worker's JS heap — the wasm module only ever sees one block at a time.
 */
export function createMixBusSessionHandler(kernel: MixKernel, post: Post) {
    const sessions = new Map<number, Float32Array[]>();

    return function handle(message: SessionRequest): void {
        try {
            switch (message.type) {
                case 'begin': {
                    const frames = Math.max(0, Math.floor(message.frames));
                    const count = Math.max(1, Math.floor(message.channelCount));
                    sessions.set(
                        message.session,
                        Array.from({ length: count }, () => new Float32Array(frames)),
                    );
                    return;
                }
                case 'add': {
                    const acc = sessions.get(message.session);
                    if (!acc) throw new Error(`add to unknown mix session ${message.session}`);
                    if (message.channels.length === 0) return;
                    for (let ch = 0; ch < acc.length; ch++) {
                        // Mono (or narrower) sources feed every output channel, as
                        // the pre-#1341 stemExport loop did.
                        const src = message.channels[Math.min(ch, message.channels.length - 1)];
                        kernel.accumulate(acc[ch], src, message.gain);
                    }
                    return;
                }
                case 'finish': {
                    const acc = sessions.get(message.session);
                    if (!acc) throw new Error(`finish of unknown mix session ${message.session}`);
                    sessions.delete(message.session);
                    const peaks = acc.map((channel) => kernel.peak(channel));
                    post(
                        { type: 'done', session: message.session, channels: acc, peaks },
                        acc.map((channel) => channel.buffer),
                    );
                    return;
                }
                case 'discard':
                    sessions.delete(message.session);
                    return;
            }
        } catch (error) {
            post(
                {
                    type: 'error',
                    session: message.session,
                    message: error instanceof Error ? error.message : String(error),
                },
                [],
            );
        }
    };
}
