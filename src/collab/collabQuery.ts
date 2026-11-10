/**
 * `?collab=local` (#1597 P1) opens a collab session on the autosave project:
 * the project doc, its update log, and the BroadcastChannel provider that keeps
 * this browser's tabs in one room. Kept apart from the session code so App.tsx
 * can check the flag without pulling Yjs into the entry chunk.
 */

export type CollabMode = 'local';

export function collabModeFromSearch(search: string): CollabMode | null {
    return new URLSearchParams(search).get('collab') === 'local' ? 'local' : null;
}
