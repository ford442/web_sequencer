import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerParams, Bass2Params } from '../types';
import type { TrackKey } from '../constants/appDefaults';
import {
    exportStemsDownload,
    type StemExportOptions,
    type StemExportReport,
    type StemMasterChain,
} from '../utils/stemExport';
import {
    getStoredSampleRatePref,
    resolveExportSampleRate,
    SAMPLE_RATE_PREFS,
    type SampleRatePref,
} from '../utils/audioContextPolicy';
import type { WavBitDepth } from '../utils/audioExport';
import type { RenderSynthEngines } from '../utils/renderAudio';
import { resolveSongTimeline } from '../utils/songTimeline';
import {
    OFFLINE_VOCAL_GAP_LABELS,
    describeOfflineVocalSupport,
    formatOfflineVocalWarning,
} from '../audio/offline/vocalOfflineSupport';

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
    /** Live HARM state; harmony layers cannot be bounced yet. */
    harmonizerActive?: boolean;
}

type ExportPhase = 'idle' | 'exporting' | 'done' | 'cancelled' | 'error';

/** Success toast: what the ZIP actually contains. */
function describeExport(report: StemExportReport | null): string {
    if (!report) return 'Stem ZIP downloaded';
    const master = report.routing === 'live-patch' ? 'live-patch master' : 'dry master';
    return `Stem ZIP downloaded · ${report.sampleRate} Hz · ${master}`;
}

/** Follow-up toast for anything the bounce could not honour. */
function describeExportWarning(report: StemExportReport | null): string | null {
    if (!report) return null;
    const vocal = formatOfflineVocalWarning(report.vocalOffline);
    const master = describeMasterWarning(report);
    return [vocal, master].filter(Boolean).join(' ') || null;
}

