import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerParams, Bass2Params } from '../types';
import type { TrackKey } from '../constants/appDefaults';
import {
    exportStemsDownload,
    type StemExportSampleRate,
    type StemExportOptions,
} from '../utils/stemExport';
import type { WavBitDepth } from '../utils/audioExport';
import type { RenderSynthEngines } from '../utils/renderAudio';

export interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    songStructure: { [key in TrackKey]: number | null }[];
    trackStorage: Record<TrackKey, (import('../types').PartSequence | import('../types').PartSequence[] | null)[]>;
    currentPattern: Pattern;
    tempo: number;
    params: {
        synthA: SynthParams;
        synthB: SynthParams;
        bass2: Bass2Params;
        kick: KickParams;
        snare: SnareParams;
        closedHat: HatParams;
        openHat: HatParams;
        sampler: SamplerParams;
    };
    engines?: RenderSynthEngines;
    sampleBuffers: (AudioBuffer | null)[];
    /** Preferred sample rate from the live AudioContext when available. */
    preferredSampleRate?: number;
}

type ExportPhase = 'idle' | 'exporting' | 'done' | 'cancelled' | 'error';

export const ExportModal = React.memo(function ExportModal({
    isOpen,
    onClose,
    onShowToast,
    songStructure,
    trackStorage,
    currentPattern,
    tempo,
    params,
    engines,
    sampleBuffers,
    preferredSampleRate,
}: ExportModalProps) {
    const [phase, setPhase] = useState<ExportPhase>('idle');
    const [progress, setProgress] = useState(0);
    const [statusLabel, setStatusLabel] = useState('');
    const [useSongMode, setUseSongMode] = useState(true);
    const [sampleRate, setSampleRate] = useState<StemExportSampleRate>(
        preferredSampleRate === 48000 ? 48000 : 44100,
    );
    const [bitDepth, setBitDepth] = useState<WavBitDepth>(16);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.abort();
            abortRef.current = null;
            setPhase('idle');
            setProgress(0);
            setStatusLabel('');
        }
    }, [isOpen]);

    useEffect(() => {
        if (preferredSampleRate === 48000 || preferredSampleRate === 44100) {
            setSampleRate(preferredSampleRate);
        }
    }, [preferredSampleRate]);

    const handleCancel = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setPhase('cancelled');
        setStatusLabel('Export cancelled');
    }, []);

    const handleExport = useCallback(async () => {
        if (phase === 'exporting') return;

        const controller = new AbortController();
        abortRef.current = controller;
        setPhase('exporting');
        setProgress(0);
        setStatusLabel('Starting export…');

        const options: StemExportOptions = {
            sampleRate,
            bitDepth,
            useSongMode,
            signal: controller.signal,
            onProgress: (pct, label) => {
                setProgress(pct);
                setStatusLabel(label);
            },
        };

        try {
            await exportStemsDownload(
                {
                    songStructure,
                    trackStorage,
                    currentPattern,
                    tempo,
                    params,
                    engines,
                    sampleBuffers,
                },
                options,
            );

            if (controller.signal.aborted) return;

            setPhase('done');
            setProgress(1);
            setStatusLabel('Export complete');
            onShowToast('Stem ZIP downloaded', 'success');
            onClose();
        } catch (err) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                setPhase('cancelled');
                setStatusLabel('Export cancelled');
                return;
            }
            console.error('Stem export failed:', err);
            setPhase('error');
            setStatusLabel(err instanceof Error ? err.message : 'Export failed');
            onShowToast('Stem export failed', 'error');
        } finally {
            abortRef.current = null;
        }
    }, [
        phase,
        sampleRate,
        bitDepth,
        useSongMode,
        songStructure,
        trackStorage,
        currentPattern,
        tempo,
        params,
        engines,
        sampleBuffers,
        onShowToast,
        onClose,
    ]);

    if (!isOpen) return null;

    const isExporting = phase === 'exporting';

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-modal-title"
        >
            <div className="w-full max-w-md mx-4 bg-[#0f1218] border border-cyan-800/40 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                    <h2 id="export-modal-title" className="text-sm font-bold text-cyan-300 tracking-wider">
                        EXPORT STEMS
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isExporting}
                        aria-label="Close export dialog"
                        title={isExporting ? "Cannot close while exporting" : "Close export dialog"}
                        className="text-gray-400 hover:text-white disabled:opacity-40"
                    >
                        ✕
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    <p className="text-xs text-gray-400">
                        Dry per-track WAVs (partA, partB, bass2, drums, 8 sampler banks, master) packaged as a ZIP.
                        Master is the sum of dry stems without master FX.
                    </p>

                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                            type="checkbox"
                            checked={useSongMode}
                            onChange={(e) => setUseSongMode(e.target.checked)}
                            disabled={isExporting}
                            className="accent-cyan-500"
                        />
                        Use song arrangement (uncheck for current pattern only)
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-gray-400">
                            Sample rate
                            <select
                                value={sampleRate}
                                onChange={(e) => setSampleRate(Number(e.target.value) as StemExportSampleRate)}
                                disabled={isExporting}
                                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs"
                            >
                                <option value={44100}>44.1 kHz</option>
                                <option value={48000}>48 kHz</option>
                            </select>
                        </label>
                        <label className="text-xs text-gray-400">
                            Bit depth
                            <select
                                value={bitDepth}
                                onChange={(e) => setBitDepth(Number(e.target.value) as WavBitDepth)}
                                disabled={isExporting}
                                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs"
                            >
                                <option value={16}>16-bit</option>
                                <option value={24}>24-bit</option>
                            </select>
                        </label>
                    </div>

                    {preferredSampleRate && preferredSampleRate !== sampleRate && (
                        <p className="text-[10px] text-amber-400/90">
                            Live AudioContext is {preferredSampleRate} Hz — choose matching rate to avoid resampling.
                        </p>
                    )}

                    {(isExporting || phase === 'cancelled' || phase === 'error') && (
                        <div className="space-y-2">
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-200"
                                    style={{ width: `${Math.round(progress * 100)}%` }}
                                />
                            </div>
                            <p className="text-[10px] text-gray-400 font-mono" aria-live="polite">
                                {statusLabel || 'Preparing…'}
                            </p>
                        </div>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
                    {isExporting ? (
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="px-4 py-2 text-xs font-bold rounded-lg border border-red-700/50 text-red-300 hover:bg-red-900/30"
                        >
                            Cancel
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-700 text-gray-400 hover:text-white"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={handleExport}
                                className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-cyan-900/60 to-cyan-800/60 text-cyan-300 border border-cyan-700/50 hover:from-cyan-800/80 hover:to-cyan-700/80"
                            >
                                Download ZIP
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});

export default ExportModal;
