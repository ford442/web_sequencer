/**
 * The project runtime (#1597 P2): stores bound to the doc, per-editor undo,
 * labelled history, and two "tabs" (two runtimes, each with its own stores)
 * kept in one room by the local provider.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocBinding, SongField } from '../binding';
import { createLocalProvider } from '../providers/local';
import type { CollabProvider } from '../providers/types';
import { ProjectRuntime, preserveIdentity } from '../runtime';
import { createChannelHub, type ChannelHub } from './channelHub';

type Step = { note: string; velocity: number } | null;
interface TestPattern { kick: { steps: Step[] }; partA: { steps: Step[] } }
interface TestParams { synthA: { filterCutoff: number; resonance: number } }
interface Clip { id: string; track: string; patternSlot: number; startStep: number; lengthSteps: number; loop: boolean }
interface TestArrangement { clips: Clip[]; lengthSteps: number }

interface FieldStore<T> {
    get(): T;
    set(next: T | ((prev: T) => T)): void;
    binding: DocBinding;
}

function fieldStore<T>(field: SongField, initial: T): FieldStore<T> {
    let value = initial;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    return {
        get: () => value,
        set(next) {
            const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
            if (resolved === value) return;
            value = resolved;
            notify();
        },
        binding: {
            name: field,
            fields: [field],
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            version: () => value,
            read: () => ({ [field]: value }),
            apply(values) {
                value = (values[field] ?? initial) as T;
                notify();
            },
        },
    };
}

const emptySteps = (): Step[] => Array<Step>(16).fill(null);

function createTab() {
    const pattern = fieldStore<TestPattern>('pattern', { kick: { steps: emptySteps() }, partA: { steps: emptySteps() } });
    const params = fieldStore<TestParams>('params', { synthA: { filterCutoff: 0.42, resonance: 0.1 } });
    const arrangement = fieldStore<TestArrangement>('arrangement', {
        clips: [
            { id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true },
            { id: 'clip-2', track: 'partA', patternSlot: 0, startStep: 16, lengthSteps: 16, loop: true },
        ],
        lengthSteps: 64,
    });
    const tempo = fieldStore<number>('tempo', 120);
    const runtime = new ProjectRuntime({ bindings: [pattern.binding, params.binding, arrangement.binding, tempo.binding] });
    runtimes.push(runtime);
    return { pattern, params, arrangement, tempo, runtime };
}

type Tab = ReturnType<typeof createTab>;

/** One pointer gesture: a new undo step, then its writes. */
function gesture(tab: Tab, fn: () => void): void {
    tab.runtime.history.beginStep('human');
    fn();
}

function paint(tab: Tab, track: 'kick' | 'partA', steps: number[]): void {
    gesture(tab, () => {
        for (const i of steps) {
            tab.pattern.set((p) => {
                const next = [...p[track].steps];
                next[i] = { note: 'C4', velocity: 1 };
                return { ...p, [track]: { steps: next } };
            });
        }
    });
}

function dragCutoff(tab: Tab, values: number[]): void {
    gesture(tab, () => {
        for (const v of values) tab.params.set((p) => ({ synthA: { ...p.synthA, filterCutoff: v } }));
    });
}

function moveClip(tab: Tab, id: string, startStep: number): void {
    gesture(tab, () => {
        tab.arrangement.set((a) => ({ ...a, clips: a.clips.map((c) => (c.id === id ? { ...c, startStep } : c)) }));
    });
}

const painted = (tab: Tab, track: 'kick' | 'partA') =>
    tab.pattern.get()[track].steps.flatMap((s, i) => (s ? [i] : []));

let runtimes: ProjectRuntime[] = [];
let providers: CollabProvider[] = [];

afterEach(() => {
    providers.forEach((p) => p.destroy());
    runtimes.forEach((r) => r.destroy());
    providers = [];
    runtimes = [];
});

