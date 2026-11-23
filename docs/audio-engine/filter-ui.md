# Filter UI — Cutoff / Resonance / Mode / Poles

Visual target for the per-OSC resonant filter controls.
Each engine can supply its own filter implementation; the shared UI exposes:

- **Cutoff**
- **Resonance**
- **Mode**: LP / BP / HP
- **Poles**: 2 / 4 (when supported)

Unsupported combinations are disabled (not hidden) and any substitution is logged.

## Per-engine limitations

| Engine | Native topology | Modes | Poles | Notes |
|--------|-----------------|-------|-------|-------|
| **WASM OSC (AssemblyScript)** | 2-pole RBJ biquad | LP/BP/HP (after update) | 2 only | Currently hardcoded LP. Easy to add types. No 4-pole. |
| **Rust** | TBD (bench is scalar LP) | LP/BP/HP planned | 2 (or 4 if implemented) | portable_simd path. Can do full matrix if written that way. |
| **C++** | TBD (never implemented) | Depends on design | 2 or 4 | Can host either RBJ or a ladder. Ladder is mostly LP. |
| **DWGS** | TBD (orphan art only) | Likely LP-focused | TBD | Waveguide / physical model; BP/HP may be approximate. |
| **WebGPU** | Offline table pre-render | LP/BP/HP possible | 2 (table bake) | Changing type/poles regenerates table. Not live-coefficient. |
| **Pyodide** | Offline (NumPy/SciPy) | LP/BP/HP easy | 2 or 4 | SciPy filters support both. Offline only. |
| **JS OscillatorNode** | Graph `BiquadFilterNode` | LP/BP/HP | 2 only | Terminal fallback. No 4-pole without extra nodes. |
| **Open303 / JC303 / high-fid** | 4-pole diode ladder | Primarily LP | 4 | BP/HP need extra stages. Extra params (accent, tracking, pole spread). |
| **Prophecy / Macro** | Existing C++ voices | Varies | Varies | Already in hyphon_native; filter is part of the voice. |
| **PCM / WAV** | Table playback | None native | — | Filter must come from another engine’s implementation. |
| **WAM** | (legacy alias / AS) | Same as WASM OSC | 2 | |

## Shared contract (lowest common denominator)

Every filter source must implement:

- `filterType: 'lp' | 'bp' | 'hp'`
- `cutoff`
- `resonance`

Optional extras (shown only when the selected source supports them):

- `poles: 2 | 4`
- accent / env amount / keyboard tracking / pole spread
- oversample

## UI notes

- When the user switches filter source, snap to the nearest supported mode/poles and log the change.
- Resonance scaling differs between biquad Q and ladder feedback — apply per-source mapping or label the control.
- Table-baked backends (WebGPU, Pyodide, current AS generate) regenerate on parameter change; worklet-resident backends update coefficients per block.

## Mockup images

Hardware-style mockups for each engine (cutoff / resonance / mode / poles) live alongside this doc or in the related issues. They are visual targets for a themed `FilterControls` component.
