# Expandable hardware chassis (#1580)

The main instrument panels can sit inside one **transforming white hardware chassis**: a rounded white body with a fixed LED step strip on top, a fixed key bed at the bottom, and a stage between them that grows and narrows as you move between oscillator, drum, sampler, TTS, Voice Designer and PCF interfaces. It is meant to read as one instrument changing shape, not a stack of separate floating panels.

Everything is **opt-in**. Without the flag the app renders exactly as before.

| Try it | URL |
|---|---|
| Live app inside the chassis | `/?chassis=white` (also `?chassis` or `?chassis=1`) |
| Review page (no audio boot) | `/?visual-review=1` → *Expandable hardware chassis*, *Knob caps*, *Oscillator panel art* |

![Chassis, oscillator mode](chassis/chassis-osc.webp)
![Chassis, Voice Designer mode — wider and deeper stage, same anchors](chassis/chassis-vd.webp)
![Live app under ?chassis=white](chassis/live.webp)

---

## How it is opted into

There are three switches, and each is scoped:

1. **`data-chassis="white"`** turns on the tokens and materials in `src/styles/chassis.css`. Every rule there is scoped under the attribute or under `.hyphon-chassis*` / `.hyphon-osc-art*` / `.hyphon-knob-led` classes that only chassis components render.
2. **`ChassisKnobMaterialContext`** (`src/components/chassis/chassisContext.ts`) is provided by `HardwareChassis` around its stage. `HardwareModule` reads it, so every rack module on the stage gets `KNOB_MATERIAL_CHASSIS` knobs and status LEDs with no new props at the call sites. `<ChassisOnly>` renders its children only on a stage. The oscillator panel art and the selector icons use it.
3. **`KnobMaterial.cap`**: a material with a `cap` renders a physical knob in all three knob renderers. `KNOB_MATERIAL` has no cap, so default knobs are unchanged. The default WGSL is byte-identical; the inline snapshot in `wgsl.contract.test.ts` pins it.

No event handlers on knobs, step buttons, pads or keys were added, removed or reordered. Styling uses classes and `data-*` attributes only.

---

## Files

