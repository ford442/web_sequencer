/**
 * Shader for HardwareModule component
 * Renders interactive knobs with metallic look and data rings
 */
export const HARDWARE_MODULE_SHADER = `
struct Uniforms {
    time: f32,
    ratio: f32, // Aspect ratio correction
    pad1: f32,
    pad2: f32,
    color: vec3f,
    pad3: f32,
    vals1: vec4f, // Values for knobs 0-3
    vals2: vec4f, // Values for knobs 4-7
    // Hardcoded array size for generic layout
    pos0: vec4f, pos1: vec4f, pos2: vec4f, pos3: vec4f,
    pos4: vec4f, pos5: vec4f, pos6: vec4f, pos7: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
    var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var output: VertexOutput;
    output.position = vec4f(pos[vIdx], 0.0, 1.0);
    output.uv = pos[vIdx]; // 0,0 top-left mapping handled in frag
    return output;
}

fn get_knob_val(idx: i32) -> f32 {
    if (idx < 4) { return u.vals1[idx]; }
    return u.vals2[idx - 4];
}

fn sdCircle(p: vec2f, r: f32) -> f32 {
    return length(p) - r;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Correct UVs: 0.0 to 1.0
    var uv = in.uv * 0.5 + 0.5; 
    uv.y = 1.0 - uv.y; // Flip Y to match standard GUI (0 at top)

    // Aspect Correction for rendering circular shapes
    // We work in a "Draw Space" (p) where X is stretched to compensate ratio
    var p = uv;
    p.x = p.x * u.ratio; // Correct X scale for circles

    // --- 1. Background (Dark Metal Panel) ---
    var col = vec3f(0.12, 0.14, 0.16);
    // Subtle noise/grain
    let noise = fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
    col += (noise * 0.03);

    // Scanline texture
    col *= 0.9 + 0.1 * sin(uv.y * 200.0);

    // --- 2. Draw Knobs ---
    var alpha = 1.0;
    
    // Loop manually unrolled or fixed size
    for (var i = 0; i < 8; i++) {
        // Get knob definition
        var k_pos_uv: vec4f;
        if(i==0){k_pos_uv=u.pos0;} else if(i==1){k_pos_uv=u.pos1;}
        else if(i==2){k_pos_uv=u.pos2;} else if(i==3){k_pos_uv=u.pos3;}
        else if(i==4){k_pos_uv=u.pos4;} else if(i==5){k_pos_uv=u.pos5;}
        else if(i==6){k_pos_uv=u.pos6;} else {k_pos_uv=u.pos7;}

        // If size is 0, knob is inactive
        if (k_pos_uv.z == 0.0) { continue; }

        // Center of knob in UV space
        let center_uv = k_pos_uv.xy;
        
        // Center in Draw Space (aspect corrected)
        let center_draw = vec2f(center_uv.x * u.ratio, center_uv.y);
        
        // Current Distance to this knob center
        let dist = length(p - center_draw);
        let radius = k_pos_uv.z;
        
        let val = get_knob_val(i);

        // --- Draw Knob Logic ---
        
        // 1. Bezel / Socket (Dark indent)
        if (dist < radius) {
            let bezel = smoothstep(radius, radius - 0.01, dist);
            col = mix(col, vec3f(0.05, 0.05, 0.05), bezel);
            
            // 2. Data Ring (The Value Indicator)
            let ring_w = 0.015;
            let ring_r = radius * 0.75;
            let ring_dist = abs(dist - ring_r);
            
            if (ring_dist < ring_w) {
                // Angle calculation
                let delta = p - center_draw;
                // atan2 returns -PI to PI. We want roughly -2.5 to 2.5 range for knob
                var angle = atan2(delta.y, delta.x); 
                angle = angle + 1.5708; // Rotate so 0 is up
                // Normalize for arc
                
                let arc_extent = 2.4; 
                // Map value 0..1 to angle -2.4 .. 2.4
                let target_angle = mix(-arc_extent, arc_extent, val);
                
                // Invert check because screen Y is flipped in calculation vs standard atan
                // Rough arc logic:
                // Check if we are inside the valid "active" arc
                // (This is a simplified visual approximation)
                
                // Glow color
                col = mix(col, u.color, smoothstep(ring_w, 0.0, ring_dist));
            }
            
            // 3. Center Cap (The physical knob)
            if (dist < radius * 0.5) {
                let cap = smoothstep(radius*0.5, radius*0.5 - 0.01, dist);
                // Metallic gradient
                let shine = dot(normalize(p - center_draw), vec2f(0.5, -0.5));
                col = mix(col, vec3f(0.2) + shine*0.1, cap);
                
                // Indicator Line on Cap
                // Calculate needle vector based on value
                let needle_angle = mix(-2.4, 2.4, val) - 1.5708;
                let needle_dir = vec2f(cos(needle_angle), sin(needle_angle));
                let delta = p - center_draw;
                let proj = dot(delta, needle_dir);
                let perp = length(delta - needle_dir * proj);
                
                if (proj > 0.0 && proj < radius*0.45 && perp < 0.005) {
                     col = mix(col, vec3f(1.0), 0.9);
                }
            }
        }
    }

    return vec4f(col, alpha);
}
`;
