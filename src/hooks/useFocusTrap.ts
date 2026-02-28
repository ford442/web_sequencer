import { useEffect, useRef, type RefObject } from 'react';

/**
 * Traps focus within a container when active.
 * Restores focus to the previously focused element on cleanup.
 *
 * @param isActive Whether the focus trap is active
 * @param onClose Optional callback when Escape is pressed
 * @param initialFocusRef Optional ref to an element to focus on mount. Defaults to the first focusable element.
 */
export const useFocusTrap = <T extends HTMLElement = HTMLDivElement>(
    isActive: boolean,
    onClose?: () => void,
    initialFocusRef?: RefObject<HTMLElement | null>
) => {
    const containerRef = useRef<T>(null);

    // 1. Capture/Restore Focus & Initial Focus
    useEffect(() => {
        if (!isActive) return;

        // Capture previous focus
        const previousFocus = document.activeElement as HTMLElement;

        // Initial Focus Logic
        // We use a small timeout to ensure the DOM is fully ready if the component just mounted
        const doFocus = () => {
            const element = containerRef.current;
            if (element) {
                if (initialFocusRef?.current) {
                    initialFocusRef.current.focus();
                } else {
                    const focusable = element.querySelectorAll<HTMLElement>(
                        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                    );
                    if (focusable.length > 0) {
                        focusable[0].focus();
                    } else {
                        // If no focusable children, focus the container itself (ensure it has tabindex in markup)
                        element.focus();
                    }
                }
            }
        };

        // Some tests might not support requestAnimationFrame properly
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(doFocus);
        } else {
            setTimeout(doFocus, 0);
        }

        return () => {
            // Restore focus
            setTimeout(() => {
                if (previousFocus && typeof previousFocus.focus === 'function') {
                    previousFocus.focus();
                }
            }, 0);
        };
    }, [isActive, initialFocusRef]); // Only run when activation state changes (initialFocusRef usually stable)

    // 2. Key Handler (Trap Logic)
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && onClose) {
                e.preventDefault();
                onClose();
                return;
            }

            if (e.key === 'Tab') {
                const element = containerRef.current;
                if (!element) return;

                const focusableElements = element.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );

                if (focusableElements.length === 0) return;

                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, onClose]);

    return containerRef;
};
