# RBS test fixtures (#774)

License-clear **generated** fixtures ship in `generated/` and run in CI.

External reference files (jsynth / community songs) are **not committed** — download locally:

```bash
bash scripts/fetch-rbs-corpus.sh
RBS_FIXTURE_DIR=test-fixtures/rbs/corpus pnpm exec vitest run src/__tests__/RbsCorpus.test.ts
```

## Layout

| Path | Committed | Purpose |
|------|-----------|---------|
| `generated/*.rbs` | Yes | Struct-accurate RBS42 IFF files built by Hyphon |
| `corpus/*.rbs` | No (gitignored) | Downloaded reference songs for fidelity validation |
| `../10_isotherms.mid` | Yes | Former misnamed MIDI file — parser must reject as `.rbs` |

## Regenerate generated corpus

```bash
bash scripts/generate-rbs-corpus.sh
pnpm exec vitest run src/__tests__/RbsCorpus.test.ts -u   # refresh golden snapshots
```

## Provenance (external)

| File | Source |
|------|--------|
| `jsynth_*.rbs` | [nsauzede/jsynth](https://github.com/nsauzede/jsynth) — format reverse-engineering reference |
