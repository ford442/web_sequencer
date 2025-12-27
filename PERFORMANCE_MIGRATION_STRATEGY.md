# Universal Incremental Migration Protocol (UIMP) v2.0

**Purpose:** A standardized workflow for migrating high-performance JavaScript applications (Audio, Graphics, Compute) to stricter, faster technologies (TS, AssemblyScript, C++, WebGPU) without breaking the existing codebase.

**Core Philosophy:** The "Bridge" Pattern.
We never delete the original JavaScript entry point immediately. The JS file remains as the **Orchestrator**, managing data conversion and API stability, while the heavy lifting is incrementally offloaded to "Sidecar" modules.

---

## Quick Start for AI Agents

When starting a migration session:

1. **Scan for existing tags:** `grep -r "@mode:\|@migrate-target:\|@perf-bottleneck:" src/`
2. **Check this tracking table** (Section 6) for current migration status
3. **Run profiling** before any optimization: `npm run dev` then use browser DevTools Performance tab
4. **Follow the 4-Pass workflow** in Section 3 - never skip passes

---

## 1. The Technology Stack Levels

Move code down this stack **only** when profiling data justifies the complexity cost.

| Level | Tech | Best For | Role |
| :--- | :--- | :--- | :--- |
| **L1** | **JavaScript** (ES6+) | UI, DOM, Event Handling, High-level orchestration. | **The Controller** |
| **L2** | **TypeScript** | Complex State Management, Config Parsing, API Contracts. | **The Safety Net** |
| **L3** | **AssemblyScript** (WASM) | Math-heavy loops, Audio DSP, Per-pixel manipulation. | **The Calculator** |
| **L4** | **C++** (Emscripten) | Existing C libraries, complex physics/simulation, SIMD. | **The Heavy Lifter** |
| **L5** | **WebGPU** (WGSL) | Massively parallel compute, Particle systems, Rendering. | **The Accelerator** |

---

## 2. AI Context System (The "Breadcrumbs")

Use these machine-readable comments to maintain context between coding sessions and AI agents.

### A. Status Tags (Top of File)
* `// @mode: javascript` - Logic is pure JS. (Default)
* `// @mode: bridge` - This file is a wrapper; it delegates logic to a generic/WASM module.
* `// @mode: deprecated` - Ready for deletion (logic fully moved to consumer).

### B. Action Tags (Inline)
* `// @migrate-target: [stack-level]` - E.g., `// @migrate-target: assemblyscript`
* `// @perf-bottleneck: [reason]` - E.g., `// @perf-bottleneck: Garbage Collection thrashing`
* `// @future-plan: [note]` - Instructions for the next AI pass.

---

## 3. The 4-Pass Migration Workflow

### Pass 1: Analysis & Annotation (Non-Destructive)
**Goal:** Understand the data shapes and prepare for typing.
1.  **Do not change logic.**
2.  Add JSDoc types to all variables to clarify inputs/outputs (`/** @type {Float32Array} */`).
3.  Identify "Hot Loops" via profiling.
4.  Add `@migrate-target` tags to specific functions.

### Pass 2: The "Sidecar" Creation
**Goal:** Implement the logic in the stricter language.
1.  Create a sibling file:
    * JS: `src/audio/processor.js`
    * Target: `src/audio/processor.as.ts` (AssemblyScript) or `src/audio/processor.cpp`
2.  Implement the logic in the target language.
3.  **Strict Constraint:** The target module should handle raw data (TypedArrays/Pointers), not complex JS objects.

### Pass 3: The "Bridge" Implementation
**Goal:** Wire the new module into the old JS file.
1.  Import the compiled WASM/TS module into the original `.js` file.
2.  **Rewrite** the JS function to:
    * Convert data (if necessary).
    * Call the new module.
    * Return the result in the expected format.
3.  **Preserve Old Code:** Comment out the original JS logic at the bottom of the function for reference/fallback.

```javascript
// Example: src/dsp/filter.js
// @mode: bridge

import { wasmFilter } from '../wasm/dsp.wasm';

export function applyFilter(buffer) {
    // 1. Bridge: Delegate to WASM
    // @note-for-ai: memory management is handled by the shared buffer strategy
    const result = wasmFilter(buffer);
    return result;

    /* --- OLD LOGIC (PRESERVED) ---
    return buffer.map(v => v * 0.5);
    */
}
```

### Pass 4: Validation & Cleanup
**Goal:** Verify performance gains and clean up.
1.  Run profiling to confirm improvements.
2.  Remove `@migrate-target` tags from completed functions.
3.  Update the Migration Tracking Table (Section 6).
4.  Consider marking the original file as `@mode: deprecated` if all logic migrated.

