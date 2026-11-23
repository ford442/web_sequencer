import { isolationMissing } from '@/utils/crossOriginIsolation'

/**
 * Degraded-mode message when the page is not cross-origin isolated (COOP/COEP
 * headers stripped by a proxy/host), which removes SharedArrayBuffer and forces
 * the single-threaded native build.
 */
export const IsolationNotice: React.FC = () => {
  if (!isolationMissing()) return null
  return (
    <div role="status" data-testid="isolation-notice" className="mx-auto my-1 max-w-[1000px] rounded border border-amber-600/50 bg-amber-950/40 px-3 py-1 font-mono text-[11px] text-amber-200">
      SharedArrayBuffer unavailable: this page is not cross-origin isolated (COOP/COEP headers missing).
      Audio runs in single-threaded mode, so heavy sessions may glitch. Reload from the official host, or ask your host to send
      <code className="mx-1">Cross-Origin-Opener-Policy: same-origin</code> and
      <code className="mx-1">Cross-Origin-Embedder-Policy: require-corp</code>.
    </div>
  )
}
