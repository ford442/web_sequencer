/**
 * WGSL for the physical knob cap (#1581): a height-field cap lit with
 * Blinn-Phong, knurl + brushed top that turn with the value, a fixed specular
 * highlight, a contact shadow and a glowing LED value arc on the panel.
 *
 * Only materials with a `cap` use this; the holographic shader in
 * KnobGPUContext.ts is untouched, so `buildKnobShaderCode(KNOB_MATERIAL)`
 * stays byte-identical. Output is premultiplied alpha to match the canvas
 * `alphaMode: 'premultiplied'` swapchain. Coordinates and radii mirror the
 * Canvas 2D twin in knobCapRender.ts (same `KNOB_CAP_FRAME`).
 */
import { KNOB_CAP_FRAME } from './knobCapRender';
import {
    normalizedLightDir,
    resolveKnobCap,
    resolveKnobLighting,
    resolveTickPositions,
    rgbToWgsl,
    tickAnglesToWgslArray,
    tickMajorFlagsToWgslArray,
} from './knobMaterial';
import type { KnobMaterial } from './knobMaterial';

const f = (n: number) => {
    const s = n.toFixed(4);
    return s === '-0.0000' ? '0.0000' : s;
};

/** Full WGSL module (uniforms, vertex, cap fragment) or null without a cap. */
export function buildKnobCapShaderCode(material: KnobMaterial): string | null {
    const cap = resolveKnobCap(material);
    if (!cap) return null;
    const lighting = resolveKnobLighting(material);
    const [lx, ly, lz] = normalizedLightDir(lighting);
    const g = material.geometry;
    const ring = lighting.ledRing;
    const pointerBase = material.pointer?.base ?? material.palette.needle;
    const tickCount = resolveTickPositions(material).length;
    const tickR = material.scale?.tickRadius ?? g.arcRadius;
    const minorHalf = (material.scale?.tickLength ?? 0.06) * 0.5;
    const majorHalf = (material.scale?.majorTickLength ?? 0.09) * 0.5;
    const shadow = lighting.dropShadow;

    return `
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
      var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOutput;
      output.position = vec4f(pos[vIdx], 0.0, 1.0);
      output.uv = pos[vIdx];
      return output;
    }

    // Premultiplied "over".
    fn over(dst: vec4f, c: vec3f, a: f32) -> vec4f {
      let k = clamp(a, 0.0, 1.0);
      return vec4f(c * k + dst.rgb * (1.0 - k), k + dst.a * (1.0 - k));
    }

    fn hash11(x: f32) -> f32 {
      return fract(sin(x * 12.9898) * 43758.5453);
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4f {
      // Body-radius units, y up, angles: 0 = up, + = clockwise (knobMaterial convention).
      let p = in.uv / ${f(KNOB_CAP_FRAME)};
      let r = length(p);
      let px = 2.0 / (max(min(u.resolution.x, u.resolution.y), 1.0) * ${f(KNOB_CAP_FRAME)});
      let pix = atan2(p.x, p.y);
      let sweep_start = ${f(g.sweepStartAngle)};
      let sweep_end = ${f(g.sweepStartAngle + g.sweepTotal)};
      let val_angle = sweep_start + clamp(u.value, 0.0, 1.0) * ${f(g.sweepTotal)};
      let L = normalize(vec3f(${f(lx)}, ${f(-ly)}, ${f(lz)}));
      var acc = vec4f(0.0);

      // 1. LED track + lit value arc printed on the panel.
      let arc_r = ${f(g.arcRadius)};
      let arc_hw = 0.035;
      let in_sweep = pix >= sweep_start && pix <= sweep_end;
      let arc_d = abs(r - arc_r);
      let arc_cov = (1.0 - smoothstep(arc_hw - px, arc_hw + px, arc_d)) * select(0.0, 1.0, in_sweep);
      acc = over(acc, ${rgbToWgsl(material.palette.ring)}, arc_cov * 0.9);
      let lit = select(0.0, 1.0, in_sweep && pix <= val_angle && u.value > 0.001);
      let arc_t = clamp((pix - sweep_start) / max(val_angle - sweep_start, 0.001), 0.0, 1.0);
      let arc_col = mix(${rgbToWgsl(material.palette.arcMin)}, ${rgbToWgsl(material.palette.arcMax)}, arc_t);
      let glow_w = ${f(ring?.width ?? 0.06)};
      let glow = exp(-(arc_d * arc_d) / (glow_w * glow_w)) * lit * ${f(Math.min(1, 0.4 * (ring?.intensity ?? 1)))};
      acc = over(acc, arc_col, glow);
      acc = over(acc, arc_col, arc_cov * lit);

      // 2. Silkscreen scale ticks.
      let tick_angles = ${tickAnglesToWgslArray(material)};
      let tick_major = ${tickMajorFlagsToWgslArray(material)};
      for (var ti = 0u; ti < ${tickCount}u; ti++) {
          let ta = tick_angles[ti];
          let dir = vec2f(sin(ta), cos(ta));
          let along = dot(p, dir);
          let perp = abs(dot(p, vec2f(dir.y, -dir.x)));
          let half_len = mix(${f(minorHalf)}, ${f(majorHalf)}, tick_major[ti]);
          let half_w = mix(0.012, 0.02, tick_major[ti]);
          let len_cov = 1.0 - smoothstep(half_len - px, half_len + px, abs(along - ${f(tickR)}));
          let w_cov = 1.0 - smoothstep(half_w - px, half_w + px, perp);
          let tick_col = mix(${rgbToWgsl(material.palette.scaleMinor)}, ${rgbToWgsl(material.palette.scaleMajor)}, tick_major[ti]);
          acc = over(acc, tick_col, len_cov * w_cov * select(0.0, 1.0, along > 0.0));
      }

      // 3. Contact shadow below the cap.
      let cap_r = ${f(cap.radius)};
      let sh_d = length(p - vec2f(0.0, ${f(-shadow.offsetY * cap.radius)})) - cap_r;
      let sh = (1.0 - smoothstep(${f(-shadow.blur * cap.radius * 0.5)}, ${f(shadow.blur * cap.radius)}, sh_d)) * ${f(shadow.opacity)};
      acc = over(acc, vec3f(0.0), sh);

      // 4. Cap: height field -> normal -> Blinn-Phong.
      let q = p / cap_r;
      let rq = length(q);
      if (rq < 1.0 + px / cap_r) {
          let top = ${f(cap.topRadius)};
          let qn = q / max(rq, 0.0001);
          let skirt_t = smoothstep(top, top + 0.06, rq);
          let bevel_t = smoothstep(${f(1 - cap.bevel)}, 1.0, rq);
          var n = normalize(vec3f(qn * (0.35 * skirt_t + 1.6 * bevel_t), 1.0));

          // Knurl ridges: tangential normal ripple that turns with the value.
          let local_ang = atan2(q.x, q.y) - val_angle;
          let knurl = sin(local_ang * ${f(cap.knurlCount)}) * skirt_t * (1.0 - 0.6 * bevel_t);
          n = normalize(n + vec3f(vec2f(qn.y, -qn.x) * knurl * 0.45, 0.0));

          let H = normalize(L + vec3f(0.0, 0.0, 1.0));
          let diff = max(dot(n, L), 0.0);
          let spec = pow(max(dot(n, H), 0.0), ${f(lighting.specularPower)}) * ${f(lighting.specularStrength)};

          // Brushed-metal top: streaks fixed to the cap, so they rotate with it.
          let cs = cos(val_angle);
          let sn = sin(val_angle);
          let lq = vec2f(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
          let streak = hash11(floor(lq.y * 160.0) + 7.0);
          let fine = hash11(floor(lq.y * 523.0) + floor(lq.x * 3.0) * 17.0);
          let brush = 0.82 + 0.12 * streak + 0.06 * fine;
          let brush_dir = vec2f(cs, -sn);
          let lxy = normalize(L.xy + vec2f(0.0001, 0.0));
          let sheen = pow(1.0 - abs(dot(brush_dir, lxy)), 4.0) * 0.35;
          let is_top = 1.0 - smoothstep(top - 0.015, top + 0.015, rq);
          let top_col = ${rgbToWgsl(cap.topColor)} * brush * (${f(lighting.ambient)} + 0.75 * max(L.z, 0.0)) + vec3f(sheen);
          let skirt_col = ${rgbToWgsl(cap.body)} * (${f(lighting.ambient)} + diff) + vec3f(spec);
          var cap_col = mix(skirt_col, top_col, is_top);

          // Groove where the top sits in the skirt.
          let gq = (rq - top) / 0.025;
          cap_col = cap_col * (1.0 - 0.6 * exp(-gq * gq));

          // Pointer line on the top.
          let nd = vec2f(sin(val_angle), cos(val_angle));
          let n_along = dot(p, nd);
          let n_perp = abs(dot(p, vec2f(nd.y, -nd.x)));
          let n_hw = ${f(cap.radius * 0.0425)};
          let needle_cov = (1.0 - smoothstep(n_hw - px, n_hw + px, n_perp))
              * step(${f(cap.radius * 0.14)}, n_along)
              * (1.0 - smoothstep(${f(g.needleLength)} - px, ${f(g.needleLength)} + px, n_along));
          cap_col = mix(cap_col, ${rgbToWgsl(pointerBase)}, needle_cov);

          // Fixed specular highlight (follows the light, not the value).
          let hl_c = vec2f(${f(lx)}, ${f(-ly)}) * top * 0.45;
          let hd = q - hl_c;
          cap_col = cap_col + vec3f(exp(-dot(hd, hd) / 0.05) * 0.28 * is_top);

          // 1px rim highlight on the skirt edge.
          let rim_d = abs(rq * cap_r - (cap_r - px));
          cap_col = cap_col + vec3f(${f(cap.rimHighlight)} * (1.0 - smoothstep(0.0, px, rim_d)));

          let cap_cov = 1.0 - smoothstep(1.0 - px / cap_r, 1.0 + px / cap_r, rq);
          acc = over(acc, clamp(cap_col, vec3f(0.0), vec3f(1.0)), cap_cov);
      }

      return acc;
    }
`;
}
