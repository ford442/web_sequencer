/**
 * Shapes shared by the take recorder (main thread), the take writer worker
 * and the recorder worklet (#1498 P1).
 *
 *   OPFS  takes/<id>.wav    the audio (`wavTakeFile.ts`)
 *         takes/<id>.json   its `TakeMeta`; `state: 'recording'` on disk after
 *                           a reload means the tab died mid-take
 *
 * The worklet's own messages live in `src/shared/rt/takeRing.ts` (worklet code
 * sees no DOM types).
 */

export const TAKES_DIR = 'takes';

export const TAKE_ID_PATTERN = /^take-[0-9a-z-]{6,64}$/;

export type TakeState = 'recording' | 'complete' | 'recovered';
export type TakePurpose = 'take' | 'sampler';

export interface TakeMeta {
    version: 1;
    id: string;
    state: TakeState;
    purpose: TakePurpose;
    sampleRate: number;
    channels: number;
    /** Context frame of the first sample, in the AudioContext that recorded it (null until known). */
    startFrame: number | null;
    /** Frames in the file (for a take still recording: as of the last meta write). */
    frames: number;
    /** Frames the ring dropped, written as silence so the take keeps its timing. */
    droppedFrames: number;
    /** The input device's label, as the browser reported it. */
    inputLabel: string;
    /** `Date.now()` when the take began. */
    createdAt: number;
}

export function takeWavName(id: string): string {
    return `${id}.wav`;
}

export function takeMetaName(id: string): string {
    return `${id}.json`;
}

export function newTakeId(now = Date.now()): string {
    const rand = Math.floor(Math.random() * 0x7fffffff).toString(36);
    return `take-${now.toString(36)}-${rand}`;
}

/** A meta file's contents, or null when it is not one this build wrote. */
export function parseTakeMeta(text: string): TakeMeta | null {
    try {
        const m = JSON.parse(text) as Partial<TakeMeta>;
        if (
            m && m.version === 1
            && typeof m.id === 'string' && TAKE_ID_PATTERN.test(m.id)
            && (m.state === 'recording' || m.state === 'complete' || m.state === 'recovered')
            && (m.purpose === 'take' || m.purpose === 'sampler')
            && typeof m.sampleRate === 'number' && m.sampleRate > 0
            && (m.channels === 1 || m.channels === 2)
            && typeof m.frames === 'number' && typeof m.droppedFrames === 'number'
            && typeof m.createdAt === 'number'
        ) {
            return {
                version: 1,
                id: m.id,
                state: m.state,
                purpose: m.purpose,
                sampleRate: m.sampleRate,
                channels: m.channels,
                startFrame: typeof m.startFrame === 'number' ? m.startFrame : null,
                frames: m.frames,
                droppedFrames: m.droppedFrames,
                inputLabel: typeof m.inputLabel === 'string' ? m.inputLabel : '',
                createdAt: m.createdAt,
            };
        }
    } catch {
        /* not JSON */
    }
    return null;
}

// ── main thread → take writer worker ────────────────────────────────────────

export type TakeWorkerRequest =
    | { t: 'begin'; rid: number; meta: TakeMeta; ring: SharedArrayBuffer | null; port: MessagePort | null }
    | { t: 'finish'; rid: number; id: string }
    | { t: 'abort'; rid: number; id: string }
    | { t: 'scan'; rid: number }
    | { t: 'recover'; rid: number; id: string }
    | { t: 'discard'; rid: number; id: string };

export type TakeWorkerReply =
    | { t: 'reply'; rid: number; ok: true; meta?: TakeMeta; takes?: TakeMeta[] }
    | { t: 'reply'; rid: number; ok: false; error: string; unsupported?: boolean }
    | { t: 'progress'; id: string; frames: number; dropped: number };
