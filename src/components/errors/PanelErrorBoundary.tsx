import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportAppError } from '@/utils/globalErrorHandlers'

interface Props {
  /** Panel name shown in the fallback and attached to the error report. */
  panel: string
  children: ReactNode
}

interface State {
  error: Error | null
  resetKey: number
}

/**
 * Catches a render/lifecycle crash inside one major panel (sequencer,
 * arrangement, rack/mixer, modal hosts for Voice Designer + TTS) and shows a
 * recoverable fallback in its place, so the rest of the app — and audio,
 * which lives in worklets outside React — keeps running.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportAppError(error, { source: 'error-boundary', panel: this.props.panel, componentStack: info.componentStack ?? undefined })
  }

  private retry = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))
  }

  render(): ReactNode {
    const { error, resetKey } = this.state
    if (error) {
      return (
        <div
          role="alert"
          data-testid={`panel-error-${this.props.panel}`}
          className="m-2 rounded border border-red-700/60 bg-red-950/40 p-3 font-mono text-xs text-red-200"
        >
          <div className="mb-1 uppercase tracking-widest text-red-300">{this.props.panel} crashed</div>
          <div className="mb-2 break-words text-red-200/80">{error.message || String(error)}</div>
          <button
            type="button"
            onClick={this.retry}
            className="rounded border border-red-500 px-2 py-1 text-red-100 hover:bg-red-800/50"
          >
            Reload panel
          </button>
        </div>
      )
    }
    return <div key={resetKey} className="contents">{this.props.children}</div>
  }
}
