import React, { useRef, useState, useEffect } from 'react';
import type { SamplerParams } from '../types';
import { SupertonicService } from '../services/Supertonic';

interface SamplerPanelProps {
    params: SamplerParams;
    onChange: (updates: Partial<SamplerParams>) => void;
    onLoadSample: (name: string, buffer: AudioBuffer) => void;
    audioContext: AudioContext;
}

export const SamplerPanel: React.FC<SamplerPanelProps> = ({ params, onChange, onLoadSample, audioContext }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [ttsText, setTtsText] = useState("Hello World");
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        // Pre-init Supertonic
        SupertonicService.getInstance().init().catch(e => setStatus("TTS Init Failed"));
    }, []);

    const handleTTS = async () => {
        if (!audioContext) return;
        setIsGenerating(true);
        setStatus("Generating...");
        try {
            const service = SupertonicService.getInstance();
            const rawData = await service.generate(ttsText);

            // Create Audio Buffer
            const buffer = audioContext.createBuffer(1, rawData.length, 44100); // Model is 44.1k
            buffer.getChannelData(0).set(rawData);

            onLoadSample(params.sampleName, buffer);
            setStatus("TTS Loaded");
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
        <div className="flex flex-col gap-4 p-4 text-xs font-mono text-gray-400 h-full">
            {/* ROW 1: Load / Record */}
            <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                    <label className="text-cyan-500 font-bold">FILE</label>
                    <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="px-2 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700">LOAD</button>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-red-500 font-bold">MIC</label>
                    <button onClick={toggleRecording} className={`px-2 py-1 border rounded ${isRecording ? 'bg-red-900 border-red-500 animate-pulse' : 'bg-gray-800 border-gray-600'}`}>
                        {isRecording ? 'STOP' : 'REC'}
                    </button>
                </div>

                <div className="flex-1 text-right text-white italic">{status}</div>
            </div>

            {/* ROW 2: TTS Generator */}
            <div className="flex flex-col gap-2 border-t border-gray-700 pt-2">
                <label className="text-purple-400 font-bold">SUPERTONIC TTS</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={ttsText}
                        onChange={(e) => setTtsText(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white focus:border-purple-500 outline-none"
                        placeholder="Type phrase..."
                    />
                    <button
                        onClick={handleTTS}
                        disabled={isGenerating}
                        className="px-3 py-1 bg-purple-900 border border-purple-500 text-purple-200 rounded hover:bg-purple-800 disabled:opacity-50"
                    >
                        {isGenerating ? '...' : 'GEN'}
                    </button>
                </div>
            </div>
        </div>
    );
};
