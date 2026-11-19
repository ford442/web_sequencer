import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AUDIO_INPUT_STORAGE_KEY,
    describeInputSettings,
    getStoredAudioInput,
    keptProcessingOf,
    matchStoredInput,
    openRecordingInput,
    recordingConstraints,
    setStoredAudioInput,
} from '../audioInputDevice';

/**
 * The recording input (#1498 P1): voice-call processing is asked off, what
 * the browser kept is reported, and a stored device that is gone opens the
 * default input instead of failing, with a flag the picker shows.
 */

function device(deviceId: string, label: string, groupId = `g-${deviceId}`): MediaDeviceInfo {
    return { deviceId, label, groupId, kind: 'audioinput', toJSON: () => ({}) } as MediaDeviceInfo;
}

function fakeStream(settings: MediaTrackSettings, label = 'Interface In 1/2') {
    const stop = vi.fn();
    const track = { label, getSettings: () => settings, stop } as unknown as MediaStreamTrack;
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    return { stream, stop };
}

describe('audioInputDevice', () => {
    const original = navigator.mediaDevices;
    let getUserMedia: ReturnType<typeof vi.fn>;
    let enumerateDevices: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        getUserMedia = vi.fn();
        enumerateDevices = vi.fn().mockResolvedValue([]);
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices } });
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original });
    });

    it('asks echo cancellation, noise suppression and auto gain off, stereo if the device has it', () => {
        expect(recordingConstraints()).toEqual({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
        });
        expect(recordingConstraints('abc')).toMatchObject({ deviceId: { exact: 'abc' }, echoCancellation: false });
    });

    it('reports the processing the browser kept and describes the settings', () => {
        const settings = { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 };
        expect(keptProcessingOf(settings)).toEqual(['echoCancellation']);
        expect(describeInputSettings(settings)).toBe('echo cancellation ON · noise suppression off · auto gain off · 2 ch · 48000 Hz');
        expect(describeInputSettings({})).toBe('echo cancellation ? · noise suppression ? · auto gain ?');
    });

    it('stores the choice and matches it by group, then label, then id', () => {
        setStoredAudioInput({ groupId: 'g2', label: 'USB Mic', deviceId: 'old' });
        expect(JSON.parse(localStorage.getItem(AUDIO_INPUT_STORAGE_KEY)!)).toEqual({ groupId: 'g2', label: 'USB Mic', deviceId: 'old' });
        const stored = getStoredAudioInput();
        expect(matchStoredInput([device('a', 'Built-in'), device('b', 'USB Mic', 'g2')], stored)?.deviceId).toBe('b');
        expect(matchStoredInput([device('c', 'USB Mic', 'rotated')], stored)?.deviceId).toBe('c');
        expect(matchStoredInput([device('old', '', '')], stored)?.deviceId).toBe('old');
        expect(matchStoredInput([device('x', 'Other')], stored)).toBeNull();
        setStoredAudioInput(null);
        expect(getStoredAudioInput()).toBeNull();
    });

    it('opens the stored device with the recording constraints and reads back its settings', async () => {
        setStoredAudioInput({ groupId: 'g-b', label: 'USB Mic' });
        enumerateDevices.mockResolvedValue([device('a', 'Built-in'), device('b', 'USB Mic')]);
        const { stream, stop } = fakeStream({ deviceId: 'b', channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: false }, 'USB Mic');
        getUserMedia.mockResolvedValue(stream);

        const input = await openRecordingInput();
        expect(getUserMedia).toHaveBeenCalledWith({ audio: { ...recordingConstraints('b') } });
        expect(input.label).toBe('USB Mic');
        expect(input.deviceId).toBe('b');
        expect(input.channels).toBe(1);
        expect(input.keptProcessing).toEqual(['noiseSuppression']);
        expect(input.fellBackToDefault).toBe(false);
        input.close();
        expect(stop).toHaveBeenCalled();
    });

    it('opens the default input when the stored device is gone, and says so', async () => {
        setStoredAudioInput({ groupId: 'gone', label: 'Unplugged', deviceId: 'dead' });
        const { stream } = fakeStream({ deviceId: 'default', channelCount: 2 });
        getUserMedia
            .mockRejectedValueOnce(Object.assign(new Error('no such device'), { name: 'OverconstrainedError' }))
            .mockResolvedValueOnce(stream);
        const input = await openRecordingInput();
        expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: recordingConstraints('dead') });
        expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: recordingConstraints() });
        expect(input.fellBackToDefault).toBe(true);
        expect(input.channels).toBe(2);
    });

    it('does not fall back when the caller named the device, or for a permission error', async () => {
        getUserMedia.mockRejectedValue(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }));
        await expect(openRecordingInput('named')).rejects.toThrow('gone');
        setStoredAudioInput({ groupId: 'g', label: 'L', deviceId: 'd' });
        getUserMedia.mockReset().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
        await expect(openRecordingInput()).rejects.toThrow('denied');
        expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
});