describe('ProjectRuntime: one tab', () => {
    it('seeds the doc from the stores', () => {
        const tab = createTab();
        expect(tab.runtime.readSong()).toMatchObject({ tempo: 120, params: { synthA: { filterCutoff: 0.42 } } });
        expect(tab.runtime.history.getSnapshot().entries).toEqual([]);
    });

    it('records a gesture as one labelled step that undo and redo replay through the stores', () => {
        const tab = createTab();
        paint(tab, 'kick', [0, 2, 4, 6, 8, 10, 12, 14]);
        expect(tab.runtime.history.getSnapshot().entries.map((e) => e.label)).toEqual(['paint 8 steps (Kick)']);
        expect(tab.runtime.readField('pattern')).toEqual(tab.pattern.get());

        expect(tab.runtime.history.undo()).toBe(true);
        expect(painted(tab, 'kick')).toEqual([]);
        expect(tab.runtime.history.getSnapshot().entries[0].done).toBe(false);
        expect(tab.runtime.history.redo()).toBe(true);
        expect(painted(tab, 'kick')).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
        expect(tab.runtime.history.getSnapshot().entries.map((e) => [e.label, e.done])).toEqual([['paint 8 steps (Kick)', true]]);
    });

    it('labels a knob drag with its first and last value, and keeps untouched subtrees by identity on undo', () => {
        const tab = createTab();
        const kickBefore = tab.pattern.get().kick;
        paint(tab, 'partA', [1]);
        dragCutoff(tab, [0.5, 0.6, 0.71]);
        const labels = tab.runtime.history.getSnapshot().entries.map((e) => e.label);
        expect(labels).toEqual(['paint 1 step (Synth A)', 'Synth A: Cutoff 0.42 → 0.71']);
        tab.runtime.history.undo();
        tab.runtime.history.undo();
        expect(tab.params.get().synthA.filterCutoff).toBe(0.42);
        // Undo rewrote `pattern` from the doc, but the kick track never changed.
        expect(tab.pattern.get().kick).toBe(kickBefore);
    });

    it('jumps to any step of the history', () => {
        const tab = createTab();
        paint(tab, 'kick', [0]);
        paint(tab, 'kick', [4]);
        paint(tab, 'kick', [8]);
        const [first, , third] = tab.runtime.history.getSnapshot().entries;
        tab.runtime.history.jumpTo(first.id);
        expect(painted(tab, 'kick')).toEqual([0]);
        tab.runtime.history.jumpTo(third.id);
        expect(painted(tab, 'kick')).toEqual([0, 4, 8]);
        tab.runtime.history.jumpTo('start');
        expect(painted(tab, 'kick')).toEqual([]);
    });

    it('runs a co-producer edit as one agent step the human undo leaves alone', () => {
        const tab = createTab();
        paint(tab, 'kick', [0]);
        tab.runtime.edit('agent', () => {
            tab.pattern.set((p) => ({ ...p, partA: { steps: emptySteps().map((_, i) => (i % 4 === 0 ? { note: 'E4', velocity: 1 } : null)) } }));
            tab.params.set((p) => ({ synthA: { ...p.synthA, resonance: 0.8 } }));
            tab.tempo.set(128);
        }, 'co-producer: edit_pattern');
        const entries = tab.runtime.history.getSnapshot().entries;
        expect(entries.map((e) => [e.editor, e.label])).toEqual([
            ['human', 'paint 1 step (Kick)'],
            ['agent', 'co-producer: edit_pattern'],
        ]);
        // Ctrl+Z undoes the human's paint only.
        tab.runtime.history.undo('human');
        expect(painted(tab, 'kick')).toEqual([]);
        expect(painted(tab, 'partA')).toEqual([0, 4, 8, 12]);
        expect(tab.tempo.get()).toBe(128);
        // The co-producer's undo reverts its whole tool call.
        expect(tab.runtime.history.undo('agent')).toBe(true);
        expect(painted(tab, 'partA')).toEqual([]);
        expect(tab.params.get().synthA.resonance).toBe(0.1);
        expect(tab.tempo.get()).toBe(120);
        expect(tab.runtime.history.canUndo('agent')).toBe(false);
    });

    it('a load is not undoable and clears the history; playback writes are not undoable', () => {
        const tab = createTab();
        paint(tab, 'kick', [0]);
        tab.runtime.edit('load', () => tab.tempo.set(90));
        expect(tab.runtime.history.getSnapshot().entries).toEqual([]);
        expect(tab.runtime.readField('tempo')).toBe(90);
        tab.runtime.edit('playback', () => tab.params.set((p) => ({ synthA: { ...p.synthA, resonance: 0.5 } })));
        expect(tab.runtime.readField('params')).toMatchObject({ synthA: { resonance: 0.5 } });
        expect(tab.runtime.history.canUndo()).toBe(false);
    });

    it('a load inside an agent step stays that step', () => {
        const tab = createTab();
        tab.runtime.edit('agent', () => {
            tab.runtime.edit('load', () => tab.tempo.set(100));
        }, 'co-producer: load');
        expect(tab.runtime.history.getSnapshot().entries.map((e) => e.label)).toEqual(['co-producer: load']);
        tab.runtime.history.undo('agent');
        expect(tab.tempo.get()).toBe(120);
    });
});

