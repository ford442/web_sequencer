## 2025-04-13 - Add aria-busy to processing buttons
**Learning:** Buttons that represent an asynchronous or intensive background process (such as rendering/mixdown or AI processing) should be explicitly marked with `aria-busy` to let screen reader users know that the system is doing work.
**Action:** When a button handles "Rendering..." or similar delayed states, ensure `aria-busy={isRendering}` or equivalent is added alongside `disabled={isRendering}`.
