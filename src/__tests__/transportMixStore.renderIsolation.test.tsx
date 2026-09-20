import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { transportMixStore, useTransportMixStore } from '../stores/transportMixStore'

describe('transportMixStore Render Isolation', () => {
    beforeEach(() => {
        transportMixStore.reset()
    })

    it('subscribing to tempo does not re-render when masterVolume changes', () => {
        const renderSpy = vi.fn()

        function TempoSubscriber() {
            const tempo = useTransportMixStore((s) => s.tempo)
            renderSpy()
            return <div data-testid="tempo">{tempo}</div>
        }

        render(<TempoSubscriber />)
        expect(renderSpy).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('tempo').textContent).toBe('120')

        // Action: Change masterVolume (should NOT trigger re-render)
        act(() => {
            transportMixStore.setMasterVolume(0.5)
        })
        expect(renderSpy).toHaveBeenCalledTimes(1)

        // Action: Change tempo (should trigger re-render)
        act(() => {
            transportMixStore.setTempo(130)
        })
        expect(renderSpy).toHaveBeenCalledTimes(2)
        expect(screen.getByTestId('tempo').textContent).toBe('130')
    })
})