describe('ProjectRuntime: two tabs in one room', () => {
    const ROOM = 'project:runtime-test';

    function connect(hub: ChannelHub, doc: Y.Doc): CollabProvider {
        const provider = createLocalProvider(doc, { room: ROOM, createChannel: hub.createChannel });
        providers.push(provider);
        return provider;
    }

    async function twoTabs() {
        const hub = createChannelHub();
        const a = createTab();
        connect(hub, a.runtime.doc);
        const b = createTab();
        // A second tab opens the room's doc and takes it into its stores.
        const docB = new Y.Doc();
        connect(hub, docB);
        await hub.settle();
        b.runtime.adopt(docB);
        a.tempo.set(124);
        await hub.settle();
        return { hub, a, b };
    }

    it('a tab that joins shows the room song', async () => {
        const { a, b } = await twoTabs();
        expect(b.tempo.get()).toBe(124);
        expect(b.pattern.get()).toEqual(a.pattern.get());
    });

    it('paint 8 steps, drag a knob, move a clip, undo twice, redo once: both tabs agree, each undoes its own edits', async () => {
        const { hub, a, b } = await twoTabs();
        const eight = [0, 2, 4, 6, 8, 10, 12, 14];

        paint(a, 'kick', eight);
        await hub.settle();
        dragCutoff(a, [0.5, 0.6, 0.71]);
        await hub.settle();
        moveClip(b, 'clip-2', 32);
        await hub.settle();

        expect(painted(b, 'kick')).toEqual(eight);
        expect(b.params.get().synthA.filterCutoff).toBe(0.71);
        expect(a.arrangement.get().clips[1].startStep).toBe(32);

        // Tab A undoes twice: its knob drag, then its paint. B's clip move stays.
        a.runtime.history.undo();
        a.runtime.history.undo();
        await hub.settle();
        for (const tab of [a, b]) {
            expect(painted(tab, 'kick')).toEqual([]);
            expect(tab.params.get().synthA.filterCutoff).toBe(0.42);
            expect(tab.arrangement.get().clips[1].startStep).toBe(32);
        }

        // Redo once: the paint comes back in both tabs; the knob stays undone.
        a.runtime.history.redo();
        await hub.settle();
        for (const tab of [a, b]) {
            expect(painted(tab, 'kick')).toEqual(eight);
            expect(tab.params.get().synthA.filterCutoff).toBe(0.42);
        }
        expect(a.runtime.readSong()).toEqual(b.runtime.readSong());

        // Tab B's history holds only its own clip move; A's steps are not in it.
        expect(b.runtime.history.getSnapshot().entries.map((e) => e.label)).toEqual(['move clip']);
        expect(a.runtime.history.getSnapshot().entries.map((e) => [e.label, e.done])).toEqual([
            ['Tempo 120 → 124', true],
            ['paint 8 steps (Kick)', true],
            ['Synth A: Cutoff 0.42 → 0.71', false],
        ]);
        b.runtime.history.undo();
        await hub.settle();
        for (const tab of [a, b]) {
            expect(tab.arrangement.get().clips[1].startStep).toBe(16);
            expect(painted(tab, 'kick')).toEqual(eight);
        }
    });

    it('an undo never overwrites what the other tab changed since', async () => {
        const { hub, a, b } = await twoTabs();
        dragCutoff(a, [0.6]);
        await hub.settle();
        dragCutoff(b, [0.9]);
        await hub.settle();
        a.runtime.history.undo();
        await hub.settle();
        expect(a.params.get().synthA.filterCutoff).toBe(0.9);
        expect(b.params.get().synthA.filterCutoff).toBe(0.9);
    });

    it('releasing a session doc goes back to a private doc holding the same song', async () => {
        const { b } = await twoTabs();
        const shared = b.runtime.doc;
        const release = b.runtime.adopt(shared);
        release();
        expect(b.runtime.doc).not.toBe(shared);
        expect(b.runtime.readField('tempo')).toBe(124);
    });
});

describe('preserveIdentity', () => {
    it('keeps equal subtrees and replaces changed ones', () => {
        const prev = { a: { x: 1 }, b: [1, 2, { y: 2 }], c: 'same' };
        const next = { a: { x: 1 }, b: [1, 2, { y: 3 }], c: 'same' };
        const out = preserveIdentity(prev, next) as typeof prev;
        expect(out).toEqual(next);
        expect(out.a).toBe(prev.a);
        expect(out.b).not.toBe(prev.b);
        expect(preserveIdentity(prev, structuredClone(prev))).toBe(prev);
    });

    it('treats a key the doc dropped (undefined) as unchanged', () => {
        const prev = { note: 'C4', chord: undefined };
        expect(preserveIdentity(prev, { note: 'C4' })).toBe(prev);
    });
});
