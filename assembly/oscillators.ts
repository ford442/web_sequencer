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

  // --- FILTER COEFFICIENT CALCULATION (BiQuad Lowpass) ---
  // Ensure cutoff is within Nyquist and positive
  let safeCutoff: f32 = max(20.0, min(cutoff, sampleRate / 2.1));
  let safeRes: f32 = max(0.1, resonance);

  let w0: f32 = 2.0 * PI * safeCutoff / sampleRate;
  let cosW0: f32 = f32(Math.cos(f64(w0)));
  let sinW0: f32 = f32(Math.sin(f64(w0)));
  let alpha: f32 = sinW0 / (2.0 * safeRes);

  // Coefficients
  let b0: f32 = (1.0 - cosW0) / 2.0;
  let b1: f32 = 1.0 - cosW0;
  let b2: f32 = (1.0 - cosW0) / 2.0;
  let a0: f32 = 1.0 + alpha;
  let a1: f32 = -2.0 * cosW0;
  let a2: f32 = 1.0 - alpha;

  // Normalize by a0
  let invA0: f32 = 1.0 / a0;
  b0 *= invA0;
  b1 *= invA0;
  b2 *= invA0;
  a1 *= invA0;
  a2 *= invA0;

  // Filter State History
  let x1: f32 = 0.0;
  let x2: f32 = 0.0;
  let y1: f32 = 0.0;
  let y2: f32 = 0.0;

  let phase: f32 = 0.0;
  let phaseIncr: f32 = freq / sampleRate;

  for (let i = 0; i < totalSamples; i++) {
    let rawSample: f32 = 0.0;

    // 1. Generate Raw Oscillator Sample
    if (type == 0) { // Saw
      // 2 * (p - floor(p + 0.5))
      // Use simple modulo logic for robustness
      // p % 1.0
      let p: f64 = f64(phase);
      let saw: f64 = 2.0 * (p - Math.floor(p + 0.5));
      rawSample = f32(saw);
    } else if (type == 1) { // Square
       let p: f64 = f64(phase);
       // p - floor(p) gives 0..1
       let cycle: f64 = p - Math.floor(p);
       rawSample = cycle >= 0.5 ? -1.0 : 1.0;
    } else if (type == 2) { // Triangle
       let p: f64 = f64(phase);
       // 2 * abs(2 * (p - floor(p + 0.5))) - 1
       let saw: f64 = 2.0 * (p - Math.floor(p + 0.5));
       rawSample = f32(2.0 * Math.abs(saw) - 1.0);
    } else { // Sine (Default)
      rawSample = f32(Math.sin(2.0 * Math.PI * f64(phase)));
    }

    // 2. Apply Biquad Filter
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
