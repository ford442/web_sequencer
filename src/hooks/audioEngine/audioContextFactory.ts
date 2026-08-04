import { getStoredLatencyMode, type LatencyMode } from '../../utils/audioLatencyMode';

type AudioContextWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

/**
 * Construct the live-playback AudioContext with an explicit latencyHint so
 * Rubberband/ONNX/TTS buffer rates negotiate against a known policy instead
 * of whatever the browser default happens to be.
 */
export function createAudioContext(latencyHint: LatencyMode = getStoredLatencyMode()): AudioContext {
    const audioWindow = window as AudioContextWindow;
    const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) {
        throw new Error('AudioContext is not available in this browser');
    }
    return new AudioContextCtor({ latencyHint });
}
