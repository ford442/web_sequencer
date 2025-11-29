// assembly/oscillators.ts
@inline const PI: f32 = 3.14159265359;

export function generate(offset: i32, sampleRate: f32, freq: f32, duration: f32, type: i32): i32 {
  let totalSamples: i32 = i32(sampleRate * duration);
  let phase: f32 = 0.0;
  let phaseIncr: f32 = freq / sampleRate;

  for (let i = 0; i < totalSamples; i++) {
    let sample: f32 = 0.0;
    // 0: Saw, 1: Square, 2: Triangle, 3: Sine
    if (type == 0) {
      sample = 2.0 * (phase - floor(phase)) - 1.0;
    } else if (type == 1) {
      let p = phase - floor(phase);
      sample = (p >= 0.5 ? 1.0 : 0.0) * -2.0 + 1.0;
    } else if (type == 2) {
      let p = phase - floor(phase);
      sample = f32(2.0 * abs(2.0 * p - 1.0) - 1.0);
    } else if (type == 3) {
      sample = f32(Math.sin(2.0 * PI * phase));
    }
    store<f32>(offset + (i * 4), sample);
    phase += phaseIncr;
  }
  return totalSamples;
}
