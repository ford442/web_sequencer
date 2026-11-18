/**
 * The live project doc and its store bindings (#1597 P2).
 *
 * The doc is the source of truth; stores are its synchronous, typed views —
 * the audio path reads their refs on every step, so they stay. The runtime
 * keeps the two in step:
 *
 *   store → doc   every store change is written into the doc as a minimal
 *                 transaction under the current editor's origin. That
 *                 transaction is what undo records, what peers receive and what
 *                 the update log persists.
 *   doc → store   every transaction the runtime did not write from a store (a
 *                 peer's edit, an undo/redo, a load through the codec) is read
 *                 back into the stores of the fields it changed.
 *
 * Who is editing decides the origin: `human` by default; `edit('agent', fn)`
 * for a co-producer tool call (one transaction, one undo step); `edit('load',
 * fn)` for a song load (not undoable, clears history); `edit('playback', fn)`
 * for state the transport writes while it plays (not undoable).
 */

import * as Y from 'yjs';
import type { SavedSongData } from '@/types';
import type { DocBinding, SongField, SongFieldValues } from './binding';
import { DOC_ORIGINS, createProjectDoc } from './doc';
import { readSongFromDoc } from './codec';
import { changedSongFields, isEmptySong, readField, writeField } from './fields';
import { EditorOrigin, ProjectHistory, type EditContext, type EditorKind, type ProjectHistoryOptions } from './history';
import type { EditScope } from './liveProject';
import { jsonEqual, type Json } from './yjson';

export interface ProjectRuntimeOptions {
    bindings: readonly DocBinding[];
    history?: ProjectHistoryOptions;
}

/** Marks a transaction the runtime wrote from the stores (never read back). */
const FROM_STORES = 'hyphon:fromStores';

const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `next`, with every subtree that equals the same subtree of `prev` replaced
 * by `prev`'s, so a projected value keeps the identities of what did not
 * change (memoised UI keyed on them does not re-render).
 */
export function preserveIdentity(prev: unknown, next: unknown): unknown {
    if (prev === next) return prev;
    if (Array.isArray(prev) && Array.isArray(next)) {
        const before = prev as unknown[];
        let changed = before.length !== next.length;
        const out = (next as unknown[]).map((item, i) => {
            const kept = i < before.length ? preserveIdentity(before[i], item) : item;
            if (kept !== before[i]) changed = true;
            return kept;
        });
        return changed ? out : prev;
    }
    if (isObject(prev) && isObject(next)) {
        const prevKeys = Object.keys(prev).filter((key) => prev[key] !== undefined);
        let changed = prevKeys.length !== Object.keys(next).length;
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(next)) {
            const kept = Object.prototype.hasOwnProperty.call(prev, key) ? preserveIdentity(prev[key], item) : item;
            if (kept !== prev[key]) changed = true;
            Object.defineProperty(out, key, { value: kept, enumerable: true, writable: true, configurable: true });
        }
        return changed ? out : prev;
    }
    if (prev !== null && next !== null && typeof prev === 'object' && typeof next === 'object') return next;
    return jsonEqual(prev as Json, next as Json) ? prev : next;
}

export class ProjectRuntime {
    readonly origins: Record<EditorKind, EditorOrigin> = {
        human: new EditorOrigin('human'),
        agent: new EditorOrigin('agent'),
    };

    private currentDoc: Y.Doc;
    private currentHistory: ProjectHistory;
    private readonly bindings: readonly DocBinding[];
    private readonly historyOptions: ProjectHistoryOptions | undefined;
    private readonly unsubscribe: Array<() => void>;
    private readonly historyListeners = new Set<() => void>();
    /** Value of each field as last synced between store and doc. */
    private readonly synced = new Map<SongField, unknown>();
    private readonly seen = new Map<DocBinding, unknown>();
    private scope: EditScope = 'human';
    private scopeLabel: string | undefined;
    private explicitScope = false;
    private projecting = false;
    private depth = 0;
    private context: EditContext | null = null;
    private destroyed = false;
    private releaseHistory: () => void = () => {};

    constructor(options: ProjectRuntimeOptions) {
        this.bindings = options.bindings;
        this.historyOptions = options.history;
        this.currentDoc = createProjectDoc();
        this.currentHistory = this.attach(this.currentDoc);
        this.seedFromStores();
        this.unsubscribe = this.bindings.map((binding) => binding.subscribe(() => this.onStoreChange(binding)));
    }

