import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelErrorBoundary } from '../PanelErrorBoundary'
import { __resetGlobalErrorHandlersForTest, getAppErrors, installGlobalErrorHandlers } from '@/utils/globalErrorHandlers'

let shouldThrow = true
const Bomb = () => {
  if (shouldThrow) throw new Error('boom')
  return <div>ok</div>
}

describe('PanelErrorBoundary', () => {
  beforeEach(() => {
    __resetGlobalErrorHandlersForTest()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows a fallback, reports, and recovers on retry', () => {
    shouldThrow = true
    render(<PanelErrorBoundary panel="sequencer"><Bomb /></PanelErrorBoundary>)
    expect(screen.getByTestId('panel-error-sequencer').textContent).toContain('boom')
    expect(getAppErrors().some((e) => e.panel === 'sequencer')).toBe(true)
    shouldThrow = false
    fireEvent.click(screen.getByText('Reload panel'))
    expect(screen.getByText('ok')).toBeTruthy()
  })

  it('records unhandled rejections without throwing', () => {
    installGlobalErrorHandlers()
    const ev = new Event('unhandledrejection') as Event & { reason: unknown }
    Object.defineProperty(ev, 'reason', { value: new Error('late') })
    window.dispatchEvent(ev)
    expect(getAppErrors().at(-1)?.message).toBe('late')
  })
})
