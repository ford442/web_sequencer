import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import { arpSequence, bucketByStep, groupSimultaneous, renderNoteFx, renderNoteFxTimeline, stepsToFxEvents } from '../chain';
import { freezeEventsToSteps, freezeNoteFx } from '../freeze';
import { defaultNoteFxChain, chainIsActive, type NoteFxChain } from '../types';
import { normalizeNoteFxChain, resolveChainAtStep } from '../params';

const n = (note: string, extra: Partial<Note> = {}): Note => ({ note, velocity: 1, length: 1, slide: false, ...extra });
const steps16 = (): (Note | null)[] => Array<Note | null>(16).fill(null);

function chain(patch: (c: NoteFxChain) => void): NoteFxChain {
    const c = defaultNoteFxChain(7);
    patch(c);
    return c;
}

const pick = (events: ReturnType<typeof renderNoteFx>) => events.map((e) => [e.start, e.pitch, e.length]);

describe('stepsToFxEvents', () => {
    it('emits root + chord tones with microtiming and stops at the loop end', () => {
        const s = steps16();
        s[1] = n('C4', { chord: ['E4'], microtiming: 0.25, velocity: 0.5 });
        s[12] = n('G4');
        const events = stepsToFxEvents(s, 8, () => 0);
        expect(events.map((e) => [e.start, e.pitch, e.velocity])).toEqual([[1.25, 60, 0.5], [1.25, 64, 0.5]]);
    });
});

describe('modules', () => {
    it('chord stacks intervals and dedupes against existing tones', () => {
        const s = steps16();
        s[0] = n('C4', { chord: ['G4'] });
        const out = renderNoteFx(s, chain((c) => { c.chord = { enabled: true, intervals: [4, 7] }; }), { loopLength: 16 });
        // C4 → +E4 +G4 (G4 already there); G4 → +B4 +D5.
        expect(out.map((e) => e.pitch)).toEqual([60, 64, 67, 71, 74]);
    });

    it('arp plays the held chord across the note length at its rate, gate shortening each note', () => {
        const s = steps16();
        s[0] = n('C4', { chord: ['E4', 'G4'], length: 2 });
        const out = renderNoteFx(s, chain((c) => { c.arp = { enabled: true, mode: 'up', rate: 0.5, octaves: 1, gate: 0.5 }; }), { loopLength: 16 });
        expect(pick(out)).toEqual([[0, 60, 0.25], [0.5, 64, 0.25], [1, 67, 0.25], [1.5, 60, 0.25]]);
    });

    it('arp modes and octaves', () => {
        expect(arpSequence([64, 60, 67], 'up', 1)).toEqual([60, 64, 67]);
        expect(arpSequence([64, 60, 67], 'down', 1)).toEqual([67, 64, 60]);
        expect(arpSequence([60, 64, 67], 'updown', 1)).toEqual([60, 64, 67, 64]);
        expect(arpSequence([64, 60], 'played', 2)).toEqual([64, 60, 76, 72]);
        expect(arpSequence([60, 64], 'up', 2)).toEqual([60, 64, 72, 76]);
    });

    it('ratchet splits each note into decaying repeats', () => {
        const s = steps16();
        s[2] = n('C4', { velocity: 0.8 });
        const out = renderNoteFx(s, chain((c) => { c.ratchet = { enabled: true, count: 4, decay: 0.5, gate: 1 }; }), { loopLength: 16 });
        expect(out.map((e) => [e.start, e.length, e.velocity])).toEqual([[2, 0.25, 0.8], [2.25, 0.25, 0.4], [2.5, 0.25, 0.2], [2.75, 0.25, 0.1]]);
    });

    it('euclid gates note starts by an E(k, n) pattern with rotation', () => {
        const s = Array.from({ length: 8 }, () => n('C4'));
        const gate = (rotation: number) => renderNoteFx(s, chain((c) => { c.euclid = { enabled: true, pulses: 3, steps: 8, rotation }; }), { loopLength: 8 }).map((e) => e.start);
        expect(gate(0)).toEqual([2, 5, 7]);
        expect(gate(1)).toEqual([0, 3, 6]);
    });

    it('humanize is bounded and deterministic per seed and loop pass', () => {
        const s = Array.from({ length: 16 }, () => n('C4', { velocity: 0.5 }));
        const c = chain((x) => { x.humanize = { enabled: true, timing: 0.1, velocity: 0.2 }; });
        const a = renderNoteFx(s, c, { loopLength: 16, iteration: 3 });
        expect(renderNoteFx(s, c, { loopLength: 16, iteration: 3 })).toEqual(a);
        expect(renderNoteFx(s, c, { loopLength: 16, iteration: 4 })).not.toEqual(a);
        for (const e of a) {
            expect(Math.abs(e.start - Math.round(e.start))).toBeLessThanOrEqual(0.1 + 1e-9);
            expect(Math.abs(e.velocity - 0.5)).toBeLessThanOrEqual(0.2 + 1e-9);
        }
    });

    it('rolls per-step probability from the seeded RNG instead of Math.random', () => {
        const s = Array.from({ length: 16 }, () => n('C4', { probability: 0.5 }));
        const c = chain((x) => { x.humanize = { enabled: true, timing: 0, velocity: 0.01 }; });
        const a = renderNoteFx(s, c, { loopLength: 16 }).length;
        expect(renderNoteFx(s, c, { loopLength: 16 }).length).toBe(a);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(16);
    });
});