    get doc(): Y.Doc {
        return this.currentDoc;
    }

    get history(): ProjectHistory {
        return this.currentHistory;
    }

    /** Called whenever the history (or the doc it belongs to) changes. */
    subscribeHistory(listener: () => void): () => void {
        this.historyListeners.add(listener);
        return () => {
            this.historyListeners.delete(listener);
        };
    }

    /**
     * Run `fn` with every store write it makes attributed to `scope`. For
     * `human` and `agent` the writes are one transaction and one undo step,
     * named `label` when given. A `load` clears the undo history afterwards.
     * Inside an outer `human`/`agent` scope, a `load` stays part of that step.
     */
    edit<T>(scope: EditScope, fn: () => T, label?: string): T {
        const inner = this.enterScope(scope, label);
        try {
            let result!: T;
            this.transact(() => {
                result = fn();
                this.syncAll();
            }, this.originFor(this.scope));
            return result;
        } finally {
            this.leaveScope(inner);
        }
    }

    /** `edit` for a function that awaits; writes stay attributed to `scope` until it settles. */
    async editAsync<T>(scope: EditScope, fn: () => Promise<T>, label?: string): Promise<T> {
        const inner = this.enterScope(scope, label);
        try {
            const result = await fn();
            this.syncAll();
            return result;
        } finally {
            this.leaveScope(inner);
        }
    }

    /** Write any store change not yet in the doc (stores are synchronous, so normally none). */
    syncAll(): void {
        for (const binding of this.bindings) this.onStoreChange(binding);
    }

    /** The song the doc holds now. */
    readSong(): SavedSongData {
        this.syncAll();
        return readSongFromDoc(this.currentDoc);
    }

    readField(field: SongField): unknown {
        return readField(this.currentDoc, field);
    }

