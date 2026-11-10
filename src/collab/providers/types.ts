/**
 * The one interface every way of reaching other peers implements (#1597 D3):
 * `local` (BroadcastChannel — tabs of this browser, and the test provider)
 * now; `webrtc` and `relay` in later slices.
 *
 * A provider keeps its doc in sync with the room's other docs and nothing
 * else: it never writes song data of its own. Updates it receives are applied
 * with the provider itself as the transaction origin, so `origin === provider`
 * tells remote changes from local ones.
 */

export type CollabProviderKind = 'local' | 'webrtc' | 'relay';

export type CollabProviderStatus = 'connected' | 'disconnected';

export interface CollabProvider {
    readonly kind: CollabProviderKind;
    /** Room name the provider joined. */
    readonly room: string;
    readonly status: CollabProviderStatus;
    /** True once at least one peer has answered this provider's sync request. */
    readonly synced: boolean;
    /** Doc client ids of the peers currently in the room. */
    peers(): number[];
    /**
     * Resolves true once a peer has answered, or false after `timeoutMs` with
     * no answer (alone in the room). Never rejects.
     */
    whenSynced(timeoutMs: number): Promise<boolean>;
    /** Called on any change of status, `synced` or the peer set. */
    subscribe(listener: () => void): () => void;
    /** Leave the room. The doc is left as it is. */
    destroy(): void;
}
