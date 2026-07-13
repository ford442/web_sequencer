# Archived one-off patch scripts (inert)

These files are **forensic history** from the `useAudioEngine.ts` / `audioPlayback.ts` TypeScript parse-error debugging saga (brace mismatch, manual patching attempts). They are **not** part of the build, CI, or dev workflow.

## Do not run

| Script | Notes |
|--------|--------|
| `fix_missing_brace.py`, `fix_braces2.py` | Hand-edited brace balancing |
| `fix_ts_errors.py` … `fix_ts_errors5.py` | Iterative TS error patch attempts |
| `patch_engine.py`, `patch_engine_*.py` | Bulk engine file rewrites |
| `patch_exact_manual17.py` … `patch_exact_manual20.py` | Manual line-range patches |
| `count_braces.py`, `test_match.py` | Debug helpers for the same incident |
| `fix_mess.sh` | Shell runner that invoked the above (also archived) |

Running any of these against the current tree may corrupt source files. Use git history if you need to understand what was tried.

**Supported workflows:** see root [README.md](../../README.md) and [AGENTS.md](../../AGENTS.md).
