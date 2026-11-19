import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sampler REC (#1498 P1): records through the take recorder — raw input,
 * lossless WAV in OPFS, decoded once into the bank — and never through
 * MediaRecorder. A browser that cannot record says why.
 */

const rec = vi.hoisted(() => ({
    support: { ok: true } as { ok: true } | { ok: false; reason: string },
    startTake: vi.fn(),
    decodeTake: vi.fn(),
    discardTake: vi.fn(),
}));
const inputs = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('../../../audio/recording/recordingSupport', () => ({
    RecordingUnsupportedError: class extends Error {},
    recordingSupport: () => rec.support,
}));
vi.mock('../../../audio/recording/takeRecorder', () => ({
    startTake: rec.startTake,
    decodeTake: rec.decodeTake,
    discardTake: rec.discardTake,
    toAudioBuffer: (d: { sampleRate: number; channels: Float32Array[] }) => ({ sampleRate: d.sampleRate, length: d.channels[0].length }),
}));
vi.mock('../../../utils/audioInputDevice', () => ({ openRecordingInput: inputs.open }));
vi.mock('../../../audio/runtime/AudioRuntime', () => ({ ensureRunning: vi.fn().mockResolvedValue(undefined) }));

import { useSamplerRecording } from '../useSamplerRecording';

describe('useSamplerRecording', () => {
    const context = { state: 'running', resume: vi.fn() } as unknown as AudioContext;
    let close: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        rec.support = { ok: true };
        rec.startTake.mockReset();
        rec.decodeTake.mockReset();
        rec.discardTake.mockReset().mockResolvedValue(undefined);
        close = vi.fn();
        inputs.open.mockReset().mockResolvedValue({ stream: {}, channels: 2, label: 'Mic', keptProcessing: [], close });
        vi.stubGlobal('MediaRecorder', vi.fn(() => { throw new Error('MediaRecorder must not be used'); }));
    });

    it('records a take into the bank, then deletes the file', async () => {
        const stop = vi.fn().mockResolvedValue({ id: 'take-abcdefg', droppedFrames: 0 });
        rec.startTake.mockResolvedValue({ stop, abort: vi.fn().mockResolvedValue(undefined) });
        rec.decodeTake.mockResolvedValue({ sampleRate: 48000, channels: [new Float32Array(480), new Float32Array(480)] });
        const onRecorded = vi.fn();
        const status = vi.fn();
        const { result } = renderHook(() => useSamplerRecording(context, onRecorded));

        await act(() => result.current.toggleRecording(status));
        expect(rec.startTake).toHaveBeenCalledWith(expect.objectContaining({ context, purpose: 'sampler' }));
        expect(result.current.isRecording).toBe(true);
        expect(status).toHaveBeenLastCalledWith('Recording...');

        await act(() => result.current.toggleRecording(status));
        expect(stop).toHaveBeenCalled();
        expect(rec.decodeTake).toHaveBeenCalledWith('take-abcdefg');
        expect(onRecorded).toHaveBeenCalledWith({ sampleRate: 48000, length: 480 });
        expect(rec.discardTake).toHaveBeenCalledWith('take-abcdefg');
        expect(close).toHaveBeenCalled();
        expect(status).toHaveBeenLastCalledWith('Recorded!');
        expect(result.current.isRecording).toBe(false);
    });

    it('says what the browser kept on', async () => {
        inputs.open.mockResolvedValue({ stream: {}, channels: 1, label: 'Mic', keptProcessing: ['echoCancellation'], close });
        rec.startTake.mockResolvedValue({ stop: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) });
        const status = vi.fn();
        const { result } = renderHook(() => useSamplerRecording(context, vi.fn()));
        await act(() => result.current.toggleRecording(status));
        expect(status).toHaveBeenLastCalledWith('Recording (browser kept echoCancellation)');
    });

    it('shows an explicit unsupported state, without opening the mic or falling back to MediaRecorder', async () => {
        rec.support = { ok: false, reason: 'no origin private file system (OPFS)' };
        const status = vi.fn();
        const { result } = renderHook(() => useSamplerRecording(context, vi.fn()));
        await act(() => result.current.toggleRecording(status));
        expect(status).toHaveBeenLastCalledWith('Rec unsupported: no origin private file system (OPFS)');
        expect(inputs.open).not.toHaveBeenCalled();
        expect(MediaRecorder).not.toHaveBeenCalled();
        expect(result.current.isRecording).toBe(false);
    });

    it('closes the input when the take cannot start', async () => {
        rec.startTake.mockRejectedValue(new Error('worker died'));
        const status = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { result } = renderHook(() => useSamplerRecording(context, vi.fn()));
        await act(() => result.current.toggleRecording(status));
        expect(close).toHaveBeenCalled();
        expect(status).toHaveBeenLastCalledWith('Record Error');
        warn.mockRestore();
    });

    it('drops a take still recording on unmount', async () => {
        const abort = vi.fn().mockResolvedValue(undefined);
        rec.startTake.mockResolvedValue({ stop: vi.fn(), abort });
        const { result, unmount } = renderHook(() => useSamplerRecording(context, vi.fn()));
        await act(() => result.current.toggleRecording(vi.fn()));
        unmount();
        expect(abort).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });
});
