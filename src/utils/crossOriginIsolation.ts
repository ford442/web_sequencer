/** True when SharedArrayBuffer is gone because the page is not cross-origin isolated. */
export function isolationMissing(): boolean {
  if (typeof window === 'undefined') return false
  return typeof SharedArrayBuffer === 'undefined' || window.crossOriginIsolated === false
}
