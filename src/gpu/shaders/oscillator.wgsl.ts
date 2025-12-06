/**
 * Compute shader for WebGPU Oscillator
 * Generates raw audio samples for different waveform types
 */
export const OSCILLATOR_SHADER = `
struct Uniforms {
    sampleRate: f32,
    frequency: f32,
    duration: f32,
    waveType: u32, // 0: Saw, 1: Square, 2: Triangle, 3: Sine
};

@group(0) @binding(0) var<uniform> params: Uniforms;
@group(0) @binding(1) var<storage, read_write> audioBuffer: array<f32>;

const PI: f32 = 3.14159265359;

fn oscSine(phase: f32) -> f32 {
    return sin(2.0 * PI * phase);
}

fn oscSaw(phase: f32) -> f32 {
    return 2.0 * fract(phase) - 1.0;
}

fn oscSquare(phase: f32) -> f32 {
    return step(0.5, fract(phase)) * -2.0 + 1.0;
}

fn oscTriangle(phase: f32) -> f32 {
    return 2.0 * abs(2.0 * fract(phase) - 1.0) - 1.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;

    // Calculate total samples needed
    let totalSamples = u32(params.sampleRate * params.duration);

    if (index >= totalSamples) {
        return;
    }

    // Time in seconds
    let t = f32(index) / params.sampleRate;
    let phase = t * params.frequency;

    var sample: f32 = 0.0;
    switch (params.waveType) {
        case 0u: { sample = oscSaw(phase); }
        case 1u: { sample = oscSquare(phase); }
        case 2u: { sample = oscTriangle(phase); }
        case 3u: { sample = oscSine(phase); }
        default: { sample = 0.0; }
    }

    audioBuffer[index] = sample;
}
`;
