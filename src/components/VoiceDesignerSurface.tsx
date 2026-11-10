import React, { useEffect, useRef, useState } from 'react';
import { VoiceDesigner } from '../services/VoiceDesigner';
import { SupertonicService } from '../services/Supertonic';

type DesignerOp = 'mirrorX' | 'mirrorY' | 'invertSign' | 'randomShift' | 'dspSharpen' | 'dspTremolo' | 'dspEcho' | 'reset';

interface OpSpec {
    op: DesignerOp;
    label: string;
    help: string;
    tone: 'neutral' | 'dsp' | 'reset';
}

const OPS: readonly OpSpec[] = [
    { op: 'mirrorX', label: 'Mirror X', help: 'Mirror the voice pattern horizontally', tone: 'neutral' },
    { op: 'mirrorY', label: 'Mirror Y', help: 'Mirror the voice pattern vertically', tone: 'neutral' },
    { op: 'invertSign', label: 'Invert', help: 'Invert the phase of the voice pattern', tone: 'neutral' },
    { op: 'randomShift', label: 'Rand Shift', help: 'Randomly shift voice characteristics', tone: 'neutral' },
    { op: 'dspSharpen', label: 'Sharpen', help: 'Enhance contrast in voice features', tone: 'dsp' },
    { op: 'dspTremolo', label: 'Tremolo', help: 'Apply amplitude modulation', tone: 'dsp' },
    { op: 'dspEcho', label: 'Echo', help: 'Add delay/echo effect', tone: 'dsp' },
    { op: 'reset', label: 'Reset', help: 'Reset to original voice style', tone: 'reset' },
];

const TONE_CLASS: Record<OpSpec['tone'], string> = {
    neutral: 'bg-gray-800 hover:bg-gray-700 text-gray-300',
    dsp: 'bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-900/50',
    reset: 'bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-900/50',
};

/**
 * accessibility.css parks every `[aria-live]` element off-screen at 1×1 px (for
 * announcer-only regions). This status line is meant to be read on screen too.
 */
export const VISIBLE_LIVE_REGION: React.CSSProperties = { position: 'static', width: 'auto', height: 'auto' };

const NOT_READY = 'TTS Service Not Ready';
const NO_VOICE = 'No Voice Loaded';

export interface VoiceDesignerSurfaceProps {
    /** Called once a style has been pushed to the TTS engine. */
    onApplied?: () => void;
    /** Tailwind classes for the heatmap well (height, margins). */
    heatmapClassName?: string;
    /** Tailwind classes for the op-button grid. */
    opsClassName?: string;
    /**
     * Keep polling the TTS service until it is ready, then load its voice.
     * The modal is opened on demand and loads once; an always-visible surface
     * (the chassis voice deck) mounts before the models finish loading.
     */
    waitForService?: boolean;
    /** Dev-only ONNX cache purge row. */
    showDevTools?: boolean;
    /** Short heatmap well: drop the placeholder's icon so its text fits. */
    compact?: boolean;
}

/**
 * Voice Designer body — heatmap, geometric / DSP ops, status and APPLY — shared
 * by the VoiceEditor modal and the chassis voice deck (#1582).
 */
