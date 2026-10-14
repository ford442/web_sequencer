/**
 * Type-level registration of the @testing-library/jest-dom matchers with
 * Vitest's `expect` (the runtime side is `@testing-library/jest-dom/vitest`
 * in vitest.setup.ts).
 *
 * jest-dom's own `vitest.d.ts` augments `interface Assertion<T = any>`, which
 * no longer merges with Vitest >= 4's `Assertion<R, T>`, and Vitest no longer
 * links its Assertion to the global `jest.Matchers` namespace that
 * `import '@testing-library/jest-dom'` augments. `Matchers<R, T>` is Vitest's
 * documented extension point for custom matchers, so register them there.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Declaration merging requires repeating Vitest's exact type parameters, so
// `T` is necessarily unused here and the interface body is empty by design.
/* eslint @typescript-eslint/no-unused-vars: "off", @typescript-eslint/no-empty-object-type: "off" */

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
