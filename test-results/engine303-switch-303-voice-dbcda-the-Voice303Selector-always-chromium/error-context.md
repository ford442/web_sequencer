# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: "Failed to load url /hyphon_native.js (resolved id: /hyphon_native.js). This file is in /public and will be copied as-is during build without going through the plugin transforms, and therefore should not be imported from source code. It can only be referenced via HTML tags."
  - generic [ref=e5]: at loadAndTransform (file:///app/node_modules/.pnpm/vite@5.4.21_@types+node@24.10.4/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async viteTransformMiddleware (file:///app/node_modules/.pnpm/vite@5.4.21_@types+node@24.10.4/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:62106:24
  - generic [ref=e6]:
    - text: Click outside, press Esc key, or fix the code to dismiss.
    - text: You can also disable this overlay by setting
    - code [ref=e7]: server.hmr.overlay
    - text: to
    - code [ref=e8]: "false"
    - text: in
    - code [ref=e9]: vite.config.ts
    - text: .
```