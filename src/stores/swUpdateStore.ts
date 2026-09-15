// Tiny pub-sub bridging the service-worker registration in main.tsx (which
// runs before React mounts, so it cannot call a hook) to a React component
// deep in the tree — same shape as engineDegradationStore's toastHandler
// bridge, just for the one "a new version is waiting" event.
type Listener = (applyUpdate: (() => void) | null) => void;

class SwUpdateStore {
    private applyUpdate: (() => void) | null = null;
    private listeners = new Set<Listener>();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.applyUpdate);
        return () => this.listeners.delete(listener);
    }

    notifyUpdateAvailable(applyUpdate: () => void): void {
        this.applyUpdate = applyUpdate;
        this.listeners.forEach((l) => l(applyUpdate));
    }

    dismiss(): void {
        this.applyUpdate = null;
        this.listeners.forEach((l) => l(null));
    }
}

export const swUpdateStore = new SwUpdateStore();
