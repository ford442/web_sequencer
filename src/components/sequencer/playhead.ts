/**
 * Playhead marking for sequencer step elements.
 *
 * The rows move the playhead imperatively (one element per row per tick), so
 * the class and the attribute are toggled together here: `is-current` drives
 * the dark-theme SEQUENCER_STYLES rules, and `data-playhead` drives the white
 * chassis pad material (#1589) the same way `ChassisLedStrip` does. Both
 * change on the same single element, so the chassis adds no extra style
 * recalc per tick.
 */
const PLAYHEAD_CLASS = 'is-current';
const PLAYHEAD_ATTR = 'data-playhead';

export function setStepPlayhead(el: Element | null | undefined, on: boolean): void {
    if (!el) return;
    if (on) {
        el.classList.add(PLAYHEAD_CLASS);
        el.setAttribute(PLAYHEAD_ATTR, '');
    } else {
        el.classList.remove(PLAYHEAD_CLASS);
        el.removeAttribute(PLAYHEAD_ATTR);
    }
}
