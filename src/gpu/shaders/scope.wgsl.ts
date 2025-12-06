/**
 * Compute shader for generating scope waveform data
 */
export const SCOPE_COMPUTE_SHADER = `
struct Params {
  waveform: u32,       // 0: saw, 1: square, 2: tri, 3: sine
  frequency: f32,      // normalized frequency for viz
  filterCutoff: f32,   // normalized 0-1
  filterRes: f32,      // raw value
  attack: f32,
  decay: f32,
  volume: f32,
  time: f32,           // animation time
}

struct Point {
  position: vec2<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<Point>;

const PI: f32 = 3.14159265359;

// Helper: Basic Oscillators
fn saw(t: f32) -> f32 { return 2.0 * (t - floor(t + 0.5)); }
fn square(t: f32) -> f32 { return select(-1.0, 1.0, fract(t) < 0.5); }
fn tri(t: f32) -> f32 { return 2.0 * abs(2.0 * (t - floor(t + 0.5))) - 1.0; }
fn sine(t: f32) -> f32 { return sin(2.0 * PI * t); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  let totalPoints = 1024u; // Must match WORKGROUP_SIZE * dispatch count
  
  if (index >= totalPoints) { return; }

  // Normalized X (0.0 to 1.0)
  let x = f32(index) / f32(totalPoints);
  
  // Calculate Waveform
  // We zoom out a bit to show a few cycles based on frequency
  let t = x * (1.0 + params.frequency * 10.0) + params.time; 
  
  var amplitude: f32 = 0.0;
  // Note: switch case works with u32 in WGSL
  switch (params.waveform) {
    case 0u: { amplitude = saw(t); }
    case 1u: { amplitude = square(t); }
    case 2u: { amplitude = tri(t); }
    case 3u: { amplitude = sine(t); }
    default: { amplitude = 0.0; }
  }

  // Simple Filter Simulation (Visual approximation)
  // If cutoff is low, we smooth out the signal (simple mix towards sine/0)
  let cutoffFactor = params.filterCutoff / 15000.0; // Normalize
  amplitude = mix(sine(t) * 0.5, amplitude, clamp(cutoffFactor * 2.0, 0.0, 1.0));

  // Envelope Simulation (Visual)
  // We visualize the attack/decay curve over the X axis
  var env: f32 = 1.0;
  let attackEnd = params.attack * 0.5;
  let decayEnd = attackEnd + params.decay * 0.5;
  
  if (x < attackEnd) {
    env = x / attackEnd;
  } else if (x < decayEnd) {
    env = 1.0 - ((x - attackEnd) / (params.decay * 0.5)) * (1.0 - 0.5); // Decay to sustain level 0.5
  } else {
    env = 0.5; // Sustain
  }

  // Apply Volume and Envelope
  let y = amplitude * params.volume * env;

  // Write to Storage Buffer (Mapped to Vertex Shader input)
  // X range: -1 to 1, Y range: -1 to 1
  outputBuffer[index].position = vec2<f32>(x * 2.0 - 1.0, y * 0.9);
}
`;

/**
 * Render shader for displaying scope waveform
 */
export const SCOPE_RENDER_SHADER = `
struct Point {
  position: vec2<f32>,
}

@group(0) @binding(1) var<storage, read> inputBuffer: array<Point>;

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) color : vec4<f32>,
}

@group(0) @binding(2) var<uniform> accentColor: vec4<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  let point = inputBuffer[vertexIndex];
  var output : VertexOutput;
  output.Position = vec4<f32>(point.position, 0.0, 1.0);
  output.color = accentColor; 
  return output;
}

@fragment
fn fs_main(@location(0) color : vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;
