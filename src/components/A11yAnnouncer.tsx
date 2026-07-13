import { useEffect, useRef } from 'react';
import { useA11yAnnouncer } from '../stores/a11yAnnouncerStore';

/** Global live region for screen-reader transport / playhead announcements. */
export function A11yAnnouncer() {
    const announcement = useA11yAnnouncer();
    const politeRef = useRef<HTMLDivElement>(null);
    const assertiveRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!announcement) return;
        const target =
            announcement.politeness === 'assertive' ? assertiveRef.current : politeRef.current;
        if (target) {
            target.textContent = announcement.message;
        }
    }, [announcement]);

    return (
        <>
            <div
                ref={politeRef}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            />
            <div
                ref={assertiveRef}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="sr-only"
            />
        </>
    );
}
