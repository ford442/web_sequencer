import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    OFFLINE_DRUMKIT_BLOCK,
    renderDrumkitOffline,
    type OfflineDrumkitApi,
    type OfflineDrumHit,
} from '../OfflineDrumKitEngine';
import { DrumkitEvent, VoiceEvent } from '../../../shared/rt/hyphonNativeExports';
import { DRUMKIT_VOICE, drumTriggerArgs } from '../../../engines/DrumKitCharacter';
import { DEFAULT_CLOSED_HAT_PARAMS, DEFAULT_KICK_PARAMS, DEFAULT_SNARE_PARAMS } from '../../../constants';

type Event = { frame: number; type: number; target: number; value: number; args: number[] };

/** Byte offset of the fake render buffer (0 is the API's error value). */
const PTR = 64;

/** A fake drum API: records events and init, renders frame-index ramps. */
function fakeApi() {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const events: Event[] = [];
    const renders: Array<[number, number]> = [];
    const init = vi.fn(() => 1);
    const destroy = vi.fn();
    const api: OfflineDrumkitApi = {
        memory,
        drumkit_create: () => 5,
        drumkit_destroy: destroy,
        drumkit_init: init,
        drumkit_push_event: (_h, frame, type, target, value, a0, a1, a2, a3) => {
            events.push({ frame, type, target, value, args: [a0, a1, a2, a3] });
            return 1;
        },
        drumkit_render: (_h, start, n) => {
            renders.push([start, n]);
            const heap = new Float32Array(memory.buffer);
            const base = PTR / 4;
            for (let i = 0; i < n; i++) {
                heap[base + i] = start + i;
                heap[base + OFFLINE_DRUMKIT_BLOCK + i] = -(start + i);
            }
            return PTR;
        },
    };
    return { api, events, renders, init, destroy };
}

const hit = (over: Partial<OfflineDrumHit> = {}): OfflineDrumHit => ({
    sound: 'kick',
    params: { ...DEFAULT_KICK_PARAMS },
    startSeconds: 0,
    ...over,
});

describe('renderDrumkitOffline', () => {
    let fake: ReturnType<typeof fakeApi>;
    beforeEach(() => {
        fake = fakeApi();
    });

    it('plays a hit the way the live engine writes it: kit, then pan and trigger on one frame', () => {
        const kick = { ...DEFAULT_KICK_PARAMS };
        renderDrumkitOffline(fake.api, { kit: '909', hits: [hit({ params: kick, pan: -0.5 })], durationSeconds: 0.01, sampleRate: 48_000 });

        const [a, b, c, d] = drumTriggerArgs('kick', kick);
        expect(fake.events).toEqual([
            { frame: 0, type: DrumkitEvent.SetKit, target: 1, value: 0, args: [0, 0, 0, 0] },
            { frame: 0, type: DrumkitEvent.SetPan, target: DRUMKIT_VOICE.kick, value: -0.5, args: [0, 0, 0, 0] },
            { frame: 0, type: VoiceEvent.Trigger, target: DRUMKIT_VOICE.kick, value: 1, args: [a, b, c, d] },
        ]);
        expect(fake.init).toHaveBeenCalledWith(5, 48_000, OFFLINE_DRUMKIT_BLOCK);
        expect(fake.destroy).toHaveBeenCalledWith(5);
    });

    it('uses the sound\'s own pan when the hit has none, and the 808 kit id', () => {
        renderDrumkitOffline(fake.api, {
            kit: '808',
            hits: [hit({ sound: 'snare', params: { ...DEFAULT_SNARE_PARAMS, pan: 0.25 } })],
            durationSeconds: 0.01,
            sampleRate: 48_000,
        });
        expect(fake.events[0]).toMatchObject({ type: DrumkitEvent.SetKit, target: 0 });
        expect(fake.events[1]).toMatchObject({ type: DrumkitEvent.SetPan, target: DRUMKIT_VOICE.snare, value: 0.25 });
    });

    it('puts each hit on its own frame, in time order, and renders in blocks', () => {
        const rate = 48_000;
        const frames = OFFLINE_DRUMKIT_BLOCK * 2 + 100;
        const [left, right] = renderDrumkitOffline(fake.api, {
            kit: '808',
            hits: [
                hit({ sound: 'closedHat', params: { ...DEFAULT_CLOSED_HAT_PARAMS }, startSeconds: 0.05 }),
                hit({ startSeconds: 0 }),
            ],
            durationSeconds: frames / rate,
            sampleRate: rate,
        });

        const triggers = fake.events.filter((e) => e.type === VoiceEvent.Trigger);
        expect(triggers.map((e) => [e.frame, e.target])).toEqual([[0, DRUMKIT_VOICE.kick], [2400, DRUMKIT_VOICE.closedHat]]);
        expect(fake.renders).toEqual([[0, OFFLINE_DRUMKIT_BLOCK], [OFFLINE_DRUMKIT_BLOCK, OFFLINE_DRUMKIT_BLOCK], [OFFLINE_DRUMKIT_BLOCK * 2, 100]]);
        expect(left).toHaveLength(frames);
        expect(left[OFFLINE_DRUMKIT_BLOCK + 7]).toBe(OFFLINE_DRUMKIT_BLOCK + 7);
        expect(right[OFFLINE_DRUMKIT_BLOCK + 7]).toBe(-(OFFLINE_DRUMKIT_BLOCK + 7));
    });

    it('hands the voice back even when a render fails', () => {
        fake.api.drumkit_render = () => 0;
        expect(() => renderDrumkitOffline(fake.api, { kit: '808', hits: [hit()], durationSeconds: 0.01, sampleRate: 48_000 })).toThrow(/drumkit_render/);
        expect(fake.destroy).toHaveBeenCalledWith(5);
    });
});
