const distortionCurveCache = new Map<number, Float32Array<ArrayBuffer>>();

export function makeLimiterCurve(threshold = 0.95): Float32Array<ArrayBuffer> {
    const sampleCount = 8192;
    const curve = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; ++i) {
        const x = (i * 2) / sampleCount - 1;
        const clamped = x < -threshold ? -threshold : x > threshold ? threshold : x;
        curve[i] = clamped / threshold;
    }

    return curve;
}

export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const rawAmount = typeof amount === 'number' ? amount : 50;
    const normalizedAmount = Math.round(rawAmount * 10) / 10;
    const cachedCurve = distortionCurveCache.get(normalizedAmount);
    if (cachedCurve) {
        return cachedCurve;
    }

    const sampleCount = 8192;
    const curve = new Float32Array(sampleCount);
    const degrees = Math.PI / 180;

    for (let i = 0; i < sampleCount; ++i) {
        const x = (i * 2) / sampleCount - 1;
        curve[i] = ((3 + normalizedAmount) * x * 20 * degrees) / (Math.PI + normalizedAmount * Math.abs(x));
    }

    distortionCurveCache.set(normalizedAmount, curve);
    return curve;
}
