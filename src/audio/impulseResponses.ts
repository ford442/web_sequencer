export function createReverbImpulseResponse(
    context: AudioContext,
    duration: number = 2.0,
    decay: number = 2.0,
): AudioBuffer {
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = i / sampleRate;
        const e = Math.pow(1 - n / duration, decay);
        left[i] = (Math.random() * 2 - 1) * e;
        right[i] = (Math.random() * 2 - 1) * e;
    }

    return impulse;
}
