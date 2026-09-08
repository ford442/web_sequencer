import { describe, it, expect } from 'vitest';
import { Open303EngineSession } from '../open303/engineSession';

/**
 * Handle ABI across the worklet-to-WASM boundary.
 *
 * `open303_create()` returns an i32 handle as a JS number in this wasm32 build.
 * Coercing it to BigInt (WASM_BIGINT only governs i64) makes every subsequent
 * call throw "Cannot convert a BigInt value to a number", which silently
 * demoted all three 303 voices to the JS fallback.
 */
describe('Open303EngineSession.toWasmHandle', () => {
  const session = new Open303EngineSession(
    { postMessage: () => {} } as unknown as MessagePort,
  );

  it('passes a number handle through unchanged', () => {
    expect(session.toWasmHandle(1)).toBe(1);
    expect(typeof session.toWasmHandle(42)).toBe('number');
  });

  it('preserves a bigint handle for a future MEMORY64 build', () => {
    expect(session.toWasmHandle(7n)).toBe(7n);
    expect(typeof session.toWasmHandle(7n)).toBe('bigint');
  });
});
