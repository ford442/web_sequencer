// assembly/oscillators.ts

@inline const PI: f32 = 3.14159265359;

export function generate(
  offset: i32,
  sampleRate: f32,
  freq: f32,
  duration: f32,
  type: i32,
  cutoff: f32,
  resonance: f32
): i32 {
  let totalSamples: i32 = i32(sampleRate * duration);

  // --- FILTER SETUP (Same as before) ---
  let safeCutoff: f32 = max(20.0, min(cutoff, sampleRate / 2.1));
  let safeRes: f32 = max(0.1, resonance);
  let w0: f32 = 2.0 * PI * safeCutoff / sampleRate;
  let cosW0: f32 = f32(Math.cos(f64(w0)));
  let sinW0: f32 = f32(Math.sin(f64(w0)));
  let alpha: f32 = sinW0 / (2.0 * safeRes);

  let a0: f32 = 1.0 + alpha;
  let invA0: f32 = 1.0 / a0;
  let b0: f32 = ((1.0 - cosW0) / 2.0) * invA0;
  let b1: f32 = (1.0 - cosW0) * invA0;
  let b2: f32 = ((1.0 - cosW0) / 2.0) * invA0;
  let a1: f32 = (-2.0 * cosW0) * invA0;
  let a2: f32 = (1.0 - alpha) * invA0;

  // Filter State
  let x1: f32 = 0.0, x2: f32 = 0.0, y1: f32 = 0.0, y2: f32 = 0.0;

  // Oscillator State
  let phase: f32 = 0.0;
  let phaseIncr: f32 = freq / sampleRate;

  for (let i = 0; i < totalSamples; i++) {
    let rawSample: f32 = 0.0;
    let p: f64 = f64(phase);

    if (type == 0) { // Sawtooth (Standard: -1 to 1)
      // 2 * p - 1
      rawSample = f32(2.0 * p - 1.0);
    } else if (type == 1) { // Square
      // 1 if < 0.5, else -1
      rawSample = phase < 0.5 ? 1.0 : -1.0;
    } else if (type == 2) { // Triangle
      // Map 0..1 -> -1..1..-1
      // 1 - 4 * abs(p - 0.5)
      rawSample = f32(1.0 - 4.0 * Math.abs(p - 0.5));
    } else { // Sine
      rawSample = f32(Math.sin(2.0 * Math.PI * p));
    }

    // Apply Filter
    let filtered: f32 = (b0 * rawSample) + (b1 * x1) + (b2 * x2) - (a1 * y1) - (a2 * y2);

    x2 = x1; x1 = rawSample;
    y2 = y1; y1 = filtered;

    store<f32>(offset + (i * 4), filtered);

    // --- PHASE WRAPPING FIX ---
    phase += phaseIncr;
    if (phase >= 1.0) phase -= 1.0;
  }

  return totalSamples;
}
