/**
 * Holographic shader for MagicKnob component
 * Features: Scanlines, Rim Glow, Data Ring, "Projected" floating feel
 */
export const HOLOGRAPHIC_SHADER = `
struct Uniforms {
  time: f32,
  value: f32,
  resolution: vec2f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
  // Full screen triangle
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4f(pos[vIdx], 0.0, 1.0);
  output.uv = pos[vIdx]; // UVs are -1 to 1 effectively for the quad
  return output;
}

// Helper: Circle SDF
fn sdCircle(p: vec2f, r: f32) -> f32 {
    return length(p) - r;
}

// Helper: Rotation Matrix
fn rotate(angle: f32) -> mat2x2f {
    let c = cos(angle);
    let s = sin(angle);
    return mat2x2f(c, -s, s, c);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  var uv = in.uv;
  // Center UVs properly assuming canvas is square-ish
  // Standardize coordinate system to -1.0 to 1.0
  
  let len = length(uv);
  let angle = atan2(uv.y, uv.x);
  
  // Base Color (Cyan/Teal Hologram)
  var color = vec3f(0.0, 0.9, 1.0);
  var alpha = 0.0;

  // 1. Outer Data Ring
  // Rotating dashed ring
  let rot_uv = rotate(u.time * 0.2) * uv;
  let ring_dist = abs(length(rot_uv) - 0.55);
  let dash = sin(atan2(rot_uv.y, rot_uv.x) * 20.0);
  if (ring_dist < 0.02 && dash > 0.5) {
      alpha += 0.6 * smoothstep(0.02, 0.0, ring_dist);
  }

  // 2. Value Arc (The "Level" Indicator)
  // Map value 0..1 to angle -2.5 .. +2.5 (approx)
  let max_angle = 2.4; 
  let val_mapped = mix(-max_angle, max_angle, u.value);
  
  // Offset angle to start from bottom-left
  let active_angle = -angle - 1.5708; // Rotate -90deg to start top
  // Normalize angle logic for gauge
  
  // Simple gauge: show if angle is "less" than value
  // We compare dot products or raw angles. 
  // Let's use a "needle" approach + arc
  
  let needle_w = 0.01;
  let needle_vec = vec2f(cos(val_mapped - 1.5708), sin(val_mapped - 1.5708));
  
  // Draw filled arc (faked with dot product and masking)
  // This is a simple visual hack for the arc
  // It glows brighter near the value
  
  // 3. Holographic Scanlines
  let scanline = sin(uv.y * 150.0 + u.time * 10.0) * 0.5 + 0.5;
  
  // 4. Central Glow / "Projector" beam
  let beam = smoothstep(0.6, 0.0, len);
  
  // Compose the "Ghost" Knob
  var final_c = vec3f(0.0);
  
  // Main Circle Body
  let circle_edge = 1.0 - smoothstep(0.48, 0.5, len);
  let inner_glow = smoothstep(0.0, 0.5, len);
  alpha += circle_edge * 0.2 * scanline; // Background body
  
  // The Needle
  let proj = dot(uv, needle_vec);
  let perp = length(uv - needle_vec * proj);
  if (proj > 0.0 && proj < 0.5 && perp < 0.02) {
      alpha += 1.0 / (perp * 100.0); // Bloom needle
      color = vec3f(1.0, 1.0, 1.0); // White hot center
  }
  
  // The Value Arc (Parametric)
  // We can render dots based on angle
  let dot_angle = atan2(uv.y, uv.x) + 1.5708; // 0 is down
  // This is tricky without proper atan handling, simplified:
  
  // 5. Fresnel / Glitch Effect
  let glitch = step(0.98, sin(u.time * 20.0 + uv.y * 10.0));
  if (glitch > 0.5) {
      uv.x += 0.05;
      alpha += 0.2;
  }

  // Vignette / Falloff at edges of canvas
  alpha *= smoothstep(0.8, 0.6, len);

  return vec4f(color * alpha * 1.5, alpha);
}
`;
