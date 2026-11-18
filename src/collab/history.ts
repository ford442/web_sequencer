/**
 * Per-editor undo over the project doc (#1597 P2).
 *
 * One `Y.UndoManager` per local editor origin, each tracking every song
 * subtree: `human` (this tab's user: Ctrl/Cmd+Z) and `agent` (the
 * co-producer). An undo manager only ever reverts changes made under its own
 * origin, and Yjs never lets it overwrite a key someone else changed since —
 * so each tab undoes only its own edits, and the human's undo leaves the
 * co-producer's alone (and the other way round).
 *
 * Stack items carry metadata the history panel shows: a label, when the step
 * began, which editor made it, and the song fields before its first and after
 * its last change (from which the label is derived when no one gave one). Yjs
 * creates a fresh item each time a step crosses between the undo and redo
 * stacks; the metadata travels with it.
 */

import * as Y from 'yjs';
import type { SongFieldValues } from './binding';
import { describeEdit } from './editLabels';
import { songRootTypes } from './fields';

export type EditorKind = 'human' | 'agent';

/** A transaction origin for one local editor. Identity is what Yjs compares. */
export class EditorOrigin {
    constructor(readonly kind: EditorKind) {}
}

export interface HistoryEntry {
    /** Stable across undo/redo; pass to `jumpTo`. */
    id: string;
    editor: EditorKind;
    label: string;
    /** Epoch ms of the step's first change. */
    at: number;
    /** False once undone (it can be redone). */
    done: boolean;
}

export interface HistorySnapshot {
    /** Oldest first, every editor's steps interleaved by time. */
    entries: readonly HistoryEntry[];
    canUndo: boolean;
    canRedo: boolean;
}

/** What the runtime is writing, for the step it lands in. */
export interface EditContext {
    before: SongFieldValues;
    after: SongFieldValues;
    /** Overrides the derived label (co-producer tool calls, named actions). */
    label?: string;
}

interface StepMeta {
    id: string;
    editor: EditorKind;
    at: number;
    before: SongFieldValues;
    after: SongFieldValues;
    label?: string;
}

const META = 'hyphon:step';

export interface ProjectHistoryOptions {
    /** Changes of one editor closer together than this share a step. */
    humanCaptureTimeoutMs?: number;
    /** Steps kept per editor; older ones are dropped. */
    maxSteps?: number;
    now?: () => number;
}

const DEFAULT_CAPTURE_MS = 500;
const DEFAULT_MAX_STEPS = 200;
/** The agent's steps are bounded by `beginStep`, never by time. */
const NEVER = Number.MAX_SAFE_INTEGER;

let nextStepId = 1;

function metaOf(item: { meta: Map<unknown, unknown> }): StepMeta | undefined {
    return item.meta.get(META) as StepMeta | undefined;
}

export class ProjectHistory {
    readonly managers: Record<EditorKind, Y.UndoManager>;
    private readonly listeners = new Set<() => void>();
    private readonly now: () => number;
    private readonly maxSteps: number;
    private context: EditContext | null = null;
    private snapshot: HistorySnapshot = { entries: [], canUndo: false, canRedo: false };
    private dirty = true;
    private readonly labelCache = new WeakMap<StepMeta, { after: SongFieldValues; label: string }>();

    constructor(
        doc: Y.Doc,
        readonly origins: Record<EditorKind, EditorOrigin>,
        options: ProjectHistoryOptions = {},
    ) {
        this.now = options.now ?? Date.now;
        this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
        const scope = songRootTypes(doc);
        const make = (kind: EditorKind, captureTimeout: number) => {
            const manager = new Y.UndoManager(scope, {
                trackedOrigins: new Set([origins[kind]]),
                captureTimeout,
            });
            manager.on('stack-item-added', (event) => this.onAdded(kind, manager, event));
            manager.on('stack-item-updated', (event) => this.onUpdated(event));
            manager.on('stack-item-popped', () => this.changed());
            manager.on('stack-cleared', () => this.changed());
            return manager;
        };
        this.managers = {
            human: make('human', options.humanCaptureTimeoutMs ?? DEFAULT_CAPTURE_MS),
            agent: make('agent', NEVER),
        };
    }

    /** The runtime announces each write before it transacts, and clears it after. */
    setContext(context: EditContext | null): void {
        this.context = context;
    }

    /** The next change of `editor` starts a new step. */
    beginStep(editor: EditorKind): void {
        this.managers[editor].stopCapturing();
    }

