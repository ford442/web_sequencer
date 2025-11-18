import React, { useRef, useEffect } from 'react';

interface MagicKnobProps {
  value: number; // 0.0 to 1.0
  min?: number;
  max?: number;
  label?: string;
  size?: number;
  onChange?: (val: number) => void;
}

export const MagicKnob: React.FC<MagicKnobProps> = ({
  value,
  min = 0,
  max = 100,
  label = "PLASMA",
  size = 100,
  onChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Interaction Logic (Mouse Drag) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;

    let isDragging = false;
    let startY = 0;
    let startVal = 0;

    const onDown = (e: MouseEvent) => {
      isDragging = true;
      startY = e.clientY;
      startVal = value;
      document.body.style.cursor = 'ns-resize';
    };

    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dy = startY - e.clientY;
      const range = max - min;
      // Sensitivity: full range over 200px
      const delta = (dy / 200) * range;
      let newVal = startVal + delta;
      newVal = Math.max(min, Math.min(max, newVal));
      onChange(newVal);
    };

    const onUp = () => {
      isDragging = false;
      document.body.style.cursor = 'default';
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [value, min, max, onChange]);

  // --- WebGPU Rendering Logic ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let context: GPUCanvasContext | null = null;
    let device: GPUDevice | null = null;
    let pipeline: GPURenderPipeline | null = null;
    let uniformBuffer: GPUBuffer | null = null;
    let animationId: number;

    const init = async () => {
      if (!navigator.gpu) {
        console.error("WebGPU not supported");
        return;
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return;

      device = await adapter.requestDevice();
      context = canvas.getContext('webgpu') as GPUCanvasContext;

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format });

      // --- The Magical WGSL Shader ---
      const shaderCode = `
        struct Uniforms {
          time: f32,
          value: f32, // Normalized 0-1
          resolution: vec2f,
        };
        @group(0) @binding(0) var<uniform> u: Uniforms;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
          // Create a full-screen quad from 3 vertices (large triangle)
          var pos = array<vec2f, 3>(
            vec2f(-1.0, -1.0),
            vec2f(3.0, -1.0),
            vec2f(-1.0, 3.0)
          );
          var output: VertexOutput;
          output.position = vec4f(pos[vIdx], 0.0, 1.0);
          output.uv = pos[vIdx]; // -1 to 3 coordinate space
          return output;
        }

        // --- SDF & Noise Functions ---

        fn sdfCircle(p: vec2f, r: f32) -> f32 {
          return length(p) - r;
        }

        // Simple hash for noise
        fn hash(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
        }

        fn noise(p: vec2f) -> f32 {
          let i = floor(p);
          let f = fract(p);
          let u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
                     mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
        }

        fn fbm(p: vec2f) -> f32 {
          var v = 0.0;
          var a = 0.5;
          var shift = vec2f(100.0);
          var pos = p;
          // Rotate to avoid artifacts
          let rot = mat2x2f(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
          for (var i = 0; i < 5; i++) {
            v += a * noise(pos);
            pos = rot * pos * 2.0 + shift;
            a *= 0.5;
          }
          return v;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4f {
          // Center UVs to -1.0 to 1.0, corrected for aspect
          var uv = in.uv;
          // Since we are in a square canvas, UV is fine as is for -1..1 range if canvas is square
          
          let center = vec2f(0.0, 0.0);
          let dist = length(uv);
          let angle = atan2(uv.y, uv.x);

          // --- 1. The Bezel (Skeuomorphic Metal) ---
          let radius_outer = 0.85;
          let radius_inner = 0.65;
          let d_ring = abs(dist - (radius_outer + radius_inner) * 0.5) - (radius_outer - radius_inner) * 0.5;

          var color = vec3f(0.05); // Dark background

          if (d_ring < 0.0) {
             // We are inside the metal ring
             // Radial brushed metal effect using noise on the angle
             let brush = noise(vec2f(angle * 20.0, 0.0)) * 0.1;
             
             // Fake specular highlight (light coming from top-left)
             let normal = normalize(vec3f(uv, 1.0)); // Fake sphere normal
             let light = normalize(vec3f(-0.5, 0.8, 1.0));
             let spec = pow(max(dot(normal, light), 0.0), 20.0);
             
             // Base metal color (Dark Anodized Steel) + Highlights
             color = vec3f(0.15, 0.16, 0.18) + vec3f(brush) + vec3f(spec * 0.4);
             
             // Knurling texture (ridges on the side)
             if (dist > 0.8) {
                let knurl = sin(angle * 60.0);
                color += vec3f(knurl * 0.05);
             }
          }

          // --- 2. The Plasma Core (Futuristic Magic) ---
          if (dist < radius_inner) {
             let t = u.time * 0.5;
             
             // Domain Warping for "Magic" look
             var q = vec2f(0.0);
             q.x = fbm( uv + vec2f(0.0,0.0) );
             q.y = fbm( uv + vec2f(5.2,1.3) );

             var r = vec2f(0.0);
             r.x = fbm( uv + 4.0*q + vec2f(t, 9.2) );
             r.y = fbm( uv + 4.0*q + vec2f(8.3, 2.8*t) );

             let f = fbm( uv + 4.0*r );

             // Color Palette (Electric Blue + Magenta)
             let c1 = vec3f(0.1, 0.0, 0.3); // Deep purple base
             let c2 = vec3f(0.0, 0.8, 0.9); // Cyan
             let c3 = vec3f(1.0, 0.0, 0.5); // Magenta highlights
             
             // Mix based on noise intensity
             var plasma = mix(c1, c2, f);
             plasma = mix(plasma, c3, length(r));
             
             // Darken edges of the glass
             let vignette = smoothstep(radius_inner, 0.0, dist);
             color = plasma * vignette * 1.5; // 1.5 for glow intensity
          }

          // --- 3. The Indicator (Laser Beam) ---
          // Calculate angle for the value (mapped -135 to +135 degrees)
          let val_norm = u.value; // 0 to 1
          let val_angle = mix(-2.356, 2.356, val_norm) - 1.5708; // -135 to 135 rads, rotated 90deg
          
          // Distance from the needle line
          let needle_uv = vec2f(cos(val_angle), sin(val_angle));
          // Project pixel onto needle vector
          let proj = dot(uv, needle_uv);
          let perp_dist = length(uv - needle_uv * proj);
          
          if (proj > 0.0 && proj < radius_inner && perp_dist < 0.02) {
             color += vec3f(1.0, 1.0, 1.0); // White hot center
             color += vec3f(0.0, 0.8, 1.0) * (0.05 / perp_dist); // Blue Glow
          }

          return vec4f(color, 1.0);
        }
      `;

      // --- Pipeline Setup ---
      const module = device.createShaderModule({ code: shaderCode });
      pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' }
      });

      // Uniform Buffer
      uniformBuffer = device.createBuffer({
        size: 16 + 4 + 8, // time(f32), value(f32), res(vec2f) + padding
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
    };

    const render = () => {
      if (!context || !device || !pipeline || !uniformBuffer) return;

      // Update Uniforms
      const now = performance.now() / 1000;
      const normalizedValue = (value - min) / (max - min);
      const uniforms = new Float32Array([
        now,                // time
        normalizedValue,    // value
        canvas.width,       // resolution.x
        canvas.height       // resolution.y
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store'
        }]
      });

      pass.setPipeline(pipeline);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      });
      pass.setBindGroup(0, bindGroup);
      pass.draw(3); // Draw 1 triangle (covers screen)
      pass.end();

      device.queue.submit([encoder.finish()]);
      animationId = requestAnimationFrame(render);
    };

    init().then(() => {
      render();
    });

    return () => cancelAnimationFrame(animationId);
  }, [value, min, max]); // Re-render when value changes (for smooth updates, value is also passed to loop)

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        style={{ width: size, height: size, borderRadius: '50%' }}
        title={label}
      />
      <span className="text-xs font-orbitron text-cyan-400 mt-1">{label}</span>
    </div>
  );
};
