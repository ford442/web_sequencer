# Bolt's Journal
## 2024-05-23 - Stabilizing Callbacks
**Learning:** replace_with_git_merge_diff can be extremely sensitive to whitespace and context. When patching a file that has been modified or read in a specific state, always ensure the search block is an exact character-for-character match of what is currently on disk. Even better, copy-paste the block directly from a fresh read_file output immediately before applying the patch.
**Action:** When using replace_with_git_merge_diff for critical hot-path optimizations (like wrapping handlers in useCallback), first verify the exact target lines with grep or read_file. If a patch fails due to context mismatch, do not assume the tool is broken; re-read the file and adjust the search block.

## 2024-05-24 - Demand-Based WebGPU Rendering
**Learning:** For WebGPU visualizations that represent static state (like knobs), a continuous `requestAnimationFrame` loop is wasteful. React's prop updates can be used to trigger imperative WebGPU renders only when data changes.
**Action:** Identify static WebGPU components, expose their `render` method via a `useRef`, and trigger it from a `useEffect` watching the data props. Ensure the `render` method reads from a mutable `Ref` of the data to avoid closure staleness issues.

## 2024-05-24 - Git Merge Diff Sensitivity
**Learning:** `replace_with_git_merge_diff` is extremely sensitive to context. When attempting to replace multiple separate blocks (functions) in a single call, it often fails if the context between blocks is not perfectly matched or if the tool expects contiguous blocks.
**Action:** When applying multiple distinct optimizations to the same file, it is safer and more reliable to apply them one by one using separate tool calls, or ensure the search block encompasses the entire region including unchanged code between functions (which increases risk of conflict).
