import React, { useRef, useState, useEffect } from 'react';
import type { SamplerParams } from '../types'; // Note: This is now SamplerBankParams[]
import { SupertonicService } from '../services/Supertonic';
import { Knob } from './Knob';

interface SamplerPanelProps {
    params: SamplerParams; // Expecting Array[8]
    onChange: (updates: SamplerParams) => void; // Expecting full array update
    onLoadSample: (name: string, buffer: AudioBuffer) => void;
    audioContext: AudioContext;
    activeBankIdx: number;           // Controlled by Parent
    onBankChange: (i: number) => void; // Controlled by Parent
    onOpenEditor?: () => void;
    ttsPhrases: string[];            // Array of 8 TTS phrases
    onTtsPhraseChange: (phrases: string[]) => void; // Update TTS phrases
    onHarmonize?: (bankIndex: number, chordType: string) => Promise<void>; // New prop
}

// 8 Banks
const SAMPLE_BANKS = Array.from({ length: 8 }, (_, i) => `${i + 1}`);

export const SamplerPanel: React.FC<SamplerPanelProps> = ({
    params, onChange, onLoadSample, audioContext, activeBankIdx, onBankChange, onOpenEditor,
    ttsPhrases, onTtsPhraseChange,
    onHarmonize
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const [ttsReady, setTtsReady] = useState(false);
    const [flashBankIdx, setFlashBankIdx] = useState<number | null>(null);
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isProcessingHarmonize, setIsProcessingHarmonize] = useState(false);
    const [chordType, setChordType] = useState('minor');

    const handleHarmonizeClick = async () => {
        if (!onHarmonize) return;
        setIsProcessingHarmonize(true);
        setStatus("Harmonizing...");
        try {
            await onHarmonize(activeBankIdx, chordType);
            setStatus("Harmonized!");
        } catch (e) {
            console.error(e);
            setStatus("Error");
        } finally {
            setIsProcessingHarmonize(false);
        }
    };

    // Get the TTS text for the current bank with bounds checking
    const currentTtsText = (ttsPhrases && activeBankIdx >= 0 && activeBankIdx < 8) 
        ? (ttsPhrases[activeBankIdx] || "Hello World")
        : "Hello World";

    // Update TTS text for current bank with bounds validation
    const setCurrentTtsText = (text: string) => {
        if (activeBankIdx < 0 || activeBankIdx >= 8) {
            console.warn(`Invalid bank index: ${activeBankIdx}`);
            return;
        }
        const newPhrases = [...ttsPhrases];
        newPhrases[activeBankIdx] = text;
        onTtsPhraseChange(newPhrases);
    };

    // Helpers to access current bank's params safely
    const currentParams = params[activeBankIdx] || {
        sampleName: `bank_${activeBankIdx}`,
        playbackSpeed: 1.0,
        volume: 1.0,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0
    };

    // Update single param for active bank
    const updateParam = (key: keyof typeof currentParams, value: number) => {
        const newParams = [...params];
        newParams[activeBankIdx] = { ...currentParams, [key]: value };
        onChange(newParams);
    };

    useEffect(() => {
        const initTTS = async () => {
            try {
                await SupertonicService.getInstance().init();
                setTtsReady(SupertonicService.getInstance().isServiceReady());
            } catch (e) {
                console.error("TTS Init Error:", e);
                setStatus("TTS Unavailable");
            }
        };
        initTTS();
    }, []);

    const loadBufferToBank = (buffer: AudioBuffer) => {
        const bankName = `bank_${activeBankIdx}`;
        onLoadSample(bankName, buffer);

        // Ensure name is synced
        if (currentParams.sampleName !== bankName) {
            const newParams = [...params];
            newParams[activeBankIdx] = { ...currentParams, sampleName: bankName };
            onChange(newParams);
        }

        // Flash UI
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        setFlashBankIdx(activeBankIdx);
        flashTimeoutRef.current = setTimeout(() => setFlashBankIdx(null), 1000);
    };

    const handleTTS = async () => {
        if (!audioContext || !SupertonicService.getInstance().isServiceReady()) {
            setStatus("Engine not ready");
            return;
        }

        setIsGenerating(true);
        setStatus("Generating...");
        try {
            const rawData = await SupertonicService.getInstance().generate(currentTtsText);
            const buffer = audioContext.createBuffer(1, rawData.length, 44100);
            buffer.getChannelData(0).set(rawData);

            loadBufferToBank(buffer);
            setStatus(`Gen: Bank ${activeBankIdx + 1}`);
        } catch (e) {
            console.error(e);
            setStatus("Gen Error");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setStatus('Loading...');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            loadBufferToBank(audioBuffer);
            setStatus(`Loaded: ${file.name.substring(0, 10)}...`);
        } catch (err) {
            setStatus('Load Error');
        }
    };

    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            setStatus('Processing...');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;
                chunksRef.current = [];

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };

                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                    const arrayBuffer = await blob.arrayBuffer();
                    try {
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        loadBufferToBank(audioBuffer);
                        setStatus('Recorded!');
                    } catch (e) { setStatus('Decode Error'); }
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                setIsRecording(true);
                setStatus('Recording...');
            } catch (err) { setStatus('Mic Error'); }
        }
    };

    return (
        <div className="flex flex-col gap-2 p-3 text-xs font-mono text-gray-400 h-full">
            {/* ROW 1: Bank Selectors (8 Banks) */}
            <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Sample Banks">
                {SAMPLE_BANKS.map((label, i) => (
                    <button
                        key={i}
                        role="tab"
                        aria-selected={activeBankIdx === i}
                        aria-label={`Select Bank ${i + 1}`}
                        onClick={() => onBankChange(i)}
                        className={`min-w-[24px] py-1 text-[10px] font-bold border rounded transition-all ${
                            flashBankIdx === i ? 'bg-green-600 border-green-400 text-white animate-pulse' :
                            activeBankIdx === i
                                ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                        }`}
                        title={`Select Bank ${i+1}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* ROW 2: Actions */}
            <div className="flex justify-between items-center gap-2">
                <div className="flex gap-1">
                    <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="btn-mini px-2 py-0.5 bg-gray-700 rounded border border-gray-600 hover:bg-gray-600">LOAD</button>
                    <button onClick={toggleRecording} className={`btn-mini px-2 py-0.5 rounded border ${isRecording ? 'bg-red-900 border-red-500 animate-pulse text-white' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}>
                        {isRecording ? 'STOP' : 'REC'}
                    </button>
                </div>
                <div className="text-[10px] text-right truncate w-24 text-yellow-500" title={status}>{status}</div>
            </div>

            {/* ROW 3: TTS */}
            <div className="flex gap-1 mt-1">
                <input
                    value={currentTtsText}
                    onChange={e => setCurrentTtsText(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 text-white text-[10px] outline-none focus:border-purple-500"
                    placeholder="Phrase..."
                />
                <button
                    onClick={handleTTS}
                    disabled={isGenerating || !ttsReady}
                    className="px-2 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50"
                >
                    GEN
                </button>
                {onOpenEditor && <button onClick={onOpenEditor} className="text-[10px] text-purple-400 underline hover:text-white px-1">EDIT</button>}
            </div>

            {/* ROW 4: INSTANT HARMONIZER */}
            <div className="mt-1 bg-gray-800/30 p-1 rounded flex gap-1 items-center">
                <select
                    value={chordType}
                    onChange={(e) => setChordType(e.target.value)}
                    className="flex-1 bg-gray-900 text-[10px] text-gray-300 border border-gray-700 rounded px-1 h-5 outline-none focus:border-purple-500"
                >
                    <option value="major">Major</option>
                    <option value="minor">Minor</option>
                    <option value="maj7">Major 7</option>
                    <option value="min7">Minor 7</option>
                    <option value="octave">Octave</option>
                    <option value="stack">Power Stack</option>
                </select>
                <button
                    onClick={handleHarmonizeClick}
                    disabled={isProcessingHarmonize || !onHarmonize}
                    className="px-2 h-5 bg-cyan-900 border border-cyan-600 text-cyan-200 rounded text-[10px] hover:bg-cyan-800 disabled:opacity-50 font-bold"
                >
                    {isProcessingHarmonize ? '...' : 'HARM'}
                </button>
            </div>

            {/* ROW 5: Parameters for Active Bank */}
            <div className="grid grid-cols-4 gap-2 mt-1 bg-gray-800/30 p-1 rounded">
                <Knob label="Speed" value={currentParams.playbackSpeed || 1} onChange={v => updateParam('playbackSpeed', v)} min={0.1} max={4.0} color="purple" />
                <Knob label="Vol" value={currentParams.volume} onChange={v => updateParam('volume', v)} min={0} max={2.0} color="purple" />
                <Knob label="Filter" value={currentParams.filterCutoff} onChange={v => updateParam('filterCutoff', v)} min={100} max={20000} color="purple" logarithmic />
                <Knob label="Drive" value={currentParams.drive} onChange={v => updateParam('drive', v)} min={0} max={1} color="red" />
            </div>
        </div>
    );
};
