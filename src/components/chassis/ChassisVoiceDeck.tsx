import React, { memo, useCallback, useEffect, useState } from 'react';
import { SupertonicService } from '../../services/Supertonic';
import { LoadingButton } from '../LoadingButton';
import { VISIBLE_LIVE_REGION, VoiceDesignerSurface } from '../VoiceDesignerSurface';

const DEFAULT_PHRASE = 'Hello World';

export interface ChassisVoiceDeckProps {
    /** Active sampler bank (0–7); the phrase field edits this bank's text. */
    bankIdx: number;
    /** Per-bank TTS phrases (8 entries). */
    phrases: readonly string[];
    onPhrasesChange: (phrases: string[]) => void;
    /** Renders the phrase into the active bank. */
    onGenerate: (text: string) => Promise<void>;
    /** Full Voice Designer (VD mode): taller heatmap. TTS mode keeps it compact. */
    expanded?: boolean;
}

function useTtsReady(): boolean {
    const [ready, setReady] = useState(() => SupertonicService.getInstance().isServiceReady());
    useEffect(() => {
        if (ready) return;
        const interval = setInterval(() => {
            if (SupertonicService.getInstance().isServiceReady()) {
                setReady(true);
                clearInterval(interval);
            }
        }, 500);
        return () => clearInterval(interval);
    }, [ready]);
    return ready;
}

/**
 * The chassis voice deck (#1582): when the sampler is on the stage in TTS / VD
 * mode the body expands to show the active bank's TTS phrase, GEN and the Voice
 * Designer heatmap beneath the sampler rack. It edits the same per-bank phrase
 * state as SamplerPanel's toolbar, so the two stay in sync.
 */
export const ChassisVoiceDeck = memo(({
    bankIdx,
    phrases,
    onPhrasesChange,
    onGenerate,
    expanded = false,
}: ChassisVoiceDeckProps) => {
    const ttsReady = useTtsReady();
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState('');
    const validBank = bankIdx >= 0 && bankIdx < 8;
    const phrase = validBank ? (phrases[bankIdx] || DEFAULT_PHRASE) : DEFAULT_PHRASE;

    const setPhrase = useCallback((text: string) => {
        if (!validBank) return;
        const next = [...phrases];
        next[bankIdx] = text;
        onPhrasesChange(next);
    }, [validBank, phrases, bankIdx, onPhrasesChange]);

    const handleGenerate = useCallback(async () => {
        if (!SupertonicService.getInstance().isServiceReady()) {
            setStatus('Engine not ready');
            return;
        }
        setIsGenerating(true);
        setStatus('Generating...');
        try {
            await onGenerate(phrase);
            setStatus(`Gen: Bank ${bankIdx + 1}`);
        } catch (e) {
            console.error(e);
            setStatus('Gen Error');
        } finally {
            setIsGenerating(false);
        }
    }, [onGenerate, phrase, bankIdx]);

    return (
        <div
            className="hyphon-chassis__deck chassis-well"
            data-testid="chassis-voice-deck"
            data-expanded={expanded ? 'true' : 'false'}
            role="group"
            aria-label="Voice deck: text to speech and Voice Designer"
        >
            <div className="flex flex-col gap-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="hyphon-chassis__deck-label">TTS · Bank {bankIdx + 1}</span>
                    <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${ttsReady ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}
                        role="status"
                        aria-label={ttsReady ? 'TTS engine ready' : 'TTS engine unavailable'}
                        title={ttsReady ? 'TTS Engine Ready' : 'TTS Engine Loading/Unavailable'}
                    />
                </div>
                <textarea
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    rows={expanded ? 4 : 3}
                    className="w-full resize-none bg-black/60 border border-gray-700 rounded px-2 py-1 text-white text-xs font-mono outline-none focus-visible:border-purple-500"
                    placeholder="Phrase..."
                    aria-label={`Text to Speech phrase for bank ${bankIdx + 1}`}
                    data-testid="chassis-tts-phrase"
                />
                <div className="flex items-center gap-2">
                    <LoadingButton
                        onClick={handleGenerate}
                        disabled={!ttsReady}
                        isLoading={isGenerating}
                        loadingText="GEN"
                        spinnerColor="text-purple-200"
                        className="flex items-center justify-center gap-1.5 px-4 py-1.5 bg-purple-900 border border-purple-600 text-purple-100 rounded text-xs font-bold font-mono hover:bg-purple-800 disabled:opacity-50 transition-all"
                        aria-label={isGenerating ? 'Generating TTS voice for current bank...' : 'Generate TTS voice for current bank'}
                        title={!ttsReady ? 'TTS engine not ready' : 'Generate TTS voice for current bank'}
                        data-testid="chassis-tts-gen"
                    >
                        GEN
                    </LoadingButton>
                    <span className="flex-1 min-w-0 text-[10px] text-gray-400 font-mono truncate" role="status" aria-live="polite" style={VISIBLE_LIVE_REGION}>{status}</span>
                </div>
            </div>

            <div className="flex flex-col gap-2 min-w-0" aria-label="Voice Designer" role="group">
                <span className="hyphon-chassis__deck-label">Voice Designer</span>
                <VoiceDesignerSurface
                    waitForService
                    compact={!expanded}
                    heatmapClassName={expanded ? 'h-44' : 'h-24'}
                    opsClassName="grid grid-cols-4 sm:grid-cols-8 gap-1.5"
                />
            </div>
        </div>
    );
});

ChassisVoiceDeck.displayName = 'ChassisVoiceDeck';
