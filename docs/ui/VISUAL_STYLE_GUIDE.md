# Hyphon Visual Style Guide

> **Living reference** for the retro-Electribe + holographic UI identity.  
> Implementation: `src/styles/hyphon-theme.css`, `src/components/ui/`, `src/components/knobMaterial.ts`.

---

## Design pillars

1. **Chassis first** — dark gunmetal surfaces (`#0a0c0f` → `#111827`) with a single top-light bevel model.
2. **Glass rim** — faint cyan inner border (`--hyphon-border-glass`) on every major panel.
3. **Holographic accents** — module colors glow on active states; idle chrome stays muted.
4. **Two font roles** — Orbitron for display/transport; Roboto Mono for data, knob values, and labels.
5. **Metal + glass knobs** — `knobMaterial.ts` is the single source for arcs, ticks, needles (WebGPU + Canvas 2D).

---

## Color tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--hyphon-bg-deep` | `#050709` | App backdrop |
| `--hyphon-bg-chassis` | `#0a0c0f` | Rack shell, main areas |
| `--hyphon-bg-panel` | `#0d1014` | Toolbars, headers |
| `--hyphon-bg-inset` | `#0a0d10` | Sequencer, recessed wells |
| `--hyphon-bg-raised` | `#1a1d24` | Sampler body |
| `--hyphon-accent-cyan` | `#22d3ee` | Primary UI accent, Part A |
| `--hyphon-accent-pink` | `#f472b6` | Part B / automation view |
| `--hyphon-accent-yellow` | `#eab308` | Drums |
| `--hyphon-accent-purple` | `#a855f7` | Sampler |

Module RGB tuples for GPU knobs live in `src/constants/appDefaults.ts` (`COLOR_LEAD`, `COLOR_BASS`, etc.).

---

## Bevel & shadow model

All panels share one lighting direction (light from top-left):

```css
/* Outer depth */
box-shadow: var(--hyphon-shadow-panel);          /* 0 8px 32px rgba(0,0,0,0.6) */

/* Inner highlight (metal lip) */
box-shadow: var(--hyphon-shadow-inset-highlight); /* inset 0 1px 0 rgba(255,255,255,0.08) */

/* Glass rim (pseudo-element on .hyphon-chrome-panel) */
border: 1px solid var(--hyphon-border-glass);  /* cyan @ 12% */
```

**Do** use `.hyphon-chrome-panel`, `.hyphon-rack-shell`, `.hyphon-sequencer-shell` for new surfaces.  
**Don't** mix ad-hoc `shadow-xl` + `border-gray-700` without the glass rim.

---

## Typography

| Role | Font | Weight | Tracking | Example |
|------|------|--------|----------|---------|
| Panel title | Orbitron | 700 | `0.18em` | `PART A` |
| Transport / rack tabs | Orbitron | 700 | `0.12em` | `HYPHON`, `PLAY` |
| Knob labels | Roboto Mono | 700 | `0.12em` | `CUTOFF` |
| Values / data | Roboto Mono | 400–500 | normal | `74`, `120 Hz` |
| Section labels | Roboto Mono | 700 | `0.12em` | `TUNE`, `ROOT` |

Utility classes: `.hyphon-panel-title`, `.hyphon-section-label`, `.font-orbitron`.

---

## LED treatments

Use `<LedIndicator />` from `src/components/ui/PanelChrome.tsx`:

| Variant | Class | When |
|---------|-------|------|
| Off | `hyphon-led--off` | Inactive state |
| Active | `hyphon-led--{color}` + optional `hyphon-led--pulse` | Selected kit, recording |
| Size | `hyphon-led--sm` / `hyphon-led--md` | Inline vs prominent |

Glow uses `box-shadow: var(--hyphon-led-glow)` — never stack custom `shadow-[0_0_…]` on LEDs.

---

## Decorative hardware

| Component | Path | Usage |
|-----------|------|-------|
| `RackPanelChrome` | `ui/RackPanelChrome.tsx` | Corner screws + optional top vents |
| `RackScrew` | same | Individual screw (sticky mode for sequencer scroll) |
| `PanelVents` | same | Vent slot strip |
| `PanelTitleBar` | `ui/PanelChrome.tsx` | Unified module header |

**Applied in:** `HardwareModule`, `MainSequencer`, `Rack` (via shell classes).

Screw spec: 16×16px, `#374151` gradient, 45° slot, inset highlight.