| File | Role |
|---|---|
| `src/styles/chassis.css` | `[data-chassis="white"]` tokens (#1589), body / well / silkscreen / pad materials, container + stage morph, rack-panel overrides, panel-art frame, knob LED, reduced-motion + forced-colors blocks |
| `src/components/chassis/HardwareChassis.tsx` | The container (#1584): head (brand, print rule, mode keys, LCD badge), LED-strip well, morphing stage, key-bed well |
| `src/components/chassis/chassisModes.ts` | Modes, footprints, track → mode mapping, `?chassis` parser |
| `src/components/chassis/ChassisLedStrip.tsx` | Presentational 32-step silicone pad strip (`data-on` / `data-playhead`) |
| `src/components/chassis/OscillatorPanelArt.tsx` | `public/osc/*.webp` artwork per family (#1583): `header` faceplate or `backdrop` (controls on top) |
| `src/components/chassis/OscillatorSignatureIcon.tsx` | One 16×16 glyph per family (#1587), `currentColor` |
| `src/components/chassis/chassisContext.ts`, `ChassisOnly.tsx` | Stage context + guard |
| `src/components/appParts/ChassisNode.tsx` | Live layout: sequencer = top anchor, rack = stage, keyboard = bottom anchor. Lazy-loaded; the three live nodes are passed in from `App.tsx` (like `Studio3D`), so they stay in the entry bundle |
| `src/components/knobCapRender.ts` | Canvas 2D cap layers (static / dynamic split) |
| `src/components/knobCapShader.ts` | WGSL cap fragment |
| `src/components/KnobCapSvg.tsx` | Classic-mode SVG cap |
| `src/components/ui/ChassisShowcase.tsx`, `ChassisMaterialsShowcase.tsx` | Review sections |

---

## Modes and footprints

The LED strip and key bed never move. Only `--chassis-stage-h` (stage height) and `--chassis-max-w` (body width) change, through CSS transitions (420 ms, `cubic-bezier(.22,.9,.24,1)`). When the hosted panel changes, a Web Animations entry (fade and a 10 px rise) plays on the stage **without remounting** it, so panel state and GPU knob slots survive. `panelKey` replays it inside one mode, for example Synth A → Synth B.

| Mode | Code | Stage (px) | Compact (px) | Body max width (px) | Live today |
|---|---|---|---|---|---|
| Oscillator | OSC | 380 | 320 | 1000 | ✅ Synth A / Synth B / Bass 2 |
| Drum voice | DRM | 340 | 290 | 1000 | ✅ Kick / Snare / hats |
| Sampler | SMP | 420 | 340 | 1000 | ✅ Sampler |
| Voice / TTS | TTS | 460 | 360 | 1060 | showcase only |
| Voice Designer | VD | 520 | 400 | 1180 | showcase only |
| Filter (PCF) | PCF | 320 | 270 | 1000 | showcase only |

The oscillator stage keeps the legacy rack height (380 px), so live panels do not reflow. The live mode keys select a track: OSC goes to Synth A (or keeps the current synth), DRM to Kick, SMP to Sampler. The LCD badge names the track and, for synths, the oscillator family with its signature icon.

---

## Knob caps (#1581)

`KNOB_MATERIAL_CHASSIS` has a black knurled cap with a brushed-metal top, a red LED value arc printed on the panel, grey silkscreen ticks and a soft contact shadow. Its `cap` and `lighting` blocks are read by all three renderers:

| Renderer | Path | Notes |
|---|---|---|
| WebGPU | `buildKnobShaderCode(material)` → `buildKnobCapShaderCode` | Height-field cap → normal → Blinn-Phong. Knurl and brush are fixed to the cap, so they **rotate with the value**. The specular highlight is fixed to the light. Premultiplied output. `KnobGPUContext.register(canvas, getValue, material)` compiles **one pipeline per material**, shared by every knob that uses it. |
| Canvas 2D | `buildKnob2DDrawCalls` → `buildKnobCapLayers` | Layered gradients. The **static layer** (track, ticks, shadow, skirt shading) is cached per material × size × DPR (48-entry LRU). Only the **dynamic layer** (lit arc, knurl, brushed top, pointer, highlight) replays on a value change. No background fill, so it composes on white or dark. |
| Classic SVG | `HardwareKnob mode="classic"` → `KnobCapSvg` | Gradients, `feDropShadow`, knurl ticks and a pointer in a rotating group, with a static highlight. `useId()` keeps gradient ids unique. |

Inside a chassis, `HardwareModule` also renders a small **status LED** at each knob's top-right in the part colour. It is lit when the parameter is automated, recording or receiving MIDI.

---

## Panel artwork (#1583) and icons (#1587)

`OSCILLATOR_PANEL_IMAGES` is now used. `oscillatorPanelImageUrl(type)` resolves it against Vite's `BASE_URL` (the build uses `./`, so it works under `/hyphon/`). `OSCILLATOR_PANEL_FOCUS` keeps each family's title or LCD in view when the art is cover-cropped. On the chassis stage, the oscillator column of Synth A, Synth B and Bass 2 gets a faceplate header that swaps (with a 320 ms fade) when the family changes. If a file is missing, the header falls back to the themed label instead of a broken image. `scripts/check-release-dist.mjs` still reads the `'/osc/…'` strings, so the map's format is unchanged.

`OscillatorTypeSelector` shows each family's signature icon next to its badge **only on a chassis stage**.

---

## Accessibility

- **Reduced motion**: the global rule in `accessibility.css` neutralises every CSS transition and animation here. `chassis.css` also drops the stage / art entry animations and the mode-key press transform. The Web Animations entry is skipped when `prefers-reduced-motion` is on (`getPrefersReducedMotion`).
- **Forced colors**: lit pads, the playhead pad, the pressed mode key and the knob LED get an outline or system colour, because `forced-colors` drops `box-shadow`.
- **Contrast** (`src/__tests__/chassisContrast.test.ts`): red print `#b3262e` on the body `#eceef0` is about 5.6:1. Muted print and body ink are ≥ 4.5:1. The owner's `--chassis-print-muted: #6b6f76` measured about 4.4:1 on the body, so it is darkened to `#575b62`.
- Mode keys are `aria-pressed` buttons in a labelled group. The LCD badge is `role="status"`. LEDs and decorative layers are `aria-hidden`. Knob sliders keep their names.

---

## Bundle impact

Measured with `vite build` against `main` (`f6894c7`):

- Code the default page now loads: about **+23 KB raw** (cap renderer + shader, art / icon components, chassis context). Measured as the entry plus its static import closure: 1,768,156 → 1,792,017 bytes.
- Entry chunk: 234,157 → 222,975 bytes brotli (budget 262,000). Rolldown moved a few modules into separate preloaded chunks, so the entry is smaller even though the total grew.
- `ChassisNode` + `HardwareChassis` are a lazy chunk fetched only under `?chassis`. The review sections are in the lazy `VisualStyleShowcase` chunk. They use `HardwareKnob`, not `HardwareModule`, on purpose: a static `HardwareModule` import from that chunk made Rolldown regroup the entry chunk (+47 KB raw).

---

## Status against the epic

| Sub-issue | State in this slice |
|---|---|
| #1589 tokens + materials | Tokens, body / well / silkscreen / label, step-pad material (chassis LED strip), contrast test. **Not yet:** the white-chassis rules for the live step grid (`SEQUENCER_STYLES`), `DrumPads` `data-hit` + `.live-pad`, `LiveKeyboard` `data-key` / `data-down` + scale LEDs. The live sequencer and key bed sit in dark wells for now. |
| #1581 knob 3D | Done: material contract, WGSL, Canvas 2D with cached static layers, classic SVG, LED dot, per-material GPU pipelines. |
| #1584 container + expansion | Done: `HardwareChassis`, modes / footprints, mode badge, compact layout, live `?chassis=white`. |
| #1583 `public/osc` panels | Done for the oscillator columns (header faceplate). The `backdrop` variant exists for full-panel art. |
| #1587 icons | Done: nine glyphs, used in the selector (on a chassis stage) and the LCD badge. |
| #1585 oscillator migration | Synth A / B / Bass 2 render on the chassis plate with chassis knobs, art and icons. The controls themselves are unchanged. |
| #1582 Sampler / TTS / Voice Designer | Sampler is live in SMP mode. TTS and VD footprints exist and are shown in the review page. **Not yet:** hosting the TTS phrase editor and the Voice Designer (today a modal) on the stage. |
| #1586 PCF + rest | PCF footprint exists. **Not yet:** hosting `PatchBayPcfPanel` on the stage. |
