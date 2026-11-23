/**
 * App-wide error reporting. `unhandledrejection` / `error` are logged and
 * surfaced as a throttled toast via engineDegradationStore's toast handler;
 * they never take the app down (preventDefault keeps the console clean of the
 * duplicate "Uncaught (in promise)" line once we have reported it).
 */
export interface AppErrorContext {
  source: 'unhandledrejection' | 'error' | 'error-boundary'
  panel?: string
  componentStack?: string
}

export interface AppErrorRecord extends AppErrorContext {
  message: string
  at: number
}

const MAX_RECORDS = 50
const records: AppErrorRecord[] = []
type Listener = (r: AppErrorRecord) => void
const listeners = new Set<Listener>()

export function onAppError(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getAppErrors(): readonly AppErrorRecord[] {
  return records
}

function toMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name
  if (typeof reason === 'string') return reason
  try { return JSON.stringify(reason) } catch { return String(reason) }
}

export function reportAppError(reason: unknown, ctx: AppErrorContext): AppErrorRecord {
  const rec: AppErrorRecord = { ...ctx, message: toMessage(reason), at: Date.now() }
  records.push(rec)
  if (records.length > MAX_RECORDS) records.shift()
  console.error(`[hyphon:${ctx.source}${ctx.panel ? `:${ctx.panel}` : ''}]`, reason)
  for (const l of listeners) {
    try { l(rec) } catch { /* a listener must not re-throw into the handler */ }
  }
  return rec
}

let installed = false
export function installGlobalErrorHandlers(target: Window = window): void {
  if (installed) return
  installed = true
  target.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    reportAppError(ev.reason, { source: 'unhandledrejection' })
    ev.preventDefault()
  })
  target.addEventListener('error', (ev: ErrorEvent) => {
    // Resource load errors (img/script) have no `error`; leave those to the browser.
    if (!ev.error && !ev.message) return
    reportAppError(ev.error ?? ev.message, { source: 'error' })
  })
}

/** @internal test hook */
export function __resetGlobalErrorHandlersForTest(): void {
  installed = false
  records.length = 0
  listeners.clear()
}