function describeMasterWarning(report: StemExportReport): string | null {
    if (report.routing === 'dry-exclusive-fallback') return report.routingNote;

    const bypassed = report.offlineGraph?.slots.filter((slot) => slot.status === 'bypassed') ?? [];
    if (bypassed.length === 0) return null;
    const names = bypassed.map((slot) => slot.packageId ?? slot.nodeId).join(', ');
    return `${bypassed.length} WAM2 insert${bypassed.length === 1 ? '' : 's'} cannot render offline and `
        + `${bypassed.length === 1 ? 'was' : 'were'} bypassed in the master bounce: ${names}`;
}

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
    harmonizerActive = false,
}: ExportModalProps) {
    const [phase, setPhase] = useState<ExportPhase>('idle');
    const [progress, setProgress] = useState(0);
    const [statusLabel, setStatusLabel] = useState('');
    const [useSongMode, setUseSongMode] = useState(true);
    // The export follows the same sample-rate policy the live context does
    // (#1136 / #1233): `native` means "whatever the running engine came up
    // with", not a second, silently different rate.
    const [sampleRatePref, setSampleRatePref] = useState<SampleRatePref>(() =>
        getStoredSampleRatePref(),
    );
    const [bitDepth, setBitDepth] = useState<WavBitDepth>(16);
    const [masterChain, setMasterChain] = useState<StemMasterChain>('live-patch');
    const sampleRate = resolveExportSampleRate(sampleRatePref, preferredSampleRate);
    const abortRef = useRef<AbortController | null>(null);
    const modalRef = useFocusTrap(isOpen, onClose);

    // Sampler banks the bounce cannot render as heard (live vocal chain only).
    const vocalOffline = useMemo(() => {
        if (!isOpen) return [];
        const timeline = resolveSongTimeline(songStructure, trackStorage, currentPattern, useSongMode);
        return describeOfflineVocalSupport({
            sampler: params.sampler,
            sequences: timeline.sequences.sampler,
            harmonizerActive,
        });
    }, [isOpen, songStructure, trackStorage, currentPattern, useSongMode, params.sampler, harmonizerActive]);

    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.abort();
            abortRef.current = null;
            setPhase('idle');
            setProgress(0);
            setStatusLabel('');
        }
    }, [isOpen]);

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

        let report: StemExportReport | null = null;

        const options: StemExportOptions = {
            onReport: (value) => {
                report = value;
            },
            sampleRatePref,
            liveSampleRate: preferredSampleRate ?? null,
            bitDepth,
            useSongMode,
            masterChain,
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
                    harmonizerActive,
                },
                options,
            );

            if (controller.signal.aborted) return;

            setPhase('done');
            setProgress(1);
            setStatusLabel('Export complete');
            onShowToast(describeExport(report), 'success');

            // A bounce that had to drop an insert, or fall back to the dry sum,
            // says so rather than leaving it to be noticed inside the ZIP.
            const warning = describeExportWarning(report);
            if (warning) onShowToast(warning, 'info');
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
        sampleRatePref,
        preferredSampleRate,
        masterChain,
        bitDepth,
        useSongMode,
        songStructure,
        trackStorage,
        currentPattern,
        tempo,
        params,
        engines,
        sampleBuffers,
        harmonizerActive,
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
            ref={modalRef}
        >
            <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden="true" />
            <div className="w-full max-w-md mx-4 bg-[#0f1218] border border-cyan-800/40 rounded-xl shadow-2xl overflow-hidden relative z-10">
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
                        <span aria-hidden="true">✕</span>
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    <p className="text-xs text-gray-400">
                        Dry per-track WAVs (partA, partB, bass2, drums, 8 sampler banks, master) packaged as a ZIP.
                        {masterChain === 'live-patch'
                            ? ' Master is the dry sum bounced through the live patch bay (master FX + loudness stage).'
                            : ' Master is the sum of dry stems without master FX.'}
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
                                value={String(sampleRatePref)}
                                onChange={(e) =>
                                    setSampleRatePref(
                                        e.target.value === 'native'
                                            ? 'native'
                                            : (Number(e.target.value) as SampleRatePref),
                                    )
                                }
                                disabled={isExporting}
                                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs"
                            >
                                {SAMPLE_RATE_PREFS.map((pref) => (
                                    <option key={String(pref)} value={String(pref)}>
                                        {pref === 'native'
                                            ? `Match live (${sampleRate} Hz)`
                                            : pref === 44100
                                              ? '44.1 kHz'
                                              : '48 kHz'}
                                    </option>
                                ))}
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

                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                            type="checkbox"
                            checked={masterChain === 'live-patch'}
                            onChange={(e) =>
                                setMasterChain(e.target.checked ? 'live-patch' : 'dry-exclusive')
                            }
                            disabled={isExporting}
                            className="accent-cyan-500"
                        />
                        Bounce master through the live patch (what you hear)
                    </label>

                    {preferredSampleRate && preferredSampleRate !== sampleRate && (
                        <p className="text-[10px] text-amber-400/90">
                            Live AudioContext is {preferredSampleRate} Hz — exporting at {sampleRate} Hz
                            resamples. Pick “Match live” to bounce at the monitored rate.
                        </p>
                    )}

                    {vocalOffline.length > 0 && (
                        <div
                            role="note"
                            aria-label="Vocal FX freeze unsupported"
                            className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 space-y-1"
                        >
                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                Vocal FX freeze unsupported
                            </p>
                            <p className="text-[10px] text-amber-200/80">
                                Sampler stems are rendered dry. The live vocal chain on these banks is not in the bounce:
                            </p>
                            <ul className="flex flex-wrap gap-1">
                                {vocalOffline.map((r) => (
                                    <li
                                        key={r.bank}
                                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/40 text-amber-200"
                                    >
                                        Bank {r.bank + 1}: {r.gaps.map((g) => OFFLINE_VOCAL_GAP_LABELS[g]).join(' · ')}
                                    </li>
                                ))}
                            </ul>
                        </div>
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
