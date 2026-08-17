import { resolvePublicAsset } from '../../utils/engineTelemetry';
import type { Wam2RuntimeConstraints } from './types';

/**
 * Probe COOP/COEP, worklet, worker, and relative-base deployment.
 * Does not fetch remote plugin URLs.
 */
export function collectWam2RuntimeConstraints(): Wam2RuntimeConstraints {
  const crossOriginIsolated =
    typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false;

  let coopHint: string | null = null;
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[http-equiv="Cross-Origin-Opener-Policy"]');
    coopHint = meta?.getAttribute('content') ?? null;
  }

  const audioWorklet = typeof AudioWorkletNode !== 'undefined';
  const worker = typeof Worker !== 'undefined';

  const baseUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? String(import.meta.env.BASE_URL)
      : './';

  let subdirectoryDeploy = baseUrl !== '/' && baseUrl !== '';
  try {
    const sample = resolvePublicAsset('wam/catalog.json');
    subdirectoryDeploy = subdirectoryDeploy || /\/.+\/wam\//.test(new URL(sample, 'https://example.invalid').pathname);
  } catch {
    /* keep baseUrl heuristic */
  }

  return {
    crossOriginIsolated,
    coopHint,
    audioWorklet,
    worker,
    baseUrl,
    subdirectoryDeploy,
  };
}
