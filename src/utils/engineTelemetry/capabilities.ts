// Browser capability probes (privacy-preserving, DOM-optional).

// ── Capability snapshot (privacy-preserving) ────────────────────────────────
// Deliberately excludes the raw navigator.userAgent string (User-Agent Reduction
// makes it low-value and a fingerprinting footgun). Only low-entropy Client Hints
// (userAgentData brands/platform) are included when the browser exposes them.

export interface BrowserCapabilities {
  webgpu: boolean;
  audioWorklet: boolean;
  wasmSimd: boolean;
  pyodide: boolean;
  secureContext: boolean;
  tier: 'high' | 'medium' | 'low';
  userAgentData?: { brands?: unknown; platform?: string };
}

// Minimal valid WASM module exercising a v128 (SIMD) result type — used purely to
// feature-detect SIMD support via WebAssembly.validate (zero dependency).
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
  65, 0, 253, 15, 253, 98, 11,
]);

/** True when this engine validates WASM SIMD (simd128). Never throws. */
export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}

export function getBrowserCapabilities(): BrowserCapabilities {
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as Record<string, unknown>) : undefined;
  const webgpu = !!(nav && nav.gpu);
  const audioWorklet = typeof AudioWorkletNode !== 'undefined';
  const wasmSimd = wasmSimdSupported();
  const pyodide =
    typeof window !== 'undefined' &&
    ('loadPyodide' in window || !!(window as unknown as Record<string, unknown>).pyodide);
  const secureContext = typeof window !== 'undefined' ? !!window.isSecureContext : false;
  const tier: BrowserCapabilities['tier'] =
    webgpu && audioWorklet && wasmSimd ? 'high' : audioWorklet && wasmSimd ? 'medium' : 'low';

  const caps: BrowserCapabilities = { webgpu, audioWorklet, wasmSimd, pyodide, secureContext, tier };

  const uad = nav && (nav.userAgentData as { brands?: unknown; platform?: string } | undefined);
  if (uad) {
    caps.userAgentData = { brands: uad.brands, platform: uad.platform };
  }
  return caps;
}


/** Playwright WebKit / Safari — pthread hyphon_native.wasm aborts in AudioWorklet. */
export function isAppleWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // happy-dom / many test UAs include AppleWebKit without being Safari.
  // Chrome also includes "Safari/" — exclude Chromium family first.
  if (/Chrome|Chromium|Edg|Android|Firefox|HeadlessChrome|HappyDOM|jsdom/i.test(ua)) return false;
  return /AppleWebKit/i.test(ua) && /Safari\//i.test(ua);
}