describe('chain plumbing', () => {
    it('is inactive until a module would change something', () => {
        expect(chainIsActive(defaultNoteFxChain())).toBe(false);
        expect(chainIsActive(chain((c) => { c.ratchet.enabled = true; c.ratchet.count = 1; }))).toBe(false);
        expect(chainIsActive(chain((c) => { c.arp.enabled = true; }))).toBe(true);
    });

    it('automation lanes override parameters per source step', () => {
        const base = chain((c) => { c.arp.enabled = true; });
        const resolved = resolveChainAtStep(base, 4, (param, step) => (param === 'noteFx.arp.rate' && step === 4 ? 0 : undefined));
        expect(resolved.arp.rate).toBe(0.25);
        expect(resolveChainAtStep(base, 5, () => undefined)).toBe(base);
    });

    it('normalizes untrusted song data', () => {
        const c = normalizeNoteFxChain({ arp: { enabled: true, mode: 'sideways', rate: 3, octaves: 9 }, euclid: { steps: 4, pulses: 99, rotation: -3 }, seed: 'x' });
        expect(c.arp).toMatchObject({ enabled: true, mode: 'up', rate: 2, octaves: 4 });
        expect(c.euclid).toMatchObject({ steps: 4, pulses: 4, rotation: 0 });
        expect(c.seed).toBe(1);
    });

    it('buckets by the step whose tick schedules each event and groups chords', () => {
        const s = steps16();
        s[0] = n('C4', { chord: ['E4'], length: 2 });
        const events = renderNoteFx(s, chain((c) => { c.ratchet = { enabled: true, count: 3, decay: 1, gate: 1 }; }), { loopLength: 4 });
        const buckets = bucketByStep(events, 4);
        expect(buckets.map((b) => b.length)).toEqual([4, 2, 0, 0]);
        expect(groupSimultaneous(buckets[0]).map((g) => g.map((e) => e.pitch))).toEqual([[60, 64], [60, 64]]);
    });

    it('a timeline render seeds each loop pass like the live clock does', () => {
        const s = Array.from({ length: 8 }, () => n('C4'));
        const c = chain((x) => { x.humanize = { enabled: true, timing: 0.2, velocity: 0 }; });
        const timeline = renderNoteFxTimeline([...s, ...s], c, { loopLength: 8 });
        const pass1 = renderNoteFx(s, c, { loopLength: 8, iteration: 1 }).map((e) => ({ ...e, start: Math.round((e.start + 8) * 1e9) / 1e9, sourceStep: e.sourceStep + 8 }));
        expect(timeline.slice(8)).toEqual(pass1);
    });
});

describe('freezeEventsToSteps', () => {
    it('writes chords, keeps per-step fields, maps an even ratchet to retrigger', () => {
        const s = steps16();
        s[0] = n('C4', { timbre: 0.3, probability: 0.9 });
        const c = chain((x) => {
            x.chord = { enabled: true, intervals: [7] };
            x.ratchet = { enabled: true, count: 2, decay: 1, gate: 1 };
        });
        const events = renderNoteFx([{ ...s[0], probability: undefined }], c, { loopLength: 16 });
        const { steps, dropped } = freezeEventsToSteps(events, s, 16);
        expect(dropped).toBe(0);
        expect(steps[0]).toEqual({ note: 'C4', chord: ['G4'], velocity: 1, length: 1, slide: false, timbre: 0.3, retrigger: 2 });
    });

    it('counts what one note-start per step cannot hold', () => {
        const s = steps16();
        s[0] = n('C4', { chord: ['E4', 'G4'] });
        const events = renderNoteFx(s, chain((c) => { c.arp = { enabled: true, mode: 'up', rate: 0.25, octaves: 1, gate: 1 }; }), { loopLength: 16 });
        const { steps, dropped } = freezeEventsToSteps(events, s, 16);
        expect(steps[0]?.note).toBe('C4');
        expect(dropped).toBe(3);
    });

    it('turns a 1/16 arp over a long note into one note per step', () => {
        const s = steps16();
        s[4] = n('C4', { chord: ['E4', 'G4'], length: 3 });
        const events = renderNoteFx(s, chain((c) => { c.arp = { enabled: true, mode: 'down', rate: 1, octaves: 1, gate: 0.5 }; }), { loopLength: 16 });
        const { steps, dropped } = freezeEventsToSteps(events, s, 16);
        expect(dropped).toBe(0);
        expect([steps[4]?.note, steps[5]?.note, steps[6]?.note]).toEqual(['G4', 'E4', 'C4']);
        expect(steps[5]?.length).toBe(0.5);
    });
});

describe('freezeNoteFx', () => {
    it('freezes the loop and keeps steps past it (a longer pattern than the track loop)', () => {
        const s: (Note | null)[] = Array.from({ length: 12 }, () => null);
        s[0] = n('C4');
        s[10] = n('A4');
        const c = chain((x) => { x.chord = { enabled: true, intervals: [12] }; });
        const r = freezeNoteFx(s, c, { loopLength: 8 });
        expect(r.steps[0]).toMatchObject({ note: 'C4', chord: ['C5'] });
        expect(r.steps[10]).toBe(s[10]);
        expect(r.steps).toHaveLength(12);
        expect(r.notes).toBe(2);
        expect(r.dropped).toBe(0);
    });
});
