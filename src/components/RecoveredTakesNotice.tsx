import React, { useCallback, useEffect, useState } from 'react';
import type { TakeMeta } from '@/audio/recording/takeProtocol';

/**
 * Offers the takes a closed or crashed tab left mid-recording (#1498 P1).
 * Each is a valid WAV up to its last flush (about a second before the tab
 * died): SAVE WAV patches its header, downloads it and frees the browser
 * storage; DISCARD deletes it.
 *
 * `RecoveredTakesGate` is what App mounts: after boot it checks for an OPFS
 * `takes/` folder, and only then loads this notice and the recorder.
 */

const loadRecorder = () => import('@/audio/recording/takeRecorder');

function describe(take: TakeMeta): string {
    const seconds = take.frames / take.sampleRate;
    const length = seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}` : `${seconds.toFixed(1)} s`;
    const when = new Date(take.createdAt).toLocaleString();
    return `${length} · ${take.channels === 1 ? 'mono' : 'stereo'} · ${take.inputLabel || 'input'} · ${when}`;
}

function fileName(take: TakeMeta): string {
    const stamp = new Date(take.createdAt).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    return `hyphon-take-${stamp}.wav`;
}

const RecoveredTakesNotice: React.FC = () => {
    const [takes, setTakes] = useState<TakeMeta[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loadRecorder()
            .then((rec) => rec.listRecoverableTakes())
            .then((found) => { if (!cancelled) setTakes(found); })
            .catch((err: unknown) => console.warn('[takes] could not look for unfinished takes:', err));
        return () => {
            cancelled = true;
        };
    }, []);

    const drop = useCallback((id: string) => setTakes((list) => list.filter((t) => t.id !== id)), []);

    const save = useCallback(async (take: TakeMeta) => {
        setBusy(take.id);
        setError(null);
        try {
            const rec = await loadRecorder();
            const recovered = await rec.recoverTake(take.id);
            const file = await rec.readTakeFile(take.id);
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName(recovered);
            document.body.appendChild(a);
            a.click();
            a.remove();
            // The download reads the file asynchronously: free storage once it has had time to.
            setTimeout(() => {
                URL.revokeObjectURL(url);
                void rec.discardTake(take.id).catch(() => undefined);
            }, 60_000);
            drop(take.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    }, [drop]);

    const discard = useCallback(async (take: TakeMeta) => {
        setBusy(take.id);
        setError(null);
        try {
            await (await loadRecorder()).discardTake(take.id);
            drop(take.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    }, [drop]);

    if (takes.length === 0) return null;

    const button = 'min-h-[28px] px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 border border-amber-400/60 font-bold text-[10px] uppercase tracking-wider disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-amber-300 focus:outline-none';
    return (
        <section
            aria-label="Unfinished recordings"
            data-testid="recovered-takes"
            className="fixed bottom-4 left-4 z-[100] max-w-[min(28rem,calc(100vw-2rem))] px-3 py-2 rounded shadow-lg border border-amber-500 bg-amber-950/95 text-amber-100 text-xs"
        >
            <div className="font-bold mb-1" role="status" aria-live="polite">
                {takes.length === 1 ? 'An unfinished recording was found' : `${takes.length} unfinished recordings were found`}
            </div>
            <ul className="space-y-1">
                {takes.map((take) => (
                    <li key={take.id} className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono flex-1 min-w-0 break-words">{describe(take)}</span>
                        <button type="button" className={button} disabled={busy !== null} onClick={() => void save(take)}>Save WAV</button>
                        <button type="button" className={button} disabled={busy !== null} onClick={() => void discard(take)}>Discard</button>
                    </li>
                ))}
            </ul>
            {error && <div className="mt-1 text-red-300">{error}</div>}
        </section>
    );
};

export default RecoveredTakesNotice;