export const VoiceDesignerSurface: React.FC<VoiceDesignerSurfaceProps> = React.memo(({
    onApplied,
    heatmapClassName = 'h-48 mb-4',
    opsClassName = 'grid grid-cols-4 gap-2 mb-6',
    waitForService = false,
    showDevTools = false,
    compact = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const designerRef = useRef<VoiceDesigner | null>(null);
    const [status, setStatus] = useState('Ready');
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        if (!canvasRef.current) return;
        let interval: ReturnType<typeof setInterval> | null = null;

        const load = (): boolean => {
            const canvas = canvasRef.current;
            if (!canvas) return true;
            const service = SupertonicService.getInstance();
            if (!service.isServiceReady()) {
                setStatus(NOT_READY);
                return false;
            }
            if (!designerRef.current) designerRef.current = new VoiceDesigner();
            const currentStyle = service.getStyle();
            if (currentStyle) {
                designerRef.current.setCanvas(canvas);
                designerRef.current.loadFromStyle(currentStyle);
                setStatus('Voice Loaded');
            } else {
                setStatus(NO_VOICE);
            }
            return true;
        };

        if (!load() && waitForService) {
            interval = setInterval(() => {
                if (load() && interval) {
                    clearInterval(interval);
                    interval = null;
                }
            }, 500);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [waitForService]);

    // Dev-only: expose purge action on window.__devtools
    useEffect(() => {
        if (import.meta.env.DEV) {
            const service = SupertonicService.getInstance();
            const w = window as unknown as { __devtools?: Record<string, unknown> };
            w.__devtools = w.__devtools || {};
            w.__devtools.purgeTTSCache = () => {
                service.purgeCache();
            };
        }
    }, []);

    const handlePurgeCache = () => {
        SupertonicService.getInstance().purgeCache();
        setStatus('ONNX cache purged');
    };

    const handleOp = async (op: DesignerOp) => {
        const d = designerRef.current;
        if (d && typeof d[op] === 'function') {
            await (d[op] as () => Promise<void>)();
            setStatus(`Applied: ${op}`);
        }
    };

    const handleApply = () => {
        if (!designerRef.current) return;

        const service = SupertonicService.getInstance();
        if (!service.isServiceReady()) {
            setStatus('Cannot apply: TTS not ready');
            return;
        }

        const raw = designerRef.current.getRawData();
        if (raw.ttl && raw.dp) {
            setIsApplying(true);
            setStatus('Applying...');
            service.updateStyleFromRaw(raw.ttl, raw.dp, raw.ttlDims, raw.dpDims);
            setStatus('Style Applied to Engine!');
            // The modal stays in its APPLYING state until it closes; an inline
            // surface (chassis deck) is ready for the next edit straight away.
            if (onApplied) onApplied();
            else setIsApplying(false);
        }
    };

    const btnClass = 'text-xs py-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-purple-400 transition-colors';
    const showPlaceholder = status === NO_VOICE || status === 'Ready' || status === NOT_READY;

    return (
        <>
            {/* Heatmap Area */}
            <div className={`border border-gray-700 bg-black relative rounded overflow-hidden ${heatmapClassName}`}>
                {showPlaceholder ? (
                    <div className={`absolute inset-0 flex flex-col items-center justify-center text-center bg-gray-800/20 border border-dashed border-gray-700 ${compact ? 'p-2' : 'p-4'}`}>
                        {!compact && <div className="w-12 h-12 rounded-full bg-purple-900/30 flex items-center justify-center mb-4 text-purple-500" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                        </div>}
                        <h3 className={`text-gray-300 font-bold text-sm ${compact ? 'mb-1' : 'mb-2'}`}>{status === NOT_READY ? 'TTS Loading…' : NO_VOICE}</h3>
                        <p className="text-gray-500 text-xs max-w-[250px]">
                            {status === NOT_READY
                                ? 'The voice heatmap appears once the TTS engine is ready.'
                                : 'Select a TTS voice from the library to view and edit its characteristics.'}
                        </p>
                    </div>
                ) : null}
                <canvas
                    ref={canvasRef}
                    className="w-full h-full block"
                    style={{
                        imageRendering: 'pixelated',
                        display: showPlaceholder ? 'none' : 'block',
                    }}
                    role="img"
                    aria-label="Voice Heatmap Visualization - Interactive Canvas"
                />
            </div>

            {/* Controls */}
            <div className={`font-mono ${opsClassName}`}>
                {OPS.map(({ op, label, help, tone }) => (
                    <button
                        key={op}
                        type="button"
                        onClick={() => handleOp(op)}
                        className={`${btnClass} ${TONE_CLASS[tone]}`}
                        aria-label={help}
                        title={help}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="flex justify-between items-center gap-2">
                <span
                    className="flex-1 min-w-0 text-xs text-gray-500 font-mono truncate"
                    role="status"
                    aria-live="polite"
                    style={VISIBLE_LIVE_REGION}
                >
                    {status}
                </span>
                <button type="button"
                    onClick={handleApply}
                    disabled={isApplying}
                    title={isApplying ? 'Applying changes...' : 'Apply changes'}
                    className="shrink-0 px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-[0_0_15px_rgba(34,197,94,0.3)] font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-white disabled:opacity-50 disabled:cursor-wait"
                    aria-busy={isApplying}
                >
                    {isApplying ? (
                        <span className="flex items-center gap-2">
                            <svg aria-hidden="true" className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            APPLYING...
                        </span>
                    ) : 'APPLY TO ENGINE'}
                </button>
            </div>

            {showDevTools && import.meta.env.DEV && (
                <div className="mt-4 pt-4 border-t border-red-900/30">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-red-400/70 font-mono">Dev Tools</span>
                        <button type="button"
                            onClick={handlePurgeCache}
                            className="px-4 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-300 border border-red-900/40 rounded font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-red-400 transition-colors"
                            aria-label="Purge ONNX TTS cache"
                            title="Purge ONNX TTS cache"
                        >
                            Purge ONNX Cache (Dev)
                        </button>
                    </div>
                </div>
            )}
        </>
    );
});

VoiceDesignerSurface.displayName = 'VoiceDesignerSurface';
