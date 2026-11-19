/**
 * Audio input for recording (#1498 P1): the device picker's stored choice and
 * the raw stream a take records.
 *
 * The browser's voice-call processing (echo cancellation, noise suppression,
 * auto gain) is asked off: it gates, ducks and re-levels a take. Browsers may
 * keep some of it anyway, so `openRecordingInput` reports what the track
 * actually runs with (`getSettings()`), and the picker shows it.
 *
 * `requestAudioOutputPermission` (audioOutputDevice.ts) opens an unconstrained
 * stream only to unlock device labels; a take never records through it.
 */

export const AUDIO_INPUT_STORAGE_KEY = 'hyphon.audioInputDevice';

export interface StoredAudioInput {
    groupId: string;
    label: string;
    /** Last deviceId this choice resolved to (ids are per origin and can rotate). */
    deviceId?: string;
}

/** Voice-call processing a take must not run through. */
export const RAW_INPUT_PROCESSING = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
} as const;

export type InputProcessingKey = keyof typeof RAW_INPUT_PROCESSING;

const PROCESSING_LABELS: Record<InputProcessingKey, string> = {
    echoCancellation: 'echo cancellation',
    noiseSuppression: 'noise suppression',
    autoGainControl: 'auto gain',
};

export function getStoredAudioInput(): StoredAudioInput | null {
    try {
        const raw = localStorage.getItem(AUDIO_INPUT_STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed && typeof parsed === 'object'
            && typeof (parsed as StoredAudioInput).groupId === 'string'
            && typeof (parsed as StoredAudioInput).label === 'string'
        ) {
            return parsed as StoredAudioInput;
        }
    } catch {
        /* ignore */
    }
    return null;
}

export function setStoredAudioInput(pref: StoredAudioInput | null): void {
    try {
        if (!pref) localStorage.removeItem(AUDIO_INPUT_STORAGE_KEY);
        else localStorage.setItem(AUDIO_INPUT_STORAGE_KEY, JSON.stringify(pref));
    } catch {
        /* ignore */
    }
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
}

/** The stored choice among `devices`: by group, then label, then the remembered id. */
export function matchStoredInput(devices: readonly MediaDeviceInfo[], stored: StoredAudioInput | null): MediaDeviceInfo | null {
    if (!stored) return null;
    return devices.find((d) => d.groupId && d.groupId === stored.groupId && (!stored.label || d.label === stored.label))
        ?? devices.find((d) => d.label && d.label === stored.label)
        ?? devices.find((d) => stored.deviceId && d.deviceId === stored.deviceId)
        ?? null;
}

/** Constraints of a recording stream on `deviceId` (undefined = the default input). */
export function recordingConstraints(deviceId?: string): MediaTrackConstraints {
    return {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        ...RAW_INPUT_PROCESSING,
        channelCount: { ideal: 2 },
    };
}

export interface RecordingInput {
    stream: MediaStream;
    track: MediaStreamTrack;
    label: string;
    deviceId: string;
    settings: MediaTrackSettings;
    /** Channels a take records: 1 for a mono input, else 2. */
    channels: 1 | 2;
    /** Processing the browser left on although it was asked off. */
    keptProcessing: InputProcessingKey[];
    /** The stored device was not found and the default input opened instead. */
    fellBackToDefault: boolean;
    /** Stop the tracks. */
    close(): void;
}

/** Processing `settings` reports on although a take asked it off. */
export function keptProcessingOf(settings: MediaTrackSettings): InputProcessingKey[] {
    return (Object.keys(RAW_INPUT_PROCESSING) as InputProcessingKey[]).filter((key) => settings[key] === true);
}

/** One line for the picker: what the browser actually runs the input with. */
export function describeInputSettings(settings: MediaTrackSettings): string {
    const parts: string[] = [];
    for (const key of Object.keys(RAW_INPUT_PROCESSING) as InputProcessingKey[]) {
        const value = settings[key];
        parts.push(`${PROCESSING_LABELS[key]} ${value === true ? 'ON' : value === false ? 'off' : '?'}`);
    }
    if (typeof settings.channelCount === 'number') parts.push(`${settings.channelCount} ch`);
    if (typeof settings.sampleRate === 'number') parts.push(`${settings.sampleRate} Hz`);
    const latency = (settings as MediaTrackSettings & { latency?: number }).latency;
    if (typeof latency === 'number') parts.push(`${(latency * 1000).toFixed(1)} ms`);
    return parts.join(' · ');
}

/**
 * Open the input a take records: the given device, else the stored choice,
 * else the default input. Throws the browser's error (permission, no device).
 */
export async function openRecordingInput(deviceId?: string): Promise<RecordingInput> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no microphone access (getUserMedia)');
    let wanted = deviceId;
    let fellBackToDefault = false;
    if (wanted === undefined) {
        const stored = getStoredAudioInput();
        if (stored) {
            const match = matchStoredInput(await listAudioInputDevices(), stored);
            wanted = match?.deviceId ?? stored.deviceId;
        }
    }
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: recordingConstraints(wanted || undefined) });
    } catch (err) {
        // A stored device that is gone: open the default rather than fail, and say so.
        if (deviceId !== undefined || !wanted || (err as { name?: string })?.name !== 'OverconstrainedError') throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio: recordingConstraints() });
        fellBackToDefault = true;
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('the input stream has no audio track');
    }
    const settings = track.getSettings();
    return {
        stream,
        track,
        label: track.label || 'default input',
        deviceId: settings.deviceId ?? wanted ?? '',
        settings,
        channels: settings.channelCount === 1 ? 1 : 2,
        keptProcessing: keptProcessingOf(settings),
        fellBackToDefault,
        close: () => stream.getTracks().forEach((t) => t.stop()),
    };
}
