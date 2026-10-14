/**
 * Arrangement playhead, published from the worklet step handler. The
 * Arrangement view subscribes and moves its playhead imperatively, so the
 * transport never re-renders React.
 */
type Listener = (songStep: number) => void;

let current = -1;
const listeners = new Set<Listener>();

export const arrangementPlayhead = {
    /** Song step last played, or -1 when stopped / not in the linear player. */
    get(): number {
        return current;
    },
    publish(songStep: number): void {
        if (songStep === current) return;
        current = songStep;
        listeners.forEach((fn) => fn(songStep));
    },
    subscribe(fn: Listener): () => void {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    },
};
