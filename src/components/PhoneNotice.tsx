import { memo, useCallback, useState } from 'react';
import { useCompactLayoutContext } from '../contexts/compactLayoutStore';

const STORAGE_KEY = 'hyphon:phone-notice-dismissed';
/** Below this the 32-step grid cannot keep its steps tappable: say so instead of silently cramping. */
export const PHONE_NOTICE_MAX_WIDTH_PX = 600;

function readDismissed(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Explicit "best on a larger screen" notice for phone-width viewports (Release 3/5). The app still
 * runs here (the transport dock, bottom bar and rack scroll), but the step grid is scaled for
 * tablets and up; telling people beats leaving them to wonder why the controls are small.
 */
export const PhoneNotice = memo(function PhoneNotice() {
    const { viewportWidth } = useCompactLayoutContext();
    const [dismissed, setDismissed] = useState(readDismissed);

    const dismiss = useCallback(() => {
        setDismissed(true);
        try {
            sessionStorage.setItem(STORAGE_KEY, '1');
        } catch {
            // private mode / blocked storage: dismissal just lasts until reload
        }
    }, []);

    if (dismissed || viewportWidth >= PHONE_NOTICE_MAX_WIDTH_PX) return null;

    return (
        <div
            data-testid="phone-notice"
            role="note"
            className="relative z-40 shrink-0 flex items-start gap-3 bg-cyan-950/90 border-b border-cyan-700/50 text-cyan-100 px-3 py-2 text-xs"
        >
            <p className="flex-1 min-w-0">
                <span className="font-bold uppercase tracking-wider text-cyan-300">Best on a tablet or desktop.</span>{' '}
                Hyphon&apos;s step grid and rack are built for a larger screen. Rotate to landscape or open it on a bigger display for the full instrument.
            </p>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss screen-size notice"
                className="shrink-0 min-h-[36px] min-w-[36px] rounded-md border border-cyan-700/60 bg-cyan-900/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation hover:bg-cyan-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
                OK
            </button>
        </div>
    );
});
