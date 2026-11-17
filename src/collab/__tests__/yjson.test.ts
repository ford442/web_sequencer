import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import fc from 'fast-check';
import {
    createShapeRules,
    escapeKey,
    jsonEqual,
    readY,
    reconcileEntry,
    toJsonImage,
    unescapeKey,
    type Json,
    type ShapeRules,
} from '../yjson';

const RULES: ShapeRules = createShapeRules({
    steps: 'slots',
    clips: 'list',
    points: 'list',
    'lyrics.*': 'text',
    lyrics: 'slots',
    blob: 'atom',
});

function makeDoc(value: Record<string, Json>): Y.Doc {
    const doc = new Y.Doc();
    write(doc, value);
    return doc;
}

function write(doc: Y.Doc, value: Record<string, Json>): void {
    const root = doc.getMap<unknown>('root');
    doc.transact(() => {
        for (const [key, item] of Object.entries(value)) reconcileEntry(root, escapeKey(key), item, [key], RULES);
        for (const key of [...root.keys()]) if (!(unescapeKey(key)! in value)) root.delete(key);
    });
}

function read(doc: Y.Doc): Json {
    return readY(doc.getMap('root'));
}

/** Two peers forked from `base`: each edits, neither has seen the other's edit, then they exchange. */
function fork(base: Record<string, Json>, editA: Record<string, Json>, editB: Record<string, Json>): [Json, Json] {
    const a = makeDoc(base);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    write(a, editA);
    write(b, editB);
    const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(a, fromB);
    Y.applyUpdate(b, fromA);
    return [read(a), read(b)];
}

const steps = (filled: Record<number, Json>): Json[] =>
    Array.from({ length: 32 }, (_, i) => filled[i] ?? null);

describe('conflicting edits converge without losing the shape', () => {
    it('two notes written to one empty step: one wins, the pattern stays 32 steps', () => {
        const [a, b] = fork(
            { steps: steps({}) },
            { steps: steps({ 5: { note: 'C2', velocity: 1 } }) },
            { steps: steps({ 5: { note: 'G2', velocity: 0.5 } }) },
        );
        expect(a).toEqual(b);
        const merged = (a as { steps: Json[] }).steps;
        expect(merged).toHaveLength(32);
        expect([{ note: 'C2', velocity: 1 }, { note: 'G2', velocity: 0.5 }]).toContainEqual(merged[5]);
    });

    it('edits to different fields of one note both survive', () => {
        const base = { steps: steps({ 2: { note: 'C2', velocity: 0.5 } }) };
        const [a, b] = fork(
            base,
            { steps: steps({ 2: { note: 'D2', velocity: 0.5 } }) },
            { steps: steps({ 2: { note: 'C2', velocity: 0.9 } }) },
        );
        expect(a).toEqual(b);
        expect((a as { steps: Json[] }).steps[2]).toEqual({ note: 'D2', velocity: 0.9 });
    });

    it('clearing a step while the other peer edits it converges', () => {
        const base = { steps: steps({ 7: { note: 'C2', velocity: 0.5 } }) };
        const [a, b] = fork(base, { steps: steps({}) }, { steps: steps({ 7: { note: 'C2', velocity: 1 } }) });
        expect(a).toEqual(b);
        expect((a as { steps: Json[] }).steps).toHaveLength(32);
    });

    it('a shorter pattern on one side and an edit past its end on the other', () => {
        const [a, b] = fork(
            { steps: steps({}) },
            { steps: steps({}).slice(0, 16) },
            { steps: steps({ 20: { note: 'C2', velocity: 1 } }) },
        );
        expect(a).toEqual(b);
        expect((a as { steps: Json[] }).steps).toHaveLength(16);
    });

    it('two clips added at once both land, even into an empty list', () => {
        const clip = (id: string) => ({ id, startStep: 0 });
        const [a, b] = fork({ clips: [] }, { clips: [clip('clip-1')] }, { clips: [clip('clip-2')] });
        expect(a).toEqual(b);
        const ids = (a as { clips: { id: string }[] }).clips.map((c) => c.id).sort();
        expect(ids).toEqual(['clip-1', 'clip-2']);
    });

    it('two people typing in one lyric line keep both edits', () => {
        const [a, b] = fork(
            { lyrics: ['hello world'] },
            { lyrics: ['hello big world'] },
            { lyrics: ['hello world!'] },
        );
        expect(a).toEqual(b);
        expect(a).toEqual({ lyrics: ['hello big world!'] });
    });

    it('a reorder by id never lands one clip’s edit on another clip', () => {
        const base = { clips: [{ id: 'x', startStep: 0 }, { id: 'y', startStep: 16 }] };
        const [a, b] = fork(
            base,
            // Peer A moves x past y; the list is kept sorted by start step.
            { clips: [{ id: 'y', startStep: 16 }, { id: 'x', startStep: 32 }] },
            // Peer B lengthens y meanwhile.
            { clips: [{ id: 'x', startStep: 0 }, { id: 'y', startStep: 16, lengthSteps: 8 }] },
        );
        expect(a).toEqual(b);
        const clips = (a as { clips: Record<string, Json>[] }).clips;
        expect(clips.find((c) => c.id === 'y')).toEqual({ id: 'y', startStep: 16, lengthSteps: 8 });
        expect(clips.find((c) => c.id === 'x')).toEqual({ id: 'x', startStep: 32 });
    });

    it('a point inserted between two others is one insert, not a rewrite', () => {
        const doc = makeDoc({ points: [{ step: 0, value: 0 }, { step: 8, value: 1 }] });
        const before = Y.encodeStateVector(doc);
        write(doc, { points: [{ step: 0, value: 0 }, { step: 4, value: 0.5 }, { step: 8, value: 1 }] });
        const diff = Y.encodeStateAsUpdate(doc, before);
        expect(diff.byteLength).toBeLessThan(60);
        expect(read(doc)).toEqual({ points: [{ step: 0, value: 0 }, { step: 4, value: 0.5 }, { step: 8, value: 1 }] });
    });
});

