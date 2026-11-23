import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChassisDeckContext } from '../chassisContext';
import { ChassisDeckPortal } from '../ChassisDeckPortal';

/**
 * Tall oscillator pickers (303 voice list, Prophecy / Macro panels) are clipped by the 380px
 * oscillator stage when they sit in the overlay column. In a chassis the host opens a deck under
 * the knobs and the pickers render there; everywhere else they stay where they are.
 */
describe('ChassisDeckPortal', () => {
    it('renders in place when no deck is open', () => {
        render(
            <div data-testid="column">
                <ChassisDeckPortal><button type="button">voice</button></ChassisDeckPortal>
            </div>,
        );
        expect(within(screen.getByTestId('column')).getByText('voice')).toBeTruthy();
    });

    it('renders into the deck element, out of the column, when one is open', () => {
        const deck = document.createElement('div');
        deck.setAttribute('data-testid', 'deck');
        document.body.appendChild(deck);
        try {
            render(
                <ChassisDeckContext.Provider value={deck}>
                    <div data-testid="column">
                        <ChassisDeckPortal><button type="button">voice</button></ChassisDeckPortal>
                    </div>
                </ChassisDeckContext.Provider>,
            );
            expect(within(deck).getByText('voice')).toBeTruthy();
            expect(within(screen.getByTestId('column')).queryByText('voice')).toBeNull();
        } finally {
            deck.remove();
        }
    });
});
