// Passive monitor taps for per-instrument expression LEDs.
// Each tap is a gain bus into the master chain plus a read-only AnalyserNode.

export interface TrackMonitor {
    bus: GainNode;
    analyser: AnalyserNode;
}

export function createTrackMonitor(
    context: AudioContext,
    destination: AudioNode,
): TrackMonitor {
    const bus = context.createGain();
    bus.gain.value = 1;
    bus.connect(destination);

    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    bus.connect(analyser);

    return { bus, analyser };
}
