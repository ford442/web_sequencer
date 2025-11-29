// assembly/oscillators.ts

@inline const PI: f32 = 3.14159265359;

export function generate(
  offset: i32,
  sampleRate: f32,
  freq: f32,
  duration: f32,
  type: i32,
  cutoff: f32,    // <--- NEW PARAMETER
  resonance: f32  // <--- NEW PARAMETER (Q)
): i32 {
  let totalSamples: i32 = i32(sampleRate * duration);

  // --- FILTER COEFFICIENT CALCULATION (BiQuad Lowpass) ---
  // Standard Audio EQ Cookbook formula for 2nd order LPF
  // w0 = 2 * PI * cutoff / sampleRate
  let w0: f32 = 2.0 * PI * cutoff / sampleRate;
  let cosW0: f32 = f32(Math.cos(w0));
  let alpha: f32 = f32(Math.sin(w0)) / (2.0 * resonance);

  // Coefficients
  let b0: f32 = (1.0 - cosW0) / 2.0;
  let b1: f32 = 1.0 - cosW0;
  let b2: f32 = (1.0 - cosW0) / 2.0;
  let a0: f32 = 1.0 + alpha;
  let a1: f32 = -2.0 * cosW0;
  let a2: f32 = 1.0 - alpha;

  // Normalize by a0 (so we divide everything by a0)
  let invA0: f32 = 1.0 / a0;
  b0 *= invA0;
  b1 *= invA0;
  b2 *= invA0;
  a1 *= invA0;
  a2 *= invA0;

  // Filter State History
  let x1: f32 = 0.0; // x[n-1]
  let x2: f32 = 0.0; // x[n-2]
  let y1: f32 = 0.0; // y[n-1]
  let y2: f32 = 0.0; // y[n-2]

  let phase: f32 = 0.0;
  let phaseIncr: f32 = freq / sampleRate;

  for (let i = 0; i < totalSamples; i++) {
    let rawSample: f32 = 0.0;

    // 1. Generate Raw Oscillator Sample
    if (type == 0) { // Saw
      rawSample = 2.0 * (phase - floor(phase)) - 1.0;
    } else if (type == 1) { // Square
      let p = phase - floor(phase);
      rawSample = (p >= 0.5 ? 1.0 : 0.0) * -2.0 + 1.0;
    } else if (type == 2) { // Triangle
      let p = phase - floor(phase);
      rawSample = f32(2.0 * abs(2.0 * p - 1.0) - 1.0);
    } else if (type == 3) { // Sine
      rawSample = f32(Math.sin(2.0 * PI * phase));
    }

    // 2. Apply Biquad Filter (Difference Equation)
    // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
    let filteredSample: f32 = (b0 * rawSample)
                            + (b1 * x1)
                            + (b2 * x2)
                            - (a1 * y1)
                            - (a2 * y2);

    // 3. Shift History
    x2 = x1;
    x1 = rawSample;
    y2 = y1;
    y1 = filteredSample;

    // 4. Write to Memory
    store<f32>(offset + (i * 4), filteredSample);

    phase += phaseIncr;
  }

  return totalSamples;
}