describe('convergence (property)', () => {
    const value = fc.jsonValue({ maxDepth: 3 }) as fc.Arbitrary<Json>;
    const doc = fc.dictionary(fc.constantFrom('steps', 'clips', 'lyrics', 'blob', 'other'), value, { maxKeys: 4 });

    it('any two concurrent snapshots merge to the same JSON on both peers', () => {
        fc.assert(
            fc.property(doc, doc, doc, (base, editA, editB) => {
                const [a, b] = fork(base, editA, editB);
                return jsonEqual(a, b);
            }),
            { numRuns: 300 },
        );
    });
});

describe('representation', () => {
    it('keeps atoms opaque and hands out copies, not doc internals', () => {
        const doc = makeDoc({ blob: { a: [1, 2] } });
        expect(doc.getMap('root').get('blob')).toEqual({ a: [1, 2] });
        const first = read(doc) as { blob: { a: number[] } };
        first.blob.a.push(3);
        expect(read(doc)).toEqual({ blob: { a: [1, 2] } });
    });

    it('switches representation when the JSON type changes', () => {
        const doc = makeDoc({ v: { a: 1 } });
        for (const next of [[1, 2], 'text', null, [{ id: 'q' }], { b: [] }] as Json[]) {
            write(doc, { v: next });
            expect(read(doc)).toEqual({ v: next });
        }
    });

    it('escapes keys that look reserved and never leaks the slots register', () => {
        const value = { '\u0001len': 3, '\u0001\u0001x': 'y', steps: [null, 1] };
        const doc = makeDoc(value);
        expect(read(doc)).toEqual(value);
        expect(unescapeKey('\u0001len')).toBeNull();
    });

    it('keeps a __proto__ key as data', () => {
        const value = toJsonImage(JSON.parse('{"__proto__": {"polluted": true}}'));
        const out = read(makeDoc(value as Record<string, Json>)) as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('does not split a surrogate pair when patching text', () => {
        const doc = makeDoc({ lyrics: ['a🎛️b'] });
        write(doc, { lyrics: ['a🎚️b'] });
        expect(read(doc)).toEqual({ lyrics: ['a🎚️b'] });
    });

    it('jsonEqual ignores key order but nothing else', () => {
        expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
        expect(jsonEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
        expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    });

    it('toJsonImage is exactly what JSON.stringify keeps', () => {
        expect(toJsonImage({ a: undefined, b: [undefined, NaN], d: new Date(0) })).toEqual({
            b: [null, null],
            d: '1970-01-01T00:00:00.000Z',
        });
        expect(toJsonImage(undefined)).toBeNull();
    });
});
