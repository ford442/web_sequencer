# 303 voice comparison harness (#1543)

Renders the same ReBirth 303 pattern through every registered 303 voice,
offline, and compares the renders: a null test, a spectral difference, and
waveform and spectrum overlays. It exists to answer one question before the
openrb-338 worklet integration: **how far is the bit-exact openrb-338 voice from
the open303 / jc303 / ReBirth-coefficient voices on real ReBirth songs?**
The answer is [below](#results).

## Run it

```bash
bash scripts/fetch-rbs-corpus.sh          # real ReBirth songs -> test-fixtures/rbs/corpus/ (gitignored)
pnpm run build:wasm:openrb338             # openrb338/pkg/openrb338.wasm (opt-in, GPL-3.0-only)
git submodule update --init jc303_wasm    # for the jc303 voice
```

```bash
pnpm run compare:303 -- test-fixtures/rbs/corpus/jsynth_kilo.rbs --patterns 2 --wav
```

With no song it uses `test-fixtures/rbs/corpus/*.rbs`, or the committed
`test-fixtures/rbs/generated/*.rbs` if the corpus is not there. Every voice
whose prerequisite is missing (no g++, no submodule, no wasm) is listed in the
report as *not rendered*, with the reason; the rest still run.

| Option | Meaning |
|--------|---------|
| `--voices a,b` / `all` | Registered voice ids to render (default: all 13). |
| `--ref <id>` | Reference voice the others are measured against (default `openrb338-2.0`). |
| `--patterns <n>` / `--pattern A0,B3` | The *n* most-used patterns per 303 (default 2), or exact slots. |
| `--loops`, `--gate`, `--tempo` | Pattern repeats (4), note length as a fraction of a step (0.6), tempo override (the song's). |
| `--mapping knob\|import` | How RBS knob bytes become voice params, see [Controls](#controls). |
| `--backend auto\|native\|ts` | open303 family: native C++ if g++ is present (`auto`), or force one. |
| `--wav` | Also write every render as a 32-bit float WAV, for listening. |
| `--out <dir>` | Output directory (default `out/compare-303/`, gitignored). |

Output: `report.md`, `report.json`, `svg/<case>-overlay.svg` and
`svg/<case>-spectra.svg` (and `wav/` with `--wav`).

## How it works

Code: `src/audio/offline/compare303/` (library), `scripts/compare-303-voices.ts`
and `scripts/compare-303/` (the Node CLI), `emscripten/tests/port_baseline/event_render.cpp`
(native helper). Tests: `src/audio/offline/compare303/__tests__/`.

**One event script, many backends.** `rbsSource.ts` turns a pattern into a
`Voice303Script`: timestamped `noteOn` / `noteOff` / param events at 44.1 kHz.
Every backend renders that same list, so two renders differ only by the voice's
DSP. 44.1 kHz is where openrb-338 is bit-exact.

**Every registered voice has an offline target** (`voices.ts`; the registry is
`TB303_MODELS`):

| Backend | Voices | Needs |
|---------|--------|-------|
| `native-open303` | `stock-open303`, `1ink303-v1`, `experimental-01`, `rebirth-338-1.5`, `rebirth-2.0`, `mb33-mkii`, `raveolution` | host `g++` (builds `open303_wrapper.cpp` through `event_render.cpp`, cached in `node_modules/.cache/compare303/`) |
| `ts-open303` | the same seven | nothing: the app's own offline port, `OfflineOpen303Engine` |
| `native-jc303` | `jc303` | host `g++` and the `jc303_wasm` submodule |
| `ts-highfid` | `highfid-cpu`; `live-highfid` and `gpu-highfid` as stand-ins | nothing (`OfflineHighFid303Engine`, 4x oversampled) |
| `openrb338-wasm` | `openrb338-vintage`, `openrb338-2.0` | `openrb338/pkg/openrb338.wasm`, driven through its C ABI |

`live-highfid` freezes through the CPU diode ladder and `gpu-highfid` falls
back to it without WebGPU, so they render identically to `highfid-cpu` and are
labelled `(as highfid-cpu)`. `jc303` is **never** substituted: the app's own
offline path renders `jc303` with stock-open303 coefficients, and a comparison
must not hide that. With no `g++` it is reported as not rendered.

`auto` prefers native for the open303 family because that is what the
worklet runs. The TS port is a close stand-in: on `jsynth_Untitled_song_2` A0 it
matches native with correlation > 0.999 and 0.3–0.5 dB spectral difference
(`stock-open303`, `rebirth-2.0`, `raveolution`).

### Controls

Both mappings send identical control values to every voice, so the comparison
is of the DSP and not of per-voice mapping:

- **`knob`** (default): each knob is `byte / 127`, the ReBirth panel position,
  plus waveform, volume 0.8 and slide time 0.33. This is what the openrb voice
  expects (it maps `v` back to `round(v * 127)`).
- **`import`**: what the RBS importer and `Open303Manager.applyLead303Params`
  send a SYNTH A / SYNTH B voice today: cutoff Hz / 8000, resonance / 20, decay in
  seconds clamped to 0..1, env mod on the filter-mode param, and **no** accent or
  env-mod param (they stay at the voice's own default).

### Notes

A pattern loops at the song tempo. A slide step is a `noteOn` while the previous
note is still held; every other note gets its `noteOff` after `--gate` of a step;
ties extend the note. That is the ReBirth form the openrb voice needs
([divergence 4](openrb338-voice.md#divergences-from-rebirth)), and the other
voices accept it. **Rest steps send nothing:** the importer keeps no note byte
for a rest, so `openrb303_rest` cannot be sent
([divergence 2](openrb338-voice.md#divergences-from-rebirth)). No knob
automation, shuffle or per-song mixer is applied.

### Metrics

All on mono renders, per case, against the reference voice (`report.md` columns):

- **Null dB**: after aligning within ±5 ms and scaling by the least-squares
  gain, the residual energy relative to the reference. 0 = nothing in common,
  −20 = a tenth of the amplitude left, −∞ = identical. **Corr** is the
  correlation at that lag. Two different oscillators and filters have different
  phase, so a null test only tells you something for voices close enough to
  correlate; it is the right tool for "is it the same DSP" (openrb vs openrb
  Vintage), not for ranking different synths.
- **Frame LSD dB**: third-octave band powers (80 Hz–12.7 kHz) per 2048-sample
  frame, compared in dB after matching level over the frames each voice is
  sounding in, averaged over frames both sound in. 0 = same timbre as it evolves.
  **Avg-spectrum LSD** is the same for the long-term average spectrum.
- **Level Δ**: whole-file RMS relative to the reference.
- **Centroid**: mean spectral centroid (Hz) over sounding frames.
- **Env corr**: correlation of the 10 ms RMS envelopes (do notes start and stop
  together).
- **Gate range dB**: loud (95th percentile) over quiet (5th) envelope, floored at
  −120 dBFS. Large when the voice closes between notes, small when it drones.
- Renders below −80 dBFS are marked **silent** and left out of the means.

## Results

12 cases from 3 real songs (`jsynth_Untitled_song_2`, `jsynth_on_the_run`,
`jsynth_kilo`; the two most-used patterns of each 303), `knob` mapping, 44.1 kHz,
4 loops, gate 0.6, reference `openrb338-2.0`. `on_the_run` B1 is the same pattern
as `Untitled_song_2` B1, so there are 11 distinct patterns.
Base commit `6af5d44`, openrb-338 revision `88a1770`.

| Voice | Backend | RMS dBFS | Level Δ dB | Null dB | Corr | Frame LSD dB | Avg-spectrum LSD dB | Centroid Hz (Δ) | Env corr | Gate range dB |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| stock-open303 | native-open303 | -17.2 | +17.0 | -0.6 | 0.310 | 25.8 | 16.8 | 202 (-24) | 0.050 | 6 |
| jc303 *(silent in 4/12)* | native-jc303 | -22.6 | +10.3 | -2.1 | 0.561 | 16.7 | 12.3 | 221 (-24) | 0.831 | 104 |
| 1ink303-v1 | native-open303 | -16.0 | +18.2 | -0.6 | 0.322 | 25.1 | 16.2 | 199 (-28) | 0.058 | 7 |
| experimental-01 | native-open303 | -17.1 | +17.1 | -0.6 | 0.316 | 26.1 | 16.7 | 202 (-25) | 0.094 | 6 |
| rebirth-338-1.5 | native-open303 | -16.9 | +17.3 | -0.6 | 0.318 | 25.5 | 16.3 | 194 (-33) | 0.045 | 6 |
| rebirth-2.0 | native-open303 | -17.3 | +16.9 | -0.6 | 0.334 | 25.8 | 16.6 | 191 (-36) | 0.067 | 6 |
| mb33-mkii | native-open303 | -16.4 | +17.8 | -0.6 | 0.319 | 25.2 | 16.1 | 197 (-30) | 0.060 | 7 |
| raveolution | native-open303 | -17.6 | +16.6 | -0.6 | 0.310 | 26.4 | 17.0 | 187 (-40) | 0.110 | 7 |
| openrb338-vintage | openrb338-wasm | -35.1 | -0.9 | -9.2 | 0.938 | 6.1 | 1.6 | 268 (+42) | 0.945 | 92 |
| **openrb338-2.0 (ref)** | openrb338-wasm | -34.2 | — | — | — | — | — | 226 | — | 93 |
| highfid-cpu (= live-/gpu-highfid) | ts-highfid | -15.3 | +18.9 | -0.6 | 0.297 | 20.0 | 10.6 | 205 (-21) | 0.015 | 4 |

Mean voice-to-voice frame LSD (dB), selected rows (full 13 × 13 matrix in
`report.md`):

| | stock | rebirth-2.0 | jc303 | highfid-cpu | openrb Vintage | openrb 2.0 |
|---|--:|--:|--:|--:|--:|--:|
| stock-open303 | · | 1.6 | 19.2 | 17.4 | 23.0 | 25.8 |
| rebirth-338-1.5 | 1.4 | 1.9 | 19.3 | 16.9 | 22.6 | 25.5 |
| jc303 | 19.2 | 19.1 | · | 18.8 | 15.6 | 16.7 |
| openrb Vintage | 23.0 | 23.0 | 15.6 | 16.5 | · | 6.1 |

### What the numbers say

1. **The openrb voice is a different instrument from every existing one.**
   The open303-family profiles are within 1.1–5.6 dB of each other and 22–26 dB
   from openrb. The nearest existing voice is `jc303` at 16.7 dB (8–26 per
   case, over the 8 patterns it renders); `highfid-cpu` is at 20.0 (16–26). Null
   depth against openrb averages −0.6 to −2.1 dB for every existing voice (best
   single case −5.7 dB, `jc303`), against −9.2 dB and 0.94 correlation for the
   openrb Vintage / 2.0 pair, the same DSP in two modes.
2. **The ReBirth-coefficient profiles do not get closer to ReBirth than stock.**
   Against openrb, `rebirth-338-1.5` is 25.5 dB, `rebirth-2.0` 25.8 dB and
   `stock-open303` 25.8 dB; on the long-term spectrum they are 16.3 / 16.6 / 16.8.
   They differ from stock by under 2 dB. This is a statement about the
   metrics, not about taste: the profiles were described as "inspired by, not
   a clone", and by these measures the inspiration is small next to the gap.
3. **Gating is the biggest single difference.** The open303 family and
   `highfid-cpu` have a gate range of 4–7 dB: nothing closes the amp between notes
   (the wrapper's `noteOff` only clears the slide flag, "envelope continues
   decaying after note-off"; the live sequencer sends the same `noteOn` /
   `noteOff` pair, so the live path does not add a gate either). openrb and
   `jc303` go quiet between notes (92–104 dB range). That is why their
   envelope correlation with openrb is 0.05–0.11 for open303 and 0.83 / 0.95
   for `jc303` / Vintage. This was read from the code and measured in renders; I did
   not listen to the live app.
4. **The spectra differ too.** With level matched over sounding frames
   (mean third-octave difference from openrb, voice minus openrb, over the cases):

   | Hz | 100–200 | 250–400 | 500–2000 | 2540–4000 | 5000 | 6400+ |
   |---|--:|--:|--:|--:|--:|--:|
   | stock-open303 / rebirth-2.0 | +1 to −2 | −7 to −10 | −9 to −16 | −3 to −12 | −1 to −3 | +1 to +8 |
   | jc303 | +2 | +1 to −6 | −9 to −10 | −7 to −9 | −6 | −5 to −6 |
   | highfid-cpu | 0 to −1 | −4 to −6 | −3 to −10 | −11 to −14 | −15 | −14 to −15 |

   The open303 profiles are thin in the mids (−15 dB around 1 kHz) and
   brighter than openrb above 6 kHz; `jc303` is 9–10 dB down between 500 Hz and
   2 kHz and 5–9 dB down above; `highfid-cpu` is closest in the mids but 14–15 dB
   dark above 4 kHz.
   `highfid-cpu` is the closest on the average spectrum overall (10.6 dB) but,
   like open303, has no gate. Mean centroids are 21–40 Hz lower than openrb's
   for all of them (openrb 2.0 averages 226 Hz).
5. **Level.** At the same normalized volume (0.8) openrb is about 17–19 dB
   quieter than the open303 profiles and `highfid-cpu`, and 10 dB quieter than
   `jc303`, because its volume 1.0 is ReBirth's default mixer (×0.2009). Switching a track's voice
   at constant Volume therefore changes loudness a lot; any voice selector A/B
   needs level matching.
6. **Vintage vs 2.0 is the smallest gap.** 6.1 dB frame LSD, 1.6 dB on the
   average spectrum, corr 0.94, with Vintage 42 Hz brighter on average
   (centroid).
7. **The `import` mapping makes the open303 family worse, not openrb.** With the
   importer's current SYNTH A / B mapping, open303-family frame LSD against openrb
   rises from ~26 to ~33 dB (accent and env mod are not sent, so those voices
   run at their own defaults), while openrb Vintage vs 2.0 stays at 6.1 dB.
   Separately, that mapping sends `cutoff = Hz / 8000`, not the knob byte, so an
   openrb voice fed this way would not receive ReBirth's knob positions; the
   raw-knob params (`64 + ctrl`, [Controls](openrb338-voice.md#controls)) exist
   for that.

### Value of the openrb-338 voice, for priority

The gap is large and systematic, not subtle, and no existing voice or
coefficient profile closes it: different gating, different brightness, different
level, and a 0.94-correlated Vintage / 2.0 pair that none of the others
resemble. If the goal is to sound like ReBirth's 303 on imported songs, the
WASM extraction is the only route in the registry that gets there, and it is
already built and bit-exact against upstream. That argues for prioritising the
worklet integration ([integration plan](openrb338-voice.md#integration-plan-open303manager--voicemanager-path)),
including the two items this harness depends on being approximated:
[divergence 4](openrb338-voice.md#divergences-from-rebirth) (holding the previous
note over a slide) and sending rest steps from the importer.

What this does **not** show: that openrb sounds better, or closer to a ReBirth
recording. It treats openrb as ReBirth because upstream validates it against
dumps of ReBirth.dll and this repo validates the wasm bit for bit against
upstream (`pnpm run verify:openrb338`); there is no ReBirth audio in this repo
to compare against. `--wav` writes every render for a listening check.

## Limitations and not verified

- **Three songs, eleven distinct patterns, no automation.** Other songs can move the
  numbers; the corpus is [jsynth's](../../test-fixtures/rbs/README.md) example files,
  and several patterns use extreme knob settings (cutoff 0, resonance 123).
- **`jc303` is silent on every square-wave pattern in the host build** (4 of 12
  cases: peak ≈ 1.6e-4 at waveform 1.0, fading linearly from waveform 0). UBSan
  flags `rosic_MipMappedWaveTable.cpp:70` (index 2048 out of bounds of
  `double[2048]`) while the tables are built. Whether the wasm build is affected
  was not checked, so `jc303` means above are over its 8 saw patterns only.
- Rest steps send nothing and slide-time / filter-mode are ignored by openrb, as
  [documented](openrb338-voice.md#divergences-from-rebirth); the gate length (0.6)
  is a choice, not ReBirth's.
- The null test only discriminates close voices. For different synths read the
  spectral and envelope columns.
- The `ts-open303` backend is a close but not bit-exact stand-in for native
  (see above). `gpu-highfid` is not rendered on the GPU.
- The corpus songs are not committed (`fetch-rbs-corpus.sh`); the unit tests use
  the committed `test-fixtures/rbs/generated/` files, and the openrb test only
  runs when `openrb338.wasm` has been built.

## Extending

- **A new voice** in `TB303_MODELS` shows up in `resolveCompareVoices()`
  automatically; a unit test fails if a registered voice is missing. An
  open303-family profile also needs its row in `OFFLINE_303_MODELS` for the TS
  backend (the native one finds it by id).
- **A new backend**: add an id and a runner to `voices.ts`
  (`BackendRunners`), and build the runner in `scripts/compare-303/runners.ts`.
- Related: [303-authenticity-gaps.md](303-authenticity-gaps.md) (spectral
  thresholds vs the jc303 soft oracle), [303-A-B-checklist.md](303-A-B-checklist.md)
  (manual high-fid A/B), [openrb338-voice.md](openrb338-voice.md).
