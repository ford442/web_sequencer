# Third-party notices

Source code from other projects that is compiled into the Hyphon build and
whose licence asks for its notice to travel with it. This file ships at the
root of every release bundle (`dist/THIRD_PARTY_NOTICES.md`;
`scripts/check-release-dist.mjs` fails a bundle without it).

Other vendored components keep their own licence files in their directories
(for example `rubberband/`, `jc303_wasm/`).

---

## Mutable Instruments eurorack — Plaits DSP

- **Used by:** the macro engine family (`macro-*` models on SYNTH A / SYNTH B),
  compiled into `hyphon_native.wasm` — see
  [docs/audio-engine/macro-voices.md](docs/audio-engine/macro-voices.md).
- **Source:** <https://github.com/pichenettes/eurorack>, pinned as the
  `third_party/eurorack` submodule. Compiled: `plaits/dsp/**` (except
  `voice.cc`) and `plaits/resources.cc`. Built from a staged copy with denormal
  guards added (`tools/plaits_wasm_patches.mjs`); `emscripten/macro_wrapper.cpp`
  adapts `plaits/dsp/voice.cc`.
- **Licence:** MIT ("Code (STM32F projects): MIT license" — the repository
  README; each source file carries the notice below).
- **Copyright:** Copyright 2014, 2016, 2021 Emilie Gillet.

Hyphon's derivative is called "Macro" and is not presented as a Mutable
Instruments product, per the repository's guidelines for derivative works
("Mutable Instruments" is a registered trademark).

## Mutable Instruments stmlib

- **Used by:** the Plaits DSP above (filters, units, random, buffer allocator).
- **Source:** <https://github.com/pichenettes/stmlib>, pinned as the
  `third_party/stmlib` submodule (the commit eurorack pins). Compiled:
  `stmlib.h`, `dsp/**`, `utils/**`.
- **Licence:** MIT (`third_party/stmlib/LICENSE`).
- **Copyright:** Copyright 2012, 2014, 2015, 2017, 2019 Emilie Gillet.

### MIT License (both components above)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