    undo(editor: EditorKind = 'human'): boolean {
        return this.managers[editor].undo() !== null;
    }

    redo(editor: EditorKind = 'human'): boolean {
        return this.managers[editor].redo() !== null;
    }

    canUndo(editor: EditorKind = 'human'): boolean {
        return this.managers[editor].canUndo();
    }

    canRedo(editor: EditorKind = 'human'): boolean {
        return this.managers[editor].canRedo();
    }

    /** Labels of `editor`'s steps that can be undone, oldest first. */
    stepLabels(editor: EditorKind): string[] {
        return this.managers[editor].undoStack.map((item) => this.labelOf(metaOf(item)));
    }

    /**
     * Undo or redo `entry`'s editor until the song is as it was right after
     * that step. `'start'` undoes every human step.
     */
    jumpTo(id: string): boolean {
        if (id === 'start') {
            let moved = false;
            while (this.undo('human')) moved = true;
            return moved;
        }
        for (const editor of ['human', 'agent'] as const) {
            const manager = this.managers[editor];
            const undoAt = manager.undoStack.findIndex((item) => metaOf(item)?.id === id);
            if (undoAt >= 0) {
                let moved = false;
                while (manager.undoStack.length > undoAt + 1 && manager.undo() !== null) moved = true;
                return moved;
            }
            const redoAt = manager.redoStack.findIndex((item) => metaOf(item)?.id === id);
            if (redoAt >= 0) {
                let moved = false;
                while (manager.redoStack.length > redoAt && manager.redo() !== null) moved = true;
                return moved;
            }
        }
        return false;
    }

    /** Forget every step (a song load). */
    clear(): void {
        this.managers.human.clear();
        this.managers.agent.clear();
        this.changed();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): HistorySnapshot {
        if (!this.dirty) return this.snapshot;
        this.dirty = false;
        const entries: HistoryEntry[] = [];
        for (const editor of ['human', 'agent'] as const) {
            const manager = this.managers[editor];
            for (const [stack, done] of [[manager.undoStack, true], [manager.redoStack, false]] as const) {
                for (const item of stack) {
                    const meta = metaOf(item);
                    if (!meta) continue;
                    entries.push({ id: meta.id, editor, label: this.labelOf(meta), at: meta.at, done });
                }
            }
        }
        entries.sort((a, b) => a.at - b.at || Number(a.id.slice(1)) - Number(b.id.slice(1)));
        this.snapshot = {
            entries,
            canUndo: this.managers.human.canUndo(),
            canRedo: this.managers.human.canRedo(),
        };
        return this.snapshot;
    }

    destroy(): void {
        this.managers.human.destroy();
        this.managers.agent.destroy();
        this.listeners.clear();
    }

    private labelOf(meta: StepMeta | undefined): string {
        if (!meta) return 'edit';
        if (meta.label) return meta.label;
        const cached = this.labelCache.get(meta);
        if (cached && cached.after === meta.after) return cached.label;
        const label = describeEdit(meta.before, meta.after);
        this.labelCache.set(meta, { after: meta.after, label });
        return label;
    }

    private onAdded(
        editor: EditorKind,
        manager: Y.UndoManager,
        event: { stackItem: { meta: Map<unknown, unknown> }; origin: unknown },
    ): void {
        const { stackItem, origin } = event;
        if (origin === manager) {
            // An undo or redo moved a step to the other stack: same step.
            const popped = manager.currStackItem ? metaOf(manager.currStackItem) : undefined;
            if (popped) stackItem.meta.set(META, popped);
        } else {
            const context = this.context;
            const meta: StepMeta = {
                id: `s${nextStepId++}`,
                editor,
                at: this.now(),
                before: context?.before ?? {},
                after: context?.after ?? {},
                label: context?.label,
            };
            stackItem.meta.set(META, meta);
            if (manager.undoStack.length > this.maxSteps) manager.undoStack.shift();
        }
        this.changed();
    }

    private onUpdated(event: { stackItem: { meta: Map<unknown, unknown> } }): void {
        const meta = metaOf(event.stackItem);
        const context = this.context;
        if (meta && context) {
            // Earliest "before" of each field, latest "after".
            meta.before = { ...context.before, ...meta.before };
            meta.after = { ...meta.after, ...context.after };
            if (context.label && !meta.label) meta.label = context.label;
        }
        this.changed();
    }

    private changed(): void {
        this.dirty = true;
        for (const listener of [...this.listeners]) listener();
    }
}
