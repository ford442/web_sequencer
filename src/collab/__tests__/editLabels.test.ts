/**
 * History panel labels (#1597 P2) for the edits #1629's audio tracks added:
 * strips, clip gain, trims and splits get a name, not "edit audioTracks".
 */
import { describe, expect, it } from 'vitest';
import { describeEdit, primaryField } from '../editLabels';
import type { SongFieldValues } from '../binding';

const track = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: `Audio ${id.slice(6)}`, gainDb: 0, pan: 0, ...patch });
const clip = (id: string, patch: Record<string, unknown> = {}) => ({
    id, kind: 'audio', track: 'audio-1', mediaId: 'm', startStep: 0, lengthSteps: 16,
    offsetFrames: 0, gainDb: 0, warp: 'off', ...patch,
});
const arrangement = (...clips: unknown[]) => ({ clips, lengthSteps: 64 });
const label = (before: SongFieldValues, after: SongFieldValues) => describeEdit(before, after);

describe('audio track labels', () => {
    it('names a strip change after the track', () => {
        expect(label({ audioTracks: [track('audio-1')] }, { audioTracks: [track('audio-1', { gainDb: -6 })] }))
            .toBe('Audio 1: Fader 0 dB → -6 dB');
        expect(label({ audioTracks: [track('audio-2')] }, { audioTracks: [track('audio-2', { pan: 0.5 })] }))
            .toBe('Audio 2: Pan 0 → 0.5');
        expect(label({ audioTracks: [track('audio-1')] }, { audioTracks: [track('audio-1', { name: 'Vox' })] }))
            .toBe('rename Audio 1 → Vox');
    });

    it('names adding and removing tracks', () => {
        expect(label({ audioTracks: undefined }, { audioTracks: [track('audio-1')] })).toBe('add Audio 1');
        expect(label({ audioTracks: [track('audio-1'), track('audio-2')] }, { audioTracks: [track('audio-1')] }))
            .toBe('remove Audio 2');
        expect(label({ audioTracks: [] }, { audioTracks: [track('audio-1'), track('audio-2')] })).toBe('add 2 audio tracks');
        expect(label({ audioTracks: [track('audio-1')] }, { audioTracks: [track('audio-1', { gainDb: -1, pan: 1 })] }))
            .toBe('edit Audio 1');
    });

    it('makes a strip change its own kind of edit (a gesture boundary)', () => {
        expect(primaryField(['audioTracks'])).toBe('audioTracks');
        expect(primaryField(['arrangement', 'audioTracks', 'media'])).toBe('arrangement');
    });
});

describe('clip labels', () => {
    it('names a clip gain change', () => {
        expect(label({ arrangement: arrangement(clip('c1')) }, { arrangement: arrangement(clip('c1', { gainDb: -3 })) }))
            .toBe('Clip gain 0 dB → -3 dB');
        expect(label({ arrangement: arrangement(clip('c1')) }, { arrangement: arrangement(clip('c1', { fadeInFrames: 480 })) }))
            .toBe('edit clip fades');
    });

    it('calls a head trim a resize and a drag along the lane a move', () => {
        const before = { arrangement: arrangement(clip('c1', { startStep: 4, lengthSteps: 12 })) };
        expect(label(before, { arrangement: arrangement(clip('c1', { startStep: 8, lengthSteps: 8, offsetSteps: 4 })) }))
            .toBe('resize clip');
        expect(label(before, { arrangement: arrangement(clip('c1', { startStep: 8, lengthSteps: 12 })) })).toBe('move clip');
        expect(label(before, { arrangement: arrangement(clip('c1', { startStep: 4, lengthSteps: 12, track: 'audio-2' })) }))
            .toBe('move clip');
    });

    it('names a split', () => {
        const before = { arrangement: arrangement(clip('c1')) };
        const after = { arrangement: arrangement(clip('c1', { lengthSteps: 6 }), clip('c2', { startStep: 6, lengthSteps: 10, offsetSteps: 6 })) };
        expect(label(before, after)).toBe('split clip');
        const elsewhere = { arrangement: arrangement(clip('c1', { lengthSteps: 6 }), clip('c2', { startStep: 32 })) };
        expect(label(before, elsewhere)).toBe('edit 2 clips');
    });
});
