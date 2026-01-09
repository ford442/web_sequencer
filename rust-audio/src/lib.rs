use wasm_bindgen::prelude::*;
use std::f32::consts::PI;
use js_sys::Float32Array; // <--- Moved import to top level

// We optimize for size and speed
#[wasm_bindgen]
pub fn generate_rust_wave(
    sample_rate: f32,
    freq: f32,
    duration: f32,
    wave_type: i32, // 0 = Saw, 1 = Square
    cutoff: f32,
    resonance: f32
) -> Float32Array {
    let num_samples = (sample_rate * duration) as usize;
    let mut buffer = Vec::with_capacity(num_samples);

    // Filter Coefficients
    let safe_cutoff = cutoff.min(sample_rate / 2.1).max(20.0);
    let safe_res = resonance.max(0.1);
    let w0 = 2.0 * PI * safe_cutoff / sample_rate;
    let cos_w0 = w0.cos();
    let sin_w0 = w0.sin();
    let alpha = sin_w0 / (2.0 * safe_res);

    let a0 = 1.0 + alpha;
    let inv_a0 = 1.0 / a0;
    let b0 = ((1.0 - cos_w0) / 2.0) * inv_a0;
    let b1 = (1.0 - cos_w0) * inv_a0;
    let b2 = ((1.0 - cos_w0) / 2.0) * inv_a0;
    let a1 = (-2.0 * cos_w0) * inv_a0;
    let a2 = (1.0 - alpha) * inv_a0;

    let mut x1 = 0.0;
    let mut x2 = 0.0;
    let mut y1 = 0.0;
    let mut y2 = 0.0;

    let mut phase = 0.0;
    let phase_incr = freq / sample_rate;

    for _ in 0..num_samples {
        // Sample Generation
        let sample = if wave_type == 0 {
            // Sawtooth
            2.0 * phase - 1.0
        } else {
            // Square
            if phase < 0.5 { 1.0 } else { -1.0 }
        };

        // Apply Filter
        let filtered = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        // Shift Filter State
        x2 = x1;
        x1 = sample;
        y2 = y1;
        y1 = filtered;

        buffer.push(filtered);

        // Increment Phase
        phase += phase_incr;
        if phase >= 1.0 {
            phase -= 1.0;
        }
    }

    // Convert to JS Float32Array
    Float32Array::from(buffer.as_slice())
}
