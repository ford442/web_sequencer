# Visual regression (Release 3/5)

`tests/visual-showcase.spec.ts` checks the UI at six sizes (1920x1080, 1440x900, 1280x720, 1024x768,
768x1024, 390x844) and in the states a user can land in. Two kinds of check:

1. **Layout facts, every browser** (`tests/helpers/visual.ts` `auditLayout`): no horizontal page scroll, no header or
   bottom-bar control clipped by the window edge, header never overlapping the scrolling region, touch targets
   >= 32px on a coarse pointer, and zero *unexpected* console errors / failed requests (`ReleaseGuard`). States that
   fail on purpose (WASM blocked, no WebGPU) list what they are allowed to log in `INTENTIONAL`.
2. **Pixel baselines, Linux, Chromium + Firefox**: `toHaveScreenshot` against `tests/__screenshots__/visual-showcase.spec.ts/<project>/`.
   WebKit has layout facts only until its baselines are generated on a machine that can launch it.

```bash
pnpm run build
pnpm run test:visual                 # compare
pnpm run test:visual:update          # regenerate baselines on purpose (Linux), review the PNG diff in the PR
DEPLOY_SMOKE_URL=https://host/staging/ pnpm run test:visual   # against a deployed build
node scripts/visual-report.mjs --in visual-report --url <url> --sha <sha>   # grid + REPORT.md
```

Sandbox notes: `VISUAL_IGNORE_HTTPS_ERRORS=1` for a Firefox that does not trust an egress proxy's CA (never on staging).
A Firefox with no audio sink skips the *playing* phase (annotated); a browser that reports no hover capability
or ignores `deviceScaleFactor` skips those two checks (annotated).
