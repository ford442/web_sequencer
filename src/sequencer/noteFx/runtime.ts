/**
 * Live side of the note FX chain: the step handler asks for one track's
 * events once per step; this caches the chain's output per loop pass,
 * bucketed by step, so a step costs one array lookup. The cache is keyed on
 * identity (steps array, chain object, automation lanes array) — every edit
 * replaces those, so an edit is heard on the next step.
 */
import type { Note } from '@/types';
import { automationStore } from '@/stores/automationStore';
import { noteFxStore } from '@/stores/noteFxStore';
import { trackLoopLength, type SongMeter } from '@/utils/songMeter';
import { bucketByStep, renderNoteFx } from './chain';
import { noteFxAutomationTarget, type NoteFxParamLookup } from './params';
import type { FxNoteEvent, NoteFxChain, NoteFxTrack } from './types';

interface Entry {
    steps: readonly (Note | null)[];
    chain: NoteFxChain;
    loopLength: number;
    iteration: number;
    lanes: unknown;
    buckets: FxNoteEvent[][];
}

const cache = new Map<string, Entry>();

export interface LiveNoteFxRequest {
    /** Cache slot: the track key, or `sampler:<bank>`. */
    key: string;
    steps: readonly (Note | null)[];
    chain: NoteFxChain;
    loopLength: number;
    /** `floor(absStep / loopLength)` — seeds the pass like an offline render of pass N. */
    iteration: number;
    salt: number;
    lookup?: NoteFxParamLookup;
    /** Identity of the automation lanes the lookup reads (cache key). */
    lanes: unknown;
}

/** The pass's events, bucketed by the step that schedules them. */
export function liveNoteFxBuckets(r: LiveNoteFxRequest): FxNoteEvent[][] {
    const hit = cache.get(r.key);
    if (
        hit &&
        hit.steps === r.steps &&
        hit.chain === r.chain &&
        hit.loopLength === r.loopLength &&
        hit.iteration === r.iteration &&
        hit.lanes === r.lanes
    ) {
        return hit.buckets;
    }
    const events = renderNoteFx(r.steps, r.chain, {
        loopLength: r.loopLength,
        iteration: r.iteration,
        salt: r.salt,
        lookup: r.lookup,
    });
    const buckets = bucketByStep(events, r.loopLength);
    cache.set(r.key, { steps: r.steps, chain: r.chain, loopLength: r.loopLength, iteration: r.iteration, lanes: r.lanes, buckets });
    return buckets;
}

/** @internal tests */
export function clearLiveNoteFxCache(): void {
    cache.clear();
}

const NO_EVENTS: FxNoteEvent[] = [];

/** Chain-parameter automation of `track`, read from the live automation lanes. */
export function noteFxLaneLookup(track: NoteFxTrack): NoteFxParamLookup {
    const target = noteFxAutomationTarget(track);
    return (param, step) => laneValue(target, param, step);
}

function laneValue(target: ReturnType<typeof noteFxAutomationTarget>, parameter: string, step: number): number | undefined {
    const lanes = automationStore.getLanesForParam(target, parameter);
    for (let i = 0; i < lanes.length; i++) {
        if (!lanes[i].enabled) continue;
        const v = automationStore.getValueAtStep(lanes[i], step);
        if (v !== null) return v;
    }
    return undefined;
}

/**
 * The step handler's entry point: the FX events `track` schedules on this
 * tick, or null when the track has no active chain (play the step as is).
 * `tStep` is the step the track reads (-1 = resting), `absStep` the steps
 * since PLAY (seeds the loop pass).
 */
export function noteFxEventsForStep(r: {
    track: NoteFxTrack;
    cacheKey: string;
    steps: readonly (Note | null)[];
    tStep: number;
    absStep: number;
    meter: Pick<SongMeter, 'stepCount' | 'trackLengths'>;
    salt: number;
}): FxNoteEvent[] | null {
    const chain = noteFxStore.getActiveChain(r.track);
    if (!chain) return null;
    if (r.tStep < 0) return NO_EVENTS;
    const loopLength = Math.max(1, trackLoopLength(r.meter, r.track));
    const buckets = liveNoteFxBuckets({
        key: r.cacheKey,
        steps: r.steps,
        chain,
        loopLength,
        iteration: Math.floor(r.absStep / loopLength),
        salt: r.salt,
        lanes: automationStore.getState().lanes,
        lookup: noteFxLaneLookup(r.track),
    });
    return buckets[r.tStep] ?? NO_EVENTS;
}
