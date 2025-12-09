import React, { useRef, useState, useEffect } from 'react';
import type { SamplerParams } from '../types';
import { SupertonicService } from '../services/Supertonic';

interface SamplerPanelProps {
    params: SamplerParams;
    onChange: (updates: Partial<SamplerParams>) => void;
    onLoadSample: (name: string, buffer: AudioBuffer) => void;
    audioContext: AudioContext;
    onOpenEditor?: () => void;
}

const SAMPLE_BANKS = ['Bank A', 'Bank B', 'Bank C', 'Bank D'];

export const SamplerPanel: React.FC<SamplerPanelProps> = ({ params, onChange, onLoadSample, audioContext, onOpenEditor }) => {
    // ... items ...
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [ttsText, setTtsText] = useState("Hello World");
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const [activeBankIdx, setActiveBankIdx] = useState(0);
    const [ttsReady, setTtsReady] = useState(false);

    // Update sampleName when bank changes
    useEffect(() => {
        const bankName = `bank_${activeBankIdx}`;
        if (params.sampleName !== bankName) {
            onChange({ sampleName: bankName });
        }
    }, [activeBankIdx, onChange, params.sampleName]);

    useEffect(() => {
        // Pre-init Supertonic (gracefully handle failures)
        const initTTS = async () => {
            try {
                await SupertonicService.getInstance().init();
                setTtsReady(SupertonicService.getInstance().isServiceReady());
            } catch (e) {
                console.error("TTS Init Error:", e);
                setStatus("TTS Unavailable");
                setTtsReady(false);
            }
        };
        initTTS();
    }, []);

    const handleTTS = async () => {
        console.log("GEN clicked - handleTTS triggered");
        if (!audioContext) {
            console.log("No audioContext");
            return;
        }

        const service = SupertonicService.getInstance();
        console.log("Service ready?", service.isServiceReady());
        if (!service.isServiceReady()) {
            setStatus("TTS models not loaded");
            return;
        }

        setIsGenerating(true);
        setStatus("Generating...");
        try {
            const rawData = await service.generate(ttsText);

            // Create Audio Buffer
            const buffer = audioContext.createBuffer(1, rawData.length, 44100); // Model is 44.1k
            buffer.getChannelData(0).set(rawData);

            onLoadSample(params.sampleName, buffer);
            setStatus("TTS Loaded");
        } catch (e) {
            console.error("TTS Generation Error:", e);
            setStatus(e instanceof Error ? e.message : "Gen Error");
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
            onLoadSample(params.sampleName, audioBuffer);
            setStatus(`Loaded: ${file.name}`);
        } catch (err) {
            console.error(err);
            setStatus('Error loading file');
        }
    };

    const toggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            setStatus('Processing...');
        } else {
            // Start recording
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
                        onLoadSample(params.sampleName, audioBuffer);
                        setStatus('Recorded Sample Loaded');
                    } catch (e) {
                        console.error(e);
                        setStatus('Decode Error');
                    }
                    // Stop all tracks
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                setIsRecording(true);
                setStatus('Recording...');
            } catch (err) {
                console.error("Mic access denied:", err);
                setStatus('Mic Error');
            }
        }
    };

    return (
        <div className="flex flex-col gap-2 p-3 text-xs font-mono text-gray-400 h-full justify-center">
            {/* ROW 1: Banks & File/Mic */}
            <div className="flex items-center justify-between">
                <div className="flex gap-1">
                    {SAMPLE_BANKS.map((b, i) => (
                        <button
                            key={b}
                            onClick={() => setActiveBankIdx(i)}
                            className={`px-2 py-1 rounded text-[10px] border ${activeBankIdx === i ? 'bg-cyan-900 border-cyan-500 text-cyan-300' : 'bg-gray-800 border-gray-700'
                                }`}
                        >
                            {['A', 'B', 'C', 'D'][i]}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="text-[10px] bg-gray-800 px-2 py-1 rounded hover:bg-gray-700 border border-gray-600">LOAD</button>
                    <button onClick={toggleRecording} className={`text-[10px] px-2 py-1 border rounded ${isRecording ? 'bg-red-900 border-red-500 animate-pulse' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`}>
                        {isRecording ? 'STOP' : 'REC'}
                    </button>
                </div>
            </div>

            {/* ROW 2: TTS Controls */}
            <div className="flex flex-col gap-1 border-t border-gray-700 pt-2">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-purple-400 font-bold text-[10px]">TTS ENGINE</span>
                        <div className={`w-2 h-2 rounded-full ${ttsReady ? 'bg-green-500 shadow-[0_0_5px_lime]' : 'bg-red-900'}`} title={ttsReady ? "Ready" : "Loading/Failed"}></div>
                    </div>
                    {onOpenEditor && (
                        <button onClick={onOpenEditor} className="text-[10px] text-purple-300 underline hover:text-white">EDIT VOICE</button>
                    )}
                </div>
                <div className="flex gap-1">
                    <input
                        value={ttsText}
                        onChange={e => setTtsText(e.target.value)}
                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 text-white focus:border-purple-500 text-[10px] outline-none"
                        placeholder="Type phrase..."
                    />
                    <button
                        onClick={handleTTS}
                        disabled={isGenerating || !ttsReady}
                        className="px-3 py-1 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50"
                    >
                        {isGenerating ? '...' : 'GEN'}
                    </button>
                </div>
                <div className="text-right text-[10px] text-gray-500 h-3 overflow-hidden">{status}</div>
            </div>
        </div>
    );
};