---

## 4. Build Commands Reference

| Tech | Build Command | Output Location |
| :--- | :--- | :--- |
| TypeScript | `tsc -b` (via Vite) | Bundled by Vite |
| AssemblyScript | `npm run build:wasm` | `public/oscillators.wasm` |
| C++ (Emscripten) | `npm run build:emcc` | `public/hyphon_native.js/.wasm` |
| Full Build | `npm run build` | `dist/` |

---

## 5. File Naming Conventions

| Original File | AssemblyScript Sidecar | C++ Sidecar |
| :--- | :--- | :--- |
| `src/utils/audio.ts` | `assembly/audio.ts` | `emscripten/audio.cpp` |
| `src/engines/processor.ts` | `assembly/processor.ts` | `emscripten/processor.cpp` |

**Pattern:** Keep the same base name. Use directory structure to indicate target tech.

---

## 6. Migration Tracking Table

Track the current status of all migration candidates here.

| File | Current Level | Target Level | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `src/engines/WasmOscillator.ts` | L2 (TypeScript) | L3 (WASM Bridge) | ✅ Complete | Uses `assembly/oscillators.ts` |
| `src/engines/WebGpuOscillator.ts` | L2 (TypeScript) | L5 (WebGPU) | ✅ Complete | Native WebGPU shader |
| `src/utils/audioExport.ts` | L2 (TypeScript) | L3 (AssemblyScript) | 📋 Candidate | Hot loop in `audioBufferToWav` |
| `src/utils/trackFreezer.ts` | L2 (TypeScript) | L3/L4 | 📋 Candidate | Loop analysis functions |
| `src/utils/musicTheory.ts` | L2 (TypeScript) | L2 | ⏸️ Hold | Low complexity, no benefit |
| `src/utils/noteColors.ts` | L2 (TypeScript) | L2 | ⏸️ Hold | UI-only, no performance issue |
| `emscripten/main.cpp` | L4 (C++) | L4 | 🚧 Scaffold | Empty placeholder for future |

**Status Legend:**
- ✅ Complete: Migration finished
- 🚧 In Progress: Currently being migrated
- 📋 Candidate: Identified for future migration
- ⏸️ Hold: Not suitable for migration

---

## 7. Example: Existing Bridge Pattern (WasmOscillator)

The codebase already demonstrates the Bridge pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│  src/engines/WasmOscillator.ts                                  │
│  // @mode: bridge                                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ generate() method:                                       │   │
│  │   1. Validates inputs                                    │   │
│  │   2. Calls WASM: exports.generate(offset, rate, ...)    │   │
│  │   3. Copies result from WASM memory                      │   │
│  │   4. Returns Float32Array                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  assembly/oscillators.ts  (AssemblyScript)                      │
│  // @mode: assemblyscript                                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ generate() function:                                     │   │
│  │   - Pure math/DSP logic                                  │   │
│  │   - No JS object dependencies                            │   │
│  │   - Direct memory writes: store<f32>(offset, value)      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Adding New Migration Candidates

When identifying a new candidate:

1. **Profile First:** Use browser DevTools to identify actual bottlenecks
2. **Add Tags:** Annotate the function with `@migrate-target: [level]` and `@perf-bottleneck: [reason]`
3. **Update Table:** Add entry to Section 6 with status "📋 Candidate"
4. **Create Issue (Optional):** For larger migrations, create a GitHub issue

### Common Bottleneck Patterns

| Pattern | Example | Recommended Target |
| :--- | :--- | :--- |
| Float array processing | WAV encoding loops | AssemblyScript (L3) |
| Complex DSP math | Filters, FFT | AssemblyScript (L3) |
| Existing C/C++ library | Audio codecs | Emscripten (L4) |
| Massively parallel compute | Per-pixel effects | WebGPU (L5) |

---

## 9. Verification Checklist

Before marking a migration as complete:

- [ ] Original behavior preserved (unit tests pass)
- [ ] Performance improvement measured (document % gain)
- [ ] Fallback path exists (graceful degradation)
- [ ] Memory management verified (no leaks)
- [ ] Build commands updated if needed
- [ ] Documentation updated

---

## 10. Rollback Strategy

If a migration causes issues:

1. The original logic should still exist (commented out in bridge, or in git history)
2. Toggle back by editing the bridge function to use original logic
3. Mark the migration as "🚧 In Progress" with notes on the issue
4. Consider whether the complexity cost is worth the performance gain
