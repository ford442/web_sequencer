import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PhoneNotice, PHONE_NOTICE_MAX_WIDTH_PX } from '../PhoneNotice';
import { CompactLayoutContext } from '../../contexts/compactLayoutStore';
import type { CompactLayoutState } from '../../hooks/useCompactLayout';

function renderAt(viewportWidth: number) {
    const state: CompactLayoutState = {
        preference: 'auto',
        isCompact: true,
        isPortrait: true,
        isCoarsePointer: true,
        viewportWidth,
        setPreference: () => undefined,
        toggleCompact: () => undefined,
    };
    return render(
        <CompactLayoutContext.Provider value={state}>
            <PhoneNotice />
        </CompactLayoutContext.Provider>,
    );
}

describe('PhoneNotice', () => {
    beforeEach(() => sessionStorage.clear());

    it('explains the screen-size limit on a phone-width viewport', () => {
        renderAt(390);
        expect(screen.getByTestId('phone-notice')).toHaveTextContent(/tablet or desktop/i);
    });

    it('stays out of the way at tablet width and above', () => {
        renderAt(PHONE_NOTICE_MAX_WIDTH_PX);
        expect(screen.queryByTestId('phone-notice')).toBeNull();
    });

    it('is dismissible and remembers the dismissal for the session', () => {
        const { unmount } = renderAt(390);
        fireEvent.click(screen.getByRole('button', { name: /dismiss screen-size notice/i }));
        expect(screen.queryByTestId('phone-notice')).toBeNull();
        unmount();
        renderAt(390);
        expect(screen.queryByTestId('phone-notice')).toBeNull();
    });
});
