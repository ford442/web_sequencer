/**
 * Audible preview state for the AI song modal (#1233).
 *
 * Rendering happens in `renderAISongPreview`, which bounces the first bars
 * through the shared offline patch-bay compiler. This hook only owns the UI
 * side of it: one render per parsed song, a blob the `<audio>` element can
 * play, and the per-slot report so the panel can say what it could not play
 * instead of pretending the mix is complete.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AISongData } from '../../importers/ai-song';
import { audioBufferToWav } from '../../utils/audioExport';
import {
    renderAISongPreview,
    summarizePreviewSkips,
    type AISongPreviewResult,
} from '../../utils/aiSongPreview';

export type AudioPreviewStatus = 'idle' | 'rendering' | 'ready' | 'error';

export interface UseAISongAudioPreview {
    status: AudioPreviewStatus;
    result: AISongPreviewResult | null;
    /** Object URL of the rendered WAV, or null until a render succeeds. */
    url: string | null;
    error: string | null;
    /** One-line "what was skipped" summary, or null when nothing was. */
    skipSummary: string | null;
    render: () => Promise<void>;
}

export interface UseAISongAudioPreviewOptions {
    /** `AudioContext.sampleRate` of the running engine, for the `native` pref. */
    liveSampleRate?: number | null;
    bars?: number;
}

export function useAISongAudioPreview(
    data: AISongData | null,
    options: UseAISongAudioPreviewOptions = {},
): UseAISongAudioPreview {
    const [status, setStatus] = useState<AudioPreviewStatus>('idle');
    const [result, setResult] = useState<AISongPreviewResult | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const urlRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const releaseUrl = useCallback(() => {
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    }, []);

    // A new paste is a different song: the previous render is not a preview of
    // it, so it is dropped rather than left playing under the new pattern grid.
    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        releaseUrl();
        setUrl(null);
        setResult(null);
        setError(null);
        setStatus('idle');
    }, [data, releaseUrl]);

    useEffect(() => () => {
        abortRef.current?.abort();
        releaseUrl();
    }, [releaseUrl]);

    const render = useCallback(async () => {
        if (!data) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setStatus('rendering');
        setError(null);

        try {
            const rendered = await renderAISongPreview(data, {
                bars: options.bars,
                liveSampleRate: options.liveSampleRate ?? null,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;

            const blob = await audioBufferToWav(rendered.buffer, {
                sampleRate: rendered.sampleRate,
            });
            if (controller.signal.aborted) return;

            releaseUrl();
            const objectUrl = URL.createObjectURL(blob);
            urlRef.current = objectUrl;
            setUrl(objectUrl);
            setResult(rendered);
            setStatus('ready');
        } catch (err) {
            if (controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
            setStatus('error');
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [data, options.bars, options.liveSampleRate, releaseUrl]);

    return {
        status,
        result,
        url,
        error,
        skipSummary: result ? summarizePreviewSkips(result) : null,
        render,
    };
}
