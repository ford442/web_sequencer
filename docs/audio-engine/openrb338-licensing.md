# openrb-338: licence decision

Status: **recommendation, awaiting owner sign-off.** Input for #1544, needed before any
substantial openrb-338 porting work lands (the 303 module in
[openrb338-voice.md](openrb338-voice.md), the PCF low-pass in
[openrb-lowpass.md](openrb-lowpass.md), the drum engines in
[openrb338-drums-spike.md](openrb338-drums-spike.md)).

*Engineering decision record, not legal advice. The repository owner makes the final call, and
anyone shipping a commercial build should get a lawyer's read first.*

## Facts

| Item | Position |
|------|----------|
| openrb-338 | **GPL-3.0-only**: no "or later", no exception. "Copyright (C) 2026 the OpenRB-338 authors." Pinned at `88a1770c` (see [openrb338/README.md](../../openrb338/README.md)). |
| What is in this repo | `openrb338/` is a standalone Rust crate with its own `LICENSE`. `tb303.rs`, `tables.rs`, `pcf_lp.rs` are upstream code with modification notices. `voice.rs`, `lowpass.rs`, `ffi.rs`, `resample.rs` are Hyphon's adapter written against that code, so they are a derived work and GPL-3.0-only too. |
| What is not | The built `openrb338.wasm` is gitignored, not in `public/`, and not part of `build:native`. `src/audio-worklets/openrb338.ts` is only the ABI contract and contains no openrb code. |
| Hyphon itself | No `LICENSE` file; `package.json` is `"private": true` with no `license` field. Nothing grants outsiders rights to the app today. |
| Existing copyleft | **Rubber Band** (GPL-2.0-or-later, `rubberband/COPYING`) is built by `build:native` into `public/rubberband.wasm` and loaded by the rubberband / sustain worklets. Its README also says distribution under non-GPL terms, including through the Apple App Store, needs a commercial licence. |
| Permissive code | Open303 / jc303 (MIT), Plaits / stmlib (MIT, listed in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)). All are GPL-3.0-compatible. |
| Web delivery | Hyphon runs client-side. Serving JS and WASM to a browser **is distribution** of that code. Running it as a hosted service does not avoid the GPL, because the code is copied to every visitor. (Only the AGPL has a network clause; this is not about that.) |
| Provenance | `tables.rs` and `tb303.rs` follow ReBirth.dll "instruction by instruction" (upstream's own wording). Upstream's GPL covers upstream's authorship. It says nothing about Propellerhead / Reason Studios' rights in the original. Upstream's drum samples are expressly proprietary (see the drums spike). |

## What is and is not allowed

**Allowed**

- Developing against openrb-338 and building `openrb338.wasm` for private use. The GPL only
  binds on conveying.
- Keeping `openrb338/` in this repository, public or private, under its own GPL-3.0 `LICENSE`
  with its modification notices.
- Shipping `openrb338.wasm` in a build **offered under GPL-3.0 terms**: the licence text, the
  complete corresponding source of the combined work (the app that loads and drives the module,
  not only `openrb338/`), and notices. Rubber Band (GPL-2.0-or-later) and the MIT code can be
  conveyed under GPL-3.0 in the same bundle, so there is no conflict inside it.
- Publishing a build that does **not** contain the module, under whatever licence the owner
  chooses for the rest, subject to the Rubber Band point below.

**Not allowed**

- Shipping `openrb338.wasm` (or a C++ / TypeScript translation of the code) in a build
  distributed under proprietary, "all rights reserved" or permissive-only terms.
- Relicensing openrb-derived code under anything but GPL-3.0-only. Translating it to another
  language does not remove the obligation.
- Linking it into `hyphon_native.wasm`. Every voice, drum and FX path shares that binary, so it
  would become one GPL-3.0-only work.
- Distributing it through stores whose terms conflict with GPL-3.0 (Apple App Store).
- Shipping Propellerhead's samples (`Standard.rbm`) on the strength of the GPL; the GPL does not
  license them.

**What must stay GPL-3.0-only if we link it:** `openrb338/` in full; the built
`openrb338.wasm`; any code derived from openrb, including ports; and, in a shipped build, the
combined work. A module the worklet instantiates and calls through a C ABI is treated as part
of one program, the same as dynamic linking. Being a separate `.wasm` file does not exempt the
JS/TS that drives it. The conservative reading, and the one this plan follows, is that a build
containing the module is a GPL-3.0 work as a whole.

## Options

| Option | Licence effect | Verdict |
|--------|----------------|---------|
| **A. Separate optional module, not shipped (today)** | Default build stays free of GPL-3.0-only code. The voices fall back to Stock Open303. | **Keep as the default.** |
| **B. Separate module, shipped only in a GPL-3.0 build flavour** | The `openrb` flavour (app + module) is GPL-3.0 with source. The default flavour omits the module and is unaffected. | **Recommended for shipping**, once the owner picks a project licence. |
| **C. Bring-your-own module** | The user builds or downloads `openrb338.wasm` and loads it. Hyphon ships none of it. The loader needs no GPL code. | Lowest-risk way to keep a non-GPL app. The legal line (an app built around a GPL plugin ABI) is less settled than B, so treat it as "probably fine", not "safe". Needs a loader UI. |
| **D. Merge into `hyphon_native.wasm`** | Whole native binary becomes GPL-3.0-only. | **No.** |
| **E. Clean-room reimplementation** | Free of the GPL, but cannot be bit-exact by copying, and must be written from hardware behaviour and listening, with nobody who read the openrb source. It would also have to re-prove the numbers against reference renders. | Fallback only, if GPL shipping is ruled out. Not the same as the existing `rebirth-*` coefficient profiles. |
| **F. Ask upstream for a licence exception / dual licence** | Possible if every contributor agrees. | Worth asking in parallel. It does nothing about the ReBirth provenance question. |

## Recommended strategy

1. **Keep the module isolated.** `openrb338/` stays its own crate, its own build
   (`build:wasm:openrb338`), outside `hyphon_native.wasm`, and out of `build:native` by default.
   Option A holds until the owner decides.
2. **Pick the project licence before the first publish that includes the module.** Rubber Band
   already makes any distributed Hyphon build a GPL-covered combined work unless a commercial
   Rubber Band licence is held. If none is, the consistent choice is to license the app
   **GPL-3.0-or-later** (or GPL-3.0-only), add a `LICENSE`, and ship option B. If one is held,
   keep the app proprietary and ship the module only as option C, or not at all.
3. **Gate by build flavour, not by runtime.** The module must be present in a build only when
   that build is released as GPL-3.0. Add a build-time switch (`HYPHON_OPENRB338=1`) that copies
   the module into the bundle and flips `isOpenrb338ModuleBundled()`. The default release script
   must not set it.
4. **Notices when it ships:** an entry in `THIRD_PARTY_NOTICES.md` (source URL, pinned revision,
   GPL-3.0-only, copyright line), the licence text in `dist/`, and a link or written offer for
   the corresponding source with each release.
5. **Do not build more on this until two questions are answered:** whether upstream's
   ReBirth.dll-derived tables raise an independent rights issue for a published build (ask
   upstream how it handled this; the GPL does not settle it), and whether Rubber Band is
   covered by a commercial licence. Neither blocks developing and testing locally.
6. **Drums:** same position as the 303, plus no Propellerhead audio in any build or repo. Engine
   only, user-supplied kit.

## Decision checklist (owner)

- [ ] Hyphon is released under GPL-3.0(-or-later) / keeps another licence (decides B vs C)
- [ ] A commercial Rubber Band licence is / is not held
- [ ] Upstream contacted about the exception and the table provenance
- [ ] `HYPHON_OPENRB338` build flag implemented, with the notices from item 4