---

## Knob family (metal + glass)

Canonical contract: `src/components/knobMaterial.ts`

| Element | Token / value | Notes |
|---------|---------------|-------|
| Body | `#0d0f13` | Recessed dark metal |
| Ring | `#00e5ff` | Module tint via GPU uniform |
| Arc sweep | 270° from 7:30 | Shared WGSL + Canvas |
| Needle | `hardware` variant | Shaded body + specular |
| Scale ticks | 7 ticks, majors at 0/50/100 | `scaleMinor` / `scaleMajor` palette |
| Detents | Dimples at majors | Optional snap per control |

CSS mirror tokens: `--hyphon-knob-ring`, `--hyphon-knob-arc-min`, etc.

---

## Toolbar patterns

Transport (`TransportToolbar`) and bottom bar (`BottomBar`) share:

- Shell: `.hyphon-toolbar-shell` / `.hyphon-toolbar-bottom`
- Grouped controls: `.hyphon-inset-well`
- Buttons: `.hyphon-btn` + variant (`--ghost`, `--accent-cyan`, `--accent-active`)

Focus ring: `focus-visible:ring-2 focus-visible:ring-cyan-500` with `ring-offset-[#0d1014]`.

---

## Optional surface textures

Toggle in **bottom bar** (`TX OFF` → `GRAIN` → `PCB`) or set `localStorage['hyphon-surface-texture']`.

| Mode | Class on `body` | Effect |
|------|-----------------|--------|
| off | — | None |
| grain | `hyphon-texture-grain` | SVG noise overlay @ 3.5% opacity |
| circuit | `hyphon-texture-circuit` | 24px grid @ 2.5% opacity |

Perf: single `::after` on `body`, `pointer-events: none`, disabled under `prefers-reduced-motion` for animations only (texture is static).

---

## 2D rack ↔ 3D studio alignment

- Rack shell colors match Studio3D dark stage (`#050709`–`#0a0c0f`).
- 3D mode track tabs use same `.hyphon-btn` variants as 2D rack selector.
- Knob material is identical in both modes; 3D adds shader bloom on top of the same geometry.

---

## HiDPI & contrast

- Global `-webkit-font-smoothing: antialiased` in theme.
- Retina: `outline: 0.5px` on panel shells for crisper edges.
- `prefers-contrast: more` brightens `--hyphon-border-glass`.
- All accent text pairs meet WCAG AA on dark backgrounds (cyan `#22d3ee` on `#0d1014` ≈ 7:1).

---

## Visual review (storybook-like)

Open the dev showcase without running Storybook:

```
http://localhost:5173/?visual-review=1
```

Shows panel shells, LEDs, buttons, legacy panels, and knob swatches side-by-side.

---

## Component audit checklist

| Component | Shell class | Chrome | Title bar | LEDs |
|-----------|-------------|--------|-----------|------|
| `HardwareModule` | `hyphon-chrome-panel` | screws + vents | `PanelTitleBar` | automation ring |
| `Rack` | `hyphon-rack-shell` | inner rim | — | tab active glow |
| `MainSequencer` | `hyphon-sequencer-shell` | sticky screws | — | step LEDs (SVG) |
| `TransportToolbar` | `hyphon-toolbar-shell` | — | `HYPHON` | play/record |
| `BottomBar` | `hyphon-toolbar-bottom` | — | — | texture toggle |
| `SamplerPanel` | `hyphon-sampler-shell` | header bar | bank tabs | bank indicators |
| `SamplerVoicePanel` | `hyphon-chrome-panel` | grid overlay | via HardwareModule | — |
| `SynthPart` | `hyphon-legacy-panel--cyan/pink` | — | Orbitron h2 | — |
| `DrumMachine` | `hyphon-legacy-panel--yellow` | — | Orbitron h2 | `LedIndicator` kits |

---

## Related docs

- [HOLOGRAPHIC_KNOBS.md](./HOLOGRAPHIC_KNOBS.md) — GPU shader effects
- [HOLOGRAPHIC_USER_GUIDE.md](./HOLOGRAPHIC_USER_GUIDE.md) — 3D mode walkthrough
- [HOLOGRAPHIC_COMPARISON.md](./HOLOGRAPHIC_COMPARISON.md) — 2D vs 3D comparison
- [MOBILE_UX.md](./MOBILE_UX.md) — touch targets + scroll classes
