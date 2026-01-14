## 2024-05-23 - Bug Discovery in audioExport
**Learning:** Found a critical bug in WAV export where reusing a variable `pos` (used for header byte offset) as a sample loop index caused the first 44 samples to be skipped.
**Action:** Always verify variable scope and reuse, especially in "C-style" manual byte writing code. When refactoring/optimizing, check for logical errors in the original code first.
