# openrb-338 TR-808 / TR-909: porting spike

Status: **spike only, nothing implemented.** Question: can Hyphon take
openrb-338's TR-808 and TR-909 devices (the exact ReBirth sample kits, plus
`.rbm` mod support) as selectable kits or modes, next to the synthesized kit
that `drumkit_set_kit` switches today ([drumkit.md](drumkit.md))?

Upstream examined: <https://github.com/pingw33n/openrb-338>, `HEAD` =
`cbca449` (2026-11-03). The TB-303 extraction pins `88a1770` (2026-10-31)
([openrb338-voice.md](openrb338-voice.md)). The clone was shallow, so the drum
files were **not** diffed between the two revisions; re-check at port time.

## Answer

| Question | Answer |
|----------|--------|
| Is it portable? | **Yes, as engine code.** `drums.rs` + `tr808.rs` + `tr909.rs` are about 1,600 lines of straight-line arithmetic whose only external crate is `libm` (already pinned by the 303 module). The extraction is the same kind of job as the 303's, with about twice its core (1,613 lines against `tb303.rs` + tables at 836). |
| WASM size | **Code: about 20-35 KB, estimated, not measured** (see [Size](#size-and-memory)). **Samples: 2,043,628 bytes measured** for the 45 drum one-shots (about 2.0 MB of 16-bit mono PCM). |
| Is it cheap to integrate? | **No.** The engine is the small part. Hyphon's drum model is four lanes (`DrumSound = 'kick' \| 'snare' \| 'closedHat' \| 'openHat'`, referenced in 127 files); each ReBirth device has eleven instruments. |
| Licence | The engine is **GPL-3.0-only**, the same position as the 303 module. The **sample kit is Propellerhead's proprietary audio**, committed upstream as a stated exception to the repository's rule. The GPL does not license it. This, not the engineering, is the gate. |
| Recommendation | **Defer.** Do not ship the ReBirth samples. If it is pursued, the viable shape is *engine only, user-supplied kit, existing four lanes*, after the licence decision (#1544) and the 303 loader plumbing land. Details in [Recommendation](#recommendation). |

## What was and was not verified

- **Read:** the upstream source (`crates/orb-engine/src/{drums,tr808,tr909,samples,process,seq}.rs`,
  `tables/`), `crates/rbm`, `docs/rbm.md`, `assets/README.md`, the backlog, and
  Hyphon's `openrb338/`, `drumkit-processor.ts`, `drumkit_wrapper.cpp`,
  `DrumKitEngine.ts`, `dist-budget.json`.
- **Measured:** per-file sample sizes. I read the `.rbm` IFF chunk directory
  with a small Python reader of my own (chunk headers and file names are not
  scrambled; nothing was decrypted or executed).
- **Not measured: WASM code size.** I tried to build the upstream crates in a
  scratch directory to get a real number; the session's permission classifier
  declined compiling external code, so I did not. The code-size figures below
  are estimates with their basis stated. How to measure them is in
  [Follow-ups](#follow-ups).
- **Not verified: Propellerhead / Reason Studios' terms.** A web search found
  the 2005 free-download release of the desktop version but no licence text.

## What openrb-338's drum engine is

The two devices are **sample players with a ReBirth-specific trigger layer**,
not synthesizers. Each is a `SongDevice` + `ChannelDevice` whose `step()` reads
a 32-pattern step table and triggers voices, and whose `process()` mixes the
voices onto one mono 64-frame bus.

| File | Lines | Role |
|------|------:|------|
| `drums.rs` | 393 | Four voice classes, shared by both devices: `Simple`, `Filter`, `Dual`, `Pitched` |
| `tr808.rs` | 561 | `CTR808Device`: 29 controllers, trigger logic, step function, mix order |
| `tr909.rs` | 659 | `CTR909Device`: 30 controllers, trigger logic, step function, flam, mix order |
| `samples.rs` | 241 (+ `aiff.rs` 417, `pe.rs` 196) | `Sample` (`Vec<i16>` + 512 zero pad), `SampleSet` (46 slots), AIFF and PE-resource readers |
| `process.rs` | 287 | Process-global drum counters (four `u16`s, shared with the delay line) |
| `tables/` | 56 of 521 in `data.rs`, plus 3 builders | `TR808_*`, `TR909_*` constants; `tr808_tom_step`, `tr909_tom_step`, `tr909_decay` builders |
| `crates/rbm/` | ~2,200 | `.rbm` container, descrambler, recrypt, pack/unpack, embedded `Standard.rbm` |

Verification upstream: a 175-render reference corpus and 1,268 songs compared
byte for byte against the original's export (README), with `corpus_tr808.rs` /
`corpus_tr909.rs` for these devices. Those tests need the original DLL
(`ORB_CD_ISO`); Hyphon would not run them. Hyphon's `openrb338/Cargo.toml`
already has `orb-engine` as a git dev-dependency, and `tr808` / `tr909` are
public modules there, so the same *reference-render* approach used for the 303
carries over.

## Sample loading

- **46 slots:** 24 TR-808 (`BD`, `SD1-5`, `N1-4`, `CB`, `CH`, `CL`, `CP`, `CY`,
  `HC`, `HT`, `LC`, `LT`, `MA`, `MC`, `MT`, `OH`, `RS`), 21 TR-909 (`bd1-4`,
  `sd1-5`, `sdn1-3`, `lt`, `mt`, `ht`, `rs`, `hc`, `chh`, `ohh`, `ccy`, `rcy`)
  and the startup jingle (slot 46, not a drum).
- **Format:** AIFF, **mono, 16-bit, 44,100 Hz** (every shipped mod). The engine
  keeps raw `i16` followed by 512 zero samples, because the voices may read
  past the end.
- **Source of the built-in kit:** `ReBirth.dll`'s `"AIFF"` resources
  1000-1045, embedded byte for byte in `assets/Standard.rbm`
  (`include_bytes!`, `crates/rbm/src/standard.rs`).
- **Mods:** a `.rbm` is an IFF `CAT PRBM` of `HEAD`, `EMBF` files (panel
  JPEGs, `Demo.rbs`, the 46 AIFFs by fixed name `TR808BD.aif` ...) and `INFO`.
  A mod replaces any subset of the 46 slots; the rest fall back to the
  built-in kit. Payloads past their first 1,024 bytes are scrambled with key
  material from `RB20FUL.DAT` (a 128 MB file on the ReBirth CD). Upstream
  embeds a 2,047-byte window of it so that *recrypted* mods load without the
  DAT; other mods must go through `orb mod recrypt` first (`docs/rbm.md` §4,
  §12).
- **Swapping at run time:** `ChannelDevice::set_samples` silences the device
  and swaps the table; a `Retired` struct holds the old `Arc`s so the audio
  thread frees nothing.

## Voice allocation

There is no dynamic allocation. Each device has a **fixed set of 12 voices**,
one per instrument, so an instrument is **monophonic**: a retrigger restarts
its voice at sample 0. The only polyphony is the bass drum.

| Class | What it does | TR-808 | TR-909 |
|-------|--------------|--------|--------|
| `Simple` (5 / 4) | `out += g*s`, exponential gain `m` per sample pair, optional `hold` blocks | RS/CL, CP/MA, CB, OH, CH | RS, CP, CH, OH |
| `Filter` (3 / 2) | `Simple` through a one-pole low-pass `y = y*c + g*s` | **BD A, BD B**, CY | **BD A, BD B** |
| `Dual` (1 / 1) | Two samples, `g1*(A + g2*B)` | SD (tone `SD1-5` + noise `N1-4`) | SD (`sd1-5` + `sdn1-3`) |
| `Pitched` (3 / 5) | 24.8 fixed-point resample with integer linear interpolation | LT/LC, MT/MC, HT/HC | LT, MT, HT, crash, ride |

Behaviours a "sample-set only" port would lose:

- **Bass drum A/B.** A process-global toggle alternates two voices and fades
  the other by 0.99 per pair, so overlapping kicks cross-fade.
- **Snare noise sequence.** The noise sample is chosen by a 32-entry
  sequence indexed by a process-global counter (pre-incremented, `& 31`), so
  successive snares are deliberately not identical.
- **Choke.** 808 closed hat clears the `hold` of all five `Simple` voices; the
  909 closed hat sets the open hat's multiplier to 0.996 (a fast decay, not a
  cut).
- **Knob tables.** 808 BD/CY tone (`TR808_TONE[tone>>4]`) and decay
  (`TR808_DECAY[decay>>3]`); 909 BD attack and decay; tom/conga pitch from a
  128-entry step table (`T808`, `T909`); 909 BD sample `bd1-4` by `tune>>5`,
  snare tone sample by `(tune*5)>>7`.
- **Accent and flam (909).** Step value 1/3 plays at 0.8x accent, 2/4 at
  2.0x; values above 2 retrigger once at 1.5x after a tempo-dependent delay.

Both devices mix onto **one mono bus** in a fixed voice order; per-instrument
outputs are null in the original, so there is no per-instrument pan or send.

## Timing model

- **Block size is fixed at 64 frames at 44.1 kHz**; every constant assumes it
  (`Frame::block`, `BLOCK = 64`).
- **Clock:** once per block, before any device renders, the sequencer advances
  its position by `tempo * TEMPO_STEP` (`tempo` = BPM x 1000;
  `TEMPO_STEP = 64*192 / (60*44100*1000)`). That is **192 ticks per quarter,
  48 per 16th step, 768 per bar**.
- **Shuffle** moves the tick inside each 8th note (`96*(t/96) + max(0, t%96 - shuffle/6)`).
- **Triggering:** `device.step(tick, shuffled_tick, tempo)` runs at the start of
  the block; a step change triggers voices immediately. A trigger therefore
  lands on a **64-frame boundary** (1.45 ms), never inside one.
- **909 flam:** a new step arms `flam_tick = tick + FLAM*tempo/700000 + 1`; the
  first later block whose tick passes it retriggers the values above 2.
- **DSP detail:** each block runs 32 sample pairs; gain is constant inside a
  pair and multiplied by `m` after it. Intermediates are f64 with an f32 store
  at the points the original stores (x87 behaviour reproduced), which is what
  makes the output bit-exact. Off 44.1 kHz it is not (same rule as the 303
  module: the core runs at 44.1 kHz and is resampled).

## Dependencies and extraction difficulty

What `tr808.rs` / `tr909.rs` / `drums.rs` import from the rest of `orb-engine`:

| Import | Needed in a host-driven port? | Replacement |
|--------|-------------------------------|-------------|
| `frame::{Block, BlockContext, ChannelDevice, SongDevice}` | `Block` = `[f32; 64]` only | Replace the two trait impls with inherent methods (what the 303 extraction did to `Tb303`) |
| `process::ProcessState` (atomics) | Four `u16` counters | Plain per-device fields |
| `samples::{Sample, SampleSet, Retired}` | `Sample`, a slot table | Keep `Sample`; drop `Retired`, `aiff.rs`, `pe.rs` if the host decodes |
| `seq::TrackMut` | Only `init_track` | Drop |
| `tables::data` (TR808/909 consts) | Yes, 56 lines | Copy |
| `tables` builders (`tr808_tom_step`, `tr909_tom_step`, `tr909_decay`) | Yes, about 30 lines, uses `libm::pow` | Copy; `T808[64]` is a documented fragile entry (`pow` must be exact so the product is exactly 256) |
| Third-party crates | `libm =0.2.16` only | Already pinned by `openrb338/` |

**Difficulty: moderate and mostly mechanical.** The numerics are the hard part,
and the 303 work already proved they carry to `wasm32-unknown-unknown` bit for
bit (IEEE f64/f32, no FMA, truncating casts, pinned `libm`).

What is new compared with the 303:

1. **Triggers instead of a held note.** The host calls a public
   `trigger(instrument, ...)` (private today) with an accent, instead of
   writing step bytes. The 909 flam needs a host-side schedule.
2. **Sample memory.** The module must own a 2 MB table that the host fills
   (`alloc` / `set_sample(slot, ptr, frames)`), not a handful of KB of tables.
3. **Two devices, 11 instruments each**, each with its own controller block
   (808: 29 bytes, 909: 30, with bytes 20-22 permuted internally).

## Size and memory

**Samples (measured** from the `.rbm` chunk directory; `assets/Standard.rbm`
is 2,572,792 bytes in total, of which 354,965 are panel JPEGs that Hyphon
would not use):

| Set | Files | AIFF bytes |
|-----|------:|-----------:|
| TR-808 | 24 | 1,200,386 |
| TR-909 | 21 | 843,242 |
| **808 + 909 drums** | **45** | **2,043,628** |
| Startup jingle (not a drum) | 1 | 169,552 |
| Four-lane subset (BD, SD + noise, CH, OH of each) | 26 | 832,512 |

Largest files: `TR808CY` 349 KB, `TR808CP` 174 KB, `TR808BD` 146 KB, `TR808CB` 103 KB,
`TR909ccy` 87 KB, `TR909rcy` 85 KB. The 808 clap, cymbal and cowbell, which
have no Hyphon lane, are 626 KB of the 808's 1.2 MB.

Each sample is resident as `i16` plus 512 pad samples (about 46 KB for 45
files). Peak memory during upload is about double if the PCM arrives as a
transferred `ArrayBuffer` and is then copied into WASM memory. This is a
separate module with its own memory, so Hyphon's shared `hyphon_native` heap
and `wasmMemoryBudget` are unaffected.

**Code (estimate, not measured).** The existing `openrb338.wasm` is about 45 KB
for 2,167 lines of Rust, including the 303's table builders, the PCF low-pass
and the resampler. The drums are about 1,600 lines of simple loops with about 90
lines of tables, so the same order: **about 20-35 KB added to `openrb338.wasm`,
or 30-40 KB as a standalone module** (own `libm::pow` and allocator). Treat
the range as +-50%.

**Distribution.** `dist-budget.json` excludes `.wasm` from `assetsDirMaxBytes`
and says sample audio is not budgeted, so 2 MB would not trip the release
check. It is still 2 MB on the wire. Only lossless coding keeps the output
"exact", and I did not measure lossless ratios.

## Fit with Hyphon's drum path

| Topic | Today | What a ReBirth kit needs |
|-------|-------|--------------------------|
| Lanes | 4: `kick`, `snare`, `closedHat`, `openHat` (`DRUMKIT_VOICE`) | 808: BD SD LT MT HT RS CP CB CY OH CH; 909: BD SD LT MT HT RS CP CH OH CC RC |
| Per-hit params | `a,b,c,d` = pitch/decay/tone/volume (kick), tone/decay/noise/volume (snare), pitch/decay/volume (hat) | ReBirth has no continuous pitch control on BD/SD/hats (the 909's BD and snare `tune` only pick one of 4 / 5 samples). Remap: 808 BD level/tone/decay; 909 BD level/tune/attack/decay; 808 snare tone or 909 snare tune picks the sample; the rest are device-global knobs |
| Engine host | `drumkit_*` exports inside the shared `hyphon_native` instance, events in a native ring | A separate no-imports module in the worklet (as planned for the 303), so its events are applied in TypeScript, not by `renderSplit` |
| Timing | Sample-accurate (`audioTime` to frame, #1344 P4) | Quantised to 64-frame blocks; a 1.5 ms flam (`voiceTiming.realWasm.test.ts`) is 66 frames at 44.1 kHz, so its two hits can no longer share a block offset. Same limitation the 303 module documents |
| Sample rate | Any | 44.1 kHz core, resampled elsewhere (Catmull-Rom, no anti-alias filter); reuse `resample.rs` |
| Output | Planar stereo, per-hit constant-power pan | Mono bus. Per-hit pan means rendering voice groups separately (the bit-exact sum is the centred case only) |
| Selector | `drumkit_set_kit(0\|1)`, `kitToNativeId` | A third engine choice, like the 303 voice selector; the persisted id must be stable from the first commit |
| Fallback | Web Audio oscillator kit | The synthesized WASM kit, announced like `openrb338-unavailable` |

`DrumSound` is a closed union used by xm/SMF/stem export, the AI-song and RBS
importers and the sequencer grid, so **eleven lanes per device is an epic of
its own**, separate from the engine port. The RBS importer already maps ReBirth's
drum machines onto those four lanes (`resolveDrumKitType`,
`convertDrumParams`), so an authentic kit would also change what an import
means.

## Licence and assets

*Engineering notes, not legal advice.*

| Part | Licence / owner | Consequence |
|------|-----------------|-------------|
| Engine code (`drums`, `tr808`, `tr909`, tables) | **GPL-3.0-only**, "Copyright (C) 2026 the OpenRB-338 authors" | Same as the 303 module: own optional module, never in `hyphon_native.wasm`, not bundled until the project licence is decided (#1544). Derived adapter code is GPL-3.0-only too. Add to `THIRD_PARTY_NOTICES.md` when bundled |
| `assets/Standard.rbm` (46 AIFFs + 59 panel JPEGs) | **Propellerhead (now Reason Studios), proprietary.** Its `HEAD` chunk reads `(c)1998 Propellerhead Software, all rights reserved.` Upstream's `assets/README.md` calls it "Propellerhead's material, committed by the user's decision of 2026-10-27 as the one exception to the rule that nothing of the original is in the repository" | The GPL on the code does not license these samples. Re-hosting them, or re-encoding them into Hyphon's assets, is redistribution of third-party audio with no grant that I could find. Upstream's own `samples.rs` header still says "nothing of Propellerhead's embedded or redistributed"; it predates the exception and is stale |
| `.rbm` mods | Each mod's author (the `rb-mods` collection); terms not stated per mod | Never bundle. User-supplied at run time only |
| ReBirth trademark | Propellerhead / Reason Studios; upstream says it is not affiliated | Do not use the name or panel art. (Press coverage says the iPad app was pulled after a Roland IP complaint; TR-808 and TR-909 are Roland designations.) |

Web search found: the desktop version was made a free download after support
ended in September 2005 ([Wikipedia](https://www.wikipedia.org/wiki/ReBirth_RB-338),
[Sound on Sound](https://www.soundonsound.com/techniques/rebirth-reason),
[GearNews on the iOS app](https://www.gearnews.com/roland-kill-off-propellerhead-rebirth-rb-338/)).
A free download is not a redistribution licence, and the end-user licence text
was not found.

**`.rbm` support has a second problem.** Loading a mod needs the descrambler
and a key window taken from `RB20FUL.DAT`, a Propellerhead file. Upstream
embeds 2,047 bytes of it (their call). Hyphon should not copy that window
without a separate review. A safer user-facing route is a per-slot file picker
(or an unpacked mod folder from `orb mod unpack`) with plain AIFF/WAV, which
Hyphon's sampler can already decode.

## Options and recommendation

| Option | Delivers | Cost | Licence |
|--------|----------|------|---------|
| **A. Full port** (both devices, all instruments, built-in kit, `.rbm`) | The whole feature | Rust extraction (**M**) + loader/worklet (**M**) + 22 new lanes across the data model and exporters (**XL**) + asset/legal work | Blocked on the sample licence and on #1544 |
| **B. Sample-set only** (45 WAVs into the existing sampler) | Authentic one-shots, none of the ReBirth behaviour | **S** | **Same blocker as A**: the samples are the proprietary part |
| **C. Engine only, user-supplied kit, existing four lanes** | ReBirth voice behaviour (BD A/B, snare noise sequence, tone/decay tables, chokes) with any 46-slot kit | Rust extraction (**M**) + loader/worklet (**M**) + BYO kit UI (**M**) | Same as the 303: GPL module pending #1544; no Propellerhead audio shipped |
| **D. Defer** | Nothing yet | None | None |

Sizes are my judgement relative to the 303 work (#1537), not measurements.

**Recommendation: D now, then C.**

1. **B is the weakest option.** It has A's licence problem, loses everything
   that makes the engine "ReBirth", and duplicates what the sampler already
   does. Do it only if Reason Studios grants permission to redistribute.
2. **A is gated twice** (samples and #1544), and its biggest cost is the lane
   model, not the DSP.
3. **Upstream is about to change the ground.** Its newest backlog milestone
   (m-6, created 2026-11-03) is a wasm32 build of the engine and UI, starting
   with "`orb-engine`, `rbs` and `rbm` build for wasm32 and render bit-identical
   to native" (task-169). Extracting now risks duplicating work and diverging.
4. **The 303 integration is unfinished** (loader, worklet voice prefix,
   `isOpenrb338ModuleBundled` probe, [Still to do](openrb338-voice.md#still-to-do-1537)).
   A drum port would reuse that plumbing, so finish it first.

Un-defer when **#1544** is decided and the 303 module loads in a worklet.
Then build **C**. It is a defensible product on its own: a "ReBirth engine"
option for the four existing lanes, with the user supplying a kit. Open the
lane-expansion epic only if C proves worth it.

## Follow-ups

- **Decision:** what is the BYO kit UX (per-slot picker, folder, `ReBirth.dll`)?
  Upstream's earlier approach read the user's own DLL at run time.
- **Measure** (needs a session that may build external code): copy `drums.rs`,
  `tr808.rs`, `tr909.rs` and the tables into a scratch crate, replace the trait
  impls as in `openrb338/src/tb303.rs`, build with the 1.99.1 toolchain for
  `wasm32-unknown-unknown` with the `openrb338/Cargo.toml` release profile, and
  compare against the 45 KB baseline.
- **Ask upstream** whether the m-6 wasm32 work will expose the drum devices
  without the sequencer and song layers.
- **Ask Reason Studios** (via the repository owner) about redistributing the
  45 drum samples, only if option A or B is wanted.
- **Re-verify** the drum files at upstream `cbca449` against the `88a1770` pin.
- Fix the stale 40 KB figure in `openrb338-voice.md` (the crate README says 45 KB).
