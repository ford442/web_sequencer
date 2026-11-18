import '@testing-library/jest-dom';
import React, { useEffect, useState } from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement, AudioClip } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { createArrangement, placeClip } from '@/arrangement/model';
import { EMPTY_AUDIO_TRACK_STATE } from '@/arrangement/audioTracks';
import { audioTrackStore } from '@/stores/audioTrackStore';
import { trackMuteSoloStore } from '@/stores/trackMuteSoloStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { mediaLengthSteps } from '../arrangement/useAudioImport';

const MEDIA = 'f'.repeat(64);
vi.mock('@/audio/media/importAudioFile', () => ({
    importAudioFile: vi.fn((file: File) => Promise.resolve({
        mediaId: 'f'.repeat(64),
        ref: { name: file.name, sampleRate: 48000, channels: 2, frames: 48000 * 2 },
        created: true,
        decoder: 'wav',
    })),
}));

const { ArrangementView } = await import('../ArrangementView');

const SLOTS = { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 } as Record<TrackKey, number>;
const METER = { stepCount: 16, timeSignature: [4, 4] as [number, number], trackLengths: {} };

const onArrangement = vi.fn<(arrangement: Arrangement) => void>();
const latest = (): Arrangement => onArrangement.mock.lastCall?.[0] ?? createArrangement(64);
function Harness({ initial }: { initial: Arrangement }) {
    const [arrangement, setArrangement] = useState(initial);
    useEffect(() => onArrangement(arrangement), [arrangement]);
    return (
        <ArrangementView
            arrangement={arrangement}
            meter={METER}
            activeTrackSlots={SLOTS}
            isSongModeActive={false}
            onSetIsSongModeActive={vi.fn()}
            onEdit={(updater) => setArrangement((prev) => updater(prev))}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            canUndo={false}
            canRedo={false}
            onClose={vi.fn()}
        />
    );
}

function dropFile(target: Element, name: string, clientX = 0) {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/wav' });
    const dataTransfer = { files: [file], types: ['Files'], dropEffect: 'none' };
    fireEvent.dragOver(target, { dataTransfer });
    // jsdom's synthetic drag events carry no pointer position: give the drop one.
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, 'clientX', { value: clientX });
    fireEvent(target, drop);
}

describe('ArrangementView audio tracks (#1629)', () => {
    afterEach(() => {
        act(() => audioTrackStore.set(EMPTY_AUDIO_TRACK_STATE));
        trackMuteSoloStore.reset();
    });

    it('shows an audio lane with its clips, mute and solo', () => {
        audioTrackStore.set({
            tracks: [{ id: 'audio-1', name: 'Vox', gainDb: 0, pan: 0 }],
            media: { [MEDIA]: { name: 'vox.wav', sampleRate: 48000, channels: 1, frames: 48000 } },
        });
        const clip: AudioClip = {
            kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: MEDIA, startStep: 16, lengthSteps: 8,
            offsetFrames: 0, gainDb: -3, warp: 'off',
        };
        render(<Harness initial={placeClip(createArrangement(64), clip)} />);
        const block = screen.getByRole('button', { name: /^Vox audio clip, vox\.wav, at 2\.1\.1, 8 steps, -3 dB$/ });
        fireEvent.focus(block);
        expect(screen.getByLabelText(/^CLIP/)).toHaveValue(-3);
        fireEvent.click(screen.getByRole('button', { name: 'Mute Vox' }));
        expect(trackMuteSoloStore.isAudible('audio-1')).toBe(false);
        expect(trackMuteSoloStore.isAudible('kick')).toBe(true);
        fireEvent.change(screen.getByLabelText(/^CLIP/), { target: { value: '-9' } });
        expect(latest().clips[0]).toMatchObject({ gainDb: -9 });
    });

    it('imports a dropped file as an audio clip on a new track', async () => {
        transportMixStore.setTempo(120);
        render(<Harness initial={createArrangement(64)} />);
        const dropRow = document.querySelector('[data-audio-drop="new"]')!;
        dropFile(dropRow, 'loop.wav');
        await waitFor(() => expect(latest().clips).toHaveLength(1));
        expect(latest().clips[0]).toMatchObject({
            kind: 'audio', track: 'audio-1', mediaId: MEDIA, startStep: 0, lengthSteps: 16, offsetFrames: 0, gainDb: 0, warp: 'off',
        });
        expect(audioTrackStore.getSnapshot().tracks.map((t) => t.id)).toEqual(['audio-1']);
        expect(audioTrackStore.getSnapshot().media[MEDIA]?.name).toBe('loop.wav');
        expect(await screen.findByRole('status')).toHaveTextContent('Imported loop.wav');
        expect(screen.getByRole('button', { name: /^Audio 1 audio clip, loop\.wav/ })).toBeInTheDocument();
    });

    it('drops onto an existing audio lane at the snapped step under the pointer', async () => {
        audioTrackStore.set({ tracks: [{ id: 'audio-2', name: 'Gtr', gainDb: 0, pan: 0 }], media: {} });
        render(<Harness initial={createArrangement(64)} />);
        const lane = document.querySelector('[data-audio-track="audio-2"]')!;
        // jsdom has no layout: x = clientX - HEADER_WIDTH (92); bar zoom = 12 px per step, beat snap (4 steps).
        dropFile(lane, 'gtr.wav', 92 + 12 * 9);
        await waitFor(() => expect(latest().clips).toHaveLength(1));
        expect(latest().clips[0]).toMatchObject({ track: 'audio-2', startStep: 8 });
    });

    it('sizes a clip to its media at the song tempo', () => {
        expect(mediaLengthSteps({ frames: 48000, sampleRate: 48000 }, 120)).toBe(8);
        expect(mediaLengthSteps({ frames: 48001, sampleRate: 48000 }, 120)).toBe(9);
        expect(mediaLengthSteps({ frames: 1, sampleRate: 48000 }, 120)).toBe(1);
    });
});
