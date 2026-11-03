# Low-pass filter modes: standard (RBJ) vs openrb / ReBirth

Status: **mode switch on every user low-pass node; openrb path built and
verified bit-exact, opt-in.** A patch-bay low-pass node takes a filter mode:

| Mode | Label | What runs |
|------|-------|-----------|
| `rbj` (default) | Standard (RBJ) | The browser's `BiquadFilterNode`: the RBJ Audio EQ Cookbook low-pass, set by cutoff (Hz) and Q. This is the node as it was. |
| `openrb` | openrb / ReBirth | ReBirth 2.01's PCF low-pass: openrb-338's bit-exact coefficient table and 2-pole filter, from the optional `openrb338.wasm`. |

Because it is a patch-bay node, any source you can cable through a low-pass
can use either mode: the 303s, Prophecy, the macro voices, the drum kit, the
sampler, the choir sum, track or master buses.

PCF nodes in the patch bay (the master PCF and placed PCFs) take the same
mode, with the pattern PCF as the standard branch; see
[pcf-node.md](pcf-node.md#openrb-mode).

## Using it

1. In the patch bay, add a **Low-pass** node. The palette has a **Mode**
   select next to Cutoff and Q.
2. Cable it in (for example `bass1Pan → Low-pass 1 → masterSaturation`).
3. Select the node. The **Filter** row has two buttons,
   **Standard (RBJ)** and **openrb / ReBirth**, plus a status line.

The buttons switch live. Both filters run in parallel behind two level gains
(`LowpassModeSwitch`, `src/audio/graph/lowpassMode.ts`), and a switch is a
20 ms crossfade, so A/B comparison needs no rebuild and does not click. A
node added since the engine started is staged, like any new node.

The mode is saved with the patch (`BiquadFilterConfig.filterMode`). A song
saved with `openrb` keeps it on a build that cannot play it.

### When openrb is not available

`openrb338.wasm` is GPL-3.0-only, and no published build bundles it (see the
[licence decision](openrb338-voice.md#licence-decision-gpl-30-only)). Without
it, openrb mode plays the RBJ biquad, and the status line says
*"plays RBJ · openrb338.wasm not loaded (opt-in GPL build) · patch keeps
openrb"*. Offline renders (freeze, stems, preview) take the same path as live
playback, so they play what you hear.

### Enabling it in a local build

```bash
pnpm run build:wasm:openrb338
```

```bash
VITE_OPENRB338_WASM_URL="/@fs/$PWD/openrb338/pkg/openrb338.wasm" pnpm run dev:fast
```

`VITE_OPENRB338_WASM_URL` is read only by `openrbModuleUrl()`
(`src/audio/openrb/openrbLowpassHost.ts`). When it is unset (the default),
nothing is fetched. When it is set, the module is fetched and compiled once
and checked for the `openrb_lp_*` exports. Each modal low-pass node then gets
an `openrb-lowpass-processor` worklet, and the compiled module is posted to
it. Any failure (404, a module without the group, a worklet that will not
load) logs one warning and leaves the nodes on RBJ.

## What openrb mode is

ReBirth's PCF is an insert filter whose cutoff follows an envelope that one
of 55 step patterns triggers. A patch-bay low-pass has no pattern, so openrb
mode is the PCF in low-pass mode **with its envelope at rest**: amount 0, an
instant attack and no new step. In that state the envelope equals the
smoothed cutoff base in every group of 4 samples. Everything else is
upstream's block, unchanged:

- **Once per 64-sample block**: a 2-pole smoother moves the base towards
  `4 × frequency knob`. The table index is `trunc(base)` (0..511) and the row
  is `(resonance × 8) >> 7` (0..7).
- **Every sample**: `y = (x·c2 + c0·y1) − c1·y2` in f64. The output is
  `f32(y)`.
- **At the block end**: the state is stored as f32.

The table (8 rows × 512 steps × `[c0, c1, c2]`) is ReBirth's `sub_100172C4`,
as openrb-338 rebuilds it. Its steps are exponential: step `i` puts the poles
at `0.4 · aw · K^(i−511)` cycles per sample, with `K` = 1.01454 (a quarter of
a semitone) and `aw = 0.6 + 0.4 · row/7`.

### Hz and Q → ReBirth knobs

The node keeps its RBJ parameters, cutoff (Hz) and Q, so one config drives
both modes. The module (`openrb338/src/lowpass.rs`) maps them:

- **Q → resonance row**: the row whose **pole Q** at the current cutoff step
  is nearest (log distance). The pole Q is read back from the table's own
  coefficients: `c1 = r²`, `c0 = 2r·cos θ`, `Q = −θ / ln c1`.
- **Hz → frequency knob**: the fractional knob whose step puts the poles at
  that frequency in that row (the row scales the pole frequency). The knob is
  fractional (0..127.75). An integer knob is ReBirth's own position.

ReBirth's resonance is not RBJ's, and the A/B is meant to show that. Measured
from the table at 44.1 kHz:

| Row | Pole range | Pole Q, low cutoffs (step 100) | Pole Q, high cutoffs (step 480) | DC gain, low / high |
|-----|-----------|---------------|----------------|---------------------|
| 0 | 6.7 Hz – 10.6 kHz | 0.50 | 0.52 | +4.4 / +4.3 dB |
| 1 | 7.3 Hz – 11.6 kHz | 0.67 | 0.93 | +3.5 / +2.3 dB |
| 3 | 8.4 Hz – 13.6 kHz | 1.00 | 2.93 | +1.9 / −3.9 dB |
| 5 | 9.8 Hz – 15.6 kHz | 1.33 | 9.29 | +0.6 / −4.1 dB |
| 7 | 11.0 Hz – 17.6 kHz | 1.67 | 29.4 | −0.6 / −4.1 dB |

So:

- **Only 8 resonance steps.** Q moves in coarse jumps.
- **Resonance grows with cutoff.** Below table step 196 (about 110–190 Hz,
  depending on the row) no row goes past Q 1.67, so a high Q there plays
  row 7. Above that, the builder blends towards a much steeper resonance
  curve. Near the top a row-7 node screams at about Q 30.
- **Level differs.** The table carries ReBirth's own gain (`2.5 / (d + 1)`
  at DC). It is not normalised, so openrb sits up to 4.4 dB above or 4.1 dB
  below RBJ at the same settings. Match levels by ear, or with a Gain node,
  when you compare tone.
- **No pole at 18 kHz.** The table tops out at 10.6–17.6 kHz, depending on
  the row. A higher cutoff plays the top step.

## Floating-point matching expectations

| Where | Match | Checked by |
|-------|-------|-----------|
| Coefficient table + smoother, any platform | **Bit-identical** to upstream `orb-engine` (`tables::pcf_lowpass`, `pcf_smoother`). The builders use f64 arithmetic in the original operand order, f32 rounding where the DLL stores, and the pure-Rust `libm` (pinned `=0.2.16`) for `pow`/`cos`/`exp`, so wasm32 builds the same table as x86-64. Upstream checks the table against dumps of the running ReBirth.dll. | `tests/lowpass_reference.rs` |
| Filter output, native, 44.1 kHz, integer knobs | **Bit for bit** equal to upstream's `Pcf::process` in low-pass mode with the envelope at rest. The cases are the defaults, an open/low jump, full resonance with cutoff jumps, and a 200-move ride of both knobs. Each is rendered in chunks of 128, 64, 4096 and `37/91/200/1/128`. | `tests/lowpass_reference.rs` |
| Filter output, `openrb338.wasm` through its C ABI | **Bit for bit** equal to the native renders above, in every chunking. The core has no FMA and no fast-math: only IEEE f64/f32 operations and `as` casts. | `tools/verify-wasm.mjs` (`pnpm run verify:openrb338`) |
| The worklet | Copies samples in and out only: the output is the module's, sample for sample, per channel. | `src/__tests__/OpenrbLowpassProcessor.test.ts` (runs when the module is built) |
| Hz / Q targets (the patch bay) | **Not** ReBirth bit-exact by definition. A fractional knob or a Q-picked row is a position ReBirth's panel cannot set. The filter that runs is still the table path: the poles land within one quarter-semitone step of the requested Hz (the index is truncated). | `src/lowpass.rs` unit tests |
| Host at 48 / 96 kHz | **Not bit-exact.** The table bakes in 44.1 kHz. The filter runs at the host rate with the index shifted by `log_K(44100 / rate)` steps (−5.9 at 48 kHz, −53.9 at 96 kHz), so the poles stay at the same Hz within one step. Pole Q and the gain follow the shifted step, and the smoother runs per host block (its time constant scales with the rate). At high rates the lowest steps fall off the bottom of the table. `openrb_lp_is_bit_exact` reports which case applies. The status line says "not bit-exact" when it is not. | `src/lowpass.rs` unit tests |
| The RBJ branch | The browser's `BiquadFilterNode`, so it is whatever the engine implements (f32 or f64 per browser). It is not compared against anything. | — |

Two adapter choices, both outside the bit-exact claims:

- **The smoother starts at its target.** A ReBirth PCF starts its smoother
  at 0 and sweeps up from about 7 Hz over the first ~20 ms. A new node here
  is primed at its first block. The reference test primes upstream the same
  way.
- **Parameter changes take effect at the next 64-sample block** (1.45 ms),
  as in ReBirth.

## Files

| File | Licence | Role |
|------|---------|------|
| `openrb338/src/pcf_lp.rs` | GPL-3.0-only (upstream code, modification notice) | Upstream's PCF low-pass table builder, smoother, index and filter step. |
| `openrb338/src/lowpass.rs` | GPL-3.0-only | The static-insert adapter: envelope at rest, Hz/Q mapping, host-rate shift, output gain. |
| `openrb338/src/ffi.rs` | GPL-3.0-only | The `openrb_lp_*` export group (revision 1, its own handle table, up to 64 filters). |
| `openrb338/tests/lowpass_reference.rs`, `tests/lowpass_cases/` | GPL-3.0-only | Bit-exact checks against upstream. |
| `src/audio-worklets/openrbLowpass.ts` | Hyphon | The ABI contract (`OpenrbLowpassExports`, `OPENRB_LP_PARAM_IDS`, `supportsOpenrbLowpass`). It contains no openrb code. |
| `src/audio-worklets/openrb-lowpass-processor.ts` | Hyphon | The worklet: one module filter per channel, in place. |
| `src/audio/openrb/openrbLowpassHost.ts` | Hyphon | The opt-in loader and the compiler's `createOpenrbLowpass` provider. |
| `src/audio/graph/lowpassMode.ts` | Hyphon | Modes, `isModalLowpass`, `LowpassModeSwitch`. |

### ABI: the `openrb_lp_*` group (revision 1)

This group is optional and separate from the 303 exports. A host probes
`openrb_lp_version` before it uses the group.

| Export | Signature | Notes |
|--------|-----------|-------|
| `openrb_lp_version` | `() → u32` | `1` = `OPENRB_LP_VERSION` |
| `openrb_lp_create` | `(sampleRate: f32) → handle` | 0 for a rate outside 8–384 kHz, or a full table. Allocates. |
| `openrb_lp_destroy` | `(handle)` | |
| `openrb_lp_set_param` | `(handle, id, value: f32)` | `0` frequency knob 0..127.75, `1` resonance knob 0..127, `2` output gain (1 = ReBirth level), `3` cutoff Hz, `4` Q. A raw knob clears the matching Hz/Q target. The change applies at the next block. |
| `openrb_lp_reset` | `(handle)` | Clears the filter and smoother state. |
| `openrb_lp_buffer` | `(handle, maxFrames) → ptr` | In-place mono f32 buffer. It moves only if a later call asks for more frames. Allocates. |
| `openrb_lp_process` | `(handle, frames)` | Filters the buffer in place. Does not allocate. |
| `openrb_lp_is_bit_exact` | `(handle) → u32` | 1 when the host runs at 44.1 kHz. |

Cost: about 3 µs per 128-frame quantum per channel in Node.

## Which nodes take a mode

`isModalLowpass`: a `biquadFilter` of type `lowpass` that the user placed
(not `fixed`), or any low-pass biquad whose config names a `filterMode`. The
stock presets have no low-pass, and their fixed peaking and shelf filters stay
plain biquads. User low-pass nodes saved before this change have no
`filterMode`. They load as `rbj`, gain the switch, and can be A/B'd like new
ones.