    /**
     * Make `doc` (a collab session's) the project doc. A doc with song data is
     * taken into the stores; an empty one is filled from them. Undo history
     * starts over. The returned function switches back to a private doc
     * holding what the stores hold then; call it before the session destroys
     * `doc`.
     */
    adopt(doc: Y.Doc): () => void {
        this.replaceDoc(doc);
        if (isEmptySong(doc)) {
            this.seedFromStores();
        } else {
            this.project(new Set(this.bindings.flatMap((b) => b.fields)), true);
        }
        return () => {
            if (this.currentDoc !== doc || this.destroyed) return;
            this.replaceDoc(createProjectDoc());
            this.seedFromStores();
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unsubscribe.forEach((off) => off());
        this.detach();
        this.historyListeners.clear();
    }

    // ---- scopes ----

    private enterScope(scope: EditScope, label: string | undefined) {
        const saved = { scope: this.scope, label: this.scopeLabel, explicit: this.explicitScope };
        // A load inside a human/agent step (the co-producer loading a song) is that step.
        const keepOuter = this.explicitScope && scope === 'load' && (this.scope === 'human' || this.scope === 'agent');
        if (!keepOuter) {
            this.scope = scope;
            this.scopeLabel = label ?? this.scopeLabel;
            if (scope === 'human' || scope === 'agent') this.currentHistory.beginStep(scope);
        }
        this.explicitScope = true;
        return { saved, keepOuter, scope };
    }

    private leaveScope({ saved, keepOuter, scope }: ReturnType<ProjectRuntime['enterScope']>): void {
        this.scope = saved.scope;
        this.scopeLabel = saved.label;
        this.explicitScope = saved.explicit;
        if (keepOuter) return;
        if (scope === 'human' || scope === 'agent') this.currentHistory.beginStep(scope);
        if (scope === 'load' && !saved.explicit) this.currentHistory.clear();
    }

    private originFor(scope: EditScope): unknown {
        switch (scope) {
            case 'human':
                return this.origins.human;
            case 'agent':
                return this.origins.agent;
            case 'load':
                return DOC_ORIGINS.load;
            case 'playback':
                return DOC_ORIGINS.playback;
        }
    }

    // ---- store → doc ----

    private transact(fn: () => void, origin: unknown): void {
        const outermost = this.depth === 0;
        this.depth++;
        try {
            this.currentDoc.transact((transaction) => {
                transaction.meta.set(FROM_STORES, true);
                fn();
            }, origin);
        } finally {
            this.depth--;
            if (outermost) {
                this.context = null;
                this.currentHistory.setContext(null);
            }
        }
    }

    private onStoreChange(binding: DocBinding): void {
        if (this.projecting || this.destroyed) return;
        const version = binding.version();
        if (this.seen.get(binding) === version && this.seen.has(binding)) return;
        this.seen.set(binding, version);
        const values = binding.read();
        const changes = binding.fields.filter((field) => values[field] !== this.synced.get(field));
        if (changes.length === 0) return;
        const context = (this.context ??= { before: {}, after: {}, label: this.scopeLabel });
        for (const field of changes) {
            if (!(field in context.before)) context.before[field] = this.synced.get(field);
            context.after[field] = values[field];
        }
        this.currentHistory.setContext(context);
        this.transact(() => {
            for (const field of changes) {
                writeField(this.currentDoc, field, values[field]);
                this.synced.set(field, values[field]);
            }
        }, this.originFor(this.scope));
    }

    private seedFromStores(): void {
        this.synced.clear();
        this.seen.clear();
        this.transact(() => {
            for (const binding of this.bindings) {
                const values = binding.read();
                for (const field of binding.fields) {
                    writeField(this.currentDoc, field, values[field]);
                    this.synced.set(field, values[field]);
                }
                this.seen.set(binding, binding.version());
            }
        }, DOC_ORIGINS.seed);
    }

    // ---- doc → store ----

    private readonly onAfterTransaction = (transaction: Y.Transaction): void => {
        if (transaction.meta.get(FROM_STORES) || this.destroyed) return;
        const fields = changedSongFields(this.currentDoc, transaction);
        if (fields.size > 0) this.project(fields, false);
    };

    /**
     * Put the doc's values of `fields` into their stores. With `fillMissing`
     * (adopting a doc), fields the doc lacks but a store has are then written
     * into the doc, so it holds the whole song.
     */
    private project(fields: Set<SongField>, fillMissing: boolean): void {
        const touched: DocBinding[] = [];
        const fromDoc: SongFieldValues = {};
        this.projecting = true;
        try {
            for (const binding of this.bindings) {
                if (!binding.fields.some((field) => fields.has(field))) continue;
                const current = binding.read();
                const values: SongFieldValues = {};
                for (const field of binding.fields) {
                    const value = readField(this.currentDoc, field);
                    fromDoc[field] = value;
                    values[field] = value === undefined ? undefined : preserveIdentity(current[field], value);
                }
                binding.apply(values);
                touched.push(binding);
            }
        } finally {
            this.projecting = false;
        }
        for (const binding of touched) {
            const values = binding.read();
            for (const field of binding.fields) {
                // Adopting: remember what the doc holds, so what the store keeps
                // on top of it is written below. Otherwise: what the store holds,
                // so its normalisation of the doc's value is not echoed as an edit.
                this.synced.set(field, fillMissing ? fromDoc[field] : values[field]);
            }
            this.seen.delete(binding);
        }
        if (fillMissing) {
            const saved = this.scope;
            this.scope = 'load';
            try {
                this.syncAll();
            } finally {
                this.scope = saved;
            }
        } else {
            for (const binding of touched) this.seen.set(binding, binding.version());
            // Side effects of `apply` on other stores are ordinary edits.
            for (const binding of this.bindings) if (!touched.includes(binding)) this.onStoreChange(binding);
        }
    }

    // ---- doc lifecycle ----

    private attach(doc: Y.Doc): ProjectHistory {
        doc.on('afterTransaction', this.onAfterTransaction);
        const history = new ProjectHistory(doc, this.origins, this.historyOptions);
        this.releaseHistory = history.subscribe(() => this.emitHistory());
        return history;
    }

    private detach(): void {
        this.releaseHistory();
        this.currentHistory.destroy();
        this.currentDoc.off('afterTransaction', this.onAfterTransaction);
    }

    private replaceDoc(doc: Y.Doc): void {
        this.detach();
        this.currentDoc = doc;
        this.currentHistory = this.attach(doc);
        this.emitHistory();
    }

    private emitHistory(): void {
        for (const listener of [...this.historyListeners]) listener();
    }
}
