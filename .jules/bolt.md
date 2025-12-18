# Bolt's Journal
## 2024-05-23 - Stabilizing Callbacks
**Learning:**  can be extremely sensitive to whitespace and context. When patching a file that has been modified or read in a specific state, always ensure the search block is an exact character-for-character match of what is currently on disk. Even better, copy-paste the block directly from a fresh  output immediately before applying the patch.
**Action:** When using  for critical hot-path optimizations (like wrapping handlers in ), first verify the exact target lines with  or . If a patch fails due to context mismatch, do not assume the tool is broken; re-read the file and adjust the search block.
## 2024-05-23 - Stabilizing Callbacks
**Learning:** replace_with_git_merge_diff can be extremely sensitive to whitespace and context. When patching a file that has been modified or read in a specific state, always ensure the search block is an exact character-for-character match of what is currently on disk. Even better, copy-paste the block directly from a fresh read_file output immediately before applying the patch.
**Action:** When using replace_with_git_merge_diff for critical hot-path optimizations (like wrapping handlers in useCallback), first verify the exact target lines with grep or read_file. If a patch fails due to context mismatch, do not assume the tool is broken; re-read the file and adjust the search block.
