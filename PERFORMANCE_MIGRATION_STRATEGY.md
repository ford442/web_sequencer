# Universal Incremental Migration Protocol (UIMP) v2.0

**Purpose:** A standardized workflow for migrating high-performance JavaScript applications (Audio, Graphics, Compute) to stricter, faster technologies (TS, AssemblyScript, C++, WebGPU) without breaking the existing codebase.

**Core Philosophy:** The "Bridge" Pattern.
We never delete the original JavaScript entry point immediately. The JS file remains as the **Orchestrator**, managing data conversion and API stability, while the heavy lifting is incrementally offloaded to "Sidecar" modules.

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
