/**
 * What the co-producer's tools need from the app, and nothing else: the open
 * song, a way to commit a new one as a single undo step, the export modal's
 * render, and the bottom bar's file builders. `agentApi.ts` implements it over
 * the live app state; tests implement it over a plain object. There is no
 * network, file or eval access here — the tools touch song state only.
 */

import type { SavedSongData } from '../../types';
import type { AgentExportResult, AgentRenderResult } from '../agentApi';

export type CoproducerExportFormat = 'rbs' | 'mid' | 'xm' | 'wav';

export interface CoproducerHost {
    /** The open song's musical state, as the save path writes it (no audio). */
    getSong(): SavedSongData;
    /**
     * Make `song` the open song as ONE undo step labelled `label`
     * (`Co-producer: …`). Parts of `song` that are the same objects as in
     * `getSong()` are unchanged and need not be touched.
     */
    commit(song: SavedSongData, label: string): Promise<void>;
    /** Replace the whole song with a converted AI song (the import modal's load step), as one undo step. */
    load(song: SavedSongData, label: string): Promise<void>;
    /** The export modal's offline render: master (and stems) as WAV, plus its report. */
    render(options: { stems: boolean }): Promise<AgentRenderResult>;
    /** Build a file of the song and offer it to the user. */
    exportFile(format: CoproducerExportFormat): Promise<AgentExportResult>;
}

/** One committed co-producer step: its label and the song before it. */
export interface CoproducerUndoStep {
    label: string;
    before: SavedSongData;
}
