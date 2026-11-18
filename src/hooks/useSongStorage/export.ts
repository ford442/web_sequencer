/**
 * Files built from the saved song (#1597 P2 split of `useSongStorage`): the
 * song JSON, ReBirth `.rbs` and Standard MIDI `.mid`. Each takes the
 * `SavedSongData` the save path built (the doc's export), so the download
 * buttons and the agent render hook produce the same bytes.
 */

import type { ResolvedTrakEvent, SavedSongData } from '@/types';

/** A file built in memory for a download button (or the agent render hook). */
export type FileExportResult =
    | { success: true; blob: Blob; filename: string; warnings: string[] }
    | { success: false; error: string; warnings: string[] };

export function downloadFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

/** The song as the JSON file "Export song" downloads. */
export function songJsonFile(song: SavedSongData): { blob: Blob; filename: string } {
    return {
        blob: new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' }),
        filename: `hyphon-song-${today()}.json`,
    };
}

/** The `.rbs` file the "Export RBS" button downloads. */
export async function buildRbsFile(
    song: SavedSongData,
    options: { isSongModeActive?: boolean; trakEvents?: ResolvedTrakEvent[] | null },
): Promise<FileExportResult> {
    // Dynamically imported so the ~9K-line RBS import/export surface never
    // lands in the entry chunk — only an actual "Export RBS" click does.
    const { RbsExporter, hyphonSongFromSavedData, shouldExportRbsSongMode } = await import('@/importers/rbs');
    const hyphonSong = hyphonSongFromSavedData(song, {
        trakEvents: options.trakEvents ?? undefined,
        isSongModeActive: options.isSongModeActive,
    });
    const mode = shouldExportRbsSongMode(song, options.isSongModeActive) ? 'song' : 'pattern';
    const result = new RbsExporter().exportToBlob(hyphonSong, { songName: hyphonSong.metadata.name, mode });
    if (!result.success || !result.blob) {
        return { success: false, error: result.error ?? 'RBS export failed', warnings: result.warnings };
    }
    const safeName = (hyphonSong.metadata.name || 'hyphon-song').replace(/[^\w.-]+/g, '_');
    return { success: true, blob: result.blob, filename: `${safeName}.rbs`, warnings: result.warnings };
}

/** The `.mid` file the "Export .mid" button downloads. */
export async function buildSmfFile(
    song: SavedSongData,
    options: { isSongModeActive?: boolean },
): Promise<FileExportResult> {
    // Dynamically imported so the SMF import/export surface never lands in
    // the entry chunk — only an actual "Export .mid" click does.
    const { SmfExporter, hyphonSongFromSavedDataForSmf } = await import('@/importers/smf');
    const result = new SmfExporter().exportToBlob(hyphonSongFromSavedDataForSmf(song), {
        useSongMode: !!options.isSongModeActive,
    });
    if (!result.success || !result.blob) {
        return { success: false, error: result.error ?? 'MIDI export failed', warnings: result.warnings };
    }
    return { success: true, blob: result.blob, filename: `hyphon-song-${today()}.mid`, warnings: result.warnings };
}
